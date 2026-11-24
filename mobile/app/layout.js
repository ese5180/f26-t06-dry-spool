import "./style.css";
export const metadata = {
  title: "DrySpool", description: "Temperature, humidity, filament weight and fan control.",
  icons: {icon: "/icon-carbon.png", apple: "/icon-carbon.png"},
};
export const viewport = {themeColor: "#171b1c", viewportFit: "cover"};
export default function Layout({children}) {
  return <html lang="en"><body>{children}</body></html>;
}
