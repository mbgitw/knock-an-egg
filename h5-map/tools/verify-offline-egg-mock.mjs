// Official local Mock; synthetic users and orders only.
import {spawn} from 'node:child_process';
import {readFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
import {OnlineClient} from '@cysj/online-h5';
import {PastureSession} from '../public/online/session.js';
import {GameConnection} from '../public/online/game-connection.js';
import {OP} from '../public/online/protocol.js';

const port=7356,peers=[],pause=ms=>new Promise(r=>setTimeout(r,ms));
const server=spawn(process.execPath,['server/mock/typescript/src/cli.mjs','--room','server/game/room.ts','--source-root','server/game','--sdk','server/typescript','--scenario','builda.room.local.json','--port',String(port)],{windowsHide:true,stdio:['ignore','pipe','pipe']});
let log='';for(const pipe of [server.stdout,server.stderr])pipe.on('data',data=>log=(log+data).slice(-4000));
const until=async(predicate,label,ms=8000)=>{const end=performance.now()+ms;while(!(await predicate())&&performance.now()<end)await pause(25);assert.ok(await predicate(),`${label}: ${log}`);};
try{
  await until(async()=>{try{return (await fetch(`http://127.0.0.1:${port}/health`)).ok;}catch{return false;}},'Mock health');
  const config=JSON.parse(await readFile('public/online/config.json','utf8'));
  async function join(identity){
    const client=new OnlineClient({gatewayUrl:`ws://127.0.0.1:${port}/ws`,gameId:config.gameId,defaultQueueName:config.defaultQueueName});
    const connection=new GameConnection(),socket=client.createSocket();
    const session=new PastureSession({socket,onMessage:(op,data)=>connection.receive(op,data),onStatus:()=>{}});connection.session=session;
    const peer={session,connection};peers.push(peer);
    await socket.connect(client.restoreSession(identity));await session.start();await until(()=>session.ready,'baseline');return peer;
  }
  const buyer=await join('local:offline-egg-buyer'),other=await join('local:offline-egg-other'),payId='egg_3715295845';
  const key=crypto.randomUUID();
  const prepared=new Promise((resolve,reject)=>{
    const off=buyer.connection.observe((type,data)=>{if(type==='payment'&&data.key===key){clearTimeout(timer);off();resolve(data);}});
    const timer=setTimeout(()=>{off();reject(Error('prepare timeout'));},8000);
    buyer.session.room.sendReliable(OP.PAYMENT,new TextEncoder().encode(JSON.stringify({key,action:'prepare',payId})));
  });
  assert.equal((await prepared).ok,true);
  await until(()=>!!buyer.connection.account.commerce.intents[payId],'saved purchase context');
  const result=await buyer.connection.command('offline-claim',undefined,{detailed:true});
  assert.equal(result.reason,'REJECTED','no pending reward; the egg context must not cause PAY_BUSY');
  assert.ok(buyer.connection.account.commerce.intents[payId]);
  assert.ok(!other.connection.account.commerce.intents[payId]);
  assert.equal(await buyer.session.leave(),true);
  const rejoined=await join('local:offline-egg-buyer');
  assert.ok(rejoined.connection.account.commerce.intents[payId],'context survives leaving and rejoining');
  const second=await rejoined.connection.command('offline-claim',undefined,{detailed:true});
  assert.equal(second.reason,'REJECTED');
  console.log(JSON.stringify({passed:true,scope:'local Mock: egg context, empty offline claim, two identities and rejoin'}));
}finally{
  for(const peer of peers)if(!peer.session.exiting)try{await peer.session.leave();}catch{}
  server.kill();
}
