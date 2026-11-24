import assert from 'node:assert/strict';
import test from 'node:test';
import {commandSerial, device, readFleet, readShadow, configuredDevices} from '../lib/cloud.mjs';
import {input} from '../lib/http.mjs';
import {GET} from '../app/api/devices/route.js';
import {POST} from '../app/api/[slot]/fan/route.js';
const now = 1800000000000;
function sample(ts = now) {
 return {reported:{dryspool:{sample_ms:ts,fan_api:1,fan_valid:true,fan_on:true,
 env_valid:true,temperature_mc:21500,humidity_mpct:48750,grams_valid:true,filament_g:0,mode:'auto',request:10}}};
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

test('configured fleet supports zero, one, and ten boxes, including failed and missing shadows', async () => {
  for (const count of [0, 1, 10]) {
    const boxes = Array.from({length:count},(_,i)=>({serial:'box-'+i,label:'Box '+i}));
    const rows = await readFleet(boxes,async serial => {
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


test('public dashboard reads configured devices and restricts fan writes to same-origin configured targets', async t => {
 Object.assign(process.env,{NRF_ORG:'test',NRF_PROJECT:'test',DRYSPOOL_OAT:'test-only',NRF_DEVICE_A:'box-a',NRF_DEVICE_B:'box-b',NRF_DEVICE_C:''});
 const writes=[];
 t.mock.method(globalThis,'fetch',async (url,options) => {
   if(options.method === 'GET') return Response.json(sample(Date.now()));
   writes.push(url);return new Response(null,{status:202});
 });
 const list = await GET();
 assert.equal(list.status,200);
 assert.deepEqual((await list.json()).map(x=>x.serial),['box-a','box-b']);
 const req = origin => new Request('https://example.test/api/id-box-a/fan',{method:'POST',headers:{origin,'content-type':'application/json'},body:'{"mode":"off"}'});
 const params = serial => ({params:Promise.resolve({slot:'id-'+serial})});
 assert.equal((await POST(req('https://other.test'),params('box-a'))).status,403);
 assert.equal((await POST(req('https://example.test'),params('unconfigured'))).status,404);
 assert.equal(writes.length,0);
 assert.equal((await POST(req('https://example.test'),params('box-a'))).status,202);
 assert.equal(writes.length,1);
 assert.ok(writes[0].endsWith('/devices/box-a/state'));
 assert.deepEqual(configuredDevices({NRF_DEVICE_A:'same',NRF_DEVICE_B:'same'}),[{serial:'same',label:'Box A'}]);
});
