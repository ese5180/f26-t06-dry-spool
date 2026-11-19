// Never store device state, credentials, or fan commands. A navigation made
// offline explains the disconnect instead of displaying cached readings.
self.addEventListener("fetch", event => {
  if (event.request.method !== "GET" || event.request.mode !== "navigate" ||
      new URL(event.request.url).pathname !== "/") return;
  event.respondWith(fetch(event.request).catch(() => new Response(
    '<!doctype html><html lang="en-US"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="theme-color" content="#171b1c"><title>DrySpool · Offline</title><body style="font:18px system-ui;background:#171b1c;color:#f2f1ec;margin:12vw"><h1>DrySpool</h1><p>Your phone is offline. Reconnect and open the dashboard to view readings and control the fans.</p><a href="/" style="color:#ff823b">Reconnect</a></body></html>',
    { status: 503, headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" } }
  )));
});
