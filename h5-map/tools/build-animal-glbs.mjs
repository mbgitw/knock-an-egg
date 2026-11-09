import {spawn,execFileSync} from 'node:child_process';
import {mkdir,readFile,writeFile,copyFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import path from 'node:path';
const root=path.resolve(import.meta.dirname,'..'),work=path.join(root,'build/animal-glb-batch'),target=path.join(root,'public/gameplay/animal-glb');
await mkdir(work,{recursive:true});await mkdir(target,{recursive:true});
await writeFile(path.join(work,'index.html'),`<!doctype html><meta charset="utf-8"><script type="importmap">{"imports":{"three":"/public/vendor/three.module.js"}}</script><script type="module">import * as batch from '/tools/build-animal-glbs-browser.js';window.batch=batch;</script>`);
const pause=ms=>new Promise(r=>setTimeout(r,ms));
const server=spawn('python',['-m','http.server','8771','--bind','127.0.0.1','--directory',root],{windowsHide:true,stdio:'ignore'});
const browser=spawn('C:/Program Files/Google/Chrome/Application/chrome.exe',['--headless','--no-first-run','--use-angle=swiftshader','--enable-unsafe-swiftshader','--remote-debugging-port=9236',`--user-data-dir=${process.env.TEMP}/animal-batch-${Date.now()}`,'about:blank'],{windowsHide:true,stdio:'ignore'});
let ws;
try{
  let tab;for(let i=0;i<80;i++){try{tab=(await(await fetch('http://127.0.0.1:9236/json')).json()).find(t=>t.type==='page');if(tab)break;}catch{}await pause(250);}
  if(!tab)throw Error('Chrome unavailable');ws=new WebSocket(tab.webSocketDebuggerUrl);await new Promise(r=>ws.addEventListener('open',r,{once:true}));
  let id=0;const pending=new Map();ws.addEventListener('message',event=>{const data=JSON.parse(event.data);if(data.id){pending.get(data.id)?.(data);pending.delete(data.id);}});
  const send=(method,params={})=>new Promise((resolve,reject)=>{const key=++id;pending.set(key,data=>data.error?reject(Error(JSON.stringify(data.error))):resolve(data.result));ws.send(JSON.stringify({id:key,method,params}));});
  const evaluate=async expression=>{const result=await send('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});if(result.exceptionDetails)throw Error(result.exceptionDetails.exception?.description||result.exceptionDetails.text);return result.result.value;};
  await send('Page.enable');await send('Page.navigate',{url:'http://127.0.0.1:8771/build/animal-glb-batch/index.html'});await pause(1000);
  for(let i=0;i<40&&!await evaluate('!!window.batch');i++)await pause(250);
  const entries=await evaluate('window.batch.describe()');if(entries.length!==92)throw Error('Unexpected animal inventory '+entries.length);
  const sourceFiles=new Map(),records=[];
  const sourceCatalog=(await Promise.all(['animals','paid-animals'].map(folder=>readFile(path.join(root,'public/model-check',folder,'catalog.json'),'utf8').then(JSON.parse)))).flat();
  const recordSource=async relative=>{if(sourceFiles.has(relative))return;sourceFiles.set(relative,createHash('sha256').update(await readFile(path.join(root,relative))).digest('hex'));};
  for(const relative of ['tools/build-animal-glbs-browser.js','tools/optimize-study-glb.py','tools/optimize-web-assets.py',
    'public/gameplay/pet-animation.js','public/gameplay/animal-glb-runtime.js','public/scene-resource.js','public/model-check/animal-animation-player.js','public/model-check/multi-mesh-animal.js',
    ...['animals','paid-animals','animal-animations','planet-x-animations','paid-animal-animations'].map(folder=>`public/model-check/${folder}/catalog.json`)])await recordSource(relative);
  for(const [index,entry] of entries.entries()){
    const result=await evaluate(`window.batch.compile(${JSON.stringify(entry.name)})`);
    await writeFile(path.join(work,entry.id+'.glb'),Buffer.from(result.glb,'base64'));
    const original=sourceCatalog.find(e=>e.name===entry.name);
    for(const file of [original.url,original.mtl])await recordSource(path.posix.normalize('public/model-check/'+file));
    for(const dependency of entry.dependencies){if(dependency.endsWith('.scene.json'))continue;let source='public/'+dependency;if(source.endsWith('.webp')){try{await readFile(path.join(root,source));}catch{source=source.slice(0,-5)+'.png';}}await recordSource(source);}
    records.push({...entry,bones:result.bones,staticMeshes:result.staticMeshes,animatedMeshes:result.animatedMeshes});
    if(index%8===0||index===entries.length-1)console.log(`Exported ${index+1}/${entries.length}: ${entry.name}`);
  }
  await writeFile(path.join(work,'records.json'),JSON.stringify(records,null,2));
  execFileSync('python',[path.join(root,'tools/optimize-study-glb.py'),'--directory',work],{cwd:root,stdio:'inherit'});
  const validations=[],catalog={version:1,entries:{}};
  for(const [index,entry] of records.entries()){
    const file=entry.id+'.glb';await copyFile(path.join(work,entry.id+'-optimized.glb'),path.join(target,file));
    const validation=await evaluate(`window.batch.validate(${JSON.stringify(entry.name)},${JSON.stringify('/public/gameplay/animal-glb/'+file)})`);
    validations.push(validation);
    catalog.entries[entry.name]={id:entry.id,file,ordinary:entry.ordinary,facingYaw:entry.model.facingYaw||0,dependencies:entry.dependencies,bones:entry.bones,staticMeshes:entry.staticMeshes,animatedMeshes:entry.animatedMeshes};
    if(index%8===0||index===records.length-1)console.log(`Validated ${index+1}/${records.length}: ${entry.name}`);
  }
  await writeFile(path.join(work,'validation.json'),JSON.stringify({validations},null,2));
  await writeFile(path.join(target,'catalog.json'),JSON.stringify(catalog));
  await writeFile(path.join(root,'tools/animal-build-inputs.json'),JSON.stringify(Object.fromEntries(sourceFiles)));
  console.log('Compiled animal catalog ready: '+Object.keys(catalog.entries).length);
}finally{ws?.close();server.kill();browser.kill();}
