import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {OP,CLIENT_CAPS,CAP_GUARD_STATES,CAP_EGG_DELTA,CAP_CONTROL_RECEIPTS,GUARD_BYTES,encodeGuardStates,decodeGuardStates} from '../public/online/protocol.js';
import {GameConnection} from '../public/online/game-connection.js';
import {PastureSession} from '../public/online/session.js';
import {TransientActions} from '../public/online/transient-actions.js';
import {installAnimalHold} from '../public/online/animal-hold.js';
import {EggWorld} from '../public/gameplay/egg-world-runtime.js';
import {EggPresentationState} from '../public/gameplay/egg-presentation-state.js';

await build({stdin:{contents:"export {PastureRoom} from './server/game/room.ts';export {createWorld,join} from './server/game/world.ts';export {createEggEngine,withTitanic} from './server/game/eggs.ts';",resolveDir:process.cwd()},bundle:true,format:'esm',platform:'node',outfile:'build/network-payload-test.mjs',plugins:[{name:'host',setup(b){b.onResolve({filter:/^@cysj\/room$/},()=>({path:'host',namespace:'host'}));b.onLoad({filter:/.*/,namespace:'host'},()=>({contents:`export class Room {handlers=new Map();sent=[];seed=12345;random(){return ((this.seed=(Math.imul(this.seed,1664525)+1013904223)>>>0)/4294967296);}onMessage(op,fn){this.handlers.set(op,fn);}unixTimeMillis(){return 0;}sendToUserJson(id,op,data){this.sent.push({id,op,data,bytes:new TextEncoder().encode(JSON.stringify(data)).length});}sendToUserOn(channel,id,op,data){this.sent.push({channel,id,op,data,bytes:data.length});}sendToUserJsonOn(channel,id,op,data){this.sent.push({channel,id,op,data,bytes:new TextEncoder().encode(JSON.stringify(data)).length});}broadcastJson(op,data){this.sent.push({op,data});}log(){}} export const defineRoom=x=>x,decodeJson=b=>JSON.parse(new TextDecoder().decode(b)),encodeJson=x=>new TextEncoder().encode(JSON.stringify(x));`,loader:'js'}));}}]});
const {PastureRoom,createWorld,join,createEggEngine,withTitanic}=await import('../build/network-payload-test.mjs');

function setup(){
  const room=new PastureRoom();room.state=createWorld();room.save=()=>{};
  const engine=withTitanic(createEggEngine(()=>room.random(),()=>{}),null,()=>room.random());engine.initialize(null,0);for(let i=1;i<100;i++)engine.update(i);
  room.state.eggs=[...engine.slots.values()];Object.defineProperty(room,'eggEngine',{value:engine});
  const a=join(room.state,'a','a'),b=join(room.state,'b','b');for(const p of [a,b])p.loaded=p.active=true;
  const egg=engine.zoneEggs(1)[0];egg.life.hp=100000;
  a.position={...a.position,x:egg.spec.position[0],y:egg.spec.floorY,z:egg.spec.position[2]};room.state.elapsed=100000;
  const client=p=>({userId:p.id,seatId:p.seat});
  return {room,engine,egg,a,b,client};
}
const guard=(zone,state='Chasing')=>({zone,state,position:{x:-1234.5,y:12.25,z:987.125},yaw:1.5,speed:16,timer:.25});

test('guard states round-trip in 26 bytes per guard and reject malformed frames',()=>{
  const frame=encodeGuardStates([guard(1),guard(10,'Returning')],123456);
  assert.equal(frame.length,6+2*GUARD_BYTES);
  const decoded=decodeGuardStates(Array.from(frame));
  assert.equal(decoded.time,123456);assert.deepEqual(decoded.guards.map(g=>[g.zone,g.state,g.position.x,g.timer]),[[1,'Chasing',-1234.5,.25],[10,'Returning',-1234.5,.25]]);
  assert.throws(()=>decodeGuardStates(frame.subarray(0,frame.length-1)),/INVALID_GUARDS/);
  const bad=frame.slice();bad[7]=99;assert.throws(()=>decodeGuardStates(bad),/INVALID_GUARDS/);
  assert.throws(()=>encodeGuardStates([{...guard(1),yaw:NaN}],0),/INVALID_GUARD/);
});
test('Room sends binary unreliable guards and egg deltas only after the client declares them',()=>{
  const {room,egg,a,b,client}=setup();
  room.handlers.get(String(OP.CAPABILITIES))(client(a),new Uint8Array([CLIENT_CAPS]));
  assert.equal(a.caps,CLIENT_CAPS);assert.equal(b.caps,undefined);
  const guards=Array.from({length:10},(_,i)=>({...guard(i+1),definition:{zone:i+1},position:{x:a.position.x,y:0,z:a.position.z}}));
  b.position={...a.position};room.sent=[];room.sendGuards([a,b],guards);
  const binary=room.sent.find(x=>x.id==='a'),legacy=room.sent.find(x=>x.id==='b');
  assert.equal(binary.channel,'state-unreliable');assert.equal(binary.op,String(OP.GUARD_STATES));assert.equal(binary.bytes,6+10*GUARD_BYTES);
  assert.equal(legacy.op,String(OP.GUARDS));assert.equal(legacy.channel,undefined);assert.ok(legacy.bytes>binary.bytes*3,`${legacy.bytes} vs ${binary.bytes}`);
  room.sent=[];room.eggHit(a,{id:1,value:{egg:egg.spec.id,generation:egg.life.generation}});
  const delta=room.sent.find(x=>x.op===String(OP.EGG_DELTA)),full=room.sent.find(x=>x.op===String(OP.EGGS));
  assert.equal(delta.id,'a');assert.equal(delta.data.egg.hp,99999);assert.equal(delta.data.egg.spec,undefined);
  assert.equal(full.id,'b');assert.ok(full.bytes>delta.bytes*10,`${full.bytes} vs ${delta.bytes}`);
  // A new snapshot (reconnect, possibly with an older client) clears capabilities until redeclared.
  room.snapshot(a);assert.equal(a.caps,0);
});
test('client merges egg deltas into the full zone frame and ignores unknown generations',()=>{
  const c=new GameConnection(),seen=[];c.observe((type,data)=>{if(type==='eggs')seen.push(data);});
  c.receive(OP.EGGS,{zone:3,time:10,titanicNextAt:900,revision:1,eggs:[{id:'x',generation:2,hp:9,spec:{typeId:'t'}},{id:'y',generation:0,hp:5,spec:{typeId:'u'}}]});
  c.receive(OP.EGG_DELTA,{zone:3,time:20,titanicNextAt:880,revision:2,egg:{id:'x',generation:2,hp:4,pet:null}});
  const frame=c.eggs.get(3);assert.equal(frame.time,20);assert.equal(frame.eggs[0].hp,4);assert.deepEqual(frame.eggs[0].spec,{typeId:'t'});assert.equal(frame.eggs[1].hp,5);assert.equal(seen.length,2);
  c.receive(OP.EGG_DELTA,{zone:3,time:30,revision:3,egg:{id:'x',generation:3,hp:1}});
  c.receive(OP.EGG_DELTA,{zone:7,time:30,revision:3,egg:{id:'x',generation:2,hp:1}});
  assert.equal(c.eggs.get(3).eggs[0].hp,4);assert.equal(seen.length,2);assert.equal(c.eggDeltaMisses,2);
});
test('client drops older unreliable guard frames and resets ordering on a new baseline',()=>{
  const c=new GameConnection(),times=[];c.observe((type,data)=>{if(type==='guards')times.push(data.time);});
  for(const time of [200,100,300,300])c.receive(OP.GUARD_STATES,{time,guards:[]});
  assert.deepEqual(times,[200,300]);
  c.receive(OP.SNAPSHOT,{self:'a',players:[]});c.receive(OP.GUARD_STATES,{time:50,guards:[]});assert.deepEqual(times,[200,300,50]);
});
test('session decodes binary guards and declares capabilities after every snapshot',()=>{
  const sent=[],received=[],socket={on:()=>()=>{}};
  const session=new PastureSession({socket,onMessage:(op,data)=>received.push([op,data])});
  session.room={roomId:'r',sendReliable:(op,b)=>sent.push([op,[...b]]),sendControl(){},sendUnreliable(){}};
  const json=x=>new TextEncoder().encode(JSON.stringify(x));
  session.receive({opCode:OP.SNAPSHOT,data:json({self:'a',players:[]})});
  session.receive({opCode:OP.SNAPSHOT,data:json({self:'a',players:[]})});
  assert.deepEqual(sent.filter(([op])=>op===OP.CAPABILITIES),[[OP.CAPABILITIES,[CLIENT_CAPS]],[OP.CAPABILITIES,[CLIENT_CAPS]]]);
  session.receive({opCode:OP.GUARD_STATES,data:encodeGuardStates([guard(2)],77)});
  assert.equal(received.at(-1)[0],OP.GUARD_STATES);assert.equal(received.at(-1)[1].guards[0].state,'Chasing');
  session.receive({opCode:OP.GUARD_STATES,data:new Uint8Array([9,9])});assert.equal(received.at(-1)[0],OP.GUARD_STATES);assert.equal(received.length,3);
});

function predictionWorld(attack){
  const sounds=[],effects=[];
  const spec={id:'e',zone:1,health:10,size:[4,4,4]};
  const egg={spec,center:{clone(){return this;}},life:{generation:0,hp:10},presentation:new EggPresentationState(spec,0,()=>.5)};
  const world={progress:{account:{online:{attack}}},time:1,feedback:{sound:n=>sounds.push(n),emit:n=>effects.push(n)},state:{eggs:[egg]},titanic:{},remove(){},add(){}};
  const frame=(hp,time=2)=>({zone:1,time,titanicNextAt:0,eggs:[{id:'e',generation:0,hp,brokenAt:time/1000,spec}]});
  return {world,egg,sounds,effects,frame};
}
test('a sent egg hit shakes, sounds and predicts health at once; the Room frame does not repeat it',async()=>{
  let resolve;const request=Object.assign(new Promise(r=>resolve=r),{sent:true});
  const f=predictionWorld(()=>request);
  const result=EggWorld.prototype.hit.call(f.world,f.egg,1,3);
  assert.equal(result.predicted,3);assert.deepEqual(f.sounds,['Impact']);assert.deepEqual(f.effects,['hit']);
  assert.equal(f.egg.presentation.hitAt,1);assert.equal(f.egg.presentation.hpTo,7);assert.equal(f.egg.life.hp,10);
  resolve({ok:true,damage:3});assert.equal((await result).damage,3);
  f.world.time=1.2;EggWorld.prototype.applyNetwork.call(f.world,f.frame(7));
  assert.deepEqual(f.sounds,['Impact']);assert.equal(f.egg.presentation.hitAt,1);assert.equal(f.egg.life.hp,7);assert.equal(f.egg.localHits,0);
  // A remote player's later hit still shakes and sounds.
  f.world.time=1.5;EggWorld.prototype.applyNetwork.call(f.world,f.frame(5));
  assert.deepEqual(f.sounds,['Impact','Impact']);assert.equal(f.egg.presentation.hitAt,1.5);
});
test('a rejected predicted hit settles the bar back; the breaking blow only shakes until Room hatches',async()=>{
  const f=predictionWorld(()=>Object.assign(Promise.resolve(false),{sent:true}));
  assert.equal(await EggWorld.prototype.hit.call(f.world,f.egg,1,3),null);
  assert.equal(f.egg.localHits,0);assert.equal(f.egg.presentation.hpTo,10);
  const kill=predictionWorld(()=>Object.assign(new Promise(()=>{}),{sent:true}));kill.egg.life.hp=2;
  EggWorld.prototype.hit.call(kill.world,kill.egg,1,5);
  assert.equal(kill.egg.presentation.hatchAt,null);assert.equal(kill.egg.presentation.hitAt,1);
  kill.world.time=1.1;EggWorld.prototype.applyNetwork.call(kill.world,kill.frame(0));
  assert.equal(kill.egg.presentation.hatchAt,1.1);assert.deepEqual(kill.sounds,['Impact']);
});
test('unsent egg hits and dead eggs show nothing locally',async()=>{
  const f=predictionWorld(()=>Object.assign(Promise.resolve(false),{sent:false}));
  const result=EggWorld.prototype.hit.call(f.world,f.egg,1,3);assert.equal(result.predicted,null);assert.deepEqual(f.sounds,[]);assert.equal(await result,null);
  f.egg.life.hp=0;assert.equal(EggWorld.prototype.hit.call(f.world,f.egg,1,3),null);
});
test('transient actions report whether the request actually left',async()=>{
  const session={ready:true,active:true,revision:0,room:{sendControl(){}}},actions=new TransientActions(session,{limit:1});
  const first=actions.send('egg-hit',{});assert.equal(first.sent,true);
  const blocked=actions.send('egg-hit',{});assert.equal(blocked.sent,false);assert.equal(await blocked,false);
  actions.clear();session.room.sendControl=()=>{throw Error('busy');};
  const failed=actions.send('egg-hit',{});assert.equal(failed.sent,false);assert.equal(await failed,false);
});
test('hold follows the Room back after a reset instead of finishing on the local clock',()=>{
  let now=0,observer;const animals={held:false,state:{hold:null},begin(){this.held=true;this.state.hold={id:'pet',elapsed:0};return true;},cancel(){this.held=false;this.state.hold=null;}};
  installAnimalHold(animals,{interactions:1,session:{ready:true,active:true},hold:()=>true,observe:fn=>observer=fn},{now:()=>now});
  const advance=()=>animals.state.advance(0,{},{held:animals.held,blocked:false});
  animals.begin();now=1000;advance();assert.equal(animals.state.hold.elapsed,1);
  observer('event',{kind:'hold-progress',sequence:1,id:'pet',active:true,elapsed:800});advance();assert.equal(animals.state.hold.elapsed,1);
  observer('event',{kind:'hold-progress',sequence:1,id:'pet',active:true,elapsed:0});advance();assert.equal(animals.state.hold.elapsed,0);
  now=3000;advance();assert.equal(animals.state.hold.elapsed,1.32);
  observer('event',{kind:'hold-progress',sequence:1,id:'pet',active:false,carrying:'pet'});advance();assert.equal(animals.state.hold.elapsed,1.4);
});

const json=x=>new TextEncoder().encode(JSON.stringify(x));
test('declared clients get ACCOUNT and RECEIPT on control-reliable; the switch restarts the account chain',()=>{
  const {room,a,b,client}=setup();
  room.snapshot(a);room.sent=[];
  room.handlers.get(String(OP.CAPABILITIES))(client(a),new Uint8Array([CLIENT_CAPS]));
  const restart=room.sent.find(x=>x.op===String(OP.ACCOUNT));
  assert.equal(restart.channel,'control-reliable');assert.ok(restart.data.account,'full account after switch');
  room.sent=[];room.handlers.get(String(OP.INTENT))({...client(a)},json({id:a.revision+1,action:'offline-claim'}));
  const account=room.sent.find(x=>x.op===String(OP.ACCOUNT)),receipt=room.sent.find(x=>x.op===String(OP.RECEIPT));
  assert.equal(account.channel,'control-reliable');assert.equal(receipt.channel,'control-reliable');assert.ok(account.data.seq>restart.data.seq);
  assert.ok(room.sent.indexOf(account)<room.sent.indexOf(receipt),'account precedes receipt on the same channel');
  // Undeclared clients keep the original game channel for both.
  room.sent=[];room.handlers.get(String(OP.INTENT))({...client(b)},json({id:b.revision+1,action:'offline-claim'}));
  assert.ok(room.sent.filter(x=>[String(OP.ACCOUNT),String(OP.RECEIPT)].includes(x.op)).every(x=>x.channel===undefined));
  // Re-declaring the same capabilities does not resend a full account.
  room.sent=[];room.handlers.get(String(OP.CAPABILITIES))(client(a),new Uint8Array([CLIENT_CAPS]));assert.equal(room.sent.length,0);
});
test('session sends intents on control, drops stale account sequences and reassembles chunks per channel',()=>{
  const sent=[],received=[];const session=new PastureSession({socket:{on:()=>()=>{}},onMessage:(op,data)=>received.push([op,data])});
  session.room={roomId:'r',sendReliable:(op)=>sent.push(['reliable',op]),sendControl:(op)=>sent.push(['control',op]),sendUnreliable(){}};
  session.requestSnapshot();
  session.receive({opCode:OP.ACCOUNT,channel:'control_reliable',data:json({seq:5,account:{cash:'2'}})});
  session.receive({opCode:OP.ACCOUNT,channel:'game_reliable',data:json({seq:4,account:{cash:'1'}})});
  assert.deepEqual(received.filter(([op])=>op===OP.ACCOUNT).map(([,d])=>d.seq),[5]);
  const text=JSON.stringify({seq:7,account:{cash:'x'.repeat(30)}}),half=Math.ceil(text.length/2);
  session.receive({opCode:OP.ACCOUNT,channel:'control_reliable',data:json({__chunk:true,index:0,count:2,text:text.slice(0,half)})});
  session.receive({opCode:OP.ACCOUNT,channel:'game_reliable',data:json({__chunk:true,index:0,count:2,text:'{"seq":6,'})});
  session.receive({opCode:OP.ACCOUNT,channel:'control_reliable',data:json({__chunk:true,index:1,count:2,text:text.slice(half)})});
  assert.equal(received.at(-1)[1].seq,7);
  // A new baseline (e.g. Room restored from an older checkpoint) accepts a lower sequence again.
  session.requestSnapshot();session.receive({opCode:OP.ACCOUNT,channel:'control_reliable',data:json({seq:1,account:{}})});assert.equal(received.at(-1)[1].seq,1);
  session.ready=true;session.active=true;assert.equal(session.intent('offline-claim'),true);assert.deepEqual(sent.at(-1),['control',OP.INTENT]);
});
test('egg baseline keeps its fields, rounds display coordinates, omits empty values and sends the player zone first',()=>{
  const {room,engine,a}=setup();a.zone=4;room.sent=[];room.eggSnapshot(a);
  const frames=room.sent.filter(x=>x.op===String(OP.EGGS));assert.deepEqual(frames.map(x=>x.data.zone),[4,1,2,3,5,6,7,8,9,10]);
  const total=frames.reduce((n,x)=>n+x.bytes,0);assert.ok(total<55000,`${total} bytes`);
  const sample=frames[0].data.eggs[0],source=engine.zoneEggs(4)[0];
  assert.deepEqual(Object.keys(sample.spec).sort(),['band','floorY','health','position','sizeMult','typeId','yaw']);
  assert.ok(sample.spec.position.every((v,i)=>Math.abs(v-source.spec.position[i])<=.0005));
  assert.equal('pet' in sample,false);assert.equal('breaker' in sample,false);
  // Room-side range checks still use the unrounded position.
  assert.notDeepEqual(source.spec.position,sample.spec.position);
  room.sent=[];room.snapshot(a);const order=room.sent.map(x=>x.op);assert.ok(order.indexOf(String(OP.ANIMALS))<order.indexOf(String(OP.EGGS)));
});
