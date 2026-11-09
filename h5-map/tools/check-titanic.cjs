const {chromium}=require('C:/Users/hortor/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const assert=require('node:assert/strict');
(async()=>{const browser=await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});try{
 const page=await browser.newPage({viewport:{width:1280,height:720}});const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto('http://localhost:8765/');await page.waitForFunction(()=>window.game?.pickaxes?.eggs?.titanic,null,{timeout:90000});
 await page.evaluate(()=>{game.player.update=()=>{};game.orbitCamera.update=()=>{};game.camera.position.set(10,20,0);game.camera.lookAt(-83,32.5,0);});
 await page.screenshot({path:'preview-titanic-board.png'});
 const spawned=await page.evaluate(()=>{const w=game.pickaxes.eggs,t=w.titanic,now=Date.now()/1000;t.nextAt=now-2;for(let i=0;i<50&&!t.eggs.length;i++){t.retryAt=0;t.update(now);}if(!t.eggs.length)throw Error('no room for event');const e=t.eggs[0];window.titanicTestEgg=e;game.camera.position.set(e.center.x+65,e.center.y+20,e.center.z+60);game.camera.lookAt(e.center);return {zone:e.spec.zone,height:e.spec.bodyHeight,ordinary:w.state.eggs.length};});
 console.log('spawn',spawned);assert.equal(spawned.ordinary,230);
 await page.waitForTimeout(1000);await page.screenshot({path:'preview-titanic-egg.png'});
 await page.reload();await page.waitForFunction(()=>window.game?.pickaxes?.eggs?.titanic,null,{timeout:90000});
 assert.equal(await page.evaluate(()=>game.pickaxes.eggs.titanic.eggs.length),1);
 await page.evaluate(()=>{window.titanicTestEgg=game.pickaxes.eggs.titanic.eggs[0];});
 const hit=await page.evaluate(()=>{const w=game.pickaxes.eggs,e=window.titanicTestEgg;const r=w.hit(e,'qa',e.spec.health);return {broken:r?.broken,pet:r?.pet};});assert.ok(hit.broken&&hit.pet);console.log('hit',hit);
 await page.waitForFunction(id=>game.animals.state.animals.has(id),hit.pet.id,{timeout:30000});
 const bank=await page.evaluate(id=>{const s=game.animals.state,a=s.animals.get(id);if(!s.begin(id,a.position))throw Error('pickup unavailable');s.advance(1.4,a.position,{held:true});return game.pickaxes.progress.bank(a.pet);},hit.pet.id);assert.ok(bank);
 await page.reload();await page.waitForFunction(()=>window.game?.pickaxes?.eggs?.titanic,null,{timeout:90000});
 assert.ok(await page.evaluate(id=>game.pickaxes.progress.data.pets.some(p=>p.id===id),hit.pet.id));assert.equal(await page.evaluate(()=>game.pickaxes.eggs.titanic.eggs.length),0);assert.deepEqual(errors,[]);console.log('PASS board/spawn/hatch/pickup/bank/reload; no page errors');
}finally{await browser.close();}})().catch(e=>{console.error(e);process.exitCode=1;});
