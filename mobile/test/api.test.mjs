import assert from 'node:assert/strict';
import test from 'node:test';
import { command, device, deviceId, devices, state } from '../lib/cloud.mjs';
import { input } from '../lib/http.mjs';
import { GET } from '../app/api/devices/route.js';
import { POST } from '../app/api/[slot]/fan/route.js';

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
test('three independent cloud IDs and isolated slot errors', async () => {
  const env={NRF_DEVICE_A:'id-A',NRF_DEVICE_B:'id-B',NRF_DEVICE_C:'id-C'};
  assert.equal(deviceId('C',env),'id-C');
  assert.throws(()=>deviceId('C',{...env,NRF_DEVICE_C:'id-a'}),{status:503});
  assert.throws(()=>deviceId('C',{...env,NRF_DEVICE_C:''}),{status:503});
  const boxes=await devices(async slot=>{
    if(slot==='B') throw Error();
    return sample(Date.now());
  });
  assert.deepEqual(boxes.map(b=>[b.slot,b.control]),[['A',true],['B',false],['C',true]]);
});
test('C gets its own state URL and acknowledgement; stale commands expire', async () => {
  const s=sample();
  Object.assign(process.env,{NRF_ORG:'test',NRF_PROJECT:'test',NRF_DEVICE_A:'a',NRF_DEVICE_B:'b',NRF_DEVICE_C:'c',DRYSPOOL_OAT:'test-only'});
  const calls=[];
  const call=(slot,patch)=>state(slot,patch,async (url,options)=>{
    calls.push([url,options.method]);
    if(options.method==='GET') return Response.json(s);
    s.desired=JSON.parse(options.body).desired;
    return new Response(null,{status:202});
  });
  const {request}=await command('C','off',call,()=>now);
  assert.ok(calls.every(([url])=>url.endsWith('/devices/c/state')));
  assert.deepEqual(calls.map(x=>x[1]),['GET','PATCH']);
  assert.equal(s.desired.config.fan.request,request);
  assert.ok(device('C',s,now).pending);
  await assert.rejects(command('C','on',call,()=>now),{status:409});
  assert.equal(device('C',s,now+46000).pending,false);
  s.reported.config={fan:{...s.desired.config.fan}};
  assert.equal(device('C',s,now).pending,false);
  await assert.rejects(command('D','on',call,()=>now),{status:404});
});
test('dashboard works without a session and only operates a ready fan', async t => {
  const writes = [];
  Object.assign(process.env,{NRF_ORG:'test',NRF_PROJECT:'test',NRF_DEVICE_A:'a',NRF_DEVICE_B:'b',NRF_DEVICE_C:'c',DRYSPOOL_OAT:'test-only'});
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    if (options.method === 'GET') return Response.json(sample(url.endsWith('/c/state') ? 0 : Date.now()));
    writes.push(url);
    return new Response(null, {status:202});
  });
  const list = await GET(new Request('https://example.test/api/devices'));
  assert.equal(list.status,200);
  assert.deepEqual((await list.json()).map(d=>d.slot),['A','B','C']);
  const request = slot => new Request('https://example.test/api/' + slot + '/fan',{method:'POST',
    headers:{origin:'https://example.test','content-type':'application/json'},body:'{"mode":"auto"}'});
  for (const [slot, status] of [['C',409],['B',202]]) {
    const response = await POST(request(slot),{params:Promise.resolve({slot})});
    assert.equal(response.status,status);
  }
  assert.equal(writes.length,1);
  assert.ok(writes[0].endsWith('/b/state'));
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
