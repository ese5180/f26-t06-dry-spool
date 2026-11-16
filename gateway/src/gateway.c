#include <stdio.h>
#include <string.h>
#include <zephyr/random/random.h>
#include "protocol.h"
#include "bridge.h"
#include "box_relay.h"
#include <zephyr/dfu/mcuboot.h>
#include <zephyr/net/conn_mgr_connectivity.h>
#include <zephyr/net/dhcpv4.h>
#include <memfault/metrics/metrics.h>

struct slot {
	struct bt_conn *link; /* Owned by the gateway main loop. */
	uint16_t handle;
	struct box_sample sample;
	int64_t seen;
	uint32_t pending;
	uint8_t requested;
	bool send;
	int64_t deadline;
};
static struct slot boxes[2];
static K_MUTEX_DEFINE(lock);
static const char *const modes[] = {"auto", "on", "off"};
static const char *const names[] = {"DrySpool A", "DrySpool B"};

int gateway_snapshot(int slot, char *out, size_t size)
{
	k_mutex_lock(&lock, K_FOREVER);
	struct slot *s = &boxes[slot];
	struct box_sample b = s->sample;
	int64_t age = s->seen ? k_uptime_get() - s->seen : -1;
	bool fresh = age >= 0 && age < 10000;
	char temp[20] = "null", rh[20] = "null", grams[16] = "null";
	if (fresh && (b.flags & ENV_OK)) {
		snprintf(temp, sizeof(temp), "%.3f", (int32_t)sys_get_le32(b.temp) / 1000.0);
		snprintf(rh, sizeof(rh), "%.3f", (int32_t)sys_get_le32(b.rh) / 1000.0);
	}
	if (fresh && (b.flags & GRAMS_OK)) {
		snprintf(grams, sizeof(grams), "%d", (int32_t)sys_get_le32(b.grams));
	}
	bool valid = fresh && (b.flags & FAN_OK);
	int n = snprintf(
		out, size,
		"{\"slot\":\"%c\",\"device\":\"%s\",\"ageMs\":%lld,\"online\":%s,\"seq\":%u,"
		"\"temperature\":%s,"
		"\"humidity\":%s,\"grams\":%s,\"fan\":%s,\"mode\":\"%s\",\"request\":%u,"
		"\"control\":%s,\"pending\":%s,\"desired\":\"%s\",\"error\":%s}",
		'A' + slot, names[slot], (long long)age, fresh ? "true" : "false",
		k_uptime_get_32(), temp, rh, grams,
		valid ? ((b.flags & OUTPUT_ON) ? "true" : "false") : "null",
		valid && b.mode < ARRAY_SIZE(modes) ? modes[b.mode] : "",
		sys_get_le32(b.command_id), valid ? "true" : "false", s->pending ? "true" : "false",
		modes[s->requested], !fresh ? "\"箱子离线\"" : "null");
	k_mutex_unlock(&lock);
	return n;
}

static int queue_command(int slot, const char *mode, uint32_t id, int64_t deadline)
{
	int index = 0;
	while (index < ARRAY_SIZE(modes) && strcmp(mode, modes[index])) {
		index++;
	}
	if (index == ARRAY_SIZE(modes)) {
		return -EINVAL;
	}
	struct slot *s = &boxes[slot];
	k_mutex_lock(&lock, K_FOREVER);
	int rc = -EBUSY;
	if (s->seen && k_uptime_get() - s->seen < 10000 && (s->sample.flags & FAN_OK) &&
	    !s->pending) {
		s->pending = id;
		s->requested = index;
		s->send = true;

		s->deadline = deadline;
		rc = 0;
	}
	k_mutex_unlock(&lock);
	return rc;
}

int gateway_command(int slot, const char *mode, uint32_t *id)
{
	*id = (sys_rand32_get() & INT32_MAX) | 1;
	return queue_command(slot, mode, *id, k_uptime_get() + 10000);
}

int gateway_cloud_command(int slot, const char *mode, uint32_t id, int64_t remaining_ms)
{
	/* Cloud reports the command only after the node's readback matches its id and mode. */
	k_mutex_lock(&lock, K_FOREVER);
	const struct slot *s = &boxes[slot];
	bool applied = s->seen && k_uptime_get() - s->seen < 10000 && (s->sample.flags & FAN_OK) &&
		       s->sample.mode < ARRAY_SIZE(modes) && !strcmp(modes[s->sample.mode], mode) &&
		       sys_get_le32(s->sample.command_id) == id;
	k_mutex_unlock(&lock);
	if (applied) {
		return 1;
	}
	if (remaining_ms <= 0 || remaining_ms > 60000) {
		return -ETIME;
	}
	return queue_command(slot, mode, id, k_uptime_get() + MIN(remaining_ms, 10000));
}

struct candidate {
	int slot;
	bt_addr_le_t addr;
};
K_MSGQ_DEFINE(found, sizeof(struct candidate), 8, 4);
static atomic_t occupied;
static bool name_field(struct bt_data *d, void *ctx)
{
	struct candidate *p = ctx;
	if (d->type != BT_DATA_NAME_COMPLETE) {
		return true;
	}
	for (int i = 0; i < ARRAY_SIZE(names); i++) {
		if (!atomic_test_bit(&occupied, i) && d->data_len == strlen(names[i]) &&
		    !memcmp(d->data, names[i], d->data_len)) {
			p->slot = i;
			k_msgq_put(&found, p, K_NO_WAIT);
			return false;
		}
	}
	return true;
}

static void scan_cb(const bt_addr_le_t *addr, int8_t rssi, uint8_t type, struct net_buf_simple *ad)
{
	if (type == BT_GAP_ADV_TYPE_ADV_IND) {
		struct candidate p = {.addr = *addr};
		bt_data_parse(ad, name_field, &p);
	}
}

/* Serialize client reads. The ATT callback finishes before the next request
 * reuses these parameters. The HTTP server runs independently. */
static struct bt_gatt_read_params reader;
static struct box_sample received;
static uint16_t received_handle;
static K_SEM_DEFINE(read_done, 0, 1);

static uint8_t on_read(struct bt_conn *conn, uint8_t err, struct bt_gatt_read_params *params,
		       const void *data, uint16_t len)
{
	if (!err && data && len == sizeof(received)) {
		memcpy(&received, data, len);
		received_handle = params->by_uuid.start_handle;
	}
	k_sem_give(&read_done);
	return BT_GATT_ITER_STOP;
}

static void poll_box(struct slot *s)
{
	if (bt_conn_get_security(s->link) < BT_SECURITY_L2) {
		bt_conn_set_security(s->link, BT_SECURITY_L2);
		return;
	}
	box_relay_connected(s - boxes, s->link);
	k_mutex_lock(&lock, K_FOREVER);
	if (s->pending && k_uptime_get() >= s->deadline) {
		s->send = false;

		s->pending = 0;
	}
	bool send = s->send && s->handle;
	uint8_t cmd[5] = {s->requested};
	sys_put_le32(s->pending, cmd + 1);
	k_mutex_unlock(&lock);
	if (send && !bt_gatt_write_without_response(s->link, s->handle, cmd, sizeof(cmd), false)) {
		k_mutex_lock(&lock, K_FOREVER);
		s->send = false;
		k_mutex_unlock(&lock);
	}
	received_handle = 0;
	reader = (struct bt_gatt_read_params){
		.func = on_read,
		.by_uuid = {.start_handle = 1, .end_handle = 0xffff, .uuid = DS_BOX}};
	if (bt_gatt_read(s->link, &reader)) {
		return;
	}
	k_sem_take(&read_done, K_FOREVER);
	if (!received_handle) {
		return;
	}
	k_mutex_lock(&lock, K_FOREVER);
	s->handle = received_handle;
	s->sample = received;
	if (received.flags & ENV_OK) {
		int32_t rh = (int32_t)sys_get_le32(received.rh) / 100;
		int32_t t = (int32_t)sys_get_le32(received.temp) / 100;
		if (s == boxes) {
			MEMFAULT_METRIC_SET_UNSIGNED(box_a_rh, rh);
			MEMFAULT_METRIC_SET_SIGNED(box_a_temp, t);
		} else {
			MEMFAULT_METRIC_SET_UNSIGNED(box_b_rh, rh);
			MEMFAULT_METRIC_SET_SIGNED(box_b_temp, t);
		}
	}
	if (received.flags & GRAMS_OK) {
		uint32_t g = sys_get_le32(received.grams);
		if (s == boxes) {
			MEMFAULT_METRIC_SET_UNSIGNED(box_a_grams, g);
		} else {
			MEMFAULT_METRIC_SET_UNSIGNED(box_b_grams, g);
		}
	}
	s->seen = k_uptime_get();
	if (s->pending && (received.flags & FAN_OK) && received.mode == s->requested &&
	    sys_get_le32(received.command_id) == s->pending) {
		s->pending = 0;
	}
	k_mutex_unlock(&lock);
}

int main(void)
{
	int rc = radio_start();
	if (rc) {
		printk("BLE startup failed: %d\n", rc);
		return rc;
	}
	conn_mgr_all_if_up(true);
	net_dhcpv4_start(net_if_get_default());
	conn_mgr_all_if_connect(true);
	rc = gateway_http_start();
	if (rc) {
		printk("HTTP startup failed: %d\n", rc);
		return rc;
	}
	bool scanning = false;
	for (;;) {
		bool connecting = false;
		for (int i = 0; i < ARRAY_SIZE(boxes); i++) {
			struct slot *s = &boxes[i];
			if (!s->link) {
				continue;
			}
			struct bt_conn_info info;
			if (bt_conn_get_info(s->link, &info) ||
			    info.state == BT_CONN_STATE_DISCONNECTED) {
				bt_conn_unref(s->link);
				k_mutex_lock(&lock, K_FOREVER);
				*s = (struct slot){0};
				k_mutex_unlock(&lock);
				atomic_clear_bit(&occupied, i);
			} else if (info.state == BT_CONN_STATE_CONNECTED) {
				poll_box(s);
			} else {
				connecting = true;
			}
		}
		if (!connecting && atomic_get(&occupied) != 3 && !scanning) {
			scanning = !bt_le_scan_start(BT_LE_SCAN_PASSIVE, scan_cb);
		}
		struct candidate p;
		if (scanning && !k_msgq_get(&found, &p, K_NO_WAIT) && !boxes[p.slot].link) {
			bt_le_scan_stop();
			scanning = false;
			k_msgq_purge(&found);
			rc = bt_conn_le_create(&p.addr, BT_CONN_LE_CREATE_CONN,
					       BT_LE_CONN_PARAM_DEFAULT, &boxes[p.slot].link);
			if (!rc) {
				atomic_set_bit(&occupied, p.slot);
			}
		}
		if (scanning || atomic_get(&occupied)) {
			if (!boot_is_img_confirmed()) {
				boot_write_img_confirmed();
			}
		}
		k_sleep(K_MSEC(500));
	}
}
