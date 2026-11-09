import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {GameAudio,SFX} from '../public/gameplay/game-audio.js';
import {afterSuccess} from '../public/gameplay/game-audio-bindings.js';
import {audioOutput,configureSettingsAudio} from '../public/gameplay/settings-audio.js';

test('all gameplay sounds are present, distinct and have valid headers',async()=>{
 const hashes=new Set();
 for(const [file] of Object.values(SFX)){
  const bytes=await readFile(new URL('../public/audio/sfx/'+file,import.meta.url));
  assert.ok(bytes.length>44);assert.ok(['RIFF','OggS'].includes(bytes.toString('ascii',0,4)));
  hashes.add(createHash('sha256').update(bytes).digest('hex'));
 }
 assert.equal(hashes.size,Object.keys(SFX).length);
});

test('voices obey gain, distance, cooldown, cap and pause without delayed replay',()=>{
  globalThis.document={hidden:false};globalThis.window={gameHostState:{paused:false}};
  let starts=0,stops=0,observer;
  const context={state:'running',currentTime:1,destination:{},createGain(){return {gain:{value:1,setValueAtTime(v){this.value=v;}},connect(){return this;},disconnect(){}};},createBufferSource(){return {playbackRate:{},connect(){return this;},disconnect(){},start(){starts++;},stop(){stops++;}};}};
  const audio=new GameAudio();audio.context=context;
  for(const cue of Object.keys(SFX))audio.buffers.set(cue,{});
  configureSettingsAudio({get:()=>.5,observe:fn=>{observer=fn;}});
  assert.ok(audio.play('impact'));assert.equal(audio.play('impact'),null);
  context.currentTime+=1;assert.equal(audio.play('impact',{position:{x:101,y:0,z:0},listener:{x:0,y:0,z:0}}),null);
  for(let i=0;i<20;i++){context.currentTime+=1;audio.play('impact');}
  assert.equal(audio.voices.size,12);assert.ok(stops>0);
  configureSettingsAudio({get:()=>0,observe:fn=>{observer=fn;}});observer('SfxVolume');assert.equal(audioOutput(context).gain.value,0);
  document.hidden=true;assert.equal(audio.play('hatch'),null);document.hidden=false;window.gameHostState.paused=true;assert.equal(audio.play('hatch'),null);
  audio.stop();assert.equal(audio.voices.size,0);assert.equal(starts,21);
  delete globalThis.document;delete globalThis.window;
});

test('success hooks retain return contracts and do not sound rejected/failed actions',async()=>{
  let played=0;const target={sync(value){return value;},async async(value){return value;},async fail(){throw Error('network');}};
  for(const key of ['sync','async','fail'])afterSuccess(target,key,()=>played++);
  assert.equal(target.sync(false),false);assert.equal(target.sync(true),true);
  assert.equal(await target.async(false),false);const receipt={ok:true};assert.equal(await target.async(receipt),receipt);
  await assert.rejects(target.fail());assert.equal(played,2);
});
