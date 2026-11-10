import * as THREE from 'three';
import {PRESENTATION as P} from './egg-presentation/config.js';
import {clamp,eggRarities,labelScale,luckAt} from './egg-presentation-state.js';

const NS='http://www.w3.org/2000/svg',animated={Mythic:.35,Secret:.5,Divine:.16,Celestial:.28,Cosmic:.4};
const color=n=>`rgb(${n.map(v=>Math.round(v*255)).join(',')})`;
const short=n=>{for(const [v,s]of [[1e15,'Qa'],[1e12,'T'],[1e9,'B'],[1e6,'M'],[1e3,'K']])if(n>=v)return `${Number((n/v).toFixed(2))}${s}`;return String(Math.floor(n*100)/100);};
export function gradientStops(rarity,time=0){
  const data=String(P.gradients[rarity]?.Color||'0 1 1 1 0 1 1 1 1 0').trim().split(/\s+/).map(Number),points=[];
  for(let i=0;i<data.length;i+=5)points.push({t:data[i],c:data.slice(i+1,i+4)});
  if(!animated[rarity])return points;
  if(points[0].c.some((v,i)=>v!==points.at(-1).c[i])){for(const p of points)p.t*=1/1.15;points.push({t:1,c:points[0].c});}
  const offset=time*animated[rarity]%1,phase=(1-offset)%1;
  const i=Math.max(1,points.findIndex(p=>p.t>=phase)),a=points[i-1],b=points[i],u=(phase-a.t)/(b.t-a.t||1),edge=a.c.map((v,k)=>v+(b.c[k]-v)*u);
  return [{t:0,c:edge},...points.map(p=>({t:(p.t+offset)%1,c:p.c})).filter(p=>p.t>.005&&p.t<.995).sort((a,b)=>a.t-b.t),{t:1,c:edge}];
}
// Reuse <stop> nodes for animated gradients; rebuilding innerHTML reparses the SVG subtree.
export function setStops(gradient,points){
  const stops=gradient.children;
  if(stops.length!==points.length){gradient.innerHTML=points.map(p=>`<stop offset="${p.t}" stop-color="${color(p.c)}"/>`).join('');return;}
  for(let i=0;i<points.length;i++){const stop=stops[i],offset=String(points[i].t),fill=color(points[i].c);
    if(stop.getAttribute('offset')!==offset)stop.setAttribute('offset',offset);if(stop.getAttribute('stop-color')!==fill)stop.setAttribute('stop-color',fill);}
}
export class EggBillboards {
  constructor(camera){this.camera=camera;this.sequence=0;this.point=new THREE.Vector3();this.view=new THREE.Vector3();this.projected=new THREE.Vector3();this.measure=document.createElement('canvas').getContext('2d');
    this.root=document.createElement('div');this.root.id='egg-billboards';this.root.setAttribute('aria-hidden','true');document.body.prepend(this.root);
    this.fontReady=false;document.fonts.load('900 75px EggOriginal').then(()=>{this.fontReady=true;});}
  add(egg){
    const id=`egg-gradient-${this.sequence++}`,svg=document.createElementNS(NS,'svg');svg.classList.add('egg-billboard');svg.setAttribute('viewBox','-30 0 560 530');svg.setAttribute('width','560');svg.setAttribute('height','530');
    svg.innerHTML=`<defs><linearGradient id="${id}" x1="0" y1="1" x2="0" y2="0"></linearGradient><linearGradient id="${id}-hp" x1="0" y1="1" x2="0" y2="0"><stop offset="0" stop-color="#37ff00"/><stop offset="1" stop-color="#ddff00"/></linearGradient><linearGradient id="${id}-luck" x1="0" y1="1" x2="0" y2="0"><stop stop-color="#00ff00"/><stop offset="1" stop-color="#aeff00"/></linearGradient><pattern id="${id}-studs" width="40" height="40" patternUnits="userSpaceOnUse"><image href="./gameplay/egg-presentation/textures/studs.png" width="40" height="40"/></pattern><clipPath id="${id}-clip"><rect x="-25" y="421.25" width="550" height="78.75" rx="8"/></clipPath></defs><g class="egg-name-row"><text class="egg-text egg-name" x="250" y="0" fill="white"/></g><g class="egg-rarity-row"><text class="egg-text egg-rarity" x="250" y="0" fill="url(#${id})"/></g><g class="egg-hp"><rect x="-25" y="421.25" width="550" height="78.75" rx="8" fill="#232323" stroke="#000" stroke-width="12"/><rect x="-25" y="421.25" width="550" height="78.75" rx="8" fill="url(#${id}-studs)" opacity=".15"/><rect x="-22" y="424.25" width="544" height="72.75" rx="6" fill="none" stroke="#4b4b4b" stroke-width="4"/><g clip-path="url(#${id}-clip)"><g class="egg-hp-fill"><rect x="-25" y="421.25" width="550" height="78.75" rx="8" fill="url(#${id}-hp)" stroke="#000" stroke-width="6"/><rect x="-25" y="421.25" width="550" height="78.75" rx="8" fill="url(#${id}-studs)" opacity=".5"/><rect x="-24" y="422.25" width="548" height="76.75" rx="7" fill="none" stroke="white" stroke-width="2"/></g></g><text class="egg-text egg-hp-text" x="250" y="460.625" fill="white"/></g><g class="egg-luck-row"><text class="egg-text egg-luck" x="250" y="462.5" fill="url(#${id}-luck)"/></g>`;
    this.root.append(svg);const get=s=>svg.querySelector(s),rarity=egg.spec.titanic?'Mythic':eggRarities[egg.spec.zone-1];
    const ref={svg,rarity,name:get('.egg-name'),rarityText:get('.egg-rarity'),hp:get('.egg-hp'),hpFill:get('.egg-hp-fill'),hpText:get('.egg-hp-text'),luck:get('.egg-luck-row'),luckText:get('.egg-luck'),gradient:get('linearGradient'),font:false,written:{}};
    ref.name.textContent=egg.spec.name;ref.rarityText.textContent=egg.spec.titanic?'TITANIC':rarity;egg.billboard=ref;this.fit(ref.name,egg.spec.name,75,500);this.fit(ref.rarityText,egg.spec.titanic?'TITANIC':rarity,75,500);this.colors(ref,0);svg.hidden=true;svg.setAttribute('hidden','');
  }
  fit(el,text,height,width){this.measure.font=`900 ${height}px EggOriginal, sans-serif`;const size=Math.min(height,height*width/Math.max(1,this.measure.measureText(text).width));el.style.fontSize=`${size}px`;el.style.strokeWidth=`${height*.19}px`;}
  colors(ref,time){setStops(ref.gradient,gradientStops(ref.rarity,time));const rotation=Number(P.gradients[ref.rarity]?.Rotation??-90)*Math.PI/180;ref.gradient.setAttribute('x1',String(.5-.5*Math.cos(rotation)));ref.gradient.setAttribute('y1',String(.5-.5*Math.sin(rotation)));ref.gradient.setAttribute('x2',String(.5+.5*Math.cos(rotation)));ref.gradient.setAttribute('y2',String(.5+.5*Math.sin(rotation)));}
  update(egg,pose,time){const ref=egg.billboard;if(!ref)return;const state=egg.presentation,hp=state.health(time),growing=pose.stage==='grow',alive=egg.life.alive;
    const show=egg.root.visible&&(alive||growing||(pose.stage==='spin'&&hp.visible));
    if(!show){if(!ref.svg.hidden){ref.svg.hidden=true;ref.svg.setAttribute('hidden','');}return;}
    const scale=labelScale(Math.min(egg.spec.size[0],egg.spec.size[2]),growing?pose.scale:1);
    this.point.copy(egg.root.position);this.point.y+=egg.spec.bodyHeight*pose.scale/2+1;
    const distance=this.point.distanceTo(this.camera.position);
    if(distance>150){if(!ref.svg.hidden){ref.svg.hidden=true;ref.svg.setAttribute('hidden','');}return;}
    this.view.copy(this.point).applyMatrix4(this.camera.matrixWorldInverse);const projected=this.projected.copy(this.point).project(this.camera);
    const visible=this.view.z<0&&projected.z>=-1&&projected.z<=1&&Math.abs(projected.x)<1.5&&Math.abs(projected.y)<1.8;
    if(ref.svg.hidden!==!visible){ref.svg.hidden=!visible;ref.svg.toggleAttribute('hidden',!visible);}if(!visible)return;
    const pixels=innerHeight/(2*Math.tan(this.camera.fov*Math.PI/360)*-this.view.z)*5*scale,k=pixels/500;
    // Each SVG write restyles and re-rasterizes the label, so write only values that changed.
    const w=ref.written;
    const transform=`translate(${((projected.x*.5+.5)*innerWidth-280*k).toFixed(1)}px,${((-projected.y*.5+.5)*innerHeight-500*k).toFixed(1)}px) scale(${k.toFixed(4)})`;
    if(w.transform!==transform){w.transform=transform;ref.svg.style.transform=transform;}
    const order=Math.max(1,1000-Math.floor(distance));if(w.order!==order){w.order=order;ref.svg.style.zIndex=String(order);}
    if(w.stage!==pose.stage){w.stage=pose.stage;ref.svg.dataset.stage=pose.stage;}
    const ordinary=alive||(pose.stage==='spin'&&hp.visible),bar=ordinary&&hp.visible;
    if(w.ordinary!==ordinary){w.ordinary=ordinary;ref.name.parentNode.style.display=ordinary?'':'none';ref.rarityText.parentNode.style.display=ordinary?'':'none';}
    if(w.bar!==bar){w.bar=bar;ref.hp.style.display=bar?'':'none';ref.name.setAttribute('y',bar?'300':'387.5');ref.rarityText.setAttribute('y',bar?'375':'462.5');}
    if(w.growing!==growing){w.growing=growing;ref.luck.style.display=growing?'':'none';}
    if(bar){const hpTransform=`translate(250 460.625) scale(${hp.scale}) translate(-250 -460.625)`,fill=`translate(${(hp.ratio-1)*550} 0)`;
      if(w.hpTransform!==hpTransform){w.hpTransform=hpTransform;ref.hp.setAttribute('transform',hpTransform);}
      if(w.fill!==fill){w.fill=fill;ref.hpFill.setAttribute('transform',fill);}
      const text=`${short(Math.floor(hp.value))}/${short(egg.spec.health)} HP`;if(ref.hpText.textContent!==text){ref.hpText.textContent=text;this.fit(ref.hpText,text,67,530);ref.hpText.style.strokeWidth='10px';}}
    if(growing){const text=`x${short(luckAt(egg.spec,state.hatchMult,pose.progress))} Luck`;if(ref.luckText.textContent!==text){ref.luckText.textContent=text;this.fit(ref.luckText,text,75,500);}}
    if(this.fontReady&&!ref.font){ref.font=true;this.fit(ref.name,egg.spec.name,75,500);this.fit(ref.rarityText,egg.spec.titanic?'TITANIC':ref.rarity,75,500);}
    if(animated[ref.rarity]&&time-(ref.lastGradient??-Infinity)>1/30){ref.lastGradient=time;this.colors(ref,time);}
  }
  remove(egg){egg.billboard?.svg.remove();egg.billboard=null;}
}
