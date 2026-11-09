import * as THREE from 'three';
while(!window.game){if(document.querySelector('canvas').dataset.error)throw Error(document.querySelector('canvas').dataset.error);await new Promise(r=>setTimeout(r,100));}
const g=window.game,e=g.environment,result=document.querySelector('#result');
g.player.update=()=>{};g.guards.update=()=>{};
g.camera.position.set(-77,15,32);g.camera.lookAt(-145,11,35);
g.player.actor.visible=false;g.player.shadow.visible=false;
for(const guard of g.guards.guards){guard.model.root.position.copy(guard.home);guard.model.root.rotation.y=guard.definition.yaw;guard.alert.visible=false;}
// Fixed comparison pose in the open lawn, away from occluding trees.
g.guards.guards[0].model.root.position.set(-125,.615,20);
const pairs=[];
for(const guard of g.guards.guards){
  const data=await fetch('gameplay/guards/'+guard.definition.model).then(r=>r.json());
  for(let i=0,mi=0;i<data.parts.length;i++){
    const p=data.parts[i],mesh=guard.model.meshes[mi];mi+=1+p.overlays.length;
    if(p.material.objColor)pairs.push({mesh,old:p.material.objColor,color:mesh.material.color.clone()});
  }
}
const oldHemi=new THREE.HemisphereLight(0xf0f9ff,0x687b57,2.5),oldSun=new THREE.DirectionalLight(0xfff1d5,2.8);
oldSun.position.set(-400,900,600);g.scene.add(oldHemi,oldSun);
const render=e.render.bind(e),env=g.scene.environment;
function show(mode){
  const modern=mode==='after';
  oldHemi.visible=oldSun.visible=!modern;
  e.ambient.visible=e.hemisphere.visible=e.sun.visible=modern;
  g.scene.background=modern?e.sky:new THREE.Color('#bed5e4');g.scene.environment=modern?env:null;
  pairs.forEach(p=>mode==='before'?p.mesh.material.color.setRGB(...p.old):p.mesh.material.color.copy(p.color));
  g.renderer.toneMapping=modern?THREE.NoToneMapping:THREE.ACESFilmicToneMapping;g.renderer.toneMappingExposure=modern?1:1.2;
  e.render=modern?render:camera=>{g.renderer.setRenderTarget(null);g.renderer.render(g.scene,camera);};
  result.textContent={before:'修正前：旧材质、旧灯光、纯色天空',material:'仅修正材质：灯光与曝光维持原状',after:'完整修正：原天空、材质与新光照调色'}[mode];
  result.dataset.mode=mode;
}
for(const mode of ['before','material','after'])document.querySelector('#'+mode).onclick=()=>show(mode);
document.querySelector('#hide').onclick=()=>document.querySelector('#qa').remove();
show('after');
