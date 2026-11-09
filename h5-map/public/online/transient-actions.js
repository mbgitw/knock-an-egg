import {OP} from './protocol.js';

// Short-lived gameplay requests may overlap receipts, but are never replayed after a pause.
// Purchases and other durable transactions retain PastureSession's single pending intent.
export class TransientActions {
  constructor(session,{limit=8,timeout=3000}={}){this.session=session;this.limit=limit;this.timeout=timeout;this.pending=new Map();}
  send(action,value){
    const s=this.session;
    const capacity=this.limit+(action==='training-stop'?1:0);
    if(!s.ready||!s.active||s.exiting||!s.room||this.pending.size>=capacity||
      (action==='egg-hit'&&s.pending))return Object.assign(Promise.resolve(false),{sent:false});
    const id=++s.revision;let sent=true;
    const request=new Promise(resolve=>{
      const timer=setTimeout(()=>this.finish(id,false),this.timeout);timer.unref?.();
      this.pending.set(id,{resolve,timer});
      try{s.room.sendControl(OP.INTENT,new TextEncoder().encode(JSON.stringify({id,action,value})));}
      catch{sent=false;this.finish(id,false);}
    });
    // `sent` lets callers start predicted presentation only for requests that actually left.
    return Object.assign(request,{sent});
  }
  finish(id,result){const p=this.pending.get(id);if(!p)return;this.pending.delete(id);clearTimeout(p.timer);p.resolve(result);}
  receive(data){this.finish(data.id,data.ok?data:false);}
  clear(){for(const id of this.pending.keys())this.finish(id,false);}
}
