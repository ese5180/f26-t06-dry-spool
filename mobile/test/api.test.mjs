import assert from 'node:assert/strict';
import test from 'node:test';
import { command, device, deviceId, devices, state } from '../lib/cloud.mjs';
import { input } from '../lib/http.mjs';
import { login, requireSession } from '../lib/session.mjs';

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
test('login cookie is signed, expires, and rejects arbitrary requests', () => {
  process.env.DRYSPOOL_PASSWORD = 'local-only-test-value';
  const req = new Request('https://example.test');
  assert.throws(()=>login(req,'wrong',now),{status:401});
  const cookie=login(req,process.env.DRYSPOOL_PASSWORD,now);
  assert.match(cookie,/HttpOnly/);
  assert.match(cookie,/; Secure/);
  const headers={ cookie: cookie.split(';')[0] };
  const signed = new Request(req,{headers});
  requireSession(signed,now+5000);
  assert.throws(()=>requireSession(signed,now+12*3600000),{status:401});
  assert.throws(()=>requireSession(new Request(req,{headers:{cookie:headers.cookie+'a'}}),now),{status:401});
});
test('mutating endpoints require same-origin JSON', async () => {
  const url='https://example.test/api/login';
  const body='{"password":"123"}';
  const make=origin=>new Request(url,{method:'POST',headers:{origin,'content-type':'application/json'},body});
  assert.deepEqual(await input(make('https://example.test')), {password:'123'});
  await assert.rejects(input(make('https://another.test')),{status:403});
});
test('browser origin is matched against the public Host behind the Next listener', async () => {
  const req=new Request('http://localhost:3000/api/login', {method:'POST',
    headers:{host:'127.0.0.1:3000',origin:'http://127.0.0.1:3000','content-type':'application/json'},
    body:'{"password":"local"}'});
  assert.deepEqual(await input(req),{password:'local'});
});
