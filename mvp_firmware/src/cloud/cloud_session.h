#pragma once

#include <zephyr/kernel.h>

/**
 * @brief Sleep until the nRF Cloud connection is ready for use, or the specified timeout elapses.
 *
 * @param timeout - The time to wait before timing out.
 * @return true if nRF Cloud became ready in time.
 * @return false if timed out.
 */
bool await_cloud_ready(k_timeout_t timeout);

/**
 * @brief Disconnect from nRF Cloud and update internal state accordingly.
 *
 * May also be called to report an external disconnection.
 */
void disconnect_cloud(void);
