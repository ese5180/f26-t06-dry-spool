/* DrySpool cloud worker, using the nRF Cloud CoAP and Memfault HTTPS
 * transports from the team's Nordic Wi-Fi firmware.
 */
#include <errno.h>
#include <date_time.h>
#include <memfault/ports/zephyr/periodic_upload.h>
#include <net/nrf_cloud.h>
#include <net/nrf_cloud_coap.h>
#include <zephyr/kernel.h>
#include <zephyr/logging/log.h>
#include <zephyr/net/conn_mgr_connectivity.h>
#include <zephyr/net/conn_mgr_monitor.h>
#include <zephyr/net/net_event.h>
#include <zephyr/net/net_if.h>
#include <zephyr/net/net_mgmt.h>

#include "cloud_connection.h"
#include "telemetry.h"
#if defined(CONFIG_SAMPLE_MEMFAULT_BUTTONS)
#include "memfault_buttons.h"
#endif

LOG_MODULE_REGISTER(dryspool_cloud, CONFIG_WIFI_NRF_CLOUD_LOG_LEVEL);

#define LINK_UP BIT(0)
#define SESSION_LOST BIT(1)
#define CLOUD_READY BIT(2)
#define REBOOT_PENDING BIT(3)
#define RETRY K_SECONDS(CONFIG_CLOUD_CONNECTION_RETRY_TIMEOUT_SECONDS)

static K_EVENT_DEFINE(events);
static struct net_mgmt_event_callback l4_cb;

static void link_changed(struct net_mgmt_event_callback *cb, uint64_t event,
			 struct net_if *iface)
{
	if (event == NET_EVENT_L4_CONNECTED) {
		k_event_post(&events, LINK_UP);
	} else if (event == NET_EVENT_L4_DISCONNECTED) {
		/* Keep SESSION_LOST latched even if Wi-Fi comes back before the
		 * sender wakes up. The previous DTLS session must be replaced.
		 */
		k_event_set_masked(&events, SESSION_LOST, LINK_UP | CLOUD_READY | SESSION_LOST);
	}
}

/* Used by the existing Memfault button and FOTA completion handlers. */
bool await_cloud_ready(k_timeout_t timeout)
{
	return k_event_wait(&events, CLOUD_READY, false, timeout) != 0 &&
	       !k_event_test(&events, SESSION_LOST);
}

void disconnect_cloud(void)
{
	/* Invoked on verified download completion, shortly before reboot. */
	k_event_set_masked(&events, SESSION_LOST | REBOOT_PENDING,
			   CLOUD_READY | SESSION_LOST | REBOOT_PENDING);
	(void)nrf_cloud_coap_disconnect();
}

static bool session_ready(void)
{
	return await_cloud_ready(K_NO_WAIT);
}

static void run_session(void)
{
	int rc = nrf_cloud_coap_connect(CONFIG_APP_VERSION);

	if (rc) {
		LOG_WRN("nRF Cloud connect failed: %d", rc);
	} else if (!k_event_test(&events, SESSION_LOST)) {
		LOG_INF("Connected to nRF Cloud; starting telemetry and Memfault release checks");
		k_event_post(&events, CLOUD_READY);
		memfault_zephyr_port_periodic_upload_enable(true);
		int64_t next_telemetry = 0;
		do {
			if (dryspool_shadow_sync()) {
				break;
			}
			if (k_uptime_get() >= next_telemetry) {
				if (dryspool_telemetry_send_latest(session_ready)) {
					break;
				}
				next_telemetry = k_uptime_get() + CONFIG_SENSOR_SAMPLE_INTERVAL_SECONDS * 1000;
			}
			if (!session_ready()) {
				break;
			}
		} while (!k_event_wait(&events, SESSION_LOST, false,
				       K_SECONDS(5)));
	}

	k_event_clear(&events, CLOUD_READY);
	memfault_zephyr_port_periodic_upload_enable(false);
	(void)nrf_cloud_coap_disconnect();
}

static void cloud_worker(void *a, void *b, void *c)
{
	struct net_if *iface = net_if_get_wifi_sta();
	const struct net_linkaddr *mac = iface ? net_if_get_link_addr(iface) : NULL;
	if (mac && mac->len == 6) {
		LOG_INF("Device Wi-Fi MAC: %02X:%02X:%02X:%02X:%02X:%02X",
			mac->addr[0], mac->addr[1], mac->addr[2], mac->addr[3],
			mac->addr[4], mac->addr[5]);
	}
	net_mgmt_init_event_callback(&l4_cb, link_changed,
				     NET_EVENT_L4_CONNECTED | NET_EVENT_L4_DISCONNECTED);
	net_mgmt_add_event_callback(&l4_cb);
	int rc;

	while ((rc = nrf_cloud_coap_init()) != 0) {
		LOG_WRN("nRF Cloud initialization failed: %d", rc);
		k_sleep(RETRY);
	}
	char id[NRF_CLOUD_CLIENT_ID_MAX_LEN + 1];
	if (!nrf_cloud_client_id_get(id, sizeof(id))) {
		LOG_INF("nRF Cloud device ID: %s", id);
	}
	if (IS_ENABLED(CONFIG_NRF_CLOUD_CHECK_CREDENTIALS)) {
		while ((rc = nrf_cloud_credentials_configured_check()) != 0) {
			if (rc == -ENOPROTOOPT) {
				/* SDK infers which CA is present from its size. Let
				 * DTLS validate the actual provisioned trust chain.
				 */
				LOG_WRN("Check CA bundle for CoAP; attempting verified connection");
				break;
			}
			LOG_WRN("Waiting for device credentials: %d", rc);
			k_sleep(RETRY);
		}
	}
	conn_mgr_all_if_connect(true);
	conn_mgr_mon_resend_status();

	while (!k_event_test(&events, REBOOT_PENDING)) {
		if (!k_event_wait(&events, LINK_UP, false, RETRY)) {
			/* Also recover from a missing AP or missing Wi-Fi profile at boot. */
			conn_mgr_all_if_connect(true);
			continue;
		}
		k_event_clear(&events, SESSION_LOST);
		if (!k_event_test(&events, LINK_UP)) {
			continue;
		}
		if (!date_time_is_valid()) {
			date_time_update_async(NULL);
		} else {
			run_session();
		}
		k_sleep(RETRY);
	}
}

/* Preemptible, below the local control loop. No network calls or waiting
 * for connectivity in main() or inside the snapshot's critical section.
 */
K_THREAD_DEFINE(cloud_thread, CONFIG_CONNECTION_THREAD_STACK_SIZE, cloud_worker,
		NULL, NULL, NULL, 5, 0, 0);

#if defined(CONFIG_SAMPLE_MEMFAULT_BUTTONS)
static void button_worker(void *a, void *b, void *c)
{
	memfault_buttons_thread_fn();
}
K_THREAD_DEFINE(button_thread, CONFIG_SAMPLE_MEMFAULT_BUTTONS_THREAD_STACK_SIZE, button_worker,
		NULL, NULL, NULL, 5, 0, 0);
#endif
