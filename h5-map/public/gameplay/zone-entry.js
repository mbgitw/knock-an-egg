import {ZoneEntryState} from './zone-entry-state.js';
import {formatNumber} from '../treadmill-state.js';
import {PLAYER_HEIGHT} from '../world-physics.js';

const base=new URL('./zone-entry/',import.meta.url);
export class ZoneEntrySystem {
  static async create(options){
    const response=await fetch(new URL('config.json',base));if(!response.ok)throw Error('区域提示配置加载失败');
    return new ZoneEntrySystem({...options,config:await response.json()});
  }
  constructor({player,guards,config}){
    Object.assign(this,{player,guards,config});this.state=new ZoneEntryState(config);this.serial=0;
    if(!document.getElementById('zone-entry-style')){
      const link=document.createElement('link');link.id='zone-entry-style';link.rel='stylesheet';link.href=new URL('./zone-entry.css',import.meta.url).href;document.head.append(link);
    }
    this.element=document.createElement('section');this.element.id='zone-entry';this.element.hidden=true;
    this.element.setAttribute('role','status');this.element.setAttribute('aria-live','polite');this.element.setAttribute('aria-atomic','true');
    this.element.innerHTML='<div class="zone-entry-title"><div class="zone-entry-band"></div><div class="zone-entry-title-content"><span class="zone-entry-name"></span><img class="zone-entry-icon" alt=""></div></div><div class="zone-entry-speed"><div class="zone-entry-speed-content"><span>Recommended:</span><img alt=""><strong></strong></div></div>';
    document.body.append(this.element);
    this.title=this.element.querySelector('.zone-entry-title');this.titleContent=this.element.querySelector('.zone-entry-title-content');
    this.name=this.element.querySelector('.zone-entry-name');this.icon=this.element.querySelector('.zone-entry-icon');
    this.speed=this.element.querySelector('.zone-entry-speed');this.speedContent=this.element.querySelector('.zone-entry-speed-content');
    this.speed.querySelector('img').src=new URL(config.speedIcon,base).href;
    this.resizeObserver=new ResizeObserver(()=>this.fit());this.resizeObserver.observe(this.element);
    document.fonts.ready.then(()=>{if(this.element.isConnected)this.fit();});
    this.onVisibility=()=>{if((window.gameHostState?.paused||document.hidden)){this.state.active=null;this.element.hidden=true;}};
    window.addEventListener('game-host-pause',this.onVisibility);
  }
  fit(){
    if(this.element.hidden)return;
    for(const [row,content] of [[this.title,this.titleContent],[this.speed,this.speedContent]]){
      content.style.scale=String(Math.min(1,Math.max(0,row.clientWidth-8)/Math.max(1,content.scrollWidth)));
    }
  }
  update(){
    const p=this.player.motor.position,now=performance.now()/1000;
    const suppressed=!!this.guards.carrying&&this.guards.guards.some(g=>['WindUp','Chasing','Catching'].includes(g.state));
    const active=this.state.update({x:p.x,y:p.y+PLAYER_HEIGHT*.5,z:p.z},now,{suppressed,deferred:!!this.player.inputLocked});
    this.element.dataset.zone=this.state.current||'';
    if(!active){this.element.hidden=true;return;}
    this.element.hidden=false;
    if(active.serial!==this.serial){
      this.serial=active.serial;this.name.textContent=active.zone.name;this.name.dataset.text=active.zone.name;
      this.name.style.setProperty('--zone-gradient',`linear-gradient(to bottom, rgb(${active.zone.colors[0].join(',')}), rgb(${active.zone.colors[1].join(',')}))`);
      this.icon.hidden=!active.zone.icon;if(active.zone.icon)this.icon.src=new URL(active.zone.icon,base).href;
      const amount=this.speed.querySelector('strong');amount.textContent=amount.dataset.text=`${formatNumber(active.zone.requiredPower)} Speed`;
      this.element.dataset.message=active.zone.id;this.fit();
    }
    const age=now-active.start,{enter,hold,exit}=this.config.timing;
    const ease=t=>1-(1-t)**2;
    const slide=age<enter?(1-ease(age/enter))*(-innerHeight*.3-55):0;
    const out=age>hold?ease(Math.min(1,(age-hold)/exit)):0;
    this.element.style.transform=`translate(-50%,${slide}px)`;
    for(const row of [this.title,this.speed]){row.style.opacity=String(1-out);row.style.transform=`translate(-50%,-${out*this.element.clientHeight*.9}px)`;}
  }
  dispose(){this.resizeObserver.disconnect();window.removeEventListener('game-host-pause',this.onVisibility);this.element.remove();}
}
