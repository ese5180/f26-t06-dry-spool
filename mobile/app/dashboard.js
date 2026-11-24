"use client";
import {useEffect, useState} from 'react';
import {api} from './client-api';

const modes = {auto:'Auto', on:'On', off:'Off'};
const value = (n, unit) => Number.isFinite(n) ? `${n.toLocaleString('en-US', {maximumFractionDigits:1})} ${unit}` : 'No reading';

function Box({box, now, networkError, reload}) {
  const [busy, setBusy] = useState(false);
  const [command, setCommand] = useState(null);
  const [error, setError] = useState('');
  const live = !networkError && !box.error && box.online && now - box.ts < 45000 && now - box.ts >= -5000;
  const confirmed = command && box.request === command.id && box.mode === command.mode && box.control;
  const waiting = command && !confirmed && now - command.sent < 30000;
  async function control(mode) {
    setBusy(true); setError(''); setCommand(null);
    try {
      const {payload} = await api('/api/' + encodeURIComponent(box.slot) + '/fan', {mode});
      setCommand({id:payload.request, mode, sent:Date.now()});
    } catch (err) {setError(err.message);}
    finally {setBusy(false); reload();}
  }
  return <section className="box">
    <header><h2>{box.label}</h2><span className={live ? 'online' : 'muted'}>{live ? 'Online' : box.ts ? 'Offline' : 'No reports'}</span></header>
    {!live && box.ts > 0 && <p className="muted">Last recorded readings</p>}
    <dl>
      <div><dt>Temperature</dt><dd>{value(box.temperature, '°C')}</dd></div>
      <div><dt>Humidity</dt><dd>{value(box.humidity, '% RH')}</dd></div>
      <div><dt>Filament left</dt><dd>{value(box.grams, 'g')}</dd></div>
    </dl>
    <div className="fan-title"><strong>Fan</strong><span>{live && typeof box.fan === 'boolean' ? box.fan ? 'On' : 'Off' : 'Unknown'}</span></div>
    <div className="buttons" role="group" aria-label={box.label + ' fan controls'}>
      {Object.entries(modes).map(([mode,label]) => <button key={mode} onClick={() => control(mode)}
        disabled={!live || !box.control || busy || !!waiting || !!box.pending}
        aria-pressed={box.mode === mode}>{label}</button>)}
    </div>
    {(busy || command || error) && <p role="status">{error || (busy ? 'Sending…' : confirmed ? 'Box confirmed: ' + modes[command.mode] : waiting ? 'Waiting for box confirmation…' : 'No confirmation received.')}</p>}
    {box.error && <p role="alert">{box.error}</p>}
    <p className="muted last-report">{box.ts > 0 ? <>Last report: <time dateTime={new Date(box.ts).toISOString()}>{new Date(box.ts).toLocaleString()}</time></> : 'Waiting for the first report.'}</p>
  </section>;
}

export default function Dashboard() {
  const [devices, setDevices] = useState(null);
  const [error, setError] = useState('');
  const [now, setNow] = useState(0);
  const [refresh, setRefresh] = useState(0);
  const reload = () => setRefresh(n => n + 1);
  useEffect(() => {
    let active = true, timer, request;
    async function poll() {
      if (!active || document.hidden) return;
      request = new AbortController();
      const timeout = setTimeout(() => request.abort(), 18000);
      try {
        const {payload} = await api('/api/devices', undefined, request.signal);
        if (!Array.isArray(payload)) throw Error('Could not read device data.');
        if (active) {setDevices(payload); setError('');}
      } catch (err) {if (active) setError(err.message);}
      finally {clearTimeout(timeout); if (active) timer = setTimeout(poll, 5000);}
    }
    function visible() {if (!document.hidden) {clearTimeout(timer); if (!request || request.signal.aborted) poll(); else reload();}}
    document.addEventListener('visibilitychange', visible);
    poll();
    return () => {active = false; clearTimeout(timer); request?.abort(); document.removeEventListener('visibilitychange', visible);};
  }, [refresh]);
  useEffect(() => {
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 2000);
    if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});
    return () => clearInterval(timer);
  }, []);
  return <main>
    <header className="page-header"><h1>DrySpool</h1><button onClick={reload}>Refresh</button></header>
    {error && <p role="alert">{error}</p>}
    {!devices && !error && <p role="status">Loading readings…</p>}
    {devices?.length === 0 && <p>No devices configured.</p>}
    <div className="boxes">{devices?.map(box => <Box key={box.slot} box={box} now={now} networkError={!!error} reload={reload} />)}</div>
  </main>;
}
