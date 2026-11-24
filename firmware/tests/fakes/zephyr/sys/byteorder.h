#pragma once
#include <stdint.h>
static inline uint32_t sys_get_be24(const uint8_t *p) { return ((uint32_t)p[0]<<16) | ((uint32_t)p[1]<<8) | p[2]; }
