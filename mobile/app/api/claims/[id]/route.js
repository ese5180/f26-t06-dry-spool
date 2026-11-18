import { apiInput, json, route } from '../../../../lib/http.mjs';
import { readShadow } from '../../../../lib/cloud.mjs';
import { ownedDevices } from '../../../../lib/request-user.mjs';

export const POST = route(async (req, {params}) => {
  const store = await ownedDevices(req);
  await apiInput(req);
  return json(await store.check((await params).id, readShadow));
});
