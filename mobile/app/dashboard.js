"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import { storageGuidance } from "../lib/storage.mjs";
import { api } from "./client-api";
import SetupGuide from "./setup-guide";
import { Brand, Icon } from "./ui";
import FilamentPanel from "./filament-panel";

const MODES = { auto: "Auto", on: "On", off: "Off" };
const OTA_PHASES = {
  checking: "Checking for updates", transferring: "Downloading firmware", restarting: "Restarting",
  idle: "Idle", failed: "Update failed",
};
const releasesUrl = process.env.NEXT_PUBLIC_NRF_CLOUD_RELEASES_URL;
const metricsUrl = process.env.NEXT_PUBLIC_NRF_CLOUD_METRICS_URL;
const controlAge = 45_000;
const demoPreviewEnabled = process.env.NODE_ENV === "development" ||
  process.env.NEXT_PUBLIC_DRYSPOOL_DEMO_PREVIEW === "1";
const virtualBox = {
  slot: "local:virtual-preview",
  serial: "local:virtual-preview",
  label: "Virtual Demo Box",
  preview: true,
  online: true,
  humidity: 18.4,
  temperature: 24.2,
  grams: 420,
  control: false,
};

function boxStatus(data, now, cloudError) {
  if (cloudError || data.error) return "Connection unavailable";
  if (!data.ts) return "Waiting for first reading";
  return data.online && now - data.ts < controlAge ? "Online" : "Offline";
}

function ReadingValue({ value, unit, maximumFractionDigits = 1 }) {
  return Number.isFinite(value)
    ? <>{value.toLocaleString("en-US", { maximumFractionDigits })} <small>{unit}</small></>
    : <span className="missing-reading">No reading</span>;
}

function Metric({ name, icon, ...reading }) {
  return <div className="metric">
    <dt><Icon name={icon} /><span>{name}</span></dt>
    <dd><ReadingValue {...reading} /></dd>
  </div>;
}

function SummaryMetric({ name, value, unit }) {
  return <span className="summary-metric">
    <span className="summary-label">{name}</span>
    <span className="summary-value"><ReadingValue value={value} unit={unit} /></span>
  </span>;
}

function Box({ data, networkError, now, reload, openSettings }) {
  const {slot, label} = data;
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

  return <article className="device-detail">
    <div className="boxheading">
      <h1>{label}</h1>
      <div className="box-status-actions">
        {openSettings && <button type="button" className="iconbutton" aria-label={"Settings for " + label} onClick={openSettings}><Icon name="settings" /></button>}
      </div>
    </div>
    <div className="device-status"><span className={"state" + (connected ? " active" : "")}><i />{state}</span>
    <p className="last-report">{data.preview ? "Simulated readings" : timestamp > 0 ? <>Last report <time dateTime={new Date(timestamp).toISOString()}>
      {new Date(timestamp).toLocaleString()}</time></> : "No reports yet"}</p>
    </div>
    {!connected && timestamp > 0 && <p className="stale-note">Last recorded readings</p>}
    <div className="device-overview">
      <figure className="product-view"><Image src="/dryspool-carbon.png" width={1268} height={1240} sizes="(max-width: 900px) 260px, 370px" alt="" loading="eager" fetchPriority="high" /><figcaption>Product illustration</figcaption></figure>
      <dl className={"readings" + (!connected ? " stale" : "")}>
        <Metric name="Humidity" icon="humidity" value={data?.humidity} unit="% RH" />
        <Metric name="Temperature" icon="temperature" value={data?.temperature} unit="°C" />
        <Metric name="Filament left" icon="filament" value={data?.grams} unit="g" />
      </dl>
    </div>
    <div className="device-panels">
    <FilamentPanel box={data} connected={connected} reload={reload} />
    <section className="box controls">
      <div className="controlheading"><h3>Fan mode</h3><span>Fan {connected ? output.toLowerCase() : "state unknown"}</span></div>
      <div className="segments" role="group" aria-label={label + " fan controls"}>
        {Object.entries(MODES).map(([mode, name]) =>
          <button key={mode} type="button" disabled={!!blocked}
            aria-pressed={data?.mode === mode} onClick={() => control(mode)}>{name}</button>)}
      </div>
      {feedback && <p role="status" className="feedback">{feedback}</p>}
    </section>
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

function DeviceSettings({box, reload, onWifi}) {
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
      <p>Connect this box to another network while keeping it linked to your account.</p>
      <button type="button" className="textbutton" onClick={onWifi}>Set up Wi-Fi</button>
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
  const showVirtualBox = demoPreviewEnabled && tab === "monitor" && now > 0 &&
    new URLSearchParams(window.location.search).get("previewBox") === "1";
  const visibleDevices = showVirtualBox && devices ? [...devices, { ...virtualBox, ts: now }] : devices;
  const selected = selectedSlot === "all" ? null :
    visibleDevices?.find(d => d.slot === selectedSlot) || visibleDevices?.[0];
  const onlineCount = visibleDevices?.filter(d => boxStatus(d, now, error) === "Online").length || 0;
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
  return <div className="app-shell">
    <aside className="sidebar">
      <Brand />
      <nav className="app-navigation" aria-label="Dashboard">
        {[["monitor","Monitor"],["devices","Devices"],["settings","Settings"]].map(([id,label]) =>
          <button key={id} aria-current={tab === id ? "page" : undefined} onClick={() => navigate(id)}><Icon name={id} /><span>{label}</span></button>)}
      </nav>
      <div className="sidebar-account"><span>Signed in as</span><p>{account.email}</p></div>
    </aside>
    <main className="dashboard-content">
    <header className="brandbar">
      <Brand />
      <Install />
    </header>
    <div className="toolbar">
      {tab === "monitor" && visibleDevices?.length > 0 && <label className="box-picker"><span className="sr-only">Choose box</span>
        <select value={selected?.slot || "all"} onChange={event => setSelectedSlot(event.target.value)}>
          {visibleDevices.map(box => <option key={box.slot} value={box.slot}>{box.label}</option>)}
          {visibleDevices.length > 1 && <option value="all">All boxes ({visibleDevices.length})</option>}
        </select><Icon name="chevron" />
      </label>}
      {tab !== "settings" && !adding && <button className="primary-action" onClick={add}><Icon name="plus" /><span>Add device</span></button>}
    </div>
    {(tab !== "monitor" || !selected) && <div className="titlebar">
      <div><h1>{tab === "settings" ? "Settings" : "Your boxes"}</h1>
        {tab !== "settings" && visibleDevices && <p className="subtitle">{visibleDevices.length} {visibleDevices.length === 1 ? "box" : "boxes"} · {error ? "status unavailable" : onlineCount + " online"}</p>}
      </div>
    </div>}
    {error && <div className="notice" role="alert">{error}<button onClick={reload}>Retry</button></div>}
    {tab !== "settings" && !devices && !error && !adding && <p role="status">Loading your boxes…</p>}
    {tab !== "settings" && visibleDevices?.length === 0 && !error && !adding && <section className="empty-state">
      <h2>Welcome to DrySpool</h2><p>Connect your first box to see its temperature, humidity, and remaining filament here.</p>
      <button type="button" className="primary-action" onClick={add}>Set up my first box</button>
    </section>}
    {adding && <SetupGuide email={account.email} changingWifi={adding === "wifi"} onClose={() => { navigate("devices"); reload(); }} />}
    {tab === "monitor" && selected && <>
      <Box key={selected.serial} data={selected} networkError={!!error} now={now} reload={reload}
        openSettings={selected.preview ? undefined : () => select(selected,{edit:true})} />
    </>}
    {tab === "monitor" && !selected && visibleDevices?.length > 0 && <section className="overview" aria-label="Boxes">
      {visibleDevices.map(box => {
        const state = boxStatus(box, now, error);
        const live = state === "Online";
        const guidance = live && storageGuidance(box.spool?.material, box.humidity);
        return <button type="button" key={box.serial} className="summary-card box" onClick={() => select(box)}>
          <strong>{box.label}</strong><span className={"state" + (live ? " active" : "")}><i />{state}</span>
          <span className="summary-readings">
            <SummaryMetric name="Humidity" value={box.humidity} unit="% RH" />
            <SummaryMetric name="Temperature" value={box.temperature} unit="°C" />
            <SummaryMetric name="Filament left" value={box.grams} unit="g" />
          </span>
          {guidance?.above && <span className="summary-alert">Above recommended humidity</span>}
          {!live && [box.humidity, box.temperature, box.grams].some(Number.isFinite) && <small>Last recorded</small>}
        </button>;
      })}
    </section>}
    {tab === "devices" && !adding && editing && selected && <>
      <button className="textbutton back" onClick={() => setEditing(false)}>← Your boxes</button>
      <DeviceSettings key={selected.serial} box={selected} reload={reload} onWifi={() => setAdding("wifi")} />
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
      {(metricsUrl || releasesUrl) && <nav className="cloudlinks settings-section" aria-label="Team cloud tools">
        {metricsUrl && <a href={metricsUrl} target="_blank" rel="noopener noreferrer">Metrics history ↗</a>}
        {releasesUrl && <a href={releasesUrl} target="_blank" rel="noopener noreferrer">Firmware releases ↗</a>}
      </nav>}
    </section>}
  </main>
  </div>;
}
