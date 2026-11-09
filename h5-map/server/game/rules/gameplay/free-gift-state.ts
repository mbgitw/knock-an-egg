// @ts-nocheck
// Generated from public/gameplay/free-gift-state.js; run node tools/build-online-rules.mjs.
export const FREE_GIFT_SPEED=10000;
export function restoreFreeGift(raw){return {claimed:raw?.claimed===true,token:typeof raw?.token==='string'&&raw.token.length<=160?raw.token:null};}
export function grantFreeGift(account,token){
  const s=account.freeGift;
  if(!s||!token||s.token!==token)return false;
  if(s.claimed)return true;
  account.power=Math.min(1e19,account.power+FREE_GIFT_SPEED);s.claimed=true;return true;
}

function roomRandomRequired():number{throw Error("Room必须注入可恢复随机源");}
function roomTimeRequired():number{throw Error("Room必须注入可信时间");}
