// Official local Room Mock with two SDK identities; no real payment is opened.
import {spawn} from 'node:child_process';
import {OnlineClient} from '@cysj/online-h5';
import {PastureSession} from '../public/online/session.js';
import {GameConnection} from '../public/online/game-connection.js';
import {OP} from '../public/online/protocol.js';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms)),port=7355,peers=[];
const server=spawn(process.execPath,['server/mock/typescript/src/cli.mjs','--room','server/game/room.ts','--source-root','server/game','--sdk','server/typescript','--scenario','builda.room.local.json','--port',String(port)],{windowsHide:true,stdio:['ignore','pipe','pipe']});
let log='';for(const pipe of [server.stdout,server.stderr])pipe.on('data',data=>log=(log+data).slice(-4000));
const until=async(predicate,label,ms=8000)=>{const end=performance.now()+ms;while(!(await predicate())&&performance.now()<end)await pause(25);assert.ok(await predicate(),`${label}: ${log}`);};
let passed=false;
try{
  await until(async()=>{try{return (await fetch(`http://127.0.0.1:${port}/health`)).ok;}catch{return false;}},'Mock health');
  const config=JSON.parse(await readFile('public/online/config.json','utf8'));
  for(let i=1;i<=2;i++){
    const client=new OnlineClient({gatewayUrl:`ws://127.0.0.1:${port}/ws`,gameId:config.gameId,defaultQueueName:config.defaultQueueName});
    const connection=new GameConnection(),socket=client.createSocket();
    const session=new PastureSession({socket,onMessage:(op,data)=>connection.receive(op,data),onStatus:()=>{}});
    connection.session=session;peers.push({session,connection});
    await socket.connect(client.restoreSession(`local:fastswing-${i}`));await session.start();await until(()=>session.ready,'baseline');
  }
  const [buyer,other]=peers,before=other.connection.account.unlocked;
  const request=(action,values={})=>new Promise((resolve,reject)=>{
    const key=`fastswing-${action}`,off=buyer.connection.observe((type,data)=>{if(type==='payment'&&data.key===key){clearTimeout(timer);off();resolve(data);}});
    const timer=setTimeout(()=>{off();reject(Error(`payment ${action} timeout`));},8000);
    buyer.session.room.sendReliable(OP.PAYMENT,new TextEncoder().encode(JSON.stringify({key,action,...values})));
  });
  assert.equal((await request('prepare',{payId:'egg_3714065679'})).ok,true);
  await until(()=>!!buyer.connection.account.commerce.intents.egg_3714065679,'prepared account');
  assert.equal((await buyer.connection.command('treadmill-unlock'))?.ok,true,'ordinary economy action remains available');
  assert.equal(other.connection.account.unlocked,before,'other player unaffected');
  assert.equal((await request('cancel',{payId:'egg_3714065679',confirmedCancelled:true})).ok,true);
  await until(()=>!buyer.connection.account.commerce.intents.egg_3714065679,'cancelled account');
  passed=true;console.log(JSON.stringify({passed,scope:'Official local Mock, two SDK identities, FastSwing prepare → ordinary action → cancel'}));
}finally{
  for(const peer of peers)try{await peer.session.leave();}catch{}
  server.kill();
}
