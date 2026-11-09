import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as THREE from 'three';
import {restoreWeapons,WeaponProgress} from '../public/gameplay/weapon-state.js';
import {restoreState} from '../public/treadmill-state.js';
import {weaponGripMatrix} from '../public/gameplay/weapon-assets.js';
import {WeaponSystem} from '../public/gameplay/weapon-system.js';

test('old accounts retain cash, pets and pickaxe, with only default bat unlocked',()=>{
  const old=restoreState({version:1,cash:567,pickaxes:{owned:[1,3],equipped:3}});
  assert.equal(old.cash,567);assert.equal(old.pickaxes.equipped,3);
  assert.deepEqual(old.weapons,{owned:[1],selected:1,equipped:null});
  assert.deepEqual(restoreWeapons({owned:[-1,1,1,11,'2',2],selected:10,equipped:10}),{owned:[1,2],selected:1,equipped:null});
});
test('unlock and equipment persist atomically without changing other progress',()=>{
  let saves=0;const account={data:restoreState(null),save(){saves++;}};
  const state=new WeaponProgress(account);assert.equal(state.equip(10),false);assert.equal(saves,0);
  assert.equal(state.unlock(10),true);assert.equal(state.unlock(10),false);assert.equal(state.unlock(NaN),false);
  assert.equal(state.equip(10),true);assert.equal(account.data.pickaxes.equipped,null);
  const restored=restoreState(JSON.parse(JSON.stringify(account.data)));
  assert.equal(restored.weapons.equipped,10);assert.equal(restored.cash,100);assert.equal(restored.pickaxes.equipped,null);
});
test('all 10 original Grip points map exactly to palm, upright basic bat',()=>{
  const catalog=JSON.parse(fs.readFileSync(new URL('../public/gameplay/weapons.json',import.meta.url)));
  for(const item of catalog){
    const g=item.grip,m=weaponGripMatrix(item);
    assert.ok(new THREE.Vector3(g.X,g.Y,g.Z).applyMatrix4(m).length()<1e-5);
    assert.ok(m.elements.every(Number.isFinite));
    if(item.tier===1)assert.ok(new THREE.Vector3(0,0,1).transformDirection(m).y>.999);
  }
});
test('swing blocks training, modals, loading and repeat input during cooldown',()=>{
  const s={equipped:1,loaded:{},busy:false,blocked:false,time:0,cooldownUntil:0,swingCount:0};
  assert.equal(WeaponSystem.prototype.swing.call(s),true);
  assert.equal(WeaponSystem.prototype.swing.call(s),false);
  s.time=1;s.blocked=true;assert.equal(WeaponSystem.prototype.swing.call(s),false);
  s.blocked=false;s.busy=true;assert.equal(WeaponSystem.prototype.swing.call(s),false);
  s.busy=false;assert.equal(WeaponSystem.prototype.swing.call(s),true);assert.equal(s.swingCount,2);
});
test('async equipment loading cannot equip through a newly opened modal',async()=>{
  let disposed=0;const s={blocked:false,busy:false,pickaxes:{busy:false},progress:{data:{owned:[1]}},refresh(){},assets:{async create(){s.blocked=true;return {dispose(){disposed++;}};}}};
  assert.equal(await WeaponSystem.prototype.equip.call(s,1),false);assert.equal(disposed,1);assert.equal(s.busy,false);
});
test('safe-zone clicks show a throttled notice without animation or hit; field swings still strike',()=>{
  let safe=true,requests=0;
  const s={equipped:1,loaded:{},busy:false,blocked:false,time:0,cooldownUntil:0,swingCount:0,
    safeNotice:{hidden:true,style:{}},combat:{canSwing:()=>!safe,snapshot:()=>({safe}),strike:()=>requests++}};
  assert.equal(WeaponSystem.prototype.swing.call(s),false);assert.equal(s.swingUntil,undefined);assert.equal(s.swingCount,0);assert.equal(requests,0);assert.equal(s.safeNotice.hidden,false);assert.equal(s.safeNoticeAt,0);
  s.time=.5;
  assert.equal(WeaponSystem.prototype.swing.call(s),false);
  assert.equal(s.safeNoticeAt,0);
  s.time=1;s.blocked=true;assert.equal(WeaponSystem.prototype.swing.call(s),false);
  s.blocked=false;s.time=1.1;WeaponSystem.prototype.swing.call(s);assert.equal(s.safeNoticeAt,1.1);
  safe=false;assert.equal(WeaponSystem.prototype.swing.call(s),true);assert.equal(requests,1);
});
