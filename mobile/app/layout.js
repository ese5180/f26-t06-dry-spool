import "./style.css";
import { Barlow_Semi_Condensed, Geist } from "next/font/google";

const geist = Geist({subsets:["latin"], variable:"--font-ui", display:"swap"});
const barlow = Barlow_Semi_Condensed({subsets:["latin"], weight:["500", "600", "700"], variable:"--font-heading", display:"swap"});

export const metadata = {
  title: "DrySpool · Device dashboard",
  description: "Monitor temperature, humidity and remaining filament in your filament boxes and control each fan.",
  applicationName: "DrySpool",
  appleWebApp: { capable: true, title: "DrySpool", statusBarStyle: "black-translucent" },
  icons: { icon: "/icon-carbon.png", apple: "/icon-carbon.png" },
};

export const viewport = { themeColor: "#171b1c", viewportFit: "cover" };

export default function Layout({ children }) {
  return <html lang="en-US" className={geist.variable + " " + barlow.variable}><body>{children}</body></html>;
}
