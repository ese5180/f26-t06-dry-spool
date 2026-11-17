/* Host regression: the cloud must distinguish a measured zero from "unknown",
 * and must not replay a stale weight after a long disconnection. */
#include <assert.h>
#include <string.h>
#include "cloud/telemetry.h"

int main(void)
{
	struct dryspool_sample s = {
		.uptime_ms = 5000,
		.temperature_mc = -1250,
		.humidity_mpct = 41250,
		.raw_counts = -7654321,
		.filament_g = 0,
		.fan_on = true,
	};
	struct dryspool_channel ch[DRYSPOOL_CHANNEL_COUNT];

	/* A missing scale does not suppress a valid environmental measurement. */
	s.env_valid = true;
	assert(dryspool_telemetry_channels(&s, 5050, ch) == 2);
	assert(strcmp(ch[0].app_id, "DRYSPOOL_TEMPERATURE_C") == 0 && ch[0].value == -1.25);
	assert(strcmp(ch[1].app_id, "DRYSPOOL_HUMIDITY_PCT") == 0 && ch[1].value == 41.25);

	/* An uncalibrated scale reports counts even when the BME is absent. */
	s.env_valid = false;
	s.raw_valid = true;
	assert(dryspool_telemetry_channels(&s, 5100, ch) == 1);
	assert(strcmp(ch[0].app_id, "DRYSPOOL_LOAD_CELL_COUNTS") == 0 && ch[0].value == -7654321);

	/* A calibrated empty spool and an enabled fan really are data. */
	s.grams_valid = s.fan_valid = s.env_valid = true;
	assert(dryspool_telemetry_channels(&s, 5200, ch) == 5);
	assert(strcmp(ch[3].app_id, "DRYSPOOL_FILAMENT_G") == 0 && ch[3].value == 0);
	assert(strcmp(ch[4].app_id, "DRYSPOOL_DEHUMIDIFIER_ON") == 0 && ch[4].value == 1);
	assert(dryspool_telemetry_channels(&s, 4999, ch) == 0);
	assert(dryspool_telemetry_channels(&s, 600000, ch) == 0);

	/* After reconnect, a new sample replaces the pre-outage weight. */
	s.uptime_ms = 600001;
	s.filament_g = 350;
	assert(dryspool_telemetry_channels(&s, 600002, ch) == 5 && ch[3].value == 350);
	return 0;
}
