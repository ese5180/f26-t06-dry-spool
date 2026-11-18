import { apiInput, json, route } from '../../../lib/http.mjs';
import { ownedDevices } from '../../../lib/request-user.mjs';

export const POST = route(async req => {
  const store = await ownedDevices(req);
  const {serial} = await apiInput(req);
  return json(await store.start(serial), 201);
});
