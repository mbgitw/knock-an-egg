import * as THREE from 'three';
import { Octree } from './vendor/Octree.js';
import { Capsule } from './vendor/Capsule.js';

export const PLAYER_HEIGHT = 5.4;
export const PLAYER_RADIUS = 1;

// Character collision and camera occlusion are separate policies. Signs and
// narrow props must still stop a capsule without forcing a close-up camera.
export function blocksCamera(part){
  if(typeof part.cameraCollide==='boolean')return part.collide&&part.cameraCollide;
  if(/(?:Board|Sign)(?:\/|$)/i.test(part.path||''))return false;
  const dimensions=[...part.size].sort((a,b)=>a-b);
  return part.collide&&dimensions[1]>=3.5&&dimensions[2]>=PLAYER_HEIGHT;
}

// Replace local facility collision without rebuilding the whole map octree.
export function combineCollisionWorlds(...worlds) {
  return {
    cameraRayIntersect(ray) {
      let nearest=false;
      for(const world of worlds){const hit=(world.cameraRayIntersect||world.rayIntersect).call(world,ray);if(hit&&(!nearest||hit.distance<nearest.distance))nearest=hit;}
      return nearest;
    },
    capsuleIntersect(capsule) {
      let deepest=false;
      for(const world of worlds){const hit=world.capsuleIntersect(capsule);if(hit&&(!deepest||hit.depth>deepest.depth))deepest=hit;}
      return deepest;
    },
    rayIntersect(ray) {
      let nearest=false;
      for(const world of worlds){const hit=world.rayIntersect(ray);if(hit&&(!nearest||hit.distance<nearest.distance))nearest=hit;}
      return nearest;
    },
  };
}

export function buildCollisionWorld(parts, extraGeometry=null, boundsPadding=0, includeCamera=true) {
  const root = new THREE.Group();
  const box = new THREE.BoxGeometry(1, 1, 1);
  const sphere = new THREE.SphereGeometry(.5, 12, 8);
  const cylinder = new THREE.CylinderGeometry(.5, .5, 1, 12);
  cylinder.rotateZ(Math.PI / 2);
  const material = new THREE.MeshBasicMaterial();
  for (const part of parts) {
    if (!part.collide || part.size.some(n => !Number.isFinite(n) || n <= 0)) continue;
    // Use the authored physics parts, including invisible safety floors and walls.
    // Visual-only animals, particles and eggs do not block the player.
    let geometry = box;
    if (part.className === 'Part' && !part.specialMesh) {
      if (part.shape === 0) geometry = sphere;
      if (part.shape === 2) geometry = cylinder;
    }
    const mesh = new THREE.Mesh(geometry, material);
    const m = part.matrix;
    mesh.matrixAutoUpdate = false;
    mesh.matrix.set(m[0], m[1], m[2], m[3], m[4], m[5], m[6], m[7], m[8], m[9], m[10], m[11], 0, 0, 0, 1);
    mesh.matrix.multiply(new THREE.Matrix4().makeScale(...part.size));
    root.add(mesh);
  }
  if(extraGeometry)root.add(extraGeometry);
  root.updateMatrixWorld(true);
  const world = new Octree();
  // Small standalone colliders need a margin on both sides of the octree bounds.
  if(boundsPadding){const calcBox=world.calcBox;world.calcBox=function(){calcBox.call(this);this.box.expandByScalar(boundsPadding);};}
  world.fromGraphNode(root);
  if(includeCamera){
    const cameraParts=parts.filter(blocksCamera);
    const cameraWorld=cameraParts.length===parts.length?world:buildCollisionWorld(cameraParts,extraGeometry,boundsPadding,false);
    world.cameraRayIntersect=ray=>cameraWorld.rayIntersect(ray);
  }
  box.dispose(); sphere.dispose(); cylinder.dispose(); material.dispose();
  return world;
}

export class CharacterMotor {
  constructor(world, spawn = new THREE.Vector3(-48, .6, 24)) {
    this.world = world;
    this.spawn = spawn.clone();
    this.capsule = new Capsule(new THREE.Vector3(), new THREE.Vector3(), PLAYER_RADIUS);
    this.velocity = new THREE.Vector3();
    this.grounded = false;
    this.coyote = 0;
    this.jumpBuffer = 0;
    this.position = new THREE.Vector3();
    this.displacement = new THREE.Vector3();
    this.reset();
  }

  reset() {
    this.resetSerial=(this.resetSerial||0)+1;
    this.externalMotion=null;
    this.capsule.start.copy(this.spawn).add(new THREE.Vector3(0, PLAYER_RADIUS, 0));
    this.capsule.end.copy(this.spawn).add(new THREE.Vector3(0, PLAYER_HEIGHT - PLAYER_RADIUS, 0));
    this.velocity.set(0, 0, 0);
    this.position.copy(this.spawn);
    this.grounded = false;
    this.coyote = this.jumpBuffer = 0;
  }

  jump() { this.jumpBuffer = .15; }

  teleport(position) {
    this.externalMotion=null;
    this.displacement.copy(position).sub(this.position);
    this.capsule.translate(this.displacement);
    this.position.copy(position); this.velocity.set(0, 0, 0);
    this.grounded = false; this.coyote = this.jumpBuffer = 0;
  }

  step(dt, direction, sprint = false) {
    const external=this.externalMotion;
    if(external){
      external.elapsed+=dt;
      if(external.elapsed>=external.duration){this.externalMotion=null;this.velocity.x=this.velocity.z=0;}
    }
    this.coyote = this.grounded ? .1 : Math.max(0, this.coyote - dt);
    this.jumpBuffer = Math.max(0, this.jumpBuffer - dt);
    if (!external && this.jumpBuffer > 0 && this.coyote > 0) {
      this.velocity.y = 24;
      this.jumpBuffer = this.coyote = 0;
      this.grounded = false;
    }
    const speed = Math.min(240, (this.walkSpeed ?? 18) * (sprint ? this.sprintMultiplier ?? 1.5 : 1));
    const blend = 1 - Math.exp(-(this.grounded ? 22 : 8) * dt);
    if(!external){
      this.velocity.x = THREE.MathUtils.lerp(this.velocity.x, direction.x * speed, blend);
      this.velocity.z = THREE.MathUtils.lerp(this.velocity.z, direction.z * speed, blend);
    }else if(this.grounded&&external.elapsed>.1){this.velocity.x*=Math.exp(-14*dt);this.velocity.z*=Math.exp(-14*dt);}
    this.velocity.y -= 65 * dt * (external?.gravityScale??1);
    this.displacement.copy(this.velocity).multiplyScalar(dt);
    this.grounded = false;
    // At 240 units/s a fixed tick can cross a thin shop post completely.
    // Bound each collision sweep to less than half the capsule radius.
    const steps=Math.max(1,Math.ceil(this.displacement.length()/(PLAYER_RADIUS*.4)));
    this.displacement.divideScalar(steps);
    for(let sub=0;sub<steps;sub++){
    this.capsule.translate(this.displacement);
    // Several contacts may be needed at corners, floor seams and fence posts.
    for (let i = 0; i < 5; i++) {
      const hit = this.world.capsuleIntersect(this.capsule);
      if (!hit) break;
      if (hit.normal.y > .45) this.grounded = true;
      const inward = this.velocity.dot(hit.normal);
      if (inward < 0) this.velocity.addScaledVector(hit.normal, -inward);
      this.capsule.translate(hit.normal.multiplyScalar(hit.depth + .0001));
    }
    }
    this.position.copy(this.capsule.start); this.position.y -= PLAYER_RADIUS;
    if (!Number.isFinite(this.position.y) || this.position.y < -100) this.reset();
  }

  launch(velocity,{duration=3,gravityScale=1}={}){
    if(!velocity.toArray().every(Number.isFinite))return false;
    this.velocity.copy(velocity);this.grounded=false;this.coyote=this.jumpBuffer=0;
    this.externalMotion={elapsed:0,duration:Math.max(.1,duration),gravityScale:Math.max(.1,gravityScale)};return true;
  }
}
