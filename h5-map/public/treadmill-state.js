import {restoreFreeGift} from './gameplay/free-gift-state.js';
import {restoreCommerce,effect} from './gameplay/commerce/state.js';
import {restoreSettings} from './gameplay/settings-state.js';
import {restoreMergeEggs} from './gameplay/merge-state.js';
import {restoreLedger} from './gameplay/pasture-economy.js';
import {restoreWeapons} from './gameplay/weapon-state.js';
import {restoreIndex} from './gameplay/index-state.js';
import {money, cashValue, restoreCash} from './gameplay/currency.js';
import {restorePickaxes} from './gameplay/pickaxe-state.js';
import {restorePlot,PLOT_RESET_VERSION} from './gameplay/plot-state.js';
import {restoreTrails,trailMultiplier} from './gameplay/trail-state.js';
export const LEVELS = Object.freeze([
  ['基础', 1, 850000], ['木制', 2, 10000000], ['黄金', 4, 500000000],
  ['尖刺', 8, 9500000000], ['钻石', 16, 120000000000], ['未来', 32, 1000000000000],
  ['极速', 64, 15000000000000], ['火山', 128, 250000000000000], ['幽灵', 256, null],
].map(([name, multiplier, cost], i) => Object.freeze({level: i + 1, name: `${name}跑步机`, multiplier, cost})));
export const SAVE_KEY = 'knock-egg:treadmill:v1';
export const UNLOCK_COST = 100;
const clamp = (x, low, high) => Math.max(low, Math.min(high, x));
const finite = (x, fallback, low, high) => typeof x === 'number' && Number.isFinite(x) ? clamp(x, low, high) : fallback;
export const progression = power => clamp(Math.log10(Math.max(10, power) / 10) / 8, 0, 1) * 290 + 10;
export const awardInterval = power => .25 - clamp((progression(power) - 10) / 90, 0, 1) * .15;
export function walkSpeed(power) {
  if (power <= 1e9) return 18 + ((progression(power) - 10) / 290) ** 1.59 * 82;
  let previousPower = 1e9, previousSpeed = 100;
  for (const [nextPower, nextSpeed] of [[1e16, 200], [1e19, 240]]) {
    if (power <= nextPower) return previousSpeed + clamp(Math.log10(power / previousPower) / Math.log10(nextPower / previousPower), 0, 1) * (nextSpeed - previousSpeed);
    previousPower = nextPower; previousSpeed = nextSpeed;
  }
  return 240;
}
export const animationRate = level => 1 + (level - 1) * .5;
export const gainColor = mult => mult >= 100 ? '#ff4848' : mult >= 25 ? '#ff43c7' : mult >= 9 ? '#00ffff' : mult > 1 ? '#ffee00' : '#b2e9ff';
export function formatNumber(value) {
  value = Number(value);
  const units = [[1e18, 'Qi'], [1e15, 'Q'], [1e12, 'T'], [1e9, 'B'], [1e6, 'M'], [1e3, 'K']];
  for (const [scale, suffix] of units) if (value >= scale) return `${+(value / scale).toFixed(2)}${suffix}`;
  return String(Math.floor(value));
}

export function restoreState(raw, now = Date.now()) {
  const fresh = {version: 1, baseId: 'Base_3', cash: 100, power: 10, unlocked: false, level: 1, slow: false, boosts: {}, publicEvent: null, pickaxes: restorePickaxes(raw?.version===1?raw.pickaxes:null)};
  // One-time user-requested reset of all base fences. Subsequent upgrades save
  // this revision and continue to restore normally; other progress is retained.
  fresh.plot=restorePlot(raw?.version===1&&raw.plot?.resetVersion===PLOT_RESET_VERSION?raw.plot:null);
  fresh.rankStats={playtime:finite(raw?.rankStats?.playtime,0,0,9999999999),income:0};
  fresh.settings=restoreSettings(raw?.settings);
  fresh.freeGift=restoreFreeGift(raw?.freeGift);
  fresh.commerce=restoreCommerce(raw?.commerce);
  fresh.pastureLedger=restoreLedger(raw?.pastureLedger);
  const placedIds=new Set(fresh.plot.pets.map(p=>p.id));
  fresh.pickaxes.pets=fresh.pickaxes.pets.filter(p=>!placedIds.has(p.id));
  const ownedIds=new Set([...fresh.pickaxes.pets,...fresh.plot.pets].map(p=>p.id));
  fresh.growingEggs=restoreMergeEggs(raw?.growingEggs,true).filter(e=>!ownedIds.has(e.id));
  const growingIds=new Set(fresh.growingEggs.map(e=>e.id));
  fresh.mergeEggs=restoreMergeEggs(raw?.mergeEggs).filter(e=>!ownedIds.has(e.id)&&!growingIds.has(e.id));
  fresh.weapons=restoreWeapons(raw?.version===1?raw.weapons:null);
  if(fresh.weapons.equipped)fresh.pickaxes.equipped=null;
  fresh.trails=restoreTrails(raw?.version===1?raw.trails:null);
  fresh.index=restoreIndex(raw?.version===1?raw.index:null,fresh.pickaxes.pets);
  if (!raw || raw.version !== 1) return fresh;
  fresh.cash = restoreCash(raw.cash);
  fresh.power = finite(raw.power, 10, 10, 1e19);
  fresh.unlocked = raw.unlocked === true;
  fresh.level = fresh.unlocked ? Math.floor(finite(raw.level, 1, 1, 9)) : 1;
  fresh.slow = raw.slow === true;
  for (const key of ['speed', 'treadmill', 'walk']) {
    const boost = raw.boosts?.[key];
    if (boost && Number.isFinite(boost.endsAt) && boost.endsAt > now) {
      fresh.boosts[key] = {multiplier: finite(boost.multiplier, 1, 1, key === 'speed' ? 4096 : 100), endsAt: boost.endsAt};
    }
  }
  const e = raw.publicEvent;
  if (e && typeof e.id === 'string' && Number.isFinite(e.landsAt) && Number.isFinite(e.endsAt) && e.endsAt > now && e.endsAt - e.landsAt <= 3600000 && e.endsAt > e.landsAt && e.landsAt <= now + 1600) {
    fresh.publicEvent = {id: e.id, landsAt: e.landsAt, endsAt: e.endsAt, multiplier: finite(e.multiplier, 4, 1, 100)};
  }
  return fresh;
}

export class TreadmillState {
  constructor({storage = null, now = () => Date.now(), onGain = () => {}} = {}) {
    this.storage = storage; this.now = now; this.onGain = onGain;
    this.storageStatus = storage ? 'ready' : 'memory';
    let raw;
    try { raw = JSON.parse(storage?.getItem(SAVE_KEY) || 'null'); } catch { this.storageStatus = 'recovered'; }
    this.data = restoreState(raw, now());
    this.session = null; this.elapsed = 0; this.dirty = false;
  }
  get level() { return LEVELS[this.data.level - 1]; }
  boost(key) { const b = this.data.boosts[key]; return b && b.endsAt > this.now() ? b.multiplier : 1; }
  get multiplier() {
    return (this.data.commerce?.speedMultiplier||1) * this.boost('speed') * trailMultiplier(this.data.trails) * (this.session ? this.level.multiplier * this.boost('treadmill') * effect(this.data,'treadmill',this.now()) * (this.session.kind === 'public' ? this.data.publicEvent?.multiplier || 1 : 1) : 1);
  }
  get speed() { return this.data.slow ? 18 : Math.min(240, walkSpeed(this.data.power) * this.boost('walk') * effect(this.data,'walk',this.now())); }
  save() {
    try { this.storage?.setItem(SAVE_KEY, JSON.stringify(this.data)); this.storageStatus = this.storage ? 'saved' : 'memory'; this.dirty = false; return true; }
    catch { this.storageStatus = 'failed'; this.dirty = true; return false; }
  }
  creditCash(amount) {
    try { const n=money(amount);if(n<=0n)return false;this.data.cash=cashValue(money(this.data.cash)+n); }
    catch { return false; }
    this.save(); return true;
  }
  unlock() {
    if (this.data.unlocked || this.data.cash < UNLOCK_COST) return false;
    this.data.cash = cashValue(money(this.data.cash)-BigInt(UNLOCK_COST)); this.data.unlocked = true; this.save(); return true;
  }
  upgrade(expectedLevel) {
    const cost = this.level.cost;
    if (!this.data.unlocked || expectedLevel !== this.data.level || cost === null || this.data.cash < cost) return false;
    this.data.cash = cashValue(money(this.data.cash)-BigInt(cost)); this.data.level++; this.save(); return true;
  }
  setSlow(value) { this.data.slow = !!value; this.save(); }
  setBoost(key, multiplier, seconds) {
    if (!['speed', 'treadmill', 'walk'].includes(key) || !Number.isFinite(multiplier) || multiplier < 1 || multiplier > (key === 'speed' ? 4096 : 100) || !Number.isFinite(seconds) || seconds <= 0 || seconds > 86400) return false;
    this.data.boosts[key] = {multiplier, endsAt: this.now() + seconds * 1000}; this.save(); return true;
  }
  begin(kind = 'own', slot = 0) {
    if (this.session || !['own', 'public'].includes(kind)) return false;
    if (kind === 'own' && (!this.data.unlocked || slot !== 0)) return false;
    if (kind === 'public' && (!this.publicActive || !Number.isInteger(slot) || slot < 0 || slot >= 7)) return false;
    this.session = {kind, slot}; this.elapsed = 0; return true;
  }
  end() { this.session = null; this.elapsed = 0; this.save(); }
  get publicActive() { const e = this.data.publicEvent; return !!e && this.now() >= e.landsAt && this.now() < e.endsAt; }
  startPublicEvent({multiplier = 4, seconds = 120} = {}) {
    if (this.data.publicEvent?.endsAt > this.now() || !Number.isFinite(multiplier) || multiplier < 1 || multiplier > 100 || !Number.isFinite(seconds) || seconds < 10 || seconds > 3600) return false;
    const landsAt = this.now() + 1600;
    this.data.publicEvent = {id: `public-${landsAt}`, landsAt, endsAt: landsAt + seconds * 1000, multiplier}; this.save(); return true;
  }
  stopPublicEvent() {
    if (this.session?.kind === 'public') this.end();
    this.data.publicEvent = null; this.save();
  }
  // Only active treadmill sessions award growth. Hidden tabs never catch up.
  advance(dt, {active = true} = {}) {
    if (this.session?.kind === 'public' && !this.publicActive) this.end();
    if (!active || !Number.isFinite(dt) || dt <= 0 || dt > .25 || !this.session) { this.elapsed = 0; return; }
    this.elapsed += dt;
    while (this.elapsed + 1e-10 >= awardInterval(this.data.power)) {
      this.elapsed = Math.max(0, this.elapsed - awardInterval(this.data.power));
      const mult = this.multiplier;
      const next = Math.min(1e19, this.data.power + mult);
      const gain = next - this.data.power;
      this.data.power = next; this.dirty ||= gain > 0;
      if (gain > 0) this.onGain(gain, mult);
    }
  }
}
