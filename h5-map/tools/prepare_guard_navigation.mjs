import fs from 'node:fs';
import * as THREE from 'three';
import {buildCollisionWorld} from '../public/world-physics.js';
import {Capsule} from '../public/vendor/Capsule.js';
import {GuardNavigation} from '../public/gameplay/guard-navigation.js';
const root=new URL('../',import.meta.url),read=p=>JSON.parse(fs.readFileSync(new URL(p,root)));
const map=read('public/map.json'),catalog=read('public/gameplay/guards/catalog.json');
const parts=map.parts.filter(p=>!catalog.guards.some(g=>p.path.startsWith(g.nodePath+'/'))&&!p.path.includes('/PlacedAnimals/')&&!/^\/Workspace\/Plots\//.test(p.path));
const world=buildCollisionWorld(parts);
const data={x:-3500,z:-82,step:3,width:1142,depth:56,heights:[],edges:[]};
const ray=new THREE.Ray(new THREE.Vector3(),new THREE.Vector3(0,-1,0));
const capsule=new Capsule(new THREE.Vector3(),new THREE.Vector3(),2);
function clear(p){capsule.start.set(p.x,p.y+2.06,p.z);capsule.end.set(p.x,p.y+3.06,p.z);const hit=world.capsuleIntersect(capsule);return !hit||hit.depth<.015;}
for(let z=0;z<data.depth;z++)for(let x=0;x<data.width;x++){
  const p={x:data.x+x*data.step,z:data.z+z*data.step};ray.origin.set(p.x,7,p.z);const floor=world.rayIntersect(ray);
  p.y=floor?.position.y;data.heights.push(floor&&floor.triangle.getNormal(new THREE.Vector3()).y>.5&&p.y>-.1&&p.y<3&&clear(p)?Math.round(p.y*1000)/1000:null);
}
const nav=new GuardNavigation({...data,edges:null});
for(let i=0;i<data.heights.length;i++){
  let bits=0;if(nav.valid(i)){const a=nav.point(i);for(const [n] of nav.neighbors(i)){
    const b=nav.point(n);let ok=true;for(let k=1;k<8;k++){const t=k/8;if(!clear({x:a.x+(b.x-a.x)*t,y:a.y+(b.y-a.y)*t,z:a.z+(b.z-a.z)*t})){ok=false;break;}}
    if(ok){const dx=n%data.width-i%data.width,dz=Math.floor(n/data.width)-Math.floor(i/data.width);bits|=1<<((dz+1)*3+dx+1);}
  }}data.edges.push(bits);
}
fs.writeFileSync(new URL('public/gameplay/guards/navigation.json',root),JSON.stringify(data));
console.log({cells:data.heights.length,walkable:nav.openCells.length,homes:catalog.guards.map(g=>{const i=nav.nearest(new THREE.Vector3(...g.home));return {zone:g.zone,nearest:nav.point(i),distance:new THREE.Vector3(...g.home).distanceTo(new THREE.Vector3(...Object.values(nav.point(i))))};})});
