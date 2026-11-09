const {chromium}=require('C:/Users/hortor/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const assert=require('node:assert/strict');
(async()=>{
 const browser=await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
 try{
  const context=await browser.newContext({viewport:{width:1280,height:720}}),page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto('http://127.0.0.1:8765/');await page.waitForFunction(()=>window.game?.settingsUI,null,{timeout:90000});
  await page.click('#settings-button');assert.equal(await page.evaluate(()=>game.player.inputLocked),true);
  const root='/Settings/SettingsList/',path=p=>page.locator(`[data-source-path="${root+p}"]`);
  const music=path('MusicVolume/Container/DragBar/DragButton');await music.focus();await page.keyboard.press('Home');assert.equal(await page.evaluate(()=>game.settings.get('MusicVolume')),0);
  await page.keyboard.press('End');assert.equal(await page.evaluate(()=>game.music.audio.volume),.5);
  await page.waitForFunction(()=>game.music.audio.readyState>=2);assert.equal(await page.evaluate(()=>game.music.audio.paused),false);
  const bar=await path('SfxVolume/Container/DragBar').boundingBox();await page.mouse.move(bar.x+bar.width,bar.y+bar.height/2);await page.mouse.down();await page.mouse.move(bar.x+bar.width*.25,bar.y+bar.height/2,{steps:4});await page.mouse.up();assert.ok(Math.abs(await page.evaluate(()=>game.settings.get('SfxVolume'))-.25)<.01);
  for(const key of ['ViewOthersPets','ViewMyPets','ViewMyEggs','ScreenFFX']){await path(key+'/Container/Toggle').click();assert.equal(await page.evaluate(k=>game.settings.get(k),key),false);}
  await page.screenshot({path:'preview-settings-off.png'});
  await page.keyboard.press('Escape');assert.equal(await page.evaluate(()=>game.player.inputLocked),false);
  await page.reload();await page.waitForFunction(()=>window.game?.settingsUI,null,{timeout:90000});
  assert.deepEqual(await page.evaluate(()=>Object.values(game.account.data.settings).slice(2)),[false,false,false,false]);assert.ok(Math.abs(await page.evaluate(()=>game.settings.get('SfxVolume'))-.25)<.01);
  await page.evaluate(()=>{
   const d=game.account.data,h=game.plots.tier.hitbox.matrix,pos=[h[3],1.27,h[11]];
   d.plot.pets=[{id:'zone1-egg-1:0',name:'Cat',zone:1,weightKg:10,position:pos,yaw:0}];
   d.growingEggs=[{id:'merge:settingsqa',name:'Cat',zone:1,weightKg:30,sizeMult:1,duration:10,position:[pos[0]+8,pos[1],pos[2]],readyAt:Date.now()+1000}];
   game.account.save();game.pasture.update(0);game.merge.update();
  });
  await page.waitForFunction(()=>game.pasture.models.size===1);await page.waitForTimeout(100);
  assert.deepEqual(await page.evaluate(()=>[[...game.pasture.models.values()][0].visible,[...game.pasture.labels.values()][0].sprite.visible,[...game.merge.models.values()][0].sprite.visible,[...game.merge.models.values()][0].label.hidden]),[false,false,false,true]);
  const cash=await page.evaluate(()=>String(game.account.data.cash));await page.evaluate(()=>{for(let i=0;i<40;i++)game.pasture.economy.update(.05);});assert.ok(BigInt(await page.evaluate(()=>String(game.account.data.cash)))>BigInt(cash));
  await page.waitForTimeout(1100);assert.equal(await page.evaluate(()=>game.merge.state.hatch('merge:settingsqa')),true);
  await page.evaluate(()=>{game.account.data.growingEggs[0].hatchingAt=Date.now()-7000;game.merge.update();});assert.equal(await page.evaluate(()=>game.account.data.pickaxes.pets.filter(p=>p.id==='merge:settingsqa').length),1);
  await page.evaluate(()=>{game.settings.set('ViewMyPets',true);game.pasture.update(0);});assert.equal(await page.evaluate(()=>[...game.pasture.models.values()][0].visible),true);
  const ffx=await page.evaluate(()=>{const f=game.pickaxes.bankFeedback;f.stop();f.show([{name:'Cat'}]);return [f.flash.hidden,f.cards.length];});assert.deepEqual(ffx,[true,1]);
  await page.evaluate(()=>{game.settings.set('ScreenFFX',true);game.pickaxes.bankFeedback.show([{name:'Cat'}]);});assert.equal(await page.evaluate(()=>game.pickaxes.bankFeedback.flash.hidden),false);
  await page.evaluate(()=>{game.settings.set('ScreenFFX',false);game.pickaxes.bankFeedback.update(0);});assert.equal(await page.evaluate(()=>game.pickaxes.bankFeedback.flash.hidden),true);
  // Decode the three recovered originals, including the two MPEG payloads.
  const tracks=await page.evaluate(async()=>{const a=new AudioContext();return Promise.all(game.music.tracks.map(async([file])=>{const data=await(await fetch('./gameplay/settings-ui/'+file)).arrayBuffer();return (await a.decodeAudioData(data)).duration;}));});assert.ok(tracks.every(n=>n>30));
  for(const [width,height] of [[1280,720],[390,844],[844,390]]){
   await page.setViewportSize({width,height});await page.click('#settings-button');
   const close=page.getByRole('button',{name:'Close Settings'}),rect=await close.boundingBox();assert.ok(rect.x>=0&&rect.y>=0&&rect.x+rect.width<=width&&rect.y+rect.height<=height);
   await path('ScreenFFX/Container/Toggle').scrollIntoViewIfNeeded();await path('ScreenFFX/Container/Toggle').click();await close.click();assert.equal(await page.evaluate(()=>game.player.inputLocked),false);
   await page.evaluate(()=>game.indexUI.open());await page.click('#settings-button');assert.deepEqual(await page.evaluate(()=>[game.indexUI.opened,game.settingsUI.opened]),[false,true]);await page.keyboard.press('Escape');
  }
  await page.setViewportSize({width:390,height:844});await page.click('#settings-button');await page.screenshot({path:'preview-settings-mobile.png'});
  const touchContext=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true});const touch=await touchContext.newPage();touch.on('pageerror',e=>errors.push(e.message));await touch.goto('http://127.0.0.1:8765/');await touch.waitForFunction(()=>window.game?.settingsUI,null,{timeout:90000});await touch.locator('#settings-button').tap();
  const touchBar=await touch.locator('[data-source-path="/Settings/SettingsList/MusicVolume/Container/DragBar"]').boundingBox();await touch.touchscreen.tap(touchBar.x+touchBar.width*.5,touchBar.y+touchBar.height/2);assert.ok(Math.abs(await touch.evaluate(()=>game.settings.get('MusicVolume'))-.5)<.02);await touch.getByRole('switch',{name:'View my Pets',exact:true}).tap();assert.equal(await touch.evaluate(()=>game.settings.get('ViewMyPets')),false);await touch.getByRole('button',{name:'Close Settings'}).tap();assert.equal(await touch.evaluate(()=>game.player.inputLocked),false);
  assert.deepEqual(errors,[]);console.log('PASS: original audio decodes/plays; pointer+keyboard sliders; 4 toggles; refresh; hidden models/labels; income/hatching unaffected; screen flash cancellation; modal exclusion; desktop/portrait/landscape. No JS errors.');
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exit(1);});

