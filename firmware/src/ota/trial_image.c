#include <zephyr/dfu/mcuboot.h>
#include <zephyr/logging/log.h>
#include "ota/memfault_update.h"
#include "ota/trial_image.h"

LOG_MODULE_REGISTER(dryspool_trial, LOG_LEVEL_INF);
static bool trial;

void trial_image_init(void)
{
	trial = !boot_is_img_confirmed();
	if (trial) {
		LOG_INF("Trial image: waiting for local sensors, settings and fan GPIO");
	}
}

void trial_image_check(bool local_health_ok)
{
	if (trial && local_health_ok) {
		memfault_confirm_running_image();
		trial = !boot_is_img_confirmed();
	}
}
