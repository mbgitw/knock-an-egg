import {readFile,writeFile} from 'node:fs/promises';
import {OnlineClient,encodeJson,decodeJson} from '@cysj/online-h5';
import assert from 'node:assert/strict';
import {OP,encodeMove} from '../public/online/protocol.js';
import {PRODUCTS} from '../public/gameplay/commerce/catalog.js';
const config=JSON.parse(await readFile(new URL('../public/online/config.json',import.meta.url),'utf8'));
const clients=[],reports=[];
const pause=ms=>new Promise(r=>setTimeout(r,ms));
async function until(fn){for(let i=0;i<100;i++){const value=fn();if(value)return value;await pause(50);}throw Error('本地回执超时');}
try{
  for(let i=1;i<=7;i++){
    const client=new OnlineClient({gatewayUrl:config.localGatewayUrl,gameId:config.gameId,defaultQueueName:config.defaultQueueName});
    const socket=client.createSocket(),messages=[];let bytes=0,account;
    socket.on('roomMessage',m=>{bytes+=m.data.byteLength;if(m.opCode!==OP.MOVES){const data=decodeJson(m.data);if(m.opCode===OP.ACCOUNT){if(data.account)account=data.account;else if(data.patch)account={...account,...data.patch};else if(data.changes)for(const change of data.changes){let target=account;for(const part of change.path.slice(0,-1))target=target[part];if(change.remove)delete target[change.path.at(-1)];else target[change.path.at(-1)]=change.value;}}messages.push({op:m.opCode,data});}});
    await socket.connect(client.restoreSession(`local:player-${i}`));
    const ticket=await socket.joinRoom('pasture-world',{allowCreate:true,idempotencyKey:crypto.randomUUID()});
    const room=await socket.waitAndConnectMatchedRoom(ticket,{idempotencyKey:crypto.randomUUID()});
    clients.push({socket,room,messages,bytes:()=>bytes,account:()=>account});room.sendReliable(OP.SNAPSHOT_REQUEST,new Uint8Array());
    await until(()=>messages.find(m=>m.op===OP.ACCOUNT));room.sendControl(OP.ACTIVE,new Uint8Array([1]));
  }
  await pause(200);
  const latest=clients[0].messages.filter(m=>m.op===OP.EVENT&&m.data.kind==='players').at(-1).data;
  assert.equal(latest.players.length,7);assert.equal(new Set(latest.players.map(p=>p.slot)).size,7);reports.push('7个官方SDK独立身份加入同一Mock Room，7槽位唯一');
  const first=clients[0];first.room.sendReliable(OP.INTENT,encodeJson({id:1,action:'treadmill-unlock'}));
  await until(()=>first.messages.find(m=>m.op===OP.RECEIPT&&m.data.id===1));
  first.room.sendReliable(OP.INTENT,encodeJson({id:1,action:'treadmill-unlock'}));await pause(200);
  assert.equal(first.account().cash,0);
  assert.equal(clients[1].account().cash,100);reports.push('解锁只扣一次100现金，重复回执幂等，其他玩家账户不变');
  first.room.sendUnreliable(OP.MOVE,encodeMove({sequence:1,x:9999,y:.5,z:0,yaw:0,flags:0}));await pause(1100);
  first.room.sendReliable(OP.SNAPSHOT_REQUEST,new Uint8Array());await pause(100);
  assert.equal(first.messages.filter(m=>m.op===OP.SNAPSHOT).at(-1).data.players.find(p=>p.id==='player-1').position.x,-48);reports.push('异常瞬移未写入Room状态');
  const rpc=async(action,value)=>{const key=crypto.randomUUID();first.room.sendReliable(OP.PAYMENT,encodeJson({key,action,...value}));return (await until(()=>first.messages.find(m=>m.op===OP.PAYMENT_RESULT&&m.data.key===key))).data;};
  const product=PRODUCTS.find(p=>p.kind==='cash');
  assert.equal((await rpc('prepare',{payId:product.payId})).ok,true);
  assert.equal((await rpc('deliver',{orderId:product.payId})).pending,true);
  await pause(300);assert.equal((await rpc('deliver',{orderId:product.payId})).delivered,true);
  assert.equal(BigInt(first.account().cash),BigInt(product.amount));
  assert.equal((await rpc('deliver',{orderId:product.payId})).delivered,true);
  assert.equal(BigInt(first.account().cash),BigInt(product.amount));
  reports.push('官方Mock假订单：prepare→allowed/fulfill→already_delivered，现金只增加一次');
  const start=clients.map(c=>c.bytes());await pause(2000);reports.push({idleDownstreamBytesPerSecond:clients.map((c,i)=>Math.round((c.bytes()-start[i])/2)),scope:'本地应用消息体，不含真实WebRTC协议开销'});
}finally{
  for(const c of clients){await c.room.leave();c.socket.close();}
}
await pause(1300);
const health=await fetch('http://127.0.0.1:7350/health').then(r=>r.json());
reports.push({health});await writeFile(new URL('../../docs/validation/multiplayer/local-integration-validation.json',import.meta.url),JSON.stringify({scope:'七人Room与假订单，仅本地Mock，不代表线上容量/WebRTC/真实支付',reports},null,2));
console.log(JSON.stringify(reports,null,2));
