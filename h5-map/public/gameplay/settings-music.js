import {NativeMusic} from './native-music.js';
// User-selected single daily track; retained at its original playback gain.
export class SettingsMusic {
  constructor(state=null){
    if(window.Builda?.audio){this.native=new NativeMusic(window.Builda.audio);if(state)this.setState(state);addEventListener('game-host-pause',()=>this.sync());for(const type of ['pointerdown','keydown'])addEventListener(type,()=>this.sync());return;}
    this.state=state;this.index=0;this.unlocked=false;this.tracks=[['9045766377.mp3',.5]];
    this.audio=new Audio();this.audio.preload='auto';this.audio.loop=true;
    this.load();if(state)this.setState(state);
    const unlock=()=>{this.unlocked=true;this.sync();};addEventListener('pointerdown',unlock);addEventListener('pointerup',unlock);addEventListener('keydown',unlock);
    addEventListener('game-host-pause',()=>this.sync());
  }
  setState(state){this.unobserve?.();this.state=state;this.unobserve=state.observe(key=>{if(key==='MusicVolume')this.sync();});this.sync();}
  load(){this.audio.src=new URL(`./settings-ui/${this.tracks[this.index][0]}`,import.meta.url).href;this.audio.load();}
  setChase(active){return this.native?.setChase(active);}
  sync(){
    if(this.native){void this.native.setEnabled(!!this.state);return;}
    if(!this.state){this.audio.pause();return;}
    this.audio.volume=this.state.get('MusicVolume')*this.tracks[this.index][1];
    if(this.overrideActive||!this.unlocked||(window.gameHostState?.paused||document.hidden)||window.gameHostState?.paused||this.audio.volume===0)this.audio.pause();
    else if(this.audio.paused)this.audio.play().catch(()=>{});
  }
}
