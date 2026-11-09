import {createPetModel,updatePetAnimation,disposePetModel} from './pet-animation.js';
import {animalVisualScale} from './animal-attributes.js';
import {animalIncome} from './animal-attributes.js';
import {mergeEggImage} from './merge-ui.js';
import * as THREE from 'three';
import {BackpackLayout,MAX_PETS,MAX_SELL,saleSelection} from './backpack-state.js';
import {bankPetImage} from './bank-feedback.js';
import {speciesOf} from './pickaxe-state.js';
import {shopNumber} from './pickaxe-shop.js';

const asset=n=>new URL(`./backpack-ui/${n}`,import.meta.url).href;
const esc=v=>String(v).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export class BackpackUI {
  constructor({pickaxes,weapons,player,scene,canvas}){
    Object.assign(this,{pickaxes,weapons,player,scene,canvas});this.progress=pickaxes.progress;
    this.layout=new BackpackLayout(this.progress.data.pets,this.slotCount,this.progress.data.hotbar);this.selected=new Set();this.opened=false;this.selling=false;this.category='Pets';this.query='';this.version=0;this.held=null;this.model=null;this.savedPose=null;
    this.root=document.createElement('div');this.root.id='original-backpack';
    this.root.innerHTML=`<button id="backpack-toggle" aria-label="Inventory 背包" aria-expanded="false"><img src="${asset('inventoryOff.png')}" alt=""></button>
    <section id="backpack-panel" aria-label="Inventory" role="dialog" tabindex="-1" hidden>
      <h2>All Pets</h2><span id="backpack-capacity"></span><input id="backpack-search" aria-label="Search inventory" placeholder="Search" autocomplete="off">
      <nav><button data-category="Pets" aria-label="Pets"><img src="./gameplay/inventory-ui/paw.png" alt=""><span>Pets</span></button><button data-category="Eggs" aria-label="Eggs"><img src="./gameplay/inventory-ui/egg.png" alt=""><span>Eggs</span></button></nav>
      <button id="backpack-sell"><span>Sell</span></button><button id="backpack-cancel" aria-label="Cancel sale" hidden>X</button><div id="backpack-value" hidden><small>Value:</small><span>$0</span></div>
      <div id="backpack-grid"></div>
    </section><aside id="backpack-info" hidden></aside>`;
    document.body.append(this.root);this.panel=this.root.querySelector('#backpack-panel');this.grid=this.root.querySelector('#backpack-grid');this.toggle=this.root.querySelector('#backpack-toggle');this.info=this.root.querySelector('#backpack-info');this.hotbar=pickaxes.ui.querySelector('.pickaxe-hotbar');
    const css=document.createElement('link');css.rel='stylesheet';css.href=new URL('./backpack-ui.css',import.meta.url).href;document.head.append(css);
    this.abort=new AbortController();const opts={signal:this.abort.signal};
    this.toggle.onclick=()=>this.opened?this.close():this.open();
    this.root.querySelector('#backpack-search').oninput=e=>{this.query=e.target.value;this.render();};
    this.root.querySelector('#backpack-sell').onclick=()=>this.sell();
    this.root.querySelector('#backpack-cancel').onclick=()=>{this.selling=false;this.selected.clear();this.render();};
    this.panel.addEventListener('pointerdown',e=>{if(!e.target.closest('[data-backpack-pet]'))this.info.hidden=true;},opts);
    this.root.querySelectorAll('[data-category]').forEach(b=>b.onclick=()=>{this.category=b.dataset.category;this.render();});
    addEventListener('keydown',e=>{
      if(e.repeat)return;
      if(e.code==='Escape'&&this.opened){e.preventDefault();this.close();return;}
      if(e.target.matches?.('input,textarea,select,[contenteditable=true]'))return;
      if(e.code==='Backquote'){e.preventDefault();this.opened?this.close():this.open();return;}
      if(/^Digit[0-9]$/.test(e.code)){const i=e.code==='Digit0'?9:Number(e.code.slice(-1))-1;if(i>=2&&i<this.layout.limit){e.preventDefault();const id=this.layout.slots[i];if(id)this.clickPet(id);}}
      if(e.code==='Delete'&&this.opened&&this.focused){this.layout.move(this.focused,null);this.unequip();this.render();}
    },opts);
    this.hotbar.addEventListener('click',e=>{const b=e.target.closest('[data-backpack-pet]');if(b&&!this.suppressClick)this.clickPet(b.dataset.backpackPet);},opts);
    this.grid.addEventListener('click',e=>{const b=e.target.closest('[data-backpack-pet]');if(b&&!this.suppressClick)this.clickPet(b.dataset.backpackPet);},opts);
    for(const surface of [this.hotbar,this.grid]){
      surface.addEventListener('pointerdown',e=>this.pointerDown(e),opts);
      surface.addEventListener('pointermove',e=>this.hover(e),opts);
      surface.addEventListener('pointerleave',()=>this.info.hidden=true,opts);
      surface.addEventListener('focusin',e=>{this.focused=e.target.closest('[data-backpack-pet]')?.dataset.backpackPet;},opts);
    }
    addEventListener('pointermove',e=>this.pointerMove(e),{...opts,passive:false});addEventListener('pointerup',e=>this.pointerUp(e),opts);addEventListener('pointercancel',()=>this.cancelDrag(),opts);
    addEventListener('resize',()=>{this.layout.resize(this.slotCount);this.render();},opts);
    addEventListener('blur',()=>this.cancelDrag(),opts);
    this.pickaxes.backpack=this;this.render();
  }
  get slotCount(){return matchMedia('(pointer:coarse)').matches||innerWidth<700?5:10;}
  get blocked(){return !!(this.player.carryingAnimal||this.player.training||this.player.motor.externalMotion||this.pickaxes.busy||this.weapons?.busy||this.pickaxes.modal||this.pickaxes.externalModal&&this.pickaxes.externalModal!==this);}
  open(){
    if(this.player.carryingAnimal||this.player.training||this.player.motor.externalMotion)return;
    this.pickaxes.externalModal?.close?.();this.pickaxes.close();this.pickaxes.externalModal=this;this.pickaxes.auto=false;this.pickaxes.clock.cancel();this.weapons.swingUntil=0;
    this.player.inputLocked=true;this.player.keys.clear();this.player.touchMove.set(0,0);this.player.touches.clear();this.player.controls.enabled=false;
    this.opened=true;this.panel.hidden=false;this.toggle.setAttribute('aria-expanded','true');this.toggle.querySelector('img').src=asset('inventoryOn.png');document.body.dataset.backpackOpen='true';this.render();this.panel.focus();
  }
  close(){
    if(!this.opened)return;this.opened=false;this.panel.hidden=true;this.selling=false;this.selected.clear();this.cancelDrag();this.info.hidden=true;
    if(this.pickaxes.externalModal===this){this.pickaxes.externalModal=null;this.player.inputLocked=false;this.player.controls.enabled=true;}
    this.toggle.setAttribute('aria-expanded','false');this.toggle.querySelector('img').src=asset('inventoryOff.png');delete document.body.dataset.backpackOpen;this.render();this.canvas.focus();
  }
  card(pet,slot=null){
    const image=bankPetImage(pet);const selected=this.selected.has(pet.id);return `<button class="${slot===null?'backpack-pet':'tool-slot backpack-slot'}${selected?' sale-selected':''}" data-backpack-pet="${esc(pet.id)}"${slot===null?'':` data-slot="${slot}"`} aria-label="${esc(pet.name)}" aria-pressed="${this.selling?selected:this.held===pet.id}" title="${esc(pet.name)}"><img src="${image||''}" alt="" draggable="false"><span class="tool-name">${esc(pet.name)}</span>${slot===null?'':`<kbd>${slot===9?0:slot+1}</kbd>`}</button>`;
  }
  render(){
    const focused=document.activeElement?.dataset?.backpackPet;
    const pets=this.progress.data.pets.filter(p=>!this.mergeSystem?.hatchPresentation?.hides(p.id));this.layout.sync(pets);const map=new Map(pets.map(p=>[p.id,p]));
    const hotbar=this.layout.slots.slice(2);if(JSON.stringify(this.progress.data.hotbar)!==JSON.stringify(hotbar)){const previous=this.progress.data.hotbar;this.progress.data.hotbar=hotbar;if(this.progress.account.save()===false)this.progress.data.hotbar=previous;}
    for(const id of this.selected)if(!map.has(id))this.selected.delete(id);
    this.hotbar.querySelectorAll('.backpack-slot,.backpack-empty').forEach(e=>e.remove());
    for(let i=2;i<this.layout.limit;i++){
      const p=map.get(this.layout.slots[i]);if(p)this.hotbar.insertAdjacentHTML('beforeend',this.card(p,i));
      else if(this.opened)this.hotbar.insertAdjacentHTML('beforeend',`<button class="tool-slot backpack-empty" data-slot="${i}" aria-label="Empty slot ${i===9?0:i+1}"><kbd>${i===9?0:i+1}</kbd></button>`);
    }
    this.panel.querySelector('h2').textContent=this.category==='Pets'?'All Pets':'All Eggs';
    this.root.querySelector('#backpack-capacity').textContent=this.category==='Pets'?`Pets: ${pets.length}/${MAX_PETS}`:'';
    this.root.querySelectorAll('[data-category]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.category===this.category)));
    const rows=this.category==='Pets'?this.layout.inventory(pets).filter(p=>p.name.toLowerCase().includes(this.query.toLowerCase())):[];
    const scroll=this.grid.scrollTop;this.grid.innerHTML=rows.map(p=>`<div class="backpack-cell">${this.card(p)}</div>`).join('');this.grid.scrollTop=scroll;
    if(this.category==='Eggs'){this.grid.replaceChildren();for(const egg of this.progress.account.data.mergeEggs||[]){if(!egg.name.toLowerCase().includes(this.query.toLowerCase()))continue;const cell=document.createElement('div');cell.className='backpack-cell';const b=document.createElement('button');b.type='button';b.className='backpack-pet';b.dataset.mergeEgg=egg.id;b.setAttribute('aria-label',egg.name+' Egg');const img=document.createElement('img');img.src=mergeEggImage(egg);img.alt='';const title=document.createElement('span');title.className='tool-name';title.textContent=egg.name+' Egg';b.append(img,title);b.onclick=()=>this.mergeSystem?.equip(egg.id);b.setAttribute('aria-pressed',String(this.mergeSystem?.held===egg.id));cell.append(b);this.grid.append(cell);}}
    this.root.querySelector('#backpack-sell').hidden=this.category==='Eggs';
    this.root.querySelector('#backpack-sell span').textContent=this.selling?'Confirm':'Sell';
    this.root.querySelector('#backpack-sell').setAttribute('aria-pressed',String(this.selling));
    this.root.querySelector('#backpack-cancel').hidden=!this.selling;this.root.querySelector('#backpack-value').hidden=!this.selling;
    this.root.querySelector('#backpack-value span').textContent='$'+shopNumber(saleSelection(pets,this.selected).total.toString());
    this.signature=this.progress.data.pets.map(p=>p.id).join('|');
    if(focused){const target=[...this.root.querySelectorAll('[data-backpack-pet]'),...this.hotbar.querySelectorAll('[data-backpack-pet]')].find(e=>e.dataset.backpackPet===focused);target?.focus({preventScroll:true});}
  }
  clickPet(id){
    if(this.blocked||this.mergeSystem?.hatchPresentation?.hides(id)||!this.progress.data.pets.some(p=>p.id===id))return;
    if(this.selling){if(this.selected.has(id))this.selected.delete(id);else if(this.selected.size<MAX_SELL){this.selected.add(id);if(this.held===id)this.unequip();}this.render();return;}
    if(this.held===id){this.unequip();return;}this.equip(id);
  }
  async equip(id){
    this.mergeSystem?.clearHeld();
    const pet=this.progress.data.pets.find(p=>p.id===id);if(!pet||this.blocked||this.mergeSystem?.hatchPresentation?.hides(id))return false;
    const version=++this.version;
    try{
      const template=await this.pickaxes.eggs.petTemplate(pet.name,pet.variant);
      if(version!==this.version||this.blocked||!this.progress.data.pets.some(p=>p.id===id))return false;
      const model=await createPetModel(template,pet.name).catch(error=>{console.warn('手持动画回退',pet.name,error.message);return template.clone(true);});
      if(version!==this.version||this.blocked||!this.progress.data.pets.some(p=>p.id===id)){disposePetModel(model);return false;}
      disposePetModel(this.model);this.model?.removeFromParent();this.model=model;this.model.scale.multiplyScalar(animalVisualScale(pet));this.scene.add(this.model);this.held=id;this.player.equippedPet=id;
      this.pickaxes.auto=false;this.pickaxes.clock.cancel();this.weapons.swingUntil=0;this.pickaxes.refresh();this.weapons.refresh();this.render();return true;
    }catch(error){console.warn('背包动物模型',error.message);return false;}
  }
  unequip(){this.mergeSystem?.clearHeld();++this.version;this.beginFrame();disposePetModel(this.model);this.model?.removeFromParent();this.model=null;this.held=null;this.player.equippedPet=null;this.pickaxes.refresh();this.weapons.refresh();this.render();}
  sell(){
    if(this.blocked)return;
    if(!this.selling){this.selling=true;this.selected.clear();this.render();return;}
    const ids=[...this.selected];if(this.held&&this.selected.has(this.held))this.unequip();
    this.progress.sellMany(ids);this.selling=false;this.selected.clear();this.pickaxes.refresh();this.render();
  }
  pointerDown(e){
    if(!this.opened||this.selling||e.button!==0)return;const b=e.target.closest('[data-backpack-pet]');if(!b)return;
    this.drag={id:b.dataset.backpackPet,startX:e.clientX,startY:e.clientY,time:performance.now(),touch:e.pointerType==='touch',button:b};
  }
  pointerMove(e){
    const d=this.drag;if(!d)return;const distance=Math.hypot(e.clientX-d.startX,e.clientY-d.startY);
    if(!d.ghost&&d.touch&&performance.now()-d.time<300){if(distance>14)this.cancelDrag();return;}
    if(!d.ghost&&distance>8){d.ghost=d.button.cloneNode(true);d.ghost.className='backpack-drag';document.body.append(d.ghost);this.info.hidden=true;}
    if(d.ghost){e.preventDefault();d.ghost.style.left=e.clientX+'px';d.ghost.style.top=e.clientY+'px';}
  }
  pointerUp(e){
    const d=this.drag;if(!d)return;if(d.ghost){
      const target=document.elementFromPoint(e.clientX,e.clientY);const slot=target?.closest('[data-slot]');const intoInventory=target?.closest('#backpack-panel');
      if(slot)this.layout.move(d.id,Number(slot.dataset.slot));else if(intoInventory||!target?.closest('.pickaxe-hotbar')){this.layout.move(d.id,null);if(this.held===d.id)this.unequip();}
      this.suppressClick=true;setTimeout(()=>this.suppressClick=false,0);this.render();
    }this.cancelDrag();
  }
  cancelDrag(){this.drag?.ghost?.remove();this.drag=null;}
  hover(e){
    if(this.drag?.ghost)return;const b=e.target.closest('[data-backpack-pet]');const pet=this.progress.data.pets.find(p=>p.id===b?.dataset.backpackPet);
    if(!pet){this.info.hidden=true;return;}const s=speciesOf(pet.name);
    this.info.innerHTML=`<strong>${esc(pet.name)}</strong><span>${esc(s.rarity)}</span>${pet.variant?`<span>${esc(pet.variant)}</span>`:''}${Number.isFinite(pet.weightKg)?`<span>${shopNumber(pet.weightKg)} kg</span>`:''}${pet.gender?`<span>${pet.gender==='Male'?'♂ Male':'♀ Female'}</span>`:''}<b>$${shopNumber(animalIncome(pet))}/s</b>`;
    this.info.hidden=false;this.info.style.left=Math.min(innerWidth-this.info.offsetWidth-8,e.clientX+30)+'px';this.info.style.top=Math.max(8,Math.min(innerHeight-this.info.offsetHeight-8,e.clientY-this.info.offsetHeight/2))+'px';
  }
  beginFrame(){if(this.savedPose){for(const [bone,q] of this.savedPose)bone.quaternion.copy(q);this.savedPose=null;}}
  update(dt=0){
    if(this.held&&(this.player.carryingAnimal||this.player.training||this.player.motor.externalMotion||!this.progress.data.pets.some(p=>p.id===this.held)))this.unequip();
    if(this.opened&&(this.player.carryingAnimal||this.player.training))this.close();
    this.toggle.hidden=!!(this.player.carryingAnimal||this.player.training);
    if(this.signature!==this.progress.data.pets.map(p=>p.id).join('|'))this.render();
    if(this.model){
      updatePetAnimation(this.model,dt);
      const yaw=this.player.actor.getWorldQuaternion(new THREE.Quaternion());this.model.quaternion.copy(yaw);
      const arm=this.player.model.getObjectByName('armR'),hand=this.player.model.getObjectByName('handR');
      this.savedPose=[arm,hand].filter(Boolean).map(b=>[b,b.quaternion.clone()]);
      // v2 inventory uses its resting right-hand grip; our actor faces +Z.
      const direction=new THREE.Vector3(-.12,-.3,.95).normalize().applyQuaternion(yaw);
      arm.parent.updateWorldMatrix(true,false);
      arm.quaternion.copy(arm.parent.getWorldQuaternion(new THREE.Quaternion()).invert().multiply(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0,1,0),direction)));
      hand.quaternion.identity();hand.updateWorldMatrix(true,false);
      this.model.position.copy(hand.localToWorld(new THREE.Vector3(0,.00645,0)));
    }
  }
}
