import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {EggLightPool} from '../public/gameplay/egg-light-pool.js';
import {createEggAmbient} from '../public/gameplay/egg-ambient.js';

const data={bodyHeight:2,nodes:[{class:'PointLight',matrix:[1,0,0,1,0,1,0,2,0,0,1,3,0,0,0,1],properties:{Enabled:'true',Brightness:'2',Range:'10',Color:{R:'.2',G:'.8',B:'.1'}}}]};
const egg=()=>{const shell=new THREE.Group();shell.position.set(10,20,30);shell.scale.setScalar(4);return {shell};};
const visibleLights=scene=>{const found=[];scene.traverseVisible(o=>{if(o.isPointLight)found.push(o);});return found;};

test('view changes keep the same visible light objects and turn empty slots off',()=>{
  const scene=new THREE.Scene(),pool=new EggLightPool(scene),slots=visibleLights(scene),e=egg();scene.add(e.shell);
  assert.equal(slots.length,4);
  for(let step=0;step<50;step++){
    pool.begin();if(step%2)pool.consider(e,data,10);pool.update();
    assert.deepEqual(visibleLights(scene),slots);
    assert.equal(slots[0].intensity,step%2?2:0);
    assert.ok(slots.slice(1).every(l=>l.intensity===0));
  }
  pool.dispose();assert.equal(visibleLights(scene).length,0);
});

test('light budgets select nearest eggs and preserve authored color, world position and range',()=>{
  const scene=new THREE.Scene(),pool=new EggLightPool(scene,2),near=egg(),far=egg(),middle=egg();
  near.shell.rotation.y=Math.PI/2;near.shell.updateMatrixWorld(true);
  pool.begin();pool.consider(far,data,30);pool.consider(near,data,10);pool.consider(middle,data,20);pool.update();
  assert.deepEqual(pool.candidates.map(c=>c.egg),[near,middle]);
  const expected=new THREE.Vector3(1,2,3).applyMatrix4(near.shell.matrixWorld);
  assert.ok(pool.lights[0].position.distanceTo(expected)<1e-8);
  assert.equal(pool.lights[0].distance,20);assert.equal(pool.lights[0].intensity,2);
  assert.deepEqual(pool.lights[0].color.toArray(),[.2,.8,.1]);
  pool.begin();pool.consider(near,{...data,nodes:[{...data.nodes[0],properties:{...data.nodes[0].properties,Enabled:'false'}}]},1);pool.update();
  assert.ok(pool.lights.every(l=>l.intensity===0));pool.dispose();
});

test('pooled ambient effects add no duplicate PointLights; standalone preview retains original lighting',async()=>{
  const pooled=await createEggAmbient(data,{pointLights:false});assert.equal(visibleLights(pooled.root).length,0);pooled.dispose();
  const standalone=await createEggAmbient(data);assert.equal(visibleLights(standalone.root).length,1);standalone.dispose();
});
