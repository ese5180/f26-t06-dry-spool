#pragma once

#include <stdint.h>

/* Both the control loop and shell can request an averaged raw reading. */
int scale_sample(int32_t *raw);
