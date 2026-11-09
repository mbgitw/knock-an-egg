import * as THREE from 'three';
import {CONFIG} from './config.js';
import {createPickaxeEffects} from '../model-check/pickaxe-effects.js';

export class PickaxeAssets {
  constructor(){this.models=new Map();this.textures=new Map();this.loader=new THREE.TextureLoader();}
  async texture(url){if(!this.textures.has(url))this.textures.set(url,this.loader.loadAsync(url));return this.textures.get(url);}
  async create(tier,{effects=true}={}){
    const item=CONFIG.tiers[tier-1];
    if(!this.models.has(tier))this.models.set(tier,fetch(item.url).then(r=>{if(!r.ok)throw Error('镐子资源读取失败');return r.json();}));
    const parts=await this.models.get(tier),root=new THREE.Group();root.name=item.name;
    for(const p of parts){
      const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(p.positions,3));g.setIndex(p.indices);
      g.setAttribute('normal',new THREE.Float32BufferAttribute(p.normals,3));g.setAttribute('uv',new THREE.Float32BufferAttribute(p.uvs,2));
      const s=p.material,m=new THREE.MeshStandardMaterial({roughness:.8,side:THREE.DoubleSide});
      if(!s.map||s.neon)m.color.setRGB(...s.color.map(v=>Math.pow(v,1/2.2)),THREE.SRGBColorSpace);
      for(const k of ['map','normalMap','emissiveMap'])if(s[k]){const t=await this.texture(new URL(s[k],new URL('./model-check/',location.href)).href);if(k!=='normalMap')t.colorSpace=THREE.SRGBColorSpace;m[k]=t;}
      if(m.map)m.alphaTest=.01;if(m.emissiveMap)m.emissive.set(0xffffff);if(s.neon){m.emissive.copy(m.color);m.emissiveIntensity=1.2;}
      const mesh=new THREE.Mesh(g,m);mesh.applyMatrix4(new THREE.Matrix4().set(...p.matrix,0,0,0,1));root.add(mesh);
    }
    const bounds=new THREE.Box3().setFromObject(root);
    if(effects)this.effects ||= fetch('./model-check/pickaxes/effects/catalog.json').then(r=>r.json());
    const nodes=effects?(await this.effects).find(x=>x.tier===tier)?.nodes||[]:[];
    const effect=await createPickaxeEffects(nodes.map(n=>({...n,texture:n.texture?new URL(n.texture,new URL('./model-check/',location.href)).href:null})));
    root.add(effect.root);
    return {root,effect,bounds,dispose(){root.traverse(o=>{if(o.isMesh){o.geometry.dispose();o.material.dispose();}});root.removeFromParent();}};
  }
  async thumbnail(tier){
    const model=await this.create(tier,{effects:false});
    try{
      this.previewRenderer ||= new THREE.WebGLRenderer({alpha:true,antialias:true});
      const renderer=this.previewRenderer;renderer.setSize(192,192,false);renderer.setClearColor(0,0);
      const scene=new THREE.Scene();scene.add(new THREE.HemisphereLight(0xffffff,0x53677d,3));
      const light=new THREE.DirectionalLight(0xffffff,3);light.position.set(3,5,8);scene.add(light);
      const size=model.bounds.getSize(new THREE.Vector3()).length();model.root.position.copy(model.bounds.getCenter(new THREE.Vector3())).negate();scene.add(model.root);
      const camera=new THREE.PerspectiveCamera(32,1,.01,size*20);camera.position.set(size*.35,size*.12,-size*1.85);camera.lookAt(0,0,0);
      renderer.render(scene,camera);return renderer.domElement.toDataURL('image/png');
    }finally{model.dispose();}
  }
}
