/* Exercise the production driver against a mux-aware I2C fake. */
#include <assert.h>
#include <errno.h>
#include <stdio.h>
#include "../src/sensors/nau7802.c"

static int64_t now, switched;
static unsigned int selected;
static int conversions, cal_count[2], resets;
static int fail_channel = -1;
static bool stale, timeout;
static int32_t values[2] = {123456, -654321};
int64_t k_uptime_get(void)
{
	return now;
}
void k_msleep(int ms)
{
	now += ms;
}
bool i2c_is_ready_dt(const struct i2c_dt_spec *s)
{
	(void)s;
	return true;
}
int i2c_reg_write_byte_dt(const struct i2c_dt_spec *s, uint8_t reg, uint8_t v)
{
	(void)s;
	assert(scale_lock);
	if (reg == POWER && (v & BIT(0))) {
		resets++;
	}
	if (reg == CTRL2) {
		selected = !!(v & BIT(7));
		switched = now;
		stale = true;
	}
	return 0;
}
int i2c_reg_update_byte_dt(const struct i2c_dt_spec *s, uint8_t reg, uint8_t mask, uint8_t v)
{
	(void)s;
	assert(scale_lock);
	if (reg == CTRL2 && (mask & BIT(7))) {
		selected = !!(v & BIT(7));
		switched = now;
		stale = true;
	}
	if (reg == CTRL2 && (mask & BIT(2))) {
		assert(now - switched >= 600);
		cal_count[selected]++;
	}
	return 0;
}
int i2c_reg_read_byte_dt(const struct i2c_dt_spec *s, uint8_t reg, uint8_t *v)
{
	(void)s;
	assert(scale_lock);
	*v = reg == POWER ? BIT(3) | (timeout ? 0 : BIT(5)) : 0;
	return 0;
}
int i2c_burst_read_dt(const struct i2c_dt_spec *s, uint8_t reg, uint8_t *buf, size_t n)
{
	(void)s;
	assert(scale_lock);
	assert(reg == DATA && n == 3);
	assert(now - switched >= 600);
	if ((int)selected == fail_channel) {
		return -EIO;
	}
	/* Pending conversion belongs to the prior channel and must be discarded. */
	int32_t value = stale ? 8388607 : values[selected];
	stale = false;
	conversions++;
	uint32_t bits = (uint32_t)value & 0xffffff;
	buf[0] = bits >> 16;
	buf[1] = bits >> 8;
	buf[2] = bits;
	return 0;
}
int main(void)
{
	int32_t pair[2] = {0};
	int failed;
	assert(scale_sample(pair, &failed) == 0);
	assert(pair[0] == values[0] && pair[1] == values[1]);
	assert(cal_count[0] == 1 && cal_count[1] == 1 && conversions == 12);
	int32_t one = 0;
	assert(scale_sample_channel(SCALE_A, &one) == 0 && one == values[0]);
	assert(scale_sample(pair, &failed) == 0 && pair[1] == values[1]);
	assert(resets == 1); /* calibration retained while switching */
	fail_channel = SCALE_B;
	pair[0] = 11;
	pair[1] = 22;
	assert(scale_sample(pair, &failed) == -EIO && failed == SCALE_B);
	assert(pair[0] == 11 && pair[1] == 22 && !scale_lock);
	fail_channel = -1;
	assert(scale_sample(pair, &failed) == 0 && resets == 2);
	values[SCALE_B] = -8388608;
	assert(scale_sample(pair, &failed) == -ERANGE && failed == SCALE_B);
	values[SCALE_B] = -654321;
	timeout = true;
	assert(scale_sample(pair, &failed) == -ETIMEDOUT && !scale_lock);
	timeout = false;
	assert(scale_sample_channel(2, &one) == -EINVAL && !scale_lock);
	assert(scale_sample(pair, &failed) == 0);
	puts("dual ADC channel, settling, failure and recovery tests passed");
}
