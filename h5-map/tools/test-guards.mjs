import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as THREE from 'three';
import {buildGuardModel} from '../public/gameplay/guard-model.js';
import {GuardNavigation} from '../public/gameplay/guard-navigation.js';
import {GuardBrain,guardChaseFactor,guardFling} from '../public/gameplay/guard-brain.js';
import {GuardSystem} from '../public/gameplay/guard-system.js';
import {CharacterMotor,buildCollisionWorld} from '../public/world-physics.js';
const root=new URL('../public/gameplay/guards/',import.meta.url),read=p=>JSON.parse(fs.readFileSync(new URL(p,root)));
const catalog=read('catalog.json'),nav=new GuardNavigation(read('navigation.json')),r=catalog.rules;
const vector=p=>new THREE.Vector3(p.x,p.y,p.z);
test('guard textured materials preserve approved tint values',()=>{
 const expected=JSON.parse(fs.readFileSync(new URL('./fixtures/guard-colors.json',import.meta.url)));
 assert.equal(expected.length,6);
 for(const entry of expected){
  const part=read(`models/zone-${entry.zone}.json`).parts.find(p=>p.path===entry.path);
  assert.ok(part.material.texture);assert.ok(part.material.objColor);
  assert.deepEqual(part.material.color,new THREE.Color().setRGB(...entry.color,THREE.SRGBColorSpace).toArray());
 }
});
function vertices(model){model.root.updateMatrixWorld(true);model.skeletons.forEach(s=>s.update());
  const box=new THREE.Box3(),sample=[];
  for(const mesh of model.meshes){const a=mesh.geometry.attributes.position;
    for(let i=0;i<a.count;i++){
      const p=new THREE.Vector3().fromBufferAttribute(a,i);mesh.applyBoneTransform(i,p);p.applyMatrix4(mesh.matrixWorld);
      assert.ok(p.toArray().every(Number.isFinite));box.expandByPoint(p);if(i%37===0)sample.push(...p.toArray());
    }
  }return {box,sample};
}
for(const definition of catalog.guards)test(`区域 ${definition.zone}: 原蒙皮与全部原动作有限且尺寸稳定`,()=>{
  const data=read(definition.model),model=buildGuardModel(data,{loadTextures:false}),rest=vertices(model);
  assert.equal(model.meshes.length,data.parts.reduce((n,p)=>n+1+p.overlays.length,0));
  assert.ok(Math.abs(rest.box.getSize(new THREE.Vector3()).y-definition.height)<.04);
  for(const [name,action] of Object.entries(definition.actions)){
    model.addAction(name,read(action.url));model.play(name);model.update(.28);
    const pose=vertices(model),size=pose.box.getSize(new THREE.Vector3());
    assert.ok(size.length()<definition.height*6,`${name} exploded: ${size.toArray()}`);
    assert.ok(pose.sample.some((n,i)=>Math.abs(n-rest.sample[i])>1e-4),`${name} does not deform mesh`);
    model.mixer.stopAllAction();
  }
  model.dispose();
});
test('所有区域出生点可到达巡逻点，走边均有烘焙的胶囊净空',()=>{
  for(const d of catalog.guards){
    const brain=new GuardBrain(d,r,nav,{random:()=>.36});
    assert.ok(brain.patrolPoint(),`zone ${d.zone}`);
    for(let n=1;n<brain.path.length;n++){
      const a=nav.nearest(brain.path[n-1]),b=nav.nearest(brain.path[n]);
      assert.ok(nav.neighbors(a).some(([i])=>i===b));
    }
    const start=brain.position.clone();for(let n=0;n<300;n++)brain.update(.05,null);
    assert.ok(brain.position.distanceTo(start)>1);
  }
});
test('A* 绕过墙且禁止斜穿封闭角',()=>{
  const grid=new GuardNavigation({x:0,z:0,step:1,width:5,depth:5,heights:Array(25).fill(0)});
  for(const i of [2,7,12,17])grid.heights[i]=null;
  const path=grid.path({x:0,y:0,z:0},{x:4,y:0,z:0});assert.ok(path.some(p=>p.z===4));
  const corner=new GuardNavigation({x:0,z:0,step:1,width:2,depth:2,heights:[0,null,null,0]});
  assert.equal(corner.path({x:0,y:0,z:0},{x:1,y:0,z:1}).length,0);
});
test('无搬运不追逐，错误区域不触发，警戒延时后追逐，安全区与清除携带会回位',()=>{
  const d=catalog.guards[0],brain=new GuardBrain(d,r,nav,{random:()=>.5});
  const target={position:new THREE.Vector3(...d.home).add(new THREE.Vector3(-20,0,0)),power:1,safe:false};
  for(let n=0;n<20;n++)brain.update(.05,target);assert.ok(!['WindUp','Chasing'].includes(brain.state));
  target.carrying={zone:2};brain.update(.05,target);assert.notEqual(brain.state,'WindUp');
  target.carrying={zone:1};brain.update(.05,target);assert.equal(brain.state,'WindUp');
  for(let n=0;n<10;n++)brain.update(.05,target);assert.equal(brain.state,'WindUp');
  for(let n=0;n<5;n++)brain.update(.05,target);assert.equal(brain.state,'Chasing');
  target.safe=true;brain.update(.05,target);assert.ok(['Returning','Idle'].includes(brain.state));
  target.safe=false;brain.update(.05,target);assert.equal(brain.state,'WindUp');
  target.carrying=null;brain.update(.05,target);assert.ok(['Returning','Idle'].includes(brain.state));
});
test('10 区抓捕均只通知一次，攻击结束后沿路径回位',()=>{
  for(const d of catalog.guards){let catches=0;
    const brain=new GuardBrain(d,r,nav,{random:()=>.5,onCatch:()=>catches++});
    const target={position:brain.position.clone(),power:1,carrying:{zone:d.zone}};
    for(let n=0;n<20;n++)brain.update(.05,target);
    assert.equal(catches,1,`zone ${d.zone}`);assert.equal(brain.state,'Catching');
    target.carrying=null;for(let n=0;n<55;n++)brain.update(.05,target);
    assert.equal(catches,1);assert.ok(['Idle','Roaming','Returning'].includes(brain.state));
  }
});
test('被墙挡住时不远程抓捕，碰撞失败不会穿墙',()=>{
  const d=catalog.guards[0];let catches=0;
  const brain=new GuardBrain(d,r,nav,{canMove:()=>false,lineOfSight:()=>false,onCatch:()=>catches++});
  const start=brain.position.clone(),target={position:start.clone(),power:1,carrying:{zone:1}};
  for(let n=0;n<200;n++)brain.update(.05,target);
  assert.equal(catches,0);assert.ok(brain.position.equals(start));
});
test('十区追逐一段距离抓捕，解除携带后均能回家结束追逐',()=>{
  for(const d of catalog.guards){let caught=false;
    const brain=new GuardBrain(d,r,nav,{random:()=>.5,onCatch:()=>caught=true});
    const target={position:brain.position.clone().add(new THREE.Vector3(-28,0,0)),power:1,carrying:{zone:d.zone}};
    for(let n=0;n<1000&&!caught;n++)brain.update(.05,target);
    assert.ok(caught,`zone ${d.zone} must catch`);target.carrying=null;
    let returned=false;
    for(let n=0;n<1000;n++){brain.update(.05,target);if(brain.state==='Idle'&&brain.position.distanceTo(brain.home)<=r.HomeArrivalDistance){returned=true;break;}}
    assert.ok(returned,`zone ${d.zone} must return home`);
  }
});
test('搬运接口显式 null 可解除；外部目标相同 token 被抓后不能重复抓捕',()=>{
  const player={motor:new CharacterMotor({capsuleIntersect:()=>false}),keys:new Set(),touchMove:new THREE.Vector2()};
  const system=new GuardSystem({scene:new THREE.Scene(),player,account:{data:{power:12}},canvas:{dataset:{}},catalog,navigation:read('navigation.json')});
  player.motor.teleport(new THREE.Vector3(...catalog.guards[0].home));
  system.setCarrying({zone:1});assert.equal(system.target().carrying.zone,1);
  system.setTargetProvider(()=>({carrying:null}));assert.equal(system.target().carrying,null);
  let drops=0;const carry={zone:1,token:'animal-instance-1',onDrop:()=>drops++};
  system.setTargetProvider(()=>({carrying:{...carry}}));
  system.catch({definition:catalog.guards[0]},system.target());assert.equal(drops,1);assert.equal(system.catchCount,1);
  system.immunity=0;player.motor.externalMotion=null;
  assert.equal(!!system.target().disabled,true);
  system.setTargetProvider(null);system.setCarrying(null);assert.equal(system.target().carrying,null);
});
test('原倍率的门槛/高力量下限及 10 区击飞参数',()=>{
  assert.equal(guardChaseFactor(100,100,r),1);assert.equal(guardChaseFactor(120,100,r),.85);
  assert.equal(guardChaseFactor(1e30,100,r),.4);assert.equal(guardChaseFactor(1,1e20,r),4);
  for(const d of catalog.guards){const f=guardFling(d.config,r,()=>0);assert.ok(f.duration>=3);assert.equal(f.gravityScale,1.44);
    const range=f.horizontal*2*f.vertical/(65*f.gravityScale);assert.ok(Math.abs(range-d.config.FlingDistance)<1e-6);
  }
});
test('击飞保留连续碰撞，落地后解除外力并恢复普通移动',()=>{
  const parts=[{collide:true,className:'Part',shape:1,size:[200,1,200],matrix:[1,0,0,0,0,1,0,0,0,0,1,0]},
    {collide:true,className:'Part',shape:1,size:[1,30,200],matrix:[1,0,0,8,0,1,0,15,0,0,1,0]}];
  const motor=new CharacterMotor(buildCollisionWorld(parts),new THREE.Vector3(0,.6,0));
  const f=guardFling(catalog.guards[9].config,r,()=>0);motor.launch(new THREE.Vector3(f.horizontal,f.vertical,0),f);
  for(let i=0;i<Math.ceil((f.duration+.2)*120);i++){motor.step(1/120,new THREE.Vector3(1,0,0));assert.ok(motor.position.x<6.51);}
  assert.equal(motor.externalMotion,null);assert.ok(Math.abs(motor.position.y-.5)<.02);assert.ok(Number.isFinite(motor.position.y));
  for(let i=0;i<120;i++)motor.step(1/120,new THREE.Vector3(-1,0,0));assert.ok(motor.position.x<0);
});

test('repick outside source region reacquires; safe and other-source pets do not',()=>{
 const d=catalog.guards[0],brain=new GuardBrain(d,r,nav,{random:()=>.5});
 const target={position:new THREE.Vector3(...catalog.guards[1].home),power:1,carrying:{zone:1,token:1}};
 brain.update(.05,target);assert.equal(brain.state,'WindUp');
 target.carrying=null;brain.update(.05,target);assert.ok(['Returning','Idle'].includes(brain.state));
 target.carrying={zone:1,token:2};brain.update(.05,target);assert.equal(brain.state,'WindUp');
 target.safe=true;brain.update(.05,target);assert.ok(!['WindUp','Chasing'].includes(brain.state));
 target.safe=false;target.carrying={zone:2,token:3};brain.update(.05,target);assert.ok(!['WindUp','Chasing'].includes(brain.state));
});
