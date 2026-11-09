// Same production Room source and official local SDK; no live account or payment calls.
import {spawn} from 'node:child_process';
import {build} from 'esbuild';
import {readFile,writeFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
import {OnlineClient} from '@cysj/online-h5';
import {PastureSession} from '../public/online/session.js';
import {GameConnection} from '../public/online/game-connection.js';
import {OP} from '../public/online/protocol.js';
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms)),port=7354,peers=[];
await build({entryPoints:['server/game/economy.ts'],bundle:true,format:'esm',platform:'node',outfile:'build/interaction-economy-mock.mjs'});
const {trainingPoint}=await import('../build/interaction-economy-mock.mjs');
const server=spawn(process.execPath,['server/mock/typescript/src/cli.mjs','--room','server/game/room.ts','--source-root','server/game','--sdk','server/typescript','--scenario','builda.room.local.json','--port',String(port)],{windowsHide:true,stdio:['ignore','pipe','pipe']});
let log='',report={scope:'Official local Mock and two independent SDK identities; not real mobile/WebRTC validation'};
for(const pipe of [server.stdout,server.stderr])pipe.on('data',s=>log=(log+s).slice(-6000));
async function until(predicate,label,ms=5000){const end=performance.now()+ms;while(!predicate()&&performance.now()<end)await pause(25);assert.ok(predicate(),label);}
async function move(peer,target){
  const from={...peer.position},distance=Math.hypot(target.x-from.x,target.z-from.z),duration=Math.max(200,distance/16*1000),start=performance.now();
  while(true){const t=Math.min(1,(performance.now()-start)/duration);peer.position={...from,x:from.x+(target.x-from.x)*t,y:from.y+(target.y-from.y)*t,z:from.z+(target.z-from.z)*t,flags:t<1?1:0};peer.session.update(peer.position);if(t===1)break;await pause(50);}
  await pause(150);
}
try{
  let healthy=false;for(let i=0;i<100;i++){try{healthy=(await fetch(`http://127.0.0.1:${port}/health`)).ok;}catch{}if(healthy)break;await pause(100);}assert.ok(healthy,log);
  const config=JSON.parse(await readFile('public/online/config.json','utf8'));
  for(let i=1;i<=2;i++){
    const client=new OnlineClient({gatewayUrl:`ws://127.0.0.1:${port}/ws`,gameId:config.gameId,defaultQueueName:config.defaultQueueName}),socket=client.createSocket(),connection=new GameConnection();
    const peer={connection,messages:[]};peers.push(peer);
    const session=new PastureSession({socket,onMessage:(op,data)=>{peer.messages.push({op,data});connection.receive(op,data);},onStatus:s=>{if(s.stage!=='room_connected')connection.actions?.clear();}});peer.session=session;connection.session=session;
    await socket.connect(client.restoreSession(`local:interaction-${i}`));await session.start();await until(()=>session.ready,'baseline');
    peer.position={...connection.players.find(p=>p.id===connection.self).position};
  }
  const [a,b]=peers;assert.equal(a.connection.interactions,1);
  assert.ok(await a.connection.command('treadmill-unlock'));
  const self=a.connection.players.find(p=>p.id===a.connection.self),point=trainingPoint({slot:self.slot,account:a.connection.account},'own',0);
  await move(a,point);
  const remoteTraining=()=>b.connection.players.find(p=>p.id===a.connection.self)?.training;
  for(let round=0;round<3;round++){
    await pause(150);a.session.update(a.position);
    assert.ok(await a.connection.command('training-start',{kind:'own',slot:0}));await until(()=>remoteTraining(),'spectator running');
    a.session.setActive(false);await until(()=>!remoteTraining(),'spectator stopped on screen off');assert.equal(a.connection.training,null);
    a.session.setActive(true);await pause(150);a.session.update(a.position);
    if(round===1){await a.session.recover();await until(()=>a.session.ready,'recovery baseline');}
  }
  report.training={pauseResumeCycles:3,remoteStop:true,recoveredBaseline:true};
  const egg=a.connection.eggs.get(1).eggs.filter(e=>e.hp>0&&e.hp<=4).sort((e,f)=>Math.hypot(e.spec.position[0]-a.position.x,e.spec.position[2]-a.position.z)-Math.hypot(f.spec.position[0]-a.position.x,f.spec.position[2]-a.position.z))[0];assert.ok(egg,'low health egg');
  await move(a,{x:egg.spec.position[0],y:egg.spec.floorY,z:egg.spec.position[2]});
  const pending=[],start=performance.now();
  for(let i=0;i<egg.hp;i++){const delay=start+i*500-performance.now();if(delay>0)await pause(delay);a.session.update(a.position);pending.push(a.connection.attack({egg:egg.id,generation:egg.generation}));}
  const receipts=await Promise.all(pending);assert.ok(receipts.every(r=>r?.ok),JSON.stringify(receipts));
  await until(()=>[...a.connection.animals.values()].some(p=>p.home.x===egg.spec.position[0]&&p.home.z===egg.spec.position[2]),'spawned animal');
  const animal=[...a.connection.animals.values()].find(p=>p.home.x===egg.spec.position[0]&&p.home.z===egg.spec.position[2]);
  report.hits={sent:pending.length,accepted:receipts.length,damage:receipts.reduce((n,r)=>n+r.damage,0)};
  await pause(6500);a.connection.hold({id:animal.id,sequence:1});
  const heldAt=performance.now();while(performance.now()-heldAt<2000&&!a.connection.animals.get(animal.id)?.carrier){a.session.update(a.position);await pause(250);a.connection.hold({id:animal.id,sequence:1});}
  await until(()=>a.connection.animals.get(animal.id)?.carrier===a.connection.self,'held animal');
  assert.ok(a.messages.some(m=>m.op===OP.EVENT&&m.data.kind==='hold-progress'&&m.data.active));
  assert.ok(a.messages.some(m=>m.op===OP.EVENT&&m.data.kind==='hold-progress'&&m.data.carrying===animal.id));
  await until(()=>b.connection.animals.get(animal.id)?.carrier===a.connection.self,'spectator carry');
  report.hold={acknowledged:true,completed:true,remoteCarrying:true};report.passed=true;
}catch(error){report.passed=false;report.failure=String(error);report.log=log;}
finally{for(const p of peers)await p.session?.leave();server.kill();await writeFile('build/interaction-mock-validation.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report));}
if(!report.passed)process.exitCode=1;
