#include "spool/calibration.h"
#include "spool/profile.h"
#include <errno.h>
#include <string.h>

void profile_migrate_v1(const struct profile_v1 *old, struct profile *out)
{
	/* A changed mechanical arrangement invalidates even the old A tare. */
	*out = (struct profile){.empty_g = old->empty_g,
				.low_g = old->low_g,
				.rh_off = old->rh_off,
				.rh_on = old->rh_on};
	memcpy(out->spool, old->spool, sizeof(out->spool));
}

int calibration_tare(struct profile *p, unsigned int channel, int32_t raw)
{
	if (channel >= SCALE_CHANNELS) {
		return -EINVAL;
	}
	p->channel[channel] = (struct scale_calibration){.zero = raw, .tared = 1};
	return 0;
}

int calibration_set_reference(struct profile *p, unsigned int channel, int32_t raw,
			      int32_t reference_g)
{
	if (channel >= SCALE_CHANNELS || !p->channel[channel].tared || reference_g < 1 ||
	    reference_g > SCALE_CAPACITY_G) {
		return -EINVAL;
	}
	struct scale_calibration *c = &p->channel[channel];
	/* A reversed bridge has a negative span. */
	int64_t span = (int64_t)raw - c->zero;
	if (!span || span < INT32_MIN || span > INT32_MAX) {
		return -ERANGE;
	}
	c->span = (int32_t)span;
	c->reference_g = reference_g;
	return 0;
}

int profile_filament_g(const struct profile *p, const int32_t raw[SCALE_CHANNELS], int32_t *grams)
{
	if (p->empty_g < 0) {
		return -ENODATA;
	}
	int64_t total_mg = 0;
	for (unsigned int i = 0; i < SCALE_CHANNELS; ++i) {
		const struct scale_calibration *c = &p->channel[i];
		if (!c->tared || !c->span || c->reference_g <= 0 ||
		    c->reference_g > SCALE_CAPACITY_G) {
			return -ENODATA;
		}
		/* Preserve sub-gram contributions until after summation.
		 * int32 delta * 5000 g * 1000 fits in int64_t. */
		int64_t mg = ((int64_t)raw[i] - c->zero) * c->reference_g * 1000 / c->span;
		if (mg < -5000 || mg > (int64_t)SCALE_CAPACITY_G * 1000) {
			return -ERANGE;
		}
		total_mg += mg;
	}
	/* Keep the conservative 5 kg system limit, not 10 kg. */
	if (total_mg < -5000 || total_mg > (int64_t)SCALE_CAPACITY_G * 1000) {
		return -ERANGE;
	}
	int64_t filament_mg = total_mg - (int64_t)p->empty_g * 1000;
	*grams = filament_mg > 0 ? (int32_t)(filament_mg / 1000) : 0;
	return 0;
}

int calibration_zero(struct profile *p, const int32_t raw[SCALE_CHANNELS])
{
	for (unsigned int i = 0; i < SCALE_CHANNELS; ++i) {
		if (!p->channel[i].tared || !p->channel[i].span || p->channel[i].reference_g <= 0) {
			return -ENODATA;
		}
	}
	for (unsigned int i = 0; i < SCALE_CHANNELS; ++i) {
		p->channel[i].zero = raw[i];
	}
	return 0;
}
