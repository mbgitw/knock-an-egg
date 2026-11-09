import {OP} from '../online/protocol.js';
import {encode,decode} from './commerce/cloud-save.js';
const KEY='free_gift_ad_v1';
const unwrap=r=>{if(!r?.ok)throw Error(r?.error?.code||'HOST_UNAVAILABLE');return r.data;};
export class FreeGiftService {
 constructor(game,{sdk=globalThis.Builda}={}){this.game=game;this.sdk=sdk;this.busy=false;this.completed=null;}
 async rpc(action,value={}){
  const c=this.game.online;if(!c?.session.ready)throw Error('ROOM_UNAVAILABLE');
  return new Promise((resolve,reject)=>{const key=crypto.randomUUID(),off=c.observe((type,data)=>{if(type!=='payment'||data.key!==key)return;clearTimeout(timer);off();data.ok?resolve(data):reject(Error(data.reason));});const timer=setTimeout(()=>{off();reject(Error('SAVE_PENDING'));},12000);
   try{c.session.room.sendReliable(OP.PAYMENT,new TextEncoder().encode(JSON.stringify({key,action,...value})));}catch(e){clearTimeout(timer);off();reject(e);}
  });
 }
 async claim(){
  if(this.busy)return {ok:false,error:'BUSY'};this.busy=true;
  try{
   if(!this.sdk?.ad||!this.sdk?.privateKV)throw Error('HOST_UNAVAILABLE');
   const prepared=await this.rpc('gift-prepare');
   if(prepared.claimed)return {ok:true,already:true};
   const saved=decode(unwrap(await this.sdk.privateKV.get(KEY)));
   if(this.completed!==prepared.token&&saved?.token!==prepared.token){
    const result=unwrap(await this.sdk.ad.showRewardAd('free_gift_once'));
    if(result?.success!==true)return {ok:false,cancelled:true};
    this.completed=prepared.token;
   }
   // Retain valid completion across disconnect/retry. Never replay the ad on save failure.
   unwrap(await this.sdk.privateKV.set(KEY,encode({token:prepared.token})));
   await this.rpc('gift-claim',{token:prepared.token});
   // The committed Room flag is authoritative even if cleanup of this hint fails.
   try{unwrap(await this.sdk.privateKV.remove(KEY));}catch{}
   return {ok:true};
  }catch(e){return {ok:false,error:e.message};}finally{this.busy=false;}
 }
}
