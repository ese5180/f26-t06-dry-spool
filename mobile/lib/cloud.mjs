import { randomInt } from 'node:crypto';
import { ApiError } from './http.mjs';
import { slots } from './slots.mjs';

const modes = ['auto', 'on', 'off'];
const phases = ['checking', 'transferring', 'restarting', 'idle', 'failed'];
const finite = n => Number.isFinite(n) ? n : null;

export function device(slot, shadow, now = Date.now()) {
  const sample = shadow.reported?.dryspool || {};
  const ts = Number.isSafeInteger(sample.sample_ms) ? sample.sample_ms : 0;
  const online = ts > 0 && now - ts >= -5000 && now - ts < 45000;
  const desired = shadow.desired?.config?.fan;
  const ack = shadow.reported?.config?.fan;
  const pending = Boolean(desired?.request > 0 && desired.expires * 1000 > now &&
    !(ack?.request === desired.request && ack.mode === desired.mode && ack.expires === desired.expires));
  const env = sample.env_valid === true;
  const fan = sample.fan_valid === true && typeof sample.fan_on === 'boolean' ? sample.fan_on : null;
  return {
    slot, device: 'DrySpool ' + slot, ts, online, pending, desired: desired?.mode ?? null,
    desiredId: desired?.request ?? null,
    temperature: env && Number.isFinite(sample.temperature_mc) ? sample.temperature_mc / 1000 : null,
    humidity: env && Number.isFinite(sample.humidity_mpct) ? sample.humidity_mpct / 1000 : null,
    grams: sample.grams_valid === true ? finite(sample.filament_g) : null, fan,
    mode: modes.includes(sample.mode) ? sample.mode : null,
    firmware: typeof sample.firmware === 'string' ? sample.firmware : null,
    ota: phases.includes(sample.ota) ? sample.ota : null,
    request: Number.isInteger(sample.request) ? sample.request : null,
    control: online && sample.fan_api === 1 && fan !== null
  };
}

export function deviceId(slot, env = process.env) {
  if (!slots.includes(slot)) throw new ApiError(404, 'Unknown box.');
  const idFor = s => env['NRF_DEVICE_' + s]?.trim();
  const id = idFor(slot);
  if (!id) throw new ApiError(503, `Set the device ID for Box ${slot}.`);
  if (slots.some(s => s !== slot && idFor(s)?.toLowerCase() === id.toLowerCase())) {
    throw new ApiError(503, `Duplicate device ID. Check the configuration for Box ${slot}.`);
  }
  return id;
}

export async function state(slot, patch, send = fetch) {
  const id = deviceId(slot);
  const { NRF_ORG, NRF_PROJECT, DRYSPOOL_OAT } = process.env;
  if (![NRF_ORG, NRF_PROJECT, DRYSPOOL_OAT].every(Boolean)) {
    throw new ApiError(503, 'Set the nRF Cloud project and server token.');
  }
  const path = [NRF_ORG, NRF_PROJECT, id].map(encodeURIComponent);
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
    throw new ApiError(502, 'Lost connection to nRF Cloud. Refresh to try again.');
  }
  throw new ApiError(502, `nRF Cloud request failed (HTTP ${res.status}).`);
}

export function devices(call = state) {
  return Promise.all(slots.map(async slot => {
    try {
      return device(slot, await call(slot));
    } catch (error) {
      return { ...device(slot, {}), error: error instanceof ApiError ? error.message : 'Could not read the cloud state.' };
    }
  }));
}

export async function command(slot, mode, call = state, clock = Date.now) {
  if (!slots.includes(slot)) throw new ApiError(404, 'Unknown box.');
  if (!modes.includes(mode)) throw new ApiError(400, 'Invalid fan mode.');
  const shadow = await call(slot);
  const now = clock();
  const current = device(slot, shadow, now);
  if (!current.control) throw new ApiError(409, 'Wait for a fresh reading and a ready fan before sending a command.');
  if (current.pending) throw new ApiError(409, 'Waiting for the box to confirm the previous command.');
  const request = randomInt(1, 0x7fffffff);
  const expires = Math.floor(now / 1000) + 45;
  await call(slot, { desired: { config: { fan: { mode, request, expires } } } });
  return { request, expires };
}
