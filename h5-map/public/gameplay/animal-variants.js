import * as THREE from 'three';
let manifest;
export function applyVariantMaterials(template,specs,variant){
  const root=template.clone(true);
  root.traverse(o=>{
    if(!o.isMesh)return;
    const apply=m=>{
      const spec=specs[m.name];if(!spec)throw Error(`Variant material missing: ${m.name}`);
      const copy=m.clone();copy.color.setRGB(...spec.color,THREE.SRGBColorSpace);
      if(copy.emissive)copy.emissive.set(spec.neon?copy.color:0);
      return copy;
    };
    o.material=Array.isArray(o.material)?o.material.map(apply):apply(o.material);
  });
  root.userData.animalVariant=variant;return root;
}
export async function variantTemplate(template,name,variant){
  manifest??=fetch(new URL('./animal-variants/materials.json',import.meta.url)).then(r=>{if(!r.ok)throw Error('Animal variant manifest unavailable');return r.json();});
  const specs=(await manifest)[name]?.[variant];
  // Original FindAnimalTemplate also falls back to Normal. Do not invent an
  // appearance when the required authored color map has not been recovered.
  if(!specs){const root=template.clone(true);root.userData.variantFallback=variant;return root;}
  return applyVariantMaterials(template,specs,variant);
}
