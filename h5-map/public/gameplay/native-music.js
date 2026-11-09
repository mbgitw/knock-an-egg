// Only one serialized owner of the host BGM channel (daily, warning, chase).
export class NativeMusic {
  constructor(audio,{paused=()=>!!window.gameHostState?.paused}={}){this.audio=audio;this.paused=paused;this.enabled=false;this.chasing=false;this.intro=false;this.current=null;this.running=null;this.timer=null;}
  setEnabled(enabled){this.enabled=enabled;return this.sync();}
  setChase(active){if(active!==this.chasing){this.chasing=active;this.intro=active;clearTimeout(this.timer);this.timer=null;}return this.sync();}
  desired(){if(!this.enabled||this.paused())return null;return this.chasing?(this.intro?'alert':'chase'):'daily';}
  sync(){
    if(this.running)return this.running;
    if(this.current===this.desired()||Date.now()<(this.retryAt||0))return Promise.resolve();
    this.running=this.reconcile().finally(()=>{
      this.running=null;
      // A state change can arrive after reconcile's last check but before this cleanup.
      if(this.current!==this.desired()&&Date.now()>=(this.retryAt||0))return this.sync();
    });return this.running;
  }
  async reconcile(){
    try{
      while(this.current!==this.desired()){
        if(this.current){const r=await this.audio.stopBGM();if(!r.ok){this.retryAt=Date.now()+3000;return;}this.current=null;clearTimeout(this.timer);this.timer=null;}
        const next=this.desired();if(!next)return;
        const tracks={daily:['audio/bgm/daily.mp3',.5],alert:['audio/chase/chase-alert-louder.wav',1],chase:['audio/chase/chase-music.mp3',.42]};
        const [path,volume]=tracks[next],r=await this.audio.playBGM(path,{loop:next!=='alert',volume});
        if(!r.ok||r.data?.available===false){this.retryAt=Date.now()+3000;return;}
        this.retryAt=0;
        this.current=next;
        if(next==='alert'&&this.desired()===next)this.timer=setTimeout(()=>{this.timer=null;this.intro=false;void this.sync();},1896);
        // State may have changed while the host was acknowledging play; loop stops stale audio.
      }
    }catch{this.retryAt=Date.now()+3000;/* A host audio failure must not stop gameplay; next state/gesture retries. */}
  }
}
