#include <errno.h>
#include <stdlib.h>
#include <string.h>
#include <zephyr/drivers/gpio.h>
#include <zephyr/drivers/sensor.h>
#include <zephyr/kernel.h>
#include <zephyr/logging/log.h>
#include <zephyr/settings/settings.h>
#include <zephyr/shell/shell.h>
#include "nau7802.h"
#include "readings.h"
#ifdef CONFIG_SAMPLE_MEMFAULT_FOTA
#include <zephyr/dfu/mcuboot.h>
#include "memfault_fota_support.h"
#endif

LOG_MODULE_REGISTER(dryspool, LOG_LEVEL_INF);
static const struct device *const bme = DEVICE_DT_GET(DT_NODELABEL(env));
static const struct gpio_dt_spec fan = GPIO_DT_SPEC_GET(DT_PATH(zephyr_user), fan_gpios);
static K_MUTEX_DEFINE(lock);

/* Only copy data under this lock. No I2C, flash, logging or network I/O. */
static struct k_spinlock sample_lock;
static struct dryspool_sample latest;
static bool have_sample;

bool dryspool_read_latest(struct dryspool_sample *out)
{
	k_spinlock_key_t key = k_spin_lock(&sample_lock);
	bool valid = have_sample;

	*out = latest;
	k_spin_unlock(&sample_lock, key);
	return valid;
}

static void publish_local_sample(struct dryspool_sample *sample)
{
	sample->uptime_ms = k_uptime_get();
	k_spinlock_key_t key = k_spin_lock(&sample_lock);

	latest = *sample;
	have_sample = true;
	k_spin_unlock(&sample_lock, key);
}

/* Versioned single record; negative span is valid for a reversed bridge. */
struct profile {
	int32_t zero, span, reference_g, empty_g, low_g, rh_off, rh_on, tared;
	char spool[24];
};
static struct profile cfg = {.empty_g = -1, .low_g = 100, .rh_off = 30, .rh_on = 40};
static bool adc_ready, storage_ready;

static int restore(const char *key, size_t len, settings_read_cb read, void *arg)
{
	struct profile p;
	if (strcmp(key, "v1")) return -ENOENT;
	if (len != sizeof(p) || read(arg, &p, sizeof(p)) != sizeof(p)) return -EINVAL;
	if (p.rh_off < 0 || p.rh_on > 100 || p.rh_off >= p.rh_on ||
	    p.empty_g < -1 || p.empty_g > 5000 || p.low_g < 0 || p.low_g > 5000 ||
	    p.reference_g < 0 || p.reference_g > 5000 ||
	    !memchr(p.spool, 0, sizeof(p.spool))) return -EINVAL;
	cfg = p;
	return 0;
}
SETTINGS_STATIC_HANDLER_DEFINE(profile, "dryspool", NULL, restore, NULL, NULL);

static bool grams_or_percent(const char *s, long max, int32_t *v)
{
	char *end;
	long n = strtol(s, &end, 10);
	if (!*s || *end || n < 0 || n > max) return false;
	*v = n;
	return true;
}

/* Caller owns lock, including for shell calibration reads. */
static int sample_scale(int32_t *raw)
{
	int rc = adc_ready ? 0 : nau_start();
	if (!rc) rc = nau_average(raw);
	adc_ready = !rc;
	return rc;
}

static int configure(const struct shell *sh, size_t argc, char **argv)
{
	k_mutex_lock(&lock, K_FOREVER);
	struct profile p = cfg;
	int32_t raw;
	int rc = -EINVAL;
	if (!storage_ready) {
		rc = -EAGAIN;
	} else if (argc == 2 && !strcmp(argv[1], "tare")) {
		rc = sample_scale(&raw);
		if (!rc) {
			p.zero = raw;
			p.tared = 1;
			p.span = p.reference_g = 0;
		}
	} else if (argc == 3 && !strcmp(argv[1], "cal") && p.tared &&
		   grams_or_percent(argv[2], 5000, &p.reference_g) && p.reference_g) {
		rc = sample_scale(&raw);
		if (!rc) {
			p.span = raw - p.zero;
			if (!p.span) rc = -ERANGE;
		}
	} else if (argc == 4 && !strcmp(argv[1], "spool") &&
		   strlen(argv[2]) < sizeof(p.spool) && *argv[2] &&
		   grams_or_percent(argv[3], 5000, &p.empty_g)) {
		strcpy(p.spool, argv[2]);
		rc = 0;
	} else if (argc == 5 && !strcmp(argv[1], "limits") &&
		   grams_or_percent(argv[2], 100, &p.rh_off) &&
		   grams_or_percent(argv[3], 100, &p.rh_on) && p.rh_off < p.rh_on &&
		   grams_or_percent(argv[4], 5000, &p.low_g)) {
		rc = 0;
	}
	if (!rc) rc = settings_save_one("dryspool/v1", &p, sizeof(p));
	if (!rc) cfg = p;
	k_mutex_unlock(&lock);
	if (rc) shell_error(sh, "Configuration unchanged (error %d). See dryspool help.", rc);
	else shell_print(sh, "Saved.");
	return rc;
}
SHELL_CMD_ARG_REGISTER(dryspool, NULL,
	"tare | cal <known_g> | spool <id> <empty_g> | limits <off_RH> <on_RH> <low_g>",
	configure, 2, 3);

int main(void)
{
	k_mutex_lock(&lock, K_FOREVER);
	storage_ready = settings_subsys_init() == 0 && settings_load_subtree("dryspool") == 0;
	k_mutex_unlock(&lock);
	if (!storage_ready) LOG_ERR("Settings unavailable; check flash storage");
	bool fan_ready = gpio_is_ready_dt(&fan) && gpio_pin_configure_dt(&fan, GPIO_OUTPUT_INACTIVE) == 0;
	bool on = false;
#ifdef CONFIG_SAMPLE_MEMFAULT_FOTA
	bool trial = !boot_is_img_confirmed();
	if (trial) LOG_INF("Trial image: waiting for local sensors, settings and fan GPIO");
#endif
	while (1) {
		struct dryspool_sample sample = {0};
		struct sensor_value t, rh;
		int rc = device_is_ready(bme) ? sensor_sample_fetch(bme) : -ENODEV;
		if (!rc) rc = sensor_channel_get(bme, SENSOR_CHAN_AMBIENT_TEMP, &t);
		if (!rc) rc = sensor_channel_get(bme, SENSOR_CHAN_HUMIDITY, &rh);
		k_mutex_lock(&lock, K_FOREVER);
		struct profile p = cfg;
		k_mutex_unlock(&lock);
		if (!rc) {
			int32_t milli = sensor_value_to_milli(&rh);
			sample.humidity_mpct = milli;
			sample.temperature_mc = sensor_value_to_milli(&t);
			sample.env_valid = true;
			if (milli >= p.rh_on * 1000) on = true;
			if (milli <= p.rh_off * 1000) on = false;
			LOG_INF("temp_mC=%d rh_mPct=%d high_rh=%d", (int)sensor_value_to_milli(&t),
				milli, milli >= p.rh_on * 1000);
		} else {
			on = false;
			LOG_WRN("environment=unavailable err=%d", rc);
		}
		if (!fan_ready || gpio_pin_set_dt(&fan, on)) LOG_ERR("fan_output=unavailable");
		else {
			sample.fan_on = on;
			sample.fan_valid = true;
			LOG_INF("fan_command=%s", on ? "on" : "off");
		}

		int32_t raw;
		k_mutex_lock(&lock, K_FOREVER);
		rc = sample_scale(&raw);
		p = cfg;
		k_mutex_unlock(&lock);
		if (!rc) {
			sample.raw_counts = raw;
			sample.raw_valid = true;
		}
		if (rc) LOG_WRN("scale=unavailable err=%d", rc);
		else if (!p.span || p.empty_g < 0) LOG_INF("raw=%d remaining=unavailable (cal/spool needed)", raw);
		else {
			int64_t gross = ((int64_t)raw - p.zero) * p.reference_g / p.span;
			if (gross > 5000 || gross < -5)
				LOG_WRN("raw=%d remaining=unavailable (outside scale range)", raw);
			else {
				int g = MAX(0, (int)gross - p.empty_g);
				sample.filament_g = g;
				sample.grams_valid = true;
				LOG_INF("spool=%s raw=%d remaining_g=%d low=%d", p.spool, raw, g, g <= p.low_g);
			}
		}
		publish_local_sample(&sample);
#ifdef CONFIG_SAMPLE_MEMFAULT_FOTA
		/* Trial success means local operation works. Wi-Fi, cloud credentials
		 * and a user's scale calibration are not prerequisites for confirmation.
		 */
		if (trial && storage_ready && sample.env_valid && sample.raw_valid && sample.fan_valid) {
			memfault_fota_support_init();
			trial = !boot_is_img_confirmed();
		}
#endif
		k_sleep(K_SECONDS(2));
	}
}
