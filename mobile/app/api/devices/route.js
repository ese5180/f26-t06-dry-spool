import { json, route } from '../../../lib/http.mjs';
import { devices } from '../../../lib/cloud.mjs';
export const dynamic = 'force-dynamic';
export const GET = route(async () => {
  return json(await devices());
});
