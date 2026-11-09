import {EGG_CONFIG as original} from './config.js';
import {V2_EGGS} from './v2-replacements.js';
const replacements=new Map(V2_EGGS.map(v=>[v.id,v]));
const templates=original.templates.map(t=>{
  const replacement=replacements.get(t.id);
  return replacement?{...t,available:true,body:replacement.body,bounds:replacement.bounds,replacement}:t;
});
export const EGG_CONFIG={...original,templates,zones:original.zones.map(z=>({...z,availableTiers:templates.filter(t=>t.zone===z.zone&&t.available).map(t=>t.tier)}))};
