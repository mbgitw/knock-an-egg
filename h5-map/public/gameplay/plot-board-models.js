import * as THREE from 'three';
import {buildCollisionWorld} from '../world-physics.js';
import {freezeStaticMatrices} from '../static-blocks.js';

// The OBJ/map export contains physical signs only for Base_3. The source board
// and post are ordinary boxes; replicate those exact parts for all seven bases.
export function createMissingPlotBoards(sourceParts,bases){
  const originals=sourceParts.filter(p=>/^\/Workspace\/Plots\/Base_3\/(UpgradeBoard|TreadmillBoard)\//.test(p.path));
  const root=new THREE.Group();root.name='Pasture sign models';const parts=[];
  const geometry=new THREE.BoxGeometry(1,1,1),materials=new Map();
  for(const base of bases){const transform=new THREE.Matrix4().set(...base.transform);
    for(const original of originals){
      const source=new THREE.Matrix4().set(...original.matrix,0,0,0,1),matrix=transform.clone().multiply(source);
      const part={...original,path:original.path.replace('/Base_3/',`/${base.id}/`),matrix:Array.from({length:12},(_,i)=>matrix.elements[(i%4)*4+Math.floor(i/4)])};parts.push(part);
      if(original.transparency>=1)continue;
      if(!materials.has(original.color)){const color=new THREE.Color().setRGB(...[(original.color>>16)&255,(original.color>>8)&255,original.color&255].map(v=>(v/255)**2.2));materials.set(original.color,new THREE.MeshStandardMaterial({color,roughness:.9}));}
      const mesh=new THREE.Mesh(geometry,materials.get(original.color));mesh.name=part.path;mesh.userData.baseId=base.id;mesh.matrixAutoUpdate=false;mesh.matrix.copy(matrix).multiply(new THREE.Matrix4().makeScale(...part.size));root.add(mesh);
    }
  }
  freezeStaticMatrices(root);
  let world=buildCollisionWorld([]),signature='';
  const collision={capsuleIntersect:c=>world.capsuleIntersect(c),rayIntersect:r=>world.rayIntersect(r),cameraRayIntersect:r=>world.cameraRayIntersect(r)};
  const setOwner=baseId=>{
    const occupied=new Set(bases.some(b=>b.id===baseId)?[baseId]:[]),next=baseId||'';if(next===signature)return;signature=next;
    for(const mesh of root.children)mesh.visible=occupied.has(mesh.userData.baseId);
    world=buildCollisionWorld(parts.filter(p=>occupied.has(p.path.split('/')[3])),null,.001);
  };
  for(const mesh of root.children)mesh.visible=false;
  return {root,parts,collision,setOwner};
}
