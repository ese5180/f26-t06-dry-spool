/* Copyright (c) 2023 Nordic Semiconductor ASA
 *
 * SPDX-License-Identifier: LicenseRef-Nordic-5-Clause
 */

#ifndef _APPLICATION_H_
#define _APPLICATION_H_

#if defined(CONFIG_NRF_CLOUD_MQTT)
#define MSG_OBJ_DEFINE(_obj_name) \
	NRF_CLOUD_OBJ_JSON_DEFINE(_obj_name);
#elif defined(CONFIG_NRF_CLOUD_COAP)
#define MSG_OBJ_DEFINE(_obj_name) \
	NRF_CLOUD_OBJ_COAP_CBOR_DEFINE(_obj_name);
#endif

/**
 * @brief Initialize DrySpool, wait for cloud readiness, then periodically
 * sample product state and send it to nRF Cloud.
 */
void main_application_thread_fn(void);

void test_counter_enable_set(const bool enable);
bool test_counter_enable_get(void);

#endif /* _APPLICATION_H_ */
