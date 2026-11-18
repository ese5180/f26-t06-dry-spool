import { requireUser, sessionClient } from '../../../lib/accounts.mjs';
import { ApiError, input, json, route } from '../../../lib/http.mjs';

export const dynamic = 'force-dynamic';

export const GET = route(async req => {
  const user = await requireUser(req);
  return json({email:user.email});
});

export const POST = route(async req => {
  const {action, email, password} = await input(req);
  const client = await sessionClient();
  if (action === 'out') {
    const {error} = await client.auth.signOut({scope:'local'});
    if (error) throw new ApiError(400, 'Could not sign out. Try again.');
    return json({signedIn:false});
  }
  if (!['in', 'up'].includes(action) || typeof email !== 'string' || typeof password !== 'string') {
    throw new ApiError(400, 'Enter an email and password.');
  }
  const credentials = {email:email.trim(), password};
  const {error, data} = action === 'up'
    ? await client.auth.signUp({ ...credentials, options: {
        emailRedirectTo: new URL('/auth/callback', process.env.DRYSPOOL_WEB_ORIGIN || req.url).href,
      } })
    : await client.auth.signInWithPassword(credentials);
  if (error) throw new ApiError(400, action === 'up'
    ? 'Could not create the account. Check the email and password and try again.'
    : 'Could not sign in. Check your email, password, and email confirmation.');
  return json({signedIn:Boolean(data.session)});
});
