import {OnlineClient} from '../vendor/online/index.js';
import {PastureSession} from './session.js';
// 只使用Builda测试外壳的明确标记切本地；真实App也可能从127.0.0.1加载。
export async function connectPasture(options={}){
  const stage=name=>{if(!options.cancelled?.())options.onStatus?.({stage:name});};
  stage('config');
  const config=await fetch(new URL('./config.json',import.meta.url)).then(r=>{if(!r.ok)throw Error('ONLINE_CONFIG_MISSING');return r.json();});
  const query=new URLSearchParams(location.search),local=query.get('builda_mock_shell')==='1';
  let token,expiresAt=0;
  if(local){const id=query.get('builda_mock_player')||'player-1';if(!/^[A-Za-z0-9_-]{1,64}$/.test(id))throw Error('INVALID_LOCAL_ID');token=`local:${id}`;}
  else{stage('auth');const result=await window.Builda.requestToken();if(!result.ok)throw Object.assign(Error('AUTH_FAILED'),{code:result.error.code});token=result.data.token;expiresAt=result.data.expiresAt;}
  if(options.cancelled?.())throw Error('ONLINE_CANCELLED');
  // 宿主身份随新游戏发布变化；仅明确的本地 Mock 使用项目配置。
  const gameId=local?config.gameId:window.Builda?.runtime?.gameId;
  if(!gameId)throw Error('ONLINE_GAME_ID_MISSING');
  const client=new OnlineClient({gameId,gatewayUrl:local?config.localGatewayUrl:config.gatewayUrl,defaultQueueName:config.defaultQueueName});
  const socket=client.createSocket(),session=new PastureSession({socket,...options});
  options.onSession?.(session);
  stage('gateway');await socket.connect(client.restoreSession(token));token=null;
  if(options.cancelled?.()){socket.close();throw Error('ONLINE_CANCELLED');}
  await session.start();
  if(options.cancelled?.()){void session.leave();throw Error('ONLINE_CANCELLED');}
  if(!local){
    let refreshing=false,attempts=0,timer;
    const refresh=async()=>{if(session.exiting||refreshing)return;refreshing=true;try{const r=await window.Builda.requestToken();if(session.exiting)return;if(!r.ok)throw Error(r.error.code);await socket.connect(client.restoreSession(r.data.token));if(session.exiting){if(session.stage==='closed')socket.close();return;}expiresAt=r.data.expiresAt;attempts=0;schedule();}catch{if(session.exiting)return;if(++attempts<=3)timer=setTimeout(refresh,10000*attempts);else session.status('recovery_required','AUTH_FAILED');}finally{refreshing=false;}};
    const schedule=()=>{clearTimeout(timer);if(!session.exiting&&Number.isFinite(expiresAt))timer=setTimeout(refresh,Math.max(10000,expiresAt*1000-Date.now()-60000));};
    const offError=socket.on('error',e=>{if(e.code==='AUTH_FAILED')void refresh();});
    const resume=()=>{if(!window.gameHostState?.paused&&expiresAt*1000-Date.now()<60000)void refresh();};window.addEventListener('game-host-pause',resume);session.onDisposed=()=>{clearTimeout(timer);offError();window.removeEventListener('game-host-pause',resume);};schedule();
  }
  return session;
}
