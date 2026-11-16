import { input, json, route } from '../../../../lib/http.mjs';
import { requireSession } from '../../../../lib/session.mjs';
import { command } from '../../../../lib/cloud.mjs';
export const POST = route(async (req, context) => {
  requireSession(req);
  const { mode } = await input(req);
  const { slot } = await context.params;
  return json(await command(slot, mode), 202);
});
