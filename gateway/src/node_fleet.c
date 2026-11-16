#include <string.h>
#include <memfault/core/data_packetizer.h>
#include <memfault/core/platform/device_info.h>
#include <memfault/metrics/metrics.h>
#include <zephyr/dfu/mcuboot.h>
#include <zephyr/sys/reboot.h>
#include "box_fleet_wire.h"
#include "node_fleet.h"
#include "readings.h"

static bool fresh_sample(struct dryspool_sample *s)
{
	return dryspool_read_latest(s) && k_uptime_get() - s->uptime_ms < 10000;
}

void memfault_metrics_heartbeat_collect_data(void)
{
	struct dryspool_sample s;
	if (!fresh_sample(&s)) {
		return;
	}
	if (s.env_valid) {
		MEMFAULT_METRIC_SET_SIGNED(dryspool_temperature_c, s.temperature_mc / 100);
		MEMFAULT_METRIC_SET_UNSIGNED(dryspool_humidity_pct, s.humidity_mpct / 100);
	}
	if (s.grams_valid) {
		MEMFAULT_METRIC_SET_UNSIGNED(dryspool_filament_g, s.filament_g);
	}
	if (s.fan_valid) {
		MEMFAULT_METRIC_SET_UNSIGNED(dryspool_dehumidifier_on, s.fan_on);
	}
}

void box_check_trial(bool radio_ok)
{
	if (boot_is_img_confirmed()) {
		return;
	}
	for (int i = 0; radio_ok && i < 60; ++i) {
		struct dryspool_sample s;
		if (fresh_sample(&s) && s.env_valid && s.raw_valid && s.fan_valid &&
		    boot_write_img_confirmed() == 0) {
			return;
		}
		k_sleep(K_SECONDS(1));
	}
	/* Reset a trial that failed its local health check so MCUboot can revert. */
	sys_reboot(SYS_REBOOT_COLD);
}

static ssize_t read_info(struct bt_conn *conn, const struct bt_gatt_attr *attr, void *buf,
			 uint16_t len, uint16_t offset)
{
	sMemfaultDeviceInfo identity;
	memfault_platform_get_device_info(&identity);
	struct box_fleet_info info = {0};
	if (!identity.device_serial || !identity.hardware_version || !identity.software_type ||
	    !identity.software_version || strlen(identity.device_serial) >= sizeof(info.serial) ||
	    strlen(identity.hardware_version) >= sizeof(info.hardware) ||
	    strlen(identity.software_type) >= sizeof(info.software) ||
	    strlen(identity.software_version) >= sizeof(info.version)) {
		return BT_GATT_ERR(BT_ATT_ERR_UNLIKELY);
	}
	strcpy(info.serial, identity.device_serial);
	strcpy(info.hardware, identity.hardware_version);
	strcpy(info.software, identity.software_type);
	strcpy(info.version, identity.software_version);
	info.confirmed = boot_is_img_confirmed();
	return bt_gatt_attr_read(conn, attr, buf, len, offset, &info, sizeof(info));
}

/* Keep the chunk in RAM until G has received a 2xx from Memfault. Reads may
 * be retried after a failed HTTPS POST or a dropped Bluetooth connection. */
static K_MUTEX_DEFINE(chunk_lock);
static uint8_t pending[4 + DS_CHUNK_MAX];
static uint32_t sequence;
static size_t size;

static ssize_t read_chunk(struct bt_conn *conn, const struct bt_gatt_attr *attr, void *buf,
			  uint16_t len, uint16_t offset)
{
	k_mutex_lock(&chunk_lock, K_FOREVER);
	if (size == 0 && offset == 0) {
		size_t n = DS_CHUNK_MAX;
		if (memfault_packetizer_get_chunk(pending + 4, &n)) {
			sys_put_le32(++sequence, pending);
			size = n + 4;
		}
	}
	ssize_t n = bt_gatt_attr_read(conn, attr, buf, len, offset, pending, size);
	k_mutex_unlock(&chunk_lock);
	return n;
}

static ssize_t ack_chunk(struct bt_conn *conn, const struct bt_gatt_attr *attr, const void *buf,
			 uint16_t len, uint16_t offset, uint8_t flags)
{
	if (offset || len != 4) {
		return BT_GATT_ERR(BT_ATT_ERR_INVALID_ATTRIBUTE_LEN);
	}
	k_mutex_lock(&chunk_lock, K_FOREVER);
	if (sys_get_le32(buf) == sequence) {
		size = 0;
	}
	k_mutex_unlock(&chunk_lock);
	return len;
}

BT_GATT_SERVICE_DEFINE(box_fleet, BT_GATT_PRIMARY_SERVICE(DS_FLEET_SVC),
		       BT_GATT_CHARACTERISTIC(DS_FLEET_INFO, BT_GATT_CHRC_READ,
					      BT_GATT_PERM_READ_ENCRYPT, read_info, NULL, NULL),
		       BT_GATT_CHARACTERISTIC(DS_FLEET_CHUNK,
					      BT_GATT_CHRC_READ | BT_GATT_CHRC_WRITE,
					      BT_GATT_PERM_READ_ENCRYPT |
						      BT_GATT_PERM_WRITE_ENCRYPT,
					      read_chunk, ack_chunk, NULL));
