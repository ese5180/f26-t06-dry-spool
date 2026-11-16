#include <cJSON.h>
#include <date_time.h>
#include <stdio.h>
#include <string.h>
#include <net/nrf_cloud_coap.h>
#include <zephyr/kernel.h>
#include <zephyr/logging/log.h>

#include "dashboard.h"
#include "telemetry.h"

LOG_MODULE_REGISTER(dryspool_dashboard, LOG_LEVEL_INF);

static const char *const modes[] = {"auto", "on", "off"};

static void fetch_request(void)
{
	static char buffer[4097];
	size_t len = sizeof(buffer) - 1;
	int rc = nrf_cloud_coap_shadow_get(buffer, &len, false, COAP_CONTENT_FORMAT_APP_JSON);
	if (rc || !len) {
		if (rc) {
			LOG_WRN("Shadow read failed: %d", rc);
		}
		return;
	}
	buffer[len] = 0;
	cJSON *root = cJSON_Parse(buffer);
	const cJSON *config = cJSON_GetObjectItemCaseSensitive(root, "config");
	const cJSON *mode = cJSON_GetObjectItemCaseSensitive(config, "fan_mode");
	const cJSON *id = cJSON_GetObjectItemCaseSensitive(config, "fan_request_id");
	if (cJSON_IsString(mode) && cJSON_IsNumber(id) && id->valuedouble > 0 &&
	    id->valuedouble <= INT32_MAX && id->valuedouble == id->valueint) {
		for (int i = FAN_AUTO; i <= FAN_OFF; i++) {
			if (strcmp(mode->valuestring, modes[i]) == 0) {
				dryspool_set_fan_request((struct fan_request){i, id->valueint});
				break;
			}
		}
	}
	cJSON_Delete(root);
}

void dryspool_dashboard_sync(void)
{
	struct dryspool_sample s;
	fetch_request();
	if (!dryspool_read_latest(&s) || !dryspool_sample_is_fresh(&s, k_uptime_get())) {
		return;
	}
	int64_t ts = s.uptime_ms;
	if (date_time_uptime_to_unix_time_ms(&ts)) {
		return;
	}
	/* A complete snapshot with validity flags prevents a merged shadow from
	 * presenting an invalid channel's previous value as a new measurement. */
	char report[512];
	char ack[110] = "";
	if (s.fan_valid) {
		snprintf(ack, sizeof(ack), "\"config\":{\"fan_mode\":\"%s\",\"fan_request_id\":%d},",
			 modes[s.fan_request.mode], s.fan_request.id);
	}
	int n = snprintf(report, sizeof(report),
		"{%s\"dryspool\":{\"sample_ms\":%lld,\"env_valid\":%s,\"temperature_mc\":%d,"
		"\"humidity_mpct\":%d,\"grams_valid\":%s,\"filament_g\":%d,\"fan_valid\":%s,"
		"\"fan_on\":%s}}", ack, (long long)ts, s.env_valid ? "true" : "false",
		s.temperature_mc, s.humidity_mpct, s.grams_valid ? "true" : "false",
		s.filament_g, s.fan_valid ? "true" : "false", s.fan_on ? "true" : "false");
	if (n > 0 && (size_t)n < sizeof(report)) {
		int rc = nrf_cloud_coap_shadow_state_update(report);
		if (rc) {
			LOG_WRN("Shadow report failed: %d", rc);
		}
	}
}
