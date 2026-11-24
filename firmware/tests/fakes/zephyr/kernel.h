#pragma once
#include <assert.h>
#include <stdbool.h>
#include <stdint.h>
#define BIT(n) (1U << (n))
#define BUILD_ASSERT(cond, msg) _Static_assert(cond, msg)
#define K_FOREVER -1
#define K_MUTEX_DEFINE(name) int name
struct k_spinlock { int unused; };
typedef int k_spinlock_key_t;
static inline int k_mutex_lock(int *m, int timeout) { (void)timeout; assert(!*m); *m = 1; return 0; }
static inline void k_mutex_unlock(int *m) { assert(*m); *m = 0; }
static inline k_spinlock_key_t k_spin_lock(struct k_spinlock *s) { (void)s; return 0; }
static inline void k_spin_unlock(struct k_spinlock *s, k_spinlock_key_t k) { (void)s; (void)k; }
int64_t k_uptime_get(void);
void k_msleep(int ms);
