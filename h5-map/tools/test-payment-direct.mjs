import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {TreadmillState} from '../public/treadmill-state.js';
import {restoreCommerce,deliveryContext,grant,redeemPaidCredits,skipProduct,growAllProduct} from '../public/gameplay/commerce/state.js';
import {PRODUCTS} from '../public/gameplay/commerce/catalog.js';
import {installRoomCommerce} from '../public/online/commerce.js';
import {encode,decode} from '../public/gameplay/commerce/cloud-save.js';
await build({entryPoints:['server/game/payment.ts'],bundle:true,format:'esm',platform:'node',outfile:'build/direct-payment-test.mjs'});
const {payment,paymentPending}=await import('../build/direct-payment-test.mjs');
const product=kind=>PRODUCTS.find(p=>p.kind===kind),ok=data=>({ok:true,data});
function fixture(kind='cash'){
  const account=new TreadmillState({now:()=>100000}).data;
  const p={id:'buyer',slot:0,connected:true,loaded:true,account,revision:0,receipts:{},dirty:false};
  let saved=JSON.stringify({account,revision:0,receipts:{}}),callback,inAllowed=false,completed=false;
  const replies=[],counts={orders:0,writes:0,saves:0};
  const room={state:{namespace:'test',elapsed:100,pendingSaves:{},saving:{}},unixTimeMillis:()=>100000,random:()=>.5,
    sendToUserJson:(_id,_op,value)=>replies.push(value),account(){},pasture(){},profiles(){},
    save(){assert.equal(inAllowed,false);counts.saves++;saved=JSON.stringify({account:p.account,revision:p.revision,receipts:p.receipts});},
    cloudLoadSnapshot(_id,fn){fn({status:'ready',entries:[{key:'pasture_account_v1',live:true,value:{kind:'string',value:saved}}]});},
    doOrder(_id,fn){counts.orders++;callback=fn;},
    fulfill(writes){assert.equal(inAllowed,true);counts.writes++;if(room.fail)throw Error('WRITE_FAILED');saved=writes[0].value.value;},
  };
  const send=(action='deliver',extra={})=>payment(room,p,{key:'request',action,orderId:'order:/+1',...extra});
  const drive=(payId=product(kind).payId)=>{
    const cb=callback;callback=null;
    if(completed){cb({status:'already_delivered'});return;}
    inAllowed=true;try{cb({status:'allowed',order:{orderId:'order:/+1',payId}});completed=true;}finally{inAllowed=false;}
  };
  return {p,room,replies,counts,send,drive,get completed(){return completed;}};
}
test('legacy prepare/cancel are read-only and never gate actions or save random eggs',()=>{
  const f=fixture('egg'),before=JSON.stringify(f.p.account);
  f.send('prepare',{payId:product('egg').payId});assert.equal(f.replies.at(-1).ok,true);
  assert.equal(JSON.stringify(f.p.account),before);assert.equal(paymentPending(f.p),false);
  f.send('cancel');assert.equal(JSON.stringify(f.p.account),before);assert.equal(f.counts.saves,0);
});
test('paid order without preparation grants verified product once, regardless of forged request fields',()=>{
  const f=fixture();f.send('deliver',{payId:product('egg').payId,amount:999999,options:{amount:'999999'}});
  f.drive();assert.equal(f.p.account.cash,100+product('cash').amount);assert.equal(f.p.account.mergeEggs.length,0);
  assert.equal(f.replies.at(-1).pending,true);assert.equal(paymentPending(f.p),true);
  f.send();f.drive();assert.equal(f.replies.at(-1).delivered,true);assert.equal(paymentPending(f.p),false);
  f.send();assert.equal(f.replies.at(-1).delivered,true);assert.equal(f.counts.writes,1);
});
test('ordinary saves finish before paid fulfillment; failed writes never complete an empty order',()=>{
  const f=fixture();f.room.state.saving.buyer=true;f.send();assert.equal(f.replies.at(-1).reason,'SAVE_PENDING');assert.equal(f.counts.orders,0);
  delete f.room.state.saving.buyer;f.room.fail=true;f.send();assert.throws(()=>f.drive(),/WRITE_FAILED/);
  assert.equal(f.completed,false);assert.equal(f.p.account.cash,100);assert.equal(paymentPending(f.p),false);
  f.room.fail=false;f.send();f.drive();assert.equal(f.p.account.cash,100+product('cash').amount);
});
test('unknown verified products fail without finishing the order',()=>{
  const f=fixture();f.send();assert.throws(()=>f.drive('not-a-product'),/UNKNOWN_PRODUCT/);
  assert.equal(f.completed,false);assert.equal(f.counts.writes,0);
});
test('migration drops unpaid records and retains only real paid receipts',()=>{
  const s=restoreCommerce({intents:{unpaid:{payId:'egg_3715295845',eggs:[{}]},paid:{payId:'egg_3714065877',orderId:'real',context:{},applied:false}}});
  assert.deepEqual(s.intents,{});assert.equal(Object.values(s.orders).length,1);assert.equal(Object.values(s.orders)[0].orderId,'real');
});
test('fixed-price acceleration ignores old time tiers and validates the target owner',()=>{
  const f=fixture('skip');f.p.account.growingEggs=[{id:'own',readyAt:999999999,position:[0,0,0]}];
  assert.equal(skipProduct(f.p.account,'own',100000).price,100);assert.equal(growAllProduct(f.p.account,100000).price,100);
  f.send('deliver',{options:{eggId:'own'}});f.drive();assert.equal(f.p.account.growingEggs[0].readyAt,100000);
  const g=fixture('skip');g.p.account.growingEggs=[{id:'own',readyAt:999999999}];g.send('deliver',{options:{eggId:'another-player-egg'}});g.drive();
  assert.equal(g.p.account.growingEggs[0].readyAt,999999999);assert.equal(g.p.account.commerce.credits.skip,1);
});
test('offline double uses current authoritative pending amount, ignoring client amount',()=>{
  const f=fixture('offline');f.p.account.pastureLedger.pending=75;
  f.send('deliver',{options:{amount:'9999999999'}});f.drive();assert.equal(f.p.account.cash,250);assert.equal(f.p.account.pastureLedger.pending,0);
});
test('paid benefits with vanished targets survive as credits and are consumed once',()=>{
  const data=new TreadmillState({now:()=>100000}).data;
  for(const kind of ['skip','growAll','offline']){
    const p=product(kind),r={payId:p.payId,context:deliveryContext(data,p,{},100000),applied:false};
    grant(data,r,100000);grant(data,r,100000);assert.equal(data.commerce.credits[kind],1);
  }
  data.pastureLedger.pending=80;data.growingEggs=[{id:'later',readyAt:200000}];
  assert.equal(redeemPaidCredits(data,100000),true);assert.equal(data.cash,260);assert.equal(data.growingEggs[0].readyAt,100000);
  assert.equal(data.commerce.credits.growAll,0);assert.equal(data.commerce.credits.offline,0);assert.equal(data.commerce.credits.skip,1);
  data.growingEggs.push({id:'next',readyAt:300000});redeemPaidCredits(data,100000);assert.equal(data.commerce.credits.skip,0);
  assert.equal(redeemPaidCredits(data,100000),false);
});
function clientFixture(){
  const listeners=new Set(),requests=[],writes=[],account=new TreadmillState().data;let stored=null;
  const commerce={busy:false,onBusy(){},onChange(){},onMessage(){}};
  const connection={account,session:{ready:false,room:{sendReliable(_op,bytes){const request=JSON.parse(new TextDecoder().decode(bytes));requests.push(request);queueMicrotask(()=>{for(const fn of listeners)fn('payment',{key:request.key,ok:true,delivered:true});});}}},observe(fn){listeners.add(fn);return()=>listeners.delete(fn);}};
  const sdk={cancel:false,failSet:false,grantBy:'room',panels:0,
    privateKV:{get:async()=>ok(stored),set:async(key,value)=>{if(sdk.failSet)return {ok:false,error:{code:'SAVE_FAILED'}};writes.push(decode(value));stored=value;return ok({});}},
    iap:{showPayPanel:async()=>{sdk.panels++;assert.equal(requests.length,0);assert.equal(writes.length,0);return ok({success:!sdk.cancel,orderId:'paid',grantBy:sdk.grantBy});},getPendingOrderIds:async()=>ok({orderIds:['unknown']})}};
  commerce.sdk=sdk;installRoomCommerce({commerce,account:{data:account}},connection);connection.session.ready=true;
  return {commerce,sdk,requests,writes,connection,setStored(value){stored=encode(value);}};
}
test('client cancel creates no RPC or purchase record; success persists only the paid receipt',async()=>{
  const f=clientFixture();f.sdk.cancel=true;
  assert.equal((await f.commerce.buy(product('cash').id)).cancelled,true);assert.equal(f.requests.length,0);assert.equal(f.writes.length,0);
  f.sdk.cancel=false;assert.equal((await f.commerce.buy(product('cash').id)).delivered,true);
  assert.deepEqual(f.requests.map(x=>x.action),['deliver']);assert.equal(f.writes[0].orderId,'paid');assert.equal(f.writes.at(-1),null);
});
test('failed paid-receipt persistence stays recoverable in memory without another charge',async()=>{
  const f=clientFixture();f.sdk.failSet=true;assert.equal((await f.commerce.buy(product('cash').id)).ok,false);
  assert.equal(f.requests.length,0);f.sdk.failSet=false;
  assert.equal((await f.commerce.recover()).recovered,1);assert.equal(f.sdk.panels,1);assert.equal(f.requests[0].action,'deliver');
});
test('unknown grantBy never routes to Room; unknown pending IDs are not guessed',async()=>{
  const f=clientFixture();f.sdk.grantBy='client';assert.equal((await f.commerce.buy(product('cash').id)).error,'ORDER_REQUIRES_CLIENT');assert.equal(f.requests.length,0);
  const g=clientFixture();assert.equal((await g.commerce.recover()).unknown,1);assert.equal(g.requests.length,0);assert.equal(g.writes.length,0);
});
