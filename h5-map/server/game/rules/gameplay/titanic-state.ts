// @ts-nocheck
// Generated from public/gameplay/titanic-state.js; run node tools/build-online-rules.mjs.
import {EGG_CONFIG as C} from './eggs/runtime-config.ts';
import {eggSpec} from './egg-spawn-state.ts';
import {EggLife} from './pickaxe-state.ts';

// Original TitanicEggConfig values. Server scheduling/placement is an H5 reconstruction.
export const TITANIC={interval:1800,lifetime:600,health:10,luck:30,maxLive:10,
  heights:{2:[18,24],3:[22,30],4:[26,38],5:[30,46]},hatch:{2:[1.2,1.3],3:[1.25,1.35],4:[1.3,1.45],5:[1.35,1.5]}};
export class TitanicState {
  constructor(world,{random=roomRandomRequired,onSpawn=()=>{},onRemove=()=>{},onChange=()=>{},onAnnounce=()=>{}}={}){
    Object.assign(this,{world,random,onSpawn,onRemove,onChange,onAnnounce});this.eggs=[];this.nextAt=0;this.retryAt=0;this.pending=null;
  }
  spec(raw){
    const t=C.templates.find(t=>t.id===raw?.typeId&&t.available&&t.zone>=2&&t.name!=='Frozen Egg');
    if(!t||!Array.isArray(raw.position)||!raw.position.every(Number.isFinite)||!Number.isFinite(raw.sizeMult)||raw.sizeMult<=0||raw.sizeMult>20)return null;
    const floor=this.world.sampleGround(raw.position[0],raw.position[2],t.zone);if(!Number.isFinite(floor))return null;
    const s=eggSpec(t,raw.sizeMult,raw.position[0],raw.position[2],raw.yaw||0,floor,this.world.nestHeightRatio(t.zone));
    s.health*=TITANIC.health;s.titanic=true;s.luckMult=TITANIC.luck;
    return s;
  }
  legal(s){return this.world.legal(s,[...this.world.zoneEggs(s.zone),...this.eggs.filter(e=>e.spec.zone===s.zone)]);}
  install(s,at,hp=s.health){
    s.id=`zone${s.zone}-egg-1000`;const life=new EggLife(s);life.generation=Math.floor(at*1000);life.hp=hp;
    const range=TITANIC.hatch[s.zone]||[1.4,1.6];
    const egg={spec:s,life,spawnedAt:at,endsAt:at+TITANIC.lifetime,brokenAt:null,hatchSizeMult:(range[0]+range[1])/2};
    this.eggs.push(egg);this.onSpawn(egg);return egg;
  }
  initialize(saved,now){
    this.nextAt=Number.isFinite(saved?.nextAt)&&saved.nextAt>0?Math.min(saved.nextAt,now+TITANIC.interval):now+TITANIC.interval;
    this.pending=Number.isFinite(saved?.pending)&&saved.pending<=now&&saved.pending+TITANIC.lifetime>now?saved.pending:null;
    for(const raw of (Array.isArray(saved?.eggs)?saved.eggs:[]).slice(0,TITANIC.maxLive)){
      if(!Number.isFinite(raw.at)||raw.at>now||raw.at+TITANIC.lifetime<=now||!(raw.hp>0))continue;
      const s=this.spec(raw.spec);if(s&&this.legal(s))this.install(s,raw.at,Math.min(raw.hp,s.health));
    }
    this.update(now);this.onChange();
  }
  spawn(at){
    const templates=C.templates.filter(t=>t.available&&t.zone>=2&&t.name!=='Frozen Egg');
    for(let i=0;i<100;i++){
      const t=templates[Math.floor(this.random()*templates.length)],box=C.zones[t.zone-1].box,heights=TITANIC.heights[t.zone]||[30,56];
      const height=heights[0]+this.random()*(heights[1]-heights[0]);
      const s=this.spec({typeId:t.id,sizeMult:height/(C.spawn.EggBaseHeight+(t.zone-1)*C.spawn.EggHeightPerZone),position:[box.matrix[3]+(this.random()-.5)*box.size[0],0,box.matrix[11]+(this.random()-.5)*box.size[2]],yaw:this.random()*Math.PI*2});
      if(s&&this.legal(s)){const e=this.install(s,at);this.onAnnounce(e);return true;}
    }return false;
  }
  hit(e,id,damage,now){
    if(!this.eggs.includes(e)||now>=e.endsAt||!e.life.hit(id,damage,now))return false;
    if(!e.life.alive){e.brokenAt=now;e.life.respawnAt=now+15;}this.onChange();return true;
  }
  update(now){
    let changed=false;
    this.eggs=this.eggs.filter(e=>{if(e.life.alive?now<e.endsAt:now<e.brokenAt+15)return true;this.onRemove(e);changed=true;return false;});
    if(now>=this.nextAt){const at=this.nextAt+Math.floor((now-this.nextAt)/TITANIC.interval)*TITANIC.interval;this.nextAt=at+TITANIC.interval;this.pending=now<at+TITANIC.lifetime?at:null;changed=true;}
    if(this.pending!==null&&now>=this.retryAt){
      if(now>=this.pending+TITANIC.lifetime)this.pending=null;
      else if(this.eggs.length<TITANIC.maxLive&&this.spawn(this.pending)){this.pending=null;changed=true;}
      this.retryAt=now+5;
    }
    if(changed)this.onChange();
  }
  snapshot(){return {nextAt:this.nextAt,pending:this.pending,eggs:this.eggs.filter(e=>e.life.alive).map(e=>({at:e.spawnedAt,hp:e.life.hp,spec:e.spec}))};}
}

function roomRandomRequired():number{throw Error("Room必须注入可恢复随机源");}
function roomTimeRequired():number{throw Error("Room必须注入可信时间");}
