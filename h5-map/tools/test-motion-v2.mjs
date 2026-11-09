import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {build} from 'esbuild';
import {writeFile} from 'node:fs/promises';
import {OP,encodeMove,decodeMove,encodeMotion,decodeMotion,encodeMotions,decodeMotions} from '../public/online/protocol.js';
import {MotionBuffer,MotionSender} from '../public/online/motion.js';
import {PastureSession} from '../public/online/session.js';
import {PlayerController} from '../public/character-controller.js';
import * as THREE from 'three';
await build({stdin:{contents:"export * from './server/game/world.ts';export * from './server/game/motion.ts';export * from './server/game/eggs.ts';export {PastureRoom} from './server/game/room.ts';",resolveDir:process.cwd()},bundle:true,format:'esm',platform:'node',outfile:'build/motion-v2-test.mjs',plugins:[{name:'io',setup(b){
  b.onResolve({filter:/^@cysj\/room$/},()=>({path:'host',namespace:'host'}));
  b.onLoad({filter:/.*/,namespace:'host'},()=>({contents:`export class Room{handlers=new Map();sent=[];onMessage(op,fn){this.handlers.set(op,fn);}unixTimeMillis(){return 0;}sendToUserOn(channel,id,op,data){this.sent.push({channel,id,op,data});}sendToUserJson(id,op,data){this.sent.push({id,op,data});}}export const defineRoom=x=>x,decodeJson=b=>JSON.parse(new TextDecoder().decode(b)),encodeJson=x=>new TextEncoder().encode(JSON.stringify(x));`,loader:'js'}));
}}]});
const {createWorld,join,renewMotion,acceptMotion,motionFrame,PastureRoom,createEggEngine,hitEgg}=await import('../build/motion-v2-test.mjs');
const pose={x:0,y:.5,z:0,yaw:0,flags:9,sequence:0,sampleTime:0,vx:18,vy:0,vz:0,epoch:0};
const setup=()=>{const state=createWorld(),p=join(state,'p','s',pose);p.active=p.loaded=true;return {state,p};};

test('增强二进制包跨JS域/字节列表往返，旧包23字节不变，拒绝坏长度/NaN/速度和槽位',()=>{
  const encoded=encodeMotion(pose);assert.equal(encoded.length,41);assert.deepEqual(decodeMotion(Array.from(encoded)),pose);
  const foreign=vm.runInNewContext(`new Uint8Array(${JSON.stringify([...encoded])})`);assert.deepEqual(decodeMotion(foreign),pose);
  assert.equal(encodeMove(pose).length,23);assert.equal(decodeMove(encodeMove(pose)).x,0);
  for(const invalid of [encoded.slice(1),[...encoded,0],Array(41),{length:1e8}])assert.throws(()=>decodeMotion(invalid));
  assert.throws(()=>encodeMotion({...pose,vx:NaN}));assert.throws(()=>encodeMotion({...pose,vx:501}));
  const packet=encodeMotions(Array.from({length:7},(_,slot)=>({...pose,slot})),123);assert.equal(packet.length,300);assert.equal(decodeMotions(packet).players.length,7);
  const bad=packet.slice();bad[48]=bad[6];assert.throws(()=>decodeMotions(bad));
});

test('正常20Hz与成簇到包都被接收；客户端位置不受位移额度限制',()=>{
  const {state,p}=setup();
  for(let i=1;i<=40;i++){state.elapsed=i*50;assert.ok(acceptMotion(state,p,encodeMotion({...pose,sequence:i,sampleTime:i*50,x:i*.9}),0));}
  state.elapsed+=100;assert.ok(acceptMotion(state,p,encodeMotion({...pose,sequence:41,sampleTime:2050,x:36.9}),0));
  assert.ok(acceptMotion(state,p,encodeMotion({...pose,sequence:42,sampleTime:2100,x:37.8}),0));
  assert.equal(acceptMotion(state,p,encodeMotion({...pose,sequence:43,sampleTime:2200,x:1000,vx:500}),0),true);
  assert.equal(acceptMotion(state,p,encodeMotion({...pose,sequence:43,sampleTime:999999,x:1000,vx:500}),0),false);
  assert.equal(p.position.x,1000);
});

test('暂停恢复及Room模拟时钟落后于手机时钟，不会永久拒绝后续合法位置',()=>{
  const room=new PastureRoom();room.state=createWorld();
  const p=join(room.state,'p','s',pose);p.loaded=p.active=true;
  room.eggSnapshot=room.animalSnapshot=()=>{};
  const send=(elapsed,sampleTime,sequence,x)=>{
    room.state.elapsed=elapsed;
    room.handlers.get(String(OP.MOTION))({userId:'p',seatId:'s'},encodeMotion({...pose,elapsed,sampleTime,sequence,x}));
  };
  send(100,1000,1,0);
  p.active=false;
  // 模拟线上暂停恢复：手机过去30秒，Room模拟时间只推进20秒。
  p.active=true;send(20100,31000,2,.5);
  assert.equal(p.lastSequence,2);
  for(let i=1;i<=20;i++)send(20100+i*40,31000+i*50,2+i,.5+i*.4);
  assert.equal(room.networkStats(p).accepted,22);
  assert.ok(p.position.x>8,'权威坐标必须继续移动');
  assert.equal(room.sent.length,0,'时钟差异不触发位置回退');
});

test('采样时间只决定表现顺序；大位移被采纳，旧时间不污染后续基线',()=>{
  const {state,p}=setup();state.elapsed=100;
  assert.ok(acceptMotion(state,p,encodeMotion({...pose,sequence:1,sampleTime:1000}),0));
  state.elapsed=150;
  assert.equal(acceptMotion(state,p,encodeMotion({...pose,sequence:2,sampleTime:1000000,x:1000,vx:500}),0),true);
  assert.equal(p.position.x,1000);
  assert.equal(acceptMotion(state,p,encodeMotion({...pose,sequence:2,sampleTime:1000000,x:.5}),0),false);
  assert.equal(acceptMotion(state,p,encodeMotion({...pose,sequence:3,sampleTime:1000000,x:1}),0),false);
  assert.equal(acceptMotion(state,p,encodeMotion({...pose,sequence:3,sampleTime:999999,x:1}),0),false);
  state.elapsed=200;
  assert.ok(acceptMotion(state,p,encodeMotion({...pose,sequence:3,sampleTime:1000050,x:1}),0));
  assert.equal(acceptMotion(state,p,encodeMotion({...pose,sequence:2,sampleTime:1000100,x:1.5}),0),false);
  const restored=JSON.parse(JSON.stringify(state));restored.elapsed+=50;
  assert.ok(acceptMotion(restored,restored.players.p,encodeMotion({...pose,sequence:4,sampleTime:1000100,x:1.5}),0));
});

test('手机与Room时间进度不同：恢复后走到蛋旁能通过权威距离校验并扣血',async()=>{
  const engine=createEggEngine(()=>.5,()=>{});engine.initialize(null,0);const egg=engine.eggs[0];
  const [x,,z]=egg.spec.position,state=createWorld();
  const p=join(state,'p','s',{...pose,x:x+50,y:egg.spec.floorY,z});p.loaded=p.active=true;
  const hit={id:1,egg:egg.spec.id,generation:egg.life.generation};
  assert.ok(acceptMotion(state,p,encodeMotion({...p.position,sampleTime:1000,epoch:0,vx:0,vy:0,vz:0}),0));
  state.elapsed=20000;
  assert.ok(acceptMotion(state,p,encodeMotion({...p.position,sequence:1,sampleTime:31000,epoch:0,vx:0,vy:0,vz:0}),0));
  assert.equal(hitEgg(engine,p,hit,20,()=>.5),null);
  for(let i=1;i<=50;i++){
    state.elapsed+=80;
    assert.ok(acceptMotion(state,p,encodeMotion({...p.position,sequence:i+1,sampleTime:31000+i*100,x:x+50-i,epoch:0,vx:-10,vy:0,vz:0}),0));
  }
  const before=egg.life.hp;assert.ok(hitEgg(engine,p,hit,state.elapsed/1000,()=>.5));assert.ok(egg.life.hp<before);
});

test('重连/重生epoch阻止旧轨迹重放，检查点恢复后保持时间顺序',()=>{
  const {state,p}=setup();state.elapsed=100;assert.ok(acceptMotion(state,p,encodeMotion({...pose,sequence:1,sampleTime:500,x:1}),0));
  const restored=JSON.parse(JSON.stringify(state)),player=restored.players.p;renewMotion(player);
  assert.equal(acceptMotion(restored,player,encodeMotion({...pose,sequence:2,sampleTime:550,x:2}),0),false);
  restored.elapsed+=100;assert.ok(acceptMotion(restored,player,encodeMotion({...pose,epoch:1,sequence:2,sampleTime:5,x:2}),0));
  assert.equal(motionFrame(player).epoch,1);assert.equal(player.motionAwaiting,false);
});

test('20Hz只提升人物通道：实际Room调度仍每秒10次玩法计算，旧客户端仍收10Hz旧包',()=>{
  const room=new PastureRoom();room.state=createWorld();const a=join(room.state,'new','a',pose),b=join(room.state,'old','b',pose);a.loaded=b.loaded=true;a.motionV2=true;
  let gameplay=0;room.updateGameplay=()=>gameplay++;
  for(let i=1;i<=20;i++){a.lastMove=b.lastMove=i*50;a.position={...pose,sequence:i,sampleTime:i*50};room.onTick(50);}
  assert.equal(gameplay,10);const enhanced=room.sent.filter(m=>m.id==='new'),legacy=room.sent.filter(m=>m.id==='old');
  assert.equal(enhanced.length,20);assert.equal(legacy.length,10);assert.ok(enhanced.every(m=>Number(m.op)===OP.MOTIONS));assert.ok(legacy.every(m=>Number(m.op)===OP.MOVES));
});

test('新客户端只在服务端宣告支持后发送增强包，否则自动沿用旧格式',()=>{
  for(const modern of [false,true]){let now=1000;const sent=[],session=new PastureSession({socket:{on:()=>()=>{}},now:()=>now});
    session.room={sendUnreliable:(op,data)=>sent.push({op,data})};
    session.receive({opCode:OP.SNAPSHOT,data:new TextEncoder().encode(JSON.stringify({self:'p',players:[{id:'p',position:{sequence:17}}],...(modern?{motion:{version:2,hz:20,epoch:3}}:{})}))});
    session.ready=true;session.stage='room_connected';session.update(pose);now+=50;session.update({...pose,x:1});
    assert.equal(sent.length,modern?2:1);assert.equal(sent[0].op,modern?OP.MOTION:OP.MOVE);
    if(modern){const p=decodeMotion(sent[0].data);assert.equal(p.sequence,18);assert.equal(p.epoch,3);}
  }
});

test('分片快照完整拼接后再协商增强通道，不能因外层分片缺字段降级',()=>{
  const session=new PastureSession({socket:{on:()=>()=>{}}});
  const json=JSON.stringify({self:'p',players:[{id:'p',position:{sequence:20}}],motion:{version:2,hz:20,epoch:7}}),half=Math.floor(json.length/2);
  for(const [index,text] of [json.slice(0,half),json.slice(half)].entries())session.receive({opCode:OP.SNAPSHOT,data:new TextEncoder().encode(JSON.stringify({__chunk:true,index,count:2,text}))});
  assert.equal(session.motionV2,true);assert.equal(session.motionEpoch,7);assert.equal(session.sender.sequence,21);
});

test('速度插值急停/急转/跳跃不越过确认范围，断流保持最后位置，乱序不能回跳',()=>{
  const b=new MotionBuffer();for(let i=0;i<8;i++)b.push({...pose,x:i*.9,y:.5+Math.sin(i/7*Math.PI)*3,sampleTime:i*50,sequence:i,vx:i<7?18:0,vy:i<4?20:-20},i*50+80);
  for(let t=80;t<1500;t+=10){const p=b.at(t);assert.ok(p.x>=0&&p.x<=6.3+1e-8);assert.ok(p.y>=.5-1e-8&&p.y<=3.5);}
  assert.equal(b.push({...pose,sequence:1,sampleTime:50,x:999},1600),false);assert.equal(b.at(1700).flags&3,0);
  assert.ok(Math.abs(b.at(2000).x-6.3)<1e-8);assert.ok(b.samples.length<=24);
});

test('样本时间与序号环回、epoch跳转重置及旧epoch拒绝',()=>{
  const b=new MotionBuffer();b.seed({...pose,x:100});
  assert.ok(b.push({...pose,sequence:0xffffffff,sampleTime:0xfffffff0},100));assert.ok(b.push({...pose,sequence:0,sampleTime:34,x:.9},150));
  assert.equal(b.samples[1].time-b.samples[0].time,50);
  assert.ok(b.push({...pose,epoch:1,sequence:1,sampleTime:0,x:50},200));assert.equal(b.at(200).x,50);
  assert.equal(b.push({...pose,epoch:0,sequence:2,sampleTime:84,x:1.8},210),false);
});

test('静止1Hz转为起跑不会沿整个心跳间隔缓慢滑动',()=>{
  const b=new MotionBuffer();b.push({...pose,flags:8,vx:0},80);b.push({...pose,flags:8,vx:0,sequence:1,sampleTime:1000},1080);
  b.push({...pose,x:.9,sequence:2,sampleTime:1650},1730);
  const samples=b.samples;assert.equal(samples.at(-2).time,1600);assert.equal(samples.at(-2).x,0);assert.equal(samples.at(-1).x,.9);
});

test('急转弯和长断流恢复只在已确认轨迹内播放，恢复后能继续前进',()=>{
  const b=new MotionBuffer();const points=[[0,0,18,0],[1,0,0,18],[1,1,-18,0],[0,1,0,0]];
  for(let i=0;i<points.length;i++){const [x,z,vx,vz]=points[i];b.push({...pose,x,z,vx,vz,sampleTime:i*100,sequence:i},i*100+80);}
  for(let t=80;t<1000;t+=10){const p=b.at(t);assert.ok(p.x>=-1e-8&&p.x<=1+1e-8);assert.ok(p.z>=-1e-8&&p.z<=1+1e-8);}
  assert.equal(b.at(1100).x,0);b.push({...pose,x:1,z:1,sampleTime:1100,sequence:4},1180);
  assert.ok(b.at(1200).x>=0);assert.ok(b.at(1600).x>0);assert.ok(b.at(1800).x<=1);
});

test('小纠正平滑显示但物理立即校正，重生/远距离跳转不拖影',()=>{
  const player=Object.create(PlayerController.prototype);player.motor={position:new THREE.Vector3(1,0,0),teleport(p){this.position.copy(p);}};player.actor={position:new THREE.Vector3(1,0,0)};player.networkVisualOffset=new THREE.Vector3();
  player.applyNetworkPosition(new THREE.Vector3(),true);assert.equal(player.motor.position.x,0);assert.equal(player.networkVisualOffset.x,1);
  player.applyNetworkPosition(new THREE.Vector3(100,0,0),true);assert.equal(player.networkVisualOffset.length(),0);
  player.applyNetworkPosition(new THREE.Vector3(),false);assert.equal(player.networkVisualOffset.length(),0);
});

test('20Hz发送有上限，静止1Hz，发送失败后无旧包排队',()=>{
  const s=new MotionSender();s.interval=50;let count=0;
  for(let now=0;now<1000;now++){const p=s.sample({...pose,x:now*.018},now);if(p){s.sent(p,now);count++;}}
  assert.equal(count,20);s.failed(1000,'ROOM_CHANNEL_BUSY');assert.equal(s.sample(pose,1100),null);
  const fresh=s.sample({...pose,x:50},1500);assert.equal(fresh.x,50);
  const idle=new MotionSender();idle.interval=50;count=0;for(let now=0;now<10000;now+=10){const p=idle.sample(pose,now);if(p){idle.sent(p,now);count++;}}assert.equal(count,10);
});

// 确定性双向链路：真正执行Room位移校验和二进制编解码，非只喂给缓冲的理想点列。
function simulate(hz){
  const {state,p}=setup(),observer=new MotionBuffer(),up=[],down=[];const interval=1000/hz;
  for(let t=0,i=0;t<=6000;t+=interval,i++){if(i%23===12)continue;up.push({at:t+[30,80,40,100][i%4],m:{...pose,sequence:i,sampleTime:t,x:Math.min(t,5000)*.018,vx:t<5000?18:0,flags:t<5000?9:8}});}
  up.sort((a,b)=>a.at-b.at);let ui=0,previous=null,nextRender=0,broadcast=0;const steps=[],lags=[];
  for(let now=0;now<=7000;now+=5){
    state.elapsed=now;
    while(ui<up.length&&up[ui].at<=now){acceptMotion(state,p,encodeMotion(up[ui++].m),0);}
    if(now%interval===0&&p.lastSequence!==null){const frame=encodeMotions([motionFrame(p)],now),index=broadcast++;if(index%19!==9)down.push({at:now+[40,90,30,60][index%4],frame});down.sort((a,b)=>a.at-b.at);}
    while(down.length&&down[0].at<=now){const q=down.shift();for(const m of decodeMotions(q.frame).players)observer.push(m,q.at);}
    if(now>=nextRender){nextRender+=1000/60;const position=observer.at(now);if(position&&previous!==null&&now>1500&&now<4500){steps.push(position.x-previous);lags.push(now-position.x/.018);}if(position)previous=position.x;}
  }
  const result={hz,minFrameStep:Math.min(...steps),maxFrameStep:Math.max(...steps),backwardFrames:steps.filter(x=>x<-.0001).length,nearStopFrames:steps.filter(x=>x<.05).length,meanVisibleDelayMs:lags.reduce((a,b)=>a+b,0)/lags.length,finalX:observer.at(7000).x};
  assert.equal(result.backwardFrames,0);assert.equal(result.finalX,90);assert.ok(observer.samples.length<=24);return result;
}
test('双向抖动/丢包/压缩到包的10Hz与20Hz对照，记录可复现结果',async()=>{
  const results=[simulate(10),simulate(20)];console.log('MOTION_BENCHMARK',JSON.stringify(results));
  await writeFile('build/motion-v2-validation.json',JSON.stringify({scope:'确定性本地模拟，不代表真机/WebRTC验收',results},null,2));
  assert.ok(results[1].meanVisibleDelayMs<results[0].meanVisibleDelayMs);
});

test('卡顿重连后的快照不把本人拉回Room记录的旧位置，并立即重新上报本地位置',async()=>{
  const {GameConnection}=await import('../public/online/game-connection.js');
  const c=new GameConnection(),events=[];c.observe((type,data)=>events.push([type,data?.kind]));
  c.receive(OP.SNAPSHOT,{self:'a',players:[{id:'a',position:{x:-150,y:.5,z:2,yaw:0,sequence:40}}]});
  assert.equal(events.some(([type,kind])=>type==='event'&&kind==='position'),false);
  assert.deepEqual(events.map(([type])=>type),['motion-reset','players']);
});
