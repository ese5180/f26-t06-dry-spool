export default function manifest() {
  return {
    id: "/",
    name: "DrySpool 设备看板",
    short_name: "DrySpool",
    start_url: "/",
    scope: "/",
    display: "standalone",
    background_color: "#f5f3ed",
    theme_color: "#f5f3ed",
    lang: "zh-CN",
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any maskable" },
    ],
  };
}
