import {readFile,writeFile,readdir,unlink} from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
const root=path.resolve(import.meta.dirname,'..'),target=path.join(root,'build/builda-draft');
const catalog=JSON.parse(await readFile(path.join(target,'gameplay/animal-glb/catalog.json'),'utf8'));
if(Object.keys(catalog.entries).length!==92)throw Error('Incomplete compiled animal inventory');
const inputs=JSON.parse(await readFile(path.join(root,'tools/animal-build-inputs.json'),'utf8'));
if(!Object.keys(inputs).length)throw Error('Missing animal build input checks');
for(const [relative,expected] of Object.entries(inputs)){
  const absolute=path.resolve(root,relative);if(!absolute.startsWith(root+path.sep))throw Error('Unsafe source path');
  const actual=createHash('sha256').update(await readFile(absolute)).digest('hex');
  if(actual!==expected)throw Error(`Animal source changed: ${relative}; rebuild with node tools/build-animal-glbs.mjs after --legacy-animals build`);
}
const candidates=new Set(Object.values(catalog.entries).flatMap(entry=>entry.dependencies));
const usedTextures=new Set();
async function scan(dir){for(const item of await readdir(dir,{withFileTypes:true})){const absolute=path.join(dir,item.name);if(item.isDirectory())await scan(absolute);else if(item.name.endsWith('.scene.json')){
  const relative=path.relative(target,absolute).replaceAll('\\','/');if(candidates.has(relative))continue;
  const data=JSON.parse(await readFile(absolute,'utf8'));for(const material of Object.values(data.materials||{}))for(const file of Object.values(material.textures||{}))usedTextures.add(path.relative(target,path.resolve(path.dirname(absolute),file)).replaceAll('\\','/'));
}}}
await scan(path.join(target,'model-check'));
const removed=[];let bytes=0;
for(const relative of candidates){
  if(usedTextures.has(relative))continue;
  const absolute=path.resolve(target,relative);if(!absolute.startsWith(target+path.sep))throw Error('Unsafe animal dependency');
  const file=await readFile(absolute);bytes+=file.length;await unlink(absolute);removed.push(relative);
}
for(const file of ['animals','paid-animals']){
  const location=path.join(target,`model-check/${file}/catalog.json`),list=JSON.parse(await readFile(location,'utf8'));
  for(const entry of list){const compiled=catalog.entries[entry.name];if(!compiled)throw Error('Animal not compiled '+entry.name);delete entry.scene;delete entry.url;delete entry.mtl;entry.format='animal-glb';entry.glb='../gameplay/animal-glb/'+compiled.file;}
  await writeFile(location,JSON.stringify(list));
}
// Runtime needs only the lookup. Keep source hashes/dependency audit outside the bundle.
const entries=Object.fromEntries(Object.entries(catalog.entries).map(([name,entry])=>{const {dependencies,...runtime}=entry;return [name,runtime];}));
await writeFile(path.join(target,'gameplay/animal-glb/catalog.json'),JSON.stringify({version:catalog.version,entries}));
await writeFile(path.join(root,'build/animal-glb-pruning.json'),JSON.stringify({removed,bytes,retainedSharedTextures:[...usedTextures].filter(p=>candidates.has(p))},null,2));
console.log(`Compiled animals: removed ${removed.length} legacy files (${(bytes/1048576).toFixed(2)} MiB raw); shared textures retained`);
