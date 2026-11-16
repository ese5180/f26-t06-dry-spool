"use client";

import { useEffect, useState } from "react";

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
    <dl className="readings">
      <Metric large name="Filament remaining" value={data?.grams} unit="g" />
      <Metric name="Temperature" value={data?.temperature} unit="°C" />
      <Metric name="Relative humidity" value={data?.humidity} unit="%" />
    </dl>
    <div className="controls">
      <div className="controlheading"><h3>Fan mode</h3><span>Fan output · {output}</span></div>
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
  return <main>
    <header className="brandbar">
      <div className="brand"><img alt="" width="36" height="36" src="/icon-192.png" />DrySpool</div>
      <Install />
    </header>
    <div className="titlebar"><h1>Device dashboard</h1>
      <nav className="cloudlinks" aria-label="nRF Cloud">
        <a href={metricsUrl} target="_blank" rel="noopener noreferrer">Metrics history ↗</a>
        <a href={releasesUrl} target="_blank" rel="noopener noreferrer">Firmware releases ↗</a>
      </nav>
    </div>
    {error && <div className="notice" role="alert">{error}<button onClick={reload}>Retry</button></div>}
    {discoveryWarning && !error && <p className="notice" role="status">{discoveryWarning}</p>}
    {!devices && !error && <p role="status">Connecting to the cloud…</p>}
    {devices?.length === 0 && !error && !discoveryWarning &&
      <p role="status">Waiting for the first DrySpool box to report.</p>}
    {devices?.length > 0 &&
      <section className="grid" aria-label="Filament boxes">
        {devices.map(d => <Box key={d.serial + "/" + d.slot} data={d}
          networkError={!!error} now={now} reload={reload} />)}
      </section>}
  </main>;
}
