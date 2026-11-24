#pragma once
#include "sensors/scale.h"
#include <stdint.h>

/* Retained for migration and rollback; never overwritten by dual firmware. */
struct profile_v1 {
	int32_t zero, span, reference_g, empty_g, low_g, rh_off, rh_on, tared;
	char spool[24];
};

struct scale_calibration {
	int32_t zero, span, reference_g, tared;
};

/* On-flash dryspool/v2 record. Preserve field order and widths. */
struct profile {
	struct scale_calibration channel[SCALE_CHANNELS];
	int32_t empty_g, low_g, rh_off, rh_on;
	char spool[24];
};

void profile_migrate_v1(const struct profile_v1 *old, struct profile *out);
int profile_init(void);
/* A zero revision means storage is not ready. */
uint32_t profile_get(struct profile *out);
/* Failed/stale writes leave RAM unchanged. */
int profile_save(const struct profile *p, uint32_t expected_revision);
