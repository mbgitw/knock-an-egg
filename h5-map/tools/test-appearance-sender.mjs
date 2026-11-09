import test from 'node:test';
import assert from 'node:assert/strict';
import {AppearanceSender} from '../public/online/appearance-sender.js';
test('failed appearance send cannot abort player frames and retries latest state with backoff',()=>{
  let calls=0,frames=0,fail=true;const messages=[],errors=[];
  const session={ready:true,active:true,room:{sendReliable(op,bytes){calls++;if(fail)throw Error('ROOM_CHANNEL_BUSY');messages.push(JSON.parse(new TextDecoder().decode(bytes)));}}};
  const sender=new AppearanceSender(e=>errors.push(e));
  for(let now=0;now<250;now+=10){sender.update(session,'cat',1,now);frames++;}
  assert.equal(frames,25);assert.equal(calls,1);assert.equal(errors.length,1);
  fail=false;sender.update(session,'dog',2,250);
  assert.deepEqual(messages,[{pet:'dog',swing:true}]);
  sender.update(session,'dog',2,1000);assert.equal(calls,2);
});
test('disconnected and inactive sessions send no appearance messages',()=>{
  const sender=new AppearanceSender();let calls=0;const session={ready:false,active:true,room:{sendReliable(){calls++;}}};
  sender.update(session,null,1,0);session.ready=true;session.active=false;sender.update(session,null,1,1000);
  assert.equal(calls,0);
});
