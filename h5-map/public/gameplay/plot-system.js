import {assignDataset} from '../dom-diff.js';
import * as THREE from 'three';
import {batchStaticBlocks} from '../static-blocks.js';
import {TreadmillSign} from '../treadmill-sign.js';
import {formatNumber} from '../treadmill-state.js';
import {PlotProgress} from './plot-state.js';

export const OWN_BUILD='/Workspace/Plots/Base_3/Build/';
export const isPlotBuild=path=>/^\/Workspace\/Plots\/[^/]+\/Build\//.test(path);
const url=name=>new URL(`./plot-upgrades/${name}`,import.meta.url).href;
const load=async name=>{const r=await fetch(url(name));if(!r.ok)throw Error('基地资源加载失败');return r.json();};

// Keep the source's per-face texture density when changing an authored box size.
export function tierUV(spec,sourceSize,size){
  const uv=spec.uv.slice();
  for(let start=0;start<spec.position.length/3;start+=3){
    const axes=[null,null];
    for(const [a,b] of [[start,start+1],[start,start+2],[start+1,start+2]])for(let u=0;u<2;u++){
      if(Math.abs(uv[a*2+u]-uv[b*2+u])<1e-6||Math.abs(uv[a*2+1-u]-uv[b*2+1-u])>1e-6)continue;
      const delta=[0,1,2].map(i=>Math.abs(spec.position[a*3+i]-spec.position[b*3+i]));
      axes[u]=delta.indexOf(Math.max(...delta));
    }
    for(let i=start;i<start+3;i++)for(let u=0;u<2;u++)if(axes[u]!==null)uv[i*2+u]*=size[axes[u]]/sourceSize[axes[u]];
  }
  return uv;
}

export function initialPlotParts(data){
  return data.bases.filter(b=>b.id!==data.baseId).flatMap(base=>data.tiers[0].parts.map(p=>{
    const matrix=new THREE.Matrix4().set(...base.transform).multiply(new THREE.Matrix4().set(...p.matrix));
    return {...p,path:p.path.replace(/^\/[^/]+\/[^/]+\/[^/]+/,`/Workspace/Plots/${base.id}`),matrix:Array.from({length:16},(_,i)=>matrix.elements[(i%4)*4+Math.floor(i/4)])};
  }));
}
export function createPlotModel(data,geometry,level,materials,base=null){
  const tier=data.tiers[level-1],root=new THREE.Group();root.name=`${base?.id||data.baseId}-Build-Lv${level}`;
  if(base){root.matrixAutoUpdate=false;root.matrix.set(...base.transform);}
  const byPart=new Map(tier.parts.map(p=>[p.geometryPart,p]));
  const parents=new Map();
  geometry.meshes.forEach((spec,i)=>{
    const p=byPart.get(spec.part),g=new THREE.BufferGeometry();
    g.setAttribute('position',new THREE.Float32BufferAttribute(spec.position,3));
    g.setAttribute('normal',new THREE.Float32BufferAttribute(spec.normal,3));
    g.setAttribute('uv',new THREE.Float32BufferAttribute(tierUV(spec,data.sourceParts[spec.part].size,p.size),2));
    // Authored tiers change wood/stone/gold/white colors as well as dimensions.
    const material=materials[i].clone();
    // Studio's OBJ exporter linearizes Color3uint8 using gamma 2.2.
    material.color.setRGB(...[(p.color>>16)&255,(p.color>>8)&255,p.color&255].map(c=>(c/255)**2.2));
    const mesh=new THREE.Mesh(g,material);mesh.name=p.path;mesh.visible=p.transparency<1;
    mesh.matrixAutoUpdate=false;mesh.matrix.set(...p.matrix).multiply(new THREE.Matrix4().makeScale(...p.size));root.add(mesh);
    parents.set(spec.part,mesh);
  });
  // Texture faces belong to the current tier's boxes, rather than the captured
  // map. Their UV density follows the new size and their white tint is retained.
  (geometry.overlays||[]).forEach((spec,i)=>{
    const p=byPart.get(spec.part),g=new THREE.BufferGeometry();
    g.setAttribute('position',new THREE.Float32BufferAttribute(spec.position,3));
    g.setAttribute('normal',new THREE.Float32BufferAttribute(spec.normal,3));
    g.setAttribute('uv',new THREE.Float32BufferAttribute(tierUV(spec,data.sourceParts[spec.part].size,p.size),2));
    const material=materials[geometry.meshes.length+i].clone();material.depthWrite=false;
    // These are flat texture faces: a separate back-face pass submits an empty
    // draw for one side. Keep DoubleSide shading in a single pass instead.
    material.forceSinglePass=true;
    const mesh=new THREE.Mesh(g,material);mesh.name='Authored top Texture';mesh.userData.plotTexture=true;
    parents.get(spec.part).add(mesh);
  });
  root.updateMatrixWorld(true);
  root.userData={level,capacity:level+7,hitbox:tier.hitbox};return root;
}
const disposeModel=root=>{root.removeFromParent();root.traverse(o=>{o.geometry?.dispose();o.material?.dispose();});};

export class PlotSystem {
  static async create(scene,player,camera,canvas,account,{prepareCollision,commitCollision,onPurchase=()=>{}}){
    const [data,geometry]=await Promise.all([load('tiers.json'),load('geometry.json')]);
    if(account.online&&account.data.baseId!==data.baseId){
      const transform=new THREE.Matrix4().set(...data.bases.find(b=>b.id===account.data.baseId).transform),inverse=transform.clone().invert();
      const rows=m=>Array.from({length:16},(_,i)=>m.elements[(i%4)*4+Math.floor(i/4)]);
      for(const tier of data.tiers){for(const p of tier.parts)p.matrix=rows(transform.clone().multiply(new THREE.Matrix4().set(...p.matrix)));tier.hitbox.matrix=rows(transform.clone().multiply(new THREE.Matrix4().set(...tier.hitbox.matrix)));}
      data.board.matrix=rows(transform.clone().multiply(new THREE.Matrix4().set(...data.board.matrix)));
      for(const b of data.bases)b.transform=rows(new THREE.Matrix4().set(...b.transform).multiply(inverse));
      data.baseId=account.data.baseId;
    }
    const textures=new Map(),loader=new THREE.TextureLoader();
    for(const name of geometry.report.textures){const t=await loader.loadAsync(url(name));t.colorSpace=THREE.SRGBColorSpace;t.wrapS=t.wrapT=THREE.RepeatWrapping;textures.set(name,t);}
    const materials=[...geometry.meshes,...(geometry.overlays||[])].map(s=>new THREE.MeshStandardMaterial({color:new THREE.Color().setRGB(...s.material.color),map:textures.get(s.material.texture)||null,roughness:.9,side:THREE.DoubleSide,transparent:s.material.opacity<1,opacity:s.material.opacity}));
    return new PlotSystem({scene,player,camera,canvas,account,data,geometry,materials,textures,prepareCollision,commitCollision,onPurchase});
  }
  constructor(options){
    Object.assign(this,options);this.progress=new PlotProgress(this.account);this.cooldown=0;this.busy=false;
    this.assets={anchors:{boardMatrix:this.data.board.matrix}};
    this.boardPosition=new THREE.Vector3().setFromMatrixPosition(new THREE.Matrix4().set(...this.data.board.matrix));
    this.boardInverse=new THREE.Matrix4().set(...this.data.board.matrix).invert();
    this.otherParts=initialPlotParts(this.data);
    this.otherRoots=this.data.bases.filter(b=>b.id!==this.data.baseId).map(base=>batchStaticBlocks(createPlotModel(this.data,this.geometry,1,this.materials,base)));
    this.scene.add(...this.otherRoots);
    this.root=this.makeModel(this.progress.level);const world=this.prepareCollision([...this.otherParts,...this.tier.parts]);
    this.scene.add(this.root);this.commitCollision(world);
    this.account.save();
    this.sign=new TreadmillSign(this,'PlotUpgradeBoard-UI');this.update(0);
  }
  get tier(){return this.data.tiers[this.progress.level-1];}
  get capacity(){return this.progress.capacity;}
  contains(position){const h=this.tier.hitbox,p=position.clone().applyMatrix4(new THREE.Matrix4().set(...h.matrix).invert());return Math.abs(p.x)<=h.size[0]/2&&Math.abs(p.y)<=h.size[1]/2&&Math.abs(p.z)<=h.size[2]/2;}
  makeModel(level){return batchStaticBlocks(createPlotModel(this.data,this.geometry,level,this.materials));}
  applyNetwork(players){
    const levels=Object.fromEntries(players.map(p=>[`Base_${p.slot+1}`,p.plot]));levels[this.data.baseId]=this.progress.level;
    const signature=JSON.stringify(levels);if(signature===this.networkSignature)return;this.networkSignature=signature;
    disposeModel(this.root);for(const root of this.otherRoots)disposeModel(root);
    this.root=this.makeModel(this.progress.level);this.scene.add(this.root);this.otherRoots=[];this.otherParts=[];
    for(const base of this.data.bases)if(base.id!==this.data.baseId){
      const level=levels[base.id]||1,root=batchStaticBlocks(createPlotModel(this.data,this.geometry,level,this.materials,base));this.otherRoots.push(root);this.scene.add(root);
      for(const p of this.data.tiers[level-1].parts){const matrix=new THREE.Matrix4().set(...base.transform).multiply(new THREE.Matrix4().set(...p.matrix));this.otherParts.push({...p,matrix:Array.from({length:16},(_,i)=>matrix.elements[(i%4)*4+Math.floor(i/4)])});}
    }
    this.commitCollision(this.prepareCollision([...this.otherParts,...this.tier.parts]));
  }
  boardReachable(){
    if(this.player.motor.position.distanceTo(this.boardPosition)>19)return false;
    const from=this.player.motor.position.clone().add(new THREE.Vector3(0,3,0));
    const delta=this.boardPosition.clone().sub(from),distance=delta.length();
    const hit=this.player.world.rayIntersect(new THREE.Ray(from,delta.normalize()));
    if(!hit||hit.distance>=distance-.6)return true;
    const local=hit.position.clone().applyMatrix4(this.boardInverse);
    return Math.abs(local.x)<=.55&&Math.abs(local.y)<=2.55&&Math.abs(local.z)<=4.55;
  }
  purchase({fromInventory=false}={}){
    if(this.busy||this.cooldown>0||(this.player.inputLocked&&!fromInventory)||this.account.session||document.hidden||(!fromInventory&&!this.boardReachable())||!this.progress.affordable)return false;
    this.busy=true;this.update(0);let next;
    try{
      const level=this.progress.level;
      next=this.makeModel(level+1);
      // Prepare both render and collision before touching the shared balance.
      const world=this.prepareCollision([...this.otherParts,...this.data.tiers[level].parts]);
      if((!fromInventory&&!this.boardReachable())||!this.progress.upgrade(level)){disposeModel(next);return false;}
      disposeModel(this.root);this.root=next;this.scene.add(next);this.commitCollision(world);
      this.cooldown=.35;this.onPurchase();return true;
    }catch(error){if(next&&next!==this.root)disposeModel(next);console.error(error);return false;}
    finally{this.busy=false;this.update(0);}
  }
  update(dt){
    this.cooldown=Math.max(0,this.cooldown-dt);const p=this.progress,cost=p.cost;
    this.sign?.update({title:'升级基地围栏',levelText:cost===null?`等级 ${p.level} · MAX`:`等级 ${p.level} → ${p.level+1}`,detailText:cost===null?`动物容量 ${p.capacity}`:`动物容量 ${p.capacity} → ${p.capacity+1}`,priceText:this.busy?'加载中…':cost===null?'MAX':`$${formatNumber(cost)}`,hasNextLevel:cost!==null,affordable:!this.busy&&!this.account.session&&p.affordable});
    assignDataset(this.canvas,{plotLevel:String(p.level),plotCapacity:String(p.capacity),plotLevels:JSON.stringify(Object.fromEntries(this.data.bases.map(b=>[b.id,b.id===this.data.baseId?p.level:1])))});
  }
  dispose(){this.sign.dispose();disposeModel(this.root);for(const root of this.otherRoots)disposeModel(root);for(const m of this.materials)m.dispose();for(const t of this.textures.values())t.dispose();}
}
