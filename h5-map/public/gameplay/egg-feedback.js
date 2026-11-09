import {gameAudio} from './game-audio.js';
import * as THREE from 'three';
import {createWeaponEffects} from '../model-check/weapon-effects.js';

export class EggFeedback {
  constructor(scene,camera){this.scene=scene;this.camera=camera;this.active=[];this.free=new Map();this.pending=new Set();this.data=null;this.audio=null;this.buffers=new Map();this.voices=[];
    this.ready=fetch('./gameplay/egg-presentation/config.json').then(r=>r.json()).then(data=>{this.data=data;return data;});
  }
  async emit(kind,position,scale=1,lifetime=1,valid=()=>true){await this.ready;if(!valid()||position.distanceTo(this.camera.position)>220)return;
    const nodes=this.data.effects[kind].filter(n=>n.texture).map(n=>({...n,properties:{...n.properties,Enabled:'false',Lifetime:String(n.properties.Lifetime).trim().split(/\s+/).map(v=>Number(v)*lifetime).join(' ')}}));
    if(!nodes.length)return;
    const effect=await createWeaponEffects(nodes);if(!valid()){effect.dispose();return;}effect.root.position.copy(position);effect.root.scale.setScalar(scale);this.scene.add(effect.root);effect.root.updateWorldMatrix(true,true);effect.emitOriginal(kind==='hit'?scale:1);effect.update(0,this.camera);
    const maxLife=Math.max(...nodes.flatMap(n=>String(n.properties.Lifetime).trim().split(/\s+/).map(Number)));this.active.push({effect,age:0,life:maxLife+.1});}
  sound(name,position,{pitch=1,volume=1}={}){
    const cue={'Impact':'impact','Egg Rumble':'crack','Reveal':'hatch'}[name];
    return cue?gameAudio.play(cue,{position,listener:this.camera.position,pitch,volume:name==='Egg Rumble'?1:volume}):null;
  }
  update(dt){this.active=this.active.filter(p=>{p.age+=dt;p.effect.update(dt,this.camera);if(p.age<p.life)return true;p.effect.dispose();return false;});}
}

export function shellAppearance(egg,white,opacity){
  if(white<=0&&opacity===1){if(egg.flashMaterials)for(const entry of egg.flashMaterials)entry.mesh.material=entry.original;return;}
  if(!egg.flashMaterials){egg.flashMaterials=[];egg.shell.traverse(mesh=>{if(!mesh.isMesh)return;const original=mesh.material,base=Array.isArray(original)?original:[original];
    const uniforms={white:{value:0},opacity:{value:1}};
    const clones=base.map(material=>{const clone=material.clone();clone.transparent=true;clone.depthWrite=true;clone.onBeforeCompile=(shader,renderer)=>{material.onBeforeCompile(shader,renderer);shader.uniforms.eggWhite=uniforms.white;shader.uniforms.eggOpacity=uniforms.opacity;shader.fragmentShader='uniform float eggWhite;uniform float eggOpacity;\n'+shader.fragmentShader;shader.fragmentShader=shader.fragmentShader.replace('#include <opaque_fragment>','outgoingLight = mix(outgoingLight, vec3(1.0), eggWhite); diffuseColor.a *= eggOpacity;\n#include <opaque_fragment>');};clone.customProgramCacheKey=()=>material.customProgramCacheKey()+'-egg-flash';return clone;});
    egg.flashMaterials.push({mesh,original,clones,uniforms,array:Array.isArray(original)});
  });}
  for(const e of egg.flashMaterials){e.uniforms.white.value=white;e.uniforms.opacity.value=opacity;e.mesh.material=e.array?e.clones:e.clones[0];for(const m of e.clones)m.depthWrite=opacity>.95;}
}

export function disposeShellAppearance(egg){for(const e of egg.flashMaterials||[])for(const m of e.clones)m.dispose();egg.flashMaterials=null;}
