import {animalSellValue} from './animal-attributes.js';
import {speciesOf} from './pickaxe-state.js';

export const MAX_PETS=250,MAX_SELL=200;
/** Persist hotbar placement; only legacy saves without layout auto-fill existing pets. */
export class BackpackLayout {
  constructor(pets,slots=10,saved=null){
    this.limit=slots;this.known=new Set(pets.map(p=>p.id));const seen=new Set();
    const items=Array.isArray(saved)?saved:pets.map(p=>p.id);
    this.slots=['pickaxe','weapon',...Array.from({length:slots-2},(_,i)=>{const id=items[i];if(!this.known.has(id)||seen.has(id))return null;seen.add(id);return id;})];
  }
  sync(pets){
    const ids=new Set(pets.map(p=>p.id));
    this.slots=this.slots.map((id,i)=>i<2||ids.has(id)?id:null);
    for(const pet of pets)if(!this.known.has(pet.id)){const free=this.slots.indexOf(null);if(free>=0)this.slots[free]=pet.id;}
    this.known=ids;
  }
  resize(limit){this.limit=limit;this.slots.length=Math.min(limit,this.slots.length);while(this.slots.length<limit)this.slots.push(null);}
  move(id,index){
    if(!this.known.has(id)||index!==null&&(!Number.isInteger(index)||index<2||index>=this.limit))return false;
    const old=this.slots.indexOf(id);
    if(index===null){if(old>=0)this.slots[old]=null;return true;}
    const other=this.slots[index];if(old>=0)this.slots[old]=other;this.slots[index]=id;return true;
  }
  inventory(pets){return pets.filter(p=>!this.slots.includes(p.id));}
}
export const petSellValue=animalSellValue;
export function saleSelection(pets,ids){
  const selected=new Set(ids);if(selected.size>MAX_SELL)return {pets:[],total:0n};
  const rows=pets.filter(p=>selected.has(p.id)&&speciesOf(p.name));
  return {pets:rows,total:rows.reduce((sum,p)=>sum+petSellValue(p),0n)};
}
