import * as THREE from 'three';
import {CONFIG} from './config.js';

// Only registered, live eggs are eligible. Sweep and range are independent:
// being visible or near the mouse cursor is never sufficient to inflict damage.
export function pickHit(eggs, origin, forward, hitbox, world) {
  const candidates=[];
  for(const egg of eggs){
    if(!egg.life.alive||egg.hittable===false)continue;
    const closest=egg.bounds.clampPoint(origin,new THREE.Vector3());
    const delta=closest.sub(origin),distance=delta.length();
    const facing=egg.center.clone().sub(origin);facing.y=0;
    if(distance>CONFIG.hitRange || facing.dot(forward)<0 || !hitbox.intersectsBox(egg.bounds))continue;
    const aim=egg.center.clone().sub(origin),length=aim.length();
    const obstruction=world?.rayIntersect(new THREE.Ray(origin,aim.normalize()));
    // Collision proxies may include floor beneath the target; only geometry
    // before its near surface blocks the swing.
    if(obstruction&&obstruction.distance<Math.min(distance,length)-.15)continue;
    candidates.push({egg,distance});
  }
  candidates.sort((a,b)=>a.distance-b.distance || a.egg.spec.id.localeCompare(b.egg.spec.id));
  return candidates[0]?.egg || null;
}
