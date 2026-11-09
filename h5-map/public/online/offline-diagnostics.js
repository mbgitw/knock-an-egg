import {OP} from './protocol.js';
// Best-effort, bounded telemetry only. Never holds up a claim or writes a save.
export function installOfflineDiagnostics(connection,ui,commerce,{now=()=>Date.now()}={}){
  let count=0,until=0,attempt=0,lastRecovery=-Infinity;const queue=[];
  const flush=()=>{
    if(!connection.session?.ready||!connection.session.room)return;
    while(queue.length){const event=queue.shift();try{connection.session.room.sendReliable(OP.OFFLINE_DIAGNOSTIC,new TextEncoder().encode(JSON.stringify(event)));}catch{break;}}
  };
  const trace=(stage,id=0,reason='')=>{
    try{
      const time=now();if(time>=until){until=time+60000;count=0;}
      if(count++>=30)return;
      const s=connection.session;
      if(queue.length>=16)queue.shift();
      queue.push({stage,attempt,id:Number.isSafeInteger(id)?id:0,reason,ready:!!s?.ready,active:!!s?.active,waiting:!!connection.waiting,pending:!!s?.pending,busy:!!commerce.busy,opened:!!ui.opened,hasReward:ui.economy.ledger.pending>0});
      flush();
    }catch{/* Telemetry never changes gameplay. */}
  };
  const recoveryReason=result=>result?.ok?(result.unknown?'UNKNOWN_ORDER':result.recovered?'DELIVERED':result.unresolved?'UNRESOLVED':'CANCELLED'):'FAILED';
  const open=ui.open;
  if(open)ui.open=function(...args){const result=open.apply(this,args);trace('opened');return result;};
  if(ui.opened)trace('opened');
  connection.offlineTrace=trace;
  connection.observe(type=>{if(type==='status')flush();});
  ui.collect=async()=>{
    attempt++;trace('click');
    const message=text=>ui.showClaimStatus?.(text);
    if(ui.busy||commerce.busy){trace('blocked',0,ui.busy?'UI_BUSY':'PAY_BUSY');message('Please wait for the current request to finish.');return;}
    if(!ui.opened||ui.economy.ledger.pending<=0n)return;
    ui.busy=true;if(ui.claim)ui.claim.disabled=true;message();
    try{
      const result=await connection.command('offline-claim',undefined,{detailed:true});
      if(result?.ok)return;
      if(result?.reason==='PAY_BUSY')message('A purchase is being settled. Please try again shortly.');
      else if(result?.reason==='TIMEOUT')message('Claim result is still being checked. Tap Claim to retry.');
      else if(['NOT_READY','PLAYER_UNAVAILABLE','INTENT_BLOCKED'].includes(result?.reason))message('Connection or previous request is not ready. Please try again.');
      else if(result?.reason==='RATE_LIMIT'||result?.reason==='WAITING')message('Please wait a moment and try again.');
      else message('Unable to claim the reward. Please try again.');
      // Recover known paid orders in the background; an unknown or empty
      // pending list is not proof that an unfinished purchase was unpaid.
      if(result?.reason==='PAY_BUSY'&&typeof commerce.recover==='function'&&now()-lastRecovery>=60000){
        lastRecovery=now();
        trace('recovery',0,'CLICK_START');
        Promise.resolve().then(()=>commerce.recover({silent:true})).then(recovery=>{
          trace('recovery',0,recoveryReason(recovery));
          if(recovery?.recovered&&ui.opened&&!ui.busy)void ui.collect();
        }).catch(()=>trace('recovery',0,'FAILED'));
      }
    }
    catch{trace('error');message('Unable to claim the reward. Please try again.');}
    finally{ui.busy=false;if(ui.claim)ui.claim.disabled=false;ui.update();trace(ui.opened?'still_open':'closed');}
  };
  return {trace,flush};
}
