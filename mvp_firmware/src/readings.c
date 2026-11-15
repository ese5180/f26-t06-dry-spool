#include <zephyr/kernel.h>

#include "readings.h"

/* Only copy data under this lock. No I2C, flash, logging or network I/O. */
static struct k_spinlock sample_lock;
static struct dryspool_sample latest;
static bool have_sample;

bool dryspool_read_latest(struct dryspool_sample *out)
{
	k_spinlock_key_t key = k_spin_lock(&sample_lock);
	bool valid = have_sample;

	*out = latest;
	k_spin_unlock(&sample_lock, key);
	return valid;
}

void dryspool_publish_sample(struct dryspool_sample *sample)
{
	sample->uptime_ms = k_uptime_get();
	k_spinlock_key_t key = k_spin_lock(&sample_lock);

	latest = *sample;
	have_sample = true;
	k_spin_unlock(&sample_lock, key);
}
