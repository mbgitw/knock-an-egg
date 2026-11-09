import * as THREE from 'three';
import {buildMultiMeshAnimal} from './multi-mesh-animal.js';

export function buildSkinnedAnimal(data, material) {
  const geometry = new THREE.BufferGeometry();
  for (const [attribute, key, size, Type] of [
    ['position', 'positions', 3, Float32Array], ['normal', 'normals', 3, Float32Array],
    ['uv', 'uvs', 2, Float32Array], ['skinIndex', 'skinIndices', 4, Uint16Array],
    ['skinWeight', 'skinWeights', 4, Float32Array],
  ]) geometry.setAttribute(attribute, new THREE.BufferAttribute(new Type(data[key]), size));
  geometry.setIndex(data.indices);
  const root = new THREE.Group();
  const mesh = new THREE.SkinnedMesh(geometry, material);
  mesh.frustumCulled = false;
  mesh.scale.fromArray(data.scale);
  root.add(mesh);
  const bones = data.bones.map(source => {
    const bone = new THREE.Bone();
    bone.name = source.name;
    bone.position.fromArray(source.position);
    bone.quaternion.fromArray(source.quaternion).normalize();
    bone.userData.restPosition = bone.position.clone();
    bone.userData.restQuaternion = bone.quaternion.clone();
    return bone;
  });
  data.bones.forEach((source, index) => {
    (source.parent < 0 ? mesh : bones[source.parent]).add(bones[index]);
  });
  root.updateMatrixWorld(true);
  const skeleton = new THREE.Skeleton(bones);
  mesh.bind(skeleton);
  skeleton.update();
  const bounds = new THREE.Box3().setFromObject(root);
  const center = bounds.getCenter(new THREE.Vector3());
  root.position.set(-center.x, -bounds.min.y, -center.z);
  root.updateMatrixWorld(true);
  skeleton.update();
  return {root, mesh, skeleton, bones, mixer: new THREE.AnimationMixer(root), actions: new Map()};
}

export function buildAnimalClip(source, rig) {
  const tracks = [];
  const identity = new THREE.Quaternion();
  for (const bone of rig.bones) {
    const keys = source.tracks[bone.name];
    if (!keys?.length || keys.every(key => key[8] === 0)) continue;
    const times = [], positions = [], rotations = [];
    for (const key of keys) {
      times.push(key[0]);
      const weight = THREE.MathUtils.clamp(key[8], 0, 1);
      const offset = new THREE.Vector3(...key.slice(1, 4)).multiplyScalar(weight);
      offset.applyQuaternion(bone.userData.restQuaternion).add(bone.userData.restPosition);
      const rotation = identity.clone().slerp(new THREE.Quaternion(...key.slice(4, 8)).normalize(), weight);
      rotation.premultiply(bone.userData.restQuaternion);
      positions.push(...offset.toArray());
      rotations.push(...rotation.toArray());
    }
    tracks.push(new THREE.VectorKeyframeTrack(`${bone.uuid}.position`, times, positions));
    tracks.push(new THREE.QuaternionKeyframeTrack(`${bone.uuid}.quaternion`, times, rotations));
  }
  return new THREE.AnimationClip(source.name, source.duration, tracks);
}

export async function createAnimalAnimationPreview({catalog, models, scene, display, canvas, onChange, paid = false}) {
  const manifest = {};
  for (const url of paid ? ['./paid-animal-animations/catalog.json'] : ['./animal-animations/catalog.json','./planet-x-animations/catalog.json']) {
    const response = await fetch(url);
    if (!response.ok) throw Error(`动物动画清单：${response.status}`);
    Object.assign(manifest, await response.json());
  }
  const panel = document.createElement('div');
  panel.className = 'animation-controls';
  panel.innerHTML = `
    <select id="animal-action" aria-label="动物动作"><option value="Idle">待机 Idle</option><option value="Walk">行走 Walk</option><option value="Static">静止姿态</option></select>
    <select id="animal-candidate" aria-label="同骨架动画候选" hidden><option value="A">候选 A（归属待确认）</option><option value="B">候选 B（归属待确认）</option></select>
    <button id="animation-play">暂停</button>
    <select id="animation-speed" aria-label="动画速度"><option value="0.25">0.25×</option><option value="0.5">0.5×</option><option value="1" selected>1× 速度</option><option value="1.5">1.5×</option><option value="2">2×</option></select>
    <button id="animation-loop">循环：开</button><button id="animal-bones">骨骼：关</button>
    <input id="animation-progress" type="range" min="0" max="1000" step="1" value="0" aria-label="动画进度">
    <span id="animation-time"></span><span id="animation-status"></span>`;
  document.querySelector('.toolbar').append(panel);
  const actionSelect = panel.querySelector('#animal-action');
  const candidateSelect=panel.querySelector('#animal-candidate');
  let candidate='A';
  const trackFor=rig=>rig?.actions.get(action+(rig.ambiguous&&candidate==='B'&&action!=='Static'?'B':''));
  const playButton = panel.querySelector('#animation-play');
  const progress = panel.querySelector('#animation-progress');
  const timeLabel = panel.querySelector('#animation-time');
  const status = panel.querySelector('#animation-status');
  const rigs = new Map(), requests = new Map();
  let action = 'Idle', playing = true, speed = 1, loop = true, bonesVisible = false;
  let selected = null, completed = 0, total = Object.values(manifest).filter(item => item.rig).length;
  let lastUiUpdate = 0;

  async function json(url) {
    if (!requests.has(url)) requests.set(url, fetch(url).then(response => {
      if (!response.ok) throw Error(`${url}: ${response.status}`);
      return response.json();
    }));
    return requests.get(url);
  }

  function apply(rig) {
    rig.mixer.stopAllAction();
    rig.bones.forEach(bone => {
      bone.position.copy(bone.userData.restPosition);
      bone.quaternion.copy(bone.userData.restQuaternion);
    });
    const clipAction = trackFor(rig);
    if (action !== 'Static' && clipAction) {
      clipAction.reset().setLoop(loop ? THREE.LoopRepeat : THREE.LoopOnce, loop ? Infinity : 1);
      clipAction.clampWhenFinished = !loop;
      clipAction.play();
    }
    rig.staticRoot.visible = action === 'Static' || !clipAction;
    rig.root.visible = !rig.staticRoot.visible;
    rig.mixer.update(0);
  }

  function refresh() {
    let visibleRigs = 0;
    for (const [id, rig] of rigs) {
      const visible = rig.wrapper.parent === display;
      rig.helper.visible = visible && bonesVisible;
      if (visible && (action === 'Static' || trackFor(rig))) visibleRigs++;
    }
    const info = selected && manifest[selected];
    candidateSelect.hidden=!info?.ambiguous;
    const available = selected ? !!trackFor(rigs.get(selected)) : visibleRigs > 0;
    const active = action !== 'Static' && available;
    playButton.disabled = !active;
    playButton.textContent = playing ? '暂停' : '播放';
    progress.disabled = !selected || !active;
    if (completed < total) status.textContent = `动画加载 ${completed} / ${total}`;
    else if (selected && !info?.rig) status.textContent = catalog.find(item => item.id === selected)?.recoverySource ? '模型已恢复 · 动画尚未接入' : '该动物缺少蒙皮网格';
    else if (selected && !rigs.has(selected)) status.textContent = '动画资源加载失败';
    else if (selected && action !== 'Static' && !available) status.textContent = '该动作尚无可用数据';
    else status.textContent = info?.ambiguous ? `候选 ${candidate} · 两物种共用骨架，动画归属待确认` : selected ? (info?.userConfirmed?'缓存动作 · 用户已确认归属':'缓存动作 · 骨架已核对') : `${rigs.size} / ${catalog.length}种可播放 · 缓存动作`;
    canvas.dataset.animation = action;
    canvas.dataset.animationPlaying = String(playing && !!active);
    canvas.dataset.animationRigs = String(rigs.size);
    if (!selected) timeLabel.textContent = '总览播放';
    else if (!active) timeLabel.textContent = '—';
    if (!active) {
      progress.value = '0';
      delete timeLabel.dataset.time;
    }
  }

  actionSelect.onchange = () => {
    action = actionSelect.value;
    playing = true;
    rigs.forEach(apply);
    refresh();
    onChange();
  };
  candidateSelect.onchange=()=>{candidate=candidateSelect.value;rigs.forEach(apply);refresh();onChange();};
  playButton.onclick = () => {
    playing = !playing;
    if (playing && selected) {
      const track = trackFor(rigs.get(selected));
      if (track?.paused) track.reset().play();
    }
    updateTimeline();
    refresh();
  };
  panel.querySelector('#animation-speed').onchange = event => { speed = Number(event.target.value); };
  panel.querySelector('#animation-loop').onclick = event => {
    loop = !loop;
    rigs.forEach(apply);
    event.target.textContent = `循环：${loop ? '开' : '关'}`;
    refresh();
  };
  panel.querySelector('#animal-bones').onclick = event => {
    bonesVisible = !bonesVisible;
    event.target.textContent = `骨骼：${bonesVisible ? '开' : '关'}`;
    refresh();
  };
  progress.oninput = () => {
    const rig = rigs.get(selected), clipAction = trackFor(rig);
    if (!clipAction) return;
    playing = false;
    clipAction.paused = false;
    clipAction.time = Number(progress.value) / 1000 * clipAction.getClip().duration;
    rig.mixer.update(0);
    updateTimeline();
    refresh();
  };

  function updateTimeline() {
    const clipAction = trackFor(rigs.get(selected));
    if (!clipAction || action === 'Static') return;
    const duration = clipAction.getClip().duration;
    progress.value = String(Math.round(clipAction.time / duration * 1000));
    timeLabel.textContent = `${clipAction.time.toFixed(2)} / ${duration.toFixed(2)} s`;
    timeLabel.dataset.time = clipAction.time.toFixed(4);
  }

  async function load(item) {
    const data = manifest[item.id];
    if (!data?.rig) return;
    try {
      const wrapper = models.get(item.id);
      if (!wrapper) throw Error('Static model unavailable');
      const staticRoot = wrapper.children[0];
      let material;
      const materials=new Map();
      staticRoot.traverse(object => {
        if (!material && object.isMesh) material = object.material;
        if(object.isMesh)for(const m of Array.isArray(object.material)?object.material:[object.material])materials.set(m.name,m);
      });
      const rigData=await json(data.rig);
      const rig = data.format==='multi-mesh'?buildMultiMeshAnimal(rigData,materials):buildSkinnedAnimal(rigData, material);
      Object.assign(rig, {wrapper, staticRoot, ambiguous:!!data.ambiguous});
      rig.mesh.traverse(object=>{if(object.isMesh)object.userData.itemId=item.id;});
      wrapper.add(rig.root);
      rig.helper = new THREE.SkeletonHelper(rig.mesh);
      rig.helper.material.depthTest = false;
      rig.helper.material.transparent = true;
      rig.helper.material.opacity = .85;
      rig.helper.visible = false;
      scene.add(rig.helper);
      rig.mixer.addEventListener('finished', () => {
        if (selected === item.id) { playing = false; refresh(); }
      });
      for (const [name, source] of Object.entries(data.actions)) {
        if (!source.available) continue;
        const clip = buildAnimalClip(await json(source.url), rig);
        if (clip.tracks.length) rig.actions.set(name, rig.mixer.clipAction(clip));
      }
      rigs.set(item.id, rig);
      apply(rig);
    } catch (error) {
      console.error(item.name, '动画加载失败', error);
    } finally {
      completed++;
      refresh();
      if (completed === total) onChange();
    }
  }
  const queue = catalog.filter(item => manifest[item.id]?.rig);
  const ready = Promise.all(Array.from({length: 4}, async () => {
    while (queue.length) await load(queue.shift());
  }));
  refresh();
  return {
    ready,
    select(id) { selected = id; refresh(); updateTimeline(); },
    listStatus(item) {
      if (!manifest[item.id]?.rig) return item.status;
      return rigs.has(item.id) ? (manifest[item.id].ambiguous?'Idle / Walk 候选待确认':'Idle / Walk 可预览') : '动画加载中';
    },
    description(item) {
      const data = item && manifest[item.id];
      if (!item && paid) return `${total}种付费动物支持待机 / 行走 · 完整骨架已核对`;
      if (!item) return `${total}种支持待机 / 行走 · X星球按完整骨架匹配，蜥蜴/巨兽动作归属已由用户确认`;
      if (!data?.rig) return item.recoverySource ? '分部件模型与骨骼绑定已恢复，动画尚未接入。' : '缺少可用蒙皮网格，当前无法预览动画。';
      if (!rigs.has(item.id)) return '正在加载蒙皮与动画…';
      return action === 'Static' ? '静止姿态 · 可切换待机或行走' : `${action === 'Idle' ? '待机' : '行走'}动画 · ${data.userConfirmed?'用户已确认动作归属':data.ambiguous?'候选 '+candidate+'，蜥蜴/巨兽归属待确认':data.format==='multi-mesh'?'完整骨架路径匹配 · 原资源ID未直接验证':'同名缓存动作 · 骨架已核对'}`;
    },
    update(dt) {
      for (const rig of rigs.values()) {
        if (rig.wrapper.parent === display && rig.root.visible && playing) rig.mixer.update(dt * speed);
      }
      if (performance.now() - lastUiUpdate > 80) {
        updateTimeline();
        lastUiUpdate = performance.now();
      }
    },
  };
}
