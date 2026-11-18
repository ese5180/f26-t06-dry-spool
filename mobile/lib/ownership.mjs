import { createHash, randomBytes } from 'node:crypto';
import { ApiError } from './http.mjs';

export const validSerial = id => typeof id === 'string' && /^[-a-zA-Z0-9_]{1,128}$/.test(id);
export const validClaimId = id => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);
const validToken = token => typeof token === 'string' && /^[0-9a-f]{64}$/.test(token);
const tokenHash = token => createHash('sha256').update(token, 'ascii').digest('hex');

function result({data, error}) {
  if (error) throw new ApiError(503, 'Device storage is unavailable. Try again.');
  return data;
}

export class Ownership {
  constructor(db, userId) {
    this.db = db;
    this.userId = userId;
  }

  async list() {
    return result(await this.db.from('dryspool_devices').select('serial,label')
      .eq('owner_id', this.userId).order('created_at'));
  }

  async find(serial) {
    if (!validSerial(serial)) throw new ApiError(404, 'Box not found.');
    return result(await this.db.from('dryspool_devices').select('serial,label')
      .eq('serial', serial).eq('owner_id', this.userId).maybeSingle());
  }

  async require(serial) {
    const row = await this.find(serial);
    if (!row) throw new ApiError(404, 'Box not found.');
    return row;
  }

  async rename(serial, label) {
    if (typeof label !== 'string' || !label.trim() || label.trim().length > 64) {
      throw new ApiError(400, 'Enter a box name between 1 and 64 characters.');
    }
    await this.require(serial);
    return result(await this.db.from('dryspool_devices').update({label: label.trim()})
      .eq('serial', serial).eq('owner_id', this.userId).select('serial,label').single());
  }

  async start(serial) {
    if (!validSerial(serial)) throw new ApiError(400, 'The box ID is invalid.');
    const token = randomBytes(32).toString('hex');
    const row = result(await this.db.rpc('dryspool_start_claim', {
      p_user: this.userId, p_serial: serial, p_hash: tokenHash(token),
    }));
    if (!row) throw new ApiError(409, 'This box is already linked to an account.');
    if (!row.id) throw new ApiError(429, 'Too many attempts. Wait a few minutes and try again.');
    return {id: row.id, token, expiresAt: row.expires_at};
  }

  async check(id, readShadow) {
    if (!validClaimId(id)) throw new ApiError(404, 'Setup attempt not found.');
    const row = result(await this.db.from('dryspool_claims')
      .select('id,serial,token_hash,expires_at,completed_at')
      .eq('id', id).eq('user_id', this.userId).maybeSingle());
    if (!row) throw new ApiError(404, 'Setup attempt not found.');
    if (row.completed_at) return {status:'added', serial:row.serial};
    if (Date.parse(row.expires_at) <= Date.now()) return {status:'expired'};

    const shadow = await readShadow(row.serial);
    const proof = shadow?.reported?.dryspool_claim?.proof;
    if (!validToken(proof) || proof !== row.token_hash) return {status:'waiting'};
    const status = result(await this.db.rpc('dryspool_finish_claim', {
      p_user: this.userId, p_id: id, p_hash: proof,
    }));
    return status === 'added' ? {status, serial:row.serial} : {status};
  }
}
