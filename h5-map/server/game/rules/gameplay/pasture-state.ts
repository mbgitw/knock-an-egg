// @ts-nocheck
// Generated from public/gameplay/pasture-state.js; run node tools/build-online-rules.mjs.
import {pastureRate} from './pasture-economy.ts';
import {speciesOf} from './pickaxe-state.ts';
import {plotCapacity} from './plot-state.ts';

export class PastureState {
  constructor(account){this.account=account;}
  get pets(){return this.account.data.plot.pets;}
  transfer(change){
    const data=this.account.data,before=JSON.stringify({bag:data.pickaxes.pets,placed:data.plot.pets});
    change();
    if(this.account.save()!==false)return true;
    const old=JSON.parse(before);data.pickaxes.pets=old.bag;data.plot.pets=old.placed;return false;
  }
  place(id,position,yaw=0){
    const data=this.account.data,pet=data.pickaxes.pets.find(p=>p.id===id);
    if(!pet||this.pets.some(p=>p.id===id)||this.pets.length>=plotCapacity(data.plot.level)||!Array.isArray(position)||position.length!==3||!position.every(Number.isFinite))return false;
    return this.transfer(()=>{data.pickaxes.pets=data.pickaxes.pets.filter(p=>p.id!==id);this.pets.push({...pet,position:[...position],yaw,cashPerSecond:pastureRate(pet)});});
  }
  equipBest(positions){
    const data=this.account.data,all=[...this.pets,...data.pickaxes.pets];
    const sorted=all.sort((a,b)=>pastureRate(b)-pastureRate(a)||a.id.localeCompare(b.id));
    const chosen=sorted.slice(0,plotCapacity(data.plot.level));
    if(positions.length<chosen.length)return false;
    return this.transfer(()=>{
      const ids=new Set(chosen.map(p=>p.id));
      data.plot.pets=chosen.map((p,i)=>({...p,position:[...positions[i]],yaw:p.yaw||0,cashPerSecond:pastureRate(p)}));
      data.pickaxes.pets=all.filter(p=>!ids.has(p.id)).map(({position,yaw,cashPerSecond,...p})=>p);
    });
  }
  retrieve(id){
    const pet=this.pets.find(p=>p.id===id),data=this.account.data;
    if(!pet||data.pickaxes.pets.some(p=>p.id===id))return false;
    return this.transfer(()=>{data.plot.pets=this.pets.filter(p=>p.id!==id);const {position,yaw,cashPerSecond,...owned}=pet;data.pickaxes.pets.push(owned);});
  }
}

function roomRandomRequired():number{throw Error("Room必须注入可恢复随机源");}
function roomTimeRequired():number{throw Error("Room必须注入可信时间");}
