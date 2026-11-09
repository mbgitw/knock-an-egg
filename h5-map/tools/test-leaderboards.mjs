import test from 'node:test';
import assert from 'node:assert/strict';
import {BOARDS,encodeScore,decodeScore,formatRank,cleanEntries} from '../public/gameplay/leaderboard-data.js';
import {Leaderboards} from '../public/gameplay/leaderboards.js';
test('large economy scores preserve ordering and round-trip precision within platform bounds',()=>{
 for(const key of ['income','power']){let last=-1;for(const v of [0,1,10,100,1e6,1e12,1e19,1e30]){const score=encodeScore(v,key);assert.ok(score>last&&score<=9999999999);assert.ok(Math.abs(decodeScore(score,key)-v)<=Math.max(1e-6,v*3e-8));last=score;}}
 assert.equal(encodeScore(NaN,'income'),null);assert.equal(encodeScore(-1,'power'),null);assert.equal(formatRank(194270000000000,'income'),'$194.27T/s');assert.equal(formatRank(27*86400+20*3600,'playtime'),'27d 20h');
});
test('bad rows, duplicate identities and invalid scores are excluded',()=>{
 const row=(id,rank,score)=>({player:{id,name:id},rank,score});assert.deepEqual(cleanEntries([row('b',2,5),row('a',1,8),row('a',3,3),row('c',4,NaN),row('d',5,-1)]).map(e=>e.player.id),['a','b']);
});
test('refresh submits Room values, does not resubmit unchanged scores and retains rows on failure',async()=>{
 const submits=[];const b=Object.assign(Object.create(Leaderboards.prototype),{game:{account:{data:{power:1e19,rankStats:{income:1234,playtime:61}}},online:{session:{ready:true}}},boards:BOARDS.map(d=>({...d,entries:[],page:0})),lastScores:new Map(),draw(){},sdk:{rank:{async submitScore(id,score){submits.push([id,score]);return {ok:true};},async getRankList(){return {ok:true,data:{list:[{player:{id:'a',name:'A'},rank:1,score:10}],self:{rank:1,score:10}}};}}}});
 await b.refresh(true,true);assert.equal(submits.length,3);assert.equal(submits[2][1],61);await b.refresh(true,false);assert.equal(submits.length,3);
 b.sdk.rank.getRankList=async()=>{throw Error('offline');};await b.refresh(false,true);assert.equal(b.boards[0].entries.length,1);assert.equal(b.boards[0].status,'加载失败');
});
