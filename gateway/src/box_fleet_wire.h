#pragma once

#include "protocol.h"

#define DS_FLEET_INFO  DS_UUID(2)
#define DS_FLEET_CHUNK DS_UUID(3)
#define DS_FLEET_SVC   DS_UUID(4)
#define DS_CHUNK_MAX   192

/* Fixed length fields include their terminators. A long ATT read retrieves
 * the full record even when the peer uses the minimum MTU. */
struct box_fleet_info {
	char serial[33];
	char hardware[24];
	char software[24];
	char version[32];
	uint8_t confirmed;
};
