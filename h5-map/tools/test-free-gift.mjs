import test from 'node:test';
import assert from 'node:assert/strict';
import {FreeGiftService} from '../public/gameplay/free-gift-service.js';
import {restoreFreeGift,grantFreeGift} from '../public/gameplay/free-gift-state.js';
import {build} from 'esbuild';
const bundle=await build({entryPoints:['server/game/free-gift.ts'],bundle:true,format:'esm',platform:'node',write:false});
const {freeGift}=await import('data:text/javascript;base64,'+Buffer.from(bundle.outputFiles[0].text).toString('base64'));
test('Room rejects remote preparation, waits for persistence and deduplicates failed flush retry',()=>{
 const replies=[],p={id:'a',slot:1,loaded:true,connected:true,position:{x:0,z:0},account:{power:10,freeGift:restoreFreeGift(),commerce:{intents:{}}}};
 let flush,saved;const room={state:{namespace:'test'},unixTimeMillis:()=>123,sendToUserJson:(_a,_b,r)=>replies.push(r),save:p=>saved=JSON.parse(JSON.stringify(p.account)),cloudFlush:(_t,f)=>flush=f,account(){}};
 freeGift(room,p,{key:'1',action:'gift-prepare'});assert.equal(replies.at(-1).reason,'TOO_FAR');p.position={x:-72.2,z:-74.3};freeGift(room,p,{key:'2',action:'gift-prepare'});assert.equal(p.freeGiftBusy,true);flush({status:'applied'});
 const token=replies.at(-1).token;freeGift(room,p,{key:'3',action:'gift-claim',token});assert.equal(saved.power,10010);assert.equal(saved.freeGift.claimed,true);flush({status:'failed'});assert.equal(replies.at(-1).reason,'SAVE_PENDING');
 freeGift(room,p,{key:'4',action:'gift-claim',token});flush({status:'applied'});assert.equal(replies.at(-1).ok,true);assert.equal(saved.power,10010);
});
function setup(){
 const account={power:10,freeGift:restoreFreeGift({token:'one-player-token'})},values=new Map();
 const sdk={ads:0,success:true,failSave:false,privateKV:{get:async k=>({ok:true,data:values.get(k)||null}),set:async(k,v)=>{if(sdk.failSave)throw Error('offline');values.set(k,v);return {ok:true};},remove:async k=>{values.delete(k);return {ok:true};}},ad:{showRewardAd:async()=>{sdk.ads++;return {ok:true,data:{success:sdk.success}};}}};
 const service=new FreeGiftService({}, {sdk});service.rpc=async(action,r)=>{if(action==='gift-prepare')return account.freeGift;if(service.failRoom)throw Error('SAVE_PENDING');assert.equal(grantFreeGift(account,r.token),true);return {ok:true};};return {account,sdk,service};
}
test('reward is once per restored player and rejects unknown tokens',()=>{
 const a={power:10,freeGift:restoreFreeGift({token:'a'})};assert.equal(grantFreeGift(a,'b'),false);assert.equal(a.power,10);assert.equal(grantFreeGift(a,'a'),true);assert.equal(a.power,10010);
 a.freeGift=restoreFreeGift(JSON.parse(JSON.stringify(a.freeGift)));assert.equal(grantFreeGift(a,'a'),true);assert.equal(a.power,10010);
 const b={power:1,freeGift:restoreFreeGift({token:'b'})};grantFreeGift(b,'b');assert.equal(b.power,10001);
});
test('cancelled or invalid ad completion never grants',async()=>{for(const success of [false,null,undefined,'true']){const {account,sdk,service}=setup();sdk.success=success;assert.equal((await service.claim()).cancelled,true);assert.equal(account.power,10);}});
test('successful ad grants once, repeated claim skips ad',async()=>{const {account,sdk,service}=setup();assert.equal((await service.claim()).ok,true);assert.equal(account.power,10010);assert.equal((await service.claim()).already,true);assert.equal(sdk.ads,1);});
test('valid completion survives room failure and service recreation',async()=>{const {account,sdk,service}=setup();service.failRoom=true;assert.equal((await service.claim()).error,'SAVE_PENDING');assert.equal(account.power,10);const retry=new FreeGiftService({}, {sdk});retry.rpc=service.rpc;service.failRoom=false;assert.equal((await retry.claim()).ok,true);assert.equal(account.power,10010);assert.equal(sdk.ads,1);});
test('save failure retains in-memory completion without replaying video',async()=>{const {sdk,service}=setup();sdk.failSave=true;assert.equal((await service.claim()).ok,false);sdk.failSave=false;assert.equal((await service.claim()).ok,true);assert.equal(sdk.ads,1);});
test('double click and unavailable host do not grant',async()=>{const {sdk,service}=setup();let finish;sdk.ad.showRewardAd=()=>new Promise(r=>finish=r);const first=service.claim();while(!finish)await new Promise(r=>setTimeout(r,0));assert.equal((await service.claim()).error,'BUSY');finish({ok:true,data:{success:true}});await first;assert.equal((await new FreeGiftService({}, {sdk:{}}).claim()).error,'HOST_UNAVAILABLE');});
