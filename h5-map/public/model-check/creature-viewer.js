import * as THREE from 'three';
import {OrbitControls} from '../vendor/OrbitControls.js';
import {OBJLoader} from '../vendor/OBJLoader.js';
import {MTLLoader} from '../vendor/MTLLoader.js';
import {loadV2LiveEgg} from '../gameplay/v2-live-egg.js';
import {setModelStudScaleCorrection} from '../gameplay/v2-model-studs.js';
import {createAnimalAnimationPreview} from './animal-animation-player.js';
import {eggAmbientCatalog,createEggAmbient} from '../gameplay/egg-ambient.js';

const category = document.body.dataset.category;
const isPaid = category === 'paid-animals';
const isAnimal = category === 'animals' || isPaid;
const title = isPaid ? '付费动物' : isAnimal ? '动物' : '蛋';
const zoneNames = ['森林', '沙漠', '雪地', '糖果', '沼泽', '海洋', '火山', '樱花', '银河', 'X星球'];
const canvas = document.querySelector('canvas');
const renderer = new THREE.WebGLRenderer({canvas, antialias: true});
renderer.setPixelRatio(Math.min(devicePixelRatio, 1.8));
renderer.outputColorSpace = THREE.SRGBColorSpace;
const scene = new THREE.Scene();
scene.background = new THREE.Color('#151e2b');
const camera = new THREE.PerspectiveCamera(42, 1, .1, 500);
const controls = new OrbitControls(camera, canvas);
controls.enableDamping = true;
scene.add(new THREE.HemisphereLight(0xdceeff, 0x5c6170, 2));
const sun = new THREE.DirectionalLight(0xffffff, 2.8);
sun.position.set(6, 10, 8);
scene.add(sun);
const rim = new THREE.DirectionalLight(0x8cbbff, 1.4);
rim.position.set(-7, 4, -5);
scene.add(rim);
const grid = new THREE.GridHelper(100, 100, 0x45617b, 0x283b50);
grid.position.y = -.025;
// The reference grid is a backdrop, not physical geometry. From below the
// ground its transparent lines otherwise overlay opaque eggs and look like holes.
grid.renderOrder = -1;
for (const material of Array.isArray(grid.material) ? grid.material : [grid.material]) {
  material.transparent = false;
  material.depthWrite = false;
}
scene.add(grid);
const display = new THREE.Group();
scene.add(display);
const response = await fetch(`./${category}/catalog.json`);
if (!response.ok) throw Error(`${title}清单：${response.status}`);
const catalog = await response.json();
if(!isAnimal){
  const replacements=await fetch('../gameplay/eggs/v2-replacements.json').then(r=>{if(!r.ok)throw Error('蛋补充清单加载失败');return r.json();});
  for(const v of replacements){const item=catalog.find(t=>t.id===v.id);if(item){
    item.originalMissingParts=item.missingParts;item.replacement=v;item.parts=v.geometry.parts;item.triangles=v.geometry.triangles;item.missingParts=0;
    item.status='v2实际使用模型';item.materialNote=`v2当前物种：${v.petName}（${v.petId}），区域：${v.sourceZone}。来源：${v.sourceFile}。${v.note}。`;
  }}
}
const byId = new Map(catalog.map(item => [item.id, item]));
const models = new Map(), labels = new Map();
const ambientData = isAnimal ? new Map() : await eggAmbientCatalog();
const ambientEffects = new Map();
let selected = null, zone = 'all', query = '', wire = false;
let animalAnimation = null;
const toolbar = document.querySelector('.toolbar');
const zoneSelect = document.createElement('select');
zoneSelect.id = 'zone-filter';
zoneSelect.setAttribute('aria-label', '区域');
zoneSelect.add(new Option('全部区域', 'all'));
if(isPaid) zoneSelect.add(new Option('Fallen Angel Egg', '1'));
else zoneNames.forEach((name, index) => zoneSelect.add(new Option(`${index + 1}区 · ${name}`, String(index + 1))));
toolbar.prepend(zoneSelect);
const search = document.createElement('input');
search.type = 'search';
search.id = 'model-search';
search.placeholder = `搜索${title}名称`;
search.setAttribute('aria-label', `搜索${title}名称`);
document.querySelector('#list').before(search);

function visibleItems() {
  return catalog.filter(item => (zone === 'all' || item.zone === Number(zone)) &&
    item.name.toLowerCase().includes(query));
}

function fit() {
  const box = new THREE.Box3();
  for (const model of display.children) if (!model.isSprite) {
    if(model.userData.modelBounds){model.updateWorldMatrix(true,false);box.union(model.userData.modelBounds.clone().applyMatrix4(model.matrixWorld));}
    else box.expandByObject(model);
  }
  if (box.isEmpty()) {
    controls.target.set(0, 1, 0);
    camera.position.set(9, 10, 12);
  } else {
    const center = box.getCenter(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3());
    const distance = Math.max(size.y, size.x / camera.aspect, size.z) * 1.65 + 4;
    controls.target.copy(center);
    const viewDirection = isAnimal ? new THREE.Vector3(.45, .45, -1) : new THREE.Vector3(.25, .65, 1);
    camera.position.copy(center).add(viewDirection.normalize().multiplyScalar(distance));
  }
  controls.update();
}

function labelFor(item) {
  if (labels.has(item.id)) return labels.get(item.id);
  const image = document.createElement('canvas');
  image.width = 512; image.height = 100;
  const context = image.getContext('2d');
  context.fillStyle = '#dfe7f0';
  context.textAlign = 'center';
  context.font = 'bold 25px system-ui';
  if(isPaid){context.strokeStyle='#000';context.lineWidth=4;context.lineJoin='round';context.strokeText(item.name,256,39,500);}
  context.fillText(item.name, 256, 39, 500);
  context.font = '21px system-ui';
  context.fillStyle = '#95a9bf';
  const groupLabel=isPaid?'Fallen Angel Egg':`${item.zone}区 · ${zoneNames[item.zone - 1]}`;
  if(isPaid)context.strokeText(groupLabel,256,75);
  context.fillText(groupLabel, 256, 75);
  const texture = new THREE.CanvasTexture(image);
  texture.colorSpace = THREE.SRGBColorSpace;
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({map: texture, depthTest: false}));
  sprite.scale.set(5.6, 1.1, 1);
  sprite.userData.itemId = item.id;
  labels.set(item.id, sprite);
  return sprite;
}

function renderList() {
  const list = document.querySelector('#list');
  list.replaceChildren();
  let lastZone;
  for (const item of visibleItems()) {
    if (lastZone !== item.zone) {
      const heading = document.createElement('h2');
      heading.textContent = isPaid?'Fallen Angel Egg':`${item.zone}区 · ${zoneNames[item.zone - 1]}`;
      list.append(heading);
      lastZone = item.zone;
    }
    const button = document.createElement('button');
    button.dataset.item = item.id;
    button.classList.toggle('active', selected === item.id);
    button.append(item.name);
    const status = document.createElement('small');
    status.textContent = item.loadError ? '加载失败' : (animalAnimation?.listStatus(item) || item.status);
    if (item.missingParts || item.loadError || !item.triangles) status.className = 'missing';
    button.append(status);
    button.onclick = () => select(item.id);
    list.append(button);
  }
}

function showInfo(item, visible) {
  const info = document.querySelector('#info');
  info.replaceChildren();
  const heading = document.createElement('h3');
  heading.textContent = item ? item.name : `${title} · ${isPaid?'Fallen Angel Egg':zone === 'all' ? '全部区域' : `${zone}区 ${zoneNames[Number(zone) - 1]}`}`;
  info.append(heading);
  const rows = item ? [
    `${isPaid?'':item.zone+'区 · '}${item.zoneName}${item.rarity ? ` · ${item.rarity}` : ''}`,
    item.loadError ? '模型加载失败，请刷新后重试' : `${item.parts} 个部件 · ${item.triangles.toLocaleString()} 个三角形${item.missingParts ? ` · 缺少${item.missingParts}个可见部件` : ''}`,
    ...(item.missingParts ? [item.geometryNote] : []),
    isAnimal ? `${item.bones} 根原始骨骼 · ${item.joints} 个关节 · Normal 模型` : item.replacement ? '用户指定v2项目的区域蛋替代外观' : `游戏区域蛋 · ${item.recoverySource ? '缓存恢复几何' : 'Studio 原生模型和材质'}`,
    ...(item.materialNote ? [item.materialNote] : []),
    ...(!isAnimal&&ambientData.get(item.id)?.nodes.length ? [`原蛋常驻特效：${ambientData.get(item.id).nodes.length}个；${ambientData.get(item.id).nodes.filter(n=>n.class==='ParticleEmitter'&&!n.texture).length}个发射器使用替代贴图。`] : []),
    ...(isAnimal ? [animalAnimation?.description(item) || '正在准备动画预览…'] : []),
  ] : [
    `${catalog.length}种${title}${isPaid?'':'，分属10个区域'} · 当前可显示${visible.filter(item => models.has(item.id)).length} / ${visible.length}种`,
    ...(visible.some(item => !models.has(item.id)) ? ['缺失模型保留在左侧清单，可点击查看原因。'] : []),
    visible.length ? '按区域或名称筛选，点击左侧名称或模型查看单件。' : '没有匹配的模型。',
    isAnimal ? (animalAnimation?.description(null) || '正在准备动画预览…') : '22种v2主题蛋补充缺口，其余保留游戏模型与材质。',
  ];
  for (const text of rows) {
    const paragraph = document.createElement('p');
    paragraph.textContent = text;
    info.append(paragraph);
  }
  if (item?.missingParts || item?.loadError) info.children[2]?.classList.add('missing');
}

function select(id = null, updateHash = true) {
  selected = byId.has(id) ? id : null;
  display.clear();
  const visible = selected ? [byId.get(selected)] : visibleItems();
  const available = visible.filter(item => models.has(item.id));
  const columns = Math.min(available.length, isPaid?3:zone === 'all' ? (isAnimal ? 10 : 5) : (isAnimal ? 4 : 3));
  const rows = Math.ceil(available.length / Math.max(columns, 1));
  available.forEach((item, index) => {
    const model = models.get(item.id);
    if (!model) return;
    const x = ((index % columns) - (columns - 1) / 2) * 6.7;
    const z = (Math.floor(index / columns) - (rows - 1) / 2) * 7.5;
    model.position.set(x, 0, z);
    display.add(model);
    if (!selected) {
      const label = labelFor(item);
      label.position.set(x, -.35, z + 2.9);
      display.add(label);
    }
  });
  document.querySelector('#count').textContent = `${models.size} / ${catalog.length}`;
  renderList();
  showInfo(byId.get(selected), visible);
  animalAnimation?.select(selected);
  fit();
  if (updateHash) history.replaceState(null, '', `#${category}${selected ? '/' + selected : zone !== 'all' ? '/zone-' + zone : ''}`);
  canvas.dataset.ready = 'true';
  canvas.dataset.modelCount = String(display.children.filter(object => !object.isSprite).length);
}

const materialSets = new Map();
function materialsFor(url) {
  if (!materialSets.has(url)) materialSets.set(url, (async () => {
    const response = await fetch(url);
    if (!response.ok) throw Error(`材质加载失败：${response.status}`);
    const text = (await response.text()).split(/\r?\n/).filter(line => !line.startsWith('map_d ')).join('\n');
    return new MTLLoader().parse(text, url.slice(0, url.lastIndexOf('/') + 1));
  })());
  return materialSets.get(url);
}
let finished = 0;
async function load(item) {
  try {
    if (!item.triangles) return;
    const materials = item.replacement ? null : await materialsFor(item.mtl);
    const group = item.replacement ? await loadV2LiveEgg(item.replacement,new URL('../gameplay/eggs/',location.href)) : await new OBJLoader().setMaterials(materials).loadAsync(item.url);
    group.traverse(object => {
      if (!object.isMesh) return;
      object.userData.itemId = item.id;
      if(item.replacement)return;
      for (const material of Array.isArray(object.material) ? object.material : [object.material]) {
        material.side = THREE.DoubleSide;
        const kd = materials.materialsInfo[material.name]?.kd;
        if (kd) material.color.setRGB(...kd.map(value => Math.pow(Math.max(0, value), 1 / 2.2)), THREE.SRGBColorSpace);
        if (material.emissiveMap) material.emissive.copy(material.color);
        if (material.bumpMap) { material.normalMap = material.bumpMap; material.bumpMap = null; }
      }
    });
    const bounds = new THREE.Box3().setFromObject(group);
    if (bounds.isEmpty()) throw Error('Empty geometry');
    const size = bounds.getSize(new THREE.Vector3());
    const center = bounds.getCenter(new THREE.Vector3());
    group.position.set(-center.x, -bounds.min.y, -center.z);
    const wrapper = new THREE.Group();
    wrapper.add(group);
    // Rotate the shared parent so static geometry and animated bones stay aligned.
    wrapper.rotation.y = item.facingYaw || 0;
    wrapper.scale.setScalar(4.2 / Math.max(size.x, size.y, size.z));
    // Preview fitting must not enlarge studs relative to the gameplay egg.
    if(item.replacement)setModelStudScaleCorrection(wrapper,(3+(item.zone-1)*.3)/(size.y*wrapper.scale.x));
    wrapper.userData.modelBounds=new THREE.Box3().setFromObject(wrapper).applyMatrix4(new THREE.Matrix4().makeScale(1/wrapper.scale.x,1/wrapper.scale.x,1/wrapper.scale.x));
    const ambient=ambientData.get(item.id);
    if(ambient?.nodes.length){
      const effect=await createEggAmbient(ambient);
      if(item.replacement){effect.root.scale.setScalar(size.y);effect.root.position.set(center.x,bounds.min.y,center.z);}
      else effect.root.applyMatrix4(new THREE.Matrix4().set(...ambient.unitToObj));
      group.add(effect.root);ambientEffects.set(item.id,effect);
    }
    models.set(item.id, wrapper);
  } catch (error) {
    item.loadError = error.message;
    console.error(item.name, error);
  } finally {
    document.querySelector('#count').textContent = `加载 ${++finished} / ${catalog.length}`;
  }
}
// Bound concurrent OBJ parses; shared material instances reuse the same textures.
const queue = [...catalog];
await Promise.all(Array.from({length: 6}, async () => { while (queue.length) await load(queue.shift()); }));
document.querySelector('#all').textContent = `全部${title}`;
document.querySelector('#all').onclick = () => { zone = 'all'; zoneSelect.value = zone; query = ''; search.value = ''; select(); };
zoneSelect.onchange = () => { zone = zoneSelect.value; select(); };
search.oninput = () => { query = search.value.trim().toLowerCase(); select(); };
document.querySelector('#reset').onclick = fit;
document.querySelector('#spin').onclick = event => {
  controls.autoRotate = !controls.autoRotate;
  event.target.textContent = `自动旋转：${controls.autoRotate ? '开' : '关'}`;
};
document.querySelector('#wire').onclick = event => {
  wire = !wire;
  for (const group of models.values()) group.traverse(object => {
    if (object.isMesh) for (const material of Array.isArray(object.material) ? object.material : [object.material]) material.wireframe = wire;
  });
  event.target.textContent = `线框：${wire ? '开' : '关'}`;
};
document.querySelector('#background').onchange = event => scene.background.set(event.target.value === 'light' ? '#d9e0e7' : '#151e2b');
const raycaster = new THREE.Raycaster();
let pointerStart;
canvas.addEventListener('pointerdown', event => { pointerStart = [event.clientX, event.clientY]; });
canvas.addEventListener('pointerup', event => {
  if (!pointerStart || Math.hypot(event.clientX - pointerStart[0], event.clientY - pointerStart[1]) > 5) return;
  const rect = canvas.getBoundingClientRect();
  raycaster.setFromCamera(new THREE.Vector2((event.clientX - rect.left) / rect.width * 2 - 1, -(event.clientY - rect.top) / rect.height * 2 + 1), camera);
  const hit = raycaster.intersectObjects(display.children, true).find(hit => hit.object.userData.itemId);
  if (hit) select(hit.object.userData.itemId);
});
let width = 0, height = 0;
function resize() {
  if (width === canvas.clientWidth && height === canvas.clientHeight) return;
  width = canvas.clientWidth; height = canvas.clientHeight;
  renderer.setSize(width, height, false);
  camera.aspect = width / height;
  camera.updateProjectionMatrix();
}
resize();
function readHash() {
  const hashItem = location.hash.split('/')[1];
  zone = /^zone-(10|[1-9])$/.test(hashItem || '') ? hashItem.slice(5) : 'all';
  zoneSelect.value = zone;
  select(byId.has(hashItem) ? hashItem : null, false);
}
addEventListener('hashchange', readHash);
readHash();
let lastFrame = performance.now();
addEventListener('visibilitychange', () => { lastFrame = performance.now(); });
renderer.setAnimationLoop(now => {
  // Animation speed follows wall time even when the preview renders slowly.
  // No physics runs here; dropping elapsed time would make 1× playback too slow.
  const dt = Math.max((now - lastFrame) / 1000, 0);
  lastFrame = now;
  if (!document.hidden) animalAnimation?.update(dt);
  let particleCount=0;
  if (!document.hidden) for(const [id,effect] of ambientEffects) if(models.get(id)?.parent===display) {effect.update(Math.min(dt,.05),camera);particleCount+=effect.stats().particles;}
  canvas.dataset.ambientParticles=String(particleCount);
  resize(); controls.update(); renderer.render(scene, camera);
});
if (isAnimal) {
  animalAnimation = await createAnimalAnimationPreview({paid: isPaid,
    catalog, models, scene, display, canvas,
    onChange: () => {
      renderList();
      showInfo(byId.get(selected), selected ? [byId.get(selected)] : visibleItems());
    },
  });
  animalAnimation.select(selected);
}
