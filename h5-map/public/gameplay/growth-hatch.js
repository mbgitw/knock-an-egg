import * as THREE from 'three';
import {HatchReveal,hatchCrackPose,hatchEggPose} from './growth-hatch-presentation.js';
import {createPetModel,disposePetModel,updatePetAnimation} from './pet-animation.js';
import {animalVisualScale} from './animal-attributes.js';
import {bankPetImage} from './bank-feedback.js';
import {gameAudio} from './game-audio.js';

// Visual delay only: Room-owned inventory is never edited or re-granted here.
export class GrowthHatch {
 constructor(system){this.system=system;this.active=new Map();}
 hides(id){return this.active.has(id);}
 ready(id){return this.active.get(id)?.done===true;}
 begin(egg){
  if(this.active.has(egg.id))return;
  const entry={egg,age:0,beat:0,model:null,effect:null,done:false};this.active.set(egg.id,entry);
  gameAudio.play('crack',{volume:.86/.45});
  this.system.pickaxes.eggs.petTemplate(egg.name,egg.variant)
   .then(t=>createPetModel(t,egg.name,{height:4,includeOrdinary:true}))
   .then(model=>{if(this.active.get(egg.id)!==entry||entry.model){disposePetModel(model);return;}entry.model=model;})
   .catch(error=>{entry.failed=true;console.warn('成长蛋动物模型',error.message);});
 }
 update(dt){
  const s=this.system;
  for(const entry of this.active.values()){
   if(entry.done){const view=s.models.get(entry.egg.id);if(view){view.sprite.visible=false;view.label.hidden=true;}continue;}
   entry.age+=dt;
   const view=s.models.get(entry.egg.id);
   if(!entry.effect){
    const pose=hatchCrackPose(entry.age);
    if(pose.beat>entry.beat){entry.beat=pose.beat;gameAudio.play('crack',{volume:.86/.45});}
    if(view)view.sprite.material.rotation=pose.tiltZ;
    // A failed/slow asset uses its existing animal portrait, never an invented pet.
    if(!entry.model&&(entry.failed||entry.age>=12)){
     const map=new THREE.TextureLoader().load(bankPetImage(entry.egg));
     const sprite=new THREE.Sprite(new THREE.SpriteMaterial({map,transparent:true}));sprite.scale.set(4,4,1);sprite.position.y=2;
     entry.model=new THREE.Group();entry.model.add(sprite);entry.fallback={sprite,map};
    }
    if(!pose.done||!entry.model)continue;
    const animal=new THREE.Group();animal.add(entry.model);
    const origin=new THREE.Vector3().fromArray(entry.egg.position),size=4*animalVisualScale(entry.egg);
    entry.effect=new HatchReveal(animal,origin,animalVisualScale(entry.egg),size,0xffe6ad,5.4);
    s.scene.add(entry.effect.root);gameAudio.play('hatch',{volume:.86/.5});
   }
   if(view){view.sprite.visible=false;view.label.hidden=true;}
   updatePetAnimation(entry.model,dt);
   entry.effect.root.visible=s.account.data.settings?.ViewMyEggs!==false;
   if(entry.effect.update(dt,s.player.motor.position)){entry.effect.dispose();disposePetModel(entry.model);entry.fallback?.sprite.material.dispose();entry.fallback?.map.dispose();entry.done=true;}
  }
 }
 release(){
  let changed=false;
  for(const [id,entry] of this.active)if(entry.done&&!this.system.account.data.growingEggs.some(e=>e.id===id)){this.active.delete(id);changed=true;}
  return changed;
 }
}
export {hatchEggPose};
