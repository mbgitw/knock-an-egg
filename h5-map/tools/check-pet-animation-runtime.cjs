const {chromium}=require('C:/Users/hortor/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const assert=require('node:assert/strict');
(async()=>{
 const browser=await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true,args:['--use-angle=swiftshader']});
 try{
  const page=await browser.newPage({viewport:{width:1400,height:900}}),errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/pet-animation-runtime-check.html',r=>r.fulfill({contentType:'text/html',body:'<style>body{margin:0}</style><script type="importmap">{"imports":{"three":"/vendor/three.module.js"}}</script>'}));
  await page.goto('http://localhost:8765/pet-animation-runtime-check.html');console.log('Runtime page loaded');
  const result=await page.evaluate(async()=>{
   const THREE=await import('/vendor/three.module.js');
   const {EggWorld}=await import('/gameplay/egg-world-runtime.js');
   const {createPetModel,updatePetAnimation,disposePetModel}=await import('/gameplay/pet-animation.js');
   const {pastureModel}=await import('/gameplay/pasture-motion.js');
   const loader={petCache:new Map(),petTemplate:EggWorld.prototype.petTemplate};
   const manifests=await Promise.all(['planet-x-animations','paid-animal-animations'].map(p=>fetch('/model-check/'+p+'/catalog.json').then(r=>r.json())));
   const scene=new THREE.Scene();scene.background=new THREE.Color('#151e2b');scene.add(new THREE.HemisphereLight(0xffffff,0x777777,3));const sun=new THREE.DirectionalLight(0xffffff,3);sun.position.set(10,20,-10);scene.add(sun);
   const renderer=new THREE.WebGLRenderer({antialias:true});renderer.setSize(1400,900);document.body.append(renderer.domElement);
   const camera=new THREE.PerspectiveCamera(45,1400/900,.1,500);camera.position.set(26,32,-43);camera.lookAt(0,0,0);
   const rows=[];
   for(const entry of manifests.flatMap(m=>Object.values(m))){
    const template=await loader.petTemplate(entry.name),held=await createPetModel(template,entry.name),placed=await pastureModel(template,entry.name);
    if(!held.userData.rig||!placed.userData.rig)throw Error('Missing rig '+entry.name);
    if(held.userData.rig.skeleton===placed.userData.rig.skeleton)throw Error('Shared skeleton');
    for(const state of ['Idle','Walk']){updatePetAnimation(held,.3,state);if(!(held.userData.rig.actions.get(state).time>0))throw Error('No action '+state);}
    disposePetModel(held);
    placed.position.set((rows.length%6-2.5)*7,0,(Math.floor(rows.length/6)-1)*10);scene.add(placed);
    updatePetAnimation(placed,.4,'Walk');rows.push({name:entry.name,meshes:placed.userData.rig.meshes.length,facing:placed.children[0].rotation.y});
   }
   scene.updateMatrixWorld(true);renderer.render(scene,camera);return rows;
  });
  assert.equal(result.length,18);assert.equal(result.find(x=>x.name==='AngelTRex').facing,Math.PI);assert.deepEqual(errors,[]);
  await page.screenshot({path:'preview-game-pet-animations.png'});
  require('node:fs').writeFileSync('../docs/validation/paid-animal-animations/game-runtime-validation.json',JSON.stringify({pets:result,errors},null,2));
  console.log('18 game pets: real templates, independent rigs, Idle/Walk, facing, disposal and render passed');
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
