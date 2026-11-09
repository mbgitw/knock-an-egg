import {EGG_RENDERS} from './inventory-ui/egg-renders.js';
import {paidPetImage} from './commerce/paid-species.js';

// Purchased bags retain EggTypeConfig.Icon. A merge result is a species egg,
// not another purchased bag. Use its render, then its available paid portrait.
export function mergeEggImage(egg){
  const name=typeof egg==='string'?egg:egg.name;
  if(egg?.paidType==='FallenAngel')return new URL('./gcoin-shop/83525826842415.png',import.meta.url).href;
  if(EGG_RENDERS[name])return new URL('./inventory-ui/'+EGG_RENDERS[name],import.meta.url).href;
  return paidPetImage(name)||new URL('./inventory-ui/egg.png',import.meta.url).href;
}
