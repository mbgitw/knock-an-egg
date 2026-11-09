const {chromium}=require('C:/Users/hortor/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const assert=require('node:assert/strict');
(async()=>{
 const browser=await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
 try{
  const page=await browser.newPage({viewport:{width:1280,height:720}});
  page.on('pageerror',e=>console.error('PAGE',e.message));
  page.on('console',m=>{if(m.type()==='error'&&!m.location().url.endsWith('/favicon.ico'))console.error('CONSOLE',m.text(),m.location().url);});
  // Fresh browser context: temporary test account, never the user's saved browser profile.
  await page.goto('http://localhost:8765/');
  await page.waitForFunction(()=>!!window.game?.indexUI&&!!window.game?.weapons,null,{timeout:60000});
  await page.evaluate(()=>{game.account.data.index={...(game.account.data.index||{}),discovered:['Cat','Anteater'],claimed:[]};});
  await page.click('#index-button');
  await page.waitForFunction(()=>getComputedStyle(document.querySelector('.original-index')).opacity==='1');
  const point=await page.evaluate(()=>{
   const auto=document.querySelector('#auto-pickaxe').getBoundingClientRect(),claim=document.querySelector('.index-claim-all').getBoundingClientRect();
   const left=Math.max(auto.left,claim.left),right=Math.min(auto.right,claim.right),top=Math.max(auto.top,claim.top),bottom=Math.min(auto.bottom,claim.bottom);
   if(right<=left||bottom<=top)throw Error('Expected screenshot overlap is missing: '+JSON.stringify({auto:auto.toJSON(),claim:claim.toJSON()}));
   const x=(left+right)/2,y=(top+bottom)/2;
   window.claimClickCount=0;document.querySelector('.index-claim-all').addEventListener('click',()=>window.claimClickCount++);
   return {x,y,target:document.elementFromPoint(x,y)?.closest('button')?.className,autoPointerEvents:getComputedStyle(document.querySelector('#auto-pickaxe')).pointerEvents};
  });
  console.log('overlap',point);
  assert.match(point.target,/index-claim-all/,'Auto Swing must not cover the Index claim button');
  assert.equal(point.autoPointerEvents,'none','Disabled Auto Swing must not intercept pointer events');
  await page.mouse.click(point.x,point.y);
  assert.equal(await page.evaluate(()=>window.claimClickCount),1,'A real pointer click must reach the overlapping claim button');
  assert.equal(await page.evaluate(()=>game.pickaxes.auto),false);
  await page.click('.index-close');
  await page.click('#auto-pickaxe');assert.equal(await page.evaluate(()=>game.pickaxes.auto),true,'Auto Swing must work after closing Index');
  await page.click('#index-button');
  await page.locator('.original-index').evaluate(async e=>{await Promise.all(e.getAnimations().map(a=>a.finished));});
  await page.screenshot({path:'preview-hotbar-overlap-fixed.png'});
  await page.click('.index-close');
  await page.evaluate(()=>game.pickaxes.open('shop'));
  assert.equal(await page.locator('#auto-pickaxe').evaluate(e=>getComputedStyle(e).pointerEvents),'none');
  await page.click('#pickaxe-close');await page.click('#auto-pickaxe');assert.equal(await page.evaluate(()=>game.pickaxes.auto),true);
  console.log('PASS: overlapping Index claim receives actual click; Auto Swing resumes after Index and shop close.');
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
