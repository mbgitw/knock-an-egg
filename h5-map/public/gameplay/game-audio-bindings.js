import {gameAudio} from './game-audio.js';

// Preserve each method's sync/async return contract and only sound successful actions.
export function afterSuccess(target,key,callback){
  if(!target||typeof target[key]!=='function')return;
  const original=target[key];target[key]=function(...args){
    const result=original.apply(this,args);
    const finish=value=>{if(value)callback(value,args);return value;};
    return result?.then?result.then(finish):finish(result);
  };
}

export function installGameAudio(game){
  const {player,pickaxes,weapons,treadmills,animals,guards,pasture,merge,plots,online}=game;
  game.audio=gameAudio;
  afterSuccess(weapons,'swing',()=>gameAudio.play('swing'));
  if(animals){const changed=animals.carryingChanged;animals.carryingChanged=function(a){changed.call(this,a);if(a)gameAudio.play('pickup');};}
  const bank=pickaxes?.bankFeedback;
  if(bank){const show=bank.show;bank.show=function(pets,options){show.call(this,pets,options);if(pets?.length)gameAudio.play(options?.rewards?'reward':'secure');};bank.playSound=null;}
  if(online){
    const cues={'pickaxe-buy':'purchase','trail-buy':'purchase','treadmill-unlock':'purchase','treadmill-upgrade':'upgrade','plot-upgrade':'upgrade','pasture-place':'drop','pasture-best':'drop','pasture-retrieve':'pickup','animal-drop':'drop','merge-place':'drop','sell-many':'offline','offline-claim':'offline','gift-claim':'reward','bat-hit':'impact'};
    const command=online.command;
    online.command=async function(action,value){const result=await command.call(this,action,value);if(result&&cues[action])gameAudio.play(cues[action]);return result;};
    online.observe((type,data)=>{if(type==='event'&&data.kind==='launch')gameAudio.play('hurt');});
  }else{
    for(const [target,key,cue] of [[treadmills,'purchase','upgrade'],[plots,'purchase','upgrade'],[pasture,'place','drop'],[pasture,'retrieve','pickup'],[pasture,'equipBest','drop'],[merge,'place','drop'],[animals,'drop','drop'],[weapons?.combat,'applyHit','hurt'],[pasture?.economy,'claim','offline']])afterSuccess(target,key,()=>gameAudio.play(cue));
    if(guards){const caught=guards.onCaught;guards.onCaught=function(event){caught?.call(this,event);gameAudio.play('hurt');};}
  }
  // Only this player's real ground movement; no footsteps during training/knockback.
  const update=player.update;let step=0;
  player.update=function(dt){const grounded=this.motor.grounded;update.call(this,dt);
    if(this.training||this.inputLocked||this.motor.externalMotion){step=0;return;}
    if(grounded&&!this.motor.grounded&&this.motor.velocity.y>0)gameAudio.play('jump');
    if(this.motor.grounded&&Math.hypot(this.motor.velocity.x,this.motor.velocity.z)>1){step+=dt;if(step>=.326){step=0;gameAudio.play('step');}}else step=0;
  };
  document.addEventListener('click',event=>{const button=event.target.closest?.('button');if(button&&!button.disabled)gameAudio.play('click');});
}
