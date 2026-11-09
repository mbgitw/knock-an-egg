// Escape feedback follows the reference game's local carrying state, not other players' guards.
export function escapeActive(target,ready=true){return !!(ready&&target?.carrying&&!target.safe&&!target.disabled);}

export class ChaseFeedback {
  constructor(game){
    this.game=game;this.active=false;this.abort=new AbortController();
    this.root=document.createElement('div');this.root.id='chase-feedback';this.root.hidden=true;
    this.root.innerHTML='<div class="chase-edge"></div><strong>RUN!!!</strong>';document.body.append(this.root);
    if(!game.music.native){
    this.alert=new Audio(new URL('../audio/chase/chase-alert-louder.wav',import.meta.url).href);
    this.track=new Audio(new URL('../audio/chase/chase-music.mp3',import.meta.url).href);
    this.alert.preload=this.track.preload='auto';this.track.loop=true;
    this.alert.onended=()=>{this.intro=false;this.sync();};
    this.alert.onerror=()=>{this.intro=false;this.sync();};
    }
    this.unobserve=game.settings.observe(key=>{if(key==='MusicVolume')this.sync();});
    const options={signal:this.abort.signal};
    for(const type of ['pointerdown','pointerup','keydown','game-host-pause'])window.addEventListener(type,()=>{this.update(true);this.sync();},options);

    window.addEventListener('pagehide',()=>this.setActive(false),options);
    this.unobserveOnline=game.online?.observe((type)=>{if(type==='status')this.update(true);});
  }
  update(force=false){
    const now=performance.now();if(!force&&now<(this.nextUpdate||0))return;this.nextUpdate=now+100;
    const g=this.game,ready=!(window.gameHostState?.paused||document.hidden)&&!window.gameHostState?.paused&&(!g.online||g.online.session.ready);
    this.setActive(escapeActive(g.guards.target(),ready));
    // Keep retrying failed host transitions even after RUN has already disappeared.
    if(g.music.native)g.music.sync();
  }
  setActive(active){
    if(active!==this.active){
      this.active=active;this.root.hidden=!active;this.intro=active;
      if(this.game.music.native){void this.game.music.setChase(active);return;}
      this.alert.pause();this.track.pause();this.alert.currentTime=this.track.currentTime=0;
      this.game.music.overrideActive=active;this.game.music.sync();
      this.sync();
    }
  }
  sync(){
    if(this.game.music.native){this.game.music.sync();return;}
    const volume=this.game.settings.get('MusicVolume');
    this.alert.volume=volume;this.track.volume=volume*.42;
    if(!this.active||!volume||(window.gameHostState?.paused||document.hidden)||window.gameHostState?.paused){this.alert.pause();this.track.pause();return;}
    const audio=this.intro?this.alert:this.track;
    if(audio.paused&&!this.pending){this.pending=true;Promise.resolve(audio.play()).catch(()=>{}).finally(()=>{this.pending=false;if(!this.active||(this.intro?this.alert:this.track)!==audio)audio.pause();});}
  }
  dispose(){this.setActive(false);this.abort.abort();this.unobserve?.();this.unobserveOnline?.();this.root.remove();if(this.alert)this.alert.onended=this.alert.onerror=null;}
}
