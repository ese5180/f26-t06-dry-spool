/* Copyright (c) 2026 Nordic Semiconductor ASA
 *
 * SPDX-License-Identifier: LicenseRef-Nordic-5-Clause
 */

#ifndef MEMFAULT_UPDATE_H
#define MEMFAULT_UPDATE_H

/**
 * @brief Confirm the running MCUboot image.
 *
 * Confirms the running image (if not already confirmed) so that MCUboot does not roll back
 * after a successful FOTA update.
 */
void memfault_confirm_running_image(void);
const char *memfault_fota_phase(void);

#endif /* MEMFAULT_UPDATE_H */
