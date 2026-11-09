import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {TreadmillState} from '../public/treadmill-state.js';
import {connectionDiagnostic,networkDiagnostic} from '../public/online/connection-diagnostic.js';
const source=await readFile(new URL('../public/online/game-connection.js',import.meta.url),'utf8');
async function connection(connect,preferences=async()=>{}){
 const name='fixture'+Math.random().toString(36).slice(2);globalThis[name]={connect,preferences};
 const js=source.replaceAll('\r','').replace(/from '\.\/transient-actions.js'/,`from '${new URL('../public/online/transient-actions.js',import.meta.url).href}'`).replace(/import .*connectionDiagnostic.*\n/,`import {connectionDiagnostic,networkDiagnostic} from '${new URL('../public/online/connection-diagnostic.js',import.meta.url).href}';\n`).replace(/import .*connectPasture.*\n/,`const connectPasture=globalThis.${name}.connect;\n`).replace(/import .*OP.*\n/,'const OP={};\n').replace(/import .*readPreferences.*\n/,`const readPreferences=globalThis.${name}.preferences;\n`);
 const m=await import('data:text/javascript;base64,'+Buffer.from(js).toString('base64'));delete globalThis[name];return m.GameConnection;
}
test('deadline covers a hanging transport, triggers cleanup and ignores late callbacks',async()=>{
 let opts,leaves=0;const s={leave:async()=>{leaves++;}};
 const C=await connection(o=>{opts=o;o.onSession(s);return new Promise(()=>{});});
 await assert.rejects(C.open({timeoutMs:15}),/ONLINE_TIMEOUT/);assert.equal(leaves,1);assert.equal(opts.cancelled(),true);assert.doesNotThrow(()=>opts.onMessage(0,null));
});
test('immediate network failure settles and success retains connected session',async()=>{
 const bad=await connection(async()=>{throw Error('NO_NETWORK');});await assert.rejects(bad.open({timeoutMs:100}),/NO_NETWORK/);
 const s={leave:async()=>{}};const good=await connection(async o=>{o.onSession(s);o.onStatus({stage:'room_connected'});return s;});
 const c=await good.open({timeoutMs:100});assert.equal(c.session,s);assert.equal(c.stage,'ready');
});

test('diagnostic distinguishes initial baselines from hanging preferences before cleanup',async()=>{
 const s={room:{roomId:'room-123'},baseline:new Set([101,105]),leave:async()=>{s.baseline.clear();}};
 const C=await connection(async o=>{o.onSession(s);o.onStatus({stage:'syncing',code:'ROOM_CHANNEL_BUSY'});return s;});
 await assert.rejects(C.open({timeoutMs:15}),e=>{assert.equal(e.diagnostic.stage,'syncing');assert.deepEqual(e.diagnostic.received,['players','account']);assert.equal(e.diagnostic.room,'room-123');assert.equal(e.diagnostic.lastCode,'ROOM_CHANNEL_BUSY');return true;});
 const P=await connection(async o=>{o.onSession(s);o.onStatus({stage:'room_connected'});return s;},()=>new Promise(()=>{}));
 await assert.rejects(P.open({timeoutMs:15}),e=>e.diagnostic.stage==='preferences');
});

test('diagnostic excludes messages, tokens and arbitrary session fields',()=>{
 const secret='Bearer private-token';
 const d=connectionDiagnostic({stage:secret,lastCode:secret,session:{token:secret,room:{roomId:secret},baseline:new Set([101])}},{message:secret,code:secret},12.6);
 assert.equal(d.stage,'starting');assert.equal(d.code,'ONLINE_FAILED');assert.equal(d.room,'');assert.equal(d.elapsedMs,13);assert.ok(!JSON.stringify(d).includes(secret));
});

test('D2 reports assigned room before handle and whitelists network states',()=>{
 const d=connectionDiagnostic({stage:'connecting_room',session:{ticket:{status:'room_ready',assignment:{room_id:'assigned-123',credential:'private'}},baseline:new Set()}},{code:200001},100);
 assert.equal(d.version,'D2');assert.equal(d.room,'assigned-123');assert.equal(d.ticket,'room_ready');assert.equal(d.code,'200001');assert.ok(!JSON.stringify(d).includes('private'));
 assert.deepEqual(networkDiagnostic({gateway:{connectionState:'connected',url:'private'},room:{connectionState:'connecting',channels:{control_reliable:'open',game_reliable:'connecting',state_unreliable:'private'}}}),{gateway:'connected',room:'connecting',channels:'open/connecting/unknown'});
});

test('hanging public network snapshot cannot block failure cleanup',async()=>{
 let leaves=0;const C=await connection(async o=>{o.onSession({socket:{networkSnapshot:()=>new Promise(()=>{})},leave:async()=>{leaves++;}});throw Object.assign(Error('failure'),{code:'WEBRTC_CHANNEL_TIMEOUT'});});
 const started=performance.now();await assert.rejects(C.open({timeoutMs:2000}),e=>e.diagnostic.code==='WEBRTC_CHANNEL_TIMEOUT');assert.equal(leaves,1);assert.ok(performance.now()-started<1500);
});
test('offline state has no persistent storage and next instance resets',()=>{
 const a=new TreadmillState({storage:null});const original=a.data.cash;a.data.cash='123456';a.save();const b=new TreadmillState({storage:null});assert.equal(b.data.cash,original);assert.equal(a.storage,null);
});

