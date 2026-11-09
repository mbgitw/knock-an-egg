import * as THREE from 'three';
import {loadSceneResource} from '/public/scene-resource.js';
import {createPetModel as legacyCreate,disposePetModel as legacyDispose} from '/public/gameplay/pet-animation.js';
import {animalGlbTemplate} from '/build/builda-draft/gameplay/animal-glb-runtime.js';
import {createPetModel,disposePetModel,updatePetAnimation} from '/build/builda-draft/gameplay/pet-animation.js';
import {variantTemplate} from '/build/builda-draft/gameplay/animal-variants.js';
const base=new URL('/build/animal-glb-baseline/model-check/',location.href),selected=new Map();let catalog,manifest,renderer;
const read=async url=>{const response=await fetch(url);if(!response.ok)throw Error(`${url}: ${response.status}`);return response.json();};
const meshes=root=>{const list=[];root.traverse(o=>{if(o.isMesh)list.push(o);});return list;};
const materials=root=>new Map(meshes(root).flatMap(o=>(Array.isArray(o.material)?o.material:[o.material]).map(m=>[m.name,m])));
async function legacyTemplate(name){const entry=catalog.find(e=>e.name===name);const model=await loadSceneResource(new URL(entry.scene,base).href),bounds=new THREE.Box3().setFromObject(model),center=bounds.getCenter(new THREE.Vector3());model.position.set(-center.x,-bounds.min.y,-center.z);const root=new THREE.Group();root.add(model);root.scale.setScalar(2.8/bounds.getSize(new THREE.Vector3()).y);root.userData.facingYaw=entry.facingYaw||0;return root;}
function pose(root,state,time){const rig=root.userData.rig;rig.mixer.stopAllAction();rig.actions.get(state).reset().play();rig.mixer.setTime(time);root.updateMatrixWorld(true);for(const skeleton of rig.skeletons||[rig.skeleton])skeleton.update();}
function difference(a,b){const aa=meshes(a),bb=meshes(b);if(aa.length!==bb.length)throw Error('Mesh count mismatch');a.updateMatrixWorld(true);b.updateMatrixWorld(true);let max=0;const p=new THREE.Vector3(),q=new THREE.Vector3();
  for(let m=0;m<aa.length;m++){const count=aa[m].geometry.attributes.position.count;if(count!==bb[m].geometry.attributes.position.count)throw Error('Vertex count mismatch');for(let i=0;i<count;i++){aa[m].getVertexPosition(i,p).applyMatrix4(aa[m].matrixWorld);bb[m].getVertexPosition(i,q).applyMatrix4(bb[m].matrixWorld);max=Math.max(max,p.distanceTo(q));}}return max;}
function materialDifference(a,b){const aa=materials(a),bb=materials(b);let max=0;for(const [key,m] of aa){const n=bb.get(key);if(!n||m.type!==n.type)throw Error('Material type/name mismatch '+key);for(const property of ['color','emissive','specular'])if(m[property])max=Math.max(max,...m[property].toArray().map((v,i)=>Math.abs(v-n[property].toArray()[i])));if(m.opacity!==n.opacity||m.shininess!==n.shininess)throw Error('Material parameters mismatch');}return max;}
export async function prepare(){catalog=(await Promise.all(['animals','paid-animals'].map(folder=>read(new URL(folder+'/catalog.json',base))))).flat();manifest=await read('/build/builda-draft/gameplay/animal-glb/catalog.json');return Object.keys(manifest.entries);}
export async function validate(name){
  const oldTemplate=await legacyTemplate(name),template=await animalGlbTemplate(name),entry=manifest.entries[name];
  const staticError=difference(oldTemplate,template),source=await legacyCreate(oldTemplate,name,{height:4,includeOrdinary:true}),current=await createPetModel(template,name,{height:4,includeOrdinary:true});
  let animationError=0;for(const state of ['Idle','Walk']){
    const duration=source.userData.rig.actions.get(state).getClip().duration;if(Math.abs(duration-current.userData.rig.actions.get(state).getClip().duration)>1e-5)throw Error('Animation duration changed '+name+':'+state);
    for(const fraction of [0,.17,.43,.79,.99,1.01,2.17]){const time=duration*fraction;pose(source,state,time);pose(current,state,time);animationError=Math.max(animationError,difference(source,current));}
  }
  let colorError=materialDifference(source,current);
  const actor=new THREE.Group();actor.position.set(123,2,-45);actor.rotation.set(.1,.7,0);actor.scale.setScalar(1.6);actor.add(source,current);actor.updateMatrixWorld(true);
  pose(source,'Walk',.3);pose(current,'Walk',.3);const parentTransformError=difference(source,current);actor.remove(source,current);
  const normalColors=new Map([...materials(template)].map(([key,m])=>[key,m.color.clone()]));
  for(const variant of ['Gold','Diamond']){
    const oldVariant=await variantTemplate(oldTemplate,name,variant),newVariant=await variantTemplate(template,name,variant);
    const a=await legacyCreate(oldVariant,name,{height:4,includeOrdinary:true}),b=await createPetModel(newVariant,name,{height:4,includeOrdinary:true});
    colorError=Math.max(colorError,materialDifference(a,b));legacyDispose(a);disposePetModel(b);
  }
  for(const [key,m] of materials(template))if(!m.color.equals(normalColors.get(key)))throw Error('Variant mutated Normal');
  const presentation=await createPetModel(template,name),ordinaryStaticPreserved=entry.ordinary?!presentation.userData.rig:!!presentation.userData.rig;disposePetModel(presentation);
  const twin=await createPetModel(template,name,{height:4,includeOrdinary:true});
  const geometryShared=current.userData.rig.meshes[0].geometry===twin.userData.rig.meshes[0].geometry,skeletonIndependent=current.userData.rig.skeleton!==twin.userData.rig.skeleton;
  let geometryDisposals=0;const onDispose=()=>geometryDisposals++;for(const mesh of current.userData.rig.meshes)mesh.geometry.addEventListener('dispose',onDispose);
  disposePetModel(current);updatePetAnimation(twin,.2,'Walk');if(twin.userData.rig.actions.get('Walk').time<=0)throw Error('Live twin stopped after disposal');
  for(const mesh of twin.userData.rig.meshes)mesh.geometry.removeEventListener('dispose',onDispose);
  legacyDispose(source);disposePetModel(twin);
  const result={name,staticError,animationError,parentTransformError,colorError,animationPoseSamples:14,ordinaryStaticPreserved,geometryShared,skeletonIndependent,geometryDisposals};
  if(staticError>1e-3||animationError>1e-3||parentTransformError>1e-3||colorError>1e-5||!ordinaryStaticPreserved||!geometryShared||!skeletonIndependent||geometryDisposals)throw Error(JSON.stringify(result));
  if(['Chicken','CrystalDragon','CelestialBeast','AngelHydra'].includes(name))selected.set(name,{oldTemplate,template});
  return result;
}
export async function render(name,variant='Normal',animated=true){
  const sample=selected.get(name);renderer ||= new THREE.WebGLRenderer({antialias:true,preserveDrawingBuffer:true});renderer.setSize(1200,600);renderer.setPixelRatio(1);document.body.replaceChildren(renderer.domElement);
  const a=await variantTemplate(sample.oldTemplate,name,variant),b=await variantTemplate(sample.template,name,variant);
  const roots=animated?[await legacyCreate(a,name,{height:4,includeOrdinary:true}),await createPetModel(b,name,{height:4,includeOrdinary:true})]:[a,b];
  const scene=new THREE.Scene();scene.background=new THREE.Color('#cbd5e1');scene.add(new THREE.HemisphereLight(0xffffff,0x556677,2.4));const sun=new THREE.DirectionalLight(0xffffff,2.1);sun.position.set(4,8,6);scene.add(sun);
  const camera=new THREE.PerspectiveCamera(32,1,.1,100);camera.position.set(7,4,10);camera.lookAt(0,2,0);renderer.setScissorTest(true);
  for(const [index,root] of roots.entries()){if(animated)pose(root,'Walk',.3);scene.add(root);renderer.setViewport(index*600,0,600,600);renderer.setScissor(index*600,0,600,600);renderer.render(scene,camera);scene.remove(root);}
  renderer.setScissorTest(false);if(animated){legacyDispose(roots[0]);disposePetModel(roots[1]);}return true;
}

export async function benchmark(name){
  const {oldTemplate,template}=selected.get(name),median=list=>[...list].sort((a,b)=>a-b)[Math.floor(list.length/2)];
  const measureGeometry=roots=>{const seen=new Set();let bytes=0;for(const root of roots)for(const mesh of root.userData.rig.meshes||[root.userData.rig.mesh])if(!seen.has(mesh.geometry)){seen.add(mesh.geometry);bytes+=Object.values(mesh.geometry.attributes).reduce((n,a)=>n+a.array.byteLength,0)+(mesh.geometry.index?.array.byteLength||0);}return bytes;};
  const results={name,instances:16};
  for(const [label,create,model,dispose] of [['legacy',legacyCreate,oldTemplate,legacyDispose],['compiled',createPetModel,template,disposePetModel]]){
    const createTimes=[],mixerTimes=[];let geometryBytes;
    for(let pass=0;pass<3;pass++){
      const roots=[],start=performance.now();for(let i=0;i<16;i++)roots.push(await create(model,name,{height:4,includeOrdinary:true}));createTimes.push(performance.now()-start);geometryBytes=measureGeometry(roots);
      for(const root of roots){root.userData.rig.mixer.stopAllAction();root.userData.rig.actions.get('Walk').play();}
      const time=performance.now();for(let frame=0;frame<240;frame++)for(const root of roots)root.userData.rig.mixer.update(1/60);mixerTimes.push(performance.now()-time);
      for(const root of roots)dispose(root);
    }
    results[label]={create16MedianMs:median(createTimes),geometryBytes,mixer240FramesMedianMs:median(mixerTimes)};
  }return results;
}
