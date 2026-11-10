import {updatePetAnimation,disposePetModel} from './pet-culling.js';
import * as THREE from 'three';
import {AnimalCarryState} from './animal-carry-state.js';
import {AnimalCarryUI} from './animal-carry-ui.js';

export class AnimalCarrySystem {
  constructor({scene,player,camera,canvas,pickaxes,guards,config}){
    Object.assign(this,{scene,player,camera,canvas,pickaxes,guards,config});this.views=new Map();this.time=0;this.lastTime=performance.now()/1000;
    this.state=new AnimalCarryState({...config,bank:pet=>pickaxes.progress.bank(pet)});this.ui=new AnimalCarryUI(camera);this.held=false;this.savedPose=null;
    this.resetSerial=player.motor.resetSerial;
    this.ray=new THREE.Ray();this.arms=['armL','armR'].map(n=>player.model.getObjectByName(n));
    pickaxes.eggs.onAnimalLanded=(pet,egg,reveal,lookRemaining)=>this.add(pet,egg,reveal,lookRemaining);
    this.bind();
  }
  get blocked(){return !!((window.gameHostState?.paused||document.hidden)||window.gameHostState?.paused||this.player.inputLocked||this.player.training||this.player.motor.externalMotion||this.pickaxes.busy||this.pickaxes.weapons?.busy||this.pickaxes.modal||this.pickaxes.externalModal);}
  add(pet,egg,reveal,lookRemaining=0){
    reveal.root.scale.copy(reveal.baseScale);reveal.root.position.y=reveal.y;
    const height=new THREE.Box3().setFromObject(reveal.root).getSize(new THREE.Vector3()).y;
    const a=this.state.add(pet,reveal.root.position,height/4,lookRemaining);
    if(!a){disposePetModel(reveal.root);reveal.root.removeFromParent();return;}
    this.views.set(a.id,{root:reveal.root,baseScale:reveal.baseScale.clone(),height,label:this.ui.add(a),despawnAge:0});
  }
  bind(){
    this.abort=new AbortController();const opts={signal:this.abort.signal};
    addEventListener('keydown',e=>{
      if(e.repeat||e.target.matches?.('input,textarea,select,[contenteditable=true]'))return;
      if(e.code==='KeyE'){e.preventDefault();this.begin();}
      if(e.code==='KeyG'&&!this.blocked){e.preventDefault();this.drop();}
    },opts);
    addEventListener('keyup',e=>{if(e.code==='KeyE')this.cancel();},opts);
    addEventListener('blur',()=>this.cancel(),opts);
    addEventListener('game-host-pause',()=>{if(window.gameHostState?.paused)this.cancel();},opts);

    addEventListener('pagehide',()=>{this.cancel();this.drop({returnHome:true});},opts);
    this.ui.pickup.addEventListener('pointerdown',e=>{if(e.button!==0)return;e.preventDefault();e.stopPropagation();this.ui.pickup.setPointerCapture(e.pointerId);this.begin();},opts);
    for(const event of ['pointerup','pointercancel','lostpointercapture'])this.ui.pickup.addEventListener(event,()=>this.cancel(),opts);
    this.ui.drop.onclick=()=>{if(!this.blocked)this.drop();};
  }
  begin(){const a=this.state.nearest(this.player.motor.position,this.blocked);if(a&&this.state.begin(a.id,this.player.motor.position,this.blocked)){this.held=true;this.holdStartedAt=performance.now()/1000;return true;}return false;}
  cancel(){this.held=false;this.holdStartedAt=null;this.state.cancel();}
  carryingChanged(a){
    this.player.carryingAnimal=a?.id||null;document.body.dataset.carryingAnimal=String(!!a);
    this.pickaxes.auto=false;this.pickaxes.clock.cancel();if(this.pickaxes.weapons)this.pickaxes.weapons.swingUntil=0;
    this.guards.setCarrying(a?{id:a.id,zone:a.pet.zone,onDrop:()=>this.drop()}:null);
    this.pickaxes.refresh();this.pickaxes.weapons?.refresh();
    if(!a)this.restorePose();
  }
  floor(position){
    // Raycast all actual walkable geometry; dropping mid-jump lands below the player.
    this.ray.set(new THREE.Vector3(position.x,position.y+.5,position.z),new THREE.Vector3(0,-1,0));
    const hit=this.player.world.rayIntersect(this.ray);return {...position,y:hit?.position.y??position.y};
  }
  drop(options={}){
    const a=this.state.drop(this.player.motor.position,options);if(!a)return null;
    if(a.position.x!==a.home.x||a.position.z!==a.home.z)a.position=this.floor(a.position);
    const v=this.views.get(a.id);v.root.position.copy(a.position);v.root.scale.copy(v.baseScale);
    this.cancel();this.carryingChanged(null);return a;
  }
  restorePose(){if(this.savedPose){for(const [bone,q] of this.savedPose)bone.quaternion.copy(q);this.savedPose=null;}}
  beginFrame(){this.restorePose();}
  pose(a){
    const v=this.views.get(a.id),yaw=this.player.actor.getWorldQuaternion(new THREE.Quaternion());
    // Use the raised-hand socket from the v2 carry pose. World-space attachment
    // adapts its authored rig scale and follows breathing/running without drift.
    const hands=['handL','handR'].map(n=>this.player.model.getObjectByName(n));
    this.player.actor.updateWorldMatrix(true,true);
    v.root.position.set(0,0,0);
    for(const hand of hands)v.root.position.add(hand.localToWorld(new THREE.Vector3(0,.00645,0)));
    v.root.position.multiplyScalar(.5);v.root.quaternion.copy(yaw);

  }
  update(dt){
    const now=performance.now()/1000,elapsed=Math.max(0,now-this.lastTime);this.lastTime=now;this.time+=dt;
    // Falling out of the level respawns at the hub; that must not grant a delivery.
    if(this.resetSerial!==this.player.motor.resetSerial){this.resetSerial=this.player.motor.resetSerial;this.cancel();this.drop({returnHome:true});}
    const claimed=this.state.advance(elapsed,this.player.motor.position,{held:this.held,blocked:this.blocked,holdDt:this.held?Math.max(0,now-this.holdStartedAt):0});
    if(claimed){this.cancel();this.carryingChanged(claimed);}
    if(!this.state.hold)this.held=false;
    // Safe-zone geometry, not guard look-ahead or private plot containment, grants delivery.
    const banked=this.state.secure(this.player.motor.position);
    if(banked){this.carryingChanged(null);this.remove(banked);this.pickaxes.banked(banked.pet);}
    if(this.state.carrying)this.pose(this.state.carrying);
    for(const a of this.state.animals.values()){
      const v=this.views.get(a.id);
      updatePetAnimation(v.root,dt);
      if(a.status==='despawning'){
        v.despawnAge+=dt;const t=v.despawnAge;
        const s=t<.12?1+.2*(1-(1-t/.12)**2):1.2*(1-Math.min(1,(t-.12)/.25)**2);
        v.root.scale.copy(v.baseScale).multiplyScalar(Math.max(.001,s));v.root.visible=t<.37;
        if(t>=.6){this.remove(a);continue;}
      }
      if(a.status==='ground'&&a.lookRemaining>0){const p=this.player.motor.position;v.root.rotation.y=Math.atan2(p.x-v.root.position.x,p.z-v.root.position.z);}
      this.ui.label(a,v,this.time);
    }
    const target=this.state.hold?this.state.animals.get(this.state.hold.id):this.state.nearest(this.player.motor.position,this.blocked);
    this.ui.interaction(target,this.views.get(target?.id),this.state.hold,this.state.carrying,this.blocked);
    Object.assign(this.canvas.dataset,{animalCount:String(this.state.animals.size),carryingAnimal:this.state.carrying?.id||'',animalTarget:target?.id||'',pickupProgress:String(this.state.hold?.elapsed||0),animalRemaining:String(this.state.carrying?.remaining??target?.remaining??'')});
  }
  remove(a){const v=this.views.get(a.id);disposePetModel(v?.root);v?.root.removeFromParent();v?.label.svg.remove();this.views.delete(a.id);this.state.remove(a.id);this.pickaxes.progress.abandon(a.id);}
}
