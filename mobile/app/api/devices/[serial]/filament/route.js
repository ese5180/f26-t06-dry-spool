import { saveFilament } from '../../../../../lib/cloud.mjs';
import { apiInput, json, route } from '../../../../../lib/http.mjs';
import { ownedDevices } from '../../../../../lib/request-user.mjs';

export const PUT = route(async (req, {params}) => {
  const store = await ownedDevices(req);
  const {serial} = await params;
  await store.require(serial);
  const {profile} = await apiInput(req);
  return json({profile: await saveFilament(serial, profile)});
});
