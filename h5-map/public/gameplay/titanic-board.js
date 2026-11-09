import {t} from '../i18n.js';
import * as THREE from 'three';
export class TitanicBoard {
  constructor(scene){
    this.canvas=document.createElement('canvas');this.canvas.width=1536;this.canvas.height=320;this.ctx=this.canvas.getContext('2d');
    this.texture=new THREE.CanvasTexture(this.canvas);this.texture.colorSpace=THREE.SRGBColorSpace;
    const material=new THREE.MeshBasicMaterial({map:this.texture,transparent:true,depthWrite:false,side:THREE.DoubleSide});
    this.root=new THREE.Group();
    for(const side of [-1,1]){const plane=new THREE.Mesh(new THREE.PlaneGeometry(56,11),material);plane.rotation.y=side*Math.PI/2;plane.position.set(-83+side*1.025,32.5,0);this.root.add(plane);}scene.add(this.root);
    this.banner=document.createElement('div');this.banner.id='titanic-announcement';this.banner.hidden=true;
    this.banner.style.cssText='position:fixed;top:18%;left:50%;transform:translateX(-50%);width:90%;text-align:center;pointer-events:none;z-index:10;font:900 clamp(20px,3vw,38px) EggOriginal,sans-serif;color:#ffe45c;-webkit-text-stroke:2px #000;paint-order:stroke fill';
    this.banner.setAttribute('role','status');document.body.append(this.banner);
  }
  announce(e,now){this.banner.textContent=`TITANIC EGG — Zone ${e.spec.zone}`;this.banner.hidden=false;this.hideAt=now+4;}
  update(now,nextAt){
    if(now>=this.hideAt)this.banner.hidden=true;
    if(now-(this.last??-Infinity)<.1)return;this.last=now;
    const c=this.ctx;c.clearRect(0,0,1536,320);c.textAlign='center';c.textBaseline='middle';c.lineJoin='round';c.strokeStyle='#000';c.lineWidth=10;
    const title=t('??? Titanic Egg');c.font='900 106px EggOriginal,sans-serif';const widths=[...title].map(l=>c.measureText(l).width+7),total=widths.reduce((a,b)=>a+b,0);let x=(1536-total)/2;
    [...title].forEach((l,i)=>{const y=111+Math.sin(now*1.6-i*.4)*8;c.fillStyle=`hsl(${(i*360/title.length-now*36)%360} 100% 50%)`;c.strokeText(l,x+widths[i]/2,y);c.fillText(l,x+widths[i]/2,y);x+=widths[i];});
    const seconds=Math.max(0,Math.ceil(nextAt-now)),text=Number.isFinite(nextAt)?`Spawns in: ${Math.floor(seconds/60)}:${String(seconds%60).padStart(2,'0')}`:'Spawns in: --:--';c.font='900 65px EggOriginal,sans-serif';c.fillStyle='#e4e5ff';c.strokeText(t(text),768,236);c.fillText(t(text),768,236);this.texture.needsUpdate=true;
  }
}
