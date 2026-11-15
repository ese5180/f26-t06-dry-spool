#include <errno.h>
#include <zephyr/drivers/sensor.h>
#include "environment.h"

static const struct device *const bme = DEVICE_DT_GET(DT_NODELABEL(env));

int environment_read(int32_t *temperature_mc, int32_t *humidity_mpct)
{
	struct sensor_value temperature, humidity;

	if (!device_is_ready(bme)) {
		return -ENODEV;
	}

	int rc = sensor_sample_fetch(bme);
	if (rc == 0) {
		rc = sensor_channel_get(bme, SENSOR_CHAN_AMBIENT_TEMP, &temperature);
	}
	if (rc == 0) {
		rc = sensor_channel_get(bme, SENSOR_CHAN_HUMIDITY, &humidity);
	}
	if (rc == 0) {
		*temperature_mc = sensor_value_to_milli(&temperature);
		*humidity_mpct = sensor_value_to_milli(&humidity);
	}
	return rc;
}
