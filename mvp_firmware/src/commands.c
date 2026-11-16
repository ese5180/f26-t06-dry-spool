#include <errno.h>
#include <stdlib.h>
#include <string.h>
#include <zephyr/shell/shell.h>

#include "calibration.h"
#include "profile.h"
#include "scale.h"

static bool parse_limit(const char *s, long max, int32_t *out)
{
	char *end;
	long value = strtol(s, &end, 10);
	if (!*s || *end || value < 0 || value > max) {
		return false;
	}
	*out = value;
	return true;
}

static int tare(struct profile *p)
{
	int32_t raw;
	int rc = scale_sample(&raw);
	if (!rc) {
		calibration_tare(p, raw);
	}
	return rc;
}

static int calibrate(struct profile *p, const char *known_g)
{
	int32_t reference_g, raw;
	if (!p->tared || !parse_limit(known_g, SCALE_CAPACITY_G, &reference_g) || !reference_g) {
		return -EINVAL;
	}
	int rc = scale_sample(&raw);
	return rc ? rc : calibration_set_reference(p, raw, reference_g);
}

static int edit_profile(struct profile *p, size_t argc, char **argv)
{
	if (argc == 2 && !strcmp(argv[1], "tare")) {
		return tare(p);
	}
	if (argc == 3 && !strcmp(argv[1], "cal")) {
		return calibrate(p, argv[2]);
	}
	if (argc == 4 && !strcmp(argv[1], "spool") &&
	    *argv[2] && strlen(argv[2]) < sizeof(p->spool) &&
	    parse_limit(argv[3], SCALE_CAPACITY_G, &p->empty_g)) {
		strcpy(p->spool, argv[2]);
		return 0;
	}
	if (argc == 5 && !strcmp(argv[1], "limits") &&
	    parse_limit(argv[2], 100, &p->rh_off) &&
	    parse_limit(argv[3], 100, &p->rh_on) && p->rh_off < p->rh_on &&
	    parse_limit(argv[4], SCALE_CAPACITY_G, &p->low_g)) {
		return 0;
	}
	return -EINVAL;
}

static int configure(const struct shell *sh, size_t argc, char **argv)
{
	struct profile p;
	uint32_t revision = profile_get(&p);
	int rc = revision ? edit_profile(&p, argc, argv) : -EAGAIN;
	if (!rc) {
		rc = profile_save(&p, revision);
	}
	if (rc) {
		shell_error(sh, "Configuration unchanged (error %d). See dryspool help.", rc);
	} else {
		shell_print(sh, "Saved.");
	}
	return rc;
}

SHELL_CMD_ARG_REGISTER(dryspool, NULL,
	"tare | cal <known_g> | spool <id> <empty_g> | limits <off_RH> <on_RH> <low_g>",
	configure, 2, 3);
