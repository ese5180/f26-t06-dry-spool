#pragma once

#include <stdint.h>

struct profile;
enum { SCALE_CAPACITY_G = 5000 };

/* These operations edit a candidate profile. The caller decides when to save it. */
void calibration_tare(struct profile *p, int32_t raw);
int calibration_set_reference(struct profile *p, int32_t raw, int32_t reference_g);

/* Returns -ENODATA before calibration/spool selection and -ERANGE outside the scale range. */
int profile_filament_g(const struct profile *p, int32_t raw, int32_t *grams);
