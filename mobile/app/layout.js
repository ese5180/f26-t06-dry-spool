import "./style.css";

export const metadata = {
  title: "DrySpool · Device dashboard",
  description: "Monitor temperature, humidity and remaining filament in your filament boxes and control each fan.",
  applicationName: "DrySpool",
  appleWebApp: { capable: true, title: "DrySpool", statusBarStyle: "default" },
  icons: { icon: "/icon-192.png", apple: "/icon-180.png" },
};

export const viewport = { themeColor: "#f5f3ed", viewportFit: "cover" };

export default function Layout({ children }) {
  return <html lang="en-US"><body>{children}</body></html>;
}
