import { sessionClient } from '../../../lib/accounts.mjs';

export async function GET(request) {
  const {searchParams} = new URL(request.url);
  const code = searchParams.get('code');
  const recovery = searchParams.get('next') === '/reset-password';
  if (code) {
    const client = await sessionClient();
    const {error} = await client.auth.exchangeCodeForSession(code);
    if (!error) return new Response(null, { status:303, headers:{ Location:recovery ? '/reset-password' : '/' } });
  }
  return new Response(null, { status:303, headers:{ Location:recovery ? '/reset-password?confirmation=failed' : '/?confirmation=failed' } });
}
