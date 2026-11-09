import {gameAudio} from './game-audio.js';
import * as THREE from 'three';
import {bindSceneTap} from './scene-tap.js';
import {CONFIG} from './config.js';
import {PickaxeProgress,SwingClock,speciesOf} from './pickaxe-state.js';
import {PickaxeAssets} from './pickaxe-assets.js';
import {EggWorld} from './egg-world.js';
import {pickHit} from './targeting.js';
import {money} from './currency.js';
import {formatNumber} from '../treadmill-state.js';
import {shopCards,fitShopText,animateShopGradients} from './pickaxe-shop.js';
import {inverseToolGrip,heldPickaxePose} from './pickaxe-pose.js';
import {HOTBAR_TOOLS} from './hotbar-ui/tools.js';
import {BankFeedback} from './bank-feedback.js';
import {updateShopCards} from './shop-card-dom.js';

const petNames={Chicken:'小鸡',Cat:'猫',Bat:'蝙蝠',Anteater:'食蚁兽',Badger:'獾',Parrot:'鹦鹉',GoldenRetriver:'金毛犬',Bear:'熊'};
const rarityNames={Common:'普通',Uncommon:'优秀',Rare:'稀有',Epic:'史诗',Legendary:'传说',Mythic:'神话',Divine:'神圣',Cosmic:'宇宙',Secret:'秘密',Celestial:'天界',Void:'虚空',Omega:'终极',Inferno:'炼狱'};
const pickIcon='<svg viewBox="0 0 64 64" aria-hidden="true"><path d="M18 55L43 16" stroke="#a47b50" stroke-width="8" stroke-linecap="round"/><path d="M10 21Q28 4 49 13L58 26 44 23 38 17 28 17 15 26Z" fill="currentColor" stroke="#142636" stroke-width="2"/></svg>';
const petValue=name=>speciesOf(name)?.sellValue||'0';

export class PickaxeSystem {
  static async create(scene,player,camera,canvas,account,{mapParts=[]}={}){
    const s=new PickaxeSystem(scene,player,camera,canvas,account);
    s.eggs=await EggWorld.create(scene,s.progress,{world:player.world,player,canvas,camera,mapParts});
    if(s.progress.data.equipped)await s.changeTier(s.progress.data.equipped);
    s.refresh();return s;
  }
  constructor(scene,player,camera,canvas,account){
    Object.assign(this,{scene,player,camera,canvas,account});this.progress=new PickaxeProgress(account);this.assets=new PickaxeAssets();this.clock=new SwingClock();
    this.arm=player.model.getObjectByName('armR');this.hand=player.model.getObjectByName('handR');
    if(!this.arm||!this.hand)throw Error('人物右手骨骼缺失');
    this.handRest=this.hand.quaternion.clone();
    this.grip=new THREE.Object3D();this.grip.position.set(0,.00645,0);this.hand.add(this.grip);
    this.mount=new THREE.Group();this.mount.name='Equipped pickaxe';scene.add(this.mount);
    this.loaded=null;this.busy=false;this.auto=false;this.modal=null;this.pointer=null;this.confirmPet=null;this.hitCount=0;this.loadVersion=0;this.thumbnails=new Map();
    this.origin=new THREE.Vector3();this.forward=new THREE.Vector3();this.box=new THREE.Box3();this.previousBox=new THREE.Box3();this.popups=[];
    this.makeUI();this.bindInput();this.bankFeedback=new BankFeedback(camera);
  }
  makeUI(){
    this.ui=document.createElement('div');this.ui.id='pickaxe-ui';
    this.ui.innerHTML=`<div class="pickaxe-hotbar" role="toolbar" aria-label="装备快捷栏"><button id="pickaxe-slot" class="tool-slot" aria-pressed="true"><img id="pickaxe-slot-image" alt=""><span id="pickaxe-name" class="tool-name two-lines"></span><kbd>1</kbd></button></div>
      <button id="auto-pickaxe" aria-pressed="false" aria-label="Auto Swing"><img src="./gameplay/hotbar-ui/auto-swing.png" alt=""><span class="auto-swing-title">Auto Swing</span></button>
      <div id="egg-health" hidden><strong></strong><div><i></i></div><small></small></div>
      <div id="pickaxe-feedback" role="status"></div><div id="egg-popups" aria-hidden="true"></div>
      <div id="pickaxe-overlay" hidden><section class="pickaxe-panel" role="dialog" aria-modal="true" aria-labelledby="pickaxe-panel-title"><header><div><small>装备与收藏</small><h2 id="pickaxe-panel-title">镐子商店</h2></div><strong id="pickaxe-cash"></strong><button id="pickaxe-close" aria-label="关闭">×</button></header><div id="pickaxe-grid"></div></section></div>`;
    document.body.append(this.ui);this.el=Object.fromEntries([...this.ui.querySelectorAll('[id]')].map(e=>[e.id,e]));
    this.shopResize=new ResizeObserver(()=>{if(this.modal==='shop')fitShopText(this.el['pickaxe-overlay']);});this.shopResize.observe(this.el['pickaxe-grid']);
    document.fonts.ready.then(()=>{if(this.modal==='shop')fitShopText(this.el['pickaxe-overlay']);});
    this.el['pickaxe-grid'].addEventListener('wheel',e=>{if(this.modal==='shop'&&Math.abs(e.deltaY)>Math.abs(e.deltaX)){e.preventDefault();this.el['pickaxe-grid'].scrollLeft+=e.deltaY;}},{passive:false});
    this.el['pickaxe-close'].onclick=()=>this.close();this.el['pickaxe-overlay'].onclick=e=>{if(e.target===this.el['pickaxe-overlay'])this.close();};
    this.el['pickaxe-slot'].onclick=()=>this.toggleEquip();
    this.el['auto-pickaxe'].onclick=()=>{
      if(this.busy||this.modal||this.externalModal||this.player.training||!this.progress.data.equipped||this.clock.time-(this.lastAutoToggle??-Infinity)<.2)return;
      this.lastAutoToggle=this.clock.time;this.auto=!this.auto;this.refresh();
    };
    this.el['pickaxe-grid'].onclick=e=>{
      const b=e.target.closest('button');if(!b)return;
      if(b.dataset.tier)this.changeTier(Number(b.dataset.tier),!this.progress.data.owned.includes(Number(b.dataset.tier)));
      if(b.dataset.pet)this.sell(b.dataset.pet);
      if(b.dataset.cancel){this.confirmPet=null;this.refresh();}
    };
  }
  bindInput(){
    this.abort=new AbortController();const opts={signal:this.abort.signal};
    addEventListener('keydown',e=>{
      if(e.target.matches?.('input,textarea,select,[contenteditable=true]'))return;
      if(e.code==='Escape'){this.close();return;}
      if(this.externalModal&&this.externalModal!==this.backpack)return;
      if(this.modal){
        if(e.code==='Tab'){const buttons=[...this.el['pickaxe-overlay'].querySelectorAll('button:not(:disabled)')];const i=buttons.indexOf(document.activeElement);if((e.shiftKey&&i<=0)||(!e.shiftKey&&i===buttons.length-1)){e.preventDefault();buttons[e.shiftKey?buttons.length-1:0]?.focus();}}return;
      }
      if(e.repeat)return;
      if(e.code==='Digit1'){e.preventDefault();this.toggleEquip();}
      if(e.code==='KeyF'){e.preventDefault();if(this.weapons?.equipped)this.weapons.swing();else this.swing();}
    },opts);
    bindSceneTap(this.canvas,e=>{
      if(this.player.equippedPet||this.modal||this.externalModal||(window.gameHostState?.paused||document.hidden)||window.gameHostState?.paused)return;
      if(this.weapons?.equipped){this.weapons.swing();return;}
      const rect=this.canvas.getBoundingClientRect(),ray=new THREE.Raycaster();ray.setFromCamera(new THREE.Vector2((e.clientX-rect.left)/rect.width*2-1,1-(e.clientY-rect.top)/rect.height*2),this.camera);
      const hit=ray.intersectObjects(this.eggs.eggs.filter(x=>x.life.alive).map(x=>x.root),true)[0];
      if(hit){const d=hit.point.clone().sub(this.player.actor.position);if(d.length()<CONFIG.hitRange+3)this.player.actor.rotation.y=Math.atan2(d.x,d.z);}
      this.swing();
    },opts);
    const pause=()=>{this.auto=false;this.pointer=null;this.clock.cancel();this.refresh();};
    addEventListener('blur',pause,opts);window.addEventListener('game-host-pause',()=>{if((window.gameHostState?.paused||document.hidden))pause();},opts);
  }
  open(kind){this.externalModal?.close?.();this.modal=kind;this.auto=false;this.clock.cancel();this.player.inputLocked=true;this.player.keys.clear();this.player.touchMove.set(0,0);this.player.touches.clear();this.player.controls.enabled=false;this.el['pickaxe-overlay'].hidden=false;this.el['pickaxe-overlay'].classList.toggle('original-shop',kind==='shop');this.el['pickaxe-panel-title'].classList.toggle('original-fit',kind==='shop');this.el['pickaxe-panel-title'].style.fontSize='';this.el['pickaxe-close'].textContent=kind==='shop'?'X':'×';this.refresh();this.el['pickaxe-close'].focus();if(kind==='shop'){Promise.all([document.fonts.load('800 32px OriginalRubik'),document.fonts.load('900 32px OriginalGotham')]).then(()=>{if(this.modal==='shop')fitShopText(this.el['pickaxe-overlay']);});this.prepareThumbnails();const best=CONFIG.tiers.filter(t=>t.tier>Math.max(...this.progress.data.owned)&&money(t.price)<=money(this.account.data.cash)).at(-1);if(best)this.el['pickaxe-grid'].scrollTo({left:(best.tier-1)*this.el['pickaxe-grid'].clientWidth*.333,behavior:'smooth'});}}
  async prepareThumbnails(){
    if(this.thumbnailJob)return;this.thumbnailJob=true;
    for(const tier of CONFIG.tiers){try{this.thumbnails.set(tier.tier,await this.assets.thumbnail(tier.tier));this.ui.querySelectorAll(`[data-art="${tier.tier}"]`).forEach(el=>{el.innerHTML=`<img src="${this.thumbnails.get(tier.tier)}" alt="">`;});}catch(e){console.warn('商店预览',tier.tier,e);}}
    this.assets.previewRenderer?.dispose();this.assets.previewRenderer=null;
  }
  art(tier){return `<span data-art="${tier}">${this.thumbnails.has(tier)?`<img src="${this.thumbnails.get(tier)}" alt="">`:pickIcon}</span>`;}
  close(){if(!this.modal)return;this.modal=null;this.confirmPet=null;this.player.inputLocked=false;this.player.controls.enabled=true;this.el['pickaxe-overlay'].hidden=true;this.canvas.focus();}
  notify(message){this.el['pickaxe-feedback'].textContent=message;this.feedbackUntil=this.clock.time+3;}
  toggleEquip(){
    if(this.backpack)++this.backpack.version;
    if(this.backpack?.opened)this.backpack.close();
    if(this.player.equippedPet){this.backpack.unequip();if(this.progress.data.equipped&&!this.weapons?.equipped)return true;}
    if(this.player.carryingAnimal||this.busy||this.weapons?.busy||this.externalModal||this.player.inputLocked)return;
    if(this.progress.data.equipped!==null){this.progress.equip(null);this.clock.cancel();this.auto=false;this.mount.visible=false;this.refresh();}
    else this.changeTier(this.progress.data.selected);
  }
  async changeTier(tier,buy=false){
    if(this.player.carryingAnimal || this.busy || this.weapons?.busy || !CONFIG.tiers[tier-1] || (!buy&&!this.progress.data.owned.includes(tier)))return false;
    if(this.player.training){this.notify('结束训练后再装备');return false;}
    this.busy=true;this.clock.cancel();this.refresh();const version=++this.loadVersion;
    try{
      const next=await this.assets.create(tier);
      if(version!==this.loadVersion){next.dispose();return false;}
      if(this.player.carryingAnimal||this.player.training||this.externalModal||this.player.motor.externalMotion){next.dispose();return false;}
      const wasWeapon=this.weapons?.equipped;
      if(wasWeapon)this.weapons.unequip(false);
      const ok=buy?this.progress.buy(tier):this.progress.equip(tier);
      if(!ok){if(wasWeapon)this.weapons.progress.data.equipped=wasWeapon;next.dispose();this.notify('现金不足');return false;}
      this.loaded?.dispose();this.loaded=next;this.mount.add(next.root);
      inverseToolGrip(CONFIG.tiers[tier-1].grip).decompose(next.root.position,next.root.quaternion,next.root.scale);
      this.mount.scale.setScalar(1);this.previousBox.makeEmpty();this.refresh();return true;
    }catch(e){console.error('镐子加载',e);this.notify('模型加载失败，请重试');return false;}
    finally{this.busy=false;this.refresh();}
  }
  swing(){
    if(!this.clock.start(!this.player.equippedPet&&!this.player.carryingAnimal&&!this.busy&&!this.modal&&!this.externalModal&&!this.player.training&&!this.player.motor.externalMotion&&!!this.progress.data.equipped&&!!this.loaded))return false;
    this.previousBox.makeEmpty();this.sound(false);return true;
  }
  sound(hit){if(!hit)gameAudio.play('swing');}

  banked(pet){
    this.bankFeedback.show([pet]);this.refresh();
  }
  sell(id){
    const pet=this.progress.data.pets.find(p=>p.id===id);if(!pet)return;
    if(this.confirmPet!==id){this.confirmPet=id;this.refresh();return;}
    if(this.progress.sell(id)){this.confirmPet=null;this.notify(`已出售 ${petNames[pet.name]||pet.name} · +$${formatNumber(petValue(pet.name))}`);this.refresh();}
  }
  refresh(){
    const focused=document.activeElement?.closest('#pickaxe-grid button'),focusTier=focused?.dataset.tier,focusPet=focused?.dataset.pet;
    const d=this.progress.data,t=CONFIG.tiers[(d.equipped||d.selected)-1];
    const tool=HOTBAR_TOOLS[t.tier-1],image=this.el['pickaxe-slot-image'];
    const imageURL=new URL(`./hotbar-ui/${tool.image}`,import.meta.url).href;if(image.src!==imageURL)image.src=imageURL;
    this.el['pickaxe-name'].innerHTML=tool.name.replace(/ Pickaxe$/,'<br>Pickaxe');
    this.el['pickaxe-slot'].setAttribute('aria-label',tool.name);this.el['pickaxe-slot'].setAttribute('aria-pressed',String(d.equipped!==null&&!this.player.training&&!this.player.equippedPet));
    this.el['auto-pickaxe'].setAttribute('aria-pressed',String(this.auto));
    this.el['auto-pickaxe'].hidden=d.equipped===null||!!this.player.training||!!this.player.equippedPet;
    for(const id of ['pickaxe-slot','auto-pickaxe'])this.el[id].disabled=this.busy||!!this.weapons?.busy||!!this.player.training||!!this.modal||!!(this.externalModal&&this.externalModal!==this.backpack);
    this.el['pickaxe-cash'].textContent=`$${formatNumber(this.account.data.cash)}`;
    this.el['pickaxe-panel-title'].textContent=this.modal==='pets'?'孵化动物':'Pickaxe Shop';
    if(this.modal==='shop'){const scroll=this.el['pickaxe-grid'].scrollLeft;if(updateShopCards(this.el['pickaxe-grid'],shopCards(d,this.account.data.cash,this.busy,tier=>this.art(tier))))fitShopText(this.el['pickaxe-overlay']);this.el['pickaxe-grid'].scrollLeft=scroll;}
    if(this.modal==='pets')this.el['pickaxe-grid'].innerHTML=d.pets.length?d.pets.map(p=>`<article class="pickaxe-card pet-card"><small>${rarityNames[speciesOf(p.name).rarity]}</small><h3>${(petNames[p.name]||p.name)}</h3><p>${p.name==='GoldenRetriver'?'Golden Retriever':p.name}</p><button data-pet="${p.id}">${this.confirmPet===p.id?'确认出售':'出售'} · $${formatNumber(petValue(p.name))}</button>${this.confirmPet===p.id?'<button data-cancel="true">取消</button>':''}</article>`).join(''):'<p class="empty-collection">还没有孵化动物</p>';
    if(focused){const next=focusTier?this.el['pickaxe-grid'].querySelector(`[data-tier="${focusTier}"]`):focusPet?this.el['pickaxe-grid'].querySelector(`[data-pet="${focusPet}"]`):null;(next&&!next.disabled?next:this.el['pickaxe-close']).focus({preventScroll:true});}
    this.account.dirty=true;
  }
  updatePose(){
    const active=!this.player.equippedPet&&!this.player.carryingAnimal&&!!this.progress.data.equipped&&!this.player.training&&!this.player.motor.externalMotion&&!!this.loaded;this.mount.visible=active;if(!active)return;
    const pose=heldPickaxePose(this.clock.phase,this.clock.active);
    const yaw=this.player.actor.getWorldQuaternion(new THREE.Quaternion());
    const aim=pose.arm.applyQuaternion(yaw);
    const worldQ=new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0,1,0),aim);
    this.arm.parent.updateWorldMatrix(true,false);this.arm.quaternion.copy(this.arm.parent.getWorldQuaternion(new THREE.Quaternion()).invert().multiply(worldQ));
    this.hand.quaternion.copy(this.handRest);
    this.grip.getWorldPosition(this.mount.position);
    this.mount.quaternion.copy(yaw).multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1,0,0),pose.pitch));
    this.mount.updateWorldMatrix(true,true);
  }
  update(dt){
    this.bankFeedback.update();
    if(this.player.motor.externalMotion){this.clock.cancel();if(this.auto){this.auto=false;this.refresh();}}
    this.clock.speed=this.account.data.commerce?.owned.includes('FastSwingOwned')?2:1;this.clock.advance(dt);this.eggs?.update(dt);
    if(this.boothTrigger){
      const transition=this.boothTrigger.update(this.player.motor.position);
      if(transition==='enter'&&!this.player.carryingAnimal&&!this.modal&&!this.externalModal&&!this.player.training)this.open('shop');
      if(transition==='leave'&&this.modal==='shop')this.close();
      this.boothSign.visible=this.camera.position.distanceTo(this.boothSign.position)<200;
      this.canvas.dataset.shopInside=String(this.boothTrigger.inside);
    }
    if(this.modal==='shop'&&this.clock.time-(this.lastGradient||0)>.033){this.lastGradient=this.clock.time;animateShopGradients(this.el['pickaxe-grid'],this.clock.time);}
    if(this.player.training){this.clock.cancel();this.auto=false;}
    this.updatePose();if(this.mount.visible)this.loaded.effect.update(dt,this.camera);
    this.origin.copy(this.player.actor.position).add(new THREE.Vector3(0,2.4,0));this.forward.set(0,0,1).applyQuaternion(this.player.actor.quaternion);
    const nearBox=new THREE.Box3().setFromCenterAndSize(this.origin.clone().addScaledVector(this.forward,3),new THREE.Vector3(7,7,7));
    const target=this.eggs?pickHit(this.eggs.eggs,this.origin,this.forward,nearBox,this.player.world):null;
    if(this.auto&&target&&!this.modal)this.swing();
    if(this.clock.active&&!this.clock.hit&&this.clock.phase>=.22&&this.loaded&&this.mount.visible){
      const sweep=this.loaded.bounds.clone().applyMatrix4(this.loaded.root.matrixWorld).expandByScalar(CONFIG.padding);
      this.box.copy(sweep);if(!this.previousBox.isEmpty())this.box.union(this.previousBox);this.previousBox.copy(sweep);
      const egg=pickHit(this.eggs.eggs,this.origin,this.forward,this.box,this.player.world);
      if(egg){
        this.clock.hit=true;const damage=CONFIG.tiers[this.progress.data.equipped-1].damage,hp=egg.life.hp,tool=this.loaded;
        const result=this.eggs.hit(egg,this.clock.id,damage);
        // Online hits with a sent request present immediately using the same damage rule as Room.
        const predicted=Number.isFinite(result?.predicted)?result.predicted:null;
        const present=actual=>{this.sound(true);if(this.loaded===tool)tool.effect.burst();if(actual>0)this.showDamage(egg,actual);};
        if(predicted!==null)present(predicted);
        const confirmed=result=>{if(!result||egg.removed)return;this.hitCount++;if(predicted===null)present(Object.hasOwn(result,'damage')?result.damage:Math.min(hp,damage));if(result.pet)this.refresh();else if(result.broken)this.notify('动物收藏已满');};
        if(result?.then)void result.then(confirmed).catch(()=>{});else confirmed(result);
      }
    }
    this.el['egg-health'].hidden=true;this.updatePopups(dt);
    if(this.feedbackUntil<this.clock.time)this.el['pickaxe-feedback'].textContent='';
    const uiLocked=!!this.modal||!!this.externalModal||!!this.weapons?.busy;
    if(this.lastCash!==this.account.data.cash||this.lastTraining!==!!this.player.training||this.lastUILocked!==uiLocked||this.lastAuto!==this.auto){this.lastCash=this.account.data.cash;this.lastTraining=!!this.player.training;this.lastUILocked=uiLocked;this.lastAuto=this.auto;this.refresh();}
    Object.assign(this.canvas.dataset,{pickaxeTier:String(this.progress.data.equipped||0),pickaxeBusy:String(this.busy),swingCount:String(this.clock.id),hitCount:String(this.hitCount),eggTarget:target?.spec.id||'',eggHp:String(target?.life.hp??''),petCount:String(this.progress.data.pets.length),pickaxeModal:this.modal||''});
  }
  screen(position){const p=position.clone().project(this.camera);return {x:(p.x*.5+.5)*innerWidth,y:(-.5*p.y+.5)*innerHeight,visible:p.z>-1&&p.z<1&&Math.abs(p.x)<1.2&&Math.abs(p.y)<1.2};}
  showHealth(egg){const el=this.el['egg-health'];if(!egg||this.modal){el.hidden=true;return;}const p=this.screen(egg.center.clone().add(new THREE.Vector3(0,egg.spec.size[1]*.65,0)));el.hidden=!p.visible;el.style.transform=`translate(${p.x}px,${p.y}px) translate(-50%,-100%)`;el.querySelector('strong').textContent=egg.root.name;el.querySelector('i').style.width=`${egg.life.hp/egg.spec.health*100}%`;el.querySelector('small').textContent=`${egg.life.hp} / ${egg.spec.health}`;}
  showDamage(egg,amount){const el=document.createElement('span');el.textContent=`−${formatNumber(amount)}`;this.el['egg-popups'].append(el);this.popups.push({el,position:egg.center.clone(),age:0});}
  updatePopups(dt){this.popups=this.popups.filter(p=>{p.age+=dt;const v=this.screen(p.position.clone().add(new THREE.Vector3(0,p.age*2,0)));p.el.style.transform=`translate(${v.x}px,${v.y}px)`;p.el.style.opacity=String(Math.max(0,1-p.age));if(p.age<1)return true;p.el.remove();return false;});}
}
