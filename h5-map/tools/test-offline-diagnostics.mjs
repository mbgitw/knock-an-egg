import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {installOfflineDiagnostics} from '../public/online/offline-diagnostics.js';
import {GameConnection} from '../public/online/game-connection.js';
import {OP} from '../public/online/protocol.js';
await build({entryPoints:['server/game/offline-diagnostics.ts'],bundle:true,platform:'node',format:'esm',outfile:'build/offline-log-test.mjs'});
const {logOffline}=await import('../build/offline-log-test.mjs');
function fixture(options={}){
  const events=[],c=new GameConnection(),ui={opened:true,busy:false,claim:{disabled:false},status:'',showClaimStatus(s=''){this.status=s;},economy:{ledger:{pending:100}},update(){if(!this.economy.ledger.pending)this.opened=false;}},commerce={busy:false};
  if(options.account)c.account=options.account;
  c.session={ready:true,active:true,revision:0,room:{sendReliable(op,b){assert.equal(op,OP.OFFLINE_DIAGNOSTIC);events.push(JSON.parse(new TextDecoder().decode(b)));}},intent(){this.revision++;return true;},recover(){}};
  const d=installOfflineDiagnostics(c,ui,commerce,options);return {c,ui,commerce,events,d};
}
test('claim receipt and close are traced without changing award or sending a second intent',async()=>{
  const {c,ui,events}=fixture();const claim=ui.collect();assert.equal(c.waiting.action,'offline-claim');
  ui.economy.ledger.pending=0;c.receive(OP.RECEIPT,{id:1,ok:true,reason:'ok'});await claim;
  assert.deepEqual(events.map(e=>e.stage),['opened','click','sent','receipt','closed']);assert.equal(c.session.revision,1);assert.equal(ui.busy,false);
});
test('rejected claim releases busy, preserves reward, and permits another click',async()=>{
  const {c,ui,events}=fixture();let claim=ui.collect();c.receive(OP.RECEIPT,{id:1,ok:false,reason:'RATE_LIMIT'});await claim;
  assert.equal(ui.economy.ledger.pending,100);assert.equal(ui.busy,false);assert.equal(ui.opened,true);
  assert.match(ui.status,/wait/i);assert.equal(ui.claim.disabled,false);
  claim=ui.collect();c.receive(OP.RECEIPT,{id:2,ok:true,reason:'ok'});await claim;
  assert.equal(c.session.revision,2);assert.ok(events.some(e=>e.reason==='RATE_LIMIT'));
});
test('PAY_BUSY releases the button while known-order recovery runs and retries after delivery',async()=>{
  const {c,ui,commerce,events}=fixture();let recoveries=0;
  commerce.recover=async()=>{recoveries++;return {ok:true,recovered:1,unknown:0};};
  const claim=ui.collect();c.receive(OP.RECEIPT,{id:1,ok:false,reason:'PAY_BUSY'});
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(recoveries,1);assert.equal(c.waiting?.id,2);
  await claim;ui.economy.ledger.pending=0;c.receive(OP.RECEIPT,{id:2,ok:true,reason:'ok'});await new Promise(resolve=>setImmediate(resolve));
  assert.equal(ui.opened,false);assert.equal(c.session.revision,2);
  assert.deepEqual(events.filter(e=>e.stage==='recovery').map(e=>e.reason),['CLICK_START','DELIVERED']);
});
test('unidentified pending order stays protected and repeated taps do not poll the host',async()=>{
  const {c,ui,commerce,events}=fixture({now:()=>100000});let recoveries=0;
  commerce.recover=async()=>{recoveries++;return {ok:true,recovered:0,unknown:1};};
  let claim=ui.collect();c.receive(OP.RECEIPT,{id:1,ok:false,reason:'PAY_BUSY'});await claim;
  assert.equal(c.session.revision,1);assert.equal(ui.opened,true);
  claim=ui.collect();c.receive(OP.RECEIPT,{id:2,ok:false,reason:'PAY_BUSY'});await claim;
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(recoveries,1);assert.equal(c.session.revision,2);
  assert.deepEqual(events.filter(e=>e.stage==='recovery').map(e=>e.reason),['CLICK_START','UNKNOWN_ORDER']);
});
test('obsolete unpaid preparation does not schedule recovery or poll the host',async t=>{
  t.mock.timers.enable({apis:['setTimeout']});
  const {c,commerce,events}=fixture({account:{commerce:{intents:{egg:{payId:'egg'}}}},now:()=>100000});let recoveries=0;
  commerce.recover=async()=>{recoveries++;return {ok:true};};
  c.emit('account',{});t.mock.timers.tick(1200000);await Promise.resolve();
  assert.equal(recoveries,0);assert.equal(events.filter(e=>e.stage==='recovery').length,0);
});

test('offline click is bounded and flushed only after reconnection, without replaying claims',async()=>{
  const {c,ui,events}=fixture();events.length=0;c.session.ready=false;for(let i=0;i<40;i++)await ui.collect();assert.equal(events.length,0);
  c.session.ready=true;c.emit('status',{});assert.ok(events.length<=16);assert.equal(c.session.revision,0);assert.equal(ui.economy.ledger.pending,100);
});
test('logging transport failures never prevent successful claiming',async()=>{
  const {c,ui}=fixture();c.session.room.sendReliable=()=>{throw Error('network');};const claim=ui.collect();ui.economy.ledger.pending=0;c.receive(OP.RECEIPT,{id:1,ok:true,reason:'ok'});await claim;assert.equal(ui.opened,false);assert.equal(ui.busy,false);
});
test('a pending click cannot dispatch a duplicate transaction',async()=>{
  const {c,ui}=fixture();const first=ui.collect();await ui.collect();assert.equal(c.session.revision,1);c.receive(OP.RECEIPT,{id:1,ok:false,reason:'REJECTED'});await first;
});
test('authoritative empty balance closes stale dialog even after rejected response',async()=>{
  const {c,ui}=fixture();const claim=ui.collect();ui.economy.ledger.pending=0;c.receive(OP.RECEIPT,{id:1,ok:false,reason:'REJECTED'});await claim;assert.equal(ui.opened,false);
});
test('server telemetry ignores spoofed identities, text, balances and invalid stages',()=>{
  const logs=[],room={state:{elapsed:0},log:(level,text)=>logs.push(text)},p={id:'real-player'};
  logOffline(room,p,{stage:'receipt',id:5,player:'forged',reason:'secret text',cash:123,token:'secret'},'client');
  const data=JSON.parse(logs[0].slice('offline_claim '.length));assert.equal(data.player,'real-player');assert.equal(data.reason,'OTHER');assert.equal(data.cash,undefined);assert.equal(data.token,undefined);
  logOffline(room,p,{stage:'server_result'},'client');logOffline(room,p,{stage:'unknown'},'client');assert.equal(logs.length,1);
});
test('server log burst is capped and logging errors are isolated',()=>{
  const logs=[],room={state:{elapsed:0},log:(l,t)=>logs.push(t)},p={id:'player'};
  for(let i=0;i<100;i++)logOffline(room,p,{stage:'click'},'client');assert.equal(logs.length,8);
  room.state.elapsed=1001;logOffline(room,p,{stage:'server_result',ok:true,reason:'ok'},'server');assert.equal(logs.length,9);
  room.log=()=>{throw Error('sink failed');};assert.doesNotThrow(()=>logOffline(room,p,{stage:'click'},'client'));
});
test('Room accepts bounded recovery outcome without order identifiers',()=>{
  const logs=[],room={state:{elapsed:0},log:(_level,message)=>logs.push(message)},p={id:'player'};
  logOffline(room,p,{stage:'recovery',reason:'UNKNOWN_ORDER',orderId:'must-not-log',payId:'must-not-log'},'client');
  assert.equal(logs.length,1);assert.equal(JSON.parse(logs[0].slice('offline_claim '.length)).reason,'UNKNOWN_ORDER');
  assert.equal(logs[0].includes('must-not-log'),false);
});

test('timeout releases the UI lock, requests baseline recovery, and does not auto-award',async t=>{
  t.mock.timers.enable({apis:['setTimeout']});
  const {c,ui,events}=fixture();let recoveries=0;c.session.recover=()=>{recoveries++;};
  const claim=ui.collect();t.mock.timers.tick(12000);await claim;
  assert.equal(recoveries,1);assert.equal(ui.busy,false);assert.equal(ui.economy.ledger.pending,100);assert.equal(c.waiting,null);
  assert.equal(ui.claim.disabled,false);assert.match(ui.status,/still being checked/i);
  assert.ok(events.some(e=>e.stage==='timeout'&&e.id===1));assert.equal(c.session.revision,1);
});
test('timed out claim retries the same request and a late old receipt cannot resolve a newer one',async t=>{
  t.mock.timers.enable({apis:['setTimeout']});
  const c=new GameConnection();let retries=0;
  c.session={ready:true,active:true,revision:0,pending:null,
    intent(action){if(this.pending)return false;this.pending={id:++this.revision,action};return true;},
    retryPending(action){if(this.pending?.action!==action)return false;retries++;return true;},recover(){}};
  let request=c.command('offline-claim',undefined,{detailed:true});t.mock.timers.tick(12000);
  assert.equal((await request).reason,'TIMEOUT');
  request=c.command('offline-claim',undefined,{detailed:true});assert.equal(c.waiting.id,1);assert.equal(retries,1);
  c.session.pending=null;c.receive(OP.RECEIPT,{id:1,ok:false,reason:'RATE_LIMIT'});assert.equal((await request).reason,'RATE_LIMIT');
  request=c.command('offline-claim',undefined,{detailed:true});assert.equal(c.waiting.id,2);
  c.receive(OP.RECEIPT,{id:1,ok:true,reason:'ok'});assert.equal(c.waiting.id,2);
  c.session.pending=null;c.receive(OP.RECEIPT,{id:2,ok:true,reason:'ok'});assert.equal((await request).ok,true);
});
