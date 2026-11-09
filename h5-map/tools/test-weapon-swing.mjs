import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as THREE from 'three';
import {WeaponSwingPose,WEAPON_SWING_DURATION} from '../public/gameplay/weapon-swing-pose.js';
import {weaponGripMatrix} from '../public/gameplay/weapon-assets.js';
const read=p=>JSON.parse(fs.readFileSync(new URL(p,import.meta.url)));
const avatarBind=read('../public/gameplay/weapon-avatar-bind.json');
const rig=read('../public/model-check/weapons/swing-rig.json'),clip=read('../public/model-check/weapons/swing-candidate.json');
function fixture(){
 const bytes=fs.readFileSync(new URL('../public/characters/default-character.glb',import.meta.url));const gltf=JSON.parse(bytes.subarray(20,20+bytes.readUInt32LE(12)).toString());
 const nodes=gltf.nodes.map(n=>{const o=new THREE.Bone();o.name=n.name||'';if(n.translation)o.position.fromArray(n.translation);if(n.rotation)o.quaternion.fromArray(n.rotation);if(n.scale)o.scale.fromArray(n.scale);return o;});
 gltf.nodes.forEach((n,i)=>n.children?.forEach(c=>nodes[i].add(nodes[c])));
 const model=new THREE.Group();gltf.scenes[gltf.scene||0].nodes.forEach(i=>model.add(nodes[i]));model.updateMatrixWorld(true);
 const mesh=new THREE.SkinnedMesh(new THREE.BufferGeometry(),new THREE.MeshBasicMaterial());mesh.skeleton=new THREE.Skeleton(gltf.skins[0].joints.map(i=>nodes[i]));model.add(mesh);
 const actor=new THREE.Group();actor.add(model);model.scale.setScalar(200);actor.updateMatrixWorld(true);
 return {model,actor};
}
test('candidate timing and torso/arms use recovered motion, lower body remains untouched',()=>{
 const p=fixture(),pose=new WeaponSwingPose(p,rig,clip,avatarBind),leg=p.model.getObjectByName('RightLeg'),before=leg.quaternion.clone();
 assert.ok(Math.abs(WEAPON_SWING_DURATION-.5047619)<1e-6);
 pose.apply(null);const idle=p.model.getObjectByName('spine_c').quaternion.clone();
 pose.apply(.42);assert.ok(idle.angleTo(p.model.getObjectByName('spine_c').quaternion)>.6);
 assert.ok(leg.quaternion.angleTo(before)<1e-7);
 for(const target of pose.targets)assert.ok(target.bone.quaternion.toArray().every(Number.isFinite));
});
test('retarget reference matches authored avatar nodes rather than mesh skin coordinates',()=>{
 const p=fixture();
 for(const [name,q] of Object.entries(avatarBind.rotations)){
  const actual=p.model.getObjectByName(name).getWorldQuaternion(new THREE.Quaternion()).normalize();
  assert.ok(actual.angleTo(new THREE.Quaternion().fromArray(q).normalize())<1e-6,name);
 }
 assert.equal(clip.frames.length,54);
});
test('repeated poses do not accumulate and restore returns every modified bone exactly',()=>{
 const p=fixture(),pose=new WeaponSwingPose(p,rig,clip,avatarBind),baseline=pose.targets.map(t=>t.bone.quaternion.clone());
 pose.apply(.2);const q=pose.targets.map(t=>t.bone.quaternion.clone());
 for(let i=0;i<100;i++)pose.apply(.2);
 pose.targets.forEach((t,i)=>assert.deepEqual(t.bone.quaternion.toArray(),q[i].toArray()));
 pose.restore();pose.targets.forEach((t,i)=>assert.deepEqual(t.bone.quaternion.toArray(),baseline[i].toArray()));assert.equal(pose.saved,null);
});
test('all weapon grips stay in the actual avatar palm through turns and candidate frames',()=>{
 const p=fixture(),pose=new WeaponSwingPose(p,rig,clip,avatarBind),hand=p.model.getObjectByName('handR'),grip=new THREE.Object3D();grip.position.y=.00645;hand.add(grip);
 const catalog=read('../public/gameplay/weapons.json');
 for(const yaw of [0,.9,Math.PI])for(const elapsed of [0,.1,.25,.4,.5,.6]){
  p.actor.rotation.y=yaw;const q=pose.apply(elapsed),palm=grip.getWorldPosition(new THREE.Vector3());
  const mount=new THREE.Matrix4().compose(palm,q,new THREE.Vector3(1,1,1));
  for(const item of catalog){const g=item.grip,point=new THREE.Vector3(g.X,g.Y,g.Z).applyMatrix4(mount.clone().multiply(weaponGripMatrix(item)));assert.ok(point.distanceTo(palm)<1e-5);}
 }
});
