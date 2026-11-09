import {readdir,readFile,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {transform} from 'esbuild';
import postcss from 'postcss';
import {esTargets} from './browser-target.mjs';

export function compatibleCss(text) {
  const root=postcss.parse(text);
  root.walkDecls(decl=>{
    if(decl.prop==='inset'){
      const v=postcss.list.space(decl.value),s=[v[0],v[1]||v[0],v[2]||v[0],v[3]||v[1]||v[0]];
      ['top','right','bottom','left'].forEach((prop,i)=>decl.cloneBefore({prop,value:s[i]}));
    }
    if(decl.prop==='container-type')decl.cloneBefore({prop:'--compat-container',value:decl.value});
    if(/^(backdrop-filter|mask(?:-.+)?)$/.test(decl.prop))decl.cloneBefore({prop:'-webkit-'+decl.prop});
    if(/\b(?:\d*\.)?\d+(?:dvh|cqw|cqh)\b/.test(decl.value)){
      const value=decl.value.replace(/(\d*\.?\d+)(dvh|cqw|cqh)\b/g,(_,n,unit)=>`calc(var(--compat-${unit}, 1${unit==='cqw'?'vw':'vh'}) * ${n})`);
      // Custom properties accept unknown units at parse time: retaining the modern
      // declaration would invalidate their consumers on old engines.
      if(decl.prop.startsWith('--'))decl.value=value;else decl.cloneBefore({value});
    }
  });
  return root.toString();
}
export async function compileBrowserTarget(folder){
  let js=0,css=0;
  async function visit(dir){
    for(const item of await readdir(dir,{withFileTypes:true})){
      const file=path.join(dir,item.name);if(item.isDirectory()){await visit(file);continue;}
      if(file.endsWith('.css')){await writeFile(file,compatibleCss(await readFile(file,'utf8')));css++;}
      if(!file.endsWith('.js')||item.name==='builda-sdk.js')continue;
      let source=await readFile(file,'utf8');
      let relative=path.relative(path.dirname(file),path.join(folder,'vendor/three.module.js')).replaceAll('\\','/');if(!relative.startsWith('.'))relative='./'+relative;
      source=source.replace(/(\bfrom\s*|\bimport\s*\(\s*|\bimport\s*)(['"])three\2/g,(_,prefix,quote)=>prefix+quote+relative+quote);
      const output=await transform(source,{target:esTargets,loader:'js',sourcefile:file,legalComments:'inline'});
      await writeFile(file,output.code);js++;
    }
  }
  await visit(folder);
  const html=path.join(folder,'index.html');
  await writeFile(html,(await readFile(html,'utf8')).replace(/<script\s+type="importmap">[\s\S]*?<\/script>/g,''));
  console.log(`Browser target ${esTargets.join(' / ')}: ${js} JS, ${css} CSS; native relative ESM (no import map).`);
}
if(process.argv[1]&&path.resolve(process.argv[1])===path.resolve(import.meta.filename))await compileBrowserTarget(path.resolve(process.argv[2]||'build/builda-draft'));
