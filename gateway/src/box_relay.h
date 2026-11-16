#pragma once
#include <zephyr/bluetooth/conn.h>
/* Called by the BLE central once a paired box link is encrypted. */
void box_relay_connected(int slot, struct bt_conn *conn);

struct box_relay_status {
	char firmware[32];
	char serial[33];
	const char *ota;
};
void box_relay_snapshot(int slot, struct box_relay_status *out);
