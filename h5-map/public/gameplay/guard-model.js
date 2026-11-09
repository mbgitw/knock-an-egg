import * as THREE from 'three';
import {buildAnimalClip} from '../model-check/animal-animation-player.js';

const base='gameplay/guards/';
const textures=new Map();
function texture(file, color=false){
  if(!file)return null;
  if(!textures.has(file)){
    const t=new THREE.TextureLoader().load(base+file);
    if(color)t.colorSpace=THREE.SRGBColorSpace;
    t.wrapS=t.wrapT=THREE.RepeatWrapping;
    textures.set(file,t);
  }
  return textures.get(file);
}
export function guardMaterial(data, loadTextures=true){
  return new THREE.MeshStandardMaterial({color:new THREE.Color().setRGB(...data.color),
    map:loadTextures?texture(data.texture,true):null,normalMap:loadTextures?texture(data.normal):null,
    roughness:.9,metalness:0,side:THREE.DoubleSide,transparent:data.opacity<1,
    opacity:data.opacity,depthWrite:data.opacity>=1,alphaTest:.01});
}
function geometry(data){
  const g=new THREE.BufferGeometry();
  for(const [a,k,n,T] of [['position','positions',3,Float32Array],['normal','normals',3,Float32Array],['uv','uvs',2,Float32Array],['skinIndex','skinIndices',4,Uint16Array],['skinWeight','skinWeights',4,Float32Array]])
    g.setAttribute(a,new THREE.BufferAttribute(new T(data[k]),n));
  g.setIndex(data.indices);return g;
}

// Each source MeshPart keeps its own bind frame; multipart rigs must not be
// independently centered. Repeated bone names bind to their UUIDs in the clip.
export function buildGuardModel(data,{loadTextures=true}={}){
  const root=new THREE.Group(),bones=[],meshes=[],skeletons=[];
  root.name=data.name;
  for(const part of data.parts){
    const group=new THREE.Group();group.matrix.fromArray(part.matrix).transpose();
    group.matrix.decompose(group.position,group.quaternion,group.scale);root.add(group);
    const mesh=new THREE.SkinnedMesh(geometry(part.rig),guardMaterial(part.material,loadTextures));
    mesh.name=part.name;mesh.position.fromArray(part.rig.offset);mesh.scale.fromArray(part.rig.scale);
    mesh.frustumCulled=false;group.add(mesh);meshes.push(mesh);
    const local=part.rig.bones.map(b=>{
      const bone=new THREE.Bone();bone.name=b.name;bone.position.fromArray(b.position);
      bone.quaternion.fromArray(b.quaternion).normalize();
      bone.userData.restPosition=bone.position.clone();bone.userData.restQuaternion=bone.quaternion.clone();return bone;
    });
    part.rig.bones.forEach((b,i)=>(b.parent<0?mesh:local[b.parent]).add(local[i]));
    root.updateMatrixWorld(true);
    const skeleton=new THREE.Skeleton(local);mesh.bind(skeleton);skeletons.push(skeleton);bones.push(...local);
    for(const overlay of part.overlays){
      const surface=new THREE.SkinnedMesh(geometry(overlay),guardMaterial(overlay.material,loadTextures));
      surface.position.copy(mesh.position);surface.scale.copy(mesh.scale);surface.frustumCulled=false;
      group.add(surface);root.updateMatrixWorld(true);surface.bind(skeleton,mesh.bindMatrix);meshes.push(surface);
    }
  }
  const mixer=new THREE.AnimationMixer(root),actions=new Map();
  let current=null;
  return {root,bones,meshes,skeletons,mixer,actions,
    addAction(name,source){actions.set(name,mixer.clipAction(buildAnimalClip(source,{bones})));},
    play(name,rate=1){
      const next=actions.get(name)||actions.get('Idle');if(!next)return;
      if(current!==next){
        next.reset().setLoop(name==='Attack'?THREE.LoopOnce:THREE.LoopRepeat,name==='Attack'?1:Infinity);
        next.clampWhenFinished=name==='Attack';next.setEffectiveWeight(1).play();
        current?.fadeOut(.12);next.fadeIn(.12);current=next;
      }
      next.timeScale=Math.max(.01,rate);
    },
    update(dt){mixer.update(dt);},
    dispose(){mixer.stopAllAction();mixer.uncacheRoot(root);meshes.forEach(m=>{m.geometry.dispose();m.material.dispose();});skeletons.forEach(s=>s.dispose());root.removeFromParent();},
  };
}
