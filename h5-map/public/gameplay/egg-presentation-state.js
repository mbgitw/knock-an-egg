import {PRESENTATION as P} from './egg-presentation/config.js';
import {ImprovedNoise} from '../vendor/ImprovedNoise.js';

export const clamp=(n,a=0,b=1)=>Math.max(a,Math.min(b,n));
export const quadOut=t=>1-(1-clamp(t))**2;
export const expoOut=t=>t>=1?1:1-2**(-10*clamp(t));
export const backOut=t=>1+2.70158*(t-1)**3+1.70158*(t-1)**2;
export function bounceOut(t){if(t<1/2.75)return 7.5625*t*t;if(t<2/2.75)return 7.5625*(t-1.5/2.75)**2+.75;if(t<2.5/2.75)return 7.5625*(t-2.25/2.75)**2+.9375;return 7.5625*(t-2.625/2.75)**2+.984375;}
const elasticOut=t=>t<=0?0:t>=1?1:2**(-10*t)*Math.sin((t*10-.75)*(2*Math.PI/3))+1;
const noise=new ImprovedNoise();
export const eggRarities=['Common','Uncommon','Rare','Epic','Legendary','Mythic','Divine','Cosmic','Secret','Celestial'];
export const labelScale=(footprint,growth=1)=>Math.min(9,clamp(footprint/2.5,.75,2)*Math.max(.001,growth)**.75);
export const hatchRevealTime=P.hatch.SpinIntroDuration+P.hatch.Grow.Duration;

export function hatchPose(age,hatchMult=1,seed=0){
  const H=P.hatch,G=H.Grow,maximum=Math.max(hatchMult,G.MinVisualMult);
  if(age<H.SpinIntroDuration){const u=clamp(age/H.SpinIntroDuration),v=u<.4?u/ .7:((u-.4)-(u-.4)**2/1.2)/.7+4/7;
    return {stage:'spin',scale:1,yaw:Math.PI*6*v,rx:0,rz:0,opacity:1,white:quadOut(u),progress:u};}
  if(age<hatchRevealTime){const t=age-H.SpinIntroDuration,u=clamp(t/G.Duration),ramp=quadOut(t/Math.min(H.ShakePreDuration,G.Duration*.5));
    const rate=t*H.ShakeTiltRate*(1+G.RattleSpeedPerMult*(Math.max(1,hatchMult)-1))*(1+u),amplitude=H.ShakeTiltMagnitude*Math.PI/180*2*ramp;
    const jitter=Math.min(G.JitterMax,G.JitterPerMult*(Math.max(1,hatchMult)-1));
    return {stage:'grow',scale:maximum**u,yaw:0,rx:noise.noise(rate,seed,0)*amplitude,rz:noise.noise(seed,rate,0)*amplitude,dx:noise.noise(u*G.ShakeRate,-seed,seed)*jitter,dz:noise.noise(-u*G.ShakeRate,-seed,seed)*jitter,opacity:1,white:1,progress:u};}
  const u=clamp((age-hatchRevealTime)/H.ExplodeDuration),e=expoOut(u);
  return {stage:u<1?'explode':'opened',scale:maximum*(1+(H.ExplodeUpscaleSize-1)*e),yaw:0,rx:0,rz:0,opacity:1-e,white:1,progress:u};
}

export function luckAt(spec,hatchMult,progress){
  const mult=Math.max(1,hatchMult),luck=1+(spec.kind-1)*.1+(spec.kind===3?.05:0);
  const end=(1+(luck-1)*P.hype.LuckSpread)*(spec.sizeMult*mult)**P.hype.SizeExponent*P.hype.Zones[spec.zone-1].LuckMult;
  const sweep=Math.max(P.hype.CounterMinSweep,mult**P.hype.SizeExponent);return (spec.luckMult||1)*end/sweep*sweep**clamp(progress);
}

export function petPose(age,lift){
  if(age<.6){const u=clamp(age/.6),s=backOut(u);return {scale:Math.max(.01,s),y:lift*s,yaw:Math.PI*6*(1-(1-u)**5)};}
  if(age<1.15)return {scale:1,y:lift*(1-bounceOut(clamp((age-.6)/.55))),yaw:0};
  return {scale:1,y:0,yaw:0};
}

export class EggPresentationState {
  constructor(spec,now=0,random=Math.random){this.spec=spec;this.random=random;this.seed=random()*100;this.hitAt=-Infinity;this.hatchAt=null;this.hpAt=-Infinity;this.healthShownAt=-Infinity;this.hpFrom=spec.health;this.hpTo=spec.health;this.nextIdle=now+this.delay();this.idle=null;this.oneShot=false;this.hatchMult=1;}
  delay(){return P.config.Idle.MinDelay+this.random()*(P.config.Idle.MaxDelay-P.config.Idle.MinDelay);}
  showHealth(now){if(this.hatchAt===null)this.healthShownAt=now;}
  hit(now,from,to,{showHealth=true}={}){if(this.hatchAt!==null)return;if(showHealth)this.showHealth(now);const displayed=this.health(now).value;this.hitAt=this.hpAt=now;this.hpFrom=displayed;this.hpTo=to;this.idle=null;this.nextIdle=now+this.delay();
    if(to<=0){this.hatchAt=now;this.oneShot=from>=this.spec.health;this.hpFrom=from;}}
  // Retarget the health bar without another shake; used when an authoritative hp
  // replaces a locally predicted one.
  settle(now,to){if(this.hatchAt!==null||this.hpTo===to)return;this.hpFrom=this.health(now).value;this.hpAt=now;this.hpTo=to;}
  health(now){const age=now-this.healthShownAt,one=this.oneShot&&this.hatchAt!==null;const duration=one?.55:.15;
    const value=this.hpFrom+(this.hpTo-this.hpFrom)*quadOut((now-this.hpAt)/duration),until=one?.75:6;
    const canShow=Number.isFinite(this.healthShownAt)&&(this.hatchAt===null||one)&&age<until+.18;
    const q=clamp((age-until)/.18);const shrink=1-(2.70158*q**3-1.70158*q*q);
    return {value:Math.max(0,value),ratio:clamp(value/this.spec.health),visible:canShow,scale:age<until?1:Math.max(0,shrink)};
  }
  sample(now,{spawnAge=Infinity,awake=true}={}){
    if(this.hatchAt!==null)return hatchPose(now-this.hatchAt,this.hatchMult,this.seed);
    const result={stage:'idle',scale:1,rx:0,rz:0,yaw:0,hop:0,opacity:1,white:0,nestScale:1};
    if(spawnAge<P.config.SpawnRise.Duration){result.stage='spawn';result.scale=result.nestScale=Math.max(.01,quadOut(spawnAge/P.config.SpawnRise.Duration));return result;}
    const hitAge=now-this.hitAt,H=P.config.Hit;
    if(hitAge<H.ShrinkTime+H.RecoverTime){result.stage='hit';result.scale=hitAge<H.ShrinkTime?1+(H.ShrinkScale-1)*quadOut(hitAge/H.ShrinkTime):H.ShrinkScale+(1-H.ShrinkScale)*elasticOut((hitAge-H.ShrinkTime)/H.RecoverTime);result.white=1-quadOut(hitAge/H.FlashTime);return result;}
    const I=P.config.Idle;
    if(!this.idle&&now>=this.nextIdle){
      if(awake&&spawnAge>.8&&hitAge>H.ShrinkTime+H.RecoverTime+.1)this.idle={start:now,hop:this.random()<I.HopChance,angle:this.random()*Math.PI*2};
      else this.nextIdle=now+this.delay();
    }
    if(this.idle){const a=now-this.idle.start,d=this.idle.hop?I.HopTime:I.WiggleTime,u=a/d;
      if(u>=1){this.idle=null;this.nextIdle=now+this.delay();}
      else if(this.idle.hop){result.stage='hop';result.hop=Math.sin(Math.PI*u)*this.spec.bodyHeight*I.HopHeightFrac;}
      else{result.stage='wiggle';const angle=I.WiggleAngle*Math.PI/180*Math.sin(2*Math.PI*I.WiggleRate*a)*(1-u);result.rx=Math.cos(this.idle.angle)*angle;result.rz=Math.sin(this.idle.angle)*angle;}
    }return result;
  }
}

export class EggCullQuality {
  constructor(){this.tier=0;this.smooth=1/60;this.time=0;this.low=null;this.high=null;this.recovery=20;this.recovered=-Infinity;}
  update(dt){const A=P.config.AdaptiveCull;this.time+=dt;this.smooth+=(Math.min(dt,A.MaxFrameTime)-this.smooth)*(1-Math.exp(-dt/A.SmoothTime));if(this.time<A.WarmupSeconds)return;
    const fps=1/this.smooth;
    if(fps<A.LowFps){this.high=null;this.low??=this.time;if(this.time-this.low>=A.DowngradeHold&&this.tier<3){this.tier++;this.low=null;if(this.time-this.recovered<A.RelapseWindow)this.recovery=Math.min(A.RecoverHoldMax,this.recovery*2);}}
    else if(fps>A.HighFps){this.low=null;this.high??=this.time;if(this.time-this.high>=this.recovery&&this.tier>0){this.tier--;this.high=null;this.recovered=this.time;}}
    else this.low=this.high=null;if(this.time-this.recovered>A.RelapseWindow)this.recovery=A.RecoverHold;
  }
  distance(base,home){return base*(home?1:P.config.AdaptiveCull.Tiers[this.tier].DistanceScale);}
}
