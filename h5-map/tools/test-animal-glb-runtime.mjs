import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import * as THREE from 'three';
import {animalGlbTemplate} from '../public/gameplay/animal-glb-runtime.js';
import {createPetModel,updatePetAnimation,disposePetModel} from '../public/gameplay/pet-animation.js';
import {variantTemplate} from '../public/gameplay/animal-variants.js';
import {PastureMotion} from '../public/gameplay/pasture-motion.js';

test('real compiled animal retries load, preserves variants, shares geometry and disposes only its own skeleton',async()=>{
  const oldFetch=globalThis.fetch,oldProgress=globalThis.ProgressEvent;let rejectOnce=true,assetRequests=0;
  globalThis.ProgressEvent=class{constructor(type,data){this.type=type;Object.assign(this,data);}};
  globalThis.fetch=async input=>{
    const url=new URL(input.url||input);if(url.pathname.endsWith('/animal_z10_05.glb')){assetRequests++;if(rejectOnce){rejectOnce=false;return new Response('',{status:503});}}
    const bytes=await fs.readFile(url);return new Response(bytes,{headers:{'Content-Length':String(bytes.length)}});
  };
  try{
    await assert.rejects(animalGlbTemplate('CrystalDragon'));
    const template=await animalGlbTemplate('CrystalDragon');assert.equal(assetRequests,2);assert.equal(template.userData.compiledAnimal,'CrystalDragon');
    assert.ok(Math.abs(new THREE.Box3().setFromObject(template).getSize(new THREE.Vector3()).y-2.8)<.01);
    const a=await createPetModel(template,'CrystalDragon',{height:4}),b=await createPetModel(template,'CrystalDragon',{height:4});
    assert.equal(assetRequests,2);assert.equal(a.userData.rig.meshes.length,53);assert.equal(a.userData.rig.skeletons.length,1);
    assert.notEqual(a.userData.rig.skeleton,b.userData.rig.skeleton);assert.notEqual(a.userData.rig.bones[0],b.userData.rig.bones[0]);
    assert.equal(a.userData.rig.meshes[0].geometry,b.userData.rig.meshes[0].geometry);
    const originalColors=new Map();template.traverse(o=>{if(o.isMesh)originalColors.set(o.material.name,o.material.color.clone());});
    for(const variant of ['Gold','Diamond']){
      const varied=await variantTemplate(template,'CrystalDragon',variant),model=await createPetModel(varied,'CrystalDragon');
      const materials=new Map();varied.traverse(o=>{if(o.isMesh)materials.set(o.material.name,o.material);});
      for(const mesh of model.userData.rig.meshes)assert.equal(mesh.material,materials.get(mesh.material.name));
      disposePetModel(model);
    }
    template.traverse(o=>{if(o.isMesh)assert.ok(o.material.color.equals(originalColors.get(o.material.name)));});
    updatePetAnimation(a,.3,'Walk');assert.ok(a.userData.rig.actions.get('Walk').time>0);assert.equal(b.userData.rig.actions.get('Walk').time,0);
    const motion=new PastureMotion(b,{position:[0,0,0]},false,{size:[100,10,100],matrix:new THREE.Matrix4().toArray()});
    motion.wait=99;motion.update(.1,[b]);assert.equal(motion.state,'Idle');motion.target=new THREE.Vector3(10,0,0);motion.update(.1,[b]);assert.equal(motion.state,'Walk');
    let geometryDisposed=0;for(const mesh of a.userData.rig.meshes)mesh.geometry.addEventListener('dispose',()=>geometryDisposed++);
    disposePetModel(a);disposePetModel(a);assert.equal(geometryDisposed,0);assert.equal(a.userData.rig,undefined);
    updatePetAnimation(b,.2,'Walk');assert.ok(b.userData.rig.actions.get('Walk').time>0);assert.equal(b.userData.rig.state,'Walk');motion.dispose();
    assert.equal(geometryDisposed,0);assert.equal(b.userData.rig,undefined);
    assert.equal(await animalGlbTemplate('not-a-real-animal'),null);
  }finally{globalThis.fetch=oldFetch;if(oldProgress)globalThis.ProgressEvent=oldProgress;else delete globalThis.ProgressEvent;}
});
