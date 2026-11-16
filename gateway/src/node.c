#include "protocol.h"
#include "readings.h"
#include "node_fleet.h"

static ssize_t read_box(struct bt_conn *conn, const struct bt_gatt_attr *attr, void *buf,
			uint16_t len, uint16_t offset)
{
	struct dryspool_sample s;
	if (!dryspool_read_latest(&s) || k_uptime_get() - s.uptime_ms > 10000) {
		return BT_GATT_ERR(BT_ATT_ERR_UNLIKELY);
	}
	struct box_sample wire = {.mode = s.fan_request.mode};
	wire.flags = (s.env_valid ? ENV_OK : 0) | (s.grams_valid ? GRAMS_OK : 0) |
		     (s.fan_valid ? FAN_OK : 0) | (s.fan_on ? OUTPUT_ON : 0);
	sys_put_le32(s.temperature_mc, wire.temp);
	sys_put_le32(s.humidity_mpct, wire.rh);
	sys_put_le32(s.filament_g, wire.grams);
	sys_put_le32(s.fan_request.id, wire.command_id);
	return bt_gatt_attr_read(conn, attr, buf, len, offset, &wire, sizeof(wire));
}

static ssize_t write_box(struct bt_conn *conn, const struct bt_gatt_attr *attr, const void *buf,
			 uint16_t len, uint16_t offset, uint8_t flags)
{
	const uint8_t *p = buf;
	if (offset || len != 5 || p[0] > FAN_OFF) {
		return BT_GATT_ERR(BT_ATT_ERR_VALUE_NOT_ALLOWED);
	}
	dryspool_set_fan_request((struct fan_request){p[0], (int32_t)sys_get_le32(p + 1)});
	return len;
}
BT_GATT_SERVICE_DEFINE(box_svc, BT_GATT_PRIMARY_SERVICE(DS_SERVICE),
		       BT_GATT_CHARACTERISTIC(DS_BOX,
					      BT_GATT_CHRC_READ | BT_GATT_CHRC_WRITE_WITHOUT_RESP,
					      BT_GATT_PERM_READ_ENCRYPT |
						      BT_GATT_PERM_WRITE_ENCRYPT,
					      read_box, write_box, NULL));

static void start_node(void *a, void *b, void *c)
{
	int rc = radio_start();
	if (rc) {
		printk("BLE startup failed: %d\n", rc);
	}
	box_check_trial(rc == 0);
}
K_THREAD_DEFINE(node_radio, 3072, start_node, NULL, NULL, NULL, 7, 0, 0);
