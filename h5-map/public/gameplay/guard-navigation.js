// A* over sampled capsule clearance. Diagonals require both side cells; all
// movement follows adjacent cells, so thin posts cannot be skipped by smoothing.
export class GuardNavigation {
  constructor(data){Object.assign(this,data);this.openCells=[];for(let i=0;i<this.heights.length;i++)if(this.heights[i]!==null)this.openCells.push(i);}
  beginWork(visits,searches){this.workBudget={visits,searches};}
  cell(p){return [Math.round((p.x-this.x)/this.step),Math.round((p.z-this.z)/this.step)];}
  index(x,z){return x>=0&&z>=0&&x<this.width&&z<this.depth?z*this.width+x:-1;}
  valid(i){return i>=0&&this.heights[i]!==null;}
  point(i){return {x:this.x+i%this.width*this.step,y:this.heights[i],z:this.z+Math.floor(i/this.width)*this.step};}
  nearest(p,limit=12){
    const [x,z]=this.cell(p);let best=-1,dist=Infinity;
    for(let dz=-limit;dz<=limit;dz++)for(let dx=-limit;dx<=limit;dx++){
      const i=this.index(x+dx,z+dz);if(!this.valid(i))continue;
      const q=this.point(i),d=(q.x-p.x)**2+(q.z-p.z)**2+(q.y-p.y)**2;
      if(d<dist){best=i;dist=d;}
    }return best;
  }
  neighbors(i){
    const x=i%this.width,z=Math.floor(i/this.width),result=[];
    for(let dz=-1;dz<=1;dz++)for(let dx=-1;dx<=1;dx++){
      if(!dx&&!dz)continue;const n=this.index(x+dx,z+dz);
      if(!this.valid(n)||Math.abs(this.heights[n]-this.heights[i])>2.5)continue;
      if(dx&&dz&&(!this.valid(this.index(x+dx,z))||!this.valid(this.index(x,z+dz))))continue;
      // Baking records swept capsule clearance, not just endpoint clearance.
      if(this.edges&&!(this.edges[i]&(1<<((dz+1)*3+dx+1))))continue;
      result.push([n,dx&&dz?Math.SQRT2:1]);
    }return result;
  }
  path(start,end,allow=()=>true){
    if(this.workBudget){if(this.workBudget.visits<=0||this.workBudget.searches<=0)return [];this.workBudget.searches--;}
    const a=this.nearest(start),b=this.nearest(end);if(a<0||b<0)return [];
    const heap=[],g=new Map([[a,0]]),parents=new Map(),closed=new Set();
    const h=i=>Math.hypot(i%this.width-b%this.width,Math.floor(i/this.width)-Math.floor(b/this.width));
    const push=(i,f)=>{heap.push([i,f]);let k=heap.length-1;while(k){const p=(k-1)>>1;if(heap[p][1]<=f)break;[heap[k],heap[p]]=[heap[p],heap[k]];k=p;}};
    const pop=()=>{const top=heap[0],last=heap.pop();if(heap.length){heap[0]=last;let k=0;for(;;){let n=k,l=k*2+1,r=l+1;if(l<heap.length&&heap[l][1]<heap[n][1])n=l;if(r<heap.length&&heap[r][1]<heap[n][1])n=r;if(n===k)break;[heap[k],heap[n]]=[heap[n],heap[k]];k=n;}}return top[0];};
    push(a,h(a));
    while(heap.length&&(!this.workBudget||this.workBudget.visits>0)){const i=pop();if(closed.has(i))continue;
      if(i===b){const path=[i];while(parents.has(path[0]))path.unshift(parents.get(path[0]));return path.map(n=>this.point(n));}
      closed.add(i);
      if(this.workBudget)this.workBudget.visits--;
      for(const [n,cost] of this.neighbors(i)){if(!allow(this.point(n)))continue;const score=g.get(i)+cost;if(score<(g.get(n)??Infinity)){parents.set(n,i);g.set(n,score);push(n,score+h(n));}}
    }return [];
  }
}
