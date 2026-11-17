#include <errno.h>
#include <zephyr/drivers/gpio.h>
#include "fan.h"

static const struct gpio_dt_spec fan = GPIO_DT_SPEC_GET(DT_PATH(zephyr_user), fan_gpios);
static bool initialized;

int fan_init(void)
{
	int rc = gpio_is_ready_dt(&fan) ? gpio_pin_configure_dt(&fan, GPIO_OUTPUT_INACTIVE)
					: -ENODEV;

	initialized = (rc == 0);
	return rc;
}

int fan_apply(bool on)
{
	return initialized ? gpio_pin_set_dt(&fan, on) : -ENODEV;
}
