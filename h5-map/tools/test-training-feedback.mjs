import test from 'node:test';
import assert from 'node:assert/strict';
import {trainingFeedback} from '../public/online/training-feedback.js';
test('local feedback keeps original cadence without modifying authoritative power',()=>{
  const account={data:{power:10},session:{kind:'own'},multiplier:1};const gains=[];
  const f=trainingFeedback(account,(...v)=>gains.push(v));
  for(let i=0;i<60;i++)f.advance(1/60);
  assert.equal(gains.length,4);assert.equal(account.data.power,10);assert.deepEqual(gains[0],[1,1]);
  account.data={power:15};account.multiplier=2;
  for(let i=0;i<60;i++)f.advance(1/60);
  assert.equal(gains.length,8);assert.deepEqual(gains.at(-1),[2,2]);assert.equal(account.data.power,15);
});
test('pause, stop, reentry and expired public sessions do not catch up',()=>{
  const a={data:{power:10},session:{kind:'own'},multiplier:1};let n=0;
  const f=trainingFeedback(a,()=>n++);f.advance(.2);f.reset();f.advance(.1);assert.equal(n,0);
  a.session=null;f.advance(.1);a.session={kind:'own'};f.advance(.2);assert.equal(n,0);
  f.advance(10);f.advance(.1);assert.equal(n,0);
  f.advance(.2,{active:false});f.advance(.2);assert.equal(n,0);
  a.session={kind:'public'};a.publicActive=false;f.advance(.25);assert.equal(n,0);
});
