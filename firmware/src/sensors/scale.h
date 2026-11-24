#pragma once
#include <stdint.h>

enum {
	SCALE_A,
	SCALE_B,
	SCALE_CHANNELS
};

/* Serialize channel selection, settling and averaging with shell requests.
 * Output is unchanged on failure. failed_channel is A/B, or -1 for startup.
 */
int scale_sample(int32_t raw[SCALE_CHANNELS], int *failed_channel);
int scale_sample_channel(unsigned int channel, int32_t *raw);
