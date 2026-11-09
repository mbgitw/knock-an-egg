import {TreadmillState} from './rules/treadmill-state.ts';
import {PastureState} from './rules/gameplay/pasture-state.ts';
import {PastureEconomy} from './rules/gameplay/pasture-economy.ts';
import {MergeState} from './rules/gameplay/merge-state.ts';
import {claimIndex} from './rules/gameplay/index-state.ts';
import {insideZone} from './rules/gameplay/zone-entry-state.ts';
import {Vector3,Matrix4} from './math.ts';
import plots from './data/plots.ts';
import treadmills from './data/treadmills.ts';
import {redeemPaidCredits} from './rules/gameplay/commerce/state.ts';
import type {Player,WorldState} from './world.ts';

// The Room already has a restored account. The browser-oriented constructor
// restores a second, throwaway default account on every 100 ms economy tick.
export function accountView(p:Player,now:number){const a:any=Object.create(TreadmillState.prototype);a.now=()=>now;a.onGain=()=>{};a.data=p.account;a.session=p.training;a.elapsed=p.trainingElapsed;a.dirty=false;a.save=()=>{p.dirty=true;return true;};return a;}
export function baseMatrix(p:Player){return new Matrix4().set(...plots.bases.find(b=>b.id===`Base_${p.slot+1}`)!.transform);}
export function relocateAccount(p:Player){
  const from=plots.bases.find(b=>b.id===p.account.baseId),to=baseMatrix(p);
  if(from){const matrix=to.multiply(new Matrix4().set(...from.transform).invert());
    for(const pet of [...p.account.plot.pets,...p.account.growingEggs])if(pet.position){const point=new Vector3(...pet.position).applyMatrix4(matrix);pet.position=[point.x,point.y,point.z];if(Number.isFinite(pet.yaw))pet.yaw+=Math.atan2(matrix.values[2],matrix.values[0]);}
  }
  p.account.baseId=`Base_${p.slot+1}`;
}
export function plotBox(p:Player){const h=plots.hitboxes[p.account.plot.level-1];return {size:h.size,matrix:baseMatrix(p).multiply(new Matrix4().set(...h.matrix)).values};}
export function trainingPoint(p:Player,kind:string,slot:number){
  const model=treadmills.models.find(m=>m.tier===(kind==='own'?p.account.level:10));if(!model?.slots[slot])return null;
  const point=new Vector3(...model.slots[slot]);
  const matrix=kind==='own'?baseMatrix(p).multiply(new Matrix4().set(...treadmills.ownOrigin)):new Matrix4().set(...treadmills.publicOrigin);
  return point.applyMatrix4(matrix);
}
function validPlacement(p:Player,position:any){
  if(!Array.isArray(position)||position.length!==3||!position.every(Number.isFinite))return false;
  const point=new Vector3(...position);return Math.abs(point.y-plots.floors[p.account.plot.level-1])<.3&&insideZone(plotBox(p),point)&&point.distanceTo(new Vector3().copy(p.position))<=50;
}
export function economyCommand(state:WorldState,p:Player,action:string,value:any,now:number,random:()=>number){
  const account=accountView(p,now),pasture=new PastureState(account);
  const merge=new (MergeState as any)(account,{now:()=>now,random,id:()=>`merge:${state.namespace}-${p.slot}-${p.revision+1}`});
  switch(action){
    case 'training-start':{
      if(p.carrying||p.training||!value||!['own','public'].includes(value.kind)||!Number.isInteger(value.slot))return false;
      const point=trainingPoint(p,value.kind,value.slot);if(!point||point.distanceTo(new Vector3().copy(p.position))>12)return false;
      if(value.kind==='public'&&Object.values(state.players).some(o=>o.training?.kind==='public'&&o.training.slot===value.slot))return false;
      account.data.publicEvent=state.publicEvent;if(!account.begin(value.kind,value.slot))return false;
      p.training=account.session;p.trainingElapsed=0;p.position={...p.position,...point};return true;
    }
    case 'pasture-place':return !p.carrying&&!p.training&&validPlacement(p,value?.position)&&p.account.plot.pets.every((a:any)=>Math.hypot(a.position[0]-value.position[0],a.position[2]-value.position[2])>2.8)&&pasture.place(value.id,value.position,Number.isFinite(value.yaw)?value.yaw:0);
    case 'pasture-retrieve':return !p.training&&typeof value==='string'&&pasture.retrieve(value);
    case 'pasture-best':{
      if(p.carrying||p.training)return false;
      const h=plotBox(p),positions=[];
      for(let i=0;i<p.account.plot.level+7;i++){const point=new Vector3(((i%4)+.5)/4*h.size[0]-h.size[0]/2,0,(Math.floor(i/4)+.5)/4*h.size[2]-h.size[2]/2).applyMatrix4(new Matrix4().set(...h.matrix));point.y=plots.floors[p.account.plot.level-1];positions.push([point.x,point.y,point.z]);}
      return pasture.equipBest(positions);
    }
    case 'merge':return !p.carrying&&!p.training&&new Vector3(-70.9568634,6.3574734,87.8627853).distanceTo(new Vector3().copy(p.position))<=22&&!!merge.merge(value);
    case 'merge-place':{
      const egg=p.account.mergeEggs.find((e:any)=>e.id===value?.id);if(!egg||p.carrying||p.training||!validPlacement(p,value?.position))return false;
      const radius=(e:any)=>.8*Math.max(.4,Math.min(13,e.sizeMult)),r=radius(egg),point=new Vector3(...value.position);
      if(![[r,r],[-r,r],[r,-r],[-r,-r]].every(([x,z])=>insideZone(plotBox(p),{x:point.x+x,y:point.y,z:point.z+z})))return false;
      if(p.account.growingEggs.some((e:any)=>Math.hypot(e.position[0]-point.x,e.position[2]-point.z)<=r+radius(e))||p.account.plot.pets.some((e:any)=>Math.hypot(e.position[0]-point.x,e.position[2]-point.z)<=r+1.5))return false;
      return merge.place(value.id,value.position);
    }
    case 'merge-hatch':return typeof value==='string'&&merge.hatch(value);
    case 'index-claim':return (value===null||typeof value==='string')&&claimIndex(account,value).count>0;
    case 'offline-claim':{const e=Object.create(PastureEconomy.prototype);e.account=account;e.now=()=>now;e.elapsed=0;return e.claim()>0n;}
    default:return null;
  }
}
export function resumeEconomy(p:Player,now:number){new PastureEconomy(accountView(p,now),()=>now);if(redeemPaidCredits(p.account,now))p.dirty=true;}
export function tickEconomy(state:WorldState,p:Player,dt:number,now:number){
  const a=accountView(p,now);a.data.publicEvent=state.publicEvent;
  if(!p.active||state.elapsed-p.lastMove>3000){p.training=null;p.trainingElapsed=0;return false;}
  p.account.rankStats??={playtime:0,income:0};
  p.account.rankStats.playtime=Math.min(9999999999,p.account.rankStats.playtime+Math.max(0,Math.min(.25,dt)));
  p.dirty=true;
  const before=p.account.power;const point=p.training&&trainingPoint(p,p.training.kind,p.training.slot);
  if(point&&point.distanceTo(new Vector3().copy(p.position))>12){a.end();p.training=null;}
  a.advance(Math.min(.25,dt));p.training=a.session;p.trainingElapsed=a.elapsed;p.dirty ||= a.dirty;
  const e=Object.create(PastureEconomy.prototype);e.account=a;e.now=()=>now;e.elapsed=0;e.update(Math.min(.25,dt));p.account.rankStats.income=e.rate;
  const m=new (MergeState as any)(a,{now:()=>now,random:()=>{throw Error('tick must not roll');},id:()=>{throw Error('tick must not create ids');}});const finished=m.finish();
  return before!==p.account.power||finished.length>0;
}
