import * as THREE from 'three';

// Keep each nest's animation transform; batch only its opaque render meshes.
// Per-instance frustum checks retain the old mesh-level visibility decision.
export class EggNestInstances {
  constructor(scene) {
    this.scene=scene;this.groups=new Map();this.members=new Map();
    this.frustum=new THREE.Frustum();this.projection=new THREE.Matrix4();
    this.matrix=new THREE.Matrix4();this.sphere=new THREE.Sphere();
  }
  add(root, zone, template) {
    let group=this.groups.get(zone);
    if (!group) {
      template.updateMatrixWorld(true);
      const inverse=template.matrixWorld.clone().invert(),sources=[];
      template.traverse(o=>{if(o.isMesh)sources.push(o);});
      if(!sources.length||sources.some(o=>Array.isArray(o.material)||o.material.transparent||o.isSkinnedMesh))return false;
      group={roots:new Set(),batches:sources.map(source=>{
        const mesh=new THREE.InstancedMesh(source.geometry,source.material,256);
        mesh.name=`Egg nest instances ${zone}`;mesh.count=0;mesh.visible=false;mesh.frustumCulled=false;
        mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
        source.geometry.computeBoundingSphere();this.scene.add(mesh);
        return {mesh,local:inverse.clone().multiply(source.matrixWorld),sphere:source.geometry.boundingSphere};
      })};this.groups.set(zone,group);
    }
    // Preserve the original renderer as a safe fallback above pool capacity.
    if(group.roots.size>=256)return false;
    group.roots.add(root);this.members.set(root,group);root.clear();return true;
  }
  remove(root) { const group=this.members.get(root);group?.roots.delete(root);this.members.delete(root); }
  update(camera) {
    if(camera){camera.updateMatrixWorld();this.frustum.setFromProjectionMatrix(this.projection.multiplyMatrices(camera.projectionMatrix,camera.matrixWorldInverse));}
    for(const group of this.groups.values()) {
      for(const batch of group.batches)batch.mesh.count=0;
      for(const root of group.roots) {
        if(!root.visible||!root.parent)continue;
        root.updateWorldMatrix(true,false);
        for(const batch of group.batches) {
          this.matrix.multiplyMatrices(root.matrixWorld,batch.local);
          this.sphere.copy(batch.sphere).applyMatrix4(this.matrix);
          if(camera&&!this.frustum.intersectsSphere(this.sphere))continue;
          batch.mesh.setMatrixAt(batch.mesh.count++,this.matrix);
        }
      }
      for(const {mesh} of group.batches){mesh.visible=mesh.count>0;mesh.instanceMatrix.needsUpdate=true;}
    }
  }
  dispose() {
    for(const group of this.groups.values())for(const {mesh} of group.batches){mesh.removeFromParent();mesh.dispose();}
    this.groups.clear();this.members.clear();
  }
}
