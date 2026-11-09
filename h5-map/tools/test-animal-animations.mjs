import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import * as THREE from 'three';
import {buildSkinnedAnimal, buildAnimalClip} from '../public/model-check/animal-animation-player.js';

const root = path.resolve(import.meta.dirname, '../public/model-check');
const read = async url => JSON.parse(await fs.readFile(path.join(root, url.replace(/^\.\//, '')), 'utf8'));
const manifest = await read('./animal-animations/catalog.json');
const clips = new Map();
const evidence = [];

test('74 animal rigs preserve their mesh at bind pose and deform under both cached actions', async () => {
  for (const [id, item] of Object.entries(manifest)) {
    if (!item.rig) continue;
    const data = await read(item.rig);
    const rig = buildSkinnedAnimal(data, new THREE.MeshBasicMaterial());
    const base = data.positions;
    const points = new THREE.Box3().setFromBufferAttribute(rig.mesh.geometry.attributes.position);
    const extent = points.getSize(new THREE.Vector3()).length();
    let bindError = 0;
    for (let i = 0; i < base.length / 3; i++) {
      const original = new THREE.Vector3().fromArray(base, i * 3);
      const actual = rig.mesh.applyBoneTransform(i, original.clone());
      bindError = Math.max(bindError, original.distanceTo(actual));
    }
    assert.ok(bindError < extent * 1e-5, `${item.name}: bind pose mismatch ${bindError}`);
    const states = {};
    for (const state of ['Idle', 'Walk']) {
      assert.ok(item.actions[state]?.available, `${id}: ${state} is missing`);
      const url = item.actions[state].url;
      if (!clips.has(url)) clips.set(url, await read(url));
      rig.mixer.stopAllAction();
      for (const bone of rig.bones) {
        bone.position.copy(bone.userData.restPosition);
        bone.quaternion.copy(bone.userData.restQuaternion);
      }
      const clip = buildAnimalClip(clips.get(url), rig);
      assert.ok(clip.duration > 0 && clip.tracks.length > 0, `${id}: empty ${state}`);
      assert.ok(clip.validate(), `${id}: invalid ${state} tracks`);
      rig.mixer.clipAction(clip).play();
      let displacement = 0, maxExtentRatio = 0;
      for (let sample = 0; sample < 7; sample++) {
        rig.mixer.setTime(clip.duration * (sample + .25) / 7);
        rig.root.updateMatrixWorld(true);
        rig.skeleton.update();
        const box = new THREE.Box3();
        for (let i = 0; i < base.length / 3; i++) {
          const original = new THREE.Vector3().fromArray(base, i * 3);
          const actual = rig.mesh.applyBoneTransform(i, original.clone());
          assert.ok(actual.toArray().every(Number.isFinite), `${id}: nonfinite posed vertex`);
          displacement = Math.max(displacement, original.distanceTo(actual));
          box.expandByPoint(actual);
        }
        maxExtentRatio = Math.max(maxExtentRatio, box.getSize(new THREE.Vector3()).length() / extent);
      }
      assert.ok(displacement > extent * 1e-6, `${id}: ${state} did not deform the mesh`);
      assert.ok(maxExtentRatio < 3, `${id}: ${state} exploded to ${maxExtentRatio} times bind size`);
      states[state] = {duration: clip.duration, tracks: clip.tracks.length, displacement, maxExtentRatio};
    }
    evidence.push({id, name: item.name, bindError, states});
    rig.mixer.stopAllAction();
    rig.mesh.geometry.dispose();
    rig.skeleton.dispose();
  }
  assert.equal(evidence.length, 74);
  assert.equal(clips.size, 36);
});
