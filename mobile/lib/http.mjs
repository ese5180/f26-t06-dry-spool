export class ApiError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

export function json(data, status = 200, headers = {}) {
  return Response.json(data, { status, headers: { 'Cache-Control': 'private, no-store', ...headers } });
}

export function route(fn) {
  return async (...args) => {
    try {
      return await fn(...args);
    } catch (error) {
      if (error instanceof ApiError) return json({ error: error.message }, error.status);
      return json({ error: 'The server is temporarily unavailable.' }, 500);
    }
  };
}

export async function input(req) {
  return readInput(req, false);
}

export async function apiInput(req) {
  return readInput(req, true);
}

async function readInput(req, allowBearer) {
  // Next may construct req.url with the internal listener's hostname.
  // Browsers send the public authority in Host and cannot override Host in fetch.
  const origin = req.headers.get('origin');
  const scheme = process.env.VERCEL ? 'https:' : new URL(req.url).protocol;
  const host = req.headers.get('host') || new URL(req.url).host;
  const native = allowBearer && !origin && /^Bearer [^\s]+$/i.test(req.headers.get('authorization') || '');
  if (!native && origin !== scheme + '//' + host) {
    throw new ApiError(403, 'Invalid request origin.');
  }
  if (req.headers.get('content-type')?.split(';')[0].trim() !== 'application/json') {
    throw new ApiError(415, 'Expected a JSON request.');
  }
  const reader = req.body?.getReader();
  if (!reader) throw new ApiError(400, 'The request body is missing.');
  const parts = [];
  let bytes = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    bytes += value.length;
    if (bytes > 1024) {
      await reader.cancel();
      throw new ApiError(413, 'The request body is too large.');
    }
    parts.push(value);
  }
  try {
    const parsed = JSON.parse(Buffer.concat(parts).toString('utf8'));
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw Error();
    return parsed;
  } catch {
    throw new ApiError(400, 'Expected a JSON object.');
  }
}
