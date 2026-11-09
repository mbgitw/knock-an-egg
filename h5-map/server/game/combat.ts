import {closestBatTarget,batLaunch,BAT_IMMUNITY} from './rules/gameplay/weapon-combat-state.ts';
import {insideZone} from './rules/gameplay/zone-entry-state.ts';
import {plotBox} from './economy.ts';
import {dropAnimal} from './animals.ts';
import weapons from './data/weapons.ts';
import guards from './data/guards.ts';
import type {WorldState,Player} from './world.ts';
export function batStrike(state:WorldState,p:Player){
  const item=weapons.find(w=>w.tier===p.account.weapons.equipped),now=state.elapsed/1000;
  if(!item||!p.loaded||!p.active||p.carrying||p.training||state.elapsed-((p as any).lastBat??-1000)<700)return null;
  const snapshot=(v:Player)=>({id:v.id,kind:'player',position:v.position,connected:v.connected&&v.active,ragdolled:(v as any).stunnedUntil>state.elapsed,immuneUntil:((v as any).immuneUntil||0)/1000,safe:guards.safeParts.some(b=>insideZone(b,v.position))||insideZone(plotBox(v),v.position)});
  (p as any).lastBat=state.elapsed;
  const hit=closestBatTarget(snapshot(p),Object.values(state.players).filter(v=>v.loaded).map(snapshot),item.range,now);
  if(!hit)return null;
  const target=state.players[hit.id],fling=batLaunch(item.knockback);
  let x=target.position.x-p.position.x,z=target.position.z-p.position.z;
  if(Math.hypot(x,z)<1e-6){x=Math.sin(p.position.yaw);z=Math.cos(p.position.yaw);}
  const length=Math.hypot(x,z);dropAnimal(state,target,false,true);target.training=null;target.trainingElapsed=0;
  Object.assign(target,{stunnedUntil:state.elapsed+fling.duration*1000,immuneUntil:state.elapsed+(fling.duration+BAT_IMMUNITY)*1000,externalSpeed:fling.horizontal});
  return {target,fling,velocity:{x:x/length*fling.horizontal,y:fling.vertical,z:z/length*fling.horizontal}};
}
