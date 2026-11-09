import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as THREE from 'three';
import {TreadmillState,restoreState} from '../public/treadmill-state.js';
import {PlotProgress,PLOT_COSTS,restorePlot} from '../public/gameplay/plot-state.js';
import {createPlotModel,initialPlotParts} from '../public/gameplay/plot-system.js';
import {buildCollisionWorld,combineCollisionWorlds,CharacterMotor} from '../public/world-physics.js';
import {money} from '../public/gameplay/currency.js';
const data=JSON.parse(fs.readFileSync(new URL('../public/gameplay/plot-upgrades/tiers.json',import.meta.url)));
const geo=JSON.parse(fs.readFileSync(new URL('../public/gameplay/plot-upgrades/geometry.json',import.meta.url)));
const memory=()=>{const m=new Map();return {getItem:k=>m.get(k)||null,setItem:(k,v)=>m.set(k,v)};};
test('nine exact original prices/capacities; insufficient cash, stale requests and MAX cannot spend',()=>{
 const a=new TreadmillState(),p=new PlotProgress(a);assert.equal(p.level,1);assert.equal(p.capacity,8);assert.equal(p.upgrade(1),false);
 assert.deepEqual(data.costs,PLOT_COSTS);
 for(let level=1;level<9;level++){
  a.data.cash=p.cost-1;assert.equal(p.upgrade(level),false);assert.equal(a.data.cash,p.cost-1);
  a.data.cash=p.cost;assert.equal(p.upgrade(level),true);assert.equal(a.data.cash,0);assert.equal(p.capacity,level+8);
  assert.equal(p.upgrade(level),false);
 }
 a.creditCash('999999999999999999999');assert.equal(p.upgrade(9),false);assert.equal(p.cost,null);
});
test('shared wallet persists the plot without resetting treadmill, pickaxe inventory or power',()=>{
 const storage=memory(),a=new TreadmillState({storage});a.unlock();a.creditCash('99999999999999999999');
 a.data.power=8765;a.data.pickaxes.pets=[{id:'zone1-egg-1:0',name:'Chicken'}];
 const p=new PlotProgress(a),before=money(a.data.cash);assert.ok(p.upgrade(1));
 const b=new TreadmillState({storage});assert.equal(b.data.plot.level,2);assert.equal(money(b.data.cash),before-10000n);
 assert.equal(b.data.power,8765);assert.equal(b.data.unlocked,true);assert.equal(b.data.pickaxes.pets[0].id,'zone1-egg-1:0');
});
test('legacy and corrupt plot saves normalize independently; training and foreign ownership reject upgrades',()=>{
 assert.equal(restoreState({version:1,cash:54321}).plot.level,1);
 for(const [value,expected] of [[null,1],[NaN,1],[Infinity,1],['9',1],[-8,1],[2.8,2],[999,9]])assert.equal(restorePlot({level:value}).level,expected);
 const a=new TreadmillState(),p=new PlotProgress(a);a.creditCash(10000);a.unlock();a.begin();assert.equal(p.upgrade(1),false);a.end();
 a.data.baseId='Base_4';assert.equal(p.upgrade(1),false);
});
test('all 369 authored parts render at their true bounds, with fixed entrance and five-unit expansion',()=>{
 const mats=[...geo.meshes,...geo.overlays].map(()=>new THREE.MeshBasicMaterial());let lastWidth=41;
 for(const tier of data.tiers){
  const model=createPlotModel(data,geo,tier.level,mats);assert.equal(model.children.length,41);assert.equal(new Set(tier.parts.map(p=>p.geometryPart)).size,41);
  for(const p of tier.parts){
   const mesh=model.children.find(m=>m.name===p.path&&new THREE.Vector3().setFromMatrixPosition(m.matrix).distanceTo(new THREE.Vector3(p.matrix[3],p.matrix[7],p.matrix[11]))<.001);
   assert.ok(mesh,p.path);const expected=new THREE.Box3().setFromCenterAndSize(new THREE.Vector3(),new THREE.Vector3(...p.size)).applyMatrix4(new THREE.Matrix4().set(...p.matrix));
   const color=new THREE.Color().setRGB(...[(p.color>>16)&255,(p.color>>8)&255,p.color&255].map(c=>(c/255)**2.2));
   assert.ok(Math.abs(mesh.material.color.r-color.r)+Math.abs(mesh.material.color.g-color.g)+Math.abs(mesh.material.color.b-color.b)<1e-6);
   mesh.geometry.computeBoundingBox();const actual=mesh.geometry.boundingBox.clone().applyMatrix4(mesh.matrixWorld);assert.ok(actual.min.distanceTo(expected.min)<.001);assert.ok(actual.max.distanceTo(expected.max)<.001);
   assert.equal(mesh.children.length,1);const overlay=mesh.children[0];assert.equal(overlay.userData.plotTexture,true);
   const top=new THREE.Box3();for(const x of [-.5,.5])for(const z of [-.5,.5])top.expandByPoint(new THREE.Vector3(x*p.size[0],p.size[1]/2+.005,z*p.size[2]).applyMatrix4(new THREE.Matrix4().set(...p.matrix)));
   const faceBounds=new THREE.Box3().setFromObject(overlay);assert.ok(faceBounds.min.distanceTo(top.min)<.002);assert.ok(faceBounds.max.distanceTo(top.max)<.002);
  }
  const step=tier.parts.filter(p=>p.name==='Grass').sort((a,b)=>a.size[1]-b.size[1])[0];
  assert.ok(Math.abs(step.matrix[3]+9.32831001)<.001);
  assert.ok(Math.abs(tier.hitbox.size[0]-lastWidth-5)<.001);lastWidth=tier.hitbox.size[0];
  model.traverse(o=>{o.geometry?.dispose();o.material?.dispose();});
 }
 for(const m of mats)m.dispose();
});
test('expanded ground supports the new area and retains original non-solid decorative fences',()=>{
 const first=data.tiers[0],last=data.tiers[8];
 const center=new THREE.Vector3(first.hitbox.matrix[3]+first.hitbox.size[0]/2+5,5,first.hitbox.matrix[11]);
 const ray=new THREE.Ray(center,new THREE.Vector3(0,-1,0));
 const oldWorld=buildCollisionWorld(first.parts),newWorld=buildCollisionWorld(last.parts);
 const oldHit=oldWorld.rayIntersect(ray),newHit=newWorld.rayIntersect(ray);
 assert.equal(oldHit,false);assert.ok(newHit);assert.ok(Math.abs(newHit.position.y-1.2666668)<.001);
 const motor=new CharacterMotor(newWorld,new THREE.Vector3(center.x,1.267,center.z));
 for(let i=0;i<120;i++)motor.step(1/120,new THREE.Vector3(1,0,0));
 assert.ok(motor.position.x>center.x+5);assert.ok(motor.grounded);
 assert.ok(last.parts.filter(p=>p.path.includes('/Fence/')).every(p=>!p.collide));
});
test('static map excludes all seven captured Builds and still excludes captured animals',()=>{
 const manifest=JSON.parse(fs.readFileSync(new URL('../public/obj-map/manifest.json',import.meta.url)));
 assert.equal(manifest.cleanup.removedPlotBuildMeshes,291);
 assert.equal(manifest.cleanup.removedPlotBuild.filter(p=>/\/(UpgradeBoard|TreadmillBoard)\//.test(p.nodePath)).length,4);assert.equal(manifest.cleanup.removedBaseAnimalMeshes,49);
 assert.equal(new Set(manifest.cleanup.removedPlotBuild.map(m=>m.nodePath.split('/')[3])).size,7);
 assert.equal(manifest.cleanup.removedPlotTextureMeshes,287);
 const names=new Set(manifest.objects.map(o=>o.name));
 assert.ok(manifest.cleanup.removedPlotTextures.every(o=>o.triangles===2&&!names.has(o.name)));
});
test('all six other bases use level one at their original entrance, with matching world collision',()=>{
 const parts=initialPlotParts(data),map=JSON.parse(fs.readFileSync(new URL('../public/map.json',import.meta.url)));
 assert.equal(data.bases.length,7);assert.equal(parts.length,246);
 for(const base of data.bases.filter(b=>b.id!=='Base_3')){
  const ps=parts.filter(p=>p.path.startsWith(`/Workspace/Plots/${base.id}/`));assert.equal(ps.length,41);
  const entrance=ps.filter(p=>p.name==='Grass').sort((a,b)=>a.size[1]-b.size[1])[0];
  const source=map.parts.filter(p=>p.path.startsWith(`/Workspace/Plots/${base.id}/Build/`)&&p.name==='Grass').sort((a,b)=>a.size[1]-b.size[1])[0];
  assert.ok(new THREE.Vector3(entrance.matrix[3],entrance.matrix[7],entrance.matrix[11]).distanceTo(new THREE.Vector3(source.matrix[3],source.matrix[7],source.matrix[11]))<.001);
  assert.ok(Math.abs(Math.max(...ps.filter(p=>p.name==='Grass').map(p=>p.size[0]))-46)<.001);
  assert.ok(ps.filter(p=>p.path.includes('/Fence/')).every(p=>p.color===0x704e27));
 }
});
test('one-time fence reset preserves the wallet and unrelated progress, then future upgrades persist',()=>{
 const old={version:1,cash:54321,power:8765,unlocked:true,level:4,plot:{level:9},trails:{owned:[1],equipped:1}};
 const reset=restoreState(old);assert.equal(reset.plot.level,1);assert.equal(reset.cash,54321);assert.equal(reset.power,8765);assert.equal(reset.level,4);assert.equal(reset.trails.equipped,1);
 const a=new TreadmillState();a.data=reset;const p=new PlotProgress(a);assert.ok(p.upgrade(1));
 const next=restoreState(JSON.parse(JSON.stringify(a.data)));assert.equal(next.plot.level,2);assert.equal(next.cash,44321);
});
test('combined world resolves raised plot ground and preserves static wall occlusion',()=>{
 const staticWorld=buildCollisionWorld([{className:'Part',size:[300,1,300],matrix:[1,0,0,0,0,1,0,0,0,0,1,0],collide:true},{className:'Part',size:[.5,15,50],matrix:[1,0,0,30,0,1,0,7.5,0,0,1,52],collide:true}]);
 const world=combineCollisionWorlds(staticWorld,buildCollisionWorld(data.tiers[8].parts));
 const m=new CharacterMotor(world,new THREE.Vector3(20,1.267,52));
 for(let i=0;i<240;i++)m.step(1/120,new THREE.Vector3(1,0,0));
 assert.ok(m.position.x>28&&m.position.x<29);assert.ok(Math.abs(m.position.y-1.26677)<.002);assert.ok(m.grounded);
 assert.ok(world.rayIntersect(new THREE.Ray(new THREE.Vector3(20,3,52),new THREE.Vector3(1,0,0))).distance<10);
});

