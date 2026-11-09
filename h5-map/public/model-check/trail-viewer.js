import * as THREE from 'three';
import {OrbitControls} from '../vendor/OrbitControls.js';
import {TRAILS} from '../gameplay/trail-state.js';
import {TrailRibbon} from '../gameplay/trail-ribbon.js';
const canvas=document.querySelector('canvas'),renderer=new THREE.WebGLRenderer({canvas,antialias:true});renderer.setPixelRatio(Math.min(devicePixelRatio,2));
const scene=new THREE.Scene();scene.background=new THREE.Color('#151e2b');
const camera=new THREE.PerspectiveCamera(45,1,.1,250),controls=new OrbitControls(camera,canvas);controls.enableDamping=true;
scene.add(new THREE.GridHelper(60,30,0x45617b,0x283b50));
let effects=[],time=0,last=performance.now(),selected=0,wire=false;
const list=document.querySelector('#list');list.innerHTML=TRAILS.map(t=>`<button data-id="${t.id}">${t.name}<small>×${t.multiplier} · ${t.rarity}</small></button>`).join('');
function show(id){
 selected=id;for(const e of effects)e.ribbon.dispose();effects=[];const ts=id?[TRAILS[id-1]]:TRAILS;
 ts.forEach((t,i)=>{const ribbon=new TrailRibbon(scene,camera);ribbon.setTrail(t);ribbon.material.wireframe=wire;effects.push({ribbon,origin:new THREE.Vector3(id?0:(i%4-1.5)*13,2,id?0:(Math.floor(i/4)-1)*12)});});
 list.querySelectorAll('button').forEach(b=>b.classList.toggle('active',Number(b.dataset.id)===id));
 document.querySelector('#count').textContent=`${ts.length} / 11`;
 document.querySelector('#info').innerHTML=`<h3>${id?TRAILS[id-1].name:'11 种拖尾'}</h3><p>原颜色序列、0.75秒寿命、2单位附件宽度、50单位最大长度。轨迹沿运动路径更新。</p><p>原纹理下载受限，当前为无贴图带状重建；角色挂载为H5实现，不代表原服务端已恢复。</p>`;fit();
}
function fit(){camera.position.set(selected?10:25,selected?10:35,selected?15:40);controls.target.set(0,2,0);controls.update();}
list.onclick=e=>{const b=e.target.closest('[data-id]');if(b)show(Number(b.dataset.id));};
document.querySelector('#all').textContent='全部拖尾';document.querySelector('#all').onclick=()=>show(0);document.querySelector('#reset').onclick=fit;
document.querySelector('#spin').onclick=e=>{controls.autoRotate=!controls.autoRotate;e.target.textContent='自动旋转：'+(controls.autoRotate?'开':'关');};
document.querySelector('#wire').onclick=e=>{wire=!wire;effects.forEach(x=>x.ribbon.material.wireframe=wire);e.target.textContent='线框：'+(wire?'开':'关');};
document.querySelector('#background').onchange=e=>scene.background.set(e.target.value==='light'?'#dce5ee':'#151e2b');
new ResizeObserver(()=>{const r=canvas.parentElement.getBoundingClientRect();renderer.setSize(r.width,r.height,false);camera.aspect=r.width/r.height;camera.updateProjectionMatrix();}).observe(canvas.parentElement);
show(0);renderer.setAnimationLoop(now=>{const dt=Math.min(.05,(now-last)/1000);last=now;time+=dt;for(const e of effects)e.ribbon.update(dt,e.origin.clone().add(new THREE.Vector3(Math.cos(time*2)*4,Math.sin(time*3)*.7,Math.sin(time*2)*4)));controls.update();renderer.render(scene,camera);});
