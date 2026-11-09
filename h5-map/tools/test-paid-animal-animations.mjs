import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import * as THREE from 'three';
import {OBJLoader} from '../public/vendor/OBJLoader.js';
import {buildMultiMeshAnimal} from '../public/model-check/multi-mesh-animal.js';
import {buildAnimalClip} from '../public/model-check/animal-animation-player.js';
const base=new URL('../public/model-check/',import.meta.url);
const read=async url=>JSON.parse(await fs.readFile(new URL(url,base),'utf8'));
const manifest=await read('./paid-animal-animations/catalog.json');
test('6 multi-mesh rigs preserve recovered geometry and all cached candidate actions deform finite meshes',async()=>{
 const checks=[];
 for(const [id,entry] of Object.entries(manifest)){
  const data=await read(entry.rig),materials=new Map(data.meshes.map(m=>[m.material,new THREE.MeshBasicMaterial()]));
  const rig=buildMultiMeshAnimal(data,materials);
  const original=new OBJLoader().parse(await fs.readFile(new URL(`./paid-animals/${entry.name}.obj`,base),'utf8'));
  const origBox=new THREE.Box3().setFromObject(original),origCenter=origBox.getCenter(new THREE.Vector3());
  original.position.set(-origCenter.x,-origBox.min.y,-origCenter.z);
  const staticBox=new THREE.Box3().setFromObject(original),bindBox=new THREE.Box3().setFromObject(rig.root);
  assert.ok(staticBox.min.distanceTo(bindBox.min)<.005&&staticBox.max.distanceTo(bindBox.max)<.005,`${id}: static/animated bind placement differs`);
  const extent=bindBox.getSize(new THREE.Vector3()).length();let bindError=0;
  for(const mesh of rig.meshes){
   const p=mesh.geometry.attributes.position;
   for(let i=0;i<p.count;i+=Math.max(1,Math.floor(p.count/100))){const v=new THREE.Vector3().fromBufferAttribute(p,i);bindError=Math.max(bindError,v.distanceTo(mesh.applyBoneTransform(i,v.clone())));}
  }
  assert.ok(bindError<extent*1e-5,`${id}: invalid inverse bind`);
  const actions={};
  for(const [name,source] of Object.entries(entry.actions)){
   rig.mixer.stopAllAction();for(const b of rig.bones){b.position.copy(b.userData.restPosition);b.quaternion.copy(b.userData.restQuaternion);}
   const clip=buildAnimalClip(await read(source.url),rig);assert.ok(clip.validate()&&clip.tracks.length);
   rig.mixer.clipAction(clip).play();let displacement=0,maxRatio=0;
   for(let sample=0;sample<7;sample++){
    rig.mixer.setTime(clip.duration*(sample+.25)/7);rig.root.updateMatrixWorld(true);rig.skeleton.update();const box=new THREE.Box3();
    for(const mesh of rig.meshes){const p=mesh.geometry.attributes.position;
     for(let i=0;i<p.count;i+=Math.max(1,Math.floor(p.count/150))){const v=new THREE.Vector3().fromBufferAttribute(p,i),posed=mesh.applyBoneTransform(i,v.clone());assert.ok(posed.toArray().every(Number.isFinite));displacement=Math.max(displacement,v.distanceTo(posed));box.expandByPoint(posed);}
    }
    maxRatio=Math.max(maxRatio,box.getSize(new THREE.Vector3()).length()/extent);
   }
   assert.ok(displacement>extent*1e-6,`${id} ${name}: no motion`);assert.ok(maxRatio<3,`${id} ${name}: exploded`);
   actions[name]={displacement,maxRatio};
  }
  checks.push({id,meshes:rig.meshes.length,bindError,actions,ambiguous:entry.ambiguous});
 }
 assert.equal(checks.length,6);assert.equal(checks.filter(x=>x.ambiguous).length,0);
});
