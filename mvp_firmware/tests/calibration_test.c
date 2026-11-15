#include <assert.h>
#include <errno.h>
#include <stdio.h>

#include "calibration.h"
#include "profile.h"

int main(void)
{
	struct profile p = {.empty_g = -1};
	int32_t grams = -1;

	assert(calibration_set_reference(&p, 1000, 100) == -EINVAL);
	calibration_tare(&p, 12000);
	assert(calibration_set_reference(&p, 7000, 500) == 0); /* reversed bridge */
	assert(profile_filament_g(&p, 4000, &grams) == -ENODATA); /* no empty spool selected */
	p.empty_g = 210;
	assert(profile_filament_g(&p, 4000, &grams) == 0 && grams == 590);
	assert(profile_filament_g(&p, 9900, &grams) == 0 && grams == 0);
	assert(profile_filament_g(&p, 10000, &grams) == 0 && grams == 0);

	/* Reject a bad reference without damaging an existing calibration. */
	assert(calibration_set_reference(&p, 7000, 0) == -EINVAL);
	assert(calibration_set_reference(&p, 7000, 5001) == -EINVAL);
	assert(calibration_set_reference(&p, 12000, 200) == -ERANGE);
	assert(p.span == -5000 && p.reference_g == 500);

	calibration_tare(&p, 0);
	assert(p.empty_g == 210 && p.span == 0 && p.reference_g == 0);
	assert(profile_filament_g(&p, 10, &grams) == -ENODATA);
	assert(calibration_set_reference(&p, 10000, 5000) == 0);
	assert(profile_filament_g(&p, 10000, &grams) == 0 && grams == 4790);
	assert(profile_filament_g(&p, 10002, &grams) == -ERANGE);
	assert(profile_filament_g(&p, -10, &grams) == 0 && grams == 0);
	assert(profile_filament_g(&p, -12, &grams) == -ERANGE);
	puts("calibration tests passed");
}
