import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as THREE from 'three';
import {createMissingPlotBoards} from '../public/gameplay/plot-board-models.js';
import {buildCollisionWorld} from '../public/world-physics.js';
const read=p=>JSON.parse(fs.readFileSync(new URL(p,import.meta.url)));
test('each local owner sees only their own solid upgrade boards',()=>{
  const map=read('../public/map.json'),layout=read('../public/gameplay/plot-upgrades/tiers.json'),treadmill=read('../public/treadmill-runtime.json');
  const {root,parts,collision,setOwner}=createMissingPlotBoards(map.parts,layout.bases);assert.equal(parts.length,28);assert.equal(root.children.length,28);assert.ok(root.children.every(m=>!m.visible));
  const world=buildCollisionWorld(parts);
  for(const base of layout.bases)for(const [kind,anchor] of [['UpgradeBoard',layout.board.matrix],['TreadmillBoard',treadmill.boardMatrix]]){
    const board=parts.find(p=>p.path===`/Workspace/Plots/${base.id}/${kind}/Board`),matrix=new THREE.Matrix4().set(...board.matrix,0,0,0,1);
    const expected=new THREE.Matrix4().set(...base.transform).multiply(new THREE.Matrix4().set(...anchor));
    assert.ok(matrix.elements.every((v,i)=>Math.abs(v-expected.elements[i])<.0001));
    const center=new THREE.Vector3().setFromMatrixPosition(matrix),normal=new THREE.Vector3(1,0,0).transformDirection(matrix),ray=new THREE.Ray(center.clone().add(new THREE.Vector3(0,.1,0)).addScaledVector(normal,3),normal.negate());
    setOwner(null);assert.equal(collision.rayIntersect(ray),false);
    setOwner(base.id);assert.equal(root.children.filter(m=>m.visible).length,4);assert.ok(collision.rayIntersect(ray),base.id+kind);
    setOwner(null);assert.equal(collision.rayIntersect(ray),false);
    const hit=world.rayIntersect(ray);assert.ok(hit&&Math.abs(hit.distance-2.5)<.01);
  }
});


