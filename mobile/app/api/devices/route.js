import { json, route } from '../../../lib/http.mjs';
import { ownedFleet } from '../../../lib/cloud.mjs';
import { ownedDevices } from '../../../lib/request-user.mjs';
export const dynamic = 'force-dynamic';
export const GET = route(async req => {
  const store = await ownedDevices(req);
  return json(await ownedFleet(await store.list()));
});
