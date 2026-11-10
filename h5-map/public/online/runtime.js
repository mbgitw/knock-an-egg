import {installOfflineDiagnostics} from './offline-diagnostics.js';
import {installAnimalHold} from './animal-hold.js';
import {installTrainingControl} from './training-control.js';
import {trainingFeedback} from './training-feedback.js';
import {installIndexClaim} from './index-claim.js';
import {chooseOfflinePreview} from '../draft-preview.js';
import {connectionDiagnostic} from './connection-diagnostic.js';
import {AppearanceSender} from './appearance-sender.js';
import * as THREE from 'three';
import {RemoteAvatars} from './avatars.js';
import {createPetModel,disposePetModel} from '../gameplay/pet-culling.js';
import {animalVisualScale} from '../gameplay/animal-attributes.js';
import {CONFIG} from '../gameplay/config.js';
import {inverseToolGrip} from '../gameplay/pickaxe-pose.js';
import {RemotePastures} from './pastures.js';
import {PastureLabels} from './pasture-labels.js';
import {insideZone} from '../gameplay/zone-entry-state.js';
import {TrailRibbon} from '../gameplay/trail-ribbon.js';
import {trailById} from '../gameplay/trail-state.js';
import {installRoomCommerce} from './commerce.js';
import {persistPreferences} from './preferences.js';
import {OP} from './protocol.js';
import {WeaponSwingPose} from '../gameplay/weapon-swing-pose.js';
import {heldPickaxePose} from '../gameplay/pickaxe-pose.js';
import {installReconnectNotice} from './reconnect-notice.js';

export function installOnline(game,connection){
  const {account,player,scene,camera,plots,pickaxes,weapons,treadmills,animals,guards,pasture,merge,backpack,indexUI,trails,inventoryUI}=game;
  const remote=new RemoteAvatars(scene,player.model,[...player.actions.values()].map(a=>a.getClip()));
  game.online=connection;connection.remote=remote;
  installRoomCommerce(game,connection);
  const remotePastures=new RemotePastures(game,connection);
  connection.remotePastures=remotePastures;
  game.canvas ??= document.querySelector('canvas');
  const pastureLabels=new PastureLabels(game,connection);connection.pastureLabels=pastureLabels;
  persistPreferences(account,game.canvas);
  game.canvas.dataset.onlineRoom=connection.session.room.roomId;game.canvas.dataset.onlineSelf=connection.self;game.canvas.dataset.onlineBase=account.data.baseId;
  const command=(action,value)=>connection.command(action,value);
  const feedback=trainingFeedback(account,(amount,mult)=>treadmills.showGain(amount,mult));
  const reset=player.motor.reset.bind(player.motor);player.motor.reset=()=>{reset();void command('respawn');};
  const originalTier=pickaxes.changeTier.bind(pickaxes),originalWeapon=weapons.equip.bind(weapons);
  const trainingControl=installTrainingControl(treadmills,connection);
  let ownLevel=account.data.level,loadingMachine=false,refreshing=false,localPickTier=account.data.pickaxes.equipped,localWeaponTier=account.data.weapons.equipped;
  const syncLocalEquipment=()=>{
    const tier=account.data.pickaxes.equipped,weapon=account.data.weapons.equipped;
    if(tier&&tier!==localPickTier&&!pickaxes.busy){pickaxes.busy=true;pickaxes.assets.create(tier).then(next=>{if(account.data.pickaxes.equipped!==tier){next.dispose();return;}inverseToolGrip(CONFIG.tiers[tier-1].grip).decompose(next.root.position,next.root.quaternion,next.root.scale);pickaxes.loaded?.dispose();pickaxes.loaded=next;pickaxes.mount.add(next.root);pickaxes.previousBox.makeEmpty();localPickTier=tier;}).catch(()=>{}).finally(()=>pickaxes.busy=false);}
    if(weapon&&weapon!==localWeaponTier&&!weapons.busy){weapons.busy=true;weapons.assets.create(weapon).then(next=>{if(account.data.weapons.equipped!==weapon){next.dispose();return;}weapons.loaded?.dispose();weapons.loaded=next;weapons.mount.add(next.root);localWeaponTier=weapon;}).catch(()=>{}).finally(()=>weapons.busy=false);}
  };
  const refresh=()=>{treadmills.refreshHUD();pickaxes.refresh();weapons.refresh();trails.syncEquipment();if(backpack.opened)backpack.render();game.shopUI?.refresh();pasture.offline?.update();if(inventoryUI.opened)inventoryUI.render(inventoryUI.read());};
  const applyAccount=data=>{
    const settings=account.data.settings,hotbar=account.data.pickaxes.hotbar;account.data=data.account;account.data.settings=settings;account.data.pickaxes.hotbar=hotbar;
    for(const pet of account.data.plot.pets){const motion=pasture.motions.get(pet.id);if(motion&&JSON.stringify(motion.pet.position)!==JSON.stringify(pet.position)){motion.center.fromArray(pet.position);motion.floor=pet.position[1];motion.target=null;motion.model.position.fromArray(pet.position);motion.pet=pet;}}
    if(!data.training&&(account.session||treadmills.lockedSession||player.training)){account.session=null;treadmills.lockedSession=null;player.releaseTraining(player.motor.position.clone(),false);}
    plots.applyNetwork(connection.players);refresh();
    if(ownLevel!==account.data.level&&!loadingMachine){loadingMachine=true;const level=account.data.level;treadmills.assets.instance(level,treadmills.ownMatrix).then(model=>{treadmills.own.dispose();treadmills.own=model;scene.add(model.root);ownLevel=level;}).finally(()=>loadingMachine=false);}
  };
  let roomEnded=false;
  installReconnectNotice(connection);
  connection.observe((type,data)=>{
    if(type==='account')applyAccount(data);
    if(type==='players'){remote.reconcile(data,connection.self);plots.applyNetwork(data);}
    if(type==='motion-reset')remote.resetMotion();
    if(type==='moves')remote.positions(data.players,performance.now(),data.time);
    if(type==='event'&&data.kind==='swing'){const actor=remote.actors.get(data.id);if(actor)actor.swingAt=performance.now();}
    if(type==='event'&&data.kind==='banked'&&data.pet)pickaxes.banked(data.pet);
    if(type==='eggs')pickaxes.eggs.applyNetwork(data);
    if(type==='guards')for(const frame of data.guards){const g=guards.guards.find(g=>g.definition.zone===frame.zone);if(g)g.networkTarget=frame;}
    if(type==='event'&&data.kind==='launch'){animals.cancel();treadmills.exit(false);player.keys.clear();player.touchMove.set(0,0);player.motor.launch(new THREE.Vector3().copy(data.velocity),data.fling);}
    if(type==='event'&&data.kind==='position'){player.applyNetworkPosition(new THREE.Vector3().copy(data.position),!!data.correction);player.actor.rotation.y=data.position.yaw;}
    if(type==='status'&&data.stage!=='room_connected'){trainingControl.interrupt();feedback.reset();player.keys.clear();player.touchMove.set(0,0);pickaxes.clock.cancel();animals.cancel();}
    if(type==='status'&&(data.stage==='idle'&&data.code!=='reconnect_timeout'||data.stage==='recovery_required'&&data.code==='BASELINE_TIMEOUT')&&!connection.session.exiting&&!roomEnded){roomEnded=true;player.inputLocked=true;pickaxes.externalModal=true;const diagnostic=connectionDiagnostic(connection,{code:connection.session.lastClose?.code||'ROOM_CLOSED'},0);diagnostic.room=connection.session.lastClose?.roomId||'';void chooseOfflinePreview(false,diagnostic,{cleanup:()=>connection.session.leave(),debug:game.diagnostics});}
  });
  remote.reconcile(connection.players,connection.self);plots.applyNetwork(connection.players);
  const self=connection.players.find(p=>p.id===connection.self);if(self){player.motor.teleport(new THREE.Vector3().copy(self.position));player.actor.rotation.y=self.position.yaw;}
  for(const frame of connection.eggs.values())pickaxes.eggs.applyNetwork(frame);
  for(const g of guards.guards)g.update=dt=>{const f=g.networkTarget;if(!f)return;g.position.lerp(new THREE.Vector3().copy(f.position),1-Math.exp(-dt*12));g.yaw+=Math.atan2(Math.sin(f.yaw-g.yaw),Math.cos(f.yaw-g.yaw))*(1-Math.exp(-dt*12));g.state=f.state;g.speed=f.speed;g.timer=f.timer;};
  // All rendering continues locally. Account growth and world decisions only advance in Room.
  account.advance=feedback.advance;pasture.economy.update=()=>{};pasture.economy.resume=()=>{};pasture.economy.stamp=()=>{};merge.state.finish=()=>[];
  pickaxes.changeTier=async(tier,buy=false)=>{if(refreshing||player.training||player.carryingAnimal)return false;refreshing=true;try{return !!await command(buy?'pickaxe-buy':'pickaxe-equip',tier);}finally{refreshing=false;}};
  const localPickEquip=pickaxes.progress.equip.bind(pickaxes.progress);pickaxes.progress.equip=tier=>{if(refreshing)return localPickEquip(tier);void command('pickaxe-equip',tier);return false;};
  weapons.equip=async tier=>!weapons.blocked&&!!await command('weapon-equip',tier);
  const localUnequip=weapons.unequip.bind(weapons);weapons.unequip=save=>{if(save===false)return localUnequip(false);void command('weapon-equip',null);};
  treadmills.purchase=async()=>{if(treadmills.busy||account.session||!treadmills.boardReachable())return false;return !!await command(account.data.unlocked?'treadmill-upgrade':'treadmill-unlock',account.data.level);};
  account.setSlow=value=>{void command('slow',value);};
  plots.purchase=async()=>!!await command('plot-upgrade',account.data.plot.level);
  trails.grid.onclick=async e=>{const b=e.target.closest('[data-trail-id]');if(!b)return;const id=Number(b.dataset.trailId);await command(b.dataset.action==='buy'?'trail-buy':'trail-equip',b.dataset.action==='buy'?id:trails.progress.data.equipped===id?null:id);trails.render();};
  pasture.place=async p=>{if(!pasture.canPlace(p))return false;const id=backpack.held;if(!await command('pasture-place',{id,position:p.toArray(),yaw:player.actor.rotation.y})){if(pasture.state.pets.length>=plots.capacity)pasture.showFullNotice();return false;}backpack.unequip();return true;};
  pasture.retrieve=async id=>!!await command('pasture-retrieve',id);
  pasture.equipBest=async()=>{if(!await command('pasture-best'))return false;backpack.unequip();return true;};
  merge.state.merge=async ids=>{const before=new Set(account.data.mergeEggs.map(e=>e.id));if(!await command('merge',ids))return null;return account.data.mergeEggs.find(e=>!before.has(e.id))||null;};
  merge.place=async p=>{if(merge.blocked||!merge.valid(p))return false;if(!await command('merge-place',{id:merge.held,position:p.toArray()}))return false;merge.clearHeld();backpack.render();return true;};
  merge.hatch=async id=>{if(!await command('merge-hatch',id))return false;merge.inventoryUI.close();merge.update();return true;};
  pickaxes.progress.sellMany=ids=>{void command('sell-many',ids);return {count:0,total:0n};};
  installIndexClaim(indexUI,account,command,pickaxes.bankFeedback);
  installOfflineDiagnostics(connection,pasture.offline,game.commerce);
  const combat=weapons.combat;
  combat.strike=()=>{void command('bat-hit');return true;};
  combat.applyHit=()=>false;combat.attackFrom=()=>false;
  const syncCombat=()=>{
    for(const id of combat.targets.keys())if(id!=='local'&&!remote.actors.has(id))combat.unregister(id);
    for(const [id,actor] of remote.actors)if(!combat.targets.has(id))combat.register({id,player:{actor:actor.root,motor:{position:actor.root.position,externalMotion:null}},isSafe:point=>{const b=plots.data.bases.find(b=>b.id===`Base_${actor.profile.slot+1}`),h=plots.data.tiers[actor.profile.plot-1].hitbox,m=new THREE.Matrix4().set(...b.transform).multiply(new THREE.Matrix4().set(...h.matrix));return insideZone({size:h.size,matrix:Array.from({length:16},(_,i)=>m.elements[(i%4)*4+Math.floor(i/4)])},point);}});
  };

  // Retain the existing carry controls and poses; replace only their state transitions.
  const pendingAnimals=new Set();
  pickaxes.eggs.canPresentAnimal=id=>connection.animals.has(id)&&!animals.views.has(id);
  installAnimalHold(animals,connection);
  animals.state.secure=()=>null;animals.drop=()=>{void command('animal-drop');return null;};
  pickaxes.eggs.onPresentationComplete=(pet,egg,reveal)=>{if(pet&&connection.animals.has(pet.id)&&!animals.views.has(pet.id))animals.add(pet,egg,reveal);else {reveal.root.removeFromParent();disposePetModel(reveal.root);}};
  pickaxes.eggs.onAnimalLanded=pickaxes.eggs.onPresentationComplete;
  const syncAnimals=()=>{
    const now=performance.now(),carried=[...connection.animals.values()].find(a=>a.carrier===connection.self);
    if(animals.state.carrying?.id!==(carried?.id||undefined)){animals.state.carrying=carried?animals.state.animals.get(carried.id)||null:null;animals.carryingChanged(animals.state.carrying);if(carried)animals.cancel();}
    for(const local of [...animals.state.animals.values()])if(!connection.animals.has(local.id)){if(animals.state.carrying?.id===local.id)animals.state.carrying=null;animals.remove(local);}
    for(const a of connection.animals.values()){
      const time=a.roomTime+now-a.receivedAt;if(time<a.readyAt)continue;
      const local=animals.state.animals.get(a.id),view=animals.views.get(a.id);
      if(!view&&!pendingAnimals.has(a.id)&&!pickaxes.eggs.hasAnimalPresentation(a.id)){pendingAnimals.add(a.id);pickaxes.eggs.petTemplate(a.pet.name,a.pet.variant).then(t=>createPetModel(t,a.pet.name)).then(root=>{
        if(!connection.animals.has(a.id)||animals.views.has(a.id)||pickaxes.eggs.hasAnimalPresentation(a.id)){disposePetModel(root);return;}
        root.scale.multiplyScalar(4/2.8*animalVisualScale(a.pet));root.position.copy(a.position);scene.add(root);animals.add(a.pet,null,{root,baseScale:root.scale.clone(),y:a.position.y});
      }).catch(()=>{}).finally(()=>pendingAnimals.delete(a.id));}
      if(local){local.lookRemaining=Math.max(0,((a.countdownAt??a.readyAt)-time)/1000);local.remaining=Math.max(0,(a.remaining-(a.carrier?0:Math.max(0,time-Math.max(a.roomTime,a.countdownAt??a.readyAt))))/1000);local.status=a.carrier?'carrying':'ground';local.position={...a.position};local.home={...a.home};
        if(view&&a.carrier!==connection.self){const other=remote.actors.get(a.carrier);view.root.position.copy(other?other.root.position.clone().add(new THREE.Vector3(0,5,.5)):a.position);}
      }
    }
  };
  const active=()=>{feedback.reset();const enabled=!(window.gameHostState?.paused||document.hidden)&&!game.commerce.busy;if(!enabled){trainingControl.interrupt();animals.cancel();connection.actions?.clear();}connection.session.setActive(enabled);};
  const onBusy=game.commerce.onBusy;game.commerce.onBusy=value=>{onBusy(value);active();};
  const syncEquipment=()=>{for(const actor of remote.actors.values()){
    if(!actor.root.visible){if(actor.gearRoot)actor.gearRoot.visible=false;if(actor.heldModel)actor.heldModel.visible=false;actor.ribbon?.clear();continue;}
    const p=actor.profile,key=p.weapon?`w${p.weapon}`:p.pickaxe?`p${p.pickaxe}`:'';
    const age=(performance.now()-(actor.swingAt||0))/1000;let orientation=null;
    if(p.weapon&&!p.training&&!p.holding){
      if(!actor.swingPose&&!actor.posePending){actor.posePending=true;WeaponSwingPose.create({actor:actor.root,model:actor.model}).then(pose=>actor.swingPose=pose).catch(()=>{}).finally(()=>actor.posePending=false);}
      if(actor.swingPose)orientation=actor.swingPose.apply(age<.63?age:null);
    }else if(p.pickaxe&&!p.training&&!p.holding){const arm=actor.model.getObjectByName('armR'),pose=heldPickaxePose(Math.min(1,age/.5),age<.5);if(arm){actor.savedArm=[arm,arm.quaternion.clone()];arm.parent.updateWorldMatrix(true,false);arm.quaternion.copy(arm.parent.getWorldQuaternion(new THREE.Quaternion()).invert().multiply(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0,1,0),pose.arm.applyQuaternion(actor.root.quaternion))));orientation=actor.root.quaternion.clone().multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1,0,0),pose.pitch));}}
    if(actor.gearKey!==key&&!actor.gearPending){actor.gearKey=key;actor.gear?.dispose();actor.gear=null;actor.gearRoot?.removeFromParent();actor.gearRoot=null;
      if(key){actor.gearPending=true;(p.weapon?weapons.assets.create(p.weapon):pickaxes.assets.create(p.pickaxe)).then(gear=>{
        if(!remote.actors.has(p.id)||actor.gearKey!==key){gear.dispose();return;}
        const item=p.weapon?weapons.assets.catalog.find(i=>i.tier===p.weapon):CONFIG.tiers[p.pickaxe-1];inverseToolGrip(item.grip).decompose(gear.root.position,gear.root.quaternion,gear.root.scale);
        const root=new THREE.Group();root.add(gear.root);scene.add(root);actor.gear=gear;actor.gearRoot=root;
      }).catch(()=>{actor.gearKey=null;}).finally(()=>actor.gearPending=false);}
    }
    if(actor.gearRoot){const hand=actor.model.getObjectByName('handR');actor.model.updateWorldMatrix(true,true);if(hand){hand.getWorldPosition(actor.gearRoot.position);hand.getWorldQuaternion(actor.gearRoot.quaternion);}if(orientation)actor.gearRoot.quaternion.copy(orientation);actor.gearRoot.visible=actor.root.visible&&!p.training;}
    const held=p.holding;
    if(actor.heldId!==(held?.id||null)&&!actor.heldPending){disposePetModel(actor.heldModel);actor.heldModel?.removeFromParent();actor.heldModel=null;actor.heldId=held?.id||null;
      if(held){actor.heldPending=true;(held.duration?Promise.resolve(merge.sprite(held)):pickaxes.eggs.petTemplate(held.name,held.variant).then(t=>createPetModel(t,held.name))).then(model=>{if(actor.heldId!==held.id||!remote.actors.has(p.id)){disposePetModel(model);return;}model.scale.multiplyScalar(held.duration?2.5:animalVisualScale(held));scene.add(model);actor.heldModel=model;}).catch(()=>{actor.heldId=null;}).finally(()=>actor.heldPending=false);}}
    if(actor.heldModel){actor.heldModel.position.copy(new THREE.Vector3(0,2.5,2).applyQuaternion(actor.root.quaternion).add(actor.root.position));actor.heldModel.quaternion.copy(actor.root.quaternion);actor.heldModel.visible=actor.root.visible&&!p.training;}
    if(actor.gearRoot&&held)actor.gearRoot.visible=false;
    actor.ribbon??=new TrailRibbon(scene,camera);if(actor.ribbon.id!==(p.trail||0))actor.ribbon.setTrail(trailById(p.trail));
    if(actor.root.visible)actor.ribbon.update(connection.frameDt,new THREE.Vector3(0,2.7,-.6).applyQuaternion(actor.root.quaternion).add(actor.root.position));else actor.ribbon.clear();
  }};
  addEventListener('game-host-pause',active);
  addEventListener('pagehide',()=>{trainingControl.interrupt();animals.cancel();connection.actions?.clear();connection.session.setActive(false);});
  addEventListener('pageshow',active);
  const appearanceSender=new AppearanceSender(error=>{game.canvas.dataset.onlineSendError=String(error.code||error.message||error);console.warn('Appearance synchronization deferred',error);});
  const phase=name=>{if(game.diagnostics)game.canvas.dataset.onlinePhase=name;};
  connection.update=dt=>{trainingControl.update();connection.frameDt=dt;game.canvas.dataset.onlineStage=connection.session.stage;game.canvas.dataset.onlinePlayers=String(connection.players.length);phase('local-equipment');syncLocalEquipment();phase('animals');syncAnimals();phase('avatars');remote.update(dt,performance.now(),camera);phase('combat');syncCombat();phase('pastures');remotePastures.update(dt);phase('equipment');syncEquipment();phase('motion-send');const p=player.motor.position;connection.session.update({x:p.x,y:p.y,z:p.z,yaw:player.actor.rotation.y,vx:player.motor.velocity.x,vy:player.motor.velocity.y,vz:player.motor.velocity.z,flags:(!player.motor.grounded?2:player.motor.velocity.lengthSq()>1?1:0)});
    appearanceSender.update(connection.session,player.equippedPet||null,pickaxes.clock.id+(weapons.swingCount||0),performance.now());
  };
  applyAccount({account:connection.account,training:connection.training});
  active();return connection;
}
