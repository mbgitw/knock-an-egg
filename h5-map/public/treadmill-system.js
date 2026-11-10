import {gameAudio} from './gameplay/game-audio.js';
import * as THREE from 'three';
import {TreadmillAssets} from './treadmill-assets.js';
import {TreadmillSign} from './treadmill-sign.js';
import {assignDataset, setAttr, setProp, setText} from './dom-diff.js';
import {TreadmillState, LEVELS, UNLOCK_COST, animationRate, formatNumber, gainColor} from './treadmill-state.js';

// Single-player authority. Future income systems use account.creditCash(), and
// host-controlled public events use startPublicEvent(); no payment is simulated.
export class TreadmillSystem {
  static async create(scene, player, camera, canvas, options = {}) {
    const assets = await TreadmillAssets.create();
    const system = new TreadmillSystem(scene, player, camera, canvas, assets, options);
    system.own = await assets.instance(system.account.data.level, system.ownMatrix);
    scene.add(system.own.root);
    if (system.account.data.publicEvent) await system.restorePublic();
    system.refreshHUD(); return system;
  }
  constructor(scene, player, camera, canvas, assets, options = {}) {
    Object.assign(this, {scene, player, camera, canvas, assets});
    let storage; try { storage = Object.hasOwn(options, 'storage') ? options.storage : localStorage; } catch { storage = null; }
    this.account = new TreadmillState({storage, onGain: (amount, mult) => this.showGain(amount, mult)});
    if(options.online){this.account.data=options.online.account;this.account.online=options.online;this.account.storage=null;this.account.save=()=>true;this.account.now=()=>options.online.now();}
    this.ownMatrix = new THREE.Matrix4().set(...assets.anchors.ownOrigin);
    this.publicMatrix = new THREE.Matrix4().set(...assets.anchors.publicOrigin);
    this.boardPosition = new THREE.Vector3(...assets.anchors.boardPosition);
    this.boardInverse = new THREE.Matrix4().set(...assets.anchors.boardMatrix).invert();
    if(options.baseTransform){const transform=new THREE.Matrix4().set(...options.baseTransform);this.ownMatrix.premultiply(transform);this.boardPosition.applyMatrix4(transform);this.boardInverse=new THREE.Matrix4().set(...assets.anchors.boardMatrix).premultiply(transform).invert();}
    this.cooldown = 0; this.saveTimer = 0; this.public = null; this.busy = false;
    this.popups = []; this.bursts = []; this.audio = null;
    this.nearBoard = false; this.ownNear = false; this.publicSlot = -1;
    this.player.onTrainingExit = jump => this.exit(jump);
    this.makeHUD();
    this.sign = new TreadmillSign(this);
    const pause = () => {
      this.exit(false); this.account.elapsed = 0;
      this.player.keys.clear(); this.player.touchMove.set(0, 0); this.player.touches.clear();
      this.cooldown = 1; this.awaitingInput = true; this.cutsceneUntil = 0; this.account.save();
    };
    addEventListener('blur', pause);
    addEventListener('pagehide', pause);
    addEventListener('game-host-pause',()=>{if(window.gameHostState?.paused)pause();});

    const activate = () => {
      this.awaitingInput = false;
    };
    addEventListener('pointerdown', activate, {capture:true,passive: true});
    addEventListener('keydown', e => {
      activate();
      if (e.code === 'Escape') this.exit(false);
      if (e.code === 'Space' || e.code === 'Escape') this.cutsceneUntil = 0;
    });
  }
  makeHUD() {
    this.ui = document.createElement('div'); this.ui.id = 'training-ui';
    this.ui.innerHTML = `
      <div class="stats"><div class="stat-card stat-card--speed" aria-label="速度"><img class="stat-card__icon" src="hud-layout/speed.webp" alt="" aria-hidden="true"><b id="speed-value"></b></div><div class="stat-card stat-card--cash" aria-label="现金"><img class="stat-card__icon" src="hud-layout/cash.png" alt="" aria-hidden="true"><b id="cash-value"></b></div></div>
      <div class="slow-mode-position"><button type="button" id="slow-mode" aria-label="慢速模式" aria-pressed="false"><span class="slow-mode-placeholder__track" aria-hidden="true"><i></i></span><b>Slow Mode</b></button></div>
      <section id="treadmill-board" aria-label="跑步机升级" hidden><span class="machine-kicker">我的跑步机</span><strong id="machine-name"></strong><div id="machine-level"></div><div class="machine-mult" id="machine-mult"></div><button id="machine-purchase"></button></section>
      <div id="public-event" hidden></div><button id="public-train" hidden>公共跑步机</button>
      <div id="speed-popups" aria-hidden="true"></div>`;
    document.body.append(this.ui);
    this.elements = Object.fromEntries([...this.ui.querySelectorAll('[id]')].map(e => [e.id, e]));
    this.elements['slow-mode'].onclick = () => { this.account.setSlow(!this.account.data.slow); this.refreshHUD(); };
    this.elements['machine-purchase'].onclick = () => this.purchase();
    this.elements['public-train'].onclick = () => { if (this.publicSlot >= 0) this.enter('public', this.publicSlot); };
  }
  refreshHUD() {
    const e = this.elements, a = this.account, d = a.data;
    // Runs every frame; the helpers skip DOM writes when nothing changed.
    setText(e['speed-value'], formatNumber(d.power));
    setText(e['cash-value'], `$${formatNumber(d.cash)}`);
    setAttr(e['slow-mode'], 'aria-pressed', d.slow);
    setProp(e['slow-mode'], 'hidden', !!a.session);
    setText(e['machine-name'], a.level.name);
    setText(e['machine-level'], !d.unlocked ? '未解锁' : a.level.cost === null ? `Lv.${d.level} · MAX` : `Lv.${d.level} → Lv.${d.level + 1}`);
    setText(e['machine-mult'], `成长 ×${a.level.multiplier}${d.unlocked && a.level.cost !== null ? ` → ×${LEVELS[d.level].multiplier}` : ''}`);
    const price = d.unlocked ? a.level.cost : UNLOCK_COST;
    setText(e['machine-purchase'], this.busy ? '加载中…' : price === null ? '已满级' : `${d.unlocked ? '升级' : '解锁'} · $${formatNumber(price)}`);
    setProp(e['machine-purchase'], 'disabled', this.busy || !!a.session || price === null || d.cash < price);
    setProp(e['machine-purchase'], 'title', this.purchaseError || (price !== null && d.cash < price ? `还需 $${formatNumber(price - d.cash)}` : ''));
    this.sign?.update({
      title: d.unlocked ? '升级跑步机' : '购买跑步机',
      levelText: price === null ? `等级 ${d.level} · MAX` : `等级 ${d.unlocked ? d.level : 0} → ${d.unlocked ? d.level + 1 : 1}`,
      priceText: this.busy ? '加载中…' : price === null ? 'MAX' : `$${formatNumber(price)}`,
      hasNextLevel: price !== null,
      affordable: !this.busy && !a.session && price !== null && d.cash >= price,
    });
    assignDataset(this.canvas, { storageStatus: a.storageStatus, treadmillLevel: d.level, speedPower: d.power, training: a.session?.kind || 'none' });
  }
  boardReachable() {
    if (this.player.motor.position.distanceTo(this.boardPosition) > 19) return false;
    const from = this.player.motor.position.clone().add(new THREE.Vector3(0, 3, 0));
    const delta = this.boardPosition.clone().sub(from), distance = delta.length();
    const hit = this.player.world.rayIntersect(new THREE.Ray(from, delta.normalize()));
    // The board itself is an authored collider; its front may intercept the ray.
    if (!hit || hit.distance >= distance - .6) return true;
    const boardHit = hit.position.clone().applyMatrix4(this.boardInverse);
    return Math.abs(boardHit.x) <= .55 && Math.abs(boardHit.y) <= 2.55 && Math.abs(boardHit.z) <= 4.55;
  }
  async purchase() {
    if (this.busy || this.account.session || !this.boardReachable()) return false;
    const a = this.account;
    this.purchaseError = '';
    if (!a.data.unlocked) { const result = a.unlock(); this.refreshHUD(); if (result) this.tone('purchase'); return result; }
    const level = a.data.level;
    if (a.level.cost === null || a.data.cash < a.level.cost) return false;
    this.busy = true; this.refreshHUD();
    let next;
    try {
      next = await this.assets.instance(level + 1, this.ownMatrix);
      // Recheck after asynchronous loading: no remote or repeated UI action can
      // spend the old price twice, or purchase after walking out of range.
      if (!this.boardReachable() || this.account.session || !a.upgrade(level)) { next.dispose(); return false; }
      this.own.dispose(); this.own = next; this.scene.add(next.root);
      this.cooldown = .6; this.tone('purchase'); return true;
    } catch (error) {
      next?.dispose(); console.error(error);
      this.purchaseError = '模型加载失败，未扣费，可重试'; return false;
    } finally { this.busy = false; this.refreshHUD(); }
  }
  canEnter(kind, slot = 0) {
    if(this.account.session)return false;
    if(this.player.carryingAnimal)return false;
    if (this.player.motor.externalMotion || this.cooldown > 0 || this.busy || this.awaitingInput || (window.gameHostState?.paused||document.hidden) || !this.player.motor.grounded) return false;
    const machine = kind === 'own' ? this.own : this.public;
    if (!machine || (kind === 'own' ? !this.ownNear : this.publicSlot !== slot)) return false;
    return true;
  }
  enter(kind, slot = 0) {
    if(!this.canEnter(kind,slot))return false;
    const machine = kind === 'own' ? this.own : this.public;
    if (!this.account.begin(kind, slot)) return false;
    this.lockedSession = {kind, slot};
    const position = new THREE.Vector3(...machine.metadata.slots[slot]).applyMatrix4(machine.root.matrixWorld);
    const facing = new THREE.Vector3(...machine.metadata.facing).transformDirection(machine.root.matrixWorld);
    this.player.lockTraining(position, Math.atan2(facing.x, facing.z), animationRate(this.account.data.level) * (kind === 'public' ? 1.5 : 1));
    this.cutsceneUntil = 0; this.refreshHUD(); return true;
  }
  exit(jump = false) {
    const session = this.account.session || this.lockedSession;
    if (!session && !this.player.training) return;
    const machine = session ? (session.kind === 'own' ? this.own : this.public) : null;
    let exit = this.player.motor.position.clone();
    if (machine) {
      const local = new THREE.Vector3(...machine.metadata.slots[session.slot]);
      // Own machines face -X. Exit behind the runner, clear of the belt so a
      // held movement key cannot instantly anchor the character again.
      if (session.kind === 'own') local.x = 5.8;
      else local.x = local.x < 0 ? -7 : 7;
      local.y = 0;
      exit = local.applyMatrix4(machine.root.matrixWorld);
    }
    this.lockedSession = null;
    this.account.end(); this.player.releaseTraining(exit, jump);
    this.player.keys.clear(); this.player.touchMove.set(0, 0);
    this.cooldown = 1; this.refreshHUD();
  }
  async restorePublic() {
    const id = this.account.data.publicEvent?.id;
    if (!id) return;
    const machine = await this.assets.instance(10, this.publicMatrix);
    if (this.account.data.publicEvent?.id !== id) { machine.dispose(); return; }
    this.public = machine; this.public.landed = this.account.publicActive;
    this.scene.add(machine.root);
  }
  async startPublicEvent(options = {}) {
    if (this.publicLoading || this.account.data.publicEvent?.endsAt > Date.now()) return false;
    this.publicLoading = true;
    let machine;
    try {
      machine = await this.assets.instance(10, this.publicMatrix);
      if (!this.account.startPublicEvent(options)) { machine.dispose(); return false; }
      this.public?.dispose(); this.public = machine; this.public.landed = false;
      machine.root.position.y += 260; this.scene.add(machine.root);
      this.cutsceneUntil = this.account.data.publicEvent.landsAt + 900;
      this.tone('fall'); return true;
    } catch (error) { machine?.dispose(); console.error(error); return false; }
    finally { this.publicLoading = false; }
  }
  stopPublicEvent() {
    if ((this.account.session || this.lockedSession)?.kind === 'public') this.exit(false);
    this.account.stopPublicEvent(); this.public?.dispose(); this.public = null;
    this.cutsceneUntil = 0;
  }
  tone(kind = 'gain') {
    if(kind==='gain')gameAudio.play('train');
    else if(kind==='slam')gameAudio.play('impact');
  }
  showGain(amount, mult) {
    if (this.popups.length >= 18) return;
    const node = document.createElement('span'); node.className = 'speed-popup';
    node.textContent = `+${formatNumber(amount)}`; node.style.color = gainColor(mult);
    this.elements['speed-popups'].append(node);
    const lane = (this.popupSerial = (this.popupSerial || 0) + 1) % 4 - 1.5;
    this.popups.push({node, age: 0, lane, anchor: this.player.motor.position.clone().add(new THREE.Vector3(0, 6.2, 0)), close: this.camera.position.distanceTo(this.player.actor.position) < 9});
    const stat = this.elements['speed-value'];
    if (typeof stat?.getAnimations === 'function') stat.getAnimations().forEach(a => a.cancel());
    if (typeof stat?.animate === 'function') stat.animate([{transform: 'scale(1.12)'}, {transform: 'scale(1)'}], {duration: 180});
    this.tone();
  }
  landingBurst() {
    const root = new THREE.Group(); root.position.setFromMatrixPosition(this.publicMatrix); root.position.y += .08;
    const shards = [];
    const geometry = new THREE.IcosahedronGeometry(1, 0);
    const material = new THREE.MeshBasicMaterial({color: 0xffad35, transparent: true, depthWrite: false});
    for (let i = 0; i < 38; i++) {
      const mesh = new THREE.Mesh(geometry, material), angle = i * 2.3999;
      mesh.scale.setScalar(.25 + Math.random() * .6); root.add(mesh);
      shards.push({mesh, velocity: new THREE.Vector3(Math.cos(angle) * (5 + i % 7), 7 + i % 8, Math.sin(angle) * (5 + i % 7))});
    }
    const rings = [];
    for (let i = 0; i < 11; i++) {
      const mat = new THREE.MeshBasicMaterial({color: i ? 0xff7e22 : 0xffdc83, transparent: true, opacity: .75, side: THREE.DoubleSide, depthWrite: false});
      const mesh = new THREE.Mesh(new THREE.RingGeometry(.8, 1, 48), mat); mesh.rotation.x = -Math.PI / 2;
      if (i) mesh.position.set(Math.cos(i * Math.PI / 5) * 6, .05, Math.sin(i * Math.PI / 5) * 14);
      root.add(mesh); rings.push(mesh);
    }
    const smoke = [];
    for (let i = 0; i < 14; i++) {
      const mesh = new THREE.Mesh(new THREE.IcosahedronGeometry(1, 1), new THREE.MeshBasicMaterial({color: 0x77706a, transparent: true, opacity: .28, depthWrite: false}));
      mesh.position.set(Math.cos(i * 2.4) * 5, 0, Math.sin(i * 2.4) * 12); root.add(mesh); smoke.push(mesh);
    }
    this.scene.add(root); this.bursts.push({root, shards, rings, smoke, age: 0, geometry, material});
    this.shakeUntil = performance.now() + 1100; this.tone('slam');
  }
  update(dt) {
    const a = this.account, d = a.data, p = this.player.motor.position, now = Date.now();
    this.cooldown = Math.max(0, this.cooldown - dt);
    this.player.motor.walkSpeed = a.speed;
    this.player.motor.sprintMultiplier = d.slow ? 1 : 1.5;
    this.own.root.updateMatrixWorld(true);
    const local = this.own.root.worldToLocal(p.clone());
    this.ownNear = Math.abs(local.x) < 3.9 && Math.abs(local.z) < 2.55 && local.y > -.15 && local.y < 2;
    this.nearBoard = this.boardReachable();
    this.canvas.dataset.nearBoard = String(this.nearBoard);
    this.canvas.dataset.nearTreadmill = String(this.ownNear);
    if (!a.session && this.ownNear && d.unlocked) this.enter('own');
    this.publicSlot = -1;
    if (this.public && d.publicEvent) {
      if (now >= d.publicEvent.endsAt) this.stopPublicEvent();
      else {
        const t = THREE.MathUtils.clamp(1 - (d.publicEvent.landsAt - now) / 1600, 0, 1);
        this.public.root.position.y = .5 + 260 * (1 - t * t);
        this.public.root.updateMatrixWorld(true);
        if (t >= 1 && !this.public.landed) { this.public.landed = true; this.landingBurst(); }
        if (a.publicActive) {
          const local = this.public.root.worldToLocal(p.clone());
          let distance = Infinity;
          this.public.metadata.slots.forEach((slot, i) => {
            const dist = Math.hypot(local.x - slot[0], local.z - slot[2]);
            if (dist < 3.5 && dist < distance && local.y >= -.2 && local.y < 2) { distance = dist; this.publicSlot = i; }
          });
          if (!a.session && this.publicSlot >= 0) this.enter('public', this.publicSlot);
        }
        this.public.effects.update(dt, this.camera);
      }
    }
    // Detect resets/foreign interruptions instead of paying for a detached pose.
    if (a.session && (!this.player.training || p.distanceTo(this.player.training.position) > .1)) this.exit(false);
    a.advance(dt, {active: !(window.gameHostState?.paused||document.hidden) && !this.awaitingInput});
    // The absolute event deadline can cross between the scene check and the
    // account tick. Release the pose even if the account already ended it.
    if (!a.session && this.player.training && this.lockedSession) this.exit(false);
    if (this.player.training) this.player.training.rate = animationRate(d.level) * (a.session?.kind === 'public' ? 1.5 : 1);
    this.own.effects.update(dt, this.camera);
    this.saveTimer += dt;
    if (this.saveTimer >= 2) { if (a.dirty) a.save(); this.saveTimer = 0; }
    this.updatePresentation(dt, now);
    this.refreshHUD();
  }
  updatePresentation(dt, now) {
    const a = this.account, e = this.elements;
    // The visible UI is rendered on the physical sign; this is its keyboard equivalent.
    e['treadmill-board'].hidden = !this.nearBoard || !!a.session;
    e['public-train'].hidden = a.session || this.publicSlot < 0 || this.cooldown > 0;
    const event = a.data.publicEvent;
    e['public-event'].hidden = !event;
    if (event) e['public-event'].textContent = now < event.landsAt ? '公共跑步机降临' : `公共跑步机 ×${event.multiplier} · ${Math.max(0, Math.ceil((event.endsAt - now) / 1000))}s`;
    for (const popup of this.popups) {
      popup.age += dt;
      const progress = popup.age / .85;
      const pos = popup.anchor.clone().add(new THREE.Vector3(0, popup.age * 2, 0)).project(this.camera);
      const x = popup.close ? 96 + popup.lane * 20 * (1 - progress) : (pos.x * .5 + .5) * innerWidth + popup.lane * (32 + popup.age * 8);
      const y = popup.close ? innerHeight - 160 + progress * 60 : (-pos.y * .5 + .5) * innerHeight - popup.age * 40;
      popup.node.style.transform = `translate(${x}px,${y}px) translate(-50%,-50%) scale(${1 + .12 * Math.sin(progress * Math.PI)})`;
      popup.node.style.opacity = pos.z > 1 || pos.z < -1 ? 0 : Math.min(1, (1 - progress) * 2);
      if (progress >= 1) popup.node.remove();
    }
    this.popups = this.popups.filter(p => p.age < .85);
    for (const burst of this.bursts) {
      burst.age += dt; const t = burst.age;
      for (const {mesh, velocity} of burst.shards) { mesh.position.addScaledVector(velocity, dt); velocity.y -= 22 * dt; mesh.rotation.x += dt * 2; }
      burst.material.opacity = Math.max(0, 1 - t / 1.4);
      burst.rings.forEach((mesh, i) => { mesh.scale.setScalar((i ? 2.2 : 5) * (1 + t * 4)); mesh.material.opacity = Math.max(0, .75 - t); });
      burst.smoke.forEach((mesh, i) => { mesh.position.y = t * (2 + i % 3); mesh.scale.setScalar(1 + t * 2); mesh.material.opacity = Math.max(0, .28 * (1 - t / 2.2)); });
      if (t > 2.2) { burst.root.removeFromParent(); burst.root.traverse(o => { o.geometry?.dispose(); o.material?.dispose(); }); }
    }
    this.bursts = this.bursts.filter(b => b.age <= 2.2);
    if (this.cutsceneUntil > now && this.public) {
      const target = new THREE.Vector3().setFromMatrixPosition(this.publicMatrix).add(new THREE.Vector3(0, 12, 0));
      this.camera.position.copy(target).add(new THREE.Vector3(35, 24, 38)); this.camera.lookAt(target);
    }
    if (this.shakeUntil > performance.now() && this.player.motor.position.distanceTo(new THREE.Vector3().setFromMatrixPosition(this.publicMatrix)) < 400) {
      const strength = Math.max(0, (this.shakeUntil - performance.now()) / 1100) * .45;
      this.camera.position.x += Math.sin(performance.now() * .077) * strength;
      this.camera.position.y += Math.sin(performance.now() * .093) * strength;
    }
  }
}
