import * as THREE from 'three';
import {OrbitControls} from '../vendor/OrbitControls.js';
import {WeaponAssets} from '../gameplay/weapon-assets.js';
const $=s=>document.querySelector(s),canvas=$('canvas');
const renderer=new THREE.WebGLRenderer({canvas,antialias:true});renderer.setPixelRatio(Math.min(devicePixelRatio,2));
const scene=new THREE.Scene();scene.background=new THREE.Color('#131e2d');
scene.add(new THREE.HemisphereLight(0xeaf4ff,0x46536e,2.7));const sun=new THREE.DirectionalLight(0xffeddc,2.6);sun.position.set(5,10,7);scene.add(sun);
const camera=new THREE.PerspectiveCamera(40,1,.01,100),controls=new OrbitControls(camera,canvas);controls.target.set(0,3,0);controls.enableDamping=true;
camera.position.set(9,6,-13);controls.update();
const floor=new THREE.GridHelper(24,24,0x60718a,0x2c3d53);scene.add(floor);
const json=async p=>{const r=await fetch(p);if(!r.ok)throw Error(p);return r.json();};
const [rig,clip]=await Promise.all([json('./weapons/swing-rig.json'),json('./weapons/swing-candidate.json')]);
const matrix=p=>new THREE.Matrix4().set(+p.R00,+p.R01,+p.R02,+p.X,+p.R10,+p.R11,+p.R12,+p.Y,+p.R20,+p.R21,+p.R22,+p.Z,0,0,0,1);
const nodes=new Map();
for(const part of rig.parts){
 const node=new THREE.Group();node.name=part.name;nodes.set(part.name,node);
 if(part.name==='HumanoidRootPart')continue;
 const s=part.properties.size,color=part.name==='Head'||/Hand/.test(part.name)?0xe7b388:/Leg|Foot/.test(part.name)?0x334663:/Right/.test(part.name)?0xffa448:0x5184bd;
 const mesh=new THREE.Mesh(new THREE.BoxGeometry(+s.X*.94,+s.Y*.96,+s.Z*.94),new THREE.MeshStandardMaterial({color,roughness:.65}));node.add(mesh);
 if(part.name==='Head')for(const x of [-.27,.27]){const eye=new THREE.Mesh(new THREE.SphereGeometry(.065,10,8),new THREE.MeshBasicMaterial({color:0x172334}));eye.position.set(x,.06,-.49);node.add(eye);}
}
const joints=[];
for(const m of rig.motors){
 const pivot=new THREE.Group();pivot.name=m.name;matrix(m.c0).decompose(pivot.position,pivot.quaternion,pivot.scale);nodes.get(m.parent).add(pivot);
 const pose=new THREE.Group();pivot.add(pose);const child=nodes.get(m.child);pose.add(child);matrix(m.c1).invert().decompose(child.position,child.quaternion,child.scale);joints.push({name:m.child,pose});
}
const root=nodes.get('HumanoidRootPart');root.position.y=3;scene.add(root);
const weapon=await (await new WeaponAssets().init()).create(1);
const hand=rig.parts.find(p=>p.name==='RightHand'),attachment=hand.attachments.find(a=>a.name==='RightGripAttachment');
const mount=new THREE.Group();if(attachment)matrix(attachment.properties.CFrame).decompose(mount.position,mount.quaternion,mount.scale);nodes.get('RightHand').add(mount);mount.add(weapon.root);
const masked=new Set(['Head','HumanoidRootPart','LowerTorso','Torso']);
const frames=clip.frames.map(f=>({time:f.time,poses:new Map(f.poses.map(p=>{
 const a=p.cframe,m=new THREE.Matrix4().set(a[3],a[4],a[5],a[0],a[6],a[7],a[8],a[1],a[9],a[10],a[11],a[2],0,0,0,1),position=new THREE.Vector3(),rotation=new THREE.Quaternion(),scale=new THREE.Vector3();m.decompose(position,rotation,scale);return [p.name,{position,rotation,weight:p.weight}];
}))}));
let time=0,playing=true,speed=1.75,hold=0,side=false;
function poseAt(t){
 const next=frames.findIndex(f=>f.time>=t),b=frames[next<0?frames.length-1:next],a=frames[Math.max(0,(next<0?frames.length-1:next)-1)];const alpha=b.time===a.time?0:(t-a.time)/(b.time-a.time);
 for(const joint of joints){joint.pose.position.set(0,0,0);joint.pose.quaternion.identity();if(masked.has(joint.name)||/Leg|Foot/.test(joint.name))continue;
  const from=a.poses.get(joint.name),to=b.poses.get(joint.name);if(!from||!to)continue;
  const weight=THREE.MathUtils.lerp(from.weight,to.weight,alpha);joint.pose.position.lerpVectors(from.position,to.position,alpha).multiplyScalar(weight);const q=from.rotation.clone().slerp(to.rotation,alpha);joint.pose.quaternion.slerp(q,weight);
 }
 root.updateMatrixWorld(true);$('#timeline').value=t;$('#time').textContent=`${t.toFixed(3)} / ${clip.duration.toFixed(3)} s`;canvas.dataset.time=t.toFixed(4);canvas.dataset.playing=String(playing);
}
$('#play').onclick=()=>{playing=!playing;$('#play').textContent=playing?'暂停':'播放';};
$('#replay').onclick=()=>{time=0;hold=0;playing=true;$('#play').textContent='暂停';};
function status(){$('#status').textContent=`循环播放 · 每次挥击约 ${(clip.duration/speed).toFixed(3)} 秒，间隔 0.7 秒`;}
$('#speed').onchange=e=>{speed=Number(e.target.value);status();};
$('#timeline').oninput=e=>{time=Number(e.target.value);playing=false;hold=0;$('#play').textContent='播放';poseAt(time);};
$('#view').onclick=()=>{side=!side;camera.position.set(...(side?[13,6,2]:[9,6,-13]));controls.target.set(0,3,0);controls.update();};
function resize(){renderer.setSize(innerWidth,innerHeight,false);camera.aspect=innerWidth/innerHeight;camera.updateProjectionMatrix();}addEventListener('resize',resize);resize();
status();canvas.dataset.ready='true';
let last=performance.now();renderer.setAnimationLoop(now=>{const dt=Math.min((now-last)/1000,.05);last=now;if(playing){if(hold>0){hold-=dt;if(hold<=0)time=0;}else{time=Math.min(clip.duration,time+dt*speed);if(time>=clip.duration)hold=.7;}}poseAt(time);controls.update();renderer.render(scene,camera);});
