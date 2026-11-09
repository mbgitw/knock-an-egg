// No balances, full input, exception text, or caller-supplied identity in logs.
const stages=new Set(['opened','click','blocked','sent','receipt','timeout','error','closed','still_open','server_result','recovery']);
const reasons=new Set(['','WAITING','NOT_READY','INTENT_BLOCKED','UI_BUSY','PAY_BUSY','ok','REJECTED','STALE_INTENT','PLAYER_UNAVAILABLE','RATE_LIMIT','INVALID_INTENT','CLICK_START','AUTO_START','CANCELLED','DELIVERED','UNKNOWN_ORDER','UNRESOLVED','FAILED']);
export function logOffline(room:any,p:any,data:any,source:'client'|'server'){
  try{
    if(!data||!stages.has(data.stage)||(source==='client'&&data.stage==='server_result'))return;
    const state=room.state,time=state.elapsed;
    const budget=(owner:any,key:string,limit:number)=>{const b=owner[key]??={until:time+60000,count:0};if(time>=b.until){b.until=time+60000;b.count=0;}return b.count++<limit;};
    const burst=state.offlineLogBurst??={until:time+1000,count:0};if(time>=burst.until){burst.until=time+1000;burst.count=0;}if(burst.count++>=8)return;
    if(!budget(p,'offlineLogBudget',40)||!budget(state,'offlineLogBudget',120))return;
    const integer=(v:any)=>Number.isSafeInteger(v)&&v>=0&&v<=0xffffffff?v:0;
    const fields:any={source,player:p.id,stage:data.stage,id:integer(data.id),attempt:integer(data.attempt),reason:reasons.has(data.reason)?data.reason:'OTHER'};
    for(const key of ['ready','active','waiting','pending','busy','opened','hasReward','ok'])if(typeof data[key]==='boolean')fields[key]=data[key];
    room.log('info',`offline_claim ${JSON.stringify(fields)}`);
  }catch{/* Even a logging failure must not affect a receipt or award. */}
}
