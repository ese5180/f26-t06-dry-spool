export async function api(path, body, signal, method = body === undefined ? "GET" : "POST") {
  const response = await fetch(path, {
    method,
    headers: body === undefined ? {} : {"Content-Type":"application/json"},
    body: body === undefined ? undefined : JSON.stringify(body),
    credentials: "same-origin",
    cache: "no-store",
    signal: signal || AbortSignal.timeout(18_000),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(typeof payload.error === "string" ? payload.error : "Could not connect. Try again.");
    error.status = response.status;
    throw error;
  }
  return {payload};
}
