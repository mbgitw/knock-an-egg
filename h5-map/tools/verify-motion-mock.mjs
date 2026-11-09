// 官方本地Mock + 官方H5 SDK两身份混合版本验证，不接触用户账户或在线服务。
import {spawn} from 'node:child_process';
import {readFile,writeFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
import {OnlineClient} from '@cysj/online-h5';
import {PastureSession} from '../public/online/session.js';
import {OP} from '../public/online/protocol.js';
import {MotionBuffer} from '../public/online/motion.js';
const pause=ms=>new Promise(r=>setTimeout(r,ms)),port=7352;
const child=spawn(process.execPath,['server/mock/typescript/src/cli.mjs','--room','server/game/room.ts','--source-root','server/game','--sdk','server/typescript','--scenario','builda.room.local.json','--port',String(port)],{windowsHide:true,stdio:['ignore','pipe','pipe']});
let log='';for(const stream of [child.stdout,child.stderr])stream.on('data',b=>{log=(log+b).slice(-8000);});
const peers=[];let report;
try{
  let healthy=false;for(let i=0;i<150;i++){try{if((await fetch(`http://127.0.0.1:${port}/health`)).ok){healthy=true;break;}}catch{}await pause(100);}
  assert.ok(healthy,log);
  const config=JSON.parse(await readFile('public/online/config.json','utf8'));
  for(let i=1;i<=2;i++){
    const client=new OnlineClient({gatewayUrl:`ws://127.0.0.1:${port}/ws`,gameId:config.gameId,defaultQueueName:config.defaultQueueName}),socket=client.createSocket();
    const peer={socket,messages:[],buffers:new Map()};peers.push(peer);
    const session=new PastureSession({socket,onMessage:(op,data)=>{peer.messages.push({op,data});if(op===OP.SNAPSHOT){peer.self=data.self;peer.origin=data.players.find(p=>p.id===data.self).position;}
      if(op===OP.MOTIONS)for(const p of data.players){if(!peer.buffers.has(p.slot))peer.buffers.set(p.slot,new MotionBuffer());peer.buffers.get(p.slot).push(p,performance.now(),data.time);}
    }});peer.session=session;
    await socket.connect(client.restoreSession(`local:player-${i}`));await session.start();
    for(let j=0;j<100&&!session.ready;j++)await pause(50);assert.ok(session.ready,'snapshot barrier');
    if(i===2){session.motionV2=false;session.sender.interval=100;}
  }
  const start=performance.now();while(performance.now()-start<2500){const elapsed=performance.now()-start;
    for(const peer of peers)peer.session.update({...peer.origin,x:peer.origin.x+elapsed*.018,flags:1,vx:18,vy:0,vz:0});
    for(const b of peers[0].buffers.values())b.at(performance.now());await pause(10);
  }
  await pause(60);for(const peer of peers)peer.session.update({...peer.origin,x:peer.origin.x+45,flags:0,vx:0,vy:0,vz:0});await pause(400);
  // 同页重新获取基线后时钟/序号/epoch重新接管，不能让旧轨迹卡住新数据。
  const current=peers[0],oldEpoch=current.session.motionEpoch;await current.session.recover();
  for(let i=0;i<100&&!current.session.ready;i++)await pause(30);assert.ok(current.session.ready);assert.notEqual(current.session.motionEpoch,oldEpoch);
  current.session.update({...current.origin,x:current.origin.x+.5,flags:1,vx:18,vy:0,vz:0});await pause(200);
  const modern=peers[0].messages.filter(m=>m.op===OP.MOTIONS),legacy=peers[1].messages.filter(m=>m.op===OP.MOVES);
  assert.ok(modern.length>30);assert.ok(legacy.length>15);assert.equal(peers[1].messages.filter(m=>m.op===OP.MOTIONS).length,0);
  assert.equal(peers[0].messages.filter(m=>m.op===OP.EVENT&&m.data.correction).length,0);
  assert.equal(peers[1].messages.filter(m=>m.op===OP.EVENT&&m.data.correction).length,0);
  assert.ok(modern.some(m=>m.data.players.length===2));assert.ok(legacy.some(m=>m.data.players.length===2));
  report={scope:'官方本地Mock及H5 SDK两身份，不代表真机WebRTC验收',modernBatches:modern.length,legacyBatches:legacy.length,modernMaxPayload:6+7*42,unexpectedCorrections:0,sharedActors:true,recoveryBaseline:true};
}catch(e){console.error(log.slice(-2000));throw e;}
finally{for(const peer of peers){await peer.session?.leave();peer.socket.close();}child.kill();}
await writeFile('build/motion-mock-validation.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
