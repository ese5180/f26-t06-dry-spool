#include <stdio.h>
#include <string.h>
#include <memfault/http/http_client.h>
#include <memfault/ports/zephyr/http.h>
#include <zephyr/mgmt/mcumgr/transport/smp_bt.h>
#include <zcbor_decode.h>
#include <zcbor_encode.h>
#include "box_fleet_wire.h"
#include "box_image.h"
#include "box_relay.h"

#define TRANSFER_BLOCK   384
#define RELAY_PERIOD_MS  30000
#define UPDATE_PERIOD_MS 300000

/* One encrypted session at a time. Each request owns a reference until both
 * the HTTPS and ATT operations finish; sensor polling remains independent. */
struct job {
	struct bt_conn *conn;
	int slot;
};
K_MSGQ_DEFINE(jobs, sizeof(struct job), 2, sizeof(void *));
static atomic_t scheduled;
static int64_t next_visit[2], next_check[2];
static struct job current;
static struct box_fleet_info identity;
static struct box_relay_status statuses[2] = {{.ota = "unknown"}, {.ota = "unknown"}};
static K_MUTEX_DEFINE(status_lock);
static char downloaded_version[32];
struct trial {
	char target[32];
	int64_t deadline;
};
static struct trial trials[2];

void box_relay_snapshot(int slot, struct box_relay_status *out)
{
	k_mutex_lock(&status_lock, K_FOREVER);
	*out = statuses[slot];
	k_mutex_unlock(&status_lock);
}

static void phase(const char *value)
{
	k_mutex_lock(&status_lock, K_FOREVER);
	statuses[current.slot].ota = value;
	k_mutex_unlock(&status_lock);
}

static K_SEM_DEFINE(att_done, 0, 1);
static int att_status;
static uint16_t found_handle;
static uint8_t *read_buf;
static size_t read_len, read_capacity;
static struct bt_gatt_discover_params discovery;
static struct bt_gatt_read_params read_params;
static struct bt_gatt_write_params write_params;

static uint8_t discovered(struct bt_conn *conn, const struct bt_gatt_attr *attr,
			  struct bt_gatt_discover_params *params)
{
	if (attr) {
		const struct bt_gatt_chrc *ch = attr->user_data;
		found_handle = ch->value_handle;
	}
	k_sem_give(&att_done);
	return BT_GATT_ITER_STOP;
}

static uint16_t characteristic(const struct bt_uuid *uuid)
{
	found_handle = 0;
	discovery = (struct bt_gatt_discover_params){.start_handle = 1,
						     .end_handle = 0xffff,
						     .type = BT_GATT_DISCOVER_CHARACTERISTIC,
						     .uuid = uuid,
						     .func = discovered};
	if (bt_gatt_discover(current.conn, &discovery) == 0) {
		k_sem_take(&att_done, K_FOREVER);
	}
	return found_handle;
}

static uint8_t on_read(struct bt_conn *conn, uint8_t err, struct bt_gatt_read_params *p,
		       const void *data, uint16_t len)
{
	if (!err && data && len <= read_capacity - read_len) {
		memcpy(read_buf + read_len, data, len);
		read_len += len;
		return BT_GATT_ITER_CONTINUE;
	}
	att_status = (err || data) ? -EIO : 0;
	k_sem_give(&att_done);
	return BT_GATT_ITER_STOP;
}

static int read_value(uint16_t handle, void *buf, size_t capacity)
{
	read_params = (struct bt_gatt_read_params){
		.handle_count = 1, .single.handle = handle, .func = on_read};
	read_buf = buf;
	read_len = 0;
	read_capacity = capacity;
	int rc = bt_gatt_read(current.conn, &read_params);
	if (rc) {
		return rc;
	}
	k_sem_take(&att_done, K_FOREVER);
	return att_status ? att_status : (int)read_len;
}

static void on_written(struct bt_conn *conn, uint8_t err, struct bt_gatt_write_params *p)
{
	att_status = err ? -EIO : 0;
	k_sem_give(&att_done);
}

static int write_value(uint16_t handle, const void *data, size_t size)
{
	write_params = (struct bt_gatt_write_params){
		.handle = handle, .data = data, .length = size, .func = on_written};
	int rc = bt_gatt_write(current.conn, &write_params);
	if (rc) {
		return rc;
	}
	k_sem_take(&att_done, K_FOREVER);
	return att_status;
}

static void forward_chunks(void)
{
	uint16_t h = characteristic(DS_FLEET_CHUNK);
	sMemfaultHttpContext http = {.sock_fd = -1};
	for (int i = 0; h && i < 32; i++) {
		uint8_t chunk[4 + DS_CHUNK_MAX];
		int n = read_value(h, chunk, sizeof(chunk));
		if (n <= 4 || (http.sock_fd < 0 && memfault_zephyr_port_http_open_socket(&http)) ||
		    memfault_zephyr_port_http_post_chunk(&http, chunk + 4, n - 4) ||
		    write_value(h, chunk, 4)) {
			break;
		}
	}
	memfault_zephyr_port_http_close_socket(&http);
}

/* MCUmgr stays the only writer of each box's upgrade slot. It serves the
 * Nordic phone application and this BLE central with the same protocol. */
struct channel {
	struct bt_gatt_subscribe_params sub;
	struct k_sem joined;
	atomic_t subscribed;
	uint16_t handle;
};
static struct channel channels[2];
static struct channel *channel;
static K_SEM_DEFINE(smp_done, 0, 1);
static struct k_spinlock rx_lock;
static uint8_t response[768], response_id, sequence;
static uint16_t response_group;
static uint8_t response_op;
static size_t received, expected;
static bool awaiting;
static uint8_t command[TRANSFER_BLOCK + 80];
static uint8_t block[TRANSFER_BLOCK];
static size_t offset, image_size, used;
static struct box_image_identity signed_role;

static uint8_t notified(struct bt_conn *conn, struct bt_gatt_subscribe_params *sub,
			const void *data, uint16_t len)
{
	struct channel *ch = CONTAINER_OF(sub, struct channel, sub);
	k_spinlock_key_t key = k_spin_lock(&rx_lock);
	bool signal = false;
	if (!data) {
		atomic_clear(&ch->subscribed);
		if (ch == channel && awaiting) {
			awaiting = false;
			received = 0;
			signal = true;
		}
	} else if (ch == channel && awaiting) {
		const uint8_t *p = data;
		if (received == 0) {
			if (len < 8 || p[0] != response_op ||
			    sys_get_be16(p + 4) != response_group || p[6] != sequence ||
			    p[7] != response_id) {
				goto done;
			}
			expected = 8 + sys_get_be16(p + 2);
		}
		if (expected > sizeof(response) || len > expected - received) {
			awaiting = false;
			received = 0;
			signal = true;
		} else {
			memcpy(response + received, data, len);
			received += len;
			if (received == expected) {
				awaiting = false;
				signal = true;
			}
		}
	}
done:
	k_spin_unlock(&rx_lock, key);
	if (signal) {
		k_sem_give(&smp_done);
	}
	return BT_GATT_ITER_CONTINUE;
}

static void subscribed(struct bt_conn *conn, uint8_t err, struct bt_gatt_subscribe_params *sub)
{
	struct channel *ch = CONTAINER_OF(sub, struct channel, sub);
	atomic_set(&ch->subscribed, !err);
	k_sem_give(&ch->joined);
}

static bool open_image_channel(void)
{
	struct channel *ch = &channels[current.slot];
	if (!atomic_get(&ch->subscribed)) {
		ch->handle = characteristic(SMP_BT_CHR_UUID);
		if (!ch->handle) {
			return false;
		}
		/* smp_bt.c defines the CCC immediately following the value. */
		ch->sub = (struct bt_gatt_subscribe_params){.notify = notified,
							    .subscribe = subscribed,
							    .value_handle = ch->handle,
							    .ccc_handle = ch->handle + 1,
							    .value = BT_GATT_CCC_NOTIFY};
		atomic_set_bit(ch->sub.flags, BT_GATT_SUBSCRIBE_FLAG_VOLATILE);
		k_sem_reset(&ch->joined);
		if (bt_gatt_subscribe(current.conn, &ch->sub)) {
			return false;
		}
		k_sem_take(&ch->joined, K_FOREVER);
	}
	return atomic_get(&ch->subscribed);
}

static bool transact(uint8_t op, uint16_t group, uint8_t id, size_t body_size)
{
	uint8_t *p = command;
	p[0] = op;
	p[1] = 0;
	sys_put_be16(body_size, p + 2);
	sys_put_be16(group, p + 4);
	p[7] = id;
	k_spinlock_key_t key = k_spin_lock(&rx_lock);
	channel = &channels[current.slot];
	p[6] = ++sequence;
	response_id = id;
	response_group = group;
	response_op = op + 1;
	received = expected = 0;
	k_sem_reset(&smp_done);
	awaiting = true;
	k_spin_unlock(&rx_lock, key);
	size_t n = body_size + 8;
	bool ok = true;
	while (n) {
		size_t len = MIN(n, bt_gatt_get_mtu(current.conn) - 3U);
		int rc = bt_gatt_write_without_response(current.conn, channel->handle, p, len,
							false);
		if (rc) {
			ok = false;
			break;
		}
		n -= len;
		p += len;
	}
	if (ok) {
		ok = k_sem_take(&smp_done, K_SECONDS(60)) == 0;
	}
	key = k_spin_lock(&rx_lock);
	awaiting = false;
	ok = ok && received >= 8 && received == expected;
	k_spin_unlock(&rx_lock, key);
	return ok;
}

static bool string_is(struct zcbor_string *s, const char *literal)
{
	return s->len == strlen(literal) && !memcmp(s->value, literal, s->len);
}

static bool response_number(const char *name, size_t wanted)
{
	ZCBOR_STATE_D(d, 4, response + 8, received - 8, 1, 0);
	uint32_t num;
	return zcbor_unordered_map_start_decode(d) && zcbor_search_key_tstr_term(d, name, 16) &&
	       zcbor_uint32_decode(d, &num) && num == wanted;
}

static bool send_block(size_t len)
{
	if (!box_image_observe(&signed_role, block, len, offset, image_size)) {
		return false;
	}
	if (offset == 0) {
		snprintf(downloaded_version, sizeof(downloaded_version), "%u.%u.%u+%u", block[20],
			 block[21], (unsigned)sys_get_le16(block + 22),
			 (unsigned)sys_get_le32(block + 24));
	}
	ZCBOR_STATE_E(e, 4, command + 8, sizeof(command) - 8, 1);
	if (!zcbor_map_start_encode(e, 4) || !zcbor_tstr_put_lit(e, "off") ||
	    !zcbor_uint32_put(e, offset) || !zcbor_tstr_put_lit(e, "data") ||
	    !zcbor_bstr_encode_ptr(e, block, len)) {
		return false;
	}
	if (!offset && (!zcbor_tstr_put_lit(e, "len") || !zcbor_uint32_put(e, image_size) ||
			!zcbor_tstr_put_lit(e, "upgrade") || !zcbor_bool_put(e, true))) {
		return false;
	}
	if (!zcbor_map_end_encode(e, 4) || !transact(2, 1, 1, e->payload - command - 8) ||
	    !response_number("off", offset + len)) {
		return false;
	}
	offset += len;
	return true;
}

static bool begin_update(const sMemfaultOtaInfo *info, void *ctx)
{
	phase("transferring");
	offset = used = 0;
	image_size = info->size;
	return image_size >= 32 && image_size < 896U * 1024 && open_image_channel();
}

static bool image_bytes(void *buf, size_t len, void *ctx)
{
	if (len > image_size - offset - used) {
		return false;
	}
	uint8_t *p = buf;
	while (len) {
		size_t n = MIN(len, sizeof(block) - used);
		memcpy(block + used, p, n);
		used += n;
		p += n;
		len -= n;
		if (used == sizeof(block)) {
			if (!send_block(used)) {
				return false;
			}
			used = 0;
		}
	}
	return true;
}

static bool read_image_state(uint8_t hash[32], bool require_pending)
{
	ZCBOR_STATE_D(d, 8, response + 8, received - 8, 1, 0);
	struct zcbor_string key;
	if (!zcbor_map_start_decode(d) || !zcbor_tstr_decode(d, &key) ||
	    !string_is(&key, "images") || !zcbor_list_start_decode(d)) {
		return false;
	}
	while (!zcbor_array_at_end(d)) {
		uint32_t slot = UINT32_MAX;
		bool pending = false;
		struct zcbor_string digest = {0};
		if (!zcbor_map_start_decode(d)) {
			return false;
		}
		while (!zcbor_array_at_end(d)) {
			if (!zcbor_tstr_decode(d, &key)) {
				return false;
			}
			bool valid;
			if (string_is(&key, "slot")) {
				valid = zcbor_uint32_decode(d, &slot);
			} else if (string_is(&key, "pending")) {
				valid = zcbor_bool_decode(d, &pending);
			} else if (string_is(&key, "hash")) {
				valid = zcbor_bstr_decode(d, &digest);
			} else {
				valid = zcbor_any_skip(d, NULL);
			}
			if (!valid) {
				return false;
			}
		}
		if (!zcbor_map_end_decode(d)) {
			return false;
		}
		if (slot == 1 && digest.len == 32) {
			if (require_pending) {
				return pending && !memcmp(hash, digest.value, 32);
			}
			memcpy(hash, digest.value, 32);
			return true;
		}
	}
	return false;
}

static bool finish_update(void *ctx)
{
	uint8_t hash[32];
	if ((used && !send_block(used)) || offset != image_size ||
	    !box_image_matches(&signed_role, identity.hardware)) {
		return false;
	}
	command[8] = 0xa0; /* empty CBOR map */
	if (!transact(0, 1, 0, 1) || !read_image_state(hash, false)) {
		return false;
	}
	ZCBOR_STATE_E(e, 4, command + 8, sizeof(command) - 8, 1);
	if (!zcbor_map_start_encode(e, 2) || !zcbor_tstr_put_lit(e, "hash") ||
	    !zcbor_bstr_encode_ptr(e, hash, 32) || !zcbor_tstr_put_lit(e, "confirm") ||
	    !zcbor_bool_put(e, false) || !zcbor_map_end_encode(e, 2) ||
	    !transact(2, 1, 0, e->payload - command - 8) || !read_image_state(hash, true)) {
		return false;
	}
	command[8] = 0xa0;
	/* A board can reboot before delivering its reset response. Re-read its
	 * identity and MCUboot confirmation rather than concluding success here. */
	struct trial *trial = &trials[current.slot];
	strcpy(trial->target, downloaded_version);
	trial->deadline = k_uptime_get() + 180000;
	phase("restarting");
	return transact(2, 0, 5, 1);
}

/* The SDK calls this synchronously from the requesting thread. Only the box
 * worker substitutes its current peer; gateway heartbeat/FOTA use G's ID. */
static k_tid_t relay_tid;
static void http_identity(sMemfaultDeviceInfo *info)
{
	if (k_current_get() == relay_tid) {
		*info = (sMemfaultDeviceInfo){.device_serial = identity.serial,
					      .hardware_version = identity.hardware,
					      .software_type = identity.software,
					      .software_version = identity.version};
	} else {
		memfault_platform_get_device_info(info);
	}
}

static bool valid_field(const char *s, size_t n)
{
	size_t len = strnlen(s, n);
	return len && len < n && strcmp(s, "Unknown") &&
	       strspn(s, "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789.-_+") ==
		       len;
}

static void run_job(void)
{
	uint16_t h = characteristic(DS_FLEET_INFO);
	const char *role = current.slot ? "dryspool-box-b" : "dryspool-box-a";
	if (!h || read_value(h, &identity, sizeof(identity)) != sizeof(identity) ||
	    !valid_field(identity.serial, sizeof(identity.serial)) ||
	    !valid_field(identity.version, sizeof(identity.version)) ||
	    strncmp(identity.hardware, role, sizeof(identity.hardware)) ||
	    strncmp(identity.software, role, sizeof(identity.software))) {
		return;
	}
	struct box_relay_status *status = &statuses[current.slot];
	k_mutex_lock(&status_lock, K_FOREVER);
	strcpy(status->serial, identity.serial);
	strcpy(status->firmware, identity.version);
	if (!strcmp(status->ota, "unknown")) {
		status->ota = "idle";
	}
	k_mutex_unlock(&status_lock);
	struct trial *trial = &trials[current.slot];
	if (trial->target[0]) {
		if (identity.confirmed && !strcmp(identity.version, trial->target)) {
			phase("idle");
			trial->target[0] = 0;
			next_check[current.slot] = k_uptime_get() + UPDATE_PERIOD_MS;
		} else if (k_uptime_get() > trial->deadline) {
			phase("failed");
			trial->target[0] = 0;
			next_check[current.slot] = k_uptime_get() + UPDATE_PERIOD_MS;
		}
	}
	forward_chunks();
	if (!trial->target[0] && k_uptime_get() >= next_check[current.slot]) {
		phase("checking");
		uint8_t buf[512];
		const sMemfaultOtaUpdateHandler handler = {.buf = buf,
							   .buf_len = sizeof(buf),
							   .handle_update_available = begin_update,
							   .handle_data = image_bytes,
							   .handle_download_complete =
								   finish_update};
		int rc = memfault_zephyr_port_ota_update(&handler);
		if (!trial->target[0]) {
			phase(rc < 0 ? "failed" : "idle");
		}
		printk("Box %c release check (%s): %d\n", 'A' + current.slot, identity.version, rc);
		next_check[current.slot] =
			k_uptime_get() + (rc < 0 ? RELAY_PERIOD_MS : UPDATE_PERIOD_MS);
	}
}

static void relay(void *a, void *b, void *c)
{
	relay_tid = k_current_get();
	for (int i = 0; i < ARRAY_SIZE(channels); i++) {
		k_sem_init(&channels[i].joined, 0, 1);
	}
	g_mflt_http_client_config.get_device_info = http_identity;
	for (;;) {
		k_msgq_get(&jobs, &current, K_FOREVER);
		run_job();
		bt_conn_unref(current.conn);
		atomic_clear_bit(&scheduled, current.slot);
	}
}
K_THREAD_DEFINE(box_uplink, 5632, relay, NULL, NULL, NULL, 9, 0, 0);

void box_relay_connected(int slot, struct bt_conn *conn)
{
	int64_t now = k_uptime_get();
	if (now < next_visit[slot] || atomic_test_and_set_bit(&scheduled, slot)) {
		return;
	}
	struct job j = {.slot = slot, .conn = bt_conn_ref(conn)};
	if (k_msgq_put(&jobs, &j, K_NO_WAIT)) {
		bt_conn_unref(j.conn);
		atomic_clear_bit(&scheduled, slot);
	} else {
		next_visit[slot] = now + RELAY_PERIOD_MS;
	}
}
