const {chromium}=require('C:/Users/hortor/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const assert=require('node:assert/strict');
(async()=>{
 const browser=await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
 try{
  const page=await browser.newPage({viewport:{width:1280,height:720}});
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto('http://localhost:8765/pickaxe-test.html');
  await page.waitForFunction(()=>!!window.game?.trails&&!!window.game?.commerce||document.querySelector('canvas')?.dataset.error,null,{timeout:90000}).catch(async error=>{console.log('startup',await page.locator('canvas').evaluate(e=>({...e.dataset})),errors);throw error;});
  assert.deepEqual(errors,[]);console.log('ready');
  await page.evaluate(()=>{
   game.account.data.cash=44150;game.account.data.pickaxes.owned=[1,3];game.account.data.pickaxes.equipped=3;
   game.pickaxes.open('shop');
  });
  async function clickAcrossRefresh(selector,system){
   const button=page.locator(selector);await button.scrollIntoViewIfNeeded();
   await page.locator(system==='pickaxes'?'.pickaxe-panel':'.trail-panel').evaluate(async e=>{await Promise.all(e.getAnimations().map(a=>a.finished));});
   await page.evaluate(({selector,system})=>{
    window.testPressed=document.querySelector(selector);
    window.testPressed.addEventListener('pointerdown',()=>{
     // Deterministic reproduction: passive income lands between press and release.
     game.account.creditCash(1);system==='pickaxes'?game.pickaxes.refresh():game.trails.render();
    },{once:true});
   },{selector,system});
   await button.click({delay:120});
   console.log(system,await page.evaluate(()=>({buttonSurvived:window.testPressed.isConnected,cash:game.account.data.cash,pickaxes:game.account.data.pickaxes.owned,trails:game.account.data.trails.owned})));
  }
  await clickAcrossRefresh('[data-tier="4"]','pickaxes');
  await page.waitForFunction(()=>!game.pickaxes.busy);
  assert.equal(await page.evaluate(()=>game.pickaxes.progress.data.equipped),4,'Gold pickaxe click must survive an income refresh');
  assert.equal(await page.evaluate(()=>game.account.data.cash),24151);
  await page.screenshot({path:'preview-pickaxe-click-fixed.png'});
  await clickAcrossRefresh('[data-tier="3"]','pickaxes');
  await page.waitForFunction(()=>!game.pickaxes.busy);
  assert.equal(await page.evaluate(()=>game.pickaxes.progress.data.equipped),3);
  // Force a different card to become affordable while the owned button is held.
  await page.evaluate(()=>{game.account.data.cash=159999;game.pickaxes.refresh();});
  await clickAcrossRefresh('[data-tier="4"]','pickaxes');
  await page.waitForFunction(()=>!game.pickaxes.busy);
  assert.equal(await page.evaluate(()=>game.pickaxes.progress.data.equipped),4);
  assert.equal(await page.evaluate(()=>game.account.data.cash),160000);
  // Exercise reopening after another panel replaced the shared grid.
  await page.evaluate(()=>{game.pickaxes.open('pets');game.pickaxes.open('shop');});
  assert.equal(await page.locator('#pickaxe-grid [data-tier="4"]').textContent(),'Equipped');
  await page.evaluate(()=>{game.account.data.cash=1000000;game.account.data.trails.owned=[];game.account.data.trails.equipped=null;game.trails.open();clearTimeout(game.trails.scrollTimer);});
  const trail=await page.evaluate(async()=>{const {TRAILS}=await import('/gameplay/trail-state.js');return TRAILS[0];});
  await clickAcrossRefresh(`[data-trail-id="${trail.id}"]`,'trails');
  assert.equal(await page.evaluate(()=>game.trails.progress.data.equipped),trail.id,'Trail purchase click must survive an income refresh');
  assert.equal(await page.evaluate(()=>Number(game.account.data.cash)),1000001-Number(trail.price));
  await clickAcrossRefresh(`[data-trail-id="${trail.id}"]`,'trails');
  assert.equal(await page.evaluate(()=>game.trails.progress.data.equipped),0);
  await clickAcrossRefresh(`[data-trail-id="${trail.id}"]`,'trails');
  assert.equal(await page.evaluate(()=>game.trails.progress.data.equipped),trail.id);
  assert.deepEqual(errors,[]);
  await page.screenshot({path:'preview-shop-click-fixed.png'});
  console.log('PASS: both shops accept actual pointer clicks during income refresh; purchase/equip/unequip and exact debit verified.');
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
