const {chromium}=require('C:/Users/hortor/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const assert=require('node:assert/strict');
const fs=require('node:fs');
(async()=>{
 const browser=await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
 try{
  const page=await browser.newPage({viewport:{width:1440,height:1000}}),errors=[];
  await page.route('**/favicon.ico',route=>route.fulfill({status:204}));
  page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
  await page.goto('http://localhost:8765/model-check/#paid-animals');
  await page.waitForFunction(()=>document.querySelector('#count').textContent==='6 / 6');
  const names=['AngelAnky','AngelTrike','AngelMegalodon','AngelTRex','AngelDragon','AngelHydra'];
  for(const name of names){await page.locator(`[data-item="paid_${name}"]`).click();await page.waitForFunction(name=>document.querySelector('#info h3').textContent===name,name);assert.ok(!(await page.locator('#info').innerText()).includes('加载失败'));}
  await page.locator('#all').click();await page.screenshot({path:'preview-paid-animals.png'});
  const runtime=await browser.newPage();
  await runtime.route('**/paid-model-runtime-check.html',route=>route.fulfill({contentType:'text/html',body:'<script type="importmap">{"imports":{"three":"/vendor/three.module.js"}}</script>'}));
  await runtime.goto('http://localhost:8765/paid-model-runtime-check.html');
  const loaded=await runtime.evaluate(async names=>{
   const {EggWorld}=await import('/gameplay/egg-world-runtime.js');
   const loader={petCache:new Map(),petTemplate:EggWorld.prototype.petTemplate};
   const result={};for(const name of [...names,'Chicken']){const root=await loader.petTemplate(name);let parts=0;root.traverse(o=>{if(o.isMesh)parts++;});result[name]=parts;}return result;
  },names);
  assert.deepEqual(Object.values(loaded),[3,3,4,3,5,6,1]);
  assert.deepEqual(errors,[]);
  fs.writeFileSync('../docs/validation/paid-animal-cache/browser-validation.json',JSON.stringify({names,loaded:6,runtimeParts:loaded,errors},null,2));
  console.log('6/6 paid models loaded and selected; no browser errors');
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
