import {readIndexSnapshot,claimIndex} from './index-state.js';
import {INDEX_DATA} from './index-ui/data.js';
import {SHOP_SOURCE} from './shop-ui/source.js';
import {sourceGradient,shopNumber} from './pickaxe-shop.js';

const asset = name => new URL(`./index-ui/${name}`, import.meta.url).href;
const worldIcon=`<img src="${asset('tab-normal.png')}" alt="">`;
const starIcon=`<img src="${asset('tab-limited.png')}" alt="">`;
const bookIcon=`<img src="${asset('book.png')}" alt="">`;
const colors=['#dfb57f','#83d534','#bdefff','#ffb7f4','#9a673b','#70d4ea','#ff7d36','#ffb9e3','#9675e7','#68fba4'];
const allAnimals=INDEX_DATA.zones.flatMap(z=>z.animals);

export {readIndexSnapshot} from './index-state.js';

export class GameIndexUI {
  constructor({account,player,canvas,pickaxes,snapshot=null}) {
    Object.assign(this,{account,player,canvas,pickaxes,snapshot});
    this.page='normal';this.selected='Chicken';this.opened=false;this.scroll={normal:0,limited:0};this.lastState='';
    this.root=document.createElement('div');this.root.id='game-index-ui';
    this.root.innerHTML=`<nav class="game-shortcuts" aria-label="游戏菜单"><button type="button" class="game-shortcut shortcut-shop" id="shop-button" aria-label="Shop 商店"><img src="${asset('shop.png')}" alt=""><b>Shop</b></button><button type="button" class="game-shortcut shortcut-index" id="index-button" aria-label="Index 图鉴" aria-haspopup="dialog" aria-expanded="false"><img src="${asset('book.png')}" alt=""><b>Index</b><span class="index-badge" hidden></span></button></nav>
      <div class="index-screen" hidden><section class="original-index" role="dialog" aria-modal="true" aria-labelledby="index-heading" tabindex="-1">
        <header class="index-topbar studs"><i class="index-header-shine" aria-hidden="true"></i><h2 id="index-heading">Index</h2><button class="index-close" aria-label="关闭 Index">X</button></header>
        <div class="index-list diamond" aria-label="区域动物图鉴"><div class="index-scroll" tabindex="0"></div></div>
        <section class="index-animal-info diamond" aria-label="动物详情"><div class="index-detail-image diamond"></div><strong class="index-detail-name"></strong><b class="index-detail-rarity"></b><b class="index-detail-cash"></b></section>
        <section class="index-reward diamond" aria-label="收集奖励"><b class="index-reward-title">Rewards:</b><div class="index-reward-icons"><div class="index-reward-icon studs"><img src="${asset('speed.webp')}" alt="速度奖励"><b class="index-speed-amount"></b></div><div class="index-reward-icon studs"><img src="${asset('cash.png')}" alt="现金奖励"><b class="index-cash-amount"></b></div></div><button class="index-claim diamond" aria-disabled="true">Claim!</button></section>
        <div class="index-completion diamond"><i></i><b></b><span class="index-book" aria-hidden="true">${bookIcon}</span><button class="index-claim-all diamond" aria-disabled="true"></button></div>
        <nav class="index-tabs" aria-label="图鉴分类"><button class="index-tab-normal studs" data-index-page="normal" aria-pressed="true">${worldIcon}<b>Normal</b></button><button class="index-tab-limited studs" data-index-page="limited" aria-pressed="false">${starIcon}<b>Limited</b></button></nav>
      </section></div>`;
    this.root.querySelector('#shop-button img').src=asset('cart-icon.png');
    this.root.querySelector('#index-button img').src=asset('index-icon.png');
    document.body.append(this.root);
    this.panel=this.root.querySelector('.original-index');this.screen=this.root.querySelector('.index-screen');this.list=this.root.querySelector('.index-scroll');
    this.resizeObserver=new ResizeObserver(()=>this.fitText());this.resizeObserver.observe(this.panel);
    document.fonts.ready.then(()=>this.fitText());
    this.root.querySelector('#index-button').onclick=()=>this.opened?this.close():this.open();
    this.root.querySelector('.index-close').onclick=()=>this.close();
    this.root.querySelector('#shop-button').setAttribute('aria-disabled','true');
    this.root.addEventListener('click',e=>{
      if(e.target.closest('.index-claim-all'))this.claim(null);
      else if(e.target.closest('.index-claim'))this.claim(this.selected);
      const tab=e.target.closest('[data-index-page]');
      if(tab){this.scroll[this.page]=this.list.scrollTop;this.page=tab.dataset.indexPage;this.render();this.list.scrollTop=this.scroll[this.page];}
      const tile=e.target.closest('[data-index-animal]');
      if(tile){this.selected=tile.dataset.indexAnimal;this.renderSelection();}
    });
    this.screen.addEventListener('pointerdown',e=>{if(e.target===this.screen)this.close();});
    this.abort=new AbortController();
    addEventListener('keydown',e=>{
      if(!this.opened)return;
      if(e.code==='Escape'){e.preventDefault();this.close();}
      if(e.code==='Tab'){
        const focusable=[...this.panel.querySelectorAll('button:not([hidden]):not(:disabled),[tabindex="0"]')].filter(e=>e.getClientRects().length);
        const i=focusable.indexOf(document.activeElement);
        if((e.shiftKey&&i<=0)||(!e.shiftKey&&i===focusable.length-1)){e.preventDefault();focusable[e.shiftKey?focusable.length-1:0]?.focus();}
      }
    },{signal:this.abort.signal});
    this.state=this.snapshot?.()||readIndexSnapshot(account);this.refreshBadge();
  }
  claim(name) {
    if(this.snapshot||!this.opened)return;
    const reward=claimIndex(this.account,name);
    if(!reward.count)return;
    this.pickaxes?.bankFeedback?.showRewards(reward);
    this.state=readIndexSnapshot(this.account);
    const top=this.list.scrollTop;this.render();this.list.scrollTop=top;
  }
  open() {
    if(this.opened)return;
    this.pickaxes?.externalModal?.close?.();
    this.pickaxes?.close();
    this.opened=true;this.screen.hidden=false;document.body.dataset.indexOpen='true';
    if(this.pickaxes){this.pickaxes.externalModal=this;this.pickaxes.auto=false;this.pickaxes.clock.cancel();this.pickaxes.refresh();}
    if(this.player){this.player.inputLocked=true;this.player.keys.clear();this.player.touchMove.set(0,0);this.player.touches.clear();this.player.controls.enabled=false;}
    this.root.querySelector('#index-button').setAttribute('aria-expanded','true');
    this.state=this.snapshot?.()||readIndexSnapshot(this.account);this.render();this.list.scrollTop=this.scroll[this.page];
    this.panel.focus();this.canvas.dataset.indexOpen='true';
    this.loadMissingRenders();
  }
  close() {
    if(!this.opened)return;
    this.scroll[this.page]=this.list.scrollTop;this.opened=false;this.screen.hidden=true;delete document.body.dataset.indexOpen;
    if(this.pickaxes?.externalModal===this){this.pickaxes.externalModal=null;this.pickaxes.refresh();}
    if(this.player&&!this.pickaxes?.modal){this.player.inputLocked=false;this.player.controls.enabled=true;}
    this.root.querySelector('#index-button').setAttribute('aria-expanded','false');this.canvas.dataset.indexOpen='false';this.canvas.focus();
  }
  image(animal) {
    const path=INDEX_DATA.assets[String(animal.renderId)]||INDEX_DATA.modelRenders?.[animal.name];
    return path?new URL(path,import.meta.url).href:this.fallbackRenders?.get(animal.name);
  }
  gradient(animal) {
    return sourceGradient(SHOP_SOURCE.rarities[animal.rarity]||SHOP_SOURCE.rarities.Common);
  }
  batImage(zone) {
    const icon=INDEX_DATA.batIcons?.[String(zone.zone)];
    const path=INDEX_DATA.assets[String(zone.batImageId)]||icon?.image;
    return path?`<img src="${new URL(path,import.meta.url).href}" style="transform:rotate(${icon?.rotation||0}deg)" alt="" draggable="false">`:'';
  }
  refreshBadge() {
    const count=allAnimals.filter(a=>this.state.discovered.has(a.name)&&!this.state.claimed.has(a.name)).length;
    const badge=this.root.querySelector('.index-badge');badge.hidden=!count;badge.textContent=count;
  }
  render() {
    const {discovered,claimed}=this.state;
    this.panel.dataset.page=this.page;
    this.root.querySelectorAll('[data-index-page]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.indexPage===this.page)));
    this.list.innerHTML=this.page==='normal'?INDEX_DATA.zones.map(z=>{
      const complete=z.animals.filter(a=>discovered.has(a.name)).length;
      const poster=INDEX_DATA.assets[String(z.imageId)]||INDEX_DATA.zonePosters?.[String(z.zone)];
      return `<section class="index-zone" style="--zone-accent:${colors[z.zone-1]};--extra-rows:${Math.max(0,Math.ceil(z.animals.length/4)-2)}" data-zone="${z.zone}" aria-label="${z.name}">
        <div class="index-zone-image zone-image-${z.zone}" role="img" aria-label="${z.name}">${poster?`<img src="${new URL(poster,import.meta.url).href}" alt="">`:''}</div>
        <div class="index-zone-animals">${z.animals.map(a=>{
          const unlocked=discovered.has(a.name),ready=unlocked&&!claimed.has(a.name),image=this.image(a);
          return `<div class="index-tile-slot"><button class="index-animal diamond ${unlocked?'is-discovered':'is-locked'} ${ready?'is-ready':''}" data-index-animal="${a.name}" data-rarity="${a.rarity}" style="--rarity-bg:${this.gradient(a)}" aria-label="${unlocked?a.displayName:'???'} · ${a.rarity}" aria-pressed="${this.selected===a.name}"><span class="index-card-face"></span>${image?`<img class="index-animal-art" src="${image}" alt="" loading="lazy" draggable="false">`:'<span class="index-render-pending" aria-hidden="true"></span>'}<b class="index-animal-name">${unlocked?a.displayName:'???'}</b></button></div>`;
        }).join('')}</div><div class="index-zone-progress studs" role="progressbar" aria-label="${z.name} 收集进度" aria-valuenow="${complete}" aria-valuemax="${z.animals.length}"><i style="width:${complete/z.animals.length*100}%"></i><b>${complete}/${z.animals.length}</b><span class="index-bat" aria-hidden="true">${this.batImage(z)}</span></div>
      </section>`;
    }).join(''):'';
    this.root.querySelectorAll('.index-animal-info,.index-reward,.index-completion').forEach(el=>el.hidden=this.page!=='normal');
    this.renderSelection();this.refreshBadge();
  }
  renderSelection() {
    const animal=allAnimals.find(a=>a.name===this.selected)||allAnimals[0];this.selected=animal.name;
    const unlocked=this.state.discovered.has(animal.name),claimed=this.state.claimed.has(animal.name);
    this.root.querySelectorAll('[data-index-animal]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.indexAnimal===animal.name)));
    const info=this.root.querySelector('.index-animal-info');info.style.setProperty('--rarity-bg',this.gradient(animal));info.classList.toggle('is-locked',!unlocked);
    const image=this.image(animal);this.root.querySelector('.index-detail-image').innerHTML=image?`<img class="index-animal-art" src="${image}" alt="${unlocked?animal.displayName:'???'}" draggable="false">`:'';
    this.root.querySelector('.index-detail-name').textContent=unlocked?animal.displayName:'???';
    this.root.querySelector('.index-detail-rarity').textContent=animal.rarity;
    this.root.querySelector('.index-detail-cash').textContent=unlocked?`$${shopNumber(animal.cash)}/s`:'???';
    this.root.querySelector('.index-speed-amount').textContent=`+${shopNumber(animal.rewardSpeed)}`;
    this.root.querySelector('.index-cash-amount').textContent=`$${shopNumber(animal.rewardCash)}`;
    const claim=this.root.querySelector('.index-claim');claim.textContent=claimed?'Claimed':'Claim!';claim.classList.toggle('is-ready',unlocked&&!claimed);
    claim.disabled=!!this.snapshot||!unlocked||claimed;claim.setAttribute('aria-disabled',String(claim.disabled));
    const total=allAnimals.filter(a=>this.state.discovered.has(a.name)).length,ready=allAnimals.filter(a=>this.state.discovered.has(a.name)&&!this.state.claimed.has(a.name)).length;
    const completion=this.root.querySelector('.index-completion');completion.querySelector('i').style.width=`${total/allAnimals.length*100}%`;
    completion.querySelector('b').textContent=`Unlocked: ${total}/${allAnimals.length}`;
    const all=completion.querySelector('button');all.disabled=!!this.snapshot||!ready;all.setAttribute('aria-disabled',String(all.disabled));all.hidden=!ready;all.textContent=`Claim!(${ready})`;
    this.canvas.dataset.indexSelected=animal.name;this.canvas.dataset.indexPage=this.page;
    this.fitText();
  }
  fitText() {
    if(!this.opened)return;
    const ctx=this.textContext ||= document.createElement('canvas').getContext('2d');
    ctx.font='800 100px IndexRubik';
    for(const el of this.panel.querySelectorAll('.index-animal-name,.index-detail-name')){
      const max=this.panel.clientWidth*(el.classList.contains('index-animal-name') ? .017 : .035);
      el.style.fontSize=`${Math.min(max,(el.clientWidth-5)/Math.max(1,ctx.measureText(el.textContent).width)*100)}px`;
    }
  }
  async loadMissingRenders() {
    if(allAnimals.every(a=>this.image(a)))return;
    if(this.fallbackRenders||this.renderJob)return;
    this.renderJob=true;
    try {
      const {createRecoveredIndexRenders}=await import('./index-ui/recovered-renders.js');
      this.fallbackRenders=await createRecoveredIndexRenders();
      if(this.opened){const top=this.list.scrollTop;this.render();this.list.scrollTop=top;}
    } catch(error) {console.warn('Index model renders',error);}
  }
  update(dt=.25) {
    this.refreshTime=(this.refreshTime||0)+dt;if(this.refreshTime<.2)return;this.refreshTime=0;
    const state=this.snapshot?.()||readIndexSnapshot(this.account);
    const signature=[...state.discovered].sort().join(',')+'|'+[...state.claimed].sort().join(',');
    if(signature!==this.lastState){this.lastState=signature;this.state=state;this.refreshBadge();if(this.opened){const top=this.list.scrollTop;this.render();this.list.scrollTop=top;}}
    if(this.player?.training){if(this.opened)this.close();this.root.querySelector('.shortcut-index').hidden=true;}
    else this.root.querySelector('.shortcut-index').hidden=false;
  }
}
