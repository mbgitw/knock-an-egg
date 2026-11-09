import * as THREE from 'three';
import {OrbitControls} from '../vendor/OrbitControls.js';
import {OBJLoader} from '../vendor/OBJLoader.js';
import {MTLLoader} from '../vendor/MTLLoader.js';
import {createTreadmillEffects} from './treadmill-effects.js';

const canvas = document.querySelector('canvas');
const renderer = new THREE.WebGLRenderer({canvas, antialias: true});
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.NoToneMapping;
const scene = new THREE.Scene();
scene.background = new THREE.Color('#151e2b');
const camera = new THREE.PerspectiveCamera(42, 1, .1, 200);
const controls = new OrbitControls(camera, canvas);
controls.enableDamping = true;
scene.add(new THREE.HemisphereLight(0xffffff, 0xb6bfcd, 1.5));
const key = new THREE.DirectionalLight(0xffffff, 1.8);
key.position.set(6, 10, 8);
scene.add(key);
const rim = new THREE.DirectionalLight(0xffffff, .8);
rim.position.set(-7, 4, -5);
scene.add(rim);
const grid = new THREE.GridHelper(45, 45, 0x45617b, 0x283b50);
grid.position.y = -.02;
scene.add(grid);
const display = new THREE.Group();
scene.add(display);
const response = await fetch('./treadmills/catalog.json');
if (!response.ok) throw Error(`跑步机清单：${response.status}`);
const catalog = await response.json();
const effectsResponse = await fetch('./treadmills/effects/catalog.json');
if (!effectsResponse.ok) throw Error(`跑步机特效清单：${effectsResponse.status}`);
const effectsCatalog = await effectsResponse.json();
const models = new Map();
let wire = false, spin = false, effectsEnabled = true;
let activeTier = null;
const effectsButton = document.createElement('button');
effectsButton.id = 'effects-toggle';
effectsButton.textContent = '特效：开';
document.querySelector('#wire').before(effectsButton);

async function load(item) {
  const response = await fetch(item.mtl);
  if (!response.ok) throw Error(`${item.mtl}: ${response.status}`);
  // Studio repeats the diffuse RGBA file as map_d. An MTL green-channel
  // alphaMap would make dark belts transparent; diffuse alpha already applies.
  const mtlText = (await response.text()).split(/\r?\n/)
    .filter(line => !line.startsWith('map_d ')).join('\n');
  const materials = new MTLLoader().parse(mtlText, item.mtl.slice(0, item.mtl.lastIndexOf('/') + 1));
  materials.preload();
  const group = await new OBJLoader().setMaterials(materials).loadAsync(item.url);
  let partOrder = 0;
  group.traverse(object => {
    if (!object.isMesh) return;
    const depthPriority = ++partOrder;
    for (const material of Array.isArray(object.material) ? object.material : [object.material]) {
      material.side = THREE.DoubleSide;
      // Volcanic OBJ solids intersect along the same bottom plane (Y=.500003).
      // Stable depth priority resolves partial coplanar overlaps without moving
      // vertices, deleting visible surfaces, or changing the source OBJ.
      if (item.tier === 8) {
        material.polygonOffset = true;
        material.polygonOffsetFactor = 0;
        material.polygonOffsetUnits = -2 * depthPriority;
      }
      // Studio writes Kd = (Color3 RGB / 255)^2.2. MTLLoader assumes Kd is
      // sRGB and decodes again, crushing midtones. Recover source RGB first.
      const kd = materials.materialsInfo[material.name]?.kd;
      if (kd) material.color.setRGB(...kd.map(value => Math.pow(Math.max(0, value), 1 / 2.2)), THREE.SRGBColorSpace);
      // OBJ emission maps are masks; their white pixels must retain the part tint.
      if (material.emissiveMap) material.emissive.copy(material.color);
      // Studio exports RGB normal maps under map_Bump.
      if (material.bumpMap) {
        material.normalMap = material.bumpMap;
        material.bumpMap = null;
      }
    }
  });
  const box = new THREE.Box3().setFromObject(group);
  const size = box.getSize(new THREE.Vector3());
  const container = new THREE.Group();
  container.add(group);
  container.position.sub(box.getCenter(new THREE.Vector3()));
  const system = await createTreadmillEffects(effectsCatalog.find(data => data.tier === item.tier)?.nodes || []);
  container.add(system.root);
  const wrapper = new THREE.Group();
  wrapper.add(container);
  wrapper.scale.setScalar(4.2 / Math.max(size.x, size.y, size.z));
  wrapper.userData.staticRoot = group;
  wrapper.userData.effects = system;
  return wrapper;
}

function displayBounds() {
  const box = new THREE.Box3();
  for (const model of display.children) {
    model.updateWorldMatrix(true, true);
    box.union(new THREE.Box3().setFromObject(model.userData.staticRoot));
  }
  return box;
}

function fit() {
  const box = displayBounds();
  if (box.isEmpty()) return;
  const center = box.getCenter(new THREE.Vector3());
  const size = box.getSize(new THREE.Vector3());
  const distance = Math.max(size.y, size.x / camera.aspect, size.z) * 1.8 + 3;
  controls.target.copy(center);
  camera.position.copy(center).add(new THREE.Vector3(.65, .85, 1).normalize().multiplyScalar(distance));
  controls.update();
}

function select(tier) {
  activeTier = tier;
  display.clear();
  for (const item of catalog) {
    const model = models.get(item.tier);
    if (!model || (tier !== null && tier !== item.tier)) continue;
    model.position.set(tier === null ? ((item.tier - 1) % 5 - 2) * 6 : 0, 0,
      tier === null ? (Math.floor((item.tier - 1) / 5) - .5) * 7 : 0);
    model.updateWorldMatrix(true, true);
    const bounds = new THREE.Box3().setFromObject(model.userData.staticRoot);
    model.position.y -= bounds.min.y;
    display.add(model);
  }
  document.querySelectorAll('[data-tier]').forEach(button => {
    button.classList.toggle('active', Number(button.dataset.tier) === tier);
  });
  const item = catalog.find(entry => entry.tier === tier);
  const info = document.querySelector('#info');
  info.replaceChildren();
  const heading = document.createElement('h3');
  heading.textContent = item ? `${item.tier}. ${item.name}` : '设施 / 跑步机 · 10种';
  info.append(heading);
  const rows = item ? [
    `${item.originalName}${item.multiplier ? ` · 成长倍率 ×${item.multiplier}` : ' · 公共设备'}`,
    `${item.status} · ${item.note}`,
    `${item.parts} 个部件 · ${item.triangles.toLocaleString()} 个三角形 · ${item.textureStatus}`,
    `特效${effectsEnabled ? '已开启' : '已关闭'}：${Object.entries(item.effects).map(([key, value]) => `${key} ×${value}`).join('，') || '此模型无粒子或光束'}；部分纹理为程序近似。`,
  ] : [
    '9级普通跑步机与管理员公共跑步机，使用 Studio 原生 OBJ、材质和贴图。',
    '尖刺缺12个Union，极速缺4个Union，幽灵缺1个网格；管理员已补齐。',
    '已接入27个粒子发射器、5条光束及序列帧；部分纹理为程序近似，未接入角色训练动画。',
  ];
  rows.forEach((text, index) => {
    const paragraph = document.createElement('p');
    paragraph.textContent = text;
    if (item && index === 3) paragraph.dataset.effectsStatus = '';
    if (index === 1) paragraph.className = !item || item.missingParts || item.loadError ? 'missing' : 'tag';
    info.append(paragraph);
  });
  fit();
  history.replaceState(null, '', `#treadmills${tier ? '/' + tier : ''}`);
}

await Promise.all(catalog.map(async item => {
  try {
    models.set(item.tier, await load(item));
  } catch (error) {
    item.status = '加载失败';
    item.loadError = true;
    console.error(item.originalName, error);
  }
}));
for (const item of catalog) {
  const button = document.createElement('button');
  button.dataset.tier = item.tier;
  button.append(`${String(item.tier).padStart(2, '0')}  ${item.name}`);
  const status = document.createElement('small');
  status.textContent = item.status;
  button.append(status);
  button.onclick = () => select(item.tier);
  document.querySelector('#list').append(button);
}
document.querySelector('#count').textContent = `${models.size} / ${catalog.length}`;
document.querySelector('#all').textContent = '全部跑步机';
document.querySelector('#all').onclick = () => select(null);
document.querySelector('#reset').onclick = fit;
effectsButton.onclick = () => {
  effectsEnabled = !effectsEnabled;
  effectsButton.textContent = `特效：${effectsEnabled ? '开' : '关'}`;
  for (const model of models.values()) model.userData.effects.root.visible = effectsEnabled;
  const status = document.querySelector('[data-effects-status]');
  if (status) status.textContent = status.textContent.replace(/^特效已(?:开启|关闭)/, `特效已${effectsEnabled ? '开启' : '关闭'}`);
};
document.querySelector('#spin').onclick = event => {
  spin = !spin;
  controls.autoRotate = spin;
  event.target.textContent = `自动旋转：${spin ? '开' : '关'}`;
};
document.querySelector('#wire').onclick = event => {
  wire = !wire;
  for (const group of models.values()) group.traverse(object => {
    if (!object.isMesh || object.userData.effect) return;
    for (const material of Array.isArray(object.material) ? object.material : [object.material]) material.wireframe = wire;
  });
  event.target.textContent = `线框：${wire ? '开' : '关'}`;
};
document.querySelector('#background').onchange = event => {
  scene.background.set(event.target.value === 'light' ? '#d9e0e7' : '#151e2b');
};
let lastWidth = 0, lastHeight = 0;
function resize() {
  const width = canvas.clientWidth, height = canvas.clientHeight;
  if (width === lastWidth && height === lastHeight) return;
  lastWidth = width;
  lastHeight = height;
  renderer.setSize(width, height, false);
  camera.aspect = width / height;
  camera.updateProjectionMatrix();
}
window.addEventListener('resize', resize);
resize();
select(Number(location.hash.split('/')[1]) || null);
const clock = new THREE.Clock();
renderer.setAnimationLoop(() => {
  const dt = Math.min(clock.getDelta(), .05);
  resize();
  controls.update();
  // The floor guide should not cover the asset when inspecting its underside.
  grid.visible = camera.position.y > grid.position.y + .05;
  if (effectsEnabled) for (const model of display.children) model.userData.effects.update(dt, camera);
  renderer.render(scene, camera);
});
