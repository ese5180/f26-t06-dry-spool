#pragma once

#include <stddef.h>
#include "readings.h"

enum { DRYSPOOL_CHANNEL_COUNT = 5 };

struct dryspool_channel {
	const char *app_id;
	double value;
};

/* The local cycle typically takes 2.5 s. Allow for a sensor timeout but never
 * send the last reading indefinitely if local sampling has stopped.
 */
static inline bool dryspool_sample_is_fresh(const struct dryspool_sample *s, int64_t now_ms)
{
	return s->uptime_ms >= 0 && now_ms >= s->uptime_ms && now_ms - s->uptime_ms <= 10000;
}

static inline size_t dryspool_telemetry_channels(const struct dryspool_sample *s, int64_t now_ms,
						struct dryspool_channel out[DRYSPOOL_CHANNEL_COUNT])
{
	if (!dryspool_sample_is_fresh(s, now_ms)) {
		return 0;
	}

	size_t n = 0;
	if (s->env_valid) {
		out[n++] = (struct dryspool_channel){"DRYSPOOL_TEMPERATURE_C", s->temperature_mc / 1000.0};
		out[n++] = (struct dryspool_channel){"DRYSPOOL_HUMIDITY_PCT", s->humidity_mpct / 1000.0};
	}
	if (s->raw_valid) {
		out[n++] = (struct dryspool_channel){"DRYSPOOL_LOAD_CELL_COUNTS", s->raw_counts};
	}
	if (s->grams_valid) {
		out[n++] = (struct dryspool_channel){"DRYSPOOL_FILAMENT_G", s->filament_g};
	}
	if (s->fan_valid) {
		out[n++] = (struct dryspool_channel){"DRYSPOOL_DEHUMIDIFIER_ON", s->fan_on};
	}
	return n;
}
