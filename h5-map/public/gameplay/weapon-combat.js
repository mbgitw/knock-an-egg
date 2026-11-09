import * as THREE from 'three';
import {closestBatTarget,eligibleTarget,canBatAttack,batLaunch,BAT_IMMUNITY} from './weapon-combat-state.js';
import {insideZone} from './zone-entry-state.js';

// Overlays share geometry and skeleton, never change the character's materials.
export class BatHighlight {
  constructor(){this.overlays=[];this.root=null;this.age=0;}
  clear(){for(const mesh of this.overlays){mesh.removeFromParent();mesh.material.dispose();}this.overlays=[];this.root=null;}
  set(root){
    if(root===this.root)return;this.clear();this.root=root;this.age=0;if(!root)return;
    const meshes=[];root.traverse(o=>{if(o.isMesh&&!o.userData.batHighlight)meshes.push(o);});
    for(const mesh of meshes)for(const outline of [false,true]){
      const material=new THREE.MeshBasicMaterial({color:outline?0x6b0000:0xff0000,transparent:true,opacity:0,depthTest:true,depthWrite:false,side:outline?THREE.BackSide:THREE.FrontSide,polygonOffset:true,polygonOffsetFactor:-1,polygonOffsetUnits:-1});
      const overlay=mesh.isSkinnedMesh?new THREE.SkinnedMesh(mesh.geometry,material):new THREE.Mesh(mesh.geometry,material);
      if(mesh.isSkinnedMesh){overlay.bindMode=mesh.bindMode;overlay.skeleton=mesh.skeleton;overlay.bindMatrix.copy(mesh.bindMatrix);overlay.bindMatrixInverse.copy(mesh.bindMatrixInverse);}
      overlay.morphTargetInfluences=mesh.morphTargetInfluences;overlay.morphTargetDictionary=mesh.morphTargetDictionary;
      overlay.userData.batHighlight=true;overlay.userData.outline=outline;
      overlay.scale.setScalar(outline?1.025:1);overlay.frustumCulled=false;overlay.renderOrder=2;
      mesh.add(overlay);this.overlays.push(overlay);
    }
  }
  update(dt){this.age+=dt;const t=Math.min(1,this.age/.18),fade=1-(1-t)**2;for(const mesh of this.overlays)mesh.material.opacity=fade*(mesh.userData.outline?.85:.5);}
}

/** Local authority for the standalone game. Network integration must call the
 * room's authority instead of trusting client target/force declarations. */
export class WeaponCombat {
  constructor({weapons,player,animals,guards,plots}){
    Object.assign(this,{weapons,player,animals,guards,plots});this.time=0;this.targets=new Map();this.highlight=new BatHighlight();this.hitCount=0;
    this.local=this.register({id:'local',player,drop:()=>animals?.drop({atHit:true}),isSafe:p=>!!plots?.tier?.hitbox&&insideZone(plots.tier.hitbox,p)});
  }
  register({id,player,drop=()=>{},isSafe=()=>false,flags=()=>({})}){
    if(!id||this.targets.has(id)||!player?.motor||!player.actor)throw Error('Invalid combat player');
    const entry={id,player,drop,isSafe,flags,immuneUntil:0,wasThrown:false};this.targets.set(id,entry);return entry;
  }
  unregister(id){this.targets.delete(id);if(this.target?.id===id){this.target=null;this.highlight.clear();}}
  snapshot(entry){
    const p=entry.player.motor.position;
    return {...entry.flags(),id:entry.id,kind:'player',position:p,ragdolled:!!entry.player.motor.externalMotion,
      immuneUntil:entry.immuneUntil,safe:entry.isSafe(p)||this.guards.catalog.safeParts.some(part=>insideZone(part,p)),entry};
  }
  select(){
    const w=this.weapons,item=w.assets.catalog.find(t=>t.tier===w.equipped);
    if(!item||w.blocked||w.busy)return null;
    return closestBatTarget(this.snapshot(this.local),[...this.targets.values()].map(e=>this.snapshot(e)),item.range,this.time,this.player.batHitboxMultiplier);
  }
  canSwing(){return canBatAttack(this.snapshot(this.local));}
  strike(){
    const target=this.select();if(!target)return false;
    const item=this.weapons.assets.catalog.find(t=>t.tier===this.weapons.equipped);
    return this.applyHit(this.local,target.entry,item);
  }
  applyHit(attacker,target,item){
    if(!item||!canBatAttack(this.snapshot(attacker))||!eligibleTarget(this.snapshot(target),this.time))return false;
    const a=attacker.player.motor.position,p=target.player,m=p.motor;
    const launch=batLaunch(item.knockback),velocity=new THREE.Vector3().subVectors(m.position,a);velocity.y=0;
    if(velocity.lengthSq()<1e-6)velocity.set(Math.sin(attacker.player.actor.rotation.y),0,Math.cos(attacker.player.actor.rotation.y));
    velocity.normalize().multiplyScalar(launch.horizontal);velocity.y=launch.vertical;
    // Release at the pre-launch position, keeping this exact world instance.
    target.drop();p.onTrainingExit?.();p.training=null;p.keys?.clear();p.touchMove?.set(0,0);
    if(target===this.local){this.animals?.cancel();this.weapons.swingUntil=0;this.weapons.pickaxes.clock.cancel();this.weapons.pickaxes.auto=false;}
    m.launch(velocity,launch);p.actor.rotation.y=Math.atan2(-velocity.x,-velocity.z);
    target.wasThrown=true;target.immuneUntil=this.time+launch.duration+BAT_IMMUNITY;
    this.hitCount++;this.lastHit={attacker:attacker.id,target:target.id,tier:item.tier,launch};return true;
  }
  // Same validation for fixtures or future local AI: no unchecked force API.
  attackFrom(id,tier){
    const attacker=this.targets.get(id),item=this.weapons.assets.catalog.find(t=>t.tier===tier);
    if(!attacker||!item||this.time<(attacker.cooldownUntil||0)||attacker.player.carryingAnimal)return false;
    const target=closestBatTarget(this.snapshot(attacker),[...this.targets.values()].map(e=>this.snapshot(e)),item.range,this.time);
    if(!canBatAttack(this.snapshot(attacker)))return false;
    attacker.cooldownUntil=this.time+.7;return target?this.applyHit(attacker,target.entry,item):false;
  }
  update(dt){
    this.time+=dt;
    for(const entry of this.targets.values()){
      const thrown=!!entry.player.motor.externalMotion;
      if(entry.wasThrown&&!thrown)entry.immuneUntil=this.time+BAT_IMMUNITY;
      entry.wasThrown=thrown;
    }
    this.target=this.select();this.highlight.set(this.target?.entry.player.actor||null);this.highlight.update(dt);
    this.weapons.canvas.dataset.weaponTarget=this.target?.id||'';this.weapons.canvas.dataset.weaponHits=String(this.hitCount);
  }
  dispose(){this.highlight.clear();this.targets.clear();}
}
