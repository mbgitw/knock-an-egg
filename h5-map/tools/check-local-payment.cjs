const {chromium}=require('C:/Users/hortor/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const assert=require('node:assert/strict');

(async()=>{
  const browser=await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
  try{
    const context=await browser.newContext({viewport:{width:1500,height:1000}});
    await context.addInitScript(()=>{
      if(!sessionStorage.getItem('local-payment-qa-seeded')){
        localStorage.setItem('knock-egg:treadmill:v1',JSON.stringify({version:1,cash:4321,power:10}));
        sessionStorage.setItem('local-payment-qa-seeded','1');
      }
    });
    const page=await context.newPage(),errors=[];
    page.on('pageerror',e=>errors.push(e.message));
    const response=await page.goto(`http://127.0.0.1:8765/?builda_mock_player=local-payment-qa-${Date.now()}`);
    assert.equal(response.status(),200);
    try{await page.waitForFunction(()=>window.game?.commerce,null,{timeout:60000});}
    catch(e){console.error('startup diagnostics',await page.evaluate(()=>({stage:document.querySelector('canvas')?.dataset.loadingStage,builda:!!window.Builda,text:document.body.innerText.slice(0,500)})),errors);throw e;}
    assert.equal(await page.evaluate(()=>game.commerce.available),true);
    assert.equal(await page.evaluate(()=>game.account.data.cash),4321);
    assert.equal(await page.evaluate(()=>localStorage.getItem('knock-egg:treadmill:v1')!==null),true);
    await page.evaluate(()=>game.shopUI.openSection('CashPacks'));
    const buy=()=>page.locator('[data-pay-id="3714065877"]').first().click();
    await buy();
    await page.getByRole('button',{name:'失败',exact:true}).click();
    await page.waitForFunction(()=>!game.commerce.busy);
    assert.equal(await page.evaluate(()=>game.account.data.cash),4321);
    await buy();
    await page.getByRole('button',{name:'成功',exact:true}).click();
    await page.waitForFunction(()=>!game.commerce.busy);
    assert.equal(await page.evaluate(()=>game.account.data.cash),104321);
    await page.reload();
    await page.waitForFunction(()=>window.game?.commerce,null,{timeout:60000});
    assert.equal(await page.evaluate(()=>game.account.data.cash),104321);
    assert.deepEqual(errors,[]);
    console.log('Local preview: legacy save, mock failure, mock success, reload restoration passed');
  }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
