// The circle advances on the local clock so pressing feels immediate, but completion
// (ownership) is only ever shown after the Room reports this player as the carrier.
const SERVER_HOLD=1.4,UNCONFIRMED_LIMIT=1.32,MAX_LEAD=.6;
export function installAnimalHold(animals,connection,{now=()=>performance.now()}={}){
  let sequence=0,nextAt=0,carrying=false,startedAt=0;
  const begin=animals.begin.bind(animals),cancel=animals.cancel.bind(animals);
  const send=id=>connection.hold({id,sequence});
  animals.begin=()=>{
    if(!begin())return false;
    sequence++;carrying=false;startedAt=now();nextAt=now()+250;
    if(!send(animals.state.hold.id)){cancel();return false;}
    return true;
  };
  animals.cancel=()=>{if(animals.held)send(null);carrying=false;cancel();};
  connection.observe((type,data)=>{
    if(type!=='event'||data.kind!=='hold-progress'||data.sequence!==sequence||!animals.state.hold)return;
    if(data.carrying===animals.state.hold.id){animals.state.hold.elapsed=SERVER_HOLD;carrying=true;return;}
    if(!data.active||data.id!==animals.state.hold.id){animals.cancel();return;}
    // Room restarted its hold (e.g. heartbeat gap) or lags far behind: follow it back.
    const local=(now()-startedAt)/1000,server=Math.max(0,data.elapsed/1000);
    if(local-server>MAX_LEAD)startedAt=now()-server*1000;
  });
  animals.state.advance=(dt,position,{held,blocked})=>{
    const hold=animals.state.hold;
    if(!hold)return null;
    if(!held||blocked||!connection.session.ready||!connection.session.active){animals.cancel();return null;}
    hold.elapsed=carrying?SERVER_HOLD:Math.min(UNCONFIRMED_LIMIT,(now()-startedAt)/1000);
    if(now()>=nextAt){nextAt=now()+250;if(!send(hold.id))animals.cancel();}
    return null;
  };
}
