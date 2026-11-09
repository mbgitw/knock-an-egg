import {bindSceneTap} from './scene-tap.js';
import * as THREE from 'three';
import {MergeState} from './merge-state.js';
import {MergeUI,mergeEggImage} from './merge-ui.js';
import {GrowthHatch,hatchEggPose} from './growth-hatch.js';
export class MergeSystem{
 static async create(options){const system=new MergeSystem(options);system.ui=await MergeUI.create({...options,state:system.state,onMerged:egg=>system.merged(egg)});return system;}
 constructor(options){
  Object.assign(this,options);this.state=new MergeState(this.account);this.models=new Map();this.held=null;this.textures=new Map();this.hatchPresentation=new GrowthHatch(this);this.lastFrame=performance.now();
  this.prompt=document.createElement('button');this.prompt.id='merge-prompt';this.prompt.textContent='E  Open';this.prompt.hidden=true;this.prompt.style.cssText='position:fixed;z-index:9;left:50%;top:58%;transform:translateX(-50%);background:#222c;color:white;border:2px solid white;border-radius:7px;padding:12px 22px;font:bold 20px sans-serif';document.body.append(this.prompt);this.prompt.onclick=()=>this.ui.open();
  addEventListener('keydown',e=>{if(e.code!=='KeyE'||e.repeat||e.target.matches('input,textarea')||this.blocked)return;if(this.held){e.preventDefault();this.placeAhead();}else if(!this.prompt.hidden){e.preventDefault();this.ui.open();}});
  this.inventoryUI.list.addEventListener('click',e=>{const b=e.target.closest('[data-hatch-egg]');if(b)this.hatch(b.dataset.hatchEgg);});
  this.unbindPlacement=bindSceneTap(this.canvas,e=>{if(this.blocked||window.gameHostState?.paused)return;const r=this.canvas.getBoundingClientRect(),ray=new THREE.Raycaster();ray.setFromCamera(new THREE.Vector2((e.clientX-r.left)/r.width*2-1,1-(e.clientY-r.top)/r.height*2),this.camera);
   if(this.held){const hit=this.player.world.rayIntersect(ray.ray);if(hit&&hit.triangle.getNormal(new THREE.Vector3()).y>.7)void this.place(hit.position);}
   else if(!this.backpack.held){const hits=ray.intersectObjects([...this.models.values()].filter(v=>v.sprite.visible).map(v=>v.sprite));if(hits[0])void this.hatch(hits[0].object.userData.eggId);}
  },{allowLeftTouch:()=>!!this.held});
  this.backpack.mergeSystem=this;
 }
 get blocked(){return this.player.inputLocked||this.player.training||this.player.carryingAnimal||this.player.motor.externalMotion||document.hidden;}
 sprite(egg){const image=mergeEggImage(egg);let texture=this.textures.get(image);if(!texture){texture=new THREE.TextureLoader().load(mergeEggImage(egg));texture.colorSpace=THREE.SRGBColorSpace;this.textures.set(image,texture);}const s=new THREE.Sprite(new THREE.SpriteMaterial({map:texture,transparent:true,alphaTest:.08}));s.userData.eggId=egg.id;return s;}
 equip(id){if(!this.account.data.mergeEggs.some(e=>e.id===id)||this.backpack.blocked)return;const previous=this.held;this.backpack.unequip();this.held=previous===id?null:id;this.heldSprite?.removeFromParent();this.heldSprite?.material.dispose();this.heldSprite=null;if(this.held){const e=this.account.data.mergeEggs.find(e=>e.id===id);this.heldSprite=this.sprite(e);this.heldSprite.scale.set(2.5,2.5,1);this.scene.add(this.heldSprite);this.player.equippedPet=id;this.pickaxes.auto=false;this.pickaxes.clock.cancel();}this.backpack.render();}
 clearHeld(){this.held=null;this.heldSprite?.removeFromParent();this.heldSprite?.material.dispose();this.heldSprite=null;if(this.player.equippedPet?.startsWith('merge:'))this.player.equippedPet=null;}
 merged(egg){this.backpack.unequip();this.backpack.render();this.pasture.update();this.inventoryUI.update();this.pickaxes.bankFeedback.show([{image:mergeEggImage(egg),text:`${egg.name} Egg`}],{rewards:true});}
 valid(p){
  const egg=this.account.data.mergeEggs.find(e=>e.id===this.held);if(!egg)return false;
  const radius=e=>4*Math.max(.4,Math.min(13,e.sizeMult))*.4/2,r=radius(egg);
  return this.plots.contains(p)&&[[r,r],[-r,r],[r,-r],[-r,-r]].every(([x,z])=>this.plots.contains(p.clone().add(new THREE.Vector3(x,0,z))))&&this.player.motor.position.distanceTo(p)<=50&&this.account.data.growingEggs.every(e=>Math.hypot(e.position[0]-p.x,e.position[2]-p.z)>r+radius(e))&&this.account.data.plot.pets.every(e=>Math.hypot(e.position[0]-p.x,e.position[2]-p.z)>r+1.5);
 }
 place(p){if(this.blocked||!this.held||!this.valid(p))return false;if(!this.state.place(this.held,p.toArray()))return false;this.clearHeld();this.backpack.render();this.update();return true;}
 placeAhead(){const p=new THREE.Vector3(0,0,5).applyQuaternion(this.player.actor.quaternion).add(this.player.motor.position),hit=this.player.world.rayIntersect(new THREE.Ray(p.clone().add(new THREE.Vector3(0,8,0)),new THREE.Vector3(0,-1,0)));return !!hit&&this.place(hit.position);}
 hatch(id){if(!this.state.hatch(id))return false;this.inventoryUI.close();this.update();return true;}
 update(){
  const now=Date.now(),d=this.account.data,frame=performance.now(),dt=document.hidden||window.gameHostState?.paused?0:Math.min(.1,Math.max(0,(frame-this.lastFrame)/1000));this.lastFrame=frame;
  for(const egg of d.growingEggs)if(egg.hatchingAt)this.hatchPresentation.begin(egg);
  if(this.ui?.opened){const sig=JSON.stringify(this.state.candidates);if(sig!==this.signature){this.signature=sig;this.ui.selecting!==null?this.ui.select(this.ui.selecting):this.ui.render();}}
  const distance=this.player.motor.position.distanceTo(new THREE.Vector3(-70.9568634,6.3574734,87.8627853));this.prompt.hidden=this.blocked||distance>20||!!this.held;
  if(this.heldSprite){if(!d.mergeEggs.some(e=>e.id===this.held)||this.backpack.held){this.clearHeld();}else{this.heldSprite.position.copy(new THREE.Vector3(0,2.7,1.8).applyQuaternion(this.player.actor.quaternion).add(this.player.motor.position));this.heldSprite.visible=!this.player.training;}}
  const ids=new Set(d.growingEggs.map(e=>e.id));for(const [id,v] of this.models)if(!ids.has(id)){v.sprite.removeFromParent();v.sprite.material.dispose();v.label.remove();this.models.delete(id);}
  for(const egg of d.growingEggs){let v=this.models.get(egg.id);if(!v){const sprite=this.sprite(egg),label=document.createElement('button');label.style.cssText='position:fixed;z-index:6;transform:translate(-50%,-50%);color:white;background:#111a;border:2px solid white;border-radius:5px;font:bold 17px sans-serif;padding:6px';label.onclick=()=>this.hatch(egg.id);document.body.append(label);this.scene.add(sprite);v={sprite,label};this.models.set(egg.id,v);}
   const progress=Math.max(0,Math.min(1,1-(egg.readyAt-now)/(egg.duration*1000))),size=4*Math.max(.4,Math.min(13,egg.sizeMult))*(1+progress*2);
   v.sprite.visible=this.account.data.settings?.ViewMyEggs!==false;v.sprite.scale.set(size,size,1);v.sprite.position.fromArray(egg.position).add(new THREE.Vector3(0,size/2,0));const pose=hatchEggPose(progress,1,frame/1000);v.sprite.position.y+=pose.lift;v.sprite.material.rotation=egg.hatchingAt?0:pose.tiltZ;v.sprite.material.opacity=1;
   const p=v.sprite.position.clone().add(new THREE.Vector3(0,size/2+1,0)).project(this.camera);v.label.hidden=egg.readyAt>now||!v.sprite.visible||p.z>1||p.z< -1||Math.abs(p.x)>1||Math.abs(p.y)>1||!!egg.hatchingAt||this.player.motor.position.distanceTo(v.sprite.position)>100||this.player.inputLocked;v.label.style.left=(p.x*.5+.5)*innerWidth+'px';v.label.style.top=(.5-p.y*.5)*innerHeight+'px';v.label.textContent='Open';v.label.disabled=egg.readyAt>now;
  }
  this.hatchPresentation.update(dt);
  const hatched=this.state.finish(id=>this.hatchPresentation.ready(id));const released=this.hatchPresentation.release();if(hatched.length||released){this.backpack.render();this.inventoryUI.update();if(hatched.length)this.pickaxes.bankFeedback.show(hatched,{rewards:false});}
 }
}
