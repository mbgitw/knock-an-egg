import * as THREE from 'three';
import {EGG_CONFIG as C} from './gameplay/eggs/runtime-config.js';
import {EggSpawnState} from './gameplay/egg-spawn-state.js';
import {TreadmillState} from './treadmill-state.js';
const $=s=>document.querySelector(s),sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
while(!window.game){if($('canvas').dataset.error)throw Error($('canvas').dataset.error);await sleep(100);}
const game=window.game,eggs=game.pickaxes.eggs,output=$('#egg-report');let selected=null,running=false;
for(const z of C.zones){const o=document.createElement('option');o.value=z.zone;o.textContent=`区域 ${z.zone} · ${z.name}`;$('#egg-zone').append(o);}
for(const t of C.templates.filter(t=>t.available)){const o=document.createElement('option');o.value=t.id;o.textContent=`${t.zone} · ${t.name}`;$('#egg-type').append(o);}
function move(position,target){
  game.player.keys.clear();game.player.motor.teleport(position);game.player.actor.position.copy(position);game.player.previousTarget.copy(position).add(new THREE.Vector3(0,3.5,0));
  game.controls.maxDistance=110;game.controls.target.copy(game.player.previousTarget);game.orbitCamera.position.copy(position).add(new THREE.Vector3(17,13,22));game.controls.update();
}
function locate(egg){
  selected=egg;if(!egg)return;const s=egg.spec;
  move(new THREE.Vector3(egg.center.x,s.floorY+.1,egg.bounds.max.z+3.6),egg.center);game.player.actor.rotation.y=Math.PI;
}
function showZone(){const zone=Number($('#egg-zone').value),z=C.zones[zone-1],e=eggs.state.zoneEggs(zone).find(e=>e.life.alive);if(e)locate(e);else{selected=null;move(new THREE.Vector3(z.box.matrix[3],.6,0));}}
$('#egg-locate').onclick=showZone;$('#egg-zone').onchange=showZone;
$('#egg-type-locate').onclick=()=>{const id=$('#egg-type').value,t=C.templates.find(t=>t.id===id);$('#egg-zone').value=t.zone;locate(eggs.eggs.find(e=>e.spec.typeId===id&&e.life.alive));};
$('#egg-type').onchange=()=>$('#egg-type-locate').click();
$('#egg-equip').onclick=async()=>{game.account.creditCash('900000000000000000');await game.pickaxes.changeTier(20,!game.pickaxes.progress.data.owned.includes(20));output.textContent='测试20级镐已装备，聚焦场景按F实际挥击';};
$('#egg-break').onclick=()=>{if(selected?.life.alive){const result=eggs.hit(selected,'qa-'+performance.now(),1e15);output.textContent=`破碎：${!!result?.broken}，奖励：${result?.pet?.name||'无'}\n${selected.life.respawnAt-Date.now()/1000}秒后重新随机生成`;}else output.textContent='所选蛋已破碎';};
function restoreCheck(){
  const raw=JSON.stringify(game.account.data),loaded=new TreadmillState({storage:{getItem:()=>raw,setItem:()=>{}}});
  const state=new EggSpawnState({sampleGround:eggs.state.sampleGround,canPlace:eggs.state.canPlace,nestHeightRatio:eggs.state.nestHeightRatio}).initialize(loaded.data.pickaxes.worldEggs,Date.now()/1000);
  for(const e of eggs.eggs){const other=state.slots.get(e.spec.id)?.egg;if(!other||e.life.hp!==other.life.hp||e.life.generation!==other.life.generation||e.spec.typeId!==other.spec.typeId||e.spec.position.some((n,i)=>Math.abs(n-other.spec.position[i])>1e-5))throw Error('快照不一致 '+e.spec.id);}
  if(String(loaded.data.cash)!==String(game.account.data.cash)||loaded.data.pickaxes.pets.length!==game.account.data.pickaxes.pets.length)throw Error('账户恢复不一致');return true;
}
$('#egg-save').onclick=()=>{try{restoreCheck();output.textContent='快照恢复通过：位置/种类/血量/代次/收藏/现金一致';}catch(e){output.textContent=e.message;console.error(e);}};
const statusInterval=setInterval(()=>{if(running||output.dataset.passed||output.dataset.error)return;
  output.textContent=`各区活蛋 ${C.zones.map(z=>`${z.zone}:${eggs.state.zoneEggs(z.zone).filter(e=>e.life.alive).length}`).join(' ')}\n30种可用：22种v2补充 + 8种原几何\n${selected?`${selected.spec.name} · HP ${selected.life.hp}/${selected.spec.health} · 代次${selected.life.generation}`:'无可生成蛋'}\n验收存储 ${game.account.storage===null?'仅内存，不写正式存档':'持久化'}`;
},400);
$('#egg-hide').onclick=()=>{clearInterval(statusInterval);$('#egg-qa').remove();};
$('#egg-suite').onclick=async()=>{
  if(running)return;running=true;const lines=[];
  const check=(condition,text)=>{if(!condition)throw Error(text);lines.push('通过 '+text);output.textContent=lines.join('\n');};
  try{
    await sleep(1200);check(eggs.templates.size===30,'加载30种模型（22种v2补充）');
    check(eggs.placementObstacles?.zones.size===10,'十区可见装饰纳入选点检查');
    check(eggs.eggs.every(e=>eggs.placementObstacles.clear(e.spec)),'全部蛋及蛋巢避开石头树木占地');
    for(const t of C.templates.filter(t=>t.replacement)){
      const box=new THREE.Box3().setFromObject(eggs.templates.get(t.id));
      check(box.min.toArray().every((v,i)=>Math.abs(v-t.bounds.min[i])<.0001)&&box.max.toArray().every((v,i)=>Math.abs(v-t.bounds.max[i])<.0001),`${t.id}实际atlas范围与刷新尺寸一致`);
    }
    for(const z of C.zones)check(eggs.state.zoneEggs(z.zone).filter(e=>e.life.alive).length===(z.availableTiers.length?z.capacity:0),`区域${z.zone}数量上限和缺失过滤`);
    check(restoreCheck(),'活蛋位置和账户快照恢复');
    const broken=[],petCount=game.account.data.pickaxes.pets.length;
    for(const z of C.zones.filter(z=>z.availableTiers.length)){
      const e=eggs.state.zoneEggs(z.zone).find(e=>e.life.alive),generation=e.life.generation,position=[...e.spec.position];
      const result=eggs.hit(e,'suite-'+z.zone,1e15);check(result?.broken&&result.pet?.zone===z.zone,`区域${z.zone}破碎发放本区动物`);
      check(eggs.hit(e,'repeat-'+z.zone,1e15)===null,`区域${z.zone}重复命中不发奖`);
      const delay=e.life.respawnAt-Date.now()/1000;check(delay>=9.8&&delay<=15,`区域${z.zone}补刷时间10–15秒`);
      broken.push({e,generation,position});
    }
    check(game.account.data.pickaxes.pets.length===petCount,'10次破碎仅生成待搬运动物');check(restoreCheck(),'未到期破碎蛋快照恢复');
    const begin=Date.now();while(Date.now()-begin<6500){await sleep(500);output.textContent=lines.join('\n')+`\n等待原计时 ${(Date.now()-begin)/1000}s`;}
    check(broken.every(({e})=>!e.nest.visible),'破碎6秒后清理旧蛋巢');
    while(Date.now()-begin<15800){await sleep(500);output.textContent=lines.join('\n')+`\n等待实际补刷 ${(Date.now()-begin)/1000}s`;}
    for(const b of broken){const next=eggs.state.slots.get(b.e.spec.id).egg;
      check(next!==b.e&&next.life.alive&&next.life.generation===b.generation+1,`区域${b.e.spec.zone}换代补刷`);
      check(next.spec.position.some((p,i)=>Math.abs(p-b.position[i])>.01),`区域${b.e.spec.zone}重新随机位置`);
    }
    check(game.account.data.pickaxes.pets.length===petCount,'补刷不会直接入库');check(restoreCheck(),'补刷后快照恢复');
    check(game.account.storage===null&&game.account.storageStatus==='memory','验收账户无持久存储写入通道');lines.push(JSON.stringify(Object.entries(localStorage))===window.eggStorageBefore?'观察 正式存档未变':'观察 正式存档有其他页面写入，本验收保持内存隔离');output.dataset.passed='true';lines.push('全部通过');
  }catch(error){lines.push('失败 '+error.message);output.dataset.error=error.message;console.error(error);}
  finally{running=false;output.textContent=lines.join('\n');output.dataset.report=lines.join('\n');}
};
$('#egg-zone').value=9;showZone();
