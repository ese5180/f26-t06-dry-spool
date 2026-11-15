#pragma once

#include <stdbool.h>
#include <stdint.h>

/* One completed pass of the local control loop. Missing data is explicitly
 * marked, so losing one sensor doesn't invalidate the other sensor's data.
 */
struct dryspool_sample {
	int64_t uptime_ms;
	int32_t temperature_mc;
	int32_t humidity_mpct;
	int32_t raw_counts;
	int32_t filament_g;
	bool env_valid;
	bool raw_valid;
	bool grams_valid;
	bool fan_valid;
	bool fan_on; /* GPIO command, not a tachometer reading */
};

/* Stamps the completed cycle with uptime and publishes it for other threads. */
void dryspool_publish_sample(struct dryspool_sample *sample);

/* Copies a consistent snapshot. False before the first pass completes. */
bool dryspool_read_latest(struct dryspool_sample *out);
