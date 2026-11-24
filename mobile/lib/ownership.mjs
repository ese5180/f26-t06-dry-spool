import { ApiError } from './http.mjs';

export const validSerial = id => typeof id === 'string' && /^[-a-zA-Z0-9_]{1,128}$/.test(id);
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

}
