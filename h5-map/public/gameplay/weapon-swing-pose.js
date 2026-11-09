import * as THREE from 'three';

export const WEAPON_SWING_SPEED=1.75;
export const WEAPON_SWING_DURATION=.8833333253860474/WEAPON_SWING_SPEED;
export const WEAPON_SWING_RECOVERY=.12;
const mapping=[['spine_c','UpperTorso'],['armL','LeftUpperArm'],['handL','LeftLowerArm'],['armR','RightUpperArm'],['handR','RightLowerArm']];
const frame=p=>new THREE.Matrix4().set(+p.R00,+p.R01,+p.R02,+p.X,+p.R10,+p.R11,+p.R12,+p.Y,+p.R20,+p.R21,+p.R22,+p.Z,0,0,0,1);
const rotation=m=>new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().extractRotation(m)).normalize();
const turn=new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0,1,0),Math.PI);

// Original R15 transforms drive this avatar's torso, upper arms and forearms.
// Its two-joint arms have no independent wrist; wrist curves drive weapon orientation.
export class WeaponSwingPose {
  static async create(player){
    const read=async name=>{const r=await fetch(new URL(`../model-check/weapons/${name}.json`,import.meta.url));if(!r.ok)throw Error('挥击动画加载失败');return r.json();};
    const [rig,clip,bind]=await Promise.all([read('swing-rig'),read('swing-candidate'),fetch(new URL('./weapon-avatar-bind.json',import.meta.url)).then(r=>{if(!r.ok)throw Error('人物挥击绑定加载失败');return r.json();})]);return new WeaponSwingPose(player,rig,clip,bind);
  }
  constructor(player,rig,clip,avatarBind){
    this.player=player;this.clip=clip;this.nodes=new Map(rig.parts.map(p=>[p.name,new THREE.Group()]));this.joints=[];
    for(const m of rig.motors){
      const pivot=new THREE.Group(),pose=new THREE.Group();frame(m.c0).decompose(pivot.position,pivot.quaternion,pivot.scale);
      this.nodes.get(m.parent).add(pivot);pivot.add(pose);const child=this.nodes.get(m.child);pose.add(child);frame(m.c1).invert().decompose(child.position,child.quaternion,child.scale);this.joints.push({name:m.child,pose});
    }
    this.root=this.nodes.get('HumanoidRootPart');this.root.updateMatrixWorld(true);
    // Use authored node rotations, not inverse skin bind matrices: this avatar's
    // mesh has a -90deg X transform which is separate from its bone hierarchy.
    const bind=new Map(Object.entries(avatarBind.rotations).map(([name,q])=>[name,new THREE.Quaternion().fromArray(q).normalize()]));
    this.targets=mapping.map(([target,source])=>{
      const bone=player.model.getObjectByName(target);if(!bone||!bind.has(target))throw Error(`挥击骨骼缺失: ${target}`);
      return {bone,source,bind:bind.get(target),sourceInverse:this.nodes.get(source).getWorldQuaternion(new THREE.Quaternion()).invert()};
    });
    const attachment=rig.parts.find(p=>p.name==='RightHand').attachments.find(a=>a.name==='RightGripAttachment');
    this.attachment=rotation(frame(attachment.properties.CFrame));this.saved=null;
    this.frames=clip.frames.map(f=>({time:f.time,poses:new Map(f.poses.map(p=>{
      const a=p.cframe,m=new THREE.Matrix4().set(a[3],a[4],a[5],a[0],a[6],a[7],a[8],a[1],a[9],a[10],a[11],a[2],0,0,0,1);
      return [p.name,{position:new THREE.Vector3(a[0],a[1],a[2]),rotation:rotation(m),weight:p.weight}];
    }))}));
  }
  restore(){if(!this.saved)return;for(const [bone,q] of this.saved)bone.quaternion.copy(q);this.saved=null;}
  sample(time){
    const index=this.frames.findIndex(f=>f.time>=time),b=this.frames[index<0?this.frames.length-1:index],a=this.frames[Math.max(0,(index<0?this.frames.length-1:index)-1)];
    const t=b.time===a.time?0:THREE.MathUtils.clamp((time-a.time)/(b.time-a.time),0,1);
    for(const j of this.joints){
      j.pose.position.set(0,0,0);j.pose.quaternion.identity();
      if(/Leg|Foot/.test(j.name)||['Head','LowerTorso','HumanoidRootPart'].includes(j.name))continue;
      const p=a.poses.get(j.name),q=b.poses.get(j.name);if(!p||!q)continue;
      const weight=THREE.MathUtils.lerp(p.weight,q.weight,t);
      j.pose.position.lerpVectors(p.position,q.position,t).multiplyScalar(weight);j.pose.quaternion.slerp(p.rotation.clone().slerp(q.rotation,t),weight);
    }
    this.root.updateMatrixWorld(true);
    const result=new Map();for(const t of this.targets)result.set(t.source,this.nodes.get(t.source).getWorldQuaternion(new THREE.Quaternion()));
    result.set('RightHand',this.nodes.get('RightHand').getWorldQuaternion(new THREE.Quaternion()));return result;
  }
  apply(elapsed){
    this.restore();this.saved=this.targets.map(t=>[t.bone,t.bone.quaternion.clone()]);
    const active=elapsed!==null&&elapsed>=0&&elapsed<WEAPON_SWING_DURATION+WEAPON_SWING_RECOVERY;
    const sourceTime=active?Math.min(this.clip.duration,elapsed*WEAPON_SWING_SPEED):0;
    const poses=this.sample(sourceTime);
    if(active&&elapsed>WEAPON_SWING_DURATION){
      const idle=this.sample(0),t=(elapsed-WEAPON_SWING_DURATION)/WEAPON_SWING_RECOVERY;
      for(const [name,q] of poses)q.slerp(idle.get(name),t*t*(3-2*t));
    }
    const world=this.player.model.getWorldQuaternion(new THREE.Quaternion());
    for(const target of this.targets){
      const delta=turn.clone().multiply(poses.get(target.source)).multiply(target.sourceInverse).multiply(turn.clone().invert());
      const desired=world.clone().multiply(delta).multiply(target.bind);
      const parent=target.bone.parent.getWorldQuaternion(new THREE.Quaternion());target.bone.quaternion.copy(parent.invert().multiply(desired)).normalize();target.bone.updateWorldMatrix(false,true);
    }
    return world.clone().multiply(turn).multiply(poses.get('RightHand')).multiply(this.attachment);
  }
}
