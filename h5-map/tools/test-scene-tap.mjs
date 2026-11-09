import test from 'node:test';
import assert from 'node:assert/strict';
import {bindSceneTap} from '../public/gameplay/scene-tap.js';
function setup(options={}){
  const handlers=new Map(),canvas={getBoundingClientRect:()=>({left:0,top:0,right:300,bottom:200})},hits=[];
  const host={addEventListener:(n,f,o)=>{assert.equal(o.capture,true);handlers.set(n,f);},removeEventListener:n=>handlers.delete(n)};
  const dispose=bindSceneTap(canvas,e=>hits.push(e.pointerType),{host,...options});
  const emit=(type,fields={})=>handlers.get(type)?.({target:canvas,pointerId:1,pointerType:'touch',button:0,clientX:150,clientY:100,timeStamp:100,...fields});
  return {emit,hits,dispose};
}
test('touch, pen and mouse taps each attack once through shared capture listener',()=>{
  const {emit,hits}=setup();for(const pointerType of ['touch','pen','mouse']){emit('pointerdown',{pointerType});emit('pointerup',{pointerType,timeStamp:200});}
  assert.deepEqual(hits,['touch','pen','mouse']);emit('pointerup');assert.equal(hits.length,3);
});
test('camera excursion returning to start, hold, multitouch, cancel and UI taps do not attack',()=>{
  const {emit,hits}=setup();
  emit('pointerdown');emit('pointermove',{clientX:180});emit('pointerup');
  emit('pointerdown');emit('pointerup',{timeStamp:500});
  emit('pointerdown');emit('pointerdown',{pointerId:2});emit('pointerup',{pointerId:2});emit('pointerup');
  emit('pointerdown');emit('pointercancel');emit('pointerup');
  emit('pointerdown',{target:{}});emit('pointerup');
  emit('pointerdown',{button:2});emit('pointerup',{button:2});
  emit('pointerdown');emit('blur');emit('pointerup');assert.equal(hits.length,0);
});
test('disposing the input binding removes its listeners',()=>{const s=setup();s.dispose();s.emit('pointerdown');s.emit('pointerup');assert.equal(s.hits.length,0);});

test('left movement taps do not attack; a right tap while holding left still attacks',()=>{
 const {emit,hits}=setup();emit('pointerdown',{clientX:40});emit('pointerup',{clientX:40});assert.equal(hits.length,0);
 emit('pointerdown',{clientX:40});emit('pointerdown',{pointerId:2,clientX:220});emit('pointerup',{pointerId:2,clientX:220,timeStamp:200});assert.equal(hits.length,1);
});

test('placement opt-in accepts a left tap but rejects drag returning to origin and multitouch',()=>{
 const {emit,hits}=setup({allowLeftTouch:()=>true});emit('pointerdown',{clientX:30});emit('pointerup',{clientX:30});assert.equal(hits.length,1);
 emit('pointerdown',{clientX:30});emit('pointermove',{clientX:90});emit('pointerup',{clientX:30});assert.equal(hits.length,1);
 emit('pointerdown',{clientX:30});emit('pointerdown',{pointerId:2,clientX:220});emit('pointerup',{pointerId:2,clientX:220});emit('pointerup',{clientX:30});assert.equal(hits.length,1);
});
