// @ts-nocheck
// Generated from public/online/protocol.js; run node tools/build-online-rules.mjs.
// 协议 revision 1。连续位置使用小端二进制；不传骨骼、粒子和个人账本。
export const OP = Object.freeze({MOVE:1, INTENT:2, SNAPSHOT_REQUEST:3, ACTIVE:4, HOLD:5, PAYMENT:6, APPEARANCE:7, MOTION:8, OFFLINE_DIAGNOSTIC:9, CAPABILITIES:10, RUNTIME_DIAGNOSTIC:11, SNAPSHOT:101, MOVES:102, EVENT:103, RECEIPT:104, ACCOUNT:105, EGGS:106, ANIMALS:107, GUARDS:108, PASTURE:109, PAYMENT_RESULT:110, MOTIONS:111, GUARD_STATES:112, EGG_DELTA:113});
// 客户端在每次SNAPSHOT后声明可选下行格式；旧Room忽略未知消息，旧客户端继续收JSON GUARDS/整区EGGS。
// CAP_CONTROL_RECEIPTS：ACCOUNT与RECEIPT整体改走control-reliable，避免排在大块基线后；两者必须同通道以保持先后。
export const CAP_GUARD_STATES=1,CAP_EGG_DELTA=2,CAP_CONTROL_RECEIPTS=4,CLIENT_CAPS=CAP_GUARD_STATES|CAP_EGG_DELTA|CAP_CONTROL_RECEIPTS;
export const MOVE_BYTES=23;
export const newer=(a,b)=>Number.isInteger(a)&&a>=0&&a<=0xffffffff&&(b===null||((a-b)>>>0)>0&&((a-b)>>>0)<0x80000000);
// Host adapters can supply byte lists or views from another JS realm. Validate the
// bounded byte contents before copying; constructor identity is not wire validity.
function packetBytes(input,min,max,code){
  if(!input||typeof input!=='object'||!Number.isInteger(input.length)||input.length<min||input.length>max)throw Error(code);
  if(input instanceof Uint8Array)return input;
  const bytes=new Uint8Array(input.length);
  for(let i=0;i<bytes.length;i++){const value=input[i];if(!Number.isInteger(value)||value<0||value>255)throw Error(code);bytes[i]=value;}
  return bytes;
}
export function encodeMove(p){
  if(!Number.isInteger(p.sequence)||p.sequence<0||p.sequence>0xffffffff||![p.x,p.y,p.z,p.yaw].every(Number.isFinite)||!Number.isInteger(p.flags)||p.flags<0||p.flags>15)throw Error('INVALID_MOVE');
  const bytes=new Uint8Array(MOVE_BYTES),v=new DataView(bytes.buffer);v.setUint8(0,1);v.setUint32(1,p.sequence,true);
  [p.x,p.y,p.z,p.yaw].forEach((n,i)=>v.setFloat32(5+i*4,n,true));v.setUint16(21,p.flags,true);return bytes;
}
export function decodeMove(bytes){
  bytes=packetBytes(bytes,MOVE_BYTES,MOVE_BYTES,'INVALID_MOVE');
  if(bytes[0]!==1)throw Error('INVALID_MOVE');
  const v=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength),p={sequence:v.getUint32(1,true),x:v.getFloat32(5,true),y:v.getFloat32(9,true),z:v.getFloat32(13,true),yaw:v.getFloat32(17,true),flags:v.getUint16(21,true)};
  if(![p.x,p.y,p.z,p.yaw].every(Number.isFinite)||p.flags>15)throw Error('INVALID_MOVE');return p;
}
// 每批至多七条，槽位标识避免每帧重复发送长身份字符串。
export function encodeMoves(players,time){
  if(players.length>7)throw Error('PLAYER_LIMIT');const b=new Uint8Array(6+players.length*(MOVE_BYTES+1)),v=new DataView(b.buffer);
  b[0]=1;b[1]=players.length;v.setUint32(2,time>>>0,true);
  players.forEach((p,i)=>{const at=6+i*24;b[at]=p.slot;b.set(encodeMove(p),at+1);});return b;
}
export function decodeMoves(b){
  b=packetBytes(b,6,6+7*(MOVE_BYTES+1),'INVALID_MOVES');
  if(b[0]!==1||b[1]>7||b.length!==6+b[1]*24)throw Error('INVALID_MOVES');
  const seen=new Set(),players=[];for(let i=0;i<b[1];i++){const at=6+i*24,slot=b[at];if(slot>6||seen.has(slot))throw Error('INVALID_SLOT');seen.add(slot);players.push({slot,...decodeMove(b.subarray(at+1,at+24))});}
  return {time:new DataView(b.buffer,b.byteOffset,b.byteLength).getUint32(2,true),players};
}
// 可选增强通道，旧23字节MOVE/MOVES保持原样。时间取采样端时钟，速度仅用于显示。
export const MOTION_BYTES=41;
export function encodeMotion(p){
  if(!Number.isInteger(p.sampleTime)||p.sampleTime<0||p.sampleTime>0xffffffff||![p.vx,p.vy,p.vz].every(n=>Number.isFinite(n)&&Math.abs(n)<=500)||!Number.isInteger(p.epoch??0)||(p.epoch??0)<0||(p.epoch??0)>65535)throw Error('INVALID_MOTION');
  const b=new Uint8Array(MOTION_BYTES),v=new DataView(b.buffer);b.set(encodeMove(p));b[0]=2;
  v.setUint32(23,p.sampleTime,true);[p.vx,p.vy,p.vz].forEach((n,i)=>v.setFloat32(27+i*4,n,true));v.setUint16(39,p.epoch??0,true);return b;
}
export function decodeMotion(input){
  const b=packetBytes(input,MOTION_BYTES,MOTION_BYTES,'INVALID_MOTION');if(b[0]!==2)throw Error('INVALID_MOTION');
  const base=b.slice(0,MOVE_BYTES);base[0]=1;const v=new DataView(b.buffer,b.byteOffset,b.byteLength);
  const p={...decodeMove(base),sampleTime:v.getUint32(23,true),vx:v.getFloat32(27,true),vy:v.getFloat32(31,true),vz:v.getFloat32(35,true),epoch:v.getUint16(39,true)};
  if(![p.vx,p.vy,p.vz].every(n=>Number.isFinite(n)&&Math.abs(n)<=500))throw Error('INVALID_MOTION');return p;
}
export function encodeMotions(players,time){
  if(players.length>7)throw Error('PLAYER_LIMIT');const b=new Uint8Array(6+players.length*42);b[0]=2;b[1]=players.length;new DataView(b.buffer).setUint32(2,time>>>0,true);
  players.forEach((p,i)=>{b[6+i*42]=p.slot;b.set(encodeMotion(p),7+i*42);});return b;
}
export function decodeMotions(input){
  const b=packetBytes(input,6,300,'INVALID_MOTIONS');if(b[0]!==2||b[1]>7||b.length!==6+b[1]*42)throw Error('INVALID_MOTIONS');
  const seen=new Set(),players=[];for(let i=0;i<b[1];i++){const at=6+i*42,slot=b[at];if(slot>6||seen.has(slot))throw Error('INVALID_SLOT');seen.add(slot);players.push({slot,...decodeMotion(b.subarray(at+1,at+42))});}
  return {time:new DataView(b.buffer,b.byteOffset,b.byteLength).getUint32(2,true),players};
}
// 守卫表现快照，走state-unreliable：可丢弃、按Room时间取最新。每个守卫26字节。
export const GUARD_STATES=Object.freeze(['Idle','Roaming','WindUp','Chasing','Catching','Returning']);
export const GUARD_BYTES=26,GUARD_LIMIT=32;
export function encodeGuardStates(guards,time){
  if(guards.length>GUARD_LIMIT)throw Error('GUARD_LIMIT');const b=new Uint8Array(6+guards.length*GUARD_BYTES),v=new DataView(b.buffer);b[0]=1;b[1]=guards.length;v.setUint32(2,time>>>0,true);
  guards.forEach((g,i)=>{const at=6+i*GUARD_BYTES,values=[g.position.x,g.position.y,g.position.z,g.yaw,g.speed,g.timer];
    if(!Number.isInteger(g.zone)||g.zone<0||g.zone>255||!values.every(Number.isFinite))throw Error('INVALID_GUARD');
    b[at]=g.zone;const state=GUARD_STATES.indexOf(g.state);b[at+1]=state<0?0:state;values.forEach((n,k)=>v.setFloat32(at+2+k*4,n,true));});
  return b;
}
export function decodeGuardStates(input){
  const b=packetBytes(input,6,6+GUARD_LIMIT*GUARD_BYTES,'INVALID_GUARDS');if(b[0]!==1||b[1]>GUARD_LIMIT||b.length!==6+b[1]*GUARD_BYTES)throw Error('INVALID_GUARDS');
  const v=new DataView(b.buffer,b.byteOffset,b.byteLength),guards=[];
  for(let i=0;i<b[1];i++){const at=6+i*GUARD_BYTES,[x,y,z,yaw,speed,timer]=Array.from({length:6},(_,k)=>v.getFloat32(at+2+k*4,true));
    if(b[at+1]>=GUARD_STATES.length||![x,y,z,yaw,speed,timer].every(Number.isFinite))throw Error('INVALID_GUARDS');
    guards.push({zone:b[at],state:GUARD_STATES[b[at+1]],position:{x,y,z},yaw,speed,timer});}
  return {time:v.getUint32(2,true),guards};
}

function roomRandomRequired():number{throw Error("Room必须注入可恢复随机源");}
function roomTimeRequired():number{throw Error("Room必须注入可信时间");}
