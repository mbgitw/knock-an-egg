// @ts-nocheck
// Generated from public/gameplay/egg-spawn-state.js; run node tools/build-online-rules.mjs.
import {EGG_CONFIG as C} from './eggs/runtime-config.ts';
import {EggLife} from './pickaxe-state.ts';
export const eggCapacity=zone=>C.spawn.MaxPerZone+(zone-1)*C.spawn.MaxPerZoneStep;
const roll=(rng,a,b)=>a+rng()*(b-a);
export function rollEggSize(zone,random=roomRandomRequired,luck=1){
  const cfg={...C.size.Spawn,MaxMult:C.size.ZoneCaps[zone-1]?.SpawnMax??C.size.Spawn.MaxMult};
  const u=Math.max(Number.EPSILON,Math.min(1,random())),large=random()<cfg.BigChance;
  const exponent=cfg.TailExponent||1,q=(1/(cfg.MaxOneIn*cfg.BigChance))**(1/(cfg.MaxMult-1)**exponent);
  const bend=luck>1?1+Math.log(luck)*(cfg.LuckBend||0):1;
  const smallExponent=Math.log(1/(cfg.MinOneIn*(1-cfg.BigChance)))/Math.log(cfg.MinMult);
  const value=large?1+bend*(Math.log(u)/Math.log(q))**(1/exponent):Math.max(cfg.MinMult,u**(1/smallExponent));
  const precision=10**cfg.Decimals;return Math.floor(value*precision+.5)/precision;
}
export function pickEggTemplate(zone,random=roomRandomRequired){
  const available=C.templates.filter(t=>t.zone===zone&&t.available);
  let n=random()*available.reduce((sum,t)=>sum+C.spawn.TierWeights[t.tier-1],0);
  for(const t of available){n-=C.spawn.TierWeights[t.tier-1];if(n<0)return t;}
  return available.at(-1)||null;
}
export function eggSpec(template,sizeMult,x,z,yaw,floorY=0.5,nestHeightRatio=.256){
  const height=(C.spawn.EggBaseHeight+(template.zone-1)*C.spawn.EggHeightPerZone)*sizeMult;
  const body=template.body,unit=height/body.size[1],bodyWidth=Math.max(body.size[0],body.size[2])*unit;
  const nestWidth=bodyWidth*C.spawn.NestWidthScale,nestHeight=nestWidth*nestHeightRatio;
  const reachBelow=Math.max(0,body.matrix[7]-body.size[1]/2-template.bounds.min[1])*unit;
  const bottom=floorY+nestHeight*(1-C.spawn.NestBuryFraction-C.spawn.NestSinkFraction)+reachBelow;
  const rx=Math.max(Math.abs(template.bounds.min[0]-body.matrix[3]),Math.abs(template.bounds.max[0]-body.matrix[3]))*unit;
  const rz=Math.max(Math.abs(template.bounds.min[2]-body.matrix[11]),Math.abs(template.bounds.max[2]-body.matrix[11]))*unit;
  return {zone:template.zone,kind:template.tier,typeId:template.id,name:template.name,sizeMult,tierScale:C.spawn.TierSizeMult[template.tier-1],
    position:[x,bottom+height/2,z],bodyBottom:bottom,bodyHeight:height,reachBelow,yaw,floorY,nestWidth,nestHeight,
    radius:Math.max(Math.hypot(rx,rz),nestWidth/2),size:[body.size[0]*unit,height,body.size[2]*unit],color:body.color,
    health:Math.max(1,Math.floor(C.types[template.name].Health*sizeMult**C.healthExponent+.5))};
}
const finite=p=>Array.isArray(p)&&p.length===3&&p.every(Number.isFinite);
export class EggSpawnState {
  constructor({random=roomRandomRequired,sampleGround=()=>.5,canPlace=()=>true,nestHeightRatio=()=>.256,onSpawn=()=>{},onRemove=()=>{},onChange=()=>{}}={}){
    Object.assign(this,{random,sampleGround,canPlace,nestHeightRatio,onSpawn,onRemove,onChange});this.slots=new Map();this.time=0;this.lastCheck=-Infinity;this.failedPlacements=0;
  }
  get eggs(){return [...this.slots.values()].filter(s=>s.egg).map(s=>s.egg);}
  zoneEggs(zone){return this.eggs.filter(e=>e.spec.zone===zone);}
  legal(spec,others=this.zoneEggs(spec.zone)){
    const zone=C.zones[spec.zone-1],box=zone.box,r=spec.radius,m=C.spawn.EdgeMargin;
    if(Math.abs(spec.position[0]-box.matrix[3])+r>box.size[0]/2-m||Math.abs(spec.position[2]-box.matrix[11])+r>box.size[2]/2-m)return false;
    if(others.some(e=>e.life.alive&&Math.hypot(e.spec.position[0]-spec.position[0],e.spec.position[2]-spec.position[2])<e.spec.radius+r+C.spawn.Gap-.001))return false;
    return this.canPlace(spec);
  }
  place(zone){
    const template=pickEggTemplate(zone,this.random);if(!template)return null;
    const mult=rollEggSize(zone,this.random),box=C.zones[zone-1].box,others=this.zoneEggs(zone),counts=Array(C.spawn.LengthBands).fill(0);
    for(const e of others)if(e.life.alive)counts[e.spec.band||0]++;
    const lowest=Math.min(...counts),bands=counts.map((n,i)=>n===lowest?i:null).filter(n=>n!==null),firstBand=bands[Math.floor(this.random()*bands.length)];
    const extent=eggSpec(template,mult,0,0,0,.5,this.nestHeightRatio(zone)),radius=extent.radius;
    const xmin=box.matrix[3]-box.size[0]/2+C.spawn.EdgeMargin+radius,xmax=box.matrix[3]+box.size[0]/2-C.spawn.EdgeMargin-radius;
    const halfZ=Math.min(box.size[2]*C.spawn.WidthSpreadFraction/2,box.size[2]/2-C.spawn.EdgeMargin)-radius;
    if(xmin>=xmax||halfZ<=0)return null;
    for(let attempt=0;attempt<C.spawn.PlacementAttempts;attempt++){
      const band=attempt<C.spawn.BandBalanceAttempts?firstBand:Math.floor(this.random()*C.spawn.LengthBands),width=(xmax-xmin)/C.spawn.LengthBands;
      const x=roll(this.random,xmin+band*width,xmin+(band+1)*width),z=box.matrix[11]+roll(this.random,-halfZ,halfZ),floor=this.sampleGround(x,z,zone);
      if(!Number.isFinite(floor))continue;
      const spec=eggSpec(template,mult,x,z,roll(this.random,0,Math.PI*2),floor,this.nestHeightRatio(zone));spec.band=band;
      if(this.legal(spec,others))return spec;
    }this.failedPlacements++;return null;
  }
  restoreSpec(raw,zone,alive=true){
    const t=C.templates.find(t=>t.id===raw?.typeId&&t.zone===zone&&t.available);
    if(!t||!finite(raw.position)||!Number.isFinite(raw.sizeMult)||raw.sizeMult<.7||raw.sizeMult>20||!Number.isFinite(raw.yaw))return null;
    const floor=this.sampleGround(raw.position[0],raw.position[2],zone);if(!Number.isFinite(floor))return null;
    const spec=eggSpec(t,raw.sizeMult,raw.position[0],raw.position[2],raw.yaw,floor,this.nestHeightRatio(zone));spec.band=Number.isInteger(raw.band)&&raw.band>=0&&raw.band<C.spawn.LengthBands?raw.band:0;
    return this.legal(spec,alive?undefined:[])?spec:null;
  }
  initialize(saved,now){
    this.time=now;
    for(const z of C.zones){
      if(!z.availableTiers.length)continue;
      for(let i=0;i<z.capacity;i++){
        const id=`zone${z.zone}-egg-${i}`,raw=saved?.version===2?saved.slots?.[id]:null;
        const slot={id,zone:z.zone,generation:Number.isSafeInteger(raw?.generation)&&raw.generation>=0&&raw.generation<1e9?raw.generation:0,egg:null,nextTry:now};this.slots.set(id,slot);
        const spec=this.restoreSpec(raw?.spec,z.zone,raw?.hp!==0);
        if(spec&&Number.isFinite(raw.hp)&&raw.hp>=0&&Number.isFinite(raw.respawnAt)){
          this.install(slot,spec,now);slot.egg.life.hp=Math.min(spec.health,raw.hp);slot.egg.life.respawnAt=Math.min(now+15,raw.respawnAt);
          slot.egg.spawnedAt=Number.isFinite(raw.spawnedAt)?Math.min(now,raw.spawnedAt):now;
          if(!slot.egg.life.alive)slot.egg.brokenAt=Number.isFinite(raw.brokenAt)?Math.min(now,raw.brokenAt):now-C.spawn.BrokenCleanupDelay;
        }else{if(raw)slot.generation++;const placed=this.place(z.zone);if(placed)this.install(slot,placed,now);}
      }
    }
    this.onChange();return this;
  }
  install(slot,spec,now){
    if(slot.egg)this.onRemove(slot.egg);spec.id=slot.id;
    const life=new EggLife(spec);life.generation=slot.generation;
    const egg={spec,life,spawnedAt:now,brokenAt:null};slot.egg=egg;this.onSpawn(egg);return egg;
  }
  hit(egg,swingId,damage,now){
    const slot=this.slots.get(egg.spec.id);if(slot?.egg!==egg||!egg.life.hit(swingId,damage,now))return false;
    if(!egg.life.alive){egg.brokenAt=now;egg.life.respawnAt=now+roll(this.random,...C.spawn.BrokenRespawnDelay);slot.nextTry=egg.life.respawnAt;}
    this.onChange();return true;
  }
  update(now){
    this.time=now;if(now-this.lastCheck<.25)return false;this.lastCheck=now;let changed=false,attempts=0;
    for(const slot of this.slots.values()){
      if(slot.egg?.life.alive)continue;
      const due=slot.egg?.life.respawnAt??slot.nextTry;if(now<due||now<slot.nextTry)continue;
      if(++attempts>8)break;
      const spec=this.place(slot.zone);slot.nextTry=now+1;
      if(spec){if(slot.egg)slot.generation++;this.install(slot,spec,now);changed=true;}
    }
    if(changed)this.onChange();return changed;
  }
  snapshot(){const slots={};for(const slot of this.slots.values())if(slot.egg){const e=slot.egg,s=e.spec;slots[slot.id]={generation:e.life.generation,hp:e.life.hp,respawnAt:e.life.respawnAt,spawnedAt:e.spawnedAt,brokenAt:e.brokenAt,spec:{typeId:s.typeId,sizeMult:s.sizeMult,position:s.position,yaw:s.yaw,band:s.band}};}return {version:2,slots};}
}

function roomRandomRequired():number{throw Error("Room必须注入可恢复随机源");}
function roomTimeRequired():number{throw Error("Room必须注入可信时间");}
