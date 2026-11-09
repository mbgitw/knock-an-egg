import test from 'node:test';
import assert from 'node:assert/strict';
import {BackpackLayout,saleSelection} from '../public/gameplay/backpack-state.js';
import {PickaxeProgress,restorePickaxes} from '../public/gameplay/pickaxe-state.js';
import {BackpackUI} from '../public/gameplay/backpack-ui.js';
const pet=(n,name='Cat')=>({id:`zone1-egg-${n}:1`,name,zone:1});
test('explicit empty hotbar keeps pets in inventory, new deliveries fill slots, resizing loses no inventory',()=>{
 const old=[pet(1)],l=new BackpackLayout(old,5,[]);assert.deepEqual(l.inventory(old),old);
 const pets=[...old,pet(2),pet(3),pet(4),pet(5)];l.sync(pets);assert.deepEqual(l.slots,['pickaxe','weapon',pet(2).id,pet(3).id,pet(4).id]);
 assert.equal(l.inventory(pets).length,2);l.resize(3);assert.equal(l.inventory(pets).length,4);
 l.resize(10);assert.equal(l.inventory(pets).length,4);l.sync(pets);assert.equal(l.inventory(pets).length,4);
});
test('drag swaps without duplication, inventory drop preserves item, locked slots reject drag',()=>{
 const l=new BackpackLayout([],5),pets=[pet(1),pet(2)];l.sync(pets);
 assert.equal(l.move(pet(1).id,3),true);assert.equal(l.slots[2],pet(2).id);assert.equal(l.slots[3],pet(1).id);
 assert.equal(l.move(pet(1).id,0),false);assert.equal(l.move('foreign',4),false);
 l.move(pet(1).id,null);assert.deepEqual(l.inventory(pets),[pet(1)]);
 l.sync([pet(1)]);assert.equal(l.slots.includes(pet(2).id),false);
});
test('batch sale deduplicates IDs, excludes unknowns, saves once and cannot pay twice',()=>{
 let saves=0;const account={data:{cash:'100',pickaxes:{pets:[pet(1),pet(2),pet(3)]}},save(){saves++;}};
 const p=new PickaxeProgress(account);const total=saleSelection(p.data.pets,[pet(1).id,pet(1).id,pet(2).id,'foreign']).total;
 const r=p.sellMany([pet(1).id,pet(1).id,pet(2).id,'foreign']);assert.equal(r.count,2);assert.equal(r.total,total);
 assert.equal(BigInt(account.data.cash),100n+total);assert.equal(saves,1);assert.deepEqual(p.data.pets,[pet(3)]);
 assert.equal(p.sellMany([pet(1).id]).count,0);assert.equal(saves,1);
});
test('overlarge sale is rejected and legacy inventory is preserved above original 250 limit',()=>{
 const pets=Array.from({length:260},(_,i)=>pet(i));assert.equal(restorePickaxes({pets}).pets.length,260);
 const p=new PickaxeProgress({data:{cash:'0',pickaxes:{pets}},save(){throw Error('must not save');}});
 assert.equal(p.sellMany(pets.map(p=>p.id)).count,0);assert.equal(p.data.pets.length,260);
 const pending=pet(300);p.pendingPets.set(pending.id,pending);assert.equal(p.bank(pending),false);
});
test('late animal model cannot equip after a new selection, sale, or carry lock',async()=>{
 for(const cancel of [s=>s.version++,s=>s.progress.data.pets=[],s=>s.blocked=true]){
  let resolve;const loaded=new Promise(r=>resolve=r),row=pet(1);
  const state={progress:{data:{pets:[row]}},blocked:false,version:0,pickaxes:{eggs:{petTemplate:()=>loaded}}};
  const pending=BackpackUI.prototype.equip.call(state,row.id);cancel(state);
  resolve({clone(){throw Error('stale model must not clone or equip');}});
  assert.equal(await pending,false);
 }
});


test('refresh preserves hotbar order and inventory-only pets; legacy saves auto-fill',()=>{
 const pets=[pet(1),pet(2),pet(3)],layout=new BackpackLayout(pets,5);
 assert.deepEqual(layout.slots.slice(2),pets.map(p=>p.id));
 layout.move(pet(1).id,null);layout.move(pet(3).id,2);
 const restored=restorePickaxes(JSON.parse(JSON.stringify({pets,hotbar:layout.slots.slice(2)})));
 const next=new BackpackLayout(restored.pets,5,restored.hotbar);
 assert.deepEqual(next.slots,layout.slots);assert.deepEqual(next.inventory(restored.pets),[pet(1)]);
 const invalid=new BackpackLayout(pets,5,[pet(1).id,pet(1).id,'foreign']);assert.deepEqual(invalid.slots.slice(2),[pet(1).id,null,null]);
});
