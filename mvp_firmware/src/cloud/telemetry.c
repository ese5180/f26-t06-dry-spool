#include <errno.h>
#include <date_time.h>
#include <memfault/metrics/metrics.h>
#include <net/nrf_cloud_coap.h>
#include <zephyr/kernel.h>
#include <zephyr/logging/log.h>

#include "telemetry.h"

LOG_MODULE_REGISTER(dryspool_telemetry, CONFIG_WIFI_NRF_CLOUD_LOG_LEVEL);

int dryspool_telemetry_send_latest(bool (*session_ready)(void))
{
	struct dryspool_sample s;
	struct dryspool_channel channels[DRYSPOOL_CHANNEL_COUNT];

	if (!dryspool_read_latest(&s)) {
		return 0;
	}
	size_t n = dryspool_telemetry_channels(&s, k_uptime_get(), channels);
	if (!n) {
		LOG_WRN("No fresh local sample for telemetry");
		return 0;
	}

	int64_t timestamp = s.uptime_ms;
	if (date_time_uptime_to_unix_time_ms(&timestamp)) {
		LOG_WRN("Sample time unavailable");
		return 0;
	}
	if (s.env_valid) {
		MEMFAULT_METRIC_SET_SIGNED(dryspool_temperature_c, s.temperature_mc / 100);
		MEMFAULT_METRIC_SET_UNSIGNED(dryspool_humidity_pct, s.humidity_mpct / 100);
	}
	if (s.grams_valid) {
		MEMFAULT_METRIC_SET_UNSIGNED(dryspool_filament_g, s.filament_g);
	}

	if (s.fan_valid) {
		MEMFAULT_METRIC_SET_UNSIGNED(dryspool_dehumidifier_on, s.fan_on);
	}

	for (size_t i = 0; i < n; i++) {
		if (!session_ready()) {
			return -ENETDOWN;
		}
		/* A confirmable message can wait for retransmissions. Skip the
		 * rest of this cycle if the snapshot has aged out meanwhile.
		 */
		if (!dryspool_sample_is_fresh(&s, k_uptime_get())) {
			break;
		}
		int rc = nrf_cloud_coap_sensor_send(channels[i].app_id, channels[i].value,
						    timestamp, true);
		if (rc) {
			LOG_WRN("CoAP send %s failed: %d", channels[i].app_id, rc);
			return rc;
		}
	}
	return 0;
}
