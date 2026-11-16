import { json, route } from '../../../lib/http.mjs';
import { requireSession } from '../../../lib/session.mjs';
import { devices, state } from '../../../lib/cloud.mjs';
export const dynamic = 'force-dynamic';
export const GET = route(async req => {
  requireSession(req);
  return json(devices(await state()));
});
