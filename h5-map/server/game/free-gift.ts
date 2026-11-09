import {grantFreeGift} from './rules/gameplay/free-gift-state.ts';
import {OP} from './rules/online/protocol.ts';
// The public ad SDK exposes a client completion result, not a signed server receipt.
// Room owns per-player reward deduplication; never claim server ad verification.
export function freeGift(room:any,p:any,r:any){
 if(!p.loaded||!p.connected||typeof r.key!=='string'||r.key.length>80)return;
 const reply=(data:any)=>room.sendToUserJson(p.id,String(OP.PAYMENT_RESULT),{key:r.key,...data});
 if(p.freeGiftBusy||p.paymentBusy||p.account.commerce.delivery){reply({ok:false,reason:'BUSY'});return;}
 const s=p.account.freeGift;
 if(r.action==='gift-prepare'){
  if(!s.claimed&&Math.hypot(p.position.x+72.2237,p.position.z+74.2926)>16){reply({ok:false,reason:'TOO_FAR'});return;}
  s.token??=`gift-${room.state.namespace.slice(0,80)}-${p.slot}-${Math.floor(Number(room.unixTimeMillis()))}`;
 }else if(r.action==='gift-claim'){
  if(!grantFreeGift(p.account,r.token)){reply({ok:false,reason:'INVALID_GIFT'});return;}
 }else return;
 p.freeGiftBusy=true;p.dirty=true;room.save(p);
 room.cloudFlush(3000,(result:any)=>{p.freeGiftBusy=false;room.account(p);reply(result.status==='applied'?{ok:true,claimed:s.claimed,token:s.token}:{ok:false,reason:'SAVE_PENDING'});});
}
