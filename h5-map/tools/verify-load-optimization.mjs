import {spawn} from 'node:child_process';
import {mkdir,readFile,writeFile,unlink} from 'node:fs/promises';
import path from 'node:path';
const root=path.resolve(import.meta.dirname,'..'),out=path.join(root,'../outputs/load-optimization');
await mkdir(out,{recursive:true});
const chrome='C:/Program Files/Google/Chrome/Application/chrome.exe';
const pause=ms=>new Promise(r=>setTimeout(r,ms));
const reports=[];
for(const [label,folder,port,debug] of [['before','audio-baseline',8766,9231],['after','builda-draft',8767,9232]]){
  const dir=path.join(root,'build',folder),qa=path.join(dir,'plot-test.html');
  await writeFile(qa,(await readFile(path.join(dir,'index.html'),'utf8')).replace('<script src="builda-sdk.js"></script>',''));
  const server=spawn('python',['-m','http.server',String(port),'--bind','127.0.0.1','--directory',dir],{windowsHide:true,stdio:'ignore'});
  const browser=spawn(chrome,['--headless','--no-first-run','--use-angle=swiftshader','--enable-unsafe-swiftshader','--window-size=1280,720',`--remote-debugging-port=${debug}`,`--user-data-dir=${process.env.TEMP}/knock-load-${label}-${Date.now()}`,'about:blank'],{windowsHide:true,stdio:'ignore'});
  let ws;
  try{
    let tab;
    for(let i=0;i<80;i++){try{tab=(await(await fetch(`http://127.0.0.1:${debug}/json`)).json()).find(t=>t.type==='page');if(tab)break;}catch{}await pause(250);}
    if(!tab)throw Error('Chrome did not start');
    ws=new WebSocket(tab.webSocketDebuggerUrl);await new Promise(r=>ws.addEventListener('open',r,{once:true}));
    let id=0;const pending=new Map(),errors=[],badResponses=[];
    ws.addEventListener('message',e=>{const data=JSON.parse(e.data);if(data.id){pending.get(data.id)?.(data);pending.delete(data.id);}
      if(data.method==='Runtime.exceptionThrown')errors.push(data.params.exceptionDetails.exception?.description||data.params.exceptionDetails.text);
      if(data.method==='Network.responseReceived'&&data.params.response.status>=400)badResponses.push({url:data.params.response.url,status:data.params.response.status});
    });
    const send=(method,params={})=>new Promise((resolve,reject)=>{const key=++id;pending.set(key,data=>data.error?reject(Error(JSON.stringify(data.error))):resolve(data.result));ws.send(JSON.stringify({id:key,method,params}));});
    const evaluate=async expression=>{const result=await send('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});if(result.exceptionDetails)throw Error(result.exceptionDetails.text);return result.result.value;};
    await send('Runtime.enable');await send('Network.enable');await send('Page.enable');
    await send('Page.navigate',{url:`http://127.0.0.1:${port}/plot-test.html`});
    let state;
    for(let i=0;i<180;i++){await pause(500);state=await evaluate(`({ready:document.querySelector('canvas')?.dataset.ready,error:document.querySelector('canvas')?.dataset.error,stage:document.querySelector('canvas')?.dataset.loadingStage})`);if(state.error)throw Error(state.error);if(state.ready==='true')break;}
    if(state?.ready!=='true')throw Error('Load timeout '+JSON.stringify(state));
    const performance=await evaluate(`({readyMs:performance.now(),resources:performance.getEntriesByType('resource').length,bytes:performance.getEntriesByType('resource').reduce((n,r)=>n+r.encodedBodySize,0)})`);
    await pause(1000);
    const screenshot=async name=>{const result=await send('Page.captureScreenshot',{format:'png'});await writeFile(path.join(out,`${label}-${name}.png`),Buffer.from(result.data,'base64'));};
    await screenshot('world');
    await evaluate('window.game.indexUI.open()');await pause(1500);await screenshot('index');
    await evaluate('window.game.indexUI.close();window.game.shopUI.open()');await pause(1500);await screenshot('shop');
    const assets=await evaluate(`({images:[...document.images].filter(i=>i.currentSrc&&!i.complete||i.complete&&i.currentSrc&&!i.naturalWidth).map(i=>i.currentSrc),webp:performance.getEntriesByType('resource').filter(r=>r.name.includes('.webp')).length})`);
    reports.push({label,...performance,errors,badResponses,assets});
    console.log(JSON.stringify(reports.at(-1)));
    ws.send(JSON.stringify({id:++id,method:'Browser.close'}));
  }finally{ws?.close();server.kill();browser.kill();await unlink(qa);}
}
await writeFile(path.join(out,'browser-report.json'),JSON.stringify(reports,null,2));
if(reports.some(r=>r.errors.length||r.assets.images.length||r.badResponses.some(b=>!b.url.endsWith('favicon.ico'))))process.exitCode=1;
