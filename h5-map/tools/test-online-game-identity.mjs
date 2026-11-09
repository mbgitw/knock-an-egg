import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import test from 'node:test';

// Exercise the real connection entry up to SDK construction, without opening a socket.
const source=readFileSync(new URL('../public/online/connect.js',import.meta.url),'utf8')
  .replace(/^import .*;\r?\n/gm,'').replace('export async function','async function')
  .replace('import.meta.url',"'https://example/online/connect.js'");
async function selected(search,hostId){
  let selectedId;
  const context={URL,URLSearchParams,location:{search},
    fetch:async()=>({ok:true,json:async()=>({gameId:'old-config-game',gatewayUrl:'wss://example',localGatewayUrl:'ws://local',defaultQueueName:'default'})}),
    window:{Builda:{runtime:{gameId:hostId},requestToken:async()=>({ok:true,data:{token:'test-only',expiresAt:0}})}},
    OnlineClient:class{constructor(config){selectedId=config.gameId;throw Error('CAPTURED');}},Error};
  vm.createContext(context);vm.runInContext(source,context);
  try{await context.connectPasture();}catch(error){if(error.message!=='CAPTURED')return error.message;}
  return selectedId;
}
test('new game uses host identity instead of original project identity',async()=>{
  assert.equal(await selected('','new-host-game'),'new-host-game');
});
test('explicit local Mock keeps configured local identity',async()=>{
  assert.equal(await selected('?builda_mock_shell=1','new-host-game'),'old-config-game');
});
test('missing host identity never falls back to another game',async()=>{
  assert.equal(await selected('',''),'ONLINE_GAME_ID_MISSING');
});
