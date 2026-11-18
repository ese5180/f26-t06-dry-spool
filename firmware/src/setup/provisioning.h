#ifndef DRYSPOOL_PROVISIONING_H
#define DRYSPOOL_PROVISIONING_H

#include <stdbool.h>
#include <zephyr/kernel.h>

#define DRYSPOOL_PROOF_SIZE 65

#if defined(CONFIG_DRYSPOOL_BLE_SETUP)
int dryspool_setup_init(void);
bool dryspool_setup_proof(char proof[DRYSPOOL_PROOF_SIZE]);
void dryspool_setup_reported(const char proof[DRYSPOOL_PROOF_SIZE]);
bool dryspool_setup_active(void);
#endif

#endif
