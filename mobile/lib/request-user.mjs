import { database, requireUser } from './accounts.mjs';
import { Ownership } from './ownership.mjs';

export async function ownedDevices(req) {
  const user = await requireUser(req);
  return new Ownership(database(), user.id);
}
