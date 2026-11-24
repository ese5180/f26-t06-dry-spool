#include "sensors/scale.h"
#include <errno.h>
#include <zephyr/drivers/i2c.h>
#include <zephyr/kernel.h>
#include <zephyr/sys/byteorder.h>

static const struct i2c_dt_spec adc = I2C_DT_SPEC_GET(DT_NODELABEL(scale));
enum {
	POWER = 0,
	CTRL1 = 1,
	CTRL2 = 2,
	DATA = 0x12,
	ADC_CFG = 0x15
};

static int wait_bit(uint8_t reg, uint8_t mask, bool set, int timeout_ms)
{
	int64_t end = k_uptime_get() + timeout_ms;
	do {
		uint8_t v;
		int rc = i2c_reg_read_byte_dt(&adc, reg, &v);
		if (rc) {
			return rc;
		}
		if (!!(v & mask) == set) {
			return 0;
		}
		k_msleep(10);
	} while (k_uptime_get() < end);
	return -ETIMEDOUT;
}

static int nau_start(void)
{
	if (!i2c_is_ready_dt(&adc)) {
		return -ENODEV;
	}
	int rc = i2c_reg_write_byte_dt(&adc, POWER, BIT(0)); /* reset */
	if (rc) {
		return rc;
	}
	k_msleep(2);
	rc = i2c_reg_write_byte_dt(&adc, POWER, 0);
	if (!rc) {
		rc = i2c_reg_write_byte_dt(&adc, POWER, BIT(1) | BIT(2));
	}
	if (!rc) {
		rc = wait_bit(POWER, BIT(3), true, 650);
	}
	/* 3.0 V bridge excitation, gain 128, channel A, default 10 SPS. */
	if (!rc) {
		rc = i2c_reg_write_byte_dt(&adc, CTRL1, (4 << 3) | 7);
	}
	if (!rc) {
		rc = i2c_reg_update_byte_dt(&adc, POWER, BIT(7) | BIT(4), BIT(7) | BIT(4));
	}
	if (!rc) {
		rc = i2c_reg_update_byte_dt(&adc, ADC_CFG, 0x30, 0x30);
	}
	if (rc) {
		return rc;
	}
	k_msleep(600);
	/* The ADC has separate internal offset/gain registers for each channel. */
	for (unsigned int channel = 0; channel < SCALE_CHANNELS; ++channel) {
		rc = i2c_reg_write_byte_dt(&adc, CTRL2, channel ? BIT(7) : 0);
		if (rc) {
			return rc;
		}
		k_msleep(600);
		rc = i2c_reg_update_byte_dt(&adc, CTRL2, BIT(2), BIT(2));
		if (!rc) {
			rc = wait_bit(CTRL2, BIT(2), false, 1500);
		}
		uint8_t status;
		if (!rc) {
			rc = i2c_reg_read_byte_dt(&adc, CTRL2, &status);
		}
		if (rc) {
			return rc;
		}
		if (status & BIT(3)) {
			return -EIO;
		}
	}
	return 0;
}

static int nau_average(unsigned int channel, int32_t *counts)
{
	int rc = i2c_reg_update_byte_dt(&adc, CTRL2, BIT(7), channel ? BIT(7) : 0);
	if (rc) {
		return rc;
	}
	/* Conservative filter settling at 10 SPS after every mux change.
	 * Also discard the pending result before averaging five fresh samples. */
	k_msleep(600);
	int32_t sum = 0;
	for (int i = 0; i < 6; i++) {
		uint8_t buf[3];
		int rc = wait_bit(POWER, BIT(5), true, 400);
		if (!rc) {
			rc = i2c_burst_read_dt(&adc, DATA, buf, sizeof(buf));
		}
		if (rc) {
			return rc;
		}
		int32_t v = sys_get_be24(buf);
		if (v & BIT(23)) {
			v -= 1 << 24;
		}
		if (i && (v == -8388608 || v == 8388607)) {
			return -ERANGE;
		}
		if (i) {
			sum += v; /* discard pending conversion, average five fresh ones */
		}
	}
	*counts = sum / 5;
	return 0;
}

static K_MUTEX_DEFINE(scale_lock);
static bool adc_ready;

int scale_sample_channel(unsigned int channel, int32_t *raw)
{
	if (channel >= SCALE_CHANNELS) {
		return -EINVAL;
	}
	k_mutex_lock(&scale_lock, K_FOREVER);
	int rc = adc_ready ? 0 : nau_start();
	if (!rc) {
		rc = nau_average(channel, raw);
	}
	adc_ready = (rc == 0);
	k_mutex_unlock(&scale_lock);
	return rc;
}

int scale_sample(int32_t raw[SCALE_CHANNELS], int *failed_channel)
{
	int32_t next[SCALE_CHANNELS];
	*failed_channel = -1;
	k_mutex_lock(&scale_lock, K_FOREVER);
	int rc = adc_ready ? 0 : nau_start();
	for (unsigned int i = 0; !rc && i < SCALE_CHANNELS; ++i) {
		rc = nau_average(i, &next[i]);
		if (rc) {
			*failed_channel = (int)i;
		}
	}
	if (!rc) {
		for (unsigned int i = 0; i < SCALE_CHANNELS; ++i) {
			raw[i] = next[i];
		}
	}
	adc_ready = (rc == 0);
	k_mutex_unlock(&scale_lock);
	return rc;
}
