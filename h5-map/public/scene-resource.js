import * as THREE from 'three';
// 发布资源为Three场景JSON，纹理按资源自身位置解析；原始OBJ仍供本地追溯。
export async function loadSceneResource(url){
  const response=await fetch(url);if(!response.ok)throw Error(`模型资源 ${response.status}`);
  const data=await response.json(),group=new THREE.ObjectLoader().parse(data.scene),loader=new THREE.TextureLoader(),pending=[];
  group.traverse(o=>{if(!o.isMesh)return;for(const m of Array.isArray(o.material)?o.material:[o.material]){
    const spec=data.materials[m.name];if(!spec)continue;
    m.side=THREE.DoubleSide;m.color.setRGB(...spec.color,THREE.SRGBColorSpace);
    for(const [key,file] of Object.entries(spec.textures))pending.push(loader.loadAsync(new URL(file,url).href).then(t=>{if(key==='map'||key==='emissiveMap')t.colorSpace=THREE.SRGBColorSpace;t.wrapS=t.wrapT=THREE.RepeatWrapping;m[key]=t;if(key==='emissiveMap')m.emissive.copy(m.color);m.needsUpdate=true;}));
  }});
  await Promise.all(pending);return group;
}
