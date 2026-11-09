import * as THREE from 'three';
import {OrbitControls} from '../vendor/OrbitControls.js';
import {createBoothModel,createBoothSign,createBoothRoof,boothCollisionParts,partMatrix} from '../gameplay/shop-booth.js';
import {createTrailBooth,createTrailSign,createTrailRoof,trailBoothCollisionParts} from '../gameplay/trail-booth.js';
const trailShop=location.hash.split('/')[1]==='trails',shopName=trailShop?'拖尾商店':'镐子商店';
const canvas=document.querySelector('canvas'),renderer=new THREE.WebGLRenderer({canvas,antialias:true});renderer.setPixelRatio(Math.min(devicePixelRatio,2));
const scene=new THREE.Scene();scene.background=new THREE.Color('#151e2b');
scene.add(new THREE.HemisphereLight(0xffffff,0x8796a5,2));const light=new THREE.DirectionalLight(0xffffff,2.3);light.position.set(12,22,8);scene.add(light);
const camera=new THREE.PerspectiveCamera(45,1,.1,250),controls=new OrbitControls(camera,canvas);controls.enableDamping=true;
const data=await (await fetch(trailShop?'../gameplay/trails/booth/model.json':'../gameplay/shop-booth/model.json')).json();
const model=(trailShop?createTrailBooth:createBoothModel)(data,{includeExisting:true});model.add(await (trailShop?createTrailSign:createBoothSign)(data));
const center=new THREE.Vector3(...(trailShop?[-66,.5,-59]:[-68,.5,65]));model.position.sub(center);scene.add(model);
const collision=new THREE.Group();collision.visible=false;model.add(collision);
const roofCollision=(trailShop?createTrailRoof:createBoothRoof)(data.parts);roofCollision.traverse(o=>{if(o.isMesh)o.material=new THREE.MeshBasicMaterial({color:0xffa64d,wireframe:true});});collision.add(roofCollision);
for(const p of (trailShop?trailBoothCollisionParts:boothCollisionParts)(data.parts)){
 const mesh=new THREE.Mesh(new THREE.BoxGeometry(...p.size),new THREE.MeshBasicMaterial({color:0xffa64d,wireframe:true}));mesh.applyMatrix4(partMatrix(p));collision.add(mesh);
}
const zone=data.parts.find(p=>p.name==='HitZone'),wireZone=new THREE.Mesh(new THREE.BoxGeometry(...zone.size),new THREE.MeshBasicMaterial({color:0x46ffda,wireframe:true}));wireZone.applyMatrix4(partMatrix(zone));collision.add(wireZone);
scene.add(new THREE.GridHelper(50,50,0x45617b,0x283b50));
function fit(){camera.position.set(24,18,27);controls.target.set(0,5,0);controls.update();}
fit();let wire=false;
document.querySelector('#list').innerHTML=['镐子商店','拖尾商店'].map((name,i)=>`<button class="${i===Number(trailShop)?'active':''}" data-shop="${i?'trails':'pickaxes'}">${name}<small>22 原部件 · 棚布/光圈重建</small></button>`).join('');document.querySelectorAll('[data-shop]').forEach(b=>b.onclick=()=>{location.hash='shops/'+b.dataset.shop;location.reload();});
document.querySelector('#all').textContent=shopName;document.querySelector('#all').onclick=fit;document.querySelector('#reset').onclick=fit;
document.querySelector('#spin').onclick=e=>{controls.autoRotate=!controls.autoRotate;e.target.textContent='自动旋转：'+(controls.autoRotate?'开':'关');};
document.querySelector('#wire').onclick=e=>{wire=!wire;for(const child of model.children)if(child!==collision)child.traverse(o=>{if(o.isMesh)o.material.wireframe=wire;});e.target.textContent='线框：'+(wire?'开':'关');};
const button=document.createElement('button');button.id='shop-collision-toggle';button.textContent='碰撞 / 触发区：关';button.onclick=()=>{collision.visible=!collision.visible;button.textContent='碰撞 / 触发区：'+(collision.visible?'开':'关');};document.querySelector('.toolbar').append(button);
document.querySelector('#background').onchange=e=>scene.background.set(e.target.value==='light'?'#dce5ee':'#151e2b');
document.querySelector('#count').textContent=trailShop?'2 / 2':'1 / 2';
document.querySelector('#info').innerHTML='<h3>设施 / '+shopName+'</h3><p>原 OBJ：21 个木架/柜台部件 + 1 个地面圆盘，共 348 面。棚布、外圈及渐变光圈按原参数重建。</p><p>橙色：实体碰撞；青色：原 HitZone（可穿行）。棚顶也有实体碰撞。未使用整个摊位包围盒阻挡人物。</p>';
new ResizeObserver(()=>{const r=canvas.parentElement.getBoundingClientRect();renderer.setSize(r.width,r.height,false);camera.aspect=r.width/r.height;camera.updateProjectionMatrix();}).observe(canvas.parentElement);
renderer.setAnimationLoop(()=>{controls.update();renderer.render(scene,camera);});
