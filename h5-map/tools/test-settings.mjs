import test from 'node:test';
import assert from 'node:assert/strict';
import {SETTINGS_DEFAULTS,restoreSettings,SettingsState,placedPetVisible} from '../public/gameplay/settings-state.js';
import {TreadmillState} from '../public/treadmill-state.js';
import {configureSettingsAudio,audioOutput} from '../public/gameplay/settings-audio.js';
import {SettingsMusic} from '../public/gameplay/settings-music.js';

test('music preloads before account readiness, retries blocked gestures and respects mute/background',async()=>{
 const keys=['Audio','window','document','addEventListener'],saved=keys.map(k=>Object.getOwnPropertyDescriptor(globalThis,k));
 const events=new EventTarget(),doc=new EventTarget();doc.hidden=false;
 class AudioStub extends EventTarget {
  constructor(){super();this.paused=true;this.plays=0;this.loads=0;this.rejectNext=false;}
  load(){this.loads++;this.paused=true;}
  pause(){this.paused=true;}
  play(){this.plays++;if(this.rejectNext){this.rejectNext=false;return Promise.reject(new Error('blocked'));}this.paused=false;return Promise.resolve();}
 }
 try{
  Object.assign(globalThis,{Audio:AudioStub,window:{gameHostState:{paused:false}},document:doc,addEventListener:events.addEventListener.bind(events)});
  const music=new SettingsMusic(),a=music.audio;
  assert.equal(a.preload,'auto');assert.equal(a.loads,1);assert.equal(a.plays,0);assert.equal(a.loop,true);assert.match(a.src,/9045766377\.mp3$/);assert.equal(music.tracks.length,1);
  events.dispatchEvent(new Event('pointerdown'));assert.equal(a.plays,0);
  const state=new SettingsState({data:{settings:{MusicVolume:0}},save:()=>true});
  music.setState(state);assert.equal(a.plays,0);
  a.rejectNext=true;state.set('MusicVolume',1);await Promise.resolve();assert.equal(a.paused,true);
  events.dispatchEvent(new Event('pointerup'));assert.equal(a.paused,false);assert.equal(a.plays,2);
  events.dispatchEvent(new Event('pointerdown'));assert.equal(a.plays,2);
  doc.hidden=true;events.dispatchEvent(new Event('game-host-pause'));assert.equal(a.paused,true);
  doc.hidden=false;events.dispatchEvent(new Event('game-host-pause'));assert.equal(a.paused,false);
  window.gameHostState.paused=true;events.dispatchEvent(new Event('game-host-pause'));assert.equal(a.paused,true);
  window.gameHostState.paused=false;events.dispatchEvent(new Event('game-host-pause'));assert.equal(a.paused,false);
  a.dispatchEvent(new Event('ended'));assert.equal(music.index,0);assert.equal(a.loads,1);assert.equal(a.volume,.5);
  state.set('MusicVolume',0);assert.equal(a.paused,true);state.dispose();
 }finally{keys.forEach((k,i)=>saved[i]?Object.defineProperty(globalThis,k,saved[i]):delete globalThis[k]);}
});
test('old/corrupt saves get source defaults; numbers clamp; false and zero survive',()=>{
 assert.deepEqual(restoreSettings(null),SETTINGS_DEFAULTS);
 assert.deepEqual(restoreSettings({MusicVolume:0,SfxVolume:2,ViewMyPets:false,ScreenFFX:'false'}),{...SETTINGS_DEFAULTS,MusicVolume:0,SfxVolume:1,ViewMyPets:false});
 assert.equal(restoreSettings({MusicVolume:NaN}).MusicVolume,1);
});
test('settings share existing save and survive reload without changing progress',()=>{
 const data=new Map(),storage={getItem:k=>data.get(k),setItem:(k,v)=>data.set(k,v)},a=new TreadmillState({storage}),s=new SettingsState(a);
 a.data.cash=54321;s.set('MusicVolume',0);s.set('ViewMyEggs',false);assert.ok(s.flush());
 const b=new TreadmillState({storage});assert.equal(b.data.settings.MusicVolume,0);assert.equal(b.data.settings.ViewMyEggs,false);assert.equal(b.data.cash,54321);assert.equal(data.size,1);s.dispose();
});
test('continuous changes flush at 0.5 seconds and failed saves retain latest state for retry',async()=>{
 let saves=0,fail=true;const a={data:{},save(){saves++;return !fail;}},s=new SettingsState(a);
 s.set('SfxVolume',.2);s.set('SfxVolume',.3);assert.equal(saves,0);
 await new Promise(r=>setTimeout(r,550));assert.equal(saves,1);assert.equal(s.dirty,true);assert.equal(s.get('SfxVolume'),.3);
 fail=false;assert.ok(s.flush());assert.equal(s.dirty,false);assert.equal(saves,2);s.dispose();
});
test('unknown keys/types do not mutate state; observer sees normalized value',()=>{
 const s=new SettingsState({data:{},save:()=>true}),events=[];s.observe((...args)=>events.push(args));
 assert.equal(s.set('cash',0),false);assert.equal(s.set('MusicVolume','0'),false);assert.equal(s.set('ScreenFFX',0),false);
 s.set('MusicVolume',-1);assert.deepEqual(events,[['MusicVolume',0]]);s.dispose();
});
test('own/other placed pets visibility are independent of one another',()=>{
 const s=restoreSettings({ViewMyPets:false});assert.equal(placedPetVisible(s,'me','me'),false);assert.equal(placedPetVisible(s,'them','me'),true);
 s.ViewMyPets=true;s.ViewOthersPets=false;assert.equal(placedPetVisible(s,'me','me'),true);assert.equal(placedPetVisible(s,'them','me'),false);
});
test('category buses mute existing voices and preserve other category; new contexts use restored values',()=>{
 const s=new SettingsState({data:{settings:{MusicVolume:.4}},save:()=>true});configureSettingsAudio(s);
 const ctx=()=>({currentTime:1,destination:{},createGain(){return {gain:{value:1,setValueAtTime(v){this.value=v;}},connect(){}};}}),c=ctx(),sfx=audioOutput(c),music=audioOutput(c,'MusicVolume');
 assert.equal(music.gain.value,.4);s.set('SfxVolume',0);assert.equal(sfx.gain.value,0);assert.equal(music.gain.value,.4);assert.equal(audioOutput(ctx()).gain.value,0);assert.equal(audioOutput(c),sfx);s.dispose();
});
