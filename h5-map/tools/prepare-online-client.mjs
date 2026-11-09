import {readFile,writeFile,mkdir,readdir,copyFile} from 'node:fs/promises';
import path from 'node:path';
const root=path.resolve(import.meta.dirname,'..');
const installation=JSON.parse(await readFile(path.join(root,'.builda-online/installation.json'),'utf8'));
const game=JSON.parse(await readFile(path.join(root,'.builda-agent/game.json'),'utf8'));
if(!game.gameId)throw Error('缺少官方游戏绑定');
async function copy(relative=''){
  const source=path.join(root,'vendor/builda-online/client-sdk/h5/dist',relative),target=path.join(root,'public/vendor/online',relative);await mkdir(target,{recursive:true});
  for(const entry of await readdir(source,{withFileTypes:true}))if(entry.isDirectory())await copy(path.join(relative,entry.name));else if(entry.name.endsWith('.js'))await copyFile(path.join(source,entry.name),path.join(target,entry.name));
}
await copy();await writeFile(path.join(root,'public/online/config.json'),JSON.stringify({gameId:String(game.gameId),gatewayUrl:installation.gatewayUrl,defaultQueueName:installation.defaultQueueName,localGatewayUrl:installation.localRoomMock.gatewayUrl,revision:1},null,2));
await writeFile(path.join(root,'builda.room.local.json'),JSON.stringify({schema_version:1,room:{room_id:'local-pasture',room_name:'七人牧场',game_id:String(game.gameId),tick_rate:10,max_players:7,match_key:'pasture-world',room_route:'pasture-world',room_type:'authoritative',match_mode:'room',room_origin:'public_match'},actors:Array.from({length:7},(_,i)=>({player_id:`player-${i+1}`,seat_id:`seat-${i+1}`,team_id:'pasture'})),bots:[],launch_context:{}},null,2));
console.log('已从官方安装记录和游戏绑定生成公开客户端配置与七人Scenario');
