import {INDEX_DATA} from '../gameplay/index-ui/data.js';
import {money} from '../gameplay/currency.js';

// Presentation only: the Room has already applied balances and claim flags.
export function installIndexClaim(indexUI,account,command,feedback){
  let busy=false;
  indexUI.claim=async name=>{
    if(busy||indexUI.snapshot||!indexUI.opened)return false;
    busy=true;
    const before=new Set(account.data.index?.claimed||[]);
    try{
      if(!await command('index-claim',name??null))return false;
      const claimed=new Set(account.data.index?.claimed||[]);
      const rewards=INDEX_DATA.zones.flatMap(z=>z.animals).filter(a=>(name==null||a.name===name)&&!before.has(a.name)&&claimed.has(a.name));
      if(rewards.length)feedback?.showRewards({cash:rewards.reduce((sum,a)=>sum+money(a.rewardCash),0n),speed:rewards.reduce((sum,a)=>sum+a.rewardSpeed,0)});
      indexUI.update(.25);
      return true;
    }finally{busy=false;}
  };
}
