import {gPrice} from './commerce/catalog.js';
import {SourceGui} from './gcoin-shop/layout-gui.js';
import {shopNumber} from './pickaxe-shop.js';

// Layout archived verbatim from StarterGui/MainGUI/Frames/OfflineRewards.
const assets={'100451594632335':'100451594632335.png','116016239612262':'116016239612262.png','128094943388135':'../inventory-ui/sunray.png','136393561370347':'../inventory-ui/bevel.png','96154824437669':'../inventory-ui/diamond.png'};
export class OfflineRewardUI {
  constructor({economy,player,pickaxes,canvas}){
    Object.assign(this,{economy,player,pickaxes,canvas});this.last=0n;this.opened=false;this.busy=false;
    const css=document.createElement('link');css.rel='stylesheet';css.href=new URL('./offline-reward-ui.css',import.meta.url);document.head.append(css);
    this.ready=Promise.all([fetch(new URL('./offline-ui/layout.json',import.meta.url)).then(r=>{if(!r.ok)throw new Error('OfflineRewards layout unavailable');return r.json();}),new Promise((resolve,reject)=>{css.onload=resolve;css.onerror=reject;})]).then(async([layout])=>{
      this.root=document.createElement('div');this.root.id='pasture-offline';this.root.hidden=true;
      this.panel=document.createElement('section');this.panel.className='offline-stage';this.panel.tabIndex=-1;this.panel.setAttribute('role','dialog');this.panel.setAttribute('aria-modal','true');this.panel.setAttribute('aria-label','Offline Cash');
      this.gui=new SourceGui(layout,assets);this.panel.append(this.gui.create(layout,{x:0,y:0,w:1000,h:1000/1.55826199}));this.root.append(this.panel);document.body.append(this.root);
      this.claimStatus=document.createElement('div');this.claimStatus.className='offline-claim-status';this.claimStatus.setAttribute('role','status');this.claimStatus.hidden=true;this.panel.append(this.claimStatus);
      const get=path=>this.gui.byPath.get('/OfflineRewards/'+path);
      this.amount=get('Amount');this.claim=get('Claim').el;
      this.gui.setText(get('Claim/Title'),'Claim');this.claim.setAttribute('aria-label','Claim');this.claim.onclick=()=>this.collect();
      const paid=get('GcoinClaim').el;paid.dataset.payId='3712778476';paid.setAttribute('aria-label','G币双倍领取');
      this.gui.setText(get('GcoinClaim/Title'),gPrice(3712778476));
      get('GcoinClaim/Title').el.classList.add('offline-price');
      for(const r of this.gui.texts){const stroke=r.node.children.find(n=>n.className==='UIStroke')?.props;if(stroke&&!r.node.children.some(n=>n.className==='UIGradient'))r.text.style.webkitTextStroke=`${Number(stroke.Thickness)*2}px #201b14`;if(r.node.props.FontFace?.Family?.url==='asset://12187365977')r.text.style.fontFamily='ShopRubik';if(r.node.props.FontFace?.Style==='Italic')r.text.style.fontStyle='italic';if(r.path.includes('/TopBar/Title'))r.text.style.webkitTextStroke='6px black';}
      for(const type of ['pointerdown','pointerup','wheel','touchstart','touchmove'])this.root.addEventListener(type,e=>e.stopPropagation(),{passive:true});
      this.root.addEventListener('keydown',e=>{if(e.code==='Tab'){e.preventDefault();this.claim.focus();}if(['Space','KeyE','Digit1','Digit2'].includes(e.code))e.stopPropagation();});
      addEventListener('resize',()=>this.resize());await Promise.all([document.fonts.load('800 40px ShopRubik'),document.fonts.load('900 40px ShopGotham')]);this.gui.fitAll();get('GcoinClaim/Title').text.style.fontSize='88px';this.resize();this.update();
    }).catch(e=>{console.error('Offline Cash UI:',e);});
  }
  resize(){const mobile=innerWidth<600||innerHeight<480;this.panel.style.setProperty('--offline-scale',Math.min(innerWidth*(mobile?.9:.7),innerHeight*(mobile?.76:.625)*1.55826199)/1000);}
  showClaimStatus(message=''){if(!this.claimStatus)return;this.claimStatus.textContent=message;this.claimStatus.hidden=!message;}
  update(){
    if(!this.gui)return;const cash=this.economy.ledger.pending;
    if(cash<=0n){this.last=0n;this.close();return;}
    if(cash===this.last)return;this.last=cash;this.gui.setText(this.amount,'$'+shopNumber(cash));this.open();
  }
  open(){
    this.pickaxes.externalModal?.close?.();this.pickaxes.close();this.pickaxes.externalModal=this;this.pickaxes.auto=false;this.pickaxes.clock.cancel();this.pickaxes.refresh();
    this.player.inputLocked=true;this.player.keys.clear();this.player.touchMove.set(0,0);this.player.touches.clear();this.player.controls.enabled=false;
    this.opened=true;this.root.hidden=false;this.canvas.dataset.shopOpen='true';document.body.dataset.shopOpen='true';this.resize();this.claim.focus();
  }
  close(){
    if(!this.opened)return;this.opened=false;this.root.hidden=true;
    this.showClaimStatus();
    if(this.pickaxes.externalModal===this){this.pickaxes.externalModal=null;this.pickaxes.refresh();delete document.body.dataset.shopOpen;this.canvas.dataset.shopOpen='false';}
    if(!this.pickaxes.modal&&!this.pickaxes.externalModal){this.player.inputLocked=false;this.player.controls.enabled=true;}
  }
  collect(){
    if(this.economy.account.commerce?.busy||this.busy||!this.opened||this.economy.ledger.pending<=0n)return;
    this.busy=true;this.claim.disabled=true;
    const cash=this.economy.claim();
    if(cash){this.update();this.pickaxes.bankFeedback.show([{image:new URL('./gcoin-shop/100451594632335.png',import.meta.url).href,text:'$'+shopNumber(cash)}],{rewards:true});}
    setTimeout(()=>{this.busy=false;this.claim.disabled=false;},3000);
  }
}
