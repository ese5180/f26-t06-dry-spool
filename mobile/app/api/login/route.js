import { input, json, route } from '../../../lib/http.mjs';
import { login } from '../../../lib/session.mjs';
export const POST = route(async req => {
  const { password } = await input(req);
  return json({}, 200, { 'Set-Cookie': login(req, password) });
});
