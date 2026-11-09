import test from 'node:test';
import assert from 'node:assert/strict';
import {TreadmillState} from '../public/treadmill-state.js';
import {PickaxeProgress} from '../public/gameplay/pickaxe-state.js';
import {PastureState} from '../public/gameplay/pasture-state.js';
test('bank, reload, place, reload, retrieve preserve the same animal exactly once',()=>{
 let snapshot;const storage={getItem:()=>snapshot,setItem:(k,v)=>snapshot=v};
 let account=new TreadmillState({storage}),bag=new PickaxeProgress(account);
 const pet=bag.hatch('zone1-egg-0:1',()=>0);assert.ok(bag.bank(pet));
 account=new TreadmillState({storage});assert.equal(account.data.pickaxes.pets.length,1);
 let pasture=new PastureState(account);assert.ok(pasture.place(pet.id,[20,1.27,50]));assert.equal(account.data.pickaxes.pets.length,0);
 assert.equal(pasture.place(pet.id,[21,1.27,50]),false);
 account=new TreadmillState({storage});pasture=new PastureState(account);assert.equal(pasture.pets.length,1);assert.deepEqual(pasture.pets[0].position,[20,1.27,50]);
 assert.ok(pasture.retrieve(pet.id));assert.equal(pasture.retrieve(pet.id),false);
 account=new TreadmillState({storage});assert.equal(account.data.pickaxes.pets[0].id,pet.id);assert.equal(account.data.plot.pets.length,0);
});
test('failed persistence does not consume a pet or duplicate it',()=>{
 const account=new TreadmillState(),bag=new PickaxeProgress(account);const pet=bag.hatch('zone1-egg-0:1',()=>0);bag.bank(pet);
 account.save=()=>false;const pasture=new PastureState(account);
 assert.equal(pasture.place(pet.id,[1,2,3]),false);assert.equal(bag.data.pets.length,1);assert.equal(pasture.pets.length,0);
});

test('failed bank save keeps the pending animal claim for retry',()=>{
 const account=new TreadmillState(),bag=new PickaxeProgress(account),pet=bag.hatch('zone1-egg-9:1',()=>0);
 account.save=()=>false;assert.equal(bag.bank(pet),false);assert.equal(bag.data.pets.length,0);assert.equal(bag.pendingPets.get(pet.id),pet);
 account.save=()=>true;assert.equal(bag.bank(pet),true);assert.equal(bag.data.pets.length,1);
});

import {PastureEconomy,pastureRate,restoreLedger} from '../public/gameplay/pasture-economy.js';
test('source reference weight, variant and disabled mutation rates',()=>{
 assert.equal(pastureRate({name:'Chicken'}),1);
 assert.equal(pastureRate({name:'Cat',variant:'Diamond'}),8);
 assert.equal(pastureRate({name:'Chicken',mutation:'Rainbow'}),1);
 assert.equal(pastureRate({name:'Cat',weightKg:36*1.38**3}),2);
 assert.equal(restoreLedger({pending:'bad'}).pending,0);
});
test('online seconds, capped offline claim, reload and duplicate claim',()=>{
 let snapshot,now=1_000_000;const storage={getItem:()=>snapshot,setItem:(k,v)=>snapshot=v};
 let a=new TreadmillState({storage}),bag=new PickaxeProgress(a),draws=0;let p=bag.hatch('zone1-egg-0:1',()=>draws++? .95:0);bag.bank(p);new PastureState(a).place(p.id,[10,1,50]);
 let e=new PastureEconomy(a,()=>now);for(let i=0;i<40;i++){now+=250;e.update(.25);}e.stamp();assert.equal(a.data.cash,110);
 now+=24*3600*1000;a=new TreadmillState({storage});e=new PastureEconomy(a,()=>now);assert.equal(e.ledger.pending,1800);
 a=new TreadmillState({storage});e=new PastureEconomy(a,()=>now);assert.equal(e.ledger.pending,1800);assert.equal(e.claim(),1800n);assert.equal(e.claim(),0n);assert.equal(a.data.cash,1910);
 a=new TreadmillState({storage});e=new PastureEconomy(a,()=>now);assert.equal(e.ledger.pending,0);
});
test('short absence and clock rollback never create offline rewards; failed claim retries once',()=>{
 let now=100000,a=new TreadmillState(),e=new PastureEconomy(a,()=>now);now+=59000;e.resume();assert.equal(e.ledger.pending,0);now-=90000;e.resume();assert.equal(e.ledger.pending,0);
 e.ledger.pending=10;a.save=()=>false;assert.equal(e.claim(),0n);assert.equal(e.ledger.pending,10);assert.equal(a.data.cash,100);
 a.save=()=>true;assert.equal(e.claim(),10n);assert.equal(e.claim(),0n);
});
test('Equip Best exchanges all containers once, respects capacity and preserves identity',()=>{
 const a=new TreadmillState(),bag=new PickaxeProgress(a);
 for(let i=0;i<12;i++){const p=bag.hatch('zone1-egg-'+i+':1',()=>i/12);bag.bank(p);}
 const before=bag.data.pets.map(p=>p.id).sort(),p=new PastureState(a),positions=Array.from({length:8},(_,i)=>[10+i*3,1,50]);
 assert.ok(p.equipBest(positions));assert.equal(p.pets.length,8);assert.equal(bag.data.pets.length,4);
 assert.ok(Math.min(...p.pets.map(pastureRate))>=Math.max(...bag.data.pets.map(pastureRate)));
 assert.deepEqual([...p.pets,...bag.data.pets].map(p=>p.id).sort(),before);
 const saved=JSON.stringify(a.data);a.save=()=>false;assert.equal(p.equipBest(positions),false);assert.equal(JSON.stringify(a.data),saved);
});

import * as THREE from 'three';
import {PastureMotion} from '../public/gameplay/pasture-motion.js';
test('celebration finishes, wander stays in pen and restore skips celebration',()=>{
 const h={matrix:[1,0,0,20,0,1,0,12,0,0,1,50,0,0,0,1],size:[46,23,38]},pet={position:[20,1.27,50]};
 const scene=new THREE.Scene(),model=new THREE.Group();model.add(new THREE.Mesh(new THREE.BoxGeometry(2,4,2)));scene.add(model);model.position.fromArray(pet.position);
 const m=new PastureMotion(model,pet,true,h);let moved=false;
 for(let i=0;i<2000;i++){m.update(.05,[model]);assert.ok(Math.abs(model.position.x-20)<=23);assert.ok(Math.abs(model.position.z-50)<=19);assert.ok(model.position.y>=1.27-1e-8);if(i>150&&model.position.distanceTo(m.center)>3)moved=true;}
 assert.ok(moved);assert.equal(m.sparks,null);assert.equal(model.position.y,1.27);m.dispose();
 const restored=new PastureMotion(model,pet,false,h);assert.ok(restored.age>restored.celebrate);assert.equal(restored.sparks,undefined);
});

import {PastureCashLabel,cashLabelInRange} from '../public/gameplay/pasture-cash-label.js';
test('cash billboard uses world distance, perspective scaling, follows its animal and disposes',()=>{
 const previous=globalThis.document;
 globalThis.document={createElement:()=>({getContext:()=>({clearRect(){},strokeText(){},fillText(){}})})};
 try{
  const scene=new THREE.Scene(),animal=new THREE.Mesh(new THREE.BoxGeometry(2,4,2)),camera=new THREE.PerspectiveCamera(60,1,.1,1000);
  scene.add(animal);animal.position.set(12,2,9);
  const label=new PastureCashLabel(scene,animal);
  camera.position.copy(animal.position).add(new THREE.Vector3(0,0,200));label.update(camera,'+$2',0);assert.equal(label.sprite.visible,true);
  camera.position.z+=.01;label.update(camera,'+$2',0);assert.equal(label.sprite.visible,false);
  // Camera position, not player distance; include all three axes.
  assert.equal(cashLabelInRange(new THREE.Vector3(0,201,0),new THREE.Vector3()),false);
  camera.position.copy(animal.position).add(new THREE.Vector3(0,0,20));camera.lookAt(animal.position);camera.updateMatrixWorld();
  label.update(camera,'+$2',0);const near=label.sprite.position.clone().project(camera);
  const top=label.sprite.position.clone().add(new THREE.Vector3(0,.5,0)).project(camera);const nearSize=top.y-near.y;
  camera.position.z+=20;camera.updateMatrixWorld();const far=label.sprite.position.clone().project(camera);const farTop=label.sprite.position.clone().add(new THREE.Vector3(0,.5,0)).project(camera);
  assert.ok(Math.abs(nearSize/(farTop.y-far.y)-2)<1e-10);assert.equal(label.material.sizeAttenuation,true);assert.equal(label.material.depthTest,false);
  animal.position.x+=5;label.update(camera,'+$3',.5);assert.equal(label.sprite.position.x,animal.position.x);
  let disposed=0;label.texture.addEventListener('dispose',()=>disposed++);label.material.addEventListener('dispose',()=>disposed++);label.remove();assert.equal(disposed,2);assert.equal(label.sprite.parent,null);
  animal.geometry.dispose();animal.material.dispose();
 }finally{globalThis.document=previous;}
});

import {overheadVisible,overheadRows} from '../public/gameplay/pasture-overhead.js';
test('pasture overhead requires plot entry, respects 150 camera distance, and omits unowned traits/timer',()=>{
 const anchor=new THREE.Vector3(),camera=new THREE.Vector3(0,0,150);
 assert.equal(overheadVisible(true,camera,anchor),true);assert.equal(overheadVisible(false,camera,anchor),false);
 camera.z=150.01;assert.equal(overheadVisible(true,camera,anchor),false);
 const normal=overheadRows({name:'Cat'});assert.equal(normal.length,2);assert.ok(normal[0].text.endsWith('/s'));assert.equal(normal[1].text,'Common');
 assert.equal(overheadRows({name:'Cat',variant:'Gold'})[0].text,'Gold');
});
