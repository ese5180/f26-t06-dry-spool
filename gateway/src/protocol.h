#pragma once
#include <zephyr/bluetooth/bluetooth.h>
#include <zephyr/bluetooth/conn.h>
#include <zephyr/bluetooth/gatt.h>
#include <zephyr/kernel.h>
#include <zephyr/sys/byteorder.h>

/* Keep box packets within the default ATT payload. All integers little endian. */
enum {
	ENV_OK = 1,
	GRAMS_OK = 2,
	FAN_OK = 4,
	OUTPUT_ON = 8
};
struct box_sample {
	uint8_t flags, mode;
	uint8_t temp[4], rh[4], grams[4], command_id[4];
};
#define DS_UUID(n)                                                                                 \
	BT_UUID_DECLARE_128(                                                                       \
		BT_UUID_128_ENCODE(0x7ba10000 + (n), 0x51a3, 0x4386, 0x9168, 0xca23e2270001))
#define DS_SERVICE DS_UUID(0)
#define DS_BOX     DS_UUID(1)
int radio_start(void);
