import {newer} from './protocol.js';
// 只保留最近十二帧；暂停/拥塞期间不积压旧位置。
export class MotionSender {
  constructor(){this.last=null;this.lastAt=-Infinity;this.retryAt=0;this.backoff=0;this.sequence=0;this.interval=100;}
  sample(p,now){
    if(now<this.retryAt||now-this.lastAt<this.interval-.001)return null;
    const last=this.last,angle=last?Math.atan2(Math.sin(p.yaw-last.yaw),Math.cos(p.yaw-last.yaw)):Infinity;
    const changed=!last||Math.hypot(p.x-last.x,p.y-last.y,p.z-last.z)>.02||Math.abs(angle)>Math.PI/180||p.flags!==last.flags;
    if(!changed&&now-this.lastAt<1000)return null;
    const elapsed=last?(now-this.lastAt)/1000:0;
    const velocity=(key,v)=>Number.isFinite(p[v])?p[v]:elapsed>0&&elapsed<.3?(p[key]-last[key])/elapsed:0;
    return {...p,sequence:this.sequence,sampleTime:Math.floor(now)>>>0,vx:Math.max(-500,Math.min(500,velocity('x','vx'))),vy:Math.max(-500,Math.min(500,velocity('y','vy'))),vz:Math.max(-500,Math.min(500,velocity('z','vz')))};
  }
  sent(p,now){this.last={...p};this.lastAt=now;this.sequence=(this.sequence+1)>>>0;this.backoff=0;}
  failed(now,code){this.backoff=Math.min(2000,Math.max(code==='ROOM_BANDWIDTH_LIMIT_EXCEEDED'?1000:200,this.backoff*2));this.retryAt=now+this.backoff;}
}
export class MotionBuffer {
  constructor(){this.samples=[];this.delay=180;this.lastSequence=null;this.sourceRaw=null;this.sourceTime=0;this.offset=null;this.targetOffset=null;this.renderAt=null;this.lastNow=null;}
  seed(p,now=performance.now()){this.initial={...p};this.samples=[{...p,time:now}];}
  push(p,now,roomTime){
    if(Number.isInteger(p.sampleTime)){this.track??=new MotionTrack();const accepted=this.track.push(p,now);this.samples=this.track.samples;return accepted;}
    if(this.track)return false;
    if(!newer(p.sequence,this.lastSequence)||!Number.isFinite(now))return false;
    let time=now;
    if(Number.isInteger(roomTime)&&roomTime>=0&&roomTime<=0xffffffff){
      if(this.sourceRaw===null){
        // The profile seed uses local time; do not mix it with Room timestamps.
        this.samples=[];this.sourceTime=roomTime;this.offset=this.targetOffset=now-roomTime;this.renderAt=null;this.lastNow=null;
      }else{
        const delta=(roomTime-this.sourceRaw)>>>0;
        if(delta===0||delta>=0x80000000)return false;
        this.sourceTime+=delta;
      }
      this.sourceRaw=roomTime;time=this.sourceTime;this.targetOffset=Math.min(this.targetOffset,now-time);
    }else if(this.sourceRaw!==null)return false;
    this.lastSequence=p.sequence;
    this.samples.push({...p,time});if(this.samples.length>12)this.samples.shift();return true;
  }
  at(now){
    if(this.track)return this.track.at(now);
    const a=this.samples;if(!a.length)return this.initial?{...this.initial}:null;
    const dt=this.lastNow===null?0:Math.max(0,now-this.lastNow);this.lastNow=now;
    // Adjust the clock gradually, never rewind playback when packets arrive.
    if(this.offset!==null)this.offset+=Math.max(-dt*.1,Math.min(dt*.1,this.targetOffset-this.offset));
    const time=Math.max(this.renderAt??-Infinity,now-(this.offset??0)-this.delay);this.renderAt=time;
    if(time<=a[0].time)return {...a[0]};
    for(let i=1;i<a.length;i++)if(time<=a[i].time)return interpolate(a[i-1],a[i],(time-a[i-1].time)/Math.max(1,a[i].time-a[i-1].time));
    // Hold confirmed position instead of overshooting and rebounding on resume.
    return {...a.at(-1)};
  }
}
function interpolate(a,b,t){const yaw=a.yaw+Math.atan2(Math.sin(b.yaw-a.yaw),Math.cos(b.yaw-a.yaw))*t;return {...b,x:a.x+(b.x-a.x)*t,y:a.y+(b.y-a.y)*t,z:a.z+(b.z-a.z)*t,yaw};}

// 增强通道使用发送端采样时间，双向网络延迟只影响缓冲，不改变轨迹的速度。
export class MotionTrack {
  constructor(){this.samples=[];this.offsets=[];this.intervals=[];this.epoch=null;this.sequence=null;this.raw=null;this.time=0;this.cursor=null;this.lastNow=null;this.stats={received:0,stale:0,underruns:0,resets:0};}
  push(p,now){
    if(!Number.isFinite(now))return false;
    if(this.epoch!==null&&p.epoch!==this.epoch){const change=(p.epoch-this.epoch)&65535;if(!change||change>=32768){this.stats.stale++;return false;}this.reset();}
    if(!newer(p.sequence,this.sequence)){this.stats.stale++;return false;}
    const delta=this.raw===null?0:(p.sampleTime-this.raw)>>>0;
    if(this.raw!==null&&(!delta||delta>=0x80000000)){this.stats.stale++;return false;}
    if(delta>2000)this.reset();
    this.time=this.raw===null?p.sampleTime:this.time+delta;this.raw=p.sampleTime;this.sequence=p.sequence;this.epoch=p.epoch;
    if(delta>0&&delta<=250){this.intervals.push(delta);if(this.intervals.length>32)this.intervals.shift();}
    this.offsets.push(now-this.time);if(this.offsets.length>32)this.offsets.shift();
    const sorted=[...this.offsets].sort((a,b)=>a-b);this.offset=sorted[0];
    const cadence=[...this.intervals].sort((a,b)=>a-b),interval=cadence.length?cadence[Math.floor(cadence.length/2)]:50;
    this.delay=Math.min(300,Math.max(100,interval*2+sorted[Math.floor((sorted.length-1)*.95)]-sorted[0]));
    const last=this.samples.at(-1);
    // 静止心跳只有1Hz，起跑不能把第一小步摊到整个静止间隔里。
    if(last&&delta>250&&!(last.flags&3)&&(p.flags&3))this.samples.push({...last,time:this.time-Math.min(100,interval),vx:0,vy:0,vz:0});
    this.samples.push({...p,time:this.time});if(this.samples.length>24)this.samples.shift();
    if(this.samples.length>24)this.samples.shift();
    if(this.cursor===null){this.cursor=this.time-this.delay;this.lastNow=now;}
    this.stats.received++;return true;
  }
  reset(){this.samples=[];this.offsets=[];this.intervals=[];this.sequence=null;this.raw=null;this.cursor=null;this.lastNow=null;this.stats.resets++;}
  at(now){
    const a=this.samples;if(!a.length)return null;
    const dt=Math.max(0,now-this.lastNow),target=now-this.offset-this.delay;this.lastNow=now;
    this.cursor+=dt+Math.max(-dt*.1,Math.min(dt*.1,target-(this.cursor+dt)));
    // 缺包时播放点停在最后确认时刻，恢复后接着播放；不预测过冲，也不积压无限历史。
    this.cursor=Math.min(a.at(-1).time,this.cursor);
    if(this.cursor<a[0].time){if(a.length<24)return {...a[0]};this.cursor=a[0].time;}
    if(this.cursor>=a.at(-1).time){if(!this.starved)this.stats.underruns++;this.starved=true;const last=a.at(-1);return {...last,flags:target-last.time>150?last.flags&~3:last.flags};}
    this.starved=false;
    for(let i=1;i<a.length;i++)if(this.cursor<=a[i].time)return smoothBetween(a[i-1],a[i],(this.cursor-a[i-1].time)/(a[i].time-a[i-1].time));
    return {...a[0]};
  }
}
function smoothBetween(a,b,t){
  const p=interpolate(a,b,t);p.flags=t<1?a.flags:b.flags;
  if(!(a.flags&8)||!(b.flags&8))return p;
  const duration=(b.time-a.time)/1000;
  for(const [axis,velocity] of [['x','vx'],['y','vy'],['z','vz']]){
    const d=b[axis]-a[axis];if(Math.abs(d)<1e-6){p[axis]=b[axis];continue;}
    // 单调Hermite限制切线，急停/碰撞/转向不越过两个已确认位置。
    let u=Math.max(0,a[velocity]*duration/d),v=Math.max(0,b[velocity]*duration/d);const length=Math.hypot(u,v);if(length>3){u*=3/length;v*=3/length;}
    p[axis]=a[axis]+d*((-2*t+3)*t*t+u*(t*t*t-2*t*t+t)+v*(t*t*t-t*t));
    p[velocity]=d*(-6*t*t+6*t+u*(3*t*t-4*t+1)+v*(3*t*t-2*t))/duration;
  }
  return p;
}
