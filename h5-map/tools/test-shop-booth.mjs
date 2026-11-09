import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as THREE from 'three';
import {buildCollisionWorld,CharacterMotor} from '../public/world-physics.js';
import {boothCollisionParts,createBoothRoof,BoothTrigger} from '../public/gameplay/shop-booth.js';
const data=JSON.parse(fs.readFileSync(new URL('../public/gameplay/shop-booth/model.json',import.meta.url)));
const floor={collide:true,className:'Part',shape:1,size:[400,1,400],matrix:[1,0,0,0,0,1,0,0,0,0,1,0]};
const parts=boothCollisionParts(data.parts),world=buildCollisionWorld([floor,...parts],createBoothRoof(data.parts));
const forward=new THREE.Vector3(.8660254,0,-.5),counter=new THREE.Vector3(-66.602356,.5,64.3705902);
function advance(m,seconds,d=new THREE.Vector3()){for(let i=0;i<seconds*120;i++)m.step(1/120,d);}
test('extracted booth contains all 22 original frame/counter parts and excludes the trigger from solids',()=>{
 assert.equal(data.report.matched,22);assert.equal(parts.length,21);assert.ok(parts.every(p=>p.path.includes('/Build/')));
 assert.equal(data.report.triangles,348);assert.equal(data.report.missing.length,11);
});
for(const speed of [18,240])test(`counter blocks a ${speed} units/s approach without penetration`,()=>{
 const m=new CharacterMotor(world,counter.clone().addScaledVector(forward,8));m.walkSpeed=speed;advance(m,.2);advance(m,1.5,forward.clone().negate());
 const distance=m.position.clone().sub(counter).dot(forward);assert.ok(distance>=1.70&&distance<1.85,`distance ${distance}`);assert.ok(Math.abs(m.position.y-.5)<.003);
});
test('thin front post stops a maximum speed capsule and allows sliding',()=>{
 const post=data.parts.find(p=>p.node===27983),center=new THREE.Vector3(post.matrix[3],.5,post.matrix[11]);
 const m=new CharacterMotor(world,center.clone().addScaledVector(forward,8));m.walkSpeed=240;advance(m,.2);advance(m,1,forward.clone().negate());
 assert.ok(m.position.clone().sub(center).dot(forward)>1.2);
 const z=m.position.z;advance(m,.12,new THREE.Vector3(0,0,1));assert.ok(m.position.z>z+.4);
});
test('open ground beside the booth and the light ring remain walkable',()=>{
 const m=new CharacterMotor(world,new THREE.Vector3(-56,.5,50));advance(m,.2);advance(m,.8,new THREE.Vector3(0,0,1));assert.ok(m.position.z>62);assert.ok(m.grounded);
});
test('jumping under the reconstructed awning hits its underside and lands safely',()=>{
 const m=new CharacterMotor(world,new THREE.Vector3(-69.5,.5,66));advance(m,.2);m.jump();let top=.5;
 for(let i=0;i<240;i++){m.step(1/120,new THREE.Vector3());top=Math.max(top,m.position.y);}
 assert.ok(top>1&&top<4,`highest feet ${top}`);assert.ok(Math.abs(m.position.y-.5)<.003);assert.ok(m.grounded);
});
test('authored oriented trigger opens on entry, stays dismissed while inside, and rearms after leaving',()=>{
 const t=new BoothTrigger(data.parts.find(p=>p.name==='HitZone'));
 const outside=new THREE.Vector3(-53,.5,57),inside=new THREE.Vector3(-61,.5,61);
 assert.equal(t.update(outside),null);assert.equal(t.update(inside),'enter');
 for(let i=0;i<100;i++)assert.equal(t.update(inside),null);
 assert.equal(t.update(outside),'leave');assert.equal(t.update(inside),'enter');
 assert.equal(t.contains(new THREE.Vector3(-65,30,63)),false);
});
