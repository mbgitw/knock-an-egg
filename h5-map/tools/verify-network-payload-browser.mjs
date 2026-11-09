// Real game page in headless Chrome against the local Room Mock (start it on 7350 and serve.py on 8765 first).
// Checks binary guard decoding and that a real pickaxe swing presents before its Room receipt.
import {spawn} from 'node:child_process';
import {writeFile} from 'node:fs/promises';
const port=9241,pause=ms=>new Promise(r=>setTimeout(r,ms));
const browser=spawn('C:/Program Files/Google/Chrome/Application/chrome.exe',['--headless','--no-first-run','--use-angle=swiftshader','--enable-unsafe-swiftshader','--window-size=1280,720',`--remote-debugging-port=${port}`,`--user-data-dir=${process.env.TEMP}/network-payload-${Date.now()}`,'about:blank'],{windowsHide:true,stdio:'ignore'});
const errors=[],report={scope:'Headless Chrome real game page + local Room Mock. Not WebRTC/mobile evidence; Mock latency is near zero.'};let ws;
try{
  let tab;for(let i=0;i<80;i++){try{tab=(await(await fetch(`http://127.0.0.1:${port}/json`)).json()).find(t=>t.type==='page');if(tab)break;}catch{}await pause(250);}if(!tab)throw Error('Chrome unavailable');
  ws=new WebSocket(tab.webSocketDebuggerUrl);await new Promise(r=>ws.addEventListener('open',r,{once:true}));let id=0;const pending=new Map();
  ws.addEventListener('message',event=>{const data=JSON.parse(event.data);if(data.id){pending.get(data.id)?.(data);pending.delete(data.id);}if(data.method==='Runtime.exceptionThrown')errors.push(data.params.exceptionDetails.exception?.description||data.params.exceptionDetails.text);});
  const send=(method,params={})=>new Promise((resolve,reject)=>{const key=++id;pending.set(key,d=>d.error?reject(Error(JSON.stringify(d.error))):resolve(d.result));ws.send(JSON.stringify({id:key,method,params}));});
  const evaluate=async expression=>{const r=await send('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});if(r.exceptionDetails)throw Error(r.exceptionDetails.exception?.description||r.exceptionDetails.text);return r.result.value;};
  await send('Runtime.enable');await send('Page.navigate',{url:'http://localhost:8765/?builda_mock_shell=1&builda_mock_player=player-3'});
  let ready;for(let i=0;i<240;i++){await pause(500);try{ready=await evaluate(`({ready:document.querySelector('canvas')?.dataset.ready,error:document.querySelector('canvas')?.dataset.error})`);}catch{continue;}if(ready.error)throw Error(ready.error);if(ready.ready==='true')break;}
  if(ready?.ready!=='true')throw Error('Game load timeout');
  report.result=await evaluate(`(async()=>{
    const g=window.game,o=g.online,eggs=g.pickaxes.eggs,wait=ms=>new Promise(r=>setTimeout(r,ms));
    const frame=()=>new Promise(r=>requestAnimationFrame(()=>r()));
    await wait(1500);const guardStart=o.guardTime;await wait(1000);
    const guards={binaryFrames:o.guardTime>guardStart,count:o.guardFrames.length,states:[...new Set(o.guardFrames.map(f=>f.state))]};
    if(!g.account.data.pickaxes.equipped)throw Error('no pickaxe equipped');
    const egg=eggs.eggs.filter(e=>e.spec.zone===1&&!e.spec.titanic&&!e.removed&&e.life.hp>=4).sort((a,b)=>a.life.hp-b.life.hp)[0];
    const [x,,z]=egg.spec.position,standOff=Math.max(egg.spec.size[0],egg.spec.size[2])/2+1.2;
    g.player.motor.teleport(new g.player.motor.position.constructor(x,egg.spec.floorY+.5,z-standOff));g.player.actor.rotation.y=0;
    for(let i=0;i<30;i++)await frame();
    const popups=()=>document.querySelectorAll('#egg-popups span').length,hitCount=()=>Number(document.querySelector('canvas').dataset.hitCount);
    const before={hp:egg.life.hp,popups:popups(),hits:hitCount()};const t0=performance.now();let presentedAt=null,receiptAt=null,authoritativeAt=null;
    g.player.actor.rotation.y=Math.atan2(x-g.player.motor.position.x,z-g.player.motor.position.z);g.pickaxes.swing();
    for(let i=0;i<240&&(receiptAt===null||authoritativeAt===null);i++){await frame();const t=performance.now()-t0;
      if(presentedAt===null&&popups()>before.popups)presentedAt=t;if(receiptAt===null&&hitCount()>before.hits)receiptAt=t;if(authoritativeAt===null&&egg.life.hp<before.hp)authoritativeAt=t;}
    const seqBefore=o.session.accountSeq,claimStart=performance.now();await o.command('offline-claim');
    const transaction={receipt:o.lastReceipt,receiptMs:performance.now()-claimStart,accountSeqBefore:seqBefore,accountSeqAfter:o.session.accountSeq,waiting:!!o.waiting};
    return {transaction,guards,egg:{id:egg.spec.id,hpBefore:before.hp,hpAfter:egg.life.hp,localHits:egg.localHits},presentedMs:presentedAt,receiptMs:receiptAt,authoritativeHpMs:authoritativeAt,presentedBeforeReceipt:presentedAt!==null&&receiptAt!==null&&presentedAt<=receiptAt,eggDeltaMisses:o.eggDeltaMisses||0};
  })()`);
  report.errors=errors;
  const r=report.result;report.passed=!!r.transaction.receipt&&!r.transaction.waiting&&r.transaction.accountSeqAfter>r.transaction.accountSeqBefore&&r.guards.binaryFrames&&r.guards.count>0&&r.presentedBeforeReceipt&&r.egg.hpAfter<r.egg.hpBefore&&r.egg.localHits===0&&!errors.length;
}catch(error){report.passed=false;report.failure=String(error?.stack||error);report.errors=errors;}
finally{try{ws?.close();}catch{}browser.kill();await writeFile('build/network-payload-browser.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));}
if(!report.passed)process.exitCode=1;
