// @ts-nocheck
// Generated from public/gameplay/plot-state.js; run node tools/build-online-rules.mjs.
import {pastureRate} from './pasture-economy.ts';
import {restorePickaxes} from './pickaxe-state.ts';
import {money,cashValue} from './currency.ts';

export const PLOT_COSTS=Object.freeze([10000,1000000,45000000,1700000000,60000000000,2200000000000,50000000000000,150000000000000]);
export const plotLevel=value=>typeof value==='number'&&Number.isFinite(value)?Math.max(1,Math.min(9,Math.floor(value))):1;
export const plotCapacity=level=>8+plotLevel(level)-1;
export const plotCost=level=>PLOT_COSTS[plotLevel(level)-1]??null;
export const PLOT_RESET_VERSION=1;
export const restorePlot=raw=>{
 const valid=restorePickaxes({pets:raw?.pets}).pets,byId=new Map((Array.isArray(raw?.pets)?raw.pets:[]).map(p=>[p?.id,p]));
 return {level:plotLevel(raw?.level),resetVersion:PLOT_RESET_VERSION,pets:valid.flatMap(p=>{
  const v=byId.get(p.id);return Array.isArray(v.position)&&v.position.length===3&&v.position.every(Number.isFinite)?[{...p,position:[...v.position],yaw:Number.isFinite(v.yaw)?v.yaw:0,cashPerSecond:pastureRate(p)}]:[];
 })};
};

export class PlotProgress {
  constructor(account){this.account=account;account.data.plot=restorePlot(account.data.plot);}
  get level(){return this.account.data.plot.level;}
  get capacity(){return plotCapacity(this.level);}
  get cost(){return plotCost(this.level);}
  get affordable(){return this.cost!==null&&money(this.account.data.cash)>=BigInt(this.cost);}
  upgrade(expectedLevel){
    if(this.account.data.baseId!=='Base_3'||this.account.session||expectedLevel!==this.level||!this.affordable)return false;
    this.account.data.cash=cashValue(money(this.account.data.cash)-BigInt(this.cost));
    this.account.data.plot.level++;
    this.account.save();return true;
  }
}

function roomRandomRequired():number{throw Error("Room必须注入可恢复随机源");}
function roomTimeRequired():number{throw Error("Room必须注入可信时间");}
