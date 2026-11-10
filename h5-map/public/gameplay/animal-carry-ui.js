import {animalIncome} from './animal-attributes.js';
import * as THREE from 'three';
import {gradientStops,setStops} from './egg-billboards.js';
import {speciesOf} from './pickaxe-state.js';
import {formatNumber} from '../treadmill-state.js';

const NS='http://www.w3.org/2000/svg';
export class AnimalCarryUI {
  constructor(camera){
    this.camera=camera;this.sequence=0;this.point=new THREE.Vector3();this.anchor=new THREE.Vector3();this.projected=new THREE.Vector3();
    const link=document.createElement('link');link.rel='stylesheet';link.href=new URL('./animal-carry.css',import.meta.url).href;document.head.append(link);
    this.root=document.createElement('div');this.root.id='animal-carry-ui';
    this.root.innerHTML='<div id="animal-overheads" aria-hidden="true"></div><button id="animal-pickup" hidden aria-label="按住拾取动物"><span class="pickup-key"><svg viewBox="0 0 54 54"><circle cx="27" cy="27" r="24"/></svg><kbd>E</kbd></span><span><b>Pick Up</b><small></small></span></button><button id="animal-drop" hidden><kbd>G</kbd> Drop</button>';
    this.root.querySelector('#animal-pickup small').setAttribute('data-i18n-context','animal');
    document.body.append(this.root);this.labels=this.root.firstElementChild;this.pickup=this.root.querySelector('#animal-pickup');this.drop=this.root.querySelector('#animal-drop');
  }
  add(a){
    const id=`animal-${this.sequence++}`,svg=document.createElementNS(NS,'svg'),species=speciesOf(a.pet.name);
    svg.classList.add('animal-overhead');svg.setAttribute('viewBox','-30 0 560 500');svg.setAttribute('width',560);svg.setAttribute('height',500);
    // Authored AnimalOverhead: 7.5 studs, bottom aligned .15 rows, .9 text height.
    svg.innerHTML=`<defs><linearGradient id="${id}-rarity" x1="0" y1="1" x2="0" y2="0"/><linearGradient id="${id}-cash" x1="0" y1="1" x2="0" y2="0"><stop stop-color="#23eb3a"/><stop offset="1" stop-color="#c3ff00"/></linearGradient><linearGradient id="${id}-time" x1="0" y1="1" x2="0" y2="0"><stop stop-color="#ca0000"/><stop offset="1" stop-color="#ff2e2e"/></linearGradient></defs><g class="animal-timer-row"><text class="animal-text animal-timer" x="250" y="312.5" fill="url(#${id}-time)">45s</text></g><text class="animal-text animal-cash" x="250" y="387.5" fill="url(#${id}-cash)" font-style="italic"/><text class="animal-text animal-rarity" x="250" y="462.5" fill="url(#${id}-rarity)"/>`;
    svg.querySelector('.animal-cash').textContent=`$${formatNumber(animalIncome(a.pet))}/s`;
    svg.querySelector('.animal-rarity').textContent=species.rarity;this.labels.append(svg);
    return {svg,gradient:svg.querySelector('linearGradient'),rarity:species.rarity,timer:svg.querySelector('.animal-timer'),timerRow:svg.querySelector('.animal-timer-row')};
  }
  project(position){
    const view=this.point.copy(position).applyMatrix4(this.camera.matrixWorldInverse),z=-view.z;
    const p=this.projected.copy(position).project(this.camera);
    return {x:(p.x*.5+.5)*innerWidth,y:(-.5*p.y+.5)*innerHeight,z,visible:z>0&&p.z>=-1&&p.z<=1&&Math.abs(p.x)<1.2&&Math.abs(p.y)<1.3};
  }
  label(a,v,time){
    const ref=v.label,anchor=this.anchor.copy(v.root.position),p=(anchor.y+=v.height+.25,this.project(anchor));
    const visible=(a.status==='ground'||a.status==='carrying')&&p.visible&&anchor.distanceTo(this.camera.position)<=150;
    if(ref.svg.hidden!==!visible)ref.svg.toggleAttribute('hidden',!visible);if(!visible)return;
    const scale=Math.min(2.2,Math.max(.85,a.scale)),k=innerHeight/(2*Math.tan(this.camera.fov*Math.PI/360)*p.z)*7.5*scale/500;
    // Write only changed values; every SVG style write restyles and re-rasterizes the label.
    const w=ref.written||(ref.written={});
    const transform=`translate(${(p.x-280*k).toFixed(1)}px,${(p.y-500*k).toFixed(1)}px) scale(${k.toFixed(4)})`;
    if(w.transform!==transform){w.transform=transform;ref.svg.style.transform=transform;}
    const seconds=Math.ceil(a.remaining);if(ref.timer.textContent!==`${seconds}s`)ref.timer.textContent=`${seconds}s`;
    const fill=a.remaining<=10?'#ff5050':'';if(w.fill!==fill){w.fill=fill;ref.timer.style.fill=fill;}
    const row=a.status==='carrying'||a.lookRemaining>0?'none':'';if(w.row!==row){w.row=row;ref.timerRow.style.display=row;}
    if(time-(ref.lastGradient??-Infinity)>.05){ref.lastGradient=time;setStops(ref.gradient,gradientStops(ref.rarity,time));}
  }
  interaction(target,view,hold,carrying,blocked){
    this.drop.hidden=!carrying||blocked;
    const p=view?this.project(view.root.position.clone().add(new THREE.Vector3(0,view.height*.45,0))):null;
    this.pickup.hidden=!target||!p?.visible||blocked||!!carrying;
    if(this.pickup.hidden)return;
    this.pickup.style.left=`${Math.max(110,Math.min(innerWidth-110,p.x))}px`;
    this.pickup.style.top=`${Math.max(55,Math.min(innerHeight-90,p.y))}px`;
    this.pickup.querySelector('small').textContent=target.pet.name;
    this.pickup.querySelector('circle').style.strokeDashoffset=String(151*(1-Math.min(1,(hold?.elapsed||0)/1.4)));
    this.pickup.classList.toggle('holding',!!hold);
    this.pickup.dataset.progress=String(Math.min(1,(hold?.elapsed||0)/1.4));
  }
}
