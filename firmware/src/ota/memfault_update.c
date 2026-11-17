/* Copyright (c) 2026 Nordic Semiconductor ASA
 *
 * SPDX-License-Identifier: LicenseRef-Nordic-5-Clause
 */

#include <zephyr/dfu/mcuboot.h>
#include <zephyr/kernel.h>
#include <zephyr/logging/log.h>
#include <memfault/components.h>
#include <net/fota_download.h>

#include "ota/memfault_update.h"
#include "cloud/cloud_session.h"
#include "ota/update_reboot.h"

LOG_MODULE_REGISTER(memfault_update, CONFIG_WIFI_NRF_CLOUD_LOG_LEVEL);

enum phase { IDLE, TRANSFERRING, RESTARTING, FAILED };
static atomic_t phase;
const char *memfault_fota_phase(void)
{
	static const char *const names[] = {"idle", "transferring", "restarting", "failed"};
	return names[atomic_get(&phase)];
}

/* Custom FOTA download callback (enabled through CONFIG_MEMFAULT_FOTA_DOWNLOAD_CALLBACK_CUSTOM)
 * so that the sample can cleanly disconnect from nRF Cloud before rebooting to apply the update.
 */
void memfault_fota_download_callback(const struct fota_download_evt *evt)
{
	switch (evt->id) {
	case FOTA_DOWNLOAD_EVT_PROGRESS:
		atomic_set(&phase, TRANSFERRING);
		break;
	case FOTA_DOWNLOAD_EVT_FINISHED:
		atomic_set(&phase, RESTARTING);
		LOG_INF("FOTA update downloaded, rebooting to apply it");
		disconnect_cloud();
		reboot_after_update();
		break;
	case FOTA_DOWNLOAD_EVT_ERROR:
		atomic_set(&phase, FAILED);
		LOG_ERR("FOTA download failed, cause: %d", evt->cause);
		break;
	case FOTA_DOWNLOAD_EVT_CANCELLED:
		atomic_set(&phase, IDLE);
		LOG_ERR("FOTA download cancelled");
		break;
	default:
		break;
	}
}

void memfault_confirm_running_image(void)
{
	/* Confirm the running image */
	if (!boot_is_img_confirmed()) {
		int err;

		LOG_INF("Confirming FOTA update image");

		err = boot_write_img_confirmed();
		if (err) {
			LOG_ERR("Failed to confirm FOTA update image, error: %d", err);
		}
	}
}
