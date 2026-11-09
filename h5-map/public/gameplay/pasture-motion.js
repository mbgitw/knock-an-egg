import * as THREE from 'three';
import {createPetModel,disposePetModel} from './pet-animation.js';
export const pastureModel=(template,name)=>createPetModel(template,name,{height:4,includeOrdinary:true});
export function freePoint(hitbox,margin=3,random=Math.random){
  return new THREE.Vector3((random()-.5)*Math.max(0,hitbox.size[0]-margin*2),0,(random()-.5)*Math.max(0,hitbox.size[2]-margin*2)).applyMatrix4(new THREE.Matrix4().set(...hitbox.matrix));
}
export class PastureMotion {
  constructor(model,pet,fresh,hitbox){
    Object.assign(this,{model,pet,hitbox});this.age=fresh?0:99;this.celebrate=3.4*(.3+Math.random()*1.4);this.scale=model.scale.clone();
    if(fresh){
      this.sparkPositions=new Float32Array(24*3);const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.BufferAttribute(this.sparkPositions,3));
      this.sparks=new THREE.Points(geometry,new THREE.PointsMaterial({color:0xffe78c,size:.22,transparent:true,depthWrite:false}));
      this.sparks.position.fromArray(pet.position);model.parent.add(this.sparks);
    }
    this.floor=pet.position[1];this.center=new THREE.Vector3(...pet.position);this.target=null;this.wait=.5+Math.random()*1.5;this.time=0;
    const box=new THREE.Box3().setFromObject(model);this.margin=Math.max(2,box.getSize(new THREE.Vector3()).x/2,box.getSize(new THREE.Vector3()).z/2)+.5;
  }
  update(dt,others){
    this.age+=dt;this.time+=dt;let speed=0;
    if(this.sparks){
      if(this.age>.85){this.sparks.removeFromParent();this.sparks.geometry.dispose();this.sparks.material.dispose();this.sparks=null;}
      else{for(let i=0;i<24;i++){const a=i*Math.PI*2/24,t=this.age;this.sparkPositions.set([Math.cos(a)*t*4,.5+t*(2+i%3)-3*t*t,Math.sin(a)*t*4],i*3);}this.sparks.geometry.attributes.position.needsUpdate=true;this.sparks.material.opacity=1-this.age/.85;}
    }
    if(this.age<this.celebrate){
      const a=this.age*2.2,local=this.center.clone().applyMatrix4(new THREE.Matrix4().set(...this.hitbox.matrix).invert());
      local.x+=Math.cos(a)*1.3;local.z+=Math.sin(a)*1.3;
      local.x=THREE.MathUtils.clamp(local.x,-this.hitbox.size[0]/2+this.margin,this.hitbox.size[0]/2-this.margin);
      local.z=THREE.MathUtils.clamp(local.z,-this.hitbox.size[2]/2+this.margin,this.hitbox.size[2]/2-this.margin);
      this.model.position.copy(local.applyMatrix4(new THREE.Matrix4().set(...this.hitbox.matrix)));
      this.model.position.y=this.floor+Math.max(0,Math.sin(this.age*Math.PI*2/.52))*1.2;
      this.model.rotation.y=-a;speed=8.1;
    }else{
      this.model.position.y=this.floor;this.wait-=dt;
      if(!this.target&&this.wait<=0){
        for(let i=0;i<20;i++){const p=freePoint(this.hitbox,this.margin);p.y=this.floor;if(others.every(m=>m===this.model||m.position.distanceTo(p)>this.margin+2)){this.target=p;break;}}
        if(!this.target)this.wait=1.5;
      }
      if(this.target){const delta=this.target.clone().sub(this.model.position),d=delta.length(),step=Math.min(d,6*dt);
        if(d>.01){this.model.position.addScaledVector(delta,step/d);const yaw=Math.atan2(-delta.x,-delta.z);this.model.rotation.y+=Math.atan2(Math.sin(yaw-this.model.rotation.y),Math.cos(yaw-this.model.rotation.y))*(1-Math.exp(-8*dt));speed=6;}
        if(d<=step+.1){this.target=null;this.wait=1.5+Math.random()*2.5;}
      }
    }
    const t=Math.min(1,this.age/.7),elastic=t>=1?1:1+2**(-10*t)*Math.sin((t*10-.75)*Math.PI*2/3);
    this.model.scale.copy(this.scale).multiplyScalar(Math.max(.01,.05+.95*elastic));
    const rig=this.model.userData.rig,state=speed?'Walk':'Idle';
    if(rig){if(this.state!==state){rig.mixer.stopAllAction();rig.actions.get(state)?.reset().play();this.state=state;}rig.mixer.update(dt*(speed>6?1.35:1));}
  }
  dispose(){if(this.sparks){this.sparks.removeFromParent();this.sparks.geometry.dispose();this.sparks.material.dispose();}disposePetModel(this.model);}
}
