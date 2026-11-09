import * as THREE from 'three';
import {applyModelStuds} from './v2-model-studs.js';

// Same record/material path as v2 source-atlas.ts build(..., null, true).
const textures=new Map();
async function texture(file,base,color){
  if(!file)return null;
  const url=new URL(file,base).href,key=url+':'+color;
  if(!textures.has(key))textures.set(key,new THREE.TextureLoader().loadAsync(url).then(t=>{if(color)t.colorSpace=THREE.SRGBColorSpace;return t;}).catch(e=>{textures.delete(key);throw e;}));
  return textures.get(key);
}
export async function loadV2LiveEgg(entry,base){
  const response=await fetch(new URL(entry.url,base));if(!response.ok)throw Error(`v2实际蛋资源 ${entry.petId}: ${response.status}`);
  const records=await response.json(),root=new THREE.Group(),parser=new THREE.BufferGeometryLoader(),textureBase=new URL(entry.textureBase,base);
  for(const item of records){
    const specs=Array.isArray(item.material)?item.material:[item.material];
    const materials=await Promise.all(specs.map(async spec=>{
      const [map,normalMap]=await Promise.all([texture(spec.map,textureBase,true),texture(spec.normalMap,textureBase,false)]);
      return new THREE.MeshStandardMaterial({color:new THREE.Color(...spec.color),vertexColors:!!item.geometry.data.attributes.color,map,normalMap,opacity:spec.opacity??1,transparent:(spec.opacity??1)<1,roughness:.8,side:THREE.DoubleSide});
    }));
    const geometry=parser.parse(item.geometry);
    // Port v2 prepareEggSurface for its close, coplanar Tiger stripe shell.
    if(item.part==='node_893ED7B91B354ADAB2D169F0EAF8F78C'){
      const p=geometry.getAttribute('position'),n=geometry.getAttribute('normal');
      if(p&&n){for(let i=0;i<p.count;i++)p.setXYZ(i,p.getX(i)+n.getX(i)*.015,p.getY(i)+n.getY(i)*.015,p.getZ(i)+n.getZ(i)*.015);p.needsUpdate=true;}
    }
    const mesh=new THREE.Mesh(geometry,Array.isArray(item.material)?materials:materials[0]);mesh.name=item.part;mesh.castShadow=true;mesh.receiveShadow=true;root.add(mesh);
  }
  applyModelStuds(root);return root;
}
