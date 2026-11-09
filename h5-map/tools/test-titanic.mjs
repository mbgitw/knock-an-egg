import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as THREE from 'three';
import {TitanicState,TITANIC} from '../public/gameplay/titanic-state.js';
import {EggSpawnState} from '../public/gameplay/egg-spawn-state.js';
import {EggWorld,isOriginalEggPart} from '../public/gameplay/egg-world.js';
import {EggPlacementObstacles} from '../public/gameplay/egg-placement-obstacles.js';
import {buildCollisionWorld} from '../public/world-physics.js';
import {isOriginalGuardPart} from '../public/gameplay/guard-system.js';
import {PickaxeProgress,restorePickaxes} from '../public/gameplay/pickaxe-state.js';
const rng=()=>{let n=3243;return()=>((n=(Math.imul(n,1664525)+1013904223)>>>0)/2**32);};
const make=()=>new TitanicState(new EggSpawnState(),{random:rng()});
test('30 minute schedule, 10 minute expiration and no offline backlog',()=>{
 const s=make();s.initialize(null,100);assert.equal(s.nextAt,1900);s.update(1899);assert.equal(s.eggs.length,0);s.update(1900);assert.equal(s.eggs.length,1);
 const e=s.eggs[0];assert.ok(e.spec.zone>=2);assert.notEqual(e.spec.name,'Frozen Egg');assert.equal(e.spec.luckMult,30);
 s.update(2500);assert.equal(s.eggs.length,0);assert.equal(s.nextAt,3700);
 s.update(1900+1800*100+700);assert.equal(s.eggs.length,0);
});
test('hit deduplication, one hatch, restore HP and consumed event cannot respawn',()=>{
 const s=make();s.initialize(null,0);s.update(1800);const e=s.eggs[0];assert.ok(s.hit(e,1,10,1801));assert.equal(s.hit(e,1,10,1801),false);
 const r=make();r.initialize(s.snapshot(),1802);assert.equal(r.eggs[0].life.hp,e.life.hp);assert.equal(r.eggs[0].life.generation,e.life.generation);
 assert.ok(s.hit(e,2,e.spec.health,1802));assert.equal(s.hit(e,3,1,1803),false);s.update(1818);assert.equal(s.eggs.length,0);
 const restored=make();restored.initialize(s.snapshot(),1820);assert.equal(restored.eggs.length,0);assert.equal(restored.nextAt,3600);
});
test('blocked placement retries without removing ordinary eggs',()=>{
 const world=new EggSpawnState({canPlace:()=>false});const s=new TitanicState(world,{random:rng()});s.initialize(null,0);s.update(1800);assert.equal(s.eggs.length,0);world.canPlace=()=>true;s.update(1805);assert.equal(s.eggs.length,1);
});
test('real map can fit a Titanic alongside the 230 ordinary eggs',()=>{
 const map=JSON.parse(fs.readFileSync(new URL('../public/map.json',import.meta.url)));
 const world=buildCollisionWorld(map.parts.filter(p=>!isOriginalEggPart(p.path)&&!isOriginalGuardPart(p.path)&&!p.path.includes('/Plots/')));
 const helper=new EggWorld(new THREE.Scene(),null,{world});helper.placementObstacles=new EggPlacementObstacles(map.parts);
 const ordinary=new EggSpawnState({random:rng(),sampleGround:(x,z)=>helper.ground(x,z),canPlace:s=>helper.canPlace(s)});ordinary.initialize(null,0);
 for(let i=1;i<120;i++)ordinary.update(i);
 const s=new TitanicState(ordinary,{random:rng()});s.initialize(null,0);
 for(let i=1800;i<1900&&!s.eggs.length;i+=5)s.update(i);
 assert.equal(s.eggs.length,1);assert.equal(ordinary.eggs.length,230);assert.ok(helper.canPlace(s.eggs[0].spec));
});
test('event animal can bank and survive inventory restoration, duplicate reward denied',()=>{
 const account={data:{},save:()=>true},p=new PickaxeProgress(account),id='zone2-egg-1000:1800000';
 const pet=p.hatch(id,()=>.99,2,{luck:TITANIC.luck});assert.ok(pet);assert.equal(p.hatch(id),null);assert.ok(p.bank(pet));assert.equal(restorePickaxes(p.data).pets[0].id,id);
});

test('online initialization retains the board and renders the Room countdown without local spawning',()=>{
 const previous=globalThis.document,text=[];
 const context={clearRect(){},measureText(){return {width:20};},strokeText(){},fillText(t){text.push(t);}};
 globalThis.document={createElement:tag=>tag==='canvas'?{getContext:()=>context}:{style:{},setAttribute(){}},body:{append(){}}};
 try{
  const world=Object.create(EggWorld.prototype);world.scene=new THREE.Scene();world.camera={};world.progress={account:{online:true}};
  world.initialize();assert.ok(world.titanicBoard);assert.equal(world.scene.children.length,1);
  world.titanicBoard.update(100,Infinity);assert.ok(text.includes('Spawns in: --:--'));
  world.applyNetwork({time:100000,titanicNextAt:1800,zone:1,eggs:[]});
  const now=Date.now()/1000;world.titanicBoard.update(now,world.titanic.nextAt);
  assert.ok(text.includes('Spawns in: 28:20'));world.titanic.update(now+2000);assert.equal(world.titanic.eggs.length,0);
 }finally{globalThis.document=previous;}
});
