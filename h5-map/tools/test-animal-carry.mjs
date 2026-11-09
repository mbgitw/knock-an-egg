import test from 'node:test';
import assert from 'node:assert/strict';
import {AnimalCarryState,pickupRadius} from '../public/gameplay/animal-carry-state.js';
import {PickaxeProgress} from '../public/gameplay/pickaxe-state.js';
import {TreadmillState} from '../public/treadmill-state.js';
import fs from 'node:fs';
import {EggWorld} from '../public/gameplay/egg-world.js';

const config=JSON.parse(fs.readFileSync(new URL('../public/gameplay/zone-entry/config.json',import.meta.url)));
const center=box=>({x:box.matrix[3],y:0,z:box.matrix[11]});
const home=center(config.zones[0].hitbox),safe=center(config.safe),outside=center(config.zones[1].hitbox);
function setup(bank=()=>true){const state=new AnimalCarryState({...config,bank}),pet={id:'zone1-egg-0:0',name:'Chicken',zone:1};return {state,a:state.add(pet,home),pet};}
function carry(s,a,p=a.position){assert.ok(s.begin(a.id,p));assert.equal(s.advance(1.4,p,{held:true}),a);}
test('presentation has no timer until ready; a new ready instance starts at 45, duplicate rejected',()=>{
  const s=new AnimalCarryState(config);s.advance(20,home);assert.equal(s.animals.size,0);
  const a=s.add({id:'a',zone:1},home);assert.equal(a.remaining,45);assert.equal(s.add(a.pet,home),null);
});
test('strict 3D v2 radius includes scale growth and rejects equality/height-only separation',()=>{
  const {state:s,a}=setup();const r=pickupRadius();assert.equal(r,10.714285714285714);
  assert.ok(s.canPick(a,{...home,x:home.x+r-.001}));assert.ok(!s.canPick(a,{...home,y:home.y+r}));
  assert.ok(!s.canPick(a,{...home,x:home.x+8,y:home.y+8}));a.scale=3;
  assert.ok(s.canPick(a,{...home,x:home.x+12}));assert.equal(pickupRadius(.1),r);
});
test('continuous hold takes full 1.4s; releasing or changing targets cannot accumulate',()=>{
  const {state:s,a}=setup();s.begin(a.id,home);s.advance(.7,home,{held:true});s.advance(.1,home,{held:false});assert.equal(s.hold,null);
  s.begin(a.id,home);assert.equal(s.advance(1.39,home,{held:true}),null);assert.equal(s.advance(.01,home,{held:true}),a);
  assert.equal(s.begin(a.id,home),false);
});
test('distance, menus and knockback cancel the hold and require a fresh press',()=>{
  for(const options of [{blocked:true,held:true},{held:false}]){const {state:s,a}=setup();s.begin(a.id,home);s.advance(.8,home,{held:true});s.advance(.7,home,options);assert.equal(s.hold,null);assert.equal(s.carrying,null);}
  const {state:s,a}=setup();s.begin(a.id,home);s.advance(.9,outside,{held:true});s.advance(2,home,{held:true});assert.equal(s.carrying,null);
});
test('only one instance can be carried and original attribution never gates pickup',()=>{
  const {state:s,a}=setup();a.pet.hatchedBy='another-player';carry(s,a);const b=s.add({id:'b',zone:1},home);
  assert.equal(s.canPick(b,home),false);assert.equal(s.begin(b.id,home),false);assert.equal(s.nearest(home),null);assert.equal(s.remove(a.id),false);
});
test('carry pauses; inside drop returns home and resumes remaining time without reset',()=>{
  const {state:s,a}=setup();s.advance(10,home);carry(s,a);const remaining=a.remaining;
  s.advance(100,home);assert.equal(a.remaining,remaining);s.drop({...home,z:home.z+10});assert.deepEqual(a.position,home);
  s.advance(2,home);assert.equal(a.remaining,remaining-2);carry(s,a);assert.ok(a.remaining<remaining);s.advance(100,home);assert.equal(a.status,'carrying');
});
test('outside drop stays there; returning to source area uses current region, not historical crossing',()=>{
  const {state:s,a}=setup();carry(s,a);s.drop(outside);assert.deepEqual(a.position,outside);
  carry(s,a,outside);s.drop({...home,z:home.z+8});assert.deepEqual(a.position,home);
});
test('leave returns home; ordinary outside drop remains a unique pickup',()=>{
  const {state:s,a}=setup();carry(s,a);s.drop(outside,{returnHome:true});assert.deepEqual(a.position,home);assert.equal(s.animals.size,1);assert.equal(s.carrying,null);
});
test('expiration wins over a pending hold; expired animals cannot be picked or banked',()=>{
  const {state:s,a}=setup();s.advance(44,home);s.begin(a.id,home);assert.equal(s.advance(1.4,home,{held:true}),null);
  assert.equal(a.status,'despawning');assert.equal(a.remaining,0);assert.equal(s.secure(safe),null);assert.equal(s.begin(a.id,home),false);
});
test('safe delivery is one-time, not source-zone exit; full inventory keeps carrying paused',()=>{
  let count=0;const {state:s,a}=setup(()=>{count++;return true;});carry(s,a);
  assert.equal(s.secure(outside),null);assert.equal(count,0);assert.equal(s.secure(safe),a);assert.equal(s.secure(safe),null);assert.equal(count,1);assert.equal(a.status,'banked');
  const {state:t,a:b}=setup(()=>false);carry(t,b);assert.equal(t.secure(safe),null);assert.equal(t.carrying,b);t.advance(99,safe);assert.ok(b.remaining>0);
});
test('hatch only rolls; bank saves once, reload keeps banked inventory but discards unbanked instances',()=>{
  const memory=new Map(),storage={getItem:k=>memory.get(k),setItem:(k,v)=>memory.set(k,v)};
  const account=new TreadmillState({storage}),p=new PickaxeProgress(account),pet=p.hatch('zone1-egg-0:0',()=>0);
  assert.equal(p.data.pets.length,0);assert.equal(p.sell(pet.id),false);assert.equal(p.bank({...pet}),false);
  assert.ok(p.bank(pet));assert.equal(p.bank(pet),false);const pending=p.hatch('zone1-egg-1:0',()=>0);
  const q=new PickaxeProgress(new TreadmillState({storage}));assert.equal(q.data.pets.length,1);assert.equal(q.bank(pending),false);assert.equal(q.hatch(pending.id),null);
  assert.ok(q.sell(pet.id));assert.equal(q.sell(pet.id),false);
});
test('bank save failure remains dirty for retry without creating another copy',()=>{
  const account=new TreadmillState({storage:{getItem:()=>null,setItem:()=>{throw Error('offline');}}}),p=new PickaxeProgress(account),pet=p.hatch('zone1-egg-0:0',()=>0);
  assert.equal(p.bank(pet),false);assert.ok(account.dirty);assert.equal(p.data.pets.length,0);assert.equal(p.pendingPets.get(pet.id),pet);
  account.storage={setItem(){}};assert.ok(p.bank(pet));assert.equal(p.bank(pet),false);assert.equal(p.data.pets.length,1);
});
test('a throttled frame counts real ground time but cannot credit a suspended hold',()=>{
  const {state:s,a}=setup();s.begin(a.id,home);assert.equal(s.advance(10,home,{held:true,holdDt:.05}),null);assert.equal(a.remaining,35);assert.equal(s.hold.elapsed,.05);
});
test('egg wall-clock respawn cannot discard an unfinished animal reveal or duplicate it',()=>{
  let reveals=0;const e={pet:{id:'zone1-egg-0:0'}},world={nestInstances:{remove(){}},reveal:async pet=>{assert.equal(pet,e.pet);reveals++;}};
  EggWorld.prototype.remove.call(world,e);assert.equal(reveals,1);assert.equal(e.opened,true);
  EggWorld.prototype.remove.call(world,e);assert.equal(reveals,1);
});

test('landing permits pickup during look presentation without starting lifetime early',()=>{
 const s=new AnimalCarryState(config),a=s.add({id:'early',zone:1},home,1,2.5);
 assert.equal(s.nearest(home),a);assert.ok(s.begin(a.id,home));
 assert.equal(s.advance(1.4,home,{held:true}),a);assert.equal(a.remaining,45);
 s.advance(2,home);assert.equal(a.lookRemaining,0);assert.equal(a.remaining,45);
 s.drop(home);s.advance(1,home);assert.equal(a.remaining,44);
});
test('unpicked look period counts only time beyond presentation; early drop does not restart it',()=>{
 const s=new AnimalCarryState(config),a=s.add({id:'look',zone:1},home,1,2.5);
 s.advance(3,home);assert.equal(a.remaining,44.5);
 const b=s.add({id:'drop',zone:1},home,1,2.5);carry(s,b);s.drop(home);
 assert.ok(Math.abs(b.lookRemaining-1.1)<1e-9);s.advance(1.6,home);assert.equal(b.remaining,44.5);
});
