import * as THREE from 'three';
import {TreadmillState,restoreState} from './treadmill-state.js';
import {PlotProgress} from './gameplay/plot-state.js';
const ready=async()=>{while(!window.game)await new Promise(r=>setTimeout(r,100));return window.game;};
const g=await ready(),s=g.plots,result=document.getElementById('plot-result');
const move=(feet,offset)=>{
 g.treadmills.exit(false);g.player.motor.teleport(new THREE.Vector3(...feet));
 const target=g.player.motor.position.clone().add(new THREE.Vector3(0,5.4*.66,0));
 g.player.target.copy(target);g.player.previousTarget.copy(target);g.controls.target.copy(target);
 g.orbitCamera.position.copy(target).add(new THREE.Vector3(...offset));g.controls.update();
 g.camera.position.copy(g.orbitCamera.position);g.camera.lookAt(target);g.player.cameraDistance=g.camera.position.distanceTo(target);
};
const locate=()=>move([-17,.5,62.52494],[-15,5,5]);
const cameraTest=document.createElement('button');cameraTest.textContent='镜头路牌回归';document.getElementById('plot-qa').append(cameraTest);
cameraTest.onclick=()=>{
 move([-12,.5,67.52494],[18,7,0]);
 setTimeout(()=>{const requested=g.orbitCamera.position.distanceTo(g.player.target),actual=g.camera.position.distanceTo(g.player.target);
 result.textContent=`路牌位于人物与镜头之间：请求 ${requested.toFixed(2)}，实际 ${actual.toFixed(2)}；${Math.abs(actual-requested)<.05?'PASS 镜头未被路牌推近':'FAIL 镜头距离异常'}`;
 },1500);
};
document.getElementById('plot-locate').onclick=locate;
document.getElementById('plot-fund').onclick=()=>{g.account.creditCash(10000);s.update(0);g.treadmills.refreshHUD();};
document.getElementById('plot-overview').onclick=()=>move([24,1.267,52.47494],[-28,30,28]);
document.getElementById('plot-rear-3').onclick=()=>move([56,.5,52.47494],[21,18,18]);
document.getElementById('plot-rear-2').onclick=()=>move([56,.5,-.52506],[21,18,18]);
document.getElementById('plot-hide').onclick=()=>document.getElementById('plot-qa').hidden=true;
const checks=[];
const check=(name,value)=>{checks.push({name,pass:!!value});result.textContent=checks.map(c=>`${c.pass?'PASS':'FAIL'} ${c.name}`).join('\n');if(!value)throw Error(name);};
document.getElementById('plot-suite').onclick=()=>{
 checks.length=0;
 try{
  locate();s.cooldown=0;
  g.account.data.cash=0;const old=g.account.data.plot.level;
  check('余额不足不扣费、不换模',s.purchase()===false&&s.progress.level===old&&g.account.data.cash===0);
  g.account.creditCash('999999999999999999999');
  move([-48,.5,24],[18,10,16]);check('远距离不能购买',s.purchase()===false&&s.progress.level===old);
  locate();s.cooldown=0;
  const prepare=s.prepareCollision,before=g.account.data.cash,root=s.root;
  s.prepareCollision=()=>{throw Error('QA simulated preparation failure');};
  // Expected failure is tested without polluting the browser console.
  const error=console.error;console.error=()=>{};
  let failed;try{failed=s.purchase();}finally{s.prepareCollision=prepare;console.error=error;}
  check('准备失败不扣费、不删除旧建筑',failed===false&&g.account.data.cash===before&&s.root===root);
  while(s.progress.level<9){
   s.cooldown=0;const level=s.progress.level,cash=BigInt(g.account.data.cash),cost=BigInt(s.progress.cost),world=g.player.world;
   check(`${level}→${level+1} 扣费换模和碰撞同步`,s.purchase()===true&&s.progress.level===level+1&&BigInt(g.account.data.cash)===cash-cost&&s.root.userData.level===level+1&&g.player.world!==world&&g.player.motor.world===g.player.world);
   check('重复点击被冷却拦截',s.purchase()===false);
   check('场景只保留一套玩家建筑',g.scene.children.filter(o=>o.name.startsWith('Base_3-Build-Lv')).length===1);
  }
  s.cooldown=0;const balance=g.account.data.cash;
  check('最高9级16容量且不可继续扣费',s.capacity===16&&s.sign.state.priceText==='MAX'&&s.purchase()===false&&g.account.data.cash===balance);
  const snap=JSON.stringify(g.account.data),memory={getItem:()=>snap,setItem:()=>{}};
  const restored=new TreadmillState({storage:memory}),p=new PlotProgress(restored);
  check('同一快照恢复等级、现金、跑步机与动物',p.level===9&&p.capacity===16&&restored.data.cash===balance&&restored.data.level===g.account.data.level&&JSON.stringify(restored.data.pickaxes)===JSON.stringify(g.account.data.pickaxes));
  check('旧存档与非法等级恢复为1',restoreState({version:1,plot:{level:'9'}}).plot.level===1);
  const restoredModel=s.makeModel(p.level);check('恢复等级生成正确基地模型',restoredModel.userData.level===9&&restoredModel.children.length===41);restoredModel.traverse(o=>{o.geometry?.dispose();o.material?.dispose();});
  const treadmillRoot=g.treadmills.own.root;check('围栏升级保留跑步机和两块路牌',treadmillRoot.parent===g.scene&&g.treadmills.sign.root.parent===g.scene&&s.sign.root.parent===g.scene);
  result.dataset.passed=String(checks.length);result.dataset.failed='0';window.plotQA=checks;
 }catch(error){result.dataset.failed='1';window.plotQA=checks;console.error(error);}
};
result.textContent='资源加载完成，可直接点击3D牌面购买';
