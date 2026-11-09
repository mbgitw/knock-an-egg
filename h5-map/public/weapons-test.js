import * as THREE from 'three';
import {clone} from './vendor/SkeletonUtils.js';
import {CharacterMotor} from './world-physics.js';
const $=s=>document.querySelector(s),wait=ms=>new Promise(r=>setTimeout(r,ms));
while(!window.game){if($('canvas').dataset.error)throw Error($('canvas').dataset.error);await wait(100);}
const g=window.game,w=g.weapons;
const combat=w.combat;
const dummy={actor:new THREE.Group(),motor:new CharacterMotor(g.player.world),keys:new Set(),touchMove:new THREE.Vector2()};
const dummyModel=clone(g.player.model);dummy.actor.add(dummyModel);g.scene.add(dummy.actor);
const dummyMixer=new THREE.AnimationMixer(dummyModel),dummyActions=new Map([...g.player.actions].map(([n,a])=>[n,dummyMixer.clipAction(a.getClip())]));
let dummyAction;let last=performance.now();
function tick(now){const dt=Math.min(.05,(now-last)/1000);last=now;
  if(!document.hidden){for(let t=0;t<dt;t+=1/120)dummy.motor.step(Math.min(1/120,dt-t),new THREE.Vector3());dummy.actor.position.copy(dummy.motor.position);
    const motion=dummy.motor.externalMotion,name=motion?'Guard Knockback':'Breathing Idle',action=dummyActions.get(name);
    if(action!==dummyAction){dummyAction?.stop();action.reset().play();dummyAction=action;}
    if(motion){const left=motion.duration-motion.elapsed;action.time=left<.5?1+.8*(1-left/.5):Math.min(1,motion.elapsed/.5);action.timeScale=0;}else action.timeScale=1;
    dummyMixer.update(dt);
  }requestAnimationFrame(tick);
}requestAnimationFrame(tick);
const dummyEntry=combat.register({id:'test-player',player:dummy});
function arena(){
  const egg=g.pickaxes.eggs.eggs.find(e=>e.spec.zone===1),p=new THREE.Vector3(egg.spec.position[0]-12,egg.spec.floorY+.1,egg.spec.position[2]+12);
  g.player.motor.teleport(p);g.player.actor.position.copy(p);g.player.actor.rotation.y=-Math.PI/2;
  dummy.motor.teleport(p.clone().add(new THREE.Vector3(-10,0,0)));dummy.actor.position.copy(dummy.motor.position);dummyEntry.immuneUntil=0;dummyEntry.wasThrown=false;combat.local.immuneUntil=0;combat.local.wasThrown=false;
  g.guards.immunity=1000;frame();
}
const combatButton=document.createElement('button');combatButton.textContent='重置对练角色';combatButton.onclick=arena;$('#qa').append(combatButton);
const receiveButton=document.createElement('button');receiveButton.textContent='对手攻击我';receiveButton.onclick=()=>combat.attackFrom('test-player',Number($('#tier').value));$('#qa').append(receiveButton);
const combatSuite=document.createElement('button');combatSuite.textContent='验收命中与受击';$('#qa').append(combatSuite);
const dropSuite=document.createElement('button');dropSuite.textContent='验收携带物受击掉落';$('#qa').append(dropSuite);
dropSuite.onclick=async()=>{
  dropSuite.disabled=true;delete $('#result').dataset.error;delete $('#result').dataset.dropPassed;
  try{
    arena();g.animals.drop({returnHome:true});const A=g.animals,S=A.state;
    const egg=g.pickaxes.eggs.eggs.find(e=>e.spec.zone===1&&e.life.alive&&e.hittable);
    const result=g.pickaxes.eggs.hit(egg,`weapon-drop-${performance.now()}`,egg.life.hp);
    if(!result?.pet)throw Error('测试孵化未开始');$('#result').textContent='等待真实孵化与拾取…';
    const end=performance.now()+20000;while(!S.animals.has(result.pet.id)&&performance.now()<end)await wait(100);
    const a=S.animals.get(result.pet.id);if(!a)throw Error('孵化超时');
    const p=new THREE.Vector3(a.position.x-4,a.position.y+.1,a.position.z);
    g.player.motor.teleport(p);g.player.actor.position.copy(p);frame();await wait(100);
    if(!A.begin())throw Error('拾取未开始');const pickupEnd=performance.now()+5000;
    while(S.carrying!==a&&performance.now()<pickupEnd)await wait(50);
    if(S.carrying!==a)throw Error('拾取超时');
    const impact=g.player.motor.position.clone(),count=S.animals.size,pets=g.pickaxes.progress.data.pets.length;
    dummy.motor.teleport(impact.clone().add(new THREE.Vector3(-6,0,0)));dummyEntry.cooldownUntil=0;combat.local.immuneUntil=0;
    if(!combat.attackFrom('test-player',1))throw Error('受击未生效');
    if(S.carrying||a.status!=='ground'||a.position.x!==impact.x||a.position.z!==impact.z||S.animals.size!==count||g.pickaxes.progress.data.pets.length!==pets||g.guards.carrying)throw Error('掉落状态或实例不一致');
    if(!g.player.motor.externalMotion)throw Error('掉落后未击退');
    $('#result').dataset.dropPassed='true';$('#result').textContent='通过：真实孵化、长按拾取、命中前位置掉落、解除守卫携带追踪、原实例保留、无重复奖励、受击击退';
  }catch(e){$('#result').dataset.error=e.message;$('#result').textContent='失败 '+e.message;console.error(e);}finally{dropSuite.disabled=false;}
};
combatSuite.onclick=async()=>{
  const lines=[],check=(ok,msg)=>{if(!ok)throw Error(msg);lines.push('通过 '+msg);$('#result').textContent=lines.join('\n');};
  delete $('#result').dataset.error;delete $('#result').dataset.combatPassed;
  try{arena();await w.equip(1);await wait(150);check(combat.target?.id==='test-player'&&combat.highlight.overlays.length>0,'最近玩家高亮');
    w.cooldownUntil=0;const hits=combat.hitCount;check(w.swing(),'挥击');check(combat.hitCount===hits+1&&dummy.motor.externalMotion,'命中并击退');check(!w.swing(),'冷却拦截');
    await wait(250);check(dummy.motor.position.distanceTo(g.player.motor.position)>10,'实际物理位移');
    arena();dummyEntry.immuneUntil=combat.time+1;w.cooldownUntil=0;w.swing();check(!dummy.motor.externalMotion,'免疫目标不受击');
    arena();const safe=g.animals.config.safe,p=new THREE.Vector3(safe.matrix[3],safe.matrix[7],safe.matrix[11]);g.player.motor.teleport(p);w.cooldownUntil=0;const safeHits=combat.hitCount,safeSwings=w.swingCount;check(!w.swing()&&!w.safeNotice.hidden&&w.swingCount===safeSwings&&combat.hitCount===safeHits,'安全区只显示提示，不挥击或命中');
    arena();check(combat.attackFrom('test-player',1)&&!!g.player.motor.externalMotion,'本地角色受击与倒地');check(!w.swing(),'倒地不可挥击');
    check(JSON.stringify(Object.entries(localStorage))===window.weaponStorageBefore,'正式存档未改');
    $('#result').dataset.combatPassed='true';await wait(2500);arena();
  }catch(e){$('#result').dataset.error=e.message;$('#result').textContent+='\n失败 '+e.message;console.error(e);}
};
const loopButton=document.createElement('button');loopButton.textContent='循环挥击';$('#qa').append(loopButton);let swingLoop;
loopButton.onclick=()=>{if(swingLoop){clearInterval(swingLoop);swingLoop=null;loopButton.textContent='循环挥击';}else{w.swing();swingLoop=setInterval(()=>w.swing(),950);loopButton.textContent='停止循环';}};

async function rendered(predicate){const end=performance.now()+5000;while(!predicate()&&performance.now()<end)await wait(50);return predicate();}
const hide=document.createElement('button');hide.textContent='收起验收';hide.onclick=()=>$('#qa').hidden=true;$('#qa').append(hide);
for(const item of w.assets.catalog){w.unlock(item.tier);const o=document.createElement('option');o.value=item.tier;o.textContent=item.name;$('#tier').append(o);}
$('#tier').onchange=()=>w.equip(Number($('#tier').value));
$('#swing').onclick=()=>w.swing();
function frame(){
  const target=g.player.actor.position.clone().add(new THREE.Vector3(0,3,0));
  g.player.previousTarget.copy(target);g.player.target.copy(target);g.controls.target.copy(target);
  g.orbitCamera.position.copy(target).add(new THREE.Vector3(15,9,23));g.controls.update();
}
$('#frame').onclick=frame;
$('#suite').onclick=async()=>{
  delete $('#result').dataset.error;delete $('#result').dataset.passed;
  const lines=[],check=(ok,msg)=>{if(!ok)throw Error(msg);lines.push('通过 '+msg);$('#result').textContent=lines.join('\n');};
  try{
    for(let tier=1;tier<=10;tier++){
      check(await w.equip(tier),`装备 ${tier}`);await wait(80);g.pickaxes.updatePose();w.update(0);
      check(!g.pickaxes.mount.visible&&w.mount.visible,`互斥 ${tier}`);
      const item=w.assets.catalog[tier-1],p=item.grip;
      const grip=new THREE.Vector3(p.X,p.Y,p.Z).applyMatrix4(w.loaded.root.matrixWorld);
      check(grip.distanceTo(g.pickaxes.grip.getWorldPosition(new THREE.Vector3()))<1e-4,`掌心 ${tier}`);
    }
    check(w.loaded.effect.stats().beams===3,'电锤 3 条光束');
    const hits=g.pickaxes.hitCount;w.cooldownUntil=0;check(w.swing()&&!w.swing(),'挥击冷却');await wait(450);check(g.pickaxes.hitCount===hits,'不伤害蛋');
    g.indexUI.open();check(!w.swing()&&!await w.equip(1),'图鉴锁定');g.indexUI.close();
    check(await g.pickaxes.changeTier(1),'切回镐子');await wait(80);g.pickaxes.updatePose();w.update(0);check(await rendered(()=>!w.mount.visible&&g.pickaxes.mount.visible),'镐子互斥');
    check(await w.equip(10),'切回电锤');w.update(0);
    check(JSON.stringify(Object.entries(localStorage))===window.weaponStorageBefore,'正式存档未改');
    $('#result').dataset.passed='true';$('#tier').value='10';frame();
  }catch(e){$('#result').dataset.error=e.message;$('#result').textContent+='\n失败 '+e.message;throw e;}
};
await w.equip(10);$('#tier').value='10';arena();$('#result').textContent='已加载：独立内存账户 · 对练角色只存在于此测试页';
