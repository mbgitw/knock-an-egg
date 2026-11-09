import {GuardBrain} from './rules/gameplay/guard-brain.ts';
import {GuardNavigation} from './rules/gameplay/guard-navigation.ts';
import {GuardPlanner} from './rules/gameplay/guard-planner.ts';
import routing from './data/guard-routing.ts';
import catalog from './data/guards.ts';
import navigation from './data/navigation.ts';
import {Vector3} from './math.ts';
const nav:any=new GuardNavigation(navigation);
const planner:any=new GuardPlanner(nav,routing,{cellPaths:true});
const brainNav=Object.assign(Object.create(nav),{patrolPath:(b:any)=>planner.patrolPath(b),route:(b:any,t:any)=>planner.route(b,t),cancel:(b:any)=>planner.cancel(b)});
export function createGuards(random:()=>number,onCatch:(guard:any,target:any)=>void,saved:any[]=[]){
  return catalog.guards.map((d:any,i:number)=>{
    const brain:any=new (GuardBrain as any)(d,catalog.rules,brainNav,{random:saved[i]?()=>0:random,onCatch,groundHeight:(p:any)=>{const cell=nav.nearest(p,1);return cell<0?NaN:nav.point(cell).y;},canMove:(p:any)=>{const [x,z]=nav.cell(p);return nav.valid(nav.index(x,z));},lineOfSight:(a:any,b:any)=>{const steps=Math.min(128,Math.ceil(a.distanceTo(b)));for(let k=0;k<=steps;k++){const [x,z]=nav.cell({x:a.x+(b.x-a.x)*k/Math.max(1,steps),z:a.z+(b.z-a.z)*k/Math.max(1,steps)});if(!nav.valid(nav.index(x,z)))return false;}return true;}});
    if(saved[i]){const s=saved[i];Object.assign(brain,s);brain.position=new Vector3().copy(s.position);if(s.destination)brain.destination=new Vector3().copy(s.destination);}
    brain.random=random;
    return brain;
  });
}
export function saveGuards(brains:any[]){return brains.map(b=>({position:{...b.position},yaw:b.yaw,state:b.state,timer:b.timer,path:b.path.map((p:any)=>typeof p==='number'?p:{...p}),speed:b.speed,repath:b.repath,blocked:b.blocked,destination:b.destination?{...b.destination}:null,target:b.target||null,navigationState:b.navigationState||null}));}
export function chooseTarget(brain:any,targets:any[]){
  // Carry origin selects the guard; crossing a zone boundary does not end a
  // chase or prevent reacquiring an animal picked up outside its source zone.
  const eligible=targets.filter(t=>brain.eligible(t));
  return eligible.find(t=>t.id===brain.target)||eligible.sort((a,b)=>brain.position.distanceTo(a.position)-brain.position.distanceTo(b.position)||a.id.localeCompare(b.id))[0]||null;
}
export function updateGuards(brains:any[],targets:any[],dt:number){
  const work=brains.map(b=>({b,target:chooseTarget(b,targets)}));
  work.sort((a,b)=>Number(!!b.target)-Number(!!a.target));
  for(const {b,target} of work){b.target=target?.id||null;for(let i=0;i<2;i++)b.update(Math.min(.05,dt/2),target);}
  return planner.advance(brains,dt);
}
