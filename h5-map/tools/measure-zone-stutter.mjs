import {spawn} from 'node:child_process';
import {mkdir,writeFile} from 'node:fs/promises';
import path from 'node:path';

const root=path.resolve(import.meta.dirname,'..');
const chrome=process.env.PERF_CHROME||'C:/Program Files/Google/Chrome/Application/chrome.exe';
const duration=Number(process.argv[2]||20);
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
  await send('Page.addScriptToEvaluateOnNewDocument',{source:'let perfSeed=1234567;Math.random=()=>((perfSeed=Math.imul(1664525,perfSeed)+1013904223)>>>0)/4294967296;'});
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
    const seed=1234567;let rng=seed;Math.random=()=>((rng=Math.imul(1664525,rng)+1013904223)>>>0)/4294967296;
    const g=game,e=g.pickaxes.eggs,p=g.player,totals={},originals=[],events=[],longTasks=[];
    const wrap=(o,k,name)=>{if(!o?.[k])return;const original=o[k];totals[name]={calls:0,ms:0,maxMs:0};o[k]=function(...args){const start=performance.now();try{return original.apply(this,args);}finally{const ms=performance.now()-start,t=totals[name];t.calls++;t.ms+=ms;t.maxMs=Math.max(t.maxMs,ms);if(ms>40)events.push({kind:name,ms,x:p.motor.position.x});}};originals.push([o,k,original]);};
    for(const name of ['player','animals','treadmills','plots','pickaxes','weapons','backpack','pasture','merge','indexUI','inventoryUI','shopUI','trails','guards','zoneEntry'])wrap(g[name],'update',name);
    wrap(g.environment,'render','render');wrap(e,'updateAmbient','ambient');wrap(p.world,'capsuleIntersect','collision');wrap(p.world,'cameraRayIntersect','cameraRay');
    const gl=g.renderer.getContext();for(const name of ['compileShader','linkProgram','getProgramParameter','texImage2D','bufferData'])wrap(gl,name,name);
    const observer=new PerformanceObserver(list=>{for(const t of list.getEntries())longTasks.push({start:t.startTime,ms:t.duration,x:p.motor.position.x});});observer.observe({entryTypes:['longtask']});
    const shaderSources=[];const rawShaderSource=gl.shaderSource;gl.shaderSource=function(shader,source){shaderSources.push(source.split('\\n').filter(l=>l.startsWith('#define ')).join('\\n'));return rawShaderSource.call(this,shader,source);};
    const samples=[],rawPlayer=p.update;let route=0,phase='forest';
    const setPosition=(x,z)=>{const dx=x-p.motor.position.x,dz=z-p.motor.position.z;p.motor.teleport(p.motor.position.clone().set(x,.6,z));p.actor.position.copy(p.motor.position);p.previousTarget.x+=dx;p.previousTarget.z+=dz;p.orbitCamera.position.x+=dx;p.orbitCamera.position.z+=dz;p.controls.target.x+=dx;p.controls.target.z+=dz;};
    setPosition(-130,0);
    p.update=function(dt){route+=dt;if(route<4){phase='forest';setPosition(-130,Math.sin(route)*20);}else{phase='candy';const t=route-4;setPosition(-480-t*12,Math.sin(t*.45)*35);}rawPlayer.call(this,dt);};
    const rawRender=g.environment.render;g.environment.render=function(camera){const start=performance.now();rawRender.call(this,camera);let lights=0;g.scene.traverseVisible(o=>{if(o.isPointLight)lights++;});samples.push({t:start,ms:performance.now()-start,x:p.motor.position.x,phase,lights,programs:g.renderer.info.programs.length,geometries:g.renderer.info.memory.geometries,textures:g.renderer.info.memory.textures});};
    try{await new Promise(r=>setTimeout(r,${duration}*1000));return {samples,totals,events,longTasks,shaderSources,glError:gl.getError()};}
    finally{observer.disconnect();gl.shaderSource=rawShaderSource;g.environment.render=rawRender;p.update=rawPlayer;for(const [o,k,original]of originals)o[k]=original;}
  })()`);
  const report={label,version,scenario:'Seeded offline scene; forest then moving Candy->Swamp, 1280x720 DPR 1.5; CPU submission not GPU time',result};
  const out=path.join(root,'../outputs/candy-stutter');await mkdir(out,{recursive:true});
  await writeFile(path.join(out,`${label}.json`),JSON.stringify(report,null,2));
  console.log(JSON.stringify({label,samples:result.samples.length,totals:result.totals,events:result.events,longTasks:result.longTasks,lightCounts:[...new Set(result.samples.map(s=>s.lights))],programRange:[Math.min(...result.samples.map(s=>s.programs)),Math.max(...result.samples.map(s=>s.programs))]}));
}finally{
  if(ws?.readyState===1)ws.send(JSON.stringify({id:99999,method:'Browser.close'}));
  ws?.close();browser.kill();
}
