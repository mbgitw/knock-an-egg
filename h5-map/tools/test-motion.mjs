import test from 'node:test';
import assert from 'node:assert/strict';
import {MotionBuffer,MotionSender} from '../public/online/motion.js';
import {GameConnection} from '../public/online/game-connection.js';
import {OP} from '../public/online/protocol.js';
import * as THREE from 'three';
import {RemoteAvatars} from '../public/online/avatars.js';
const pose={x:0,y:.5,z:0,yaw:0,flags:1,sequence:0};

test('10Hz移动在80ms交替抖动下仍按服务端时间匀速播放，不发生停顿或回跳',()=>{
  const b=new MotionBuffer(),packets=[];let index=0,previous=null;const steps=[];
  for(let t=0;t<=6000;t+=100)packets.push({time:t,arrival:t+500+(t%200?100:20),p:{...pose,x:t*.018,sequence:t/100}});
  for(let now=0;now<6500;now+=1000/60){
    while(index<packets.length&&packets[index].arrival<=now){const p=packets[index++];b.push(p.p,p.arrival,p.time);}
    const p=b.at(now);if(p&&previous!==null&&now>1500&&now<6000)steps.push(p.x-previous);if(p)previous=p.x;
  }
  assert.ok(Math.min(...steps)>.25,`最小帧步长 ${Math.min(...steps)}`);
  assert.ok(Math.max(...steps)<.35,`最大帧步长 ${Math.max(...steps)}`);
});

test('停跑包不提前切换动画、不外推滑行，断流外推不超过150ms',()=>{
  const b=new MotionBuffer();b.push(pose,0,0);b.push({...pose,x:1.8,sequence:1},100,100);
  b.push({...pose,x:3.6,sequence:2,flags:0},200,200);
  assert.equal(b.at(250).flags,1);assert.equal(b.at(500).flags,0);assert.equal(b.at(500).x,3.6);
  const lost=new MotionBuffer();lost.push(pose,0,0);lost.push({...pose,x:1.8,sequence:1},100,100);
  const p=lost.at(1000);assert.ok(Math.abs(p.x-4.5)<1e-8);assert.equal(p.flags,0);
});

test('偶发丢失一包时有限外推衔接下一帧，恢复后不回跳或积压补播',()=>{
  const b=new MotionBuffer();let previous=null;const steps=[];
  for(let now=0;now<=2000;now+=10){
    if(now%100===0&&now!==1000)b.push({...pose,x:now*.018,sequence:now/100},now,now);
    const p=b.at(now);if(previous!==null&&now>=800&&now<=1400)steps.push(p.x-previous);previous=p.x;
  }
  assert.ok(Math.min(...steps)>.17);assert.ok(Math.max(...steps)<.19);
});

test('乱序、重复帧不污染时间轴，时间和序号uint32环回可继续播放',()=>{
  const b=new MotionBuffer();b.push({...pose,sequence:0xfffffffe},1000,0xffffff9b);
  assert.equal(b.push({...pose,x:1.8,sequence:0xffffffff},1100,0xffffffff),true);
  assert.equal(b.push({...pose,x:999,sequence:0xfffffffe},1200,99),false);
  assert.equal(b.push({...pose,x:3.6,sequence:0},1200,99),true);
  assert.equal(b.push({...pose,x:999,sequence:1},1201,98),false);
  assert.equal(b.at(1300).flags,1);assert.ok(b.at(1400).x>3);
  assert.ok(b.samples[2].time>b.samples[1].time);
});

test('同一Room tick的最新帧合并，快照初始位置不吞第一条同序号位置',()=>{
  const b=new MotionBuffer();b.seed({...pose,x:50});assert.equal(b.at(0).x,50);
  assert.equal(b.push({...pose,x:51},500,100),true);
  assert.equal(b.push({...pose,x:52,sequence:1},500,100),true);
  assert.equal(b.samples.length,1);assert.equal(b.at(500).x,52);
});

test('重连快照通知清空旧移动时间轴，普通玩家资料更新不清空',()=>{
  const c=new GameConnection(),events=[];c.observe(type=>events.push(type));
  c.receive(OP.SNAPSHOT,{self:'a',players:[]});assert.deepEqual(events,['motion-reset','players']);
  events.length=0;c.receive(OP.EVENT,{kind:'players',players:[]});assert.deepEqual(events,['players','event']);
});
  assert.equal(events.some(([type,kind])=>type==='event'&&kind==='position'),false);
  assert.equal(c.players[0].position.x,-150);
});

test('历史缓存有界、转向走最短弧，移动发送维持10Hz上限',()=>{
  const b=new MotionBuffer();for(let i=0;i<100;i++)b.push({...pose,sequence:i,yaw:i%2?-Math.PI+.1:Math.PI-.1},i*100,i*100);
  assert.equal(b.samples.length,12);assert.equal(b.offsets.length,32);assert.ok(Math.abs(b.at(9900).yaw)>3);
  const sender=new MotionSender();let sent=0;for(let t=0;t<1000;t++){const p=sender.sample({...pose,x:t*.018},t);if(p){sender.sent(p,t);sent++;}}
  assert.equal(sent,10);
});

test('实际RemoteAvatars每帧应用服务端插值位置，重连低序号能重新接管角色',()=>{
  const scene=new THREE.Scene(),remote=new RemoteAvatars(scene,new THREE.Group(),[]),camera=new THREE.PerspectiveCamera();
  camera.position.set(0,5,10);camera.lookAt(0,0,-10);camera.updateMatrixWorld();
  const player={id:'other',slot:1,connected:true,position:{...pose,z:-10,sequence:100}};
  remote.reconcile([player],'self');const actor=remote.actors.get('other');
  remote.positions([{...pose,z:-10,slot:1,x:1.8,sequence:100}],500,0);
  remote.positions([{...pose,z:-10,slot:1,x:3.6,sequence:101}],600,100);
  remote.update(1/60,700,camera);const start=actor.root.position.x;
  remote.update(1/60,700+1000/60,camera);assert.ok(actor.root.position.x>start);
  remote.resetMotion();remote.reconcile([{...player,position:{...pose,z:-10,x:50}}],'self');
  remote.positions([{...pose,z:-10,slot:1,x:50,sequence:0}],1000,0);
  remote.update(1/60,1000,camera);assert.equal(actor.root.position.x,50);
});
