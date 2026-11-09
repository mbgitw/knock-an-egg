// @ts-nocheck
// Generated from public/gameplay/eggs/runtime-config.js; run node tools/build-online-rules.mjs.
import {EGG_CONFIG as original} from './config.ts';
import {V2_EGGS} from './v2-replacements.ts';
const replacements=new Map(V2_EGGS.map(v=>[v.id,v]));
const templates=original.templates.map(t=>{
  const replacement=replacements.get(t.id);
  return replacement?{...t,available:true,body:replacement.body,bounds:replacement.bounds,replacement}:t;
});
export const EGG_CONFIG={...original,templates,zones:original.zones.map(z=>({...z,availableTiers:templates.filter(t=>t.zone===z.zone&&t.available).map(t=>t.tier)}))};

function roomRandomRequired():number{throw Error("Room必须注入可恢复随机源");}
function roomTimeRequired():number{throw Error("Room必须注入可信时间");}
