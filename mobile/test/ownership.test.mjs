import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { PGlite } from '@electric-sql/pglite';
import { Ownership } from '../lib/ownership.mjs';

test('ownership lookups always filter by the signed-in account', async () => {
  const filters = new Map();
  const store = new Ownership({from: () => ({
    select(){return this;}, eq(key,value){filters.set(key,value);return this;},
    maybeSingle(){return {data:null};},
  })}, 'alice');
  await assert.rejects(store.require('other-box'), {status:404});
  assert.equal(filters.get('owner_id'),'alice');
  assert.equal(filters.get('serial'),'other-box');
});

test('database restricts device assignment to administrators', async t => {
  const db = new PGlite();
  t.after(() => db.close());
  await db.exec('create schema auth; create table auth.users (id uuid primary key); ' +
    'create role anon; create role authenticated; create role service_role bypassrls;');
  await db.exec(await readFile(new URL('../db/001_device_ownership.sql',import.meta.url),'utf8'));
  for (const role of ['anon','authenticated','service_role']) {
    assert.equal((await db.query("select has_table_privilege($1,'dryspool_devices','INSERT') as allowed",[role])).rows[0].allowed,false);
  }
  assert.equal((await db.query("select has_table_privilege('authenticated','dryspool_devices','SELECT') as allowed")).rows[0].allowed,false);
  assert.equal((await db.query("select has_table_privilege('service_role','dryspool_devices','UPDATE') as allowed")).rows[0].allowed,true);
});
