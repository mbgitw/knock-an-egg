import {gPrice} from './commerce/catalog.js';
import * as THREE from 'three';
import {TRAIL_CONFIG} from './trails/config.js';
import {REUSED_TRAIL_ART} from './trails/reused-assets.js';
import {TRAILS,TrailProgress,trailById} from './trail-state.js';
import {TrailRibbon,trailThumbnail} from './trail-ribbon.js';
import {BoothTrigger} from './shop-booth.js';
import {SHOP_SOURCE} from './shop-ui/source.js';
import {sourceGradient,shopNumber,fitShopText} from './pickaxe-shop.js';
import {money} from './currency.js';
import {updateShopCards} from './shop-card-dom.js';

const rgb=c=>`rgb(${c.map(Math.round).join(' ')})`;
export class TrailSystem {
  constructor({scene,player,camera,canvas,account,pickaxes,treadmills,boothData,booth,sign}){
    Object.assign(this,{scene,player,camera,canvas,account,pickaxes,treadmills,booth,sign});
    this.progress=new TrailProgress(account);this.ribbon=new TrailRibbon(scene,camera);this.anchor=new THREE.Vector3();this.trigger=new BoothTrigger(boothData.parts.find(p=>p.name==='HitZone'));
    this.opened=false;this.time=0;this.signature='';this.icons=new Map(TRAILS.map(t=>{const file=t.icon||REUSED_TRAIL_ART.icons[t.id];return [t.id,file?'/gameplay/trails/'+file:trailThumbnail(t)];}));
    this.makeUI();this.syncEquipment();this.abort=new AbortController();
    addEventListener('keydown',e=>{if(!this.opened)return;if(e.code==='Escape'){e.preventDefault();this.close();}if(e.code==='Tab'){const bs=[...this.root.querySelectorAll('button:not(:disabled)')].filter(b=>b.getClientRects().length),i=bs.indexOf(document.activeElement);if((e.shiftKey&&i<=0)||(!e.shiftKey&&i===bs.length-1)){e.preventDefault();bs[e.shiftKey?bs.length-1:0]?.focus();}}},{signal:this.abort.signal});
    const clear=()=>this.ribbon.clear();addEventListener('blur',clear,{signal:this.abort.signal});window.addEventListener('game-host-pause',clear,{signal:this.abort.signal});
  }
  makeUI(){
    this.root=document.createElement('div');this.root.id='trail-ui';this.root.className='original-shop';
    this.root.innerHTML='<div class="trail-overlay" hidden><section class="trail-panel" role="dialog" aria-modal="true" aria-labelledby="trail-title"><header><h2 id="trail-title" class="original-fit">Trails Shop</h2><div class="trail-header-shine" aria-hidden="true"></div><button class="trail-close" aria-label="关闭拖尾商店">X</button></header><div class="trail-grid"></div></section></div>';
    document.body.append(this.root);this.overlay=this.root.querySelector('.trail-overlay');this.grid=this.root.querySelector('.trail-grid');
    for(const [id,key] of [['116016239612262','--studs-image'],['76963081135721','--sunray-image']]){const file=TRAIL_CONFIG.assets[id]||REUSED_TRAIL_ART.decorations[id];if(file)this.root.style.setProperty(key,`url('/gameplay/trails/${file}')`);}
    this.root.querySelector('.trail-close').onclick=()=>this.close();this.overlay.onclick=e=>{if(e.target===this.overlay)this.close();};
    this.grid.onclick=e=>{const button=e.target.closest('[data-trail-id]');if(!button)return;const id=Number(button.dataset.trailId),buy=button.dataset.action==='buy';const ok=buy?this.progress.buy(id):this.progress.toggle(id);if(ok){this.syncEquipment();this.render();this.treadmills.refreshHUD();if(buy)this.treadmills.tone('purchase');}};
    this.grid.addEventListener('wheel',e=>{if(Math.abs(e.deltaY)>Math.abs(e.deltaX)){e.preventDefault();this.grid.scrollLeft+=e.deltaY;}},{passive:false});
    this.resize=new ResizeObserver(()=>{if(this.opened)fitShopText(this.root);});this.resize.observe(this.grid);
  }
  render(){
    const scroll=this.grid.scrollLeft,focused=document.activeElement?.dataset?.trailId;
    const markup=TRAILS.map(t=>{
      const owned=this.progress.data.owned.includes(t.id),equipped=this.progress.data.equipped===t.id,poor=money(this.account.data.cash)<money(t.price),r=SHOP_SOURCE.rarities[t.rarity],purchase=SHOP_SOURCE.purchaseStyles[poor?'NoneAffordable':'Affordable'];
      const bg=sourceGradient({rotation:0,stops:[[0,...t.colors[0].map(v=>v+(255-v)*.35)],[1,...t.colors[1].map(v=>v+(255-v)*.175)]]});
      return `<article class="original-pickaxe-card" data-trail="${t.id}" data-rarity="${t.rarity}" aria-label="${t.name}"><div class="original-card-inner" style="--rarity-bg:${bg};--rarity-text:${sourceGradient(r)}"><div class="original-studs"></div><div class="original-sunray"></div><div class="original-shine"></div><h3 class="original-name original-fit">${t.name}</h3><span class="original-rarity original-fit">${t.rarity}</span><div class="trail-art"><img src="${this.icons.get(t.id)}" alt="" draggable="false"></div><div class="original-power"><strong>x${shopNumber(t.multiplier)}</strong><span>Speed</span></div>${owned?`<button class="original-equip" data-trail-id="${t.id}" data-action="equip"><span class="original-fit">${equipped?'Unequip':'Equip'}</span></button>`:`<button class="original-purchase" data-trail-id="${t.id}" data-action="buy" ${poor?'disabled':''} style="--purchase:${sourceGradient(purchase)};--purchase-border:${rgb(Object.values(purchase.strokes.Outer).map(v=>Number(v)*255))};--purchase-inner:${rgb(Object.values(purchase.strokes.Inner).map(v=>Number(v)*255))}" aria-label="Buy ${t.name} for $${t.price}"><span class="original-fit">$${shopNumber(t.price)}</span></button><button class="original-gcoin" data-pay-id="${t.productId}" aria-label="G币购买 ${t.name}"><span class="original-fit">${gPrice(t.productId)}</span></button>`}</div></article>`;
    }).join('');if(updateShopCards(this.grid,markup))fitShopText(this.root);this.grid.scrollLeft=scroll;
    if(focused)(this.grid.querySelector(`[data-trail-id="${focused}"]:not(:disabled)`)||this.root.querySelector('.trail-close')).focus({preventScroll:true});
  }
  syncEquipment(){
    const t=trailById(this.progress.data.equipped);this.ribbon.setTrail(t);
    const amount=this.treadmills.elements['speed-value'];
    amount.classList.toggle('trail-speed-color',!!t);
    if(t)amount.style.setProperty('--trail-speed-color',rgb(t.colors[0]));else amount.style.removeProperty('--trail-speed-color');
    let mult=document.getElementById('trail-speed-mult');if(!mult){mult=document.createElement('span');mult.id='trail-speed-mult';amount.after(mult);}
    const multiplier=(t?.multiplier||1)*this.account.boost('speed')*(this.account.data.commerce?.speedMultiplier||1);mult.hidden=multiplier<=1;mult.textContent=`(x${shopNumber(multiplier)})`;
    this.canvas.dataset.trailEquipped=String(t?.id||0);
  }
  open(){
    if(this.opened||this.player.training)return;
    this.pickaxes?.externalModal?.close?.();this.pickaxes?.close();this.opened=true;this.overlay.hidden=false;
    if(this.pickaxes){this.pickaxes.externalModal=this;this.pickaxes.auto=false;this.pickaxes.clock.cancel();this.pickaxes.refresh();}
    this.player.inputLocked=true;this.player.keys.clear();this.player.touchMove.set(0,0);this.player.touches.clear();this.player.controls.enabled=false;this.render();
    this.root.querySelector('.trail-close').focus();this.canvas.dataset.trailModal='shop';
    Promise.all([document.fonts.load('800 32px OriginalRubik'),document.fonts.load('900 32px OriginalGotham')]).then(()=>{if(this.opened)fitShopText(this.root);});
    clearTimeout(this.scrollTimer);this.scrollTimer=setTimeout(()=>{if(!this.opened)return;const max=Math.max(0,...this.progress.data.owned),best=TRAILS.filter(t=>t.id>max&&money(t.price)<=money(this.account.data.cash)).at(-1);if(best)this.grid.scrollTo({left:this.grid.querySelector(`[data-trail="${best.id}"]`).offsetLeft,behavior:'smooth'});},300);
  }
  close(){
    if(!this.opened)return;this.opened=false;clearTimeout(this.scrollTimer);this.overlay.hidden=true;
    if(this.pickaxes?.externalModal===this){this.pickaxes.externalModal=null;this.pickaxes.refresh();}
    this.player.inputLocked=false;this.player.controls.enabled=true;this.canvas.dataset.trailModal='';this.canvas.focus();
  }
  update(dt){
    this.time+=dt;const transition=this.trigger.update(this.player.motor.position);
    if(transition==='enter'&&!this.player.carryingAnimal&&!this.pickaxes?.modal&&!this.pickaxes?.externalModal&&!this.player.training)this.open();
    if(transition==='leave'&&this.opened)this.close();if(this.player.training&&this.opened)this.close();
    this.sign.visible=this.camera.position.distanceTo(this.sign.position)<200;this.canvas.dataset.trailShopInside=String(this.trigger.inside);
    this.canvas.dataset.trailCash=String(this.account.data.cash);this.canvas.dataset.trailPoints=String(this.ribbon.history.points.length);
    const signature=JSON.stringify([this.progress.data,this.account.data.cash,this.account.boost('speed')]);
    if(signature!==this.signature){this.signature=signature;this.syncEquipment();if(this.opened)this.render();}
    // Origin at the back of the character root, matching the two-unit attachment span.
    this.anchor.set(0,2.7,-.6).applyAxisAngle(THREE.Object3D.DEFAULT_UP,this.player.actor.rotation.y).add(this.player.actor.position);
    this.ribbon.update(dt,this.anchor);
    if(this.opened)for(const card of this.grid.children){const s=SHOP_SOURCE.rarities[card.dataset.rarity];if(s?.speed)card.firstElementChild.style.setProperty('--rarity-text',sourceGradient(s,{phase:this.time}));}
  }
  dispose(){this.close();this.abort.abort();this.resize.disconnect();this.ribbon.dispose();this.root.remove();document.getElementById('trail-speed-mult')?.remove();}
}
