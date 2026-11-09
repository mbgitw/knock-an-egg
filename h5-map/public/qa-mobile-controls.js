const panel=document.createElement('div');panel.id='mobile-qa';panel.dataset.noI18n='';panel.style.cssText='position:fixed;left:10px;top:140px;z-index:100;background:white;color:black;padding:12px;font:14px Arial';panel.textContent='Loading touch QA';document.body.append(panel);
const css=document.createElement('style');css.textContent='#mobile-jump{display:block}';document.head.append(css);
const timer=setInterval(()=>{if(document.querySelector('canvas').dataset.ready!=='true')return;clearInterval(timer);panel.innerHTML='<button>Run touch regression</button><pre></pre>';panel.querySelector('button').onclick=async()=>{
 const g=window.game,p=g.player,c=g.canvas,checks=[];const check=(ok,label)=>{checks.push((ok?'PASS ':'FAIL ')+label);};
 const r=c.getBoundingClientRect(),emit=(type,id,x,y)=>c.dispatchEvent(new PointerEvent(type,{bubbles:true,pointerType:'touch',pointerId:id,button:0,clientX:x,clientY:y}));
 // Synthetic pointers have no OS capture; keep this exception limited to the test page.
 const capture=c.setPointerCapture;c.setPointerCapture=()=>{};
 try{
 const x=r.width*.25,y=r.height*.7,rx=r.width*.7;
 emit('pointerdown',101,x,y);emit('pointermove',101,x+30,y-40);const distance=p.orbitCamera.position.distanceTo(p.controls.target),direction=p.orbitCamera.position.clone();
 emit('pointerdown',102,rx,y);emit('pointermove',102,rx+50,y-10);
 check(p.touchMove.length()>.5,'walking continues while rotating');check(Math.abs(p.orbitCamera.position.distanceTo(p.controls.target)-distance)<.0001,'left + right does not zoom');check(direction.distanceTo(p.orbitCamera.position)>1,'right rotates');
 emit('pointerdown',103,rx+100,y);emit('pointermove',103,rx+160,y);check(Math.abs(p.orbitCamera.position.distanceTo(p.controls.target)-distance)>1,'two right fingers zoom');emit('pointerup',103,rx+160,y);emit('pointerup',102,rx+50,y-10);check(p.touchMove.length()>.5,'lifting camera finger preserves walking');emit('pointerup',101,x+30,y-40);check(p.touchMove.length()===0,'lifting left stops walking');
 let jumps=0;const jump=p.jump;p.jump=()=>jumps++;const before=g.pickaxes.clock.id;document.querySelector('#mobile-jump').dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,pointerType:'touch',pointerId:104,button:0}));p.jump=jump;check(jumps===1&&g.pickaxes.clock.id===before,'jump fires once without attacking');
 emit('pointerdown',105,x,y);emit('pointermove',105,x+30,y-40);window.dispatchEvent(new Event('blur'));check(p.touches.size===0&&p.touchMove.length()===0,'blur clears touch state');
 }finally{c.setPointerCapture=capture;p.resetTouchInput();}
 panel.querySelector('pre').textContent=checks.join('\n');
 };},200);
