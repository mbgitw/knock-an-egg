import * as THREE from 'three';
while(!window.game)await new Promise(r=>setTimeout(r,100));
const g=window.game,$=s=>document.querySelector(s);
const h=g.plots.tier.hitbox,center=new THREE.Vector3(h.matrix[3],1.27,h.matrix[11]);
g.player.motor.teleport(center);g.player.actor.position.copy(center);g.player.actor.rotation.y=0;
g.player.previousTarget.copy(center).add(new THREE.Vector3(0,3.5,0));g.controls.target.copy(g.player.previousTarget);g.orbitCamera.position.copy(center).add(new THREE.Vector3(12,12,18));g.controls.update();
$('#qa-setup').onclick=()=>{if(!g.pickaxes.progress.data.pets.length&&!g.pasture.state.pets.length){const p=g.pickaxes.progress.hatch('zone1-egg-990:1',()=>0);if(p)g.pickaxes.progress.bank(p);}g.backpack.render();};
$('#qa-equip').onclick=()=>g.backpack.equip(g.pickaxes.progress.data.pets[0]?.id);
$('#qa-place').onclick=()=>g.pasture.placeAhead();
$('#qa-retrieve').onclick=()=>g.pasture.retrieve(g.pasture.state.pets[0]?.id);
setInterval(()=>{$('#carry-report').textContent=JSON.stringify({bag:g.pickaxes.progress.data.pets.length,placed:g.pasture.state.pets.length,models:g.pasture.models.size,held:g.backpack.held,storage:g.account.storageStatus,cash:g.account.data.cash,rate:g.pasture.economy.rate,rigs:[...g.pasture.models.values()].filter(m=>m.userData.rig).length});},100);

const extra=document.createElement('button');extra.textContent='离线一分钟验收';extra.id='qa-offline';$('#carry-qa').prepend(extra);
extra.onclick=()=>{g.pasture.economy.ledger.lastSeen=Date.now()-60000;g.pasture.economy.resume();};
const batch=document.createElement('button');batch.textContent='准备12只';batch.id='qa-many';$('#carry-qa').prepend(batch);
batch.onclick=()=>{for(let i=0;i<12;i++){const p=g.pickaxes.progress.hatch(`zone1-egg-${1100+i}:1`,()=>i/12);if(p)g.pickaxes.progress.bank(p);}g.backpack.render();};
