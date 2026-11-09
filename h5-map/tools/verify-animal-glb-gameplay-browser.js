import * as THREE from '/build/builda-draft/vendor/three.module.js';
const pause=ms=>new Promise(r=>setTimeout(r,ms));
const assert=(value,message)=>{if(!value)throw Error(message);};
const wait=async predicate=>{for(let i=0;i<600;i++){if(predicate())return;await pause(100);}const g=window.game;throw Error('Animal gameplay wait timed out '+JSON.stringify({hidden:document.hidden,paused:window.gameHostState?.paused,busy:g?.commerce?.busy,reveals:g?.pickaxes.eggs.reveals.map(p=>p.age)}));};
export async function run(){
  performance.setResourceTimingBufferSize(5000);
  const g=window.game,checks=[];assert(g&&!g.online,'QA must use isolated offline test account');
  g.treadmills.exit(false);g.player.inputLocked=false;g.pickaxes.close();g.backpack.close();g.pickaxes.externalModal=null;
  const h=g.plots.tier.hitbox,center=new THREE.Vector3(h.matrix[3],1.27,h.matrix[11]);
  g.player.motor.teleport(center);g.player.actor.position.copy(center);
  const pet=g.pickaxes.progress.hatch('zone1-egg-900001:1',()=>.5,1);assert(pet&&g.pickaxes.progress.bank(pet),'QA pet grant failed');
  assert(await g.backpack.equip(pet.id),'Backpack equip failed');assert(g.backpack.model.userData.compiledAnimal===pet.name,'Equip did not use compiled model');checks.push('backpack-equip');
  const target=center.clone().add(new THREE.Vector3(5,0,4));
  const floor=g.player.world.rayIntersect(new THREE.Ray(target.clone().add(new THREE.Vector3(0,8,0)),new THREE.Vector3(0,-1,0)));if(floor)target.copy(floor.position);
  assert(await g.pasture.place(target),'Pasture placement failed');await wait(()=>!!g.pasture.models.get(pet.id));
  const placed=g.pasture.models.get(pet.id);assert(placed.userData.rig?.sharedGeometry,'Pasture did not use shared compiled rig');checks.push('pasture-place-and-animate');
  assert(await g.pasture.retrieve(pet.id),'Pasture retrieve failed');await wait(()=>!g.pasture.models.has(pet.id));
  assert(await g.backpack.equip(pet.id),'Re-equip after disposal failed');checks.push('retrieve-and-reequip');g.backpack.unequip();
  // Exercise the existing reveal -> landed animal -> pickup/drop presentation,
  // using only a transient fixture egg in this disposable local test account.
  const next=g.pickaxes.progress.hatch('zone1-egg-900002:1',()=>.5,1);assert(next,'QA reveal pet failed');
  const position=g.player.motor.position.clone(),egg={spec:{position:position.toArray(),floorY:position.y,bodyBottom:position.y,bodyHeight:6},presentation:{hatchMult:1},pet:next,center:position.clone(),petReady:g.pickaxes.eggs.petTemplate(next.name,next.variant)};
  await g.pickaxes.eggs.reveal(next,egg);await wait(()=>g.animals.views.has(next.id));
  const view=g.animals.views.get(next.id);assert(view.root.userData.compiledAnimal===next.name||view.root.userData.rig?.sharedGeometry,'Reveal did not use compiled asset');checks.push('hatch-reveal-and-land');
  // Keep the actor outside the bank safe area so the next frame cannot deliver it.
  const zone=g.animals.state.zones.find(z=>z.index===1).hitbox,p=new THREE.Vector3(zone.matrix[3],1.27,zone.matrix[11]);
  g.player.motor.teleport(p);g.player.actor.position.copy(p);const animal=g.animals.state.animals.get(next.id);animal.position={x:p.x,y:p.y,z:p.z};animal.home={...animal.position};view.root.position.copy(p);
  assert(g.animals.state.begin(next.id,p),'Pickup begin failed');const claimed=g.animals.state.advance(1.4,p,{held:true,holdDt:1.4});assert(claimed,'Pickup hold did not complete');g.animals.carryingChanged(claimed);g.animals.pose(claimed);assert(g.player.carryingAnimal===next.id,'Carry state missing');checks.push('pickup-and-carry');
  assert(g.animals.drop(),'Drop failed');assert(!g.player.carryingAnimal,'Carry flag survived drop');checks.push('drop');
  const resources=performance.getEntriesByType('resource');const legacyRequests=resources.filter(r=>/model-check\/(animal-animations|planet-x-animations|paid-animal-animations)\/(rigs|clips)\//.test(r.name));
  assert(!legacyRequests.length,'Game requested pruned legacy rig/clip JSON');
  return {checks,pet:pet.name,revealPet:next.name,compiledRequests:resources.filter(r=>r.name.includes('/animal-glb/')&&r.name.endsWith('.glb')).length,legacyRigRequests:legacyRequests.length};
}
