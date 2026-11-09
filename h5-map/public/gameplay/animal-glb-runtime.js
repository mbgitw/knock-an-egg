import * as THREE from 'three';
import {GLTFLoader} from '../vendor/GLTFLoader.js';
import {clone as cloneSkeleton} from '../vendor/SkeletonUtils.js';

const base=new URL('./animal-glb/',import.meta.url),assets=new Map();let catalogPromise;
const readCatalog=()=>catalogPromise ||= fetch(new URL('catalog.json',base)).then(r=>{if(!r.ok)throw Error('动物GLB清单读取失败');return r.json();}).catch(error=>{catalogPromise=null;throw error;});

export function phongSpec(material){return {specular:material.specular.toArray(),shininess:material.shininess,normalScale:material.normalScale.toArray(),flatShading:material.flatShading,vertexColors:material.vertexColors,depthWrite:material.depthWrite};}
export function restoreAnimalMaterials(root){
  const cache=new Map();root.traverse(object=>{if(!object.isMesh)return;const restore=material=>{
    const spec=material.userData.knockEggPhong;if(!spec)return material;if(cache.has(material))return cache.get(material);
    const copy=new THREE.MeshPhongMaterial({name:material.name,color:material.color,emissive:material.emissive,
      specular:new THREE.Color().fromArray(spec.specular),shininess:spec.shininess,normalScale:new THREE.Vector2(...spec.normalScale),
      map:material.map,normalMap:material.normalMap,emissiveMap:material.emissiveMap,alphaMap:material.alphaMap,
      opacity:material.opacity,transparent:material.transparent,alphaTest:material.alphaTest,side:material.side,
      flatShading:spec.flatShading,vertexColors:spec.vertexColors,depthWrite:spec.depthWrite});cache.set(material,copy);return copy;
    };object.material=Array.isArray(object.material)?object.material.map(restore):restore(object.material);
  });
}

export function cloneAnimalSkeleton(root){
  const copy=cloneSkeleton(root),skeletons=[];
  copy.traverse(mesh=>{if(!mesh.isSkinnedMesh)return;mesh.frustumCulled=false;
    const existing=skeletons.find(s=>s.boneInverses===mesh.skeleton.boneInverses&&s.bones.length===mesh.skeleton.bones.length&&s.bones.every((bone,i)=>bone===mesh.skeleton.bones[i]));
    if(existing)mesh.skeleton=existing;else skeletons.push(mesh.skeleton);
  });return copy;
}

export async function animalGlbAsset(name){
  const catalog=await readCatalog(),entry=catalog.entries[name];if(!entry)return null;
  if(!assets.has(name))assets.set(name,new GLTFLoader().loadAsync(new URL(entry.file,base).href).then(gltf=>{
    restoreAnimalMaterials(gltf.scene);
    const staticRoot=gltf.scene.getObjectByName('__pet_static'),animatedRoot=gltf.scene.getObjectByName('__pet_animated');
    if(!staticRoot||!animatedRoot||!['Idle','Walk'].every(state=>gltf.animations.some(clip=>clip.name===state)))throw Error('动物GLB内容不完整 '+name);
    return {entry,staticRoot,animatedRoot,clips:gltf.animations};
  }).catch(error=>{assets.delete(name);throw error;}));
  return assets.get(name);
}

export async function animalGlbTemplate(name){
  const asset=await animalGlbAsset(name);if(!asset)return null;
  const root=asset.staticRoot.clone(true);root.name=name;
  root.userData.compiledAnimal=name;root.userData.facingYaw=asset.entry.facingYaw||0;
  return root;
}

export async function createAnimalGlbInstance(template,name,{height=2.8,includeOrdinary=false}={}){
  const asset=await animalGlbAsset(name);if(!asset)throw Error('动物GLB未登记 '+name);
  if(asset.entry.ordinary&&!includeOrdinary){const root=template.clone(true);root.scale.multiplyScalar(height/2.8);return root;}
  const root=cloneAnimalSkeleton(asset.animatedRoot),materials=new Map(),meshes=[],skeletons=new Set(),bones=new Set();
  template.traverse(object=>{if(object.isMesh)for(const material of Array.isArray(object.material)?object.material:[object.material])materials.set(material.name,material);});
  root.traverse(object=>{if(!object.isMesh)return;const choose=material=>{const mapped=materials.get(material.name);if(!mapped)throw Error('动物材质缺失 '+name+': '+material.name);return mapped;};
    object.material=Array.isArray(object.material)?object.material.map(choose):choose(object.material);
    if(object.isSkinnedMesh){meshes.push(object);skeletons.add(object.skeleton);for(const bone of object.skeleton.bones)bones.add(bone);}
  });
  root.scale.multiplyScalar(height/2.8);root.userData.facingYaw=asset.entry.facingYaw||0;
  const mixer=new THREE.AnimationMixer(root),actions=new Map(asset.clips.map(clip=>[clip.name,mixer.clipAction(clip)]));
  root.userData.rig={root,mesh:meshes[0],meshes,bones:[...bones],skeleton:meshes[0]?.skeleton,skeletons:[...skeletons],mixer,actions,sharedGeometry:true};
  actions.get('Idle').play();root.userData.rig.state='Idle';mixer.update(0);
  return root;
}
