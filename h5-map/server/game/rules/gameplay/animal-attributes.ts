// @ts-nocheck
// Generated from public/gameplay/animal-attributes.js; run node tools/build-online-rules.mjs.
import {PAID_SPECIES} from './commerce/paid-species.ts';
import {EGG_CONFIG} from './eggs/runtime-config.ts';
const species=new Map(EGG_CONFIG.zones.flatMap(z=>z.animalPool.map(p=>[p.name,{...p,zone:z.zone}])));
const speciesOf=name=>species.get(name)||PAID_SPECIES.find(p=>p.name===name);
const reference=[1.38,1.48,1.55,1.65,1.7,1.73,1.79,1.81,1.81,1.81];
const exponent=[1.1,1.12,1.14,1.16,1.18,1.2,1.22,1.25,1.27,1.29];
export function animalIncome(pet){
  const s=speciesOf(pet.name);if(!s)return 0;
  const ref=reference[s.zone-1],kg=pet.weightKg;
  let mult=1;
  if(Number.isFinite(kg)&&kg>0){const r=kg/(s.baseKg*ref**3),e=exponent[s.zone-1];mult=r<=8?r**e:8**e*(r/8)**(e-.55);}
  else if(Number.isFinite(pet.sizeMult)){const r=Math.max(0,pet.sizeMult)/ref;mult=r<=2?r**3:8*r/2;}
  // Missing historical size/weight uses the source reference weight. Mutations are disabled in the source.
  return Math.max(1,Math.round(s.cash*Math.max(.2,mult)*Math.min(3,Math.max(1,Math.sqrt(s.baseKg/50)))*({Gold:2,Diamond:4}[pet.variant]||1)));
}

export const animalSellValue=pet=>BigInt(animalIncome(pet))*60n;

// Original GenderConfig.Roll and EggRewards.PoolVariantHatchChance.
export function rollAnimalTraits(random=roomRandomRequired){
  const gender=random()<.5?'Female':'Male',n=random();
  return {gender,variant:n<.9875?'Normal':n<.9975?'Gold':'Diamond'};
}
// EggSizes.ForZone(zone).Hatch.Roll, with no unconfirmed luck inputs.
// MaxMult calibrates the tail probability; it is not a hard size cap.
export function rollAnimalSize(zone,random=roomRandomRequired){
  const cfg=EGG_CONFIG.size.Hatch,max=EGG_CONFIG.size.ZoneCaps[zone-1]?.HatchMax??cfg.MaxMult;
  const u=Math.max(Number.EPSILON,Math.min(1,random())),large=random()<cfg.BigChance;
  const exponent=cfg.TailExponent||1,q=(1/(cfg.MaxOneIn*cfg.BigChance))**(1/(max-1)**exponent);
  const smallExponent=cfg.MinMult<1?Math.log(1/(cfg.MinOneIn*(1-cfg.BigChance)))/Math.log(cfg.MinMult):0;
  const value=large?1+(Math.log(u)/Math.log(q))**(1/exponent):cfg.MinMult<1?Math.max(cfg.MinMult,u**(1/smallExponent)):1;
  const precision=10**cfg.Decimals;return Math.floor(value*precision+.5)/precision;
}
export function rollAnimalWeight(name,zone,random=roomRandomRequired){
  const s=speciesOf(name);if(!s)throw new Error('Unknown animal: '+name);
  const sizeMult=rollAnimalSize(zone,random);
  return {sizeMult,weightKg:s.baseKg*sizeMult**3};
}
// EggRewards.ScaleForWeight; historical pets without attributes keep their size.
export function animalVisualScale(pet){
  const s=speciesOf(pet.name),size=pet.sizeMult||1;
  if(!s)return 1;
  let scale;
  if(Number.isFinite(pet.weightKg)&&pet.weightKg>0){const byKg=Math.cbrt(pet.weightKg/s.baseKg);scale=Math.max(.4,size*Math.max(1/1.5,Math.min(1.5,byKg/size)));}
  else {const d=Math.max(0,size-1.5);scale=size<=1.5?Math.max(.4,size):10-8.5*Math.exp(-d/8.5);}
  return Math.min(pet.id?.startsWith('merge:')?13:10,scale);
}

function roomRandomRequired():number{throw Error("Room必须注入可恢复随机源");}
function roomTimeRequired():number{throw Error("Room必须注入可信时间");}
