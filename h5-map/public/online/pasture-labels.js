import * as THREE from 'three';
import {PlayerNames} from './player-names.js';
import {mockPlayerProfile} from './mock-player-profile.js';

// presentation only: query Builda once per identity, never send them through Room.
export class PastureLabels{
  constructor(game,connection){
    Object.assign(this,{game,connection});this.owners=new Map();this.profiles=new Map();this.asked=new Set();
    this.view=new THREE.Vector3();this.projected=new THREE.Vector3();this.ray=new THREE.Ray();this.direction=new THREE.Vector3();this.occlusion=new WeakMap();this.transforms=new WeakMap();
    this.layer=document.createElement('div');this.layer.className='pasture-labels';
    const css=document.createElement('style');css.textContent=`.pasture-labels{position:fixed;top:0;right:0;bottom:0;left:0;pointer-events:none;z-index:1}.pasture-labels [hidden]{display:none!important}.pasture-badge{position:absolute;left:0;top:0;display:flex;align-items:center;flex-direction:column;width:190px;transform-origin:center;pointer-events:none}.pasture-portrait{position:relative;width:72px;height:72px;border:3px solid #000;border-radius:50%;overflow:hidden;background:#416d8a}.pasture-portrait>*{position:absolute;top:0;right:0;bottom:0;left:0;width:100%;height:100%;object-fit:cover}.pasture-owner-name{color:white;font:bold 20px sans-serif;-webkit-text-stroke:3px #000;paint-order:stroke fill;white-space:nowrap;max-width:190px;overflow:hidden;text-overflow:ellipsis}.pasture-home{width:48px;height:48px;object-fit:contain}`;
    this.layer.append(css);document.body.append(this.layer);
    this.playerNames=new PlayerNames(this);
    this.home=document.createElement('img');this.home.className='pasture-badge pasture-home';this.home.src=new URL('./home.png',import.meta.url).href;this.home.alt='我的家';this.home.hidden=true;this.layer.append(this.home);
    this.reconcile();
    this.unobserve=connection.observe(type=>{if(type==='players')this.reconcile();});
    void this.loadSelf();
  }
  async loadSelf(){try{const r=await window.Builda?.whoami({timeoutMs:3000});if(r?.ok&&String(r.data.id)===this.connection.self){this.profiles.set(this.connection.self,{name:r.data.name,avatar:r.data.avatar});this.refreshProfiles();}}catch{}}
  async loadProfiles(ids){
    for(const id of ids){const profile=mockPlayerProfile(id,location.search);if(profile&&!this.profiles.has(id))this.profiles.set(id,profile);}
    this.refreshProfiles();
    const wanted=ids.filter(id=>/^[1-9][0-9]*$/.test(id)&&!this.asked.has(id));if(!wanted.length)return;wanted.forEach(id=>this.asked.add(id));
    try{const r=await window.Builda?.getRoleInfo(wanted,{timeoutMs:3500});if(r?.ok){for(const id of wanted){const p=r.data[id];if(p)this.profiles.set(id,{name:p.userName,avatar:p.userImg});}this.refreshProfiles();}}catch{}
  }
  refreshProfiles(){
    for(const [id,v] of this.owners){const profile=this.profiles.get(id);v.name.textContent=String(profile?.name||id).slice(0,18);let url='';try{const u=new URL(profile?.avatar);if(['https:','http:'].includes(u.protocol))url=u.href;}catch{}if(v.url===url)continue;v.url=url;v.img.hidden=true;v.el.dataset.avatarState=url?'loading':'fallback';if(url)v.img.src=url;else v.img.removeAttribute('src');}
  }
  center(slot){const {data}=this.game.plots,base=data.bases.find(b=>b.id===`Base_${slot+1}`);return new THREE.Vector3().setFromMatrixPosition(new THREE.Matrix4().set(...data.tiers[0].hitbox.matrix)).applyMatrix4(new THREE.Matrix4().set(...base.transform));}
  reconcile(){
    const {players,self}=this.connection,ids=new Set(players.map(p=>p.id));
    for(const [id,v] of this.owners)if(!ids.has(id)){v.img.onload=v.img.onerror=null;v.img.removeAttribute('src');v.el.remove();this.owners.delete(id);}
    for(const p of players){let v=this.owners.get(p.id);if(!v){const el=document.createElement('div');el.className='pasture-badge';el.hidden=true;el.dataset.owner=p.id;
      const portrait=document.createElement('div');portrait.className='pasture-portrait';portrait.innerHTML='<svg viewBox="0 0 72 72" aria-hidden="true"><circle cx="36" cy="27" r="13" fill="#dceef5"/><path d="M10 72v-9a26 26 0 0 1 52 0v9" fill="#dceef5"/></svg>';
      const img=document.createElement('img');img.alt='牧场主人头像';img.crossOrigin='anonymous';img.referrerPolicy='no-referrer';img.hidden=true;img.onload=()=>{img.hidden=false;el.dataset.avatarState='loaded';};img.onerror=()=>{img.hidden=true;el.dataset.avatarState='fallback';};portrait.append(img);
      const name=document.createElement('span');name.className='pasture-owner-name';el.append(portrait,name);this.layer.append(el);v={el,img,name,url:null};this.owners.set(p.id,v);}
      v.position=this.center(p.slot);v.position.y=21.5;v.el.dataset.base=`Base_${p.slot+1}`;
      if(p.id===self){this.homePosition=this.center(p.slot);this.homePosition.y=14;this.home.dataset.base=`Base_${p.slot+1}`;}
    }
    this.refreshProfiles();void this.loadProfiles([...ids]);this.updateBoards();
  }
  updateBoards(){this.game.plotBoards?.setOwner(this.game.plots.data.baseId);}
  place(el,position,size,baseSize,maxScale,home=false){
    // One rect read per frame: reading after the previous label's style write forces layout.
    const {camera,player,canvas}=this.game,rect=this.frameRect??=canvas.getBoundingClientRect();
    this.view.copy(position).applyMatrix4(camera.matrixWorldInverse);this.projected.copy(position).project(camera);
    const x=rect.left+(this.projected.x+1)*rect.width/2,y=rect.top+(1-this.projected.y)*rect.height/2;
    const safe=window.Builda?.runtime?.safeArea?.()||{};
    let hidden=this.view.z>=-camera.near||this.projected.z>1||x<rect.left+(safe.left||0)||x>rect.right-(safe.right||0)||y<rect.top+(safe.top||0)||y>rect.bottom-(safe.bottom||0);
    if(home&&Math.hypot(player.motor.position.x-position.x,player.motor.position.z-position.z)<=10)hidden=true;
    if(!hidden){
      // Occlusion rays walk the whole map octree; 5 Hz per label is enough for a name tag.
      const now=performance.now(),cached=this.occlusion.get(el);
      if(cached&&now-cached.at<200)hidden=cached.hidden;
      else{this.direction.subVectors(position,camera.position);const distance=this.direction.length();this.ray.set(camera.position,this.direction.normalize());const hit=player.world.rayIntersect(this.ray);hidden=!!hit&&hit.distance<distance-.1;this.occlusion.set(el,{at:now,hidden});}
    }
    if(el.hidden!==hidden)el.hidden=hidden;if(hidden)return;
    const scale=Math.min(maxScale,rect.height*camera.projectionMatrix.elements[5]*size/(2*-this.view.z*baseSize)),transform=`translate3d(${x.toFixed(1)}px,${y.toFixed(1)}px,0) translate(-50%,-50%) scale(${scale.toFixed(4)})`;
    if(this.transforms.get(el)!==transform){this.transforms.set(el,transform);el.style.transform=transform;}
  }
  update(){const {game}=this;this.frameRect=null;this.layer.hidden=!!(game.player.inputLocked||game.backpack.opened||game.inventoryUI.opened||game.shopUI?.opened||game.settingsUI?.opened);if(this.layer.hidden)return;game.camera.updateMatrixWorld();for(const v of this.owners.values())this.place(v.el,v.position,4.5,72,1.1);if(this.homePosition)this.place(this.home,this.homePosition,3,48,90/48,true);this.playerNames.update();}
  dispose(){this.unobserve();this.layer.remove();}
}
