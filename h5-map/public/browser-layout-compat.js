// Resize-driven fallbacks. No per-frame scanning, no gameplay or account state.
(function(){
  const chromium=/Chrom(?:e|ium)\/(\d+)/.exec(navigator.userAgent);
  if(chromium&&Number(chromium[1])<123)document.documentElement.classList.add('compat-text-outline');
  const cq=!CSS.supports('width','1cqw');
  const aspect=!CSS.supports('aspect-ratio','1');
  function viewport(){document.documentElement.style.setProperty('--compat-dvh',innerHeight/100+'px');}
  viewport();addEventListener('resize',viewport);
  if(!cq&&!aspect)return;
  const containerSelector='#backpack-panel,.backpack-pet,#pickaxe-ui .tool-slot,#auto-pickaxe,.bank-item-display,.original-index,.inventory-drawer,.original-shop .pickaxe-panel,.original-card-inner,.trail-panel,#zone-entry';
  // Explicit axes keep the authored size authoritative, including height-led icons.
  const ratios=[
    ['#backpack-panel nav button,.backpack-cell,.index-tile-slot,.inventory-close',1,'width'],
    ['#backpack-info',1.95548,'width'],['#auto-pickaxe',4.12171173,'width'],
    ['.index-tabs button',2.3,'width'],['.inventory-drawer',1.32348347,'width'],
    ['.inventory-drawer[data-kind=eggs]',1.32233882,'width'],
    ['.bank-item,.index-close,.index-reward-icon,.inventory-pet-art,.inventory-sunray,.inventory-rays img,#pickaxe-close,.trail-close,.zone-entry-icon,.zone-entry-speed img,#auto-pickaxe img',1,'height'],
    ['.index-book',110/135,'height']
  ];
  const containers=new Set(),sized=new Map();let queued=false;
  const observer=new ResizeObserver(()=>schedule());
  function set(el,name,value){if(el.style.getPropertyValue(name)!==value)el.style.setProperty(name,value);}
  function measure(){
    queued=false;
    for(const [el,rule]of sized){
      if(!el.isConnected){observer.unobserve(el);sized.delete(el);continue;}
      const s=getComputedStyle(el);if(s.display==='none')continue;
      const n=parseFloat(s[rule[2]]);if(!(n>0))continue;
      set(el,rule[2]==='width'?'height':'width',(rule[2]==='width'?n/rule[1]:n*rule[1])+'px');
    }
    for(const el of containers){
      if(!el.isConnected){observer.unobserve(el);containers.delete(el);continue;}
      const s=getComputedStyle(el),w=el.clientWidth-parseFloat(s.paddingLeft)-parseFloat(s.paddingRight),h=el.clientHeight-parseFloat(s.paddingTop)-parseFloat(s.paddingBottom);
      if(!(w>0&&h>0))continue;
      // Values belong to children: units on a nested container itself still refer
      // to its ancestor. clientWidth avoids multiplying CSS transforms twice.
      for(const child of el.children){set(child,'--compat-cqw',w/100+'px');set(child,'--compat-cqh',h/100+'px');}
    }
  }
  function schedule(){if(!queued){queued=true;requestAnimationFrame(measure);}}
  function discover(){
    if(cq)for(const el of document.querySelectorAll(containerSelector))if(!containers.has(el)){containers.add(el);observer.observe(el);}
    if(aspect)for(const rule of ratios)for(const el of document.querySelectorAll(rule[0])){if(!sized.has(el))observer.observe(el);sized.set(el,rule);}
    schedule();
  }
  function start(){discover();new MutationObserver(discover).observe(document.body,{subtree:true,childList:true,attributes:true,attributeFilter:['class','hidden','data-kind']});addEventListener('resize',schedule);document.fonts.ready.then(schedule);}
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',start,{once:true});else start();
})();
