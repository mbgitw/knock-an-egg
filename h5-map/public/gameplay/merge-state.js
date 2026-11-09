import {owns} from './commerce/state.js';
import {speciesOf} from './pickaxe-state.js';
const multipliers={Common:1,Uncommon:1.15,Rare:1.3,Epic:1.5,Legendary:1.75,Mythic:2,Divine:2.3,Cosmic:2.6,Secret:3,Celestial:3.5,Inferno:4,Void:4.5,Omega:5};
export const mergeWeight=p=>Number.isFinite(p.weightKg)&&p.weightKg>0?p.weightKg:(speciesOf(p.name)?.baseKg||1)*(p.sizeMult||1)**3;
export const growthSeconds=(kg,rarity)=>Math.floor(Math.min(604800,10*(kg>150?(kg/150)**.88:1)*(multipliers[rarity]||1))+.5);
// Deliberately cumulative: the source carries the Diamond count into Gold.
export function variantOdds(pets){let left=1,count=0;const odds={};for(const variant of ['Diamond','Gold']){count+=pets.filter(p=>p.variant===variant).length;odds[variant]=left*Math.min(count/3,1);left-=odds[variant];}return {...odds,Normal:Math.max(0,left)};}
export function rollVariant(pets,random=Math.random){let n=random();for(const [v,p] of Object.entries(variantOdds(pets))){if(n<p)return v==='Normal'?null:v;n-=p;}return null;}
export function restoreMergeEggs(raw,placed=false){
 const ids=new Set();return (Array.isArray(raw)?raw:[]).flatMap(e=>{
  if(!e||!/^merge:[a-z0-9-]+$/i.test(e.id)||ids.has(e.id)||!speciesOf(e.name)||!Number.isFinite(e.weightKg)||e.weightKg<=0||e.weightKg>1e30)return [];
  if(placed&&(!Array.isArray(e.position)||e.position.length!==3||!e.position.every(Number.isFinite)||!Number.isFinite(e.readyAt)))return [];
  ids.add(e.id);return [{id:e.id,name:e.name,zone:speciesOf(e.name).zone,weightKg:e.weightKg,sizeMult:Math.cbrt(e.weightKg/speciesOf(e.name).baseKg),variant:['Gold','Diamond'].includes(e.variant)?e.variant:null,duration:e.paidType==='FallenAngel'?60:growthSeconds(e.weightKg,speciesOf(e.name).rarity),...(e.paidType==='FallenAngel'?{paidType:'FallenAngel'}:{}),...(placed?{position:[...e.position],readyAt:e.readyAt,...(Number.isFinite(e.hatchingAt)?{hatchingAt:e.hatchingAt}:{})}:{})}];
 });
}
export class MergeState{
 constructor(account,{now=()=>Date.now(),random=Math.random,id=()=>`merge:${crypto.randomUUID()}`}={}){Object.assign(this,{account,now,random,id});account.data.mergeEggs??=[];account.data.growingEggs??=[];}
 get candidates(){return [...this.account.data.pickaxes.pets,...this.account.data.plot.pets].sort((a,b)=>Object.keys(multipliers).indexOf(speciesOf(b.name)?.rarity)-Object.keys(multipliers).indexOf(speciesOf(a.name)?.rarity)||mergeWeight(b)-mergeWeight(a)||a.name.localeCompare(b.name));}
 transaction(change){const d=this.account.data,keys=['mergeEggs','growingEggs'],before={pets:d.pickaxes.pets,placed:d.plot.pets,...Object.fromEntries(keys.map(k=>[k,d[k]]))};change(d);try{if(this.account.save()!==false)return true;}catch{}d.pickaxes.pets=before.pets;d.plot.pets=before.placed;for(const k of keys)d[k]=before[k];return false;}
 merge(ids){
  if(!Array.isArray(ids)||ids.length!==3||new Set(ids).size!==3)return null;
  const pets=ids.map(id=>this.candidates.find(p=>p.id===id));if(pets.some(p=>!p)||pets.some(p=>p.name!==pets[0].name))return null;
  const name=pets[0].name,species=speciesOf(name);if(!species)return null;
  const weightKg=pets.reduce((n,p)=>n+mergeWeight(p),0);if(!Number.isFinite(weightKg)||weightKg>1e30)return null;
  const egg={id:this.id(),name,zone:species.zone,weightKg,sizeMult:Math.cbrt(weightKg/species.baseKg),duration:growthSeconds(weightKg,species.rarity),variant:rollVariant(pets,this.random)};
  if([...this.candidates,...this.account.data.mergeEggs,...this.account.data.growingEggs].some(p=>p.id===egg.id))return null;
  return this.transaction(d=>{d.pickaxes.pets=d.pickaxes.pets.filter(p=>!ids.includes(p.id));d.plot.pets=d.plot.pets.filter(p=>!ids.includes(p.id));d.mergeEggs=[...d.mergeEggs,egg];})?egg:null;
 }
 place(id,position){const egg=this.account.data.mergeEggs.find(e=>e.id===id);if(!egg||!Array.isArray(position)||position.length!==3||!position.every(Number.isFinite))return false;
  return this.transaction(d=>{d.mergeEggs=d.mergeEggs.filter(e=>e.id!==id);d.growingEggs=[...d.growingEggs,{...egg,position:[...position],readyAt:this.now()+egg.duration*1000/(owns(d,'DoubleGrowthOwned')?2:1)}];});
 }
 hatch(id){const egg=this.account.data.growingEggs.find(e=>e.id===id);if(!egg||egg.readyAt>this.now()||egg.hatchingAt||this.candidates.length+this.account.data.mergeEggs.length+this.account.data.growingEggs.length>250)return false;
  return this.transaction(d=>{d.growingEggs=d.growingEggs.map(e=>e.id===id?{...e,hatchingAt:this.now()}:e);});
 }
 finish(canFinish=()=>true){const ready=this.account.data.growingEggs.filter(e=>e.hatchingAt&&this.now()>=e.hatchingAt+6200&&canFinish(e.id));if(!ready.length)return [];
  const ids=new Set(ready.map(e=>e.id));return this.transaction(d=>{d.growingEggs=d.growingEggs.filter(e=>!ids.has(e.id));d.pickaxes.pets=[...d.pickaxes.pets,...ready.filter(e=>!this.candidates.some(p=>p.id===e.id)).map(({position,readyAt,duration,hatchingAt,...pet})=>pet)];})?ready:[];
 }
}
