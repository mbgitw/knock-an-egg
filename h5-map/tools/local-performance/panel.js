// LOCAL_PERFORMANCE_ONLY: copied only into a dedicated loopback test build.
export function createLocalPerformance(renderer) {
  if (!['127.0.0.1', 'localhost', '[::1]'].includes(location.hostname)) throw Error('Local performance panel requires loopback');
  const panel = document.createElement('pre');
  panel.id = 'local-performance-panel';
  panel.setAttribute('aria-label', '本地实时性能');
  panel.style.cssText = 'position:fixed;right:12px;top:52px;z-index:210;pointer-events:none;margin:0;color:#fff;font:800 clamp(10px,1.55vw,13px)/1.25 Arial,sans-serif;text-align:right;white-space:pre;-webkit-text-stroke:1.5px #000;paint-order:stroke fill;font-variant-numeric:tabular-nums';
  panel.textContent = 'FPS — · 正在载入…';
  document.body.append(panel);
  const fresh = () => ({frames:0,updates:0,intervals:0,intervalMs:0,updateMs:0,renderMs:0,delayMs:0,gapMs:0,gaps:0,callMin:Infinity,callMax:0,triangles:0,hidden:0,paused:0,notReady:0,busy:0});
  let stats = fresh(), windowStart = performance.now(), previous = null, previousEnd = null, start = 0, renderStart = 0, renderMs = 0, updateMs = 0, oldAutoReset = true, wasReady = false;
  const n = value => value.toFixed(1);
  const k = value => value >= 1000 ? `${n(value / 1000)}k` : `${Math.round(value)}`;
  function flush(now) {
    if (now - windowStart < 500 || !stats.frames) return;
    const f = stats.frames, elapsed = (now - windowStart) / 1000;
    const fps = stats.intervals && stats.intervalMs ? stats.intervals * 1000 / stats.intervalMs : 0;
    panel.textContent = `FPS ${n(fps)} · ${n(stats.intervals ? stats.intervalMs / stats.intervals : 0)} ms\n` +
      `Draw calls ${stats.callMin}–${stats.callMax} · Triangles ${k(stats.triangles / f)}\n` +
      `Update ${n(stats.updateMs / f)} ms · Render submit ${n(stats.renderMs / f)} ms\n` +
      `Geometries ${renderer.info.memory.geometries} · Textures ${renderer.info.memory.textures}\n` +
      `RAF ${n(f / elapsed)} · Gate ${n(stats.updates / elapsed)}\n` +
      `Gap ${n(stats.gaps ? stats.gapMs / stats.gaps : 0)} ms · Delay ${n(stats.delayMs / f)} ms\n` +
      `Skip 后台/暂停/未就绪/购买 ${stats.hidden}/${stats.paused}/${stats.notReady}/${stats.busy}\n` +
      `DPR ${n(renderer.getPixelRatio())} · ${renderer.domElement.width}×${renderer.domElement.height}`;
    stats = fresh(); windowStart = now;
  }
  return {
    begin(timestamp, ready) {
      start = performance.now();
      if (ready !== wasReady) { stats = fresh(); windowStart = start; previous = previousEnd = null; wasReady = ready; }
      if (previous !== null) { stats.intervals++; stats.intervalMs += start - previous; }
      if (previousEnd !== null) { stats.gaps++; stats.gapMs += Math.max(0, start - previousEnd); }
      previous = start; stats.frames++; stats.delayMs += Math.max(0, start - timestamp);
      if (!ready) stats.notReady++;
      else if (document.hidden) stats.hidden++;
      else if (window.gameHostState?.paused) stats.paused++;
      else if (window.game?.commerce?.busy) stats.busy++;
      oldAutoReset = renderer.info.autoReset; renderer.info.autoReset = false; renderer.info.reset();
    },
    admit() { stats.updates++; },
    beforeRender() { renderStart = performance.now(); updateMs = renderStart - start; },
    afterRender() { renderMs = performance.now() - renderStart; },
    end() {
      stats.updateMs += updateMs; stats.renderMs += renderMs;
      const {calls, triangles} = renderer.info.render;
      stats.callMin = Math.min(stats.callMin, calls); stats.callMax = Math.max(stats.callMax, calls); stats.triangles += triangles;
      renderer.info.autoReset = oldAutoReset;
      flush(performance.now()); previousEnd = performance.now();
    },
    error() { renderer.info.autoReset = oldAutoReset; panel.textContent = '性能采样中断：游戏帧发生异常'; }
  };
}
