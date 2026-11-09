// Actual built game in Chromium 81, exercising native touch event propagation and the avatar mixer.
import {spawn} from 'node:child_process';
import {readFile,writeFile,unlink} from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
const root=path.resolve(import.meta.dirname,'..'),qa=path.join(root,'build/builda-draft/interaction-test.html');
await writeFile(qa,(await readFile(path.join(root,'build/builda-draft/index.html'),'utf8')).replace('<script src="builda-sdk.js"></script>',''));
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const server=spawn('python',[path.join(root,'tools/browser-compat-server.py'),'8785'],{windowsHide:true,stdio:['ignore','pipe','pipe']});
let serverLog='';for(const stream of [server.stdout,server.stderr])stream.on('data',s=>serverLog+=s);
const chrome=path.join(process.env.TEMP,'chromium-737027/chrome-win/chrome.exe');
const browser=spawn(chrome,['--headless','--no-first-run','--use-gl=swiftshader','--use-angle=swiftshader','--enable-unsafe-swiftshader','--window-size=1280,720','--remote-debugging-port=9255',`--user-data-dir=${process.env.TEMP}/knock-interactions-${Date.now()}`,'about:blank'],{windowsHide:true,stdio:'ignore'});
let ws;const report={scope:'Local built game in Chromium 81; native touch input and actual avatar animation, not a phone/Builda-host test',cycles:[],errors:[]};
try{
  let tab;for(let i=0;i<80;i++){try{tab=(await(await fetch('http://127.0.0.1:9255/json')).json()).find(t=>t.type==='page');if(tab)break;}catch{}await pause(250);}assert.ok(tab,'browser startup');
  ws=new WebSocket(tab.webSocketDebuggerUrl);await new Promise(resolve=>ws.addEventListener('open',resolve,{once:true}));let id=0;const pending=new Map();
  ws.addEventListener('message',e=>{const d=JSON.parse(e.data);if(d.id){pending.get(d.id)?.(d);pending.delete(d.id);}if(d.method==='Runtime.exceptionThrown')report.errors.push(d.params.exceptionDetails.exception?.description||d.params.exceptionDetails.text);});
  const send=(method,params={})=>new Promise((resolve,reject)=>{const key=++id;pending.set(key,d=>d.error?reject(Error(JSON.stringify(d.error))):resolve(d.result));ws.send(JSON.stringify({id:key,method,params}));});
  const evaluate=async expression=>{const d=await send('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});if(d.exceptionDetails)throw Error(d.exceptionDetails.exception?.description||d.exceptionDetails.text);return d.result.value;};
  await send('Runtime.enable');await send('Page.enable');await send('Emulation.setTouchEmulationEnabled',{enabled:true,maxTouchPoints:2});
  report.version=await send('Browser.getVersion');await send('Page.navigate',{url:'http://127.0.0.1:8785/interaction-test.html'});
  let ready;for(let i=0;i<180;i++){await pause(500);ready=await evaluate(`document.querySelector('canvas')?.dataset.ready==='true'`);if(ready)break;if(report.errors.length)throw Error(report.errors.join('\n'));if(i%20===0){report.load=await evaluate(`({url:location.href,state:{...document.querySelector('canvas')?.dataset},text:document.body.innerText.slice(0,600)})`);console.log('Loading:',JSON.stringify(report.load));}}assert.ok(ready,'game loaded');
  for(let round=0;round<3;round++){
    const stopped=await evaluate(`(()=>{gameHostState.visible=false;window.dispatchEvent(new Event('game-host-pause'));return {running:!!game.player.training,awaitingInput:game.treadmills.awaitingInput};})()`);
    assert.deepEqual(stopped,{running:false,awaitingInput:true});
    await evaluate(`gameHostState.visible=true;window.dispatchEvent(new Event('game-host-pause'))`);
    const touch=await evaluate(`(()=>{for(const x of [150,250,350])for(const y of [330,420,510])if(document.elementFromPoint(x,y)===game.canvas)return {x,y};throw Error('No canvas touch target');})()`);
    await send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{...touch,id:1}]});
    const activation=await evaluate(`({awaitingInput:game.treadmills.awaitingInput,touches:game.player.touches.size})`);
    assert.equal(activation.awaitingInput,false);assert.equal(activation.touches,1);
    await send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
    const entered=await evaluate(`(async()=>{const T=await import('./vendor/three.module.js'),t=game.treadmills,p=game.player;t.account.data.unlocked=true;t.cooldown=0;t.ownNear=true;t.own.root.updateMatrixWorld(true);p.motor.teleport(new T.Vector3(...t.own.metadata.slots[0]).applyMatrix4(t.own.root.matrixWorld));p.motor.grounded=true;const ok=t.enter('own');p.update(.016);return {ok,running:!!p.training,animation:p.animation,time:p.actions.get('RunLobbyNew').time};})()`);
    assert.equal(entered.ok,true);assert.equal(entered.running,true);assert.equal(entered.animation,'RunLobbyNew');
    const advanced=await evaluate(`(()=>{const p=game.player,a=p.actions.get('RunLobbyNew'),before=a.time;p.update(.1);return a.time!==before;})()`);assert.equal(advanced,true);
    report.cycles.push({round:round+1,captureActivated:true,animationAdvanced:advanced});
  }
  assert.deepEqual(report.errors,[]);report.passed=true;
}catch(error){report.passed=false;report.failure=String(error);report.serverLog=serverLog;}
finally{if(ws?.readyState===1)ws.send(JSON.stringify({id:99999,method:'Browser.close'}));ws?.close();browser.kill();server.kill();await unlink(qa);await writeFile(path.join(root,'build/interaction-browser-validation.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report));}
if(!report.passed)process.exitCode=1;
