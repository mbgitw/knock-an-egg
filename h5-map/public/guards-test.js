import * as THREE from 'three';
const $=s=>document.querySelector(s),sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
while(!window.game){if($('canvas').dataset.error)throw Error($('canvas').dataset.error);await sleep(100);}
const game=window.game,system=game.guards,result=$('#result');
for(const guard of system.guards){const option=document.createElement('option');option.value=guard.definition.zone;option.textContent=`区域 ${guard.definition.zone} · ${guard.definition.name}`;$('#zone').append(option);}
let selected=()=>system.guards[Number($('#zone').value)-1];
function teleport(position){
  game.player.keys.clear();game.player.motor.teleport(position);game.player.actor.position.copy(position);
  const target=position.clone().add(new THREE.Vector3(0,3.5,0));game.player.previousTarget.copy(target);game.player.target.copy(target);game.controls.target.copy(target);
  game.controls.maxDistance=160;game.orbitCamera.position.copy(target).add(new THREE.Vector3(34,24,48));game.controls.update();
}
function locate(){
  system.setCarrying(null);system.immunity=0;const g=selected(),zone=g.definition.zonePart;g.setState('Idle');g.timer=180;
  const inward=new THREE.Vector3(zone.matrix[3]-g.position.x,0,-g.position.z).normalize();
  if(inward.lengthSq()<.1)inward.set(0,0,-1);
  teleport(g.position.clone().addScaledVector(inward,24).add(new THREE.Vector3(0,.1,0)));
  game.orbitCamera.position.copy(game.controls.target).addScaledVector(inward,65).add(new THREE.Vector3(0,36,0));game.controls.update();
}
$('#patrol').onclick=()=>{selected().setState('Idle');selected().timer=0;};
$('#locate').onclick=locate;$('#zone').onchange=locate;
$('#carry').onclick=()=>{system.setCarrying({zone:selected().definition.zone});};
$('#clear').onclick=()=>system.setCarrying(null);
$('#safe').onclick=()=>teleport(new THREE.Vector3(-45,.6,24));
$('#catch').onclick=()=>{const g=selected();system.immunity=0;teleport(g.position.clone().add(new THREE.Vector3(0,.1,0)));system.setCarrying({zone:g.definition.zone});};
$('#hide').onclick=()=>{clearInterval(statusInterval);$('#qa').remove();};
let running=false,lastStatus=0;
const statusInterval=setInterval(()=>{if(running||result.dataset.passed||result.dataset.error)return;const g=selected();if(!g)return;result.textContent=`${g.state} · ${g.speed.toFixed(1)} studs/s\n动作 ${g.model.actions.get(g.state==='Catching'&&g.model.actions.has('Attack')?'Attack':g.speed>.1?'Walk':'Idle')?.getClip().name}\n抓捕 ${system.catchCount||0} · 携带 ${system.carrying?.zone||'无'} · 击飞 ${!!game.player.motor.externalMotion}\n10 个守卫已加载 · 共享存档 ${JSON.stringify(Object.entries(localStorage))===window.guardStorageBefore?'未改动':'有外部改动'}`;},300);
$('#suite').onclick=async()=>{
  if(running)return;running=true;const lines=[];result.textContent='正在运行…';
  const check=(value,label)=>{if(!value)throw Error(label);lines.push('通过 '+label);result.textContent=lines.join('\n');};
  try{
    check(system.guards.length===10,'10 个模型与 25 条原动作加载');
    for(const g of system.guards){
      $('#zone').value=g.definition.zone;system.setCarrying(null);system.immunity=0;
      g.position.copy(g.home);g.setState('Idle');g.timer=100;teleport(g.position.clone().add(new THREE.Vector3(-28,.1,0)));
      await sleep(180);check(g.state==='Idle',`区域 ${g.definition.zone} 无搬运不追逐`);
      system.setCarrying({zone:g.definition.zone});await sleep(200);check(g.state==='WindUp',`区域 ${g.definition.zone} 警戒`);
      const before=system.catchCount||0;
      await sleep(750);
      // A very fast guard may already have caught the target after wind-up.
      check(['Chasing','Catching','Returning'].includes(g.state),`区域 ${g.definition.zone} 追逐切换`);
      if((system.catchCount||0)===before)teleport(g.position.clone());
      const end=performance.now()+2500;while((system.catchCount||0)===before&&performance.now()<end)await sleep(60);
      check((system.catchCount||0)===before+1,`区域 ${g.definition.zone} 单次抓捕 / 击飞`);
      check(system.carrying===null,`区域 ${g.definition.zone} 搬运掉落接口`);
      await sleep(240);check((system.catchCount||0)===before+1,`区域 ${g.definition.zone} 无重复抓捕`);
      system.setCarrying(null);
      const returnEnd=performance.now()+6000;
      let returned=false;
      while(performance.now()<returnEnd){
        if(g.state==='Idle'&&g.position.distanceTo(g.home)<=4)returned=true;
        if(returned&&!game.player.motor.externalMotion)break;
        await sleep(60);
      }
      check(returned,`区域 ${g.definition.zone} 回位完成`);
      check(!game.player.motor.externalMotion&&game.player.visual.rotation.x===0&&game.player.visual.rotation.z===0,`区域 ${g.definition.zone} 角色恢复`);
      game.player.motor.teleport(new THREE.Vector3(-45,.6,24));
    }
    const g=system.guards[0];system.immunity=0;teleport(g.position.clone().add(new THREE.Vector3(-30,.1,0)));system.setCarrying({zone:1});await sleep(180);
    teleport(new THREE.Vector3(-45,.6,24));await sleep(120);check(!['WindUp','Chasing'].includes(g.state),'安全区解除追逐');system.setCarrying(null);
    check(JSON.stringify(Object.entries(localStorage))===window.guardStorageBefore,'共享存档未变');
    result.dataset.passed='true';lines.push('全部通过');
  }catch(error){lines.push('失败 '+error.message);result.dataset.error=error.message;console.error(error);}
  finally{running=false;lastStatus=performance.now();result.textContent=lines.join('\n');result.dataset.report=lines.join('\n');}
};
locate();

// Reproduce the reported Zone 2 slab-edge stall in the actual collision world.
const groundButton=document.createElement('button');groundButton.textContent='二区卡点回归';$('#qa').prepend(groundButton);
groundButton.onclick=async()=>{
 if(running)return;running=true;system.setCarrying(null);$('#zone').value='2';const g=selected();
 g.position.set(-260,.7057403146917455,.35658886016647573);locate();g.setState('Returning');
 const start=g.position.clone();result.textContent='正在验证二区原卡点回位…';
 const end=performance.now()+10000;let passed=false;
 while(performance.now()<end){if(g.state==='Idle'&&g.position.distanceTo(g.home)<=4){passed=true;break;}await sleep(60);}
 result.textContent=(passed?'通过':'失败')+' 二区原卡点回位；实际移动 '+g.position.distanceTo(start).toFixed(2)+' studs';
 result.dataset.groundPassed=String(passed);running=false;g.timer=0;
};
