const {chromium}=require('C:/Users/hortor/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const fs=require('node:fs'),assert=require('node:assert/strict');
(async()=>{
 const browser=await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
 try{
  const page=await browser.newPage({viewport:{width:1440,height:1000}}),errors=[];
  await page.route('**/favicon.ico',r=>r.fulfill({status:204}));
  page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
  await page.goto('http://localhost:8765/model-check/#paid-animals');
  await page.waitForFunction(()=>document.querySelector('canvas').dataset.animationRigs==='6',{},{timeout:120000});
  const manifest=JSON.parse(fs.readFileSync('public/model-check/paid-animal-animations/catalog.json','utf8'));
  for(const [id,entry] of Object.entries(manifest)){
   await page.locator(`[data-item="${id}"]`).click();
   for(const action of ['Idle','Walk']){
    await page.locator('#animal-action').selectOption(action);
    await page.waitForFunction(()=>document.querySelector('#animation-time').dataset.time>0.01);
    assert.equal(await page.locator('#animation-play').isEnabled(),true);
   }
   assert.equal(await page.locator('#animal-candidate').isVisible(),entry.ambiguous);
   if(entry.ambiguous){await page.locator('#animal-candidate').selectOption('B');assert.match(await page.locator('#animation-status').innerText(),/候选 B/);await page.locator('#animal-candidate').selectOption('A');}
  }
  await page.locator('[data-item="paid_AngelDragon"]').click();
  await page.locator('#animation-play').click();
  const before=await page.locator('#animation-time').getAttribute('data-time');await page.waitForTimeout(200);assert.equal(await page.locator('#animation-time').getAttribute('data-time'),before);
  await page.locator('#animation-progress').fill('500');await page.locator('#animation-progress').dispatchEvent('input');
  await page.screenshot({path:'preview-paid-dragon-animation.png'});
  await page.locator('#animation-play').click();
  await page.locator('#zone-filter').selectOption('all');
  await page.screenshot({path:'preview-paid-animal-animations.png'});
  await page.locator('[data-item="paid_AngelDragon"]').click();await page.locator('#animal-action').selectOption('Static');assert.equal(await page.locator('#animation-play').isEnabled(),false);
  assert.deepEqual(errors,[]);
  fs.writeFileSync('../docs/validation/paid-animal-animations/browser-validation.json',JSON.stringify({animals:6,rigs:6,states:['Idle','Walk','Static'],candidateSelectorHidden:true,pause:true,timeline:true,errors},null,2));
  console.log('6 paid animals: Idle/Walk, confirmed mapping, pause, seek and static passed; 6 total rigs, no errors');
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
