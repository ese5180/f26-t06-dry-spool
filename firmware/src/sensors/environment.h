#pragma once

#include <stdint.h>

/* Temperature in millidegrees Celsius, relative humidity in 0.001 % RH. */
int environment_read(int32_t *temperature_mc, int32_t *humidity_mpct);
