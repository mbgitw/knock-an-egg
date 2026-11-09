export function installTrainingControl(treadmills,connection,{paused=()=>!!(window.gameHostState?.paused||document.hidden)}={}){
  const enter=treadmills.enter.bind(treadmills),exit=treadmills.exit.bind(treadmills);
  let entering=false,generation=0,stopping=false,needsStop=false,nextStop=0;
  const stop=async()=>{
    if(stopping||!needsStop||!connection.session.ready||!connection.session.active)return;
    stopping=true;
    try{if(await connection.stopTraining())needsStop=false;}
    catch{/* Keep the stop pending for the bounded-rate update retry. */}
    finally{stopping=false;nextStop=performance.now()+500;}
  };
  treadmills.enter=async(kind,slot=0)=>{
    if(entering||needsStop||connection.waiting||connection.session.pending||paused()||!treadmills.canEnter(kind,slot))return false;
    entering=true;const token=++generation;
    try{
      if(!await connection.command('training-start',{kind,slot})){needsStop=true;void stop();return false;}
      if(token!==generation||paused()||!treadmills.canEnter(kind,slot)||!enter(kind,slot)){
        needsStop=true;void stop();return false;
      }
      return true;
    }catch{needsStop=true;void stop();return false;}finally{entering=false;}
  };
  treadmills.exit=jump=>{
    const had=entering||treadmills.account.session||treadmills.lockedSession||treadmills.player.training;
    generation++;exit(jump);
    if(had){needsStop=true;void stop();}
  };
  return {
    interrupt(){treadmills.exit(false);treadmills.awaitingInput=true;},
    update(){if(needsStop&&performance.now()>=nextStop)void stop();},
  };
}
