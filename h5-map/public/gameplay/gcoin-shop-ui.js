import {gPrice,productOf} from './commerce/catalog.js';
import {SourceGui} from './gcoin-shop/layout-gui.js';
const base=new URL('./gcoin-shop/',import.meta.url);
const short=n=>n>=1e9?`${n/1e9}B`:n>=1e6?`${n/1e6}M`:n>=1e3?`${n/1e3}K`:String(n);

// Presentation only. Commerce state is supplied by a future authoritative adapter.
// No purchase callback, balance mutation, local entitlement grant or saved prices.
export class GameGcoinShopUI {
  static async create(options={}) {
    const [layout,assets,catalog,animalLayout]=await Promise.all(['layout.json','assets.json','catalog.json','animalinfo.json'].map(async name=>{const r=await fetch(new URL(name,base));if(!r.ok)throw new Error(`Shop ${name}: ${r.status}`);return r.json();}));
    const ui=new GameGcoinShopUI({...options,layout,assets,catalog,animalLayout});await ui.ready;return ui;
  }
  constructor({layout,assets,catalog,animalLayout,account,player,canvas,pickaxes,snapshot=null,button=document.querySelector('#shop-button')}){
    // Token redemption is not available yet; omit its offers before layout.
    layout=JSON.parse(JSON.stringify(layout));
    const scroll=layout.children.find(node=>node.props.Name==='ScrollingFrame');
    scroll.children=scroll.children.filter(node=>!['FallenTokens','Splitter_Fallen_Tokens'].includes(node.props.Name));
    catalog={...catalog,products:catalog.products.filter(product=>product.group!=='FallenTokenPacks')};
    Object.assign(this,{catalog,account,player,canvas,pickaxes,snapshot,button});this.opened=false;
    if(!document.querySelector('link[data-gcoin-shop]')){const style=document.createElement('link');style.rel='stylesheet';style.href=new URL('./gcoin-shop-ui.css',import.meta.url);style.dataset.gcoinShop='true';document.head.append(style);}
    this.root=document.createElement('div');this.root.id='game-gcoin-shop';this.root.hidden=true;this.root.innerHTML='<div class="gcoin-shop-screen"><section class="gcoin-shop-stage" role="dialog" aria-modal="true" aria-label="Shop" tabindex="-1"></section></div>';
    this.panel=this.root.querySelector('section');this.screen=this.root.firstElementChild;this.gui=new SourceGui(layout,assets,{plainText:true});
    this.shopFrame=this.gui.create(layout,{x:0,y:0,w:1000,h:1000/1.98});this.panel.append(this.shopFrame);document.body.append(this.root);
    this.animalGui=new SourceGui(animalLayout,assets,{plainText:true});this.animalFrame=this.animalGui.create(animalLayout,{x:0,y:0,w:230,h:230/1.9554795});this.animalFrame.hidden=true;this.animalFrame.style.zIndex='100';this.animalFrame.setAttribute('role','tooltip');this.panel.append(this.animalFrame);
    this.animalGui.byPath.get('/AnimalInfo/List/Earnings').el.hidden=true;
    this.gui.scroll.addEventListener('scroll',()=>this.hideAnimal());
    this.products=[];this.bindCatalog();this.gui.fitAll();
    this.loadFonts=()=>this.fontJob ||= Promise.all([document.fonts.load('900 40px ShopGotham'),document.fonts.load('800 40px ShopRubik'),document.fonts.load('900 40px ShopMerriweather')]).then(()=>{this.gui.fitAll();this.layoutSpeedAmount();}).catch(error=>{this.fontJob=null;console.warn('Shop font loading deferred',error);});
    const css=document.querySelector('link[data-gcoin-shop]');this.ready=css.sheet?Promise.resolve():new Promise((resolve,reject)=>{css.addEventListener('load',resolve,{once:true});css.addEventListener('error',()=>reject(new Error('Shop stylesheet failed to load')),{once:true});});
    this.gui.nodes.find(r=>r.path==='/Shop/TopBar/Close').el.onclick=()=>this.close();
    if(button){button.removeAttribute('aria-disabled');button.setAttribute('aria-haspopup','dialog');button.setAttribute('aria-expanded','false');button.onclick=()=>this.opened?this.close():this.open();}
    this.screen.addEventListener('pointerdown',e=>{if(e.target===this.screen)this.close();});
    for(const type of ['pointerdown','pointerup','wheel','touchstart','touchmove'])this.root.addEventListener(type,e=>e.stopPropagation(),{passive:true});
    this.abort=new AbortController();addEventListener('resize',()=>this.resize(),{signal:this.abort.signal});
    addEventListener('keydown',e=>{
      if(!this.opened)return;
      if(e.code==='Escape'){e.preventDefault();e.stopImmediatePropagation();this.close();return;}
      if(e.code==='Tab'){
        const nodes=[...this.panel.querySelectorAll('button,[tabindex="0"]')].filter(n=>n.getClientRects().length),i=nodes.indexOf(document.activeElement);
        if((e.shiftKey&&i<=0)||(!e.shiftKey&&(i<0||i===nodes.length-1))){e.preventDefault();nodes[e.shiftKey?nodes.length-1:0]?.focus();}
      }
      if(['KeyW','KeyA','KeyS','KeyD','KeyF','Digit1','Digit2'].includes(e.code))e.stopImmediatePropagation();
    },{capture:true,signal:this.abort.signal});
    this.resize();this.refresh();
  }
  bindCatalog(){
    for(const product of this.catalog.products){
      const record=this.gui.nodes.find(r=>r.node.props.Name===product.card);if(!record)throw new Error(`Missing Shop card ${product.card}`);
      const records=this.gui.nodes.filter(r=>r.path.startsWith(record.path+'/'));
      const purchase=records.find(r=>r.node.props.Name===(product.purchase||'Purchase'));
      const price=records.find(r=>r.path===purchase.path+'/Price');
      this.products.push({...product,record,purchase,price});
      for(const r of records)if(r.image&&r.path.startsWith(purchase.path+'/Price/'))r.el.hidden=true;
      purchase.el.dataset.productId=String(product.id);purchase.el.dataset.payId=String(product.id);purchase.el.setAttribute('aria-disabled','true');purchase.el.setAttribute('aria-label',`购买 ${product.card}${product.amount?' '+short(product.amount):''}`);
      let title;
      if(product.group==='SpeedPacks')title=`<font color="${product.amount>=5e7?'#ffc800':'#00FF00'}">+${short(product.amount)}</font> SPEED`;
      if(product.group==='CashPacks')title=`$${short(product.amount)}`;
      if(title)this.gui.setText(records.find(r=>r.path===record.path+'/Inner/Title'),title);
      if(product.group==='Featured')this.gui.setText(records.find(r=>r.path===purchase.path+'/Amount'),`${product.amount} ${product.amount===1?'Egg':'Eggs'}`);
    }
    this.speedCard=this.gui.nodes.find(r=>r.node.props.Name==='DoubleSpeed');
    const speedNodes=this.gui.nodes.filter(r=>r.path.startsWith(this.speedCard.path+'/'));
    this.speed={before:speedNodes.find(r=>r.node.props.Name==='Before'),after:speedNodes.find(r=>r.node.props.Name==='After'),purchase:speedNodes.find(r=>r.node.props.Name==='Purchase'),price:speedNodes.find(r=>r.node.props.Name==='Price')};
    this.speed.purchase.el.setAttribute('aria-disabled','true');this.speed.purchase.el.setAttribute('aria-label','购买下一档速度倍率');
    for(let i=0;i<6;i++){
      const node=this.gui.nodes.find(r=>r.path.endsWith(`/AnimalsDisplay/Animal${i+3}`));node.el.setAttribute('aria-label',`${this.catalog.animalInfo[i].name} ${this.catalog.odds[i]}%`);
      node.el.onpointerenter=e=>{if(e.pointerType!=='touch')this.showAnimal(i,node.el,e);};node.el.onpointermove=e=>{if(this.activeAnimal===i)this.positionAnimal(node.el,e);};node.el.onpointerleave=e=>{if(e.pointerType!=='touch')this.hideAnimal();};node.el.onfocus=()=>{if(node.el.matches(':focus'))this.showAnimal(i,node.el);};node.el.onblur=()=>this.hideAnimal();
      node.el.onclick=e=>{if(e.pointerType==='touch'){if(this.activeAnimal===i)this.hideAnimal();else{this.showAnimal(i,node.el);this.animalTimeout=setTimeout(()=>this.hideAnimal(),2500);}}else this.showAnimal(i,node.el);};
      this.gui.setText(this.gui.nodes.find(r=>r.path===node.path+'/Chance')||this.gui.nodes.find(r=>r.path===node.path+'/Inner'&&r.text),`${this.catalog.odds[i]}%`);
    }
    this.timer=this.gui.nodes.find(r=>r.path.endsWith('/EggsPack/Inner/Timer'));
    // the authored example countdown as if it were an active offer.
    if(this.timer)this.timer.el.hidden=true;
  }
  refresh(){
    const state=this.snapshot?.()||this.account?.data?.commerce||this.account?.data?.shop||{},owned=new Set(state.owned||[]),prices=state.prices||{};
    for(const p of this.products){
      const bought=!!p.owned&&(owned.has(p.id)||owned.has(p.owned));const value=prices[p.id];
      this.gui.setText(p.price,bought?'BOUGHT!':this.snapshot?(Number.isFinite(value)?String(value):'—'):gPrice(p.id));p.purchase.el.dataset.owned=String(bought);
      p.purchase.el.dataset.priceStatus=bought?'owned':this.snapshot?'unavailable':'gcoins';
      p.purchase.el.setAttribute('aria-disabled',String(bought||!this.account?.commerce?.available||this.account.commerce.busy));
    }
    const multiplier=Number(state.speedMultiplier)||1,next=this.catalog.speedTiers.find(t=>t.multiplier>multiplier);
    this.gui.setText(this.speed.before,`x${multiplier}`);this.gui.setText(this.speed.after,next?`x${next.multiplier}`:'MAX');
    this.layoutSpeedAmount();
    this.gui.setText(this.speed.price,next?(this.snapshot?(Number.isFinite(prices[next.id])?String(prices[next.id]):'—'):gPrice(next.id)):'MAXED');
    this.speed.purchase.el.dataset.productId=next?String(next.id):'';this.speed.purchase.el.dataset.payId=next?String(next.id):'';this.speed.purchase.el.setAttribute('aria-disabled',String(!next||!this.account?.commerce?.available||this.account.commerce.busy));
    const end=state.featuredEndsAt;
    if(this.timer){this.timer.el.hidden=!Number.isFinite(end);if(Number.isFinite(end)){const s=Math.max(0,Math.ceil((end-Date.now())/1000));this.gui.setText(this.timer,`${Math.floor(s/86400)}d ${Math.floor(s%86400/3600)}h ${Math.floor(s%3600/60)}m ${s%60}s`);}}
  }
  layoutSpeedAmount(){
    const parent=this.gui.byPath.get(this.speed.before.path.replace('/Before','')),icon=this.gui.byPath.get(parent.path+'/Icon'),gap=parent.rect.w*.025;
    for(const r of [this.speed.before,this.speed.after]){this.gui.context.font=`900 ${r.rect.h/1.06}px ShopGotham`;r.rect.w=this.gui.context.measureText(r.text.textContent).width+2;r.el.style.width=`${r.rect.w}px`;this.gui.fit(r);}
    let x=(parent.rect.w-this.speed.before.rect.w-this.speed.after.rect.w-icon.rect.w-2*gap)/2;
    for(const r of [this.speed.before,icon,this.speed.after]){r.el.style.left=`${x}px`;x+=r.rect.w+gap;}
  }
  resize(){
    const mobile=innerWidth<600||innerHeight<480;
    const width=Math.min(innerWidth*(mobile?.94:.7),innerHeight*(mobile?.78:.625)*1.98);
    this.panel.style.setProperty('--shop-scale',String(width/1000));
    this.hideAnimal();
  }
  showAnimal(i,anchor,event){
    clearTimeout(this.animalTimeout);this.activeAnimal=i;const info=this.catalog.animalInfo[i];this.animalFrame.hidden=false;
    this.animalGui.setText(this.animalGui.byPath.get('/AnimalInfo/List/AnimalName'),info.name);
    const rarity=this.animalGui.byPath.get('/AnimalInfo/List/Rarity');this.animalGui.setText(rarity,info.rarity);this.animalGui.fitAll();this.positionAnimal(anchor,event);
  }
  positionAnimal(anchor,event){
    const p=this.panel.getBoundingClientRect(),a=anchor.getBoundingClientRect(),s=p.width/1000,w=230*s,h=230/1.9554795*s;
    const left=event?.clientX??a.right,top=event?.clientY??(a.top+a.height/2);let x=left+30;if(x+w>innerWidth)x=(event?.clientX??a.left)-30-w;
    this.animalFrame.style.left=`${(Math.max(0,Math.min(innerWidth-w,x))-p.left)/s}px`;this.animalFrame.style.top=`${(Math.max(0,Math.min(innerHeight-h,top-h/2))-p.top)/s}px`;
  }
  hideAnimal(){if(this.animalFrame)this.animalFrame.hidden=true;this.activeAnimal=null;clearTimeout(this.animalTimeout);}
  open(){
    if(this.opened||this.player?.training)return;
    void this.loadFonts();
    this.pickaxes?.externalModal?.close?.();this.pickaxes?.close();
    if(this.pickaxes){this.pickaxes.externalModal=this;this.pickaxes.auto=false;this.pickaxes.clock.cancel();this.pickaxes.refresh();}
    if(this.player){this.player.inputLocked=true;this.player.keys.clear();this.player.touchMove.set(0,0);this.player.touches.clear();this.player.controls.enabled=false;}
    this.opened=true;this.root.hidden=false;this.button?.setAttribute('aria-expanded','true');document.body.dataset.shopOpen='true';if(this.canvas)this.canvas.dataset.shopOpen='true';this.refresh();this.resize();this.panel.focus();this.gui.fitAll();
  }
  close(){
    this.hideAnimal();
    if(!this.opened)return;this.opened=false;this.root.hidden=true;this.button?.setAttribute('aria-expanded','false');delete document.body.dataset.shopOpen;if(this.canvas)this.canvas.dataset.shopOpen='false';
    if(this.pickaxes?.externalModal===this){this.pickaxes.externalModal=null;this.pickaxes.refresh();}
    if(this.player&&!this.pickaxes?.modal&&!this.pickaxes?.externalModal){this.player.inputLocked=false;this.player.controls.enabled=true;}
    this.button?.focus();
  }
  openSection(name){this.open();const record=this.gui.nodes.find(r=>r.path===`/Shop/ScrollingFrame/${name}`);if(record)this.gui.scroll.scrollTop=record.rect.y;}
  update(dt=.016){
    if(this.player?.training&&this.opened)this.close();if(this.button)this.button.hidden=!!this.player?.training;
    this.elapsed=(this.elapsed||0)+dt;if(this.opened&&this.elapsed>=1){this.elapsed=0;this.refresh();}
  }
}
