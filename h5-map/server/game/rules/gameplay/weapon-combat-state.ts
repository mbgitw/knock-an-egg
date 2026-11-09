// @ts-nocheck
// Generated from public/gameplay/weapon-combat-state.js; run node tools/build-online-rules.mjs.
export const BAT_COOLDOWN=.7, BAT_IMMUNITY=1;
const valid=p=>p&&[p.x,p.y,p.z].every(Number.isFinite);
export const canBatAttack=attacker=>attacker?.kind==='player'&&attacker.connected!==false&&valid(attacker.position)&&attacker.alive!==false&&!attacker.safe&&!attacker.ragdolled;
export function eligibleTarget(target,now){
  return target?.kind==='player'&&target.connected!==false&&valid(target.position)&&
    target.alive!==false&&!target.safe&&!target.ragdolled&&!target.batImmune&&
    !(target.immuneUntil>now)&&!target.hellEvent&&target.tutorialDone!==false;
}
export function closestBatTarget(attacker,targets,range,now=0,multiplier=1){
  if(!canBatAttack(attacker)||!Number.isFinite(range)||range<=0)return null;
  if(!Number.isFinite(multiplier)||multiplier<=0)multiplier=1;
  const max=range*Math.min(20,Math.max(.1,multiplier))+2;
  let best=null,distance=Infinity;
  for(const target of targets){
    if(target.id===attacker.id||!eligibleTarget(target,now))continue;
    const d=Math.hypot(target.position.x-attacker.position.x,target.position.y-attacker.position.y,target.position.z-attacker.position.z);
    if(d<=max&&d<distance){best=target;distance=d;}
  }
  return best;
}
export function batLaunch(distance,gravity=65){
  if(!Number.isFinite(distance)||distance<=0||!Number.isFinite(gravity)||gravity<=0)throw Error('Invalid bat launch');
  // The bat server script is absent: use the configured base distance, without
  // guessing how it sampled Variance. ShapeLaunch itself is available verbatim.
  distance=Math.max(5,distance);
  const angle=28*Math.PI/180,sine=Math.sin(2*angle);
  const speed=Math.min(192,Math.sqrt(distance*gravity/sine)*1.35);
  const gravityScale=Math.min(4,Math.max(1,speed*speed*sine/(distance*gravity)));
  const horizontal=speed*Math.cos(angle),vertical=speed*Math.sin(angle);
  const flight=2*vertical/(gravity*gravityScale);
  return {horizontal,vertical,gravityScale,flight,duration:Math.max(1,flight+.5)};
}

function roomRandomRequired():number{throw Error("Room必须注入可恢复随机源");}
function roomTimeRequired():number{throw Error("Room必须注入可信时间");}
