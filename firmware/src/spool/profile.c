#include <errno.h>
#include <string.h>
#include <zephyr/kernel.h>
#include <zephyr/logging/log.h>
#include <zephyr/settings/settings.h>

#include "spool/calibration.h"
#include "spool/profile.h"

LOG_MODULE_REGISTER(dryspool_profile, LOG_LEVEL_INF);

#define PROFILE_KEY "dryspool/v2"
BUILD_ASSERT(sizeof(struct profile_v1) == 56, "dryspool/v1 record format changed");
BUILD_ASSERT(sizeof(struct profile) == 72, "dryspool/v2 record format changed");

static struct profile active = {.empty_g = -1, .low_g = 100, .rh_off = 30, .rh_on = 40};
static uint32_t revision;
static struct k_spinlock state_lock;
static K_MUTEX_DEFINE(writer_lock);

static bool valid(const struct profile *p)
{
	for (unsigned int i = 0; i < SCALE_CHANNELS; ++i) {
		const struct scale_calibration *c = &p->channel[i];
		if ((c->tared != 0 && c->tared != 1) || c->reference_g < 0 ||
		    c->reference_g > SCALE_CAPACITY_G ||
		    (c->span && (!c->tared || !c->reference_g)) || (!c->span && c->reference_g)) {
			return false;
		}
	}
	return p->rh_off >= 0 && p->rh_on <= 100 && p->rh_off < p->rh_on && p->empty_g >= -1 &&
	       p->empty_g <= SCALE_CAPACITY_G && p->low_g >= 0 && p->low_g <= SCALE_CAPACITY_G &&
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
			} else if (len == -ENOENT || len == 0) {
				struct profile_v1 legacy;
				ssize_t old_len =
					settings_load_one("dryspool/v1", &legacy, sizeof(legacy));
				if (old_len == sizeof(legacy)) {
					profile_migrate_v1(&legacy, &loaded);
					if (valid(&loaded)) {
						/* Persist before publishing: subsequent boots use
						 * v2. Keep v1 untouched for an older image's
						 * rollback. */
						rc = settings_save_one(PROFILE_KEY, &loaded,
								       sizeof(loaded));
						if (!rc) {
							publish(&loaded);
							LOG_INF("Migrated spool and limits; tare "
								"and calibrate A and B");
						}
					} else {
						publish(&previous);
					}
				} else if (old_len < 0 && old_len != -ENOENT) {
					rc = (int)old_len;
				} else {
					publish(&previous);
				}
			} else if (len < 0) {
				rc = (int)len;
			} else {
				if (len > 0) {
					LOG_WRN("Invalid dryspool/v2 profile; using defaults");
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
