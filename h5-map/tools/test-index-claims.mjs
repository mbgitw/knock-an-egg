import test from 'node:test';
import assert from 'node:assert/strict';
import {TreadmillState} from '../public/treadmill-state.js';
import {claimIndex,restoreIndex} from '../public/gameplay/index-state.js';
import {INDEX_DATA} from '../public/gameplay/index-ui/data.js';
const animals=INDEX_DATA.zones.flatMap(z=>z.animals);
function fixture(){let saved=null;const storage={getItem:()=>saved,setItem:(k,v)=>{saved=v;}};const a=new TreadmillState({storage});a.data.index.discovered=['Cat','Anteater'];return {a,storage};}
test('locked and unknown claims cannot pay; single claim is once-only across reload',()=>{
 const {a,storage}=fixture();assert.equal(claimIndex(a,'Chicken').count,0);assert.equal(claimIndex(a,'bogus').count,0);
 const cat=animals.find(a=>a.name==='Cat');assert.equal(claimIndex(a,'Cat').count,1);
 assert.equal(a.data.cash,100+Number(cat.rewardCash));assert.equal(a.data.power,10+cat.rewardSpeed);
 assert.equal(claimIndex(a,'Cat').count,0);const reload=new TreadmillState({storage});assert.equal(claimIndex(reload,'Cat').count,0);assert.deepEqual(reload.data.index,a.data.index);
});
test('bulk awards only remaining discoveries and preserves exact cash above safe integer range',()=>{
 const {a}=fixture();a.data.cash='9007199254740993';claimIndex(a,'Cat');const result=claimIndex(a);
 assert.equal(result.count,1);const expected=animals.filter(x=>['Cat','Anteater'].includes(x.name));
 assert.equal(a.data.cash,(9007199254740993n+expected.reduce((n,x)=>n+BigInt(x.rewardCash),0n)).toString());
 assert.equal(a.data.power,10+expected.reduce((n,x)=>n+x.rewardSpeed,0));assert.equal(claimIndex(a).count,0);
});
test('index migration deduplicates, rejects invalid data and remembers discoveries after sale',()=>{
 assert.deepEqual(restoreIndex({discovered:['Cat','Cat','fake'],claimed:['Chicken','fake']},[{name:'Anteater'}]),{discovered:['Cat','Anteater','Chicken'],claimed:['Chicken']});
 const {a,storage}=fixture();a.data.pickaxes.pets=[];a.save();assert.deepEqual(new TreadmillState({storage}).data.index.discovered,['Cat','Anteater']);
 assert.deepEqual(restoreIndex({discovered:{},claimed:'Cat'}),{discovered:[],claimed:[]});
});
test('failed save does not permit double credit in current session, and retry stores both reward and flag',()=>{
 const {a,storage}=fixture();a.storage={setItem(){throw Error('quota');}};claimIndex(a);assert.equal(a.dirty,true);assert.equal(claimIndex(a).count,0);
 a.storage=storage;a.save();assert.equal(claimIndex(new TreadmillState({storage})).count,0);
});
