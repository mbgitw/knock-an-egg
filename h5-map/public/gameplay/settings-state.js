export const SETTINGS_DEFAULTS=Object.freeze({Language:'auto',MusicVolume:1,SfxVolume:1,ViewOthersPets:true,ViewMyPets:true,ViewMyEggs:true,ScreenFFX:true});
export function restoreSettings(raw){
  return Object.fromEntries(Object.entries(SETTINGS_DEFAULTS).map(([key,fallback])=>[key,key==='Language'?(['auto','zh','en'].includes(raw?.Language)?raw.Language:'auto'):typeof fallback==='number'?(typeof raw?.[key]==='number'&&Number.isFinite(raw[key])?Math.max(0,Math.min(1,raw[key])):fallback):(typeof raw?.[key]==='boolean'?raw[key]:fallback)]));
}
export function placedPetVisible(settings,ownerId,localId){return settings[ownerId===localId?'ViewMyPets':'ViewOthersPets']!==false;}
export class SettingsState {
  constructor(account){this.account=account;account.data.settings=restoreSettings(account.data.settings);this.listeners=new Set();this.dirty=false;}
  get(key){return this.account.data.settings[key];}
  set(key,value){
    if(!Object.hasOwn(SETTINGS_DEFAULTS,key)||typeof value!==typeof SETTINGS_DEFAULTS[key]||(typeof value==='number'&&!Number.isFinite(value)))return false;
    if(key==='Language'&&!['auto','zh','en'].includes(value))return false;
    value=typeof value==='number'?Math.max(0,Math.min(1,value)):value;
    if(this.get(key)===value)return true;
    this.account.data.settings[key]=value;this.dirty=true;
    for(const fn of this.listeners)fn(key,value);
    // Throttle, not debounce: continuously dragging still saves every 0.5s.
    this.timer??=setTimeout(()=>{this.timer=null;this.flush();},500);return true;
  }
  observe(fn){this.listeners.add(fn);return ()=>this.listeners.delete(fn);}
  flush(){clearTimeout(this.timer);this.timer=null;if(!this.dirty)return true;const ok=this.account.save();this.dirty=!ok;if(!ok)this.timer=setTimeout(()=>{this.timer=null;this.flush();},500);return ok;}
  dispose(){this.flush();clearTimeout(this.timer);this.listeners.clear();}
}
