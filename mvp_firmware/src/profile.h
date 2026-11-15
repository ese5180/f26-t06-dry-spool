#pragma once

#include <stdint.h>

/* On-flash dryspool/v1 record. Preserve field order, widths and spool capacity. */
struct profile {
	int32_t zero, span, reference_g, empty_g, low_g, rh_off, rh_on, tared;
	char spool[24];
};

int profile_init(void);

/* Copies the entire profile. A zero revision means storage is not ready. */
uint32_t profile_get(struct profile *out);
/* Writes only if this revision is still active. Failed writes leave RAM unchanged. */
int profile_save(const struct profile *p, uint32_t expected_revision);
