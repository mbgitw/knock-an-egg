// Room仅需刚体变换和三维点，不引入渲染引擎。
export class Vector3{
  constructor(public x=0,public y=0,public z=0){}
  copy(p:{x:number;y:number;z:number}){this.x=p.x;this.y=p.y;this.z=p.z;return this;}
  clone(){return new Vector3(this.x,this.y,this.z);}
  distanceTo(p:Vector3){return Math.hypot(this.x-p.x,this.y-p.y,this.z-p.z);}
  applyMatrix4(matrix:Matrix4){const m=matrix.values,{x,y,z}=this;this.x=m[0]*x+m[1]*y+m[2]*z+m[3];this.y=m[4]*x+m[5]*y+m[6]*z+m[7];this.z=m[8]*x+m[9]*y+m[10]*z+m[11];return this;}
}
export class Matrix4{
  values=[1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1];
  set(...values:number[]){this.values=values;return this;}
  makeRotationY(a:number){const c=Math.cos(a),s=Math.sin(a);return this.set(c,0,s,0,0,1,0,0,-s,0,c,0,0,0,0,1);}
  setPosition(p:Vector3){this.values[3]=p.x;this.values[7]=p.y;this.values[11]=p.z;return this;}
  multiply(other:Matrix4){const a=this.values,b=other.values,result=Array(16).fill(0);for(let r=0;r<4;r++)for(let c=0;c<4;c++)for(let k=0;k<4;k++)result[r*4+c]+=a[r*4+k]*b[k*4+c];this.values=result;return this;}
  invert(){const m=this.values,tx=m[3],ty=m[7],tz=m[11];return this.set(m[0],m[4],m[8],-(m[0]*tx+m[4]*ty+m[8]*tz),m[1],m[5],m[9],-(m[1]*tx+m[5]*ty+m[9]*tz),m[2],m[6],m[10],-(m[2]*tx+m[6]*ty+m[10]*tz),0,0,0,1);}
}
