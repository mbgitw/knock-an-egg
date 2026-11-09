import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {TreadmillSystem} from '../public/treadmill-system.js';

test('training gain keeps the frame alive without Web Animations APIs', () => {
  const before = globalThis.document;
  const node = {textContent: '', style: {}};
  const stat = {};
  let appended = 0, sounds = 0;
  globalThis.document = {createElement: () => node};
  try {
    const system = {
      popups: [], popupSerial: 0,
      elements: {'speed-popups': {append: () => appended++}, 'speed-value': stat},
      player: {motor: {position: new THREE.Vector3()}, actor: {position: new THREE.Vector3()}},
      camera: {position: new THREE.Vector3(0, 0, 8)},
      tone: () => sounds++,
    };
    TreadmillSystem.prototype.showGain.call(system, 5, 1);
    assert.equal(appended, 1);
    assert.equal(system.popups.length, 1);
    assert.equal(sounds, 1);

    let cancelled = 0, animated = 0;
    stat.getAnimations = () => [{cancel: () => cancelled++}];
    stat.animate = () => animated++;
    TreadmillSystem.prototype.showGain.call(system, 5, 1);
    assert.equal(cancelled, 1);
    assert.equal(animated, 1);
  } finally {
    globalThis.document = before;
  }
});
