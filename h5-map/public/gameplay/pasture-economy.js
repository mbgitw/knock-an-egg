import {effect,owns} from './commerce/state.js';
import {animalIncome as pastureRate} from './animal-attributes.js';
export {animalIncome as pastureRate} from './animal-attributes.js';
import {money,cashValue,restoreCash} from './currency.js';
export function restoreLedger(raw){
  return {lastSeen:Number.isFinite(raw?.lastSeen)&&raw.lastSeen>0?raw.lastSeen:0,pending:restoreCash(raw?.pending,0),fraction:Number.isFinite(raw?.fraction)?Math.max(0,Math.min(.999999,raw.fraction)):0};
}
export class PastureEconomy {
  constructor(account,now=()=>Date.now()){this.account=account;this.now=now;this.elapsed=0;account.data.pastureLedger=restoreLedger(account.data.pastureLedger);this.resume();}
  get ledger(){return this.account.data.pastureLedger;}
  get rate(){return this.account.data.plot.pets.reduce((n,p)=>n+pastureRate(p),0)*(owns(this.account.data,'DoubleCashOwned')?2:1)*effect(this.account.data,'cash',this.now());}
  resume(){
    const now=this.now(),gap=Math.max(0,(now-this.ledger.lastSeen)/1000);
    if(this.ledger.lastSeen&&gap>=60)this.ledger.pending=cashValue(money(this.ledger.pending)+BigInt(Math.floor(this.rate*.1*Math.min(18000,gap))));
    this.ledger.lastSeen=Math.max(now,this.ledger.lastSeen);this.account.save();
  }
  stamp(){this.ledger.lastSeen=Math.max(this.ledger.lastSeen,this.now());this.account.save();this.elapsed=0;}
  update(dt){
    if(!Number.isFinite(dt)||dt<=0||dt>.25)return;
    const amount=this.rate*dt+this.ledger.fraction,whole=Math.floor(amount);
    this.ledger.fraction=amount-whole;
    if(whole)this.account.data.cash=cashValue(money(this.account.data.cash)+BigInt(whole));
    this.ledger.lastSeen=Math.max(this.ledger.lastSeen,this.now());this.account.dirty=true;
    this.elapsed+=dt;if(this.elapsed>=30)this.stamp();
  }
  claim(){
    const amount=money(this.ledger.pending);if(amount<=0n)return 0n;
    const cash=this.account.data.cash;this.account.data.cash=cashValue(money(cash)+amount);this.ledger.pending=0;
    if(this.account.save()===false){this.account.data.cash=cash;this.ledger.pending=cashValue(amount);return 0n;}
    return amount;
  }
}
