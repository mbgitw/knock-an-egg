import * as THREE from 'three';
const panel=document.createElement('div');panel.dataset.noI18n='';panel.style.cssText='position:fixed;top:140px;left:10px;z-index:100;background:white;color:black;padding:12px';panel.textContent='Loading placement QA';document.body.append(panel);
const timer=setInterval(()=>{const g=window.game;if(document.querySelector('canvas').dataset.ready!=='true')return;clearInterval(timer);panel.innerHTML='<button>Test animal and egg taps</button><pre></pre>';panel.querySelector('button').onclick=()=>{
 const results=[],check=(ok,label)=>results.push((ok?'PASS ':'FAIL ')+label),c=g.canvas,p=g.player,hitbox=g.plots.tier.hitbox;
 const center=new THREE.Vector3().applyMatrix4(new THREE.Matrix4().set(...hitbox.matrix));const hit=p.world.rayIntersect(new THREE.Ray(center.clone().add(new THREE.Vector3(0,20,0)),new THREE.Vector3(0,-1,0)));const point=hit.position.clone();p.motor.teleport(point.clone().add(new THREE.Vector3(0,1,4)));
 const capture=c.setPointerCapture,intersect=p.world.rayIntersect;p.world.rayIntersect=()=>({position:point.clone(),triangle:{getNormal:v=>v.set(0,1,0)}});c.setPointerCapture=()=>{};
 const r=c.getBoundingClientRect(),x=r.width*.25,y=r.height*.7,emit=(type,dx=0)=>c.dispatchEvent(new PointerEvent(type,{bubbles:true,pointerType:'touch',pointerId:91,button:0,clientX:x+dx,clientY:y}));
 try{
 const id='qa-place-cat';g.account.data.pickaxes.pets.push({id,name:'Cat',zone:1,weightKg:10});g.backpack.held=id;p.equippedPet=id;
 emit('pointerdown');emit('pointermove',40);emit('pointerup');check(g.backpack.held===id,'drag does not place');
 emit('pointerdown');emit('pointerup');check(g.account.data.plot.pets.some(a=>a.id===id)&&!g.backpack.held,'left touch places animal once');
 const pets=[1,2,3].map(i=>({id:'qa-merge-'+i,name:'Cat',zone:1,weightKg:10}));g.account.data.pickaxes.pets.push(...pets);const egg=g.merge.state.merge(pets.map(p=>p.id));g.merge.equip(egg.id);point.x+=6;
 emit('pointerdown');emit('pointerup');check(g.account.data.growingEggs.some(e=>e.id===egg.id)&&!g.merge.held,'left touch places egg once');
 check(!document.querySelector('#pasture-place')&&!document.querySelector('#merge-place'),'no Place overlay buttons');
 }finally{p.world.rayIntersect=intersect;c.setPointerCapture=capture;p.resetTouchInput();}
 panel.querySelector('pre').textContent=results.join('\n');
 };},200);
