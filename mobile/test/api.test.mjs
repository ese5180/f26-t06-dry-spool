import assert from 'node:assert/strict';
import test from 'node:test';
import { command, devices } from '../lib/cloud.mjs';
import { input } from '../lib/http.mjs';
import { login, requireSession } from '../lib/session.mjs';

const now = 1800000000000;
const reading = { online: true, control: true, fan: true, temperature: 21.5, mode: 'auto', request: 10 };
function sample() {
  return { reported: { dryspool: { A: reading, B: { ...reading, online: false } } },
    metadata: { reported: { dryspool: { A: { seq: { timestamp: now/1000 } } } } } };
}
test('only live healthy outputs can be commanded', () => {
  const [a,b] = devices(sample(), now);
  assert.equal(a.temperature, 21.5);
  assert.equal(a.control,true);
  assert.equal(b.control,false);
  assert.equal(devices(sample(), now+46000)[0].online, false);
});
test('only the target slot is patched, and an exact device acknowledgement completes the request', async () => {
  const s = sample();
  const send = async patch => {
    if (!patch) return s;
    assert.deepEqual(Object.keys(patch.desired.config), ['A']);
    s.desired = patch.desired;
  };
  const { request } = await command('A','off',send,()=>now);
  assert.ok(request > 0);
  assert.ok(devices(s, now)[0].pending);
  await assert.rejects(command('A','on',send,()=>now), { status: 409 });
  await assert.rejects(command('B','on',send,()=>now), { status: 409 });
  s.reported.config = { A: { ...s.desired.config.A, request: request+1 } };
  assert.ok(devices(s, now)[0].pending);
  s.reported.config.A.request = request;
  assert.equal(devices(s,now)[0].pending,false);
});
test('expired shadow commands do not block subsequent control', async () => {
  const s = sample();
  s.desired={config:{A:{request:77,mode:'off',expires:now/1000-1}}};
  assert.equal(devices(s,now)[0].pending,false);
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
