/*
 * DrySpool power status for Memfault (requirement 3.11 - metric 4.1).
 *
 * The nRF7002 DK has no battery: it is always powered over USB. Memfault's
 * built-in battery metrics (battery_soc_pct, battery_discharge_duration_ms,
 * battery_soc_pct_drop) call this function every heartbeat, so we report
 * "100 % and not discharging" = USB/mains powered.
 *
 * PLACEHOLDER: when the DrySpool PCB gets a battery + fuel gauge, read the
 * real state of charge here instead of the constant below.
 */
#include <stdbool.h>
#include <memfault/metrics/platform/battery.h>

int memfault_platform_get_stateofcharge(sMfltPlatformBatterySoc *soc)
{
	/* 100 % in Memfault's scaled units (CONFIG_MEMFAULT_METRICS_BATTERY_SOC_PCT_SCALE_VALUE) */
	soc->soc = 100 * CONFIG_MEMFAULT_METRICS_BATTERY_SOC_PCT_SCALE_VALUE;
	soc->discharging = false; /* USB powered -> never discharging */
	return 0;
}
