"use client";

import { slots } from "../lib/slots.mjs";
import { useEffect, useState } from "react";

const MODES = { on: "开启", off: "关闭", auto: "自动" };
const OTA_PHASES = {
  checking: "检查更新", transferring: "传输固件", restarting: "正在重启",
  idle: "空闲", failed: "升级失败",
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
    const error = new Error(typeof payload.error === "string" ? payload.error : "暂时无法连接，请重试");
    error.status = response.status;
    throw error;
  }
  return payload;
}

function Metric({ name, value, unit, large = false }) {
  return <div className={large ? "metric major" : "metric"}>
    <dt>{name}</dt>
    <dd>{Number.isFinite(value) ? value.toLocaleString("zh-CN", {
      maximumFractionDigits: large ? 0 : 1,
    }) : "—"} <small>{unit}</small></dd>
  </div>;
}

function Box({ slot, data, networkError, now, reload }) {
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
  const state = networkError ? "连接中断" : data?.error ? "读取失败" : !timestamp ? "等待上报" :
    data.online === false ? "已离线" : connected ? "在线" : "读数已过期";
  const output = data?.fan === true ? "开" : data?.fan === false ? "关" : "未知";
  const firmware = typeof data?.firmware === "string" ? data.firmware.trim() : "";
  const ota = Object.hasOwn(OTA_PHASES, data?.ota) ? OTA_PHASES[data.ota] : "";
  const feedback = error || (sending ? "正在发送…" : ack ? "箱子已确认 · " + MODES[command.mode] :
    waiting || data?.pending ? "指令已发送，等待箱子确认" : command ? "尚未收到设备确认" :
    data?.error || (connected && !data.control ? "当前设备仅上报读数" : ""));
  async function control(mode) {
    setSending(true);
    setCommand(null);
    setError("");
    try {
      const result = await api("/api/" + slot + "/fan", { mode });
      if (!result.request) throw new Error("云端未返回指令编号");
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
      <h2><span className="letter">{slot}</span>耗材箱 {slot}</h2>
      <span className={"state" + (connected ? " active" : "")}><i />{state}</span>
    </div>
    <dl className="readings">
      <Metric large name="耗材余量" value={data?.grams} unit="g" />
      <Metric name="箱内温度" value={data?.temperature} unit="°C" />
      <Metric name="相对湿度" value={data?.humidity} unit="%" />
    </dl>
    <div className="controls">
      <div className="controlheading"><h3>风扇模式</h3><span>上报输出 · {output}</span></div>
      <div className="segments" role="group" aria-label={"箱 " + slot + " 风扇"}>
        {Object.entries(MODES).map(([mode, name]) =>
          <button key={mode} type="button" disabled={!!blocked}
            aria-pressed={data?.mode === mode} onClick={() => control(mode)}>{name}</button>)}
      </div>
      {feedback && <p role="status" className="feedback">{feedback}</p>}
    </div>
    {(firmware || ota) && <dl className="firmware" aria-label={"箱 " + slot + " 固件信息"}>
      {firmware && <div><dt>上报固件版本</dt><dd>{firmware}</dd></div>}
      {ota && <div><dt>上报升级状态</dt><dd>{ota}</dd></div>}
    </dl>}
    <footer>{timestamp > 0 ? <>最近上报 <time dateTime={new Date(timestamp).toISOString()}>
      {new Date(timestamp).toLocaleString("zh-CN", { month:"2-digit", day:"2-digit", hour:"2-digit",
        minute:"2-digit", second:"2-digit", hour12:false })}</time></> : "暂无上报时间"}</footer>
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
    }}>添加到主屏幕</button>
    {showHelp && <p role="status" className="installhelp">iPhone 请点 Safari 的“分享”→“添加到主屏幕”。Android 可在浏览器菜单中选择“安装应用”或“添加到主屏幕”。</p>}
  </div>;
}

export default function Dashboard() {
  const [devices, setDevices] = useState([]);
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
        const value = await api("/api/devices", undefined, request.signal);
        if (!active || generation !== run) return;
        if (!Array.isArray(value)) throw new Error("设备数据格式有误");
        setDevices(value); setError("");
      } catch (e) {
        if (!active || generation !== run) return;
        setError(e.status ? e.message : "与云端连接中断");
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
    <div className="titlebar"><h1>设备看板</h1>
      <nav className="cloudlinks" aria-label="nRF Cloud">
        <a href={metricsUrl} target="_blank" rel="noopener noreferrer">历史指标 ↗</a>
        <a href={releasesUrl} target="_blank" rel="noopener noreferrer">固件发布 ↗</a>
      </nav>
    </div>
    {error && <div className="notice" role="alert">{error}<button onClick={reload}>重试</button></div>}
    {devices.length === 0 && !error ? <p role="status">正在连接云端…</p> :
      <section className="grid" aria-label="耗材箱">
        {slots.map(slot => <Box key={slot} slot={slot} data={devices.find(d => d.slot === slot)}
          networkError={!!error} now={now} reload={reload} />)}
      </section>}
  </main>;
}
