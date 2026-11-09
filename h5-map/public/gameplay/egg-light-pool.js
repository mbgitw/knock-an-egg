import * as THREE from 'three';

// Keep the shader's point-light count constant as eggs enter/leave the view.
// Empty slots stay visible with zero intensity; hiding/removing a light would
// change NUM_POINT_LIGHTS and recompile every lit material during movement.
export class EggLightPool {
  constructor(scene,capacity=4){
    this.lights=Array.from({length:capacity},()=>{
      const light=new THREE.PointLight(0xffffff,0,1,2);
      light.name='Egg ambient light slot';scene.add(light);return light;
    });
    this.candidates=[];this.scale=new THREE.Vector3();
  }
  begin(){this.candidates.length=0;}
  consider(egg,data,distance){
    if(!data)return;
    for(const node of data.nodes){
      if(node.class!=='PointLight'||node.properties.Enabled!=='true')continue;
      let index=this.candidates.findIndex(c=>distance<c.distance);
      if(index<0)index=this.candidates.length;
      if(index>=this.lights.length)continue;
      this.candidates.splice(index,0,{egg,node,distance,bodyHeight:data.bodyHeight});
      if(this.candidates.length>this.lights.length)this.candidates.pop();
    }
  }
  update(){
    for(let i=0;i<this.lights.length;i++){
      const light=this.lights[i],entry=this.candidates[i];
      if(!entry){light.intensity=0;continue;}
      const {egg,node,bodyHeight}=entry,p=node.properties,c=p.Color;
      egg.shell.updateWorldMatrix(true,false);
      light.position.set(node.matrix[3],node.matrix[7],node.matrix[11]).applyMatrix4(egg.shell.matrixWorld);
      egg.shell.getWorldScale(this.scale);
      light.color.setRGB(Number(c.R),Number(c.G),Number(c.B));
      light.distance=Number(p.Range)/bodyHeight*Math.max(this.scale.x,this.scale.y,this.scale.z);
      light.intensity=Number(p.Brightness);
    }
  }
  dispose(){for(const light of this.lights){light.removeFromParent();light.dispose();}this.candidates.length=0;}
}
