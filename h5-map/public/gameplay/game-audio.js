import {audioOutput} from './settings-audio.js';

export const SFX={
  swing:['weapon-swing.wav',.4,.08], impact:['hit.wav',.5,.06],
  crack:['hatch-crack.ogg',.45,.3], hatch:['hatch-reveal-tight.wav',.5,.15],
  pickup:['egg-pickup.wav',.45,.15], drop:['egg-drop.wav',.35,.15],
  secure:['egg-secure.wav',.45,.2], hurt:['player-hit.ogg',.55,.3],
  reward:['reward.wav',.4,.15], purchase:['purchase.wav',.4,.2],
  upgrade:['facility-upgrade.ogg',.5,.2], offline:['offline-claim-fast.wav',.4,.3],
  train:['train-tick.wav',.16,.12], click:['ui-click.wav',.22,.08],
  jump:['jump.wav',.22,.2], step:['footstep.wav',.14,.26],
};

export class GameAudio {
  constructor(){this.buffers=new Map();this.loading=new Map();this.voices=new Set();this.last=new Map();}
  install(){
    if(this.installed)return;this.installed=true;
    const unlock=()=>this.unlock();
    for(const name of ['pointerdown','pointerup','keydown'])window.addEventListener(name,unlock,{capture:true});
    const pause=()=>{if(window.gameHostState?.paused)this.stop();if(window.Builda?.audio){this.muteQueue=(this.muteQueue||Promise.resolve()).then(()=>window.Builda.audio.setMuted(!!window.gameHostState?.paused,'effect')).catch(()=>{});}};
    window.addEventListener('game-host-pause',pause);
    window.addEventListener('pagehide',()=>this.stop());
  }
  unlock(){
    if(window.Builda?.audio||(window.gameHostState?.paused||document.hidden)||window.gameHostState?.paused)return;
    try{
      const Context=window.AudioContext||window.webkitAudioContext;if(!Context)return;
      this.context ||= new Context();
      if(this.context.state==='suspended')void this.context.resume().catch(()=>{});
      for(const [cue,[file]] of Object.entries(SFX))if(!this.buffers.has(cue)&&!this.loading.has(cue)){
        const task=fetch(new URL(`../audio/sfx/${file}`,import.meta.url)).then(r=>{if(!r.ok)throw Error('audio unavailable');return r.arrayBuffer();})
          .then(bytes=>this.context.decodeAudioData(bytes)).then(buffer=>this.buffers.set(cue,buffer)).catch(()=>{}).finally(()=>this.loading.delete(cue));
        this.loading.set(cue,task);
      }
    }catch{/* Audio must never prevent an action. */}
  }
  play(cue,{position,listener,volume=1,pitch=1}={}){
    const context=this.context,spec=SFX[cue],buffer=this.buffers.get(cue);
    if(window.Builda?.audio){
      if(!spec||window.gameHostState?.paused)return null;
      const now=performance.now()/1000,dist=position&&listener?Math.hypot(position.x-listener.x,position.y-listener.y,position.z-listener.z):0,attenuation=Math.max(0,1-dist/(cue==='impact'?100:80));
      if(!attenuation||now-(this.last.get(cue)??-Infinity)<spec[2])return null;this.last.set(cue,now);
      void window.Builda.audio.playSFX(`audio/sfx/${spec[0]}`,{sessionId:`game-${cue}`,loop:false,volume:Math.min(1,Math.max(0,spec[1]*volume*attenuation)),pitch:Math.max(.5,Math.min(2,pitch))}).then(r=>{if(!r.ok)this.last.set(cue,performance.now()/1000+2);}).catch(()=>{this.last.set(cue,performance.now()/1000+2);});return null;
    }
    if(!spec||!buffer||context?.state!=='running'||(window.gameHostState?.paused||document.hidden)||window.gameHostState?.paused)return null;
    const distance=position&&listener?Math.hypot(position.x-listener.x,position.y-listener.y,position.z-listener.z):0;
    const attenuation=Math.max(0,1-distance/(cue==='impact'?100:80));
    if(!attenuation||context.currentTime-(this.last.get(cue)??-Infinity)<spec[2])return null;
    this.last.set(cue,context.currentTime);
    if(this.voices.size>=12)this.voices.values().next().value.stop();
    const source=context.createBufferSource(),gain=context.createGain();source.buffer=buffer;
    source.playbackRate.value=Math.max(.5,Math.min(2,pitch));gain.gain.value=spec[1]*volume*attenuation;
    source.connect(gain).connect(audioOutput(context));
    const voice={stop:()=>{try{source.stop();}catch{}this.voices.delete(voice);}};
    source.onended=()=>{this.voices.delete(voice);source.disconnect();gain.disconnect();};
    this.voices.add(voice);source.start();return voice.stop;
  }
  stop(){for(const voice of [...this.voices])voice.stop();}
}

export const gameAudio=new GameAudio();
