/* Copyright (c) 2023 Nordic Semiconductor ASA
 *
 * SPDX-License-Identifier: LicenseRef-Nordic-5-Clause
 */

#include <zephyr/kernel.h>
#include <zephyr/logging/log.h>
#include <zephyr/sys/reboot.h>
#include <zephyr/logging/log_ctrl.h>

#include "ota/update_reboot.h"

#define UPDATE_REBOOT_DELAY_S 10

LOG_MODULE_REGISTER(update_reboot, CONFIG_WIFI_NRF_CLOUD_LOG_LEVEL);

void reboot_after_update(void)
{
	LOG_INF("Rebooting in %us...", UPDATE_REBOOT_DELAY_S);
	LOG_PANIC();
	k_sleep(K_SECONDS(UPDATE_REBOOT_DELAY_S));
	sys_reboot(SYS_REBOOT_COLD);
}
