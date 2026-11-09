import test from 'node:test';
import assert from 'node:assert/strict';
import {MotionBuffer} from '../public/online/motion.js';
const p=(sequence,x)=>({sequence,x,y:0,z:0,yaw:0,flags:1});
test('packet gap never predicts beyond confirmed position or rebounds on arrival',()=>{
 const b=new MotionBuffer();b.push(p(0,0),0);b.push(p(1,10),100);
 assert.equal(b.at(450).x,10);b.push(p(2,12),451);assert.ok(b.at(451).x>=10);assert.equal(b.at(1000).x,12);
});
test('compressed arrivals use Room timestamps, not artificial high speed',()=>{
 const b=new MotionBuffer();b.push(p(0,0),1000,0);b.push(p(1,10),1200,100);b.push(p(2,20),1201,200);
 assert.equal(b.at(1250).x,7);assert.equal(b.at(1300).x,12);assert.equal(b.at(2000).x,20);
});
test('jitter and loss cannot reverse steady forward motion or overshoot a stop',()=>{
 const b=new MotionBuffer();const packets=Array.from({length:40},(_,i)=>({s:i*100,t:i*100+100+([0,100,1,60][i%4]),x:Math.min(i,25)})).filter((_,i)=>i%7!==3).sort((a,b)=>a.t-b.t);
 let previous=0,maxReceived=0,i=0;
 for(let now=0;now<5000;now+=10){while(i<packets.length&&packets[i].t<=now){const q=packets[i++];if(b.push(p(q.s/100,q.x),q.t,q.s))maxReceived=q.x;}
  const value=b.at(now);if(value){assert.ok(value.x>=previous-1e-9);assert.ok(value.x<=maxReceived+1e-9);previous=value.x;}}
 assert.equal(previous,25);assert.ok(b.samples.length<=12);
});
test('Room uint32 timestamp wraps and stale packets remain rejected',()=>{
 const b=new MotionBuffer();b.push(p(1,0),0,0xffffffc0);assert.ok(b.push(p(2,10),100,36));
 assert.equal(b.samples[1].time-b.samples[0].time,100);assert.equal(b.push(p(1,500),110,20),false);assert.equal(b.at(1000).x,10);
});
