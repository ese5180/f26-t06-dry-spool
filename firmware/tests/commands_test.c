#include <assert.h>
#include <errno.h>
#include <stdio.h>
#include "../src/shell/commands.c"
static struct profile stored = {.empty_g = -1};
static uint32_t current = 1;
static int error;
static int32_t raw[2] = {100, 200};
uint32_t profile_get(struct profile *p) { *p = stored; return current; }
int profile_save(const struct profile *p, uint32_t rev) {
    if (rev != current) return -EAGAIN;
    stored = *p; ++current; return 0;
}
int scale_sample(int32_t out[2], int *failed) {
    *failed = error ? 1 : -1;
    if (!error) memcpy(out, raw, sizeof(raw));
    return error;
}
int scale_sample_channel(unsigned int channel, int32_t *out) {
    assert(channel < 2); if (!error) *out = raw[channel]; return error;
}
static int run(size_t argc, char **argv) { return configure(NULL, argc, argv); }
int main(void) {
    char *tare[] = {"dryspool", "tare"};
    char *cal_a[] = {"dryspool", "cal", "A", "500"};
    char *cal_b[] = {"dryspool", "cal", "B", "500"};
    char *old[] = {"dryspool", "cal", "500"};
    char *bad[] = {"dryspool", "cal", "C", "500"};
    char *zero[] = {"dryspool", "zero"};
    assert(run(3, old) == -EINVAL && current == 1);
    assert(run(4, bad) == -EINVAL && current == 1);
    assert(run(2, zero) == -ENODATA && current == 1);
    assert(run(2, tare) == 0);
    raw[0] = 1100; assert(run(4, cal_a) == 0);
    raw[1] = -1800; assert(run(4, cal_b) == 0);
    assert(stored.channel[0].span == 1000 && stored.channel[1].span == -2000);
    raw[0] = 300; raw[1] = 500; assert(run(2, zero) == 0);
    assert(stored.channel[0].zero == 300 && stored.channel[1].zero == 500);
    assert(stored.channel[0].span == 1000 && stored.channel[1].span == -2000);
    struct profile previous = stored; uint32_t rev = current;
    error = -EIO;
    assert(run(2, tare) == -EIO && run(2, zero) == -EIO && run(4, cal_a) == -EIO);
    assert(current == rev && memcmp(&previous, &stored, sizeof(stored)) == 0);
    error = 0;
    char *tare_b[] = {"dryspool", "tare", "B"};
    assert(run(3, tare_b) == 0);
    assert(stored.channel[0].span == 1000 && !stored.channel[1].span);
    puts("dual shell calibration, zero and failed-read tests passed");
}
