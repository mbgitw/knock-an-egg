// Official local Mock, same Room source: two new clients and one legacy client (never declares
// capabilities). Measures received application bytes per message type; not WebRTC/mobile evidence.
import {spawn} from 'node:child_process';
import {readFile,writeFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
import {OnlineClient} from '@cysj/online-h5';
import {PastureSession} from '../public/online/session.js';
import {GameConnection} from '../public/online/game-connection.js';
import {OP} from '../public/online/protocol.js';
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms)),port=7355,peers=[];
const server=spawn(process.execPath,['server/mock/typescript/src/cli.mjs','--room','server/game/room.ts','--source-root','server/game','--sdk','server/typescript','--scenario','builda.room.local.json','--port',String(port)],{windowsHide:true,stdio:['ignore','pipe','pipe']});
let log='';const report={scope:'Official local Mock, three SDK identities (two new clients, one legacy). Application payload bytes only; excludes WebRTC/SCTP overhead and is not mobile evidence.'};
for(const pipe of [server.stdout,server.stderr])pipe.on('data',s=>log=(log+s).slice(-6000));
async function until(predicate,label,ms=8000){const end=performance.now()+ms;while(!predicate()&&performance.now()<end)await pause(25);assert.ok(predicate(),label);}
const name=Object.fromEntries(Object.entries(OP).map(([k,v])=>[v,k]));
const window_=()=>{for(const p of peers)p.bytes={};};
const summary=keys=>Object.fromEntries(peers.map(p=>[p.label,Object.fromEntries(keys.map(k=>[k,p.bytes[k]||{count:0,bytes:0}]))]));
try{
  let healthy=false;for(let i=0;i<100;i++){try{healthy=(await fetch(`http://127.0.0.1:${port}/health`)).ok;}catch{}if(healthy)break;await pause(100);}assert.ok(healthy,log);
  const config=JSON.parse(await readFile('public/online/config.json','utf8'));
  for(const [i,label] of ['hitter-new','spectator-new','spectator-legacy'].entries()){
    const client=new OnlineClient({gatewayUrl:`ws://127.0.0.1:${port}/ws`,gameId:config.gameId,defaultQueueName:config.defaultQueueName}),socket=client.createSocket(),connection=new GameConnection();
    const peer={label,connection,bytes:{},channels:{},baseline:{}};peers.push(peer);
    peer.receipts=[];const session=new PastureSession({socket,onMessage:(op,data)=>{if(op===OP.RECEIPT)peer.receipts.push(data);connection.receive(op,data);}});peer.session=session;connection.session=session;
    const receive=session.receive.bind(session);session.receive=m=>{const k=name[m.opCode]||String(m.opCode),e=peer.bytes[k]??={count:0,bytes:0};e.count++;e.bytes+=m.data?.length||0;(peer.channels[k]??=new Set()).add(m.channel);if(!session.ready){const t=peer.baseline[k]??={count:0,bytes:0};t.count++;t.bytes+=m.data?.length||0;}receive(m);};
    if(label.endsWith('legacy')){let room=null;Object.defineProperty(session,'room',{get:()=>room,set:v=>{room=v;if(v&&!v.legacyWrapped){const send=v.sendReliable.bind(v);v.sendReliable=(op,b)=>op===OP.CAPABILITIES?undefined:send(op,b);v.legacyWrapped=true;}}});}
    await socket.connect(client.restoreSession(`local:payload-${i+1}`));await session.start();await until(()=>session.ready,'baseline '+label);
    peer.position={...connection.players.find(p=>p.id===connection.self).position};
  }
  const [a,b,c]=peers;await pause(500);
  // Stand all three players in zone 1 so every guard frame carries the same nearby guards.
  const zone=a.connection.eggs.get(1),egg=zone.eggs.filter(e=>e.hp>=12).sort((e,f)=>e.hp-f.hp)[0];assert.ok(egg,'egg');
  const spot={x:egg.spec.position[0],y:egg.spec.floorY,z:egg.spec.position[2],yaw:0,vx:0,vy:0,vz:0,flags:0};
  for(const p of peers){p.position=spot;for(let k=0;k<4;k++){p.session.update(p.position);await pause(60);}}
  await pause(1000);window_();const idleStart=performance.now(),guardTimes=[];a.connection.observe((type,data)=>{if(type==='guards')guardTimes.push(data.time);});
  while(performance.now()-idleStart<5000){for(const p of peers)p.session.update(p.position);await pause(100);}
  const idleSeconds=(performance.now()-idleStart)/1000;
  // The Mock adds a fixed 50ms per setInterval tick; coarse OS timers make Room time run slower than wall time.
  report.mockRoomClockPerWallSecond=Math.round((guardTimes.at(-1)-guardTimes[0])/idleSeconds)/1000;
  report.guards={seconds:idleSeconds,received:summary(['GUARDS','GUARD_STATES'])};
  for(const p of peers){const g=p.bytes.GUARD_STATES||p.bytes.GUARDS;assert.ok(g?.count>=30,`${p.label} guard frames`);}
  assert.ok(!a.bytes.GUARDS&&!b.bytes.GUARDS&&!c.bytes.GUARD_STATES,'format by capability');
  assert.ok(a.connection.guardFrames.length>0&&a.connection.guardFrames.length===c.connection.guardFrames.length,'same guard set');
  window_();const hits=10,receipts=[],start=performance.now();
  for(let i=0;i<hits;i++){const delay=start+i*Math.ceil(560/Math.min(1,report.mockRoomClockPerWallSecond))-performance.now();if(delay>0)await pause(delay);for(const p of peers)p.session.update(p.position);receipts.push(a.connection.attack({egg:egg.id,generation:egg.generation}));}
  const results=await Promise.all(receipts);report.rawReceipts=a.receipts;assert.ok(results.every(r=>r?.ok),JSON.stringify(a.receipts));await pause(800);
  const hp=p=>p.connection.eggs.get(1).eggs.find(e=>e.id===egg.id).hp;
  assert.equal(hp(a),egg.hp-hits);assert.equal(hp(b),hp(a));assert.equal(hp(c),hp(a));
  assert.ok(a.connection.eggs.get(1).eggs.find(e=>e.id===egg.id).spec,'merged frame keeps static spec');
  report.eggHits={hits,hpBefore:egg.hp,hpAfter:hp(a),allClientsAgree:true,received:summary(['EGGS','EGG_DELTA'])};
  const per=(p,k)=>p.bytes[k]?Math.round(p.bytes[k].bytes/p.bytes[k].count):0;
  // Transactions: declared clients use control-reliable for intent, account and receipt; legacy keeps game-reliable.
  for(const p of peers){p.channels={};const r=await p.connection.command('offline-claim');p.claim=r===false?'rejected-no-reward':'ok';await pause(300);}
  const channels=p=>Object.fromEntries(['ACCOUNT','RECEIPT'].map(k=>[k,[...(p.channels[k]||[])]]));
  report.transactionChannels=Object.fromEntries(peers.map(p=>[p.label,{...channels(p),claim:p.claim}]));
  for(const p of [a,b])assert.deepEqual(channels(p),{ACCOUNT:['control_reliable'],RECEIPT:['control_reliable']},p.label);
  assert.deepEqual(channels(c),{ACCOUNT:['game_reliable'],RECEIPT:['game_reliable']});
  report.baselineBeforeReady=Object.fromEntries(peers.map(p=>[p.label,{totalBytes:Object.values(p.baseline).reduce((n,x)=>n+x.bytes,0),eggFramesBeforeReady:p.baseline.EGGS?.count||0}]));
  report.perMessage={guardJsonBytes:per(c,'GUARDS'),guardBinaryBytes:per(a,'GUARD_STATES'),zoneFrameBytes:per(c,'EGGS'),eggDeltaBytes:per(b,'EGG_DELTA')};
  report.passed=true;
}catch(error){report.passed=false;report.failure=String(error?.stack||error);report.log=log;}
finally{for(const p of peers)await p.session?.leave().catch(()=>{});server.kill();await writeFile('build/network-payload-mock.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));}
if(!report.passed)process.exitCode=1;
