import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as THREE from 'three';
import {TreadmillState, restoreState, SAVE_KEY, LEVELS, walkSpeed, awardInterval} from '../public/treadmill-state.js';
import {buildCollisionWorld, CharacterMotor} from '../public/world-physics.js';
import {money} from '../public/gameplay/currency.js';
import {TreadmillSystem} from '../public/treadmill-system.js';
const storage = () => { const data = new Map(); return {getItem: k => data.get(k) || null, setItem: (k, v) => data.set(k, v)}; };
const advance = (account, seconds, hz = 120, options) => { for (let i = 0; i < Math.round(seconds * hz); i++) account.advance(1 / hz, options); };
const unlocked = options => { const account = new TreadmillState(options); assert.ok(account.unlock()); return account; };

test('new account, unlock and stale duplicate upgrade are atomic', () => {
  const a = new TreadmillState();
  assert.equal(a.begin(), false); assert.equal(a.data.cash, 100);
  assert.equal(a.creditCash(-10), false); assert.equal(a.creditCash(Infinity), false);
  assert.ok(a.unlock()); assert.equal(a.data.cash, 0); assert.equal(a.unlock(), false);
  assert.equal(a.upgrade(1), false); assert.equal(a.data.level, 1);
  a.creditCash(850000); assert.ok(a.upgrade(1)); assert.equal(a.data.cash, 0);
  a.creditCash(10000000); assert.equal(a.upgrade(1), false); assert.equal(a.data.cash, 10000000);
  assert.ok(a.upgrade(2)); assert.equal(a.data.level, 3);
});
test('all nine original prices/multipliers, max level and restored state agree', () => {
  const s = storage(), a = unlocked({storage: s});
  for (let i = 1; i < 9; i++) {
    a.creditCash(LEVELS[i - 1].cost); assert.ok(a.upgrade(i));
    assert.equal(a.level.multiplier, 2 ** i); assert.equal(a.data.cash, 0);
  }
  assert.equal(a.upgrade(9), false);
  const b = new TreadmillState({storage: s});
  assert.equal(b.data.level, 9); assert.equal(b.level.multiplier, 256); assert.equal(b.session, null);
});
test('foreground training awards at the same rate at 30/60/120Hz', () => {
  const results = [];
  for (const hz of [30, 60, 120]) {
    const a = unlocked(); assert.ok(a.begin()); assert.equal(a.begin(), false);
    advance(a, 20, hz); results.push(a.data.power);
  }
  assert.equal(results[0], results[1]); assert.equal(results[1], results[2]); assert.ok(results[0] > 90);
});
test('movement never awards growth; only training awards and exits stop it', () => {
  let gains = 0;
  const a = unlocked({onGain: () => gains++}), b = unlocked();
  a.setBoost('speed', 2, 60); b.setBoost('speed', 2, 60);
  advance(a, 10, 60, {moving: true});
  assert.equal(a.data.power, 10); assert.equal(gains, 0); assert.equal(a.elapsed, 0);
  a.begin(); b.begin();
  advance(a, 4, 60, {moving: true}); advance(b, 4, 60, {moving: false});
  assert.equal(a.data.power, b.data.power);
  assert.ok(a.data.power > 10); assert.ok(gains > 0);
  a.end(); const before = a.data.power;
  const gained = gains;
  advance(a, 3); assert.equal(a.data.power, before);
  advance(a, 3, 60, {moving: true}); assert.equal(a.data.power, before);
  assert.equal(gains, gained); assert.equal(a.elapsed, 0);
});
test('pause, ending session and background stalls never pay catch-up', () => {
  const s = storage(), a = unlocked({storage: s}); a.begin(); advance(a, .2, 60);
  advance(a, 120, 60, {active: false}); assert.equal(a.data.power, 10);
  a.advance(600); assert.equal(a.data.power, 10);
  a.end(); advance(a, 10); assert.equal(a.data.power, 10);
  assert.equal(new TreadmillState({storage: s}).session, null);
});
test('growth curve, soft cap, overdrive and slow mode use original speed limits', () => {
  assert.equal(walkSpeed(10), 18); assert.equal(walkSpeed(1e9), 100);
  assert.equal(walkSpeed(1e16), 200); assert.equal(walkSpeed(1e19), 240);
  assert.equal(walkSpeed(1e30), 240); assert.equal(awardInterval(10), .25); assert.equal(awardInterval(1e9), .1);
  const a = new TreadmillState(); a.data.power = 1e16; a.setSlow(true); assert.equal(a.speed, 18);
  a.setSlow(false); assert.equal(a.speed, 200);
});
test('public machine permits seven slots only during landed event; expiry stops training', () => {
  let now = 10000; const a = unlocked({now: () => now});
  assert.equal(a.startPublicEvent({seconds: 9}), false); assert.equal(a.startPublicEvent({multiplier: 101}), false);
  assert.ok(a.startPublicEvent({multiplier: 4, seconds: 10}));
  assert.equal(a.startPublicEvent(), false); assert.equal(a.begin('public'), false);
  now += 1600;
  assert.equal(a.begin('public', 7), false);
  for (let slot = 0; slot < 7; slot++) { assert.ok(a.begin('public', slot)); assert.equal(a.multiplier, 4); a.end(); }
  a.begin('public'); advance(a, 1); assert.ok(a.data.power > 10);
  now += 10001; const before = a.data.power; a.advance(.1);
  assert.equal(a.session, null); assert.equal(a.data.power, before);
  a.stopPublicEvent(); assert.equal(a.data.publicEvent, null);
});
test('timed boosts stack once, expire in wall time and cannot persist beyond expiration', () => {
  let now = 10000; const s = storage(), a = unlocked({storage: s, now: () => now});
  a.creditCash(850000); a.upgrade(1);
  assert.ok(a.setBoost('speed', 2, 10)); assert.ok(a.setBoost('treadmill', 2, 10));
  a.begin(); assert.equal(a.multiplier, 8);
  a.startPublicEvent(); now += 1600; a.end(); a.begin('public'); assert.equal(a.multiplier, 32);
  now += 10001; assert.equal(a.multiplier, 8); // Level 2 x public 4, expired boosts removed.
  assert.deepEqual(new TreadmillState({storage: s, now: () => now}).data.boosts, {});
});
test('bad or unavailable storage does not break training or accept invalid state', () => {
  const a = new TreadmillState({storage: {getItem: () => '{bad', setItem: () => { throw Error('quota'); }}});
  assert.equal(a.storageStatus, 'recovered'); assert.ok(a.unlock()); a.begin(); advance(a, 2);
  assert.ok(a.data.power > 10); assert.equal(a.save(), false); assert.equal(a.storageStatus, 'failed');
  const d = restoreState({version: 1, level: 999, cash: -10, power: 'NaN', unlocked: true, publicEvent: {id: 'bad', landsAt: NaN, endsAt: Infinity}});
  assert.equal(d.level, 9); assert.equal(d.cash, 100); assert.equal(d.power, 10); assert.equal(d.publicEvent, null);
  assert.equal(restoreState({version: 42}).cash, 100);
  assert.equal(restoreState({version: 1, unlocked: false, level: 9}).level, 1);
});
test('shared high-value cash stays exact through a treadmill upgrade and save', () => {
  const s = storage(), a = unlocked({storage: s});
  const credit = '99999999999999999999999';
  assert.ok(a.creditCash(credit)); assert.ok(a.upgrade(1));
  const b = new TreadmillState({storage: s});
  assert.equal(money(b.data.cash), BigInt(credit) - 850000n);
});
test('dynamic replacements remove every visible old machine, preserve board and captured-animal cleanup', () => {
  const manifest = JSON.parse(fs.readFileSync(new URL('../public/obj-map/manifest.json', import.meta.url)));
  assert.equal(manifest.cleanup.removedBaseAnimalMeshes, 49); assert.equal(manifest.cleanup.unmatchedSourceParts, 0);
  assert.equal(manifest.cleanup.removedTreadmillMeshes, 151);
  assert.ok(manifest.cleanup.removedTreadmills.every(m => !m.nodePath.includes('TreadmillBoard')));
  assert.equal(manifest.cleanup.treadmillSourcePartsNotExported.length, 4);
  assert.ok(manifest.cleanup.treadmillSourcePartsNotExported.every(p => p.endsWith('/Hitbox')));
});
test('fast character still collides with thin walls at maximum trained speed', () => {
  const part = (size, xyz) => ({collide: true, className: 'Part', shape: 1, size, matrix: [1,0,0,xyz[0],0,1,0,xyz[1],0,0,1,xyz[2]]});
  const world = buildCollisionWorld([part([200,2,200],[0,-1,0]),part([.5,20,30],[10,10,0])]);
  const motor = new CharacterMotor(world, new THREE.Vector3(0,.01,0)); motor.walkSpeed = 240;
  for (let i=0;i<240;i++) motor.step(1/120, new THREE.Vector3(1,0,0));
  assert.ok(motor.position.x < 8.76); assert.ok(motor.position.x > 8.6);
});
function purchaseFixture() {
  const account = unlocked(); account.creditCash(850000);
  const f = {account, busy:false, range:true, replacements:0, oldDisposed:0, newDisposed:0,
    own:{dispose(){ f.oldDisposed++; }}, ownMatrix:new THREE.Matrix4(),
    boardReachable(){return this.range;}, refreshHUD(){}, tone(){},
    scene:{add(){f.replacements++;}},
    assets:{async instance(){return {root:{},dispose(){f.newDisposed++;}};}}};
  return f;
}
test('failed model loading cannot charge cash or remove current treadmill', async () => {
  const f = purchaseFixture(); f.assets.instance = async () => { throw Error('offline'); };
  const previous = console.error; console.error = () => {};
  try { assert.equal(await TreadmillSystem.prototype.purchase.call(f), false); }
  finally { console.error = previous; }
  assert.equal(f.account.data.cash, 850000); assert.equal(f.account.data.level, 1);
  assert.equal(f.oldDisposed, 0); assert.equal(f.busy, false); assert.ok(f.purchaseError);
});
test('walking away during asynchronous loading discards new model without spending', async () => {
  const f = purchaseFixture(); let resolve;
  const loaded = new Promise(r => {resolve=r;});
  f.assets.instance = () => loaded;
  const pending = TreadmillSystem.prototype.purchase.call(f);
  f.range = false; resolve({root:{},dispose(){f.newDisposed++;}});
  assert.equal(await pending, false); assert.equal(f.account.data.cash, 850000);
  assert.equal(f.newDisposed, 1); assert.equal(f.oldDisposed, 0);
});
test('overlapping purchase requests replace one model and spend one upgrade cost', async () => {
  const f = purchaseFixture();
  const pending = TreadmillSystem.prototype.purchase.call(f);
  assert.equal(await TreadmillSystem.prototype.purchase.call(f), false);
  assert.ok(await pending); assert.equal(f.account.data.cash, 0);
  assert.equal(f.account.data.level, 2); assert.equal(f.oldDisposed, 1); assert.equal(f.replacements, 1);
});
test('deadline crossing during reward tick still releases the character pose', () => {
  let now=10000; const a=unlocked({now:()=>now}); a.startPublicEvent({seconds:10});
  now+=1600; a.begin('public',0);
  const f={account:a,lockedSession:{kind:'public',slot:0},public:null,refreshHUD(){},
    player:{training:{},motor:{position:new THREE.Vector3(0,1,0)},keys:new Set(),touchMove:new THREE.Vector2(),releaseTraining(){this.training=null;}}};
  now+=10001; a.advance(.01); assert.equal(a.session,null);
  TreadmillSystem.prototype.exit.call(f,false);
  assert.equal(f.player.training,null); assert.equal(f.lockedSession,null); assert.equal(f.cooldown,1);
});
