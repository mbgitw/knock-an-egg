import {EggSpawnState} from './rules/gameplay/egg-spawn-state.ts';
import {EggLife} from './rules/gameplay/pickaxe-state.ts';
import {EGG_CONFIG as C} from './rules/gameplay/eggs/runtime-config.ts';
import {CONFIG} from './rules/gameplay/config.ts';
import navigation from './data/navigation.ts';
import type {Player} from './world.ts';
import {rollAnimalTraits,rollAnimalWeight} from './rules/gameplay/animal-attributes.ts';
import {TitanicState} from './rules/gameplay/titanic-state.ts';
export type EggSlot={id:string;zone:number;generation:number;egg:any;nextTry:number};
// 使用离线烘焙的地面/净空网格；Room不读取GLB和纹理。
function ground(x:number,z:number){const nx=Math.round((x-navigation.x)/navigation.step),nz=Math.round((z-navigation.z)/navigation.step);return nx<0||nz<0||nx>=navigation.width||nz>=navigation.depth?null:navigation.heights[nz*navigation.width+nx];}
function canPlace(spec:any){
  const r=spec.radius,[x,,z]=spec.position,step=navigation.step;
  if(r>100)return false;
  for(let dx=-r;dx<=r;dx+=step)for(let dz=-r;dz<=r;dz+=step){
    if(dx*dx+dz*dz>r*r)continue;const y=ground(x+dx,z+dz);if(y===null||Math.abs(y-spec.floorY)>.35)return false;
  }return true;
}
export function createEggEngine(random:()=>number,onChange:()=>void){
  return new (EggSpawnState as any)({random,sampleGround:ground,canPlace,onChange});
}
export function restoreEggEngine(slots:EggSlot[],random:()=>number,onChange:()=>void){
  const engine:any=createEggEngine(random,onChange);
  for(const slot of slots){if(slot.egg)slot.egg.life=Object.assign(new EggLife(slot.egg.spec),slot.egg.life);engine.slots.set(slot.id,slot);}return engine;
}
export function withTitanic(engine:any,saved:any,random:()=>number){
  const t:any=new (TitanicState as any)(engine,{random});
  if(saved){t.nextAt=saved.nextAt;t.retryAt=saved.retryAt;t.pending=saved.pending;t.eggs=saved.eggs.map((e:any)=>({...e,life:Object.assign(new EggLife(e.spec),e.life)}));}
  else t.nextAt=1800;
  const zoneEggs=engine.zoneEggs.bind(engine),hit=engine.hit.bind(engine),update=engine.update.bind(engine);
  engine.zoneEggs=(zone:number)=>[...zoneEggs(zone),...t.eggs.filter((e:any)=>e.spec.zone===zone)];
  engine.hit=(e:any,id:string,damage:number,now:number)=>e.spec.titanic?t.hit(e,id,damage,now):hit(e,id,damage,now);
  engine.update=(now:number)=>{update(now);t.update(now);};engine.titanic=t;
  return engine;
}
export const saveTitanic=(engine:any)=>({nextAt:engine.titanic.nextAt,retryAt:engine.titanic.retryAt,pending:engine.titanic.pending,eggs:engine.titanic.eggs});
export function zoneAt(p:{x:number;z:number}){return C.zones.find((z:any)=>Math.abs(p.x-z.box.matrix[3])<=z.box.size[0]/2&&Math.abs(p.z-z.box.matrix[11])<=z.box.size[2]/2)?.zone||1;}
// Display-only coordinates; Room keeps full precision for range checks. 1mm is invisible at egg scale.
const mm=(n:number)=>Math.round(n*1000)/1000;
// Same field names as before so older clients still parse it; empty values are omitted (they read as falsy).
export function compactEggs(engine:any,zone:number){
  return engine.zoneEggs(zone).map((e:any)=>{
    const spec:any={typeId:e.spec.typeId,sizeMult:e.spec.sizeMult,position:e.spec.position.map(mm),yaw:mm(e.spec.yaw),band:e.spec.band,floorY:mm(e.spec.floorY),health:e.spec.health};
    if(e.spec.titanic)spec.titanic=true;
    const egg:any={id:e.spec.id,generation:e.life.generation,hp:e.life.hp,respawnAt:e.life.respawnAt,spawnedAt:e.spawnedAt,spec};
    for(const key of ['brokenAt','endsAt','hatchSizeMult','pet','breaker'])if(e[key]!==undefined&&e[key]!==null)egg[key]=e[key];
    return egg;
  });
}
export function hitEgg(engine:any,p:Player,input:any,time:number,random:()=>number){
  if(!p.connected||!p.active||!p.loaded||p.training||p.carrying||(p as any).stunnedUntil>time*1000||!p.account.pickaxes.equipped)return null;
  if(typeof input.egg!=='string'||!Number.isSafeInteger(input.generation))return null;
  const slot=engine.slots.get(input.egg),egg=slot?.egg||engine.titanic?.eggs.find((e:any)=>e.spec.id===input.egg);if(!egg||!egg.life.alive||egg.life.generation!==input.generation||time-egg.spawnedAt<.7)return null;
  const [x,y,z]=egg.spec.position,position=p.position;
  // 与蛋包围体的近似距离；不接受客户端上报伤害或孵化结果。
  const distance=Math.hypot(Math.max(0,Math.abs(position.x-x)-egg.spec.size[0]/2),Math.max(0,Math.abs(position.y+2.5-y)-egg.spec.size[1]/2),Math.max(0,Math.abs(position.z-z)-egg.spec.size[2]/2));
  if(distance>CONFIG.hitRange+CONFIG.padding)return null;
  const tier=CONFIG.tiers.find((t:any)=>t.tier===p.account.pickaxes.equipped);if(!tier)return null;
  if(!engine.hit(egg,`${p.id}:${input.id}`,tier.damage,time))return null;
  if(!egg.life.alive){
    const pool=C.zones[egg.spec.zone-1].animalPool,weights=pool.map(a=>a.weight**(1/(1+Math.log(egg.spec.titanic?30:1)*.5)));let roll=random()*weights.reduce((sum:number,w:number)=>sum+w,0),selected=pool[0];
    for(let i=0;i<pool.length;i++){selected=pool[i];roll-=weights[i];if(roll<0)break;}
    egg.breaker=p.id;egg.pet={name:selected.name,zone:egg.spec.zone,id:`${egg.spec.id}:${egg.life.generation}`,...rollAnimalTraits(random),...rollAnimalWeight(selected.name,egg.spec.zone,random)};
  }
  return egg;
}
