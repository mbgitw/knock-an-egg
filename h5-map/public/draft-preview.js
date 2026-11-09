import {retryGate} from './online/retry-gate.js';
import {t} from './i18n.js';
// Build-time switch. The release packager writes enabled:false; no URL bypass.
export async function draftPreviewEnabled(){try{const r=await fetch(new URL('./draft-preview-config.json',import.meta.url));return r.ok&&(await r.json()).enabled===true;}catch{return false;}}
export async function draftDiagnosticsEnabled(){try{const r=await fetch(new URL('./draft-preview-config.json',import.meta.url));return r.ok&&(await r.json()).diagnostics===true;}catch{return false;}}
export function chooseOfflinePreview(enabled,diagnostic,{cleanup,debug=false}={}){
  return new Promise(resolve=>{
    const root=document.createElement('div');root.id='connection-choice';root.setAttribute('role','dialog');root.setAttribute('aria-modal','true');
    root.style.cssText='position:fixed;top:0;right:0;bottom:0;left:0;z-index:200;display:grid;place-items:center;background:#0008;color:white;font:700 20px Arial,sans-serif;-webkit-text-stroke:1px black;paint-order:stroke fill;';
    const panel=document.createElement('section');panel.style.cssText='box-sizing:border-box;width:min(420px,90vw);padding:24px;border:3px solid black;border-radius:12px;background:#233c54;text-align:center';
    const title=document.createElement('h2');title.textContent=t('Unable to connect');
    const text=document.createElement('p');text.textContent=t(enabled?'Draft offline progress resets when you leave.':'Please retry the connection.');text.style.cssText='font-size:16px;line-height:1.5';panel.append(title,text);
    if(diagnostic){const code=/^[A-Z0-9_:-]{1,80}$/.test(diagnostic.lastCode||diagnostic.code)?(diagnostic.lastCode||diagnostic.code):'ONLINE_FAILED';const status=document.createElement('p');status.style.cssText='font-size:14px;overflow-wrap:anywhere';status.textContent=`${diagnostic.stage||'connecting'} · ${code}`;panel.append(status);}
    if(debug&&diagnostic){const info=document.createElement('p');info.dataset.connectionDiagnostic=diagnostic.version;info.style.cssText='font:700 12px/1.4 monospace;overflow-wrap:anywhere;white-space:pre-wrap';info.textContent=`${diagnostic.version} · ${diagnostic.stage} · ${diagnostic.code}\n${diagnostic.elapsedMs} ms${diagnostic.lastCode?' · '+diagnostic.lastCode:''}${diagnostic.ticket?' · Ticket: '+diagnostic.ticket:''}\n已收到 / Received: ${diagnostic.received.join(', ')||'—'}${diagnostic.room?'\nRoom: '+diagnostic.room:''}${diagnostic.network?'\nGateway: '+diagnostic.network.gateway+' · Room: '+diagnostic.network.room+'\nChannels: '+diagnostic.network.channels:''}`;panel.append(info);}
    const button=(label,action)=>{const b=document.createElement('button');b.textContent=t(label);b.style.cssText='margin:6px;padding:12px 18px;background:#247f35;color:white;border:2px solid black;border-radius:8px;font:bold 18px Arial;touch-action:manipulation';b.onclick=action;panel.append(b);return b;};
    if(enabled)button('Play offline',()=>{root.remove();resolve();});
    const busy=[diagnostic?.code,diagnostic?.lastCode].includes('MATCH_ROLE_BUSY');
    const retry=retryGate(cleanup,{cooldownMs:busy?10000:0});
    const retryButton=button('Retry connection',async()=>{retryButton.disabled=true;text.textContent=t('Finishing the previous connection…');try{if(await retry()){location.reload();return;}text.textContent=t('The previous connection is still ending. Please retry shortly.');}finally{retryButton.disabled=false;}});
    if(busy){text.textContent=t('The previous connection is still ending. Please retry shortly.');retryButton.disabled=true;setTimeout(()=>{retryButton.disabled=false;},10000);}root.append(panel);document.body.append(root);panel.querySelector('button').focus();
  });
}
export function addReconnectOption(settingsUI){
  const content=settingsUI?.root.querySelector('.source-content');if(!content)return;
  const b=document.createElement('button');b.textContent=t('Reconnect (leave offline preview)');b.style.cssText='pointer-events:auto;position:absolute;left:25px;top:'+content.style.height+';width:940px;height:90px;background:#247f35;border:3px solid black;color:white;font:bold 32px Arial;touch-action:manipulation';
  b.onclick=()=>location.reload();content.append(b);content.style.height=(parseFloat(content.style.height)+110)+'px';
}
