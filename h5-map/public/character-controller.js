import {assignDataset} from './dom-diff.js';
import {MobileGestures} from './mobile-gestures.js';
import {CameraOcclusion} from './camera-occlusion.js';
import * as THREE from 'three';
import { GLTFLoader } from './vendor/GLTFLoader.js';
import { CharacterMotor, PLAYER_HEIGHT } from './world-physics.js';

export class PlayerController {
  static async create(scene, camera, controls, world, canvas) {
    const gltf = await new GLTFLoader().loadAsync('characters/default-character.glb');
    return new PlayerController(scene, camera, controls, world, canvas, gltf);
  }

  constructor(scene, camera, controls, world, canvas, gltf) {
    this.camera = camera; this.orbitCamera = controls.object; this.controls = controls; this.canvas = canvas;
    this.motor = new CharacterMotor(world);
    this.world = world;
    this.keys = new Set();
    this.direction = new THREE.Vector3();
    this.forward = new THREE.Vector3();
    this.right = new THREE.Vector3();
    this.target = new THREE.Vector3();
    this.previousTarget = new THREE.Vector3();
    this.offset = new THREE.Vector3();
    this.networkVisualOffset = new THREE.Vector3();
    this.ray = new THREE.Ray();
    this.cameraOcclusion=new CameraOcclusion();
    this.accumulator = 0;
    this.actor = new THREE.Group();
    this.actor.name = 'Player';
    this.visual = new THREE.Group();
    this.model = gltf.scene;
    this.visual.add(this.model); this.actor.add(this.visual); scene.add(this.actor);
    this.mixer = new THREE.AnimationMixer(this.model);
    this.actions = new Map();
    for (const clip of gltf.animations) this.actions.set(clip.name, this.mixer.clipAction(clip));
    // Evaluate an actual idle frame before measuring this model's authored scale.
    this.setAnimation('Breathing Idle', true); this.mixer.update(0);
    this.model.updateMatrixWorld(true);
    const bounds = new THREE.Box3().setFromObject(this.model, true);
    const height = bounds.max.y - bounds.min.y;
    const size = PLAYER_HEIGHT / height;
    this.model.scale.multiplyScalar(size);
    this.model.updateMatrixWorld(true);
    bounds.setFromObject(this.model, true);
    const center = bounds.getCenter(new THREE.Vector3());
    this.model.position.x -= center.x;
    this.model.position.z -= center.z;
    this.model.position.y -= bounds.min.y;
    this.actor.position.copy(this.motor.position);
    // The character faces +Z in its authored rig; -X points into the first zone.
    this.actor.rotation.y = -Math.PI / 2;
    this.actor.traverse(o => { if (o.isMesh) o.frustumCulled = false; });
    this.cameraMaterials=new Map();
    this.model.traverse(o=>{if(o.isMesh)for(const m of (Array.isArray(o.material)?o.material:[o.material]))if(!this.cameraMaterials.has(m))this.cameraMaterials.set(m,{opacity:m.opacity,transparent:m.transparent,depthWrite:m.depthWrite});});
    this.cameraFade=1;
    controls.enablePan = false;
    controls.minDistance = 8; controls.maxDistance = 52;
    controls.minPolarAngle = .18; controls.maxPolarAngle = Math.PI * .49;
    controls.rotateSpeed = .7; controls.zoomSpeed = .8;
    controls.mouseButtons.LEFT = THREE.MOUSE.ROTATE;
    controls.mouseButtons.RIGHT = THREE.MOUSE.ROTATE;
    controls.touches.ONE = THREE.TOUCH.ROTATE;
    controls.touches.TWO = THREE.TOUCH.DOLLY_ROTATE;
    this.target.copy(this.motor.position).add(new THREE.Vector3(0, PLAYER_HEIGHT * .66, 0));
    this.previousTarget.copy(this.target);
    camera.position.copy(this.target).add(new THREE.Vector3(18, 10, 16));
    this.orbitCamera.position.copy(camera.position);
    controls.target.copy(this.target); controls.update();
    this.cameraDistance = camera.position.distanceTo(this.target);
    this.shadow = this.makeShadow(); scene.add(this.shadow);
    this.bindInput();
  }

  makeShadow() {
    const canvas = document.createElement('canvas');canvas.width = canvas.height = 64;
    const ctx = canvas.getContext('2d');
    const gradient = ctx.createRadialGradient(32, 32, 3, 32, 32, 32);
    gradient.addColorStop(0, 'rgba(25,31,24,.4)');gradient.addColorStop(1, 'rgba(25,31,24,0)');
    ctx.fillStyle = gradient;ctx.fillRect(0, 0, 64, 64);
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(4.8, 4.8), new THREE.MeshBasicMaterial({map: new THREE.CanvasTexture(canvas), transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2}));
    mesh.rotation.x = -Math.PI / 2; return mesh;
  }

  setAnimation(name, immediate = false) {
    if (this.animation === name) return;
    const next = this.actions.get(name); if (!next) return;
    const prev = this.actions.get(this.animation);
    next.reset().setEffectiveTimeScale(1).setEffectiveWeight(1).play();
    if (prev && !immediate) prev.crossFadeTo(next, .16, true);
    else if (prev) prev.stop();
    this.animation = name;
  }

  bindInput() {
    const movement = ['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'];
    addEventListener('keydown', e => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement || e.target.isContentEditable) return;
      if (this.inputLocked) return;
      if (movement.includes(e.code)) e.preventDefault();
      this.keys.add(e.code);
      if (e.code === 'Space' && !e.repeat) this.jump();
    });
    addEventListener('keyup', e => this.keys.delete(e.code));
    addEventListener('blur', () => this.keys.clear());
    window.addEventListener('game-host-pause', () => { if ((window.gameHostState?.paused||document.hidden)) { this.keys.clear(); this.accumulator = 0; } });
    this.canvas.addEventListener('contextmenu', e => e.preventDefault());
    this.touchMove = new THREE.Vector2();
    const gestures=new MobileGestures();this.touches=gestures.points;
    const css=document.createElement('link');css.rel='stylesheet';css.href=new URL('./mobile-controls.css',import.meta.url);document.head.append(css);
    const joystick=document.createElement('div');joystick.id='mobile-joystick';joystick.hidden=true;joystick.innerHTML='<i></i>';document.body.append(joystick);
    const jump=document.createElement('button');jump.id='mobile-jump';jump.type='button';jump.setAttribute('aria-label','Jump');jump.innerHTML='<svg viewBox="0 0 64 64" aria-hidden="true"><path d="M32 10 9 34h14v20h18V34h14Z" fill="white" stroke="black" stroke-width="2"/></svg>';document.body.append(jump);
    const blocked=()=>this.inputLocked||(window.gameHostState?.paused||document.hidden)||window.gameHostState?.paused||window.game?.commerce?.busy;
    const reset=()=>{gestures.clear();this.touchMove.set(0,0);joystick.hidden=true;};
    this.resetTouchInput=reset;
    const stop=e=>{e.preventDefault();e.stopImmediatePropagation();};
    jump.addEventListener('pointerdown',e=>{stop(e);if(!blocked())this.jump();});
    jump.addEventListener('click',e=>{stop(e);if(e.detail===0&&!blocked())this.jump();});
    this.canvas.addEventListener('pointerdown',e=>{
      if(e.pointerType!=='touch')return;if(blocked()){reset();return;}
      // Menus may clear the shared map without invoking this module.
      if(!gestures.points.size)gestures.moveId=null;
      const r=this.canvas.getBoundingClientRect();gestures.down(e.pointerId,e.clientX,e.clientY,r.left+r.width/2);
      this.canvas.setPointerCapture(e.pointerId);
      if(gestures.moveId===e.pointerId){joystick.hidden=false;joystick.style.left=e.clientX+'px';joystick.style.top=e.clientY+'px';joystick.firstChild.style.transform='translate(0px,0px)';}
      stop(e);
    },{capture:true,passive:false});
    this.canvas.addEventListener('pointermove',e=>{
      if(e.pointerType!=='touch')return;if(blocked()){reset();return;}
      const action=gestures.move(e.pointerId,e.clientX,e.clientY);if(!action)return;
      if(action.kind==='move'){this.touchMove.set(action.x,action.y).clampLength(0,1);joystick.firstChild.style.transform=`translate(${this.touchMove.x*38}px,${this.touchMove.y*38}px)`;}
      else if(action.kind==='zoom'){const offset=this.orbitCamera.position.clone().sub(this.controls.target);const length=THREE.MathUtils.clamp(offset.length()*action.ratio,this.controls.minDistance,this.controls.maxDistance);this.orbitCamera.position.copy(this.controls.target).add(offset.setLength(length));}
      else{const spherical=new THREE.Spherical().setFromVector3(this.orbitCamera.position.clone().sub(this.controls.target));spherical.theta-=action.dx*.006;spherical.phi=THREE.MathUtils.clamp(spherical.phi-action.dy*.006,this.controls.minPolarAngle,this.controls.maxPolarAngle);this.orbitCamera.position.copy(this.controls.target).add(new THREE.Vector3().setFromSpherical(spherical));}
      stop(e);
    },{capture:true,passive:false});
    const end=e=>{if(e.pointerType!=='touch')return;if(gestures.up(e.pointerId)){this.touchMove.set(0,0);joystick.hidden=true;}stop(e);};
    for(const name of ['pointerup','pointercancel','lostpointercapture'])this.canvas.addEventListener(name,end,{capture:true,passive:false});
    for(const name of ['blur','resize','game-host-pause'])addEventListener(name,reset);

  }

  jump() {
    if(this.motor.externalMotion)return;
    if (this.training) { this.onTrainingExit?.(true); return; }
    this.motor.jump();
  }

  lockTraining(position, yaw, rate) {
    this.training = {position: position.clone(), yaw, rate};
    this.motor.teleport(position); this.motor.grounded = true;
    this.accumulator = 0;
  }

  releaseTraining(position, jump = false) {
    this.training = null; this.motor.teleport(position);
    this.motor.grounded = true; this.motor.coyote = .1;
    if (jump) this.motor.jump();
    this.accumulator = 0;
  }

  applyNetworkPosition(position,smooth=false){
    const distance=this.motor.position.distanceTo(position);
    if(smooth&&distance<=6&&!this.training&&!this.motor.externalMotion)this.networkVisualOffset.copy(this.actor.position).sub(position);
    else this.networkVisualOffset.set(0,0,0);
    this.motor.teleport(position);
  }

  update(dt) {
    if(this.inputLocked||(!this.touches.size&&this.touchMove.lengthSq()))this.resetTouchInput?.();
    const k = this.keys;
    const x = Number(k.has('KeyD')||k.has('ArrowRight'))-Number(k.has('KeyA')||k.has('ArrowLeft'))+this.touchMove.x;
    const z = Number(k.has('KeyW')||k.has('ArrowUp'))-Number(k.has('KeyS')||k.has('ArrowDown'))-this.touchMove.y;
    this.camera.getWorldDirection(this.forward);this.forward.y=0;this.forward.normalize();
    this.right.crossVectors(this.forward,THREE.Object3D.DEFAULT_UP).normalize();
    this.direction.copy(this.forward).multiplyScalar(z).addScaledVector(this.right,x);
    if(this.direction.lengthSq()>1)this.direction.normalize();
    if(this.inputLocked||this.motor.externalMotion)this.direction.set(0,0,0);
    if (this.training) {
      this.motor.teleport(this.training.position); this.motor.grounded = true;
      this.actor.rotation.y = this.training.yaw;
    } else {
      this.accumulator += Math.min(dt,.05);
      while(this.accumulator>=1/120){this.motor.step(1/120,this.direction,k.has('ShiftLeft')||k.has('ShiftRight'));this.accumulator-=1/120;}
    }
    this.networkVisualOffset.multiplyScalar(Math.exp(-18*dt));
    if(this.networkVisualOffset.lengthSq()<1e-6)this.networkVisualOffset.set(0,0,0);
    this.actor.position.copy(this.motor.position).add(this.networkVisualOffset);
    const thrown=this.motor.externalMotion;
    // The supplied avatar already contains v2's authored dive and get-up clip.
    this.visual.rotation.x=this.visual.rotation.z=0;
    const speed = Math.hypot(this.motor.velocity.x,this.motor.velocity.z);
    if(!this.training && this.direction.lengthSq()>.01){
      const desired = Math.atan2(this.direction.x,this.direction.z);
      const diff = Math.atan2(Math.sin(desired-this.actor.rotation.y),Math.cos(desired-this.actor.rotation.y));
      this.actor.rotation.y += diff*(1-Math.exp(-16*dt));
    }
    this.setAnimation(thrown?'Guard Knockback':this.carryingAnimal?(speed>1?'Carry Egg Run':'Carry Egg'):this.training ? 'RunLobbyNew' : !this.motor.grounded?'LobbyAir':speed>1?'RunLobbyNew':'Breathing Idle');
    if(thrown){
      const hit=this.actions.get('Guard Knockback');
      const remaining=thrown.duration-thrown.elapsed;
      // Keep real collision/launch physics; hold prone until the final half-second.
      hit.time=remaining<.5?1+.8*(1-remaining/.5):Math.min(1,thrown.elapsed/.5);
      hit.timeScale=0;
    }
    if(this.animation==='Carry Egg Run')this.actions.get(this.animation).timeScale=THREE.MathUtils.clamp(speed/18,.6,3);
    if(this.animation==='RunLobbyNew')this.actions.get(this.animation).timeScale=this.training?.rate ?? THREE.MathUtils.clamp(speed/18,.6,3);
    this.mixer.update(dt);
    this.target.copy(this.motor.position).add(this.networkVisualOffset).add(new THREE.Vector3(0,PLAYER_HEIGHT*.66,0));
    this.offset.copy(this.target).sub(this.previousTarget);
    this.orbitCamera.position.add(this.offset);this.controls.target.copy(this.target);
    this.previousTarget.copy(this.target);
    this.controls.update();
    this.camera.position.copy(this.orbitCamera.position);
    this.camera.quaternion.copy(this.orbitCamera.quaternion);
    // Preserve the requested orbit; resolve only against camera-blocking geometry.
    this.cameraOcclusion.resolve(this.target,this.camera.position,this.world,dt);
    this.camera.lookAt(this.target);
    const distance=this.camera.position.distanceTo(this.target);
    const fade=THREE.MathUtils.smoothstep(distance,PLAYER_HEIGHT*.65,PLAYER_HEIGHT*1.3);
    if(fade!==this.cameraFade){
      this.cameraFade=fade;this.visual.visible=fade>0;
      for(const [material,original] of this.cameraMaterials){
        const transparent=original.transparent||fade<1;
        if(material.transparent!==transparent){material.transparent=transparent;material.needsUpdate=true;}
        material.opacity=original.opacity*fade;material.depthWrite=fade<1?false:original.depthWrite;
      }
    }
    this.ray.set(new THREE.Vector3(this.motor.position.x,this.motor.position.y+.5,this.motor.position.z),new THREE.Vector3(0,-1,0));
    const floor=this.world.rayIntersect(this.ray);
    this.shadow.visible=!!floor&&floor.distance<15;
    if(this.shadow.visible){this.shadow.position.copy(floor.position);this.shadow.position.y+=.025;this.shadow.material.opacity=Math.max(.12,1-floor.distance/15);}
    // Diagnostics are DOM data attributes only; no gameplay hints are rendered.
    assignDataset(this.canvas,{playerX:this.motor.position.x.toFixed(3),playerY:this.motor.position.y.toFixed(3),playerZ:this.motor.position.z.toFixed(3),grounded:String(this.motor.grounded),animation:this.animation,cameraDistance:distance.toFixed(3)});
  }
}
