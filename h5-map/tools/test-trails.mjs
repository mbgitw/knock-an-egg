import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as THREE from 'three';
import {TreadmillState,restoreState} from '../public/treadmill-state.js';
import {TrailProgress,TRAILS,restoreTrails} from '../public/gameplay/trail-state.js';
import {TrailHistory,TrailRibbon} from '../public/gameplay/trail-ribbon.js';
import {trailBoothCollisionParts,createTrailRoof} from '../public/gameplay/trail-booth.js';
import {BoothTrigger} from '../public/gameplay/shop-booth.js';
import {buildCollisionWorld,CharacterMotor} from '../public/world-physics.js';
const booth=JSON.parse(fs.readFileSync(new URL('../public/gameplay/trails/booth/model.json',import.meta.url)));
const account=()=>new TreadmillState({storage:null,now:()=>1000});
test('11 original prices/multipliers preserved; no paid trail on fresh or legacy accounts',()=>{
 assert.deepEqual(TRAILS.map(t=>t.multiplier),[2,4,8,16,40,100,250,600,1500,4000,10000]);
 assert.deepEqual(TRAILS.map(t=>t.price),[500,7500,100000,1250000,17500000,250000000,3500000000,45000000000,600000000000,8000000000000,100000000000000]);
 assert.deepEqual(new TrailProgress(account()).data,{owned:[],equipped:0});
 const old=restoreState({version:1,cash:1234,power:500,unlocked:true,level:4});assert.equal(old.cash,1234);assert.equal(old.level,4);assert.deepEqual(old.trails,{owned:[],equipped:0});
});
test('purchase validates balance and id, charges exactly once, equips only owned trails',()=>{
 const a=account(),p=new TrailProgress(a);assert.equal(p.buy(1),false);a.creditCash(8000);assert.equal(p.buy('1'),false);assert.equal(p.buy(NaN),false);assert.equal(p.equip(11),false);assert.equal(p.buy(1),true);assert.equal(a.data.cash,7600);assert.equal(p.buy(1),false);assert.equal(a.data.cash,7600);assert.equal(p.data.equipped,1);assert.equal(p.buy(2),true);assert.equal(a.data.cash,100);assert.equal(p.data.equipped,2);assert.equal(p.toggle(2),true);assert.equal(p.data.equipped,0);
});
test('large balance, ownership and equipment survive shared save without losing pickaxes/plot',()=>{
 let saved;const storage={getItem:()=>saved||null,setItem:(_,v)=>saved=v};const a=new TreadmillState({storage}),p=new TrailProgress(a);a.creditCash('10000000000000100');const before=BigInt(a.data.cash);assert.ok(p.buy(11));assert.equal(BigInt(a.data.cash),before-100000000000000n);const b=new TreadmillState({storage});assert.deepEqual(b.data.trails,{owned:[11],equipped:11});assert.deepEqual(b.data.pickaxes,a.data.pickaxes);assert.deepEqual(b.data.plot,a.data.plot);
 assert.deepEqual(restoreTrails({owned:[1,1,2,'3',99,-1,null],equipped:11}),{owned:[1,2],equipped:0});
});
test('training combines one trail multiplier with machine and boosts, switch/unequip restores baseline',()=>{
 const a=account(),p=new TrailProgress(a);a.creditCash('200000000000000');a.unlock();a.data.level=3;a.setBoost('speed',2,60);a.setBoost('treadmill',3,60);a.begin();const base=a.multiplier;assert.equal(base,24);p.buy(7);assert.equal(a.multiplier,base*250);p.buy(11);assert.equal(a.multiplier,base*10000);p.equip(7);assert.equal(a.multiplier,base*250);p.equip(0);assert.equal(a.multiplier,base);
 p.equip(1);assert.equal(a.multiplier,base);a.end();p.equip(11);const old=a.data.power;for(let i=0;i<100;i++)a.advance(.1);assert.equal(a.data.power,old);assert.equal(a.speed,18);
 a.begin();a.advance(.25);assert.equal(a.data.power,old+240000);a.setSlow(true);assert.equal(a.speed,18);const power=a.data.power;a.advance(.2,{active:false});assert.equal(a.data.power,power);
});
test('trail stops fade out, teleport clears the strip, fast runs stay bounded',()=>{
 const h=new TrailHistory();for(let i=0;i<180;i++)h.advance(1/120,new THREE.Vector3(i*2,0,0));assert.ok(h.points.length<=26);assert.ok(h.points.at(-1).position.distanceTo(h.points[0].position)<=50);
 h.advance(1/60,new THREE.Vector3(1000,0,0));assert.equal(h.points.length,1);for(let i=0;i<100;i++)h.advance(.01,new THREE.Vector3(1000,0,0));assert.equal(h.points.length,0);
});
test('all 11 renderer configurations remain finite and switching disposes old history',()=>{
 const scene=new THREE.Scene(),camera=new THREE.PerspectiveCamera();camera.position.set(10,10,10);const r=new TrailRibbon(scene,camera);
 for(const t of TRAILS){r.setTrail(t);for(let i=0;i<30;i++)r.update(1/60,new THREE.Vector3(i*.2,Math.sin(i*.2),0));assert.ok(r.geometry.drawRange.count>0);for(const attr of Object.values(r.geometry.attributes))assert.ok([...attr.array].every(Number.isFinite));}
 r.setTrail(null);assert.equal(r.geometry.drawRange.count,0);assert.equal(r.mesh.visible,false);r.dispose();assert.equal(scene.children.length,0);
});
test('original booth extraction and rotated trigger preserve open ring vs solid counter',()=>{
 assert.equal(booth.report.matched,22);assert.equal(booth.report.triangles,348);const parts=trailBoothCollisionParts(booth.parts);assert.equal(parts.length,21);assert.ok(parts.every(p=>p.path.includes('/Build/')));
 const trigger=new BoothTrigger(booth.parts.find(p=>p.name==='HitZone'));const out=new THREE.Vector3(-50,.5,-48),inside=new THREE.Vector3(-58,.5,-54);assert.equal(trigger.update(out),null);assert.equal(trigger.update(inside),'enter');assert.equal(trigger.update(inside),null);assert.equal(trigger.update(out),'leave');assert.equal(trigger.update(inside),'enter');
});
for(const speed of [18,240])test(`trail counter blocks approach at ${speed}`,()=>{
 const floor={collide:true,className:'Part',shape:1,size:[400,1,400],matrix:[1,0,0,0,0,1,0,0,0,0,1,0]};const world=buildCollisionWorld([floor,...trailBoothCollisionParts(booth.parts)],createTrailRoof(booth.parts));
 const center=new THREE.Vector3(-64.0479355,.5,-57.6511269),forward=new THREE.Vector3(.8660254,0,.5),m=new CharacterMotor(world,center.clone().addScaledVector(forward,8));m.walkSpeed=speed;
 for(let i=0;i<180;i++)m.step(1/120,forward.clone().negate());const d=m.position.clone().sub(center).dot(forward);assert.ok(d>=1.7&&d<1.9,`counter separation ${d}`);
});
