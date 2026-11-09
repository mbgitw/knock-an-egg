// Shared category gains affect both newly started and already playing voices.
const contexts=new Map();let state;
export function configureSettingsAudio(settings){state=settings;settings.observe(key=>{if(key==='MusicVolume'||key==='SfxVolume')for(const [context,buses] of contexts)for(const [category,gain] of Object.entries(buses))gain.gain.setValueAtTime(state.get(category),context.currentTime);});}
export function audioOutput(context,category='SfxVolume'){
  let buses=contexts.get(context);if(!buses){buses={};contexts.set(context,buses);}
  if(!buses[category]){const gain=context.createGain();gain.gain.value=state?.get(category)??1;gain.connect(context.destination);buses[category]=gain;}
  return buses[category];
}
