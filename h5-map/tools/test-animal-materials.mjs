import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as THREE from 'three';
const read=p=>fs.readFileSync(new URL(p,import.meta.url),'utf8');
const expected=JSON.parse(read('./fixtures/animal-colors.json'));
const materials=new Map(read('../public/model-check/creatures/creatures.mtl').split(/(?=^newmtl )/m).filter(b=>b.startsWith('newmtl ')).map(b=>[b.split(/\r?\n/)[0].slice(7),b]));
test('animal materials preserve the approved color values and valid texture files',()=>{
 assert.equal(expected.length,74);
 for(const entry of expected){
  const block=materials.get(entry.material);assert.ok(block,entry.animal);
  const kd=block.match(/^Kd (.+)$/m)[1].split(' ').map(Number);
  const actual=new THREE.Color().setRGB(...kd.map(v=>v**(1/2.2)),THREE.SRGBColorSpace);
  const target=new THREE.Color().setRGB(...entry.color,THREE.SRGBColorSpace);
  assert.ok(actual.toArray().every((v,i)=>Math.abs(v-target.toArray()[i])<1e-7),entry.animal);
  for(const match of block.matchAll(/^map_\w+ (.+)$/gm))assert.ok(fs.existsSync(new URL('../public/model-check/creatures/'+match[1].trim(),import.meta.url)));
 }
});
