import * as THREE from 'three';
import {createWeaponEffects} from '../model-check/weapon-effects.js';
import {inverseToolGrip} from './pickaxe-pose.js';

const base = new URL('../model-check/',import.meta.url);
export function weaponGripMatrix(item){
  return inverseToolGrip(item.grip);
}
async function json(url){const r=await fetch(url);if(!r.ok)throw Error(`武器资源加载失败: ${r.status}`);return r.json();}
export class WeaponAssets {
  constructor(){this.loader=new THREE.TextureLoader();this.textures=new Map();this.parts=new Map();}
  async init(){[this.catalog,this.effects]=await Promise.all([json(new URL('./weapons.json',import.meta.url)),json(new URL('weapons/effects/catalog.json',base))]);return this;}
  async create(tier){
    const item=this.catalog.find(x=>x.tier===tier);if(!item)throw Error('未知武器');
    if(!this.parts.has(tier))this.parts.set(tier,json(item.url).catch(e=>{this.parts.delete(tier);throw e;}));
    const root=new THREE.Group();root.name=item.originalName;
    try{
      for(const p of await this.parts.get(tier)){
        const s=p.material,g=new THREE.BufferGeometry();
        g.setAttribute('position',new THREE.Float32BufferAttribute(p.positions,3));
        g.setAttribute('normal',new THREE.Float32BufferAttribute(p.normals,3));
        g.setAttribute('uv',new THREE.Float32BufferAttribute(p.uvs,2));g.setIndex(p.indices);
        const m=new THREE.MeshPhongMaterial({side:THREE.DoubleSide,shininess:Math.min(s.shininess,90),opacity:s.opacity,transparent:s.opacity<1,specular:new THREE.Color(.12,.12,.12)});
        const mesh=new THREE.Mesh(g,m);mesh.name=p.name;root.add(mesh);
        m.color.setRGB(...(s.map?s.textureTint:s.color),THREE.SRGBColorSpace);
        for(const field of ['map','normalMap','emissiveMap','specularMap'])if(s[field]){
          const url=new URL(s[field],base).href,key=field+url;
          if(!this.textures.has(key))this.textures.set(key,this.loader.loadAsync(url).then(t=>{if(field==='map'||field==='emissiveMap')t.colorSpace=THREE.SRGBColorSpace;return t;}).catch(e=>{this.textures.delete(key);throw e;}));
          m[field]=await this.textures.get(key);
        }
        if(m.emissiveMap)m.emissive.setRGB(...s.emissive);
        if(s.neon){m.emissive.copy(m.color);m.emissiveIntensity=.8;}
        if(m.map&&!s.surfaceAppearance)m.alphaTest=.01;
      }
      const nodes=this.effects.find(x=>x.tier===tier)?.nodes||[];
      const effect=await createWeaponEffects(nodes.map(n=>({...n,texture:n.texture?new URL(n.texture,base).href:null})));
      root.add(effect.root);weaponGripMatrix(item).decompose(root.position,root.quaternion,root.scale);
      return {root,effect,dispose:()=>dispose(root)};
    }catch(e){dispose(root);throw e;}
  }
}
function dispose(root){root.traverse(o=>{if(o.isMesh){o.geometry.dispose();o.material.dispose();}});root.removeFromParent();}
