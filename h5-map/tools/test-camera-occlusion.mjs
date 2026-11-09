import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as THREE from 'three';
import {buildCollisionWorld,combineCollisionWorlds,blocksCamera} from '../public/world-physics.js';
import {CameraOcclusion} from '../public/camera-occlusion.js';

const part=(path,size,z)=>({path,size,collide:true,className:'Part',shape:1,matrix:[1,0,0,0,0,1,0,0,0,0,1,z]});
const ray=new THREE.Ray(new THREE.Vector3(),new THREE.Vector3(0,0,1));
test('signs keep character collision but do not shorten the camera, including real map boards',()=>{
 const board=part('/Workspace/Plots/Base_3/UpgradeBoard/Panel',[12,8,1],4);
 const world=buildCollisionWorld([board]);
 assert.ok(world.rayIntersect(ray));assert.equal(world.cameraRayIntersect(ray),false);
 const data=JSON.parse(fs.readFileSync('public/map.json','utf8'));
 const boards=data.parts.filter(p=>/\/(UpgradeBoard|TreadmillBoard)\//.test(p.path)&&p.collide);
 assert.ok(boards.length>0);assert.ok(boards.every(p=>!blocksCamera(p)));
 assert.equal(blocksCamera(part('/post',[1,12,1],5)),false);
});
test('large walls still block camera across combined worlds and explicit policy overrides work',()=>{
 const wall=part('/wall',[20,20,1],10),world=combineCollisionWorlds(buildCollisionWorld([part('/Sign',[12,8,1],4)]),buildCollisionWorld([wall]));
 assert.equal(world.rayIntersect(ray).distance,3.5);assert.equal(world.cameraRayIntersect(ray).distance,9.5);
 assert.equal(blocksCamera({...wall,cameraCollide:false}),false);
 assert.equal(blocksCamera({...part('/post',[1,12,1],5),cameraCollide:true}),true);
});
test('wall safety is immediate, recovery is held briefly then smooth, requested zoom remains separate',()=>{
 const solver=new CameraOcclusion(),target=new THREE.Vector3(),requested=new THREE.Vector3(0,0,25),out=requested.clone();
 const blocked=buildCollisionWorld([part('/wall',[20,20,1],10)]),clear=buildCollisionWorld([]);
 solver.resolve(target,out,clear,1/60);assert.equal(out.z,25);
 solver.resolve(target,out.copy(requested),blocked,1/60);assert.ok(out.z<9.5&&out.z>9);
 const near=out.z;
 for(let i=0;i<6;i++)solver.resolve(target,out.copy(requested),clear,1/60);
 assert.equal(out.z,near);
 solver.resolve(target,out.copy(requested),clear,1/60);solver.resolve(target,out.copy(requested),clear,1/60);
 assert.ok(out.z>near&&out.z<12);assert.equal(requested.z,25);
 for(let i=0;i<120;i++)solver.resolve(target,out.copy(requested),clear,1/60);
 assert.ok(out.z>24.98&&out.z<=25);
 solver.resolve(target,out.set(0,0,8),clear,1/60);assert.equal(out.z,8);
});
test('offset probes catch wall edges missed by the center ray',()=>{
 const solver=new CameraOcclusion(),out=new THREE.Vector3(0,0,25);
 solver.resolve(new THREE.Vector3(),out,{cameraRayIntersect:r=>Math.abs(r.origin.x)>.3?{distance:6}:false},1/60);
 assert.ok(out.z<6);
});
