import {browserTarget} from './browser-target.mjs';
import {compileBrowserTarget} from './compile-browser-target.mjs';
import {readdir,mkdir,copyFile,readFile,writeFile,rm} from 'node:fs/promises';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {OBJLoader} from 'three/examples/jsm/loaders/OBJLoader.js';
import {MTLLoader} from 'three/examples/jsm/loaders/MTLLoader.js';
const root=path.resolve(import.meta.dirname,'..'),source=path.join(root,'public'),target=path.join(root,'build/builda-draft');
if(target!==path.resolve(root,'build','builda-draft'))throw Error('Invalid build directory');
await rm(target,{recursive:true,force:true});
// 只复制运行资源。原始导出、独立检查页、Room源码均不进入客户端包。
async function copy(dir=''){
  await mkdir(path.join(target,dir),{recursive:true});
  for(const entry of await readdir(path.join(source,dir),{withFileTypes:true})){
    const rel=path.posix.join(dir,entry.name);
    if(rel.startsWith('audio/')||rel==='audio'||rel==='gameplay/settings-ui/9045766377.mp3')continue;
    if(/(^|\/)studio(\/|$)/.test(rel)||/\.(map|ts|py|md|ps1|zip|obj|mtl|meshbin)$/.test(rel)||/(^|\/)(\.env|AGENTS\.md)/.test(rel)||entry.name==='obj-parts.json'||/-test\.(html|js)$/.test(rel)||/\.html$/.test(rel)&&rel!=='index.html'||entry.name.startsWith('qa-'))continue;
    if(entry.name==='test-page.js'||/^model-check\/(?:.*viewer|entry|weapon-swing)\.js$/.test(rel))continue;
    if(entry.isDirectory())await copy(rel);else await copyFile(path.join(source,rel),path.join(target,rel));
  }
}
execFileSync(process.execPath,[path.join(root,'tools/prepare-builda-audio.mjs')],{cwd:root,stdio:'inherit'});
await copy();
await writeFile(path.join(target,'draft-preview-config.json'),JSON.stringify({enabled:!process.argv.includes('--release'),diagnostics:!process.argv.includes('--release')&&process.argv.includes('--diagnostics')}));
let converted=0;
for(const catalogPath of ['model-check/treadmills/catalog.json','model-check/animals/catalog.json','model-check/paid-animals/catalog.json']){
  const catalog=JSON.parse(await readFile(path.join(source,catalogPath),'utf8'));
  for(const item of catalog){
    if(!item.url?.endsWith('.obj')||!item.mtl)continue;
    const objPath=path.resolve(source,'model-check',item.url),mtlPath=path.resolve(source,'model-check',item.mtl);
    const group=new OBJLoader().parse(await readFile(objPath,'utf8')),infos=new MTLLoader().parse(await readFile(mtlPath,'utf8'),'').materialsInfo,materials={};
    const scenePath=objPath.slice(0,-4)+'.scene.json';
    group.traverse(o=>{if(!o.isMesh)return;for(const m of Array.isArray(o.material)?o.material:[o.material]){
      const info=infos[m.name]||{},textures={};
      for(const [from,to] of [['map_kd','map'],['map_ke','emissiveMap'],['map_bump','normalMap'],['bump','normalMap'],['norm','normalMap']])if(info[from])textures[to]=path.relative(path.dirname(scenePath),path.resolve(path.dirname(mtlPath),info[from])).replaceAll('\\','/');
      materials[m.name]={color:(info.kd||[1,1,1]).map(v=>Math.max(0,v)**(1/2.2)),textures};
    }});
    const out=path.join(target,path.relative(source,scenePath));await mkdir(path.dirname(out),{recursive:true});await writeFile(out,JSON.stringify({scene:group.toJSON(),materials},(key,value)=>key==='generator'?undefined:value));
    item.scene=item.url.slice(0,-4)+'.scene.json';delete item.url;delete item.mtl;item.format='three-scene-json';converted++;
  }
  await writeFile(path.join(target,catalogPath),JSON.stringify(catalog));
}
execFileSync(process.env.PYTHON||'python',[path.join(root,'tools/optimize-web-assets.py')],{cwd:root,stdio:'inherit'});
if(!process.argv.includes('--legacy-animals'))execFileSync(process.execPath,[path.join(root,'tools/prune-animal-legacy.mjs')],{cwd:root,stdio:'inherit'});
await compileBrowserTarget(target);
const manifestText=await readFile(path.join(root,'builda.publish.json'),'utf8');
const manifest=JSON.parse(manifestText);
Object.assign(manifest,{title:'Knock an Egg',tagline:'一起敲蛋、收藏动物并成长自己的牧场。',desc:'七人牧场联机开发草稿。',category:'leisure',orientation:'landscape',...browserTarget});
const nextManifest=JSON.stringify(manifest,null,2)+'\n';
if(nextManifest!==manifestText)await writeFile(path.join(root,'builda.publish.json'),nextManifest);
console.log(`客户端草稿目录：build/builda-draft，已转换${converted}个模型`);
