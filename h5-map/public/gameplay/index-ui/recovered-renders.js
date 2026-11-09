import * as THREE from 'three';
import {animalGlbTemplate} from '../animal-glb-runtime.js';

// The twelve unpublished source icon IDs are unavailable through public APIs.
// Use their recovered original models for these twelve UI images only.
export async function createRecoveredIndexRenders() {
  const base=new URL('../../model-check/',import.meta.url);
  const catalog=await (await fetch(new URL('animals/catalog.json',base))).json();
  const items=catalog.filter(a=>a.zone===10),result=new Map();
  const renderer=new THREE.WebGLRenderer({alpha:true,antialias:true,preserveDrawingBuffer:true});
  renderer.setSize(320,320);renderer.outputColorSpace=THREE.SRGBColorSpace;
  const scene=new THREE.Scene();scene.add(new THREE.HemisphereLight(0xffffff,0x737b8c,2.8));
  const sun=new THREE.DirectionalLight(0xffffff,2.2);sun.position.set(-4,8,-6);scene.add(sun);
  const camera=new THREE.PerspectiveCamera(30,1,.01,1000);
  try {
    for(const item of items){
      const root=await animalGlbTemplate(item.name);if(!root)throw Error('图鉴动物模型缺失 '+item.name);
      const box=new THREE.Box3().setFromObject(root),center=box.getCenter(new THREE.Vector3()),size=box.getSize(new THREE.Vector3());
      root.position.sub(center);const scale=1/Math.max(size.x,size.y,size.z);root.scale.setScalar(scale);root.position.multiplyScalar(scale);scene.add(root);
      camera.position.set(.7,.45,-1.2).normalize().multiplyScalar(2.1);camera.lookAt(0,0,0);renderer.render(scene,camera);
      result.set(item.name,renderer.domElement.toDataURL('image/png'));
      scene.remove(root); // Shared asset geometry stays owned by the animal cache.
    }
  } finally {renderer.dispose();}
  return result;
}
