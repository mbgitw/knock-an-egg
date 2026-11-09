// @ts-nocheck
// Generated from public/gameplay/zone-entry-state.js; run node tools/build-online-rules.mjs.
// Original ZoneHitboxLookup: full oriented box; Y gets two studs of slack.
export function insideZone(part,point){
  const m=part.matrix,dx=point.x-m[3],dy=point.y-m[7],dz=point.z-m[11];
  return Math.abs(dx*m[0]+dy*m[4]+dz*m[8])<=part.size[0]/2 &&
    Math.abs(dx*m[1]+dy*m[5]+dz*m[9])<=part.size[1]/2+2 &&
    Math.abs(dx*m[2]+dy*m[6]+dz*m[10])<=part.size[2]/2;
}
export function zoneAt(config,point){
  if(!point||![point.x,point.y,point.z].every(Number.isFinite))return null;
  return config.zones.find(z=>insideZone(z.hitbox,point))?.id || (insideZone(config.safe,point)?'SafeZone':null);
}
export class ZoneEntryState {
  constructor(config){this.config=config;this.current=null;this.pending=null;this.active=null;this.serial=0;}
  show(id,now){const zone=this.config.zones.find(z=>z.id===id);if(zone)this.active={zone,start:now,serial:++this.serial};}
  update(point,now,{suppressed=false,deferred=false}={}){
    const next=zoneAt(this.config,point),changed=next!==this.current;this.current=next;
    if(suppressed){this.active=null;this.pending=null;return null;}
    if(deferred){
      if(this.active||changed)this.pending=next;
      this.active=null;return null;
    }
    if(this.pending){const pending=this.pending;this.pending=null;if(pending===next)this.show(next,now);}
    if(changed&&next&&next!=='SafeZone')this.show(next,now);
    if(this.active&&now-this.active.start>=this.config.timing.hold+this.config.timing.exit)this.active=null;
    return this.active;
  }
}

function roomRandomRequired():number{throw Error("Room必须注入可恢复随机源");}
function roomTimeRequired():number{throw Error("Room必须注入可信时间");}
