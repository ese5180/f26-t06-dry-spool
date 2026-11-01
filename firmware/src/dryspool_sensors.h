/* SPDX-License-Identifier: LicenseRef-Nordic-5-Clause */

#ifndef DRYSPOOL_SENSORS_H_
#define DRYSPOOL_SENSORS_H_

#include <stdbool.h>

struct dryspool_reading {
	double temperature_c;
	double humidity_pct;
	double filament_remaining_g;
	bool dehumidifier_on;
};

int dryspool_sensors_init(void);
int dryspool_sensors_read(struct dryspool_reading *reading);

#endif /* DRYSPOOL_SENSORS_H_ */
