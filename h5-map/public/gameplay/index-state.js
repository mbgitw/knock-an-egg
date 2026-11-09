import {INDEX_DATA} from './index-ui/data.js';
import {money,cashValue} from './currency.js';

const animals=INDEX_DATA.zones.flatMap(z=>z.animals);
const names=new Set(animals.map(a=>a.name));
const valid=value=>Array.isArray(value)?value.filter(n=>names.has(n)):[];

export function restoreIndex(raw,pets=[]) {
  const claimed=[...new Set(valid(raw?.claimed))];
  return {discovered:[...new Set([...valid(raw?.discovered),...valid(pets.map(p=>p.name)),...claimed])],claimed};
}

export function readIndexSnapshot(account) {
  const state=restoreIndex(account?.data?.index,account?.data?.pickaxes?.pets||[]);
  return {discovered:new Set(state.discovered),claimed:new Set(state.claimed)};
}

// Claim flags and both balances are committed in the same account save.
export function claimIndex(account,name=null) {
  if(!account?.data||typeof account.save!=='function')return {count:0};
  const state=readIndexSnapshot(account);
  const ready=animals.filter(a=>(name===null||a.name===name)&&state.discovered.has(a.name)&&!state.claimed.has(a.name));
  if(!ready.length)return {count:0};
  const cash=ready.reduce((sum,a)=>sum+money(a.rewardCash),0n);
  const speed=ready.reduce((sum,a)=>sum+a.rewardSpeed,0);
  account.data.cash=cashValue(money(account.data.cash)+cash);
  account.data.power=Math.min(1e19,account.data.power+speed);
  account.data.index={discovered:[...state.discovered],claimed:[...state.claimed,...ready.map(a=>a.name)]};
  account.save();
  return {count:ready.length,cash,speed};
}
