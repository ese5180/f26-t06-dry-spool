#include "spool/calibration.h"
#include "spool/profile.h"
#include <assert.h>
#include <errno.h>
#include <stdio.h>
#include <string.h>

int main(void)
{
	struct profile p = {.empty_g = -1};
	int32_t grams = -1, raw[2] = {4000, 22000};
	assert(calibration_set_reference(&p, SCALE_A, 1000, 100) == -EINVAL);
	assert(calibration_tare(&p, SCALE_A, 12000) == 0);
	assert(calibration_set_reference(&p, SCALE_A, 7000, 500) == 0);
	assert(profile_filament_g(&p, raw, &grams) == -ENODATA);
	p.empty_g = 210;
	assert(profile_filament_g(&p, raw, &grams) == -ENODATA); /* B missing */
	assert(calibration_tare(&p, SCALE_B, 2000) == 0);
	assert(calibration_set_reference(&p, SCALE_B, 12000, 500) == 0);
	/* Opposite polarities and different gains: 800 + 1000 - 210. */
	assert(profile_filament_g(&p, raw, &grams) == 0 && grams == 1590);
	/* Move the same total weight between supports. */
	raw[0] = -6000;
	raw[1] = 2000;
	assert(profile_filament_g(&p, raw, &grams) == 0 && grams == 1590);
	raw[0] = 12000;
	raw[1] = 38000;
	assert(profile_filament_g(&p, raw, &grams) == 0 && grams == 1590);
	int32_t holder[2] = {10000, 6000};
	assert(calibration_zero(&p, holder) == 0);
	assert(p.channel[0].span == -5000 && p.channel[1].span == 10000);
	assert(profile_filament_g(&p, holder, &grams) == 0 && grams == 0);
	int32_t original_zero[2] = {12000, 2000};
	assert(calibration_zero(&p, original_zero) == 0);
	struct profile before = p;
	assert(calibration_set_reference(&p, SCALE_A, 7000, 0) == -EINVAL);
	assert(calibration_set_reference(&p, SCALE_A, 7000, 5001) == -EINVAL);
	assert(calibration_set_reference(&p, SCALE_A, 12000, 200) == -ERANGE);
	assert(calibration_tare(&p, 2, 0) == -EINVAL);
	assert(calibration_set_reference(&p, 2, 0, 100) == -EINVAL);
	assert(memcmp(&p, &before, sizeof(p)) == 0);
	/* Retaring A invalidates only A; never output a partial total. */
	calibration_tare(&p, SCALE_A, 0);
	assert(p.channel[SCALE_A].span == 0 && p.channel[SCALE_A].reference_g == 0);
	assert(memcmp(&p.channel[SCALE_B], &before.channel[SCALE_B], sizeof(p.channel[0])) == 0);
	grams = 123;
	assert(profile_filament_g(&p, raw, &grams) == -ENODATA && grams == 123);
	struct profile uncalibrated = p;
	assert(calibration_zero(&p, raw) == -ENODATA);
	assert(memcmp(&p, &uncalibrated, sizeof(p)) == 0);
	calibration_tare(&p, SCALE_B, 0);
	calibration_set_reference(&p, SCALE_A, 10000, 5000);
	calibration_set_reference(&p, SCALE_B, 10000, 5000);
	raw[0] = 5000;
	raw[1] = 5000;
	assert(profile_filament_g(&p, raw, &grams) == 0 && grams == 4790);
	raw[1] = 5001;
	assert(profile_filament_g(&p, raw, &grams) == -ERANGE); /* sum exceeds 5 kg */
	raw[0] = -10;
	raw[1] = 0;
	assert(profile_filament_g(&p, raw, &grams) == 0 && grams == 0);
	raw[0] = -11;
	assert(profile_filament_g(&p, raw, &grams) == -ERANGE);
	raw[0] = -6;
	raw[1] = -6;
	assert(profile_filament_g(&p, raw, &grams) == -ERANGE); /* combined zero drift */
	p.empty_g = 0;
	raw[0] = 1;
	raw[1] = 1;
	assert(profile_filament_g(&p, raw, &grams) == 0 && grams == 1); /* add before rounding */
	raw[0] = INT32_MAX;
	raw[1] = INT32_MIN;
	assert(profile_filament_g(&p, raw, &grams) == -ERANGE);
	struct profile_v1 old = {.zero = 120,
				 .span = 500,
				 .reference_g = 100,
				 .tared = 1,
				 .empty_g = 210,
				 .low_g = 100,
				 .rh_off = 30,
				 .rh_on = 40,
				 .spool = "PLA01"};
	profile_migrate_v1(&old, &p);
	assert(p.empty_g == 210 && p.low_g == 100 && p.rh_off == 30 && p.rh_on == 40);
	assert(strcmp(p.spool, "PLA01") == 0);
	assert(!p.channel[0].tared && !p.channel[1].tared);
	assert(profile_filament_g(&p, raw, &grams) == -ENODATA);
	puts("dual calibration and migration tests passed");
}
