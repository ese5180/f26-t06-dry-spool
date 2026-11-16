#pragma once
#include <stdint.h>
#include <stddef.h>
int gateway_snapshot(int slot, char *out, size_t size);
int gateway_command(int slot, const char *mode, uint32_t *id);
int gateway_cloud_command(int slot, const char *mode, uint32_t id, int64_t remaining_ms);
int gateway_http_start(void);
