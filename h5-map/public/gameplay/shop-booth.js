import {t,onLanguageChange} from '../i18n.js';
import * as THREE from 'three';

export const BOOTH_PATH='/Workspace/Booths/Pickaxe Shop/';
export function partMatrix(p){return new THREE.Matrix4().set(...p.matrix.slice(0,4),...p.matrix.slice(4,8),...p.matrix.slice(8,12),0,0,0,1);}

// The original controller tests the character root against this oriented box,
export class BoothTrigger {
  constructor(part){this.inverse=partMatrix(part).invert();this.half=new THREE.Vector3(...part.size).multiplyScalar(.5);this.inside=false;this.local=new THREE.Vector3();}
  contains(feet,margin=0){const p=this.local.copy(feet).add(new THREE.Vector3(0,2.7,0)).applyMatrix4(this.inverse);return Math.abs(p.x)<=this.half.x+margin&&Math.abs(p.y)<=this.half.y+margin&&Math.abs(p.z)<=this.half.z+margin;}
  update(feet){const inside=this.contains(feet,this.inside?.25:0);if(inside===this.inside)return null;this.inside=inside;return inside?'enter':'leave';}
}

export function boothCollisionParts(parts){
  // Thin counters and posts retain their authored rotated dimensions. Do not
  // turn the entire booth bounding box or its light ring into an invisible wall.
  return parts.filter(p=>p.path.startsWith(BOOTH_PATH+'Build/')&&p.className==='Part').map(p=>({...p,collide:true}));
}

export function createBoothRoof(parts){
  const root=new THREE.Group();root.name='Shop awning reconstruction';
  const front=parts.find(p=>p.node===27976),back=parts.find(p=>p.node===27991);
  const f=new THREE.Vector3(front.matrix[3],front.matrix[7]+.3,front.matrix[11]);
  const b=new THREE.Vector3(back.matrix[3],back.matrix[7]+.3,back.matrix[11]);
  const width=new THREE.Vector3(.5,0,.8660254),direction=b.clone().sub(f);
  const length=direction.length();direction.normalize();
  const normal=new THREE.Vector3().crossVectors(direction,width).normalize();if(normal.y<0)normal.negate();
  const rotation=new THREE.Matrix4().makeBasis(direction,normal,new THREE.Vector3().crossVectors(direction,normal));
  for(let i=0;i<9;i++){
    const material=new THREE.MeshStandardMaterial({color:i%2?0xf4f4f4:0x0091ff,roughness:.85,side:THREE.DoubleSide});
    const roof=new THREE.Mesh(new THREE.BoxGeometry(length+.5,.18,1.5),material);
    roof.position.copy(f).lerp(b,.5).addScaledVector(width,(i-4)*1.5);roof.quaternion.setFromRotationMatrix(rotation);root.add(roof);
    // Scalloped valance on the open front, derived from the missing 1.5-wide strips.
    const shape=new THREE.Shape();shape.moveTo(-.75,0);shape.lineTo(.75,0);shape.lineTo(.75,-.65);shape.quadraticCurveTo(0,-1.25,-.75,-.65);shape.closePath();
    const fringe=new THREE.Mesh(new THREE.ExtrudeGeometry(shape,{depth:.12,bevelEnabled:false,curveSegments:8}),material);
    fringe.position.copy(f).addScaledVector(width,(i-4)*1.5).addScaledVector(direction,-.25);fringe.rotation.y=Math.PI/3;root.add(fringe);
  }
  return root;
}

export async function loadBoothData(){const r=await fetch('gameplay/shop-booth/model.json');if(!r.ok)throw Error('镐子摊位资源加载失败');return r.json();}

export function createBoothModel(data,{includeExisting=false}={}){
  const root=new THREE.Group();root.name='Pickaxe Shop';
  if(includeExisting){
    const loader=new THREE.TextureLoader();
    for(const spec of data.meshes){
      const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.Float32BufferAttribute(spec.position,3));geometry.setAttribute('normal',new THREE.Float32BufferAttribute(spec.normal,3));
      if(spec.uv)geometry.setAttribute('uv',new THREE.Float32BufferAttribute(spec.uv,2));
      const m=spec.material,material=new THREE.MeshStandardMaterial({color:new THREE.Color().setRGB(...m.color),roughness:.9,opacity:m.opacity??1,transparent:m.opacity<1,side:THREE.DoubleSide});
      if(m.texture){material.map=loader.load('/gameplay/shop-booth/'+m.texture);material.map.colorSpace=THREE.SRGBColorSpace;material.map.wrapS=material.map.wrapT=THREE.RepeatWrapping;}
      const mesh=new THREE.Mesh(geometry,material);mesh.name=spec.name;root.add(mesh);
    }
  }
  root.add(createBoothRoof(data.parts));
  const ring=data.parts.find(p=>p.name==='Ring');
  const mesh=new THREE.Mesh(new THREE.RingGeometry(8.412,9.013,96),new THREE.MeshBasicMaterial({color:0x00aeff,transparent:true,opacity:.5,side:THREE.DoubleSide,depthWrite:false}));
  mesh.rotation.x=-Math.PI/2;mesh.position.set(ring.matrix[3],ring.matrix[7],ring.matrix[11]);root.add(mesh);
  const cylinder=data.parts.find(p=>p.name==='GradientCylinder');
  const geometry=new THREE.CylinderGeometry(cylinder.size[0]/2,cylinder.size[0]/2,cylinder.size[1],64,1,true);
  const material=new THREE.ShaderMaterial({transparent:true,depthWrite:false,side:THREE.DoubleSide,vertexShader:'varying vec2 vUv;void main(){vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}',fragmentShader:'varying vec2 vUv;void main(){gl_FragColor=vec4(0.,.65,1.,.28*(1.-vUv.y));}'});
  const glow=new THREE.Mesh(geometry,material);glow.position.set(cylinder.matrix[3],cylinder.matrix[7],cylinder.matrix[11]);root.add(glow);
  return root;
}

export async function createBoothSign(data){
  await document.fonts.load('800 80px OriginalGotham');
  const canvas=document.createElement('canvas');canvas.width=1024;canvas.height=154;
  const c=canvas.getContext('2d');
  const sprite=new THREE.Sprite(new THREE.SpriteMaterial({map:new THREE.CanvasTexture(canvas),depthTest:true,depthWrite:false,toneMapped:false}));sprite.scale.set(20,3,1);
  const paint=()=>{c.clearRect(0,0,1024,154);c.font='800 106px Arial, sans-serif';c.textAlign='center';c.textBaseline='middle';c.lineJoin='round';c.lineWidth=11;c.strokeStyle='#000';c.fillStyle='#00dfff';c.strokeText(t('Pickaxe Shop'),512,77,990);c.fillText(t('Pickaxe Shop'),512,77,990);sprite.material.map.needsUpdate=true;};paint();onLanguageChange(paint);
  // Model.WorldPivotData + OverheadUi.CFrame(identity) + StudsOffset(0,5,0).
  sprite.position.set(-69.3525391,12.03186226,65.9584045);sprite.name='Pickaxe Shop authored billboard';return sprite;
}
