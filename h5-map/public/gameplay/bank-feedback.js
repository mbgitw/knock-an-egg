import {paidPetImage} from './commerce/paid-species.js';
import {INDEX_DATA} from './index-ui/data.js';
import {cardMotion,bankMotion} from './bank-feedback-motion.js';
import {shopNumber} from './pickaxe-shop.js';

const animals=new Map(INDEX_DATA.zones.flatMap(z=>z.animals).map(a=>[a.name,a]));
const url=path=>new URL(path,import.meta.url).href;
export function bankPetImage(pet){
  const animal=animals.get(pet.name);
  const path=INDEX_DATA.assets[String(animal?.renderId)]||INDEX_DATA.modelRenders?.[pet.name];
  return path?url(path):paidPetImage(pet.name);
}

/** Delivery presentation only: never grants, sells or saves an animal. */
export class BankFeedback {
  constructor(camera){
    this.camera=camera;this.cards=[];this.time=0;this.lastNow=performance.now();this.lastBank=-Infinity;this.flashAge=null;this.baseFov=camera.fov;
    const css=document.createElement('link');css.rel='stylesheet';css.href=url('./bank-feedback.css');css.onload=()=>this.layout();document.head.append(css);this.css=css;
    this.root=document.createElement('div');this.root.id='bank-new-items';this.root.setAttribute('role','status');this.root.setAttribute('aria-live','polite');document.body.append(this.root);
    this.flash=document.createElement('div');this.flash.id='bank-reward-flash';this.flash.hidden=true;this.flash.setAttribute('aria-hidden','true');document.body.append(this.flash);
    this.abort=new AbortController();
    const stop=()=>{if((window.gameHostState?.paused||document.hidden)||window.gameHostState?.paused)this.stop();};

    addEventListener('game-host-pause',stop,{signal:this.abort.signal});
    addEventListener('resize',()=>this.layout(),{signal:this.abort.signal});
    document.fonts.ready.then(()=>this.layout());
  }
  showRewards({cash,speed}){
    // IndexController.showClaimPopup: cash first, then speed; PlaySting only.
    this.show([
      {image:url('./index-ui/cash.png'),text:`$${shopNumber(cash)}`},
      {image:url('./index-ui/speed.webp'),text:`+${shopNumber(speed)}`},
    ],{rewards:true});
  }
  show(pets,{rewards=false}={}){
    if(!Array.isArray(pets)||!pets.length)return;
    if(this.screenEffects!==false&&!rewards&&this.time-this.lastBank>=1.5){
      this.lastBank=this.time;if(this.flashAge===null)this.baseFov=this.camera.fov;
      this.flashAge=0;this.flash.hidden=false;this.flash.style.opacity='1';
      // Sound is enabled only when the exact source asset is recovered.
      this.playSound?.();
    }
    pets.forEach((pet,i)=>{
      const image=rewards?pet.image:bankPetImage(pet);if(!image)return;
      const card=document.createElement('div');card.className='bank-item';
      const display=document.createElement('div');display.className='bank-item-display';
      const img=document.createElement('img');img.className='bank-item-art';img.src=image;img.alt='';img.draggable=false;
      const name=document.createElement('span');name.className='bank-item-name';
      const count=Math.max(1,Math.floor(Number(pet.count)||1));name.textContent=rewards?pet.text:pet.name+(count>1?` x${count}`:'');
      display.append(img,name);card.append(display);this.root.append(card);
      this.cards.push({card,display,name,age:-i*.07,pulse:0,retireAt:3+i*.06});
    });
    this.layout();this.update(0);
  }
  layout(){
    for(const {name} of this.cards){name.style.fontSize='';const h=name.clientHeight;let size=h;name.style.fontSize=`${size}px`;while((name.scrollWidth>name.clientWidth||name.scrollHeight>h+1)&&size>6){name.style.fontSize=`${--size}px`;}}
  }
  pulse(c){
    const glow=document.createElement('img');glow.className='bank-item-glow';glow.src=url('./bank-feedback/glow.png');glow.alt='';c.card.prepend(glow);
    const a=glow.animate([{transform:'translate(-50%,-50%) scale(1.08)',opacity:1},{transform:'translate(-50%,-50%) scale(1.5)',opacity:0}],{duration:1200,easing:'cubic-bezier(.25,.46,.45,.94)'});a.onfinish=()=>glow.remove();
    if(c.pulse%5===0){const ring=document.createElement('i');ring.className='bank-item-ring';c.card.prepend(ring);const b=ring.animate([{transform:'translate(-50%,-50%) scale(1)',opacity:1},{transform:'translate(-50%,-50%) scale(1.3)',opacity:0}],{duration:1400,easing:'cubic-bezier(.39,.575,.565,1)'});b.onfinish=()=>ring.remove();}
    c.pulse++;
  }
  update(dt=null){
    const now=performance.now();if(dt===null)dt=Math.max(0,(now-this.lastNow)/1000);this.lastNow=now;
    this.time+=dt;
    if(this.screenEffects===false&&this.flashAge!==null){this.flashAge=null;this.flash.hidden=true;this.camera.fov=this.baseFov;this.camera.updateProjectionMatrix();}
    if(this.flashAge!==null){this.flashAge+=dt;const m=bankMotion(this.flashAge,this.baseFov);this.flash.style.opacity=String(m.opacity);this.camera.fov=m.fov;this.camera.updateProjectionMatrix();if(m.done){this.flashAge=null;this.flash.hidden=true;}}
    for(const c of [...this.cards]){
      c.age+=dt;const age=c.age>=c.retireAt?3+c.age-c.retireAt:c.age;
      const m=cardMotion(age);c.display.style.transform=`translate(-50%,-50%) scale(${m.scale})`;c.name.style.transform=`translateX(-50%) scale(${m.amountScale})`;
      if(c.age>=.42+c.pulse*.4&&c.age<c.retireAt)this.pulse(c);
      if(m.done){c.card.remove();this.cards.splice(this.cards.indexOf(c),1);}
    }
  }
  stop(){this.lastNow=performance.now();this.flashAge=null;this.flash.hidden=true;this.camera.fov=this.baseFov;this.camera.updateProjectionMatrix();for(const c of this.cards)c.card.remove();this.cards=[];this.lastBank=-Infinity;}
  dispose(){this.stop();this.abort.abort();this.root.remove();this.flash.remove();this.css.remove();}
}
