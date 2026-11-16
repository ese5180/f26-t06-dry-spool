/* SPDX-License-Identifier: LicenseRef-Nordic-5-Clause */

#include <errno.h>
#include <zephyr/drivers/i2c.h>
#include <zephyr/drivers/sensor.h>
#include <zephyr/logging/log.h>
#include <zephyr/shell/shell.h>

#include "dryspool_sensors.h"

LOG_MODULE_REGISTER(dryspool_sensors, LOG_LEVEL_INF);

#define BME_NODE DT_NODELABEL(dryspool_bme280)
static const struct device *const bme = DEVICE_DT_GET(BME_NODE);
static const struct device *const bus = DEVICE_DT_GET(DT_BUS(BME_NODE));

int dryspool_sensors_init(void)
{
	bool found = false;

	if (!device_is_ready(bus)) {
		return -ENODEV;
	}
	/* Probe only the Bosch addresses; reject BMP280 (no humidity). */
	for (uint16_t addr = 0x76; addr <= 0x77; addr++) {
		uint8_t id;
		int ret = i2c_reg_read_byte(bus, addr, 0xd0, &id);

		if (ret == 0) {
			LOG_INF("BME probe: address 0x%02x, chip ID 0x%02x", addr, id);
			if (addr != DT_REG_ADDR(BME_NODE) || id != 0x60) {
				LOG_ERR("Unexpected sensor identity/address; expected BME280 at 0x%02x",
					(unsigned int)DT_REG_ADDR(BME_NODE));
				return -ENODEV;
			}
			found = true;
		}
	}
	if (!found || !device_is_ready(bme)) {
		return -ENODEV;
	}
	/* Verify one real sample before image confirmation or network waits. */
	struct dryspool_reading reading;
	int ret = dryspool_sensors_read(&reading);

	if (ret) {
		return ret;
	}
	LOG_INF("BME280 startup: %.2f C, %.2f %%RH", reading.temperature_c,
		reading.humidity_pct);
	return 0;
}

int dryspool_sensors_read(struct dryspool_reading *reading)
{
	static unsigned int sample_number;
	struct sensor_value temperature, humidity;
	int ret;

	if (reading == NULL) {
		return -EINVAL;
	}
	ret = sensor_sample_fetch(bme);
	if (ret) {
		return ret;
	}
	ret = sensor_channel_get(bme, SENSOR_CHAN_AMBIENT_TEMP, &temperature);
	if (ret) {
		return ret;
	}
	ret = sensor_channel_get(bme, SENSOR_CHAN_HUMIDITY, &humidity);
	if (ret) {
		return ret;
	}
	reading->temperature_c = sensor_value_to_double(&temperature);
	reading->humidity_pct = sensor_value_to_double(&humidity);
	/* Filament and actuator state remain prototype simulations. */
	reading->filament_remaining_g = 750.0 - (sample_number++ % 100) * 0.5;
	reading->dehumidifier_on = reading->humidity_pct > 43.0;
	return 0;
}

static int cmd_bme_read(const struct shell *shell, size_t argc, char **argv)
{
	struct dryspool_reading reading;
	int ret;

	(void)shell;
	(void)argc;
	(void)argv;
	ret = dryspool_sensors_read(&reading);
	if (ret) {
		LOG_ERR("BME280 sample failed: %d", ret);
		return ret;
	}
	LOG_INF("BME280 sample: %.2f C, %.2f %%RH", reading.temperature_c,
		reading.humidity_pct);
	return 0;
}

SHELL_CMD_REGISTER(bme_read, NULL, "Read BME280 temperature and humidity", cmd_bme_read);
