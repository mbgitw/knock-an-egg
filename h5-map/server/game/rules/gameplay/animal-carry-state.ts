// @ts-nocheck
// Generated from public/gameplay/animal-carry-state.js; run node tools/build-online-rules.mjs.
import {insideZone} from './zone-entry-state.ts';

export const PICKUP_HOLD_SECONDS=1.4;
export const ANIMAL_LIFETIME=45;
// v2 distance formula, applied to this game's animal height / reference height (4).
export const pickupRadius=(scale=1)=>10.714285714285714+Math.max(0,scale-1)*1.7857142857142858;
const point=p=>({x:p.x,y:p.y,z:p.z});
const valid=p=>p&&[p.x,p.y,p.z].every(Number.isFinite);

/** Transient world instances. Only bank() may transfer one into the saved inventory. */
export class AnimalCarryState {
  constructor({zones,safe,bank=()=>false}){Object.assign(this,{zones,safe,bank});this.animals=new Map();this.carrying=null;this.hold=null;}
  // Landing opens pickup; the remaining look presentation delays only the lifetime clock.
  add(pet,home,scale=1,lookRemaining=0){
    if(!pet?.id||!valid(home)||!Number.isFinite(scale)||scale<=0||this.animals.has(pet.id))return null;
    const animal={id:pet.id,pet,home:point(home),position:point(home),scale,remaining:ANIMAL_LIFETIME,lookRemaining:Math.max(0,Number(lookRemaining)||0),status:'ground'};
    this.animals.set(animal.id,animal);return animal;
  }
  canPick(animal,position,blocked=false){return !blocked&&!this.carrying&&animal?.status==='ground'&&animal.remaining>0&&valid(position)&&Math.hypot(position.x-animal.position.x,position.y-animal.position.y,position.z-animal.position.z)<pickupRadius(animal.scale);}
  nearest(position,blocked=false){
    let best=null,distance=Infinity;
    for(const a of this.animals.values())if(this.canPick(a,position,blocked)){const d=Math.hypot(position.x-a.position.x,position.y-a.position.y,position.z-a.position.z);if(d<distance){best=a;distance=d;}}
    return best;
  }
  begin(id,position,blocked=false){
    if(this.hold||!this.canPick(this.animals.get(id),position,blocked))return false;
    this.hold={id,elapsed:0};return true;
  }
  cancel(){this.hold=null;}
  advance(dt,position,{blocked=false,held=false,holdDt=dt}={}){
    if(!Number.isFinite(dt)||dt<0)return null;
    for(const a of this.animals.values()){
      const countdownDt=Math.max(0,dt-a.lookRemaining);
      a.lookRemaining=Math.max(0,a.lookRemaining-dt);
      if(a.status==='ground'){a.remaining=Math.max(0,a.remaining-countdownDt);if(a.remaining===0)a.status='despawning';}
    }
    if(!this.hold)return null;
    const a=this.animals.get(this.hold.id);
    if(!held||!this.canPick(a,position,blocked)){this.cancel();return null;}
    this.hold.elapsed+=Math.max(0,Math.min(dt,holdDt));
    if(this.hold.elapsed+1e-9<PICKUP_HOLD_SECONDS)return null;
    // A single transition claims the same instance; no second ground copy.
    this.cancel();a.status='carrying';this.carrying=a;return a;
  }
  drop(position,{returnHome=false,atHit=false}={}){
    const a=this.carrying;if(!a||!valid(position))return null;
    const zone=this.zones.find(z=>z.index===a.pet.zone);
    const home=returnHome||!atHit&&!!zone&&insideZone(zone.hitbox,position);
    a.position=point(home?a.home:position);a.status='ground';this.carrying=null;this.cancel();return a;
  }
  secure(position){
    const a=this.carrying;
    if(!a||!valid(position)||!insideZone(this.safe,position)||!this.bank(a.pet))return null;
    a.status='banked';this.carrying=null;this.cancel();return a;
  }
  remove(id){if(this.carrying?.id===id)return false;if(this.hold?.id===id)this.cancel();return this.animals.delete(id);}
}

function roomRandomRequired():number{throw Error("Room必须注入可恢复随机源");}
function roomTimeRequired():number{throw Error("Room必须注入可信时间");}
