import {awardInterval} from '../treadmill-state.js';

// Local presentation only. Never changes account power or sends Room messages.
export function trainingFeedback(account,showGain){
  let elapsed=0,session=null;
  const reset=()=>{elapsed=0;session=null;};
  const advance=(dt,{active=true}={})=>{
    if(!active||!account.session||!Number.isFinite(dt)||dt<=0||dt>.25||
      (account.session.kind==='public'&&!account.publicActive)){reset();return;}
    if(session!==account.session){elapsed=0;session=account.session;}
    elapsed+=dt;
    const interval=awardInterval(account.data.power);
    while(elapsed+1e-10>=interval){
      elapsed=Math.max(0,elapsed-interval);
      const mult=account.multiplier,gain=Math.min(1e19,account.data.power+mult)-account.data.power;
      if(gain>0)showGain(gain,mult);
    }
  };
  return {advance,reset};
}
