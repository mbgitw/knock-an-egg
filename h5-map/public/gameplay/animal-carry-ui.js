import {animalIncome} from './animal-attributes.js';
import * as THREE from 'three';
import {gradientStops} from './egg-billboards.js';
import {speciesOf} from './pickaxe-state.js';
import {formatNumber} from '../treadmill-state.js';

const NS='http://www.w3.org/2000/svg';
export class AnimalCarryUI {
  constructor(camera){
    this.camera=camera;this.sequence=0;this.point=new THREE.Vector3();
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
    const p=position.clone().project(this.camera);
    return {x:(p.x*.5+.5)*innerWidth,y:(-.5*p.y+.5)*innerHeight,z,visible:z>0&&p.z>=-1&&p.z<=1&&Math.abs(p.x)<1.2&&Math.abs(p.y)<1.3};
  }
  label(a,v,time){
    const ref=v.label,anchor=v.root.position.clone().add(new THREE.Vector3(0,v.height+.25,0)),p=this.project(anchor);
    const visible=(a.status==='ground'||a.status==='carrying')&&p.visible&&anchor.distanceTo(this.camera.position)<=150;
    ref.svg.toggleAttribute('hidden',!visible);if(!visible)return;
    const scale=Math.min(2.2,Math.max(.85,a.scale)),k=innerHeight/(2*Math.tan(this.camera.fov*Math.PI/360)*p.z)*7.5*scale/500;
    ref.svg.style.transform=`translate(${p.x-280*k}px,${p.y-500*k}px) scale(${k})`;
    const seconds=Math.ceil(a.remaining);if(ref.timer.textContent!==`${seconds}s`)ref.timer.textContent=`${seconds}s`;
    ref.timer.style.fill=a.remaining<=10?'#ff5050':'';
    ref.timerRow.style.display=a.status==='carrying'||a.lookRemaining>0?'none':'';
    if(time-(ref.lastGradient??-Infinity)>.05){ref.lastGradient=time;ref.gradient.innerHTML=gradientStops(ref.rarity,time).map(s=>`<stop offset="${s.t}" stop-color="rgb(${s.c.map(n=>Math.round(n*255)).join(',')})"/>`).join('');}
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
