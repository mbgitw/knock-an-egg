// Shown only while an established Room connection is resyncing, so a reconnect never looks like a freeze.
// A short delay hides sub-second blips; text is localized by the DOM observer.
const WAITING=new Set(['reconnecting','syncing','admitting','ticket_active','connecting_room']);
export function installReconnectNotice(connection,{delay=600,doc=globalThis.document}={}){
  let el=null,timer=null;
  const show=()=>{timer=null;if(!doc)return;
    if(!el){el=doc.createElement('div');el.id='online-reconnect-notice';el.setAttribute('role','status');el.textContent='正在重新连接…';
      el.style.cssText="position:fixed;left:50%;top:14vh;transform:translateX(-50%);width:max-content;max-width:94vw;text-align:center;pointer-events:none;z-index:60;color:#fff;font:800 clamp(16px,2.2vw,36px)/1.2 OriginalRubik,sans-serif;-webkit-text-stroke:clamp(2px,.2vw,4px) black;paint-order:stroke fill;text-shadow:none";
      doc.body.append(el);}
    el.hidden=false;};
  const hide=()=>{clearTimeout(timer);timer=null;if(el)el.hidden=true;};
  const off=connection.observe((type,data)=>{
    if(type!=='status'||connection.session?.exiting)return;
    if(data.stage==='room_connected')hide();
    else if(WAITING.has(data.stage)){if(!timer&&(!el||el.hidden))timer=setTimeout(show,delay);}
    else hide();
  });
  return {dispose(){hide();off();el?.remove();},get element(){return el;}};
}
