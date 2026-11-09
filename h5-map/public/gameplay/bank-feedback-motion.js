// Timings/easing from NewItemTweens, NewItemController and RewardFlashConfig.
const clamp=x=>Math.max(0,Math.min(1,x));
const backOut=x=>{const t=clamp(x)-1;return 1+2.70158*t*t*t+1.70158*t*t;};
const backIn=x=>{const t=clamp(x);return 2.70158*t*t*t-1.70158*t*t;};
const quintOut=x=>1-(1-clamp(x))**5;
export function cardMotion(age){
  const scale=age<0?0:age<.42?backOut(age/.42):age<3?1:age<3.1?1+.1*(1-(1-(age-3)/.1)**2):1.1*(1-backIn((age-3.1)/.22));
  return {scale,amountScale:.4+.6*backOut((age-.1)/.3),done:age>=3.32};
}
export function bankMotion(age,baseFov){
  const fov=age<.05?baseFov:age<.45?baseFov+(100-baseFov)*quintOut((age-.05)/.4):100+(baseFov-100)*quintOut((age-.45));
  return {fov,opacity:1-quintOut((age-.05)/1.4),done:age>=1.45};
}
