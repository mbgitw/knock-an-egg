import * as THREE from 'three';
export const guardMatrix=m=>new THREE.Matrix4().set(...m.slice(0,12),0,0,0,1);
export function insideGuardBox(position,part,margin=0){
  // This check runs for every A* neighbor; avoid allocating/inverting a matrix there.
  const m=part.matrix,x=position.x-m[3],y=position.y-m[7],z=position.z-m[11];
  return Math.abs(m[0]*x+m[4]*y+m[8]*z)<=part.size[0]/2+margin&&Math.abs(m[1]*x+m[5]*y+m[9]*z)<=part.size[1]/2+2&&Math.abs(m[2]*x+m[6]*y+m[10]*z)<=part.size[2]/2+margin;
}
export function guardChaseFactor(power,required,r){
  if(required<=0)return r.OutrunSpeedFactor;
  const ratio=Math.max(power||0,1)/required;
  if(ratio>=1){
    if(ratio<r.EscapeSecureRatio)return r.GateSpeedFactor+(r.OutrunSpeedFactor-r.GateSpeedFactor)*Math.log(ratio)/Math.log(r.EscapeSecureRatio);
    return Math.max(r.MinOutrunSpeedFactor,r.OutrunSpeedFactor*r.OutrunShrinkPerDecade**Math.log10(ratio/r.EscapeSecureRatio));
  }
  let factor=Math.min(r.MaxCatchSpeedFactor,r.CatchSpeedFactor*r.CatchGrowthPerDecade**Math.log10(1/ratio));
  if(ratio>r.CloseCallRatio)factor+=(r.GateSpeedFactor-factor)*Math.log(ratio/r.CloseCallRatio)/Math.log(1/r.CloseCallRatio);
  return factor;
}
export function guardFling(config,r,random=Math.random){
  const distance=(config.FlingDistance||r.FlingDistanceDefault)*(1+random()*r.FlingDistanceVariance);
  const angle=r.FlingLaunchAngle*Math.PI/180,scale=r.FlingTimeScale;
  const speed=Math.sqrt(distance*65/Math.sin(2*angle))*scale*r.FlingSpeedMultiplier;
  const gravityScale=Math.max(r.FlingMinGravityScale,Math.min(4,scale*scale));
  const horizontal=speed*Math.cos(angle),vertical=speed*Math.sin(angle);
  const flight=2*vertical/(65*gravityScale);
  return {horizontal,vertical,gravityScale,duration:Math.max(r.RagdollDuration,flight+r.RagdollSettleTime),wobble:(random()*2-1)*r.FlingAngleWobble*Math.PI/180};
}
export class GuardBrain {
  constructor(definition,rules,nav,{random=Math.random,canMove=()=>true,groundHeight=p=>p.y,lineOfSight=()=>true,onCatch=()=>{}}={}){
    Object.assign(this,{definition,rules,nav,random,canMove,groundHeight,lineOfSight,onCatch});
    this.position=new THREE.Vector3(...definition.home);this.home=this.position.clone();this.yaw=definition.yaw;
    this.state='Idle';this.timer=this.idleTime();this.path=[];this.speed=0;this.repath=0;this.blocked=0;
  }
  idleTime(){return this.rules.RoamIdleMin+this.random()*(this.rules.RoamIdleMax-this.rules.RoamIdleMin);}
  setState(state){this.state=state;this.path=[];this.speed=0;this.repath=0;this.blocked=0;
    this.nav.cancel?.(this);
    this.timer=state==='Idle'?this.idleTime():state==='WindUp'?this.rules.WindUpMin+this.random()*(this.rules.WindUpMax-this.rules.WindUpMin):state==='Catching'?Math.max(.45,Math.min(2,this.definition.actions.Attack?.duration||.45)):0;
  }
  eligible(target){return !!target?.carrying&&Number(target.carrying.zone)===this.definition.zone&&!target.safe&&!target.disabled&&Number.isFinite(target.position?.x);}
  turn(target,dt){const desired=Math.atan2(this.position.x-target.x,this.position.z-target.z);const d=Math.atan2(Math.sin(desired-this.yaw),Math.cos(desired-this.yaw));this.yaw+=d*(1-Math.exp(-this.rules.WindUpTurnSpeed*dt));}
  patrolPoint(){
    if(this.nav.patrolPath){const path=this.nav.patrolPath(this);if(!path?.length)return false;this.path=path;const last=path.at(-1);this.destination=new THREE.Vector3().copy(typeof last==='number'?this.nav.point(last):last);return true;}
    const z=this.definition.zonePart,m=z.matrix;
    for(let i=0;i<12;i++){
      const p=new THREE.Vector3(m[3]+(this.random()-.5)*(z.size[0]-this.rules.RoamMargin*2),this.home.y,m[11]+(this.random()-.5)*(z.size[2]-this.rules.RoamMargin*2));
      const path=this.nav.path(this.position,p,q=>insideGuardBox(q,z,-2));if(path.length>2){this.path=path;this.destination=new THREE.Vector3().copy(path.at(-1));return true;}
    }return false;
  }
  move(target,speed,dt,refresh=false){
    this.repath-=dt;
    if(!this.path.length||(refresh&&this.repath<=0)){
      if(this.nav.route){const route=this.nav.route(this,target);if(route.status==='ready')this.path=route.path;this.repath=route.status==='pending'?0:this.rules.Recovery.PathRetrySeconds;}
      else{this.path=this.nav.path(this.position,target,this.state==='Roaming'?p=>insideGuardBox(p,this.definition.zonePart,-2):undefined);this.repath=this.rules.Recovery.PathRetrySeconds;}
    }
    let budget=speed*dt,moved=0;
    while(budget>0&&this.path.length){
      const point=typeof this.path[0]==='number'?this.nav.point(this.path[0]):this.path[0],dx=point.x-this.position.x,dz=point.z-this.position.z,d=Math.hypot(dx,dz);
      if(d<.08){this.path.shift();continue;}
      const step=Math.min(budget,d,.4),next=this.position.clone();next.x+=dx/d*step;next.z+=dz/d*step;next.y+=(point.y-next.y)*Math.min(1,step/Math.max(d,.01));
      // Navigation heights are samples, not a ramp through raised floor slabs.
      // Resolve each substep onto its actual support before testing clearance.
      const floor=this.groundHeight(next);
      if(!Number.isFinite(floor)||Math.abs(floor-this.position.y)>2.5){this.path=[];this.blocked+=dt;break;}
      next.y=floor;
      if(!this.canMove(next)){this.path=[];this.blocked+=dt;break;}
      this.turn(next,Math.max(dt,.02));this.position.copy(next);budget-=step;moved+=step;
    }
    this.speed=moved/dt;
    if(moved>.05)this.blocked=0;
    // A newly blocked route is retried. Recovery returns along navigation; it
    // never teleports a visible guard through a wall to the carried animal.
    if(this.blocked>this.rules.Recovery.HardStuckSeconds&&this.state!=='Returning')this.setState('Returning');
  }
  catches(target){
    if(!this.lineOfSight(this.position,target.position))return false;
    const pose=new THREE.Matrix4().makeRotationY(this.yaw);pose.setPosition(this.position);
    const local=pose.multiply(guardMatrix(this.definition.hitbox.matrix)).invert();
    const radius=1+this.rules.CatchDistance,size=this.definition.hitbox.size;
    for(const height of [1,2.7,4.4]){
      const p=new THREE.Vector3().copy(target.position);p.y+=height;p.applyMatrix4(local);
      // Large/flying source bodies sit above the R6 walker. Extend the catch
      // volume down to its feet so a grounded carrier remains reachable.
      const bottom=Math.min(-size[1]/2,-this.definition.hitbox.matrix[7]);
      const dx=Math.max(0,Math.abs(p.x)-size[0]/2),dy=Math.max(0,bottom-p.y,p.y-size[1]/2),dz=Math.max(0,Math.abs(p.z)-size[2]/2);
      if(dx*dx+dy*dy+dz*dz<=radius*radius)return true;
    }return false;
  }
  update(dt,target){
    dt=Math.min(.05,Math.max(.001,dt));this.speed=0;this.timer-=dt;
    const eligible=this.eligible(target);
    if(['WindUp','Chasing'].includes(this.state)&&!eligible)this.setState('Returning');
    if(['Idle','Roaming','Returning'].includes(this.state)&&eligible&&Number(target.carrying.zone)===this.definition.zone)this.setState('WindUp');
    if(this.state==='Idle'&&this.timer<=0){if(this.patrolPoint())this.state='Roaming';else this.timer=this.idleTime();}
    if(this.state==='Roaming'){
      if(this.position.distanceTo(this.destination)<this.rules.RoamArriveDistance)this.setState('Idle');
      else this.move(this.destination,Math.max(this.rules.RoamSpeedMin,this.definition.config.GuardSpeed*this.rules.RoamSpeedFraction),dt);
    }else if(this.state==='WindUp'){
      this.turn(target.position,dt);if(this.timer<=0)this.setState('Chasing');
    }else if(this.state==='Chasing'){
      if(this.catches(target)){this.setState('Catching');this.onCatch(this,target);return;}
      const distance=this.position.distanceTo(target.position),flat=this.definition.config.GuardFlatRadius||this.rules.FlatRadius;
      const ramp=Math.min(this.rules.MaxSpeedMultiplier,1+Math.max(0,distance-flat)/flat*this.rules.SpeedRampPerRadius);
      const factor=guardChaseFactor(target.power,target.carrying.requiredPower??this.definition.config.RequiredPower,this.rules);
      const speed=Math.min(this.rules.MaxAbsoluteSpeed,Math.max(this.rules.TractionMinSpeed,this.definition.config.GuardSpeed*factor*ramp*(distance>this.rules.FarBoostRadius?this.rules.FarBoostMultiplier:1)));
      this.move(target.position,speed,dt,true);
      if(this.catches(target)){this.setState('Catching');this.onCatch(this,target);}
    }else if(this.state==='Catching'&&this.timer<=0)this.setState('Returning');
    else if(this.state==='Returning'){
      if(this.position.distanceTo(this.home)<=this.rules.HomeArrivalDistance){this.setState('Idle');}
      else this.move(this.home,this.definition.config.GuardSpeed*this.rules.ReturnHomeSpeedMultiplier,dt);
    }
  }
}
