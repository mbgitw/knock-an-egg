import * as THREE from 'three';
const $=s=>document.querySelector(s),sleep=ms=>new Promise(r=>setTimeout(r,ms));
const writes=[];const setItem=Storage.prototype.setItem;
Storage.prototype.setItem=function(key,value){writes.push(key);return setItem.call(this,key,value);};
while(!window.game){if($('canvas').dataset.error)throw Error($('canvas').dataset.error);await sleep(100);}
const g=window.game,system=g.zoneEntry,config=system.config;
for(const z of config.zones){const o=document.createElement('option');o.value=z.index;o.textContent=z.name;$('#zone-select').append(o);}
function teleport(part){
  g.player.keys.clear();const p=new THREE.Vector3(part.matrix[3],.6,part.matrix[11]);g.player.motor.teleport(p);g.player.actor.position.copy(p);
  const target=p.clone().add(new THREE.Vector3(0,3.5,0));g.player.target.copy(target);g.player.previousTarget.copy(target);g.controls.target.copy(target);
  g.orbitCamera.position.copy(target).add(new THREE.Vector3(35,15,18));g.controls.update();system.update();
}
$('#enter-zone').onclick=()=>{system.state.current=null;teleport(config.zones[+$('#zone-select').value-1].hitbox);};
$('#safe-zone').onclick=()=>teleport(config.safe);
function pin(){if($('#pin-zone').checked&&system.state.active)system.state.active.start=performance.now()/1000-.4;requestAnimationFrame(pin);}pin();
$('#zone-result').textContent='就绪 · 独立内存账户';
$('#zone-suite').onclick=async()=>{
  const lines=[];const check=(v,s)=>{if(!v)throw Error(s);lines.push('通过 '+s);$('#zone-result').textContent=lines.join('\n');};
  $('#pin-zone').checked=false;$('#zone-suite').disabled=true;
  try{
    for(const z of config.zones){
      teleport(z.hitbox);await sleep(320);
      check(system.state.current===z.id&&system.name.textContent===z.name,`${z.id} 真实位置触发/名称`);
      check(system.icon.hidden===!z.icon,`${z.id} 图标显隐`);
      if(z.icon){await system.icon.decode();check(system.icon.naturalWidth>0,`${z.id} 图片加载`);}
    }
    const serial=system.state.serial;await sleep(2400);check(system.element.hidden,'2秒停留 + 0.3秒淡出');
    await sleep(200);check(system.state.serial===serial,'同区不重复');
    teleport(config.safe);teleport(config.zones[0].hitbox);await sleep(320);check(system.state.active?.zone.id==='Zone1','离区重入');
    check(!g.player.inputLocked,'提示不锁定操作');
    check(g.account.storage===null&&writes.length===0,'本验收页没有写入正式存档');
    $('#zone-result').dataset.passed='true';lines.push('全部通过');
  }catch(e){lines.push('失败 '+e.message);$('#zone-result').dataset.error=e.message;console.error(e);}
  finally{$('#zone-result').textContent=lines.join('\n');$('#zone-suite').disabled=false;}
};
if(new URLSearchParams(location.search).has('preview')){$('#pin-zone').checked=true;$('#enter-zone').click();$('#zone-qa').hidden=true;}
