import * as THREE from 'three';
import {PresentationVisibility,skipHiddenMatrices} from '../static-blocks.js';
import {Capsule} from '../vendor/Capsule.js';
import {buildGuardModel} from './guard-model.js';
import {GuardNavigation} from './guard-navigation.js';
import {GuardBrain,insideGuardBox,guardFling} from './guard-brain.js';

async function json(path){const r=await fetch('gameplay/guards/'+path);if(!r.ok)throw Error(`守卫资源 ${path}: ${r.status}`);return r.json();}
export const isOriginalGuardPart=path=>/^\/Workspace\/Build\/ZoneBuilds\/Zone(?:10|[1-9])\/(?:Chicken|SPHINX|IceYeti|EmeraldSerpent|WoollyMammoth|RedshellCrab|MoleTitan|Griffin|3Hydra|AlienGuardian)(?:\/|$)/.test(path);
export function guardGroundHeight(world,p,ray=new THREE.Ray()){
  let height=-Infinity;
  // The capsule reaches a step before its center does. Sample its footprint,
  // otherwise the low slab's vertical edge blocks an otherwise walkable route.
  for(let i=0;i<9;i++){
    const a=i*Math.PI/4,r=i===8?0:2;
    ray.set(new THREE.Vector3(p.x+Math.cos(a)*r,p.y+.6,p.z+Math.sin(a)*r),new THREE.Vector3(0,-1,0));
    const hit=world.rayIntersect(ray);
    if(hit&&hit.triangle.getNormal(new THREE.Vector3()).y>.5)height=Math.max(height,hit.position.y);
    else if(i===8)return NaN;
  }return Number.isFinite(height)?height:NaN;
}

export class GuardSystem {
  static async create(options){
    const [catalog,navigation]=await Promise.all([json('catalog.json'),json('navigation.json')]);
    const system=new GuardSystem({...options,catalog,navigation});
    await Promise.all(catalog.guards.map(async definition=>{
      const model=buildGuardModel(await json(definition.model));
      await Promise.all(Object.entries(definition.actions).map(async([name,action])=>model.addAction(name,await json(action.url))));
      system.add(definition,model);
    }));
    system.guards.sort((a,b)=>a.definition.zone-b.definition.zone);return system;
  }
  constructor({scene,player,account,plots,canvas,catalog,navigation}){
    Object.assign(this,{scene,player,account,plots,canvas,catalog});
    this.nav=new GuardNavigation(navigation);this.guards=[];this.carrying=null;this.generation=0;this.time=0;this.immunity=0;
    this.capsule=new Capsule(new THREE.Vector3(),new THREE.Vector3(),2);this.ray=new THREE.Ray();
  }
  add(definition,model){
    const brain=new GuardBrain(definition,this.catalog.rules,this.nav,{
      groundHeight:p=>guardGroundHeight(this.player.world,p,this.ray),
      canMove:p=>{
        this.capsule.start.set(p.x,p.y+2.06,p.z);this.capsule.end.set(p.x,p.y+3.06,p.z);
        const hit=this.player.world.capsuleIntersect(this.capsule);return !hit||hit.depth<.02;
      },
      lineOfSight:(a,b)=>{const start=a.clone();start.y+=2.7;const end=new THREE.Vector3().copy(b);end.y+=2.7;
        const delta=end.sub(start),distance=delta.length();if(distance<.01)return true;
        this.ray.set(start,delta.normalize());const hit=this.player.world.rayIntersect(this.ray);return !hit||hit.distance>=distance-.15;
      },onCatch:(guard,target)=>this.catch(guard,target),
    });
    brain.model=model;brain.alert=this.alertSprite(definition.height);model.root.add(brain.alert);
    skipHiddenMatrices(model.root);this.scene.add(model.root);this.guards.push(brain);model.play('Idle');
    model.root.position.copy(brain.position);model.root.rotation.y=brain.yaw;
  }
  alertSprite(height){
    const canvas=document.createElement('canvas');canvas.width=128;canvas.height=160;
    const c=canvas.getContext('2d');c.textAlign='center';c.font='bold 138px Arial';c.lineWidth=12;c.strokeStyle='white';c.strokeText('!',64,132);c.fillStyle='#ff2020';c.fillText('!',64,132);
    const material=new THREE.SpriteMaterial({map:new THREE.CanvasTexture(canvas),transparent:true,depthTest:true});
    const sprite=new THREE.Sprite(material);sprite.position.y=height+4;sprite.scale.set(5,6.25,1);sprite.visible=false;return sprite;
  }
  // The pickup system owns the instance; clearing this reference cancels pursuit.
  setCarrying(carrying){
    if(carrying&&(!Number.isInteger(Number(carrying.zone))||Number(carrying.zone)<1||Number(carrying.zone)>10))throw Error('携带来源区域必须为 1–10');
    this.carrying=carrying?{...carrying,zone:Number(carrying.zone),token:++this.generation}:null;
  }
  setTargetProvider(provider){if(provider!==null&&typeof provider!=='function')throw Error('守卫目标接口需要函数或 null');this.targetProvider=provider;}
  target(){
    const supplied=this.targetProvider?.();
    const position=supplied?.position||this.player.motor.position;
    const velocity=supplied?.velocity||this.player.motor.velocity;
    const lookAhead=new THREE.Vector3().copy(velocity);lookAhead.y=0;lookAhead.multiplyScalar(.1).clampLength(0,(this.player.motor.walkSpeed||18)*.1+3).add(position);
    const safe=this.catalog.safeParts.some(part=>insideGuardBox(position,part)||insideGuardBox(lookAhead,part))||!!this.plots?.contains(position)||!!this.plots?.contains(lookAhead);
    const carrying=supplied&&Object.hasOwn(supplied,'carrying')?supplied.carrying:this.carrying;
    const alreadyCaught=carrying&&(carrying===this.lastCaughtCarry||(carrying.token!==undefined&&carrying.token===this.lastCaughtCarry?.token));
    return {position,velocity,power:this.account?.data.power||0,...supplied,carrying,
      safe:safe||supplied?.safe,disabled:alreadyCaught||this.immunity>0||!!this.player.motor.externalMotion||supplied?.disabled};
  }
  catch(guard,target){
    if(this.immunity>0)return;
    const carrying=target.carrying;this.lastCaughtCarry=carrying;this.carrying=null;this.immunity=3;
    this.player.onTrainingExit?.();this.player.training=null;
    const fling=guardFling(guard.definition.config,this.catalog.rules);
    // Source launch direction is toward the hub (+X), with its authored wobble.
    const velocity=new THREE.Vector3(Math.cos(fling.wobble)*fling.horizontal,fling.vertical,Math.sin(fling.wobble)*fling.horizontal);
    this.player.keys.clear();this.player.touchMove.set(0,0);
    this.player.motor.launch(velocity,fling);
    const event={zone:guard.definition.zone,guard:guard.definition.name,carrying,fling};
    this.lastCatch=event;this.catchCount=(this.catchCount||0)+1;
    // Commit guard state and release carrying before notifying downstream code.
    try{carrying?.onDrop?.(event);}catch(error){console.error('守卫掉落回调失败',error);}
    try{this.onCaught?.(event);}catch(error){console.error('守卫抓捕回调失败',error);}
  }
  update(dt){
    this.visibility??=new PresentationVisibility();this.visibility.update(this.player.camera);
    this.time+=dt;this.immunity=Math.max(0,this.immunity-dt);const target=this.target();
    for(const guard of this.guards){
      guard.update(dt,target);guard.model.root.position.copy(guard.position);guard.model.root.rotation.y=guard.yaw;
      guard.model.root.visible=guard.position.distanceTo(this.player.motor.position)<650&&this.visibility.visible(guard.position,guard.definition.height*1.5+8);
      if(!guard.model.root.visible){guard.animationTime=0;continue;}
      const pulse=guard.state==='WindUp'?.22*(.5+.5*Math.sin((.8-guard.timer)*Math.PI/.75)):0;
      for(const mesh of guard.model.meshes)mesh.material.emissive.setRGB(pulse,0,0);
      const alerted=guard.state==='WindUp'||guard.state==='Chasing';guard.alert.visible=alerted;
      if(alerted)guard.alert.scale.setScalar(1+Math.sin(this.time*9)*.08).multiply(new THREE.Vector3(5,6.25,1));
      guard.model.play(guard.state==='Catching'&&guard.model.actions.has('Attack')?'Attack':guard.speed>.1?'Walk':'Idle',guard.speed>.1?guard.speed/(guard.definition.config.GuardSpeed*.25):1);
      // Far rigs keep their logical patrol and evaluate poses at 5 Hz.
      guard.animationTime=(guard.animationTime||0)+dt;
      if(guard.position.distanceTo(target.position)<450||guard.animationTime>=.2){guard.model.update(guard.animationTime);guard.animationTime=0;}
    }
    this.canvas.dataset.guardCount=String(this.guards.length);
    this.canvas.dataset.guardStates=this.guards.map(g=>`${g.definition.zone}:${g.state}`).join(',');
    this.canvas.dataset.guardCatches=String(this.catchCount||0);
  }
  dispose(){for(const g of this.guards){g.alert.material.map.dispose();g.alert.material.dispose();g.model.dispose();}this.guards=[];this.carrying=null;}
}
