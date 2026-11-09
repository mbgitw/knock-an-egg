import {PRODUCTS,gPrice} from './commerce/catalog.js';
import {SHOP_SOURCE} from './shop-ui/source.js';
import {CONFIG} from './config.js';
import {money} from './currency.js';

const rgb=c=>`rgb(${c.map(Math.round).join(' ')})`;
export function sourceGradient(spec,{white=0,phase=0}={}){
  let stops=spec.stops;
  if(phase&&spec.speed){
    const first=stops[0],last=stops.at(-1),closed=first.slice(1).every((v,i)=>v===last[i+1]);
    stops=stops.map(s=>[s[0]*(closed?1:1/1.15),...s.slice(1)]);
    if(!closed)stops.push([1,...first.slice(1)]);
    const shift=(phase*spec.speed)%1,t=(1-shift)%1;
    const i=Math.max(0,stops.findIndex((s,i)=>i<stops.length-1&&s[0]<=t&&stops[i+1][0]>=t));
    const a=stops[i],b=stops[i+1],f=(t-a[0])/(b[0]-a[0]);
    const edge=a.slice(1).map((v,j)=>v+(b[j+1]-v)*f);
    stops=[[0,...edge],...stops.slice(0,-1).map(s=>[(s[0]+shift)%1,...s.slice(1)]).filter(s=>s[0]>.005&&s[0]<.995).sort((a,b)=>a[0]-b[0]),[1,...edge]];
  }
  return `linear-gradient(${spec.rotation+90}deg,${stops.map(s=>`${rgb(s.slice(1).map(v=>v+(255-v)*white))} ${s[0]*100}%`).join(',')})`;
}
// Original FormatNumber.Short uses Qa (not Q) for quadrillions.
export function shopNumber(value){const n=Number(value),units=['','K','M','B','T','Qa','Qi'];let i=Math.min(units.length-1,Math.max(0,Math.floor(Math.log10(Math.max(n,1))/3)));return `${+(n/1000**i).toFixed(2)}${units[i]}`;}

export function shopCards(progress,cash,busy,art){
  return CONFIG.tiers.map(t=>{
    const owned=progress.owned.includes(t.tier),equipped=progress.equipped===t.tier,poor=money(cash)<money(t.price),rarity=SHOP_SOURCE.rarities[t.rarity];
    const button=SHOP_SOURCE.purchaseStyles[poor?'NoneAffordable':'Affordable'];
    const border=rgb(Object.values(button.strokes.Outer).map(v=>Number(v)*255)),inner=rgb(Object.values(button.strokes.Inner).map(v=>Number(v)*255));
    const name=SHOP_SOURCE.names[t.tier-1];
    return `<article class="original-pickaxe-card" data-rarity="${t.rarity}" aria-label="${name}"><div class="original-card-inner" style="--rarity-bg:${sourceGradient(rarity,{white:.35})};--rarity-text:${sourceGradient(rarity)}">
      <div class="original-studs" aria-hidden="true"></div><div class="original-sunray" aria-hidden="true"></div><div class="original-shine" aria-hidden="true"></div>
      <h3 class="original-name original-fit">${name}</h3><span class="original-rarity original-fit">${t.rarity}</span>
      <div class="original-pickaxe-art">${art(t.tier)}</div>
      <div class="original-power"><strong>${shopNumber(t.damage)}</strong><span>Power</span></div>
      ${owned?`<button class="original-equip" data-tier="${t.tier}" ${busy||equipped?'disabled':''}><span class="original-fit">${equipped?'Equipped':'Equip'}</span></button>`:
      `<button class="original-purchase" data-tier="${t.tier}" ${busy||poor?'disabled':''} style="--purchase:${sourceGradient(button)};--purchase-border:${border};--purchase-inner:${inner}" aria-label="Buy ${name} for $${t.price}"><span class="original-fit">$${shopNumber(t.price)}</span></button><button class="original-gcoin" data-pay-id="${PRODUCTS.find(p=>p.kind==='pickaxe'&&p.tier===t.tier)?.id||''}" aria-label="G币购买 ${name}"><span class="original-fit">${gPrice(PRODUCTS.find(p=>p.kind==='pickaxe'&&p.tier===t.tier)?.id)}</span></button>`}
    </div></article>`;
  }).join('');
}

export function fitShopText(panel){
  const ctx=fitShopText.context ||= document.createElement('canvas').getContext('2d');
  for(const el of panel.querySelectorAll('.original-fit')){
    const size=getComputedStyle(el),height=el.clientHeight,width=el.clientWidth-10;
    if(!height||!width)continue;
    ctx.font=`${size.fontWeight} 100px ${size.fontFamily}`;
    el.style.fontSize=`${Math.min(height/.99,width/Math.max(1,ctx.measureText(el.textContent).width)*100)}px`;
  }
}
export function animateShopGradients(panel,time){
  for(const card of panel.querySelectorAll('.original-pickaxe-card')){
    const spec=SHOP_SOURCE.rarities[card.dataset.rarity];if(!spec?.speed)continue;
    const inner=card.firstElementChild;
    inner.style.setProperty('--rarity-bg',sourceGradient(spec,{white:.35,phase:time}));
    inner.style.setProperty('--rarity-text',sourceGradient(spec,{phase:time}));
  }
}
