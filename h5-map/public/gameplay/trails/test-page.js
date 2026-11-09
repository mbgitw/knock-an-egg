// Isolated in-memory account. Production entry has no test controls.
const panel=document.createElement('div');panel.id='trail-test-controls';panel.style.cssText='position:fixed;bottom:8px;left:8px;z-index:40;background:#102233ed;color:white;padding:8px;border-radius:6px;font:12px system-ui;display:flex;gap:6px;flex-wrap:wrap;max-width:600px';
panel.innerHTML='<span>拖尾验收 / 内存账户</span><button data-action="outside">商店前</button><button data-action="inside">进商店</button><button data-action="shop">商店UI</button><button data-action="cash">测试现金</button><button data-action="run">试跑位置</button><select aria-label="验收装备"></select><button data-action="equip">装备测试</button><button data-action="train">训练倍率</button><button data-action="hold">持续试跑</button><button data-action="stop">停止试跑</button><output></output>';
document.body.append(panel);
const {TRAILS}=await import('../trail-state.js');panel.querySelector('select').innerHTML='<option value="0">卸下</option>'+TRAILS.map(t=>`<option value="${t.id}">${t.name}</option>`).join('');
panel.onclick=e=>{
  const g=window.game;if(!g)return;const action=e.target.dataset.action;
  if(action==='hold'){g.trails.close();g.player.keys.add('KeyW');clearTimeout(panel.stopTimer);panel.stopTimer=setTimeout(()=>g.player.keys.delete('KeyW'),20000);}
  if(action==='stop'){clearTimeout(panel.stopTimer);g.player.keys.clear();}
  if(action==='cash'){g.account.creditCash('200000000000000');g.trails.signature='';}
  if(action==='shop')g.trails.open();
  if(action==='outside'||action==='inside'||action==='run'){
    g.trails.close();g.indexUI.close();g.pickaxes.close();g.treadmills.exit();
    const pos=action==='outside'?[-50,.6,-48]:action==='inside'?[-58,.6,-54]:[-38,.6,16];g.player.motor.teleport(g.player.motor.position.clone().set(...pos));g.player.actor.rotation.y=Math.PI;
    const target=g.player.motor.position.clone().add({x:0,y:3,z:0});g.controls.target.copy(target);g.orbitCamera.position.copy(target).add({x:13,y:10,z:18});g.controls.update();g.camera.position.copy(g.orbitCamera.position);
  }
  if(action==='equip'){const id=Number(panel.querySelector('select').value);if(id&&!g.trails.progress.data.owned.includes(id)){g.account.creditCash('200000000000000');g.trails.progress.buy(id);}else g.trails.progress.equip(id);g.trails.signature='';}
  if(action==='train'){if(!g.account.data.unlocked){g.account.creditCash(100);g.account.unlock();}g.account.begin();panel.querySelector('output').textContent=`成长倍率 ×${g.account.multiplier}`;g.account.end();}
};
