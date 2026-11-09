// Isolated visual fixture; no production ad or account is simulated by game code.
const {chromium}=require('C:/Users/hortor/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const fs=require('node:fs');
(async()=>{
 const browser=await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
 try{
 const page=await browser.newPage({viewport:{width:1280,height:720}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.route('**/free-gift-qa.html',r=>r.fulfill({contentType:'text/html',body:`<!doctype html><html><head><link rel="stylesheet" href="/gameplay/gcoin-shop.css"><style>body{margin:0;overflow:hidden}</style><script type="importmap">{"imports":{"three":"/vendor/three.module.js"}}</script></head><body><script type="module">
 import * as THREE from 'three';import {FreeGift} from '/gameplay/free-gift.js';import {GLTFLoader} from '/vendor/GLTFLoader.js';
 const scene=new THREE.Scene(),camera=new THREE.PerspectiveCamera(53,innerWidth/innerHeight,.1,1000),renderer=new THREE.WebGLRenderer({antialias:true});renderer.setSize(innerWidth,innerHeight);renderer.setClearColor(0x85caff);document.body.append(renderer.domElement);camera.position.set(-52,11,-72);camera.lookAt(-73,4,-74);camera.updateMatrixWorld();scene.add(new THREE.HemisphereLight(0xffffff,0x889988,2));const sun=new THREE.DirectionalLight(0xffffff,2);sun.position.set(0,100,-30);scene.add(sun);scene.add((await new GLTFLoader().loadAsync('/obj-map/world.glb')).scene);
 const game={scene,camera,account:{data:{freeGift:{claimed:false}}},player:{motor:{position:new THREE.Vector3(0,0,0)},controls:{enabled:true},keys:new Set(),touchMove:new THREE.Vector2()},pickaxes:{close(){},clock:{cancel(){}},refresh(){},bankFeedback:{showRewards(){}}}};window.gift=await FreeGift.create(game);renderer.setAnimationLoop(()=>{gift.update();renderer.render(scene,camera)});
 </script></body></html>`}));
 await page.goto('http://localhost:8765/free-gift-qa.html');await page.waitForFunction(()=>!!window.gift,null,{timeout:90000});await page.waitForTimeout(1000);
 fs.mkdirSync('../docs/validation/free-gift',{recursive:true});await page.screenshot({path:'../docs/validation/free-gift/model.png'});
 await page.evaluate(()=>gift.open());await page.waitForTimeout(500);await page.screenshot({path:'../docs/validation/free-gift/desktop.png'});
 await page.evaluate(()=>gift.redeem());if(!await page.locator('.gift-message').textContent().then(s=>s.includes('Builda')))throw Error('Missing host must not reward');
 await page.setViewportSize({width:844,height:390});await page.waitForTimeout(300);await page.screenshot({path:'../docs/validation/free-gift/mobile.png'});
 console.log(JSON.stringify({errors,hostFailure:await page.locator('.gift-message').textContent()}));if(errors.length)throw Error(errors.join('\n'));
 }finally{await browser.close();}
})();
