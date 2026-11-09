import {ChaseFeedback} from './gameplay/chase-feedback.js';
import {installRenderCompatibility} from './render-compat.js';
import {gameAudio} from './gameplay/game-audio.js';
import {installGameAudio} from './gameplay/game-audio-bindings.js';
gameAudio.install();
import {draftPreviewEnabled,draftDiagnosticsEnabled,chooseOfflinePreview,addReconnectOption} from './draft-preview.js';
import {installRuntimeDiagnostic} from './runtime-diagnostic.js';
import {setLanguage,installDomLocalization} from './i18n.js';
import {FreeGift} from './gameplay/free-gift.js';
import {Leaderboards} from './gameplay/leaderboards.js';
import {plotSpawn} from './online/plot-spawn.js';
import {CloudSave} from './gameplay/commerce/cloud-save.js';
import {freezeStaticMatrices} from './static-blocks.js';
import {FrameMetrics} from './frame-metrics.js';
import {createMissingPlotBoards} from './gameplay/plot-board-models.js';
import {GameConnection} from './online/game-connection.js';
import {installOnline} from './online/runtime.js';
import {SAVE_KEY} from './treadmill-state.js';
import {installCommerce} from './gameplay/commerce/runtime.js';
import {SettingsState} from './gameplay/settings-state.js';
import {configureSettingsAudio} from './gameplay/settings-audio.js';
import {SettingsUI} from './gameplay/settings-ui.js';
import {SettingsMusic} from './gameplay/settings-music.js';
import {MergeSystem} from './gameplay/merge-system.js';
import {PastureSystem} from './gameplay/pasture-system.js';
import {isRemovedMapPart} from './map-cleanup.js';
import * as THREE from 'three';
import {createEnvironment} from './environment.js';
import {ZoneEntrySystem} from './gameplay/zone-entry.js';
import { OrbitControls } from './vendor/OrbitControls.js';
import { GLTFLoader } from './vendor/GLTFLoader.js';
import { buildCollisionWorld,combineCollisionWorlds } from './world-physics.js';
import { PlayerController } from './character-controller.js';
import { TreadmillSystem } from './treadmill-system.js';
import {WeaponSystem} from './gameplay/weapon-system.js';
import {WeaponCombat} from './gameplay/weapon-combat.js';
import { PickaxeSystem } from './gameplay/pickaxe-system.js';
import { GameIndexUI } from './gameplay/index-ui.js';
import {BackpackUI} from './gameplay/backpack-ui.js';
import { GameInventoryUI } from './gameplay/inventory-ui.js';
import { GameGcoinShopUI } from './gameplay/gcoin-shop-ui.js';
import {isOriginalEggPart} from './gameplay/egg-world.js';
import {GuardSystem,isOriginalGuardPart} from './gameplay/guard-system.js';
import {AnimalCarrySystem} from './gameplay/animal-carry-system.js';
import {TrailSystem} from './gameplay/trail-system.js';
import {TRAIL_BOOTH_PATH,createTrailBooth,createTrailRoof,trailBoothCollisionParts,createTrailSign} from './gameplay/trail-booth.js';
import {PlotSystem,isPlotBuild} from './gameplay/plot-system.js';
import {BOOTH_PATH,loadBoothData,boothCollisionParts,createBoothRoof,createBoothModel,createBoothSign,BoothTrigger} from './gameplay/shop-booth.js';

const canvas = document.querySelector('canvas');
async function loadingStage(stage){
  canvas.dataset.loadingStage=stage;
  window.gameLoading?.stage(stage);
  window.gameHealth?.stage(stage);
  // Allow the stage label to paint before synchronous scene construction.
  await new Promise(resolve=>setTimeout(resolve,0));
}
addEventListener('error',event=>{canvas.dataset.runtimeError=event.message;});
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
installRenderCompatibility(renderer);
const frameMetrics=new FrameMetrics(renderer);
renderer.setPixelRatio(Math.min(devicePixelRatio, 1.8));
renderer.setSize(innerWidth, innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
const scene = new THREE.Scene();
scene.background = new THREE.Color('#bed5e4');
const camera = new THREE.PerspectiveCamera(55, innerWidth / innerHeight, .12, 10000);
// OrbitControls owns a separate camera, so wall avoidance never overwrites zoom.
const orbitCamera = camera.clone();
const controls = new OrbitControls(orbitCamera, canvas);
controls.enableDamping = true;
controls.dampingFactor = .08;
let settings;
let settingsUI;
const music=new SettingsMusic();
let pasture;
let merge;
let environment;
let player;
let worldModel;
let treadmills;
let pickaxes;
let weapons;
let indexUI;
let inventoryUI;
let backpack;
let shopUI;
let trails;
let plots;
let guards;
let zoneEntry;
let animals;
let online;
let offlinePreview=false;
let diagnostics=false,playerFrames=0;
async function start() {
  diagnostics=await draftDiagnosticsEnabled();
  setLanguage('auto');installDomLocalization();
  await loadingStage('environment');
  environment=await createEnvironment(renderer,scene);
  await loadingStage('map-data');
  const response = await fetch('map.json');
  if (!response.ok) throw new Error('Map load failed');
  const data = await response.json();
  data.parts = data.parts.filter(part => !part.editorDeleted && !isRemovedMapPart(part.path));
  const modelUrl = data.objExport?.url;
  if (!modelUrl) throw new Error('No exported map found');
  await loadingStage('map-model');
  const [map,boothData,trailBoothData,plotLayout] = await Promise.all([new GLTFLoader().loadAsync(modelUrl,event=>window.gameLoading?.mapProgress(event)),loadBoothData(),fetch('gameplay/trails/booth/model.json').then(r=>{if(!r.ok)throw Error('鎷栧熬鎽婁綅璧勬簮鍔犺浇澶辫触');return r.json();}),fetch('gameplay/plot-upgrades/tiers.json').then(r=>{if(!r.ok)throw Error('鐗у満甯冨眬鍔犺浇澶辫触');return r.json();})]);
  await loadingStage('world');
  worldModel = map.scene;
  scene.add(worldModel);
  freezeStaticMatrices(worldModel);
  const missingBoards=createMissingPlotBoards(data.parts,plotLayout.bases);scene.add(missingBoards.root);data.parts=data.parts.filter(p=>!/^\/Workspace\/Plots\/[^/]+\/(UpgradeBoard|TreadmillBoard)\//.test(p.path));
  const booth=createBoothModel(boothData);scene.add(booth);const boothSign=await createBoothSign(boothData);booth.add(boothSign);
  const trailBooth=createTrailBooth(trailBoothData);scene.add(trailBooth);const trailSign=await createTrailSign();trailBooth.add(trailSign);
  const staticParts=[...data.parts.filter(part => !isOriginalEggPart(part.path)&&!isOriginalGuardPart(part.path)&&!/^\/Workspace\/Plots\/[^/]+\/[^/]*Treadmill\//.test(part.path)&&!part.path.startsWith(BOOTH_PATH)&&!part.path.startsWith(TRAIL_BOOTH_PATH)&&!isPlotBuild(part.path)),...boothCollisionParts(boothData.parts),...trailBoothCollisionParts(trailBoothData.parts)];
  const roofs=new THREE.Group();roofs.add(createBoothRoof(boothData.parts),createTrailRoof(trailBoothData.parts));
  const staticWorld=buildCollisionWorld(staticParts,roofs);
  const prepareCollision=parts=>combineCollisionWorlds(staticWorld,missingBoards.collision,buildCollisionWorld(parts));
  let collisionWorld = prepareCollision([]);
  await loadingStage('player');
  player = await PlayerController.create(scene, camera, controls, collisionWorld, canvas);
  const testPage = ['/placement-test.html','/mobile-controls-test.html','/animal-carry-test.html','/treadmill-test.html','/pickaxe-test.html','/plot-test.html','/trails-test.html','/guards-test.html','/eggs-test.html','/egg-presentation-test.html','/weapons-test.html','/lighting-test.html','/zone-entry-test.html'].includes(location.pathname);
  const onlinePage=!testPage&&!location.pathname.endsWith('-test.html');
  let baseTransform;
  if(onlinePage){
    await loadingStage('connecting');
    try{online=await GameConnection.open();window.gameHealth?.bind(online);baseTransform=plotLayout.bases.find(b=>b.id===online.account.baseId)?.transform;player.motor.spawn.copy(plotSpawn(baseTransform));}
    catch(error){window.gameHealth?.error('connect_error',error);console.warn('Online startup failed',error.diagnostic?.code||'ONLINE_FAILED');await chooseOfflinePreview(await draftPreviewEnabled(),error.diagnostic,{cleanup:error.retryCleanup,debug:await draftDiagnosticsEnabled()});offlinePreview=true;canvas.dataset.playMode='draft-offline';const own=plotLayout.bases.find(b=>b.id===plotLayout.baseId);player.motor.spawn.copy(plotSpawn(own.transform));player.motor.teleport(player.motor.spawn);}
  }
  await loadingStage('treadmills');
  missingBoards.setOwner(online?.account.baseId||plotLayout.baseId);
  const cloudStorage=!onlinePage&&!testPage&&location.pathname!=='/pasture-test.html'&&window.Builda?.privateKV?await CloudSave.open(window.Builda):null;
  // The loopback mock has its own storage. Seed it once from the existing preview save.
  if(cloudStorage&&cloudStorage.text===null&&['localhost','127.0.0.1'].includes(location.hostname)&&location.port==='8765'){
    const previous=localStorage.getItem(SAVE_KEY);
    if(previous){
      let valid=false;
      try{valid=JSON.parse(previous)?.version===1;}
      catch{console.warn('Local preview save is invalid and was not imported');}
      if(valid){cloudStorage.setItem(SAVE_KEY,previous);await cloudStorage.flush();}
    }
  }
  treadmills = await TreadmillSystem.create(scene, player, camera, canvas, online?{storage:null,online,baseTransform}:location.pathname==='/pasture-test.html'?{storage:{getItem:k=>localStorage.getItem('qa-pasture:'+k),setItem:(k,v)=>localStorage.setItem('qa-pasture:'+k,v)}}:(testPage||offlinePreview) ? { storage: null } : cloudStorage?{storage:cloudStorage}:{});
  settings=new SettingsState(treadmills.account);setLanguage(settings.get('Language'));configureSettingsAudio(settings);music.setState(settings);
  addEventListener('pagehide',()=>settings.flush());window.addEventListener('game-host-pause',()=>{if((window.gameHostState?.paused||document.hidden))settings.flush();});
  await loadingStage('plots');
  plots=await PlotSystem.create(scene,player,camera,canvas,treadmills.account,{prepareCollision,commitCollision:world=>{
    collisionWorld=world;player.world=player.motor.world=world;
    if(window.game)window.game.collisionWorld=world;
  },onPurchase:()=>{treadmills.tone('purchase');treadmills.refreshHUD();}});
  await loadingStage('pickaxes');
  if(location.pathname !== '/treadmill-test.html')pickaxes = await PickaxeSystem.create(scene, player, camera, canvas, treadmills.account,{mapParts:data.parts});
  if(pickaxes){pickaxes.boothTrigger=new BoothTrigger(boothData.parts.find(p=>p.name==='HitZone'));pickaxes.booth=booth;pickaxes.boothSign=boothSign;}
  await loadingStage('weapons');
  if(pickaxes)weapons=await WeaponSystem.create({scene,player,camera,canvas,account:treadmills.account,pickaxes});
  if(pickaxes)backpack=new BackpackUI({pickaxes,weapons,player,scene,canvas});
  if(pickaxes)indexUI=new GameIndexUI({account:treadmills.account,player,canvas,pickaxes});
  if(pickaxes)inventoryUI=new GameInventoryUI({account:treadmills.account,player,canvas,pickaxes});
  if(pickaxes)shopUI=await GameGcoinShopUI.create({account:treadmills.account,player,canvas,pickaxes});
  if(pickaxes)trails=new TrailSystem({scene,player,camera,canvas,account:treadmills.account,pickaxes,treadmills,boothData:trailBoothData,booth:trailBooth,sign:trailSign});
  await loadingStage('guards');
  guards=await GuardSystem.create({scene,player,account:treadmills.account,plots,canvas});
  zoneEntry=await ZoneEntrySystem.create({player,guards});
  if(pickaxes)animals=new AnimalCarrySystem({scene,player,camera,canvas,pickaxes,guards,config:zoneEntry.config});
  if(weapons)weapons.combat=new WeaponCombat({weapons,player,animals,guards,plots});
  if(backpack)pasture=new PastureSystem({scene,player,camera,canvas,account:treadmills.account,plots,backpack,pickaxes,inventoryUI});
  if(pasture)merge=await MergeSystem.create({scene,player,camera,canvas,account:treadmills.account,plots,backpack,pickaxes,inventoryUI,pasture});
  if(pickaxes){settingsUI=await SettingsUI.create({state:settings,player,pickaxes,canvas});pickaxes.bankFeedback.screenEffects=settings.get('ScreenFFX');settings.observe((key,value)=>{if(key==='ScreenFFX')pickaxes.bankFeedback.screenEffects=value;});}
  window.game = { canvas, offlinePreview, plotBoards:missingBoards, settings, settingsUI, music, merge, pasture, scene, camera, orbitCamera, renderer, controls, environment, player, collisionWorld, treadmills, plots, pickaxes, weapons, indexUI, inventoryUI, backpack, shopUI, trails, guards, zoneEntry, animals, account: treadmills.account };
  window.game.performance=frameMetrics;
  if(pickaxes)installCommerce(window.game);
  if(offlinePreview){window.game.commerce.sdk=null;addReconnectOption(settingsUI);}
  if(online)installOnline(window.game,online);
  installGameAudio(window.game);
  window.game.chaseFeedback=new ChaseFeedback(window.game);
  window.game.leaderboards=new Leaderboards(window.game,data.parts,offlinePreview?null:window.Builda);
  if(pickaxes&&!offlinePreview)window.game.freeGift=await FreeGift.create(window.game);
  window.dispatchEvent(new Event('game-ui-ready'));
  // Compile offscreen map/egg/guard materials under the final fixed light set
  // while the loading screen is still up, not on the first run into a zone.
  await environment.prepare(camera);
  await loadingStage('ready');
  canvas.dataset.ready = 'true';
  window.gameHealth?.ready();
  if(diagnostics){window.game.diagnostics=true;installRuntimeDiagnostic(window.game);}
  window.gameLoading?.finish();
  document.getElementById('loading')?.remove();
}
addEventListener('resize', () => {
  renderer.setSize(innerWidth, innerHeight);
  environment?.resize();
  camera.aspect = orbitCamera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix(); orbitCamera.updateProjectionMatrix();
});
let last = performance.now();
renderer.setAnimationLoop(now => {
  try {
  frameMetrics.begin();
  const dt = Math.min((now - last) / 1000, .05); last = now;
  window.gameHealth?.phase('gate');
  if(diagnostics)canvas.dataset.framePhase='gate';
  if (canvas.dataset.ready==='true' && player && (!online||online.session.ready) && !(window.gameHostState?.paused||document.hidden) && !window.gameHostState?.paused&&!window.game?.commerce?.busy) { window.gameHealth?.phase('online');if(diagnostics)canvas.dataset.framePhase='online';online?.update(dt);window.gameHealth?.phase('begin');if(diagnostics)canvas.dataset.framePhase='begin';animals?.beginFrame(); backpack?.beginFrame(); weapons?.beginFrame();window.gameHealth?.phase('player');if(diagnostics)canvas.dataset.framePhase='player'; player.update(dt);window.gameHealth?.phase('gameplay');if(diagnostics){canvas.dataset.playerFrames=String(++playerFrames);canvas.dataset.framePhase='gameplay';} animals?.update(dt); treadmills?.update(dt); plots?.update(dt); pickaxes?.update(dt); weapons?.update(dt); backpack?.update(dt); pasture?.update(dt); merge?.update(dt); indexUI?.update(dt); inventoryUI?.update(dt); shopUI?.update(dt); trails?.update(dt); guards?.update(dt); zoneEntry?.update(); online?.pastureLabels.update();window.game?.leaderboards?.update();window.game?.freeGift?.update(); }
  window.game?.chaseFeedback?.update();
  window.gameHealth?.phase('render');
  if(environment)environment.render(camera);else renderer.render(scene,camera);
  window.gameHealth?.frame(renderer);
  frameMetrics.end();
  } catch (error) { window.gameHealth?.error('frame_error', error); throw error; }
});
start().catch(error => {
  console.error(error);
  window.gameHealth?.error('startup_error',error);
  canvas.dataset.error = error.message;
  if(window.gameLoading)window.gameLoading.fail();
  else {const loading=document.getElementById('loading');if(loading)loading.textContent=error.message;}
});
