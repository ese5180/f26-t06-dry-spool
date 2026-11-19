import { requireUser, sessionClient } from '../../../lib/accounts.mjs';
import { ApiError, input, json, route } from '../../../lib/http.mjs';

export const dynamic = 'force-dynamic';

export const GET = route(async req => {
  const user = await requireUser(req);
  return json({email:user.email});
});

export const POST = route(async req => {
  const {action, email, password} = await input(req);
  if (!['in', 'up', 'out', 'resend', 'recover', 'password'].includes(action)) {
    throw new ApiError(400, 'Choose an account action.');
  }
  const client = await sessionClient();
  if (action === 'out') {
    const {error} = await client.auth.signOut({scope:'local'});
    if (error) throw new ApiError(400, 'Could not sign out. Try again.');
    return json({signedIn:false});
  }
  if (action === 'password') {
    const {data: session, error: expired} = await client.auth.getUser();
    if (expired || !session?.user) throw new ApiError(401, 'Open your password reset email again or request a new link.');
    if (typeof password !== 'string' || password.length < 8) {
      throw new ApiError(400, 'Use at least 8 characters for your new password.');
    }
    const {error} = await client.auth.updateUser({password});
    if (error) throw new ApiError(400, error.code === 'same_password'
      ? 'Choose a password different from your previous one.' : 'Could not save your new password. Request a new link and try again.');
    return json({updated:true});
  }
  if (typeof email !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
    throw new ApiError(400, 'Enter a valid email address.');
  }
  const callback = new URL('/auth/callback', process.env.DRYSPOOL_WEB_ORIGIN || req.url);
  if (['resend', 'recover'].includes(action)) {
    if (action === 'recover') callback.searchParams.set('next', '/reset-password');
    const {error} = action === 'recover'
      ? await client.auth.resetPasswordForEmail(email.trim(), {redirectTo:callback.href})
      : await client.auth.resend({type:'signup', email:email.trim(), options:{emailRedirectTo:callback.href}});
    if (error) throw new ApiError(error.status === 429 ? 429 : 503, error.status === 429
      ? 'Please wait a minute before requesting another email.'
      : 'We could not send the email. Try again shortly.');
    return json({sent:true});
  }
  if (typeof password !== 'string' || !password) {
    throw new ApiError(400, 'Enter an email and password.');
  }
  if (action === 'up' && password.length < 8) throw new ApiError(400, 'Use at least 8 characters for your password.');
  const credentials = {email:email.trim(), password};
  const {error, data} = action === 'up'
    ? await client.auth.signUp({ ...credentials, options: {
      emailRedirectTo: callback.href,
      } })
    : await client.auth.signInWithPassword(credentials);
  if (error) throw new ApiError(400, action === 'up'
    ? 'Could not create the account. Check the email and password and try again.'
    : 'Could not sign in. Check your email, password, and email confirmation.');
  return json({signedIn:Boolean(data.session)});
});
