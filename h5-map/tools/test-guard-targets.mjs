import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
await build({entryPoints:['server/game/guards.ts'],bundle:true,format:'esm',platform:'node',outfile:'build/guard-targets-test.mjs'});
const {createGuards,chooseTarget,updateGuards,saveGuards}=await import('../build/guard-targets-test.mjs');
const guards=()=>createGuards(()=>.5,()=>{});
const target=(b,id='carrier',extra={})=>({id,position:b.home.clone(),power:1,carrying:{zone:b.definition.zone},safe:false,disabled:false,...extra});
const outside=b=>({x:b.home.x+10000,y:b.home.y,z:b.home.z+10000});

test('all ten guards retain their carrier outside the source zone, ahead of a closer player',()=>{
  for(const b of guards()){
    const carrier=target(b,'carrier',{position:outside(b)}),near=target(b,'near');
    b.target=carrier.id;b.state='Chasing';
    assert.equal(chooseTarget(b,[near,carrier]),carrier);
  }
});
test('outside-zone pickup and repickup acquire only the animal source guard',()=>{
  const brains=guards();
  for(const b of brains){
    const carrier=target(b,'carrier',{position:outside(b)});
    b.target=null;
    assert.equal(chooseTarget(b,[carrier]),carrier);
    assert.equal(chooseTarget(b,[{...carrier,carrying:null}]),null);
    assert.equal(chooseTarget(b,[carrier]),carrier);
    for(const other of brains)if(other!==b)assert.equal(chooseTarget(other,[carrier]),null);
  }
});
test('safe, protected, dropped, disconnected and changed-origin targets are released',()=>{
  const b=guards()[0],carrier=target(b,'carrier',{position:outside(b)});b.target=carrier.id;
  for(const extra of [{safe:true},{disabled:true},{carrying:null},{carrying:{zone:2}}]){
    assert.equal(chooseTarget(b,[{...carrier,...extra}]),null);
  }
  assert.equal(chooseTarget(b,[]),null);
});
test('without a valid old target the nearest eligible carrier wins, with stable ID ties',()=>{
  const b=guards()[0],a=target(b,'a'),z=target(b,'z'),far=target(b,'far',{position:outside(b)});
  b.target='gone';assert.equal(chooseTarget(b,[far,z,a]),a);
  b.target='far';assert.equal(chooseTarget(b,[far,z,a]),far);
  far.safe=true;assert.equal(chooseTarget(b,[far,z,a]),a);
});
test('Room ticks preserve cross-zone chase through snapshot restore and stop in safety',()=>{
  let b=guards()[0];const carrier=target(b,'carrier',{position:outside(b)});
  b.target=carrier.id;b.state='Chasing';b.position.x+=100;
  // Isolate target/state transitions from locomotion and catch geometry.
  const tick=()=>{b.move=()=>{};b.catches=()=>false;updateGuards([b],[carrier],.1);};
  tick();assert.equal(b.state,'Chasing');assert.equal(b.target,carrier.id);
  b=createGuards(()=>.5,()=>{},JSON.parse(JSON.stringify(saveGuards([b]))))[0];
  tick();assert.equal(b.state,'Chasing');assert.equal(b.target,carrier.id);
  carrier.safe=true;tick();assert.equal(b.state,'Returning');assert.equal(b.target,null);
  carrier.safe=false;tick();assert.equal(b.state,'WindUp');assert.equal(b.target,carrier.id);
});
