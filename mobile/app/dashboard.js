"use client";

import { useEffect, useState } from "react";
import { storageGuidance, storageSource } from "../lib/storage.mjs";
import { api } from "./client-api";

const MODES = { on: "On", off: "Off", auto: "Auto" };
const OTA_PHASES = {
  checking: "Checking for updates", transferring: "Downloading firmware", restarting: "Restarting",
  idle: "Idle", failed: "Update failed",
};
const projectUrl = "https://app.memfault.com/organizations/zicong-zhang/projects/default-project";
const releasesUrl = process.env.NEXT_PUBLIC_NRF_CLOUD_RELEASES_URL || projectUrl + "/releases";
const metricsUrl = process.env.NEXT_PUBLIC_NRF_CLOUD_METRICS_URL || projectUrl + "/dashboards/memfault-metrics";
const controlAge = 45_000;

function boxStatus(data, now, cloudError) {
  if (cloudError || data.error) return "Connection unavailable";
  if (!data.ts) return "Waiting for first reading";
  return data.online && now - data.ts < controlAge ? "Online" : "Offline";
}

function Metric({ name, value, unit, large = false }) {
  return <div className={large ? "metric major" : "metric"}>
    <dt>{name}</dt>
    <dd>{Number.isFinite(value) ? value.toLocaleString("en-US", {
      maximumFractionDigits: large ? 0 : 1,
    }) : <small>No reading</small>} {Number.isFinite(value) && <small>{unit}</small>}</dd>
  </div>;
}

function Box({ data, networkError, now, reload, openSettings }) {
  const {slot, serial, label} = data;
  const [sending, setSending] = useState(false);
  const [command, setCommand] = useState(null);
  const [error, setError] = useState("");
  const timestamp = data?.ts;
  const age = now - timestamp;
  const fresh = Number.isFinite(timestamp) && timestamp > 0 && age >= -10_000 && age < controlAge;
  const connected = !networkError && !data?.error && data?.online !== false && fresh;
  const ack = command && data?.request === command.id && data?.mode === command.mode && data?.control;
  const waiting = command && !ack && now - command.sent < 30_000;
  const blocked = !connected || !data?.control || sending || waiting || data?.pending;
  const state = boxStatus(data, now, networkError);
  const output = data?.fan === true ? "On" : data?.fan === false ? "Off" : "Unknown";
  const firmware = typeof data?.firmware === "string" ? data.firmware.trim() : "";
  const spool = connected ? data?.spool : null;
  const guidance = storageGuidance(spool?.material, connected ? data?.humidity : null);
  const ota = Object.hasOwn(OTA_PHASES, data?.ota) ? OTA_PHASES[data.ota] : "";
  const feedback = error || (sending ? "Sending…" : ack ? "Box confirmed · " + MODES[command.mode] :
    waiting || data?.pending ? "Command sent. Waiting for the box to confirm." : command ? "No confirmation from the box yet." :
    data?.error || (connected && !data.control ? "This box is reporting readings only." : ""));
  async function control(mode) {
    setSending(true);
    setCommand(null);
    setError("");
    try {
      const {payload: result} = await api("/api/" + encodeURIComponent(slot) + "/fan", { mode });
      if (!result.request) throw new Error("The cloud did not return a command ID.");
      setCommand({ id: result.request, mode, sent: Date.now() });
    } catch (e) {
      setError(e.message);
    } finally {
      setSending(false);
      reload();
    }
  }

  return <article className="box">
    <div className="boxheading">
      <h2>{label}</h2>
      <div className="box-status-actions">
        <span className={"state" + (connected ? " active" : "")}><i />{state}</span>
        <button type="button" className="textbutton" onClick={openSettings}>Settings</button>
      </div>
    </div>
    {label !== "Box " + serial && <p className="serial">{serial}</p>}
    <p className="last-report">{timestamp > 0 ? <>Last report <time dateTime={new Date(timestamp).toISOString()}>
      {new Date(timestamp).toLocaleString()}</time></> : "No reports yet"}</p>
    {!connected && timestamp > 0 && <p className="stale-note">Last recorded readings</p>}
    <dl className={"readings" + (!connected ? " stale" : "")}>
      <Metric large name="Relative humidity" value={data?.humidity} unit="%" />
      <Metric name="Temperature" value={data?.temperature} unit="°C" />
      <Metric name="Filament remaining" value={data?.grams} unit="g" />
    </dl>
    <section className="spool-panel" aria-label="Filament information">
      <div className="section-title"><h3>Filament</h3><span>{spool?.source === "openprinttag" ? "OpenPrintTag" : spool ? "Manual profile" : "No tag data"}</span></div>
      {spool ? <>
        <p className="material-name">{spool.brand ? spool.brand + " · " : ""}{spool.material || "Material unknown"}{spool.color ? " · " + spool.color : ""}</p>
        {guidance ? <div className={"storage-advice" + (guidance.above ? " alert" : "")}>
          <strong>Storage guide: below {guidance.max}% RH</strong>
          <span>{guidance.above === null ? "Humidity unavailable." : guidance.above ? "Above the recommended limit." : "Within the recommended limit."} {guidance.note || ""}</span>
        </div> : <p className="supporting">No verified storage limit for this material yet.</p>}
      </> : <p className="supporting">Material and color will appear here after a supported tag is read. NFC scanning is not available on this prototype.</p>}
      <p className="source-note">Humidity guidance is for storage, not drying. <a href={storageSource} target="_blank" rel="noopener noreferrer">Prusa guidance ↗</a> Temperature is monitored; this box has no heater or temperature control.</p>
    </section>
    <div className="controls">
      <div className="controlheading"><h3>Fan mode</h3><span>Fan output · {connected ? output : "Unknown"}</span></div>
      <div className="segments" role="group" aria-label={label + " fan controls"}>
        {Object.entries(MODES).map(([mode, name]) =>
          <button key={mode} type="button" disabled={!!blocked}
            aria-pressed={data?.mode === mode} onClick={() => control(mode)}>{name}</button>)}
      </div>
      {feedback && <p role="status" className="feedback">{feedback}</p>}
    </div>
    {(firmware || ota) && <dl className="firmware" aria-label={label + " firmware"}>
      {firmware && <div><dt>Firmware version</dt><dd>{firmware}</dd></div>}
      {ota && <div><dt>Update status</dt><dd>{ota}</dd></div>}
    </dl>}
  </article>;
}

function Install() {
  const [prompt, setPrompt] = useState(null);
  const [showHelp, setShowHelp] = useState(false);
  const [installed, setInstalled] = useState(false);
  useEffect(() => {
    function ready(event) { event.preventDefault(); setPrompt(event); }
    function done() { setInstalled(true); setPrompt(null); setShowHelp(false); }
    setInstalled(matchMedia("(display-mode: standalone)").matches || navigator.standalone === true);
    addEventListener("beforeinstallprompt", ready);
    addEventListener("appinstalled", done);
    if ("serviceWorker" in navigator) navigator.serviceWorker.register("/sw.js").catch(() => {});
    return () => {
      removeEventListener("beforeinstallprompt", ready);
      removeEventListener("appinstalled", done);
    };
  }, []);
  if (installed) return null;
  return <div className="install"><button type="button" className="textbutton"
    aria-expanded={showHelp} onClick={async () => {
      if (!prompt) { setShowHelp(!showHelp); return; }
      try { await prompt.prompt(); await prompt.userChoice; } finally { setPrompt(null); }
    }}>Add to Home Screen</button>
    {showHelp && <p role="status" className="installhelp">On iPhone, tap Share in Safari, then Add to Home Screen. On Android, open the browser menu and choose Install app or Add to Home screen.</p>}
  </div>;
}

const setupUrl = process.env.NEXT_PUBLIC_DRYSPOOL_SETUP_URL || "dryspool://setup";

function AddBox({onClose}) {
  return <section className="empty-state">
    <h2>Add a box</h2>
    <p>On your phone, open DrySpool Setup and sign in with this account. Follow the instructions near the powered box.</p>
    <div className="actions">
      <a className="primary-action" href={setupUrl}>Open Setup app</a>
      <button className="textbutton" onClick={onClose}>Back to boxes</button>
    </div>
  </section>;
}

function DeviceSettings({box, reload}) {
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);
  async function rename(event) {
    event.preventDefault();
    const label = new FormData(event.currentTarget).get("label");
    setBusy(true);
    setError("");
    setSaved(false);
    try {
      await api("/api/devices/" + encodeURIComponent(box.serial), {label}, undefined, "PATCH");
      setSaved(true);
      reload();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }
  return <section className="box settings-panel">
    <h2>{box.label}</h2>
    <p className="serial">{box.serial}</p>
    <form className="stack" onSubmit={rename}>
      <label>Box name<input name="label" defaultValue={box.label} maxLength={64} required /></label>
      <button className="primary-action" disabled={busy}>Save name</button>
    </form>
    {saved && <p role="status">Name saved.</p>}
    {error && <p role="alert">{error}</p>}
    <div className="settings-section">
      <h3>Change Wi-Fi</h3>
      <p>Open DrySpool Setup on your phone near this box. Its account stays the same.</p>
      <a href={setupUrl}>Open Setup app ↗</a>
    </div>
  </section>;
}

export default function Dashboard({account,signOut,onExpired}) {
  const [devices, setDevices] = useState(null);
  const [selectedSlot, setSelectedSlot] = useState(null);
  const [tab, setTab] = useState("monitor");
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState(false);
  const [accountError, setAccountError] = useState("");
  const [error, setError] = useState("");
  const [now, setNow] = useState(0);
  const [refresh, setRefresh] = useState(0);
  const reload = () => setRefresh(t => t + 1);
  useEffect(() => {
    let active = true;
    let timer;
    let request;
    let generation = 0;
    async function poll() {
      if (document.hidden || !active) return;
      const run = ++generation;
      request = new AbortController();
      const timeout = setTimeout(() => request.abort(), 18_000);
      try {
        const {payload: value} = await api("/api/devices", undefined, request.signal);
        if (!active || generation !== run) return;
        if (!Array.isArray(value)) throw new Error("Unexpected device data format.");
        setDevices(value); setError("");
      } catch (e) {
        if (!active || generation !== run) return;
        if (e.status === 401) {
          onExpired();
          return;
        }
        setError(e.status ? e.message : "Lost connection to the cloud.");
      } finally {
        clearTimeout(timeout);
        if (active && generation === run && !document.hidden) {
          setNow(Date.now());
          timer = setTimeout(poll, 5000);
        }
      }
    }
    function visibilityChanged() {
      generation++;
      clearTimeout(timer);
      request?.abort();
      if (!document.hidden) { setNow(Date.now()); poll(); }
    }
    document.addEventListener("visibilitychange", visibilityChanged);
    poll();
    return () => {
      active = false;
      clearTimeout(timer);
      request?.abort();
      document.removeEventListener("visibilitychange", visibilityChanged);
    };
  }, [refresh]);
  // Revoke controls locally when a cloud request takes longer than its freshness window.
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 2000);
    return () => clearInterval(timer);
  }, []);
  const selected = devices?.find(d => d.slot === selectedSlot) || (devices?.length === 1 ? devices[0] : null);
  const onlineCount = devices?.filter(d => boxStatus(d, now, error) === "Online").length || 0;
  function navigate(page) {
    setTab(page);
    setAdding(false);
    setEditing(false);
    setSelectedSlot(null);
  }
  function select(box, options = {}) {
    setSelectedSlot(box.slot);
    setEditing(!!options.edit);
    setAdding(false);
    setTab(options.edit ? "devices" : "monitor");
  }
  function add() {
    navigate("devices");
    setAdding(true);
  }
  return <main>
    <header className="brandbar">
      <div className="brand"><img alt="" width="36" height="36" src="/icon-192.png" />DrySpool</div>
      <Install />
    </header>
    <nav className="section-nav" aria-label="Dashboard">
      {[["monitor","Monitor"],["devices","Devices"],["settings","Settings"]].map(([id,label]) =>
        <button key={id} aria-current={tab === id ? "page" : undefined} onClick={() => navigate(id)}>{label}</button>)}
    </nav>
    <div className="titlebar">
      <div><h1>{tab === "monitor" ? "Filament storage" : tab === "devices" ? "Your boxes" : "Settings"}</h1>
        {tab !== "settings" && devices && <p className="subtitle">{devices.length} {devices.length === 1 ? "box" : "boxes"} · {error ? "status unavailable" : onlineCount + " online"}</p>}
      </div>
      {tab !== "settings" && !adding && <button className="primary-action" onClick={add}>+ Add device</button>}
    </div>
    {error && <div className="notice" role="alert">{error}<button onClick={reload}>Retry</button></div>}
    {tab !== "settings" && !devices && !error && !adding && <p role="status">Loading your boxes…</p>}
    {tab !== "settings" && devices?.length === 0 && !error && !adding && <section className="empty-state">
      <h2>No boxes yet</h2><p>Add a box to see its readings here.</p>
    </section>}
    {adding && <AddBox onClose={() => setAdding(false)} />}
    {tab === "monitor" && selected && <>
      {devices.length > 1 && <button className="textbutton back" onClick={() => setSelectedSlot(null)}>← All boxes</button>}
      <Box key={selected.serial} data={selected} networkError={!!error} now={now} reload={reload}
        openSettings={() => select(selected,{edit:true})} />
    </>}
    {tab === "monitor" && !selected && devices?.length > 0 && <section className="overview" aria-label="Boxes">
      {devices.map(box => {
        const state = boxStatus(box, now, error);
        const live = state === "Online";
        const guidance = live && storageGuidance(box.spool?.material, box.humidity);
        return <button type="button" key={box.serial} className="summary-card box" onClick={() => select(box)}>
          <strong>{box.label}</strong><span className={"state" + (live ? " active" : "")}><i />{state}</span>
          <span className="summary-reading">{Number.isFinite(box.humidity) ? `${box.humidity.toFixed(1)}% RH` : "No humidity reading"}</span>
          {guidance?.above && <span className="summary-alert">Above recommended humidity</span>}
          {!live && Number.isFinite(box.humidity) && <small>Last recorded</small>}
        </button>;
      })}
    </section>}
    {tab === "devices" && editing && selected && <>
      <button className="textbutton back" onClick={() => setEditing(false)}>← Your boxes</button>
      <DeviceSettings key={selected.serial} box={selected} reload={reload} />
    </>}
    {tab === "devices" && !adding && !editing && devices?.length > 0 && <ul className="managed-boxes box">
      {devices.map(box => <li key={box.serial}>
        <div><strong>{box.label}</strong><small>{boxStatus(box, now, error)}</small></div>
        <button className="textbutton" onClick={() => select(box,{edit:true})} aria-label={`Settings for ${box.label}`}>Settings</button>
      </li>)}
    </ul>}
    {tab === "settings" && <section className="box settings-panel">
      <h2>Account</h2><p>{account.email}</p>
      <button className="primary-action" onClick={async () => {
        setAccountError("");
        try { await signOut(); } catch (err) { setAccountError(err.message); }
      }}>Sign out</button>
      {accountError && <p role="alert">{accountError}</p>}
      <nav className="cloudlinks settings-section" aria-label="Team cloud tools">
        <a href={metricsUrl} target="_blank" rel="noopener noreferrer">Metrics history ↗</a>
        <a href={releasesUrl} target="_blank" rel="noopener noreferrer">Firmware releases ↗</a>
      </nav>
    </section>}
  </main>;
}
