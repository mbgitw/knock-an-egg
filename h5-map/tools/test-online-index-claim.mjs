import test from 'node:test';
import assert from 'node:assert/strict';
import {installIndexClaim} from '../public/online/index-claim.js';
import {INDEX_DATA} from '../public/gameplay/index-ui/data.js';
const animals=INDEX_DATA.zones.flatMap(z=>z.animals);
test('single and all claims show confirmed cash and speed without mutating balances',async()=>{
  for(const selected of [animals[0].name,null]){
    const chosen=selected?[animals[0]]:animals.slice(0,3),account={data:{cash:100,power:10,index:{claimed:[]}}},calls=[];
    const ui={opened:true,update(){}};
    installIndexClaim(ui,account,async()=>{account.data={...account.data,index:{claimed:chosen.map(a=>a.name)}};return {ok:true};},{showRewards:r=>calls.push(r)});
    await ui.claim(selected);await ui.claim(selected);
    assert.equal(calls.length,1);
    assert.equal(calls[0].cash,chosen.reduce((s,a)=>s+BigInt(a.rewardCash),0n));
    assert.equal(calls[0].speed,chosen.reduce((s,a)=>s+a.rewardSpeed,0));
    assert.equal(account.data.cash,100);assert.equal(account.data.power,10);
  }
});
test('failed, unconfirmed and overlapping claims do not show false rewards',async()=>{
  const account={data:{index:{claimed:[]}}},ui={opened:true,update(){}},cards=[];let resolve,calls=0;
  installIndexClaim(ui,account,()=>{calls++;return new Promise(r=>resolve=r);},{showRewards:r=>cards.push(r)});
  const pending=ui.claim(null);assert.equal(await ui.claim(null),false);assert.equal(calls,1);resolve(false);await pending;
  const unconfirmed=ui.claim(null);resolve({ok:true});await unconfirmed;assert.equal(cards.length,0);
});
