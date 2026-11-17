#include <assert.h>
#include "control/fan.h"

int main(void)
{
	/* The same humidity inside the band must keep either prior state. */
	assert(!fan_requested_on(false, true, 35000, 30, 40));
	assert(fan_requested_on(true, true, 35000, 30, 40));
	assert(!fan_requested_on(false, true, 39999, 30, 40));
	assert(fan_requested_on(false, true, 40000, 30, 40));
	assert(fan_requested_on(true, true, 30001, 30, 40));
	assert(!fan_requested_on(true, true, 30000, 30, 40));
	assert(!fan_requested_on(true, false, 99000, 30, 40));
	assert(fan_mode_output(FAN_ON, false, true, 10000, 30, 40));
	assert(!fan_mode_output(FAN_OFF, true, true, 80000, 30, 40));
	assert(fan_mode_output(FAN_AUTO, false, true, 80000, 30, 40));
	assert(!fan_mode_output(FAN_AUTO, true, true, 10000, 30, 40));
	return 0;
}
