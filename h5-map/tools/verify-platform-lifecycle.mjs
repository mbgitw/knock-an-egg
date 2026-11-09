import {spawn} from 'node:child_process';
import {readFile,writeFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
import {OnlineClient} from '@cysj/online-h5';
import {PastureSession} from '../public/online/session.js';
const wait=ms=>new Promise(r=>setTimeout(r,ms)),port=7353;
const server=spawn(process.execPath,['server/mock/typescript/src/cli.mjs','--room','server/game/room.ts','--source-root','server/game','--sdk','server/typescript','--scenario','builda.room.local.json','--port',String(port)],{windowsHide:true,stdio:['ignore','pipe','pipe']});
let log='',session;for(const pipe of [server.stdout,server.stderr])pipe.on('data',s=>{log=(log+s).slice(-3000);});
try{
  let ready=false;for(let i=0;i<100;i++){try{ready=(await fetch(`http://127.0.0.1:${port}/health`)).ok;}catch{}if(ready)break;await wait(100);}assert.ok(ready,log);
  const config=JSON.parse(await readFile('public/online/config.json','utf8'));
  for(let round=0;round<2;round++){
    const client=new OnlineClient({gatewayUrl:`ws://127.0.0.1:${port}/ws`,gameId:config.gameId,defaultQueueName:config.defaultQueueName}),socket=client.createSocket();
    session=new PastureSession({socket,onStatus:s=>console.log('local stage',s.stage,s.code)});await socket.connect(client.restoreSession('local:lifecycle-audit'));await session.start();
    for(let i=0;i<100&&!session.ready;i++)await wait(50);assert.equal(session.ready,true,JSON.stringify({stage:session.stage,baseline:[...session.baseline],log}));
    session.setActive(false);assert.equal(session.active,false);session.setActive(true);await session.recover();
    for(let i=0;i<100&&!session.ready;i++)await wait(50);assert.equal(session.ready,true,JSON.stringify({stage:session.stage,baseline:[...session.baseline],log}));
    assert.equal(await session.leave(),true);assert.equal(session.stage,'closed');assert.equal(session.room,null);assert.equal(session.key,null);session=null;
  }
  await writeFile('build/platform-lifecycle-validation.json',JSON.stringify({scope:'Official local Mock, not real WebRTC',sameIdentityRounds:2,baselineRecovery:true,confirmedLeave:true,roleBusy:false},null,2));
  console.log('Official Mock: same identity entered, recovered baseline, confirmed leave and re-entered twice.');
}finally{if(session)await session.leave();server.kill();}
