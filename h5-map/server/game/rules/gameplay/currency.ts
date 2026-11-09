// @ts-nocheck
// Generated from public/gameplay/currency.js; run node tools/build-online-rules.mjs.
// Preserve exact integer balances above JavaScript's safe integer range.
// Small balances stay numbers for compatibility with the existing HUD/save.
export function money(value) {
  if (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0) return BigInt(value);
  if (typeof value === 'string' && /^\d{1,25}$/.test(value)) return BigInt(value);
  if (typeof value === 'bigint' && value >= 0n && value < 10n ** 25n) return value;
  throw new TypeError('Invalid cash amount');
}
export function cashValue(value) {
  const n = money(value);
  return n <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(n) : n.toString();
}
export function restoreCash(value, fallback = 100) {
  try { return cashValue(value); } catch { return fallback; }
}

function roomRandomRequired():number{throw Error("Room必须注入可恢复随机源");}
function roomTimeRequired():number{throw Error("Room必须注入可信时间");}
