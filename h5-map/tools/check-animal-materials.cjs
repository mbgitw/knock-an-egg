// Isolated Chrome profile: the real player's browser save is never accessed.
const {chromium}=require('C:/Users/hortor/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const fs=require('node:fs');
const assert=require('node:assert/strict');
(async()=>{
 const browser=await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
 try{
  const page=await browser.newPage({viewport:{width:1280,height:800}}),errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  await page.goto('http://localhost:8765/');
  await page.waitForFunction(()=>!!window.game?.backpack,null,{timeout:90000});
  const result=await page.evaluate(async()=>{
   const g=window.game,THREE=await import('/vendor/three.module.js');
   const pet={id:'qa-material-chicken',name:'Chicken',zone:1,variant:'Normal'};
   g.pickaxes.progress.data.pets.push(pet);g.backpack.render();
   if(!await g.backpack.equip(pet.id))throw Error('Cannot equip QA chicken');
   g.player.update=()=>{};g.guards.update=()=>{};
   const p=g.player.actor.getWorldPosition(new THREE.Vector3());
   g.camera.position.copy(p).add(new THREE.Vector3(11,8,15));g.camera.lookAt(p.clone().add(new THREE.Vector3(0,2,0)));
   const samples={};
   for(const name of ['Chicken','Cat','CrystalDragon']){
    const model=await g.pickaxes.eggs.petTemplate(name);samples[name]=[];
    model.traverse(o=>{if(o.isMesh)for(const m of Array.isArray(o.material)?o.material:[o.material])samples[name].push({name:m.name,color:m.color.toArray(),textured:!!m.map});});
   }
   const held=[];g.backpack.model.traverse(o=>{if(o.isMesh)for(const m of Array.isArray(o.material)?o.material:[o.material])held.push(m.color.toArray());});
   return {samples,held,pet:g.backpack.held};
  });
  assert.equal(result.pet,'qa-material-chicken');assert.deepEqual(result.held,[[1,1,1]]);
  assert.ok(result.samples.CrystalDragon.some(m=>m.color.some(v=>v<.5)),'Authored solid colors must remain');
  await page.waitForFunction(()=>{let ready=true;game.backpack.model.traverse(o=>{if(o.isMesh)for(const m of Array.isArray(o.material)?o.material:[o.material])if(m.map&&!m.map.image?.complete)ready=false;});return ready;});
  await page.screenshot({path:'preview-animal-material-after.png'});
  await page.evaluate(()=>{game.backpack.model.traverse(o=>{if(o.isMesh)for(const m of Array.isArray(o.material)?o.material:[o.material])m.color.setRGB(...[.373615,.368591,.383775].map(v=>v**(1/2.2)),'srgb');});});
  await page.waitForTimeout(150);
  await page.screenshot({path:'preview-animal-material-before.png'});
  assert.deepEqual(errors,[]);
  fs.writeFileSync('../docs/validation/animal-research/material-browser-validation.json',JSON.stringify({...result,errors},null,2)+'\n');
  console.log(JSON.stringify({held:result.held,species:Object.keys(result.samples),errors}));
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
