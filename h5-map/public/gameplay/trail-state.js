import {TRAIL_CONFIG} from './trails/config.js';
import {money,cashValue} from './currency.js';

export const TRAILS=TRAIL_CONFIG.tiers;
export const trailById=id=>Number.isInteger(id)?TRAILS.find(t=>t.id===id):undefined;
export function restoreTrails(raw){
  const owned=[...new Set((Array.isArray(raw?.owned)?raw.owned:[]).filter(id=>!!trailById(id)))].sort((a,b)=>a-b);
  return {owned,equipped:owned.includes(raw?.equipped)?raw.equipped:0};
}
export const trailMultiplier=data=>trailById(data?.equipped)?.multiplier||1;

export class TrailProgress {
  constructor(account){this.account=account;account.data.trails=restoreTrails(account.data.trails);}
  get data(){return this.account.data.trails;}
  buy(id){
    const t=trailById(id);
    if(!t||this.data.owned.includes(id)||money(this.account.data.cash)<money(t.price))return false;
    this.account.data.cash=cashValue(money(this.account.data.cash)-money(t.price));
    this.data.owned.push(id);this.data.owned.sort((a,b)=>a-b);this.data.equipped=id;
    this.account.save();return true;
  }
  equip(id){
    if(id!==0&&(!trailById(id)||!this.data.owned.includes(id)))return false;
    this.data.equipped=id;this.account.save();return true;
  }
  toggle(id){return this.equip(this.data.equipped===id?0:id);}
}
