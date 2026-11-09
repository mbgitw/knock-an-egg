import {PAID_SPECIES} from './commerce/paid-species.js';
import {animalSellValue,rollAnimalTraits,rollAnimalWeight} from './animal-attributes.js';
import {CONFIG} from './config.js';
import {restoreIndex} from './index-state.js';
import {money, cashValue} from './currency.js';
import {EGG_CONFIG} from './eggs/runtime-config.js';
export const ALL_SPECIES=EGG_CONFIG.zones.flatMap(z=>z.animalPool.map(p=>({...p,zone:z.zone})));
export const speciesOf=name=>ALL_SPECIES.find(p=>p.name===name)||PAID_SPECIES.find(p=>p.name===name);

export function restorePickaxes(raw) {
  const owned = [...new Set([1, ...(Array.isArray(raw?.owned) ? raw.owned : [])])]
    .filter(t => Number.isInteger(t) && t >= 1 && t <= 20).sort((a,b) => a-b);
  const pets = [], ids = new Set();
  for (const pet of Array.isArray(raw?.pets) ? raw.pets.slice(0, 1000) : []) {
    const match=typeof pet?.id==='string'&&/^(?:online:[a-f0-9]{1,256}:)?zone(10|[1-9])-egg-\d+:\d+$/.exec(pet.id),species=speciesOf(pet?.name);
    if ((!match && !/^merge:[a-z0-9-]+$/i.test(pet.id||'')) || ids.has(pet.id) || !species || (match && species.zone!==Number(match[1]))) continue;
    pets.push({id:pet.id, name:pet.name,zone:species.zone,...(['Male','Female'].includes(pet.gender)?{gender:pet.gender}:{}),...(Number.isFinite(pet.weightKg)&&pet.weightKg>0?{weightKg:pet.weightKg}:{}),...(Number.isFinite(pet.sizeMult)&&pet.sizeMult>0?{sizeMult:pet.sizeMult}:{}),...(["Normal","Gold","Diamond"].includes(pet.variant)?{variant:pet.variant}:{})}); ids.add(pet.id);
  }
  const eggs={};
  for(const [id,e] of Object.entries(raw?.eggs||{}))if(/^zone1-egg-\d+$/.test(id)&&Number.isFinite(e?.hp)&&e.hp>=0&&Number.isFinite(e?.respawnAt)&&Number.isSafeInteger(e?.generation)&&e.generation>=0)eggs[id]={hp:e.hp,respawnAt:e.respawnAt,generation:e.generation};
  return {owned, equipped: raw?.equipped === null ? null : owned.includes(raw?.equipped) ? raw.equipped : 1,
    selected: owned.includes(raw?.selected) ? raw.selected : 1, pets, eggs, hotbar:Array.isArray(raw?.hotbar)?raw.hotbar.slice(0,8).map(id=>ids.has(id)?id:null):null, titanic:raw?.titanic&&typeof raw.titanic==='object'?raw.titanic:null,
    worldEggs:raw?.worldEggs?.version===2&&raw.worldEggs.slots&&typeof raw.worldEggs.slots==='object'?{version:2,slots:Object.fromEntries(Object.entries(raw.worldEggs.slots).filter(([id])=>/^zone(10|[1-9])-egg-\d+$/.test(id)).slice(0,230))}:null,
    claims: Array.isArray(raw?.claims) ? raw.claims.filter(x=>typeof x==='string').slice(-2000) : [],
    broken: Number.isSafeInteger(raw?.broken) && raw.broken >= 0 ? raw.broken : 0};
}

// Uses the same persisted account as speed/treadmills. Each transaction saves
// both cash and ownership in one snapshot, never separate wallet/inventory writes.
export class PickaxeProgress {
  constructor(account) { this.account = account; this.pendingPets=new Map(); account.data.pickaxes = restorePickaxes(account.data.pickaxes); }
  get data() { return this.account.data.pickaxes; }
  buy(tier) {
    const item = CONFIG.tiers.find(x=>x.tier===tier);
    if (!item || this.data.owned.includes(tier)) return false;
    const balance = money(this.account.data.cash), cost = money(item.price);
    if (balance < cost) return false;
    this.account.data.cash = cashValue(balance-cost);
    this.data.owned.push(tier); this.data.owned.sort((a,b)=>a-b);
    this.data.selected = this.data.equipped = tier; this.account.save(); return true;
  }
  equip(tier) {
    if (tier !== null && !this.data.owned.includes(tier)) return false;
    this.data.equipped = tier; if(tier!==null)this.data.selected=tier;
    this.account.save(); return true;
  }
  hatch(id, random = Math.random, zone=Number(/^zone(\d+)-/.exec(id)?.[1]||1),options={}) {
    if (this.data.claims.includes(id)) return null;
    if(!/^zone(10|[1-9])-egg-\d+:\d+$/.test(id)||zone!==Number(/^zone(\d+)-/.exec(id)[1]))return null;
    const pool=ALL_SPECIES.filter(p=>p.zone===zone);if(!pool.length)return null;
    // Missing original server picker: temper pool weights for the event only.
    // A monotonic bias raises rare-species odds without manufacturing a guarantee.
    const luck=Math.min(40,Math.max(1,Number(options.luck)||1));
    const weights=pool.map(p=>p.weight**(1/(1+Math.log(luck)*.5)));
    const total=weights.reduce((s,w)=>s+w,0);
    let n=Math.min(.999999999,Math.max(0,random()))*total, selected=pool[0];
    for (let i=0;i<pool.length;i++) {selected=pool[i];n-=weights[i];if(n<0)break;}
    const pet=Object.freeze({id,name:selected.name,zone,...rollAnimalTraits(random),...rollAnimalWeight(selected.name,zone,random)});this.pendingPets.set(id,pet);this.data.broken++;this.data.claims.push(id);this.data.claims=this.data.claims.slice(-2000);
    this.account.save();return pet;
  }
  bank(pet){
    if(!pet||this.pendingPets.get(pet.id)!==pet||this.data.pets.length+(this.account.data.plot?.pets?.length||0)+(this.account.data.mergeEggs?.length||0)+(this.account.data.growingEggs?.length||0)>=250||this.data.pets.some(p=>p.id===pet.id))return false;
    const index=this.account.data.index;
    this.data.pets.push({...pet});
    this.account.data.index=restoreIndex(index,this.data.pets);
    if(this.account.save()===false){this.data.pets=this.data.pets.filter(p=>p.id!==pet.id);this.account.data.index=index;return false;}
    this.pendingPets.delete(pet.id);return true;
  }
  abandon(id){this.pendingPets.delete(id);}
  sell(id) { return this.sellMany([id]).count>0; }
  sellMany(ids) {
    const selected=new Set(Array.isArray(ids)?ids:[]);
    if(!selected.size||selected.size>200)return {count:0,total:0n};
    const pets=this.data.pets.filter(p=>selected.has(p.id)&&speciesOf(p.name));
    if(!pets.length)return {count:0,total:0n};
    const total=pets.reduce((sum,p)=>sum+animalSellValue(p),0n);
    const sold=new Set(pets.map(p=>p.id));
    this.account.data.cash=cashValue(money(this.account.data.cash)+total);
    this.data.pets=this.data.pets.filter(p=>!sold.has(p.id));this.account.save();
    return {count:pets.length,total};
  }
}

export class EggLife {
  constructor(spec) {this.spec=spec;this.hp=spec.health;this.generation=0;this.respawnAt=0;this.lastSwing=null;}
  get alive() {return this.hp>0;}
  hit(swingId,damage,now) {
    if(!this.alive || this.lastSwing===swingId || !Number.isFinite(damage) || damage<=0)return false;
    this.lastSwing=swingId;this.hp=Math.max(0,this.hp-damage);
    if(!this.alive)this.respawnAt=now+CONFIG.respawnSeconds;
    return true;
  }
  update(now) {
    if(!this.alive && now>=this.respawnAt){this.hp=this.spec.health;this.generation++;this.lastSwing=null;return true;}
    return false;
  }
}

export class SwingClock {
  constructor(){this.speed=1;this.time=0;this.started=-Infinity;this.id=0;this.active=false;this.hit=false;}
  start(enabled=true){if(!enabled||this.time-this.started<CONFIG.cooldown/this.speed-1e-9)return false;this.started=this.time;this.active=true;this.hit=false;this.id++;return true;}
  advance(dt){this.time+=Math.max(0,Math.min(.05,dt));if(this.time-this.started>CONFIG.sweepDuration/this.speed)this.active=false;}
  cancel(){this.active=false;}
  get phase(){return Math.max(0,Math.min(1,(this.time-this.started)/(CONFIG.cooldown/this.speed)));}
}
