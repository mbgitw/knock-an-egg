import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {GuardNavigation} from '../public/gameplay/guard-navigation.js';
import {insideGuardBox,guardMatrix} from '../public/gameplay/guard-brain.js';
import * as THREE from 'three';
import {readFile} from 'node:fs/promises';
await build({entryPoints:['server/game/guards.ts'],bundle:true,format:'esm',platform:'node',outfile:'build/guard-budget-test.mjs'});
const {createGuards,updateGuards,saveGuards}=await import('../build/guard-budget-test.mjs');
await build({entryPoints:['server/game/room.ts'],bundle:true,format:'esm',platform:'node',packages:'external',outfile:'build/room-budget-test.mjs'});
await build({entryPoints:['server/game/world.ts'],bundle:true,format:'esm',platform:'node',outfile:'build/world-budget-test.mjs'});
await build({entryPoints:['server/game/eggs.ts'],bundle:true,format:'esm',platform:'node',outfile:'build/eggs-budget-test.mjs'});
const {PastureRoom}=await import('../build/room-budget-test.mjs');
const {createWorld,join}=await import('../build/world-budget-test.mjs');
const {createEggEngine}=await import('../build/eggs-budget-test.mjs');
test('room-wide A* budget bounds disconnected searches across repeated patrol attempts',()=>{
 const width=60,heights=Array(width*width).fill(0);for(let z=0;z<width;z++)heights[z*width+30]=null;
 const nav=new GuardNavigation({x:0,z:0,step:1,width,depth:width,heights});let nearest=0,expanded=0;const n=nav.nearest.bind(nav),neighbors=nav.neighbors.bind(nav);nav.nearest=(...a)=>{nearest++;return n(...a);};nav.neighbors=(...a)=>{expanded++;return neighbors(...a);};nav.beginWork(600,4);
 for(let i=0;i<120;i++)nav.path({x:2,y:0,z:2},{x:55,y:0,z:55});
 assert.ok(expanded<=600);assert.ok(nearest<=8);assert.ok(nav.workBudget.visits>=0);assert.ok(nav.workBudget.searches>=0);
 nav.beginWork(600,4);assert.ok(nav.path({x:2,y:0,z:2},{x:5,y:0,z:5}).length>0);
});
test('allocation-free zone checks match the original inverse for source CFrames',async()=>{
 const data=JSON.parse(await readFile('public/gameplay/guards/catalog.json','utf8'));
 for(const g of data.guards)for(const margin of [-2,0,3])for(let k=0;k<30;k++){
 const part=g.zonePart,m=part.matrix,position={x:m[3]+(k-15)*4,y:m[7]+(k%3)-1,z:m[11]+(k%11-5)*7};const p=new THREE.Vector3().copy(position).applyMatrix4(guardMatrix(m).invert());
 const expected=Math.abs(p.x)<=part.size[0]/2+margin&&Math.abs(p.y)<=part.size[1]/2+2&&Math.abs(p.z)<=part.size[2]/2+margin;assert.equal(insideGuardBox(position,part,margin),expected);
 }
});
test('60 seconds of all guard patrols stay bounded and restore deterministically',()=>{
 let seed=17;const random=()=>{seed=(seed*1664525+1013904223)>>>0;return seed/4294967296;};let guards=createGuards(random,()=>{});let pops=0;
 for(let tick=0;tick<600;tick++){const work=updateGuards(guards,[],.1);assert.ok(work.pops<=600);pops+=work.pops;const saved=JSON.parse(JSON.stringify(saveGuards(guards)));const before=seed;guards=createGuards(random,()=>{},saved);assert.equal(seed,before);assert.deepEqual(saveGuards(guards),saved);}
 assert.equal(pops,0,'baked patrols must not launch runtime A*');
});
test('Room derived caches preserve checkpoint state and random sequence across 100 active ticks',()=>{
 let setupSeed=41;const setupRandom=()=>((setupSeed=(Math.imul(setupSeed,1664525)+1013904223)>>>0)/4294967296);
 const initial=createWorld(),eggEngine=createEggEngine(setupRandom,()=>{});eggEngine.initialize(null,0);
 initial.eggs=[...eggEngine.slots.values()];initial.guards=saveGuards(createGuards(setupRandom,()=>{}));
 for(let i=0;i<2;i++){const p=join(initial,`p${i}`,`s${i}`);p.loaded=p.active=true;}
 const makeRoom=()=>{const room=new PastureRoom();room.state=JSON.parse(JSON.stringify(initial));let seed=setupSeed;
   room.random=()=>((seed=(Math.imul(seed,1664525)+1013904223)>>>0)/4294967296);
   room.unixTimeMillis=()=>BigInt(1000+room.state.elapsed);room.log=()=>{};room.sendToUserJson=()=>{};room.sendToUserOn=()=>{};room.save=()=>{};
   return {room,seed:()=>seed};};
 const cached=makeRoom(),restored=makeRoom();
 for(let i=0;i<100;i++){
   for(const instance of [cached,restored]){for(const p of Object.values(instance.room.state.players))p.lastMove=instance.room.state.elapsed;instance.room.onTick(100);}
   // A migrated Room has no in-memory derived objects. Simulate that on every tick.
   // Migration always checkpoints first; live guards serialize there rather than every tick.
   restored.room.syncGuards();restored.room.clearDerivedState();
   if(i%10===9){cached.room.syncGuards();assert.deepEqual(JSON.parse(JSON.stringify(cached.room.state)),JSON.parse(JSON.stringify(restored.room.state)));assert.equal(cached.seed(),restored.seed());}
 }
});
test('authoritative room close clears readiness and retains its stable error for recovery UI',async()=>{
 const {PastureSession}=await import('../public/online/session.js');const events=new Map();let status;const s=new PastureSession({socket:{on:(name,fn)=>{events.set(name,fn);return()=>{};}},onStatus:x=>status=x});s.room={roomId:'r'};s.ready=true;s.baseline.add(101);s.pending={id:1};events.get('roomClosed')({roomId:'r',reason:'failed',errorCode:'ROOM_RESOURCE_BUDGET_EXCEEDED'});assert.equal(s.ready,false);assert.equal(s.room,null);assert.equal(s.baseline.size,0);assert.equal(s.pending,null);assert.equal(status.code,'ROOM_RESOURCE_BUDGET_EXCEEDED');assert.equal(s.lastClose.code,status.code);assert.equal(s.stage,'idle');
});
test('transient save read failures retry from the tick; only exhaustion or corruption is final',()=>{
 const run=(failures,value)=>{const room=new PastureRoom();room.state=createWorld();const eggs=createEggEngine(()=>.5,()=>{});eggs.initialize(null,0);room.state.eggs=[...eggs.slots.values()];
  const sent=[];let reads=0;room.random=()=>.5;room.unixTimeMillis=()=>1000n;room.log=()=>{};room.sendToUserJson=(id,op,data)=>sent.push({op,data});room.sendToUserOn=()=>{};room.broadcastJson=()=>{};room.save=()=>{};
  room.cloudLoadSnapshot=(_id,fn)=>{reads++;fn(reads<=failures?{status:'unavailable'}:{status:'ready',entries:value?[{key:'pasture_account_v1',live:true,value:{kind:'string',value}}]:[]});};
  room.onJoin({userId:'p',seatId:'s'});for(let i=0;i<400&&!room.state.players.p.loaded;i++)room.onTick(100);
  return {p:room.state.players.p,reads,fails:sent.filter(m=>m.data?.reason==='SAVE_LOAD_FAILED')};};
 const recovered=run(3);assert.equal(recovered.p.loaded,true);assert.equal(recovered.reads,4);assert.equal(recovered.fails.length,0);
 const exhausted=run(99);assert.equal(exhausted.p.loaded,false);assert.equal(exhausted.reads,6);assert.deepEqual(exhausted.fails.map(m=>m.data.final),[true]);
 const corrupt=run(0,'{not json');assert.equal(corrupt.reads,1);assert.deepEqual(corrupt.fails.map(m=>m.data.final),[true]);
});
test('profile and pasture broadcasts skip unchanged payloads; baselines still send',()=>{
 const room=new PastureRoom();room.state=createWorld();const a=join(room.state,'a','a'),b=join(room.state,'b','b');for(const p of [a,b])p.loaded=p.connected=true;
 const sent=[];room.broadcastJson=(op,data)=>sent.push({op,data,to:'*'});room.sendToUserJson=(id,op,data)=>sent.push({op,data,to:id});
 room.profiles();a.position={...a.position,x:a.position.x+5};room.profiles();assert.equal(sent.length,1,'movement alone does not rebroadcast profiles');
 a.account.plot.level++;room.profiles();assert.equal(sent.length,2);
 sent.length=0;room.pasture(a);room.pasture(a);assert.equal(sent.length,2,'one pasture to each player, not repeated');
 room.pasture(a,'b');assert.equal(sent.length,3,'targeted baseline always sends');
 room.onLeave({userId:'a',seatId:'a'});sent.length=0;const again=join(room.state,'a','a');again.loaded=again.connected=true;room.pasture(again);assert.ok(sent.some(m=>m.to==='b'),'a rejoining owner is broadcast again');
});
test('a lost receipt keeps movement flowing and the intent retrying',async()=>{
 const {PastureSession}=await import('../public/online/session.js');let now=0;const sent=[];
 const s=new PastureSession({socket:{on:()=>()=>{}},now:()=>now});
 s.room={roomId:'r',sendControl:(op,b)=>sent.push(op),sendReliable:(op)=>sent.push(op),sendUnreliable:(op)=>sent.push(op)};s.ready=true;s.stage='room_connected';s.motionEpoch=0;
 assert.equal(s.intent('treadmill-unlock',1),true);
 for(let t=0;t<20000;t+=100){now=t;s.update({x:t/100,y:0,z:0,yaw:0,flags:0});}
 assert.equal(s.stage,'room_connected');assert.ok(s.pending,'pending intent kept for idempotent retry');
 assert.ok(sent.filter(op=>op===2).length>=6,'intent keeps retrying');assert.ok(sent.filter(op=>op===1||op===8).length>10,'movement still uploads');
});
