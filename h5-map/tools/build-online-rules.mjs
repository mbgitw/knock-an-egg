// 从现有纯规则生成Room依赖，避免前后端另写一份价格/成长公式。
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import path from 'node:path';
const root=path.resolve(import.meta.dirname,'..'),seen=new Set();
async function copy(relative){
  if(seen.has(relative))return;seen.add(relative);
  let source=await readFile(path.join(root,'public',relative),'utf8');
  if(relative==='gameplay/guard-brain.js')source=source.replace("import * as THREE from 'three';",'');
  const dependencies=[...source.matchAll(/from\s*['"]([^'"]+)['"]/g)].map(m=>m[1]);
  for(const d of dependencies){if(!d.startsWith('.'))throw Error(`非纯规则依赖 ${relative}: ${d}`);await copy(path.posix.normalize(path.posix.join(path.posix.dirname(relative),d)));}
  source=source.replace(/from\s*(['"])([^'"]+)\.js\1/g,'from $1$2.ts$1').replace(/Math\.random/g,'roomRandomRequired').replace(/Date\.now\(\)/g,'roomTimeRequired()');
  if(relative==='gameplay/guard-brain.js')source="import * as THREE from '../../math.ts';\n"+source;
  // GuardNavigation's shared work budget is set by Room updateGuards for each callback.
  const helpers='\nfunction roomRandomRequired():number{throw Error("Room必须注入可恢复随机源");}\nfunction roomTimeRequired():number{throw Error("Room必须注入可信时间");}\n';
  const destination=path.join(root,'server/game/rules',relative.replace(/\.js$/,'.ts'));await mkdir(path.dirname(destination),{recursive:true});
  await writeFile(destination,'// @ts-nocheck\n// Generated from public/'+relative+'; run node tools/build-online-rules.mjs.\n'+source+helpers);
}
for(const p of ['treadmill-state.js','gameplay/egg-spawn-state.js','gameplay/animal-carry-state.js','gameplay/pasture-state.js','gameplay/merge-state.js','gameplay/weapon-combat-state.js','gameplay/titanic-state.js','gameplay/plot-state.js','gameplay/guard-brain.js','gameplay/guard-navigation.js','gameplay/guard-planner.js','online/protocol.js','online/plot-spawn.js'])await copy(p);
console.log(`Room规则生成：${seen.size}个模块`);
for(const [name,file] of [['navigation','gameplay/guards/navigation.json'],['zones','gameplay/zone-entry/config.json'],['weapons','gameplay/weapons.json'],['guards','gameplay/guards/catalog.json'],['plots','gameplay/plot-upgrades/tiers.json'],['treadmills','treadmill-runtime.json']]){
  let data=JSON.parse(await readFile(path.join(root,'public',file),'utf8'));
  if(name==='plots')data={bases:data.bases,board:data.board,hitboxes:data.tiers.map(t=>t.hitbox),floors:data.tiers.map(t=>Math.max(...t.parts.filter(p=>p.name==='Grass'&&p.collide).map(p=>p.matrix[7]+p.size[1]/2)))};
  await mkdir(path.join(root,'server/game/data'),{recursive:true});await writeFile(path.join(root,`server/game/data/${name}.ts`),'// Generated from public/'+file+'\nexport default '+JSON.stringify(data)+';\n');
}
const {bakeProjectGuardRouting}=await import('./bake-guard-routing.mjs');await bakeProjectGuardRouting();
