import test from 'node:test';
import assert from 'node:assert/strict';
import {bankMotion,cardMotion} from '../public/gameplay/bank-feedback-motion.js';
test('bank camera returns to its starting FOV and flash finishes at 1.45 seconds',()=>{
  for(const base of [55,70,85]){
    assert.equal(bankMotion(0,base).fov,base);
    assert.equal(bankMotion(0,base).opacity,1);
    assert.equal(bankMotion(.45,base).fov,100);
    const end=bankMotion(1.45,base);assert.equal(end.fov,base);assert.equal(end.opacity,0);assert.equal(end.done,true);
  }
});
test('reward stays three seconds then pops up and shrinks away',()=>{
  assert.ok(Math.abs(cardMotion(0).scale)<1e-10);assert.ok(cardMotion(.3).scale>1);
  assert.equal(cardMotion(.42).scale,1);assert.equal(cardMotion(2.99).done,false);
  assert.ok(Math.abs(cardMotion(3.1).scale-1.1)<1e-10);
  assert.ok(Math.abs(cardMotion(3.32).scale)<1e-10);assert.equal(cardMotion(3.32).done,true);
});
