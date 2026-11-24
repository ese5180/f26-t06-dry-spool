#pragma once
#include <stdbool.h>
#include <stdint.h>
#include <stddef.h>
#define DT_NODELABEL(x) 0
#define I2C_DT_SPEC_GET(x) {0}
struct i2c_dt_spec { int unused; };
bool i2c_is_ready_dt(const struct i2c_dt_spec *s);
int i2c_reg_read_byte_dt(const struct i2c_dt_spec *s, uint8_t reg, uint8_t *v);
int i2c_reg_write_byte_dt(const struct i2c_dt_spec *s, uint8_t reg, uint8_t v);
int i2c_reg_update_byte_dt(const struct i2c_dt_spec *s, uint8_t reg, uint8_t mask, uint8_t v);
int i2c_burst_read_dt(const struct i2c_dt_spec *s, uint8_t reg, uint8_t *buf, size_t n);
