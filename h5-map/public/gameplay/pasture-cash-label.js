import * as THREE from 'three';

// AnimalCashGainPopup/BillboardGui: Size = 10 x 1 studs,
// MaxDistance = 200, AlwaysOnTop = true. No screen-space DOM overlay.
export const CASH_LABEL_MAX_DISTANCE=200;
export function cashLabelInRange(cameraPosition,animalPosition){
  return cameraPosition.distanceToSquared(animalPosition)<=CASH_LABEL_MAX_DISTANCE**2;
}
export class PastureCashLabel {
  constructor(scene,model){
    this.model=model;this.anchor=new THREE.Vector3();this.cameraPosition=new THREE.Vector3();
    this.canvas=document.createElement('canvas');this.canvas.width=1280;this.canvas.height=128;
    this.context=this.canvas.getContext('2d');
    this.texture=new THREE.CanvasTexture(this.canvas);this.texture.colorSpace=THREE.SRGBColorSpace;
    this.material=new THREE.SpriteMaterial({map:this.texture,transparent:true,depthTest:false,depthWrite:false,sizeAttenuation:true,toneMapped:false});
    this.sprite=new THREE.Sprite(this.material);this.sprite.name='AnimalCashGain';this.sprite.renderOrder=10000;
    this.sprite.scale.set(10,1,1);scene.add(this.sprite);
    const box=new THREE.Box3().setFromObject(model);
    this.headHeight=Math.max(0,box.max.y-model.getWorldPosition(this.anchor).y);
    this.text=null;
  }
  update(camera,text,phase){
    this.model.getWorldPosition(this.anchor);camera.getWorldPosition(this.cameraPosition);
    this.sprite.visible=this.model.visible&&cashLabelInRange(this.cameraPosition,this.anchor);
    this.sprite.position.copy(this.anchor);this.sprite.position.y+=this.headHeight+1+phase*1.5;
    if(text===this.text)return;this.text=text;
    const c=this.context;c.clearRect(0,0,this.canvas.width,this.canvas.height);
    c.font='bold 104px sans-serif';c.textAlign='center';c.textBaseline='middle';c.lineJoin='round';
    c.strokeStyle='#000';c.lineWidth=10;c.fillStyle='#8bff37';
    c.strokeText(text,640,64,1240);c.fillText(text,640,64,1240);this.texture.needsUpdate=true;
  }
  remove(){this.sprite.removeFromParent();this.material.dispose();this.texture.dispose();}
}
