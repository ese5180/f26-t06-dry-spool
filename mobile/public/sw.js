// Never store device state, credentials, or fan commands. A navigation made
// offline explains the disconnect instead of displaying cached readings.
self.addEventListener("fetch", event => {
  if (event.request.method !== "GET" || event.request.mode !== "navigate" ||
      new URL(event.request.url).pathname !== "/") return;
  event.respondWith(fetch(event.request).catch(() => new Response(
    '<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>DrySpool · 离线</title><body style="font:18px system-ui;background:#f5f3ed;color:#263b32;margin:12vw"><h1>DrySpool</h1><p>手机网络已断开。联网后重新打开看板，即可查看读数和操作风扇。</p><a href="/">重新连接</a></body></html>',
    { status: 503, headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" } }
  )));
});
