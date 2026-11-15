#include <errno.h>
#include <zephyr/kernel.h>
#include <zephyr/logging/log.h>

#include "calibration.h"
#include "environment.h"
#include "fan.h"
#include "profile.h"
#include "readings.h"
#include "scale.h"
#ifdef CONFIG_SAMPLE_MEMFAULT_FOTA
#include "trial_image.h"
#endif

LOG_MODULE_REGISTER(dryspool, LOG_LEVEL_INF);

static void update_environment(struct dryspool_sample *sample, const struct profile *profile,
			       bool *fan_on)
{
	int rc = environment_read(&sample->temperature_mc, &sample->humidity_mpct);
	sample->env_valid = (rc == 0);
	if (sample->env_valid) {
		LOG_INF("temp_mC=%d rh_mPct=%d high_rh=%d", sample->temperature_mc,
			sample->humidity_mpct, sample->humidity_mpct >= profile->rh_on * 1000);
	} else {
		LOG_WRN("environment=unavailable err=%d", rc);
	}

	*fan_on = fan_requested_on(*fan_on, sample->env_valid, sample->humidity_mpct,
				   profile->rh_off, profile->rh_on);
	sample->fan_valid = (fan_apply(*fan_on) == 0);
	if (sample->fan_valid) {
		sample->fan_on = *fan_on;
		LOG_INF("fan_command=%s", *fan_on ? "on" : "off");
	} else {
		LOG_ERR("fan_output=unavailable");
	}
}

static void update_weight(struct dryspool_sample *sample, struct profile *profile,
			  uint32_t starting_revision)
{
	int rc = scale_sample(&sample->raw_counts);
	if (rc != 0) {
		LOG_WRN("scale=unavailable err=%d", rc);
		return;
	}

	sample->raw_valid = true;
	/* A shell command can change the active spool or calibration while
	 * the ADC takes its five readings. Apply the new settings next cycle.
	 */
	if (profile_get(profile) != starting_revision) {
		LOG_INF("raw=%d remaining=unavailable (settings changed)", sample->raw_counts);
		return;
	}
	rc = profile_filament_g(profile, sample->raw_counts, &sample->filament_g);
	if (rc == -ENODATA) {
		LOG_INF("raw=%d remaining=unavailable (cal/spool needed)", sample->raw_counts);
	} else if (rc != 0) {
		LOG_WRN("raw=%d remaining=unavailable (outside scale range)", sample->raw_counts);
	} else {
		sample->grams_valid = true;
		LOG_INF("spool=%s raw=%d remaining_g=%d low=%d", profile->spool, sample->raw_counts,
			sample->filament_g, sample->filament_g <= profile->low_g);
	}
}

int main(void)
{
	bool storage_ready = (profile_init() == 0);
	bool fan_on = false;

	if (!storage_ready) {
		LOG_ERR("Settings unavailable; check flash storage");
	}
	if (fan_init() != 0) {
		LOG_ERR("Fan GPIO initialization failed");
	}
#ifdef CONFIG_SAMPLE_MEMFAULT_FOTA
	trial_image_init();
#endif
	for (;;) {
		struct dryspool_sample sample = {0};
		struct profile profile;
		uint32_t revision = profile_get(&profile);

		update_environment(&sample, &profile, &fan_on);
		update_weight(&sample, &profile, revision);
		dryspool_publish_sample(&sample);
#ifdef CONFIG_SAMPLE_MEMFAULT_FOTA
		trial_image_check(storage_ready && sample.env_valid && sample.raw_valid && sample.fan_valid);
#endif
		k_sleep(K_SECONDS(2));
	}
}
