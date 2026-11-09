import assert from 'node:assert/strict';
import {OnlineClient} from '../public/vendor/online/index.js';
import {PastureSession} from '../public/online/session.js';
const clients=[];const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function until(fn){for(let i=0;i<200;i++){if(fn())return;await sleep(25);}throw Error('MOCK_TIMEOUT');}
try{for(const id of ['player-1','player-2']){const client=new OnlineClient({gameId:'GD:409930:13',gatewayUrl:'ws://127.0.0.1:7351/ws',defaultQueueName:'default'});const socket=client.createSocket();const messages=[];const session=new PastureSession({socket,onMessage:(op,data)=>messages.push({op,data})});clients.push({socket,session,messages});await socket.connect(client.restoreSession('local:'+id));await session.start();await until(()=>session.ready);assert.equal(session.stage,'room_connected');assert.equal(session.baseline.size,4);}
const health=await fetch('http://127.0.0.1:7351/health').then(r=>r.json());assert.equal(health.active_rooms,1);assert.equal(clients[0].session.room.roomId,clients[1].session.room.roomId);const accounts=clients.map(c=>c.messages.find(m=>m.op===105&&m.data.account).data.account);assert.notEqual(accounts[0].baseId,accounts[1].baseId);console.log('PASS: same Room source; two SDK identities join; four baselines ready; unique pastures.');
}finally{for(const c of clients){assert.equal(await c.session.leave(),true);}}
await sleep(1500);const h=await fetch('http://127.0.0.1:7351/health').then(r=>r.json());assert.equal(h.active_rooms,0);assert.equal(h.lifecycle,'idle');console.log('PASS: authoritative leave and automatic empty-Room reclamation. Local Mock only.');

