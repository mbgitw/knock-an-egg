import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import * as THREE from 'three';
import {RemoteAvatars} from '../public/online/avatars.js';
import {EggWorld} from '../public/gameplay/egg-world-runtime.js';
import {EggPresentationState} from '../public/gameplay/egg-presentation-state.js';

const glb=await readFile(new URL('../public/characters/default-character.glb',import.meta.url));
const modelJson=JSON.parse(glb.subarray(20,20+glb.readUInt32LE(12)).toString('utf8'));
const modelClips=new Set(modelJson.animations.map(a=>a.name));

test('remote movement selects the actual avatar run/air clips and advances the rig',()=>{
  for(const name of ['Breathing Idle','RunLobbyNew','LobbyAir'])assert.ok(modelClips.has(name),name);
  const scene=new THREE.Scene(),template=new THREE.Group(),leg=new THREE.Object3D();leg.name='leg';template.add(leg);
  const clips=['Breathing Idle','RunLobbyNew','LobbyAir'].map(name=>new THREE.AnimationClip(name,1,[new THREE.NumberKeyframeTrack('leg.rotation[x]',[0,.5,1],name==='Breathing Idle'?[0,0,0]:[0,1,0])]));
  const remote=new RemoteAvatars(scene,template,clips),camera=new THREE.PerspectiveCamera(60,1,.1,500);
  camera.position.set(0,5,20);camera.lookAt(0,0,0);
  const position={x:0,y:0,z:0,yaw:0,sequence:0,flags:0};remote.reconcile([{id:'other',slot:1,connected:true,position}], 'self');
  const actor=remote.actors.get('other'),at=actor.buffer.samples[0].time;
  remote.positions([{...position,x:1,sequence:1,slot:1,flags:1}],at+100);
  remote.update(.2,at+250,camera);assert.equal(actor.animation.getClip().name,'RunLobbyNew');
  const before=actor.model.getObjectByName('leg').rotation.x;remote.update(.1,at+300,camera);
  assert.notEqual(actor.model.getObjectByName('leg').rotation.x,before);assert.equal(leg.rotation.x,0);
  remote.positions([{...position,x:1,sequence:2,slot:1,flags:2}],at+350);remote.update(.2,at+600,camera);
  assert.equal(actor.animation.getClip().name,'LobbyAir');
  remote.positions([{...position,x:1,sequence:3,slot:1,flags:0}],at+650);remote.update(.2,at+900,camera);
  assert.equal(actor.animation.getClip().name,'Breathing Idle');
  actor.profile.training={};remote.update(.2,at+950,camera);assert.equal(actor.animation.getClip().name,'RunLobbyNew');
});

const spec={id:'egg-test',zone:1,health:100,bodyHeight:5,kind:1,sizeMult:1};
function viewer(){
  const sent=[],world=new EggWorld(new THREE.Scene(),{account:{online:{attack:(...args)=>{sent.push(args);return Promise.resolve({ok:true});}}}});
  const egg={spec,life:{hp:100,generation:0},presentation:new EggPresentationState(spec,0,()=>.5)};
  world.state={eggs:[egg]};world.titanic={};return {world,egg,sent};
}
function frame(hp,time=1000){return {zone:1,time,titanicNextAt:1800,eggs:[{id:spec.id,generation:0,hp,respawnAt:0}]};}

test('shared egg HP updates both clients while only the local hitter sees its health bar',async()=>{
  const a=viewer(),b=viewer();a.world.time=b.world.time=1;
  await a.world.hit(a.egg,1,10);assert.equal(a.sent.length,1);assert.equal(a.egg.life.hp,100,'no client damage prediction');
  a.world.applyNetwork(frame(90));b.world.applyNetwork(frame(90));
  assert.equal(a.egg.life.hp,90);assert.equal(b.egg.life.hp,90);
  assert.equal(a.egg.presentation.health(1.2).visible,true);
  assert.equal(b.egg.presentation.health(1.2).visible,false);
  assert.equal(b.egg.presentation.health(1.2).value,90);
  assert.equal(b.egg.presentation.sample(1.01).stage,'hit','shared shell feedback is retained');
  a.world.time=b.world.time=7.3;a.world.applyNetwork(frame(80,7300));b.world.applyNetwork(frame(80,7300));
  assert.equal(a.egg.presentation.health(7.4).visible,false,'another hit must not extend the local timeout');
  await b.world.hit(b.egg,2,10);assert.equal(b.egg.presentation.health(7.4).visible,true);
  assert.equal(a.egg.presentation.health(7.4).visible,false);
});

test('damaged egg baseline and shared hatching never reveal a spectator health bar',()=>{
  const spectator=viewer();spectator.world.time=1;spectator.world.applyNetwork(frame(25));
  assert.equal(spectator.egg.presentation.health(1.2).value,25);assert.equal(spectator.egg.presentation.health(1.2).visible,false);
  spectator.world.time=2;spectator.world.applyNetwork({...frame(0,2000),eggs:[{...frame(0).eggs[0],brokenAt:2}]});
  assert.equal(spectator.egg.life.hp,0);assert.equal(spectator.egg.presentation.sample(2.1).stage,'spin');
  assert.equal(spectator.egg.presentation.health(2.1).visible,false);
});
