import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
import {NativeMusic} from '../public/gameplay/native-music.js';
import {GameAudio} from '../public/gameplay/game-audio.js';
import {PastureSession} from '../public/online/session.js';
import {retryGate} from '../public/online/retry-gate.js';
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};};
const ok={ok:true,data:{available:true}};

test('native music serializes late acknowledgements, stops stale chase and restores daily',async()=>{
  const wait=deferred(),calls=[];let first=true,paused=false;
  const music=new NativeMusic({playBGM:async(p)=>{calls.push(p);if(first){first=false;return wait.promise;}return ok;},stopBGM:async()=>{calls.push('stop');return ok;}},{paused:()=>paused});
  const running=music.setEnabled(true);music.setChase(true);music.setChase(false);paused=true;music.sync();wait.resolve(ok);await running;
  assert.deepEqual(calls,['audio/bgm/daily.mp3','stop']);assert.equal(music.current,null);
  paused=false;await music.sync();await music.setChase(true);assert.equal(music.current,'alert');
  // Simulate alert completion without waiting in real time.
  clearTimeout(music.timer);music.intro=false;await music.sync();assert.equal(music.current,'chase');
  await music.setChase(false);assert.equal(music.current,'daily');await music.setEnabled(false);
});

test('ending chase during an idle sync does not lose the daily transition',async()=>{
  const music=new NativeMusic({playBGM:async()=>ok,stopBGM:async()=>ok},{paused:()=>false});
  await music.setEnabled(true);await music.setChase(true);
  clearTimeout(music.timer);music.intro=false;await music.sync();
  const idle=music.sync(),ended=music.setChase(false);await Promise.all([idle,ended]);
  assert.equal(music.current,'daily');await music.setEnabled(false);
});

test('failed chase stop respects backoff then reconciles to daily',async()=>{
  let stops=0,fail=false;
  const music=new NativeMusic({playBGM:async()=>ok,stopBGM:async()=>{stops++;return fail?{ok:false}:ok;}},{paused:()=>false});
  await music.setEnabled(true);await music.setChase(true);
  clearTimeout(music.timer);music.intro=false;await music.sync();
  fail=true;await music.setChase(false);const attempts=stops;
  await music.sync();assert.equal(stops,attempts);assert.equal(music.current,'chase');
  fail=false;music.retryAt=0;await music.sync();assert.equal(music.current,'daily');
  await music.setEnabled(false);
});

test('host SFX needs no WebAudio context and never falls back after SDK failure',async()=>{
  const calls=[];globalThis.window={gameHostState:{paused:false},Builda:{audio:{playSFX:async(p,o)=>{calls.push([p,o]);return {ok:false,error:{code:'HOST_UNAVAILABLE'}};}}}};
  const audio=new GameAudio();audio.play('impact');audio.play('impact');await Promise.resolve();assert.equal(calls.length,1);assert.equal(calls[0][0],'audio/sfx/hit.wav');assert.equal(audio.context,undefined);
  window.gameHostState.paused=true;audio.play('jump');assert.equal(calls.length,1);delete globalThis.window;
});

function socket(){return {on:()=>()=>{},close(){this.closed=true;}};}
test('pending leave retains the handle and gateway; repeated retry confirms same leave',async()=>{
  const s=socket(),session=new PastureSession({socket:s});let attempts=0;
  const handle={leave:async()=>{if(++attempts===1)throw {code:'ROOM_LEAVE_PENDING'};}};session.room=handle;session.key='same';
  assert.equal(await session.leave(),false);assert.equal(session.room,handle);assert.equal(s.closed,undefined);
  assert.equal(await session.leave(),true);assert.equal(attempts,2);assert.equal(session.room,null);assert.equal(s.closed,true);
});

test('uncertain admission is recovered using its original key before cleanup',async()=>{
  const s=socket(),session=new PastureSession({socket:s}),keys=[];session.key='original-key';
  s.joinRoom=async(_,o)=>{keys.push(o.idempotencyKey);return {ticket_id:'t',status:'waiting'};};
  s.settleMatchTicket=async()=>({ticket_id:'t',status:'cancelled'});
  assert.equal(await session.leave(),true);assert.deepEqual(keys,['original-key']);assert.equal(s.closed,true);
});

test('late room connection is left before allowing retry; repeated clicks share cleanup',async()=>{
  const s=socket(),session=new PastureSession({socket:s}),wait=deferred();let leaves=0;
  session.key='k';session.connecting=wait.promise;
  const gate=retryGate(()=>session.leave()),a=gate(),b=gate();assert.equal(s.closed,undefined);
  wait.resolve({leave:async()=>{leaves++;}});assert.equal(await a,true);assert.equal(await b,true);assert.equal(leaves,1);assert.equal(s.closed,true);
});

test('cold-start busy backoff does not issue rapid new admissions',async()=>{
  let now=0,calls=0;const gate=retryGate(async()=>{calls++;return true;},{cooldownMs:10000,now:()=>now});
  assert.equal(await gate(),false);now=9999;assert.equal(await gate(),false);assert.equal(calls,0);now=10000;assert.equal(await gate(),true);assert.equal(calls,1);
});

test('snapshot retry is bounded and stops after the complete baseline or leave',async()=>{
  const s=socket(),session=new PastureSession({socket:s});let sends=0;
  session.room={sendReliable(){sends++;},sendControl(){},leave:async()=>{}};
  session.requestSnapshot();assert.equal(sends,1);clearTimeout(session.snapshotTimer);
  session.sendSnapshotRequest();assert.equal(sends,2);clearTimeout(session.snapshotTimer);
  session.baseline=new Set([101,105,107]);session.receive({opCode:106,data:new TextEncoder().encode('{}')});
  assert.equal(session.ready,true);session.sendSnapshotRequest();assert.equal(sends,2);
  session.ready=false;session.snapshotAttempts=90;session.sendSnapshotRequest();assert.equal(session.stage,'recovery_required');assert.equal(sends,2);
  await session.leave();session.sendSnapshotRequest();assert.equal(sends,2);
});

test('host DPR cap, safe insets and capsule use the documented top/right coordinates',async()=>{
  const props={},events={},el={style:{},getBoundingClientRect:()=>({top:10,bottom:60,left:900,right:980})};
  const window={devicePixelRatio:3,innerWidth:1000,Builda:{runtime:{safeArea:()=>({top:24,left:12}),capsuleMenuRect:()=>({top:10,right:20,width:100,height:40})}},addEventListener:(n,f)=>events[n]=f};
  vm.runInNewContext(await readFile(new URL('../public/host-layout.js',import.meta.url),'utf8'),{window,location:{search:'?dpr=1'},URLSearchParams,document:{documentElement:{style:{setProperty:(k,v)=>props[k]=v}},querySelectorAll:()=>[el]}});
  assert.equal(window.devicePixelRatio,1);assert.equal(props['--host-safe-top'],'24px');assert.equal(el.style.marginTop,'48px');events.resize();assert.equal(el.style.marginTop,'48px');
});

test('foreground does not resume gameplay while host pause panel stays open',async()=>{
  const callbacks={},events=[];let ready=0;
  const window={Builda:{runtime:{ready:()=>ready++},events:{on:(n,f)=>callbacks[n]=f}},addEventListener(){},dispatchEvent:e=>events.push(e.type)};
  vm.runInNewContext(await readFile(new URL('../public/builda-bootstrap.js',import.meta.url),'utf8'),{window,location:{hostname:'test',port:''},document:{hidden:false},Event});
  callbacks.pausePanel({visible:true});callbacks.appVisibility({visible:false});callbacks.appVisibility({visible:true});assert.equal(window.gameHostState.paused,true);
  callbacks.pausePanel({visible:false});assert.equal(window.gameHostState.paused,false);assert.equal(ready,1);
});

test('late token refresh cannot reopen a session after exit starts',async()=>{
  const wait=deferred(),timers=[];let requests=0,connects=0;
  const sock={connect:async()=>{connects++;},on:()=>()=>{},close(){}};
  const fixture={OnlineClient:class{createSocket(){return sock;}restoreSession(t){return t;}},PastureSession:class{constructor(o){Object.assign(this,o);}async start(){}},fetch:async()=>({ok:true,json:async()=>({gameId:'test',gatewayUrl:'test'})}),window:{Builda:{runtime:{gameId:'test'},requestToken:async()=>++requests===1?{ok:true,data:{token:'test',expiresAt:999}}:wait.promise},addEventListener(){},removeEventListener(){}},location:{search:''},setTimeout:fn=>{timers.push(fn);return 1;},clearTimeout(){}};
  globalThis.__refreshFixture=fixture;
  let source=await readFile(new URL('../public/online/connect.js',import.meta.url),'utf8');
  source=source.replaceAll('import.meta.url',JSON.stringify(new URL('../public/online/connect.js',import.meta.url).href));
  source=source.replace(/^import .*;\r?\n/gm,'');source='const {OnlineClient,PastureSession,fetch,window,location,setTimeout,clearTimeout}=globalThis.__refreshFixture;\n'+source;
  try{
    const {connectPasture}=await import('data:text/javascript;base64,'+Buffer.from(source).toString('base64'));
    const session=await connectPasture();const refreshing=timers[0]();session.exiting=true;
    wait.resolve({ok:true,data:{token:'test-refresh',expiresAt:1999}});await refreshing;assert.equal(connects,1);
  }finally{delete globalThis.__refreshFixture;}
});
