import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as THREE from 'three';
import {Matrix4 as RuntimeMatrix4} from '../public/vendor/three.core.js';
import {batchStaticBlocks,skipHiddenMatrices,PresentationVisibility} from '../public/static-blocks.js';
import {createPlotModel} from '../public/gameplay/plot-system.js';
const data=JSON.parse(fs.readFileSync(new URL('../public/gameplay/plot-upgrades/tiers.json',import.meta.url)));
const geo=JSON.parse(fs.readFileSync(new URL('../public/gameplay/plot-upgrades/geometry.json',import.meta.url)));

test('Matrix4 typed fast path preserves normal arrays, offsets, return identity and short typed writes',()=>{
  const m=new RuntimeMatrix4().makeRotationX(.31);m.setPosition(7,13,29);
  for(const offset of [0,3,16]){const target=new Float32Array(32).fill(-1),expected=target.slice();m.elements.forEach((v,i)=>expected[offset+i]=v);assert.equal(m.toArray(target,offset),target);assert.deepEqual(target,expected);}
  const normal=[99];assert.equal(m.toArray(normal,1),normal);assert.deepEqual(normal,[99,...m.elements]);
  const short=new Float32Array(4);m.toArray(short);assert.deepEqual([...short],m.elements.slice(0,4).map(Math.fround));
  const mixed=[];for(let i=0;i<100;i++){m.toArray(mixed);m.toArray(new Float32Array(16));}assert.deepEqual(mixed,m.elements);
});

test('all nine pasture tiers: block batching reduces calls/verts, preserves bounds, triangles and overlays',()=>{
  const reports=[];
  for(const tier of data.tiers){
    const materials=[...geo.meshes,...geo.overlays].map(()=>new THREE.MeshStandardMaterial());
    const root=createPlotModel(data,geo,tier.level,materials,data.bases.find(b=>b.id==='Base_5'));
    const bounds=new THREE.Box3().setFromObject(root),overlays=[];let triangles=0;
    root.traverse(o=>{if(o.isMesh)triangles+=(o.geometry.index?.count??o.geometry.attributes.position.count)/3;if(o.userData.plotTexture)overlays.push([o,new THREE.Box3().setFromObject(o)]);});
    batchStaticBlocks(root);const after=new THREE.Box3().setFromObject(root);assert.ok(bounds.min.distanceTo(after.min)<.001&&bounds.max.distanceTo(after.max)<.001);
    let actual=0;root.traverse(o=>{if(o.isMesh)actual+=(o.geometry.index?.count??o.geometry.attributes.position.count)/3;assert.equal(o.matrixAutoUpdate,false);});assert.equal(actual,triangles);
    // Every original texture vertex stays at the same world location after the
    // coplanar overlays are merged, including the rotated Base_5 transform.
    const vertices=[];root.traverse(o=>{if(o.userData.plotTexture)for(let i=0;i<o.geometry.attributes.position.count;i++)vertices.push(new THREE.Vector3().fromBufferAttribute(o.geometry.attributes.position,i).applyMatrix4(o.matrixWorld));});
    for(const [o] of overlays)for(let i=0;i<o.geometry.attributes.position.count;i++){const point=new THREE.Vector3().fromBufferAttribute(o.geometry.attributes.position,i).applyMatrix4(o.matrixWorld);assert.ok(vertices.some(v=>v.distanceTo(point)<.001));}
    const stats=root.userData.blockStats;assert.ok(stats.afterDraws<stats.beforeDraws);assert.ok(stats.afterVertices<stats.beforeVertices);reports.push({level:tier.level,...stats});
    root.traverse(o=>{o.geometry?.dispose();o.material?.dispose();});materials.forEach(m=>m.dispose());
  }
});

test('hidden render roots skip bone matrix traversal and recover their current transform when visible',()=>{
  const root=skipHiddenMatrices(new THREE.Group()),child=new THREE.Bone();root.add(child);root.updateMatrixWorld(true);root.visible=false;child.position.x=12;root.updateMatrixWorld(true);assert.equal(child.matrixWorld.elements[12],0);root.visible=true;root.updateMatrixWorld(true);assert.equal(child.matrixWorld.elements[12],12);
  const view=new PresentationVisibility(),camera=new THREE.PerspectiveCamera(60,1,.1,100);view.update(camera);assert.equal(view.visible(new THREE.Vector3(0,0,-20),4),true);assert.equal(view.visible(new THREE.Vector3(0,0,20),4),false);
});
