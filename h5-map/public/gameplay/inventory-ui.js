import {gPrice} from './commerce/catalog.js';
import {skipProduct,growAllProduct} from './commerce/state.js';
import {PAID_SPECIES,paidPetImage} from './commerce/paid-species.js';
import {INDEX_DATA} from './index-ui/data.js';
import {EGG_RENDERS} from './inventory-ui/egg-renders.js';
import {plotCapacity,plotCost} from './plot-state.js';
import {shopNumber,sourceGradient} from './pickaxe-shop.js';
import {SHOP_SOURCE} from './shop-ui/source.js';

const asset=name=>new URL(`./inventory-ui/${name}.png`,import.meta.url).href;
const animals=new Map(INDEX_DATA.zones.flatMap(z=>z.animals).map(a=>[a.name,a]));
const escapeText=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const art=name=>{const a=animals.get(name),path=INDEX_DATA.assets[String(a?.renderId)]||INDEX_DATA.modelRenders?.[name];return path?new URL(path,import.meta.url).href:paidPetImage(name)||asset('egg');};
const eggArt=name=>EGG_RENDERS[name]?new URL(`./inventory-ui/${EGG_RENDERS[name]}`,import.meta.url).href:asset('egg');
export function inventorySnapshot(account,now=Date.now()) {
  const data=account?.data||{},level=data.plot?.level||1;
  // Collections earned by breaking eggs are not placed animals. Never import
  // captured PlacedAnimals or infer placement from the existing collection.
  const pets=(Array.isArray(data.plot?.pets)?data.plot.pets:[]).filter(p=>p?.id&&(animals.has(p.name)||PAID_SPECIES.some(s=>s.name===p.name)));
  const eggs=(Array.isArray(data.growingEggs)?data.growingEggs:[]).filter(e=>!e.hatchingAt).filter(e=>e?.id&&Number.isFinite(e.readyAt));
  return {capacity:plotCapacity(level),cost:plotCost(level),pets:[...pets].sort((a,b)=>(b.cashPerSecond||0)-(a.cashPerSecond||0)),
    eggs:eggs.map(e=>({...e,remaining:Math.max(0,Math.ceil((e.readyAt-now)/1000)),ready:e.readyAt<=now})).sort((a,b)=>Number(b.ready)-Number(a.ready)||a.readyAt-b.readyAt||String(a.id).localeCompare(String(b.id)))};
}
export const eggDuration=seconds=>{const n=Math.max(0,Math.ceil(seconds)),h=Math.floor(n/3600),m=Math.floor(n%3600/60),s=n%60;return h?`${h}h ${m}m`:m?`${m}m ${s}s`:`${s}s`;};

/** Original UI presentation. PastureSystem binds placed-pet retrieval.
 * PastureSystem also binds Equip Best and capacity upgrades; growing eggs remain unimplemented. */
export class GameInventoryUI {
  constructor({account,player,canvas,pickaxes,snapshot=null}) {
    if(!document.querySelector('link[href$="inventory-ui.css"]')){const style=document.createElement('link');style.rel='stylesheet';style.href=new URL('./inventory-ui.css',import.meta.url).href;document.head.append(style);}
    Object.assign(this,{account,player,canvas,pickaxes,snapshot});this.opened=false;this.kind='eggs';this.scroll={eggs:0,pets:0};this.signature='';
    this.root=document.createElement('div');this.root.id='game-inventory-ui';
    this.root.innerHTML=`<nav class="inventory-shortcuts" aria-label="基地列表"><button id="eggs-button" class="inventory-shortcut inventory-egg inv-diamond inv-bevel" aria-label="孵蛋列表" aria-haspopup="dialog" aria-expanded="false"><img src="${asset('egg')}" alt=""><span class="inventory-ready-badge" hidden></span></button><button id="pets-button" class="inventory-shortcut inventory-paw inv-diamond inv-bevel" aria-label="基地宠物列表" aria-haspopup="dialog" aria-expanded="false"><img src="${asset('paw')}" alt=""></button></nav>
      <div class="inventory-screen" hidden><section class="inventory-drawer inv-studs inv-bevel" role="dialog" aria-modal="true" aria-labelledby="inventory-heading" tabindex="-1">
      <header class="inventory-topbar inv-studs inv-bevel"><h2 id="inventory-heading"></h2><button class="inventory-header-action inv-diamond inv-bevel" aria-disabled="true"></button></header>
      <button class="inventory-close" aria-label="关闭列表"><span>&gt;</span></button><div class="inventory-list" tabindex="0" aria-label="列表"></div>
      <button class="inventory-equip-best inv-diamond inv-bevel" aria-disabled="true">Equip Best</button></section></div>`;
    document.body.append(this.root);this.panel=this.root.querySelector('.inventory-drawer');this.screen=this.root.querySelector('.inventory-screen');this.list=this.root.querySelector('.inventory-list');this.nav=this.root.querySelector('nav');
    for(const kind of ['eggs','pets'])this.root.querySelector(`#${kind}-button`).onclick=()=>this.opened&&this.kind===kind?this.close():this.open(kind);
    this.root.querySelector('.inventory-close').onclick=()=>this.close();
    this.screen.addEventListener('pointerdown',e=>{e.stopPropagation();if(e.target===this.screen)this.close();});
    for(const type of ['pointerdown','pointerup','wheel','touchstart','touchmove'])this.root.addEventListener(type,e=>e.stopPropagation(),{passive:true});
    this.abort=new AbortController();
    this.resizeObserver=new ResizeObserver(()=>this.fitText());this.resizeObserver.observe(this.panel);
    document.fonts.ready.then(()=>{if(this.opened)this.fitText();});
    addEventListener('keydown',e=>{
      if(!this.opened)return;
      if(e.code==='Escape'){e.preventDefault();e.stopImmediatePropagation();this.close();return;}
      if(e.code==='Tab'){
        const nodes=[...this.panel.querySelectorAll('button,[tabindex="0"]')].filter(n=>n.getClientRects().length),i=nodes.indexOf(document.activeElement);
        if((e.shiftKey&&i<=0)||(!e.shiftKey&&(i<0||i===nodes.length-1))){e.preventDefault();nodes[e.shiftKey?nodes.length-1:0]?.focus();}
      }
      if(['Space','KeyF','Digit1','Digit2','KeyW','KeyA','KeyS','KeyD','ArrowUp','ArrowDown','ArrowLeft','ArrowRight'].includes(e.code)&&e.target===this.panel)e.preventDefault();
    },{capture:true,signal:this.abort.signal});
    this.update();
  }
  read(){return this.snapshot?.()||inventorySnapshot(this.account);}
  open(kind='eggs') {
    if(!['eggs','pets'].includes(kind)||this.player?.training)return;
    if(this.opened){this.scroll[this.kind]=this.list.scrollTop;}
    else{
      this.pickaxes?.externalModal?.close?.();this.pickaxes?.close();
      if(this.pickaxes){this.pickaxes.externalModal=this;this.pickaxes.auto=false;this.pickaxes.clock.cancel();this.pickaxes.refresh();}
      if(this.player){this.player.inputLocked=true;this.player.keys.clear();this.player.touchMove.set(0,0);this.player.touches.clear();this.player.controls.enabled=false;}
    }
    this.kind=kind;this.opened=true;this.screen.hidden=false;this.nav.hidden=true;
    document.body.dataset.inventoryOpen='true';this.canvas.dataset.inventoryOpen='true';
    for(const k of ['eggs','pets'])this.root.querySelector(`#${k}-button`).setAttribute('aria-expanded',String(k===kind));
    this.render(this.read());this.list.scrollTop=this.scroll[kind];this.panel.focus();
  }
  close() {
    if(!this.opened)return;
    this.scroll[this.kind]=this.list.scrollTop;this.opened=false;this.screen.hidden=true;this.nav.hidden=!!this.player?.training;
    delete document.body.dataset.inventoryOpen;this.canvas.dataset.inventoryOpen='false';
    if(this.pickaxes?.externalModal===this){this.pickaxes.externalModal=null;this.pickaxes.refresh();}
    if(this.player&&!this.pickaxes?.modal&&!this.pickaxes?.externalModal){this.player.inputLocked=false;this.player.controls.enabled=true;}
    for(const k of ['eggs','pets'])this.root.querySelector(`#${k}-button`).setAttribute('aria-expanded','false');
    this.root.querySelector(`#${this.kind}-button`).focus();
  }
  render(state) {
    this.panel.dataset.kind=this.kind;const pets=this.kind==='pets';
    this.root.querySelector('h2').textContent=pets?`${state.pets.length}/${state.capacity} Active`:'Growing Eggs';
    this.root.querySelector('.inventory-header-action').textContent=pets?(state.cost===null?'MAX':`+1 Equip [${shopNumber(state.cost)}$]`):`Grow All ${gPrice(growAllProduct(this.account.data)?.id)}`;
    this.root.querySelector('.inventory-equip-best').hidden=!pets;
    this.root.querySelector('.inventory-header-action').setAttribute('aria-disabled',String(pets?state.cost===null:!growAllProduct(this.account.data)||!this.account.commerce?.available));
    const previous=this.list.scrollTop;
    this.list.innerHTML=pets?state.pets.map(p=>`<div class="inventory-row"><div class="inventory-row-inner inv-diamond inv-bevel"><img class="inventory-sunray" src="${asset('sunray')}" alt=""><img class="inventory-pet-art" src="${art(p.name)}" alt=""><strong class="inventory-pet-name">${escapeText(p.displayName||animals.get(p.name)?.displayName||p.name)}</strong><b class="inventory-pet-cash">($${shopNumber(p.cashPerSecond||0)}/s)</b><button class="inventory-unequip inv-studs inv-bevel" data-retrieve-pet="${escapeText(p.id)}">Unequip</button></div></div>`).join(''):
      state.eggs.map(e=>{const progress=Math.max(0,Math.min(1,1-e.remaining/Math.max(1,e.duration||1)));return `<div class="inventory-row"><div class="inventory-row-inner inv-studs inv-bevel"><div class="inventory-rays"><img src="${asset('rays')}" alt=""></div><img class="inventory-egg-art" src="${eggArt(e.name)}" alt="${escapeText(e.displayName||'Egg')}">${e.ready?`<button class="inventory-open inv-studs inv-bevel" data-hatch-egg="${escapeText(e.id)}">Open</button>`:`<div class="inventory-timer inv-studs"><i style="width:${progress*100}%"></i><b>${eggDuration(e.remaining)}</b></div><button class="inventory-skip inv-studs" data-egg-id="${escapeText(e.id)}" data-pay-id="${skipProduct(this.account.data,e.id)?.id||''}" aria-label="加速成长"><span>${gPrice(skipProduct(this.account.data,e.id)?.id)}</span></button>`}</div></div>`;}).join('');
    this.list.scrollTop=previous;
    if(pets)this.list.querySelectorAll('.inventory-pet-name').forEach((el,i)=>{const rarity=animals.get(state.pets[i].name)?.rarity;el.style.backgroundImage=sourceGradient(SHOP_SOURCE.rarities[rarity]||SHOP_SOURCE.rarities.Common);});
    this.fitText();
  }
  fitText() {
    const ctx=this.textContext ||= document.createElement('canvas').getContext('2d');
    for(const el of this.panel.querySelectorAll('h2,.inventory-pet-name,.inventory-pet-cash')){
      el.style.fontSize='';const style=getComputedStyle(el);if(!el.clientWidth)continue;
      ctx.font=`${style.fontWeight} 100px ${style.fontFamily}`;
      el.style.fontSize=Math.min(parseFloat(style.fontSize),(el.clientWidth-4)/Math.max(1,ctx.measureText(el.textContent).width)*100)+'px';
    }
  }
  update() {
    if(this.player?.training&&this.opened)this.close();
    this.nav.hidden=this.opened||!!this.player?.training;
    const time=performance.now();if(time<(this.refreshAt||0))return;this.refreshAt=time+250;
    const state=this.read(),badge=this.root.querySelector('.inventory-ready-badge'),ready=state.eggs.filter(e=>e.ready).length;
    badge.hidden=!ready;badge.textContent=String(ready);
    const signature=JSON.stringify(state);
    if(signature!==this.signature){this.signature=signature;if(this.opened)this.render(state);}
  }
  dispose(){this.close();this.abort.abort();this.resizeObserver.disconnect();this.root.remove();}
}
