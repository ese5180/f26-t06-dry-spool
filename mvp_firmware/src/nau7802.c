#include <errno.h>
#include <zephyr/drivers/i2c.h>
#include <zephyr/kernel.h>
#include <zephyr/sys/byteorder.h>
#include "nau7802.h"

static const struct i2c_dt_spec adc = I2C_DT_SPEC_GET(DT_NODELABEL(scale));
enum { POWER = 0, CTRL1 = 1, CTRL2 = 2, DATA = 0x12, ADC_CFG = 0x15 };

static int wait_bit(uint8_t reg, uint8_t mask, bool set, int timeout_ms)
{
	int64_t end = k_uptime_get() + timeout_ms;
	do {
		uint8_t v;
		int rc = i2c_reg_read_byte_dt(&adc, reg, &v);
		if (rc) return rc;
		if (!!(v & mask) == set) return 0;
		k_msleep(10);
	} while (k_uptime_get() < end);
	return -ETIMEDOUT;
}

int nau_start(void)
{
	if (!i2c_is_ready_dt(&adc)) return -ENODEV;
	int rc = i2c_reg_write_byte_dt(&adc, POWER, BIT(0)); /* reset */
	if (rc) return rc;
	k_msleep(2);
	rc = i2c_reg_write_byte_dt(&adc, POWER, 0);
	if (!rc) rc = i2c_reg_write_byte_dt(&adc, POWER, BIT(1) | BIT(2));
	if (!rc) rc = wait_bit(POWER, BIT(3), true, 650);
	/* 3.0 V bridge excitation, gain 128, channel A, default 10 SPS. */
	if (!rc) rc = i2c_reg_write_byte_dt(&adc, CTRL1, (4 << 3) | 7);
	if (!rc) rc = i2c_reg_update_byte_dt(&adc, POWER, BIT(7) | BIT(4), BIT(7) | BIT(4));
	if (!rc) rc = i2c_reg_update_byte_dt(&adc, ADC_CFG, 0x30, 0x30);
	if (rc) return rc;
	k_msleep(600);
	rc = i2c_reg_write_byte_dt(&adc, CTRL2, BIT(2)); /* internal offset calibration */
	if (!rc) rc = wait_bit(CTRL2, BIT(2), false, 1500);
	uint8_t status;
	if (!rc) rc = i2c_reg_read_byte_dt(&adc, CTRL2, &status);
	return rc ? rc : ((status & BIT(3)) ? -EIO : 0);
}

int nau_average(int32_t *counts)
{
	int32_t sum = 0;
	for (int i = 0; i < 6; i++) {
		uint8_t buf[3];
		int rc = wait_bit(POWER, BIT(5), true, 400);
		if (!rc) rc = i2c_burst_read_dt(&adc, DATA, buf, sizeof(buf));
		if (rc) return rc;
		int32_t v = sys_get_be24(buf);
		if (v & BIT(23)) v -= 1 << 24;
		if (v == -8388608 || v == 8388607) return -ERANGE;
		if (i) sum += v; /* discard pending conversion, average five fresh ones */
	}
	*counts = sum / 5;
	return 0;
}
