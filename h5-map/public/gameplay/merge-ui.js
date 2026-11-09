import {SourceGui} from './gcoin-shop/layout-gui.js';
import {bankPetImage} from './bank-feedback.js';
import {mergeEggImage} from './merge-egg-image.js';
export {mergeEggImage} from './merge-egg-image.js';
import {mergeWeight} from './merge-state.js';
const rootPath='/MergeMachine',fusion=rootPath+'/AnimalFusion';
const kg=n=>n.toLocaleString('en-US',{maximumFractionDigits:1})+'KG';
export class MergeUI{
 static async create(options){const base=new URL('./merge-ui/',import.meta.url);const [layout,assets]=await Promise.all(['layout.json','assets.json'].map(n=>fetch(new URL(n,base)).then(r=>r.json())));return new MergeUI({...options,layout,assets});}
 constructor({state,pickaxes,player,canvas,onMerged,layout,assets}){
  Object.assign(this,{state,pickaxes,player,canvas,onMerged});this.slots=[null,null,null];this.selecting=null;this.opened=false;
  const all=n=>{if(n.props.Text)n.props.TextWrapped='false';if(n.props.Name!=='Template')n.props.Visible='true';for(const c of n.children)all(c);};all(layout);
  const css=document.createElement('link');css.rel='stylesheet';css.href=new URL('./merge-ui.css',import.meta.url).href;document.head.append(css);
  this.root=document.createElement('div');this.root.id='merge-screen';this.root.hidden=true;this.panel=document.createElement('section');this.panel.className='merge-stage';this.panel.tabIndex=-1;this.panel.setAttribute('role','dialog');this.panel.setAttribute('aria-modal','true');this.panel.setAttribute('aria-label','Merge Pets');this.root.append(this.panel);document.body.append(this.root);
  this.gui=new SourceGui(layout,assets);this.frame=this.gui.create(layout,{x:0,y:0,w:920,h:710.34});this.panel.append(this.frame);
  this.get=root=>this.gui.byPath.get(root);this.get(rootPath+'/ScrollingFrameContainer').el.hidden=true;
  this.list=document.createElement('div');this.list.className='merge-selection';this.list.hidden=true;this.panel.append(this.list);
  this.get(rootPath+'/TopBar/Close').el.onclick=()=>this.selecting!==null?this.showFusion():this.close();
  for(let i=0;i<3;i++){
   const p=fusion+'/PetsPlacementList/Slot_'+(i+1);
   this.get(p+'/AddPet/Add').el.onclick=()=>this.select(i);
   this.get(p+'/AnimalAdded/Remove').el.onclick=()=>{this.slots[i]=null;this.render();};
  }
  this.get(fusion+'/Merge').el.onclick=async()=>{const egg=await this.state.merge(this.slots);if(egg){this.slots=[null,null,null];this.close();this.onMerged(egg);}else this.render();};
  for(const type of ['pointerdown','pointerup','wheel','touchstart','touchmove'])this.root.addEventListener(type,e=>e.stopPropagation(),{passive:true});
  addEventListener('resize',()=>this.resize());addEventListener('keydown',e=>{if(!this.opened)return;if(e.code==='Escape'){e.preventDefault();e.stopImmediatePropagation();this.selecting!==null?this.showFusion():this.close();}else if(e.code==='Tab'){const b=[...this.panel.querySelectorAll('button')].filter(b=>b.getClientRects().length&&!b.disabled),i=b.indexOf(document.activeElement);if(e.shiftKey&&i<=0||!e.shiftKey&&(i<0||i===b.length-1)){e.preventDefault();b[e.shiftKey?b.length-1:0]?.focus();}}else if(!['Enter','Space'].includes(e.code))e.stopImmediatePropagation();},{capture:true});
  css.onload=()=>document.fonts.ready.then(()=>this.gui.fitAll());this.resize();this.render();
 }
 resize(){this.panel.style.setProperty('--merge-scale',Math.min(innerWidth*.94/920,innerHeight*.65/710.34));}
 image(path,url){const r=this.get(path);if(!r)return;let img=r.el.querySelector(':scope > img.merge-animal');if(!img){img=document.createElement('img');img.className='merge-animal';img.alt='';r.el.append(img);}img.src=url||'';img.hidden=!url;r.image?.remove();for(const c of r.el.querySelectorAll('.source-gui'))c.hidden=true;}
 render(){
  const candidates=this.state.candidates;this.slots=this.slots.map(id=>candidates.some(p=>p.id===id)?id:null);const pets=this.slots.map(id=>candidates.find(p=>p.id===id)),count=pets.filter(Boolean).length;
  for(let i=0;i<3;i++){
   const path=fusion+'/PetsPlacementList/Slot_'+(i+1),pet=pets[i];this.get(path+'/AddPet').el.hidden=!!pet;this.get(path+'/AnimalAdded').el.hidden=!pet;
   if(pet){this.gui.setText(this.get(path+'/AnimalAdded/Name'),pet.name);this.gui.setText(this.get(path+'/AnimalAdded/Weight'),'('+kg(mergeWeight(pet))+')');this.image(path+'/AnimalAdded/AnimalDisplay',bankPetImage(pet));}
   const tube=this.get(fusion+'/Tube_'+['Left','Center','Right'][i]);tube.el.dataset.filled=String(!!pet);if(tube.image){const id=(pet?['122487515029734','92798397627127','136895246004208']:['128802052415346','78926622205969','76086504409503'])[i],src=this.gui.assets[id];if(src)tube.image.style.backgroundImage=`url("${new URL(src,new URL('./gcoin-shop/layout-gui.js',import.meta.url)).href}")`;}
  }
  this.gui.setText(this.get(fusion+'/Merge/Title'),count===3?'Merge':count===2?'1 Pet Left':`${3-count} Pets Left`);this.get(fusion+'/Merge').el.disabled=count!==3;
  this.get(fusion+'/OutCome/Weight').el.hidden=!count;this.gui.setText(this.get(fusion+'/OutCome/Weight'),kg(pets.filter(Boolean).reduce((n,p)=>n+mergeWeight(p),0)));
  this.image(fusion+'/OutCome/BlackAnimalDisplay',count?mergeEggImage(pets.find(Boolean).name):null);
  this.get(fusion+'/OutCome/Fill/Bar').el.style.top='0';
  this.get(fusion+'/OutCome/Fill/Bar').el.style.transform=`translateY(${(1-count/3)*100}%)`;
  this.get(fusion+'/OutCome').el.dataset.count=count;
 }
 select(slot){
  this.render();this.selecting=slot;this.get(fusion).el.hidden=true;this.list.hidden=false;this.list.replaceChildren();const title=document.createElement('h3');title.textContent='Select Pet to Merge';this.list.append(title);
  const name=this.state.candidates.find(p=>this.slots.includes(p.id))?.name,rows=this.state.candidates.filter(p=>!this.slots.includes(p.id)&&(!name||p.name===name));
  if(!rows.length){const empty=document.createElement('p');empty.textContent='NO PETS';this.list.append(empty);}
  for(const pet of rows){const b=document.createElement('button');b.className='merge-pet';b.dataset.petId=pet.id;const img=document.createElement('img');img.src=bankPetImage(pet)||'';img.alt='';const n=document.createElement('strong');n.textContent=pet.name;const w=document.createElement('b');w.textContent='('+kg(mergeWeight(pet))+')';b.append(img,n,w);b.onclick=()=>{if(this.state.candidates.some(p=>p.id===pet.id)&&!this.slots.includes(pet.id)){this.slots[slot]=pet.id;}this.showFusion();};this.list.append(b);}
 }
 showFusion(){this.selecting=null;this.list.hidden=true;this.get(fusion).el.hidden=false;this.render();}
 open(){if(this.player.training||this.player.carryingAnimal||this.player.motor.externalMotion)return;this.pickaxes.externalModal?.close?.();this.pickaxes.close();this.pickaxes.externalModal=this;this.pickaxes.auto=false;this.pickaxes.clock.cancel();this.player.keys.clear();this.player.touchMove.set(0,0);this.player.touches.clear();this.player.inputLocked=true;this.player.controls.enabled=false;this.root.hidden=false;this.opened=true;this.showFusion();this.pickaxes.refresh();this.panel.focus();}
 close(){if(!this.opened)return;this.opened=false;this.root.hidden=true;if(this.pickaxes.externalModal===this){this.pickaxes.externalModal=null;this.player.inputLocked=false;this.player.controls.enabled=true;}this.pickaxes.refresh();this.canvas.focus();}
}
