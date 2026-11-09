import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import * as THREE from 'three';
import {OBJLoader} from '../public/vendor/OBJLoader.js';
import {createPetModel,updatePetAnimation,disposePetModel} from '../public/gameplay/pet-animation.js';
import {PastureMotion} from '../public/gameplay/pasture-motion.js';
const base=new URL('../public/model-check/',import.meta.url);
const read=async path=>JSON.parse(await fs.readFile(new URL(path,base),'utf8'));
globalThis.fetch=async url=>({ok:true,json:async()=>JSON.parse(await fs.readFile(url,'utf8'))});
test('18 pets: runtime geometry, separate instances, material variants, facing, Idle/Walk and cleanup',async()=>{
 const paid=await read('paid-animals/catalog.json'),animals=await read('animals/catalog.json');
 const manifest={...await read('planet-x-animations/catalog.json'),...await read('paid-animal-animations/catalog.json')};
 assert.equal(Object.keys(manifest).length,18);
 for(const [id,entry] of Object.entries(manifest)){
  const catalog=[...paid,...animals].find(e=>e.id===id);
  const obj=new OBJLoader().parse(await fs.readFile(new URL(catalog.url,base),'utf8'));
  const template=new THREE.Group();template.add(obj);template.userData.facingYaw=catalog.facingYaw||0;
  const materials=new Map();obj.traverse(o=>{if(o.isMesh)for(const m of Array.isArray(o.material)?o.material:[o.material]){m.color.set('#ffd700');materials.set(m.name,m);}});
  const a=await createPetModel(template,entry.name,{height:4}),b=await createPetModel(template,entry.name);
  const ra=a.userData.rig,rb=b.userData.rig;assert.ok(ra&&rb,entry.name);
  assert.notEqual(ra.skeleton,rb.skeleton);assert.notEqual(ra.bones[0],rb.bones[0]);
  assert.equal(a.children[0].rotation.y,catalog.facingYaw||0);
  assert.ok(Math.abs(new THREE.Box3().setFromObject(a).getSize(new THREE.Vector3()).y-4)<.02,entry.name+' height');
  for(const mesh of ra.meshes)assert.equal(mesh.material,materials.get(mesh.material.name));
  for(const state of ['Idle','Walk']){updatePetAnimation(a,.25,state);assert.equal(ra.state,state);assert.ok(ra.actions.get(state).time>0);assert.equal(rb.actions.get('Idle').time,0);}
  const hitbox={size:[100,10,100],matrix:new THREE.Matrix4().toArray()};
  const motion=new PastureMotion(a,{position:[0,0,0]},false,hitbox);motion.wait=99;motion.update(.1,[a]);assert.equal(motion.state,'Idle');
  motion.target=new THREE.Vector3(10,0,0);motion.update(.1,[a]);assert.equal(motion.state,'Walk');
  let disposed=0;for(const mesh of ra.meshes)mesh.geometry.addEventListener('dispose',()=>disposed++);
  motion.dispose();assert.equal(disposed,ra.meshes.length);assert.equal(a.userData.rig,undefined);disposePetModel(b);
 }
});
