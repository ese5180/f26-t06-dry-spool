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

static struct fan_request requested; /* Starts in automatic mode. */

static struct fan_request queued;
static int64_t deadline;

void dryspool_queue_fan_request(struct fan_request request, int64_t deadline_ms)
{
	k_spinlock_key_t key = k_spin_lock(&sample_lock);
	queued = request;
	deadline = deadline_ms;
	k_spin_unlock(&sample_lock, key);
}

struct fan_request dryspool_get_fan_request(void)
{
	k_spinlock_key_t key = k_spin_lock(&sample_lock);
	if (deadline && k_uptime_get() < deadline) {
		requested = queued;
	}
	deadline = 0;
	struct fan_request request = requested;
	k_spin_unlock(&sample_lock, key);
	return request;
}
