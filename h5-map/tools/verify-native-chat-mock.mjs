// Official SDK + same-source local Room, with the SDK's documented test-only host bridge.
// This checks membership lifecycle; it does not send messages or emulate the native chat UI.
import {spawn} from 'node:child_process';
import {readFile,writeFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
import {OnlineClient} from '@cysj/online-h5';
import {PastureSession} from '../public/online/session.js';
import {CHAT_TEAM_ID} from '../public/online/native-room-chat.js';
const wait=ms=>new Promise(r=>setTimeout(r,ms)),port=7356;
const server=spawn(process.execPath,['server/mock/typescript/src/cli.mjs','--room','server/game/room.ts','--source-root','server/game','--sdk','server/typescript','--scenario','builda.room.local.json','--port',String(port)],{windowsHide:true,stdio:['ignore','pipe','pipe']});
let log='',session;for(const pipe of [server.stdout,server.stderr])pipe.on('data',s=>log=(log+s).slice(-3000));
const report={scope:'Official local Room/SDK plus injected host bridge, not native App UI or real IM',cycles:[]};
async function until(fn,label){for(let i=0;i<100&&!fn();i++)await wait(50);assert.ok(fn(),label);}
try{
  let healthy=false;for(let i=0;i<100;i++){try{healthy=(await fetch(`http://127.0.0.1:${port}/health`)).ok;}catch{}if(healthy)break;await wait(100);}assert.ok(healthy,log);
  const config=JSON.parse(await readFile('public/online/config.json','utf8'));
  for(let round=0;round<3;round++){
    const calls=[];let release,subscribed=0,unsubscribed=0;
    const bridge={available:()=>true,subscribe:()=>{subscribed++;return()=>unsubscribed++;},request:async(command,params)=>{calls.push({command,...params});if(round===2&&command==='joinChatGroup')await new Promise(resolve=>release=resolve);return {ok:true};}};
    const client=new OnlineClient({gatewayUrl:`ws://127.0.0.1:${port}/ws`,gameId:config.gameId,defaultQueueName:config.defaultQueueName,chatGroupHostBridge:bridge}),socket=client.createSocket();
    session=new PastureSession({socket});await socket.connect(client.restoreSession('local:native-chat-audit'));await session.start();
    await until(()=>session.ready,'game ready');await until(()=>calls.some(c=>c.command==='joinChatGroup'),'native group join');
    const roomId=session.room.roomId;assert.deepEqual(calls[0],{command:'joinChatGroup',groupId:roomId,teamId:CHAT_TEAM_ID});
    if(round<2){
      await until(()=>session.chat.current?.status==='joined','chat joined');session.setActive(false);session.setActive(true);await session.recover();await until(()=>session.ready,'recovered baseline');
      assert.equal(calls.filter(c=>c.command==='joinChatGroup').length,1);
    }
    assert.equal(await session.leave(),true);assert.equal(session.chat.current,null);
    release?.();await until(()=>calls.some(c=>c.command==='quitChatGroup'),'SDK cleans up native group');
    assert.deepEqual(calls.at(-1),{command:'quitChatGroup',groupId:roomId,teamId:CHAT_TEAM_ID});assert.equal(subscribed,unsubscribed);
    report.cycles.push({round:round+1,joinedCorrectRoom:true,sharedTeam:CHAT_TEAM_ID,quitAutomatically:true,lateJoin:round===2,subscriptionsReleased:true});session=null;
  }
  report.passed=true;
}catch(error){report.passed=false;report.failure=String(error);report.log=log;}
finally{if(session)await session.leave();server.kill();await writeFile('build/native-chat-mock-validation.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report));}
if(!report.passed)process.exitCode=1;
