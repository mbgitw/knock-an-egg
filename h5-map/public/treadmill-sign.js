import {t,currentLanguage,onLanguageChange} from './i18n.js';
import * as THREE from 'three';

// Keep that project's artwork, but attach it to this map's existing 9 x 5 board.
export function paintUpgradeSign(context, {title, levelText, priceText, hasNextLevel, affordable, detailText}) {
  const canvas = context.canvas;
  const text=(value,x,y)=>{value=t(value);context.strokeStyle='#000';context.lineWidth=6;context.lineJoin='round';context.strokeText(value,x,y);context.fillText(value,x,y);};
  const roundRect = (x, y, width, height, radius) => {
    const r=Math.min(radius,width/2,height/2);
    context.beginPath();
    context.moveTo(x+r,y);context.arcTo(x+width,y,x+width,y+height,r);
    context.arcTo(x+width,y+height,x,y+height,r);context.arcTo(x,y+height,x,y,r);
    context.arcTo(x,y,x+width,y,r);context.closePath();context.fill();
  };
  context.clearRect(0, 0, canvas.width, canvas.height);
  context.fillStyle = 'rgb(16 27 45 / 0.78)';
  roundRect(32, 26, canvas.width - 64, canvas.height - 52, 28);
  context.textAlign = 'center'; context.textBaseline = 'middle';
  context.fillStyle = '#ffffff'; context.font = '900 76px Inter, "Microsoft YaHei", sans-serif';
  text(title, canvas.width / 2, 86);
  context.fillStyle = '#62ff72'; context.font = '950 66px Inter, "Microsoft YaHei", sans-serif';
  text(levelText, canvas.width / 2, 180);
  if(detailText){context.fillStyle='#ffffff';context.font='800 48px Inter, "Microsoft YaHei", sans-serif';text(detailText,canvas.width/2,260);}
  context.fillStyle = hasNextLevel ? (affordable ? '#29c94f' : '#ef2938') : '#516174';
  roundRect(120, 318, canvas.width - 240, 168, 24);
  context.fillStyle = '#ffffff'; context.font = '950 84px Inter, "Microsoft YaHei", sans-serif';
  text(priceText, canvas.width / 2, 402);
}

export function isPurchaseUV(uv) {
  const x = uv.x * 1024, y = (1 - uv.y) * 560;
  return x >= 120 && x <= 904 && y >= 318 && y <= 486;
}

export class TreadmillSign {
  constructor(system, name='TreadmillBoard-UI', interactive=true) {
    this.system = system;
    this.canvas = document.createElement('canvas');
    this.canvas.width = 1024; this.canvas.height = 560;
    this.context = this.canvas.getContext('2d');
    this.offLanguage=onLanguageChange(()=>{if(this.state)this.update(this.state);});
    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.colorSpace = THREE.SRGBColorSpace;
    this.texture.minFilter = this.texture.magFilter = THREE.LinearFilter;
    this.material = new THREE.MeshBasicMaterial({map: this.texture, transparent: true, depthWrite: false, toneMapped: false});
    this.root = new THREE.Group(); this.root.name = name;
    this.root.matrixAutoUpdate = false; this.root.matrix.copy(system.boardInverse).invert();
    this.faces = [-1, 1].map(side => {
      const face = new THREE.Mesh(new THREE.PlaneGeometry(8.72, 4.8), this.material);
      face.rotation.y = side * Math.PI / 2; face.position.x = side * .512;
      face.name = `${name}-${side}`; this.root.add(face); return face;
    });
    system.scene.add(this.root); this.root.updateMatrixWorld(true);
    this.raycaster = new THREE.Raycaster();
    this.abort = new AbortController();
    this.root.userData.interactive=interactive;
    if(!interactive)return;
    const options = {capture: true, passive: false, signal: this.abort.signal};
    const stop = event => {event.preventDefault(); event.stopImmediatePropagation();};
    // Document capture precedes character touch gestures, orbit dragging and pickaxe clicks.
    document.addEventListener('pointerdown', event => {
      if (event.target !== system.canvas || event.button !== 0 || system.player.inputLocked || !system.boardReachable() || system.account.session) return;
      if (!this.hit(event)) return;
      this.pointer = {id: event.pointerId, x: event.clientX, y: event.clientY, time: performance.now()};
      system.canvas.setPointerCapture(event.pointerId); stop(event);
    }, options);
    document.addEventListener('pointermove', event => {
      if (this.pointer?.id !== event.pointerId) return;
      if (Math.hypot(event.clientX - this.pointer.x, event.clientY - this.pointer.y) > 8) this.pointer.dragged = true;
      stop(event);
    }, options);
    document.addEventListener('pointerup', event => {
      const p = this.pointer; if (p?.id !== event.pointerId) return;
      this.pointer = null; stop(event);
      if (system.canvas.hasPointerCapture(event.pointerId)) system.canvas.releasePointerCapture(event.pointerId);
      if (!p.dragged && performance.now() - p.time < 800 && !system.player.inputLocked && this.hit(event)) void system.purchase();
    }, options);
    document.addEventListener('pointercancel', event => {if (this.pointer?.id === event.pointerId) {this.pointer = null; stop(event);}}, options);
    addEventListener('blur', () => {this.pointer = null;}, {signal: this.abort.signal});
  }
  hit(event) {
    const s = this.system, rect = s.canvas.getBoundingClientRect();
    this.raycaster.setFromCamera(new THREE.Vector2((event.clientX - rect.left) / rect.width * 2 - 1, 1 - (event.clientY - rect.top) / rect.height * 2), s.camera);
    const hit = this.raycaster.intersectObjects(this.faces, false)[0];
    if (!hit || !isPurchaseUV(hit.uv)) return null;
    const obstacle = s.player.world.rayIntersect(this.raycaster.ray);
    return obstacle && obstacle.distance < hit.distance - .025 ? null : hit;
  }
  update(state) {
    const signature = currentLanguage()+JSON.stringify(state);
    if (signature === this.signature) return;
    this.signature = signature; this.state = state;
    paintUpgradeSign(this.context, state); this.texture.needsUpdate = true;
    this.root.userData.ui = state;
  }
  dispose() {
    this.offLanguage?.();
    this.abort.abort(); this.root.removeFromParent();
    for (const face of this.faces) face.geometry.dispose();
    this.material.dispose(); this.texture.dispose();
  }
}
