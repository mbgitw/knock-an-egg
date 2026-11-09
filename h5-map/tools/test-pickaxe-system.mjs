import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import fs from 'node:fs';
import {CONFIG} from '../public/gameplay/config.js';
import {PickaxeProgress,EggLife,SwingClock,restorePickaxes} from '../public/gameplay/pickaxe-state.js';
import {TreadmillState,SAVE_KEY} from '../public/treadmill-state.js';
import {pickHit} from '../public/gameplay/targeting.js';
import {money} from '../public/gameplay/currency.js';
import {inverseToolGrip,heldPickaxePose} from '../public/gameplay/pickaxe-pose.js';

test('all 20 authored grip points stay at the palm through character turns and swings',()=>{
  for(const tier of CONFIG.tiers)for(const yaw of [0,.7,Math.PI])for(const phase of [0,.28,.5,.62,.9]){
    const pose=heldPickaxePose(phase,true),palm=new THREE.Vector3(-2,3,4);
    const mount=new THREE.Matrix4().compose(palm,new THREE.Quaternion().setFromEuler(new THREE.Euler(pose.pitch,yaw,0,'YXZ')),new THREE.Vector3(1,1,1));
    const handle=mount.clone().multiply(inverseToolGrip(tier.grip));
    const gripPoint=new THREE.Vector3(+tier.grip.X,+tier.grip.Y,+tier.grip.Z).applyMatrix4(handle);
    assert.ok(gripPoint.distanceTo(palm)<1e-8,`tier ${tier.tier}`);
    const up=new THREE.Vector3(0,1,0).transformDirection(inverseToolGrip(tier.grip));assert.ok(up.y>.9999);
  }
});

test('idle and canceled swings hold upright with an extended arm; strike travels forward',()=>{
  for(const phase of [0,.2,.5,.8,1]){
    const idle=heldPickaxePose(phase,false);assert.equal(idle.pitch,0);assert.ok(idle.arm.z>.98&&Math.abs(idle.arm.y)<.15);
  }
  assert.ok(heldPickaxePose(.28,true).pitch<0);
  const impact=heldPickaxePose(.62,true);assert.ok(new THREE.Vector3(0,1,0).applyAxisAngle(new THREE.Vector3(1,0,0),impact.pitch).z>.9);
  assert.equal(heldPickaxePose(.9,true).pitch,0);
});
const storage=()=>{const m=new Map();return {getItem:k=>m.get(k)||null,setItem:(k,v)=>m.set(k,v)};};
test('20 original prices are exact; purchases, duplicate requests and insufficient cash',()=>{
  const account=new TreadmillState(),p=new PickaxeProgress(account);
  assert.equal(p.buy(3),false);assert.equal(p.buy(2),true);assert.equal(account.data.cash,20);assert.equal(p.buy(2),false);
  for(const t of CONFIG.tiers.slice(2)){account.creditCash(t.price);assert.ok(p.buy(t.tier));assert.equal(money(account.data.cash),20n);}
  assert.equal(CONFIG.tiers[19].price,'200000000000000000');assert.equal(p.data.owned.length,20);assert.equal(p.buy(21),false);
  assert.equal(p.equip(null),true);assert.equal(p.equip(1),true);
});
test('treadmill and pickaxes spend one wallet and persist in one snapshot',()=>{
  const s=storage(),a=new TreadmillState({storage:s}),p=new PickaxeProgress(a);p.buy(2);assert.equal(a.unlock(),false);
  a.creditCash(100);a.unlock();assert.equal(a.data.cash,20);const b=new TreadmillState({storage:s});const q=new PickaxeProgress(b);
  assert.equal(b.data.unlocked,true);assert.deepEqual(q.data.owned,[1,2]);assert.equal(q.data.equipped,2);assert.equal(b.data.cash,20);
  a.creditCash('200000000000000001');p.buy(20);assert.equal(money(a.data.cash),21n);
  assert.equal(JSON.parse(s.getItem(SAVE_KEY)).pickaxes.equipped,20);
});
test('hatch and sale each settle once, including after reloading',()=>{
  const s=storage(),a=new TreadmillState({storage:s}),p=new PickaxeProgress(a);const id='zone1-egg-722:0';
  let draws=0;const pet=p.hatch(id,()=>draws++? .95:0);assert.equal(pet.name,'Chicken');assert.equal(p.hatch(id),null);assert.equal(p.sell(id),false);assert.ok(p.bank(pet));assert.equal(p.sell(id),true);assert.equal(p.sell(id),false);assert.equal(a.data.cash,160);
  const q=new PickaxeProgress(new TreadmillState({storage:s}));assert.equal(q.hatch(id),null);assert.equal(q.data.pets.length,0);
});
test('corrupt inventory and cash recover without free premium equipment',()=>{
  const p=restorePickaxes({owned:[1,2,2,NaN,-1,21],equipped:20,pets:[{id:'<script>',name:'Chicken'}]});assert.deepEqual(p.owned,[1,2]);assert.equal(p.equipped,1);assert.equal(p.pets.length,0);
  const a=new TreadmillState({storage:{getItem:()=>'{',setItem:()=>{}}});assert.equal(a.data.cash,100);
});
test('one hit per swing and one death; respawn occurs at original 15 second delay',()=>{
  const e=new EggLife({health:5});assert.ok(e.hit(1,2,0));assert.equal(e.hit(1,2,.1),false);assert.ok(e.hit(2,4,.5));assert.equal(e.hp,0);assert.equal(e.hit(3,10,1),false);assert.equal(e.update(15.49),false);assert.equal(e.update(15.5),true);assert.equal(e.hp,5);assert.equal(e.generation,1);
});
test('swing cooldown, cancel and frame rate cannot multiply hits',()=>{
  for(const hz of [30,60,120]){const c=new SwingClock();assert.ok(c.start());assert.equal(c.start(),false);for(let i=0;i<hz/2;i++)c.advance(1/hz);assert.ok(c.start());assert.equal(c.id,2);c.cancel();assert.equal(c.active,false);assert.equal(c.start(false),false);}
});
test('targeting rejects behind, out of range, dead and wall-obstructed eggs',()=>{
  const make=(id,z)=>({spec:{id},life:{alive:true},center:new THREE.Vector3(0,2,z),bounds:new THREE.Box3(new THREE.Vector3(-1,1,z-1),new THREE.Vector3(1,3,z+1))});
  const a=make('a',4),behind=make('behind',-4),far=make('far',15),origin=new THREE.Vector3(0,2,0),forward=new THREE.Vector3(0,0,1),box=new THREE.Box3(new THREE.Vector3(-3,-1,-20),new THREE.Vector3(3,5,20));
  assert.equal(pickHit([behind,far,a],origin,forward,box,null),a);assert.equal(pickHit([a],origin,forward,box,{rayIntersect:()=>({distance:1})}),null);a.life.alive=false;assert.equal(pickHit([a],origin,forward,box,null),null);
});
test('14 stable source egg anchors; all models and source effect files remain present',()=>{
  const spawns=JSON.parse(fs.readFileSync(new URL('../public/gameplay/egg-spawns.json',import.meta.url)));assert.equal(spawns.length,14);assert.equal(new Set(spawns.map(x=>x.id)).size,14);
  for(const p of spawns){assert.ok(p.health>0);assert.equal(p.position.length,3);assert.ok(p.nodePath.includes('/Zone1/Eggs/'));}
  for(const t of CONFIG.tiers)assert.ok(fs.existsSync(new URL('../public/'+t.url,import.meta.url)));
});
