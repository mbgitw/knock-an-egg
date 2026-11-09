import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {ZoneEntryState,zoneAt,insideZone} from '../public/gameplay/zone-entry-state.js';
const config=JSON.parse(fs.readFileSync(new URL('../public/gameplay/zone-entry/config.json',import.meta.url)));
const center=part=>({x:part.matrix[3],y:part.matrix[7],z:part.matrix[11]});
const z=i=>center(config.zones[i-1].hitbox);
test('十区名称/数值与原触发体匹配，第十区没有臆造图标',()=>{
  assert.equal(config.zones.length,10);
  assert.deepEqual(config.zones.map(z=>z.requiredPower),[5,1e3,5e4,75e4,12e6,15e7,1e9,5e9,25e9,1e11]);
  assert.equal(config.zones[0].name,'Forest Zone');assert.equal(config.zones[9].name,'Planet X Zone');assert.equal(config.zones[9].icon,null);
  for(let i=1;i<=10;i++)assert.equal(zoneAt(config,z(i)),`Zone${i}`);
  assert.equal(zoneAt(config,center(config.safe)),'SafeZone');
});
test('进入一次、停留不重复；空隙/安全区后重入再次显示',()=>{
  const s=new ZoneEntryState(config);assert.equal(s.update(center(config.safe),0),null);
  assert.equal(s.update(z(1),1).zone.id,'Zone1');const serial=s.serial;
  assert.equal(s.update(z(1),2).serial,serial);assert.equal(s.update(z(1),3.31),null);
  assert.equal(s.update(z(1),5),null);s.update(null,6);assert.equal(s.update(z(1),7).serial,serial+1);
  s.update(center(config.safe),8);assert.equal(s.update(z(1),9).serial,serial+2);
});
test('跨区打断旧消息，旧到期时刻不能提前隐藏新消息',()=>{
  const s=new ZoneEntryState(config);s.update(z(1),0);s.update(z(2),1.9);
  assert.equal(s.update(z(2),2.4).zone.id,'Zone2');assert.equal(s.update(z(2),4.21),null);
});
test('追逐立即隐藏且不补发；面板延后只补发当前所在区域',()=>{
  const s=new ZoneEntryState(config);s.update(z(1),0);assert.equal(s.update(z(1),.1,{suppressed:true}),null);
  assert.equal(s.update(z(2),.2,{suppressed:true}),null);assert.equal(s.update(z(2),.3),null);
  s.update(z(3),1,{deferred:true});s.update(z(4),2,{deferred:true});assert.equal(s.update(z(4),3).zone.id,'Zone4');
  s.update(z(4),3.1,{deferred:true});s.update(center(config.safe),3.2,{deferred:true});assert.equal(s.update(center(config.safe),4),null);
});
test('原三维范围含Y方向2单位容差，旋转触发体按局部坐标检测',()=>{
  const part={size:[4,6,8],matrix:[0,0,1,10,0,1,0,20,-1,0,0,30,0,0,0,1]};
  assert.ok(insideZone(part,{x:14,y:25,z:32}));assert.ok(!insideZone(part,{x:14.01,y:20,z:30}));
  assert.ok(!insideZone(part,{x:10,y:25.01,z:30}));assert.ok(!insideZone(part,{x:10,y:20,z:32.01}));
});
