import * as THREE from 'three';

// MAX_SAMPLES is only a global ceiling. Float color and depth renderbuffers can
// support fewer samples (including none) on older WebGL2 implementations.
export function compatibleRenderSamples(gl, colorFormat, ceiling=4) {
  const color=Array.from(gl.getInternalformatParameter(gl.RENDERBUFFER,colorFormat,gl.SAMPLES)||[]);
  const depth=Array.from(gl.getInternalformatParameter(gl.RENDERBUFFER,gl.DEPTH_COMPONENT24,gl.SAMPLES)||[]);
  return Math.max(0,...color.filter(n=>n>0&&n<=ceiling&&depth.includes(n)));
}


export function supportsSrgbMipmaps(gl){
  const texture=gl.createTexture(),framebuffer=gl.createFramebuffer(),pixel=new Uint8Array(4);
  try{
    gl.bindTexture(gl.TEXTURE_2D,texture);
    gl.texStorage2D(gl.TEXTURE_2D,3,gl.SRGB8_ALPHA8,4,4);
    gl.texSubImage2D(gl.TEXTURE_2D,0,0,0,4,4,gl.RGBA,gl.UNSIGNED_BYTE,new Uint8Array(64).fill(255));
    gl.generateMipmap(gl.TEXTURE_2D);
    gl.bindFramebuffer(gl.FRAMEBUFFER,framebuffer);
    gl.framebufferTexture2D(gl.FRAMEBUFFER,gl.COLOR_ATTACHMENT0,gl.TEXTURE_2D,texture,1);
    if(gl.checkFramebufferStatus(gl.FRAMEBUFFER)!==gl.FRAMEBUFFER_COMPLETE)return false;
    gl.readPixels(0,0,1,1,gl.RGBA,gl.UNSIGNED_BYTE,pixel);
    return pixel.every(n=>n>=250);
  }finally{
    gl.bindFramebuffer(gl.FRAMEBUFFER,null);gl.bindTexture(gl.TEXTURE_2D,null);
    gl.deleteFramebuffer(framebuffer);gl.deleteTexture(texture);
  }
}
const affectedRenderers=new WeakSet();let installed=false;
export function installRenderCompatibility(renderer){
  const supported=supportsSrgbMipmaps(renderer.getContext());renderer.resetState();
  renderer.browserCompatibility={srgbMipmaps:supported};
  if(supported)return;
  affectedRenderers.add(renderer);
  if(installed)return;installed=true;
  // A material hook also covers GLBs/textures loaded after startup. Only the
  // failing driver loses sRGB mip filtering; native shader color conversion stays.
  const original=THREE.Material.prototype.onBeforeRender;
  THREE.Material.prototype.onBeforeRender=function(renderer,...args){
    if(affectedRenderers.has(renderer))for(const key of ['map','emissiveMap']){
      const texture=this[key];
      if(texture?.colorSpace===THREE.SRGBColorSpace&&texture.generateMipmaps){
        texture.generateMipmaps=false;
        texture.minFilter=texture.magFilter===THREE.NearestFilter?THREE.NearestFilter:THREE.LinearFilter;
        texture.needsUpdate=true;
      }
    }
    original.call(this,renderer,...args);
  };
}
