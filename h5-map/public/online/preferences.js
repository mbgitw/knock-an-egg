import {encode,decode} from '../gameplay/commerce/cloud-save.js';
import {restoreSettings} from '../gameplay/settings-state.js';
const KEY='pasture_preferences_v1';
export async function readPreferences(account){
  const sdk=window.Builda;if(!sdk?.privateKV)return;
  const result=await sdk.privateKV.get(KEY);if(!result.ok)return;
  try{const saved=decode(result.data);if(saved){account.settings=restoreSettings(saved.settings);if(Array.isArray(saved.hotbar))account.pickaxes.hotbar=saved.hotbar;}}catch{}
}
export function persistPreferences(account,canvas){
  let committed='',pending=null,timer=null,writing=false;
  const flush=async()=>{timer=null;if(writing||!pending||pending===committed)return;writing=true;const value=pending;
    try{const result=await window.Builda.privateKV.set(KEY,encode(JSON.parse(value)));if(result.ok){committed=value;canvas.dataset.preferencesSaved='true';}else canvas.dataset.preferencesSaved='false';}
    catch{canvas.dataset.preferencesSaved='false';}finally{writing=false;if(pending!==value)timer=setTimeout(flush,500);}
  };
  account.save=()=>{pending=JSON.stringify({settings:account.data.settings,hotbar:account.data.pickaxes.hotbar});if(!timer&&!writing&&pending!==committed)timer=setTimeout(flush,500);return true;};
  addEventListener('pagehide',()=>{account.save();void flush();});
}
