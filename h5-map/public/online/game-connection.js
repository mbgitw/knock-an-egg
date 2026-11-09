import {connectPasture} from './connect.js';
import {OP} from './protocol.js';
import {readPreferences} from './preferences.js';
import {connectionDiagnostic,networkDiagnostic} from './connection-diagnostic.js';
import {TransientActions} from './transient-actions.js';

// Owns network state independently of WebGL loading. No account writes are accepted from the browser.
export class GameConnection {
  constructor(){this.players=[];this.eggs=new Map();this.animals=new Map();this.pastures=new Map();this.guardFrames=[];this.listeners=new Set();this.clockOffset=0;}
  static async open({timeoutMs=180000}={}){
    const connection=new GameConnection();connection.stage='starting';const started=performance.now();let ready,failed,timer;
    const baseline=new Promise((resolve,reject)=>{ready=resolve;failed=reject;});
    // Observe baseline rejection immediately, including while transport is connecting.
    baseline.catch(()=>{});
    const deadline=new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('ONLINE_TIMEOUT')),timeoutMs);});
    const work=(async()=>{
      connection.session=await connectPasture({cancelled:()=>connection.abandoned,onSession:s=>{connection.session=s;},onMessage:(op,data)=>{if(!connection.abandoned)connection.receive(op,data);},onStatus:status=>{
        if(connection.abandoned)return;
        connection.stage=status.stage;if(status.code)connection.lastCode=status.code;
        if(status.stage!=='room_connected')connection.actions?.clear();
        connection.emit('status',status);
        if(status.stage==='room_connected')ready();
        if(['recovery_required','cleanup_failed'].includes(status.stage)||(status.stage==='idle'&&status.code))failed(Object.assign(Error(status.code||'ONLINE_FAILED'),{code:status.code}));
      }});
      await baseline;if(connection.abandoned)throw Error('ONLINE_CANCELLED');
      connection.stage='preferences';await readPreferences(connection.account);connection.stage='ready';return connection;
    })();
    try{return await Promise.race([work,deadline]);}
    catch(error){const diagnostic=connectionDiagnostic(connection,error,performance.now()-started);connection.abandoned=true;let snapshotTimer;try{const snapshot=await Promise.race([connection.session?.socket?.networkSnapshot?.(diagnostic.room),new Promise(resolve=>{snapshotTimer=setTimeout(resolve,300);})]);if(snapshot)diagnostic.network=networkDiagnostic(snapshot);}catch{}finally{clearTimeout(snapshotTimer);}const failure=Object.assign(new Error(error?.message||'ONLINE_FAILED'),{code:error?.code,diagnostic,retryCleanup:async()=>connection.session?await connection.session.leave():true});void failure.retryCleanup().catch(()=>{});throw failure;}
    finally{clearTimeout(timer);}
  }
  observe(fn){this.listeners.add(fn);return()=>this.listeners.delete(fn);}
  emit(type,data){for(const fn of this.listeners)fn(type,data);}
  receive(op,data){
    if(op===OP.SNAPSHOT)this.interactions=data.interactions||0;
    if(op===OP.RECEIPT&&data.reason==='SAVE_LOAD_FAILED')this.lastCode='SAVE_LOAD_FAILED';
    if(op===OP.ACCOUNT&&data.changes){if(!this.account)return;let next=JSON.parse(JSON.stringify(this.account));for(const change of data.changes){let target=next;for(const part of change.path.slice(0,-1))target=target[part];const key=change.path.at(-1);if(change.remove)delete target[key];else target[key]=change.value;}data.account=next;}
    if(op===OP.SNAPSHOT){this.guardTime=null;this.self=data.self;this.players=data.players;this.emit('motion-reset');this.emit('players',this.players);}
    // 快照里本人坐标是断线前最后采纳的旧值；Room信任客户端位置，重连后保留本地位置并由下一帧上报覆盖。首次进房由runtime按快照定位，重生走单独position事件。
    if(op===OP.EVENT&&data.kind==='players'){this.players=data.players;const ids=new Set(this.players.map(p=>p.id));for(const id of this.pastures.keys())if(!ids.has(id))this.pastures.delete(id);this.emit('players',this.players);}
    if(op===OP.ACCOUNT){if(data.patch&&!this.account)return;this.account=data.account||{...this.account,...data.patch};if(Number.isSafeInteger(data.patch?.pickaxeBroken))this.account.pickaxes.broken=data.patch.pickaxeBroken;this.training=data.training;this.clockOffset=(data.now||Date.now())-Date.now();this.emit('account',{...data,account:this.account});}
    if(op===OP.EGGS){this.eggs.set(data.zone,data);this.emit('eggs',data);}
    if(op===OP.ANIMALS){if(data.full)this.animals.clear();for(const id of data.removed)this.animals.delete(id);for(const a of data.animals)this.animals.set(a.id,{...a,receivedAt:performance.now(),roomTime:data.time});this.emit('animals',data);}
    if(op===OP.PASTURE){this.pastures.set(data.id,data);this.emit('pasture',data);}
    if(op===OP.EGG_DELTA)this.applyEggDelta(data);
    if(op===OP.GUARDS||op===OP.GUARD_STATES){
      // Unreliable frames may arrive out of order; Room time only advances within one baseline.
      if(op===OP.GUARD_STATES&&this.guardTime!==null&&this.guardTime!==undefined&&data.time<=this.guardTime)return;
      this.guardTime=data.time;this.guardFrames=data.guards;this.emit('guards',data);
    }
    if(op===OP.MOVES||op===OP.MOTIONS)this.emit('moves',data);
    if(op===OP.EVENT)this.emit('event',data);
    if(op===OP.PAYMENT_RESULT)this.emit('payment',data);
    if(op===OP.RECEIPT&&this.waiting?.id===data.id&&this.waiting.action==='offline-claim')this.traceOffline('receipt',data.id,data.reason);
    if(op===OP.RECEIPT){this.lastReceipt=data;this.actions?.receive(data);}
    if(op===OP.RECEIPT&&this.waiting?.id===data.id){const waiting=this.waiting;this.waiting=null;clearTimeout(waiting.timer);waiting.resolve(waiting.detailed?data:data.ok?data:false);}
  }
  // Merge one egg's dynamic fields into the last full zone frame, then reuse the full-frame path.
  // A delta for an unknown egg/generation is ignored; the next generation change resends the zone.
  applyEggDelta(delta){
    const frame=this.eggs.get(delta?.zone),incoming=delta?.egg;
    const index=frame?.eggs?.findIndex(e=>e.id===incoming?.id&&e.generation===incoming.generation)??-1;
    if(index<0){this.eggDeltaMisses=(this.eggDeltaMisses||0)+1;return;}
    const eggs=frame.eggs.slice();eggs[index]={...eggs[index],...incoming,spec:eggs[index].spec};
    const next={...frame,time:delta.time,titanicNextAt:delta.titanicNextAt,revision:delta.revision,eggs};
    this.eggs.set(next.zone,next);this.emit('eggs',next);
  }
  traceOffline(...args){try{this.offlineTrace?.(...args);}catch{}}
  command(action,value,{detailed=false}={}){
    const trace=(stage,id=0,reason='')=>{if(action==='offline-claim')this.traceOffline(stage,id,reason);};
    const fail=reason=>{trace('blocked',0,reason);return Promise.resolve(detailed?{ok:false,reason}:false);};
    if(this.waiting||!this.session?.ready)return fail(this.waiting?'WAITING':'NOT_READY');
    const retry=action==='offline-claim'&&this.session.pending?.action===action;
    if(!retry&&!this.session.intent(action,value))return fail('INTENT_BLOCKED');
    const id=retry?this.session.pending.id:this.session.revision;
    trace('sent',id);
    return new Promise(resolve=>{
      const waiting={id,action,resolve,detailed,timer:null};this.waiting=waiting;
      waiting.timer=setTimeout(()=>{
        if(this.waiting!==waiting)return;
        this.waiting=null;trace('timeout',id);resolve(detailed?{ok:false,reason:'TIMEOUT'}:false);
        try{Promise.resolve(this.session.recover()).catch(()=>{});}catch{}
      },12000);
      if(retry&&!this.session.retryPending?.(action)){
        clearTimeout(waiting.timer);this.waiting=null;resolve(detailed?{ok:false,reason:'NOT_READY'}:false);
      }
    });
  }
  now(){return Date.now()+this.clockOffset;}
  attack(value){return this.interactions===1?this.transient('egg-hit',value):this.command('egg-hit',value);}
  stopTraining(){return this.transient('training-stop');}
  transient(action,value){if(!this.session)return Promise.resolve(false);this.actions??=new TransientActions(this.session);return this.actions.send(action,value);}
  hold(value){
    const s=this.session;if(!s?.ready||!s.active||s.exiting||!s.room)return false;
    if(this.interactions!==1&&value&&typeof value==='object')value=value.id;
    try{s.room.sendReliable(OP.HOLD,new TextEncoder().encode(JSON.stringify(value)));return true;}catch{return false;}
  }
}
