#pragma once

#include "sensors/scale.h"
#include <stdint.h>

struct profile;
enum {
	SCALE_CAPACITY_G = 5000
};

/* These operations edit a candidate profile. The caller decides when to save
 * it. */
int calibration_tare(struct profile *p, unsigned int channel, int32_t raw);
int calibration_set_reference(struct profile *p, unsigned int channel, int32_t raw,
			      int32_t reference_g);

/* Returns -ENODATA before calibration/spool selection and -ERANGE outside the
 * scale range. */
int profile_filament_g(const struct profile *p, const int32_t raw[SCALE_CHANNELS], int32_t *grams);

/* Update installed-holder zeros without changing either calibrated gain. */
int calibration_zero(struct profile *p, const int32_t raw[SCALE_CHANNELS]);
