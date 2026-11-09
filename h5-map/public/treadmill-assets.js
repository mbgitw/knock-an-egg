import * as THREE from 'three';
import {OBJLoader} from './vendor/OBJLoader.js';
import {MTLLoader} from './vendor/MTLLoader.js';
import {createTreadmillEffects} from './model-check/treadmill-effects.js';
import {loadSceneResource} from './scene-resource.js';

const base = new URL('./model-check/', import.meta.url);
async function json(url) {
  const response = await fetch(url);
  if (!response.ok) throw Error(`Treadmill resource ${response.status}: ${url}`);
  return response.json();
}
export class TreadmillAssets {
  static async create() {
    const [catalog, effects, anchors] = await Promise.all([
      json(new URL('treadmills/catalog.json', base)), json(new URL('treadmills/effects/catalog.json', base)),
      json(new URL('./treadmill-runtime.json', import.meta.url)),
    ]);
    return new TreadmillAssets(catalog, effects, anchors);
  }
  constructor(catalog, effects, anchors) { Object.assign(this, {catalog, effects, anchors}); this.cache = new Map(); }
  async template(tier) {
    if (!this.cache.has(tier)) {
      const request = this.load(tier).catch(error => { this.cache.delete(tier); throw error; });
      this.cache.set(tier, request);
    }
    return this.cache.get(tier);
  }
  async load(tier) {
    const item = this.catalog.find(item => item.tier === tier);
    if (!item) throw Error(`Unknown treadmill ${tier}`);
    if(item.scene){const group=await loadSceneResource(new URL(item.scene,base));let order=0;group.traverse(o=>{if(o.isMesh&&tier===8){order++;for(const m of Array.isArray(o.material)?o.material:[o.material]){m.polygonOffset=true;m.polygonOffsetFactor=0;m.polygonOffsetUnits=-2*order;}}});return group;}
    const mtlUrl = new URL(item.mtl, base);
    const response = await fetch(mtlUrl);
    if (!response.ok) throw Error(`Treadmill material ${response.status}`);
    const mtl = (await response.text()).split(/\r?\n/).filter(line => !line.startsWith('map_d ')).join('\n');
    const manager = new THREE.LoadingManager();
    const materials = new MTLLoader(manager).parse(mtl, new URL('.', mtlUrl).href);
    // Wait for material maps as well as geometry, so a failed upgrade never
    // charges cash and leaves the owner with an invisible or half-loaded model.
    const texturesReady = new Promise((resolve, reject) => {
      manager.onLoad = resolve;
      manager.onError = url => reject(Error(`Treadmill texture unavailable: ${url}`));
    });
    materials.preload();
    const [group] = await Promise.all([new OBJLoader(manager).setMaterials(materials).loadAsync(new URL(item.url, base).href), texturesReady]);
    let order = 0;
    group.traverse(object => {
      if (!object.isMesh) return;
      const priority = ++order;
      for (const material of Array.isArray(object.material) ? object.material : [object.material]) {
        material.side = THREE.DoubleSide;
        const kd = materials.materialsInfo[material.name]?.kd;
        if (kd) material.color.setRGB(...kd.map(n => Math.max(0, n) ** (1 / 2.2)), THREE.SRGBColorSpace);
        if (material.emissiveMap) material.emissive.copy(material.color);
        if (material.bumpMap) { material.normalMap = material.bumpMap; material.bumpMap = null; }
        if (tier === 8) { material.polygonOffset = true; material.polygonOffsetFactor = 0; material.polygonOffsetUnits = -2 * priority; }
      }
    });
    return group;
  }
  async instance(tier, placement) {
    const [template] = await Promise.all([this.template(tier)]);
    const metadata = this.anchors.models.find(m => m.tier === tier);
    const source = new THREE.Group(); source.add(template.clone(true));
    const nodes = (this.effects.find(m => m.tier === tier)?.nodes || []).map(n => ({...n, texture: n.texture ? new URL(n.texture, base).href : null}));
    const effects = await createTreadmillEffects(nodes);
    source.add(effects.root);
    source.applyMatrix4(new THREE.Matrix4().set(...metadata.sourceOrigin).invert());
    const root = new THREE.Group(); root.name = `Treadmill-${tier}`; root.add(source);
    root.applyMatrix4(placement);
    root.updateMatrixWorld(true);
    return {root, effects, metadata, dispose() { root.removeFromParent(); effects.dispose(); }};
  }
}
