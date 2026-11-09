import * as THREE from 'three';
import {WeaponAssets} from './weapon-assets.js';
import {WeaponProgress} from './weapon-state.js';
import {WeaponSwingPose,WEAPON_SWING_DURATION,WEAPON_SWING_RECOVERY} from './weapon-swing-pose.js';

export class WeaponSystem {
  static async create(options){
    const s=new WeaponSystem(options);s.assets=await new WeaponAssets().init();s.swingPose=await WeaponSwingPose.create(s.player);
    s.makeUI();s.pickaxes.weapons=s;
    if(s.progress.data.equipped)await s.equip(s.progress.data.equipped);
    s.refresh();return s;
  }
  constructor({scene,player,camera,canvas,account,pickaxes}){
    Object.assign(this,{scene,player,camera,canvas,account,pickaxes});
    this.progress=new WeaponProgress(account);this.mount=new THREE.Group();this.mount.name='Equipped weapon';scene.add(this.mount);
    this.mount.visible=false;this.time=0;this.swingUntil=0;this.cooldownUntil=0;this.swingCount=0;this.busy=false;
    this.abort=new AbortController();
    addEventListener('keydown',e=>{
      if(e.repeat||e.target.matches?.('input,textarea,select,[contenteditable=true]'))return;
      if(e.code==='Digit2'){e.preventDefault();this.toggle();}
    },{signal:this.abort.signal});
    const cancel=()=>{this.swingUntil=0;};
    addEventListener('blur',cancel,{signal:this.abort.signal});
    window.addEventListener('game-host-pause',()=>{if((window.gameHostState?.paused||document.hidden))cancel();},{signal:this.abort.signal});
  }
  get equipped(){return this.progress.data.equipped;}
  get blocked(){return !!(this.player.equippedPet||this.player.carryingAnimal||this.player.training||this.player.inputLocked||this.player.motor.externalMotion||this.pickaxes.modal||this.pickaxes.externalModal);}
  makeUI(){
    this.safeNotice=document.createElement('div');this.safeNotice.id='weapon-safe-notice';this.safeNotice.setAttribute('role','status');this.safeNotice.hidden=true;
    this.safeNotice.textContent="You can't use the Bat in a Safe Zone!";
    this.safeNotice.style.cssText="position:fixed;left:50%;bottom:12vh;transform:translateX(-50%);width:max-content;max-width:94vw;text-align:center;pointer-events:none;z-index:60;color:rgb(255,75,75);font:800 clamp(18px,2.5vw,42px)/1.2 OriginalRubik,sans-serif;-webkit-text-stroke:clamp(2px,.2vw,4px) black;paint-order:stroke fill;text-shadow:none";
    document.body.append(this.safeNotice);
    this.slot=document.createElement('button');this.slot.id='weapon-slot';this.slot.className='tool-slot';this.slot.innerHTML='<img alt=""><span class="tool-name"></span><kbd>2</kbd>';
    this.pickaxes.el['pickaxe-slot'].after(this.slot);this.slot.onclick=()=>this.toggle();
    this.choice=document.createElement('select');this.choice.id='weapon-choice';this.choice.setAttribute('aria-label','选择武器');this.slot.after(this.choice);
    this.choice.onchange=()=>this.equip(Number(this.choice.value));
  }
  refresh(){
    if(!this.assets)return;
    const item=this.assets.catalog.find(t=>t.tier===this.progress.data.selected);
    const label=this.slot.querySelector('span'),name=item.originalName||item.name;
    label.textContent=name;label.classList.toggle('two-lines',name.length>8);this.slot.setAttribute('aria-label',name);
    const image=this.slot.querySelector('img'),url=new URL(`./index-ui/bat-${item.tier}.png`,import.meta.url).href;if(image.src!==url)image.src=url;
    image.style.transform=item.tier===10?'rotate(40deg)':'';
    this.slot.setAttribute('aria-pressed',String(!!this.equipped&&!this.player.training&&!this.player.equippedPet));this.slot.disabled=this.busy||this.pickaxes.busy||!!(this.player.carryingAnimal||this.player.training||(this.player.inputLocked&&this.pickaxes.externalModal!==this.pickaxes.backpack)||this.player.motor.externalMotion||this.pickaxes.modal||(this.pickaxes.externalModal&&this.pickaxes.externalModal!==this.pickaxes.backpack));
    const signature=this.progress.data.owned.join(',');
    if(this.ownedSignature!==signature){this.ownedSignature=signature;this.choice.innerHTML=this.assets.catalog.filter(t=>this.progress.data.owned.includes(t.tier)).map(t=>`<option value="${t.tier}">${t.name}</option>`).join('');}
    this.choice.value=String(item.tier);this.choice.hidden=this.progress.data.owned.length<2;this.choice.disabled=this.slot.disabled;
    this.pickaxes.el['auto-pickaxe'].hidden=!!this.player.equippedPet||!!this.equipped||!this.pickaxes.progress.data.equipped||!!this.player.training;
  }
  toggle(){if(this.pickaxes.backpack)++this.pickaxes.backpack.version;if(this.pickaxes.backpack?.opened)this.pickaxes.backpack.close();if(this.player.equippedPet){this.pickaxes.backpack.unequip();if(this.equipped)return true;}if(this.blocked||this.busy||this.pickaxes.busy)return false;if(this.equipped){this.unequip();return true;}return this.equip(this.progress.data.selected);}
  unequip(save=true){this.swingPose?.restore();this.progress.data.equipped=null;this.swingUntil=0;this.mount.visible=false;if(save)this.account.save();this.refresh();}
  unlock(tier){const ok=this.progress.unlock(tier);this.refresh();return ok;}
  async equip(tier){
    if(this.blocked||this.busy||this.pickaxes.busy||!this.progress.data.owned.includes(tier))return false;
    this.busy=true;this.refresh();let next;
    try{
      next=await this.assets.create(tier);
      // Loading may finish after a modal opens, training starts or knockback begins.
      if(this.blocked){next.dispose();return false;}
      this.pickaxes.clock.cancel();this.pickaxes.auto=false;this.pickaxes.mount.visible=false;
      this.progress.equip(tier);this.loaded?.dispose();this.loaded=next;this.mount.add(next.root);
      this.swingUntil=0;this.pickaxes.refresh();return true;
    }catch(error){next?.dispose();console.error('武器加载',error);this.pickaxes.notify('武器加载失败，请重试');return false;}
    finally{this.busy=false;this.pickaxes.refresh?.();this.refresh();}
  }
  swing(){
    const canHit=!this.combat||this.combat.canSwing();
    const safe=!canHit&&this.combat.snapshot(this.combat.local).safe;
    const reason=!this.equipped?'unequipped':!this.loaded?'loading':this.busy?'busy':this.blocked?'locked':safe?'safe-zone':this.time<this.cooldownUntil?'cooldown':!canHit?'ineligible':'';
    if(this.canvas)this.canvas.dataset.weaponAttackBlocked=reason;
    if(reason==='safe-zone'&&this.time>=(this.safeNoticeAt??-Infinity)+1){this.safeNoticeAt=this.time;if(this.safeNotice){this.safeNotice.hidden=false;this.safeNotice.style.opacity='0';}}
    if(reason)return false;
    this.swingStarted=this.time;this.swingUntil=this.time+WEAPON_SWING_DURATION+WEAPON_SWING_RECOVERY;this.cooldownUntil=this.time+.7;this.swingCount++;
    if(canHit)this.combat?.strike();return true;
  }
  beginFrame(){this.swingPose?.restore();}
  update(dt){
    this.time+=dt;if(this.blocked)this.swingUntil=0;this.combat?.update(dt);
    if(this.safeNotice&&!this.safeNotice.hidden){const age=this.time-this.safeNoticeAt;this.safeNotice.hidden=age>=2.5;this.safeNotice.style.opacity=String(Math.max(0,Math.min(1,age/.2,(2.5-age)/.3)));}
    const active=!this.player.equippedPet&&!this.player.carryingAnimal&&!!this.equipped&&!!this.loaded&&!this.player.training&&!this.player.motor.externalMotion;
    this.mount.visible=active;if(!active)this.swingPose?.restore();
    if(active){
      const elapsed=this.swingUntil>this.time?this.time-this.swingStarted:null;
      const orientation=this.swingPose.apply(elapsed);
      this.pickaxes.grip.getWorldPosition(this.mount.position);this.mount.quaternion.copy(orientation);
      this.mount.updateWorldMatrix(true,true);this.loaded.effect.update(dt,this.camera);
    }
    this.refresh();Object.assign(this.canvas.dataset,{weaponTier:String(this.equipped||0),weaponVisible:String(active),weaponBusy:String(this.busy),weaponSwings:String(this.swingCount),weaponAnimation:'Bat Swing candidate',weaponAnimationTime:String(this.swingUntil>this.time?this.time-this.swingStarted:0)});
  }
}
