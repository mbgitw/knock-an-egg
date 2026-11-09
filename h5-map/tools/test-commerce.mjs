import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {CloudSave,encode,decode,orderKey} from '../public/gameplay/commerce/cloud-save.js';
import {Commerce} from '../public/gameplay/commerce/service.js';
import {PRODUCTS} from '../public/gameplay/commerce/catalog.js';
import {grant,purchaseContext,growAllProduct,skipProduct} from '../public/gameplay/commerce/state.js';
import {TreadmillState,restoreState} from '../public/treadmill-state.js';
import {MergeState} from '../public/gameplay/merge-state.js';
import {PastureEconomy} from '../public/gameplay/pasture-economy.js';
import {animalIncome} from '../public/gameplay/animal-attributes.js';
const ok=data=>({ok:true,data}),fail=()=>({ok:false,error:{code:'TEST_FAILURE'}});
function mock(){
  const values=new Map(),pending=new Set();let serial=0;
  const sdk={values,pending,claims:0,panels:0,cancel:false,room:false,failClaim:false,failSet:false,partial:false,loseHead:false,
    privateKV:{get:async k=>ok(values.get(k)||null),getMany:async keys=>ok({entries:Object.fromEntries(keys.map(k=>[k,values.get(k)||null]))}),set:async(k,v)=>{if(sdk.failSet)return fail();values.set(k,v.slice());if(sdk.loseHead){sdk.loseHead=false;return fail();}return ok({key:k});},setMany:async entries=>{if(sdk.failSet)return fail();for(const [k,v] of Object.entries(entries)){values.set(k,v.slice());if(sdk.partial)break;}return ok({keys:Object.keys(entries)});}},
    iap:{showPayPanel:async()=>{sdk.panels++;if(sdk.cancel)return ok({success:false});const orderId=sdk.reuse||`order:/+${++serial}`;pending.add(orderId);return ok({success:true,orderId,grantBy:sdk.room?'room':'client'});},claim:async id=>{sdk.claims++;if(sdk.failClaim)return fail();pending.delete(id);return ok({success:true});},getPendingOrderIds:async()=>ok({orderIds:[...pending]})}};return sdk;
}
async function setup(sdk=mock()){
 const storage=await CloudSave.open(sdk),account=new TreadmillState({storage,now:()=>100000});const commerce=new Commerce(account,{sdk,now:()=>100000,random:()=>.5});return {sdk,storage,account,commerce};
}
const cashProduct=PRODUCTS.find(p=>p.kind==='cash');
test('81 runtime prices equal approved formula and stable manifest pay points',()=>{
 const manifest=JSON.parse(fs.readFileSync(new URL('../builda.publish.json',import.meta.url)));
 assert.equal(PRODUCTS.length,81);assert.equal(new Set(PRODUCTS.map(p=>p.payId)).size,81);
 for(const p of PRODUCTS){assert.equal(p.price,(['skip','growAll','offline'].includes(p.kind)?100:Math.max(100,p.originalGcoin*5)));assert.match(p.payId,/^[A-Za-z0-9_-]{1,64}$/);assert.deepEqual(manifest.payPoints.find(x=>x.payId===p.payId),{payId:p.payId,payName:p.name,price:p.price,grantBy:'room'});}
});
test('cloud bytes, multi-chunk save, partial writes and lost head response preserve valid snapshot',async()=>{
 assert.deepEqual(decode(encode({text:'G币 🐣'})),{text:'G币 🐣'});
 const sdk=mock(),s=await CloudSave.open(sdk);s.setItem('',JSON.stringify({old:'x'.repeat(15000)}));await s.flush();
 sdk.partial=true;s.setItem('',JSON.stringify({new:'y'.repeat(15000)}));await assert.rejects(s.flush());
 assert.equal(JSON.parse((await CloudSave.open(sdk)).text).old.length,15000);
 sdk.partial=false;await s.retry();assert.equal(JSON.parse((await CloudSave.open(sdk)).text).new.length,15000);
 sdk.loseHead=true;s.setItem('',JSON.stringify({paid:1}));await assert.rejects(s.flush());await s.retry();
 assert.deepEqual(JSON.parse((await CloudSave.open(sdk)).text),{paid:1});
 assert.ok([...sdk.values.keys()].every(k=>/^[A-Za-z0-9_-]{1,64}$/.test(k)));assert.ok(sdk.values.size<=61);
});
test('cancel and absent host never grant; normal purchase survives refresh and duplicate response',async()=>{
 const {sdk,account,commerce,storage}=await setup();sdk.cancel=true;
 assert.equal((await commerce.buy(cashProduct.id)).cancelled,true);assert.equal(account.data.cash,100);assert.equal(sdk.claims,0);
 sdk.cancel=false;assert.equal((await commerce.buy(cashProduct.id)).delivered,true);const balance=account.data.cash;
 sdk.reuse=Object.values(account.data.commerce.orders)[0].orderId;await commerce.buy(cashProduct.id);assert.equal(account.data.cash,balance);
 const restored=await setup(sdk);assert.equal(restored.account.data.cash,balance);assert.equal(Object.keys(restored.account.data.commerce.orders).length,1);
 const noHost=new Commerce(new TreadmillState());assert.equal((await noHost.buy(cashProduct.id)).ok,false);
 await storage.flush();await restored.storage.flush();
});
test('failed checkpoint before pay does not open panel; failed claim recovers exactly once after restart',async()=>{
 const {sdk,account,commerce,storage}=await setup();sdk.failSet=true;
 assert.equal((await commerce.buy(cashProduct.id)).ok,false);assert.equal(sdk.panels,0);assert.equal(account.data.cash,100);
 sdk.failSet=false;sdk.failClaim=true;assert.equal((await commerce.buy(cashProduct.id)).ok,false);const balance=account.data.cash;
 assert.equal(balance,100+cashProduct.amount);
 const restored=await setup(sdk);sdk.failClaim=false;assert.equal((await restored.commerce.recover()).recovered,1);
 assert.equal(restored.account.data.cash,balance);assert.equal((await restored.commerce.recover()).recovered,0);
 await storage.flush();await restored.storage.flush();
});
test('room and unknown pending orders never grant or claim; opaque order IDs are safely hashed',async()=>{
 const {sdk,account,commerce,storage}=await setup();sdk.room=true;
 assert.equal((await commerce.buy(cashProduct.id)).error,'ORDER_REQUIRES_ROOM');assert.equal(account.data.cash,100);assert.equal(sdk.claims,0);
 sdk.pending.clear();sdk.pending.add('unknown');assert.equal((await commerce.recover()).unknown,1);assert.equal(sdk.claims,0);
 const a=await orderKey('order:/+1'),b=await orderKey('order:/+2');assert.match(a,/^pay_order_[a-f0-9]{48}$/);assert.notEqual(a,b);await storage.flush();
});
test('all 81 grant types update exactly once, preserve cash purchases and restore state',async()=>{
 for(const p of PRODUCTS){
   const {sdk,account,commerce,storage}=await setup();
   if(p.kind==='speed')account.data.commerce.speedMultiplier=p.multiplier/2;
   if(p.kind==='offline')account.data.pastureLedger.pending=1000;
   if(p.kind==='skip'||p.kind==='growAll'){
     const seconds=p.seconds||300000;
     account.data.growingEggs=[{id:'merge:test',name:'Chicken',weightKg:10,sizeMult:1,duration:seconds,readyAt:100000+seconds*1000,position:[0,0,0]}];
   }
   const result=await commerce.buy(p.id,{eggId:'merge:test'});assert.equal(result.delivered,true,JSON.stringify({p,result}));
   const data=account.data,s=data.commerce,receipt=Object.values(s.orders)[0];assert.equal(receipt.applied,true);assert.equal(receipt.claimed,true);
   const before=JSON.stringify(data);grant(data,receipt,100000);assert.equal(JSON.stringify(data),before);
   if(p.kind==='egg'){assert.equal(data.mergeEggs.length,p.amount);assert.equal(restoreState(data,100000).mergeEggs.length,p.amount);}
   if(p.kind==='cash')assert.equal(data.cash,100+p.amount);
   if(p.kind==='power')assert.equal(data.power,10+p.amount);
   if(p.kind==='tokens')assert.equal(s.tokens,p.amount);
   if(p.kind==='speed')assert.equal(s.speedMultiplier,p.multiplier);
   if(p.kind==='potion')assert.equal(s.potions[p.effect].endsAt,100000+900000);
   if(p.kind==='entitlement')assert.ok(s.owned.includes(p.owned));
   if(p.kind==='pickaxe')assert.ok(data.pickaxes.owned.includes(p.tier));
   if(p.kind==='trail')assert.ok(data.trails.owned.includes(p.tier));
   if(['skip','growAll'].includes(p.kind))assert.equal(data.growingEggs[0].readyAt,100000);
   if(p.kind==='offline'){assert.equal(data.cash,2100);assert.equal(data.pastureLedger.pending,0);}
   assert.equal(sdk.claims,1);await storage.flush();
 }
});
test('paid eggs place, grow, hatch, restore as animated species and produce income',async()=>{
 const {account,commerce,storage}=await setup();let now=100000;
 await commerce.buy(PRODUCTS.find(p=>p.kind==='egg').id);
 const merge=new MergeState(account,{now:()=>now});const egg=account.data.mergeEggs[0];assert.equal(egg.duration,60);
 assert.equal(merge.place(egg.id,[0,0,0]),true);now+=60000;assert.equal(merge.hatch(egg.id),true);now+=6200;merge.finish();
 assert.ok(animalIncome(account.data.pickaxes.pets[0])>0);
 assert.equal(restoreState(account.data,now).pickaxes.pets.length,1);await storage.flush();
});
test('capacity, owned goods and tiers are checked; acceleration price is independent of time',async()=>{
 const {account,commerce,sdk,storage}=await setup();account.data.pickaxes.pets=Array.from({length:250},()=>({}));
 assert.equal((await commerce.buy(PRODUCTS.find(p=>p.kind==='egg').id)).error,'INVENTORY_FULL');
 assert.equal((await commerce.buy(PRODUCTS.find(p=>p.kind==='speed'&&p.multiplier===4).id)).error,'WRONG_TIER');
 assert.equal(sdk.panels,0);
 account.data.growingEggs=[{id:'a',readyAt:100000+900000}];assert.equal(skipProduct(account.data,'a',100000).seconds,900);
 account.data.growingEggs[0].readyAt+=999999999;assert.equal(skipProduct(account.data,'a',100000).price,100);
 assert.equal(growAllProduct(account.data,100000).seconds,3600);await storage.flush();
});
test('permanent and potion benefits affect training, walking, cash and growth',async()=>{
 const {account,commerce,storage}=await setup();account.data.unlocked=true;account.begin();const base=account.multiplier;
 for(const p of PRODUCTS.filter(p=>p.kind==='entitlement'||p.kind==='potion'))await commerce.buy(p.id);
 await commerce.buy(PRODUCTS.find(p=>p.kind==='speed').id);assert.equal(account.multiplier,base*4);
 assert.ok(account.speed>18);
 account.data.plot.pets=[{id:'merge:a',name:'Chicken',weightKg:10,sizeMult:1}];const economy=new PastureEconomy(account,()=>100000);assert.equal(economy.rate,animalIncome(account.data.plot.pets[0])*4);
 const merge=new MergeState(account,{now:()=>100000});account.data.mergeEggs=[{id:'merge:b',name:'Chicken',weightKg:10,sizeMult:1,duration:60}];merge.place('merge:b',[0,0,0]);assert.equal(account.data.growingEggs[0].readyAt,130000);await storage.flush();
});
test('double click starts one payment; interrupted paid receipt save never leaves an unpaid preparation after reload',async()=>{
 const {sdk,account,commerce,storage}=await setup();
 const pair=await Promise.all([commerce.buy(cashProduct.id),commerce.buy(cashProduct.id)]);
 assert.equal(pair.filter(r=>r.delivered).length,1);assert.equal(sdk.panels,1);
 const eggProduct=PRODUCTS.find(p=>p.kind==='egg'),show=sdk.iap.showPayPanel;
 sdk.iap.showPayPanel=async(...args)=>{const result=await show(...args);sdk.failSet=true;return result;};
 assert.equal((await commerce.buy(eggProduct.id)).ok,false);assert.equal(account.data.mergeEggs.length,0);
 // Simulate process loss: discard the unsaved local receipt, retaining platform KV only.
 clearTimeout(storage.timer);sdk.failSet=false;sdk.iap.showPayPanel=show;
 const resumed=await setup(sdk);assert.equal((await resumed.commerce.recover()).unknown,1);
 sdk.reuse=[...sdk.pending][0];assert.equal((await resumed.commerce.buy(eggProduct.id)).delivered,true);
 assert.equal(resumed.account.data.mergeEggs.length,1);assert.equal(resumed.account.data.cash,100+cashProduct.amount);
 await resumed.storage.flush();
});
