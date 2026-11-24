#include <errno.h>
#include <zephyr/kernel.h>
#include <zephyr/logging/log.h>
#include <zephyr/sys/printk.h>

#include "spool/calibration.h"
#include "sensors/environment.h"
#include "control/fan.h"
#include "spool/profile.h"
#include "readings.h"
#include "sensors/scale.h"
#ifdef CONFIG_SAMPLE_MEMFAULT_FOTA
#include "ota/trial_image.h"
#endif

LOG_MODULE_REGISTER(dryspool, LOG_LEVEL_INF);

/* Format signed thousandths to two decimal places without floating-point logging. */
static void format_reading(char *out, size_t size, int32_t milli)
{
	uint32_t magnitude = milli < 0 ? 0U - (uint32_t)milli : (uint32_t)milli;
	uint32_t hundredths = (magnitude + 5U) / 10U;
	snprintk(out, size, "%s%u.%02u", milli < 0 && hundredths ? "-" : "",
		 hundredths / 100U, hundredths % 100U);
}

static void update_environment(struct dryspool_sample *sample, const struct profile *profile,
			       bool *fan_on)
{
	int rc = environment_read(&sample->temperature_mc, &sample->humidity_mpct);
	sample->env_valid = (rc == 0);
	if (sample->env_valid) {
		char temperature[16], humidity[16];
		format_reading(temperature, sizeof(temperature), sample->temperature_mc);
		format_reading(humidity, sizeof(humidity), sample->humidity_mpct);
		LOG_INF("Temperature: %s °C | Humidity: %s%% RH%s", temperature, humidity,
			sample->humidity_mpct >= profile->rh_on * 1000 ? " (high)" : "");
	} else {
		LOG_WRN("Temperature and humidity unavailable (sensor error %d)", rc);
	}

	sample->fan_request = dryspool_get_fan_request();
	bool target = fan_mode_output(sample->fan_request.mode, *fan_on, sample->env_valid,
				      sample->humidity_mpct, profile->rh_off, profile->rh_on);
	sample->fan_valid = (fan_apply(target) == 0);
	if (sample->fan_valid) {
		*fan_on = target;
		sample->fan_on = target;
		LOG_INF("Fan command: %s (%s)", target ? "On" : "Off",
			sample->fan_request.mode == FAN_AUTO ? "Auto" : "Manual");
	} else {
		LOG_ERR("Fan output unavailable: GPIO command failed");
	}
}

static void update_weight(struct dryspool_sample *sample, struct profile *profile,
			  uint32_t starting_revision)
{
	int failed_channel;
	int rc = scale_sample(sample->raw_counts, &failed_channel);
	if (rc != 0) {
		LOG_WRN("Scale read failed: %s", failed_channel < 0 ? "ADC initialization" :
			(failed_channel == SCALE_A ? "channel A" : "channel B"));
		if (rc == -EIO) {
			LOG_WRN("Scale unavailable: I/O error (%d). Check NAU7802 power and wiring.", rc);
		} else {
			LOG_WRN("Scale unavailable (sensor error %d)", rc);
		}
		return;
	}

	sample->raw_valid = true;
	/* A shell command can change the active spool or calibration while
	 * the ADC samples both channels. Apply the new settings next cycle.
	 */
	if (profile_get(profile) != starting_revision) {
		LOG_INF("Scale A: %d counts | B: %d counts | Filament unavailable: settings changed", sample->raw_counts[SCALE_A], sample->raw_counts[SCALE_B]);
		return;
	}
	rc = profile_filament_g(profile, sample->raw_counts, &sample->filament_g);
	if (rc == -ENODATA) {
		LOG_INF("Scale A: %d counts | B: %d counts | Filament unavailable: calibrate both A and B and set empty spool mass", sample->raw_counts[SCALE_A], sample->raw_counts[SCALE_B]);
	} else if (rc != 0) {
		LOG_WRN("Scale A: %d counts | B: %d counts | Filament unavailable: weight outside scale range", sample->raw_counts[SCALE_A], sample->raw_counts[SCALE_B]);
	} else {
		sample->grams_valid = true;
		LOG_INF("Spool: %s | Filament remaining: %d g%s | Scale A: %d counts | B: %d counts", profile->spool,
			sample->filament_g, sample->filament_g <= profile->low_g ? " (low)" : "",
			sample->raw_counts[SCALE_A], sample->raw_counts[SCALE_B]);
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
