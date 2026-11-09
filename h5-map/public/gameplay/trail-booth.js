import {t,onLanguageChange} from '../i18n.js';
import * as THREE from 'three';
export const TRAIL_BOOTH_PATH='/Workspace/Booths/Trails Shop/';
export const trailBoothCollisionParts=parts=>parts.filter(p=>p.path.startsWith(TRAIL_BOOTH_PATH+'Build/')&&p.className==='Part').map(p=>({...p,collide:true}));
export function createTrailRoof(parts){
  const root=new THREE.Group();root.name='Trails Shop authored-size canopy reconstruction';
  const front=parts.find(p=>p.node===27934),back=parts.find(p=>p.node===27935);
  const f=new THREE.Vector3(front.matrix[3],front.matrix[7]+.3,front.matrix[11]);
  const b=new THREE.Vector3(back.matrix[3],back.matrix[7]+.3,back.matrix[11]);
  const width=new THREE.Vector3(.5,0,-.8660254),direction=b.clone().sub(f),length=direction.length();direction.normalize();
  const normal=new THREE.Vector3().crossVectors(direction,width).normalize();if(normal.y<0)normal.negate();
  const rotation=new THREE.Matrix4().makeBasis(direction,normal,new THREE.Vector3().crossVectors(direction,normal));
  for(let i=0;i<9;i++){
    const material=new THREE.MeshStandardMaterial({color:i%2?0xf4f4f4:0x00ff00,roughness:.85,side:THREE.DoubleSide});
    const roof=new THREE.Mesh(new THREE.BoxGeometry(length+.5,.18,1.5),material);
    roof.position.copy(f).lerp(b,.5).addScaledVector(width,(i-4)*1.5);roof.quaternion.setFromRotationMatrix(rotation);root.add(roof);
    const shape=new THREE.Shape();shape.moveTo(-.75,0);shape.lineTo(.75,0);shape.lineTo(.75,-.65);shape.quadraticCurveTo(0,-1.25,-.75,-.65);shape.closePath();
    const fringe=new THREE.Mesh(new THREE.ExtrudeGeometry(shape,{depth:.12,bevelEnabled:false,curveSegments:8}),material);
    fringe.position.copy(f).addScaledVector(width,(i-4)*1.5).addScaledVector(direction,-.25);fringe.rotation.y=Math.PI/3;root.add(fringe);
  }
  return root;
}
export function createTrailBooth(data,{includeExisting=false}={}){
  const root=new THREE.Group();root.name='Trails Shop';
  if(includeExisting){
    for(const spec of data.meshes){
      const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.Float32BufferAttribute(spec.position,3));geometry.setAttribute('normal',new THREE.Float32BufferAttribute(spec.normal,3));
      if(spec.uv)geometry.setAttribute('uv',new THREE.Float32BufferAttribute(spec.uv,2));
      const m=spec.material,material=new THREE.MeshStandardMaterial({color:new THREE.Color().setRGB(...m.color),roughness:.9,opacity:m.opacity??1,transparent:m.opacity<1,side:THREE.DoubleSide});
      if(m.texture){material.map=new THREE.TextureLoader().load('/gameplay/trails/booth/'+m.texture);material.map.colorSpace=THREE.SRGBColorSpace;material.map.wrapS=material.map.wrapT=THREE.RepeatWrapping;}
      root.add(new THREE.Mesh(geometry,material));
    }
  }
  root.add(createTrailRoof(data.parts));
  const ring=data.parts.find(p=>p.name==='Ring'),cylinder=data.parts.find(p=>p.name==='GradientCylinder');
  const mesh=new THREE.Mesh(new THREE.RingGeometry(8.412,9.013,96),new THREE.MeshBasicMaterial({color:0x37ff00,transparent:true,opacity:.5,side:THREE.DoubleSide,depthWrite:false}));
  mesh.rotation.x=-Math.PI/2;mesh.position.set(ring.matrix[3],ring.matrix[7],ring.matrix[11]);root.add(mesh);
  const glow=new THREE.Mesh(new THREE.CylinderGeometry(cylinder.size[0]/2,cylinder.size[0]/2,cylinder.size[1],64,1,true),new THREE.ShaderMaterial({transparent:true,depthWrite:false,side:THREE.DoubleSide,vertexShader:'varying vec2 vUv;void main(){vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}',fragmentShader:'varying vec2 vUv;void main(){gl_FragColor=vec4(.2157,1.,0.,.28*(1.-vUv.y));}'}));
  glow.position.set(cylinder.matrix[3],cylinder.matrix[7],cylinder.matrix[11]);root.add(glow);return root;
}
export async function createTrailSign(){
  await document.fonts.load('800 80px OriginalGotham');
  const canvas=document.createElement('canvas');canvas.width=1024;canvas.height=154;
  const c=canvas.getContext('2d');
  const sprite=new THREE.Sprite(new THREE.SpriteMaterial({map:new THREE.CanvasTexture(canvas),depthTest:true,depthWrite:false,toneMapped:false}));sprite.scale.set(20,3,1);
  const paint=()=>{c.clearRect(0,0,1024,154);c.font='800 106px Arial, sans-serif';c.textAlign='center';c.textBaseline='middle';c.lineJoin='round';c.lineWidth=11;c.strokeStyle='#000';c.fillStyle='#a6ff27';c.strokeText(t('Trails Shop'),512,77,990);c.fillText(t('Trails Shop'),512,77,990);sprite.material.map.needsUpdate=true;};paint();onLanguageChange(paint);
  sprite.position.set(-66.7981186,12.03086281,-59.238945);sprite.name='Trails Shop billboard';return sprite;
}
