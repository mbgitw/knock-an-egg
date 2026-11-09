import * as THREE from 'three';
import {SourceGui} from './gcoin-shop/layout-gui.js';
import {applyModelStuds} from './v2-model-studs.js';
import {FreeGiftService} from './free-gift-service.js';
const base=new URL('./free-gift/',import.meta.url);
export class FreeGift {
 static async create(game){const [layout,parts,assets]=await Promise.all([fetch(new URL('layout.json',base)).then(r=>r.json()),fetch(new URL('parts.json',base)).then(r=>r.json()),fetch(new URL('./gcoin-shop/assets.json',import.meta.url)).then(r=>r.json())]);return new FreeGift(game,layout,parts,assets);}
 constructor(game,layout,parts,assets){
  this.game=game;this.service=new FreeGiftService(game);this.point=new THREE.Vector3(-72.869,.434,-74.048);this.opened=false;this.wasNear=false;
  const css=document.createElement('link');css.rel='stylesheet';css.href=new URL('./free-gift.css',import.meta.url);document.head.append(css);
  this.root=document.createElement('div');this.root.id='free-gift';this.root.hidden=true;this.panel=document.createElement('section');this.panel.className='gift-stage';this.panel.setAttribute('role','dialog');this.panel.setAttribute('aria-modal','true');this.panel.setAttribute('aria-label','Free Reward');this.root.append(this.panel);document.body.append(this.root);
  this.gui=new SourceGui(layout,{...assets,'117732208807958':'88766775715844.png','136393561370347':'../inventory-ui/bevel.png','96154824437669':'../inventory-ui/diamond.png'},{plainText:true});
  this.panel.append(this.gui.create(layout,{x:0,y:0,w:1000,h:1000/1.74244094}));this.get=p=>this.gui.byPath.get('/GroupReward/'+p);
  this.get('ToDoList').el.hidden=true;
  this.gui.setText(this.get('Title'),'ONE TIME!');this.gui.setText(this.get('Claim/Title'),'Watch Ad & Claim!');
  for(const r of this.gui.texts){if(r.node.props.Name==='Inner')r.el.hidden=true;else {r.text.hidden=false;Object.assign(r.text.style,{color:r.path==='/GroupReward/Amount'?'#00b9f2':r.path==='/GroupReward/Title'?'#ff626a':'white',fontFamily:'ShopRubik, Arial, sans-serif',fontWeight:'900',textShadow:'none',filter:'none',webkitTextStroke:'5px black',paintOrder:'stroke fill'});}}
  this.message=document.createElement('div');this.message.className='gift-message';this.panel.append(this.message);
  this.claim=this.get('Claim').el;this.claim.onclick=()=>this.redeem();this.get('TopBar/Close').el.onclick=()=>this.close();
  addEventListener('resize',()=>this.resize());addEventListener('keydown',e=>{if(this.opened&&e.code==='Escape'){e.preventDefault();this.close();}});
  this.root.addEventListener('keydown',e=>{e.stopPropagation();if(e.code==='Escape')this.close();if(e.code==='Tab'){e.preventDefault();(document.activeElement===this.claim?this.get('TopBar/Close').el:this.claim).focus();}});
  for(const event of ['pointerdown','pointerup','touchstart','wheel'])this.root.addEventListener(event,e=>e.stopPropagation(),{passive:true});
  this.model=new THREE.Group();this.model.visible=game.account.data.freeGift?.claimed!==true;this.model.position.copy(this.point);game.scene.add(this.model);
  // The original white pedestal was baked into the map; it now follows this player's claim state.
  this.pedestal=new THREE.Mesh(new THREE.CylinderGeometry(4.6993,4.6993,.294,48),new THREE.MeshStandardMaterial({color:0xffffff,roughness:.8}));this.pedestal.position.set(-72.2237,.433633,-74.2926);this.pedestal.visible=this.model.visible;applyModelStuds(this.pedestal);game.scene.add(this.pedestal);
  for(const p of parts.filter(p=>p.className==='Part')){const mesh=new THREE.Mesh(new THREE.BoxGeometry(...p.size),new THREE.MeshStandardMaterial({color:p.color,roughness:.75}));mesh.applyMatrix4(new THREE.Matrix4().set(...p.matrix,0,0,0,1));mesh.position.sub(this.point);this.model.add(mesh);}applyModelStuds(this.model);
  // Original three GiftDetail UnionOperations have no exported triangles. Ribbon
  // reconstruction preserves the reference bow silhouette; it is not original CSG.
  const gold=new THREE.MeshStandardMaterial({color:0xffdf00,roughness:.55,emissive:0x665000,emissiveIntensity:.25});
  for(const size of [[4.65,1.0336,1.0336],[1.0336,1.0336,4.65]]){const band=new THREE.Mesh(new THREE.BoxGeometry(...size),gold);band.position.y=3.6174;band.rotation.y=Math.PI/2+.2618;this.model.add(band);}
  const ribbon=(points,width=.22)=>{const verts=[],idx=[];for(let i=0;i<points.length;i++){const p=new THREE.Vector3(...points[i]),prev=new THREE.Vector3(...points[Math.max(0,i-1)]),next=new THREE.Vector3(...points[Math.min(points.length-1,i+1)]),t=next.sub(prev).normalize(),n=new THREE.Vector3(-t.y,t.x,0).multiplyScalar(width);verts.push(...p.clone().add(n).toArray(),...p.clone().sub(n).toArray());if(i)idx.push(i*2-2,i*2-1,i*2,i*2-1,i*2+1,i*2);}const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(verts,3));g.setIndex(idx);g.computeVertexNormals();const mat=gold.clone();mat.side=THREE.DoubleSide;const mesh=new THREE.Mesh(g,mat);mesh.rotation.y=Math.PI/2;this.model.add(mesh);};
  ribbon([[0,4.3,0],[-1,5.7,0],[-2.1,6.1,0],[-2.8,5.6,0],[-2.5,4.7,0],[-1.3,4.3,0],[0,4.3,0],[1.3,4.7,0],[2.6,5.8,0],[2.1,6.2,0],[1.2,6,0],[0,4.3,0]]);
  ribbon([[-3.4,3.8,0],[-1.5,4.3,0],[0,4.4,0],[1.7,4,0],[3.5,3.6,0]],.18);
  const glowCanvas=document.createElement('canvas');glowCanvas.width=glowCanvas.height=128;const ctx=glowCanvas.getContext('2d'),g=ctx.createRadialGradient(64,64,3,64,64,64);g.addColorStop(0,'#eaff8b');g.addColorStop(.55,'#8aff00aa');g.addColorStop(1,'#70ff0000');ctx.fillStyle=g;ctx.fillRect(0,0,128,128);
  this.glow=new THREE.Mesh(new THREE.PlaneGeometry(12,12),new THREE.MeshBasicMaterial({map:new THREE.CanvasTexture(glowCanvas),transparent:true,depthWrite:false,blending:THREE.AdditiveBlending,side:THREE.DoubleSide}));this.glow.rotation.x=-Math.PI/2;this.glow.position.copy(this.point).add(new THREE.Vector3(0,.18,0));game.scene.add(this.glow);
  const star=document.createElement('canvas');star.width=star.height=64;const c=star.getContext('2d');c.fillStyle='white';c.beginPath();for(let i=0;i<8;i++){const a=i*Math.PI/4,r=i%2?5:31;c.lineTo(32+Math.cos(a)*r,32+Math.sin(a)*r);}c.closePath();c.fill();const map=new THREE.CanvasTexture(star);
  this.stars=Array.from({length:16},(_,i)=>{const s=new THREE.Sprite(new THREE.SpriteMaterial({map,transparent:true,depthWrite:false,blending:THREE.AdditiveBlending,color:0xf5ffae}));game.scene.add(s);return s;});
  this.label=document.createElement('button');this.label.className='free-gift-label';this.label.textContent='FREE!';this.label.setAttribute('aria-label','Open free reward');this.label.onclick=()=>{if(this.near)this.open();};document.body.append(this.label);
  this.resize();css.onload=()=>document.fonts.ready.then(()=>this.gui.fitAll());document.fonts.ready.then(()=>this.gui.fitAll());
 }
 resize(){this.panel.style.setProperty('--gift-scale',Math.min(innerWidth*.88/1000,innerHeight*.76/(1000/1.74244094)));this.gui.fitAll();}
 open(){const g=this.game;if(this.opened||g.player.inputLocked||g.player.training||g.player.carryingAnimal||g.commerce?.busy)return;g.pickaxes.close();g.pickaxes.externalModal=this;g.pickaxes.auto=false;g.pickaxes.clock.cancel();g.player.inputLocked=true;g.player.controls.enabled=false;g.player.keys.clear();g.player.touchMove.set(0,0);this.opened=true;this.root.hidden=false;this.message.textContent='';this.resize();this.claim.focus();}
 close(){if(this.service.busy)return;this.opened=false;this.root.hidden=true;const g=this.game;if(g.pickaxes.externalModal===this){g.pickaxes.externalModal=null;g.player.inputLocked=false;g.player.controls.enabled=true;g.pickaxes.refresh();}}
 async redeem(){if(this.service.busy||this.game.account.data.freeGift?.claimed)return;this.claim.disabled=true;this.message.textContent='Opening video…';const r=await this.service.claim();this.claim.disabled=false;
  this.message.textContent=r.ok?'Claimed! +10K Speed':r.cancelled?'Video not completed. Reward not claimed.':({HOST_UNAVAILABLE:'Please watch the video in the Builda app.',ROOM_UNAVAILABLE:'Connection unavailable. Please retry.',SAVE_PENDING:'Saving reward. Click again to retry.',BUSY:'Please wait and try again.'}[r.error]||'Unable to claim. Please retry.');
  if(r.ok&&!r.already)this.game.pickaxes.bankFeedback.showRewards?.({speed:10000});if(r.ok)this.close();this.update();
 }
 update(){const g=this.game,claimed=g.account.data.freeGift?.claimed===true,t=performance.now()/1000,d=g.player.motor.position.distanceTo(this.point);this.near=d<12;
  this.model.visible=!claimed;this.pedestal.visible=!claimed;
  if(this.near&&!this.wasNear&&!claimed)this.open();this.wasNear=this.near;
  this.claim.disabled=claimed||this.service.busy;const caption=claimed?'Claimed!':this.service.busy?'Please wait…':'Watch Ad & Claim!';if(this.caption!==caption){this.caption=caption;this.gui.setText(this.get('Claim/Title'),caption);}
  this.model.position.y=this.point.y+.35+Math.sin(t*2)*.22;this.model.rotation.y=Math.sin(t*.8)*.2;this.model.rotation.z=Math.sin(t*1.5)*.04;
  this.glow.visible=!claimed&&d<160;this.glow.material.opacity=.65+Math.sin(t*3)*.15;
  this.stars.forEach((s,i)=>{const u=(t*.3+i/16)%1,a=i*2.399;s.visible=!claimed&&d<160;s.position.set(this.point.x+Math.cos(a)*4,this.point.y+u*5,this.point.z+Math.sin(a)*4);s.scale.setScalar(.2+Math.sin(u*Math.PI)*.55);s.material.opacity=Math.sin(u*Math.PI);});
  const p=this.point.clone().add(new THREE.Vector3(0,8,0)).project(g.camera);this.label.hidden=claimed||d>150||p.z>1||p.z< -1||this.opened;this.label.style.left=`${(p.x*.5+.5)*innerWidth}px`;this.label.style.top=`${(.5-p.y*.5)*innerHeight}px`;this.label.style.fontSize=`${Math.max(18,Math.min(58,1700/Math.max(10,d)))}px`;
 }
}
