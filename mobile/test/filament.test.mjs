import assert from 'node:assert/strict';
import test from 'node:test';
import { device, saveFilament } from '../lib/cloud.mjs';
import { filamentProfile, savedFilament } from '../lib/filament.mjs';
import { PUT } from '../app/api/devices/[serial]/filament/route.js';

const now = 1800000000000;
test('manual profiles validate text and optional swatches without accepting caller-supplied provenance', () => {
  assert.deepEqual(filamentProfile({material:' PETG ',color:' Blue ',colorHex:'#123abc',source:'openprinttag'}),
    {material:'PETG',color:'Blue',colorHex:'#123ABC',brand:''});
  for (const value of [null, [], {material:'',color:'Blue'}, {material:'PLA',color:''},
    {material:'a'.repeat(41),color:'Blue'}, {material:'PLA',color:17},
    {material:'PLA',color:'a'.repeat(81)}, {material:'PLA',color:'Blue',brand:'a'.repeat(81)},
    {material:'PLA',color:'Blue',colorHex:'red'}, {material:'PLA\nPETG',color:'Blue'}]) {
    assert.throws(() => filamentProfile(value), {status:400});
  }
  assert.equal(savedFilament({material:'PLA',color:'Blue'}),null);
});

test('saving only changes selected-box metadata, survives reload while offline, and leaves telemetry/fan intact', async () => {
  const fan = {mode:'off',request:7,expires:1900000000};
  const reported = {dryspool:{sample_ms:now-120000,env_valid:true,humidity_mpct:27000,grams_valid:false},
    config:{fan:{...fan}}};
  const shadow = {desired:{config:{fan}},reported};
  const writes = [];
  const read = async (id, patch) => {
    assert.equal(id,'box-1');
    if (patch) {
      writes.push(patch);
      Object.assign(shadow.desired.config,patch.desired.config);
    }
    return structuredClone(shadow);
  };
  const saved = await saveFilament('box-1',{material:'PETG',color:'Blue',brand:'Example'},read,()=>now);
  assert.equal(writes.length,1);
  assert.deepEqual(Object.keys(writes[0].desired.config),['filament']);
  assert.deepEqual(shadow.desired.config.fan,fan);
  assert.deepEqual(shadow.reported,reported);
  const reloaded = device('id-box-1',await read('box-1'),now);
  assert.deepEqual(reloaded.spool,saved);
  assert.equal(reloaded.online,false);
  assert.equal(reloaded.humidity,27);
  assert.equal(reloaded.grams,null);
  assert.equal(reloaded.control,false);
  shadow.reported.dryspool.spool_valid = true;
  shadow.reported.dryspool.spool = {material:'PLA',color:'Orange',source:'openprinttag'};
  assert.equal(device('id-box-1',shadow,now).spool.source,'manual');
  assert.equal(device('id-box-2',{},now).spool,null);
  await assert.rejects(saveFilament('box-1',{material:'PLA',color:'Blue'},async()=>{throw Error('Unavailable');}));
});

test('profile API authenticates, rejects invalid/cross-origin input before cloud writes, and returns the stored profile', async t => {
  Object.assign(process.env,{NRF_ORG:'test',NRF_PROJECT:'test',DRYSPOOL_OAT:'test-only',
    SUPABASE_URL:'https://accounts.example.test',SUPABASE_PUBLISHABLE_KEY:'testing',
    SUPABASE_SERVICE_ROLE_KEY:'test-service-only'});
  const writes=[];
  t.mock.method(globalThis,'fetch',async (target,options)=>{
    const url=new URL(target.toString());
    if(url.pathname==='/auth/v1/user') return new Headers(options.headers).get('authorization')==='Bearer alice'
      ? Response.json({id:'alice'}) : Response.json({msg:'Forbidden'},{status:401});
    if(url.pathname==='/rest/v1/dryspool_devices') {
      assert.equal(url.searchParams.get('owner_id'),'eq.alice');
      return Response.json(url.searchParams.get('serial')==='eq.alice-box'?[{serial:'alice-box',label:'My box'}]:[]);
    }
    assert.ok(url.pathname.endsWith('/devices/alice-box/state'));
    assert.equal(options.method,'PATCH');
    writes.push(JSON.parse(options.body));
    return new Response(null,{status:202});
  });
  const context={params:Promise.resolve({serial:'alice-box'})};
  const request=(body,headers={})=>new Request('https://example.test/api/devices/alice-box/filament',{
    method:'PUT',headers:{authorization:'Bearer alice','content-type':'application/json',...headers},body:JSON.stringify(body)});
  assert.equal((await PUT(request({profile:{material:'PLA',color:'Blue'}},{authorization:'Bearer invalid'}),context)).status,401);
  assert.equal((await PUT(request({profile:{material:'PLA',color:'Blue'}},{origin:'https://attacker.test'}),context)).status,403);
  assert.equal((await PUT(request({profile:{material:'PLA',color:''}}),context)).status,400);
  assert.equal((await PUT(request({profile:{material:'PLA',color:'x'.repeat(1100)}}),context)).status,413);
  assert.equal(writes.length,0);
  const response=await PUT(request({profile:{material:'PETG',color:'Blue',colorHex:'#123abc',source:'openprinttag'}}),context);
  assert.equal(response.status,200);
  assert.equal(response.headers.get('cache-control'),'private, no-store');
  const {profile}=await response.json();
  assert.equal(profile.source,'manual');
  assert.equal(profile.colorHex,'#123ABC');
  assert.deepEqual(writes,[{desired:{config:{filament:profile}}}]);
});
