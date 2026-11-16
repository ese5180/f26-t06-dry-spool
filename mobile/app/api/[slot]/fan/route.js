import { input, json, route } from '../../../../lib/http.mjs';
import { command } from '../../../../lib/cloud.mjs';
export const POST = route(async (req, context) => {
  const { mode } = await input(req);
  const { slot } = await context.params;
  return json(await command(slot, mode), 202);
});
