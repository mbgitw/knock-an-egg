import * as THREE from 'three';

// Decoration can be non-collidable for walkers and still occupy spawn space.
// World AABBs conservatively include rotated/scaled pieces of rocks and trees.
export class EggPlacementObstacles {
  constructor(parts=[]){
    this.zones=new Map();
    for(const part of parts){
      const match=/^\/Workspace\/Build\/ZoneBuilds\/Zone(10|[1-9])\/([^/]+)\//.exec(part.path||'');
      if(!match||part.transparency>=1||!part.size?.every(n=>Number.isFinite(n)&&n>0))continue;
      if(['Parts','Eggs','Chicken','SPHINX','IceYeti','EmeraldSerpent','WoollyMammoth','RedshellCrab','MoleTitan','Griffin','3Hydra','AlienGuardian'].includes(match[2]))continue;
      // Broad, thin ground sheets are support surfaces, not rocks.
      if(part.size[1]<1&&part.size[0]>60&&part.size[2]>60)continue;
      const matrix=new THREE.Matrix4().set(...part.matrix.slice(0,12),0,0,0,1);
      const box=new THREE.Box3().setFromCenterAndSize(new THREE.Vector3(),new THREE.Vector3(...part.size)).applyMatrix4(matrix);
      const zone=Number(match[1]);if(!this.zones.has(zone))this.zones.set(zone,[]);
      this.zones.get(zone).push({box,path:part.path});
    }
  }
  clear(spec){
    const [x,,z]=spec.position,r=spec.radius+.2,top=spec.bodyBottom+spec.bodyHeight;
    return !(this.zones.get(spec.zone)||[]).some(({box})=>{
      if(box.max.y<=spec.floorY+.025||box.min.y>=top+.2)return false;
      const dx=Math.max(box.min.x-x,0,x-box.max.x),dz=Math.max(box.min.z-z,0,z-box.max.z);
      return dx*dx+dz*dz<r*r;
    });
  }
}
