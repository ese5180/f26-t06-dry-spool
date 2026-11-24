import { json, route } from '../../../lib/http.mjs';
import { configuredDevices, readFleet } from '../../../lib/cloud.mjs';
export const dynamic = 'force-dynamic';
export const GET = route(async () => json(await readFleet(configuredDevices())));
