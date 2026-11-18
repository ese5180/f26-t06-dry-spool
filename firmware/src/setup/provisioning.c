#include <errno.h>
#include <string.h>
#include <psa/crypto.h>
#include <net/nrf_cloud.h>
#include <net/wifi_prov_core/wifi_prov_core.h>
#include <bluetooth/services/wifi_provisioning.h>
#include <zephyr/bluetooth/bluetooth.h>
#include <zephyr/bluetooth/conn.h>
#include <zephyr/bluetooth/gatt.h>
#include <zephyr/bluetooth/hci.h>
#include <zephyr/drivers/gpio.h>
#include <zephyr/logging/log.h>
#include <zephyr/sys/atomic.h>

#include "provisioning.h"

LOG_MODULE_REGISTER(dryspool_setup, LOG_LEVEL_INF);

#define SETUP_SERVICE BT_UUID_128_ENCODE(0xd7a61001,0x9df9,0x4b91,0x82bd,0xacf530acb853)
#define SETUP_ID BT_UUID_DECLARE_128( \
	BT_UUID_128_ENCODE(0xd7a61002,0x9df9,0x4b91,0x82bd,0xacf530acb853))
#define SETUP_STATE BT_UUID_DECLARE_128( \
	BT_UUID_128_ENCODE(0xd7a61003,0x9df9,0x4b91,0x82bd,0xacf530acb853))
#define SETUP_CLAIM BT_UUID_DECLARE_128( \
	BT_UUID_128_ENCODE(0xd7a61004,0x9df9,0x4b91,0x82bd,0xacf530acb853))

static const struct gpio_dt_spec button = GPIO_DT_SPEC_GET(DT_ALIAS(sw1), gpios);
static const struct gpio_dt_spec indicator = GPIO_DT_SPEC_GET(DT_ALIAS(led1), gpios);
static struct gpio_callback button_cb;
static struct k_spinlock proof_lock;
static char pending_proof[DRYSPOOL_PROOF_SIZE];
static int64_t proof_until;
static atomic_t active;
static atomic_t connected;
static atomic_t confirmed;

static const struct bt_data advertising[] = {
	BT_DATA_BYTES(BT_DATA_FLAGS, BT_LE_AD_GENERAL | BT_LE_AD_NO_BREDR),
	BT_DATA_BYTES(BT_DATA_UUID128_ALL, SETUP_SERVICE),
};
static const struct bt_data scan_response[] = {
	BT_DATA(BT_DATA_NAME_COMPLETE, "DrySpool", sizeof("DrySpool") - 1),
	BT_DATA_BYTES(BT_DATA_UUID128_ALL, BT_UUID_PROV_VAL),
};

static ssize_t read_id(struct bt_conn *conn, const struct bt_gatt_attr *attr, void *buf,
		       uint16_t len, uint16_t offset)
{
	char id[NRF_CLOUD_CLIENT_ID_MAX_LEN + 1];
	if (nrf_cloud_client_id_get(id, sizeof(id))) {
		return BT_GATT_ERR(BT_ATT_ERR_UNLIKELY);
	}
	return bt_gatt_attr_read(conn, attr, buf, len, offset, id, strlen(id));
}

static ssize_t read_state(struct bt_conn *conn, const struct bt_gatt_attr *attr, void *buf,
			  uint16_t len, uint16_t offset)
{
	uint8_t value = atomic_get(&confirmed) ? 1 : 0;
	return bt_gatt_attr_read(conn, attr, buf, len, offset, &value, 1);
}

static bool is_token(const uint8_t *bytes, uint16_t len)
{
	if (len != 64) {
		return false;
	}
	for (size_t i = 0; i < len; i++) {
		if (!(bytes[i] >= '0' && bytes[i] <= '9') &&
		    !(bytes[i] >= 'a' && bytes[i] <= 'f')) {
			return false;
		}
	}
	return true;
}

static ssize_t write_claim(struct bt_conn *conn, const struct bt_gatt_attr *attr,
			   const void *buf, uint16_t len, uint16_t offset, uint8_t flags)
{
	if (!atomic_get(&confirmed) || !atomic_get(&active)) {
		return BT_GATT_ERR(BT_ATT_ERR_AUTHORIZATION);
	}
	if (offset || flags & BT_GATT_WRITE_FLAG_PREPARE || !is_token(buf, len)) {
		return BT_GATT_ERR(BT_ATT_ERR_INVALID_ATTRIBUTE_LEN);
	}

	uint8_t hash[32];
	size_t written;
	if (psa_crypto_init() != PSA_SUCCESS ||
	    psa_hash_compute(PSA_ALG_SHA_256, buf, len, hash, sizeof(hash), &written) != PSA_SUCCESS ||
	    written != sizeof(hash)) {
		return BT_GATT_ERR(BT_ATT_ERR_UNLIKELY);
	}

	static const char digits[] = "0123456789abcdef";
	k_spinlock_key_t key = k_spin_lock(&proof_lock);
	for (size_t i = 0; i < sizeof(hash); i++) {
		pending_proof[i * 2] = digits[hash[i] >> 4];
		pending_proof[i * 2 + 1] = digits[hash[i] & 15];
	}
	proof_until = k_uptime_get() + 10 * 60 * 1000;
	k_spin_unlock(&proof_lock, key);
	return len;
}

BT_GATT_SERVICE_DEFINE(setup_service,
	BT_GATT_PRIMARY_SERVICE(BT_UUID_DECLARE_128(SETUP_SERVICE)),
	BT_GATT_CHARACTERISTIC(SETUP_ID, BT_GATT_CHRC_READ, BT_GATT_PERM_READ_ENCRYPT,
			      read_id, NULL, NULL),
	BT_GATT_CHARACTERISTIC(SETUP_STATE, BT_GATT_CHRC_READ, BT_GATT_PERM_READ_ENCRYPT,
			      read_state, NULL, NULL),
	BT_GATT_CHARACTERISTIC(SETUP_CLAIM, BT_GATT_CHRC_WRITE, BT_GATT_PERM_WRITE_ENCRYPT,
			      NULL, write_claim, NULL)
);

static bool authorize_write(struct bt_conn *conn, const struct bt_gatt_attr *attr)
{
	if (bt_uuid_cmp(attr->uuid, BT_UUID_PROV_CONTROL_POINT) != 0) {
		return true;
	}
	return atomic_get(&active) && atomic_get(&confirmed);
}

static const struct bt_gatt_authorization_cb authorization = {.write_authorize = authorize_write};

static void disconnect_peer(struct bt_conn *conn, void *data)
{
	(void)bt_conn_disconnect(conn, BT_HCI_ERR_REMOTE_USER_TERM_CONN);
}

static void close_window(struct k_work *work)
{
	atomic_clear(&active);
	atomic_clear(&confirmed);
	(void)bt_le_adv_stop();
	bt_conn_foreach(BT_CONN_TYPE_LE, disconnect_peer, NULL);
	(void)gpio_pin_set_dt(&indicator, 0);
}
static K_WORK_DELAYABLE_DEFINE(window_close, close_window);

static void start_or_confirm(struct k_work *work)
{
	if (atomic_get(&active) && atomic_get(&connected)) {
		atomic_set(&confirmed, 1);
		(void)gpio_pin_set_dt(&indicator, 1);
		(void)k_work_reschedule(&window_close, K_MINUTES(3));
		return;
	}
	if (atomic_get(&active)) {
		return;
	}
	int rc = bt_le_adv_start(BT_LE_ADV_CONN_FAST_1, advertising, ARRAY_SIZE(advertising),
				scan_response, ARRAY_SIZE(scan_response));
	if (rc) {
		LOG_WRN("Setup mode unavailable: %d", rc);
		return;
	}
	atomic_set(&active, 1);
	(void)gpio_pin_set_dt(&indicator, 1);
	(void)k_work_reschedule(&window_close, K_MINUTES(2));
}
static K_WORK_DELAYABLE_DEFINE(setup_button_work, start_or_confirm);

static void button_pressed(const struct device *port, struct gpio_callback *cb, uint32_t pins)
{
	(void)k_work_reschedule(&setup_button_work, K_MSEC(50));
}

static void peer_connected(struct bt_conn *conn, uint8_t err)
{
	if (!err && atomic_get(&active)) {
		atomic_set(&connected, 1);
	}
}

static void peer_disconnected(struct bt_conn *conn, uint8_t reason)
{
	atomic_clear(&connected);
	atomic_clear(&confirmed);
	if (atomic_cas(&active, 1, 0)) {
		(void)k_work_reschedule(&window_close, K_NO_WAIT);
	}
}

BT_CONN_CB_DEFINE(setup_connection) = {.connected = peer_connected, .disconnected = peer_disconnected};

int dryspool_setup_init(void)
{
	int rc = gpio_pin_configure_dt(&button, GPIO_INPUT);
	if (!rc) rc = gpio_pin_configure_dt(&indicator, GPIO_OUTPUT_INACTIVE);
	if (!rc) rc = bt_enable(NULL);
	if (!rc) rc = bt_gatt_authorization_cb_register(&authorization);
	if (!rc) rc = wifi_prov_init();
	if (!rc) {
		gpio_init_callback(&button_cb, button_pressed, BIT(button.pin));
		rc = gpio_add_callback(button.port, &button_cb);
	}
	if (!rc) rc = gpio_pin_interrupt_configure_dt(&button, GPIO_INT_EDGE_TO_ACTIVE);
	if (!rc && !wifi_prov_state_get()) {
		(void)k_work_schedule(&setup_button_work, K_NO_WAIT);
	}
	return rc;
}

bool dryspool_setup_active(void)
{
	return atomic_get(&active) != 0;
}

bool dryspool_setup_proof(char proof[DRYSPOOL_PROOF_SIZE])
{
	k_spinlock_key_t key = k_spin_lock(&proof_lock);
	bool ready = pending_proof[0] && k_uptime_get() < proof_until;
	if (ready) {
		memcpy(proof, pending_proof, DRYSPOOL_PROOF_SIZE);
	}
	k_spin_unlock(&proof_lock, key);
	return ready;
}

void dryspool_setup_reported(const char proof[DRYSPOOL_PROOF_SIZE])
{
	k_spinlock_key_t key = k_spin_lock(&proof_lock);
	if (!memcmp(proof, pending_proof, DRYSPOOL_PROOF_SIZE)) {
		memset(pending_proof, 0, sizeof(pending_proof));
	}
	k_spin_unlock(&proof_lock, key);
}
