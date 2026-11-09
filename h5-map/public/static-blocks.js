import * as THREE from 'three';
import {mergeGeometries,mergeVertices} from './vendor/BufferGeometryUtils.js';

// Batch immutable plot parts. Transparent top textures merge only within the
// same plane/material/tile, preserving ordering between different surfaces.
export function batchStaticBlocks(root){
  root.updateMatrixWorld(true);
  const inverse=root.matrixWorld.clone().invert(),batches=new Map();
  let beforeDraws=0,beforeVertices=0;
  root.traverse(o=>{if(!o.isMesh||o.isSkinnedMesh||Array.isArray(o.material)||!o.visible||(o.material.transparent&&!o.userData.plotTexture))return;
    const m=o.material,g=o.geometry;
    if(g.morphAttributes.position||g.attributes.skinIndex)return;
    const transform=inverse.clone().multiply(o.matrixWorld),center=new THREE.Vector3().setFromMatrixPosition(transform);
    let plane=null;if(o.userData.plotTexture){const normal=new THREE.Vector3().fromBufferAttribute(g.attributes.normal,0).applyNormalMatrix(new THREE.Matrix3().getNormalMatrix(transform)),point=new THREE.Vector3().fromBufferAttribute(g.attributes.position,0).applyMatrix4(transform);plane=[...normal.toArray(),normal.dot(point)].map(v=>Math.round(v*1e5)/1e5);}
    const key=JSON.stringify([Math.floor(center.x/64),Math.floor(center.z/64),m.type,m.color?.getHex(),m.map?.uuid,m.normalMap?.uuid,m.roughness,m.metalness,m.side,m.alphaTest,m.vertexColors,m.depthTest,m.depthWrite,m.transparent,m.opacity,m.forceSinglePass,plane,o.renderOrder]);
    if(!batches.has(key))batches.set(key,[]);batches.get(key).push({o,g,transform});beforeDraws++;beforeVertices+=g.attributes.position.count;
  });
  let afterDraws=beforeDraws,afterVertices=beforeVertices;
  for(const list of batches.values()){
    if(list.length<2)continue;
    const geometries=list.map(({g,transform})=>{const clone=g.index?g.toNonIndexed():g.clone();return clone.applyMatrix4(transform);});
    const combined=mergeGeometries(geometries);geometries.forEach(g=>g.dispose());if(!combined)continue;
    const welded=mergeVertices(combined,1e-6);combined.dispose();welded.computeBoundingBox();welded.computeBoundingSphere();
    const material=list[0].o.material.clone(),mesh=new THREE.Mesh(welded,material);mesh.name='Static plot block';mesh.renderOrder=list[0].o.renderOrder;
    mesh.userData.plotTexture=!!list[0].o.userData.plotTexture;
    // Reparent overlays before removing the source boxes; keep world placement.
    for(const {o,g} of list){for(const child of [...o.children]){const local=inverse.clone().multiply(child.matrixWorld);root.add(child);child.matrix.copy(local);child.matrixAutoUpdate=false;}o.removeFromParent();g.dispose();o.material.dispose();}
    root.add(mesh);afterDraws-=list.length-1;afterVertices+=welded.attributes.position.count-list.reduce((n,v)=>n+v.g.attributes.position.count,0);
  }
  freezeStaticMatrices(root);
  root.userData.blockStats={beforeDraws,afterDraws,beforeVertices,afterVertices};return root;
}

export function freezeStaticMatrices(root){
  root.updateMatrixWorld(true);root.traverse(o=>{if(o.matrixAutoUpdate)o.updateMatrix();o.matrixAutoUpdate=false;o.matrixWorldAutoUpdate=false;});
}

// Presentation roots have no gameplay bone consumers. Hidden rigs need neither
// bone matrix traversal nor renderer skeleton uploads; resume normally on view.
export function skipHiddenMatrices(root){
  const update=root.updateMatrixWorld;
  root.updateMatrixWorld=function(force){if(this.visible)update.call(this,force);};return root;
}

export class PresentationVisibility{
  constructor(){this.frustum=new THREE.Frustum();this.matrix=new THREE.Matrix4();this.sphere=new THREE.Sphere();}
  update(camera){camera.updateMatrixWorld();this.frustum.setFromProjectionMatrix(this.matrix.multiplyMatrices(camera.projectionMatrix,camera.matrixWorldInverse));}
  visible(position,radius){this.sphere.center.copy(position);this.sphere.center.y+=radius*.5;this.sphere.radius=radius;return this.frustum.intersectsSphere(this.sphere);}
}
