// Incremental, serializable A*. Static graph/patrol trees are baked offline.
const MAX_NODES=2048,MAX_HEAP=4096,MAX_PATH=1024;
const heapPush=(heap,item)=>{heap.push(item);let i=heap.length-1;while(i){const p=(i-1)>>1;if(heap[p][1]<item[1]||(heap[p][1]===item[1]&&heap[p][0]<=item[0]))break;heap[i]=heap[p];i=p;}heap[i]=item;};
const heapPop=heap=>{const first=heap[0],last=heap.pop();if(heap.length){let i=0;while(i*2+1<heap.length){let c=i*2+1;if(c+1<heap.length&&(heap[c+1][1]<heap[c][1]||(heap[c+1][1]===heap[c][1]&&heap[c+1][0]<heap[c][0])))c++;if(last[1]<heap[c][1]||(last[1]===heap[c][1]&&last[0]<=heap[c][0]))break;heap[i]=heap[c];i=c;}heap[i]=last;}return first;};
export class GuardPlanner {
  constructor(nav,routing,{cellPaths=false}={}){this.nav=nav;this.routing=routing;this.cellPaths=cellPaths;}
  routePath(cells){return this.cellPaths?cells.slice():cells.map(i=>this.nav.point(i));}
  cell(p){const [x,z]=this.nav.cell(p),i=this.nav.index(x,z);return this.nav.valid(i)?i:this.nav.nearest(p,2);}
  heuristic(a,b){const x=Math.abs(a%this.nav.width-b%this.nav.width),z=Math.abs(Math.floor(a/this.nav.width)-Math.floor(b/this.nav.width));return 1000*Math.max(x,z)+414*Math.min(x,z);}
  neighbor(i,bit){return i+(Math.floor(bit/3)-1)*this.nav.width+bit%3-1;}
  linked(a,b){const dx=b%this.nav.width-a%this.nav.width,dz=Math.floor(b/this.nav.width)-Math.floor(a/this.nav.width);return Math.abs(dx)<=1&&Math.abs(dz)<=1&&!!(this.routing.edges[a]&(1<<((dz+1)*3+dx+1)));}
  direct(a,b){
    if(a<0||b<0)return null;const result=[a];let current=a;
    for(let k=0;k<256&&current!==b;k++){const dx=b%this.nav.width-current%this.nav.width,dz=Math.floor(b/this.nav.width)-Math.floor(current/this.nav.width),next=current+Math.sign(dz)*this.nav.width+Math.sign(dx);if(!this.linked(current,next))return null;result.push(next);current=next;}
    return current===b?result:null;
  }
  treePath(tree,a,b){
    if(tree.parents[a]===undefined||tree.parents[b]===undefined)return null;const left=[],seen={};let n=a;
    for(let k=0;k<MAX_PATH;k++){seen[n]=left.length;left.push(n);if(n===tree.root)break;n=tree.parents[n];}
    const right=[];n=b;for(let k=0;k<MAX_PATH;k++){if(seen[n]!==undefined)return left.slice(0,seen[n]+1).concat(right.reverse());right.push(n);n=tree.parents[n];if(n===undefined)return null;}
    return null;
  }
  state(brain){return brain.navigationState??= {job:null,cached:null,failedGoal:-1,retryAt:0,clock:0,wait:0};}
  cancel(brain){const s=this.state(brain);s.job=null;}
  patrolPath(brain){
    const s=this.state(brain),tree=this.routing.patrols.find(t=>t.zone===brain.definition.zone),start=this.cell(brain.position);if(!tree)return null;
    const candidates=tree.candidates.filter(c=>this.heuristic(start,c)>Math.max(3000,brain.rules.RoamArriveDistance/this.nav.step*1000+2000));if(!candidates.length)return null;
    const goal=candidates[Math.min(candidates.length-1,Math.floor(brain.random()*candidates.length))],path=this.treePath(tree,start,goal);if(!path)return null;s.job=null;return this.routePath(path);
  }
  route(brain,target){
    const s=this.state(brain),a=this.cell(brain.position),b=this.cell(target);if(a<0||b<0)return {status:'failed'};
    if(s.job&&s.job.target!==(brain.target||null))s.job=null;
    if(this.routing.components[a]!==this.routing.components[b]){s.job=null;return {status:'failed'};}
    const cached=s.cached;
    if(cached&&cached.goal===b&&(!s.job||s.job.status==='pending')){const join=cached.path.indexOf(a);if(join>=0)return {status:'ready',path:this.routePath(cached.path.slice(join))};}
    // Cheap, edge-validated fast path; never smooth through thin posts or closed corners.
    const straight=this.direct(a,b);if(straight){s.job=null;s.cached={goal:b,path:straight};return {status:'ready',path:this.routePath(straight)};}
    if(brain.state==='Returning'){const tree=this.routing.patrols.find(t=>t.zone===brain.definition.zone),path=tree&&this.treePath(tree,a,b);if(path){s.job=null;return {status:'ready',path:this.routePath(path)};}}
    if(s.job?.status==='ready'){
      const path=s.job.path;let joined=path.indexOf(a),prefix=null;
      if(joined<0){for(let i=0;i<path.length;i++)if(this.heuristic(a,path[i])<=3000){prefix=this.direct(a,path[i]);if(prefix){joined=i;break;}}}
      if(joined>=0){const cells=prefix?prefix.concat(path.slice(joined+1)):path.slice(joined);s.cached={goal:s.job.goal,path:cells};s.job=null;return {status:'ready',path:this.routePath(cells)};}
      s.job=null;
    }
    if(s.job?.status==='failed'){s.failedGoal=s.job.goal;s.retryAt=s.clock+.75;s.job=null;}
    if(s.failedGoal===b&&s.clock<s.retryAt){const join=cached?.goal===b?cached.path.indexOf(a):-1;return join>=0?{status:'ready',path:this.routePath(cached.path.slice(join))}:{status:'failed'};}
    // Finish the current request for the same actor instead of starving it whenever
    // a running target changes cells. A completed corridor is repaired at the agent.
    if(s.job&&s.job.target===(brain.target||null))return {status:'pending'};
    s.job={start:a,goal:b,target:brain.target||null,status:'pending',heap:[[a,this.heuristic(a,b),0]],nodes:{[a]:[0,-1,0]},count:1,pops:0,path:null};s.wait=0;
    // A prevalidated tree corridor gets a stationary agent moving immediately;
    // incremental A* can shorten that corridor without blocking locomotion.
    if(!brain.path?.length){const tree=this.routing.patrols.find(t=>t.zone===brain.definition.zone),fallback=tree&&this.treePath(tree,a,b);if(fallback){s.cached={goal:b,path:fallback};return {status:'ready',path:this.routePath(fallback)};}}
    return {status:'pending'};
  }
  step(job,budget){
    let spent=0;
    while(job.status==='pending'&&job.heap.length&&spent<budget){
      const [i,,cost]=heapPop(job.heap);spent++;job.pops++;const record=job.nodes[i];if(record[2]||record[0]!==cost)continue;
      if(i===job.goal){const path=[];let n=i;for(let k=0;k<MAX_PATH&&n>=0;k++){path.push(n);n=job.nodes[n][1];}if(n>=0){job.status='failed';break;}job.path=path.reverse();job.status='ready';job.heap=[];job.nodes={};break;}
      record[2]=1;
      for(let bit=0;bit<9;bit++)if(this.routing.edges[i]&(1<<bit)){
        const n=this.neighbor(i,bit),g=cost+(bit%3!==1&&Math.floor(bit/3)!==1?1414:1000),old=job.nodes[n];if(old&&old[0]<=g)continue;
        if((!old&&job.count>=MAX_NODES)||job.heap.length>=MAX_HEAP){job.status='failed';break;}
        if(!old)job.count++;job.nodes[n]=[g,i,0];heapPush(job.heap,[n,g+this.heuristic(n,job.goal),g]);
      }
    }
    if(job.status==='pending'&&!job.heap.length)job.status='failed';return spent;
  }
  advance(brains,dt,budget=600){
    const jobs=[];for(const brain of brains){const s=this.state(brain);s.clock+=dt;if(s.job?.status==='pending'){s.wait++;jobs.push({brain,s});}}
    const metrics={pops:0,jobs:jobs.length};
    // Every queued guard receives progress before remaining work is prioritized.
    for(const {s} of jobs){const spent=this.step(s.job,Math.min(24,budget));budget-=spent;metrics.pops+=spent;}
    jobs.sort((a,b)=>Number(b.brain.state==='Chasing')-Number(a.brain.state==='Chasing')||b.s.wait-a.s.wait||a.brain.definition.zone-b.brain.definition.zone);
    while(budget>0){let progress=0;for(const {s} of jobs){if(budget<=0)break;const spent=this.step(s.job,Math.min(120,budget));budget-=spent;metrics.pops+=spent;progress+=spent;}if(!progress)break;}
    return metrics;
  }
}
