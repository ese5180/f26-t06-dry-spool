import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { PGlite } from '@electric-sql/pglite';

test('PostgreSQL grants one owner and rejects the wrong proof or an expired attempt', async t => {
  const db = new PGlite();
  t.after(() => db.close());
  const alice = '11a99927-2389-4f5d-8958-b955a9842faa';
  const bob = '3bbb5cfc-6019-44f5-bfe5-9863c651c763';
  await db.exec('create schema auth; create table auth.users (id uuid primary key); ' +
    'create role anon; create role authenticated; create role service_role bypassrls;');
  await db.query('insert into auth.users values ($1),($2)',[alice,bob]);
  await db.exec(await readFile(new URL('../db/001_device_ownership.sql',import.meta.url),'utf8'));
  const start = async (owner, serial, proof) => (await db.query(
    'select dryspool_start_claim($1,$2,$3) as claim',[owner,serial,proof])).rows[0].claim;
  const finish = async (owner, id, proof) => (await db.query(
    'select dryspool_finish_claim($1,$2,$3) as status',[owner,id,proof])).rows[0].status;
  const proofA = 'a'.repeat(64);
  const proofB = 'b'.repeat(64);
  const a = await start(alice,'shared',proofA);
  const b = await start(bob,'shared',proofB);
  assert.equal(await finish(bob,a.id,proofA),'expired');
  assert.equal(await finish(alice,a.id,proofB),'expired');
  const statuses = await Promise.all([finish(alice,a.id,proofA),finish(bob,b.id,proofB)]);
  assert.deepEqual([...statuses].sort(),['added','claimed']);
  const won = statuses[0] === 'added' ? [alice,a.id,proofA] : [bob,b.id,proofB];
  assert.equal(await finish(...won),'added');
  assert.equal((await db.query('select owner_id from dryspool_devices')).rows[0].owner_id,won[0]);
  assert.equal(await start(bob,'shared','c'.repeat(64)),null);
  const expired = await start(bob,'another','d'.repeat(64));
  await db.query("update dryspool_claims set expires_at = now() - interval '10 seconds' where id = $1",[expired.id]);
  assert.equal(await finish(bob,expired.id,'d'.repeat(64)),'expired');
  assert.equal((await db.query("select has_table_privilege('authenticated','dryspool_devices','SELECT') as allowed"))
    .rows[0].allowed,false);
});
