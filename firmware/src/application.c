/*
 * DrySpool application telemetry.
 *
 * Based on Nordic Semiconductor's Wi-Fi nRF Cloud sample.
 * SPDX-License-Identifier: LicenseRef-Nordic-5-Clause
 */

#include <zephyr/kernel.h>
#include <zephyr/logging/log.h>
#include <helpers/nrfx_reset_reason.h>
#include <date_time.h>
#include <net/nrf_cloud_codec.h>

#include "application.h"
#include "cloud_connection.h"
#include "dryspool_sensors.h"
#include "message_queue.h"
#if defined(CONFIG_SAMPLE_MEMFAULT_FOTA)
#include "memfault_fota_support.h"
#endif

LOG_MODULE_REGISTER(application, CONFIG_WIFI_NRF_CLOUD_LOG_LEVEL);

static K_TIMER_DEFINE(sensor_sample_timer, NULL, NULL);
static bool test_counter_enabled;

static int send_numeric_sample(const char *const app_id, double value)
{
	int ret;
	MSG_OBJ_DEFINE(msg_obj);

	ret = nrf_cloud_obj_msg_ts_init(&msg_obj, app_id,
					NRF_CLOUD_JSON_MSG_TYPE_VAL_DATA);
	if (ret) {
		return ret;
	}

	ret = nrf_cloud_obj_num_add(&msg_obj, NRF_CLOUD_JSON_DATA_KEY, value, false);
	if (ret) {
		nrf_cloud_obj_free(&msg_obj);
		return ret;
	}

	return send_device_message(&msg_obj);
}

static void send_dryspool_sample(const struct dryspool_reading *reading)
{
	LOG_INF("DrySpool: %.1f C, %.1f %%RH, %.1f g, dehumidifier %s",
		(double)reading->temperature_c, (double)reading->humidity_pct,
		(double)reading->filament_remaining_g,
		reading->dehumidifier_on ? "on" : "off");

	(void)send_numeric_sample("DRYSPOOL_TEMPERATURE_C", reading->temperature_c);
	(void)send_numeric_sample("DRYSPOOL_HUMIDITY_PCT", reading->humidity_pct);
	(void)send_numeric_sample("DRYSPOOL_FILAMENT_G", reading->filament_remaining_g);
	(void)send_numeric_sample("DRYSPOOL_DEHUMIDIFIER_ON",
				 reading->dehumidifier_on ? 1.0 : 0.0);
}

static void test_counter_send(void)
{
	static int counter;

	for (int i = 0; i < CONFIG_TEST_COUNTER_MULTIPLIER; i++) {
		(void)send_numeric_sample("COUNT", counter++);
	}
}

static void print_reset_reason(void)
{
	uint32_t reset_reason = nrfx_reset_reason_get();

	nrfx_reset_reason_clear(reset_reason);
	LOG_INF("Reset reason: 0x%x", reset_reason);
}

void main_application_thread_fn(void)
{
	struct dryspool_reading reading;
	int ret;

	print_reset_reason();

	ret = dryspool_sensors_init();
	if (ret) {
		LOG_ERR("DrySpool sensor initialization failed: %d", ret);
		return;
	}

	/* Confirm a new image only after the product sensor layer passes its
	 * startup check. If startup fails or crashes first, MCUboot can revert it.
	 */
#if defined(CONFIG_SAMPLE_MEMFAULT_FOTA)
	memfault_fota_support_init();
#endif

	(void)await_cloud_ready(K_FOREVER);

	LOG_INF("Waiting for valid network time");
	if (!await_date_time_known(K_SECONDS(CONFIG_DATE_TIME_ESTABLISHMENT_TIMEOUT_SECONDS))) {
		LOG_WRN("Valid date/time unavailable; continuing");
	}

	while (true) {
		k_timer_start(&sensor_sample_timer,
			      K_SECONDS(CONFIG_SENSOR_SAMPLE_INTERVAL_SECONDS), K_FOREVER);

		ret = dryspool_sensors_read(&reading);
		if (ret) {
			LOG_ERR("DrySpool sensor read failed: %d", ret);
		} else {
			send_dryspool_sample(&reading);
		}

		if (test_counter_enable_get()) {
			test_counter_send();
		}

		k_timer_status_sync(&sensor_sample_timer);

		if (!await_cloud_ready(K_NO_WAIT) && is_device_deleted()) {
			LOG_INF("Cloud not ready; pausing telemetry");
			(void)await_cloud_ready(K_FOREVER);
			LOG_INF("Cloud ready; resuming telemetry");
		}
	}
}

void test_counter_enable_set(const bool enable)
{
	if (!IS_ENABLED(CONFIG_TEST_COUNTER)) {
		test_counter_enabled = enable;
	}
}

bool test_counter_enable_get(void)
{
	return test_counter_enabled || IS_ENABLED(CONFIG_TEST_COUNTER);
}
