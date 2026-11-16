import { randomInt } from 'node:crypto';
import { ApiError } from './http.mjs';

const slots = ['A', 'B', 'C'];
const knownSoftware = new Set(['dryspool-wifi-box', 'dryspool-app']);
const validSerial = id => typeof id === 'string' && /^[-a-zA-Z0-9_]{1,128}$/.test(id);

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

function configuredId(slot, env = process.env) {
  return env['NRF_DEVICE_' + slot]?.trim();
}

export function deviceId(slot, env = process.env) {
  if (!slots.includes(slot)) throw new ApiError(404, 'Unknown box.');
  const id = configuredId(slot, env);
  if (!id) throw new ApiError(503, `Set the device ID for Box ${slot}.`);
  if (slots.some(s => s !== slot && configuredId(s, env)?.toLowerCase() === id.toLowerCase())) {
    throw new ApiError(503, `Duplicate device ID. Check the configuration for Box ${slot}.`);
  }
  return id;
}

async function cloudRequest(path, patch, send, cache) {
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
      ...cache, redirect: 'error', signal: AbortSignal.timeout(8000)
    });
    if (res.ok) return patch ? undefined : await res.json();
  } catch {
    throw new ApiError(502, 'Lost connection to nRF Cloud. Refresh to try again.');
  }
  throw new ApiError(502, `nRF Cloud request failed (HTTP ${res.status}).`);
}

// Only the project inventory is cached. Readings and command eligibility always use live shadows.
export async function inventory(send = fetch) {
  const records = new Map();
  for (let page = 1; ; page++) {
    const result = await cloudRequest('/devices?per_page=100&page=' + page, undefined, send,
      { next: { revalidate: 30 } });
    const paging = result?.paging;
    if (!Array.isArray(result?.data) || paging?.page !== page ||
        !Number.isSafeInteger(paging.page_count) || paging.page_count < 0) {
      throw new ApiError(502, 'Unexpected device list from nRF Cloud.');
    }
    for (const record of result.data) {
      if (validSerial(record?.device_serial)) records.set(record.device_serial, record);
    }
    if (page >= paging.page_count) return records;
  }
}

function pinnedSlots() {
  return slots.filter(slot => configuredId(slot));
}

export function readShadow(id, patch, send = fetch) {
  if (!validSerial(id)) throw new ApiError(400, 'Invalid device ID.');
  return cloudRequest('/long-range/devices/' + encodeURIComponent(id) + '/state', patch, send,
    { cache: 'no-store' });
}

async function readCard(card, read) {
  const { slot, serial, label, pinned, known } = card;
  let shadow = {};
  let error;
  try {
    shadow = await read(pinned ? deviceId(slot) : serial);
  } catch (err) {
    error = err instanceof ApiError ? err.message : 'Could not read the cloud state.';
  }
  if (!pinned && !known && shadow?.reported?.dryspool?.fan_api !== 1) return null;
  return { ...device(slot, shadow), serial, label, error };
}

export async function fleet(list = inventory, read = readShadow) {
  let records = new Map();
  let warning = '';
  try {
    records = await list();
  } catch {
    warning = 'Device discovery is unavailable. The dashboard will retry.';
  }
  const cards = pinnedSlots().map(slot => ({
    slot, label: 'Box ' + slot, serial: configuredId(slot), pinned: true
  }));
  const pinnedIds = new Set(cards.map(card => card.serial.toLowerCase()));
  for (const record of records.values()) {
    if (!pinnedIds.has(record.device_serial.toLowerCase())) {
      const serial = record.device_serial;
      cards.push({
        slot: 'id-' + serial, serial, label: record.nickname?.trim() || 'Box ' + serial,
        known: knownSoftware.has(record.last_seen_software_version?.software_type?.name)
      });
    }
  }
  const rows = [];
  // Limit simultaneous shadow requests as the fleet grows.
  for (let i = 0; i < cards.length; i += 8) {
    const group = cards.slice(i, i + 8);
    const batch = await Promise.all(group.map(card => readCard(card, read)));
    rows.push(...batch.filter(Boolean));
  }
  return {rows, warning};
}

async function commandTarget(slot) {
  if (slots.includes(slot)) return deviceId(slot);
  if (!slot.startsWith('id-') || !validSerial(slot.slice(3))) throw new ApiError(404, 'Unknown box.');
  const id = slot.slice(3);
  const records = await inventory();
  if (!records.has(id) || pinnedSlots().some(s =>
      configuredId(s).toLowerCase() === id.toLowerCase())) {
    throw new ApiError(404, 'Unknown box.');
  }
  return id;
}

export async function command(slot, mode, read = readShadow, clock = Date.now) {
  if (!modes.includes(mode)) throw new ApiError(400, 'Invalid fan mode.');
  const id = await commandTarget(slot);
  const shadow = await read(id);
  const now = clock();
  const current = device(slot, shadow, now);
  if (!current.control) throw new ApiError(409, 'Wait for a fresh reading and a ready fan before sending a command.');
  if (current.pending) throw new ApiError(409, 'Waiting for the box to confirm the previous command.');
  const request = randomInt(1, 0x7fffffff);
  const expires = Math.floor(now / 1000) + 45;
  await read(id, { desired: { config: { fan: { mode, request, expires } } } });
  return { request, expires };
}
