import * as THREE from 'three';
import {pastureModel,PastureMotion} from '../gameplay/pasture-motion.js';
import {animalVisualScale} from '../gameplay/animal-attributes.js';
import {disposePetModel} from '../gameplay/pet-animation.js';
export class RemotePastures{
  constructor(game,connection){Object.assign(this,{game,connection});this.pets=new Map();this.pending=new Set();this.machines=new Map();this.machinePending=new Set();this.eggs=new Map();}
  update(dt){
    const {plots,pickaxes,scene,account,treadmills,merge,player}=this.game,wanted=new Set(),eggs=new Set(),owners=new Set(this.connection.players.filter(p=>p.id!==this.connection.self).map(p=>p.id));
    for(const [owner,data] of this.connection.pastures){if(!owners.has(owner))continue;
      const base=plots.data.bases.find(b=>b.id===`Base_${data.slot+1}`),matrix=new THREE.Matrix4().set(...base.transform),h=plots.data.tiers[data.level-1].hitbox,hMatrix=matrix.clone().multiply(new THREE.Matrix4().set(...h.matrix)),hitbox={size:h.size,matrix:Array.from({length:16},(_,i)=>hMatrix.elements[(i%4)*4+Math.floor(i/4)])};
      for(const pet of data.pets){wanted.add(pet.id);const existing=this.pets.get(pet.id);if(existing){existing.motion.hitbox=hitbox;if(JSON.stringify(existing.motion.pet.position)!==JSON.stringify(pet.position)){existing.motion.center.fromArray(pet.position);existing.motion.floor=pet.position[1];existing.motion.target=null;existing.model.position.fromArray(pet.position);existing.motion.pet=pet;}}if(!this.pets.has(pet.id)&&!this.pending.has(pet.id)&&account.data.settings.ViewOthersPets!==false){
        this.pending.add(pet.id);pickaxes.eggs.petTemplate(pet.name,pet.variant).then(t=>pastureModel(t,pet.name)).then(model=>{
          if(!this.connection.players.some(p=>p.id===owner)||!this.connection.pastures.get(owner)?.pets.some(p=>p.id===pet.id)){disposePetModel(model);return;}
          model.scale.multiplyScalar(animalVisualScale(pet));model.position.fromArray(pet.position);model.rotation.y=pet.yaw||0;scene.add(model);this.pets.set(pet.id,{owner,model,motion:new PastureMotion(model,pet,false,hitbox)});
        }).catch(()=>{}).finally(()=>this.pending.delete(pet.id));
      }}
      for(const egg of data.growing){eggs.add(egg.id);let view=this.eggs.get(egg.id);if(!view){view=merge.sprite(egg);scene.add(view);this.eggs.set(egg.id,view);}const progress=Math.max(0,Math.min(1,1-(egg.readyAt-this.connection.now())/(egg.duration*1000))),size=4*Math.max(.4,Math.min(13,egg.sizeMult))*(1+progress*2);view.position.fromArray(egg.position).add(new THREE.Vector3(0,size/2,0));view.scale.set(size,size,1);view.visible=account.data.settings.ViewOthersPets!==false&&view.position.distanceTo(player.motor.position)<450;}
    }
    for(const [id,a] of this.pets){if(!wanted.has(id)){a.motion.dispose();a.model.removeFromParent();this.pets.delete(id);continue;}const distance=a.model.position.distanceTo(player.motor.position);a.model.visible=account.data.settings.ViewOthersPets!==false&&distance<450;a.elapsed=(a.elapsed||0)+dt;if(a.model.visible&&a.elapsed>=(distance>120?.1:1/30)){a.motion.update(Math.min(.25,a.elapsed),[]);a.elapsed=0;}}
    for(const [id,view] of this.eggs)if(!eggs.has(id)){view.removeFromParent();view.material.dispose();this.eggs.delete(id);}
    for(const p of this.connection.players)if(owners.has(p.id)){
      const old=this.machines.get(p.id);if(old?.level===p.treadmill||this.machinePending.has(p.id))continue;
      this.machinePending.add(p.id);const base=plots.data.bases.find(b=>b.id===`Base_${p.slot+1}`),matrix=new THREE.Matrix4().set(...base.transform).multiply(treadmills.ownMatrix);
      treadmills.assets.instance(p.treadmill,matrix).then(model=>{if(!this.connection.players.some(v=>v.id===p.id)){model.dispose();return;}old?.model.dispose();scene.add(model.root);this.machines.set(p.id,{level:p.treadmill,model});}).catch(()=>{}).finally(()=>this.machinePending.delete(p.id));
    }
    for(const [id,a] of this.machines)if(!owners.has(id)){a.model.dispose();this.machines.delete(id);}
  }
}
