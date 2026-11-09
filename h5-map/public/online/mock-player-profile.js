// The checked-in Room scenario uses player-1 ... player-7. These are local
// fixtures, not valid numeric Builda role IDs. Never use this fallback in App.
export function mockPlayerProfile(id,search){
  const query=new URLSearchParams(search);
  if(query.get('builda_mock_shell')!=='1')return null;
  const match=/^player-([1-7])$/.exec(id);
  if(!match)return null;
  const own=query.get('builda_mock_player')===id?query.get('builda_mock_name'):null;
  return {name:own||`Player${match[1]}`,avatar:''};
}
