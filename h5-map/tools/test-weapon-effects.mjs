import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import * as THREE from 'three';
import {createWeaponEffects} from '../public/model-check/weapon-effects.js';

// Rendering is verified in-browser; these tests exercise clocks and geometry without a GPU.
THREE.TextureLoader.prototype.loadAsync = async () => {
  const texture = new THREE.DataTexture(new Uint8Array([255,255,255,255]), 1, 1);
  texture.needsUpdate = true;
  return texture;
};
const catalog = JSON.parse(await fs.readFile(new URL('../public/model-check/weapons/effects/catalog.json', import.meta.url)));
const camera = new THREE.PerspectiveCamera();
camera.position.set(6, 5, 15);
camera.lookAt(0, 3, 0);
camera.updateMatrixWorld();

test('all original emitters, beam endpoints and textures are available', async () => {
  let emitters = 0, beams = 0;
  const textures = new Set();
  for (const entry of catalog) {
    const system = await createWeaponEffects(entry.nodes);
    system.update(1/60, camera);
    emitters += system.stats().emitters;
    beams += system.stats().beams;
    for (const node of entry.nodes) {
      textures.add(node.texture);
      await fs.access(new URL('../public/model-check/' + node.texture, import.meta.url));
    }
    for (const mesh of system.root.children) {
      const data = mesh.isInstancedMesh ? mesh.instanceMatrix.array : mesh.geometry.attributes.position.array;
      assert.ok([...data].every(Number.isFinite));
    }
  }
  assert.equal(emitters, 16);
  assert.equal(beams, 3);
  assert.equal(textures.size, 14);
});

test('TimeScale zero keeps original tree glow frozen while other emitters animate', async () => {
  const system = await createWeaponEffects(catalog[4].nodes);
  system.update(0, camera);
  const frozen = system.root.children.find(m => m.name === 'Glowing Spec 16');
  const before = [...frozen.instanceMatrix.array];
  system.update(.5, camera);
  assert.deepEqual([...frozen.instanceMatrix.array], before);
});

test('hammer beams advance and pause without stretching UV into repeated tiles', async () => {
  const system = await createWeaponEffects(catalog[9].nodes);
  system.update(.25, camera);
  assert.equal(system.stats().beamTime, .25);
  const beam = system.root.children.find(m => m.material.uniforms.uTime);
  assert.equal(Math.max(...beam.geometry.attributes.uv.array), 1);
  const first = [...beam.geometry.attributes.position.array];
  system.update(0, camera);
  assert.equal(system.stats().beamTime, .25);
  assert.deepEqual([...beam.geometry.attributes.position.array], first);
  system.update(.25, camera);
  assert.equal(system.stats().beamTime, .5);
});

test('plain bat and cactus retain no invented particle or beam effects', async () => {
  for (const entry of catalog.slice(0, 2)) {
    const system = await createWeaponEffects(entry.nodes);
    assert.equal(system.root.children.length, 0);
  }
});
