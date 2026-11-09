import * as THREE from 'three';
const WORLD_UP=new THREE.Vector3(0,1,0),PROBES=[[0,0],[.35,0],[-.35,0],[0,.35],[0,-.35]];

export class CameraOcclusion {
  constructor(){this.distance=null;this.clearTime=0;this.ray=new THREE.Ray();this.direction=new THREE.Vector3();this.right=new THREE.Vector3();this.up=new THREE.Vector3();this.origin=new THREE.Vector3();}
  resolve(target,requested,world,dt){
    const direction=this.direction.copy(requested).sub(target),wanted=direction.length();
    if(wanted<1e-6)return requested;
    direction.divideScalar(wanted);
    this.right.crossVectors(direction,WORLD_UP).normalize();
    this.up.crossVectors(this.right,direction).normalize();
    let safe=wanted;
    // A small cross around the sight line protects the near plane at corners.
    for(const [x,y] of PROBES){
      this.origin.copy(target).addScaledVector(this.right,x).addScaledVector(this.up,y);
      this.ray.set(this.origin,direction);
      const hit=(world.cameraRayIntersect||world.rayIntersect).call(world,this.ray);
      if(hit)safe=Math.min(safe,Math.max(.15,hit.distance-.45));
    }
    const step=Math.min(Math.max(dt,0),.1);
    if(this.distance===null||safe<this.distance){this.distance=safe;this.clearTime=0;}
    else if(safe>this.distance+.01){
      this.clearTime+=step;
      if(this.clearTime>=.12)this.distance+=(safe-this.distance)*(1-Math.exp(-5*step));
    }else this.clearTime=0;
    requested.copy(target).addScaledVector(direction,this.distance);
    return requested;
  }
}
