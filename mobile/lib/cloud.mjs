import { randomInt } from 'node:crypto';
import { ApiError } from './http.mjs';
import { validSerial } from './ownership.mjs';

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
  const spool = sample.spool_valid === true && sample.spool && typeof sample.spool === 'object' ? {
    material: typeof sample.spool.material === 'string' ? sample.spool.material.slice(0, 40) : null,
    color: typeof sample.spool.color === 'string' ? sample.spool.color.slice(0, 80) : null,
    brand: typeof sample.spool.brand === 'string' ? sample.spool.brand.slice(0, 80) : null,
    source: sample.spool.source === 'openprinttag' ? 'openprinttag' : 'manual',
  } : null;
  return {
    slot, device: 'DrySpool ' + slot, ts, online, pending, desired: desired?.mode ?? null,
    desiredId: desired?.request ?? null,
    temperature: env && Number.isFinite(sample.temperature_mc) ? sample.temperature_mc / 1000 : null,
    humidity: env && Number.isFinite(sample.humidity_mpct) ? sample.humidity_mpct / 1000 : null,
    grams: sample.grams_valid === true ? finite(sample.filament_g) : null, fan, spool,
    mode: modes.includes(sample.mode) ? sample.mode : null,
    firmware: typeof sample.firmware === 'string' ? sample.firmware : null,
    ota: phases.includes(sample.ota) ? sample.ota : null,
    request: Number.isInteger(sample.request) ? sample.request : null,
    control: online && sample.fan_api === 1 && fan !== null
  };
}

async function cloudRequest(path, patch, send) {
  const { NRF_ORG, NRF_PROJECT, DRYSPOOL_OAT } = process.env;
  if (![NRF_ORG, NRF_PROJECT, DRYSPOOL_OAT].every(Boolean)) {
    throw new ApiError(503, 'Set the nRF Cloud project and server token.');
  }
  const url = 'https://api.nrfcloud.com/v1/organizations/' + encodeURIComponent(NRF_ORG) +
    '/projects/' + encodeURIComponent(NRF_PROJECT) + path;
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

export function readShadow(id, patch, send = fetch) {
  if (!validSerial(id)) throw new ApiError(400, 'Invalid device ID.');
  return cloudRequest('/long-range/devices/' + encodeURIComponent(id) + '/state', patch, send);
}

export async function ownedCard({serial,label}, read = readShadow) {
  let shadow = {};
  let error;
  try {
    shadow = await read(serial);
  } catch (err) {
    error = err instanceof ApiError ? err.message : 'Could not read the cloud state.';
  }
  return { ...device('id-' + serial, shadow), serial, label, error };
}

export async function commandSerial(id, mode, read = readShadow, clock = Date.now) {
  if (!modes.includes(mode)) throw new ApiError(400, 'Invalid fan mode.');
  const shadow = await read(id);
  const now = clock();
  const current = device('id-' + id, shadow, now);
  if (!current.control) throw new ApiError(409, 'Wait for a fresh reading and a ready fan before sending a command.');
  if (current.pending) throw new ApiError(409, 'Waiting for the box to confirm the previous command.');
  const request = randomInt(1, 0x7fffffff);
  const expires = Math.floor(now / 1000) + 45;
  await read(id, { desired: { config: { fan: { mode, request, expires } } } });
  return { request, expires };
}

export async function ownedFleet(boxes, read = readShadow) {
  const rows = [];
  for (let i = 0; i < boxes.length; i += 8) {
    rows.push(...await Promise.all(boxes.slice(i, i + 8).map(box => ownedCard(box, read))));
  }
  return rows;
}
