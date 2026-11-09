import * as THREE from 'three';
import {MergeSystem} from './gameplay/merge-system.js';
import {EggWorld} from './gameplay/egg-world-runtime.js';
import {PickaxeProgress,speciesOf} from './gameplay/pickaxe-state.js';
import {restoreState} from './treadmill-state.js';
import {gameAudio} from './gameplay/game-audio.js';
const scene=new THREE.Scene();scene.background=new THREE.Color('#526d83');
scene.add(new THREE.HemisphereLight(0xffffff,0x657052,3));const light=new THREE.DirectionalLight(0xffffff,2);light.position.set(5,12,8);scene.add(light);
const floor=new THREE.Mesh(new THREE.PlaneGeometry(60,60),new THREE.MeshStandardMaterial({color:0x73934f}));floor.rotation.x=-Math.PI/2;scene.add(floor);
const camera=new THREE.PerspectiveCamera(50,innerWidth/innerHeight,.1,200);camera.position.set(12,11,19);camera.lookAt(0,2,0);
const renderer=new THREE.WebGLRenderer({antialias:true});renderer.setSize(innerWidth,innerHeight);document.body.append(renderer.domElement);
const account={data:restoreState({}),save:()=>true},player={motor:{position:new THREE.Vector3(0,0,8)},actor:new THREE.Group()},progress=new PickaxeProgress(account);
const marker=new THREE.Mesh(new THREE.BoxGeometry(1,4,1),new THREE.MeshStandardMaterial({color:0xffa333}));marker.position.set(0,2,8);scene.add(marker);
const pickaxes={progress,eggs:new EggWorld(scene,progress,{}),bankFeedback:{show(){}},clock:{cancel(){}}};
const inventoryUI={list:document.createElement('div'),close(){},update(){}},backpack={render(){},unequip(){},held:null};
const system=new MergeSystem({scene,camera,account,player,pickaxes,backpack,inventoryUI,canvas:renderer.domElement,pasture:{update(){}},plots:{contains:()=>true}});system.ui={opened:false,open(){}};
function reset(){if(system.hatchPresentation.active.size)return;account.data.pickaxes.pets=[];account.data.growingEggs=['Chicken','Cat','AngelAnky'].map((name,i)=>({id:'merge:qa'+i,name,weightKg:speciesOf(name).baseKg,sizeMult:1,zone:speciesOf(name).zone,duration:60,position:[(i-1)*6,0,0],readyAt:Date.now()+(i===1?60000:0),...(i===2?{paidType:'FallenAngel'}:{})}));}
reset();document.querySelector('#reset').onclick=reset;document.querySelector('#open').onclick=()=>system.hatch('merge:qa0');let paused=false,inspect=false;document.querySelector('#inspect').onclick=()=>{inspect=true;system.hatch('merge:qa0');};document.querySelector('#pause').onclick=()=>paused=!paused;
gameAudio.install();renderer.setAnimationLoop(()=>{if(!paused)system.update();else system.lastFrame=performance.now();if(inspect&&[...system.hatchPresentation.active.values()].some(e=>e.effect?.elapsed>=.5)){paused=true;inspect=false;}renderer.render(scene,camera);document.querySelector('output').textContent=` 背包: ${account.data.pickaxes.pets.length} / 展示: ${system.hatchPresentation.active.size}`;});
