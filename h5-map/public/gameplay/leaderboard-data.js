export const BOARDS=[
  {id:'pasture_income_v1',model:'TopMoney',title:'Top Money',color:'#a6ff27',icon:'hud-layout/cash.png',key:'income'},
  {id:'training_power_v1',model:'TopSpeed',title:'Top Speed',color:'#00dfff',icon:'hud-layout/speed.webp',key:'power'},
  {id:'playtime_seconds_v1',model:'TopPlaytime',title:'Top Playtime',color:'#ff658c',key:'playtime'},
];
// Builda scores are integers <= 9,999,999,999. Log encoding preserves ordering
// of huge economy values with ~2.3e-8 relative precision instead of capping them.
export function encodeScore(value,key){if(!Number.isFinite(value)||value<0)return null;return key==='playtime'?Math.min(9999999999,Math.floor(value)):Math.min(9999999999,Math.round(Math.log10(1+value)*1e8));}
export function decodeScore(value,key){return key==='playtime'?value:10**(value/1e8)-1;}
export function formatRank(value,key){
  if(key==='playtime'){const s=Math.floor(value),d=Math.floor(s/86400),h=Math.floor(s/3600)%24,m=Math.floor(s/60)%60;return d?`${d}d ${h}h`:h?`${h}h ${m}m`:m?`${m}m`:`${s}s`;}
  const units=['','K','M','B','T','Qa','Qi','Sx','Sp','Oc','No'];let i=Math.min(units.length-1,Math.max(0,Math.floor(Math.log10(Math.max(1,value))/3)));const text=i?`${+(value/1000**i).toFixed(2)}${units[i]}`:String(Math.round(value));return key==='income'?`$${text}/s`:text;
}
export function cleanEntries(list){
  const seen=new Set();return (Array.isArray(list)?list:[]).filter(e=>{const id=e?.player?.id;if(typeof id!=='string'||seen.has(id)||!Number.isSafeInteger(e.rank)||e.rank<1||!Number.isSafeInteger(e.score)||e.score<0||e.score>9999999999)return false;seen.add(id);return true;}).sort((a,b)=>a.rank-b.rank).slice(0,100);
}
