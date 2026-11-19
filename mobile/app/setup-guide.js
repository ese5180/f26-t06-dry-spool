"use client";

import { useEffect, useState } from "react";

const setupUrl = process.env.NEXT_PUBLIC_DRYSPOOL_SETUP_URL || "dryspool://setup";
const iosInstallUrl = process.env.NEXT_PUBLIC_DRYSPOOL_IOS_SETUP_URL;
const androidInstallUrl = process.env.NEXT_PUBLIC_DRYSPOOL_ANDROID_SETUP_URL;

export default function SetupGuide({ email, changingWifi = false, onClose }) {
  const [platform, setPlatform] = useState("unknown");
  const [installed, setInstalled] = useState(false);

  useEffect(() => {
    const agent = navigator.userAgent;
    if (/iPhone|iPad|iPod/i.test(agent) || navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1) {
      setPlatform("ios");
    } else if (/Android/i.test(agent)) {
      setPlatform("android");
    }
  }, []);

  const available = [
    { platform: "ios", label: "Get the iPhone app", url: iosInstallUrl },
    { platform: "android", label: "Get the Android app", url: androidInstallUrl },
  ].filter(option => (platform === "unknown" || platform === option.platform) && option.url?.startsWith("https://"));

  return <section className="box setup-guide" aria-labelledby="setup-heading">
    <h2 id="setup-heading">{changingWifi ? "Change your box’s Wi-Fi" : "Add your box"}</h2>
    <p className="supporting">Use your phone near the powered box. Your boxes and readings will appear here after setup.</p>
    <ol className="setup-steps">
      <li>
        <h3>Open DrySpool Setup on your phone</h3>
        <p>Sign in with your DrySpool account{email && <>, <strong>{email}</strong></>}. Your app and dashboard use the same account.</p>
        {available.length > 0
          ? <div className="actions">{available.map(option => <a key={option.platform} className="primary-action" href={option.url} target="_blank" rel="noopener noreferrer">{option.label}</a>)}</div>
          : <p className="setup-availability" role="status">The {platform === "ios" ? "iPhone" : platform === "android" ? "Android" : "phone"} app is still in testing. An installation link will appear here when it is available.</p>}
        <label className="setup-installed"><input type="checkbox" checked={installed} onChange={event => setInstalled(event.target.checked)} />I already have DrySpool Setup installed</label>
        {installed && <div className="actions"><a className="primary-action" href={setupUrl}>Open DrySpool Setup</a><p className="supporting">If the app does not open, launch it from your phone’s home screen.</p></div>}
      </li>
      <li>
        <h3>{changingWifi ? "Select your box, then Change Wi-Fi" : "Tap Add device and select your box"}</h3>
        <p>Turn on Bluetooth. Press the box’s Setup button to make it discoverable, then press it again when the app asks you to confirm.</p>
      </li>
      <li>
        <h3>Choose Wi-Fi and connect</h3>
        <p>Pick your home network, enter its password, and wait for the app to confirm. {changingWifi ? "Your box stays linked to this account." : "The box will be linked to your account automatically."}</p>
      </li>
    </ol>
    <p className="supporting">Return here after setup. Keep the box powered while it sends its first reading.</p>
    <button type="button" className="primary-action" onClick={onClose}>Check my boxes</button>
  </section>;
}
