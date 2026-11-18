import { createServerClient } from '@supabase/ssr';
import { createClient } from '@supabase/supabase-js';
import { cookies } from 'next/headers.js';
import { ApiError } from './http.mjs';

function publicConfig() {
  const { SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY } = process.env;
  if (!SUPABASE_URL || !SUPABASE_PUBLISHABLE_KEY) {
    throw new ApiError(503, 'DrySpool accounts are not configured.');
  }
  return [SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY];
}

export async function sessionClient() {
  const config = publicConfig();
  const jar = await cookies();
  return createServerClient(...config, {
    cookies: {
      getAll: () => jar.getAll(),
      setAll: entries => entries.forEach(({name, value, options}) =>
        jar.set(name, value, { ...options, httpOnly: true, sameSite: 'lax', secure: Boolean(process.env.VERCEL) })),
    },
  });
}

export async function requireUser(req) {
  const authorization = req.headers.get('authorization');
  const bearer = authorization?.match(/^Bearer ([^\s]+)$/i)?.[1];
  if (authorization && !bearer) throw new ApiError(401, 'Please sign in.');
  const client = bearer
    ? createClient(...publicConfig(), { auth: { persistSession: false, autoRefreshToken: false } })
    : await sessionClient();
  const {data, error} = await client.auth.getUser(bearer);
  if (error || !data?.user) throw new ApiError(401, 'Please sign in.');
  return data.user;
}

export function database() {
  const [url] = publicConfig();
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) throw new ApiError(503, 'DrySpool device storage is not configured.');
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}
