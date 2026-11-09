import * as THREE from 'three';
import {hatchRevealTime} from './gameplay/egg-presentation-state.js';
const $=s=>document.querySelector(s),sleep=t=>new Promise(r=>setTimeout(r,t));
while(!window.game){if($('canvas').dataset.error)throw Error($('canvas').dataset.error);await sleep(100);}
const game=window.game,eggs=game.pickaxes.eggs,report=$('#presentation-report');let selected,frozen=false,running=false;
const update=eggs.update.bind(eggs);eggs.update=dt=>update(frozen?0:dt);
function locate(zone){frozen=false;selected=eggs.eggs.find(e=>e.spec.zone===zone&&e.life.alive&&e.spec.sizeMult<1.8)||eggs.eggs.find(e=>e.spec.zone===zone&&e.life.alive);if(!selected)return;
  const s=selected.spec,p=new THREE.Vector3(s.position[0]+8,s.floorY+.05,s.position[2]+12);game.player.keys.clear();game.player.motor.teleport(p);game.player.actor.position.copy(p);game.player.previousTarget.copy(p).add(new THREE.Vector3(0,3.5,0));game.controls.target.copy(game.player.previousTarget);game.orbitCamera.position.copy(p).add(new THREE.Vector3(5,9,16));game.controls.update();report.textContent=`${s.name} · ${selected.life.hp}/${s.health} HP`;
}
function hit(kill=false){if(selected?.life.alive)eggs.hit(selected,'presentation-'+performance.now(),kill?selected.life.hp:Math.max(1,selected.spec.health*.15));}
$('#qa-forest').onclick=()=>locate(1);$('#qa-galaxy').onclick=()=>locate(9);$('#qa-hurt').onclick=()=>hit();$('#qa-open').onclick=()=>{frozen=false;hit(true);};
$('#qa-freeze').onclick=()=>{frozen=!frozen;$('#qa-freeze').textContent=frozen?'继续':'暂停';};
for(const button of document.querySelectorAll('[data-age]'))button.onclick=()=>{if(selected?.life.alive)hit(true);if(!selected)return;selected.life.respawnAt=Date.now()/1000+100;selected.presentation.hatchAt=eggs.time-Number(button.dataset.age);update(0);frozen=true;$('#qa-freeze').textContent='继续';report.textContent=`演出${button.dataset.age}s · ${selected.pose.stage} · ${selected.pose.scale.toFixed(3)}倍`;};
$('#qa-hide').onclick=()=>$('#presentation-qa').hidden=true;
const approach=document.createElement('button');approach.textContent='走近';approach.id='qa-approach';$('#qa-hurt').before(approach);
approach.onclick=()=>{locate(1);const s=selected.spec,p=new THREE.Vector3(s.position[0],s.floorY+.05,s.position[2]+s.radius+2);game.player.motor.teleport(p);game.player.actor.position.copy(p);game.player.actor.rotation.y=Math.PI;game.player.previousTarget.copy(p).add(new THREE.Vector3(0,3.5,0));game.controls.target.copy(game.player.previousTarget);game.orbitCamera.position.copy(p).add(new THREE.Vector3(5,9,16));game.controls.update();$('canvas').focus();report.textContent='已走近，使用实际 F 键挥镐';};
$('#qa-run').onclick=async()=>{if(running)return;running=true;frozen=false;const lines=[];let count=0;
  const check=(ok,text)=>{if(!ok)throw Error(text);lines.push('通过 '+text);report.textContent=lines.join('\n');count++;};
  try{
    check(game.account.storage===null,'内存账户隔离');check(eggs.eggs.length===230,'230个蛋与标签注册');
    for(let zone=1;zone<=10;zone++){locate(zone);await sleep(450);const visible=eggs.eggs.filter(e=>e.spec.zone===zone&&!e.billboard.svg.hidden);check(visible.length>0,`第${zone}区名称/品质可见`);}
    locate(1);await sleep(300);const e=selected;check(e.billboard.name.textContent===e.spec.name,'英文原蛋名');check(e.billboard.rarityText.textContent==='Common','同区Common品质');
    frozen=true;const camera=eggs.camera,position=camera.position.clone(),rotation=camera.quaternion.clone(),anchor=e.root.position.clone();anchor.y+=e.spec.bodyHeight/2+1;
    for(const distance of [149,151]){camera.position.copy(anchor).add(new THREE.Vector3(0,0,distance));camera.lookAt(anchor);camera.updateMatrixWorld(true);eggs.billboards.update(e,e.pose,eggs.time);check(e.billboard.svg.hasAttribute('hidden')===(distance>150),`${distance}摄像机距离标签${distance>150?'隐藏':'显示'}`);}
    camera.position.copy(position);camera.quaternion.copy(rotation);camera.updateMatrixWorld(true);frozen=false;
    check(!e.presentation.health(eggs.time).visible,'满血平时隐藏血条');hit();await sleep(250);check(e.presentation.health(eggs.time).visible&&e.life.hp<e.spec.health,'受击显示血条');
    check(e.billboard.hp.style.display!=='none','血条实际显示');check(document.querySelector('#egg-health').hidden,'旧目标血条隐藏');
    const start=eggs.time,petCount=game.account.data.pickaxes.pets.length;hit(true);check(eggs.hit(e,'repeat',1e15)===null,'孵化中不重复命中');
    check(game.account.data.pickaxes.pets.length===petCount,'敲开暂不入库');await sleep(450);check(e.root.visible&&e.pose.stage==='spin','破蛋后蛋壳仍在并旋转');
    while(eggs.time-start<3)await sleep(100);check(e.pose.stage==='grow'&&e.pose.scale>1.1,'4秒指数膨胀');check(e.billboard.luck.style.display!=='none','膨胀显示幸运计数');
    while(eggs.time-start<5.15)await sleep(50);check(e.pose.stage==='explode'&&e.pose.scale>1.75&&e.pose.opacity<1,'白色膨胀淡出打开');check($('#hatch-result').hidden,'结算面板不遮挡打开演出');
    while(eggs.time-start<6.3)await sleep(100);check(!e.root.visible,'打开后壳体隐藏');check(!e.billboard.svg.hidden===false,'打开后标签隐藏');check(eggs.reveals.some(p=>p.egg===e),'原动物模型展示');check(!e.nest.visible,'巢缩小退场');
    while(eggs.time-start<9)await sleep(100);check(game.account.data.pickaxes.pets.length===petCount,'展示完成等待带回入库');
    check(JSON.stringify(Object.entries(localStorage))===window.eggStorageBefore,'正式存档未改');
    report.dataset.passed=String(count);report.dataset.report=lines.join('\n');report.textContent=lines.join('\n')+'\n全部通过';
  }catch(error){report.dataset.error=error.message;report.textContent=lines.join('\n')+'\n失败 '+error.message;console.error(error);}finally{running=false;}
};
locate(1);
