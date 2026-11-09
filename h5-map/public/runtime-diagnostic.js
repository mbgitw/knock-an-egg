// Temporary read-only instrumentation, installed only in an explicit diagnostic build.
export function installRuntimeDiagnostic(game){
  const panel=document.createElement('pre');panel.id='runtime-diagnostic';
  panel.style.cssText='position:fixed;top:4px;left:27%;max-width:48vw;margin:0;padding:4px;background:#233c54dd;color:white;border:1px solid black;font:700 10px/1.3 monospace;-webkit-text-stroke:.25px black;paint-order:stroke fill;white-space:pre-wrap;overflow-wrap:anywhere;pointer-events:none;z-index:199';
  document.body.append(panel);let fault='none';
  addEventListener('error',event=>{const name=event.error?.name;const type=['Error','TypeError','RangeError','ReferenceError'].includes(name)?name:'runtime-error';const file=String(event.filename||'').split('/').at(-1).split('?')[0].replace(/[^A-Za-z0-9._-]/g,'').slice(0,64);fault=`${type} ${file}:${event.lineno||0}:${event.colno||0}`;});
  const n=value=>Number.isFinite(value)?value.toFixed(2):'?';
  const render=()=>{const {player,canvas,online,commerce}=game,p=player.motor.position,close=online?.session?.lastClose;panel.textContent=`D3 · online=${!!online} ready=${!!online?.session?.ready} ${online?.session?.stage||'offline'}\nframes=${canvas.dataset.playerFrames||0} phase=${canvas.dataset.framePhase||'-'}/${canvas.dataset.onlinePhase||'-'}\nhidden=${document.hidden} paused=${!!window.gameHostState?.paused} busy=${!!commerce?.busy} locked=${!!player.inputLocked} training=${!!player.training}\ntouch=${n(player.touchMove.x)},${n(player.touchMove.y)} pos=${n(p.x)},${n(p.y)},${n(p.z)}\nerror=${fault}${close?'\nclosed='+close.code+' room='+close.roomId:''}`;};
  render();const timer=setInterval(render,500);addEventListener('pagehide',()=>clearInterval(timer),{once:true});
}
