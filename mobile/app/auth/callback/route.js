import { sessionClient } from '../../../lib/accounts.mjs';

export async function GET(request) {
  const {searchParams} = new URL(request.url);
  const code = searchParams.get('code');
  if (code) {
    const client = await sessionClient();
    const {error} = await client.auth.exchangeCodeForSession(code);
    if (!error) return new Response(null, { status:303, headers:{ Location:'/' } });
  }
  return new Response(null, { status:303, headers:{ Location:'/?confirmation=failed' } });
}
