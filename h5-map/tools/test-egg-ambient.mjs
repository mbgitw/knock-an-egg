import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
const base=path.resolve(import.meta.dirname,'../public/gameplay/eggs/ambient');
const data=JSON.parse(fs.readFileSync(path.join(base,'catalog.json'),'utf8'));
test('原蛋常驻特效清单覆盖30种蛋：14种有特效，52粒子+1灯',()=>{
 assert.equal(data.models.length,30);assert.equal(data.models.filter(m=>m.nodes.length).length,14);
 const nodes=data.models.flatMap(m=>m.nodes);assert.equal(nodes.filter(n=>n.class==='ParticleEmitter').length,52);assert.equal(nodes.filter(n=>n.class==='PointLight').length,1);
 for(const m of data.models){assert.ok(m.bodyHeight>0);assert.equal(m.unitToObj.length,16);assert.ok(m.unitToObj.every(Number.isFinite));for(const n of m.nodes){assert.ok(n.matrix.every(Number.isFinite));assert.equal(n.properties.Enabled,'true');}}
});
test('原粒子可用贴图保留哈希，缺失原图明确标记',()=>{
 for(const [id,a] of Object.entries(data.assets)){if(a.available)assert.equal(createHash('sha256').update(fs.readFileSync(path.join(base,'textures',id+'.png'))).digest('hex'),a.sha256);else assert.ok(a.reason);}
 assert.equal(Object.values(data.assets).filter(a=>a.available).length,15);
});
