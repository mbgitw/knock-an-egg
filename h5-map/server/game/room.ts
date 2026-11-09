import {logOffline} from './offline-diagnostics.ts';
import {logRuntimeHealth} from './runtime-health.ts';
import {freeGift} from './free-gift.ts';
import {acceptMotion,motionFrame} from './motion.ts';
import {Room,Client,defineRoom,decodeJson,encodeJson,type RoomContext,type RoomSnapshot,type ActivationReason} from '@cysj/room';
import {createWorld,join,disconnect,leave,acceptMove,transact,renewMotion,publicPlayer,type WorldState,type Player} from './world.ts';
import {OP,encodeMoves,encodeMotions,encodeGuardStates,CAP_GUARD_STATES,CAP_EGG_DELTA,CAP_CONTROL_RECEIPTS} from './rules/online/protocol.ts';
import {restoreState} from './rules/treadmill-state.ts';
import {restoreCommerce,redeemPaidCredits} from './rules/gameplay/commerce/state.ts';
import {createEggEngine,restoreEggEngine,compactEggs,hitEgg,zoneAt,withTitanic,saveTitanic} from './eggs.ts';
import {batStrike} from './combat.ts';
import {payment,paymentPending,paymentBlocksAction} from './payment.ts';
import {accountChanges} from './account-delta.ts';
import {addAnimal,holdAnimal,dropAnimal,advanceAnimals,visibleAnimals} from './animals.ts';
import {resumeEconomy,tickEconomy,plotBox,relocateAccount} from './economy.ts';
import {createGuards,saveGuards,updateGuards} from './guards.ts';
import {insideZone} from './rules/gameplay/zone-entry-state.ts';
import {guardFling} from './rules/gameplay/guard-brain.ts';
import guardCatalog from './data/guards.ts';

const SAVE='pasture_account_v1';
const DERIVED=Symbol('pasture-room-derived');
// 所有持续状态进入state；不广播其中的私人账户和幂等回执。
export class PastureRoom extends Room<any>{
  declare state:WorldState;
  get derived(){
    const state=this.state as any;
    if(!state[DERIVED])Object.defineProperty(state,DERIVED,{value:{eggEngine:null,eggSource:null,titanicSource:null,guards:null,guardSource:null},configurable:true});
    return state[DERIVED];
  }
  get eggEngine(){
    const cache=this.derived;
    const titanic=(this.state as any).titanic;
    if(!cache.eggEngine||cache.eggSource!==this.state.eggs||cache.titanicSource!==titanic){
      cache.eggEngine=withTitanic(restoreEggEngine(this.state.eggs,()=>this.random(),()=>{}),titanic,()=>this.random());
      cache.eggSource=this.state.eggs;cache.titanicSource=titanic;
    }
    return cache.eggEngine;
  }
  clearDerivedState(){delete (this.state as any)[DERIVED];}
  // Bounded counters survive recovery with the player; never affect game decisions.
  networkStats(p:Player){return (p as any).networkStats??={moves:0,accepted:0,activeMessages:0,intents:0,hits:0,hitAccepted:0};}
  logNetwork(players:Player[]){
    const state=this.state as any;if(this.state.elapsed<(state.nextNetworkLog??0))return;
    state.nextNetworkLog=this.state.elapsed+10000;
    for(const p of players){const n=this.networkStats(p);this.log('info',`network_sample ${JSON.stringify({player:p.id,active:p.active,loaded:p.loaded,moves:n.moves,accepted:n.accepted,activeMessages:n.activeMessages,intents:n.intents,hits:n.hits,hitAccepted:n.hitAccepted,hitCooldown:n.hitCooldown||0,rejected:n.rejected,corrections:n.corrections||0,correctionReason:n.correctionReason,packet:n.packet,connected:p.connected,sequence:p.lastSequence,position:[p.position.x,p.position.y,p.position.z].map(v=>Math.round(v*10)/10),runtime:n.runtime})}`);}
  }
  constructor(){
    super();
    this.onMessage(String(OP.CAPABILITIES),(client,bytes)=>{
      const p=this.player(client);if(!p||bytes.length!==1)return;
      const before=this.privateChannel(p);(p as any).caps=bytes[0]&(CAP_GUARD_STATES|CAP_EGG_DELTA|CAP_CONTROL_RECEIPTS);
      // Switching channels: restart the account diff chain with a full account on the new channel.
      if(p.loaded&&before!==this.privateChannel(p)){(p as any).accountSent=null;this.account(p);}
    });
    this.onMessage(String(OP.OFFLINE_DIAGNOSTIC),(client,bytes)=>{const p=this.player(client);if(!p||bytes.length>512)return;try{logOffline(this,p,decodeJson(bytes),'client');}catch{}});
    this.onMessage(String(OP.RUNTIME_DIAGNOSTIC),(client,bytes)=>{const p=this.player(client);if(!p||bytes.length>512)return;try{logRuntimeHealth(this,p,decodeJson(bytes));}catch{}});
    this.onMessage(String(OP.MOTION),(client,bytes)=>this.receiveMotion(client,bytes));
    this.onMessage(String(OP.APPEARANCE),(client,bytes)=>{const p=this.player(client);if(!p?.loaded||!p.active||bytes.length>500)return;try{const data:any=decodeJson(bytes);if(this.state.elapsed-((p as any).lastAppearance||-1000)<100)return;(p as any).lastAppearance=this.state.elapsed;const pet=[...p.account.pickaxes.pets,...p.account.mergeEggs].find((a:any)=>a.id===data.pet);const changed=(p as any).holding?.id!==pet?.id;(p as any).holding=pet||null;if(data.swing&&this.state.elapsed-((p as any).lastSwing||-1000)>=250){(p as any).lastSwing=this.state.elapsed;this.broadcastJson(String(OP.EVENT),{kind:'swing',id:p.id,weapon:!!p.account.weapons.equipped});}if(changed)this.profiles();}catch{}});
    this.onMessage(String(OP.PAYMENT),(client,bytes)=>{const p=this.player(client);if(!p||bytes.length>2048)return;try{const r:any=decodeJson(bytes);if(r?.action==='gift-prepare'||r?.action==='gift-claim')freeGift(this,p,r);else payment(this,p,r);}catch{}});
    this.onMessage(String(OP.HOLD),(client,bytes)=>{const p=this.player(client);if(!p||bytes.length>512)return;try{const data:any=decodeJson(bytes);const enhanced=data&&typeof data==='object'&&Number.isSafeInteger(data.sequence)&&data.sequence>0;if(enhanced)(p as any).holdSequence=data.sequence;holdAnimal(this.state,p,enhanced?data.id:data);if(enhanced)this.holdProgress(p);}catch{}});
    // Presentation movement is client-reported; only malformed, stale or excessive traffic is dropped.
    this.onMessage(String(OP.MOVE),(client,bytes)=>{const p=this.player(client);if(!p)return;const stats:any=this.networkStats(p);stats.moves++;stats.packet={length:bytes.length,version:bytes[0],typed:bytes instanceof Uint8Array};if(acceptMove(this.state,p,bytes,0,reason=>{stats.rejected=reason;})){stats.accepted++;const zone=zoneAt(p.position);if(zone!==p.zone){p.zone=zone;this.animalSnapshot(p);}}});
    this.onMessage(String(OP.ACTIVE),(client,bytes)=>{const p=this.player(client);if(!p||bytes.length!==1||bytes[0]>1)return;this.networkStats(p).activeMessages++;const before=p.active;p.active=bytes[0]===1;if(!p.active){const trained=!!p.training;p.training=null;p.trainingElapsed=0;p.hold=null;this.save(p);this.holdProgress(p);if(trained){this.account(p);this.profiles();}}else if(!before&&p.loaded&&!paymentPending(p)){resumeEconomy(p,Number(this.unixTimeMillis()));this.account(p);this.profiles();} });
    this.onMessage(String(OP.SNAPSHOT_REQUEST),(client,bytes)=>{const p=this.player(client);if(p&&bytes.length===0&&this.state.elapsed-p.lastSnapshot>=1000){p.lastSnapshot=this.state.elapsed;this.snapshot(p);}});
    this.onMessage(String(OP.INTENT),(client,bytes)=>{
      const p=this.player(client);if(!p||bytes.length>32768)return;
      let request:any;try{request=decodeJson(bytes);}catch{return;}
      this.networkStats(p).intents++;
      // Replay an already recorded claim before applying a new payment gate.
      // This never grants again and keeps a lost receipt idempotent.
      if(request?.action==='offline-claim'&&Number.isSafeInteger(request.id)&&p.receipts[String(request.id)]){this.receipt(p,{id:request.id,...p.receipts[String(request.id)],revision:p.revision});return;}
      if(request?.action!=='training-stop'&&paymentBlocksAction(p,request?.action)){if(request?.action==='offline-claim')logOffline(this,p,{stage:'server_result',id:request.id,reason:'PAY_BUSY',ok:false},'server');this.receipt(p,{id:request?.id,ok:false,reason:'PAY_BUSY'});return;}
      if(request?.action==='egg-hit'){this.eggHit(p,request);return;}
      if(request?.action==='animal-drop'){this.animalDrop(p,request);return;}
      if(request?.action==='bat-hit'){this.batHit(p,request);return;}
      const result=transact(this.state,p,request,Number(this.unixTimeMillis()),()=>this.random());
      if(request?.id===p.revision){p.dirty=true;this.save(p);}
      if(request?.action==='offline-claim')logOffline(this,p,{stage:'server_result',id:request.id,reason:result.reason,ok:result.ok,active:!!p.active,hasReward:p.account.pastureLedger.pending>0},'server');
      this.account(p);if(result.ok){this.profiles();this.pasture(p);}
      if(request?.action==='respawn'){this.sendToUserJson(p.id,String(OP.EVENT),{kind:'position',position:p.position,motionEpoch:(p as any).motionEpoch});this.animals();}
      this.receipt(p,{id:request?.id,...result,revision:p.revision});
    });
  }
  receiveMotion(client:Client,bytes:Uint8Array){
    const p=this.player(client);if(!p)return;
    const stats=this.networkStats(p);stats.moves++;
    if(acceptMotion(this.state,p,bytes,0,reason=>{stats.rejected=reason;})){
      stats.accepted++;const zone=zoneAt(p.position);
      if(zone!==p.zone){p.zone=zone;this.animalSnapshot(p);}return;
    }
  }
  onCreate(context:RoomContext){
    if(context.matchKey!=='pasture-world'||context.matchMode!=='room'||context.maxPlayers!==7||context.roster.some(s=>s.occupantKind!=='human'))throw Error('INVALID_WORLD_CONFIG');
    this.state=createWorld();this.state.joinable=true;this.state.publicEvent=null;this.state.titanic=null;this.state.namespace=Array.from(context.roomId).map(c=>c.charCodeAt(0).toString(16).padStart(4,'0')).join('');const engine=createEggEngine(()=>this.random(),()=>{});engine.initialize(null,0);this.state.eggs=[...engine.slots.values()];this.releaseRoom();
  }
  player(client:Client){const p=this.state.players[client.userId];return p?.seat===client.seatId?p:undefined;}
  onJoin(client:Client){
    const p=join(this.state,client.userId,client.seatId);
    if(p.loaded){this.snapshot(p);return;}
    this.cloudLoadSnapshot(p.id,result=>{
      if(this.state.players[p.id]!==p)return;
      if(result.status!=='ready'){this.receipt(p,{ok:false,reason:'SAVE_LOAD_FAILED'});return;}
      try{
        const value=result.entries.find(e=>e.key===SAVE&&e.live)?.value;
        if(value&&value.kind!=='string')throw Error('SAVE_SCHEMA');
        const saved=this.state.pendingSaves[p.id]?JSON.parse(this.state.pendingSaves[p.id].value):value?JSON.parse(value.value as string):null;
        p.account=restoreState(saved?.account??null,Number(this.unixTimeMillis()));p.account.baseId=saved?.account?.baseId||'Base_3';relocateAccount(p);
        p.revision=Number.isSafeInteger(saved?.revision)?saved.revision:0;p.receipts=saved?.receipts||{};p.loaded=true;resumeEconomy(p,Number(this.unixTimeMillis()));this.snapshot(p);this.profiles();this.pasture(p);
        // Persist legacy preparation migration even if the player makes no move.
        if(Object.keys(saved?.account?.commerce?.intents||{}).length){p.dirty=true;this.save(p);}
      }catch{this.receipt(p,{ok:false,reason:'SAVE_LOAD_FAILED'});}
    });
  }
  onDisconnect(client:Client){const p=this.player(client);if(p){dropAnimal(this.state,p,true);disconnect(p);this.save(p);this.profiles();this.animals();}}
  onReconnect(client:Client){const p=this.player(client);if(p){p.connected=true;p.active=false;this.snapshot(p);this.profiles();}}
  onLeave(client:Client){const p=this.player(client);if(!p)return;dropAnimal(this.state,p,true);this.save(p);leave(this.state,p.id);delete this.state.animalCache[p.id];this.profiles();this.animals();}
  onTick(deltaMs:number){
    this.state.elapsed+=Math.max(0,deltaMs);
    const state=this.state as any;state.gameplayPending=(state.gameplayPending??0)+Math.max(0,deltaMs);
    // 人物20Hz；守卫/蛋/经济保持原10Hz工作量，不随移动同步翻倍。
    if(state.gameplayPending>=100){const step=state.gameplayPending;state.gameplayPending=0;this.updateGameplay(step);}
    const players=Object.values(this.state.players).filter(p=>p.connected&&p.loaded);
    const changed=players.filter(p=>!(p as any).motionAwaiting&&this.state.elapsed-p.lastMove<=150);
    if(!changed.length)return;
    const enhanced=encodeMotions(changed.map(motionFrame),this.state.elapsed);
    for(const p of players)if((p as any).motionV2)this.sendToUserOn('state-unreliable',p.id,String(OP.MOTIONS),enhanced);
    if(this.state.elapsed-(state.legacyMotionAt??-100)>=100){state.legacyMotionAt=this.state.elapsed;const legacy=encodeMoves(changed.map(p=>({...p.position,slot:p.slot})),this.state.elapsed);for(const p of players)if(!(p as any).motionV2)this.sendToUserOn('state-unreliable',p.id,String(OP.MOVES),legacy);}
  }
  updateGameplay(deltaMs:number){
    for(const id of Object.keys(this.state.pendingSaves))this.flushSave(id);
    const players=Object.values(this.state.players).filter(p=>p.connected&&p.loaded);
    // 空房由平台宽限回收；不运行世界扫描或AI。
    if(!players.length)return;
    this.logNetwork(players);
    const now=Number(this.unixTimeMillis()),second=Math.floor(this.state.elapsed/1000)!==Math.floor((this.state.elapsed-deltaMs)/1000);
    for(const p of players){if(paymentPending(p))continue;const trainingBefore=JSON.stringify(p.training),count=p.account.growingEggs.length,credited=redeemPaidCredits(p.account,now);if(credited)p.dirty=true;tickEconomy(this.state,p,deltaMs/1000,now);if(trainingBefore!==JSON.stringify(p.training)){this.account(p);this.profiles();}if(credited||count!==p.account.growingEggs.length){this.account(p);this.save(p);this.pasture(p);}else if(second){this.account(p,true);if(Math.floor(this.state.elapsed/1000)%10===0)this.save(p);}}
    const cache=this.derived;
    const guards=cache.guards&&cache.guardSource===this.state.guards?cache.guards:createGuards(()=>this.random(),(guard,target)=>this.onGuardCatch(guard,target),this.state.guards);
    cache.guards=guards;
    updateGuards(guards,players.map(p=>({id:p.id,position:p.position,power:p.account.power,carrying:p.carrying?this.state.animals[p.carrying]?.pet:null,safe:guardCatalog.safeParts.some(part=>insideZone(part,p.position))||insideZone(plotBox(p),p.position),disabled:!p.active||(p as any).immuneUntil>this.state.elapsed})),deltaMs/1000);
    this.state.guards=saveGuards(guards);
    cache.guardSource=this.state.guards;
    this.sendGuards(players,guards);
    const holds=players.map(p=>({p,id:p.hold?.id,carrying:p.carrying}));
    const animals=advanceAnimals(this.state,Math.max(0,deltaMs));
    for(const h of holds)if(h.id!==h.p.hold?.id||h.carrying!==h.p.carrying)this.holdProgress(h.p);
    for(const p of animals.banked){this.save(p);this.account(p);this.sendToUserJson(p.id,String(OP.EVENT),{kind:'banked',pet:p.account.pickaxes.pets.at(-1)});}
    if(animals.changed)this.animals();
    const before=this.state.eggs.map(s=>s.generation);
    const engine=this.eggEngine,titanicBefore=JSON.stringify((this.state as any).titanic);engine.update(this.state.elapsed/1000);(this.state as any).titanic=saveTitanic(engine);cache.titanicSource=(this.state as any).titanic;
    const changedZones=new Set<number>();this.state.eggs.forEach((s,i)=>{if(s.generation!==before[i])changedZones.add(s.zone);});
    if(titanicBefore!==JSON.stringify((this.state as any).titanic))for(let zone=1;zone<=10;zone++)changedZones.add(zone);
    if(changedZones.size)this.broadcastEggs(players,[...changedZones]);
  }
  onGuardCatch(guard:any,target:any){
    const p=this.state.players[target.id];if(!p)return;dropAnimal(this.state,p);p.training=null;p.trainingElapsed=0;
    const fling=guardFling(guard.definition.config,guardCatalog.rules,()=>this.random());
    (p as any).stunnedUntil=this.state.elapsed+fling.duration*1000;(p as any).externalSpeed=fling.horizontal;(p as any).immuneUntil=(p as any).stunnedUntil+1000;
    this.profiles();this.account(p);this.sendToUserJson(p.id,String(OP.EVENT),{kind:'launch',fling,velocity:{x:Math.cos(fling.wobble)*fling.horizontal,y:fling.vertical,z:Math.sin(fling.wobble)*fling.horizontal}});this.animals();
  }
  onActivated(){this.clearDerivedState();this.state.animalCache={};this.state.saving={};for(const p of Object.values(this.state.players))(p as any).paymentBusy=false;}
  // eggEngine only restores methods/Map indexing over state.eggs. Caches carry no gameplay state.
  onCheckpoint():RoomSnapshot{return {schemaVersion:1,data:encodeJson(this.state)};}
  onRestore(context:RoomContext,snapshot:RoomSnapshot,reason:ActivationReason){super.onRestore(context,snapshot,reason);this.clearDerivedState();this.state.animalCache={};this.state.saving={};for(const p of Object.values(this.state.players))(p as any).paymentBusy=false;}
  snapshot(p:Player){if(!p.loaded)return;renewMotion(p);(p as any).caps=0;(p as any).motionV2=false;(p as any).motionAwaiting=false;(p as any).accountSent=null;this.sendToUserJson(p.id,String(OP.SNAPSHOT),{revision:this.state.revision,time:this.state.elapsed,self:p.id,interactions:1,motion:{version:2,hz:20,epoch:(p as any).motionEpoch},players:Object.values(this.state.players).filter(p=>p.loaded).map(publicPlayer)});this.account(p);this.animalSnapshot(p);this.eggSnapshot(p);for(const owner of Object.values(this.state.players))if(owner.loaded)this.pasture(owner,p.id);}
  animalSnapshot(p:Player,full=true){
    const visible=visibleAnimals(this.state,p),previous=full?new Map<string,string>():new Map<string,string>(Object.entries(this.state.animalCache[p.id]||{})),next=new Map<string,string>();
    const changed=visible.filter(a=>{const key=JSON.stringify([a.carrier,a.position,a.readyAt]);next.set(a.id,key);return previous.get(a.id)!==key;});
    const removed=[...previous.keys()].filter(id=>!next.has(id));this.state.animalCache[p.id]=Object.fromEntries(next);
    if(!full&&!changed.length&&!removed.length)return;
    const count=Math.max(1,Math.ceil(Math.max(changed.length,removed.length)/25));
    for(let index=0;index<count;index++)this.sendToUserJson(p.id,String(OP.ANIMALS),{time:this.state.elapsed,revision:this.state.revision,full,index,count,animals:changed.slice(index*25,(index+1)*25),removed:removed.slice(index*25,(index+1)*25)});
  }
  animals(){for(const p of Object.values(this.state.players))if(p.loaded&&p.connected)this.animalSnapshot(p,false);}
  animalDrop(p:Player,request:any){
    if(!Number.isSafeInteger(request.id)||request.id<1||request.id>0xffffffff)return;
    const prior=p.receipts[String(request.id)];
    if(prior){this.receipt(p,{id:request.id,...prior});return;}
    const ok=request.id>p.revision&&p.loaded&&p.active&&dropAnimal(this.state,p);
    const receipt={ok:!!ok,reason:ok?'ok':'DROP_REJECTED'};
    if(request.id>p.revision){p.revision=request.id;p.receipts[String(request.id)]=receipt;for(const k of Object.keys(p.receipts).slice(0,-64))delete p.receipts[k];}
    this.receipt(p,{id:request.id,...receipt});if(ok)this.animals();
  }
  // All zones are visible before entry. Keep the existing per-zone wire format.
  // The player's own zone goes first: the client becomes ready after the first EGGS frame plus animals.
  eggSnapshot(p:Player){const own=p.zone>=1&&p.zone<=10?p.zone:1;this.broadcastEggs([p],[own,...Array.from({length:10},(_,i)=>i+1).filter(z=>z!==own)]);}
  broadcastEggs(players:Player[],zones:number[]){
    const engine=this.eggEngine;
    for(const zone of new Set(zones)){
      const frame={zone,time:this.state.elapsed,titanicNextAt:engine.titanic.nextAt,revision:this.state.revision,eggs:compactEggs(engine,zone)};
      for(const p of players)if(p.connected&&p.loaded)this.sendToUserJson(p.id,String(OP.EGGS),frame);
    }
  }
  batHit(p:Player,request:any){
    if(!Number.isSafeInteger(request.id)||request.id<1||request.id>0xffffffff)return;
    const prior=p.receipts[String(request.id)];if(prior){this.receipt(p,{id:request.id,...prior});return;}
    if(request.id<=p.revision)return;
    const hit=batStrike(this.state,p),receipt={ok:!!hit,reason:hit?'ok':'HIT_REJECTED'};
    p.revision=request.id;p.receipts[String(request.id)]=receipt;
    for(const k of Object.keys(p.receipts).slice(0,-64))delete p.receipts[k];
    if(hit){this.sendToUserJson(hit.target.id,String(OP.EVENT),{kind:'launch',fling:hit.fling,velocity:hit.velocity});this.profiles();this.animals();}
    this.receipt(p,{id:request.id,...receipt});
  }
  eggHit(p:Player,request:any){
    const stats=this.networkStats(p);stats.hits++;
    if(!Number.isSafeInteger(request.id)||request.id<1||request.id>0xffffffff)return;
    const key=String(request.id),prior=p.receipts[key];
    if(prior){this.receipt(p,{id:request.id,...prior});return;}
    let egg=null,damage=0;
    const engine=this.eggEngine,cooldown=p.account.commerce?.owned.includes('FastSwingOwned')?250:500;
    // 冷却按墙钟：负载高时 onTick 的 elapsed 只走真实时间约 0.6 倍，会把按时挥击判成冷却中。
    // 速率按理论到达时间计：允许 0.8 个冷却的抖动，单次迟到不惩罚下一击，长期上限仍为每冷却一击。
    const now=Number(this.unixTimeMillis()),scheduled=(p as any).hitClockReadyAt,readyAt=Number.isFinite(scheduled)?scheduled:-Infinity;
    const candidate=engine.slots.get(request.value?.egg)?.egg||engine.titanic?.eggs.find((e:any)=>e.spec.id===request.value?.egg),beforeHp=candidate?.life.hp;
    const withinBudget=now+cooldown*.8>=readyAt;
    if(request.id>p.revision&&withinBudget){
      egg=hitEgg(engine,p,{...request.value,id:request.id},this.state.elapsed/1000,()=>this.random());
      if(egg){damage=beforeHp-egg.life.hp;p.lastHit=this.state.elapsed;(p as any).hitClockReadyAt=Math.max(now,readyAt)+cooldown;(this.state as any).titanic=saveTitanic(engine);this.derived.titanicSource=(this.state as any).titanic;}
    }
    const receipt={ok:!!egg,reason:egg?'ok':withinBudget?'HIT_REJECTED':'HIT_COOLDOWN',...(egg?{damage}: {})};
    if(egg)stats.hitAccepted++;else if(!withinBudget)stats.hitCooldown=(stats.hitCooldown||0)+1;
    if(request.id>p.revision){p.revision=request.id;p.receipts[key]=receipt;for(const k of Object.keys(p.receipts).slice(0,-64))delete p.receipts[k];}
    this.receipt(p,{id:request.id,...receipt});
    if(egg){
      if(!egg.life.alive){egg.pet.id=`online:${this.state.namespace}:${egg.pet.id}`;addAnimal(this.state,egg);p.account.pickaxes.broken++;p.dirty=true;this.save(p);this.account(p,true);this.animals();}
      this.state.revision++;this.broadcastEggDelta(Object.values(this.state.players),egg,engine);
    }
  }
  // 守卫只是表现：新客户端收不可靠二进制，丢包等下一帧；旧客户端保持原JSON。
  sendGuards(players:Player[],guards:any[]){
    for(const p of players){
      const near=guards.filter(g=>Math.hypot(g.position.x-p.position.x,g.position.z-p.position.z)<650).map(g=>({zone:g.definition.zone,position:g.position,yaw:g.yaw,state:g.state,speed:g.speed,timer:g.timer}));
      if((p as any).caps&CAP_GUARD_STATES)this.sendToUserOn('state-unreliable',p.id,String(OP.GUARD_STATES),encodeGuardStates(near,this.state.elapsed));
      else this.sendToUserJson(p.id,String(OP.GUARDS),{time:this.state.elapsed,guards:near});
    }
  }
  // 单蛋受击只发变化字段；位置/尺寸等静态spec已在整区帧中。代际变化仍走broadcastEggs。
  broadcastEggDelta(players:Player[],egg:any,engine:any=this.eggEngine){
    const zone=egg.spec.zone;let full:any=null;
    const delta={zone,time:this.state.elapsed,titanicNextAt:engine.titanic.nextAt,revision:this.state.revision,egg:{id:egg.spec.id,generation:egg.life.generation,hp:egg.life.hp,respawnAt:egg.life.respawnAt,spawnedAt:egg.spawnedAt,brokenAt:egg.brokenAt,endsAt:egg.endsAt,hatchSizeMult:egg.hatchSizeMult,pet:egg.pet||null,breaker:egg.breaker||null}};
    for(const p of players){
      if(!p.connected||!p.loaded)continue;
      if((p as any).caps&CAP_EGG_DELTA){this.sendToUserJson(p.id,String(OP.EGG_DELTA),delta);continue;}
      full??={zone,time:this.state.elapsed,titanicNextAt:engine.titanic.nextAt,revision:this.state.revision,eggs:compactEggs(engine,zone)};
      this.sendToUserJson(p.id,String(OP.EGGS),full);
    }
  }
  holdProgress(p:Player){
    const state=p as any;if(!state.holdSequence)return;
    const key=JSON.stringify([state.holdSequence,p.hold?.id??null,p.carrying]);
    if(key===state.holdProgressKey&&this.state.elapsed-(state.holdProgressAt??-1000)<250)return;
    state.holdProgressKey=key;state.holdProgressAt=this.state.elapsed;
    this.sendToUserJson(p.id,String(OP.EVENT),{kind:'hold-progress',sequence:state.holdSequence,id:p.hold?.id??null,active:!!p.hold,elapsed:p.hold?Math.max(0,this.state.elapsed-p.hold.startedAt):0,carrying:p.carrying});
  }

  pasture(owner:Player,target?:string){const data={id:owner.id,slot:owner.slot,level:owner.account.plot.level,pets:owner.account.plot.pets,growing:owner.account.growingEggs};for(const p of Object.values(this.state.players))if(p.loaded&&p.connected&&(!target||p.id===target))this.sendObject(p.id,OP.PASTURE,data);}
  sendObject(id:string,op:number,data:any,channel:'game-reliable'|'control-reliable'='game-reliable'){
    const send=(payload:any)=>channel==='game-reliable'?this.sendToUserJson(id,String(op),payload):this.sendToUserJsonOn(channel,id,String(op),payload);
    const text=JSON.stringify(data);if(new TextEncoder().encode(text).length<20000){send(data);return;}
    const count=Math.ceil(text.length/5000);for(let index=0;index<count;index++)send({__chunk:true,index,count,text:text.slice(index*5000,(index+1)*5000)});
  }
  // 交易回执与账户同属一条通道：声明能力的客户端走control-reliable，不排在蛋/牧场等大块基线之后。
  privateChannel(p:Player){return (p as any).caps&CAP_CONTROL_RECEIPTS?'control-reliable' as const:'game-reliable' as const;}
  receipt(p:Player,data:any){const channel=this.privateChannel(p);if(channel==='game-reliable')this.sendToUserJson(p.id,String(OP.RECEIPT),data);else this.sendToUserJsonOn(channel,p.id,String(OP.RECEIPT),data);}
  account(p:Player,delta=false){
    const before=(p as any).accountSent;
    const data=delta?{patch:{cash:p.account.cash,power:p.account.power,pastureLedger:p.account.pastureLedger,pickaxeBroken:p.account.pickaxes.broken}}:before?{changes:accountChanges(before,p.account)}:{account:p.account};
    // seq lets the client drop a stale full account that arrives late on the other channel after a switch.
    const seq=(p as any).accountSeq=((p as any).accountSeq||0)+1;
    this.sendObject(p.id,OP.ACCOUNT,{...data,seq,revision:p.revision,training:p.training,now:Number(this.unixTimeMillis())},this.privateChannel(p));
    if(!delta)(p as any).accountSent=JSON.parse(JSON.stringify(p.account));
  }
  profiles(){this.broadcastJson(String(OP.EVENT),{kind:'players',revision:this.state.revision,players:Object.values(this.state.players).filter(p=>p.loaded).map(publicPlayer)});}
  save(p:Player){
    if(!p.loaded||!p.dirty)return;
    if((p as any).paymentBusy||p.account.commerce.delivery)return;
    if(Object.keys(p.account.commerce.intents||{}).length)p.account.commerce=restoreCommerce(p.account.commerce);
    this.state.pendingSaves[p.id]={value:JSON.stringify({account:p.account,revision:p.revision,receipts:p.receipts}),nextAt:this.state.elapsed};p.dirty=false;this.flushSave(p.id);
  }
  flushSave(id:string){
    const pending=this.state.pendingSaves[id];if(!pending||this.state.saving[id]||pending.nextAt>this.state.elapsed)return;
    this.state.saving[id]=true;pending.nextAt=this.state.elapsed+5000;
    try{
      this.cloudEnqueue({roleId:id,key:SAVE,operation:'set',value:{kind:'string',value:pending.value}});
      this.cloudFlush(3000,result=>{
        delete this.state.saving[id];
        if(result.status==='applied'&&this.state.pendingSaves[id]?.value===pending.value)delete this.state.pendingSaves[id];
        else if(result.status!=='applied'&&this.state.players[id]?.connected)this.sendToUserJson(id,String(OP.EVENT),{kind:'save-pending'});
      });
    }catch{delete this.state.saving[id];}
  }
}
export default defineRoom(PastureRoom);
