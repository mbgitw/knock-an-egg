// Runtime culling for animated pets and guards. Kept apart from pet-animation.js and
// animal-glb-runtime.js, whose bytes are inputs to the compiled animal GLB build.
import * as THREE from 'three';
import {createPetModel as createRawPetModel,disposePetModel} from './pet-animation.js';

export {disposePetModel};

// The rig builders disable culling because three takes a SkinnedMesh's lazy bounding
// sphere from bone matrices that are still zero on the first cull. Pose each rig once,
// pad the mesh-local sphere for animation, and reuse it per species and mesh.
const CULL_PADDING=1.6,spheres=new Map();
export function posedCullSphere(mesh,key,padding=CULL_PADDING){
  let sphere=spheres.get(key);
  if(sphere===undefined){
    sphere=null;
    try{mesh.skeleton.update();mesh.computeBoundingSphere();const s=mesh.boundingSphere;
      if(s&&Number.isFinite(s.radius)&&s.radius>1e-4&&s.center.toArray().every(Number.isFinite)){sphere=s.clone();sphere.radius*=padding;}}catch{sphere=null;}
    spheres.set(key,sphere);
  }
  return sphere;
}
export function enableRigCulling(model,name){
  const rig=model?.userData.rig;if(!rig)return;
  const meshes=(rig.meshes||[rig.mesh]).filter(mesh=>mesh?.isSkinnedMesh);if(!meshes.length)return;
  model.updateMatrixWorld(true);
  meshes.forEach((mesh,index)=>{
    const sphere=posedCullSphere(mesh,`${name}:${index}:${mesh.geometry.attributes.position?.count}`);
    // Unusable pose data keeps the original always-draw behaviour.
    if(sphere){mesh.boundingSphere=sphere.clone();mesh.frustumCulled=true;}
  });
}
export async function createPetModel(template,name,options){
  const model=await createRawPetModel(template,name,options);enableRigCulling(model,name);return model;
}

// Skinning every pet's mixer each frame is costly. Rigs in the main scene that are
// hidden or entirely outside the camera frustum bank their time and catch up when seen.
const view={scene:null,frustum:new THREE.Frustum(),matrix:new THREE.Matrix4()};
export function setPetAnimationView(camera,scene){
  view.scene=scene;camera.updateMatrixWorld();
  view.frustum.setFromProjectionMatrix(view.matrix.multiplyMatrices(camera.projectionMatrix,camera.matrixWorldInverse));
}
export function rigVisible(root,meshes){
  if(!view.scene)return true;
  let top=root,shown=root.visible;while(top.parent){top=top.parent;shown&&=top.visible;}
  if(top!==view.scene)return true; // previews in their own scene keep animating
  if(!shown)return false;
  for(const mesh of meshes){if(!mesh)continue;if(!mesh.frustumCulled||!mesh.boundingSphere||view.frustum.intersectsObject(mesh))return true;}
  return false;
}
export function advancePetMixer(model,rig,dt){
  dt=Math.max(0,dt);
  if(!rigVisible(model,rig.meshes||[rig.mesh])){rig.pendingTime=(rig.pendingTime||0)+dt;return;}
  rig.mixer.update(dt+(rig.pendingTime||0));rig.pendingTime=0;
}
// Same state handling as pet-animation.js updatePetAnimation, plus off-screen banking.
export function updatePetAnimation(model,dt,state='Idle'){
  const rig=model?.userData.rig;if(!rig)return;
  if(rig.state!==state){rig.mixer.stopAllAction();rig.actions.get(state)?.reset().play();rig.state=state;rig.pendingTime=0;}
  advancePetMixer(model,rig,dt);
}
