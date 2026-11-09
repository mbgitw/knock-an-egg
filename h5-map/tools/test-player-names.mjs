import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {PlayerNames} from '../public/online/player-names.js';
import {PLAYER_HEIGHT} from '../public/world-physics.js';
import {mockPlayerProfile} from '../public/online/mock-player-profile.js';

test('local scenario profiles provide both names only in explicitly marked shells',()=>{
  const search='?builda_mock_shell=1&builda_mock_player=player-1&builda_mock_name=Player1';
  assert.equal(mockPlayerProfile('player-1',search).name,'Player1');
  assert.equal(mockPlayerProfile('player-2',search).name,'Player2');
  assert.equal(mockPlayerProfile('player-2','?builda_mock_player=player-1'),null);
  assert.equal(mockPlayerProfile('123456',search),null);
  const {names,labels,restore}=setup();try{
    labels.connection.self='player-1';labels.connection.players=[{id:'player-1',connected:true},{id:'player-2',connected:true}];
    labels.connection.remote.actors.set('player-2',labels.connection.remote.actors.get('other'));
    for(const p of labels.connection.players)labels.profiles.set(p.id,mockPlayerProfile(p.id,search));
    names.update();assert.equal(names.entries.get('player-2').el.hidden,false);assert.equal(names.entries.get('player-2').el.textContent,'Player2');assert.equal(names.entries.has('player-1'),false);
  }finally{restore();}
});

function setup(){
  const previous=globalThis.document;
  globalThis.document={createElement:()=>({textContent:'',hidden:false,remove(){this.removed=true;}})};
  const root=new THREE.Group();root.position.x=44;
  const labels={layer:{append(){}},profiles:new Map([['other',{name:'小明 <b>测试</b>'}]]),
    connection:{self:'self',players:[{id:'other',connected:true}],remote:{actors:new Map([['other',{root}]])}},
    game:{player:{motor:{position:new THREE.Vector3()},actor:new THREE.Group()}},
    place(el,position){el.hidden=false;el.anchor=position.clone();}};
  const names=new PlayerNames(labels);
  return {names,labels,root,restore:()=>{globalThis.document=previous;}};
}
test('nearby names follow rendered players within exactly 45 units and disappear on disconnect',()=>{
  const {names,labels,root,restore}=setup();try{
    names.update();const el=names.entries.get('other').el;
    assert.equal(el.hidden,false);assert.equal(el.textContent,'小明 <b>测试</b>');assert.equal(el.anchor.y,PLAYER_HEIGHT+.9);
    root.position.set(40,3,0);names.update();assert.equal(el.hidden,false);assert.equal(el.anchor.y,3+PLAYER_HEIGHT+.9);
    root.position.x=45.01;names.update();assert.equal(el.hidden,true);
    root.position.set(48,0,0);names.update();assert.equal(el.hidden,true);
    root.position.x=45;names.update();assert.equal(el.hidden,false);
    labels.connection.players=[];names.update();assert.equal(el.removed,true);assert.equal(names.entries.size,0);
  }finally{restore();}
});
test('missing profiles stay hidden, loaded/changed names update, hidden avatars remain hidden',()=>{
  const {names,labels,root,restore}=setup();try{
    labels.profiles.clear();names.update();const el=names.entries.get('other').el;assert.equal(el.hidden,true);
    labels.profiles.set('other',{name:'玩家昵称'});names.update();assert.equal(el.hidden,false);assert.equal(el.textContent,'玩家昵称');
    root.visible=false;names.update();assert.equal(el.hidden,true);
    root.visible=true;labels.profiles.set('other',{name:'新名字'});names.update();assert.equal(el.textContent,'新名字');
    labels.connection.players.push({id:'self',connected:true});labels.profiles.set('self',{name:'自己'});names.update();assert.equal(names.entries.has('self'),false);
  }finally{restore();}
});
