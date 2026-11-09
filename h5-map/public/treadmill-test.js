// Deliberately isolated QA page: no fixture funds or controls in the game URL.
import * as THREE from 'three';
import {LEVELS, SAVE_KEY, TreadmillState} from './treadmill-state.js';
const output = document.querySelector('#qa-result');
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
async function ready() { while (!window.game) { if (document.querySelector('canvas').dataset.error) throw Error(document.querySelector('canvas').dataset.error); await pause(30); } return window.game; }
let results = [];
function check(condition, message) { if (!condition) throw Error(message); results.push(message); output.textContent = `PASS ${results.length}\n${results.join('\n')}`; }
function locate(game, position, offset = new THREE.Vector3(19, 12, 17)) {
  game.treadmills.exit(); game.player.motor.teleport(position);
  const target = position.clone().add(new THREE.Vector3(0, 3.6, 0));
  game.player.previousTarget.copy(target); game.controls.target.copy(target);
  game.orbitCamera.position.copy(target).add(offset); game.controls.update();
  game.treadmills.awaitingInput = false;
}
async function board(game) { locate(game, new THREE.Vector3(-26, .51, 29)); await pause(350); }
async function belt(game) {
  const t = game.treadmills; locate(game, new THREE.Vector3(2.5, .01, 0).applyMatrix4(t.own.root.matrixWorld), new THREE.Vector3(17, 12, 17));
  t.cooldown = 0; await pause(450);
}
document.querySelector('#qa-board').onclick = async () => board(await ready());
document.querySelector('#qa-enter').onclick = async () => belt(await ready());
document.querySelector('#qa-public').onclick = async () => {
  const g = await ready();
  locate(g, new THREE.Vector3(0, .02, 0).applyMatrix4(g.treadmills.publicMatrix), new THREE.Vector3(35, 24, 38));
  await g.treadmills.startPublicEvent({seconds: 20, multiplier: 4});
};
document.querySelector('#qa-clean').onclick = () => { document.querySelector('#qa-controls').hidden = true; };

// World-sign interaction fixtures, kept exclusively on this memory-account page.
const signFixture = document.createElement('button');
signFixture.id = 'qa-sign'; signFixture.textContent = '路牌正面点击验收';
document.querySelector('#qa-controls').append(signFixture);
signFixture.onclick = async () => {
  const g = await ready(), t = g.treadmills;
  const matrix = t.sign.root.matrix;
  const position = new THREE.Vector3(-11, 0, 0).applyMatrix4(matrix); position.y = .51;
  const offset = new THREE.Vector3(-13, 7, 8).transformDirection(matrix).multiplyScalar(17);
  locate(g, position, offset);
  output.textContent = '内存账户：点击牌面价格购买；拖动、点标题、超距不能购买。';
};
document.querySelector('#qa-all').onclick = async () => {
  const run = document.querySelector('#qa-all'); run.disabled = true; results = [];
  try {
    const g = await ready(), t = g.treadmills, a = t.account;
    check(a.storage === null, '独立内存账户');
    check(t.sign.faces.length === 2 && t.sign.faces.every(f => f.parent === t.sign.root), '升级UI附着于路牌两面');
    check(t.sign.material.depthTest && !t.sign.material.toneMapped, '牌面有深度遮挡且颜色不受光照压暗');
    await board(g);
    check(t.nearBoard && !t.elements['treadmill-board'].hidden, '升级板距离与视线有效，界面可见');
    check(await t.purchase(), '100现金解锁'); check(a.data.cash === 0, '解锁扣费一次');
    check(t.sign.state.priceText === '$850K' && !t.sign.state.affordable, '购买后路牌刷新下一等级及红色缺钱按钮');
    await belt(g);
    check(a.session?.kind === 'own', '踏入跑带自动训练');
    check(g.player.animation === 'RunLobbyNew', '角色循环跑步动画');
    const pinned = g.player.motor.position.clone(), before = a.data.power;
    await pause(1000);
    check(a.data.power > before, '真实帧循环持续成长');
    check(pinned.distanceTo(g.player.motor.position) < .001, '训练位置固定');
    g.player.jump(); await pause(250);
    check(!a.session && !g.player.training && g.player.motor.position.y > .8, '跳跃退出并解除固定');
    await pause(1300); check(!a.session, '退出不会自动重新吸附');
    await belt(g); check(a.session?.kind === 'own', '再次进入可训练');
    window.dispatchEvent(new Event('blur')); const pausedPower = a.data.power; await pause(500);
    check(!a.session && a.data.power === pausedPower, '失焦退出且停止奖励');
    for (let level = 1; level < 9; level++) {
      await board(g); a.creditCash(LEVELS[level - 1].cost);
      check(await t.purchase(), `等级${level + 1}购买换模成功`);
      check(a.data.level === level + 1 && a.data.cash === 0 && t.own.metadata.tier === level + 1, `等级${level + 1}余额/模型/倍率一致`);
      await belt(g); check(g.player.training?.rate === 1 + level * .5, `等级${level + 1}训练动画速率`);
      t.exit();
    }
    await board(g); check(!await t.purchase(), '满级禁止继续扣款');
    check(t.sign.state.priceText === 'MAX' && !t.sign.state.hasNextLevel, '满级牌面显示MAX');
    a.setSlow(true); await pause(50); check(g.player.motor.walkSpeed === 18, '慢速模式还原18移速'); a.setSlow(false);
    const data = new Map(); a.storage = {getItem: k => data.get(k), setItem: (k,v) => data.set(k,v)}; a.save();
    const restored = new TreadmillState({storage: a.storage});
    check(restored.data.level === 9 && restored.data.power === a.data.power && !restored.session, '存档恢复等级与成长，不恢复训练会话');
    a.storage = null;
    check(await t.startPublicEvent({seconds: 10, multiplier: 4}), '限时公共跑步机开始');
    check(t.public.root.position.y > 200 && !a.publicActive, '260高空降落阶段禁止训练');
    await pause(1900);
    check(t.public.landed && a.publicActive && t.public.root.position.y === .5, '1.6秒落地与效果');
    check(t.bursts.length === 1, '落地爆炸仅触发一次');
    for (let slot = 0; slot < 7; slot++) {
      const local = new THREE.Vector3(...t.public.metadata.slots[slot]); local.y = .05;
      locate(g, local.applyMatrix4(t.public.root.matrixWorld)); t.cooldown = 0; await pause(180);
      check(a.session?.kind === 'public' && a.session.slot === slot, `公共站位${slot + 1}进入`);
      check(a.multiplier === 1024 && g.player.training.rate === 7.5, `公共站位${slot + 1}成长/动画叠加`);
      t.exit();
    }
    const local = new THREE.Vector3(...t.public.metadata.slots[0]); local.y = .05;
    locate(g, local.applyMatrix4(t.public.root.matrixWorld)); t.cooldown = 0; await pause(250);
    a.data.publicEvent.endsAt = Date.now() - 1; await pause(80);
    check(!a.session && !g.player.training && !t.public && t.elements['public-event'].hidden, '活动到期退出、模型/界面清理');
    await belt(g); check(a.session?.kind === 'own', '公共活动后普通训练正常');
    check(document.querySelectorAll('.speed-popup').length <= 18, '弹字数量预算有效');
    output.dataset.result = 'passed'; output.dataset.checks = results.length;
  } catch (error) { output.dataset.result = 'failed'; output.textContent += `\nFAIL ${error.message}`; console.error(error); }
  finally { run.disabled = false; }
};
