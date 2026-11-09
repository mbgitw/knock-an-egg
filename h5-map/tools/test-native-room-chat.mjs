import test from 'node:test';
import assert from 'node:assert/strict';
import {PastureSession} from '../public/online/session.js';
import {CHAT_TEAM_ID} from '../public/online/native-room-chat.js';
import {OP} from '../public/online/protocol.js';
const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return {resolve,promise};};
const bytes=data=>new TextEncoder().encode(JSON.stringify(data));
function fixture(join=async()=>({available:true})){
  let now=0;const calls=[],events=new Map(),socket={on:(name,fn)=>{events.set(name,fn);return()=>events.delete(name);},close(){}};
  const session=new PastureSession({socket,now:()=>now});
  const room={roomId:'a',joinChatGroup:team=>{calls.push(team);return join();},sendControl(){},sendReliable(){},leave:async()=>{}};
  session.room=room;
  const baseline=()=>{
    for(const [op,data] of [[OP.SNAPSHOT,{players:[]}],[OP.ACCOUNT,{account:{}}],[OP.EGGS,{}],[OP.ANIMALS,{full:true,index:0,count:1,time:0,revision:0,animals:[],removed:[]}]])session.receive({opCode:op,data:bytes(data)});
  };
  return {session,room,calls,events,baseline,setTime:t=>now=t,settled:()=>session.chat.current?.pending};
}

test('native chat starts after the complete baseline and never holds gameplay readiness',async()=>{
  const wait=deferred(),f=fixture(()=>wait.promise);f.session.chat.update();assert.equal(f.calls.length,0);
  f.baseline();assert.equal(f.session.ready,true);assert.equal(f.session.stage,'room_connected');
  await Promise.resolve();assert.deepEqual(f.calls,[CHAT_TEAM_ID]);
  for(let i=0;i<10;i++)f.session.chat.update();assert.equal(f.calls.length,1);
  wait.resolve({available:true});await f.settled();assert.equal(f.session.chat.current.status,'joined');
});
test('same Room keeps membership through pause and baseline recovery without duplicate joins',async()=>{
  const f=fixture();f.baseline();await f.settled();f.session.setActive(false);f.session.chat.update();f.session.setActive(true);
  f.session.requestSnapshot();f.baseline();await f.settled();f.session.chat.update();assert.equal(f.calls.length,1);
});
test('unsupported host is quiet and never retries, even in a later Room',async()=>{
  const f=fixture(async()=>({available:false}));f.baseline();await f.settled();
  f.setTime(100000);f.session.chat.update();f.session.chat.reset();f.session.room={...f.room,roomId:'b'};f.session.chat.update();
  assert.equal(f.calls.length,1);assert.equal(f.session.chat.unavailable,true);assert.equal(f.session.ready,true);
});
test('transient failures retry after backoff, at most three times, and pause postpones retry',async()=>{
  const f=fixture(async()=>{throw {code:'CHAT_GROUP_TIMEOUT'};});f.baseline();await f.settled();assert.equal(f.calls.length,1);
  f.setTime(1999);f.session.chat.update();assert.equal(f.calls.length,1);
  f.setTime(2000);f.session.setActive(false);f.session.chat.update();assert.equal(f.calls.length,1);
  f.session.setActive(true);f.session.chat.update();await f.settled();assert.equal(f.calls.length,2);
  f.setTime(6000);f.session.chat.update();await f.settled();assert.equal(f.calls.length,3);
  f.setTime(999999);f.session.chat.update();assert.equal(f.calls.length,3);assert.equal(f.session.chat.current.status,'failed');assert.equal(f.session.stage,'room_connected');
});
test('a retry can succeed, while deterministic errors never retry',async()=>{
  let attempts=0;const f=fixture(async()=>{if(++attempts===1)throw {code:'CHAT_GROUP_TIMEOUT'};return {available:true};});
  f.baseline();await f.settled();f.setTime(2000);f.session.chat.update();await f.settled();assert.equal(f.session.chat.current.status,'joined');
  const bad=fixture(async()=>{throw {code:'CHAT_GROUP_TEAM_INVALID'};});bad.baseline();await bad.settled();bad.setTime(999999);bad.session.chat.update();assert.equal(bad.calls.length,1);
});
test('leaving never waits for chat and a late join reply cannot revive local membership',async()=>{
  const wait=deferred(),f=fixture(()=>wait.promise);f.baseline();await Promise.resolve();const pending=f.settled();
  assert.equal(await f.session.leave(),true);assert.equal(f.session.chat.current,null);
  wait.resolve({available:true});await pending;assert.equal(f.session.chat.current,null);assert.equal(f.session.stage,'closed');
});
test('terminal Room closure resets chat; a new Room joins with the same shared team',async()=>{
  const f=fixture();f.baseline();await f.settled();f.events.get('roomClosed')({roomId:'a',reason:'game_completed'});
  assert.equal(f.session.chat.current,null);f.session.room={...f.room,roomId:'b'};f.baseline();await f.settled();
  assert.deepEqual(f.calls,[CHAT_TEAM_ID,CHAT_TEAM_ID]);assert.equal(f.session.chat.current.room.roomId,'b');
});
test('late replies from an old Room cannot overwrite the new Room chat state',async()=>{
  const wait=deferred(),f=fixture(()=>wait.promise);f.baseline();await Promise.resolve();const pending=f.settled();
  f.session.room={...f.room,roomId:'b',joinChatGroup:async()=>({available:true})};f.session.chat.update();await f.settled();
  wait.resolve({available:false});await pending;assert.equal(f.session.chat.current.status,'joined');assert.equal(f.session.chat.unavailable,false);
});
