import { randomInt } from 'node:crypto';
import { ApiError } from './http.mjs';

const modes = ['auto', 'on', 'off'];
const slots = ['A', 'B'];
const otaStates = ['checking', 'transferring', 'restarting', 'idle', 'failed'];
const freshness = 45000;
function timestamp(meta) {
  return Number.isSafeInteger(meta?.timestamp) && meta.timestamp > 0 ? meta.timestamp * 1000 : 0;
}
const finite = n => Number.isFinite(n) ? n : null;

export function devices(shadow, now = Date.now()) {
  return slots.map(slot => {
    const sample = shadow.reported?.dryspool?.[slot] || {};
    const ts = timestamp(shadow.metadata?.reported?.dryspool?.[slot]?.seq);
    const online = sample.online === true && ts > 0 && now - ts >= -5000 && now - ts < freshness;
    const desired = shadow.desired?.config?.[slot];
    const ack = shadow.reported?.config?.[slot];
    const pending = Boolean(desired?.request > 0 && desired.expires * 1000 > now &&
      !(ack?.request === desired.request && ack.mode === desired.mode && ack.expires === desired.expires));
    return {
      slot, device: 'DrySpool ' + slot, ts, online, pending, desired: desired?.mode ?? null,
      desiredId: desired?.request ?? null,
      temperature: finite(sample.temperature), humidity: finite(sample.humidity), grams: finite(sample.grams),
      fan: typeof sample.fan === 'boolean' ? sample.fan : null,
      mode: modes.includes(sample.mode) ? sample.mode : null,
      firmware: typeof sample.firmware === 'string' ? sample.firmware : null,
      ota: otaStates.includes(sample.ota) ? sample.ota : null,
      request: Number.isInteger(sample.request) ? sample.request : null,
      control: online && sample.control === true && typeof sample.fan === 'boolean'
    };
  });
}

export async function state(patch, send = fetch) {
  const { NRF_ORG, NRF_PROJECT, NRF_GATEWAY_ID, DRYSPOOL_OAT } = process.env;
  if (![NRF_ORG, NRF_PROJECT, NRF_GATEWAY_ID, DRYSPOOL_OAT].every(Boolean)) {
    throw new ApiError(503, '请在服务器配置 nRF Cloud 项目和 G 的设备身份');
  }
  const path = [NRF_ORG, NRF_PROJECT, NRF_GATEWAY_ID].map(encodeURIComponent);
  const url = 'https://api.nrfcloud.com/v1/organizations/' + path[0] + '/projects/' + path[1] +
    '/long-range/devices/' + path[2] + '/state';
  let res;
  try {
    res = await send(url, {
      method: patch ? 'PATCH' : 'GET', headers: {
        Authorization: 'Bearer ' + DRYSPOOL_OAT, 'Content-Type': 'application/json'
      }, body: patch ? JSON.stringify(patch) : undefined,
      cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(8000)
    });
    if (res.ok) return patch ? undefined : await res.json();
  } catch {
    throw new ApiError(502, 'nRF Cloud 连接中断，请稍后刷新');
  }
  throw new ApiError(502, 'nRF Cloud 请求失败（HTTP ' + res.status + '）');
}

export async function command(slot, mode, call = state, clock = Date.now) {
  if (!slots.includes(slot)) throw new ApiError(404, '未知箱子');
  if (!modes.includes(mode)) throw new ApiError(400, '风扇模式无效');
  const shadow = await call();
  const now = clock();
  const current = devices(shadow, now).find(box => box.slot === slot);
  if (!current.control) throw new ApiError(409, '读数已过期或风扇未就绪，请等待设备上报');
  if (current.pending) throw new ApiError(409, '正在等待上一条指令的回执');
  const request = randomInt(1, 0x7fffffff);
  const expires = Math.floor(now / 1000) + 45;
  await call({ desired: { config: { [slot]: { mode, request, expires } } } });
  return { request, expires };
}
