// Pointer ownership is fixed at touch-down, even if a finger crosses the midpoint.
export class MobileGestures {
  constructor(){this.points=new Map();this.moveId=null;}
  down(id,x,y,mid){const role=x<mid?(this.moveId===null?'move':'ignore'):'camera';if(role==='move')this.moveId=id;this.points.set(id,{x,y,startX:x,startY:y,role});}
  move(id,x,y){const p=this.points.get(id);if(!p)return null;const cameras=[...this.points.values()].filter(p=>p.role==='camera').slice(0,2);
    const before=cameras.length===2?Math.hypot(cameras[0].x-cameras[1].x,cameras[0].y-cameras[1].y):0;
    const dx=x-p.x,dy=y-p.y;p.x=x;p.y=y;
    if(p.role==='move')return {kind:'move',x:(x-p.startX)/55,y:(y-p.startY)/55,startX:p.startX,startY:p.startY};
    if(p.role!=='camera')return null;
    if(cameras.length===2){if(!cameras.includes(p))return null;const after=Math.hypot(cameras[0].x-cameras[1].x,cameras[0].y-cameras[1].y);return {kind:'zoom',ratio:before>5&&after>5?before/after:1};}
    return {kind:'rotate',dx,dy};
  }
  up(id){const move=id===this.moveId;this.points.delete(id);if(move)this.moveId=null;return move;}
  clear(){this.points.clear();this.moveId=null;}
}
