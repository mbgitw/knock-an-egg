import {spawn} from 'node:child_process';
import {mkdir,readFile,writeFile,unlink} from 'node:fs/promises';
import path from 'node:path';
const root=path.resolve(import.meta.dirname,'..'),dir=path.join(root,'build/builda-draft');
const label=process.argv[2]||'chrome81',chrome=process.env.COMPAT_CHROME||path.join(process.env.TEMP,'chromium-737027/chrome-win/chrome.exe');
const out=path.join(root,'../outputs/browser-compat',label);await mkdir(out,{recursive:true});
const qa=path.join(dir,'browser-compat-test.html');
await writeFile(qa,(await readFile(path.join(dir,'index.html'),'utf8')).replace('<script src="builda-sdk.js"></script>',''));
const pause=ms=>new Promise(r=>setTimeout(r,ms));
const server=spawn('python',[path.join(root,'tools/browser-compat-server.py'),'8783'],{windowsHide:true,stdio:'ignore'});
const browser=spawn(chrome,['--headless','--no-first-run','--use-gl=swiftshader','--use-angle=swiftshader','--enable-unsafe-swiftshader','--window-size=1280,720','--remote-debugging-port=9251',`--user-data-dir=${process.env.TEMP}/knock-compat-${label}-${Date.now()}`,'about:blank'],{windowsHide:true,stdio:'ignore'});
let ws;const report={label,mode:'Local client rendering; local native-audio copies; no host/payment mock',errors:[],badResponses:[],screens:[],glErrors:[],glWarnings:[]};
try{
 let tab;for(let i=0;i<80;i++){try{tab=(await(await fetch('http://127.0.0.1:9251/json')).json()).find(t=>t.type==='page');if(tab)break;}catch{}await pause(250);}
 if(!tab)throw Error('Browser did not start');
 ws=new WebSocket(tab.webSocketDebuggerUrl);await new Promise(r=>ws.addEventListener('open',r,{once:true}));
 let id=0;const pending=new Map();
 ws.addEventListener('message',e=>{const d=JSON.parse(e.data);if(d.id){pending.get(d.id)?.(d);pending.delete(d.id);}if(d.method==='Runtime.exceptionThrown')report.errors.push(d.params.exceptionDetails.exception?.description||d.params.exceptionDetails.text);if(d.method==='Network.responseReceived'&&d.params.response.status>=400&&!d.params.response.url.endsWith('favicon.ico'))report.badResponses.push(d.params.response.url);});
 const send=(method,params={})=>new Promise((resolve,reject)=>{const key=++id;pending.set(key,d=>d.error?reject(Error(JSON.stringify(d.error))):resolve(d.result));ws.send(JSON.stringify({id:key,method,params}));});
 const evaluate=async expression=>{const d=await send('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});if(d.exceptionDetails)throw Error(d.exceptionDetails.exception?.description||d.exceptionDetails.text);return d.result.value;};
 ws.addEventListener('message',e=>{const d=JSON.parse(e.data);if(d.method==='Runtime.consoleAPICalled'&&d.params.type==='error')console.log('Browser error:',d.params.args.map(a=>a.description||a.value).join(' '));});
 ws.addEventListener('message',e=>{const d=JSON.parse(e.data);if(d.method==='Log.entryAdded'&&/WebGL|GL_|shader|texture/i.test(d.params.entry.text)){const entry=d.params.entry;(/INVALID|incomplete|ERROR|CONTEXT_LOST/i.test(entry.text)?report.glErrors:report.glWarnings).push(entry.text);}});
 await send('Log.enable');await send('Runtime.enable');await send('Network.enable');await send('Page.enable');report.version=await send('Browser.getVersion');
 if(process.env.COMPAT_NO_BITMAP)await send('Page.addScriptToEvaluateOnNewDocument',{source:'window.createImageBitmap=undefined;'});
 await send('Page.navigate',{url:'http://127.0.0.1:8783/browser-compat-test.html'});
 let state;for(let i=0;i<180;i++){await pause(500);state=await evaluate(`({ready:document.querySelector('canvas')?.dataset.ready,error:document.querySelector('canvas')?.dataset.error,stage:document.querySelector('canvas')?.dataset.loadingStage})`);if(state.error)throw Error(JSON.stringify(state));if(state.ready==='true')break;if(report.errors.length)throw Error(report.errors.join('\n'));}
 if(state?.ready!=='true')throw Error('Load timeout '+JSON.stringify(state));
 report.render=await evaluate(`(()=>{game.environment.render(game.camera);const gl=game.renderer.getContext(),pixels=new Uint8Array(4);gl.readPixels(320,180,1,1,gl.RGBA,gl.UNSIGNED_BYTE,pixels);return {pixel:Array.from(pixels),error:gl.getError(),info:game.renderer.info.render,compatibility:game.renderer.browserCompatibility,paused:gameHostState.paused,hidden:document.hidden,canvas:[game.canvas.width,game.canvas.height],extensions:gl.getSupportedExtensions()};})()`);
 const canvasImage=await evaluate(`(()=>{game.renderer.render(game.scene,game.camera);return game.canvas.toDataURL();})()`);await writeFile(path.join(out,'canvas.png'),Buffer.from(canvasImage.split(',')[1],'base64'));
 if(process.env.COMPAT_DEBUG_RENDER){for(const variant of ['alpha','maps','basic']){const img=await evaluate(`(async()=>{const T=await import('./vendor/three.module.js');const saved=[];game.scene.traverse(o=>{if(o.isMesh&&!Array.isArray(o.material)&&o.material.opacity>0){saved.push([o,o.material]);let m=o.material.clone();if('${variant}'==='alpha'){m.alphaTest=0;m.transparent=false;}if('${variant}'==='maps'){m.map=null;m.normalMap=null;m.envMap=null;}if('${variant}'==='basic'){m=new T.MeshBasicMaterial({color:o.material.color,map:o.material.map,opacity:o.material.opacity,transparent:o.material.transparent,alphaTest:o.material.alphaTest,side:o.material.side});}o.material=m;}});game.renderer.render(game.scene,game.camera);const image=game.canvas.toDataURL();for(const [o,m]of saved){o.material.dispose();o.material=m;}return image;})()`);await writeFile(path.join(out,'debug-'+variant+'.png'),Buffer.from(img.split(',')[1],'base64'));}}
 report.shims=await evaluate(`({at:[1,2].at(-1),own:Object.hasOwn({x:1},'x'),uuid:crypto.randomUUID(),importMap:document.querySelector('script[type=importmap]')!==null,container:CSS.supports('width','1cqw')})`);
 if(process.env.COMPAT_DEBUG_TEXTURE){for(const variant of ['mips','srgb']){const img=await evaluate(`(async()=>{const T=await import('./vendor/three.module.js'),saved=new Map();game.scene.traverse(o=>{if(o.isMesh){for(const m of Array.isArray(o.material)?o.material:[o.material])for(const k of ['map','normalMap'])if(m[k]&&!saved.has(m[k])){const t=m[k];saved.set(t,[t.generateMipmaps,t.minFilter,t.colorSpace]);if('${variant}'==='mips'){t.generateMipmaps=false;t.minFilter=T.LinearFilter;}else t.colorSpace=T.NoColorSpace;t.needsUpdate=true;}}});game.renderer.render(game.scene,game.camera);const image=game.canvas.toDataURL();for(const [t,s]of saved){[t.generateMipmaps,t.minFilter,t.colorSpace]=s;t.needsUpdate=true;}return image;})()`);await writeFile(path.join(out,'debug-'+variant+'.png'),Buffer.from(img.split(',')[1],'base64'));}}
 for(const [name,action,selector]of [
  ['world','', '#auto-pickaxe'],
  ['shop','game.shopUI.open()', '.gcoin-shop-stage'],
  ['backpack','game.shopUI.close();game.backpack.open()', '#backpack-panel'],
  ['index','game.backpack.close();game.indexUI.open()', '.original-index'],
  ['pickaxe',"game.indexUI.close();game.pickaxes.open('shop')",'.pickaxe-panel'],
 ]){
  if(action)await evaluate(action);await pause(700);
  report.screens.push({name,geometry:await evaluate(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});if(!e)return null;const r=e.getBoundingClientRect();return {width:r.width,height:r.height,font:getComputedStyle(e).fontSize};})()`)});
  const shot=await send('Page.captureScreenshot',{format:'png'});await writeFile(path.join(out,name+'.png'),Buffer.from(shot.data,'base64'));
 }
 await send('Emulation.setDeviceMetricsOverride',{width:844,height:390,deviceScaleFactor:1,mobile:false});
 await evaluate('game.pickaxes.close();game.backpack.open()');await pause(700);
 report.mobile=await evaluate(`(()=>{const r=document.querySelector('#backpack-panel').getBoundingClientRect();return {width:r.width,height:r.height,viewport:[innerWidth,innerHeight]};})()`);
 const shot=await send('Page.captureScreenshot',{format:'png'});await writeFile(path.join(out,'mobile-backpack.png'),Buffer.from(shot.data,'base64'));
 // This known spawn point must show green terrain, not the blue sky exposed by
 // invisible map textures. Keep this in addition to manual screenshot review.
 report.spawnTerrainVisible=report.render.pixel[1]>report.render.pixel[0]&&report.render.pixel[1]>report.render.pixel[2];
 report.passed=report.errors.length===0&&report.badResponses.length===0&&report.glErrors.length===0&&report.render.error===0&&report.spawnTerrainVisible&&report.screens.every(s=>s.geometry?.width>0&&s.geometry?.height>0);
}catch(e){report.failure=String(e);report.passed=false;}finally{
 await writeFile(path.join(out,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report));
 if(ws?.readyState===1)ws.send(JSON.stringify({id:99999,method:'Browser.close'}));ws?.close();browser.kill();server.kill();await unlink(qa);
}
if(!report.passed)process.exitCode=1;
