import test from 'node:test';import assert from 'node:assert/strict';import * as THREE from 'three';
import {hatchCrackPose,hatchAnimalGrowth,hatchFlightPose,HatchReveal} from '../public/gameplay/growth-hatch-presentation.js';
import {MergeState} from '../public/gameplay/merge-state.js';
import {restoreState} from '../public/treadmill-state.js';
test('reference crack beats, reveal hold and flight arrival timing',()=>{
 for(const [t,beat,done] of [[0,0,false],[.8,1,false],[1.6,2,false],[2.4,2,true]]){const p=hatchCrackPose(t);assert.equal(p.beat,beat);assert.equal(p.done,done);}
 assert.equal(hatchAnimalGrowth(0),.5);assert.equal(hatchAnimalGrowth(1.3),1);
 const origin=new THREE.Vector3(),target=new THREE.Vector3(0,2,10);
 assert.ok(hatchFlightPose(2.8,origin,target).position.equals(origin));assert.equal(hatchFlightPose(3.49,origin,target).done,false);assert.equal(hatchFlightPose(3.5,origin,target).done,true);
});
test('reveal uses private materials and restores shared source on disposal',()=>{
 const material=new THREE.MeshStandardMaterial({color:0x123456}),animal=new THREE.Group(),mesh=new THREE.Mesh(new THREE.BoxGeometry(),material);animal.add(mesh);
 const effect=new HatchReveal(animal,new THREE.Vector3(),1,4,0xffffff);
 assert.notEqual(mesh.material,material);effect.update(3.2,new THREE.Vector3(0,0,5));assert.equal(material.opacity,1);effect.dispose();assert.equal(mesh.material,material);assert.equal(effect.root.parent,null);
});
test('local inventory waits for presentation and settlement remains once-only',()=>{
 const account={data:restoreState({}),save:()=>true};account.data.growingEggs=[{id:'merge:qa',name:'Chicken',zone:1,weightKg:5,sizeMult:1,position:[0,0,0],readyAt:1,hatchingAt:1000,duration:60}];
 const state=new MergeState(account,{now:()=>20000});assert.deepEqual(state.finish(()=>false),[]);assert.equal(account.data.pickaxes.pets.length,0);
 assert.equal(state.finish(()=>true).length,1);assert.equal(account.data.pickaxes.pets.length,1);assert.equal(state.finish(()=>true).length,0);
});
import {GrowthHatch} from '../public/gameplay/growth-hatch.js';
test('early Room delivery stays hidden until visual arrival without changing inventory',()=>{
 const pet={id:'merge:online',name:'Chicken'},account={data:{pickaxes:{pets:[pet]},growingEggs:[]}};
 const presentation=new GrowthHatch({account});presentation.active.set(pet.id,{done:false});assert.equal(presentation.hides(pet.id),true);assert.equal(presentation.release(),false);assert.equal(account.data.pickaxes.pets[0],pet);
 presentation.active.get(pet.id).done=true;assert.equal(presentation.release(),true);assert.equal(presentation.hides(pet.id),false);assert.equal(account.data.pickaxes.pets.length,1);
});
