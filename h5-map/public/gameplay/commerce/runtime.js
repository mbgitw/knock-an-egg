import {Commerce} from './service.js';
import {growAllProduct} from './state.js';
const errors={MAX_POWER:'速度成长已达上限',SAVE_TOO_LARGE:'存档空间不足，购买未开始',HOST_UNAVAILABLE:'请在 Builda 中使用 G币支付',INVENTORY_FULL:'背包空间不足',ALREADY_OWNED:'已拥有该商品',WRONG_TIER:'请购买下一档倍率',NO_OFFLINE_REWARD:'暂无可领取收益',EGG_CHANGED:'蛋状态已变化，请重新选择',ORDER_REQUIRES_ROOM:'此订单需要服务器发货，尚未领取',UNKNOWN_PENDING_ORDER:'有未完成订单，请稍后查看',SAVE_FAILED:'存档未成功，请稍后重试',SAVE_PENDING:'游戏数据正在保存，请稍后重试',PAYMENT_PENDING:'订单正在处理中，请稍后查看',CLAIM_FAILED:'物品已发放，订单确认未完成'};
export function installCommerce(game){
  const {account,shopUI,pickaxes,trails,inventoryUI,backpack,treadmills,pasture,player}=game;
  const status=document.createElement('div');status.setAttribute('role','status');status.hidden=true;status.style.cssText='position:fixed;z-index:40;left:50%;top:12%;transform:translateX(-50%);padding:10px 16px;border:2px solid #000;background:#273647;color:white;font:bold 16px Arial,sans-serif;-webkit-text-stroke:2px black;paint-order:stroke fill;pointer-events:none';document.body.append(status);
  let timer,prior;
  const message=code=>{status.textContent=errors[code]||'购买未完成，请稍后重试';status.hidden=false;clearTimeout(timer);timer=setTimeout(()=>status.hidden=true,6000);};
  const refresh=()=>{shopUI?.refresh();pickaxes?.refresh();trails?.render();backpack?.render();treadmills?.refreshHUD();if(inventoryUI?.opened)inventoryUI.render(inventoryUI.read());pasture?.offline?.update();};
  const commerce=new Commerce(account,{onMessage:message,onChange:refresh,onBusy:value=>{
    if(value){prior={locked:player.inputLocked,modal:pickaxes?.modal||pickaxes?.externalModal||backpack?.opened};player.inputLocked=true;player.keys.clear();pickaxes?.clock.cancel();}
    else player.inputLocked=!!(pickaxes?.modal||pickaxes?.externalModal||backpack?.opened||(prior?.locked&&!prior?.modal));
    if(!(['localhost','127.0.0.1'].includes(location.hostname)&&location.port==='8765'))document.body.inert=value;
  }});
  game.commerce=commerce;
  document.addEventListener('click',async e=>{
    const b=e.target.closest('[data-pay-id]');if(!b?.dataset.payId)return;
    e.preventDefault();e.stopImmediatePropagation();
    const result=await commerce.buy(b.dataset.payId,{eggId:b.dataset.eggId});
    if(result.delivered){status.textContent='购买成功';status.hidden=false;clearTimeout(timer);timer=setTimeout(()=>status.hidden=true,2500);}
    refresh();
  },true);
  const header=inventoryUI?.root.querySelector('.inventory-header-action'),old=header?.onclick;
  if(header)header.onclick=()=>{
    if(inventoryUI.kind==='pets')return old?.();
    const p=growAllProduct(account.data);if(p)void commerce.buy(p.id).then(refresh);
  };
  refresh();return commerce;
}
