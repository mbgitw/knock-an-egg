import {decodeMotion} from './rules/online/protocol.ts';
import {applyPosition,type Player,type WorldState} from './world.ts';

// Preserve packet order and epochs while relaying client-reported presentation state.
export function acceptMotion(state:WorldState,p:Player,bytes:Uint8Array,_now:number,onReject?:(reason:string)=>void){
  let m;try{m=decodeMotion(bytes);}catch{onReject?.('MOTION_DECODE');return false;}
  if(m.epoch!==((p as any).motionEpoch??0)){onReject?.('MOTION_EPOCH');return false;}
  const old=(p as any).motionSample;
  // 手机采样时钟与Room模拟时钟不保证同速；这里只检查单调与回绕。
  if(old){const delta=(m.sampleTime-old.raw)>>>0;if(!delta||delta>=0x80000000){onReject?.('MOTION_TIME');return false;}}
  if(!applyPosition(state,p,m,onReject))return false;
  (p as any).motionV2=true;(p as any).motionAwaiting=false;(p as any).motionSample={raw:m.sampleTime,arrived:state.elapsed};
  // 切换到新时钟/重连会通过epoch明确切断旧轨迹。
  Object.assign(p.position,{sampleTime:m.sampleTime,vx:m.vx,vy:m.vy,vz:m.vz,epoch:(p as any).motionEpoch??0});return true;
}
export function motionFrame(p:Player){
  const pos=p.position as any;
  return {...pos,slot:p.slot,flags:pos.flags|(pos.sampleTime===undefined?0:8),sampleTime:pos.sampleTime??(p.lastMove>>>0),vx:pos.vx??0,vy:pos.vy??0,vz:pos.vz??0,epoch:(p as any).motionEpoch??0};
}
