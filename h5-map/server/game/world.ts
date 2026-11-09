import {plotSpawn} from './rules/online/plot-spawn.ts';
import plots from './data/plots.ts';
import type {Animal} from './animals.ts';
import {dropAnimal} from './animals.ts';
import {economyCommand} from './economy.ts';
import {decodeMove,newer} from './rules/online/protocol.ts';
import {restoreState,walkSpeed,TreadmillState} from './rules/treadmill-state.ts';
import {PickaxeProgress} from './rules/gameplay/pickaxe-state.ts';
import {TrailProgress} from './rules/gameplay/trail-state.ts';
import {WeaponProgress} from './rules/gameplay/weapon-state.ts';
import {plotCost} from './rules/gameplay/plot-state.ts';
import {money,cashValue} from './rules/gameplay/currency.ts';

export type Position={x:number;y:number;z:number;yaw:number;flags:number;sequence:number};
export type Player={id:string;seat:string;slot:number;connected:boolean;active:boolean;loaded:boolean;account:any;position:Position;lastMove:number;lastSequence:number|null;movementFrameAt?:number;movementFrames?:number;lastIntent:number;receipts:Record<string,{ok:boolean;reason:string}>;lastSnapshot:number;training:any;trainingElapsed:number;dirty:boolean;revision:number;lastHit:number;zone:number;carrying:string|null;hold:{id:string;startedAt:number;seenAt:number}|null};
export type WorldState={elapsed:number;revision:number;joinable:boolean;players:Record<string,Player>;eggs:any[];guards:any[];publicEvent:any;animals:Record<string,Animal>;namespace:string;titanic:any;animalCache:Record<string,Record<string,string>>;saving:Record<string,boolean>;pendingSaves:Record<string,{value:string;nextAt:number}>};
export const createWorld=():WorldState=>({elapsed:0,revision:0,joinable:true,players:{},eggs:[],guards:[],publicEvent:null,animals:{},namespace:"",titanic:null,pendingSaves:{},animalCache:{},saving:{}});
const deny=(reason:string)=>({ok:false,reason});
export const pastureSpawn=(slot:number):Position=>plotSpawn(plots.bases.find(b=>b.id===`Base_${slot+1}`)!.transform);
export function join(state:WorldState,id:string,seat:string,spawn?:Position){
  if(!id||!seat||id.length>128||seat.length>128)throw Error('INVALID_SEAT');
  const old=state.players[id];if(old){if(old.seat!==seat)throw Error('SEAT_CONFLICT');old.connected=true;old.active=false;return old;}
  if(Object.values(state.players).some(p=>p.seat===seat))throw Error('SEAT_CONFLICT');
  const used=new Set(Object.values(state.players).map(p=>p.slot));let slot=0;while(slot<7&&used.has(slot))slot++;
  if(slot===7)throw Error('ROOM_FULL');
  const p:Player={id,seat,slot,connected:true,active:false,loaded:false,account:restoreState(null,0),position:spawn?{...spawn}:pastureSpawn(slot),lastMove:state.elapsed,lastSequence:null,lastIntent:-1000,receipts:{},lastSnapshot:-1000,training:null,trainingElapsed:0,dirty:false,revision:0,lastHit:-1000,zone:1,carrying:null,hold:null};
  p.account.baseId=`Base_${slot+1}`;state.players[id]=p;state.revision++;return p;
}
export function disconnect(p:Player){p.connected=false;p.active=false;p.training=null;p.trainingElapsed=0;}
export function leave(state:WorldState,id:string){if(state.players[id]){delete state.players[id];state.revision++;}}
export function renewMotion(p:Player){const player=p as any;player.motionEpoch=((player.motionEpoch??0)+1)&65535;player.motionSample=null;player.motionAwaiting=!!player.motionV2;for(const key of ['sampleTime','vx','vy','vz','epoch'])delete (p.position as any)[key];}
// Client position is presentation state. Keep only protocol/order and a generous flood cap.
export function applyPosition(state:WorldState,p:Player,move:Position,onReject?:(reason:string)=>void){
  const reject=(reason:string)=>{onReject?.(reason);return false;};
  if(!p.connected||!p.loaded||!p.active)return reject('PLAYER_UNAVAILABLE');
  if(!newer(move.sequence,p.lastSequence))return reject('SEQUENCE');
  if(p.movementFrameAt!==state.elapsed){p.movementFrameAt=state.elapsed;p.movementFrames=0;}
  if((p.movementFrames??0)>=16)return reject('RATE_LIMIT');
  p.movementFrames=(p.movementFrames??0)+1;p.position=move;p.lastSequence=move.sequence;p.lastMove=state.elapsed;return true;
}
export function acceptMove(state:WorldState,p:Player,bytes:Uint8Array,_now=0,onReject?:(reason:string)=>void){
  let move:Position;try{move=decodeMove(bytes);}catch(error){onReject?.(`DECODE_${error instanceof Error?error.name:'ERROR'}`);return false;}
  return applyPosition(state,p,move,onReject);
}
// 同一账户规则只在Room执行；浏览器提交操作意图，不上传价格、余额或成长。
export function transact(state:WorldState,p:Player,request:any,now:number,random:()=>number=()=>{throw Error('RANDOM_REQUIRED');}){
  if(!request||!Number.isSafeInteger(request.id)||request.id<1||request.id>0xffffffff||typeof request.action!=='string')return deny('INVALID_INTENT');
  const key=String(request.id),prior=p.receipts[key];if(prior)return prior;
  if(request.id<=p.revision)return deny('STALE_INTENT');
  if(!p.loaded||!p.connected||(!p.active&&request.action!=='training-stop'))return deny('PLAYER_UNAVAILABLE');
  if(request.action!=='training-stop'){if(state.elapsed-p.lastIntent<100)return deny('RATE_LIMIT');p.lastIntent=state.elapsed;}
  const account:any=new TreadmillState({now:()=>now});account.data=structured(p.account);account.session=p.training;
  let ok=false;
  const value=request.value;
  const extended=economyCommand(state,p,request.action,value,now,random);
  if(extended!==null){const result={ok:!!extended,reason:extended?'ok':'REJECTED'};p.receipts[key]=result;p.revision=request.id;p.dirty=true;if(extended)state.revision++;for(const k of Object.keys(p.receipts).slice(0,-64))delete p.receipts[k];return result;}
  switch(request.action){
    case 'respawn':if(state.elapsed-((p as any).lastRespawn??-5000)>=5000){dropAnimal(state,p,true);p.training=null;p.trainingElapsed=0;p.position={...pastureSpawn(p.slot),sequence:p.position.sequence};renewMotion(p);p.lastMove=state.elapsed;(p as any).lastRespawn=state.elapsed;ok=true;}break;
    case 'slow':if(typeof value==='boolean'){account.setSlow(value);ok=true;}break;
    case 'pickaxe-buy':ok=new PickaxeProgress(account).buy(value);if(ok)account.data.weapons.equipped=null;break;
    case 'pickaxe-equip':ok=new PickaxeProgress(account).equip(value);if(ok&&value!==null)account.data.weapons.equipped=null;break;
    case 'weapon-equip':ok=new WeaponProgress(account).equip(value);break;
    case 'trail-buy':ok=new TrailProgress(account).buy(value);break;
    case 'trail-equip':ok=new TrailProgress(account).equip(value);break;
    case 'sell':if(typeof value==='string'&&value.length<180)ok=new PickaxeProgress(account).sell(value);break;
    case 'sell-many':if(Array.isArray(value)&&value.length<=200)ok=new PickaxeProgress(account).sellMany(value).count>0;break;
    case 'plot-upgrade':{
      const cost=plotCost(account.data.plot.level);
      if(!p.training&&value===account.data.plot.level&&cost!==null&&money(account.data.cash)>=BigInt(cost)){
        account.data.cash=cashValue(money(account.data.cash)-BigInt(cost));account.data.plot.level++;ok=true;
      }break;
    }
    case 'treadmill-unlock':if(!p.training)ok=account.unlock();break;
    case 'treadmill-upgrade':if(!p.training)ok=account.upgrade(value);break;
    case 'training-stop':p.training=null;p.trainingElapsed=0;ok=true;break;
  }
  if(ok){p.account=account.data;p.dirty=true;state.revision++;}
  const result={ok,reason:ok?'ok':'REJECTED'};p.receipts[key]=result;p.revision=request.id;
  const keys=Object.keys(p.receipts);for(const k of keys.slice(0,Math.max(0,keys.length-64)))delete p.receipts[k];return result;
}
export function publicPlayer(p:Player){const holding=(p as any).holding;return {id:p.id,slot:p.slot,connected:p.connected,position:p.position,plot:p.account.plot.level,treadmill:p.account.level,unlocked:p.account.unlocked,pickaxe:p.account.pickaxes.equipped,weapon:p.account.weapons.equipped,trail:p.account.trails.equipped,training:p.training,holding:holding&&[...p.account.pickaxes.pets,...p.account.mergeEggs].some((a:any)=>a.id===holding.id)?holding:null};}
function structured<T>(value:T):T{return JSON.parse(JSON.stringify(value));}
