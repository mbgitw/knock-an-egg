import test from 'node:test';
import assert from 'node:assert/strict';
import {MobileGestures} from '../public/mobile-gestures.js';
test('walking and looking are independent, including fingers crossing sides',()=>{
 const g=new MobileGestures();g.down(1,100,100,500);g.move(1,140,80);g.down(2,700,100,500);
 assert.equal(g.move(2,650,120).kind,'rotate');assert.equal(g.move(1,650,80).kind,'move');assert.equal(g.move(2,200,120).kind,'rotate');assert.equal(g.up(2),false);assert.equal(g.moveId,1);
});
test('only two camera fingers pinch; movement continues with three fingers',()=>{
 const g=new MobileGestures();g.down(1,100,100,500);g.down(2,600,100,500);g.down(3,800,100,500);
 assert.equal(g.move(3,900,100).ratio,2/3);assert.equal(g.move(1,150,100).kind,'move');g.up(3);assert.deepEqual(g.move(2,610,100),{kind:'rotate',dx:10,dy:0});
});
test('extra movement finger does not pinch; release/cancel/reset do not inherit old drag',()=>{
 const g=new MobileGestures();g.down(1,100,100,500);g.down(2,200,100,500);assert.equal(g.move(2,220,100),null);assert.equal(g.up(1),true);g.clear();assert.equal(g.points.size,0);assert.equal(g.move(1,200,100),null);g.down(3,150,150,500);assert.equal(g.move(3,150,150).x,0);
});
