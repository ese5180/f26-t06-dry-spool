#pragma once

#include <stdbool.h>
#include <stdint.h>

/* Humidity is in 0.001 % RH; thresholds are whole % RH. */
static inline bool fan_requested_on(bool previous, bool humidity_valid, int32_t humidity_mpct,
				    int32_t off_pct, int32_t on_pct)
{
	if (!humidity_valid || humidity_mpct <= off_pct * 1000) {
		return false;
	}
	return previous || humidity_mpct >= on_pct * 1000;
}

int fan_init(void);
int fan_apply(bool on);
