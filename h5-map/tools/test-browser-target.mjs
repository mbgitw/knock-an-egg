import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import {webcrypto} from 'node:crypto';
import {compatibleRenderSamples,supportsSrgbMipmaps} from '../public/render-compat.js';
import {compatibleCss} from './compile-browser-target.mjs';
import {browserTarget} from './browser-target.mjs';
test('float MSAA uses the intersection of format capabilities, not MAX_SAMPLES',()=>{
 const gl={RENDERBUFFER:1,RGBA16F:2,DEPTH_COMPONENT24:3,SAMPLES:4,getInternalformatParameter:(_,format)=>format===2?[2]:[8,4,2]};
 assert.equal(compatibleRenderSamples(gl,2),2);
 gl.getInternalformatParameter=(_,format)=>format===2?[]:[8,4];assert.equal(compatibleRenderSamples(gl,2),0);
 gl.getInternalformatParameter=()=>[8,4,2];assert.equal(compatibleRenderSamples(gl,2),4);
});
test('sRGB mip probe rejects empty levels and releases temporary GPU resources',()=>{
 let good=true,deleted=0;
 const gl={FRAMEBUFFER_COMPLETE:1,createTexture:()=>({}),createFramebuffer:()=>({}),bindTexture(){},texStorage2D(){},texSubImage2D(){},generateMipmap(){},bindFramebuffer(){},framebufferTexture2D(){},checkFramebufferStatus:()=>1,readPixels:(_x,_y,_w,_h,_format,_type,pixel)=>pixel.fill(good?255:0),deleteFramebuffer:()=>deleted++,deleteTexture:()=>deleted++};
 assert.equal(supportsSrgbMipmaps(gl),true);good=false;assert.equal(supportsSrgbMipmaps(gl),false);assert.equal(deleted,4);
});
test('CSS fallback survives custom-property invalid-at-computed-value behavior',()=>{
 const css=compatibleCss('.p{--size:min(10vw,8dvh);width:var(--size);font-size:8cqh;inset:1px 2px;backdrop-filter:blur(2px)}');
 assert.match(css,/--size:min\(10vw,calc\(var\(--compat-dvh, 1vh\) \* 8\)\)/);
 assert.match(css,/font-size:calc\(var\(--compat-cqh, 1vh\) \* 8\);font-size:8cqh/);
 for(const text of ['top:1px','right:2px','bottom:1px','left:2px','-webkit-backdrop-filter:blur(2px)'])assert.ok(css.includes(text));
});
test('legacy shims: negative indices, own keys, secure UUID, abort and listener removal',async()=>{
 class LegacyTarget extends EventTarget {addEventListener(type,fn,options){const {signal,...rest}=typeof options==='object'?options:{};return super.addEventListener(type,fn,typeof options==='boolean'?options:rest);}}
 class Dom {append(...nodes){this.nodes=nodes;}appendChild(child){this.nodes=child.nodes;}}
 const context=vm.createContext({Element:Dom,Document:Dom,DocumentFragment:Dom,document:{createDocumentFragment:()=>new Dom()},crypto:{getRandomValues:bytes=>webcrypto.getRandomValues(bytes)},EventTarget:LegacyTarget,Event,AbortController});
 vm.runInContext('Array.prototype.at=undefined;Object.hasOwn=undefined;',context);
 vm.runInContext(await readFile(new URL('../public/browser-compat.js',import.meta.url),'utf8'),context);
 assert.equal(vm.runInContext('[10,20].at(-1)',context),20);
 assert.equal(vm.runInContext('[10].at(Infinity)',context),undefined);
 assert.equal(vm.runInContext('Object.hasOwn(Object.create({x:1}),"x")',context),false);
 assert.match(vm.runInContext('crypto.randomUUID()',context),/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/);
 assert.equal(vm.runInContext(`(()=>{const t=new EventTarget(),a=new AbortController();let count=0;const fn=()=>count++;t.addEventListener('a',fn,{signal:a.signal});t.dispatchEvent(new Event('a'));a.abort();t.dispatchEvent(new Event('a'));return count;})()`,context),1);
 assert.equal(vm.runInContext(`(()=>{const t=new EventTarget(),a=new AbortController();let count=0;const fn=()=>count++;t.addEventListener('a',fn,{signal:a.signal});t.removeEventListener('a',fn);t.dispatchEvent(new Event('a'));return count;})()`,context),0);
});
test('manifest and build share the requested Builda reference target',async()=>{
 const manifest=JSON.parse(await readFile(new URL('../builda.publish.json',import.meta.url),'utf8'));
 for(const [key,value]of Object.entries(browserTarget))assert.equal(manifest[key],value);
});
