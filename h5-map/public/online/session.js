import {OP,encodeMove,decodeMoves,encodeMotion,decodeMotions,decodeGuardStates,CLIENT_CAPS} from './protocol.js';
import {MotionSender} from './motion.js';
import {NativeRoomChat} from './native-room-chat.js';
const terminal=new Set(['cancelled','timeout','confirm_timeout','failed']);
const MAX_INTENT_ATTEMPTS=32;
// 单个生命周期对象贯穿加载、后台、重连和退出，不创建第二个未结算Ticket。
export class PastureSession {
  constructor({socket,onStatus=()=>{},onMessage=()=>{},now=()=>performance.now()}){
    Object.assign(this,{socket,onStatus,onMessage,now});this.stage='idle';this.ticket=null;this.room=null;this.key=null;this.admission=null;this.connecting=null;this.exiting=false;this.cleaning=null;
    this.sender=new MotionSender();this.pending=null;this.revision=0;this.ready=false;this.active=true;this.listeners=[];this.baseline=new Set();
    this.chat=new NativeRoomChat(this);
    const on=(name,fn)=>this.listeners.push(socket.on(name,fn));
    on('matchTicketUpdated',t=>{if(t.ticket_id===this.ticket?.ticket_id)this.ticket=t;});
    on('roomMessage',m=>{if(this.room&&m.roomId===this.room.roomId)this.receive(m);});
    for(const event of ['roomReconnecting','roomTransferStarted'])on(event,e=>{if(e.roomId===this.room?.roomId){this.ready=false;clearTimeout(this.snapshotTimer);this.baseline.clear();this.status('reconnecting');}});
    for(const event of ['roomReconnected','roomTransferCompleted'])on(event,e=>{if(e.roomId===this.room?.roomId){this.status('syncing');this.requestSnapshot();}});
    on('roomClosed',e=>{
      if(e.roomId!==this.room?.roomId)return;clearTimeout(this.snapshotTimer);this.chat.reset();this.lastClose={roomId:e.roomId,reason:e.reason,code:e.errorCode||'ROOM_CLOSED'};this.room=null;this.ticket=null;this.key=null;this.ready=false;this.pending=null;this.baseline.clear();this.fragments?.clear();this.animalBatch=null;
      if(this.exiting)return;
      this.status('idle',e.errorCode||e.reason);
      if(e.reason==='reconnect_timeout')queueMicrotask(()=>this.start().catch(()=>{}));
    });
    on('error',e=>{if(e.code==='ROOM_BANDWIDTH_LIMIT_EXCEEDED'||e.code==='ROOM_CHANNEL_BUSY')this.sender.failed(this.now(),e.code);this.onStatus({stage:this.stage,code:String(e.code),message:e.message});});
  }
  status(stage,code=''){this.stage=stage;this.onStatus({stage,code});}
  async start(){
    if(this.stage!=='idle'||this.room||this.ticket||this.admission||this.key||this.exiting)return;
    this.key=crypto.randomUUID();this.status('admitting');
    try{
      this.admission=this.socket.joinRoom('pasture-world',{allowCreate:true,idempotencyKey:this.key});
      this.ticket=await this.admission;this.admission=null;this.status('ticket_active');
      if(this.exiting)return;
      this.status('connecting_room');this.waitAbort=new AbortController();this.connecting=this.socket.waitAndConnectMatchedRoom(this.ticket,{idempotencyKey:this.key+'-connect',signal:this.waitAbort.signal});
      this.room=await this.connecting;this.ticket=null;this.connecting=null;
      if(this.exiting)return;
      this.status('syncing');this.requestSnapshot();
    }catch(error){
      this.status('connecting_room',String(error.code||'ROOM_CONNECT_FAILED'));
      this.admission=null;this.connecting=null;this.ready=false;
      if(error.code==='MATCH_ROLE_BUSY'&&!this.ticket&&!this.room){this.key=null;this.lastAdmissionCode=error.code;}
      if(this.exiting)return;
      // Failure cleanup is owned by leave(); do not race a second settle flow.
      // Admission结果不确定时保留key；重试只允许复用原操作。
      this.status(this.key?'recovery_required':'idle',String(error.code||'UNKNOWN_ERROR'));
    }
  }
  // A restored Room may resume from an older account sequence; restart the filter with each baseline request.
  requestSnapshot(){this.ready=false;this.baseline.clear();this.accountSeq=0;clearTimeout(this.snapshotTimer);this.snapshotAttempts=0;this.sendSnapshotRequest();}
  sendSnapshotRequest(){
    if(this.exiting||this.ready||!this.room)return;
    if(this.snapshotAttempts++>=90){this.status('recovery_required','BASELINE_TIMEOUT');return;}
    try{this.room.sendReliable(OP.SNAPSHOT_REQUEST,new Uint8Array());}catch(e){this.lastSendCode=e.code||'ROOM_CHANNEL_BUSY';}
    this.snapshotTimer=setTimeout(()=>this.sendSnapshotRequest(),2000);this.snapshotTimer.unref?.();
  }
  receive(message){
    if(this.exiting)return;
    let data;try{data=message.opCode===OP.MOVES?decodeMoves(message.data):message.opCode===OP.MOTIONS?decodeMotions(message.data):message.opCode===OP.GUARD_STATES?decodeGuardStates(message.data):JSON.parse(new TextDecoder().decode(message.data));}catch{return;}
    if(data?.__chunk){
      if(!Number.isInteger(data.count)||data.count<1||data.count>256||typeof data.text!=='string'||data.text.length>5000)return;
      // Channels are not ordered with each other, so reassemble per channel.
      const key=`${message.channel||''}:${message.opCode}`;
      this.fragments??=new Map();if(data.index===0)this.fragments.set(key,{count:data.count,next:0,text:''});
      const part=this.fragments.get(key);if(!part||part.next!==data.index||part.count!==data.count)return;
      part.text+=data.text;part.next++;if(part.next<part.count)return;this.fragments.delete(key);try{data=JSON.parse(part.text);}catch{return;}
    }
    // After the Room moves ACCOUNT to control-reliable, an older full account may still arrive on the game channel.
    if(message.opCode===OP.ACCOUNT&&Number.isSafeInteger(data?.seq)){if(data.seq<=(this.accountSeq||0))return;this.accountSeq=data.seq;}
    if(message.opCode===OP.ANIMALS){
      if(!Number.isInteger(data.count)||data.count<1||data.count>128||!Number.isInteger(data.index)||data.index<0||data.index>=data.count)return;
      if(data.index===0)this.animalBatch={...data,animals:[],removed:[],next:0};
      const batch=this.animalBatch;
      if(!batch||data.index!==batch.next||data.revision!==batch.revision||data.time!==batch.time||data.count!==batch.count)return;
      batch.animals.push(...data.animals);batch.removed.push(...data.removed);batch.next++;
      if(batch.next<batch.count)return;data=batch;this.animalBatch=null;
      if(data.full)this.baseline.add(OP.ANIMALS);
    }
    if(message.opCode===OP.SNAPSHOT){this.motionV2=data.motion?.version===2;this.motionEpoch=data.motion?.epoch??0;this.sender.interval=this.motionV2&&data.motion.hz===20?50:100;this.sender.last=null;this.sender.lastAt=-Infinity;const own=data.players?.find(p=>p.id===data.self);if(own)this.sender.sequence=(own.position.sequence+1)>>>0;
      // Room在每次SNAPSHOT前清空能力；声明后它才切换到二进制守卫、蛋增量和control通道回执。
      try{this.room?.sendReliable(OP.CAPABILITIES,new Uint8Array([CLIENT_CAPS]));}catch(e){this.lastSendCode=e.code||'ROOM_CHANNEL_BUSY';}}
    if(message.opCode===OP.EVENT&&data.kind==='position'){if(Number.isInteger(data.motionEpoch))this.motionEpoch=data.motionEpoch;this.sender.last=null;this.sender.lastAt=-Infinity;}
    if(message.opCode===OP.ACCOUNT)this.revision=Math.max(this.revision,data.revision||0);
    if([OP.SNAPSHOT,OP.ACCOUNT,OP.EGGS].includes(message.opCode)&&(message.opCode!==OP.ACCOUNT||data.account))this.baseline.add(message.opCode);
    if(message.opCode===OP.RECEIPT&&this.pending?.id===data.id){this.pending=null;if(this.ready)this.status('room_connected');}
    this.onMessage(message.opCode,data);
    // First render/reconnect must apply all three baselines before accepting input.
    if(!this.ready&&[OP.SNAPSHOT,OP.ACCOUNT,OP.EGGS,OP.ANIMALS].every(op=>this.baseline.has(op))){
      clearTimeout(this.snapshotTimer);this.ready=true;this.status('room_connected');this.setActive(this.active);
      this.chat.update();
      if(this.pending){this.pending.attempts=0;this.pending.nextAt=0;this.retryIntent();}
    }
  }
  setActive(active){this.active=!!active;if(this.room&&(!this.active||this.ready)){try{this.room.sendControl(OP.ACTIVE,new Uint8Array([this.active?1:0]));}catch(e){this.lastSendCode=e.code||'ROOM_CHANNEL_BUSY';}}}
  intent(action,value){
    if(!this.ready||!this.active||this.pending||this.exiting)return false;
    const request={id:++this.revision,action,value};this.pending={...request,attempts:0,nextAt:0};this.retryIntent();return true;
  }
  retryPending(action){
    if(!this.ready||!this.active||this.exiting||!this.room||this.pending?.action!==action)return false;
    this.pending.attempts=0;this.pending.nextAt=0;
    if(this.stage==='operation_pending')this.status('room_connected');
    this.retryIntent();return true;
  }
  // A missing receipt must not stop movement or freeze the world. Resending is idempotent
  // (Room replays the stored receipt by id), so keep retrying at a capped interval; after
  // ~2 minutes give up the slot and re-baseline, since the outcome is then unknown.
  retryIntent(){
    const p=this.pending;if(!p||!this.ready||!this.room||this.now()<p.nextAt)return;
    if(p.attempts>=MAX_INTENT_ATTEMPTS){this.pending=null;this.lastCode='RECEIPT_TIMEOUT';this.status('syncing','RECEIPT_TIMEOUT');this.requestSnapshot();return;}
    if(p.attempts>=3)this.lastCode='RECEIPT_TIMEOUT';
    // Transactions use control-reliable so they never queue behind baseline bulk on game-reliable.
    try{this.room.sendControl(OP.INTENT,new TextEncoder().encode(JSON.stringify({id:p.id,action:p.action,value:p.value})));}catch(e){this.sender.failed(this.now(),e.code);}
    p.attempts++;p.nextAt=this.now()+Math.min(4000,1000*2**(p.attempts-1));
  }
  update(position){
    if(!this.ready||!this.active||this.exiting||this.stage!=='room_connected')return;
    this.chat.update();this.retryIntent();const now=this.now(),p=this.sender.sample({...position,epoch:this.motionEpoch??0},now);if(!p)return;
    try{this.room.sendUnreliable(this.motionV2?OP.MOTION:OP.MOVE,this.motionV2?encodeMotion(p):encodeMove(p));this.sender.sent(p,now);}catch(e){this.sender.failed(now,e.code);}
  }
  async recover(){
    if(this.exiting)return false;
    if(this.room){this.status('syncing');this.requestSnapshot();return true;}
    if(this.stage!=='recovery_required'||!this.key||this.ticket||this.admission)return false;
    // Reuse the uncertain admission idempotency key; never open a second admission.
    this.status('admitting');
    try{
      this.admission=this.socket.joinRoom('pasture-world',{allowCreate:true,idempotencyKey:this.key});
      this.ticket=await this.admission;this.admission=null;
      if(this.exiting)return false;
      this.connecting=this.socket.waitAndConnectMatchedRoom(this.ticket,{idempotencyKey:this.key+'-connect'});
      this.room=await this.connecting;this.connecting=null;this.ticket=null;
      if(this.exiting)return false;
      this.status('syncing');this.requestSnapshot();return true;
    }catch(e){this.admission=null;this.connecting=null;this.status(this.ticket?'cleanup_failed':'recovery_required',String(e.code||'UNKNOWN_ERROR'));return false;}
  }
  async leave(){if(this.cleaning)return this.cleaning;this.exiting=true;this.ready=false;this.chat.reset();clearTimeout(this.snapshotTimer);this.waitAbort?.abort();this.status('cleaning');this.cleaning=this.cleanup();try{return await this.cleaning;}finally{this.cleaning=null;}}
  async cleanup(){
    try{
      if(this.admission){try{this.ticket=await this.admission;}finally{this.admission=null;}}
      else if(this.key&&!this.ticket&&!this.room&&!this.connecting){
        // Resolve the uncertain original admission; never mint a fresh key.
        this.admission=this.socket.joinRoom('pasture-world',{allowCreate:true,idempotencyKey:this.key});
        try{this.ticket=await this.admission;}finally{this.admission=null;}
      }
      if(this.connecting){try{this.room=await this.connecting;}catch{}finally{this.connecting=null;}}
      if(this.room){await this.room.leave();this.room=null;}
      else if(this.ticket){
        let t=await this.socket.settleMatchTicket(this.ticket);this.ticket=t;
        if(t.status==='room_ready'||t.status==='confirmed'){this.room=await this.socket.connectMatchedRoom(t);await this.room.leave();this.room=null;}
        else if(!terminal.has(t.status))throw Object.assign(Error(),{code:'MATCH_CANCEL_NOT_SETTLED'});
      }else if(this.key)throw Object.assign(Error(),{code:'ADMISSION_OUTCOME_UNKNOWN'});
      this.ticket=null;this.key=null;this.pending=null;for(const off of this.listeners)off();this.listeners=[];this.onDisposed?.();this.socket.close();this.status('closed');return true;
    }catch(e){this.status('cleanup_failed',String(e.code||'UNKNOWN_ERROR'));return false;}
  }
}
