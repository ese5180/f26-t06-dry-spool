#include <errno.h>

#include "calibration.h"
#include "profile.h"

void calibration_tare(struct profile *p, int32_t raw)
{
	p->zero = raw;
	p->tared = 1;
	p->span = 0;
	p->reference_g = 0;
}

int calibration_set_reference(struct profile *p, int32_t raw, int32_t reference_g)
{
	if (!p->tared || reference_g < 1 || reference_g > SCALE_CAPACITY_G) {
		return -EINVAL;
	}
	/* A reversed bridge has a negative span. Zero span cannot establish a gain. */
	int64_t span = (int64_t)raw - p->zero;
	if (!span || span < INT32_MIN || span > INT32_MAX) {
		return -ERANGE;
	}
	p->span = (int32_t)span;
	p->reference_g = reference_g;
	return 0;
}

int profile_filament_g(const struct profile *p, int32_t raw, int32_t *grams)
{
	if (!p->span || p->empty_g < 0) {
		return -ENODATA;
	}
	int64_t gross = ((int64_t)raw - p->zero) * p->reference_g / p->span;
	/* The local scale allows a 5 g negative zero drift. */
	if (gross > SCALE_CAPACITY_G || gross < -5) {
		return -ERANGE;
	}
	*grams = gross > p->empty_g ? (int32_t)gross - p->empty_g : 0;
	return 0;
}
