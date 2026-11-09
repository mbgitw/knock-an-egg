const stages=new Set(['starting','config','auth','gateway','admitting','ticket_active','connecting_room','syncing','room_connected','preferences','ready','recovery_required','cleanup_failed','idle','reconnecting']);
const safeCode=value=>Number.isSafeInteger(value)&&value>=0?String(value):typeof value==='string'&&/^[A-Z][A-Z0-9_]{1,63}$/.test(value)?value:'';
export function connectionDiagnostic(connection,error,elapsedMs){
  const session=connection.session;
  const baseline=session?.baseline;
  const room=session?.room?.roomId||session?.ticket?.assignment?.room_id;
  return {
    version:'D2',stage:stages.has(connection.stage)?connection.stage:'starting',
    code:safeCode(error?.code)||(['ONLINE_TIMEOUT','ONLINE_FAILED','ONLINE_CANCELLED'].includes(error?.message)?error.message:'ONLINE_FAILED'),
    lastCode:safeCode(connection.lastCode),elapsedMs:Math.max(0,Math.round(elapsedMs)),
    room:typeof room==='string'&&/^[a-zA-Z0-9-]{1,128}$/.test(room)?room:'',
    ticket:['waiting','forming','room_ready','confirmed','cancelled','timeout','confirm_timeout','failed'].includes(session?.ticket?.status)?session.ticket.status:'',
    received:baseline?[['players',101],['account',105],['eggs',106],['animals',107]].filter(([,op])=>baseline.has(op)).map(([name])=>name):[],
  };
}
export function networkDiagnostic(snapshot){
  const state=value=>['new','connecting','connected','disconnected','failed','closed','completed','checking','open','closing'].includes(value)?value:'unknown';
  return {gateway:state(snapshot?.gateway?.connectionState),room:state(snapshot?.room?.connectionState),channels:['control_reliable','game_reliable','state_unreliable'].map(name=>state(snapshot?.room?.channels?.[name])).join('/')};
}
