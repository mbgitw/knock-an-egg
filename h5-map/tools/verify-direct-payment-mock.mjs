// Public SDK + official local Room Mock. No real orders, identities or uploads.
import {spawn} from 'node:child_process';
import {OnlineClient} from '@cysj/online-h5';
import {PastureSession} from '../public/online/session.js';
import {GameConnection} from '../public/online/game-connection.js';
import {OP} from '../public/online/protocol.js';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms)),port=7357,peers=[];
const server=spawn(process.execPath,['server/mock/typescript/src/cli.mjs','--room','server/game/room.ts','--source-root','server/game','--sdk','server/typescript','--scenario','builda.room.local.json','--port',String(port)],{windowsHide:true,stdio:['ignore','pipe','pipe']});
let log='';for(const pipe of [server.stdout,server.stderr])pipe.on('data',data=>log=(log+data).slice(-5000));
const until=async(predicate,label,ms=10000)=>{const end=performance.now()+ms;while(!(await predicate())&&performance.now()<end)await pause(25);assert.ok(await predicate(),`${label}: ${log}`);};
try{
  await until(async()=>{try{return (await fetch(`http://127.0.0.1:${port}/health`)).ok;}catch{return false;}},'Mock ready');
  const config=JSON.parse(await readFile('public/online/config.json','utf8'));
  for(let i=1;i<=2;i++){
    const client=new OnlineClient({gatewayUrl:`ws://127.0.0.1:${port}/ws`,gameId:config.gameId,defaultQueueName:config.defaultQueueName});
    const connection=new GameConnection(),socket=client.createSocket();
    const session=new PastureSession({socket,onMessage:(op,data)=>connection.receive(op,data),onStatus:()=>{}});
    connection.session=session;peers.push({session,connection});
    await socket.connect(client.restoreSession(`local:direct-payment-${i}`));await session.start();await until(()=>session.ready,'baseline');
  }
  const [buyer,other]=peers,before=buyer.connection.account.cash,otherCash=other.connection.account.cash;
  let serial=0;
  const request=(action,values={})=>new Promise((resolve,reject)=>{
    const key=`direct-${++serial}`,off=buyer.connection.observe((type,data)=>{if(type==='payment'&&data.key===key){clearTimeout(timer);off();resolve(data);}});
    const timer=setTimeout(()=>{off();reject(Error(`payment ${action} timeout: ${log}`));},8000);
    buyer.session.room.sendReliable(OP.PAYMENT,new TextEncoder().encode(JSON.stringify({key,action,...values})));
  });
  const deliver=async orderId=>{
    let result;
    for(let i=0;i<6;i++){
      result=await request('deliver',{orderId});if(result.delivered)return result;
      assert.ok(result.pending||result.reason==='SAVE_PENDING',JSON.stringify(result));await pause(250*(i+1));
    }
    throw Error(`delivery not completed: ${JSON.stringify(result)} ${log}`);
  };
  // Default Mock orders use payId=orderId and bind to the authenticated identity.
  await deliver('egg_3714065877');
  await until(()=>buyer.connection.account.cash===before+100000,'cash grant');
  await deliver('egg_3714065877');assert.equal(buyer.connection.account.cash,before+100000);
  assert.equal(other.connection.account.cash,otherCash);
  assert.deepEqual(buyer.connection.account.commerce.intents,{});
  await deliver('egg_3715295141');await until(()=>buyer.connection.account.mergeEggs.length===1,'paid egg');
  assert.equal((await request('prepare',{payId:'egg_3714065679'})).ok,true);
  assert.deepEqual(buyer.connection.account.commerce.intents,{});
  assert.equal((await request('cancel')).ok,true);
  assert.equal((await buyer.connection.command('treadmill-unlock'))?.ok,true);
  await buyer.session.leave();await pause(250);
  const reclient=new OnlineClient({gatewayUrl:`ws://127.0.0.1:${port}/ws`,gameId:config.gameId,defaultQueueName:config.defaultQueueName});
  const reconnected=new GameConnection(),socket=reclient.createSocket();
  const session=new PastureSession({socket,onMessage:(op,data)=>reconnected.receive(op,data),onStatus:()=>{}});
  reconnected.session=session;peers.push({session,connection:reconnected});
  await socket.connect(reclient.restoreSession('local:direct-payment-1'));await session.start();await until(()=>session.ready,'buyer rejoin');
  await until(()=>reconnected.account.mergeEggs.length===1,'paid egg survives rejoin');
  assert.equal(reconnected.account.cash,before+100000-100);assert.equal(reconnected.account.commerce.delivery,null);
  console.log(JSON.stringify({passed:true,scope:'Official local Mock: two identities; direct paid cash/egg; duplicate; no unpaid prepare; ordinary action; leave/rejoin. Not real App payments.'}));
}finally{
  for(const peer of peers)try{await peer.session.leave();}catch{}
  server.kill();
}
