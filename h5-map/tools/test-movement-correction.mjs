import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {OP,encodeMove,decodeMoves} from '../public/online/protocol.js';

// Exercise the actual Room message handler; only platform I/O is replaced.
await build({stdin:{contents:"export {PastureRoom} from './server/game/room.ts';export {createWorld,join} from './server/game/world.ts';",resolveDir:process.cwd()},bundle:true,format:'esm',platform:'node',outfile:'build/movement-correction-test.mjs',plugins:[{name:'host',setup(b){
 b.onResolve({filter:/^@cysj\/room$/},()=>({path:'host',namespace:'host'}));
 b.onLoad({filter:/.*/,namespace:'host'},()=>({contents:`
 export class Room { handlers=new Map();sent=[];onMessage(op,fn){this.handlers.set(op,fn);}unixTimeMillis(){return 0;}sendToUserJson(id,op,data){this.sent.push({id,op,data});}sendToUserOn(channel,id,op,data){this.sent.push({channel,id,op,data});} }
 export const defineRoom=x=>x,decodeJson=b=>JSON.parse(new TextDecoder().decode(b)),encodeJson=x=>new TextEncoder().encode(JSON.stringify(x));
 `,loader:'js'}));
}}]});
const {PastureRoom,createWorld,join}=await import('../build/movement-correction-test.mjs');
function setup(){const room=new PastureRoom();room.state=createWorld();const p=join(room.state,'p','s',{x:0,y:.5,z:0,yaw:0,flags:1,sequence:0});p.active=p.loaded=true;p.zone=1;room.eggSnapshot=room.animalSnapshot=()=>{};return {room,p,send:(time,sequence,x,y=.5)=>{room.state.elapsed=time;room.handlers.get(String(OP.MOVE))({userId:'p',seatId:'s'},Array.from(encodeMove({x,y,z:0,yaw:0,flags:1,sequence})));}};}

test('closely arriving legal movement is accepted without snapping the local player backwards',()=>{
 const {room,p,send}=setup();
 send(2000,1,3);assert.equal(p.lastSequence,1);
 send(2050,2,6);assert.equal(p.lastSequence,2);assert.equal(p.position.x,6);
 assert.equal(room.sent.length,0,'arrival timing must not trigger a teleport');
 send(2200,3,8);assert.equal(p.lastSequence,3);assert.equal(room.sent.length,0);
});
test('client-reported large movement is relayed without spatial correction',()=>{
 const {room,p,send}=setup();send(2000,1,3);send(2100,2,500);
 assert.equal(p.position.x,500);assert.equal(room.sent.length,0);
 send(2200,3,600);assert.equal(p.position.x,600);assert.equal(room.sent.length,0);
 room.updateGameplay=()=>{};room.onTick(50);
 assert.equal(decodeMoves(room.sent[0].data).players[0].x,600);
});
