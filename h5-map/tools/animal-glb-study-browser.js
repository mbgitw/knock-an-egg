import * as THREE from 'three';
import {GLTFExporter} from '/node_modules/three/examples/jsm/exporters/GLTFExporter.js';
import {GLTFLoader} from '/public/vendor/GLTFLoader.js';
import {clone as cloneSkeleton} from '/node_modules/three/examples/jsm/utils/SkeletonUtils.js';
import {loadSceneResource} from '/public/scene-resource.js';
import {createPetModel} from '/public/gameplay/pet-animation.js';

const base=new URL('/build/builda-draft/model-check/',location.href);
const read=async url=>{const response=await fetch(url);if(!response.ok)throw Error(`${url}: ${response.status}`);return response.json();};
const samples=new Map();
const median=values=>[...values].sort((a,b)=>a-b)[Math.floor(values.length/2)];
function meshes(root){const result=[];root.traverse(o=>{if(o.isSkinnedMesh)result.push(o);});return result;}
function geometryBytes(roots){const unique=new Set();let bytes=0;for(const root of roots)for(const mesh of meshes(root))if(!unique.has(mesh.geometry)){unique.add(mesh.geometry);for(const attribute of Object.values(mesh.geometry.attributes))bytes+=attribute.array.byteLength;bytes+=mesh.geometry.index?.array.byteLength||0;}return {bytes,geometries:unique.size};}
function pose(root,mixer,clip,time){mixer.stopAllAction();mixer.clipAction(clip).reset().play();mixer.setTime(time);root.updateMatrixWorld(true);for(const mesh of meshes(root))mesh.skeleton.update();}
function vertexError(a,b){const am=meshes(a),bm=meshes(b);if(am.length!==bm.length)throw Error(`Mesh count ${am.length}/${bm.length}`);let max=0,count=0;const p=new THREE.Vector3(),q=new THREE.Vector3();
  for(let m=0;m<am.length;m++){const n=am[m].geometry.attributes.position.count;if(n!==bm[m].geometry.attributes.position.count)throw Error('Vertex count mismatch');for(let i=0;i<n;i++){am[m].getVertexPosition(i,p).applyMatrix4(am[m].matrixWorld);bm[m].getVertexPosition(i,q).applyMatrix4(bm[m].matrixWorld);max=Math.max(max,p.distanceTo(q));count++;}}return {max,count};}
function materials(root){const result=new Map();root.traverse(o=>{if(o.isMesh)for(const m of Array.isArray(o.material)?o.material:[o.material])result.set(m.name,m);});return result;}
function restorePhong(root){
  const cache=new Map();root.traverse(o=>{if(!o.isMesh)return;const restore=material=>{
    const spec=material.userData.knockEggPhong;if(!spec)return material;if(cache.has(material))return cache.get(material);
    const copy=new THREE.MeshPhongMaterial({name:material.name,color:material.color,emissive:material.emissive,
      specular:new THREE.Color().fromArray(spec.specular),shininess:spec.shininess,normalScale:new THREE.Vector2(...spec.normalScale),
      map:material.map,normalMap:material.normalMap,emissiveMap:material.emissiveMap,alphaMap:material.alphaMap,
      opacity:material.opacity,transparent:material.transparent,alphaTest:material.alphaTest,side:material.side,
      flatShading:spec.flatShading,vertexColors:spec.vertexColors,depthWrite:spec.depthWrite});cache.set(material,copy);return copy;
    };o.material=Array.isArray(o.material)?o.material.map(restore):restore(o.material);});
}
function base64(buffer){const bytes=new Uint8Array(buffer);let text='';for(let i=0;i<bytes.length;i+=32768)text+=String.fromCharCode(...bytes.subarray(i,i+32768));return btoa(text);}
function cloneAsset(root){
  const copy=cloneSkeleton(root),skeletons=[];
  // SkeletonUtils makes one Skeleton per mesh; preserve authored shared skins.
  for(const mesh of meshes(copy)){
    const same=skeletons.find(s=>s.boneInverses===mesh.skeleton.boneInverses&&s.bones.length===mesh.skeleton.bones.length&&s.bones.every((bone,i)=>bone===mesh.skeleton.bones[i]));
    if(same)mesh.skeleton=same;else skeletons.push(mesh.skeleton);
  }return copy;
}

export async function build(name){
  window.studyPhase='catalog';
  const catalog=await read(new URL('animals/catalog.json',base)),entry=catalog.find(e=>e.name===name);if(!entry?.scene)throw Error('Missing sample '+name);
  const dependencies=new Set([new URL('animals/catalog.json',base).href]);
  const modelUrl=new URL(entry.scene,base);dependencies.add(modelUrl.href);
  const sceneData=await read(modelUrl);
  for(const spec of Object.values(sceneData.materials))for(const file of Object.values(spec.textures))dependencies.add(new URL(file,modelUrl).href);
  const folder=name==='Chicken'?'animal-animations':'planet-x-animations',manifest=await read(new URL(folder+'/catalog.json',base)),animation=Object.values(manifest).find(e=>e.name===name);
  dependencies.add(new URL(animation.rig,base).href);for(const action of Object.values(animation.actions))if(action.available)dependencies.add(new URL(action.url,base).href);
  window.studyPhase='template';const coldStart=performance.now(),template=await loadSceneResource(modelUrl.href);template.userData.facingYaw=entry.facingYaw||0;
  window.studyPhase='source-rig';
  const original=await createPetModel(template,name,{height:4,includeOrdinary:true}),sourceLoadMs=performance.now()-coldStart;
  const rig=original.userData.rig;rig.mixer.stopAllAction();
  const clips=['Idle','Walk'].map(state=>{const clip=rig.actions.get(state).getClip().clone();clip.name=state;return clip;});
  const optimizedClips=clips.map(clip=>clip.clone().optimize());
  const metadata=[];original.traverse(o=>{metadata.push([o,o.userData]);o.userData={};});
  const materialMetadata=[];for(const material of materials(original).values())if(material.isMeshPhongMaterial){materialMetadata.push([material,material.userData]);material.userData={knockEggPhong:{specular:material.specular.toArray(),shininess:material.shininess,normalScale:material.normalScale.toArray(),flatShading:material.flatShading,vertexColors:material.vertexColors,depthWrite:material.depthWrite}};}
  window.studyPhase='export';const buffer=await new GLTFExporter().parseAsync(original,{binary:true,animations:optimizedClips,onlyVisible:false});
  for(const [object,data] of metadata)object.userData=data;
  for(const [material,data] of materialMetadata)material.userData=data;
  window.studyPhase='import';const parseTimes=[];let imported;
  for(let i=0;i<5;i++){const start=performance.now();const parsed=await new GLTFLoader().parseAsync(buffer.slice(0),location.href);restorePhong(parsed.scene);parseTimes.push(performance.now()-start);if(i===0)imported=parsed;}
  const glb=imported.scene,mixer=new THREE.AnimationMixer(glb),checks=[];
  for(const clip of clips){const target=imported.animations.find(c=>c.name===clip.name);if(!target)throw Error('Missing GLB animation '+clip.name);
    for(const fraction of [0,.17,.43,.79]){const time=clip.duration*fraction;pose(original,rig.mixer,clip,time);pose(glb,mixer,target,time);checks.push({action:clip.name,time,...vertexError(original,glb)});}}
  const oldMaterials=materials(original),newMaterials=materials(glb);let colorError=0;
  for(const [key,material] of oldMaterials){const other=newMaterials.get(key);if(!other)throw Error('Missing GLB material '+key);colorError=Math.max(colorError,Math.abs(material.color.r-other.color.r),Math.abs(material.color.g-other.color.g),Math.abs(material.color.b-other.color.b));}
  const variants=await read('/public/gameplay/animal-variants/materials.json'),variantChecks=[];
  for(const variant of ['Gold','Diamond']){const specs=variants[name]?.[variant];if(!specs){variantChecks.push({variant,available:false});continue;}let missing=0;
    for(const [key] of oldMaterials)if(!specs[key]||!newMaterials.has(key))missing++;
    variantChecks.push({variant,available:true,missing});}
  // Compare the current cached-JSON assembly with skeleton-safe GLB instances.
  const oldTimes=[],newTimes=[];let oldInstances=[],newInstances=[];
  for(let pass=0;pass<3;pass++){
    const previous=[];let start=performance.now();for(let i=0;i<16;i++)previous.push(await createPetModel(template,name,{height:4,includeOrdinary:true}));oldTimes.push(performance.now()-start);
    const next=[];start=performance.now();for(let i=0;i<16;i++)next.push(cloneSkeleton(glb));newTimes.push(performance.now()-start);
    if(pass===0){oldInstances=previous;newInstances=next;}
  }
  const oldMixers=oldInstances.map(root=>root.userData.rig.mixer),newMixers=newInstances.map(root=>new THREE.AnimationMixer(root));
  newMixers.forEach(m=>m.clipAction(imported.animations.find(c=>c.name==='Walk')).play());
  oldInstances.forEach(root=>{root.userData.rig.mixer.stopAllAction();root.userData.rig.actions.get('Walk').play();});
  const updateTimes=(mixers)=>{const times=[];for(let pass=0;pass<5;pass++){const start=performance.now();for(let frame=0;frame<240;frame++)for(const m of mixers)m.update(1/60);times.push(performance.now()-start);}return median(times);};
  const result={name,format:animation.format||'single-mesh',meshes:meshes(original).length,bones:rig.bones.length,
    dependencies:[...dependencies].filter(url=>!url.endsWith('catalog.json')).map(url=>new URL(url).pathname),sourceLoadMs,
    glbBytes:buffer.byteLength,glbParseMedianMs:median(parseTimes),parseTimes,
    sourceKeyValues:clips.reduce((n,c)=>n+c.tracks.reduce((v,t)=>v+t.times.length,0),0),optimizedKeyValues:optimizedClips.reduce((n,c)=>n+c.tracks.reduce((v,t)=>v+t.times.length,0),0),
    checks,colorError,variantChecks,instances:16,sourceCreateMedianMs:median(oldTimes),glbCloneMedianMs:median(newTimes),
    sourceGeometry:geometryBytes(oldInstances),glbGeometry:geometryBytes(newInstances),
    sourceMixer240FramesMs:updateTimes(oldMixers),glbMixer240FramesMs:updateTimes(newMixers),
    independentSkeletons:meshes(newInstances[0])[0].skeleton!==meshes(newInstances[1])[0].skeleton,
    sharedGeometry:meshes(newInstances[0])[0].geometry===meshes(newInstances[1])[0].geometry};
  const normalColors=new Map([...oldMaterials].map(([key,m])=>[key,{color:m.color.clone(),emissive:m.emissive?.clone()}]));
  samples.set(name,{original,glb,rig,clips,mixer,imported,variants:variants[name],oldMaterials,newMaterials,normalColors});
  return {report:result,glb:base64(buffer)};
}

export async function validateOptimized(name,url){
  const s=samples.get(name),buffer=await(await fetch(url)).arrayBuffer(),times=[];let parsed;
  for(let i=0;i<5;i++){const start=performance.now();const asset=await new GLTFLoader().parseAsync(buffer.slice(0),location.href);restorePhong(asset.scene);times.push(performance.now()-start);if(!i)parsed=asset;}
  const mixer=new THREE.AnimationMixer(parsed.scene),checks=[];
  for(const clip of s.clips){const target=parsed.animations.find(c=>c.name===clip.name);for(const fraction of [0,.17,.43,.79]){pose(s.original,s.rig.mixer,clip,clip.duration*fraction);pose(parsed.scene,mixer,target,clip.duration*fraction);checks.push({action:clip.name,fraction,...vertexError(s.original,parsed.scene)});}}
  const skinSet=new Set(meshes(parsed.scene).map(m=>m.skeleton));
  Object.assign(s,{glb:parsed.scene,mixer,imported:parsed,newMaterials:materials(parsed.scene)});
  const cloneTimes=[];let instances;
  for(let pass=0;pass<3;pass++){const list=[],start=performance.now();for(let i=0;i<16;i++)list.push(cloneAsset(parsed.scene));cloneTimes.push(performance.now()-start);if(!pass)instances=list;}
  const mixers=instances.map(root=>{const mixer=new THREE.AnimationMixer(root);mixer.clipAction(parsed.animations.find(c=>c.name==='Walk')).play();return mixer;}),updateTimes=[];
  for(let pass=0;pass<5;pass++){const start=performance.now();for(let frame=0;frame<240;frame++)for(const mixer of mixers)mixer.update(1/60);updateTimes.push(performance.now()-start);}
  return {parseMedianMs:median(times),parseTimes:times,maxVertexError:Math.max(...checks.map(c=>c.max)),checks,uniqueSkeletons:skinSet.size,
    clone16MedianMs:median(cloneTimes),mixer240FramesMs:median(updateTimes),instanceGeometry:geometryBytes(instances),
    skeletonsPerInstance:new Set(meshes(instances[0]).map(m=>m.skeleton)).size,
    independentSkeletons:meshes(instances[0])[0].skeleton!==meshes(instances[1])[0].skeleton,
    sharedGeometry:meshes(instances[0])[0].geometry===meshes(instances[1])[0].geometry};
}

let renderer;
export function render(name,variant='Normal',state='Walk',time=.3){
  const s=samples.get(name);if(!s)throw Error('Sample not built');
  renderer ||= new THREE.WebGLRenderer({antialias:true,preserveDrawingBuffer:true});renderer.setSize(1200,600);renderer.setPixelRatio(1);renderer.outputColorSpace=THREE.SRGBColorSpace;renderer.toneMapping=THREE.NoToneMapping;document.body.replaceChildren(renderer.domElement);
  const scene=new THREE.Scene();scene.background=new THREE.Color('#cbd5e1');scene.add(new THREE.HemisphereLight(0xffffff,0x556677,2.4));const light=new THREE.DirectionalLight(0xffffff,2.1);light.position.set(4,8,6);scene.add(light);
  const camera=new THREE.PerspectiveCamera(32,1,.1,100);camera.position.set(7,4,10);camera.lookAt(0,2,0);
  renderer.setScissorTest(true);
  for(const [index,root] of [s.original,s.glb].entries()){
    const mats=materials(root),normal=index?s.newMaterials:s.oldMaterials;
    for(const [key,material] of mats){const spec=s.variants?.[variant]?.[key];
      if(variant!=='Normal'&&spec){material.color.setRGB(...spec.color,THREE.SRGBColorSpace);if(material.emissive)material.emissive.set(spec.neon?material.color:0);}
      else{material.color.copy(s.normalColors.get(key).color);if(material.emissive&&s.normalColors.get(key).emissive)material.emissive.copy(s.normalColors.get(key).emissive);}
    }
    root.position.set(0,0,0);scene.add(root);
    const clip=(index?s.imported.animations:s.clips).find(c=>c.name===state);pose(root,index?s.mixer:s.rig.mixer,clip,time);
    renderer.setViewport(index*600,0,600,600);renderer.setScissor(index*600,0,600,600);renderer.render(scene,camera);scene.remove(root);
  }
  renderer.setScissorTest(false);return true;
}
