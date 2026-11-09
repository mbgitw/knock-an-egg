import {spawn} from 'node:child_process';
import {mkdir,writeFile,readFile} from 'node:fs/promises';
import {deflateRawSync} from 'node:zlib';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
const root=path.resolve(import.meta.dirname,'..'),dir=path.join(root,'build/animal-glb-study');await mkdir(dir,{recursive:true});
await writeFile(path.join(dir,'index.html'),`<!doctype html><html><head><meta charset="utf-8"><title>Animal GLB study</title><style>body{margin:0}</style><script type="importmap">{"imports":{"three":"/public/vendor/three.module.js"}}</script></head><body><script type="module">import * as study from '/tools/animal-glb-study-browser.js';window.study=study;</script></body></html>`);
const pause=ms=>new Promise(r=>setTimeout(r,ms));
const server=spawn('python',['-m','http.server','8770','--bind','127.0.0.1','--directory',root],{windowsHide:true,stdio:'ignore'});
const browser=spawn('C:/Program Files/Google/Chrome/Application/chrome.exe',['--headless','--no-first-run','--use-angle=swiftshader','--enable-unsafe-swiftshader','--window-size=1200,650','--remote-debugging-port=9235',`--user-data-dir=${process.env.TEMP}/animal-glb-study-${Date.now()}`,'about:blank'],{windowsHide:true,stdio:'ignore'});
let ws;const reports=[],errors=[];
try{
  let tab;for(let i=0;i<80;i++){try{tab=(await(await fetch('http://127.0.0.1:9235/json')).json()).find(t=>t.type==='page');if(tab)break;}catch{}await pause(250);}
  if(!tab)throw Error('Chrome unavailable');ws=new WebSocket(tab.webSocketDebuggerUrl);await new Promise(r=>ws.addEventListener('open',r,{once:true}));
  let id=0;const pending=new Map();ws.addEventListener('message',event=>{const data=JSON.parse(event.data);if(data.id){pending.get(data.id)?.(data);pending.delete(data.id);}if(data.method==='Runtime.exceptionThrown')errors.push(data.params.exceptionDetails.exception?.description||data.params.exceptionDetails.text);});
  const send=(method,params={})=>new Promise((resolve,reject)=>{const key=++id;pending.set(key,data=>data.error?reject(Error(JSON.stringify(data.error))):resolve(data.result));ws.send(JSON.stringify({id:key,method,params}));});
  const evaluate=async expression=>{const result=await send('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});if(result.exceptionDetails)throw Error(result.exceptionDetails.exception?.description||result.exceptionDetails.text);return result.result.value;};
  await send('Runtime.enable');await send('Page.enable');await send('Page.navigate',{url:'http://127.0.0.1:8770/build/animal-glb-study/index.html'});
  await send('Network.enable');ws.addEventListener('message',event=>{const data=JSON.parse(event.data);if(data.method==='Network.responseReceived'&&data.params.response.status>=400)console.log('HTTP '+data.params.response.status+' '+data.params.response.url);});
  await pause(1000);for(let i=0;i<30&&!await evaluate('!!window.study');i++)await pause(250);
  for(const name of ['Chicken','CrystalDragon']){
    console.log('Building '+name);
    const result=await evaluate(`window.study.build(${JSON.stringify(name)}).catch(error=>{throw Error(window.studyPhase+': '+(error.stack||error.message||String(error)))})`),binary=Buffer.from(result.glb,'base64');await writeFile(path.join(dir,name+'.glb'),binary);
    const report=result.report;let sourceRaw=0,sourceZip=0;
    for(const dependency of report.dependencies){const bytes=await readFile(path.join(root,dependency.replace(/^\//,'')));sourceRaw+=bytes.length;sourceZip+=deflateRawSync(bytes,{level:9}).length;}
    Object.assign(report,{sourceDependencyBytes:sourceRaw,sourceDependencyZipBytes:sourceZip,glbZipBytes:deflateRawSync(binary,{level:9}).length});
    execFileSync('python',[path.join(root,'tools/optimize-study-glb.py')],{stdio:'inherit'});
    const optimized=await readFile(path.join(dir,name+'-optimized.glb'));
    report.optimized={bytes:optimized.length,zipBytes:deflateRawSync(optimized,{level:9}).length,...await evaluate(`window.study.validateOptimized(${JSON.stringify(name)},'/build/animal-glb-study/${name}-optimized.glb')`)};
    report.maxVertexError=Math.max(...report.checks.map(c=>c.max));
    for(const variant of ['Normal','Gold','Diamond']){await evaluate(`window.study.render(${JSON.stringify(name)},${JSON.stringify(variant)})`);const shot=await send('Page.captureScreenshot',{format:'png',captureBeyondViewport:true});await writeFile(path.join(dir,`${name}-${variant}.png`),Buffer.from(shot.data,'base64'));}
    reports.push(report);await writeFile(path.join(dir,'report.json'),JSON.stringify({reports,errors},null,2));
    console.log(JSON.stringify({name,sourceRaw,sourceZip,glbRaw:binary.length,glbZip:report.glbZipBytes,optimizedZip:report.optimized.zipBytes,maxVertexError:report.optimized.maxVertexError,sourceCreate16:report.sourceCreateMedianMs,glbClone16:report.glbCloneMedianMs}));
  }
  ws.send(JSON.stringify({id:++id,method:'Browser.close'}));
}finally{ws?.close();server.kill();browser.kill();}
if(errors.length||reports.some(r=>r.maxVertexError>1e-3||r.optimized.maxVertexError>1e-3||r.colorError>1e-5||!r.independentSkeletons||!r.sharedGeometry||!r.optimized.independentSkeletons||!r.optimized.sharedGeometry||r.optimized.skeletonsPerInstance!==1||r.variantChecks.some(v=>v.missing)))throw Error('Study validation failed; see build/animal-glb-study/report.json');
execFileSync('python',[path.join(root,'tools/validate-animal-glb-study.py')],{stdio:'inherit'});
