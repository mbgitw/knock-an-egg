import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import * as THREE from 'three';
import {EggWorld} from '../public/gameplay/egg-world-runtime.js';
const runtime=await readFile(new URL('../public/online/runtime.js',import.meta.url),'utf8');
const body=runtime.slice(runtime.indexOf('  const syncAnimals=()=>{'),runtime.indexOf('  const active=()=>'));
const deferred=()=>{let resolve;return {promise:new Promise(r=>resolve=r),resolve:v=>resolve(v)};};
const drain=async()=>{for(let i=0;i<12;i++)await Promise.resolve();};
function fixture(){
  const scene=new THREE.Scene(),world=new EggWorld(scene,{account:{},abandon(){}}),pet={id:'one',name:'Test',sizeMult:1};
  assert.equal(scene.children.filter(child=>child.isLight).length,4);
  const egg={pet,opened:true,spec:{position:[0,0,0],floorY:0,bodyBottom:0,bodyHeight:4},presentation:{hatchMult:1}};
  const a={id:pet.id,pet,position:{x:0,y:0,z:0},home:{x:0,y:0,z:0},readyAt:0,remaining:45000,roomTime:10000,receivedAt:performance.now()};
  const connection={animals:new Map([[pet.id,a]]),self:'self'},animals={views:new Map(),state:{animals:new Map()},add(p,e,r){this.views.set(p.id,r);this.state.animals.set(p.id,{});},carryingChanged(){},cancel(){},remove(id){this.views.get(id)?.root.removeFromParent();this.views.delete(id);this.state.animals.delete(id);}};
  world.canPresentAnimal=id=>connection.animals.has(id)&&!animals.views.has(id);
  let creations=0;const template=deferred();world.petTemplate=()=>template.promise;egg.petReady=template.promise;
  const sync=new Function('connection','animals','pickaxes','scene','remote','pendingAnimals','createPetModel','disposePetModel','animalVisualScale',body+'return syncAnimals;')(connection,animals,{eggs:world},scene,{actors:new Map()},new Set(),async t=>{creations++;return t.clone();},()=>{},()=>1);
  return {world,scene,egg,pet,template,connection,animals,sync,get creations(){return creations;}};
}
// The real model factory's optional animation catalogs are empty for this test animal.
globalThis.fetch=async()=>({ok:true,json:async()=>({})});
test('network fallback cannot create a second root during an async hatch reveal',async()=>{
  const f=fixture(),reveal=f.world.reveal(f.pet,f.egg);f.sync();assert.equal(f.creations,0);
  f.template.resolve(new THREE.Group());await reveal;f.sync();await drain();assert.equal(f.scene.children.filter(child=>!child.isLight).length,1);assert.equal(f.creations,0);
});
test('fallback started first is discarded when the hatch takes ownership while loading',async()=>{
  const f=fixture();f.sync();const reveal=f.world.reveal(f.pet,f.egg);f.template.resolve(new THREE.Group());await reveal;await drain();
  assert.equal(f.scene.children.filter(child=>!child.isLight).length,1);assert.equal(f.animals.views.size,0);assert.equal(f.world.reveals.length,1);
});
test('existing network animal suppresses a late reveal rather than making a twin',async()=>{
  const f=fixture();f.template.resolve(new THREE.Group());f.sync();await drain();assert.equal(f.animals.views.size,1);
  await f.world.reveal(f.pet,f.egg);assert.equal(f.scene.children.filter(child=>!child.isLight).length,1);assert.equal(f.world.reveals.length,0);
});
test('animal removed during model loading cannot leave a ghost reveal',async()=>{
  const f=fixture(),reveal=f.world.reveal(f.pet,f.egg);f.connection.animals.clear();f.template.resolve(new THREE.Group());await reveal;
  assert.equal(f.scene.children.filter(child=>!child.isLight).length,0);assert.equal(f.world.hasAnimalPresentation(f.pet.id),false);
});
test('duplicate reveal callbacks coalesce; failed loading releases fallback eligibility',async()=>{
  const f=fixture(),one=f.world.reveal(f.pet,f.egg),two=f.world.reveal(f.pet,f.egg);f.template.resolve(null);await Promise.all([one,two]);
  assert.equal(f.world.pendingReveals.size,0);assert.equal(f.world.hasAnimalPresentation(f.pet.id),false);
});
test('same species with different animal IDs are not deduplicated',async()=>{
  const f=fixture();f.world.reveals.push({egg:{pet:{id:'other',name:f.pet.name}}});assert.equal(f.world.hasAnimalPresentation(f.pet.id),false);
  f.template.resolve(new THREE.Group());f.sync();await drain();assert.equal(f.animals.views.size,1);
});
