import { ownedCard } from '../../../../lib/cloud.mjs';
import { apiInput, json, route } from '../../../../lib/http.mjs';
import { ownedDevices } from '../../../../lib/request-user.mjs';

export const GET = route(async (req, {params}) => {
  const store = await ownedDevices(req);
  return json(await ownedCard(await store.require((await params).serial)));
});

export const PATCH = route(async (req, {params}) => {
  const store = await ownedDevices(req);
  const {label} = await apiInput(req);
  return json(await store.rename((await params).serial, label));
});
