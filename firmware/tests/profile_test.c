#include <assert.h>
#include <errno.h>
#include <stdio.h>
#include "../src/spool/profile.c"

static struct profile saved;
static struct profile_v1 legacy = {.empty_g = 210,
				   .low_g = 80,
				   .rh_off = 25,
				   .rh_on = 45,
				   .zero = 10,
				   .span = 100,
				   .reference_g = 500,
				   .tared = 1,
				   .spool = "PLA01"};
static bool has_v2, save_fail;
static int writes;
int settings_subsys_init(void)
{
	return 0;
}
ssize_t settings_load_one(const char *key, void *buf, size_t n)
{
	if (!strcmp(key, "dryspool/v2")) {
		if (!has_v2) {
			return -ENOENT;
		}
		assert(n == sizeof(saved));
		memcpy(buf, &saved, n);
		return n;
	}
	assert(!strcmp(key, "dryspool/v1") && n == sizeof(legacy));
	memcpy(buf, &legacy, n);
	return n;
}
int settings_save_one(const char *key, const void *buf, size_t n)
{
	assert(!strcmp(key, "dryspool/v2") && n == sizeof(saved));
	if (save_fail) {
		return -EIO;
	}
	memcpy(&saved, buf, n);
	has_v2 = true;
	writes++;
	return 0;
}
int main(void)
{
	save_fail = true;
	assert(profile_init() == -EIO && revision == 0);
	save_fail = false;
	assert(profile_init() == 0 && writes == 1);
	struct profile p;
	uint32_t rev = profile_get(&p);
	assert(p.empty_g == 210 && p.low_g == 80 && !p.channel[0].tared && !p.channel[1].tared);
	calibration_tare(&p, 0, 100);
	calibration_set_reference(&p, 0, 1100, 500);
	calibration_tare(&p, 1, 200);
	calibration_set_reference(&p, 1, -1800, 500);
	assert(profile_save(&p, rev) == 0);
	assert(profile_save(&p, rev) == -EAGAIN);
	revision = 0; /* reboot: v2 wins over legacy */
	assert(profile_init() == 0 && writes == 2);
	struct profile loaded;
	rev = profile_get(&loaded);
	assert(memcmp(&p, &loaded, sizeof(p)) == 0);
	p.low_g = 90;
	save_fail = true;
	assert(profile_save(&p, rev) == -EIO);
	profile_get(&loaded);
	assert(loaded.low_g == 80);
	p.channel[1].tared = 0;
	assert(profile_save(&p, rev) == -EINVAL);
	assert(legacy.span == 100 && legacy.reference_g == 500);
	puts("v1 migration, v2 persistence and failed/stale save tests passed");
}
