import assert from 'node:assert/strict';
import test from 'node:test';
import { commandSerial, device, ownedFleet, readShadow } from '../lib/cloud.mjs';
import { input } from '../lib/http.mjs';
import { storageGuidance } from '../lib/storage.mjs';
import { GET } from '../app/api/devices/route.js';
import { POST } from '../app/api/[slot]/fan/route.js';
import { GET as detail, PATCH as rename } from '../app/api/devices/[serial]/route.js';
import { PUT as editFilament } from '../app/api/devices/[serial]/filament/route.js';

const now = 1800000000000;
function sample(ts = now) {
  return { reported: { dryspool: { sample_ms:ts, fan_api:1, fan_valid:true, fan_on:true,
    env_valid:true, temperature_mc:21500, humidity_mpct:48750, grams_valid:true, filament_g:0,
    mode:'auto', request:10 } } };
}
test('fresh, valid sensor data and protocol are required for live control', () => {
  const s=sample();
  const a=device('A',s,now);
  assert.equal(a.temperature,21.5);
  assert.equal(a.humidity,48.75);
  assert.equal(a.grams,0);
  assert.equal(a.control,true);
  assert.equal(device('A',s,now+46000).control,false);
  s.reported.dryspool.fan_api=0;
  assert.equal(device('A',s,now).control,false);
});
test('the selected serial gets the command and acknowledgment; stale commands expire', async () => {
  const s=sample();
  Object.assign(process.env,{NRF_ORG:'test',NRF_PROJECT:'test',DRYSPOOL_OAT:'test-only'});
  const calls=[];
  const call=(id,patch)=>readShadow(id,patch,async (url,options)=>{
    calls.push([url,options.method]);
    if(options.method==='GET') return Response.json(s);
    s.desired=JSON.parse(options.body).desired;
    return new Response(null,{status:202});
  });
  const {request}=await commandSerial('c','off',call,()=>now);
  assert.ok(calls.every(([url])=>url.endsWith('/devices/c/state')));
  assert.deepEqual(calls.map(x=>x[1]),['GET','PATCH']);
  assert.equal(s.desired.config.fan.request,request);
  assert.ok(device('C',s,now).pending);
  await assert.rejects(commandSerial('c','on',call,()=>now),{status:409});
  assert.equal(device('C',s,now+46000).pending,false);
  s.reported.config={fan:{...s.desired.config.fan}};
  assert.equal(device('C',s,now).pending,false);
});
test('device routes scope reads, settings and fan commands to the authenticated account', async t => {
  const shadows = [];
  const writes = [];
  Object.assign(process.env,{NRF_ORG:'test',NRF_PROJECT:'test',DRYSPOOL_OAT:'test-only',
    SUPABASE_URL:'https://accounts.example.test', SUPABASE_PUBLISHABLE_KEY:'testing',
    SUPABASE_SERVICE_ROLE_KEY:'test-service-only'});
  t.mock.method(globalThis, 'fetch', async (target, options) => {
    const url = new URL(target.toString());
    if (url.pathname === '/auth/v1/user') {
      const name = new Headers(options.headers).get('authorization')?.split(' ')[1];
      return ['alice','bob'].includes(name) ? Response.json({id:name,email:name+'@example.test'})
        : Response.json({msg:'Forbidden'},{status:401});
    }
    if (url.pathname === '/rest/v1/dryspool_devices') {
      const name = url.searchParams.get('owner_id')?.slice(3);
      assert.ok(['alice','bob'].includes(name), 'every query must filter the authenticated owner');
      const box = {serial:name+'-box',label:name+' workshop'};
      const filter = url.searchParams.get('serial');
      return Response.json(!filter || filter === 'eq.' + box.serial ? [box] : []);
    }
    shadows.push(url.pathname);
    if (options.method === 'GET') return Response.json(sample(Date.now()));
    writes.push(url.pathname);
    return new Response(null, {status:202});
  });
  const request = (path, token, method = 'GET', body) => new Request('https://example.test' + path,{
    method, headers:{authorization:'Bearer '+token,'content-type':'application/json'},
    body:body && JSON.stringify(body),
  });
  for (const name of ['alice','bob']) {
    const list = await GET(request('/api/devices',name));
    assert.equal(list.status,200);
    assert.deepEqual((await list.json()).map(d=>d.serial),[name+'-box']);
  }
  assert.equal((await GET(request('/api/devices','invalid'))).status,401);
  const bob = {params:Promise.resolve({serial:'bob-box'})};
  const before = shadows.length;
  assert.equal((await detail(request('/api/devices/bob-box','alice'),bob)).status,404);
  assert.equal((await rename(request('/api/devices/bob-box','alice','PATCH',{label:'other'}),bob)).status,404);
  assert.equal((await editFilament(request('/api/devices/bob-box/filament','alice','PUT',
    {profile:{material:'PETG',color:'Blue'}}),bob)).status,404);
  assert.equal((await POST(request('/api/id-bob-box/fan','alice','POST',{mode:'auto'}),
    {params:Promise.resolve({slot:'id-bob-box'})})).status,404);
  assert.equal(shadows.length,before);
  assert.equal((await POST(request('/api/id-alice-box/fan','alice','POST',{mode:'auto'}),
    {params:Promise.resolve({slot:'id-alice-box'})})).status,202);
  assert.deepEqual(writes,['/v1/organizations/test/projects/test/long-range/devices/alice-box/state']);
});
test('mutating endpoints require same-origin JSON', async () => {
  const url='https://example.test/api/A/fan';
  const body='{"mode":"auto"}';
  const make=origin=>new Request(url,{method:'POST',headers:{origin,'content-type':'application/json'},body});
  assert.deepEqual(await input(make('https://example.test')), {mode:'auto'});
  await assert.rejects(input(make('https://another.test')),{status:403});
});
test('browser origin is matched against the public Host behind the Next listener', async () => {
  const req=new Request('http://localhost:3000/api/A/fan', {method:'POST',
    headers:{host:'127.0.0.1:3000',origin:'http://127.0.0.1:3000','content-type':'application/json'},
    body:'{"mode":"on"}'});
  assert.deepEqual(await input(req),{mode:'on'});
});

test('owned fleet supports zero, one, and ten boxes, including failed and missing shadows', async () => {
  for (const count of [0, 1, 10]) {
    const boxes = Array.from({length:count},(_,i)=>({serial:'box-'+i,label:'Box '+i}));
    const rows = await ownedFleet(boxes,async serial => {
      if (serial==='box-1') throw Error();
      return serial==='box-2' ? {} : sample(Date.now());
    });
    assert.equal(rows.length,count);
    assert.equal(new Set(rows.map(row=>row.serial)).size,count);
    if (count===10) {
      assert.equal(rows[0].control,true);
      assert.equal(rows[1].control,false);
      assert.ok(rows[1].error);
      assert.equal(rows[2].ts,0);
    }
  }
});

test('storage guidance needs a verified material and never guesses unknown limits', () => {
  assert.equal(storageGuidance('PETG',22).above,true);
  assert.equal(storageGuidance('PLA',25).max,30);
  assert.equal(storageGuidance('PA11-CF',25),null);
  assert.equal(storageGuidance(null,20),null);
});

test('device reports do not supply filament metadata', () => {
  const shadow = sample();
  shadow.reported.dryspool.spool = {material:'PETG',color:'Blue'};
  shadow.reported.dryspool.spool_valid = true;
  assert.equal(device('A',shadow,now).spool,null);
});
