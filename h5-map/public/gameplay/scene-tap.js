// Observe at window capture: the character controller consumes canvas touch
// events in capture phase. Never preventDefault or interrupt camera/movement.
export function bindSceneTap(canvas,onTap,{host=window,signal,allowLeftTouch=()=>false}={}){
  const pointers=new Map();const opts={capture:true,passive:true,signal};
  const clear=()=>pointers.clear();
  const down=e=>{
    if(e.target!==canvas||e.button!==0)return;
    const r=canvas.getBoundingClientRect();if(e.pointerType==='touch'&&e.clientX<r.left+(r.width??r.right-r.left)/2&&!allowLeftTouch())return;
    const p={x:e.clientX,y:e.clientY,time:e.timeStamp,moved:false,multi:pointers.size>0};
    for(const other of pointers.values())other.multi=true;
    pointers.set(e.pointerId,p);
  };
  const move=e=>{const p=pointers.get(e.pointerId);if(p&&Math.hypot(e.clientX-p.x,e.clientY-p.y)>8)p.moved=true;};
  const end=e=>{
    const p=pointers.get(e.pointerId);pointers.delete(e.pointerId);
    if(canvas.dataset?.worldUiPointer===String(e.pointerId))return;
    if(!p||p.multi||p.moved||e.button!==0||e.timeStamp-p.time>350||Math.hypot(e.clientX-p.x,e.clientY-p.y)>8)return;
    const r=canvas.getBoundingClientRect();
    if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)return;
    onTap(e);
  };
  const cancel=e=>pointers.delete(e.pointerId);
  const listeners={pointerdown:down,pointermove:move,pointerup:end,pointercancel:cancel,blur:clear};
  for(const [name,handler] of Object.entries(listeners))host.addEventListener(name,handler,opts);
  return ()=>{clear();for(const [name,handler] of Object.entries(listeners))host.removeEventListener(name,handler,true);};
}
