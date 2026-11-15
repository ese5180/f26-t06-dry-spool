#include <errno.h>
#include <string.h>
#include <zephyr/kernel.h>
#include <zephyr/logging/log.h>
#include <zephyr/settings/settings.h>

#include "profile.h"

LOG_MODULE_REGISTER(dryspool_profile, LOG_LEVEL_INF);

#define PROFILE_KEY "dryspool/v1"
BUILD_ASSERT(sizeof(struct profile) == 56, "dryspool/v1 record format changed");

static struct profile active = {.empty_g = -1, .low_g = 100, .rh_off = 30, .rh_on = 40};
static uint32_t revision;
static struct k_spinlock state_lock;
static K_MUTEX_DEFINE(writer_lock);

static bool valid(const struct profile *p)
{
	return p->rh_off >= 0 && p->rh_on <= 100 && p->rh_off < p->rh_on &&
	       p->empty_g >= -1 && p->empty_g <= 5000 &&
	       p->low_g >= 0 && p->low_g <= 5000 &&
	       p->reference_g >= 0 && p->reference_g <= 5000 &&
	       memchr(p->spool, '\0', sizeof(p->spool)) != NULL;
}

static void publish(const struct profile *p)
{
	k_spinlock_key_t key = k_spin_lock(&state_lock);
	active = *p;
	if (++revision == 0) {
		revision = 1;
	}
	k_spin_unlock(&state_lock, key);
}

uint32_t profile_get(struct profile *out)
{
	k_spinlock_key_t key = k_spin_lock(&state_lock);
	uint32_t current = revision;
	*out = active;
	k_spin_unlock(&state_lock, key);
	return current;
}

int profile_init(void)
{
	struct profile loaded;
	struct profile previous;
	int rc = 0;

	k_mutex_lock(&writer_lock, K_FOREVER);
	if (profile_get(&previous) == 0) {
		rc = settings_subsys_init();
		if (!rc) {
			ssize_t len = settings_load_one(PROFILE_KEY, &loaded, sizeof(loaded));
			if (len == sizeof(loaded) && valid(&loaded)) {
				publish(&loaded);
			} else if (len < 0 && len != -ENOENT) {
				rc = (int)len;
			} else {
				if (len > 0) {
					LOG_WRN("Invalid dryspool/v1 profile; using defaults");
				}
				publish(&previous);
			}
		}
	}
	k_mutex_unlock(&writer_lock);
	return rc;
}

int profile_save(const struct profile *p, uint32_t expected_revision)
{
	int rc;

	if (!valid(p)) {
		return -EINVAL;
	}
	/* Serialize competing flash writes. Readers take only state_lock and
	 * continue using the previously committed record while NVS is busy.
	 */
	k_mutex_lock(&writer_lock, K_FOREVER);
	k_spinlock_key_t key = k_spin_lock(&state_lock);
	bool can_save = revision != 0 && revision == expected_revision;
	k_spin_unlock(&state_lock, key);
	if (can_save) {
		rc = settings_save_one(PROFILE_KEY, p, sizeof(*p));
		if (!rc) {
			publish(p);
		}
	} else {
		rc = -EAGAIN;
	}
	k_mutex_unlock(&writer_lock);
	return rc;
}
