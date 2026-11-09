import test from 'node:test';
import assert from 'node:assert/strict';
import {EggPresentationState,EggCullQuality,hatchPose,petPose,labelScale,luckAt,hatchRevealTime} from '../public/gameplay/egg-presentation-state.js';
import {PRESENTATION as P} from '../public/gameplay/egg-presentation/config.js';
const spec={health:100,bodyHeight:5,kind:1,sizeMult:1,zone:1};
const near=(a,b)=>assert.ok(Math.abs(a-b)<1e-6,`${a} != ${b}`);
test('source timeline keeps shell through spin and grow, then explodes/fades',()=>{
  assert.equal(P.hatch.SpinIntroDuration,1);assert.equal(P.hatch.Grow.Duration,4);assert.equal(hatchRevealTime,5);
  assert.equal(hatchPose(.99).stage,'spin');assert.equal(hatchPose(1).stage,'grow');near(hatchPose(3).scale,Math.sqrt(1.75));near(hatchPose(5).scale,1.75);
  assert.equal(hatchPose(5.1).stage,'explode');assert.ok(hatchPose(5.1).scale>1.75);assert.ok(hatchPose(5.1).opacity<1);near(hatchPose(6).opacity,0);near(hatchPose(6).scale,5.25);
});
test('idle is randomized, bounded, terminates at bind pose, never drifts',()=>{
  const e=new EggPresentationState(spec,0,()=>.1);e.nextIdle=0;assert.equal(e.sample(0).stage,'hop');near(e.sample(.175).hop,.6);near(e.sample(.35).hop,0);
  const w=new EggPresentationState(spec,0,()=>.7);w.nextIdle=0;assert.equal(w.sample(0).stage,'wiggle');const p=w.sample(.05);assert.ok(Math.hypot(p.rx,p.rz)<=6*Math.PI/180);near(w.sample(.7).rx,0);
  for(let i=1;i<=100;i++){w.nextIdle=i*10;w.sample(i*10);const end=w.sample(i*10+1);near(end.scale,1);near(end.rx,0);near(end.rz,0);near(end.hop,0);}
});
test('offscreen/far eggs skip starting idle; hits and hatch cancel active idle',()=>{
  const e=new EggPresentationState(spec,0,()=>.1);e.nextIdle=0;assert.equal(e.sample(1,{awake:false}).stage,'idle');e.nextIdle=1;e.sample(1,{awake:true});assert.ok(e.idle);
  e.hit(1.1,100,80);assert.equal(e.idle,null);assert.equal(e.sample(1.11).stage,'hit');e.hit(1.2,80,0);assert.equal(e.sample(1.21).stage,'spin');const start=e.hatchAt;e.hit(4,0,0);assert.equal(e.hatchAt,start);
});
test('health interpolation is continuous between hits and hides after six seconds',()=>{
  const e=new EggPresentationState(spec);assert.equal(e.health(0).visible,false);e.hit(1,100,80);near(e.health(1.15).value,80);e.hit(1.2,80,60);near(e.health(1.2).value,80);near(e.health(1.35).value,60);
  assert.equal(e.health(7).visible,true);assert.equal(e.health(7.39).visible,false);
  const one=new EggPresentationState(spec);one.hit(0,100,0);near(one.health(0).value,100);assert.ok(one.health(.3).value>0);near(one.health(.55).value,0);assert.equal(one.health(.74).visible,true);assert.equal(one.health(.94).visible,false);
});
test('spawn grows at fixed bottom; labels follow original size caps and luck counter',()=>{
  const e=new EggPresentationState(spec);near(e.sample(0,{spawnAge:0}).scale,.01);near(e.sample(.35,{spawnAge:.35}).scale,.75);near(e.sample(.7,{spawnAge:.7}).scale,1);
  near(labelScale(1),.75);near(labelScale(5),2);near(labelScale(100,100),9);near(luckAt(spec,1,0),1/3);near(luckAt(spec,1,1),1);
});
test('pet rises with rotation then bounce lands and stops floating',()=>{
  near(petPose(0,4).scale,.01);near(petPose(.6,4).y,4);near(petPose(1.15,4).y,0);near(petPose(3,4).yaw,0);near(petPose(3,4).scale,1);
});
test('adaptive culling retains home-zone distance and recovers conservatively',()=>{
  const q=new EggCullQuality();for(let i=0;i<800;i++)q.update(.05);assert.equal(q.tier,3);near(q.distance(200,false),90);near(q.distance(200,true),200);
  for(let i=0;i<14000;i++)q.update(1/60);assert.equal(q.tier,0);
});
