import {setLanguage,onLanguageChange} from '../i18n.js';
import {SourceGui,rgb} from './gcoin-shop/layout-gui.js';
import {SETTINGS_DEFAULTS} from './settings-state.js';
const assets={'116016239612262':'116016239612262.png','96154824437669':'../inventory-ui/diamond.png','136393561370347':'../inventory-ui/bevel.png'};
export class SettingsUI {
  static async create(options){const r=await fetch(new URL('./settings-ui/layout.json',import.meta.url));if(!r.ok)throw Error('Settings layout unavailable');return new SettingsUI({...options,layout:await r.json()});}
  constructor({state,layout,player,pickaxes,canvas}){
    Object.assign(this,{state,player,pickaxes,canvas});this.opened=false;
    const css=document.createElement('link');css.rel='stylesheet';css.href=new URL('./settings-ui.css',import.meta.url);document.head.append(css);
    this.button=document.createElement('button');this.button.id='settings-button';this.button.type='button';this.button.setAttribute('aria-label','Settings');this.button.setAttribute('aria-haspopup','dialog');this.button.setAttribute('aria-expanded','false');
    this.button.innerHTML='<svg viewBox="0 0 32 32" aria-hidden="true"><path d="M13 2h6l1 4 3 2 4-1 3 5-3 3v3l3 3-3 5-4-1-3 2-1 4h-6l-1-4-3-2-4 1-3-5 3-3v-3l-3-3 3-5 4 1 3-2Z" fill="white"/><circle cx="16" cy="16.5" r="5" fill="#353739"/></svg>';
    document.body.append(this.button);this.button.onclick=()=>{this.button.firstChild.animate([{transform:'rotate(0)'},{transform:'rotate(360deg)'}],{duration:500,easing:'cubic-bezier(.175,.885,.32,1.275)'});this.opened?this.close():this.open();};
    this.root=document.createElement('div');this.root.id='game-settings';this.root.hidden=true;this.panel=document.createElement('section');this.panel.className='settings-stage';this.panel.tabIndex=-1;this.panel.setAttribute('role','dialog');this.panel.setAttribute('aria-modal','true');this.panel.setAttribute('aria-label','Settings');this.root.append(this.panel);document.body.append(this.root);
    this.gui=new SourceGui(layout,assets);this.panel.append(this.gui.create(layout,{x:0,y:0,w:1000,h:1000/1.19968426}));
    this.get=p=>this.gui.byPath.get('/Settings/'+p);
    // Honor the project text rule: one fill and black stroke, no offset duplicate.
    for(const r of this.gui.texts){if(r.node.props.Name==='Inner'){r.el.hidden=true;continue;}Object.assign(r.text.style,{color:rgb(r.node.children.find(n=>n.className==='TextLabel'&&n.props.Name==='Inner')?.props.TextColor3||r.node.props.TextColor3),backgroundImage:'none',filter:'none',textShadow:'none',webkitTextStroke:`${r.path.endsWith('/TopBar/Title')?5:2.5}px black`,paintOrder:'stroke fill'});if(r.node.props.FontFace?.Family?.url==='asset://12187365977')r.text.style.fontFamily='ShopRubik';}
    this.closeButton=this.get('TopBar/Close').el;this.closeButton.setAttribute('aria-label','Close Settings');this.closeButton.onclick=()=>this.close();
    this.gui.scroll.setAttribute('aria-label','Settings list');this.controls=new Map();
    for(const [key,value] of Object.entries(SETTINGS_DEFAULTS)){
      if(key==='Language')continue;
      if(window.Builda?.audio&&['MusicVolume','SfxVolume'].includes(key)){const row=this.get(`SettingsList/${key}`).el;row.hidden=true;row.style.display='none';continue;}
      const prefix=`SettingsList/${key}/Container/`;
      if(typeof value==='number'){
        const bar=this.get(prefix+'DragBar'),knob=this.get(prefix+'DragBar/DragButton'),fill=this.get(prefix+'DragBar/Fill');
        const el=knob.el;el.setAttribute('role','slider');el.setAttribute('aria-label',key==='MusicVolume'?'Music':'SFX');el.setAttribute('aria-valuemin','0');el.setAttribute('aria-valuemax','100');bar.el.style.pointerEvents='auto';bar.el.style.touchAction='none';
        const apply=e=>{const rect=bar.el.getBoundingClientRect();this.state.set(key,(e.clientX-rect.left)/rect.width);};
        bar.el.onpointerdown=e=>{if(e.button!==0)return;e.preventDefault();bar.el.setPointerCapture(e.pointerId);this.drag={key,bar,id:e.pointerId};apply(e);};
        bar.el.onpointermove=e=>{if(this.drag?.id===e.pointerId&&this.drag.key===key)apply(e);};
        const end=()=>{this.drag=null;this.state.flush();};bar.el.onpointerup=end;bar.el.onpointercancel=end;bar.el.onlostpointercapture=end;
        el.onkeydown=e=>{const delta={ArrowLeft:-.01,ArrowDown:-.01,ArrowRight:.01,ArrowUp:.01,PageDown:-.1,PageUp:.1}[e.key];if(delta!==undefined||e.key==='Home'||e.key==='End'){e.preventDefault();e.stopPropagation();this.state.set(key,e.key==='Home'?0:e.key==='End'?1:this.state.get(key)+delta);}};
        this.controls.set(key,()=>{const v=this.state.get(key);el.style.left=`${bar.rect.w*v-knob.rect.w/2}px`;fill.el.style.width=`${bar.rect.w*v}px`;el.setAttribute('aria-valuenow',String(Math.round(v*100)));});
      }else{
        const toggle=this.get(prefix+'Toggle'),knob=this.get(prefix+'Toggle/ToggleOn'),label=this.get(prefix+'Toggle/Title'),onX=knob.rect.x,offX=toggle.rect.w-onX-knob.rect.w,onImage=knob.el.style.backgroundImage;
        toggle.el.setAttribute('role','switch');toggle.el.setAttribute('aria-label',this.get(prefix+'Title').text.textContent);toggle.el.onclick=()=>this.state.set(key,!this.state.get(key));knob.el.style.transition='left .18s cubic-bezier(.175,.885,.32,1.275),background-color .18s';
        this.controls.set(key,()=>{const v=this.state.get(key);toggle.el.setAttribute('aria-checked',String(v));knob.el.style.left=(v?onX:offX)+'px';knob.el.style.backgroundImage=v?onImage:'linear-gradient(0deg,#d53333,#ff603f)';this.gui.setText(label,v?'ON':'OFF');});
      }
    }
    const content=this.gui.scroll.querySelector('.source-content');
    if(window.Builda?.audio){const removed=['MusicVolume','SfxVolume'].map(key=>this.get(`SettingsList/${key}`));for(const child of content.children){if(child.hidden)continue;const top=parseFloat(child.style.top)||0;child.style.top=(top-removed.filter(r=>r.rect.y<top).reduce((n,r)=>n+r.rect.h,0))+'px';}content.style.height=(parseFloat(content.style.height)-removed.reduce((n,r)=>n+r.rect.h,0))+'px';}
    const row=document.createElement('div');row.className='settings-language';row.style.top='0px';
    for(const child of content.children)child.style.top=(parseFloat(child.style.top||'0')+125)+'px';
    const label=document.createElement('span');label.textContent='Language';row.append(label);
    const options=document.createElement('div');options.className='settings-language-options';row.append(options);
    this.languageButtons=[];
    for(const [value,title] of [['auto','Follow device'],['zh','中文'],['en','English']]){
      const button=document.createElement('button');button.type='button';button.textContent=title;button.setAttribute('aria-label',title);button.onclick=()=>{state.set('Language',value);state.flush();};options.append(button);this.languageButtons.push([value,button]);
    }
    content.append(row);content.style.height=(parseFloat(content.style.height)+125)+'px';
    this.refresh();state.observe((key,value)=>{if(key==='Language')setLanguage(value);this.refresh();});
    onLanguageChange(()=>{queueMicrotask(()=>this.gui.fitAll());this.refresh();});
    for(const type of ['pointerdown','pointerup','wheel','touchstart','touchmove'])this.root.addEventListener(type,e=>e.stopPropagation(),{passive:true});
    this.root.addEventListener('keydown',e=>{e.stopPropagation();if(e.code==='Escape'){e.preventDefault();this.close();}if(e.code==='Tab'){const all=[...this.panel.querySelectorAll('button,[role=slider],[role=switch]')].filter(el=>!el.closest('[hidden]'));const i=all.indexOf(document.activeElement);e.preventDefault();all[(i+(e.shiftKey?-1:1)+all.length)%all.length]?.focus();}});
    addEventListener('resize',()=>this.resize());css.onload=()=>document.fonts.ready.then(()=>this.gui.fitAll());this.resize();this.gui.fitAll();
  }
  refresh(){for(const [value,button] of this.languageButtons||[]){button.setAttribute('aria-pressed',String(this.state.get('Language')===value));}for(const apply of this.controls.values())apply();}
  resize(){const mobile=innerWidth<600||innerHeight<480;this.panel.style.setProperty('--settings-scale',Math.min(innerWidth*(mobile?.9:.7),innerHeight*(mobile?.78:.625)*1.19968426)/1000);}
  open(){if(this.opened||this.player.training)return;this.pickaxes.externalModal?.close?.();this.pickaxes.close();this.pickaxes.externalModal=this;this.pickaxes.auto=false;this.pickaxes.clock.cancel();this.pickaxes.refresh();this.player.inputLocked=true;this.player.keys.clear();this.player.touchMove.set(0,0);this.player.touches.clear();this.player.controls.enabled=false;this.opened=true;this.root.hidden=false;this.button.setAttribute('aria-expanded','true');document.body.dataset.shopOpen='true';this.canvas.dataset.shopOpen='true';this.resize();this.gui.fitAll();this.closeButton.focus();}
  close(){if(!this.opened)return;this.drag=null;this.state.flush();this.opened=false;this.root.hidden=true;this.button.setAttribute('aria-expanded','false');if(this.pickaxes.externalModal===this){this.pickaxes.externalModal=null;this.pickaxes.refresh();delete document.body.dataset.shopOpen;this.canvas.dataset.shopOpen='false';}if(!this.pickaxes.modal&&!this.pickaxes.externalModal){this.player.inputLocked=false;this.player.controls.enabled=true;}this.button.focus();}
}
