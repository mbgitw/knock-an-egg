import * as THREE from 'three';
import {GLTFLoader} from './vendor/GLTFLoader.js';
import {Leaderboards} from './gameplay/leaderboards.js';
import {BOARDS,encodeScore} from './gameplay/leaderboard-data.js';
const renderer=new THREE.WebGLRenderer({antialias:true});renderer.setSize(innerWidth,innerHeight);renderer.setPixelRatio(devicePixelRatio);renderer.setClearColor(0x8bcfff);document.body.append(renderer.domElement);
const scene=new THREE.Scene(),camera=new THREE.PerspectiveCamera(53,innerWidth/innerHeight,.1,1000);camera.position.set(-34,17,-108);camera.lookAt(-78,12,-108);camera.updateMatrixWorld();
scene.add(new THREE.HemisphereLight(0xffffff,0x8b9688,2));const sun=new THREE.DirectionalLight(0xffffff,2);sun.position.set(0,100,-30);scene.add(sun);
const [map,data]=await Promise.all([new GLTFLoader().loadAsync('obj-map/world.glb'),fetch('map.json').then(r=>r.json())]);scene.add(map.scene);
const game={scene,camera,canvas:renderer.domElement,account:{data:{}},player:{motor:{position:camera.position},world:{rayIntersect(){return false;}}}};
const sdk={rank:{getRankList:async id=>({ok:true,data:{list:Array.from({length:18},(_,i)=>({rank:i+1,score:encodeScore(id===BOARDS[0].id?194.27e12/(i+1):id===BOARDS[1].id?200.1e15/(i+1):2390000-i*37000,BOARDS.find(b=>b.id===id).key),player:{id:String(i+1),name:['BuildaPlayer','牧场主人','EggHunter','Runner','SunnyRanch','PlayerSix'][i%6]}})),self:{rank:12,score:100}}})}};
const boards=new Leaderboards(game,data.parts,sdk);await boards.refresh(false,true);renderer.domElement.dataset.ready='true';
renderer.setAnimationLoop(()=>renderer.render(scene,camera));

function resize(){renderer.setSize(innerWidth,innerHeight);camera.aspect=innerWidth/innerHeight;camera.updateProjectionMatrix();camera.position.set(-78+Math.max(44,33/(Math.tan(53*Math.PI/360)*camera.aspect)),17,-108);camera.lookAt(-78,12,-108);camera.updateMatrixWorld();}addEventListener('resize',resize);resize();
