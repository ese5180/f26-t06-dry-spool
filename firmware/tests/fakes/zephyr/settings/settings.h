#pragma once
#include <sys/types.h>
int settings_subsys_init(void);
ssize_t settings_load_one(const char *key, void *buf, size_t n);
int settings_save_one(const char *key, const void *buf, size_t n);
