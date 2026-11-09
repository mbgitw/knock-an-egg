// A page may only be replaced after the original session confirms release.
export function retryGate(cleanup,{cooldownMs=0,now=()=>Date.now()}={}){
  let pending=null,nextAt=now()+cooldownMs;
  return async()=>{
    if(pending)return pending;
    if(now()<nextAt)return false;
    pending=(async()=>{try{return cleanup?await cleanup()===true:true;}catch{return false;}finally{nextAt=now()+5000;}})();
    try{return await pending;}finally{pending=null;}
  };
}
