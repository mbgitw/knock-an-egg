import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as THREE from 'three';
import {buildCollisionWorld, CharacterMotor} from '../public/world-physics.js';

const zero = new THREE.Vector3();
const part = (position,size,angle=0) => {
  const m=new THREE.Matrix4().makeRotationY(angle);m.setPosition(...position);
  const e=m.elements;
  return {collide:true,className:'Part',shape:1,size,matrix:[e[0],e[4],e[8],e[12],e[1],e[5],e[9],e[13],e[2],e[6],e[10],e[14]]};
};
const floor=part([0,-1,0],[400,2,400]);
function advance(motor,seconds,direction=zero){for(let i=0;i<seconds*120;i++)motor.step(1/120,direction);}

test('gravity settles capsule feet on a floor without sinking',()=>{
  const motor=new CharacterMotor(buildCollisionWorld([floor]),new THREE.Vector3(0,8,0));
  advance(motor,2);
  assert.equal(motor.grounded,true);assert.ok(Math.abs(motor.position.y)<.002);
  advance(motor,5);assert.ok(Math.abs(motor.position.y)<.002);
});

test('jump rises, cannot jump again in air, and returns to the floor',()=>{
  const motor=new CharacterMotor(buildCollisionWorld([floor]),new THREE.Vector3(0,.2,0));
  advance(motor,1);motor.jump();advance(motor,.2);
  assert.equal(motor.grounded,false);assert.ok(motor.position.y>2);
  const before=motor.velocity.y;motor.jump();motor.step(1/120,zero);
  assert.ok(motor.velocity.y<before);
  advance(motor,2);assert.equal(motor.grounded,true);assert.ok(Math.abs(motor.position.y)<.002);
});

test('a wall stops movement and diagonal input slides along it',()=>{
  const motor=new CharacterMotor(buildCollisionWorld([floor,part([10,10,0],[2,20,150])]),new THREE.Vector3(0,.1,0));
  advance(motor,1);advance(motor,2,new THREE.Vector3(1,0,0));
  assert.ok(motor.position.x<=8.002 && motor.position.x>7.8);
  const z=motor.position.z;advance(motor,1,new THREE.Vector3(1,0,1).normalize());
  assert.ok(motor.position.x<8.01);assert.ok(motor.position.z>z+5);
});

test('a ceiling blocks the upward jump',()=>{
  const motor=new CharacterMotor(buildCollisionWorld([floor,part([0,7,0],[20,1,20])]),new THREE.Vector3(0,.1,0));
  advance(motor,1);motor.jump();let highest=0;
  for(let i=0;i<240;i++){motor.step(1/120,zero);highest=Math.max(highest,motor.position.y);}
  assert.ok(highest<=1.102);assert.equal(motor.grounded,true);
});

test('falling out of the level resets to the spawn',()=>{
  const motor=new CharacterMotor(buildCollisionWorld([]),new THREE.Vector3(2,1,3));
  advance(motor,2);
  assert.ok(motor.position.y>-100);assert.equal(motor.position.x,2);assert.equal(motor.position.z,3);
});

test('actual map spawn, jump, and route into the first zone stay grounded',()=>{
  const data=JSON.parse(fs.readFileSync(new URL('../public/map.json',import.meta.url)));
  const motor=new CharacterMotor(buildCollisionWorld(data.parts));
  advance(motor,2);assert.equal(motor.grounded,true);assert.ok(Math.abs(motor.position.y-.5)<.002);
  motor.jump();advance(motor,2);assert.equal(motor.grounded,true);
  advance(motor,10,new THREE.Vector3(-1,0,0));
  assert.ok(motor.position.x < -180);assert.equal(motor.grounded,true);
});
