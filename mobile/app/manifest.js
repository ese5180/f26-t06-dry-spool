export default function manifest() {
  return {
    id: "/",
    name: "DrySpool Dashboard",
    short_name: "DrySpool",
    start_url: "/",
    scope: "/",
    display: "standalone",
    background_color: "#171b1c",
    theme_color: "#171b1c",
    lang: "en-US",
    icons: [
      { src: "/icon-carbon.png", sizes: "1254x1254", type: "image/png", purpose: "any maskable" },
    ],
  };
}
