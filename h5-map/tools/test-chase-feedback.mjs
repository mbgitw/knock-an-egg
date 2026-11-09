import test from 'node:test';
import assert from 'node:assert/strict';
import {ChaseFeedback,escapeActive} from '../public/gameplay/chase-feedback.js';
import {NativeMusic} from '../public/gameplay/native-music.js';

test('hidden RUN keeps reconciling a failed native stop without another gesture',async()=>{
  globalThis.window={addEventListener(){},gameHostState:{paused:false}};
  globalThis.document={hidden:false,body:{append(){}},createElement:()=>({remove(){}})};
  const ok={ok:true,data:{available:true}};let fail=false,safe=false;
  const native=new NativeMusic({playBGM:async()=>ok,stopBGM:async()=>fail?{ok:false}:ok},{paused:()=>false});
  const g={settings:{observe:()=>()=>{}},music:{native,setChase:v=>native.setChase(v),sync:()=>native.setEnabled(true)},guards:{target:()=>({carrying:{},safe})}};
  await native.setEnabled(true);const fx=new ChaseFeedback(g);fx.update(true);await native.running;
  clearTimeout(native.timer);native.intro=false;await native.sync();
  fail=true;safe=true;fx.update(true);await native.running;
  assert.equal(fx.root.hidden,true);assert.equal(native.current,'chase');
  fail=false;native.retryAt=0;fx.update(true);await native.running;
  assert.equal(native.current,'daily');fx.dispose();await native.setEnabled(false);
});

test('escape belongs to local carry and stops at safety, catch and disconnect',()=>{
  const t={carrying:{zone:1},safe:false,disabled:false};
  assert.equal(escapeActive(t),true);
  for(const state of [{...t,safe:true},{...t,disabled:true},{...t,carrying:null}])assert.equal(escapeActive(state),false);
  assert.equal(escapeActive(t,false),false);
});

test('one alert then chase loop, volume changes and exit restore daily music',async()=>{
  globalThis.window={addEventListener(){},gameHostState:{paused:false}};
  globalThis.document={hidden:false,addEventListener(){},body:{append(){}},createElement:()=>({remove(){}})};
  globalThis.Audio=class{constructor(){this.paused=true;this.currentTime=0;this.starts=0;}play(){this.paused=false;this.starts++;return Promise.resolve();}pause(){this.paused=true;}};
  let volume=.5,changed;const g={settings:{get:()=>volume,observe:fn=>{changed=fn;return ()=>{};}},music:{sync(){}},guards:{target:()=>({carrying:{}})}};
  const fx=new ChaseFeedback(g);fx.update(true);await Promise.resolve();await Promise.resolve();
  assert.equal(fx.alert.starts,1);assert.equal(fx.track.starts,0);assert.equal(g.music.overrideActive,true);
  fx.update(true);assert.equal(fx.alert.starts,1);
  fx.alert.paused=true;fx.alert.onended();await Promise.resolve();await Promise.resolve();
  assert.equal(fx.track.starts,1);assert.equal(fx.track.loop,true);assert.equal(fx.track.volume,.21);
  volume=0;changed('MusicVolume');assert.equal(fx.track.paused,true);
  volume=1;changed('MusicVolume');await Promise.resolve();await Promise.resolve();assert.equal(fx.track.volume,.42);
  g.guards.target=()=>({carrying:{},safe:true});fx.update(true);
  assert.equal(fx.root.hidden,true);assert.equal(fx.track.paused,true);assert.equal(g.music.overrideActive,false);
  fx.dispose();
});
