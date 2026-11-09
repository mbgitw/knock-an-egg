import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import {OBJLoader} from 'three/addons/loaders/OBJLoader.js';import * as THREE from 'three';import {applyVariantMaterials} from '../public/gameplay/animal-variants.js';
const specs=JSON.parse(fs.readFileSync(new URL('../public/gameplay/animal-variants/materials.json',import.meta.url)));const catalog=JSON.parse(fs.readFileSync(new URL('../public/model-check/animals/catalog.json',import.meta.url)));
test('all 12 recovered original models match both variants material-by-material without mutating Normal',()=>{
 assert.equal(Object.keys(specs).length,12);
 for(const [name,variants] of Object.entries(specs)){
  const item=catalog.find(a=>a.name===name),root=new OBJLoader().parse(fs.readFileSync(new URL('../public/model-check/'+item.url,import.meta.url),'utf8'));let original;root.traverse(o=>{if(o.isMesh&&!original)original=o.material;});const color=original.color.clone();
  for(const variant of ['Gold','Diamond']){const clone=applyVariantMaterials(root,variants[variant],variant);let count=0;clone.traverse(o=>{if(!o.isMesh)return;for(const m of Array.isArray(o.material)?o.material:[o.material]){const want=new THREE.Color().setRGB(...variants[variant][m.name].color,THREE.SRGBColorSpace);assert.ok(m.color.equals(want));assert.notEqual(m,original);count++;}});assert.ok(count>0);}
  assert.ok(original.color.equals(color));
 }
});
