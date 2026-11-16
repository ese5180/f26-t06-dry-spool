import { input, json, route } from '../../../lib/http.mjs';
import { logout } from '../../../lib/session.mjs';
export const POST = route(async req => {
  await input(req);
  return json({}, 200, { 'Set-Cookie': logout(req) });
});
