import { json, route } from '../../../lib/http.mjs';
import { fleet } from '../../../lib/cloud.mjs';
export const dynamic = 'force-dynamic';
export const GET = route(async () => {
  const {rows, warning} = await fleet();
  return json(rows, 200, warning ? {'X-DrySpool-Discovery': warning} : {});
});
