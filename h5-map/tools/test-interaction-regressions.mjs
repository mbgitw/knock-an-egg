import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {readFile} from 'node:fs/promises';
import {TransientActions} from '../public/online/transient-actions.js';
import {installAnimalHold} from '../public/online/animal-hold.js';
import {installTrainingControl} from '../public/online/training-control.js';
import {GameConnection} from '../public/online/game-connection.js';
import {TreadmillSystem} from '../public/treadmill-system.js';
import {EggWorld} from '../public/gameplay/egg-world-runtime.js';
import {OP} from '../public/online/protocol.js';

await build({stdin:{contents:"export {PastureRoom} from './server/game/room.ts';export {createWorld,join,transact} from './server/game/world.ts';export {createEggEngine,withTitanic} from './server/game/eggs.ts';export {addAnimal,advanceAnimals} from './server/game/animals.ts';",resolveDir:process.cwd()},bundle:true,format:'esm',platform:'node',outfile:'build/interaction-room-test.mjs',plugins:[{name:'host',setup(b){b.onResolve({filter:/^@cysj\/room$/},()=>({path:'host',namespace:'host'}));b.onLoad({filter:/.*/,namespace:'host'},()=>({contents:`export class Room {handlers=new Map();sent=[];seed=12345;random(){return ((this.seed=(Math.imul(this.seed,1664525)+1013904223)>>>0)/4294967296);}onMessage(op,fn){this.handlers.set(op,fn);}unixTimeMillis(){return 0;}sendToUserJson(id,op,data){this.sent.push({id,op,data});}broadcastJson(op,data){this.sent.push({op,data});}log(){}} export const defineRoom=x=>x,decodeJson=b=>JSON.parse(new TextDecoder().decode(b)),encodeJson=x=>new TextEncoder().encode(JSON.stringify(x));`,loader:'js'}));}}]});
const {PastureRoom,createWorld,join,transact,createEggEngine,withTitanic,addAnimal,advanceAnimals}=await import('../build/interaction-room-test.mjs');
const bytes=x=>new TextEncoder().encode(JSON.stringify(x));
test('offline diagnostic packets cannot claim rewards; server records the real claim once even if logs fail',()=>{
  const {room,p,client}=roomFixture();const logs=[];
  room.log=(level,text)=>logs.push(text);
  p.account.pastureLedger.pending=100;
  const cash=p.account.cash;
  room.handlers.get(String(OP.OFFLINE_DIAGNOSTIC))(client,bytes({stage:'closed',hasReward:false,player:'forged'}));
  assert.equal(p.account.pastureLedger.pending,100);assert.equal(p.account.cash,cash);
  room.handlers.get(String(OP.INTENT))(client,bytes({id:1,action:'offline-claim'}));
  assert.equal(p.account.cash,cash+100);assert.equal(p.account.pastureLedger.pending,0);
  assert.ok(logs.some(text=>text.includes('"source":"server"')&&text.includes('"ok":true')));
  room.log=()=>{throw Error('diagnostic sink unavailable');};
  room.handlers.get(String(OP.INTENT))(client,bytes({id:1,action:'offline-claim'}));
  assert.equal(p.account.cash,cash+100);assert.equal(room.sent.at(-1).data.ok,true);
});
test('Room lets FastSwing prepare coexist with offline claim, but freezes during verified delivery',()=>{
  const {room,p,client}=roomFixture();
  p.account.pastureLedger.pending=100;
  p.account.commerce.intents.egg_3714065679={payId:'egg_3714065679',context:{},applied:false};
  room.handlers.get(String(OP.INTENT))(client,bytes({id:1,action:'offline-claim'}));
  assert.equal(room.sent.filter(x=>x.op===String(OP.RECEIPT)).at(-1).data.ok,true);
  assert.equal(p.account.pastureLedger.pending,0);
  p.account.pastureLedger.pending=50;p.account.commerce.delivery='unfulfilled';
  room.handlers.get(String(OP.INTENT))(client,bytes({id:2,action:'offline-claim'}));
  const receipt=room.sent.filter(x=>x.op===String(OP.RECEIPT)).at(-1).data;
  assert.equal(receipt.ok,false);assert.equal(receipt.reason,'PAY_BUSY');assert.equal(p.account.pastureLedger.pending,50);
});
test('a saved egg purchase context does not block offline claim or lose its frozen eggs',()=>{
  const {room,p,other,client}=roomFixture(),payId='egg_3715295845';
  p.account.pastureLedger.pending=100;
  p.account.commerce.intents[payId]={payId,context:{},eggs:[{id:'prepared-egg'}],applied:false};
  const cash=p.account.cash,otherCash=other.account.cash;
  room.handlers.get(String(OP.INTENT))(client,bytes({id:1,action:'offline-claim'}));
  assert.equal(room.sent.filter(x=>x.op===String(OP.RECEIPT)).at(-1).data.ok,true);
  assert.equal(p.account.cash,cash+100);assert.equal(p.account.pastureLedger.pending,0);
  assert.equal(p.account.commerce.intents[payId].eggs[0].id,'prepared-egg');assert.equal(other.account.cash,otherCash);
  p.account.commerce.delivery='paid-order';
  room.handlers.get(String(OP.INTENT))(client,bytes({id:1,action:'offline-claim'}));
  assert.equal(room.sent.filter(x=>x.op===String(OP.RECEIPT)).at(-1).data.ok,true,'replay returns recorded receipt');
  assert.equal(p.account.cash,cash+100,'replay did not grant twice');
  p.account.pastureLedger.pending=50;
  room.handlers.get(String(OP.INTENT))(client,bytes({id:2,action:'offline-claim'}));
  assert.equal(room.sent.filter(x=>x.op===String(OP.RECEIPT)).at(-1).data.reason,'PAY_BUSY');
  assert.equal(p.account.pastureLedger.pending,50);
});
test('an unpaid double-offline preparation no longer reserves or blocks the reward',()=>{
  const {room,p,client}=roomFixture(),payId='egg_3712778476';p.account.pastureLedger.pending=100;
  p.account.commerce.intents[payId]={payId,context:{amount:'100'},applied:false};
  room.handlers.get(String(OP.INTENT))(client,bytes({id:1,action:'offline-claim'}));
  assert.equal(room.sent.filter(x=>x.op===String(OP.RECEIPT)).at(-1).data.ok,true);
  assert.equal(p.account.pastureLedger.pending,0);
});
test('a prepared egg purchase permits world egg damage but a bound order or busy payment blocks it',()=>{
  const f=roomFixture(),payId='egg_3715295845',intent={payId,context:{},eggs:[{id:'prepared-egg'}],applied:false};
  f.p.account.commerce.intents[payId]=intent;f.room.unixTimeMillis=()=>100000;
  const request=id=>f.room.handlers.get(String(OP.INTENT))(f.client,bytes({id,action:'egg-hit',value:{egg:f.egg.spec.id,generation:f.egg.life.generation}}));
  const receipt=()=>f.room.sent.filter(x=>x.op===String(OP.RECEIPT)).at(-1).data;
  request(1);assert.equal(receipt().ok,true);assert.equal(f.egg.life.hp,99999);assert.equal(intent.eggs[0].id,'prepared-egg');
  f.p.account.commerce.delivery='pending';request(2);assert.equal(receipt().reason,'PAY_BUSY');assert.equal(f.egg.life.hp,99999);
  f.p.account.commerce.delivery=null;f.p.paymentBusy=true;request(3);assert.equal(receipt().reason,'PAY_BUSY');assert.equal(f.egg.life.hp,99999);
  f.p.paymentBusy=false;f.p.freeGiftBusy=true;request(4);assert.equal(receipt().reason,'PAY_BUSY');assert.equal(f.egg.life.hp,99999);
});
test('runtime diagnostic packets are tied to the Room identity and cannot alter gameplay',()=>{
  const {room,p,client}=roomFixture(),logs=[];
  room.unixTimeMillis=()=>100000;room.log=(level,text)=>logs.push(text);
  const cash=p.account.cash;
  room.handlers.get(String(OP.RUNTIME_DIAGNOSTIC))(client,bytes({kind:'webgl_lost',run:'12345678',stage:'ready',phase:'render',width:1600,height:900,dpr:1.8,player:'forged',cash:999999}));
  assert.equal(p.account.cash,cash);assert.equal(logs.length,1);
  const data=JSON.parse(logs[0].slice('client_runtime '.length));
  assert.equal(data.player,p.id);assert.equal(data.cash,undefined);
  room.handlers.get(String(OP.RUNTIME_DIAGNOSTIC))(client,new Uint8Array(513));
  assert.equal(logs.length,1);
});
const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve};};
function roomFixture(){
  const room=new PastureRoom();room.state=createWorld();room.save=()=>{};
  const engine=withTitanic(createEggEngine(()=>room.random(),()=>{}),null,()=>room.random());engine.initialize(null,0);for(let i=1;i<100;i++)engine.update(i);
  room.state.eggs=[...engine.slots.values()];Object.defineProperty(room,'eggEngine',{value:engine});
  const p=join(room.state,'a','a'),other=join(room.state,'b','b');for(const player of [p,other])player.loaded=player.active=true;
  const egg=engine.zoneEggs(1)[0];egg.life.hp=100000;
  p.position={...p.position,x:egg.spec.position[0],y:egg.spec.floorY,z:egg.spec.position[2]};room.state.elapsed=100000;
  const client={userId:p.id,seatId:p.seat,sendJson:(op,data)=>room.sent.push({id:p.id,op,data})};
  return {room,p,other,egg,client};
}
function hit(f,id,time,elapsed=time){f.room.state.elapsed=elapsed;f.room.unixTimeMillis=()=>time;f.room.eggHit(f.p,{id,value:{egg:f.egg.spec.id,generation:f.egg.life.generation}});return f.room.sent.filter(x=>x.op===String(OP.RECEIPT)).at(-1).data;}

test('normal and fast swings tolerate 50ms alternating arrivals without halving damage',()=>{
  for(const cooldown of [500,250]){
    const f=roomFixture();if(cooldown===250)f.p.account.commerce.owned.push('FastSwingOwned');
    for(let i=0;i<10;i++){const r=hit(f,i+1,100000+i*cooldown-(i%2?50:0));assert.equal(r.ok,true);assert.equal(r.damage,1);}
    assert.equal(f.egg.life.hp,99990);
  }
});
test('jitter allowance does not accumulate free swings; duplicate IDs and invalid distance do no damage',()=>{
  const f=roomFixture();let accepted=0;
  for(let i=0;i<600;i++)accepted+=Number(hit(f,i+1,100000+i*100).ok);
  assert.ok(accepted<=121,accepted);const hp=f.egg.life.hp;
  hit(f,600,160000);assert.equal(f.egg.life.hp,hp);
  f.p.position.x+=1000;assert.equal(hit(f,601,160500).ok,false);assert.equal(f.egg.life.hp,hp);
});
test('cooldown schedule survives player checkpoint serialization',()=>{
  const f=roomFixture();assert.ok(hit(f,1,100000).ok);
  Object.assign(f.p,JSON.parse(JSON.stringify(f.p)));
  assert.equal(hit(f,2,100050).ok,false);assert.equal(f.room.sent.at(-1).data.reason,'HIT_COOLDOWN');assert.equal(hit(f,3,100150).ok,true);
});
test('on-time swings are accepted when the overloaded Room tick clock runs at 0.55x and packets jitter',()=>{
  // Online logs: network_sample every 10s of elapsed arrived every 15-18s of wall time.
  for(const cooldown of [500,250]){
    const f=roomFixture();if(cooldown===250)f.p.account.commerce.owned.push('FastSwingOwned');
    const jitter=[0,180,20,0,150,0,60,170,0,90];
    for(let i=0;i<40;i++){const wall=100000+i*cooldown+jitter[i%10]*(cooldown/500);const r=hit(f,i+1,wall,100000+(wall-100000)*.55);assert.equal(r.ok,true,`swing ${i}`);}
    assert.equal(f.egg.life.hp,100000-40);
  }
});
test('six swings can await independent receipts; bounds, failures and pause discard stale feedback',async()=>{
  const sent=[],session={ready:true,active:true,revision:0,room:{sendControl:(op,b)=>sent.push(JSON.parse(new TextDecoder().decode(b)))}};
  const actions=new TransientActions(session,{limit:6});
  const pending=Array.from({length:6},()=>actions.send('egg-hit',{egg:'e',generation:0}));
  assert.equal(sent.length,6);assert.equal(await actions.send('egg-hit',{}),false);
  const urgent=actions.send('training-stop');assert.equal(sent.length,7);
  assert.equal(await actions.send('training-stop'),false);
  for(const [i,request] of sent.entries())actions.receive({id:request.id,ok:i%2===0,damage:4});
  assert.ok(await urgent);
  assert.deepEqual((await Promise.all(pending)).map(Boolean),[true,false,true,false,true,false]);
  const stale=actions.send('egg-hit',{});actions.clear();assert.equal(await stale,false);assert.equal(actions.pending.size,0);
  session.pending={id:20};assert.equal(await actions.send('egg-hit',{}),false);
  const stop=actions.send('training-stop');actions.receive({id:session.revision,ok:true});assert.ok(await stop);
});
test('legacy egg hit requests without a send flag still wait for the receipt and use server damage',async()=>{
  const wait=deferred();let health=0;
  const egg={spec:{id:'e'},life:{generation:0,hp:10},presentation:{showHealth(){health++;}}};
  const world={progress:{account:{online:{attack:()=>wait.promise}}},time:2};
  const result=EggWorld.prototype.hit.call(world,egg,1,99);assert.equal(health,0);
  wait.resolve({ok:true,damage:3});assert.equal((await result).damage,3);assert.equal(health,1);
  world.progress.account.online.attack=async()=>false;
  assert.equal(await EggWorld.prototype.hit.call(world,egg,2,99),null);assert.equal(health,1);
});
function holdFixture(){
  let now=0,observer;const sent=[];
  const animals={held:false,state:{hold:null},begin(){this.held=true;this.state.hold={id:'pet',elapsed:0};return true;},cancel(){this.held=false;this.state.hold=null;}};
  const connection={interactions:1,session:{ready:true,active:true},hold:value=>{sent.push(value);return true;},observe:fn=>observer=fn};
  installAnimalHold(animals,connection,{now:()=>now});
  return {animals,connection,sent,setTime:t=>now=t,ack:data=>observer('event',{kind:'hold-progress',sequence:1,id:'pet',active:true,elapsed:0,...data}),advance:()=>animals.state.advance(0,{}, {held:animals.held,blocked:false})};
}
test('hold progresses locally at once, but full local duration cannot display completion before server ownership',()=>{
  const h=holdFixture();h.animals.begin();assert.deepEqual(h.sent,[{id:'pet',sequence:1}]);
  h.setTime(500);h.advance();assert.equal(h.animals.state.hold.elapsed,.5);
  h.setTime(1400);h.advance();assert.equal(h.animals.state.hold.elapsed,1.32);
  h.ack({elapsed:1200});h.setTime(1600);h.advance();assert.ok(h.animals.state.hold.elapsed<1.4);
  h.ack({active:false,id:null,carrying:'pet'});assert.equal(h.animals.state.hold.elapsed,1.4);
});
test('hold rejection, pause and stale acknowledgements cannot finish a new gesture',()=>{
  const h=holdFixture();h.animals.begin();h.ack({active:false});assert.equal(h.animals.state.hold,null);
  h.animals.begin();h.ack({carrying:'pet'});assert.equal(h.animals.state.hold.elapsed,0);
  h.connection.session.active=false;h.advance();assert.equal(h.animals.state.hold,null);
});
test('Room reports hold start, cancellation, reset and completion; legacy string still works',()=>{
  const f=roomFixture(),{room,p,client}=f;const id='online:abcd:zone1-egg-0:0';
  addAnimal(room.state,{pet:{id,name:'Chick',zone:1},spec:{position:[-150,0,0],floorY:0}});p.position={...p.position,x:-150,y:0,z:0};room.state.elapsed+=9000;
  const send=data=>room.handlers.get(String(OP.HOLD))(client,bytes(data));
  send({id,sequence:1});assert.equal(room.sent.at(-1).data.active,true);
  room.state.elapsed+=650;advanceAnimals(room.state,650);room.holdProgress(p);assert.equal(room.sent.at(-1).data.active,false);
  send({id,sequence:2});for(let i=0;i<6;i++){room.state.elapsed+=250;send({id,sequence:2});advanceAnimals(room.state,250);}room.holdProgress(p);
  assert.equal(p.carrying,id);assert.equal(room.sent.at(-1).data.carrying,id);
  p.carrying=null;room.state.animals[id].carrier=null;send(id);assert.equal(p.hold.id,id);send(null);assert.equal(p.hold,null);
});
function trainingFixture(){
  const wait=deferred();let paused=false,can=true,stops=0;
  const t={account:{session:null},player:{training:null},canEnter:()=>can,enter(){this.account.session={kind:'own'};this.player.training={};return true;},exit(){this.account.session=null;this.player.training=null;}};
  const connection={session:{ready:true,active:true},command:()=>wait.promise,stopTraining:async()=>{stops++;return true;}};
  const control=installTrainingControl(t,connection,{paused:()=>paused});
  return {t,control,connection,wait,get stops(){return stops;},setPaused:v=>paused=v,setCan:v=>can=v};
}
test('training checks local eligibility before sending, and late start after pause is stopped',async()=>{
  const f=trainingFixture();f.setCan(false);assert.equal(await f.t.enter('own'),false);
  f.setCan(true);const entering=f.t.enter('own');f.setPaused(true);f.control.interrupt();f.wait.resolve({ok:true});
  assert.equal(await entering,false);assert.equal(f.t.player.training,null);assert.ok(f.stops>=1);
});
test('training can repeatedly enter and leave after resuming',async()=>{
  const f=trainingFixture();f.wait.resolve({ok:true});
  for(let i=0;i<3;i++){assert.equal(await f.t.enter('own'),true);f.t.exit(false);await Promise.resolve();await Promise.resolve();assert.equal(f.t.player.training,null);}
});
test('local training gate blocks awaiting input; activation captures touch before joystick stops bubbling',async()=>{
  globalThis.window={gameHostState:{paused:false}};globalThis.document={hidden:false};
  const t={account:{session:null},player:{motor:{grounded:true}},awaitingInput:true};
  assert.equal(TreadmillSystem.prototype.canEnter.call(t,'own'),false);
  const source=await readFile(new URL('../public/treadmill-system.js',import.meta.url),'utf8');
  assert.match(source,/addEventListener\('pointerdown', activate, \{capture:true,passive: true\}\)/);
});
test('training-stop bypasses ordinary intent cooldown and is accepted while inactive',()=>{
  const {room,p}=roomFixture();p.training={kind:'own',slot:0};p.lastIntent=room.state.elapsed;p.active=false;
  const result=transact(room.state,p,{id:1,action:'training-stop'},0);assert.equal(result.ok,true);assert.equal(p.training,null);
});
test('screen off clears authoritative training and broadcasts the cleared profile',()=>{
  const {room,p,client}=roomFixture();p.training={kind:'own',slot:0};
  room.handlers.get(String(OP.ACTIVE))(client,new Uint8Array([0]));
  assert.equal(p.training,null);const profile=room.sent.find(x=>x.data.kind==='players');assert.equal(profile.data.players.find(x=>x.id==='a').training,null);
  assert.ok(room.sent.some(x=>x.op===String(OP.ACCOUNT)&&x.data.training===null));
});
