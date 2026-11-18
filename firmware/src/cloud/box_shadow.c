#include <cJSON.h>
#include <date_time.h>
#include <errno.h>
#include <net/nrf_cloud_coap.h>
#include <stdio.h>
#include <string.h>
#include <zephyr/app_version.h>
#include <zephyr/kernel.h>

#include "telemetry.h"
#include "ota/memfault_update.h"
#include "setup/provisioning.h"

/* One cloud worker owns the JSON buffer and the unacknowledged command. */
static char buffer[4097];
static const char *const modes[] = {"auto", "on", "off"};
static struct fan_request command;
static uint32_t expires;

static int get_shadow(bool delta, cJSON **result)
{
	size_t len = sizeof(buffer) - 1;
	*result = NULL;
	int rc = nrf_cloud_coap_shadow_get(buffer, &len, delta, COAP_CONTENT_FORMAT_APP_JSON);
	if (rc || len == 0) {
		return rc;
	}
	buffer[len] = 0;
	*result = cJSON_Parse(buffer);
	return *result ? 0 : -EBADMSG;
}

static const cJSON *fan_config(const cJSON *root)
{
	return cJSON_GetObjectItemCaseSensitive(cJSON_GetObjectItemCaseSensitive(root, "config"),
						"fan");
}

static bool positive_integer(const cJSON *item, uint32_t max)
{
	return cJSON_IsNumber(item) && item->valuedouble >= 1 && item->valuedouble <= max &&
	       (double)(uint32_t)item->valuedouble == item->valuedouble;
}

static int receive_command(void)
{
	cJSON *root;
	int rc = get_shadow(true, &root);
	bool changed = fan_config(root) != NULL;
	cJSON_Delete(root);
	if (rc || !changed) {
		return rc;
	}

	/* A delta can contain just the new ID when the mode is unchanged. */
	rc = get_shadow(false, &root);
	if (!rc) {
		const cJSON *fan = fan_config(root);
		const cJSON *mode = cJSON_GetObjectItemCaseSensitive(fan, "mode");
		const cJSON *id = cJSON_GetObjectItemCaseSensitive(fan, "request");
		const cJSON *until = cJSON_GetObjectItemCaseSensitive(fan, "expires");
		int64_t now;
		if (cJSON_IsString(mode) && positive_integer(id, INT32_MAX) &&
		    positive_integer(until, UINT32_MAX) && !date_time_now(&now)) {
			int64_t remaining = (int64_t)until->valuedouble * 1000 - now;
			for (int i = FAN_AUTO; remaining > 0 && remaining <= 60000 && i <= FAN_OFF;
			     i++) {
				if (!strcmp(mode->valuestring, modes[i])) {
					command =
						(struct fan_request){.mode = i, .id = id->valueint};
					expires = (uint32_t)until->valuedouble;
					dryspool_queue_fan_request(command,
								   k_uptime_get() + remaining);
					break;
				}
			}
		}
	}
	cJSON_Delete(root);
	return rc;
}

int dryspool_shadow_sync(void)
{
#ifdef CONFIG_DRYSPOOL_BLE_SETUP
	char proof[DRYSPOOL_PROOF_SIZE];
	if (dryspool_setup_proof(proof)) {
		snprintf(buffer, sizeof(buffer), "{\"dryspool_claim\":{\"proof\":\"%s\"}}", proof);
		int claim_rc = nrf_cloud_coap_shadow_state_update(buffer);
		if (claim_rc) {
			return claim_rc;
		}
		dryspool_setup_reported(proof);
	}
#endif
	int rc = receive_command();
	if (rc) {
		return rc;
	}
	struct dryspool_sample s;
	if (!dryspool_read_latest(&s) || !dryspool_sample_is_fresh(&s, k_uptime_get())) {
		return 0;
	}
	int64_t ts = s.uptime_ms;
	if (date_time_uptime_to_unix_time_ms(&ts)) {
		return 0;
	}
	char ack[120] = "";
	if (expires && s.fan_valid && s.fan_request.id == command.id &&
	    s.fan_request.mode == command.mode) {
		snprintf(ack, sizeof(ack),
			 ",\"config\":{\"fan\":{\"mode\":\"%s\",\"request\":%d,\"expires\":%u}}",
			 modes[command.mode], command.id, expires);
	}
	int n = snprintf(
		buffer, sizeof(buffer),
		"{\"dryspool\":{\"fan_api\":1,\"sample_ms\":%lld,\"env_valid\":%s,\"temperature_"
		"mc\":%d,"
		"\"humidity_mpct\":%d,\"grams_valid\":%s,\"filament_g\":%d,\"fan_valid\":%s,"
		"\"fan_on\":%s,\"mode\":\"%s\",\"request\":%d,\"firmware\":\"%s\",\"ota\":\"%s\"}%"
		"s}",
		(long long)ts, s.env_valid ? "true" : "false", s.temperature_mc, s.humidity_mpct,
		s.grams_valid ? "true" : "false", s.filament_g, s.fan_valid ? "true" : "false",
		s.fan_on ? "true" : "false", modes[s.fan_request.mode], s.fan_request.id,
		APP_VERSION_EXTENDED_STRING, memfault_fota_phase(), ack);
	if (n < 0 || n >= sizeof(buffer)) {
		return -ENOBUFS;
	}
	rc = nrf_cloud_coap_shadow_state_update(buffer);
	if (!rc && ack[0]) {
		expires = 0;
	}
	return rc;
}
