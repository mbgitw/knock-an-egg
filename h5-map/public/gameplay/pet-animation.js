import * as THREE from 'three';
import {buildSkinnedAnimal,buildAnimalClip} from '../model-check/animal-animation-player.js';
import {buildMultiMeshAnimal} from '../model-check/multi-mesh-animal.js';
import {createAnimalGlbInstance} from './animal-glb-runtime.js';
const requests=new Map();
const json=path=>{
  const url=new URL('../model-check/'+path.replace(/^\.\//,''),import.meta.url);
  if(!requests.has(url.href))requests.set(url.href,fetch(url).then(r=>{if(!r.ok)throw Error(path);return r.json();}).catch(error=>{requests.delete(url.href);throw error;}));
  return requests.get(url.href);
};
// Templates remain static and cloneable. Every displayed pet owns its skeleton and mixer.
export async function createPetModel(template,name,{height=2.8,includeOrdinary=false}={}){
  if(template.userData.compiledAnimal)return createAnimalGlbInstance(template,name,{height,includeOrdinary});
  const catalogs=await Promise.all(['planet-x-animations','paid-animal-animations',...(includeOrdinary?['animal-animations']:[])].map(folder=>json(folder+'/catalog.json')));
  const entry=catalogs.flatMap(c=>Object.values(c)).find(e=>e.name===name&&e.rig);
  if(!entry){const root=template.clone(true);root.scale.multiplyScalar(height/2.8);return root;}
  let material;const materials=new Map();
  template.traverse(o=>{if(o.isMesh)for(const m of Array.isArray(o.material)?o.material:[o.material]){material??=m;materials.set(m.name,m);}});
  const data=await json(entry.rig);
  const rig=entry.format==='multi-mesh'?buildMultiMeshAnimal(data,materials):buildSkinnedAnimal(data,material);
  const model=new THREE.Group(),facing=new THREE.Group();model.add(facing);facing.add(rig.root);
  try{
    // Facing correction belongs above the authored rig, not on its animated bones.
    facing.rotation.y=template.userData.facingYaw||0;
    model.scale.setScalar(height/new THREE.Box3().setFromObject(model).getSize(new THREE.Vector3()).y);
    for(const state of ['Idle','Walk'])if(entry.actions[state]?.available)rig.actions.set(state,rig.mixer.clipAction(buildAnimalClip(await json(entry.actions[state].url),rig)));
    model.userData.rig=rig;model.userData.facingYaw=template.userData.facingYaw||0;
    updatePetAnimation(model,0);return model;
  }catch(error){model.userData.rig=rig;disposePetModel(model);throw error;}
}
export function updatePetAnimation(model,dt,state='Idle'){
  const rig=model?.userData.rig;if(!rig)return;
  if(rig.state!==state){rig.mixer.stopAllAction();rig.actions.get(state)?.reset().play();rig.state=state;}
  rig.mixer.update(Math.max(0,dt));
}
export function disposePetModel(model){
  const rig=model?.userData.rig;if(!rig)return;
  rig.mixer.stopAllAction();rig.mixer.uncacheRoot(rig.root);
  if(!rig.sharedGeometry)for(const mesh of rig.meshes||[rig.mesh])mesh.geometry.dispose();
  for(const skeleton of new Set(rig.skeletons||[rig.skeleton]))skeleton?.dispose();delete model.userData.rig;
}
