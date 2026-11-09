// Explicit opt-in capture, no production HUD and no per-frame work when idle.
export class FrameMetrics{
  constructor(renderer){this.renderer=renderer;this.active=false;}
  start(seconds=60){
    if(this.active)throw Error('Capture already active');
    this.active=true;this.until=performance.now()+Math.max(1,Math.min(600,seconds))*1000;this.started=performance.now();this.previous=null;this.frames=[];this.cpu=[];this.calls=[];this.triangles=[];
    this.autoReset=this.renderer.info.autoReset;this.renderer.info.autoReset=false;
    return new Promise(resolve=>this.resolve=resolve);
  }
  begin(){if(!this.active)return;this.frameStart=performance.now();if(this.previous!==null)this.frames.push(this.frameStart-this.previous);this.previous=this.frameStart;this.renderer.info.reset();}
  end(){if(!this.active)return;this.cpu.push(performance.now()-this.frameStart);this.calls.push(this.renderer.info.render.calls);this.triangles.push(this.renderer.info.render.triangles);if(performance.now()>=this.until)this.stop();}
  stop(){if(!this.active)return;this.active=false;this.renderer.info.autoReset=this.autoReset;const summary=a=>{if(!a.length)return null;const s=[...a].sort((a,b)=>a-b);return {mean:a.reduce((n,v)=>n+v,0)/a.length,p50:s[Math.floor(s.length*.5)],p95:s[Math.floor(s.length*.95)],p99:s[Math.floor(s.length*.99)],max:s.at(-1)};};
    const frame=summary(this.frames);this.result={userAgent:navigator.userAgent,viewport:[innerWidth,innerHeight],pixelRatio:this.renderer.getPixelRatio(),seconds:(performance.now()-this.started)/1000,samples:this.frames.length,targetFps:60,frameBudgetMs:1000/60,averageFps:frame?1000/frame.mean:0,frameMs:frame,cpuSubmissionMs:summary(this.cpu),drawCalls:summary(this.calls),triangles:summary(this.triangles),framesOver33ms:this.frames.filter(v=>v>1000/30).length,hidden:document.hidden,note:'Browser frame intervals and CPU submission, not GPU timings. Device acceptance requires real phone and foreground gameplay.'};this.resolve(this.result);return this.result;}
}
