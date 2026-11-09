// @ts-nocheck
// Generated from public/gameplay/weapon-state.js; run node tools/build-online-rules.mjs.
export function restoreWeapons(raw) {
  const owned = [...new Set([1, ...(Array.isArray(raw?.owned) ? raw.owned : [])])]
    .filter(t => Number.isInteger(t) && t >= 1 && t <= 10).sort((a,b) => a-b);
  return {owned, selected: owned.includes(raw?.selected) ? raw.selected : 1,
    equipped: owned.includes(raw?.equipped) ? raw.equipped : null};
}

// The shared account is saved once per equipment transaction.
export class WeaponProgress {
  constructor(account) { this.account=account; account.data.weapons=restoreWeapons(account.data.weapons); }
  get data() { return this.account.data.weapons; }
  unlock(tier) {
    if (!Number.isInteger(tier)||tier<1||tier>10||this.data.owned.includes(tier)) return false;
    this.data.owned.push(tier); this.data.owned.sort((a,b)=>a-b); this.account.save(); return true;
  }
  equip(tier) {
    if(tier!==null&&!this.data.owned.includes(tier))return false;
    this.data.equipped=tier;
    if(tier!==null){this.data.selected=tier;this.account.data.pickaxes.equipped=null;}
    this.account.save();return true;
  }
}

function roomRandomRequired():number{throw Error("Room必须注入可恢复随机源");}
function roomTimeRequired():number{throw Error("Room必须注入可信时间");}
