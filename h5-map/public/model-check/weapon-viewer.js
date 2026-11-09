import * as THREE from 'three';
import {OrbitControls} from '../vendor/OrbitControls.js';
import {createWeaponEffects} from './weapon-effects.js';

const canvas = document.querySelector('canvas');
const renderer = new THREE.WebGLRenderer({canvas, antialias: true});
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
const scene = new THREE.Scene();
scene.background = new THREE.Color('#151e2b');
const camera = new THREE.PerspectiveCamera(40, 1, .01, 500);
const controls = new OrbitControls(camera, canvas);
controls.enableDamping = true;
scene.add(new THREE.HemisphereLight(0xe6f2ff, 0x596178, 2));
const key = new THREE.DirectionalLight(0xffffff, 2.5);
key.position.set(6, 10, 10);
scene.add(key);
const fill = new THREE.DirectionalLight(0xa9ceff, 1.5);
fill.position.set(-7, 5, -4);
scene.add(fill);
const display = new THREE.Group();
scene.add(display);
const grid = new THREE.GridHelper(40, 40, 0x476079, 0x283b50);
grid.position.y = -.03;
scene.add(grid);

async function fetchJSON(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`);
  return response.json();
}
const catalog = await fetchJSON('./weapons/catalog.json');
const swingLink=document.createElement('a');swingLink.href='./weapon-swing.html';swingLink.textContent='挥击候选 ↗';document.querySelector('.toolbar').append(swingLink);
const effectCatalog = await fetchJSON('./weapons/effects/catalog.json');
const models = new Map();
const textures = new Map();
const textureLoader = new THREE.TextureLoader();
let current = null, wire = false, actualSize = false, columns = 5;
let effectsEnabled = true, effectsPaused = false, effectTime = 0;
const effectButton = document.createElement('button');
effectButton.textContent = '特效：开';
const pauseButton = document.createElement('button');
pauseButton.textContent = '暂停特效';
document.querySelector('#wire').before(effectButton, pauseButton);
effectButton.onclick = () => {
  effectsEnabled = !effectsEnabled;
  effectButton.textContent = `特效：${effectsEnabled ? '开' : '关'}`;
  for (const model of models.values()) model.userData.effects.root.visible = effectsEnabled;
};
pauseButton.onclick = () => {
  effectsPaused = !effectsPaused;
  pauseButton.textContent = effectsPaused ? '继续特效' : '暂停特效';
};
const sizeButton = document.createElement('button');
sizeButton.textContent = '尺寸：等高展示';
document.querySelector('#wire').after(sizeButton);
document.querySelector('#all').textContent = '全部武器';

async function loadMaterial(spec) {
  const material = new THREE.MeshPhongMaterial({
    side: THREE.DoubleSide, shininess: Math.min(spec.shininess, 90),
    opacity: spec.opacity, transparent: spec.opacity < 1,
    specular: new THREE.Color(.12, .12, .12),
  });
  material.color.setRGB(...(spec.map ? spec.textureTint : spec.color), THREE.SRGBColorSpace);
  for (const field of ['map', 'normalMap', 'emissiveMap', 'specularMap']) {
    if (!spec[field]) continue;
    const cacheKey = `${field}:${spec[field]}`;
    if (!textures.has(cacheKey)) {
      textures.set(cacheKey, textureLoader.loadAsync(spec[field]).then(texture => {
        if (field === 'map' || field === 'emissiveMap') texture.colorSpace = THREE.SRGBColorSpace;
        texture.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
        return texture;
      }));
    }
    material[field] = await textures.get(cacheKey);
  }
  if (material.emissiveMap) material.emissive.setRGB(...spec.emissive);
  if (spec.neon) {
    material.emissive.copy(material.color);
    material.emissiveIntensity = .8;
  }
  // SurfaceAppearance Overlay uses opaque texture color; alpha is not a cutout.
  if (material.map && !spec.surfaceAppearance) material.alphaTest = .01;
  return material;
}

function labelFor(item) {
  const surface = document.createElement('canvas');
  surface.width = 512; surface.height = 80;
  const ctx = surface.getContext('2d');
  ctx.fillStyle = '#dfeeff'; ctx.textAlign = 'center';
  ctx.font = '600 32px system-ui';
  ctx.fillText(`${String(item.tier).padStart(2, '0')}  ${item.name}`, 256, 46);
  const texture = new THREE.CanvasTexture(surface);
  texture.colorSpace = THREE.SRGBColorSpace;
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({map: texture, depthTest: false}));
  sprite.scale.set(4.5, .7, 1);
  return sprite;
}

for (const item of catalog) {
  const button = document.createElement('button');
  button.dataset.weaponTier = item.tier;
  button.append(`${String(item.tier).padStart(2, '0')}  ${item.name}`);
  const detail = document.createElement('small');
  detail.textContent = item.originalName;
  button.append(detail);
  button.onclick = () => select(item.tier);
  document.querySelector('#list').append(button);
  try {
    const parts = await fetchJSON(item.url);
    const root = new THREE.Group();
    root.name = item.originalName;
    for (const part of parts) {
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute('position', new THREE.Float32BufferAttribute(part.positions, 3));
      geometry.setAttribute('normal', new THREE.Float32BufferAttribute(part.normals, 3));
      geometry.setAttribute('uv', new THREE.Float32BufferAttribute(part.uvs, 2));
      geometry.setIndex(part.indices);
      const mesh = new THREE.Mesh(geometry, await loadMaterial(part.material));
      mesh.name = part.name;
      root.add(mesh);
    }
    // The basic bat's SpecialMesh is authored along Z; rotate only the display.
    if (item.tier === 1) root.rotation.x = -Math.PI / 2;
    const bounds = new THREE.Box3().setFromObject(root);
    const center = bounds.getCenter(new THREE.Vector3());
    const size = bounds.getSize(new THREE.Vector3());
    root.position.set(-center.x, -bounds.min.y, -center.z);
    const staticRoot = new THREE.Group();
    for (const child of [...root.children]) staticRoot.add(child);
    root.add(staticRoot);
    const effects = await createWeaponEffects(effectCatalog.find(entry => entry.tier === item.tier)?.nodes || []);
    effects.root.visible = effectsEnabled;
    root.add(effects.root);
    const wrapper = new THREE.Group();
    wrapper.add(root);
    wrapper.userData = {root, staticRoot, effects, size, label: labelFor(item), item};
    models.set(item.tier, wrapper);
  } catch (error) {
    detail.textContent = '加载失败'; detail.className = 'missing';
    console.error(item.originalName, error);
  }
  document.querySelector('#count').textContent = `${models.size} / ${catalog.length}`;
}

function fit() {
  const bounds = new THREE.Box3();
  for (const model of models.values()) {
    if (model.parent === display) {
      model.updateWorldMatrix(true, true);
      bounds.union(new THREE.Box3().setFromObject(model.userData.staticRoot));
    }
  }
  if (bounds.isEmpty()) return;
  const center = bounds.getCenter(new THREE.Vector3());
  const size = bounds.getSize(new THREE.Vector3());
  const top = document.querySelector('.toolbar').offsetHeight + 35;
  const bottom = document.querySelector('#info').offsetHeight + 35;
  const availableHeight = Math.max(100, canvas.clientHeight - top - bottom);
  camera.setViewOffset(canvas.clientWidth, canvas.clientHeight, 0, (bottom-top)/2,
                       canvas.clientWidth, canvas.clientHeight);
  const distance = Math.max((size.y + 1.5) * canvas.clientHeight / availableHeight,
                            (size.x + 2) / camera.aspect) /
                   (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2))) * 1.12 + size.z;
  controls.target.copy(center);
  camera.position.copy(center).add(new THREE.Vector3(.16, .1, 1).normalize().multiplyScalar(distance));
  controls.update();
}

function select(tier) {
  current = tier;
  display.clear();
  for (const [id, model] of models) {
    if (tier !== null && tier !== id) continue;
    const {size, label} = model.userData;
    const scale = actualSize ? 1 : 5.3 / Math.max(size.x, size.y, size.z);
    model.scale.setScalar(scale);
    const spacing = actualSize ? 13 : 7.5;
    model.position.set(tier === null ? ((id-1) % columns - (columns-1)/2) * spacing : 0,
                       tier === null ? Math.floor((id-1)/columns) * -(actualSize ? 14 : 8) : 0, 0);
    display.add(model);
    if (tier === null) {
      label.position.copy(model.position).add(new THREE.Vector3(0, -.65, 0));
      display.add(label);
    }
  }
  grid.visible = tier !== null;
  document.querySelectorAll('[data-weapon-tier]').forEach(button => {
    button.classList.toggle('active', Number(button.dataset.weaponTier) === tier);
  });
  const item = catalog.find(entry => entry.tier === tier);
  document.querySelector('#info').innerHTML = item
    ? `<h3>${item.tier}. ${item.name} · ${item.originalName}</h3>
       <p class="tag">Studio 原生 OBJ · ${item.parts} 个可见部件 · ${item.triangles.toLocaleString()} 个三角面</p>
       <p>原尺寸：${item.bounds.size.map(n => n.toFixed(2)).join(' × ')} · ${actualSize ? '原始比例' : '等高展示'}</p>
       <p>${item.effects.ParticleEmitter || 0} 个粒子发射器 · ${item.effects.Beam || 0} 条光束 · ${Object.keys(item.effects).length ? '原贴图与参数动态预览' : '原模型无动态特效'}</p>`
    : `<h3>武器 / 球棒与电锤 · ${models.size} / 10</h3>
       <p>9 把球棒 + 1 把电锤 · 全部来自游戏 模型资源</p>
       <p>25 个可见部件 · 14,335 个三角面 · 29 张原生导出材质图（32–64 像素）</p>
       <p>16 个粒子发射器 + 3 条光束已播放 · 14 种原效果贴图齐全</p>`;
  history.replaceState(null, '', tier ? `#weapons/${tier}` : '#weapons');
  fit();
}
sizeButton.onclick = () => {
  actualSize = !actualSize;
  sizeButton.textContent = `尺寸：${actualSize ? '原始比例' : '等高展示'}`;
  select(current);
};
document.querySelector('#all').onclick = () => select(null);
document.querySelector('#reset').onclick = fit;
document.querySelector('#spin').onclick = event => {
  controls.autoRotate = !controls.autoRotate;
  event.target.textContent = `自动旋转：${controls.autoRotate ? '开' : '关'}`;
};
document.querySelector('#wire').onclick = event => {
  wire = !wire;
  for (const model of models.values()) model.traverse(node => {
    if (node.isMesh && !node.userData.effect) node.material.wireframe = wire;
  });
  event.target.textContent = `线框：${wire ? '开' : '关'}`;
};
document.querySelector('#background').onchange = event => {
  scene.background.set(event.target.value === 'light' ? '#d9e0e7' : '#151e2b');
};
let lastWidth = 0, lastHeight = 0;
function resize() {
  const {clientWidth: width, clientHeight: height} = canvas;
  if (!width || !height || (width === lastWidth && height === lastHeight)) return;
  lastWidth = width; lastHeight = height;
  renderer.setSize(width, height, false);
  camera.aspect = width / height;
  camera.updateProjectionMatrix();
  columns = width < 650 ? 3 : 5;
  select(current);
}
const requested = Number(location.hash.split('/')[1]);
current = models.has(requested) ? requested : null;
resize();
select(current);
let lastTime = performance.now();
renderer.setAnimationLoop(() => {
  const now = performance.now();
  const dt = document.hidden ? 0 : Math.min(.05, (now-lastTime)/1000);
  lastTime = now;
  resize();
  controls.update();
  if (effectsEnabled) {
    const step = effectsPaused ? 0 : dt;
    effectTime += step;
    for (const model of models.values()) {
      if (model.parent === display) model.userData.effects.update(step, camera);
    }
  }
  canvas.dataset.effectTime = effectTime.toFixed(4);
  canvas.dataset.effectsEnabled = String(effectsEnabled);
  canvas.dataset.effectsPaused = String(effectsPaused);
  renderer.render(scene, camera);
});
