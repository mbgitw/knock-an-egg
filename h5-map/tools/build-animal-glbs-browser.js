import * as THREE from 'three';
import {GLTFExporter} from '/node_modules/three/examples/jsm/exporters/GLTFExporter.js';
import {GLTFLoader} from '/public/vendor/GLTFLoader.js';
import {loadSceneResource} from '/public/scene-resource.js';
import {createPetModel,disposePetModel} from '/public/gameplay/pet-animation.js';
import {phongSpec,restoreAnimalMaterials} from '/public/gameplay/animal-glb-runtime.js';
const base=new URL('/build/builda-draft/model-check/',location.href);
const read=async url=>{const response=await fetch(url);if(!response.ok)throw Error(`${url}: ${response.status}`);return response.json();};
const meshes=root=>{const list=[];root.traverse(o=>{if(o.isMesh)list.push(o);});return list;};
const skinMeshes=root=>meshes(root).filter(o=>o.isSkinnedMesh);
const materialMap=root=>{const map=new Map();for(const mesh of meshes(root))for(const m of Array.isArray(mesh.material)?mesh.material:[mesh.material])map.set(m.name,m);return map;};
let descriptions;
export async function describe(){
  const models=(await Promise.all(['animals','paid-animals'].map(folder=>read(new URL(folder+'/catalog.json',base))))).flat();
  const manifests=await Promise.all(['animal-animations','planet-x-animations','paid-animal-animations'].map(folder=>read(new URL(folder+'/catalog.json',base))));
  descriptions=[];
  for(let group=0;group<manifests.length;group++)for(const [id,animation] of Object.entries(manifests[group]))if(animation.rig){
    const model=models.find(m=>m.name===animation.name);if(!model?.scene)throw Error('Missing static model '+animation.name);
    const sceneUrl=new URL(model.scene,base),scene=await read(sceneUrl);
    const dependencies=new Set([sceneUrl.pathname.replace('/build/builda-draft/','')]);
    for(const material of Object.values(scene.materials))for(const file of Object.values(material.textures))dependencies.add(new URL(file,sceneUrl).pathname.replace('/build/builda-draft/',''));
    for(const file of [animation.rig,...Object.values(animation.actions).filter(a=>a.available).map(a=>a.url)])dependencies.add(new URL(file,base).pathname.replace('/build/builda-draft/',''));
    descriptions.push({id,name:model.name,model,animation,ordinary:group===0,dependencies:[...dependencies]});
  }return descriptions;
}
async function sourceModels(entry){
  const model=await loadSceneResource(new URL(entry.model.scene,base).href),bounds=new THREE.Box3().setFromObject(model),center=bounds.getCenter(new THREE.Vector3());
  model.position.set(-center.x,-bounds.min.y,-center.z);const template=new THREE.Group();template.add(model);template.scale.setScalar(2.8/bounds.getSize(new THREE.Vector3()).y);template.userData.facingYaw=entry.model.facingYaw||0;
  const animated=await createPetModel(template,entry.name,{height:2.8,includeOrdinary:true});animated.userData.rig.mixer.stopAllAction();
  return {template,animated};
}
function base64(buffer){let text='';const bytes=new Uint8Array(buffer);for(let i=0;i<bytes.length;i+=32768)text+=String.fromCharCode(...bytes.subarray(i,i+32768));return btoa(text);}
export async function compile(name){
  const entry=descriptions.find(d=>d.name===name);if(!entry)throw Error(name);
  const {template,animated}=await sourceModels(entry),rig=animated.userData.rig;
  const clips=['Idle','Walk'].map(state=>{const clip=rig.actions.get(state).getClip().clone().optimize();clip.name=state;return clip;});
  template.name='__pet_static';animated.name='__pet_animated';const asset=new THREE.Group();asset.name=entry.id;asset.add(template,animated);
  asset.traverse(object=>{object.userData={};});
  for(const material of materialMap(asset).values())if(material.isMeshPhongMaterial)material.userData={knockEggPhong:phongSpec(material)};
  const buffer=await new GLTFExporter().parseAsync(asset,{binary:true,animations:clips,onlyVisible:false});
  const result={glb:base64(buffer),bones:rig.bones.length,staticMeshes:meshes(template).length,animatedMeshes:skinMeshes(animated).length};
  rig.mixer.stopAllAction();rig.mixer.uncacheRoot(rig.root);for(const skeleton of new Set(rig.skeletons||[rig.skeleton]))skeleton.dispose();
  for(const mesh of meshes(asset))mesh.geometry.dispose();
  return result;
}

function pose(root,mixer,clip,time){mixer.stopAllAction();mixer.clipAction(clip).reset().play();mixer.setTime(time);root.updateMatrixWorld(true);for(const mesh of skinMeshes(root))mesh.skeleton.update();}
function vertexError(a,b,skinned){const aa=skinned?skinMeshes(a):meshes(a),bb=skinned?skinMeshes(b):meshes(b);if(aa.length!==bb.length)throw Error(`Mesh count ${aa.length}/${bb.length}`);let max=0;const p=new THREE.Vector3(),q=new THREE.Vector3();
  a.updateMatrixWorld(true);b.updateMatrixWorld(true);
  for(let m=0;m<aa.length;m++){const count=aa[m].geometry.attributes.position.count;if(count!==bb[m].geometry.attributes.position.count)throw Error('Vertex count mismatch');for(let i=0;i<count;i++){aa[m].getVertexPosition(i,p).applyMatrix4(aa[m].matrixWorld);bb[m].getVertexPosition(i,q).applyMatrix4(bb[m].matrixWorld);max=Math.max(max,p.distanceTo(q));}}return max;}
export async function validate(name,url){
  const entry=descriptions.find(d=>d.name===name),{template,animated}=await sourceModels(entry),sourceRig=animated.userData.rig;
  const parsed=await new GLTFLoader().loadAsync(url);restoreAnimalMaterials(parsed.scene);
  const staticRoot=parsed.scene.getObjectByName('__pet_static'),animatedRoot=parsed.scene.getObjectByName('__pet_animated');
  const staticError=vertexError(template,staticRoot,false),mixer=new THREE.AnimationMixer(animatedRoot);let animationError=0;
  for(const state of ['Idle','Walk']){const source=sourceRig.actions.get(state).getClip(),target=parsed.animations.find(a=>a.name===state);
    if(!target)throw Error('Missing animation '+name+':'+state);
    for(const fraction of [0,.17,.43,.79]){pose(animated,sourceRig.mixer,source,source.duration*fraction);pose(animatedRoot,mixer,target,source.duration*fraction);animationError=Math.max(animationError,vertexError(animated,animatedRoot,true));}}
  const old=materialMap(template),next=materialMap(staticRoot);let colorError=0;
  for(const [key,m] of old){const n=next.get(key);if(!n||m.type!==n.type)throw Error('Material type/name changed '+name+':'+key);colorError=Math.max(colorError,...m.color.toArray().map((v,i)=>Math.abs(v-n.color.toArray()[i])));if(m.shininess!==n.shininess)throw Error('Shininess changed');}
  if(staticError>1e-3||animationError>1e-3||colorError>1e-5)throw Error(`${name}: ${staticError},${animationError},${colorError}`);
  disposePetModel(animated);for(const mesh of meshes(template))mesh.geometry.dispose();mixer.stopAllAction();mixer.uncacheRoot(animatedRoot);
  return {name,staticError,animationError,colorError,meshes:skinMeshes(animatedRoot).length,bones:new Set(skinMeshes(animatedRoot).flatMap(m=>m.skeleton.bones)).size};
}
