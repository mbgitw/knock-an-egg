import {bindSceneTap} from './scene-tap.js';
import {disposePetModel} from './pet-animation.js';
import {PastureOverhead} from './pasture-overhead.js';
import {placedPetVisible} from './settings-state.js';
import {animalVisualScale} from './animal-attributes.js';
import {PastureEconomy,pastureRate} from './pasture-economy.js';
import {pastureModel,PastureMotion} from './pasture-motion.js';
import {OfflineRewardUI} from './offline-reward-ui.js';
import {shopNumber} from './pickaxe-shop.js';
import * as THREE from 'three';
import {PastureState} from './pasture-state.js';
import {PastureCashLabel} from './pasture-cash-label.js';

export class PastureSystem {
  constructor({scene,player,camera,canvas,account,plots,backpack,pickaxes,inventoryUI}){
    Object.assign(this,{scene,player,camera,canvas,account,plots,backpack,pickaxes,inventoryUI});
    this.state=new PastureState(account);this.models=new Map();this.pending=new Set();this.motions=new Map();this.fresh=new Set();this.labels=new Map();this.overheads=new Map();this.economy=new PastureEconomy(account);
    addEventListener('keydown',e=>{if(e.code==='KeyE'&&!e.repeat&&!e.target.matches('input,textarea')&&!this.blocked){e.preventDefault();this.placeAhead();}});
    this.unbindPlacement=bindSceneTap(canvas,e=>{
      if(this.blocked||window.gameHostState?.paused)return;
      const rect=canvas.getBoundingClientRect(),ray=new THREE.Raycaster();
      ray.setFromCamera(new THREE.Vector2((e.clientX-rect.left)/rect.width*2-1,1-(e.clientY-rect.top)/rect.height*2),camera);
      const hit=player.world.rayIntersect(ray.ray);if(hit&&hit.triangle.getNormal(new THREE.Vector3()).y>.5)void this.place(hit.position);
    },{allowLeftTouch:()=>!!this.backpack.held});
    inventoryUI.list.addEventListener('click',e=>{const b=e.target.closest('[data-retrieve-pet]');if(b)this.retrieve(b.dataset.retrievePet);});
    const best=inventoryUI.root.querySelector('.inventory-equip-best');best.removeAttribute('aria-disabled');best.onclick=()=>this.equipBest();
    inventoryUI.root.querySelector('.inventory-header-action').onclick=()=>{if(inventoryUI.kind==='pets'&&plots.purchase({fromInventory:true}))inventoryUI.render(inventoryUI.read());};
    this.offline=new OfflineRewardUI({economy:this.economy,player,pickaxes,canvas});
    const hide=()=>{this.economy.stamp();this.suspended=true;};
    const resume=()=>{if(this.suspended){this.economy.resume();this.suspended=false;}};

    addEventListener('pagehide',hide);addEventListener('pageshow',resume);
    addEventListener('game-host-pause',()=>window.gameHostState?.paused?hide():resume());
    this.update();
  }
  get blocked(){return !this.backpack.held||this.player.inputLocked||this.player.training||this.player.motor.externalMotion||this.player.carryingAnimal||(window.gameHostState?.paused||document.hidden);}
  valid(p){return this.plots.contains(p)&&this.player.motor.position.clone().setY(0).distanceTo(p.clone().setY(0))<=50&&this.state.pets.every(a=>Math.hypot(a.position[0]-p.x,a.position[2]-p.z)>2.8);}
  canPlace(p){
    if(this.blocked||!this.plots.contains(p)||this.player.motor.position.clone().setY(0).distanceTo(p.clone().setY(0))>50)return false;
    if(this.state.pets.length>=this.plots.capacity){this.showFullNotice();return false;}
    return this.valid(p);
  }
  showFullNotice(){
    const now=performance.now();
    if(now<(this.fullNoticeAt??-Infinity)+1000)return;
    if(!this.fullNotice){
      this.fullNotice=document.createElement('div');this.fullNotice.id='pasture-full-notice';this.fullNotice.setAttribute('role','status');
      this.fullNotice.textContent='牧场已满';
      this.fullNotice.style.cssText="position:fixed;left:50%;bottom:12vh;transform:translateX(-50%);width:max-content;max-width:94vw;text-align:center;pointer-events:none;z-index:60;color:rgb(255,75,75);font:800 clamp(18px,2.5vw,42px)/1.2 OriginalRubik,sans-serif;-webkit-text-stroke:clamp(2px,.2vw,4px) black;paint-order:stroke fill;text-shadow:none";
      document.body.append(this.fullNotice);
    }
    this.fullNoticeAt=now;this.fullNotice.hidden=false;this.fullNotice.style.opacity='0';
  }
  placeAhead(){
    const p=new THREE.Vector3(0,0,5).applyQuaternion(this.player.actor.quaternion).add(this.player.motor.position);
    const hit=this.player.world.rayIntersect(new THREE.Ray(p.clone().add(new THREE.Vector3(0,8,0)),new THREE.Vector3(0,-1,0)));
    return !!hit&&this.place(hit.position);
  }
  place(p){
    if(!this.canPlace(p))return false;
    if(!this.state.place(this.backpack.held,p.toArray(),this.player.actor.rotation.y))return false;
    this.fresh.add(this.backpack.held);this.backpack.unequip();this.update();return true;
  }
  retrieve(id){if(!this.state.retrieve(id))return false;this.backpack.render();this.update();this.inventoryUI.render(this.inventoryUI.read());return true;}
  equipBest(){
    if(this.player.carryingAnimal||this.player.training)return false;
    const h=this.plots.tier.hitbox,positions=[];
    for(let i=0;i<this.plots.capacity;i++){
      const p=new THREE.Vector3(((i%4)+.5)/4*h.size[0]-h.size[0]/2,0,(Math.floor(i/4)+.5)/4*h.size[2]-h.size[2]/2).applyMatrix4(new THREE.Matrix4().set(...h.matrix));
      const hit=this.player.world.rayIntersect(new THREE.Ray(p,new THREE.Vector3(0,-1,0)));if(!hit)return false;positions.push(hit.position.toArray());
    }
    const previous=new Set(this.state.pets.map(p=>p.id));
    if(!this.state.equipBest(positions))return false;
    for(const p of this.state.pets)if(!previous.has(p.id))this.fresh.add(p.id);
    this.backpack.unequip();
    for(const m of this.motions.values())m.dispose();for(const model of this.models.values())model.removeFromParent();this.models.clear();this.motions.clear();for(const label of this.labels.values())label.remove();this.labels.clear();for(const label of this.overheads.values())label.remove();this.overheads.clear();
    this.update();this.inventoryUI.render(this.inventoryUI.read());return true;
  }
  update(dt=0){
    if(this.fullNotice&&!this.fullNotice.hidden){const age=(performance.now()-this.fullNoticeAt)/1000;this.fullNotice.hidden=age>=2.5;this.fullNotice.style.opacity=String(Math.max(0,Math.min(1,age/.2,(2.5-age)/.3)));}
    this.economy.update(dt);
    this.offline.update();

    const ids=new Set(this.state.pets.map(p=>p.id));
    for(const [id,model] of this.models)if(!ids.has(id)){model.removeFromParent();this.models.delete(id);this.motions.get(id)?.dispose();this.motions.delete(id);this.labels.get(id)?.remove();this.labels.delete(id);this.overheads.get(id)?.remove();this.overheads.delete(id);}
    for(const p of this.state.pets)if(!this.models.has(p.id)&&!this.pending.has(p.id)){
      this.pending.add(p.id);
      this.pickaxes.eggs.petTemplate(p.name,p.variant).then(template=>pastureModel(template,p.name).catch(error=>{console.warn("牧场动画回退",p.name,error.message);return template.clone(true);})).then(model=>{
        if(!this.state.pets.some(a=>a.id===p.id)){disposePetModel(model);return;}
        model.scale.multiplyScalar(animalVisualScale(p));
        model.position.fromArray(p.position);model.rotation.y=p.yaw;this.scene.add(model);this.models.set(p.id,model);
        const pet=this.state.pets.find(a=>a.id===p.id);model.position.fromArray(pet.position);
        this.motions.set(p.id,new PastureMotion(model,pet,this.fresh.has(p.id),this.plots.tier.hitbox));this.fresh.delete(p.id);
        this.labels.set(p.id,new PastureCashLabel(this.scene,model));
        this.overheads.set(p.id,new PastureOverhead(this.scene,model,pet));
      }).catch(e=>console.warn('牧场动物加载失败',e.message)).finally(()=>this.pending.delete(p.id));
    }
    const models=[...this.models.values()],insidePlot=this.plots.contains(this.player.motor.position);
    for(const [id,motion] of this.motions){
      motion.model.visible=placedPetVisible(this.account.data.settings||{},motion.pet.ownerId??this.account.data.baseId,this.account.data.baseId);
      motion.hitbox=this.plots.tier.hitbox;motion.update(dt,models);if(motion.sparks)motion.sparks.visible=motion.model.visible;
      const text=motion.age<motion.celebrate?'♥':'+$'+shopNumber(pastureRate(motion.pet));
      this.labels.get(id).update(this.camera,text,motion.time%1);
      this.overheads.get(id).update(this.camera,insidePlot);
      // Keep transient gains beside the persistent information rows.
      if(this.overheads.get(id).sprite.visible)this.labels.get(id).sprite.position.addScaledVector(new THREE.Vector3().setFromMatrixColumn(this.camera.matrixWorld,0),motion.margin+.6);
    }
    this.canvas.dataset.placedPets=String(this.state.pets.length);
  }
}

