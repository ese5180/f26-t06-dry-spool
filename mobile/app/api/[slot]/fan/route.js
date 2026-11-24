import { input, json, route } from '../../../../lib/http.mjs';
import { configuredSerial, commandSerial } from '../../../../lib/cloud.mjs';
export const POST = route(async (req, {params}) => {
  const {mode} = await input(req);
  const serial = configuredSerial((await params).slot);
  return json(await commandSerial(serial, mode), 202);
});
