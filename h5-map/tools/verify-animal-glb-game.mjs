import {spawn} from 'node:child_process';
import {mkdir,readFile,writeFile,unlink} from 'node:fs/promises';
import path from 'node:path';
const root=path.resolve(import.meta.dirname,'..'),out=path.join(root,'../outputs/animal-glb-migration');await mkdir(out,{recursive:true});
const qa=path.join(root,'build/animal-glb-runtime-tests');await mkdir(qa,{recursive:true});
await writeFile(path.join(qa,'index.html'),`<!doctype html><style>body{margin:0}</style><script type="importmap">{"imports":{"three":"/public/vendor/three.module.js"}}</script><script type="module">import * as checks from '/tools/validate-animal-glbs-browser.js';window.checks=checks;</script>`);
const server=spawn('python',[path.join(root,'tools/animal-glb-qa-server.py')],{windowsHide:true,stdio:'ignore'});
const browser=spawn('C:/Program Files/Google/Chrome/Application/chrome.exe',['--headless','--no-first-run','--use-angle=swiftshader','--enable-unsafe-swiftshader','--window-size=1280,720','--remote-debugging-port=9237',`--user-data-dir=${process.env.TEMP}/animal-runtime-${Date.now()}`,'about:blank'],{windowsHide:true,stdio:'ignore'});
const pause=ms=>new Promise(r=>setTimeout(r,ms));let ws;const errors=[],responses=[],validations=[],consoleErrors=[];
try{
 let tab;for(let i=0;i<80;i++){try{tab=(await(await fetch('http://127.0.0.1:9237/json')).json()).find(t=>t.type==='page');if(tab)break;}catch{}await pause(250);}if(!tab)throw Error('Chrome unavailable');
 ws=new WebSocket(tab.webSocketDebuggerUrl);await new Promise(r=>ws.addEventListener('open',r,{once:true}));let id=0;const pending=new Map();
 ws.addEventListener('message',event=>{const data=JSON.parse(event.data);if(data.id){pending.get(data.id)?.(data);pending.delete(data.id);}if(data.method==='Runtime.exceptionThrown')errors.push(data.params.exceptionDetails.exception?.description||data.params.exceptionDetails.text);if(data.method==='Runtime.consoleAPICalled'&&data.params.type==='error')consoleErrors.push(data.params.args.map(a=>a.description||a.value));if(data.method==='Network.responseReceived'&&data.params.response.status>=400&&!data.params.response.url.endsWith('/favicon.ico'))responses.push(data.params.response);});
 const send=(method,params={})=>new Promise((resolve,reject)=>{const key=++id;pending.set(key,data=>data.error?reject(Error(JSON.stringify(data.error))):resolve(data.result));ws.send(JSON.stringify({id:key,method,params}));});
 const evaluate=async expression=>{const result=await send('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});if(result.exceptionDetails)throw Error(result.exceptionDetails.exception?.description||result.exceptionDetails.text);return result.result.value;};
 await send('Runtime.enable');await send('Page.enable');await send('Network.enable');await send('Page.navigate',{url:'http://127.0.0.1:8772/build/animal-glb-runtime-tests/index.html'});await pause(1000);
 for(let i=0;i<40&&!await evaluate('!!window.checks');i++)await pause(250);
 const names=await evaluate('window.checks.prepare()');
 for(const [index,name] of names.entries()){validations.push(await evaluate(`window.checks.validate(${JSON.stringify(name)})`));if(index%8===0||index===names.length-1)console.log(`Runtime checked ${index+1}/${names.length}: ${name}`);}
 const benchmarks=[];for(const name of ['Chicken','CrystalDragon'])benchmarks.push(await evaluate(`window.checks.benchmark(${JSON.stringify(name)})`));await writeFile(path.join(out,'benchmark.json'),JSON.stringify({benchmarks},null,2));
 for(const name of ['Chicken','CrystalDragon','CelestialBeast','AngelHydra'])for(const variant of ['Normal','Gold','Diamond']){
  await evaluate(`window.checks.render(${JSON.stringify(name)},${JSON.stringify(variant)})`);const shot=await send('Page.captureScreenshot',{format:'png',captureBeyondViewport:true});await writeFile(path.join(out,`${name}-${variant}.png`),Buffer.from(shot.data,'base64'));
 }
 await writeFile(path.join(out,'runtime-validation.json'),JSON.stringify({validations,errors,responses},null,2));
 if(!process.argv.includes('--models-only')){
 const gameQa=path.join(root,'build/builda-draft/plot-test.html');await writeFile(gameQa,await readFile(path.join(root,'build/builda-draft/index.html'),'utf8'));
 try{
  await send('Page.navigate',{url:'http://127.0.0.1:8772/build/builda-draft/plot-test.html'});await pause(1000);let ready;
  for(let i=0;i<180;i++){ready=await evaluate(`({ready:document.querySelector('canvas')?.dataset.ready,error:document.querySelector('canvas')?.dataset.error,stage:document.querySelector('canvas')?.dataset.loadingStage})`);if(ready.error)throw Error(JSON.stringify({ready,errors,consoleErrors,responses:responses.map(r=>r.url)}));if(ready.ready==='true')break;await pause(500);}if(ready?.ready!=='true')throw Error('Game load timeout '+JSON.stringify(ready));
  const gameplay=await evaluate(`import('/tools/verify-animal-glb-gameplay-browser.js').then(m=>m.run())`);await writeFile(path.join(out,'gameplay-validation.json'),JSON.stringify({gameplay,errors,responses},null,2));console.log(JSON.stringify(gameplay));
 }finally{await unlink(gameQa);}
 }
 if(errors.length||responses.length)throw Error('Browser errors/network failures; see validation reports');
 ws.send(JSON.stringify({id:++id,method:'Browser.close'}));
}finally{ws?.close();server.kill();browser.kill();}
