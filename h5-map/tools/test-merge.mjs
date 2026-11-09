import test from 'node:test';import assert from 'node:assert/strict';
import {TreadmillState,restoreState} from '../public/treadmill-state.js';
import {MergeState,growthSeconds,variantOdds} from '../public/gameplay/merge-state.js';
import {mergeEggImage} from '../public/gameplay/merge-egg-image.js';
import {PAID_SPECIES,paidPetImage} from '../public/gameplay/commerce/paid-species.js';
import {existsSync} from 'node:fs';
const pets=()=>[1,2,3].map(i=>({id:`zone1-egg-${i}:0`,name:'Cat',zone:1,weightKg:i*10}));
test('all six paid species merge into identifiable eggs without becoming purchased bags',()=>{
 for(const species of PAID_SPECIES){
  const a=new TreadmillState();a.data.pickaxes.pets=[1,2,3].map(i=>({id:`merge:paid-${i}`,name:species.name,weightKg:species.baseKg,paidType:'FallenAngel'}));
  const m=new MergeState(a,{id:()=> 'merge:paid-result',random:()=>.99});
  const egg=m.merge(a.data.pickaxes.pets.map(p=>p.id));assert.ok(egg);
  assert.equal(egg.paidType,undefined);assert.equal(egg.weightKg,species.baseKg*3);
  assert.equal(egg.duration,growthSeconds(egg.weightKg,species.rarity));
  const image=mergeEggImage(egg);assert.equal(image,paidPetImage(species.name));assert.ok(existsSync(new URL(image)));
  assert.equal(mergeEggImage(species.name),image);assert.equal(mergeEggImage(restoreState(a.data).mergeEggs[0]),image);
  assert.match(mergeEggImage({...egg,paidType:'FallenAngel'}),/83525826842415\.png$/);
 }
 assert.match(mergeEggImage({name:'Cat'}),/egg-82614480241126\.png$/);
});
function setup(){let now=1000;const a=new TreadmillState();a.data.pickaxes.pets=pets().slice(0,2);a.data.plot.pets=[{...pets()[2],position:[0,0,0],yaw:0}];return {a,m:new MergeState(a,{now:()=>now,random:()=>.99,id:()=> 'merge:unit-test'}),time:n=>now=n};}
test('merge consumes three same-species owned pets across bag and pasture once',()=>{const {a,m}=setup();const egg=m.merge(pets().map(p=>p.id));assert.equal(egg.weightKg,60);assert.equal(a.data.plot.pets.length,0);assert.equal(a.data.pickaxes.pets.length,0);assert.equal(a.data.mergeEggs.length,1);assert.equal(m.merge(pets().map(p=>p.id)),null);assert.equal(restoreState(a.data).mergeEggs.length,1);});
test('invalid selection never consumes, including duplicates, missing ownership and wrong species',()=>{const {a,m}=setup(),ids=pets().map(p=>p.id);assert.equal(m.merge([ids[0],ids[0],ids[2]]),null);assert.equal(m.merge([...ids.slice(0,2),'missing']),null);a.data.pickaxes.pets[0].name='Anteater';assert.equal(m.merge(ids),null);assert.equal(a.data.pickaxes.pets.length,2);});
test('save failures roll back every container for merge, place, hatch and grant',()=>{const {a,m,time}=setup();const initial=JSON.stringify(a.data);a.save=()=>false;assert.equal(m.merge(pets().map(p=>p.id)),null);assert.equal(JSON.stringify(a.data),initial);a.save=()=>true;const e=m.merge(pets().map(p=>p.id));a.save=()=>false;assert.equal(m.place(e.id,[0,0,0]),false);assert.equal(a.data.mergeEggs.length,1);a.save=()=>true;m.place(e.id,[0,0,0]);time(11000);a.save=()=>false;assert.equal(m.hatch(e.id),false);a.save=()=>true;assert.equal(m.hatch(e.id),true);time(17200);a.save=()=>false;assert.deepEqual(m.finish(),[]);assert.equal(a.data.growingEggs.length,1);a.save=()=>true;assert.equal(m.finish().length,1);assert.equal(m.finish().length,0);});
test('growth begins on placement; readiness and 6.2 second reveal survive restore',()=>{const {a,m,time}=setup(),e=m.merge(pets().map(p=>p.id));time(100000);assert.equal(m.place(e.id,[1,2,3]),true);assert.equal(m.hatch(e.id),false);time(110000);assert.equal(m.hatch(e.id),true);assert.equal(m.hatch(e.id),false);a.data=restoreState(a.data);time(116199);assert.equal(m.finish().length,0);time(116200);assert.equal(m.finish().length,1);const restored=restoreState(a.data);assert.equal(restored.pickaxes.pets[0].weightKg,60);assert.equal(restored.pickaxes.pets[0].id,e.id);assert.equal(restored.growingEggs.length,0);});
test('source growth formula and cumulative variant probabilities',()=>{assert.equal(growthSeconds(150,'Common'),10);assert.equal(growthSeconds(150,'Omega'),50);assert.equal(growthSeconds(1e30,'Omega'),604800);const o=variantOdds([{variant:'Diamond'},{variant:'Gold'},{}]);assert.ok(Math.abs(o.Diamond-1/3)<1e-10);assert.ok(Math.abs(o.Gold-4/9)<1e-10);assert.deepEqual(variantOdds(Array(3).fill({variant:'Gold'})),{Diamond:0,Gold:1,Normal:0});});
