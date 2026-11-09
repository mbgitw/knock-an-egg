import test from 'node:test';
import assert from 'node:assert/strict';
import {animalIncome,animalSellValue,animalVisualScale,rollAnimalTraits,rollAnimalSize} from '../public/gameplay/animal-attributes.js';
import {pastureRate} from '../public/gameplay/pasture-economy.js';
import {petSellValue} from '../public/gameplay/backpack-state.js';
import {PickaxeProgress,speciesOf,EggLife} from '../public/gameplay/pickaxe-state.js';
import {AnimalCarryState} from '../public/gameplay/animal-carry-state.js';
import {TreadmillState,restoreState} from '../public/treadmill-state.js';
test('original Hatch curves use zone tails, two decimals and a finite zero boundary',()=>{
 for(const [zone,max] of [[1,4],[2,4.6],[3,5.4],[4,6.2],[5,6.6],[6,6.9],[7,7.3],[8,7.5],[9,7.5],[10,7.5]]){
  let i=0;assert.equal(rollAnimalSize(zone,()=>i++?0:1/270000),max);
  assert.equal(rollAnimalSize(zone,()=>.95),1);
  assert.ok(Number.isFinite(rollAnimalSize(zone,()=>0)));
 }
 let i=0;assert.ok(rollAnimalSize(1,()=>i++?0:1e-10)>4,'tail calibration must not clamp weight');
});
test('final-hit settlement rolls once and carry, banking and reload retain the weight',()=>{
 const account=new TreadmillState(),progress=new PickaxeProgress(account),life=new EggLife({health:2});
 let calls=0;const values=[0,.25,.5,1/270000,0],rng=()=>{assert.ok(calls<5);return values[calls++];};
 const hit=id=>{life.hit(id,1,0);return life.alive?null:progress.hatch('zone1-egg-90:1',rng,1);};
 assert.equal(hit(1),null);assert.equal(calls,0);
 const pet=hit(2);assert.equal(calls,5);assert.equal(pet.sizeMult,4);assert.equal(pet.weightKg,speciesOf(pet.name).baseKg*64);
 assert.equal(hit(3),null);assert.equal(calls,5);
 const carry=new AnimalCarryState({zones:[],safe:null}),at={x:0,y:0,z:0};
 const animal=carry.add(pet,at,animalVisualScale(pet),2.5);assert.equal(animal.pet,pet);
 carry.begin(pet.id,at);carry.advance(1.4,at,{held:true});carry.drop(at);assert.equal(animal.pet,pet);
 assert.ok(progress.bank(pet));assert.deepEqual(restoreState(JSON.parse(JSON.stringify(account.data))).pickaxes.pets[0],pet);
 assert.equal(calls,5);
});
test('original gender and mutually exclusive variant probability boundaries',()=>{
 for(const [n,variant] of [[0,'Normal'],[.987499,'Normal'],[.9875,'Gold'],[.997499,'Gold'],[.9975,'Diamond'],[.99999,'Diamond']]){let i=0;assert.deepEqual(rollAnimalTraits(()=>i++?n:.75),{gender:'Male',variant});}
 assert.equal(rollAnimalTraits(()=>0).gender,'Female');
});
test('actual attributes drive pasture, backpack quote and paid sale identically',()=>{
 const a=new TreadmillState(),p=new PickaxeProgress(a),pet={id:'zone1-egg-80:1',name:'Cat',zone:1,weightKg:36*2**3,sizeMult:2,gender:'Female',variant:'Diamond'};
 p.data.pets.push(pet);const rate=animalIncome(pet),value=animalSellValue(pet);assert.equal(rate,pastureRate(pet));assert.equal(petSellValue(pet),BigInt(rate)*60n);
 const restored=restoreState(JSON.parse(JSON.stringify(a.data)));assert.deepEqual(restored.pickaxes.pets[0],pet);
 const cash=a.data.cash;assert.equal(p.sellMany([pet.id]).total,value);assert.equal(BigInt(a.data.cash),BigInt(cash)+value);assert.equal(p.sellMany([pet.id]).count,0);
});
test('visual size cap does not cap weight income, and variant is applied before rounding',()=>{
 const a={id:'zone1-egg-1:1',name:'Cat',sizeMult:20,weightKg:36*20**3};const b={...a,sizeMult:40,weightKg:36*40**3};
 assert.equal(animalVisualScale(a),10);assert.equal(animalVisualScale(b),10);assert.ok(animalIncome(b)>animalIncome(a));
 assert.equal(animalIncome({name:'Cat',weightKg:36*1.38**3,variant:'Diamond'}),7);
});
