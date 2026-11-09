import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as THREE from 'three';
import {buildCollisionWorld} from '../public/world-physics.js';
import {Capsule} from '../public/vendor/Capsule.js';
import {GuardNavigation} from '../public/gameplay/guard-navigation.js';
import {GuardBrain} from '../public/gameplay/guard-brain.js';
import {guardGroundHeight} from '../public/gameplay/guard-system.js';
const read=p=>JSON.parse(fs.readFileSync(new URL(p,import.meta.url)));
const c=read('../public/gameplay/guards/catalog.json'),nav=new GuardNavigation(read('../public/gameplay/guards/navigation.json'));
const parts=read('../public/map.json').parts.filter(p=>p.path.startsWith('/Workspace/Build/')&&!c.guards.some(g=>p.path.startsWith(g.nodePath+'/'))&&!p.path.includes('/Eggs/'));
const world=buildCollisionWorld(parts),capsule=new Capsule(new THREE.Vector3(),new THREE.Vector3(),2);
function clearance(p){capsule.start.set(p.x,p.y+2.06,p.z);capsule.end.set(p.x,p.y+3.06,p.z);const hit=world.capsuleIntersect(capsule);return !hit||hit.depth<.02;}
test('二区真实凸起地面：旧插值复现卡住，脚下净空修复后30种巡逻持续完成',()=>{
 let seed=3;const random=()=>((seed=(Math.imul(seed,1664525)+1013904223)>>>0)/4294967296);
 const old=new GuardBrain(c.guards[1],c.rules,nav,{random,canMove:clearance});
 for(let i=0;i<700;i++)old.update(.05,null);
 assert.equal(old.state,'Returning');assert.ok(old.blocked>4);assert.ok(Math.abs(old.position.x+260)<.1);
 let simulations=0;
 for(let run=1;run<=30;run++){
  seed=run;const guard=new GuardBrain(c.guards[1],c.rules,nav,{random,canMove:clearance,groundHeight:p=>guardGroundHeight(world,p)});let stationary=0,arrivals=0;
  for(let i=0;i<6000;i++){const before=guard.state;guard.update(.05,null);stationary=guard.speed<.01&&guard.state!=='Idle'?stationary+.05:0;assert.ok(stationary<4,`seed ${run}: stuck`);if(before==='Roaming'&&guard.state==='Idle')arrivals++;}
  assert.ok(arrivals>=10,`seed ${run} completed patrols`);simulations++;
 }
 assert.equal(simulations,30);
 const stuck=new GuardBrain(c.guards[1],c.rules,nav,{random,canMove:clearance,groundHeight:p=>guardGroundHeight(world,p)});
 stuck.position.copy(old.position);stuck.setState('Returning');for(let i=0;i<200&&stuck.state!=='Idle';i++)stuck.update(.05,null);
 assert.equal(stuck.state,'Idle');assert.ok(stuck.position.distanceTo(stuck.home)<=c.rules.HomeArrivalDistance);
});
test('脚底高度采样不允许穿过高墙',()=>{
 const wall=buildCollisionWorld([{collide:true,className:'Part',shape:1,size:[1,20,20],matrix:[1,0,0,0,0,1,0,10,0,0,1,0]}]);
 assert.ok(!Number.isFinite(guardGroundHeight(wall,new THREE.Vector3(0,0,0))));
});
