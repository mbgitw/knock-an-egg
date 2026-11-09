import * as THREE from 'three';
import {clone} from '../vendor/SkeletonUtils.js';
import {MotionBuffer} from './motion.js';
import {disposePetModel} from '../gameplay/pet-animation.js';
import {PresentationVisibility,skipHiddenMatrices} from '../static-blocks.js';
// 六个纯显示角色，共享几何/材质；独立骨架和动画混合器，没有输入/镜头/物理。
export class RemoteAvatars {
  constructor(scene,template,clips){this.scene=scene;this.template=template;this.clips=clips;this.actors=new Map();this.visibility=new PresentationVisibility();}
  reconcile(players,self){
    const wanted=new Set(players.filter(p=>p.id!==self&&p.connected).map(p=>p.id));
    for(const [id,a] of this.actors)if(!wanted.has(id)){disposePetModel(a.heldModel);a.heldModel?.removeFromParent();a.ribbon?.dispose();a.gear?.dispose();a.gearRoot?.removeFromParent();a.root.removeFromParent();a.mixer.stopAllAction();a.mixer.uncacheRoot(a.model);this.actors.delete(id);}
    for(const p of players){
      if(!wanted.has(p.id))continue;
      if(!this.actors.has(p.id)&&this.actors.size<6){
        const model=clone(this.template),root=skipHiddenMatrices(new THREE.Group());root.add(model);root.name='RemotePlayer';root.traverse(o=>{if(o.isMesh){o.castShadow=o.receiveShadow=false;}});
        const mixer=new THREE.AnimationMixer(model),actions=new Map(this.clips.map(c=>[c.name,mixer.clipAction(c)]));
        this.scene.add(root);this.actors.set(p.id,{root,model,mixer,actions,buffer:new MotionBuffer(),animation:null,elapsed:0,slot:p.slot});
      }
      const actor=this.actors.get(p.id);actor.slot=p.slot;actor.profile=p;if(!actor.buffer.samples.length)actor.buffer.seed(p.position);
    }
  }
  resetMotion(){for(const a of this.actors.values())a.buffer=new MotionBuffer();}
  positions(players,now,roomTime){for(const p of players)for(const a of this.actors.values())if(a.slot===p.slot)a.buffer.push(p,now,roomTime);}
  update(dt,now,camera){
    this.visibility.update(camera);
    for(const a of this.actors.values()){
      a.swingPose?.restore();if(a.savedArm){a.savedArm[0].quaternion.copy(a.savedArm[1]);a.savedArm=null;}
      const p=a.buffer.at(now);if(!p)continue;a.root.position.set(p.x,p.y,p.z);a.root.rotation.y=p.yaw;
      const distance=a.root.position.distanceTo(camera.position);a.root.visible=distance<450&&this.visibility.visible(a.root.position,12);if(!a.root.visible){a.elapsed=0;continue;}
      const name=a.profile.training?'RunLobbyNew':p.flags&2?'LobbyAir':p.flags&1?'RunLobbyNew':'Breathing Idle';const action=a.actions.get(name)||a.actions.get('Breathing Idle');
      if(action&&a.animation!==action){a.animation?.fadeOut(.15);action.reset().fadeIn(.15).play();a.animation=action;}
      if(action&&Number.isFinite(p.vx)&&name==='RunLobbyNew')action.setEffectiveTimeScale(a.profile.training?1:THREE.MathUtils.clamp(Math.hypot(p.vx,p.vz)/18,.6,3));
      a.elapsed+=dt;if(a.elapsed>=(distance>150?.1:distance>70?1/30:0)){a.mixer.update(a.elapsed);a.elapsed=0;}
    }
  }
}
