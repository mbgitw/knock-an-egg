// Inventory metadata is sent only when it changes. Equipping a tool must not
// retransmit up to 250 pets on every click.
export function accountChanges(before:any,after:any,path:(string|number)[]=[],out:any[]=[]):any[]{
  if(JSON.stringify(before)===JSON.stringify(after))return out;
  if(after===undefined){out.push({path,remove:true});return out;}
  if(before&&after&&typeof before==='object'&&typeof after==='object'&&Array.isArray(before)===Array.isArray(after)&&(!Array.isArray(after)||before.length===after.length)){
    for(const key of new Set([...Object.keys(before),...Object.keys(after)]))accountChanges(before[key],after[key],[...path,key],out);
  }else out.push({path,value:after});return out;
}
