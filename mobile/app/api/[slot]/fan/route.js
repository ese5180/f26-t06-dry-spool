import { ApiError, apiInput, json, route } from '../../../../lib/http.mjs';
import { commandSerial } from '../../../../lib/cloud.mjs';
import { ownedDevices } from '../../../../lib/request-user.mjs';
export const POST = route(async (req, context) => {
  const store = await ownedDevices(req);
  const { mode } = await apiInput(req);
  const { slot } = await context.params;
  if (!slot.startsWith('id-')) throw new ApiError(404, 'Box not found.');
  const {serial} = await store.require(slot.slice(3));
  return json(await commandSerial(serial, mode), 202);
});
