import {spawn} from 'node:child_process';
import {mkdir,writeFile} from 'node:fs/promises';
import path from 'node:path';

const root=path.resolve(import.meta.dirname,'..');
const chrome=process.env.PERF_CHROME||'C:/Program Files/Google/Chrome/Application/chrome.exe';
const duration=Number(process.argv[2]||8);
const label=process.argv[3]||'baseline';
const port=9328+Math.floor(Math.random()*500);
const browser=spawn(chrome,['--headless=new','--no-first-run','--window-size=1280,720',`--force-device-scale-factor=1.5`,`--remote-debugging-port=${port}`,`--user-data-dir=${path.join(process.env.TEMP||root,`knock-perf-${Date.now()}`)}`,'about:blank'],{windowsHide:true,stdio:'ignore'});
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
let ws;
try{
  let tab;
  for(let i=0;i<80;i++){
    try{tab=(await(await fetch(`http://127.0.0.1:${port}/json`)).json()).find(item=>item.type==='page');if(tab)break;}catch{}
    await pause(250);
  }
  if(!tab)throw Error('Browser did not start');
  ws=new WebSocket(tab.webSocketDebuggerUrl);
  await new Promise(resolve=>ws.addEventListener('open',resolve,{once:true}));
  let id=0;
  const pending=new Map();
  ws.addEventListener('message',event=>{const result=JSON.parse(event.data);if(result.id){pending.get(result.id)?.(result);pending.delete(result.id);}});
  const send=(method,params={})=>new Promise((resolve,reject)=>{const key=++id;pending.set(key,result=>result.error?reject(Error(JSON.stringify(result.error))):resolve(result.result));ws.send(JSON.stringify({id:key,method,params}));});
  const evaluate=async expression=>{const result=await send('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});if(result.exceptionDetails)throw Error(result.exceptionDetails.exception?.description||result.exceptionDetails.text);return result.result.value;};
  await send('Runtime.enable');await send('Page.enable');
  await send('Emulation.setDeviceMetricsOverride',{width:1280,height:720,deviceScaleFactor:1.5,mobile:false});
  const version=(await send('Browser.getVersion')).product;
  await send('Page.navigate',{url:'http://127.0.0.1:8765/pasture-test.html'});
  let state;
  for(let i=0;i<180;i++){
    await pause(500);
    state=await evaluate(`({ready:document.querySelector('canvas')?.dataset.ready,error:document.querySelector('canvas')?.dataset.error,stage:document.querySelector('canvas')?.dataset.loadingStage})`);
    if(state.error)throw Error(JSON.stringify(state));
    if(state.ready==='true')break;
  }
  if(state?.ready!=='true')throw Error(`Load timeout ${JSON.stringify(state)}`);
  await evaluate(`document.querySelector('#carry-qa')?.remove()`);
  await pause(2000);
  const result=await evaluate(`(async()=>{
    const targets=['player','animals','treadmills','plots','pickaxes','weapons','backpack','pasture','merge','indexUI','inventoryUI','shopUI','trails','guards','zoneEntry','environment','eggs','eggCull','eggAmbient','eggBillboards','eggFeedback'];
    const totals={};const originals=[];
    for(const name of targets){const object=({eggs:game.pickaxes?.eggs,eggCull:game.pickaxes?.eggs,eggAmbient:game.pickaxes?.eggs,eggBillboards:game.pickaxes?.eggs?.billboards,eggFeedback:game.pickaxes?.eggs?.feedback})[name]??game[name],key=name==='environment'?'render':name==='eggCull'?'updateCull':name==='eggAmbient'?'updateAmbient':'update';if(typeof object?.[key]!=='function')continue;
      const original=object[key];totals[name]={calls:0,ms:0,maxMs:0};
      object[key]=function(...args){const begin=performance.now();try{return original.apply(this,args);}finally{const ms=performance.now()-begin;totals[name].calls++;totals[name].ms+=ms;totals[name].maxMs=Math.max(totals[name].maxMs,ms);}};
      originals.push([object,key,original]);
    }
    try{const frames=await game.performance.start(${duration});return {frames,stages:totals,sceneChildren:game.scene.children.length,visibleChildren:game.scene.children.filter(child=>child.visible).length,canvas:[game.canvas.width,game.canvas.height],glError:game.renderer.getContext().getError(),heap:performance.memory?.usedJSHeapSize??null};}
    finally{for(const [object,key,original] of originals)object[key]=original;}
  })()`);
  const billboards=await evaluate(`({total:document.querySelectorAll('.egg-billboard').length,visible:[...document.querySelectorAll('.egg-billboard')].filter(node=>!node.hidden).length,missingTransforms:[...document.querySelectorAll('.egg-billboard')].filter(node=>!node.hidden&&!node.style.transform).length})`);
  const report={label,version,scenario:'pasture-test fixed spawn, 1280x720 CSS, DPR 1.5, 2s warmup',result,billboards};
  const out=path.join(root,'../outputs/performance-toolkit');await mkdir(out,{recursive:true});
  await writeFile(path.join(out,`${label}.json`),JSON.stringify(report,null,2));
  const shot=await send('Page.captureScreenshot',{format:'png'});
  await writeFile(path.join(out,`${label}.png`),Buffer.from(shot.data,'base64'));
  console.log(JSON.stringify(report));
}finally{
  if(ws?.readyState===1)ws.send(JSON.stringify({id:99999,method:'Browser.close'}));
  ws?.close();browser.kill();
}
