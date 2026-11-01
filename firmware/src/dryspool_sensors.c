/* SPDX-License-Identifier: LicenseRef-Nordic-5-Clause */

#include <errno.h>
#include <stddef.h>
#include <zephyr/sys/util.h>

#include "dryspool_sensors.h"

int dryspool_sensors_init(void)
{
	/* Replace this with device_is_ready() checks when the sensor and load-cell
	 * choices are finalized. Keeping this boundary stable lets those drivers be
	 * developed and tested without changing the cloud or FOTA layers.
	 */
	return 0;
}

int dryspool_sensors_read(struct dryspool_reading *reading)
{
#if defined(CONFIG_DRYSPOOL_SIMULATED_SENSORS)
	static unsigned int sample_number;

	if (reading == NULL) {
		return -EINVAL;
	}

	/* Deterministic prototype data makes the wireless demo observable before
	 * the final sensors are selected. It is not presented as real measurement.
	 */
	reading->temperature_c = 23.0 + (sample_number % 5) * 0.1;
	reading->humidity_pct = 42.0 + (sample_number % 7) * 0.2;
	reading->filament_remaining_g = 750.0 - (sample_number % 100) * 0.5;
	reading->dehumidifier_on = reading->humidity_pct > 43.0;
	sample_number++;
	return 0;
#else
	ARG_UNUSED(reading);
	return -ENOTSUP;
#endif
}
