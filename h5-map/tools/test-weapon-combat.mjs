import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {closestBatTarget,batLaunch} from '../public/gameplay/weapon-combat-state.js';
import {WeaponCombat,BatHighlight} from '../public/gameplay/weapon-combat.js';
import {AnimalCarryState} from '../public/gameplay/animal-carry-state.js';
import {CharacterMotor} from '../public/world-physics.js';
const actor=(id,x,y=0)=>({id,kind:'player',position:{x,y,z:0}});
test('original target selection is nearest 3D player, including behind; no guards or protected targets',()=>{
  const me=actor('me',0),near=actor('near',-4),far=actor('far',16);
  assert.equal(closestBatTarget(me,[far,near],15),near);
  for(const flag of [{safe:true},{ragdolled:true},{batImmune:true},{immuneUntil:2},{tutorialDone:false},{hellEvent:true},{alive:false},{connected:false},{kind:'guard'}])assert.equal(closestBatTarget(me,[{...near,...flag},far],15),far);
  assert.equal(closestBatTarget(me,[actor('high',0,18)],15),null);
  assert.equal(closestBatTarget(me,[actor('edge',17)],15)?.id,'edge');
  assert.equal(closestBatTarget({...me,safe:true},[near],15),null);
});
test('original ShapeLaunch preserves configured distance and caps safe speed',()=>{
  for(const d of [17.5,24,27,30,33,36,39,42,45,48]){
    const f=batLaunch(d);assert.ok(Math.abs(f.horizontal*f.flight-d)<1e-8);assert.ok(f.duration>=1);assert.ok(Math.abs(f.gravityScale-1.8225)<1e-10);
  }
  const f=batLaunch(10000);assert.ok(Math.hypot(f.horizontal,f.vertical)<=192.00001);assert.throws(()=>batLaunch(NaN));
});
test('hit drops same carrying instance at impact even in home zone; guard/manual behavior unchanged',()=>{
  const box={matrix:[1,0,0,0,0,1,0,0,0,0,1,0],size:[100,10,100]};
  const s=new AnimalCarryState({zones:[{index:1,hitbox:box}],safe:box});
  const a=s.add({id:'animal',zone:1},{x:0,y:0,z:0});a.status='carrying';s.carrying=a;
  assert.equal(s.drop({x:8,y:0,z:2},{atHit:true}),a);assert.equal(a.position.x,8);assert.equal(s.animals.size,1);assert.equal(a.remaining,45);
  a.status='carrying';s.carrying=a;s.drop({x:8,y:0,z:2});assert.equal(a.position.x,0);
});
test('combat validates range, releases before launch, prevents repeat hits and grants recovery immunity',()=>{
  const world={capsuleIntersect:()=>null};
  const player=x=>({actor:new THREE.Group(),motor:new CharacterMotor(world,new THREE.Vector3(x,0,0)),keys:new Set(),touchMove:new THREE.Vector2()});
  const p=player(0),w={assets:{catalog:[{tier:1,range:15,knockback:17.5}]},equipped:1,canvas:{dataset:{}},pickaxes:{clock:{cancel(){}}}};
  let drops=0;const c=new WeaponCombat({weapons:w,player:p,guards:{catalog:{safeParts:[]}}});
  const other=player(8);const target=c.register({id:'other',player:other,drop:()=>{assert.equal(other.motor.externalMotion,null);drops++;}});
  assert.equal(c.strike(),true);assert.equal(drops,1);assert.equal(c.strike(),false);assert.ok(other.motor.velocity.x>0);
  other.motor.externalMotion=null;c.update(.1);assert.equal(c.strike(),false);c.update(1.01);assert.equal(c.strike(),true);
  c.unregister('other');assert.equal(c.strike(),false);c.dispose();
});
test('highlight fades to source opacity, retains depth testing and does not mutate material',()=>{
  const root=new THREE.Group(),mesh=new THREE.Mesh(new THREE.BoxGeometry(),new THREE.MeshBasicMaterial({color:'blue'}));root.add(mesh);
  const material=mesh.material,h=new BatHighlight();h.set(root);h.update(.18);
  assert.equal(h.overlays.length,2);assert.equal(h.overlays[0].material.opacity,.5);assert.equal(h.overlays[1].material.opacity,.85);assert.ok(h.overlays.every(m=>m.material.depthTest));
  h.clear();assert.equal(mesh.children.length,0);assert.equal(mesh.material,material);assert.equal(mesh.material.color.getHex(),0x0000ff);
});
