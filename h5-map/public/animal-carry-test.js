import * as THREE from 'three';
const $=s=>document.querySelector(s),sleep=ms=>new Promise(r=>setTimeout(r,ms));
while(!window.game){if($('canvas').dataset.error)throw Error($('canvas').dataset.error);await sleep(100);}
const g=window.game,A=g.animals,S=A.state,report=$('#carry-report');let serial=0,running=false,selected;
const point=b=>new THREE.Vector3(b.matrix[3],.52,b.matrix[11]);
function move(p){g.player.keys.clear();g.player.motor.teleport(p);g.player.actor.position.copy(p);g.player.previousTarget.copy(p).add(new THREE.Vector3(0,3.5,0));g.controls.target.copy(g.player.previousTarget);g.orbitCamera.position.copy(p).add(new THREE.Vector3(10,11,18));g.controls.update();}
async function until(fn,ms=15000){const start=performance.now();while(!fn()){if(performance.now()-start>ms)throw Error('等待超时');await sleep(50);}}
async function hatch(){
  A.drop({returnHome:true});g.player.motor.externalMotion=null;g.guards.immunity=100;
  selected=g.pickaxes.eggs.eggs.find(e=>e.spec.zone===1&&e.life.alive&&e.hittable);if(!selected)throw Error('没有就绪蛋');
  move(new THREE.Vector3(selected.spec.position[0]+5,selected.spec.floorY+.05,selected.spec.position[2]+4));g.player.actor.rotation.y=-Math.PI*.7;
  const result=g.pickaxes.eggs.hit(selected,`carry-qa-${++serial}`,selected.life.hp);if(!result?.pet)throw Error('孵化失败');
  report.textContent='播放完整打开演出…';await until(()=>S.animals.has(result.pet.id));return S.animals.get(result.pet.id);
}
async function claim(a){move(new THREE.Vector3(a.position.x+4,a.position.y+.05,a.position.z+3));await sleep(120);if(!A.begin())throw Error('长按未开始');await until(()=>S.carrying===a,4000);}
$('#qa-hatch').onclick=async()=>{try{const a=await hatch();report.textContent=`${a.pet.name} · ${Math.ceil(a.remaining)}s · 可按住 E 拾取`;}catch(e){report.textContent=e.message;}};
$('#qa-safe').onclick=()=>move(point(A.config.safe));
$('#qa-outside').onclick=()=>move(point(A.config.zones[1].hitbox));
$('#qa-catch').onclick=()=>{g.guards.immunity=0;g.guards.catch(g.guards.guards[0],g.guards.target());};
$('#qa-expire').onclick=()=>{const a=S.carrying||S.nearest(g.player.motor.position);if(a)a.remaining=3;};
$('#qa-hide').onclick=()=>$('#carry-qa').hidden=true;
$('#qa-run').onclick=async()=>{
  if(running)return;running=true;const lines=[];
  const check=(ok,text)=>{if(!ok)throw Error(text);lines.push(`通过 ${text}`);report.textContent=lines.join('\n');};
  try{
    check(g.account.storage===null,'正式存档隔离');const before=g.pickaxes.progress.data.pets.length;
    const worldCount=S.animals.size;const hatching=hatch();await sleep(800);check(S.animals.size===worldCount,'破壳初期未提前创建可拾取实例');check(g.pickaxes.progress.data.pets.length===before,'敲开不入库');
    const a=await hatching,v=A.views.get(a.id);check(a.remaining===45&&a.lookRemaining>0,'落地时开放拾取，展示期尚未扣45秒');check(v.root.parent===g.scene,'演出模型转交世界拾取');
    await sleep(400);check(!A.ui.pickup.hidden&&v.root.parent===g.scene,'展示期模型保留且靠近显示交互');A.begin();await sleep(650);A.cancel();check(!S.carrying&&!S.hold,'松开中断清零');
    await claim(a);check(g.player.carryingAnimal===a.id&&g.guards.carrying.id===a.id,'唯一携带实例并通知守卫');check(!g.pickaxes.mount.visible&&!g.weapons.mount.visible,'携带隐藏装备');
    check(!g.pickaxes.swing()&&!g.weapons.swing(),'携带不可挥击');const remaining=a.remaining;await sleep(1100);check(a.remaining===remaining,'携带暂停倒数');
    check(getComputedStyle($('#game-index-ui')).display==='none'&&getComputedStyle($('#training-ui .stats')).display!=='none','隐藏菜单并保留货币');
    A.drop();check(a.status==='ground'&&a.position.x===a.home.x&&a.position.z===a.home.z,'所属区域内回原位');await sleep(400);check(a.remaining<remaining,'回原位续计');
    await claim(a);const outside=point(A.config.zones[1].hitbox);move(outside);A.drop();check(a.position.x===outside.x&&a.position.z===outside.z,'所属区域外留在落点');
    await claim(a);move(new THREE.Vector3(a.home.x+4,a.home.y+.05,a.home.z+3));g.guards.immunity=0;g.guards.catch(g.guards.guards[0],g.guards.target());
    check(!S.carrying&&a.status==='ground'&&a.position.x===a.home.x,'守卫抓捕解除携带并回原位');check(!!g.player.motor.externalMotion,'抓捕击飞仍有效');
    g.player.motor.externalMotion=null;g.guards.immunity=100;await claim(a);g.player.motor.reset();await sleep(100);
    check(!S.carrying&&a.status==='ground'&&g.pickaxes.progress.data.pets.length===before,'跌出地图重生不误判交付');
    await claim(a);const root=v.root;move(point(A.config.safe));await until(()=>!S.carrying);
    check(g.pickaxes.progress.data.pets.length===before+1,'进入安全区一次入库');check(root.parent===null&&!S.animals.has(a.id),'入库移除世界模型与计时');
    check(!g.pickaxes.progress.bank(a.pet),'重复交付拒绝');check($('#bank-new-items .bank-item')!==null&&!$('#hatch-result'),'带回显示原获得卡片，无收下出售');
    await sleep(400);check(getComputedStyle($('#game-index-ui')).display!=='none','交付恢复原HUD');
    const b=await hatch();await until(()=>b.lookRemaining===0);b.remaining=.2;const bv=A.views.get(b.id);await until(()=>!S.animals.has(b.id),2000);check(!bv.root.parent,'到期膨胀缩小后清除');
    check(g.pickaxes.progress.data.pets.length===before+1,'过期不发奖');check(!g.pickaxes.progress.pendingPets.has(b.id),'过期清理暂存奖励');
    report.dataset.passed=String(lines.length);report.dataset.report=lines.join('\n');report.textContent=lines.join('\n')+'\n全部通过';
  }catch(e){report.dataset.error=e.message;report.textContent=lines.join('\n')+'\n失败 '+e.message;console.error(e);}finally{running=false;}
};
report.textContent='就绪 · 独立内存账户';

const bankPreview=document.createElement('button');bankPreview.textContent='带回卡片预览';bankPreview.id='qa-bank-preview';$('#carry-qa').prepend(bankPreview);
bankPreview.onclick=()=>{g.pickaxes.bankFeedback.stop();g.pickaxes.bankFeedback.show([{name:'Cat'}]);};
const bankFreeze=document.createElement('button');bankFreeze.textContent='静帧检查';bankFreeze.id='qa-bank-freeze';$('#carry-qa').prepend(bankFreeze);
bankFreeze.onclick=()=>{g.pickaxes.bankFeedback.stop();g.pickaxes.bankFeedback.show([{name:'Cat'}]);g.pickaxes.bankFeedback.update(1.6);g.pickaxes.bankFeedback.update=()=>{};report.textContent='仅冻结反馈动画供截图，刷新恢复；未修改账户';};

const bagSample=document.createElement('button');bagSample.textContent='背包样例';bagSample.id='qa-backpack-sample';$('#carry-qa').prepend(bagSample);
const addSamples=()=>{if(g.account.storage!==null)throw Error('账户未隔离');g.backpack.unequip();g.pickaxes.progress.data.pets=Array.from({length:14},(_,i)=>({id:`zone1-egg-${800+i}:1`,name:['Cat','Chicken','Bat','Badger'][i%4],zone:1}));g.backpack.layout=new g.backpack.layout.constructor(g.pickaxes.progress.data.pets,g.backpack.slotCount);g.backpack.render();g.backpack.open();};
bagSample.onclick=addSamples;
const bagRun=document.createElement('button');bagRun.textContent='背包回归';bagRun.id='qa-backpack-run';$('#carry-qa').prepend(bagRun);
bagRun.onclick=async()=>{
 const lines=[];const check=(ok,msg)=>{if(!ok)throw Error(msg);lines.push('通过 '+msg);report.textContent=lines.join('\n');};
 try{
  addSamples();const b=g.backpack,p=g.pickaxes.progress;check(g.account.storage===null,'内存隔离');check(b.grid.querySelectorAll('[data-backpack-pet]').length===14,'恢复宠物进入背包');
  const search=$('#backpack-search');search.value='Cat';search.dispatchEvent(new Event('input'));check(b.grid.querySelectorAll('[data-backpack-pet]').length===4,'名称搜索');search.value='';search.dispatchEvent(new Event('input'));
  b.root.querySelector('[data-category="Eggs"]').click();check(b.grid.children.length===0,'空蛋分类不伪造宠物蛋');b.root.querySelector('[data-category="Pets"]').click();
  const first=p.data.pets[0];check(await b.equip(first.id),'背包装备模型');check(g.player.equippedPet===first.id,'选中唯一宠物');check(!g.pickaxes.swing()&&!g.weapons.swing(),'宠物装备时不能挥击');
  b.layout.move(first.id,2);b.render();check(b.hotbar.querySelector('[data-slot="2"]').dataset.backpackPet===first.id,'转入快捷栏');
  b.close();g.pickaxes.toggleEquip();check(!b.held&&!g.player.equippedPet,'镐子切换卸下宠物');b.open();
  b.sell();b.clickPet(first.id);const second=p.data.pets[1];b.clickPet(second.id);check(b.selected.size===2,'批量选择');
  const before=BigInt(g.account.data.cash),count=p.data.pets.length;const total=(await import('./gameplay/backpack-state.js')).saleSelection(p.data.pets,b.selected).total;
  b.sell();check(p.data.pets.length===count-2&&BigInt(g.account.data.cash)===before+total,'确认后一次删除并加钱');check(!b.layout.slots.includes(first.id),'售出清空快捷栏');
  const cash=g.account.data.cash;p.sellMany([first.id,second.id]);check(g.account.data.cash===cash,'重复出售不加钱');
  b.sell();b.clickPet(p.data.pets[0].id);b.close();check(!b.selling&&b.selected.size===0,'关闭清空出售模式');
  const snapshot=JSON.stringify(g.account.data);g.pickaxes.bankFeedback.show([{name:'Cat'}]);await sleep(3600);check(!$('#bank-new-items').children.length&&$('#bank-reward-flash').hidden,'卡片和闪屏自动清理');check(g.camera.fov===55,'视野恢复');check(snapshot===JSON.stringify(g.account.data),'反馈不修改存档');
  report.dataset.backpackPassed=String(lines.length);report.textContent=lines.join('\n')+'\n背包全部通过';
 }catch(e){report.dataset.backpackError=e.message;report.textContent=lines.join('\n')+'\n失败 '+e.message;console.error(e);}
};

const posePreview=document.createElement('button');posePreview.textContent='持握动作预览';posePreview.id='qa-pose-preview';$('#carry-qa').prepend(posePreview);
posePreview.onclick=async()=>{try{const a=await hatch();await claim(a);report.textContent='持握动作：'+g.player.animation;}catch(e){report.textContent=e.message;}};
