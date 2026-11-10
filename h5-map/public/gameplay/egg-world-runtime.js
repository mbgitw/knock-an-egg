import {createPetModel,updatePetAnimation,disposePetModel} from './pet-culling.js';
import {variantTemplate} from './animal-variants.js';
import {animalGlbTemplate} from './animal-glb-runtime.js';
import {animalVisualScale} from './animal-attributes.js';
import {TitanicState} from './titanic-state.js';
import {TitanicBoard} from './titanic-board.js';
import * as THREE from 'three';
import {OBJLoader} from '../vendor/OBJLoader.js';
import {MTLLoader} from '../vendor/MTLLoader.js';
import {loadSceneResource} from '../scene-resource.js';
import {loadV2LiveEgg} from './v2-live-egg.js';
import {eggAmbientCatalog,createEggAmbient} from './egg-ambient.js';
import {EggLightPool} from './egg-light-pool.js';
import {EggNestInstances} from './egg-nest-instances.js';
import {Capsule} from '../vendor/Capsule.js';
import {EggSpawnState,eggSpec} from './egg-spawn-state.js';
import {EggLife} from './pickaxe-state.js';
import {EggPlacementObstacles} from './egg-placement-obstacles.js';
import {EGG_CONFIG as C} from './eggs/runtime-config.js';
import {PRESENTATION as P} from './egg-presentation/config.js';
import {EggPresentationState,EggCullQuality,hatchRevealTime,petPose,quadOut,clamp} from './egg-presentation-state.js';
import {EggBillboards} from './egg-billboards.js';
import {EggFeedback,shellAppearance,disposeShellAppearance} from './egg-feedback.js';

const base='gameplay/eggs/';
async function json(path){const r=await fetch(base+path);if(!r.ok)throw Error(`蛋刷新资源 ${path}: ${r.status}`);return r.json();}
const names={'Forest Egg':'森林蛋','Rock Egg':'岩石蛋','Swamp Egg':'沼泽蛋','Cactus Egg':'仙人掌蛋','Bones Egg':'骨头蛋','Frozen Egg':'冰冻蛋','Frosty Egg':'霜冻蛋','Rainbow Egg':'彩虹蛋','Easter Bunny Egg':'复活节兔子蛋','Gooey Egg':'黏液蛋','Lake Egg':'湖泊蛋','Sea Stones Egg':'海石蛋','Water Egg':'水蛋','Volcanic Egg':'火山蛋','Scorpion Egg':'蝎子蛋','Yeti Egg':'雪怪蛋','Candy Egg':'糖果蛋','Tree Egg':'树木蛋','Sea Egg':'海洋蛋','Angel Egg':'天使蛋','Fallen Angel Egg':'堕落天使蛋','Bamboo Egg':'竹子蛋','Blossom Egg':'樱花蛋','Fortune Egg':'幸运蛋','Starry Egg':'星空蛋','Sun Egg':'太阳蛋','BlackHole Egg':'黑洞蛋','Plasma Egg':'等离子蛋','Nebula Egg':'星云蛋','Supernova Egg':'超新星蛋'};
export const isOriginalEggPart=path=>/^\/Workspace\/Build\/ZoneBuilds\/Zone\d+\/Eggs\//.test(path);
export class EggWorld {
  static async create(scene,progress,{world,player,canvas,camera,mapParts=[]}={}){
    const system=new EggWorld(scene,progress,{world,player,canvas,camera});system.placementObstacles=new EggPlacementObstacles(mapParts);await system.loadAssets();system.initialize();return system;
  }
  constructor(scene,progress,{world,player,canvas,camera}={}){
    Object.assign(this,{scene,progress,world,player,canvas});this.eggs=[];this.reveals=[];this.petCache=new Map();this.materials=new Map();this.textures=new Map();this.templates=new Map();this.nests=new Map();
    this.ray=new THREE.Ray(new THREE.Vector3(),new THREE.Vector3(0,-1,0));this.capsule=new Capsule(new THREE.Vector3(),new THREE.Vector3(),1);this.dirty=false;
    this.camera=camera;this.time=0;this.quality=new EggCullQuality();this.billboards=camera?new EggBillboards(camera):null;this.feedback=camera?new EggFeedback(scene,camera):null;
    this.cameraPoint=new THREE.Vector3();this.localPoint=new THREE.Vector3();this.homeZone=0;this.lastCull=-Infinity;
    this.ambientLights=new EggLightPool(scene);
    this.nestInstances=new EggNestInstances(scene);
  }
  material(spec){
    const key=JSON.stringify([spec.color,spec.texture,spec.normal,spec.opacity]);if(this.materials.has(key))return this.materials.get(key);
    const load=(file,color)=>{if(!file)return null;if(!this.textures.has(file)){const t=new THREE.TextureLoader().load(base+file);if(color)t.colorSpace=THREE.SRGBColorSpace;t.wrapS=t.wrapT=THREE.RepeatWrapping;this.textures.set(file,t);}return this.textures.get(file);};
    const material=new THREE.MeshStandardMaterial({color:new THREE.Color().setRGB(...spec.color),map:load(spec.texture,true),normalMap:load(spec.normal,false),side:THREE.DoubleSide,roughness:.9,metalness:0,transparent:spec.opacity<1,opacity:spec.opacity,alphaTest:.01,depthWrite:spec.opacity>=1});
    this.materials.set(key,material);return material;
  }
  model(data){
    const root=new THREE.Group(),batches=new Map();
    for(const part of data.meshes)for(const group of part.groups){
      const material=this.material(group.material);if(!batches.has(material))batches.set(material,{positions:[],normals:[],uvs:[]});const b=batches.get(material);
      for(let i=group.start;i<group.start+group.count;i++){b.positions.push(...part.positions.slice(i*3,i*3+3));b.normals.push(...part.normals.slice(i*3,i*3+3));b.uvs.push(...part.uvs.slice(i*2,i*2+2));}
    }
    for(const [material,b] of batches){const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(b.positions,3));g.setAttribute('normal',new THREE.Float32BufferAttribute(b.normals,3));g.setAttribute('uv',new THREE.Float32BufferAttribute(b.uvs,2));root.add(new THREE.Mesh(g,material));}return root;
  }
  async loadAssets(){
    this.ambientData=await eggAmbientCatalog();
    await Promise.all(C.templates.filter(t=>t.available).map(async t=>{
      if(!t.replacement){this.templates.set(t.id,this.model(await json(`models/${t.id}.json`)));return;}
      const source=await loadV2LiveEgg(t.replacement,new URL(base,location.href));
      const bounds=new THREE.Box3().setFromObject(source),size=bounds.getSize(new THREE.Vector3()),center=bounds.getCenter(new THREE.Vector3());
      if(bounds.isEmpty()||size.y<=0)throw Error('空蛋模型 '+t.id);
      const normalized=new THREE.Group();normalized.add(source);source.position.sub(new THREE.Vector3(center.x,bounds.min.y,center.z));normalized.scale.setScalar(1/size.y);
      const template=new THREE.Group();template.add(normalized);this.templates.set(t.id,template);
    }));
    await Promise.all(C.zones.filter(z=>z.availableTiers.length).map(async z=>{const d=await json(`models/nest-${z.zone}.json`);this.nests.set(z.zone,{model:this.model(d),heightRatio:d.heightRatio});}));
  }
  ground(x,z){
    const world=this.player?.world||this.world;if(!world)return .5;this.ray.origin.set(x,7,z);this.ray.direction.set(0,-1,0);const hit=world.rayIntersect(this.ray);
    if(!hit||hit.position.y<-.1||hit.position.y>2||hit.triangle.getNormal(new THREE.Vector3()).y<.7)return null;return hit.position.y;
  }
  canPlace(spec){
    if(this.placementObstacles&&!this.placementObstacles.clear(spec))return false;
    const world=this.player?.world||this.world;if(!world)return true;const [x,,z]=spec.position,r=Math.min(spec.radius,spec.bodyHeight*.43),y=spec.floorY;
    this.capsule.radius=r;this.capsule.start.set(x,y+r+.08,z);this.capsule.end.set(x,y+Math.max(r,spec.bodyHeight-r)+.08,z);
    const hit=world.capsuleIntersect(this.capsule);if(hit&&hit.depth>.025)return false;
    for(let i=0;i<8;i++){
      const a=i*Math.PI/4,dx=Math.cos(a),dz=Math.sin(a),floor=this.ground(x+dx*spec.radius,z+dz*spec.radius);
      if(floor===null||Math.abs(floor-y)>.35)return false;
      this.ray.set(new THREE.Vector3(x,y+Math.max(1,spec.bodyHeight*.5),z),new THREE.Vector3(dx,0,dz));
      const obstruction=world.rayIntersect(this.ray);if(obstruction&&obstruction.distance<spec.radius+.15)return false;
    }return true;
  }
  initialize(){
    this.titanicBoard=this.camera?new TitanicBoard(this.scene):null;
    if(this.progress.account.online){this.state={eggs:[],update(){},zoneEggs(zone){return this.eggs.filter(e=>e.spec.zone===zone);}};this.titanic={eggs:[],update(){},nextAt:Infinity};return;}
    this.state=new EggSpawnState({sampleGround:(x,z)=>this.ground(x,z),canPlace:s=>this.canPlace(s),nestHeightRatio:z=>this.nests.get(z)?.heightRatio||.256,
      onSpawn:e=>this.add(e),onRemove:e=>this.remove(e),onChange:()=>{this.progress.data.worldEggs=this.state.snapshot();this.dirty=true;}});
    this.state.initialize(this.progress.data.worldEggs,Date.now()/1000);
    this.titanic=new TitanicState(this.state,{onSpawn:e=>this.add(e),onRemove:e=>this.remove(e),onChange:()=>{this.progress.data.titanic=this.titanic.snapshot();this.dirty=true;},onAnnounce:e=>this.titanicBoard?.announce(e,Date.now()/1000)});
    this.titanic.initialize(this.progress.data.titanic,Date.now()/1000);
    const ordinaryLegal=this.state.legal.bind(this.state);
    this.state.legal=(s,others)=>ordinaryLegal(s,[...(others??this.state.zoneEggs(s.zone)),...this.titanic.eggs.filter(e=>e.spec.zone===s.zone)]);
    this.eggs=[...this.state.eggs,...this.titanic.eggs];if(this.dirty){this.progress.account.save();this.dirty=false;}
  }
  add(egg){
    const s=egg.spec,root=new THREE.Group();root.name=names[s.name]||s.name;root.position.set(s.position[0],s.bodyBottom,s.position[2]);root.rotation.y=s.yaw;
    const shell=this.templates.get(s.typeId).clone(true);shell.scale.setScalar(s.bodyHeight);root.add(shell);this.scene.add(root);root.updateMatrixWorld(true);
    const bounds=new THREE.Box3().setFromObject(root),center=bounds.getCenter(new THREE.Vector3()),nest=this.nests.get(s.zone).model.clone(true);
    nest.position.set(s.position[0],s.floorY-s.nestHeight*C.spawn.NestBuryFraction,s.position[2]);nest.scale.setScalar(s.nestWidth);nest.rotation.y=s.yaw;this.scene.add(nest);
    const nestBox=new THREE.Box3().setFromObject(nest);
    this.nestInstances.add(nest,s.zone,this.nests.get(s.zone).model);
    Object.assign(egg,{root,shell,nest,bounds,center,shake:0,nestBaseY:nest.position.y,nestBottomY:nestBox.min.y,presentation:new EggPresentationState(s,this.time)});root.traverse(o=>{o.userData.egg=egg;});this.billboards?.add(egg);
  }
  remove(egg){
    this.nestInstances.remove(egg.nest);
    egg.removed=true;egg.ambient?.dispose();egg.stopRumble?.();this.billboards?.remove(egg);disposeShellAppearance(egg);egg.root?.removeFromParent();egg.nest?.removeFromParent();
    // A background tab can reach the wall-clock respawn before the visual timeline.
    // Preserve the rolled animal and finish its own reveal instead of losing it with the egg.
    if(egg.pet&&!egg.opened){egg.opened=true;this.reveal(egg.pet,egg).catch(error=>{this.progress.abandon(egg.pet.id);console.warn('孵化展示',error.message);});}
  }
  updateAmbient(e,active,dt){
    const data=this.ambientData.get(e.spec.typeId);if(!data?.nodes.some(n=>n.class==='ParticleEmitter'))return;
    e.ambientActive=active;
    if(!active){if(e.ambient){e.ambient.dispose();e.ambient=null;}return;}
    if(!e.ambient&&!e.ambientPending){e.ambientPending=true;createEggAmbient(data,{pointLights:false}).then(fx=>{
      if(e.removed||!e.ambientActive){fx.dispose();return;}e.ambient=fx;e.shell.add(fx.root);
    }).catch(error=>console.warn('蛋常驻特效',error)).finally(()=>{e.ambientPending=false;});}
    e.ambient?.update(Math.min(dt,.05),this.camera);
  }
  hit(egg,swingId,damage){
    if(this.progress.account.online){
      if(egg.removed||egg.hittable===false||!(egg.life.hp>0))return null;
      const generation=egg.life.generation,request=this.progress.account.online.attack({egg:egg.spec.id,generation});
      // Predict only requests that actually left: shake, sound and health bar now; the
      // breaking blow only shakes because hatching and the animal still come from Room.
      let predicted=null;
      if(request?.sent){
        if(!(egg.localHits>0))egg.predictedHp=egg.life.hp;
        const from=egg.predictedHp,to=Math.max(0,from-Math.max(0,Number(damage)||0));predicted=from-to;
        egg.localHits=(egg.localHits||0)+1;egg.localHitAt=this.time;if(to>0)egg.predictedHp=to;
        egg.presentation.hit(this.time,from,to>0?to:from);
        this.feedback?.sound('Impact',egg.center);this.feedback?.emit('hit',egg.center.clone(),clamp(Math.min(egg.spec.size[0],egg.spec.size[2])/6.1,.35,3),1,()=>!egg.removed);
      }
      return Object.assign(request.then(receipt=>{
        const current=!egg.removed&&egg.life.generation===generation;
        if(!receipt&&predicted!==null&&current&&egg.localHits>0){egg.localHits--;if(!egg.localHits)egg.presentation.settle(this.time,egg.life.hp);}
        if(!receipt||!current)return null;
        egg.presentation.showHealth(this.time);
        return {broken:false,damage:Number.isFinite(receipt.damage)?receipt.damage:null};
      }),{predicted});
    }
    const now=Date.now()/1000,previous=egg.life.hp;if(egg.hittable===false||!(egg.spec.titanic?this.titanic:this.state).hit(egg,swingId,damage,now))return null;
    egg.presentation.hit(this.time,previous,egg.life.hp);egg.presentation.hatchMult=egg.hatchSizeMult??1;
    this.feedback?.sound('Impact',egg.center);this.feedback?.emit('hit',egg.center.clone(),clamp(Math.min(egg.spec.size[0],egg.spec.size[2])/6.1,.35,3),1,()=>!egg.removed);
    if(egg.life.alive){this.progress.account.save();this.dirty=false;return {broken:false};}
    const pet=this.progress.hatch(`${egg.spec.id}:${egg.life.generation}`,Math.random,egg.spec.zone,egg.spec.titanic?{luck:30}:{});egg.pet=pet;
    if(pet)egg.petReady=this.petTemplate(pet.name,pet.variant).catch(error=>{console.warn('孵化动物资源',error.message);return null;});
    this.progress.account.save();this.dirty=false;return {broken:true,pet};
  }
  applyNetwork(frame){
    this.titanic.nextAt=Date.now()/1000+(frame.titanicNextAt-frame.time/1000);
    const present=new Set(frame.eggs.map(e=>e.id));
    for(const egg of this.state.eggs)if(egg.spec.zone===frame.zone&&!present.has(egg.spec.id)){egg.opened=true;this.remove(egg);}
    this.state.eggs=this.state.eggs.filter(e=>e.spec.zone!==frame.zone||present.has(e.spec.id));
    for(const incoming of frame.eggs){
      let egg=this.state.eggs.find(e=>e.spec.id===incoming.id);
      if(egg&&egg.life.generation!==incoming.generation){egg.opened=true;this.remove(egg);this.state.eggs=this.state.eggs.filter(e=>e!==egg);egg=null;}
      const hadEgg=!!egg;
      if(!egg){const raw=incoming.spec,t=C.templates.find(t=>t.id===raw.typeId);if(!t)continue;
        const spec={...eggSpec(t,raw.sizeMult,raw.position[0],raw.position[2],raw.yaw,raw.floorY),id:incoming.id,band:raw.band,titanic:!!raw.titanic,...(raw.health?{health:raw.health}:{})};
        egg={spec,life:new EggLife(spec),spawnedAt:Date.now()/1000-(frame.time/1000-incoming.spawnedAt)};egg.life.generation=incoming.generation;this.add(egg);this.state.eggs.push(egg);
      }
      const previous=egg.life.hp;egg.life.hp=incoming.hp;egg.life.respawnAt=incoming.respawnAt;
      if(incoming.endsAt)egg.endsAt=Date.now()/1000+incoming.endsAt-frame.time/1000;
      egg.presentation.hatchMult=incoming.hatchSizeMult||1;
      if(egg.localHits>0&&this.time-egg.localHitAt>3)egg.localHits=0;
      if(previous!==incoming.hp){
        // The player's own predicted hit already shook and played Impact; settle without repeating it.
        if(hadEgg&&incoming.hp<previous&&egg.localHits>0){
          egg.localHits--;
          if(incoming.hp===0)egg.presentation.hit(this.time,previous,0,{showHealth:false});
          else if(egg.localHits>0)egg.predictedHp=Math.min(egg.predictedHp,incoming.hp);
          else egg.presentation.settle(this.time,incoming.hp);
        }else{egg.presentation.hit(this.time,previous,incoming.hp,{showHealth:false});if(hadEgg&&incoming.hp<previous)this.feedback?.sound('Impact',egg.center);}
        if(incoming.hp===0)egg.presentation.hatchAt=this.time-Math.max(0,frame.time/1000-incoming.brokenAt);}
      if(incoming.pet&&!egg.pet){egg.pet=incoming.pet;egg.brokenAt=Date.now()/1000-(frame.time/1000-incoming.brokenAt);egg.petReady=this.petTemplate(egg.pet.name,egg.pet.variant).catch(()=>null);}
    }
    this.eggs=this.state.eggs;
  }
  async petTemplate(name,variant='Normal'){
    if(variant==='Gold'||variant==='Diamond'){
      const key=variant+':'+name;
      if(!this.petCache.has(key))this.petCache.set(key,this.petTemplate(name).then(t=>variantTemplate(t,name,variant)).catch(e=>{this.petCache.delete(key);throw e;}));
      return this.petCache.get(key);
    }
    if(!this.petCache.has(name))this.petCache.set(name,(async()=>{
      const compiled=await animalGlbTemplate(name);if(compiled)return compiled;
      this.petCatalog ||= Promise.all(['animals','paid-animals'].map(category=>fetch(`./model-check/${category}/catalog.json`).then(r=>{if(!r.ok)throw Error('动物清单加载失败 '+category);return r.json();}))).then(catalogs=>catalogs.flat());
      const entry=(await this.petCatalog).find(x=>x.name===name),baseUrl=new URL('./model-check/',location.href);if(!entry)throw Error('缺少动物模型 '+name);
      if(entry.scene){const model=await loadSceneResource(new URL(entry.scene,baseUrl)),b=new THREE.Box3().setFromObject(model),c=b.getCenter(new THREE.Vector3());model.position.set(-c.x,-b.min.y,-c.z);const wrap=new THREE.Group();wrap.add(model);wrap.userData.facingYaw=entry.facingYaw||0;wrap.scale.setScalar(2.8/b.getSize(new THREE.Vector3()).y);return wrap;}
      const text=await fetch(new URL(entry.url,baseUrl)).then(r=>r.text()),mtlUrl=new URL(entry.mtl,baseUrl),used=new Set([...text.matchAll(/^usemtl (.+)$/gm)].map(x=>x[1].trim()));this.mtlTexts ||=new Map();
      if(!this.mtlTexts.has(mtlUrl.href))this.mtlTexts.set(mtlUrl.href,fetch(mtlUrl).then(r=>r.text()));
      const mtl=(await this.mtlTexts.get(mtlUrl.href)).split(/(?=^newmtl )/m).filter(s=>used.has(s.split(/\r?\n/)[0].slice(7).trim())).join('\n').replace(/^map_d .*$/gm,'');
      const materials=new MTLLoader().parse(mtl,new URL('.',mtlUrl).href),model=new OBJLoader().setMaterials(materials).parse(text);
      model.traverse(o=>{if(o.isMesh)for(const m of Array.isArray(o.material)?o.material:[o.material]){const kd=materials.materialsInfo[m.name]?.kd;if(kd)m.color.setRGB(...kd.map(v=>v**(1/2.2)),THREE.SRGBColorSpace);m.side=THREE.DoubleSide;}});
      model.rotation.y=entry.facingYaw||0;
      const b=new THREE.Box3().setFromObject(model),c=b.getCenter(new THREE.Vector3());model.position.set(-c.x,-b.min.y,-c.z);const wrap=new THREE.Group();wrap.add(model);wrap.userData.facingYaw=entry.facingYaw||0;wrap.scale.setScalar(2.8/b.getSize(new THREE.Vector3()).y);return wrap;
    })().catch(e=>{this.petCache.delete(name);throw e;}));return this.petCache.get(name);
  }
  hasAnimalPresentation(id){
    return !!(this.pendingReveals?.has(id)||this.reveals.some(p=>p.egg.pet?.id===id)||this.eggs.some(e=>e.pet?.id===id&&!e.opened));
  }
  async reveal(pet,egg){
    this.pendingReveals??=new Set();
    if(this.pendingReveals.has(pet.id)||this.reveals.some(p=>p.egg.pet?.id===pet.id)||this.canPresentAnimal?.(pet.id)===false)return;
    this.pendingReveals.add(pet.id);
    try{
    const template=await egg.petReady;if(!template){this.progress.abandon(pet.id);return;}
    if(this.canPresentAnimal?.(pet.id)===false)return;
    const root=await createPetModel(template,pet.name).catch(error=>{console.warn('宠物动画回退',pet.name,error.message);return template.clone(true);});
    if(this.canPresentAnimal?.(pet.id)===false){disposePetModel(root);return;}
    root.position.set(egg.spec.position[0],egg.spec.floorY,egg.spec.position[2]);this.scene.add(root);
    // Original reference height, retaining the existing reference-weight reward.
    root.scale.multiplyScalar((P.hatch?4/2.8:1)*animalVisualScale(pet));const baseScale=root.scale.clone();root.scale.multiplyScalar(.01);
    const lift=Math.max(3,egg.spec.bodyBottom+egg.spec.bodyHeight*Math.max(1.75,egg.presentation.hatchMult)/2-(egg.spec.floorY+2));
    this.reveals.push({root,age:0,y:egg.spec.floorY,lift,baseScale,egg,landed:false});egg.petRevealedAt=this.time;
    this.feedback?.sound('Egg Open',egg.center);this.feedback?.sound('Confetti',egg.center);this.feedback?.sound('Reveal',egg.center);
    }finally{this.pendingReveals.delete(pet.id);}
  }
  inView(egg){if(!this.camera)return true;const d=egg.center.distanceTo(this.camera.position);if(d<=60)return true;
    this.localPoint.copy(egg.center).applyMatrix4(this.camera.matrixWorldInverse);const z=-this.localPoint.z,r=egg.spec.size.reduce((a,n)=>a+n*n,0)**.5*.75;
    const vertical=this.camera.fov*Math.PI/360+Math.PI/12,horizontal=Math.atan(Math.tan(this.camera.fov*Math.PI/360)*this.camera.aspect)+Math.PI/12;
    return z>=-r&&Math.abs(this.localPoint.x)<=z*Math.tan(horizontal)+r/Math.cos(horizontal)&&Math.abs(this.localPoint.y)<=z*Math.tan(vertical)+r/Math.cos(vertical);}
  updateCull(){const pos=this.player?.motor.position;this.homeZone=pos?(C.zones.find(z=>Math.abs(pos.x-z.box.matrix[3])<=z.box.size[0]/2&&Math.abs(pos.z-z.box.matrix[11])<=z.box.size[2]/2)?.zone||0):0;
    for(const e of this.eggs){const d=this.camera?e.center.distanceTo(this.camera.position):0,threshold=this.quality.distance(600,e.spec.zone===this.homeZone);
      if(e.far===undefined)e.far=d>=threshold+25;else if(e.far&&d<=threshold)e.far=false;else if(!e.far&&d>=threshold+25)e.far=true;}}
  update(dt){
    const now=Date.now()/1000;this.time+=dt;this.quality.update(dt);this.titanic.update(now);this.state.update(now);this.eggs=[...this.state.eggs,...this.titanic.eggs];this.titanicBoard?.update(now,this.titanic.nextAt);this.camera?.updateMatrixWorld();
    if(this.time-this.lastCull>=.25){this.lastCull=this.time;this.updateCull();}
    this.ambientLights.begin();
    for(const e of this.eggs){const s=e.spec,age=now-e.spawnedAt,d=this.camera?e.center.distanceTo(this.camera.position):0,awake=d<this.quality.distance(200,s.zone===this.homeZone)&&this.inView(e);
      this.updateAmbient(e,!!this.camera&&awake&&e.life.alive,dt);
      const pose=e.presentation.sample(this.time,{spawnAge:age,awake});if(s.titanic&&e.life.alive&&e.endsAt-now<.4){const shrink=clamp((e.endsAt-now)/.4);pose.scale*=shrink;pose.nestScale=shrink;}e.pose=pose;const hatch=e.presentation.hatchAt!==null,hatchAge=this.time-e.presentation.hatchAt;
      e.hittable=age>=.7&&e.life.alive;e.root.visible=!e.far&&(e.life.alive||(hatch&&pose.opacity>0));
      e.root.position.set(s.position[0]+(pose.dx||0),s.bodyBottom+s.bodyHeight*pose.scale/2+(pose.hop||0),s.position[2]+(pose.dz||0));
      e.root.rotation.set(pose.rx,s.yaw+pose.yaw,pose.rz,'YXZ');e.shell.position.set(0,-s.bodyHeight*pose.scale/2,0);e.shell.rotation.set(0,0,0);e.shell.scale.setScalar(s.bodyHeight*pose.scale);
      if(awake&&e.life.alive&&e.root.visible)this.ambientLights.consider(e,this.ambientData.get(s.typeId),d);
      shellAppearance(e,pose.white,pose.opacity);
      let ns=pose.nestScale??1;
      if(e.petRevealedAt!==undefined){const t=this.time-e.petRevealedAt,N=P.config.NestPop;ns=t<N.PopTime?1+(N.PopScale-1)*quadOut(t/N.PopTime):N.PopScale*(1-quadOut((t-N.PopTime)/N.ShrinkTime));}
      e.nest.scale.setScalar(s.nestWidth*Math.max(.001,ns));e.nest.position.y=e.nestBottomY+(e.nestBaseY-e.nestBottomY)*ns;
      e.nest.visible=!e.far&&ns>.001&&(e.life.alive||(hatch&&hatchAge<6)||(!hatch&&now-e.brokenAt<C.spawn.BrokenCleanupDelay));
      if(hatch){
        if(pose.stage==='grow'&&!e.rumbleStarted){e.rumbleStarted=true;e.stopRumble=this.feedback?.sound('Egg Rumble',e.center,{volume:.15,loop:true});}
        if(pose.stage==='grow'&&this.time>=(e.nextTick??0)){this.feedback?.sound('Dark Impact',e.center,{pitch:1+pose.progress});e.nextTick=this.time+.25-.2*pose.progress;}
        if(hatchAge>=hatchRevealTime&&!e.opened){e.opened=true;e.stopRumble?.();const center=new THREE.Vector3(s.position[0],s.bodyBottom+s.bodyHeight*Math.max(1.75,e.presentation.hatchMult)/2,s.position[2]);
          this.feedback?.emit('explode',center,Math.max(1.75,e.presentation.hatchMult)*clamp(Math.min(s.size[0],s.size[2])/6.1,.35,3),1.5,()=>!e.removed);
          if(e.pet)this.reveal(e.pet,e).catch(error=>console.warn('孵化展示',error.message));}
      }
      this.billboards?.update(e,pose,this.time);
    }
    this.nestInstances.update(this.camera);
    this.ambientLights.update();
    if(this.dirty){this.progress.account.save();this.dirty=false;}
    this.reveals=this.reveals.filter(p=>{updatePetAnimation(p.root,dt);p.age+=dt;const pose=petPose(p.age,p.lift);p.root.position.y=p.y+pose.y;p.root.scale.copy(p.baseScale).multiplyScalar(pose.scale);
      const player=this.player?.motor.position;p.root.rotation.y=(player?Math.atan2(player.x-p.root.position.x,player.z-p.root.position.z):0)+pose.yaw;
      if(p.age>=1.15&&!p.landed){p.landed=true;this.feedback?.emit('impact',new THREE.Vector3(p.root.position.x,p.y,p.root.position.z),1,.5,()=>!p.egg.removed);}
      if(p.age>=1.15&&this.onAnimalLanded){
        this.onAnimalLanded(p.egg.pet,p.egg,p,Math.max(0,1.15+P.hatch.PetLookDuration-p.age));return false;
      }
      if(p.age<1.15+P.hatch.PetLookDuration)return true;
      // Transfer this exact root to the pickup lifecycle. Egg respawns are independent.
      if(this.onPresentationComplete)this.onPresentationComplete(p.egg.pet,p.egg,p);
      else{disposePetModel(p.root);p.root.removeFromParent();this.progress.abandon(p.egg.pet.id);}return false;});this.feedback?.update(dt);
    // QA counters walk every egg and particle; 4 Hz keeps them current without a per-frame scan.
    this.statsAge=(this.statsAge??Infinity)+dt;
    if(this.canvas&&this.statsAge>=.25){this.statsAge=0;this.canvas.dataset.eggAmbientInstances=String(this.eggs.filter(e=>e.ambient).length);this.canvas.dataset.eggAmbientParticles=String(this.eggs.reduce((n,e)=>n+(e.ambient?.stats().particles||0),0));this.canvas.dataset.eggCounts=C.zones.map(z=>`${z.zone}:${this.state.zoneEggs(z.zone).filter(e=>e.life.alive).length}`).join(',');this.canvas.dataset.eggGeometryTypes=String(this.templates.size);}
  }
}
