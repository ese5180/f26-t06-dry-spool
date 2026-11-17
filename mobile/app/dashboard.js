"use client";

import { useEffect, useState } from "react";
import { storageGuidance, storageSource } from "../lib/storage.mjs";

const MODES = { on: "On", off: "Off", auto: "Auto" };
const OTA_PHASES = {
  checking: "Checking for updates", transferring: "Downloading firmware", restarting: "Restarting",
  idle: "Idle", failed: "Update failed",
};
const projectUrl = "https://app.memfault.com/organizations/zicong-zhang/projects/default-project";
const releasesUrl = process.env.NEXT_PUBLIC_NRF_CLOUD_RELEASES_URL || projectUrl + "/releases";
const metricsUrl = process.env.NEXT_PUBLIC_NRF_CLOUD_METRICS_URL || projectUrl + "/dashboards/memfault-metrics";
const controlAge = 45_000;

async function api(path, body, signal) {
  const response = await fetch(path, {
    method: body === undefined ? "GET" : "POST",
    headers: body === undefined ? {} : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
    credentials: "omit",
    cache: "no-store",
    signal: signal || AbortSignal.timeout(18_000),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(typeof payload.error === "string" ? payload.error : "Could not connect. Try again.");
    error.status = response.status;
    throw error;
  }
  return {payload, headers: response.headers};
}

function Metric({ name, value, unit, large = false }) {
  return <div className={large ? "metric major" : "metric"}>
    <dt>{name}</dt>
    <dd>{Number.isFinite(value) ? value.toLocaleString("en-US", {
      maximumFractionDigits: large ? 0 : 1,
    }) : "—"} <small>{unit}</small></dd>
  </div>;
}

function Box({ data, networkError, now, reload }) {
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
  const state = networkError ? "Disconnected" : data?.error ? "Read failed" : !timestamp ? "Awaiting data" :
    data.online === false ? "Offline" : connected ? "Online" : "Stale reading";
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
      <span className={"state" + (connected ? " active" : "")}><i />{state}</span>
    </div>
    {label !== "Box " + serial && <p className="serial">{serial}</p>}
    {!connected && timestamp > 0 && <p className="stale-note">Last recorded readings below · current conditions unknown</p>}
    <dl className={"readings" + (!connected ? " stale" : "")}>
      <Metric large name="Filament remaining" value={data?.grams} unit="g" />
      <Metric name="Temperature" value={data?.temperature} unit="°C" />
      <Metric name="Relative humidity" value={data?.humidity} unit="%" />
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
    <footer>{timestamp > 0 ? <>Last report <time dateTime={new Date(timestamp).toISOString()}>
      {new Date(timestamp).toLocaleString("en-US", { month:"2-digit", day:"2-digit", hour:"2-digit",
        minute:"2-digit", second:"2-digit", hour12:false })}</time></> : "No reports yet"}</footer>
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

export default function Dashboard() {
  const [devices, setDevices] = useState(null);
  const [selectedSlot, setSelectedSlot] = useState(null);
  const [discoveryWarning, setDiscoveryWarning] = useState("");
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
        const {payload: value, headers} = await api("/api/devices", undefined, request.signal);
        if (!active || generation !== run) return;
        if (!Array.isArray(value)) throw new Error("Unexpected device data format.");
        setDevices(value); setDiscoveryWarning(headers.get("X-DrySpool-Discovery") || ""); setError("");
      } catch (e) {
        if (!active || generation !== run) return;
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
  useEffect(() => {
    if (!devices?.length) { setSelectedSlot(null); return; }
    if (!devices.some(d => d.slot === selectedSlot)) {
      const firstOnline = devices.find(d => d.online && d.ts > Date.now() - controlAge);
      setSelectedSlot((firstOnline || devices[0]).slot);
    }
  }, [devices, selectedSlot]);
  const selected = devices?.find(d => d.slot === selectedSlot);
  const onlineCount = devices?.filter(d => d.online && d.ts > now - controlAge).length || 0;
  return <main>
    <header className="brandbar">
      <div className="brand"><img alt="" width="36" height="36" src="/icon-192.png" />DrySpool</div>
      <Install />
    </header>
    <div className="titlebar"><div><p className="eyebrow">PROJECT DEVICES</p><h1>Filament storage</h1>
      <p className="subtitle">{devices ? `${devices.length} ${devices.length === 1 ? "box" : "boxes"} · ${error ? "status unavailable" : `${onlineCount} online`}` : "Connecting to your boxes…"}</p></div>
      <nav className="cloudlinks" aria-label="nRF Cloud">
        <a href={metricsUrl} target="_blank" rel="noopener noreferrer">Metrics history ↗</a>
        <a href={releasesUrl} target="_blank" rel="noopener noreferrer">Firmware releases ↗</a>
      </nav>
    </div>
    {error && <div className="notice" role="alert">{error}<button onClick={reload}>Retry</button></div>}
    {discoveryWarning && !error && <p className="notice" role="status">{discoveryWarning}</p>}
    {!devices && !error && <p role="status">Connecting to the cloud…</p>}
    {devices?.length === 0 && !error && !discoveryWarning && <section className="empty-state" role="status">
      <h2>No boxes yet</h2><p>Power a DrySpool box, connect it to Wi-Fi, and register it in the same nRF Cloud project. It will appear here after its first report.</p>
      <a href="https://github.com/ese5180/f26-t06-dry-spool/blob/feature/mvp-firmware-sirui/firmware/README.md" target="_blank" rel="noopener noreferrer">Team setup guide ↗</a>
    </section>}
    {devices?.length > 0 && selected && <div className="dashboard-layout">
      <aside className="device-list" aria-label="Choose a box">
        <div className="list-heading"><h2>Boxes</h2><span>{devices.length}</span></div>
        <div className="device-switcher">
          {devices.map((d, index) => {
            const live = !error && !d.error && d.online && d.ts > now - controlAge;
            return <button key={d.serial + "/" + d.slot} type="button" className={"device-choice" + (d.slot === selectedSlot ? " selected" : "")}
              aria-current={d.slot === selectedSlot ? "true" : undefined} onClick={() => setSelectedSlot(d.slot)}>
              <span className="device-index">{String(index + 1).padStart(2, "0")}</span>
              <span className="device-choice-label"><strong>{d.label}</strong><small>{live ? "Online" : "Offline or waiting"}</small></span>
              <span className={"choice-dot" + (live ? " live" : "")} aria-hidden="true" />
            </button>;
          })}
        </div>
      </aside>
      <section className="detail" aria-label="Selected box">
        <Box key={selected.serial + "/" + selected.slot} data={selected} networkError={!!error} now={now} reload={reload} />
      </section>
    </div>}
  </main>;
}
