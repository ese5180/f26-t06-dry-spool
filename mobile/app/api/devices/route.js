import { json, route } from '../../../lib/http.mjs';
import { requireSession } from '../../../lib/session.mjs';
import { devices } from '../../../lib/cloud.mjs';
export const dynamic = 'force-dynamic';
export const GET = route(async req => {
  requireSession(req);
  return json(await devices());
});
