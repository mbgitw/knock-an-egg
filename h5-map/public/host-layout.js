// Runs before renderer construction; host cap supplements the game's own GPU cap.
(()=>{
  const cap=Number(new URLSearchParams(location.search).get('dpr'));
  if(Number.isFinite(cap)&&cap>0&&cap<window.devicePixelRatio){try{Object.defineProperty(window,'devicePixelRatio',{configurable:true,get:()=>cap});}catch{}}
  const finite=v=>Number.isFinite(v)&&v>0?v:0;
  const apply=()=>{
    const sdk=window.Builda?.runtime,safe=sdk?.safeArea?.()||{},style=document.documentElement.style;
    for(const side of ['top','right','bottom','left'])style.setProperty(`--host-safe-${side}`,`${finite(safe[side])}px`);
    const r=sdk?.capsuleMenuRect?.();
    for(const el of document.querySelectorAll('#settings-button,#backpack-toggle,.game-shortcut,.inventory-shortcuts,#mobile-jump')){
      el.style.marginTop='';if(!r||!(r.width>0&&r.height>0))continue;
      const b=el.getBoundingClientRect(),x=window.innerWidth-r.right-r.width,y=r.top;
      if(b.right>x-8&&b.left<x+r.width+8&&b.bottom>y-8&&b.top<y+r.height+8)el.style.marginTop=`${Math.max(0,y+r.height+8-b.top)}px`;
    }
  };
  for(const event of ['resize','orientationchange','game-ui-ready'])window.addEventListener(event,apply);
  apply();
})();
