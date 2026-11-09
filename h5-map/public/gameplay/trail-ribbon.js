import * as THREE from 'three';

const parseSequence=(text,stride)=>{const a=text.trim().split(/\s+/).map(Number);return Array.from({length:a.length/stride},(_,i)=>a.slice(i*stride,(i+1)*stride));};
function sample(stops,t){let i=0;while(i<stops.length-2&&t>stops[i+1][0])i++;const a=stops[i],b=stops[i+1]||a,f=THREE.MathUtils.clamp((t-a[0])/(b[0]-a[0]||1),0,1);return a.slice(1,-1).map((v,j)=>v+(b[j+1]-v)*f);}

// Bounded history shared by runtime rendering and automated lifetime/teleport checks.
export class TrailHistory {
  constructor({lifetime=.75,maxLength=50,maxSamples=192}={}){Object.assign(this,{lifetime,maxLength,maxSamples});this.points=[];this.time=0;this.last=null;}
  clear(){this.points.length=0;this.last=null;}
  advance(dt,position){
    if(!Number.isFinite(dt)||dt<=0)return;
    this.time+=dt;
    const distance=this.last?this.last.distanceTo(position):0;
    if(dt>.25||distance>Math.max(8,dt*400)){this.clear();}
    if(!this.last||this.last.distanceTo(position)>.035){this.points.push({position:position.clone(),at:this.time});this.last=position.clone();}
    while(this.points.length&&this.time-this.points[0].at>=this.lifetime)this.points.shift();
    let length=0;
    for(let i=this.points.length-2;i>=0;i--){length+=this.points[i].position.distanceTo(this.points[i+1].position);if(length>this.maxLength){this.points.splice(0,i+1);break;}}
    if(this.points.length>this.maxSamples)this.points.splice(0,this.points.length-this.maxSamples);
  }
}

export class TrailRibbon {
  constructor(scene,camera){
    this.camera=camera;this.history=new TrailHistory();this.id=0;this.textureVersion=0;
    const count=this.history.maxSamples*2;this.geometry=new THREE.BufferGeometry();
    this.geometry.setAttribute('position',new THREE.BufferAttribute(new Float32Array(count*3),3).setUsage(THREE.DynamicDrawUsage));
    this.geometry.setAttribute('color',new THREE.BufferAttribute(new Float32Array(count*3),3).setUsage(THREE.DynamicDrawUsage));
    this.geometry.setAttribute('uv',new THREE.BufferAttribute(new Float32Array(count*2),2).setUsage(THREE.DynamicDrawUsage));
    this.geometry.setAttribute('fade',new THREE.BufferAttribute(new Float32Array(count),1).setUsage(THREE.DynamicDrawUsage));
    const indices=[];for(let i=0;i<this.history.maxSamples-1;i++){const n=i*2;indices.push(n,n+1,n+2,n+1,n+3,n+2);}this.geometry.setIndex(indices);this.geometry.setDrawRange(0,0);
    this.material=new THREE.ShaderMaterial({transparent:true,depthWrite:false,side:THREE.DoubleSide,toneMapped:false,uniforms:{map:{value:null},hasMap:{value:0},brightness:{value:1}},vertexShader:'attribute vec3 color;attribute float fade;varying vec3 vColor;varying float vFade;varying vec2 vUv;void main(){vColor=color;vFade=fade;vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}',fragmentShader:'uniform sampler2D map;uniform float hasMap;uniform float brightness;varying vec3 vColor;varying float vFade;varying vec2 vUv;void main(){vec4 tex=vec4(1.);if(hasMap>.5)tex=texture2D(map,vUv);float edge=smoothstep(0.,.1,vUv.y)*smoothstep(0.,.1,1.-vUv.y);gl_FragColor=vec4(vColor*tex.rgb*brightness,vFade*tex.a*edge);}' });
    this.mesh=new THREE.Mesh(this.geometry,this.material);this.mesh.name='Equipped Trail';this.mesh.frustumCulled=false;this.mesh.renderOrder=3;scene.add(this.mesh);
    this.tangent=new THREE.Vector3();this.view=new THREE.Vector3();this.side=new THREE.Vector3();this.colors=null;this.texture=null;this.disposed=false;
  }
  setTrail(t){
    if(this.id===(t?.id||0))return;this.id=t?.id||0;const version=++this.textureVersion;this.history.clear();this.geometry.setDrawRange(0,0);this.texture?.dispose();this.texture=null;this.material.uniforms.hasMap.value=0;
    if(!t){this.mesh.visible=false;return;}this.mesh.visible=true;
    this.history.lifetime=Number(t.effect.Lifetime);this.history.maxLength=Number(t.effect.MaxLength);
    this.colors=parseSequence(t.effect.Color,5);this.opacity=parseSequence(t.effect.Transparency,3);this.width=parseSequence(t.effect.WidthScale,3);
    this.material.uniforms.brightness.value=1+Math.log2(Math.max(1,Number(t.effect.Brightness)/3.5))*.12;
    if(t.texture){new THREE.TextureLoader().load('/gameplay/trails/'+t.texture,texture=>{if(this.disposed||this.textureVersion!==version){texture.dispose();return;}this.texture=texture;this.material.uniforms.map.value=texture;this.material.uniforms.hasMap.value=1;},undefined,()=>{});}
  }
  clear(){this.history.clear();this.geometry.setDrawRange(0,0);}
  update(dt,position){if(!this.id)return;this.history.advance(dt,position);this.render();}
  render(){
    const points=this.history.points,n=points.length;this.geometry.setDrawRange(0,Math.max(0,n-1)*6);if(n<2)return;
    const a=this.geometry.attributes;
    for(let i=0;i<n;i++){
      const p=points[i],age=THREE.MathUtils.clamp((this.history.time-p.at)/this.history.lifetime,0,1),fraction=1-i/(n-1);
      this.tangent.subVectors(points[Math.min(i+1,n-1)].position,points[Math.max(0,i-1)].position).normalize();this.view.subVectors(this.camera.position,p.position).normalize();this.side.crossVectors(this.tangent,this.view).normalize();if(this.side.lengthSq()<.01)this.side.set(0,1,0);
      const width=sample(this.width,age)[0],color=sample(this.colors,fraction),opacity=1-sample(this.opacity,age)[0];
      for(let j=0;j<2;j++){const k=i*2+j,sign=j?1:-1;a.position.setXYZ(k,p.position.x+this.side.x*width*sign,p.position.y+this.side.y*width*sign,p.position.z+this.side.z*width*sign);a.color.setXYZ(k,...color);a.uv.setXY(k,fraction,j);a.fade.setX(k,opacity);}
    }
    for(const attr of Object.values(a))attr.needsUpdate=true;
  }
  dispose(){this.disposed=true;this.mesh.removeFromParent();this.geometry.dispose();this.material.dispose();this.texture?.dispose();}
}

// When original icon pixels are unavailable, show the actual reconstructed effect.
export function trailThumbnail(t){
  const canvas=document.createElement('canvas');canvas.width=420;canvas.height=420;const ctx=canvas.getContext('2d');
  const stops=parseSequence(t.effect.Color,5),gradient=ctx.createLinearGradient(70,0,350,0);
  for(const s of stops)gradient.addColorStop(s[0],`rgb(${s.slice(1,4).map(v=>Math.round(v*255)).join(',')})`);
  ctx.translate(0,22);ctx.lineCap='round';ctx.lineJoin='round';
  ctx.shadowColor=t.colors[0]?`rgb(${t.colors[0].join(',')})`:'#fff';ctx.shadowBlur=18;
  ctx.beginPath();ctx.moveTo(58,258);ctx.bezierCurveTo(120,305,155,175,226,200);ctx.bezierCurveTo(285,230,313,109,360,119);ctx.lineWidth=36;ctx.strokeStyle=gradient;ctx.stroke();
  ctx.shadowBlur=0;ctx.globalAlpha=.65;ctx.lineWidth=4;ctx.strokeStyle='#fff';ctx.stroke();
  return canvas.toDataURL();
}
