import {insideZone} from './rules/gameplay/zone-entry-state.ts';
import {pickupRadius} from './rules/gameplay/animal-carry-state.ts';
import zones from './data/zones.ts';
import type {WorldState,Player} from './world.ts';
import {animalVisualScale} from './rules/gameplay/animal-attributes.ts';
import {restoreIndex} from './rules/gameplay/index-state.ts';
export type Animal={id:string;pet:any;home:{x:number;y:number;z:number};position:{x:number;y:number;z:number};scale:number;remaining:number;readyAt:number;countdownAt:number;carrier:string|null};
export const safe=(p:Player)=>insideZone(zones.safe,p.position);
export function addAnimal(state:WorldState,egg:any){
  const pet=egg.pet;if(!pet||state.animals[pet.id])return false;
  const home={x:egg.spec.position[0],y:egg.spec.floorY,z:egg.spec.position[2]};
  // Shared presentation clock: 1s spin + 4s growth + 1.15s landing + 2.5s look.
  state.animals[pet.id]={id:pet.id,pet,home,position:{...home},scale:animalVisualScale(pet),remaining:45000,readyAt:state.elapsed+6150,countdownAt:state.elapsed+8650,carrier:null};
  return true;
}
function eligible(state:WorldState,p:Player,a:Animal|undefined){return !!a&&p.connected&&p.loaded&&p.active&&!p.training&&!p.carrying&&!(p as any).paymentBusy&&!p.account.commerce.delivery&&!((p as any).stunnedUntil>state.elapsed)&&state.elapsed>=a.readyAt&&!a.carrier&&a.remaining>0&&Math.hypot(p.position.x-a.position.x,p.position.y-a.position.y,p.position.z-a.position.z)<pickupRadius(a.scale);}
// Reliable down/up and low-rate heartbeats, never a client-supplied hold duration.
export function holdAnimal(state:WorldState,p:Player,id:unknown){
  if(id===null){p.hold=null;return true;}
  if(typeof id!=='string'||id.length>400||!eligible(state,p,state.animals[id])){p.hold=null;return false;}
  if(p.hold?.id===id)p.hold.seenAt=state.elapsed;
  else p.hold={id,startedAt:state.elapsed,seenAt:state.elapsed};
  return true;
}
export function dropAnimal(state:WorldState,p:Player,returnHome=false,atHit=false){
  p.hold=null;const a=p.carrying&&state.animals[p.carrying];p.carrying=null;if(!a||a.carrier!==p.id)return false;
  const z=zones.zones.find(z=>z.index===a.pet.zone);
  a.position=returnHome||!atHit&&!!z&&insideZone(z.hitbox,p.position)?{...a.home}:{x:p.position.x,y:a.home.y,z:p.position.z};a.carrier=null;state.revision++;return true;
}
export function advanceAnimals(state:WorldState,dt:number){
  const banked:Player[]=[];let changed=false;
  for(const a of Object.values(state.animals))if(!a.carrier&&state.elapsed>=a.readyAt){
    a.remaining=Math.max(0,a.remaining-Math.min(dt,Math.max(0,state.elapsed-(a.countdownAt??a.readyAt))));
    if(!a.remaining){delete state.animals[a.id];changed=true;}
  }
  for(const p of Object.values(state.players)){
    const h=p.hold;
    if(h){const a=state.animals[h.id];
      if(state.elapsed-h.seenAt>600||!eligible(state,p,a))p.hold=null;
      else if(state.elapsed-h.startedAt>=1400){a.carrier=p.id;p.carrying=a.id;p.hold=null;changed=true;}
    }
    const a=p.carrying&&state.animals[p.carrying];
    if(a&&p.connected&&p.active&&safe(p)&&p.account.pickaxes.pets.length+p.account.plot.pets.length+p.account.mergeEggs.length+p.account.growingEggs.length<250){
      // World instance is removed atomically with inventory insertion in one checkpoint.
      if(!p.account.pickaxes.pets.some((pet:any)=>pet.id===a.id))p.account.pickaxes.pets.push({...a.pet});
      p.account.index=restoreIndex(p.account.index,p.account.pickaxes.pets);
      p.carrying=null;delete state.animals[a.id];p.dirty=true;banked.push(p);changed=true;
    }
  }
  if(changed)state.revision++;
  return {changed,banked};
}
export function visibleAnimals(state:WorldState,p:Player){return Object.values(state.animals).filter(a=>a.carrier===p.id||a.pet.zone===p.zone||Math.hypot(a.position.x-p.position.x,a.position.z-p.position.z)<200);}
