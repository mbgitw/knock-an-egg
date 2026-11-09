// @ts-nocheck
// Generated from public/gameplay/commerce/state.js; run node tools/build-online-rules.mjs.
import {PRODUCTS,productOf} from './catalog.ts';
import {PAID_SPECIES} from './paid-species.ts';
import {money,cashValue} from '../currency.ts';
export function restoreCommerce(raw){
  const orders={...raw?.orders};
  // Migrate only records with a real order id. Unpaid preparation is obsolete.
  for(const receipt of Object.values(raw?.intents||{}))if(receipt?.orderId&&!Object.values(orders).some(r=>r.orderId===receipt.orderId))orders[`legacy_${receipt.orderId}`]={...receipt,grantBy:'room'};
  return {owned:Array.isArray(raw?.owned)?raw.owned.filter(x=>['FastSwingOwned','DoubleCashOwned','DoubleGrowthOwned'].includes(x)):[],speedMultiplier:PRODUCTS.some(p=>p.kind==='speed'&&p.multiplier===raw?.speedMultiplier)?raw.speedMultiplier:1,
    tokens:Number.isSafeInteger(raw?.tokens)&&raw.tokens>=0?raw.tokens:0,potions:raw?.potions||{},orders,intents:{},delivery:raw?.delivery||null,credits:{skip:Math.max(0,Math.floor(raw?.credits?.skip||0)),growAll:Math.max(0,Math.floor(raw?.credits?.growAll||0)),offline:Math.max(0,Math.floor(raw?.credits?.offline||0))}};
}
export const effect=(data,key,now=roomTimeRequired())=>data.commerce?.potions?.[key]?.endsAt>now?data.commerce.potions[key].multiplier:1;
export const owns=(data,key)=>!!data.commerce?.owned?.includes(key);
export const remaining=(egg,now)=>Math.max(0,(egg.readyAt-now)/1000);
export function skipProduct(data,id,now=roomTimeRequired()){
  const egg=data.growingEggs.find(e=>e.id===id&&!e.hatchingAt),seconds=egg?remaining(egg,now):0;
  return seconds>0?PRODUCTS.find(p=>p.kind==='skip'):null;
}
// Fixed-price acceleration: duration never selects a different pay point.
export function growAllProduct(data,now=roomTimeRequired()){
  const eggs=data.growingEggs.filter(e=>!e.hatchingAt&&remaining(e,now)>0);
  return eggs.length?PRODUCTS.find(p=>p.kind==='growAll'):null;
}
export function purchaseContext(data,product,options={},now=roomTimeRequired()){
  if(!product)throw Error('UNKNOWN_PRODUCT');
  const s=data.commerce||restoreCommerce();
  if(product.kind==='entitlement'&&s.owned.includes(product.owned)||product.kind==='speed'&&s.speedMultiplier>=product.multiplier||product.kind==='pickaxe'&&data.pickaxes.owned.includes(product.tier)||product.kind==='trail'&&data.trails.owned.includes(product.tier))throw Error('ALREADY_OWNED');
  if(product.kind==='speed'&&PRODUCTS.find(p=>p.kind==='speed'&&p.multiplier>s.speedMultiplier)?.id!==product.id)throw Error('WRONG_TIER');
  if(product.kind==='power'&&data.power+product.amount>1e19)throw Error('MAX_POWER');
  if(product.kind==='skip'){
    if(!skipProduct(data,options.eggId,now))throw Error('EGG_CHANGED');
    return {eggIds:[options.eggId]};
  }
  if(product.kind==='growAll'){
    if(!growAllProduct(data,now))throw Error('EGG_CHANGED');
    return {eggIds:data.growingEggs.filter(e=>!e.hatchingAt&&remaining(e,now)>0).map(e=>e.id)};
  }
  if(product.kind==='offline'){
    if(money(data.pastureLedger.pending)<=0n)throw Error('NO_OFFLINE_REWARD');
    return {amount:String(data.pastureLedger.pending)};
  }
  if(product.kind==='egg'&&data.pickaxes.pets.length+data.plot.pets.length+data.mergeEggs.length+data.growingEggs.length+product.amount>250)throw Error('INVENTORY_FULL');
  return {};
}
// Construct context only AFTER payment, from the current authoritative account.
// A paid benefit whose target disappeared becomes a usable credit, never a lock.
export function deliveryContext(data,product,options={},now=roomTimeRequired()){
  const eggs=data.growingEggs.filter(e=>!e.hatchingAt&&remaining(e,now)>0);
  if(product.kind==='skip')return {eggIds:eggs.filter(e=>options.eggId?e.id===options.eggId:e===eggs[0]).map(e=>e.id)};
  if(product.kind==='growAll')return {eggIds:eggs.map(e=>e.id)};
  if(product.kind==='offline')return {amount:String(data.pastureLedger.pending)};
  return {};
}
export function redeemPaidCredits(data,now=roomTimeRequired()){
  const credits=data.commerce.credits;if(!credits||!credits.skip&&!credits.growAll&&!credits.offline)return false;let changed=false;
  const eggs=data.growingEggs.filter(e=>!e.hatchingAt&&remaining(e,now)>0);
  if(credits.growAll>0&&eggs.length){for(const egg of eggs)egg.readyAt=now;credits.growAll--;changed=true;}
  else while(credits.skip>0&&eggs.length){eggs.shift().readyAt=now;credits.skip--;changed=true;}
  if(credits.offline>0&&money(data.pastureLedger.pending)>0n){
    data.cash=cashValue(money(data.cash)+money(data.pastureLedger.pending)*2n);data.pastureLedger.pending=0;credits.offline--;changed=true;
  }
  return changed;
}
export function makePaidEggs(amount,key,random=roomRandomRequired){
  return Array.from({length:amount},(_,i)=>{
    let n=random()*100;const species=PAID_SPECIES.find(s=>(n-=s.weight)<0)||PAID_SPECIES.at(-1),v=random();
    return {id:`merge:${key.slice(10)}-${i}`,name:species.name,zone:9,weightKg:species.baseKg,sizeMult:1,variant:v<.01?'Diamond':v<.06?'Gold':null,duration:60,paidType:'FallenAngel'};
  });
}
export function grant(data,receipt,now=roomTimeRequired()){
  if(receipt.applied)return false;
  const p=productOf(receipt.payId);if(!p)throw Error('UNKNOWN_PRODUCT');
  const s=data.commerce;
  switch(p.kind){
    case 'cash':data.cash=cashValue(money(data.cash)+BigInt(p.amount));break;
    case 'power':data.power=Math.min(1e19,data.power+p.amount);break;
    case 'tokens':s.tokens+=p.amount;break;
    case 'speed':s.speedMultiplier=Math.max(s.speedMultiplier,p.multiplier);break;
    case 'entitlement':
      if(!s.owned.includes(p.owned)){
        if(p.owned==='DoubleGrowthOwned')for(const e of data.growingEggs)if(!e.hatchingAt&&e.readyAt>now)e.readyAt=now+(e.readyAt-now)/2;
        s.owned.push(p.owned);
      }break;
    case 'pickaxe':if(!data.pickaxes.owned.includes(p.tier))data.pickaxes.owned.push(p.tier);break;
    case 'trail':if(!data.trails.owned.includes(p.tier))data.trails.owned.push(p.tier);break;
    case 'potion':s.potions[p.effect]={multiplier:p.multiplier,endsAt:Math.max(now,s.potions[p.effect]?.endsAt||0)+p.seconds*1000};break;
    case 'egg':for(const egg of receipt.eggs)if(![...data.mergeEggs,...data.growingEggs,...data.pickaxes.pets,...data.plot.pets].some(p=>p.id===egg.id))data.mergeEggs.push(egg);break;
    case 'skip':case 'growAll':{
      const targets=data.growingEggs.filter(e=>receipt.context.eggIds.includes(e.id)&&!e.hatchingAt&&e.readyAt>now);
      if(targets.length)for(const e of targets)e.readyAt=now;
      else {s.credits??={skip:0,growAll:0,offline:0};s.credits[p.kind]++;}break;
    }
    case 'offline':{
      const pending=money(data.pastureLedger.pending),amount=pending<money(receipt.context.amount)?pending:money(receipt.context.amount);
      if(amount>0n){data.cash=cashValue(money(data.cash)+amount*2n);data.pastureLedger.pending=cashValue(pending-amount);}
      else {s.credits??={skip:0,growAll:0,offline:0};s.credits.offline++;}break;
    }
    default:throw Error('UNKNOWN_GRANT');
  }
  receipt.applied=true;return true;
}

function roomRandomRequired():number{throw Error("Room必须注入可恢复随机源");}
function roomTimeRequired():number{throw Error("Room必须注入可信时间");}
