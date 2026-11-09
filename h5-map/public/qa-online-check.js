// Local QA fixture. Excluded from the Builda client bundle.
import * as THREE from 'three';
if(new URLSearchParams(location.search).get('builda_mock_shell')!=='1')throw Error('LOCAL_QA_ONLY');
const panel=document.createElement('section');panel.style='position:fixed;left:12px;bottom:100px;z-index:80;background:white;color:black;padding:10px;max-width:550px';panel.innerHTML='<b>本地联机验收</b><div id="qa-actions"></div><pre id="qa-result">加载中</pre>';document.body.append(panel);
const pause=ms=>new Promise(r=>setTimeout(r,ms));
while(!window.game?.online)await pause(100);
const g=window.game,c=g.online,result=panel.querySelector('pre');
const action=(name,fn)=>{const b=document.createElement('button');b.textContent=name;panel.querySelector('div').append(b);b.onclick=async()=>{b.disabled=true;try{await fn();result.textContent=name+' 完成';}catch(e){result.textContent=name+' 失败 '+e.message;}finally{b.disabled=false;}};};
const walk=async target=>{for(let i=0;i<700;i++){const p=g.player.motor.position,d=new THREE.Vector3().subVectors(target,p);d.y=0;if(d.length()<1)break;d.clampLength(0,1.5);const next=p.clone().add(d);next.y=target.y;g.player.motor.teleport(next);await pause(110);}await pause(250);};
const egg=()=>g.pickaxes.eggs.eggs.filter(e=>e.life.alive&&e.spec.zone===1).sort((a,b)=>a.spec.position[0]-b.spec.position[0]).at(-1);
action('走到共享蛋',async()=>{const e=egg();if(!e)throw Error('无蛋');await walk(new THREE.Vector3(e.spec.position[0]+e.spec.size[0]/2+2,e.spec.floorY,e.spec.position[2]));});
action('连续敲蛋',async()=>{const e=egg();for(let i=0;i<80&&e.life.alive;i++){const response=await c.command('egg-hit',{egg:e.spec.id,generation:e.life.generation});if(!response)throw Error('HIT_REJECTED');await pause(650);}});
action('长按拾取',async()=>{for(let i=0;i<130&&!g.animals.state.nearest(g.player.motor.position,false);i++)await pause(100);if(!g.animals.begin())throw Error('无可拾取动物');for(let i=0;i<25&&!g.player.carryingAnimal;i++)await pause(100);g.animals.cancel();if(!g.player.carryingAnimal)throw Error('未获所有权');});
action('回安全区',()=>walk(new THREE.Vector3(-48,.5,24)));
action('走到自己的跑步机',async()=>{await c.command('treadmill-unlock');const t=new THREE.Vector3(...g.treadmills.own.metadata.slots[0]).applyMatrix4(g.treadmills.ownMatrix);await walk(t);});
action('放置最佳动物',()=>g.pasture.equipBest());
action('走到他人牧场',async()=>{const farm=[...c.pastures.values()].find(p=>p.id!==c.self&&p.pets.length);if(!farm)throw Error('他人牧场没有动物');const p=farm.pets[0].position;await walk(new THREE.Vector3(p[0]-12,p[1],p[2]));});
action('同步恢复',()=>c.session.recover());
action('采集10秒性能',async()=>{const report=await g.performance.start(10);panel.dataset.performance=JSON.stringify(report);panel.dataset.blocks=JSON.stringify([g.plots.root,...g.plots.otherRoots].map(r=>r.userData.blockStats));});
action('查看牧场标记',()=>{const target=c.pastureLabels.homePosition.clone();const update=g.player.update.bind(g.player);g.player.update=dt=>{update(dt);g.camera.position.set(target.x-65,36,target.z+45);g.camera.lookAt(target.x,8,target.z);};});
action('离开房间',()=>c.session.leave());
action('完整入库链路',async()=>{
  const e=egg(),before=g.account.data.pickaxes.pets.length;
  result.textContent='接近共享蛋';await walk(new THREE.Vector3(e.spec.position[0]+e.spec.size[0]/2+2,e.spec.floorY,e.spec.position[2]));
  result.textContent='挥镐';for(let i=0;i<80&&e.life.alive;i++){const response=await c.command('egg-hit',{egg:e.spec.id,generation:e.life.generation});if(!response)throw Error('HIT_REJECTED');await pause(650);}if(e.life.alive)throw Error('蛋未破碎');
  result.textContent='等待动物落地';for(let i=0;i<150&&!g.animals.state.nearest(g.player.motor.position,false);i++)await pause(100);
  if(!g.animals.begin())throw Error('动物不可拾取');result.textContent='拾取中';for(let i=0;i<30&&!g.player.carryingAnimal;i++)await pause(100);g.animals.cancel();
  if(!g.player.carryingAnimal)throw Error('争抢未获得所有权');result.textContent='带回安全区';await walk(new THREE.Vector3(-48,.5,24));await pause(500);
  if(g.account.data.pickaxes.pets.length!==before+1)throw Error('未入库');
});
setInterval(()=>{panel.dataset.state=JSON.stringify({self:c.self,room:c.session.room?.roomId,stage:c.session.stage,players:c.players.length,cash:g.account.data.cash,power:g.account.data.power,pets:g.account.data.pickaxes.pets.length,placed:g.account.data.plot.pets.length,remoteAvatars:c.remote?.actors.size,remotePlaced:c.remotePastures?.pets.size,worldPets:c.animals.size,carrying:g.player.carryingAnimal,eggs:g.pickaxes.eggs.eggs.filter(e=>e.spec.zone===1).map(e=>({id:e.spec.id,hp:e.life.hp,pet:e.pet?.id}))});},250);
panel.id='online-qa';result.textContent='已连接 '+c.self;

action('查看排行榜',async()=>{const update=g.player.update.bind(g.player);g.player.update=dt=>{update(dt);g.camera.position.set(-34,17,-108);g.camera.lookAt(-78,12,-108);};await g.leaderboards.refresh(false,true);});
