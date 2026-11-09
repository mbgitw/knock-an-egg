import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import {build} from 'esbuild';

const source=readFileSync(new URL('../public/runtime-health.js',import.meta.url),'utf8');
function browser(storage=new Map()){
  const listeners=new Map(),canvasListeners=new Map(),sent=[];
  const canvas={width:1600,height:900,addEventListener:(name,fn)=>canvasListeners.set(name,fn),dataset:{ready:'true'}};
  let time=1000;
  const window={devicePixelRatio:1.8};
  const context={window,document:{querySelector:()=>canvas,hidden:false},location:{href:'http://localhost/index.html'},URL,TextEncoder,Uint32Array,
    crypto:{getRandomValues(array){array[0]=0x12345678;}},performance:{now:()=>time},Date:{now:()=>time},
    localStorage:{getItem:key=>storage.get(key)||null,setItem:(key,value)=>storage.set(key,value),removeItem:key=>storage.delete(key)},
    addEventListener:(name,fn)=>listeners.set(name,fn),setInterval:fn=>{window.tick=fn;},Error};
  runInNewContext(source,context);
  const connection={session:{ready:true,room:{sendControl(op,data){sent.push({op,event:JSON.parse(new TextDecoder().decode(data))});}}},observe(){}};
  return {window,canvas,listeners,canvasListeners,sent,connection,storage,setTime:value=>{time=value;}};
}
test('early errors persist across a new page and flush only through a ready Room',()=>{
  const storage=new Map(),a=browser(storage);
  a.listeners.get('error')({message:'failed https://example.test/?token=secret 43712349 token=my-secret "private name"',filename:'http://localhost/app.js?token=x',lineno:20,colno:4});
  assert.ok(storage.has('knockegg_runtime_health_v1'));
  a.window.gameHealth.ready();a.window.gameHealth.frame({info:{memory:{textures:0,geometries:0},programs:[]}});
  assert.equal(JSON.parse(storage.get('knockegg_runtime_health_v1')).length,1);
  const b=browser(storage);b.window.gameHealth.bind(b.connection);
  assert.equal(b.sent.length,1);assert.equal(b.sent[0].op,11);assert.equal(b.sent[0].event.kind,'script_error');
  assert.equal(b.sent[0].event.file,'app.js');assert.doesNotMatch(b.sent[0].event.message,/secret|43712349|private name/);
  assert.equal(storage.has('knockegg_runtime_health_v1'),false);
});
test('ready, first rendered frame and context loss are reported without UI changes',()=>{
  const b=browser();b.window.gameHealth.bind(b.connection);b.window.gameHealth.stage('ready');b.window.gameHealth.ready();
  b.setTime(1500);b.window.gameHealth.frame({info:{memory:{textures:4,geometries:6},programs:[1]}});
  b.canvasListeners.get('webglcontextlost')();
  assert.deepEqual(b.sent.map(e=>e.event.kind),['ready','first_frame','webgl_lost']);
  assert.equal(b.canvas.dataset.ready,'true');assert.equal(b.sent[1].event.width,1600);
});
test('stalled frame reports once and recovery is observed',()=>{
  const b=browser();b.window.gameHealth.bind(b.connection);b.window.gameHealth.ready();b.setTime(12000);b.window.tick();b.window.tick();
  assert.equal(b.sent.filter(e=>e.event.kind==='frame_stall').length,1);
  b.setTime(12500);b.window.gameHealth.frame({info:{memory:{textures:0,geometries:0},programs:[]}});
  assert.ok(b.sent.some(e=>e.event.kind==='frame_resumed'));
});
test('a long non-ASCII error still fits the Room message cap',()=>{
  const b=browser();b.window.gameHealth.bind(b.connection);
  b.window.gameHealth.error('startup_error',new Error('加载失败'.repeat(100)));
  assert.equal(b.sent.length,1);
  assert.ok(new TextEncoder().encode(JSON.stringify(b.sent[0].event)).length<=512);
});
test('sampled WebGL errors and context state reach the Room without per-frame logging',()=>{
  const b=browser();b.window.gameHealth.bind(b.connection);b.window.gameHealth.ready();b.setTime(61000);
  b.window.gameHealth.frame({info:{memory:{textures:4,geometries:6},programs:[1]},getContext:()=>({getError:()=>1280,isContextLost:()=>false})});
  const beat=b.sent.find(e=>e.event.kind==='heartbeat').event;
  assert.equal(beat.glError,1280);assert.equal(beat.contextLost,false);
});

await build({entryPoints:['server/game/runtime-health.ts'],bundle:true,platform:'node',format:'esm',outfile:'build/runtime-health-test.mjs'});
const {logRuntimeHealth}=await import('../build/runtime-health-test.mjs');
test('Room only logs bounded diagnostic fields under the authenticated player',()=>{
  const logs=[],stats={},room={state:{},unixTimeMillis:()=>100000,networkStats:()=>stats,log:(level,text)=>logs.push({level,text})},p={id:'real-player'};
  logRuntimeHealth(room,p,{kind:'script_error',run:'12345678',stage:'ready',phase:'render',at:99990,ms:50,width:1600,height:900,dpr:1.8,name:'TypeError',message:'failed at https://example.test/token',file:'http://host/app.js',line:20,player:'forged',token:'secret'});
  assert.equal(logs.length,1);const data=JSON.parse(logs[0].text.slice('client_runtime '.length));
  assert.equal(data.player,'real-player');assert.equal(data.kind,'script_error');assert.equal(data.stage,'ready');
  assert.equal(data.token,undefined);assert.doesNotMatch(data.message,/example|token/);assert.equal(stats.runtime.firstFrame,false);
  logRuntimeHealth(room,p,{kind:'first_frame',stage:'ready',phase:'render'});assert.equal(stats.runtime.firstFrame,true);
  logRuntimeHealth(room,p,{kind:'heartbeat',textures:7,geometries:8,programs:9});assert.equal(logs.length,2);
  logRuntimeHealth(room,p,{kind:'heartbeat',textures:7,glError:1280,contextLost:false});assert.equal(logs.length,3);assert.equal(logs[2].level,'warn');
});
test('Room rejects unknown kinds and limits log bursts without touching gameplay',()=>{
  const logs=[],stats={},room={state:{},unixTimeMillis:()=>100000,networkStats:()=>stats,log:(level,text)=>logs.push(text)},p={id:'player'};
  logRuntimeHealth(room,p,{kind:'unknown',message:'bad'});assert.equal(logs.length,0);
  for(let i=0;i<100;i++)logRuntimeHealth(room,p,{kind:'webgl_lost'});
  assert.ok(logs.length<=4);room.log=()=>{throw Error('sink failed');};
  assert.doesNotThrow(()=>logRuntimeHealth(room,p,{kind:'frame_error'}));
});
