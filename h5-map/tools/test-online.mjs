import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {mkdir} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {OP,encodeMove,decodeMove,encodeMoves,decodeMoves,newer} from '../public/online/protocol.js';
import {PastureSession} from '../public/online/session.js';
import {MotionSender,MotionBuffer} from '../public/online/motion.js';
await mkdir(new URL('../build/',import.meta.url),{recursive:true});
await build({entryPoints:[fileURLToPath(new URL('../server/game/world.ts',import.meta.url))],bundle:true,format:'esm',platform:'node',outfile:fileURLToPath(new URL('../build/online-world.mjs',import.meta.url))});
const {createWorld,join,leave,disconnect,acceptMove,transact}=await import('../build/online-world.mjs');
await build({entryPoints:[fileURLToPath(new URL('../server/game/eggs.ts',import.meta.url))],bundle:true,format:'esm',platform:'node',outfile:fileURLToPath(new URL('../build/online-eggs.mjs',import.meta.url))});
const {createEggEngine,restoreEggEngine,hitEgg,compactEggs}=await import('../build/online-eggs.mjs');
await build({entryPoints:[fileURLToPath(new URL('../server/game/animals.ts',import.meta.url))],bundle:true,format:'esm',platform:'node',outfile:fileURLToPath(new URL('../build/online-animals.mjs',import.meta.url))});
const {addAnimal,holdAnimal,dropAnimal,advanceAnimals}=await import('../build/online-animals.mjs');
await build({entryPoints:[fileURLToPath(new URL('../server/game/guards.ts',import.meta.url))],bundle:true,format:'esm',platform:'node',outfile:fileURLToPath(new URL('../build/online-guards.mjs',import.meta.url))});
const {createGuards,saveGuards,updateGuards}=await import('../build/online-guards.mjs');
for(const module of ['economy','combat','payment','account-delta'])await build({entryPoints:[fileURLToPath(new URL(`../server/game/${module}.ts`,import.meta.url))],bundle:true,format:'esm',platform:'node',outfile:fileURLToPath(new URL(`../build/online-${module}.mjs`,import.meta.url))});
const {accountChanges}=await import('../build/online-account-delta.mjs');
const {relocateAccount,plotBox,trainingPoint,tickEconomy}=await import('../build/online-economy.mjs');
const {batStrike}=await import('../build/online-combat.mjs');
const {payment,paymentPending}=await import('../build/online-payment.mjs');
const {withTitanic,saveTitanic}=await import('../build/online-eggs.mjs');
const {PRODUCTS}=await import('../public/gameplay/commerce/catalog.js');
const origin={x:0,y:.5,z:0,yaw:0,flags:0,sequence:0};
test('移动包支持大地图、拒绝截断/NaN，序号支持环回',()=>{
  const p={...origin,x:-4500,z:1000,sequence:0xffffffff};assert.deepEqual(decodeMove(encodeMove(p)),p);
  assert.throws(()=>decodeMove(new Uint8Array(22)));assert.throws(()=>encodeMove({...p,x:NaN}));
  assert.equal(newer(0,0xffffffff),true);assert.equal(newer(0xffffffff,0),false);
  assert.equal(decodeMoves(encodeMoves([{...p,slot:6}],100)).players[0].slot,6);
});
test('七人唯一槽位，第八人拒绝，断线不释放，最终退出才补位',()=>{
  const s=createWorld();for(let i=0;i<7;i++)join(s,`p${i}`,`s${i}`,origin);
  assert.equal(new Set(Object.values(s.players).map(p=>p.slot)).size,7);
  assert.throws(()=>join(s,'p8','s8',origin),/ROOM_FULL/);disconnect(s.players.p0);
  assert.throws(()=>join(s,'p8','s8',origin),/ROOM_FULL/);assert.equal(join(s,'p0','s0',origin).slot,0);
  leave(s,'p0');assert.equal(join(s,'p8','s8',origin).slot,0);
});
test('移动采用客户端位置，仍拒绝旧帧和不可用玩家',()=>{
  const s=createWorld(),p=join(s,'p','seat',origin);p.loaded=p.active=true;s.elapsed=100;
  assert.equal(acceptMove(s,p,encodeMove({...origin,sequence:1,x:999})),true);
  assert.equal(p.position.x,999);
  s.elapsed+=100;assert.equal(acceptMove(s,p,encodeMove({...origin,sequence:1,x:2})),false);
  disconnect(p);assert.equal(acceptMove(s,p,encodeMove({...origin,sequence:2})),false);
});
test('购买幂等与账户隔离，恶意客户端不能指定余额/其他玩家',()=>{
  const s=createWorld(),p=join(s,'p','seat',origin),other=join(s,'other','seat2',origin);p.loaded=p.active=true;
  const req={id:1,action:'treadmill-unlock',cash:999999,userId:'other'};
  assert.equal(transact(s,p,req,0).ok,true);assert.equal(p.account.cash,0);assert.equal(other.account.cash,100);
  assert.equal(transact(s,p,req,0).ok,true);assert.equal(p.account.cash,0);
  s.elapsed+=100;assert.equal(transact(s,p,{id:2,action:'plot-upgrade',value:1},0).ok,false);
});
test('购买准备不阻挡离线领取，只有已验证发货期间冻结',()=>{
  const s=createWorld(),p=join(s,'p','seat',origin);p.loaded=p.active=true;
  p.account.pastureLedger.pending=100;
  p.account.commerce.intents.egg_3714065679={payId:'egg_3714065679',context:{},applied:false};
  assert.equal(paymentPending(p),false);
  assert.equal(transact(s,p,{id:1,action:'offline-claim'},0).ok,true);
  assert.equal(p.account.pastureLedger.pending,0);
  p.account.commerce.delivery='unfulfilled';
  assert.equal(paymentPending(p),true);
  delete p.account.commerce.intents.egg_3714065679;p.account.commerce.delivery=null;
  p.account.commerce.intents.egg_3712778476={payId:'egg_3712778476',context:{amount:'100'},applied:false};
  assert.equal(paymentPending(p),false,'未付款双倍购买不冻结待领金额');
});
test('无订单号的准备跨重进移除，普通收益只领取一次',async()=>{
  const {restoreState}=await import('../public/treadmill-state.js');
  const first=createWorld(),old=join(first,'p','old',origin);old.loaded=old.active=true;
  old.account.pastureLedger.pending=100;
  old.account.commerce.intents.egg_3714065679={payId:'egg_3714065679',context:{},applied:false};
  const snapshot=JSON.parse(JSON.stringify(old.account)),next=createWorld(),p=join(next,'p','new',origin);
  p.loaded=p.active=true;p.account=restoreState(snapshot,0);const cash=BigInt(p.account.cash);
  assert.equal(paymentPending(p),false);assert.equal(transact(next,p,{id:1,action:'offline-claim'},0).ok,true);
  assert.equal(BigInt(p.account.cash),cash+100n);assert.equal(p.account.pastureLedger.pending,0);
  assert.equal(p.account.commerce.intents.egg_3714065679,undefined);
  next.elapsed=200;transact(next,p,{id:2,action:'offline-claim'},200);
  assert.equal(BigInt(p.account.cash),cash+100n);
});
test('十秒静止仅十个位置包，拥塞无队列；断档停在最后确认位置',()=>{
  const sender=new MotionSender();let count=0;
  for(let t=0;t<10000;t+=16){const p=sender.sample(origin,t);if(p){sender.sent(p,t);count++;}}assert.equal(count,10);
  sender.failed(10000,'ROOM_CHANNEL_BUSY');assert.equal(sender.sample({...origin,x:10},10100),null);
  const b=new MotionBuffer();b.push(origin,0);b.push({...origin,x:10,sequence:1},100);
  assert.equal(b.push({...origin,x:999,sequence:0},200),false);assert.equal(b.at(10000).x,10);
});
test('共享蛋有230个唯一槽，竞争最后一击仅破碎一次；快照可恢复',()=>{
  let seed=42;const random=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;};
  const engine=createEggEngine(random,()=>{});engine.initialize(null,0);
  assert.equal(engine.slots.size,230);assert.equal(engine.eggs.length,230);
  const e=engine.eggs[0],s=createWorld(),p=join(s,'a','seat',origin);p.loaded=p.active=true;p.position={...origin,x:e.spec.position[0],y:e.spec.floorY,z:e.spec.position[2]};
  e.life.hp=1;assert.ok(hitEgg(engine,p,{id:1,egg:e.spec.id,generation:0},1,random));
  assert.equal(e.breaker,'a');assert.equal(hitEgg(engine,p,{id:2,egg:e.spec.id,generation:0},1,random),null);
  const restored=restoreEggEngine(JSON.parse(JSON.stringify([...engine.slots.values()])),random,()=>{});
  assert.equal(restored.eggs[0].life.alive,false);assert.equal(restored.eggs[0].breaker,'a');
  assert.ok(new TextEncoder().encode(JSON.stringify(compactEggs(restored,10))).length<16000);
  p.account.pickaxes.pets.push({...e.pet,id:`online:abcd:${e.pet.id}`});
  s.elapsed=500;assert.equal(transact(s,p,{id:3,action:'pickaxe-equip',value:1},0).ok,true);
  assert.equal(p.account.pickaxes.pets.length,1,'跨Room唯一ID不能在账户规则恢复时被丢弃');
});
test('多人争抢同一动物：完整演出后长按1.4秒，持有暂停，掉落续计，安全区只入库一次',()=>{
  const s=createWorld(),a=join(s,'a','a',origin),b=join(s,'b','b',origin);
  a.loaded=a.active=b.loaded=b.active=true;
  const pet={id:'online:abcd:zone1-egg-0:0',name:'Chick',zone:1};
  addAnimal(s,{pet,spec:{position:[-150,0,0],floorY:0}});
  a.position=b.position={...origin,x:-150,y:0};
  assert.equal(holdAnimal(s,a,pet.id),false);s.elapsed=8650;
  assert.equal(holdAnimal(s,a,pet.id),true);assert.equal(holdAnimal(s,b,pet.id),true);
  for(let i=0;i<14;i++){s.elapsed+=100;holdAnimal(s,a,pet.id);holdAnimal(s,b,pet.id);advanceAnimals(s,100);}
  assert.equal(a.carrying,pet.id);assert.equal(b.carrying,null);
  const remaining=s.animals[pet.id].remaining;
  s.elapsed+=10000;advanceAnimals(s,10000);assert.equal(s.animals[pet.id].remaining,remaining);
  assert.equal(dropAnimal(s,a,true),true);s.elapsed+=100;advanceAnimals(s,100);
  assert.equal(s.animals[pet.id].remaining,remaining-100);
  holdAnimal(s,b,pet.id);for(let i=0;i<14;i++){s.elapsed+=100;holdAnimal(s,b,pet.id);advanceAnimals(s,100);}
  assert.equal(b.carrying,pet.id);b.position={...origin,x:-48,y:.6,z:24};
  assert.equal(advanceAnimals(s,0).banked.length,1);assert.equal(advanceAnimals(s,0).banked.length,0);
  assert.equal(b.account.pickaxes.pets.length,1);assert.equal(a.account.pickaxes.pets.length,0);
});
test('松开、失去心跳、断线期间不能完成拾取；到期唯一实例清除',()=>{
  const s=createWorld(),p=join(s,'a','a',origin);p.loaded=p.active=true;p.position={...origin,x:-150,y:0};
  const pet={id:'online:abcd:zone1-egg-0:0',name:'Chick',zone:1};addAnimal(s,{pet,spec:{position:[-150,0,0],floorY:0}});s.elapsed=8650;
  holdAnimal(s,p,pet.id);s.elapsed+=700;advanceAnimals(s,700);assert.equal(p.hold,null);
  holdAnimal(s,p,pet.id);holdAnimal(s,p,null);s.elapsed+=1400;advanceAnimals(s,1400);assert.equal(p.carrying,null);
  p.connected=false;assert.equal(holdAnimal(s,p,pet.id),false);s.elapsed+=50000;advanceAnimals(s,50000);assert.equal(Object.keys(s.animals).length,0);
});
test('重建守卫不消耗宿主随机数，纯JSON快照恢复后继续同一轨迹',()=>{
  let calls=0;const random=()=>{calls++;return .31;};const guards=createGuards(random,()=>{});
  for(let i=0;i<50;i++)updateGuards(guards,[],.1);
  const saved=JSON.parse(JSON.stringify(saveGuards(guards))),before=calls;
  const recovered=createGuards(random,()=>{},saved);assert.equal(calls,before);
  assert.deepEqual(saveGuards(recovered),saved);
  updateGuards(guards,[],.1);updateGuards(recovered,[],.1);assert.deepEqual(saveGuards(recovered),saveGuards(guards));
});
test('客户端快照屏障等待全部分片，重连后不能沿用旧场景基线',()=>{
  const events=new Map(),sent=[],socket={on:(e,fn)=>{events.set(e,fn);return()=>{};}};
  const session=new PastureSession({socket});session.room={roomId:'r',sendControl:(...a)=>sent.push(a),sendReliable:()=>{}};
  const receive=(op,data)=>events.get('roomMessage')({roomId:'r',opCode:op,data:new TextEncoder().encode(JSON.stringify(data))});
  receive(OP.SNAPSHOT,{});receive(OP.ACCOUNT,{revision:3,account:{}});receive(OP.EGGS,{});assert.equal(session.ready,false);
  const part={full:true,count:2,revision:1,time:0,animals:[],removed:[]};receive(OP.ANIMALS,{...part,index:0});assert.equal(session.ready,false);
  receive(OP.ANIMALS,{...part,index:1});assert.equal(session.ready,true);assert.equal(sent.length,1);
  events.get('roomReconnecting')({roomId:'r'});receive(OP.ACCOUNT,{revision:4});assert.equal(session.ready,false);
});

test('客户端报告的位置不受Room冲刺预算限制',()=>{
  const s=createWorld(),p=join(s,'p','seat',origin);p.loaded=p.active=true;
  for(let i=1;i<=50;i++){s.elapsed+=100;assert.equal(acceptMove(s,p,encodeMove({...origin,sequence:i,x:i*2.7})),true);}
  s.elapsed+=60000;assert.equal(acceptMove(s,p,encodeMove({...origin,sequence:51,x:500})),true);assert.equal(p.position.x,500);
});
test('展示位置保留宽松包频率上限，避免异常发送耗尽Room',()=>{
  const s=createWorld(),p=join(s,'p','seat',origin);p.loaded=p.active=true;s.elapsed=100;
  for(let i=1;i<=16;i++)assert.equal(acceptMove(s,p,encodeMove({...origin,sequence:i,x:i})),true);
  assert.equal(acceptMove(s,p,encodeMove({...origin,sequence:17,x:17})),false);
  s.elapsed+=50;assert.equal(acceptMove(s,p,encodeMove({...origin,sequence:17,x:17})),true);
});
test('250只动物的账户换镐子只发送装备字段，数组减少和删除字段可恢复',()=>{
  const before={pickaxes:{equipped:1,pets:Array.from({length:250},(_,i)=>({id:`pet-${i}`,name:'Chicken',weightKg:12345}))},commerce:{intents:{old:{id:'payment'}}}};
  const after=JSON.parse(JSON.stringify(before));after.pickaxes.equipped=2;
  assert.ok(JSON.stringify(accountChanges(before,after)).length<100);
  after.pickaxes.pets.pop();delete after.commerce.intents.old;const output=JSON.parse(JSON.stringify(before));
  for(const change of accountChanges(before,after)){let target=output;for(const key of change.path.slice(0,-1))target=target[key];if(change.remove)delete target[change.path.at(-1)];else target[change.path.at(-1)]=change.value;}
  assert.deepEqual(output,after);
});
test('重分牧场搬迁位置可逆，自己的训练增长由Room计时且断流停止',()=>{
  const s=createWorld(),p=join(s,'p','seat',origin);p.loaded=p.active=true;
  p.account.baseId='Base_3';p.account.plot.pets=[{id:'p',position:[10,1.2666668,52],yaw:0}];relocateAccount(p);
  assert.ok(Math.abs(p.account.plot.pets[0].position[2]+54)<.001);
  p.slot=2;relocateAccount(p);assert.ok(Math.abs(p.account.plot.pets[0].position[2]-52)<.001);p.account.plot.pets=[];
  p.account.unlocked=true;p.position={...origin,...trainingPoint(p,'own',0)};
  assert.equal(transact(s,p,{id:1,action:'training-start',value:{kind:'own',slot:0}},1000).ok,true);
  const before=p.account.power;for(let i=0;i<20;i++){s.elapsed+=100;p.lastMove=s.elapsed;tickEconomy(s,p,.1,1000+s.elapsed);}
  assert.ok(p.account.power>before);s.elapsed+=4000;tickEconomy(s,p,.1,7000);assert.equal(p.training,null);
});
test('放置、收入、检索、合成和孵化只修改所属账户',()=>{
  const s=createWorld(),p=join(s,'p','seat',origin),b=join(s,'b','seat2',origin);p.loaded=p.active=true;
  const species='Chicken',pet={id:'zone1-egg-0:0',name:species,zone:1,weightKg:1,sizeMult:1,gender:'Male'};
  // Use an actual species from the generated source pool.
  const e=createEggEngine(()=>.3,()=>{});e.initialize(null,0);const first=e.eggs[0];p.position={...origin,x:first.spec.position[0],y:first.spec.floorY,z:first.spec.position[2]};first.life.hp=1;
  const rolled=hitEgg(e,p,{id:1,egg:first.spec.id,generation:0},1,()=>.3).pet;
  p.account.pickaxes.pets=[rolled];const box=plotBox(p);p.position={...origin,x:box.matrix[3],y:1.2666668,z:box.matrix[11]};
  assert.equal(transact(s,p,{id:1,action:'pasture-place',value:{id:rolled.id,position:[p.position.x,p.position.y,p.position.z],yaw:0}},1000).ok,true);
  const cash=BigInt(p.account.cash);for(let i=0;i<100;i++){s.elapsed+=100;p.lastMove=s.elapsed;tickEconomy(s,p,.1,1000+s.elapsed);}assert.ok(BigInt(p.account.cash)>cash);assert.equal(b.account.cash,100);
  s.elapsed+=100;assert.equal(transact(s,p,{id:2,action:'pasture-retrieve',value:rolled.id},11000).ok,true);assert.equal(p.account.plot.pets.length,0);
  const candidate={...rolled,gender:'Male'};p.account.pickaxes.pets=[candidate,{...candidate,id:'zone1-egg-1:0'},{...candidate,id:'zone1-egg-2:0'}];p.position={...origin,x:-70.9568634,y:6.3574734,z:87.8627853};
  s.elapsed+=100;const ids=p.account.pickaxes.pets.map(p=>p.id);assert.equal(transact(s,p,{id:3,action:'merge',value:ids},12000,()=>.3).ok,true);
  assert.equal(p.account.mergeEggs.length,1);assert.equal(p.account.pickaxes.pets.length,0);
  const eggId=p.account.mergeEggs[0].id;const home=plotBox(p);p.position={...origin,x:home.matrix[3],y:1.2666668,z:home.matrix[11]};s.elapsed+=100;
  assert.equal(transact(s,p,{id:4,action:'merge-place',value:{id:eggId,position:[p.position.x,p.position.y,p.position.z]}},12000).ok,true);
  const ready=p.account.growingEggs[0].readyAt;s.elapsed+=100;
  assert.equal(transact(s,p,{id:5,action:'merge-hatch',value:eggId},ready+1).ok,true);
  p.lastMove=s.elapsed;tickEconomy(s,p,.1,ready+10000);assert.equal(p.account.growingEggs.length,0);assert.equal(p.account.pickaxes.pets.length,1);
});
test('球棒由Room选择目标，忽略客户端力量，原位置掉落且保护免疫',()=>{
  const s=createWorld(),a=join(s,'a','a',{...origin,x:-150}),b=join(s,'b','b',{...origin,x:-154});a.loaded=a.active=b.loaded=b.active=true;a.account.weapons.equipped=1;
  const pet={id:'zone1-egg-0:0',name:'Chick',zone:1};addAnimal(s,{pet,spec:{position:[-170,0,0],floorY:0}});s.animals[pet.id].carrier=b.id;b.carrying=pet.id;
  const hit=batStrike(s,a);assert.equal(hit.target.id,'b');assert.equal(b.carrying,null);assert.equal(s.animals[pet.id].position.x,-154);assert.equal(batStrike(s,a),null);
  s.elapsed+=1000;assert.equal(batStrike(s,a),null);
});
test('巨型蛋时钟、血量和破碎快照跨恢复保留，不重新抽奖',()=>{
  let seed=42;const rng=()=>((seed=(Math.imul(seed,1664525)+1013904223)>>>0)/4294967296);
  const engine=createEggEngine(rng,()=>{});engine.initialize(null,0);withTitanic(engine,null,rng);engine.update(1800);
  const saved=JSON.parse(JSON.stringify(saveTitanic(engine))),slots=JSON.parse(JSON.stringify([...engine.slots.values()]));
  const restored=withTitanic(restoreEggEngine(slots,()=>{throw Error('restore random');},()=>{}),saved,()=>{throw Error('restore random');});
  assert.deepEqual(JSON.parse(JSON.stringify(saveTitanic(restored))),saved);assert.equal(restored.titanic.nextAt,3600);
});
test('Room付款只在allowed内fulfill，完成后重读，重复订单不重复加钱',()=>{
  const s=createWorld(),p=join(s,'buyer','s',origin);p.loaded=p.active=true;const product=PRODUCTS.find(p=>p.kind==='cash');
  let persisted,completed=false,inAllowed=false,fulfills=0;const replies=[];
  const room={state:s,random:()=>.3,unixTimeMillis:()=>1000,sendToUserJson:(_,op,v)=>replies.push(v),account(){},pasture(){},profiles(){},save(p){assert.equal(inAllowed,false);persisted=JSON.stringify({account:p.account,revision:p.revision,receipts:p.receipts});},cloudFlush(ms,fn){assert.equal(inAllowed,false);fn({status:'applied'});},cloudLoadSnapshot(_,fn){fn({status:'ready',entries:[{key:'pasture_account_v1',live:true,value:{kind:'string',value:persisted}}]});},doOrder(id,fn){if(completed){fn({status:'already_delivered'});return;}inAllowed=true;fn({status:'allowed',order:{orderId:id,payId:product.payId}});inAllowed=false;completed=true;},fulfill(writes){assert.ok(inAllowed);fulfills++;persisted=writes[0].value.value;}};
  payment(room,p,{key:'1',action:'prepare',payId:product.payId});assert.equal(replies.at(-1).ok,true);
  payment(room,p,{key:'2',action:'deliver',orderId:'fake-order'});assert.equal(replies.at(-1).pending,true);
  payment(room,p,{key:'2b',action:'deliver',orderId:'fake-order'});assert.equal(replies.at(-1).delivered,true);
  payment(room,p,{key:'3',action:'deliver',orderId:'fake-order'});assert.equal(replies.at(-1).delivered,true);const cash=p.account.cash;
  payment(room,p,{key:'4',action:'deliver',orderId:'fake-order'});assert.equal(replies.at(-1).delivered,true);assert.equal(p.account.cash,cash);assert.equal(fulfills,1);
  assert.equal(BigInt(cash),100n+BigInt(product.amount));
});
test('离线领取存档未写完时不启动发货，保存完成后蛋与收益一并保留',()=>{
  const s=createWorld(),p=join(s,'save-guard','seat',origin);p.loaded=p.active=true;
  const payId='egg_3715295845';p.account.pastureLedger.pending=100;
  p.account.commerce.intents[payId]={payId,context:{},applied:false,eggs:[{id:'prepared-egg',name:'test'}]};
  const before=BigInt(p.account.cash);assert.equal(transact(s,p,{id:1,action:'offline-claim'},0).ok,true);
  let persisted='',completed=false,orders=0,fulfills=0;const replies=[];
  const room={state:s,random:()=>.3,unixTimeMillis:()=>1000,sendToUserJson:(_,op,v)=>replies.push(v),account(){},pasture(){},profiles(){},
    save(){persisted=JSON.stringify({account:p.account,revision:p.revision,receipts:p.receipts});},
    cloudFlush(_ms,cb){cb({status:'applied'});},cloudLoadSnapshot(_id,cb){cb({status:'ready',entries:[{key:'pasture_account_v1',live:true,value:{kind:'string',value:persisted}}]});},
    doOrder(_id,cb){orders++;if(completed){cb({status:'already_delivered'});return;}cb({status:'allowed',order:{payId}});completed=true;},
    fulfill(writes){fulfills++;persisted=writes[0].value.value;}};
  const send=key=>payment(room,p,{key,action:'deliver',orderId:'paid-egg'});
  s.pendingSaves[p.id]={value:'unsaved-claim',nextAt:0};s.saving[p.id]=true;send('blocked');
  assert.equal(replies.at(-1).reason,'SAVE_PENDING');assert.equal(orders,0);assert.equal(p.account.commerce.intents[payId].orderId,undefined);
  delete s.pendingSaves[p.id];delete s.saving[p.id];send('bind');send('fulfill');send('complete');
  assert.equal(replies.at(-1).delivered,true);assert.equal(BigInt(p.account.cash),before+100n);
  assert.equal(p.account.pastureLedger.pending,0);assert.equal(p.account.mergeEggs.length,10);assert.equal(p.account.commerce.intents[payId],undefined);
  send('again');assert.equal(fulfills,1);assert.equal(BigInt(p.account.cash),before+100n);
});

test('七个牧场独立出生、重生回本人门前、重连保留位置',()=>{
  const s=createWorld(),positions=[];
  for(let i=0;i<7;i++){
    const p=join(s,`spawn${i}`,`seat${i}`),home={...p.position};positions.push(home);
    assert.equal(p.account.baseId,`Base_${i+1}`);
    p.position={...p.position,x:900,z:900};disconnect(p);
    assert.equal(join(s,p.id,p.seat).position.x,900);
    p.loaded=p.active=true;
    assert.equal(transact(s,p,{id:1,action:'respawn'},0).ok,true);
    assert.deepEqual(p.position,home);
  }
  assert.equal(new Set(positions.map(p=>`${p.x},${p.z}`)).size,7);
  assert.ok(Math.abs(positions[2].x+13.8073769)<1e-6);
  assert.ok(Math.abs(positions[4].yaw-positions[2].yaw)>1);
  assert.ok(Math.abs(positions[5].yaw-positions[2].yaw)>1);
});

test('leaderboard playtime counts only active connected movement heartbeats and survives account restore',async()=>{
 const {restoreState}=await import('../public/treadmill-state.js');const s=createWorld(),p=join(s,'time','seat',origin);p.loaded=p.active=true;
 for(let i=0;i<10;i++){s.elapsed+=100;p.lastMove=s.elapsed;tickEconomy(s,p,.1,1000+s.elapsed);}
 assert.ok(Math.abs(p.account.rankStats.playtime-1)<1e-8);assert.equal(p.account.rankStats.income,0);
 p.active=false;tickEconomy(s,p,.1,3000);assert.ok(Math.abs(p.account.rankStats.playtime-1)<1e-8);
 p.active=true;s.elapsed+=4000;tickEconomy(s,p,.1,7000);assert.ok(Math.abs(p.account.rankStats.playtime-1)<1e-8);
 assert.equal(restoreState(JSON.parse(JSON.stringify(p.account))).rankStats.playtime,p.account.rankStats.playtime);
});


test('首次已付款请求直接在玩家消息内发起doOrder，不经过准备或异步绑定',async()=>{
  const {createMockEconomy}=await import('../server/mock/typescript/src/mock-economy.mjs');
  const s=createWorld(),p=join(s,'payment-buyer','seat',origin);p.loaded=p.active=true;
  const product=PRODUCTS.find(p=>p.kind==='speed'&&p.multiplier===2),orderId='test-context-order';
  const economy=createMockEconomy({orders:[{orderId,userId:p.id,payId:product.payId}]}),host=economy.hostBindings();
  const tasks=[],replies=[];let persisted,fulfills=0,allowedHandle;
  const room={state:s,random:()=>.3,unixTimeMillis:()=>1000,
    sendToUserJson:(_,op,v)=>replies.push(v),account(){},pasture(){},profiles(){},
    save(){persisted=JSON.stringify({account:p.account,revision:p.revision,receipts:p.receipts});},
    cloudFlush(ms,fn){tasks.push(()=>fn({status:'applied'}));},
    cloudLoadSnapshot(_,fn){tasks.push(()=>fn({status:'ready',entries:[{key:'pasture_account_v1',live:true,value:{kind:'string',value:persisted}}]}));},
    doOrder(id,fn){const handle=host.doOrderStart(id,10000);tasks.push(()=>{
      const r=host.doOrderPoll(handle);
      if(r.tag==='allowed'){allowedHandle=handle;fn({status:'allowed',order:r.val});allowedHandle=null;host.doOrderFinish(handle,10000);}
      else fn({status:r.tag==='completed'?'already_delivered':r.tag});
    });},
    fulfill(writes){assert.ok(allowedHandle);fulfills++;persisted=writes[0].value.value;}
  };
  const flush=()=>{while(tasks.length)tasks.shift()();};
  const send=request=>{economy.setActiveUserId(p.id);try{payment(room,p,request);}finally{economy.setActiveUserId('');}flush();};
  send({key:'prepare',action:'prepare',payId:product.payId});
  send({key:'bind',action:'deliver',orderId});
  assert.deepEqual(replies.at(-1),{key:'bind',ok:true,pending:true});
  assert.equal(fulfills,1);
  // A different order cannot replace an actual fulfillment in progress.
  send({key:'wrong',action:'deliver',orderId:'different'});assert.equal(replies.at(-1).reason,'RECOVER_PENDING_PURCHASE');
  send({key:'grant',action:'deliver',orderId});assert.equal(replies.at(-1).delivered,true);
  assert.equal(p.account.commerce.speedMultiplier,2);assert.equal(fulfills,1);
  send({key:'complete',action:'deliver',orderId});assert.equal(replies.at(-1).delivered,true);
  send({key:'repeat',action:'deliver',orderId});assert.equal(replies.at(-1).delivered,true);assert.equal(fulfills,1);
});


test('联机客户端直接处理发货/完成回执；已有订单只补发不再次付款',async()=>{
  const {installRoomCommerce}=await import('../public/online/commerce.js');
  const {encode,decode}=await import('../public/gameplay/commerce/cloud-save.js');
  const product=PRODUCTS.find(p=>p.kind==='speed'&&p.multiplier===2);
  for(const existing of [false,true]){
    let saved=existing?{orderId:'test-paid',payId:product.payId,grantBy:'room'}:null,pays=0,deliveries=0;
    const listeners=new Set(),actions=[];
    const connection={observe(fn){listeners.add(fn);return()=>listeners.delete(fn);},session:{ready:true,room:{sendReliable(op,bytes){
      const r=JSON.parse(new TextDecoder().decode(bytes));actions.push(r.action);
      const result=r.action==='deliver'?(++deliveries<2?{pending:true}:{delivered:true}):{};
      queueMicrotask(()=>{for(const fn of listeners)fn('payment',{key:r.key,ok:true,...result});});
    }}}};
    const commerce={onBusy(){},onChange(){},onMessage(code){throw Error(code);},sdk:{
      privateKV:{async get(){return {ok:true,data:encode(saved)};},async set(key,value){saved=decode(value);return {ok:true,data:{}};}},
      iap:{async showPayPanel(){pays++;return {ok:true,data:{success:true,orderId:'test-paid',grantBy:'room'}};}}
    }};
    installRoomCommerce({commerce,account:{data:new (await import('../public/treadmill-state.js')).TreadmillState().data}},connection);
    const result=await commerce.buy(product.id);
    assert.equal(result.delivered,true);assert.equal(pays,existing?0:1);assert.equal(saved,null);
    assert.equal(actions.includes('prepare'),false);assert.equal(listeners.size,1);
  }
});
test('支付面板取消或失败时客户端不保存新的无订单号准备记录',async()=>{
  const {installRoomCommerce}=await import('../public/online/commerce.js');
  const {encode,decode}=await import('../public/gameplay/commerce/cloud-save.js');
  for(const cancelled of [true,false]){
    let saved=null,writes=[];const actions=[],listeners=new Set(),messages=[];
    const c={busy:false,onBusy(){},onChange(){},onMessage(v){messages.push(v);},sdk:{
      privateKV:{async get(){return {ok:true,data:encode(saved)};},async set(_k,v){saved=decode(v);writes.push(saved);return {ok:true};}},
      iap:{async showPayPanel(){assert.equal(writes.length,0);return cancelled?{ok:true,data:{success:false}}:{ok:false,error:{code:'PENDING'}};}}
    }};
    const conn={observe(fn){listeners.add(fn);return()=>listeners.delete(fn);},session:{ready:true,room:{sendReliable(_op,bytes){
      const r=JSON.parse(new TextDecoder().decode(bytes));actions.push(r.action);queueMicrotask(()=>{for(const fn of listeners)fn('payment',{key:r.key,ok:true});});
    }}}};
    installRoomCommerce({commerce:c,account:{data:new (await import('../public/treadmill-state.js')).TreadmillState().data}},conn);const result=await c.buy('egg_3714065679');
    assert.deepEqual(actions,[]);
    assert.equal(!!result.cancelled,cancelled);assert.equal(saved,null);
    assert.ok(writes.every(value=>value===null));
    if(!cancelled)assert.equal(messages[0],'PENDING');
  }
});
test('发货遇到账户保存中时自动重试原订单，不重新发起支付',async()=>{
  const {installRoomCommerce}=await import('../public/online/commerce.js');
  const {encode,decode}=await import('../public/gameplay/commerce/cloud-save.js');
  let saved={orderId:'paid-test-order',payId:'egg_3715295845',grantBy:'room'},sends=0,pays=0;
  const listeners=new Set(),c={busy:false,onBusy(){},onChange(){},onMessage(code){throw Error(code);},sdk:{
    privateKV:{async get(){return {ok:true,data:encode(saved)};},async set(_k,v){saved=decode(v);return {ok:true};}},
    iap:{async showPayPanel(){pays++;throw Error('unexpected payment');}}
  }};
  const conn={observe(fn){listeners.add(fn);return()=>listeners.delete(fn);},session:{ready:true,room:{sendReliable(_op,bytes){
    const r=JSON.parse(new TextDecoder().decode(bytes));assert.equal(r.orderId,'paid-test-order');
    const response=++sends===1?{ok:false,reason:'SAVE_PENDING'}:{ok:true,delivered:true};
    queueMicrotask(()=>{for(const fn of listeners)fn('payment',{key:r.key,...response});});
  }}}};
  installRoomCommerce({commerce:c,account:{data:new (await import('../public/treadmill-state.js')).TreadmillState().data}},conn);const result=await c.buy('egg_3715295845');
  assert.equal(result.delivered,true);assert.equal(sends,2);assert.equal(pays,0);assert.equal(saved,null);
});
test('联机恢复检查待交付订单，但空列表和未知订单均不自动取消准备',async()=>{
  const {installRoomCommerce}=await import('../public/online/commerce.js');
  const {encode}=await import('../public/gameplay/commerce/cloud-save.js');
  for(const orderIds of [[],['unidentified-order']]){
    const listeners=new Set(),actions=[];let queries=0,messages=[];
    const connection={observe(fn){listeners.add(fn);return()=>listeners.delete(fn);},session:{ready:true,room:{sendReliable(_op,bytes){
      const request=JSON.parse(new TextDecoder().decode(bytes));actions.push(request.action);
      queueMicrotask(()=>{for(const fn of listeners)fn('payment',{key:request.key,ok:true});});
    }}}};
    const commerce={onBusy(){},onChange(){},onMessage(code){messages.push(code);},sdk:{
      privateKV:{async get(){return {ok:true,data:encode(null)};},async set(){return {ok:true,data:{}};}},
      iap:{async getPendingOrderIds(){queries++;return {ok:true,data:{orderIds}};}}
    }};
    installRoomCommerce({commerce,account:{data:new (await import('../public/treadmill-state.js')).TreadmillState().data}},connection);
    const result=await commerce.recover({silent:true});
    assert.equal(result.ok,true);assert.equal(result.unknown,orderIds.length);assert.equal(!!result.unresolved,orderIds.length>0);assert.equal(queries,1);
    assert.deepEqual(actions,[]);
    assert.deepEqual(messages,[]);
    assert.equal(listeners.size,1);
  }
});
