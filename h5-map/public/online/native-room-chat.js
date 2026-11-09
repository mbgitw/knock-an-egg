// Everyone in this seven-player pasture shares the same host chat team.
export const CHAT_TEAM_ID=1;
const transientErrors=new Set(['CHAT_GROUP_TIMEOUT','CHAT_GROUP_HOST_ERROR','NETWORK_ERROR']);

export class NativeRoomChat {
  constructor(session){this.session=session;this.current=null;this.unavailable=false;}
  reset(){this.current=null;}
  update(){
    const s=this.session,room=s.room;
    if(!room||!s.ready||!s.active||s.exiting||this.unavailable)return;
    let state=this.current;
    if(state?.room!==room)this.current=state={room,status:'idle',attempts:0,nextAt:0,pending:null};
    if(state.pending||['joined','failed'].includes(state.status)||s.now()<state.nextAt)return;
    if(typeof room.joinChatGroup!=='function'){this.unavailable=true;state.status='unavailable';return;}
    state.status='joining';state.attempts++;
    const current=()=>this.current===state&&s.room===room&&!s.exiting;
    // Never delay the snapshot barrier or let chat errors enter gameplay recovery.
    state.pending=Promise.resolve().then(()=>current()?room.joinChatGroup(CHAT_TEAM_ID):null).then(result=>{
      if(!current())return;
      if(result?.available===false){this.unavailable=true;state.status='unavailable';}
      else if(result?.available===true){state.status='joined';state.errorCode=null;}
      else{state.status='failed';state.errorCode='CHAT_GROUP_INVALID_RESULT';}
    }).catch(error=>{
      if(!current())return;
      const code=String(error?.code||'CHAT_GROUP_HOST_ERROR');
      state.errorCode=/^[A-Z0-9_]{1,80}$/.test(code)?code:'CHAT_GROUP_HOST_ERROR';
      state.status=transientErrors.has(code)&&state.attempts<3?'retry':'failed';
      state.nextAt=s.now()+2000*2**(state.attempts-1);
    }).finally(()=>{state.pending=null;});
  }
  // Room.leave / roomClosed / Socket.close own chat cleanup, including late join replies.
}
