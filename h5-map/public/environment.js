import * as THREE from 'three';
import {compatibleRenderSamples} from './render-compat.js';

export async function createEnvironment(renderer, scene) {
  const source=await fetch('environment/lighting.json').then(r=>{if(!r.ok)throw Error('Lighting data unavailable');return r.json();});
  const color=rgb=>new THREE.Color().setRGB(...rgb,THREE.SRGBColorSpace);
  const ambient=new THREE.AmbientLight(color(source.lighting.Ambient),1.1);
  const hemisphere=new THREE.HemisphereLight(color(source.lighting.OutdoorAmbient),color(source.lighting.Ambient),1.35);
  const sun=new THREE.DirectionalLight(0xffffff,2.5);
  // Noon at latitude zero: overhead sun; retain a small slope for readable faces.
  sun.position.set(-120,900,160);
  scene.add(ambient,hemisphere,sun);
  const sky=await new THREE.CubeTextureLoader().loadAsync(['rt','lf','up','dn','bk','ft'].map(face=>`environment/sky-${face}.png`));
  sky.colorSpace=THREE.SRGBColorSpace;
  scene.background=sky;
  // PMREM supplies broad sky reflection without using the background as a lamp.
  const gl=renderer.getContext(),floatColor=!!gl.getExtension('EXT_color_buffer_float');
  let environment=null;
  if(floatColor){const pmrem=new THREE.PMREMGenerator(renderer);environment=pmrem.fromCubemap(sky);scene.environment=environment.texture;scene.environmentIntensity=.25;pmrem.dispose();}
  renderer.toneMapping=THREE.NoToneMapping;
  renderer.toneMappingExposure=1;

  const grade=source.children.find(c=>c.className==='ColorCorrectionEffect'&&c.properties.Enabled).properties;
  // The grade clamps to 0..1, so float range is unused. sRGB8 storage keeps dark
  // gradients smooth at half the bytes of RGBA16F; blending still happens in linear.
  const target=new THREE.WebGLRenderTarget(1,1,{type:THREE.UnsignedByteType,colorSpace:THREE.SRGBColorSpace,depthBuffer:true,samples:compatibleRenderSamples(gl,gl.SRGB8_ALPHA8,Math.min(4,renderer.capabilities.maxSamples))});
  const material=new THREE.ShaderMaterial({
    depthTest:false,depthWrite:false,toneMapped:false,
    uniforms:{image:{value:target.texture},contrast:{value:grade.Contrast},saturation:{value:grade.Saturation},tint:{value:new THREE.Vector3(...grade.TintColor)}},
    vertexShader:`varying vec2 vUv; void main(){vUv=uv;gl_Position=vec4(position.xy,0.,1.);}`,
    fragmentShader:`
      uniform sampler2D image; uniform float contrast; uniform float saturation;
      uniform vec3 tint; varying vec2 vUv;
      void main(){
        // Display-referred grade, without ACES' desaturation of bright colors.
        vec3 c=sRGBTransferOETF(vec4(clamp(texture2D(image,vUv).rgb,0.,1.),1.)).rgb;
        float luma=dot(c,vec3(.2126,.7152,.0722));
        c=mix(vec3(luma),c,1.+saturation);
        c=(c-.5)*(1.+contrast)+.5;
        gl_FragColor=vec4(clamp(c*tint,0.,1.),1.);
      }`,
  });
  const screen=new THREE.Scene(),screenCamera=new THREE.Camera();
  const geometry=new THREE.PlaneGeometry(2,2);screen.add(new THREE.Mesh(geometry,material));
  const size=new THREE.Vector2();
  function resize(){renderer.getDrawingBufferSize(size);target.setSize(size.x,size.y);}
  resize();
  return {source,sky,sun,ambient,hemisphere,resize,
    prepare(camera){
      const previous=renderer.getRenderTarget();
      try{renderer.setRenderTarget(target);return renderer.compileAsync(scene,camera);}
      finally{renderer.setRenderTarget(previous);}
    },
    render(camera){renderer.setRenderTarget(target);renderer.render(scene,camera);renderer.setRenderTarget(null);renderer.render(screen,screenCamera);},
    dispose(){target.dispose();geometry.dispose();material.dispose();sky.dispose();environment?.dispose();scene.remove(sun,ambient,hemisphere);},
  };
}
