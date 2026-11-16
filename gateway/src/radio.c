#include <zephyr/drivers/gpio.h>
#include <zephyr/settings/settings.h>
#include "protocol.h"

static const struct gpio_dt_spec button = GPIO_DT_SPEC_GET(DT_ALIAS(sw0), gpios);

static enum bt_security_err accept_pair(struct bt_conn *conn,
					const struct bt_conn_pairing_feat *feat)
{
	return gpio_pin_get_dt(&button) == 1 ? BT_SECURITY_ERR_SUCCESS
					     : BT_SECURITY_ERR_PAIR_NOT_ALLOWED;
}

static struct bt_conn_auth_cb auth = {.pairing_accept = accept_pair};
#ifdef CONFIG_DRYSPOOL_NODE
#include <zephyr/mgmt/mcumgr/transport/smp_bt.h>
static const struct bt_data sd[] = {BT_DATA_BYTES(BT_DATA_UUID128_ALL, SMP_BT_SVC_UUID_VAL)};
static const struct bt_data adv[] = {
	BT_DATA_BYTES(BT_DATA_FLAGS, BT_LE_AD_GENERAL | BT_LE_AD_NO_BREDR),
	BT_DATA(BT_DATA_NAME_COMPLETE, CONFIG_BT_DEVICE_NAME, sizeof(CONFIG_BT_DEVICE_NAME) - 1),
};

static void advertise(struct k_work *work)
{
	int rc = bt_le_adv_start(BT_LE_ADV_CONN_FAST_2, adv, ARRAY_SIZE(adv), sd, ARRAY_SIZE(sd));
	if (rc && rc != -EALREADY && rc != -ENOMEM) {
		printk("Advertising failed: %d\n", rc);
	}
}
static K_WORK_DEFINE(adv_work, advertise);
static void recycled(void)
{
	k_work_submit(&adv_work);
}
/* Keep advertising after the first connection so a phone can do DFU
 * while the gateway remains connected. */
static void connected(struct bt_conn *conn, uint8_t err)
{
	k_work_submit(&adv_work);
}
BT_CONN_CB_DEFINE(radio_cb) = {.connected = connected, .recycled = recycled};

#endif
int radio_start(void)
{
	if (!gpio_is_ready_dt(&button)) {
		return -ENODEV;
	}
	int rc = gpio_pin_configure_dt(&button, GPIO_INPUT);
	if (!rc) {
		rc = bt_conn_auth_cb_register(&auth);
	}
	if (!rc) {
		rc = bt_enable(NULL);
	}
	if (!rc) {
		rc = settings_load();
	}
#ifdef CONFIG_DRYSPOOL_NODE
	if (!rc) {
		k_work_submit(&adv_work);
	}
#endif
	return rc;
}
