#include <errno.h>
#include <stdio.h>
#include <string.h>
#include <cJSON.h>
#include <date_time.h>
#include <net/nrf_cloud_coap.h>
#include <zephyr/kernel.h>
#include <zephyr/logging/log.h>
#include <zephyr/net/net_if.h>
#include <zephyr/app_version.h>
#include "bridge.h"
#include "box_relay.h"

LOG_MODULE_REGISTER(gateway_shadow, LOG_LEVEL_INF);

/* Buffered only in the cloud thread. A blocked/reconnecting DTLS session
 * must not stop the LAN server, the BLE poller or local humidity control. */
static char incoming[4097];
static char report[1200];

static int get_config(bool delta, cJSON **root)
{
	size_t n = sizeof(incoming) - 1;
	*root = NULL;
	int rc = nrf_cloud_coap_shadow_get(incoming, &n, delta, COAP_CONTENT_FORMAT_APP_JSON);
	if (rc || !n) {
		return rc;
	}
	incoming[n] = 0;
	*root = cJSON_Parse(incoming);
	return *root ? 0 : -EBADMSG;
}

static int pending_slots(void)
{
	cJSON *root;
	int rc = get_config(true, &root);
	if (rc) {
		return rc > 0 ? -EPROTO : rc;
	}
	const cJSON *config = cJSON_GetObjectItemCaseSensitive(root, "config");
	int mask = (cJSON_GetObjectItemCaseSensitive(config, "A") ? BIT(0) : 0) |
		   (cJSON_GetObjectItemCaseSensitive(config, "B") ? BIT(1) : 0);
	cJSON_Delete(root);
	return mask;
}

static bool whole_number(const cJSON *value, double limit)
{
	return cJSON_IsNumber(value) && value->valuedouble >= 1 && value->valuedouble <= limit &&
	       (double)(uint32_t)value->valuedouble == value->valuedouble;
}

static int sync_boxes(void)
{
	/* A delta may omit the mode if only the request ID changed. Get the
	 * full desired tuple for slots with unacknowledged changes. */
	int mask = pending_slots();
	if (mask < 0) {
		return mask;
	}
	cJSON *root = NULL;
	if (mask) {
		int rc = get_config(false, &root);
		if (rc) {
			return rc;
		}
	}
	const cJSON *config = cJSON_GetObjectItemCaseSensitive(root, "config");
	char ack[2][90] = {0};
	for (int i = 0; i < 2; ++i) {
		if (!(mask & BIT(i))) {
			continue;
		}
		const cJSON *cmd = cJSON_GetObjectItemCaseSensitive(config, i ? "B" : "A");
		const cJSON *id = cJSON_GetObjectItemCaseSensitive(cmd, "request");
		const cJSON *mode = cJSON_GetObjectItemCaseSensitive(cmd, "mode");
		const cJSON *expires = cJSON_GetObjectItemCaseSensitive(cmd, "expires");
		int64_t now;
		if (!whole_number(id, INT32_MAX) || !whole_number(expires, UINT32_MAX) ||
		    !cJSON_IsString(mode) || date_time_now(&now)) {
			continue;
		}
		uint32_t until = (uint32_t)expires->valuedouble;
		if (gateway_cloud_command(i, mode->valuestring, id->valueint,
					  (int64_t)until * 1000 - now) == 1) {
			snprintf(ack[i], sizeof(ack[i]),
				 "\"%c\":{\"mode\":\"%s\",\"request\":%d,\"expires\":%u}", 'A' + i,
				 mode->valuestring, id->valueint, until);
		}
	}
	cJSON_Delete(root);
	char sample[2][475];
	for (int i = 0; i < 2; ++i) {
		int n = gateway_snapshot(i, sample[i], sizeof(sample[i]));
		if (n <= 0 || n >= sizeof(sample[i])) {
			return -ENOBUFS;
		}
		struct box_relay_status status;
		box_relay_snapshot(i, &status);
		/* The relay admits bounded, alphanumeric identity strings and
		 * supplies a literal phase after observing the box's state. */
		size_t left = sizeof(sample[i]) - (n - 1);
		int written = snprintf(sample[i] + n - 1, left,
				       ",\"firmware\":\"%s\",\"serial\":\"%s\",\"ota\":\"%s\"}",
				       status.firmware, status.serial, status.ota);
		if (written < 0 || written >= left) {
			return -ENOBUFS;
		}
	}
	bool any_ack = ack[0][0] || ack[1][0];
	int n = snprintf(report, sizeof(report), "{\"dryspool\":{\"A\":%s,\"B\":%s}%s%s%s%s%s}",
			 sample[0], sample[1], any_ack ? ",\"config\":{" : "", ack[0],
			 ack[0][0] && ack[1][0] ? "," : "", ack[1], any_ack ? "}" : "");
	if (n < 0 || n >= sizeof(report)) {
		return -ENOBUFS;
	}
	return nrf_cloud_coap_shadow_state_update(report);
}

static void shadow_worker(void *a, void *b, void *c)
{
	int rc;
	while ((rc = nrf_cloud_coap_init()) != 0) {
		LOG_WRN("Cloud init: %d", rc);
		k_sleep(K_SECONDS(30));
	}
	for (;;) {
		if (!net_if_ipv4_get_global_addr(net_if_get_default(), NET_ADDR_PREFERRED)) {
			k_sleep(K_SECONDS(5));
			continue;
		}
		if (!date_time_is_valid()) {
			date_time_update_async(NULL);
			k_sleep(K_SECONDS(15));
			continue;
		}
		rc = nrf_cloud_coap_connect(APP_VERSION_STRING);
		if (!rc) {
			LOG_INF("Gateway Device Shadow connected");
			while (!(rc = sync_boxes())) {
				k_sleep(K_SECONDS(5));
			}
		}
		LOG_WRN("Cloud session ended: %d; retrying", rc);
		(void)nrf_cloud_coap_disconnect();
		k_sleep(K_SECONDS(10));
	}
}

K_THREAD_DEFINE(shadow_thread, 6144, shadow_worker, NULL, NULL, NULL, 6, 0, 0);
