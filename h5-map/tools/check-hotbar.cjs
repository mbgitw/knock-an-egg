const {chromium}=require('C:/Users/hortor/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const path=require('path');
(async()=>{
 const browser=await chromium.launch({executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',headless:true,args:['--enable-webgl','--ignore-gpu-blocklist']});
 const page=await browser.newPage({viewport:{width:1920,height:1094}}),errors=[];
 page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error'&&!m.location().url.endsWith('/favicon.ico'))errors.push(m.text()+' '+m.location().url);});
 page.on('requestfailed',r=>console.log('FAILED',r.url(),r.failure()));
 await page.goto('http://localhost:8765/pickaxe-test.html');await page.waitForFunction(()=>!!window.game?.weapons,{timeout:60000});await page.evaluate(()=>document.fonts.ready);
 const images=await page.evaluate(async()=>{const {HOTBAR_TOOLS}=await import('./gameplay/hotbar-ui/tools.js');return Promise.all(HOTBAR_TOOLS.map(async t=>{const i=new Image();i.src='./gameplay/hotbar-ui/'+t.image;await i.decode();return [t.tier,i.naturalWidth,i.naturalHeight];}));});if(images.length!==20)throw Error('Missing tier art');
 await page.click('#qa-grip-crystal');await page.waitForFunction(()=>game.pickaxes.progress.data.equipped===11&&!game.pickaxes.busy);await page.locator('#qa').evaluate(e=>e.style.display='none');
 await page.screenshot({path:path.resolve('preview-hotbar.png')});
 console.log('initial',await page.locator('.pickaxe-hotbar').boundingBox(),await page.locator('#auto-pickaxe').boundingBox());
 await page.click('#auto-pickaxe');if(!await page.evaluate(()=>game.pickaxes.auto))throw Error('auto enable failed');
 await page.screenshot({path:path.resolve('preview-hotbar-on.png')});
 await page.keyboard.press('Digit2');await page.waitForFunction(()=>!!game.weapons.equipped&&!game.weapons.busy);
 if(await page.locator('#auto-pickaxe').isVisible())throw Error('auto visible with bat');
 if(await page.locator('#pickaxe-slot').getAttribute('aria-pressed')!=='false')throw Error('two selected tools');
 await page.keyboard.press('Digit2');await page.waitForFunction(()=>!game.weapons.equipped);if(await page.locator('#auto-pickaxe').isVisible())throw Error('auto visible while unarmed');
 await page.keyboard.press('Digit1');await page.waitForFunction(()=>!!game.pickaxes.progress.data.equipped&&!game.pickaxes.busy);
 await page.evaluate(()=>game.indexUI.open());await page.keyboard.press('Digit2');if(await page.evaluate(()=>!!game.weapons.equipped))throw Error('modal allows equip');await page.evaluate(()=>game.indexUI.close());
 await page.locator('#qa').evaluate(e=>e.style.display='flex');await page.click('#qa-egg');await page.locator('#qa').evaluate(e=>e.style.display='none');
 await page.click('#auto-pickaxe');await page.waitForFunction(()=>game.pickaxes.hitCount>0,{timeout:10000});
 await page.click('#auto-pickaxe');if(await page.evaluate(()=>game.pickaxes.auto))throw Error('auto disable failed');
 for(const size of [{width:1280,height:720},{width:390,height:844},{width:844,height:390}]){
  await page.setViewportSize(size);await page.screenshot({path:path.resolve(`preview-hotbar-${size.width}.png`)});
  const boxes=await Promise.all(['#auto-pickaxe','#pickaxe-slot','#weapon-slot'].map(s=>page.locator(s).boundingBox()));
  for(const b of boxes)if(!b||b.x<0||b.y<0||b.x+b.width>size.width||b.y+b.height>size.height)throw Error('HUD out of viewport '+JSON.stringify(boxes));
 }
 const touch=await browser.newContext({viewport:{width:844,height:390},isMobile:true,hasTouch:true,deviceScaleFactor:1}),mobile=await touch.newPage();
 await mobile.goto('http://localhost:8765/pickaxe-test.html');await mobile.waitForFunction(()=>!!window.game?.weapons,{timeout:60000});await mobile.locator('#qa').evaluate(e=>e.remove());
 await mobile.tap('#auto-pickaxe');if(!await mobile.evaluate(()=>game.pickaxes.auto))throw Error('Touch auto toggle failed');
 await mobile.tap('#weapon-slot');await mobile.waitForFunction(()=>!!game.weapons.equipped&&!game.weapons.busy);await mobile.tap('#pickaxe-slot');await mobile.waitForFunction(()=>!!game.pickaxes.progress.data.equipped&&!game.pickaxes.busy);
 await mobile.screenshot({path:path.resolve('preview-hotbar-touch.png')});
 await page.setViewportSize({width:1920,height:1094});await page.goto('http://localhost:8765/');await page.waitForFunction(()=>!!window.game?.weapons,{timeout:60000});await page.evaluate(()=>document.fonts.ready);await page.screenshot({path:path.resolve('preview-hotbar-game.png')});
 console.log(JSON.stringify({errors,images:images.length,checks:'toggle, two tool slots, hotkeys, unarmed visibility, modal lock, real egg hit, 4 viewport sizes, touch taps, production page'}));
 await browser.close();if(errors.length)process.exitCode=1;
})().catch(e=>{console.error(e);process.exit(1)});
