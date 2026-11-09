import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {build} from 'esbuild';
import {fileURLToPath} from 'node:url';
import {encodeMove,decodeMove,encodeMoves,decodeMoves} from '../public/online/protocol.js';

const root=fileURLToPath(new URL('../',import.meta.url));
await build({stdin:{contents:"export * from './server/game/world.ts';export * from './server/game/eggs.ts';",resolveDir:root},bundle:true,format:'esm',platform:'node',outfile:root+'build/online-byte-boundary.mjs'});
const {createWorld,join,acceptMove,createEggEngine,hitEgg}=await import('../build/online-byte-boundary.mjs');
const foreign=bytes=>vm.runInNewContext('new Uint8Array([77,88,...packet,99]).subarray(2,2+packet.length)',{packet:Array.from(bytes)});
const forms=[['byte list',bytes=>Array.from(bytes)],['foreign byte view',foreign]];
const point={sequence:0x01020304,x:1,y:.5,z:-2,yaw:0,flags:3};
const fixture=[1,4,3,2,1,0,0,128,63,0,0,0,63,0,0,0,192,0,0,0,0,3,0];

test('wire format stays identical for byte lists and foreign views with nonzero offsets',()=>{
  assert.deepEqual(Array.from(encodeMove(point)),fixture);
  for(const [name,convert] of forms){const input=convert(fixture);assert.equal(input instanceof Uint8Array,false,name);assert.deepEqual(decodeMove(input),point,name);}
});

test('byte normalization rejects coercion, holes, wrong lengths, versions and non-finite positions',()=>{
  for(const value of [-1,256,.5,NaN,Infinity,undefined,'1',null]){const bad=fixture.slice();bad[5]=value;assert.throws(()=>decodeMove(bad));}
  const hole=fixture.slice();delete hole[5];assert.throws(()=>decodeMove(hole));
  for(const input of [null,fixture.join(''),fixture.slice(1),[...fixture,0],{length:1e9},[2,...fixture.slice(1)]])assert.throws(()=>decodeMove(input));
  const nan=Uint8Array.from(fixture);new DataView(nan.buffer).setFloat32(5,NaN,true);assert.throws(()=>decodeMove(Array.from(nan)));
});

test('remote movement batches preserve slots and timestamps across transport byte representations',()=>{
  const players=[{...point,slot:0},{...point,sequence:9,x:-8,slot:6}],packet=encodeMoves(players,12345);
  for(const [,convert] of forms){assert.deepEqual(decodeMoves(convert(packet)),{time:12345,players});assert.throws(()=>decodeMoves(convert(packet.slice(1))));}
  const bad=Array.from(packet);bad[30]=0;assert.throws(()=>decodeMoves(bad),/INVALID_SLOT/);
});

for(const [name,convert] of forms)test(`client movement survives checkpoint, accepts jumps and rejects replay: ${name}`,()=>{
  let state=createWorld(),p=join(state,'player','seat',{...point,sequence:0,x:0,z:0});p.loaded=p.active=true;
  for(let i=1;i<=30;i++){
    state.elapsed+=100;
    assert.equal(acceptMove(state,p,convert(encodeMove({...point,sequence:i,x:i*.8,z:0}))),true,`move ${i}`);
    if(i===15){state=JSON.parse(JSON.stringify(state));p=state.players.player;}
  }
  assert.ok(Math.abs(p.position.x-24)<.001);
  state.elapsed+=100;
  assert.equal(acceptMove(state,p,convert(encodeMove({...point,sequence:30,x:24,z:0}))),false);
  assert.equal(acceptMove(state,p,convert(encodeMove({...point,sequence:31,x:500,z:0}))),true);
  assert.equal(p.position.x,500);
});

test('moving to an egg through host byte lists enables authoritative hits',()=>{
  const engine=createEggEngine(()=>.5,()=>{});engine.initialize(null,0);const egg=engine.eggs[0];
  const [x,,z]=egg.spec.position,state=createWorld();
  const p=join(state,'player','seat',{sequence:0,x:x+50,y:egg.spec.floorY,z,yaw:0,flags:1});p.loaded=p.active=true;
  const hit={id:1,egg:egg.spec.id,generation:egg.life.generation};
  assert.equal(hitEgg(engine,p,hit,1,()=>.5),null);
  for(let i=1;i<=50;i++){state.elapsed+=100;assert.equal(acceptMove(state,p,Array.from(encodeMove({...p.position,sequence:i,x:x+50-i}))),true);}
  const before=egg.life.hp;assert.ok(hitEgg(engine,p,hit,state.elapsed/1000,()=>.5));assert.ok(egg.life.hp<before);
});
