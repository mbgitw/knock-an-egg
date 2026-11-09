import {EggPlacementObstacles} from '../public/gameplay/egg-placement-obstacles.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as THREE from 'three';
import {EGG_CONFIG as SOURCE} from '../public/gameplay/eggs/config.js';
import {EGG_CONFIG as C} from '../public/gameplay/eggs/runtime-config.js';
import {createHash} from 'node:crypto';
import {applyModelStuds,applyModelStudMaterial} from '../public/gameplay/v2-model-studs.js';
import {EggSpawnState,rollEggSize,pickEggTemplate,eggSpec} from '../public/gameplay/egg-spawn-state.js';
import {EggWorld,isOriginalEggPart} from '../public/gameplay/egg-world.js';
import {PickaxeProgress,ALL_SPECIES,restorePickaxes} from '../public/gameplay/pickaxe-state.js';
import {TreadmillState} from '../public/treadmill-state.js';
import {buildCollisionWorld} from '../public/world-physics.js';
import {isOriginalGuardPart} from '../public/gameplay/guard-system.js';
const read=p=>JSON.parse(fs.readFileSync(new URL(p,import.meta.url),'utf8'));
function rng(seed=13245){return ()=>((seed=(Math.imul(seed,1664525)+1013904223)>>>0)/4294967296);}
function make(options={}){return new EggSpawnState({random:rng(),...options}).initialize(null,100);}
test('v2 stud保持颜色贴图，补充材质着色器并随蛋实例克隆保留',()=>{
  const material=new THREE.MeshStandardMaterial({color:0xee6600,map:new THREE.Texture(),normalMap:new THREE.Texture()});
  const root=new THREE.Group(),mesh=new THREE.Mesh(new THREE.BoxGeometry(),material);root.add(mesh);
  const before=Array.from(mesh.geometry.attributes.position.array);applyModelStuds(root);
  assert.notEqual(mesh.material,material);assert.equal(mesh.material.map,material.map);assert.equal(mesh.material.normalMap,material.normalMap);assert.ok(mesh.material.color.equals(material.color));
  assert.deepEqual(Array.from(mesh.geometry.attributes.position.array),before);assert.ok(mesh.geometry.hasAttribute('studPosition'));assert.ok(mesh.geometry.hasAttribute('studNormal'));
  const shader={vertexShader:THREE.ShaderLib.standard.vertexShader,fragmentShader:THREE.ShaderLib.standard.fragmentShader,uniforms:{}};mesh.material.onBeforeCompile(shader,{});
  assert.equal(shader.uniforms.modelStudSpacing.value,.5);assert.ok(shader.vertexShader.includes('vStudPosition = studPosition * studWorldScale'));assert.ok(shader.fragmentShader.includes('float studHeight = studDetail.x'));assert.ok(shader.fragmentShader.includes('diffuseColor.rgb *= 1.0 + 0.035'));
  const hook=mesh.material.onBeforeCompile;applyModelStudMaterial(mesh.material);assert.equal(mesh.material.onBeforeCompile,hook);
  const clone=root.clone(true);assert.equal(clone.children[0].material.onBeforeCompile,hook);assert.equal(material.userData.modelStudSpacing,undefined);
});
test('30种蛋模板、首区14个、总数230',()=>{
  const state=make();assert.equal(state.zoneEggs(1).length,14);assert.equal(state.eggs.length,230);
  for(const e of state.eggs)assert.ok(C.templates.some(t=>t.id===e.spec.typeId&&t.available));
  assert.ok(pickEggTemplate(1).replacement);assert.equal(C.templates.filter(t=>t.replacement).length,22);
});
test('30种模型文件有效，v2实际模型/纹理字节哈希与10种原巢完整',()=>{
  for(const t of C.templates.filter(t=>t.available)){
    if(t.replacement){
      const v=t.replacement,bytes=fs.readFileSync(new URL('../public/gameplay/eggs/'+v.url,import.meta.url));
      assert.equal(v.format,'source-atlas');const records=JSON.parse(bytes);assert.ok(records.length>0);
      const bounds=new THREE.Box3();for(const record of records){const geometry=new THREE.BufferGeometryLoader().parse(record.geometry);geometry.computeBoundingBox();bounds.union(geometry.boundingBox);assert.ok(geometry.attributes.position.count>0);}
      assert.ok(bounds.getSize(new THREE.Vector3()).toArray().every((n,i)=>Math.abs(n-v.geometry.size[i])<.0001));
      assert.ok(t.bounds.min.every(Number.isFinite)&&t.bounds.max.every(Number.isFinite));assert.equal(t.body.size[1],1);continue;
    }
    const d=read(`../public/gameplay/eggs/models/${t.id}.json`);assert.ok(d.meshes.length);
    for(const m of d.meshes){assert.ok(m.positions.length>0);assert.ok(m.positions.every(Number.isFinite));assert.equal(m.normals.length,m.positions.length);assert.equal(m.uvs.length/2,m.positions.length/3);
      for(const g of m.groups)for(const k of ['texture','normal'])if(g.material[k])assert.ok(fs.existsSync(new URL('../public/gameplay/eggs/'+g.material[k],import.meta.url)));
    }
  }
  for(let z=1;z<=10;z++){const n=read(`../public/gameplay/eggs/models/nest-${z}.json`);assert.equal(n.meshes.length,2);assert.ok(n.heightRatio>.2&&n.heightRatio<.3);}
});
test('各区数量达上限，蛋保持边距/间隙，三段分布和宽度限制正确',()=>{
  for(const seed of [7,12345,183735]){
    const state=make({random:rng(seed)});for(let now=101;now<=150;now++)state.update(now);
    for(const z of C.zones){const eggs=state.zoneEggs(z.zone);assert.equal(eggs.length,z.availableTiers.length?z.capacity:0);
      for(let i=0;i<eggs.length;i++){const s=eggs[i].spec;assert.ok(Math.abs(s.position[0]-z.box.matrix[3])+s.radius<=z.box.size[0]/2-C.spawn.EdgeMargin+.001);assert.ok(Math.abs(s.position[2])+s.radius<=z.box.size[2]*C.spawn.WidthSpreadFraction/2+.001);
        for(let j=i+1;j<eggs.length;j++){const b=eggs[j].spec;assert.ok(Math.hypot(s.position[0]-b.position[0],s.position[2]-b.position[2])+1e-6>=s.radius+b.radius+C.spawn.Gap);}
      }
    }
  }
});
test('可用种类重新归一化权重；完整三档保持3:2:1',()=>{
  const random=rng(875),counts=[0,0,0];for(let i=0;i<60000;i++)counts[pickEggTemplate(9,random).tier-1]++;
  for(let i=0;i<3;i++)assert.ok(Math.abs(counts[i]/60000-[.5,1/3,1/6][i])<.008);
  for(let z=1;z<=10;z++){const seen=new Set();for(let i=0;i<200;i++)seen.add(pickEggTemplate(z,random).tier);assert.deepEqual([...seen].sort(),[1,2,3]);}
});
test('大小曲线保留原Roll公式和0.7小蛋尾部，MaxMult不是硬裁切上限',()=>{
  const sequence=[.00000000001,.1];assert.ok(rollEggSize(1,()=>sequence.shift())>C.size.ZoneCaps[0].SpawnMax);
  const small=[0,.9];assert.equal(rollEggSize(2,()=>small.shift()),.7);
  for(let z=1;z<=10;z++)for(let i=0;i<100;i++)assert.ok(Number.isFinite(rollEggSize(z,rng(i+z))));
});
test('血量随尺寸线性变化，TierScale不额外放大壳高，原蛋巢埋深一致',()=>{
  for(const t of C.templates.filter(t=>t.available)){
    const s=eggSpec(t,1.4,0,0,0,.5,.256);assert.equal(s.health,Math.floor(C.types[t.name].Health*1.4+.5));
    assert.ok(Math.abs(s.bodyHeight-(3+.3*(t.zone-1))*1.4)<1e-8);assert.ok(Math.abs(s.bodyBottom-.5-s.nestHeight*.2-s.reachBelow)<1e-8);
  }
});
test('一次挥击只扣一次血、破碎只结算一次，10–15秒后换位置和代次',()=>{
  const state=make(),egg=state.zoneEggs(2)[0],before=[...egg.spec.position];assert.ok(state.hit(egg,'first',1,100));assert.equal(state.hit(egg,'first',1,100.1),false);
  assert.ok(state.hit(egg,'break',1e15,101));assert.equal(state.hit(egg,'again',1e15,102),false);assert.ok(egg.life.respawnAt>=111&&egg.life.respawnAt<=116);
  state.update(egg.life.respawnAt-.01);assert.equal(state.slots.get(egg.spec.id).egg,egg);
  state.update(egg.life.respawnAt+.3);const next=state.slots.get(egg.spec.id).egg;assert.notEqual(next,egg);assert.equal(next.life.generation,1);assert.ok(next.life.alive);assert.notDeepEqual(next.spec.position,before);assert.equal(state.hit(egg,'stale',1e15,120),false);
});
test('活蛋和未到期破碎蛋可恢复，离线到期只补一代，不重复补发奖励',()=>{
  const state=make(),egg=state.eggs[0];state.hit(egg,1,1e15,100);const snapshot=state.snapshot();
  const restored=new EggSpawnState({random:rng()}).initialize(snapshot,101);const old=restored.slots.get(egg.spec.id).egg;assert.equal(old.life.hp,0);assert.equal(old.life.generation,0);
  const restoredAlive=restored.eggs.find(e=>e.life.alive),savedAlive=state.eggs.find(e=>e.spec.id===restoredAlive.spec.id);assert.deepEqual(restoredAlive.spec.position,savedAlive.spec.position);
  restored.update(50000);const next=restored.slots.get(egg.spec.id).egg;assert.equal(next.life.generation,1);assert.equal(next.life.hp,next.spec.health);assert.equal(restored.eggs.length,230);
});
test('阻挡/无地面不强行摆蛋，失败可重试且不穿墙补位',()=>{
  let allowed=false;const state=make({canPlace:()=>allowed});assert.equal(state.eggs.length,0);allowed=true;
  for(let i=0;i<100;i++)state.update(101+i);assert.equal(state.eggs.length,230);
  const absent=make({sampleGround:()=>null});assert.equal(absent.eggs.length,0);
});
test('真实地图：所有生成蛋都落在有效地面，尺寸净空与满额补位均通过',()=>{
  const map=read('../public/map.json'),parts=map.parts.filter(p=>!isOriginalEggPart(p.path)&&!isOriginalGuardPart(p.path)&&!p.path.includes('/Plots/'));
  const world=buildCollisionWorld(parts),helper=new EggWorld(new THREE.Scene(),null,{world});helper.placementObstacles=new EggPlacementObstacles(map.parts);
  const state=make({sampleGround:(x,z)=>helper.ground(x,z),canPlace:s=>helper.canPlace(s)});
  for(let i=0;i<120;i++)state.update(101+i);
  for(const z of C.zones)assert.equal(state.zoneEggs(z.zone).length,z.availableTiers.length?z.capacity:0,`zone ${z.zone}`);
  for(const e of state.eggs){assert.ok(helper.canPlace(e.spec));assert.ok(e.spec.floorY>=0&&e.spec.floorY<=2);const p=e.spec.position,hit=world.rayIntersect(new THREE.Ray(new THREE.Vector3(p[0],7,p[2]),new THREE.Vector3(0,-1,0)));assert.ok(hit&&Math.abs(hit.position.y-e.spec.floorY)<1e-6);}
});
test('86种Normal奖励使用本区池，读取旧收藏/现金不丢失，新区奖励只领卖一次',()=>{
  assert.equal(ALL_SPECIES.length,86);const a=new TreadmillState(),progress=new PickaxeProgress(a);a.creditCash('200000000000000000');
  const old=progress.hatch('zone1-egg-722:0',()=>0);assert.equal(old.name,'Chicken');assert.ok(progress.bank(old));const cash=a.data.cash;
  for(let z=2;z<=10;z++){const id=`zone${z}-egg-0:0`,pet=progress.hatch(id,()=>0);assert.equal(pet.zone,z);assert.ok(C.zones[z-1].animalPool.some(p=>p.name===pet.name));assert.equal(progress.hatch(id),null);assert.ok(progress.bank(pet));assert.ok(progress.sell(id));assert.equal(progress.sell(id),false);}
  assert.ok(progress.data.pets.some(p=>p.id===old.id));assert.equal(restorePickaxes(a.data.pickaxes).pets[0].name,'Chicken');assert.equal(progress.hatch('zone2-egg-1:0',()=>0,3),null);
});

 test('旧216蛋存档升级为230，现金/收藏保留，原几何不被覆盖',()=>{
  const state=make(),saved=state.snapshot();for(const id of Object.keys(saved.slots))if(id.startsWith('zone1-'))delete saved.slots[id];
  const restored=new EggSpawnState({random:rng(45)}).initialize(saved,101);assert.equal(restored.zoneEggs(1).length,14);assert.equal(restored.eggs.length,230);
  for(const e of restored.eggs.filter(e=>e.spec.zone>1)){const old=saved.slots[e.spec.id];assert.equal(e.life.generation,old.generation);assert.equal(e.spec.typeId,old.spec.typeId);}
  assert.equal(SOURCE.templates.filter(t=>t.available).length,16);assert.equal(SOURCE.templates.filter(t=>t.replacement).length,0);
 });


test('非碰撞石头仍阻挡蛋及蛋巢，埋入石头的旧存档重新选点',()=>{
 const map=read('../public/map.json'),obstacles=new EggPlacementObstacles(map.parts);
 assert.equal(obstacles.zones.size,10);
 const rock=map.parts.find(p=>p.path.includes('/Zone1/Decor/Rocks/')&&!p.collide&&p.transparency===0&&p.size[1]>2);
 assert.ok(rock);const template=C.templates.find(t=>t.zone===1&&t.available);
 const spec=eggSpec(template,1,rock.matrix[3],rock.matrix[11],0,.5);
 assert.equal(obstacles.clear(spec),false);
 const state=make(),saved=state.snapshot(),id='zone1-egg-0';saved.slots[id].spec={...saved.slots[id].spec,typeId:template.id,sizeMult:1,position:spec.position,yaw:0};
 const restored=new EggSpawnState({random:rng(42),canPlace:s=>obstacles.clear(s)}).initialize(saved,200);
 assert.notDeepEqual(restored.slots.get(id).egg?.spec.position,spec.position);
 for(const e of restored.eggs)assert.ok(obstacles.clear(e.spec));
});
