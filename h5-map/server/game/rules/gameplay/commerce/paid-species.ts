// @ts-nocheck
// Generated from public/gameplay/commerce/paid-species.js; run node tools/build-online-rules.mjs.
// Original EggRewards pool / rarity fallback weights; kept OUT of ordinary zone pools.
export const PAID_SPECIES=[
  ['AngelAnky','Angel Bat','Secret',6000000,91.9,70],
  ['AngelTrike','Angel Scorpion','Secret',10000000,91.9,18],
  ['AngelMegalodon','Angel Hound','Celestial',40000000,116,9.9],
  ['AngelTRex','Angel Golem','Celestial',70000000,116,1],
  ['AngelDragon','Angel Dragon','Inferno',850000000,136.1,1],
  ['AngelHydra','Angel Cerberus','Inferno',1100000000,136.1,.1],
].map(([name,displayName,rarity,cash,baseKg,weight])=>({name,displayName,rarity,cash,baseKg,weight,zone:9,indexHidden:true}));
export const paidPetImage=name=>{const i=PAID_SPECIES.findIndex(p=>p.name===name);return i<0?null:new URL(`../gcoin-shop/${['74246833251618','99321278713144','84203671085363','76793212198244','116921943982099','77270104975767'][i]}.png`,import.meta.url).href;};

function roomRandomRequired():number{throw Error("Room必须注入可恢复随机源");}
function roomTimeRequired():number{throw Error("Room必须注入可信时间");}
