// 在资源加载前告知宿主已启动；普通独立预览仍可使用。
window.Builda?.runtime.ready();
// The loopback mock dialog lives in this document and needs its own input events.
const localMockPreview=['localhost','127.0.0.1'].includes(location.hostname)&&location.port==='8765';
if(!localMockPreview)for(const type of ['keydown','keyup','pointerdown','pointerup','click','wheel','touchstart','touchmove'])window.addEventListener(type,e=>{
  if(window.game?.commerce?.busy){e.preventDefault();e.stopImmediatePropagation();}
},{capture:true,passive:false});
window.gameHostState={visible:!document.hidden,pausePanel:false,get paused(){return !this.visible||this.pausePanel;}};
window.Builda?.events.on('appVisibility',({visible})=>{window.gameHostState.visible=visible;window.dispatchEvent(new Event('game-host-pause'));});
window.Builda?.events.on('pausePanel',({visible})=>{window.gameHostState.pausePanel=visible;window.dispatchEvent(new Event('game-host-pause'));});

// Standalone browser only: the SDK owns visibility normalization in Builda.
if(!window.Builda?.events)document.addEventListener('visibilitychange',()=>{window.gameHostState.visible=!document.hidden;window.dispatchEvent(new Event('game-host-pause'));});
