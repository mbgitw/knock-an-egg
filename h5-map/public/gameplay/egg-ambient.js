import * as THREE from 'three';
import {createWeaponEffects} from '../model-check/weapon-effects.js';
let catalog;
export function eggAmbientCatalog(){return catalog??=fetch(new URL('./eggs/ambient/catalog.json',import.meta.url)).then(r=>{if(!r.ok)throw Error('蛋常驻特效 '+r.status);return r.json();}).then(d=>new Map(d.models.map(m=>[m.id,m])));}
const scaledRange=(v,s)=>String(v||'0 0').trim().split(/\s+/).map(x=>Number(x)*s).join(' ');
const scaledCurve=(v,s)=>String(v||'').trim().split(/\s+/).map((x,i)=>Number(x)*(i%3?s:1)).join(' ');
// Missing private texture IDs use a declared original sprite substitute, never an empty emitter.
const fallback={
 '110262636049753':'17391818367','10352554571':'12656879896','15811794808':'12656879896',
 '16771418430':'12656879896','6475162564':'108199419086235','12386383371':'12656879896',
 '284205403':'9997556038','89284632673030':'17391818367','135149314975230':'17391818367',
 '15409825193':'17391818367','71933679055307':'12656879896','17086409913':'12656879896',
};
export async function createEggAmbient(data,{pointLights=true}={}){
 const scale=1/data.bodyHeight;
 const nodes=data.nodes.filter(n=>n.class==='ParticleEmitter').map(n=>{
  const p=JSON.parse(JSON.stringify(n.properties)),id=n.texture? n.textureId:fallback[n.textureId];
  if(!id)throw Error('缺少蛋粒子贴图 '+n.textureId);
  if(!n.texture){
   p.FlipbookLayout=id==='12656879896'?'4':'0';p.FlipbookSizeX=p.FlipbookSizeY=id==='12656879896'?'8':'1';
   if(id==='12656879896')p.FlipbookFramerate='20 20';
  }
  p.Size=scaledCurve(p.Size,scale);p.Speed=scaledRange(p.Speed,scale);
  if(p.Acceleration)p.Acceleration=Object.fromEntries(Object.entries(p.Acceleration).map(([k,v])=>[k,String(Number(v)*scale)]));
  return {...n,properties:p,texture:new URL('./eggs/ambient/textures/'+id+'.png',import.meta.url).href};
 });
 const fx=await createWeaponEffects(nodes);fx.root.name='原蛋常驻特效';const lights=[];
 for(const n of data.nodes.filter(n=>pointLights&&n.class==='PointLight'&&n.properties.Enabled==='true')){
  const p=n.properties,c=p.Color;const light=new THREE.PointLight(new THREE.Color(Number(c.R),Number(c.G),Number(c.B)),Number(p.Brightness),Number(p.Range)*scale,2);
  light.position.set(n.matrix[3],n.matrix[7],n.matrix[11]);fx.root.add(light);lights.push({light,range:Number(p.Range)*scale});
 }
 const update=fx.update,worldScale=new THREE.Vector3();
 fx.update=(dt,camera)=>{update(dt,camera);fx.root.getWorldScale(worldScale);for(const {light,range}of lights)light.distance=range*Math.max(worldScale.x,worldScale.y,worldScale.z);};
 return fx;
}
