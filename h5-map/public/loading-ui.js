// Loaded before the game module graph, so module failures also have a recovery UI.
(() => {
  const root = document.getElementById('loading');
  if (!root) return;
  const label = document.getElementById('loading-stage');
  const bar = document.getElementById('loading-progress');
  const fill = document.getElementById('loading-fill');
  const percent = document.getElementById('loading-percent');
  const note = document.getElementById('loading-note');
  const retry = document.getElementById('loading-retry');
  const stages = {
    boot: [0, '正在启动游戏…', 'Starting game…'],
    environment: [3, '正在准备天空与光照…', 'Preparing sky and lighting…'],
    'map-data': [7, '正在读取地图…', 'Reading map…'],
    'map-model': [12, '正在加载地图与贴图…', 'Loading map and textures…'],
    world: [45, '正在构建场景…', 'Building world…'],
    player: [52, '正在加载角色…', 'Loading character…'],
    connecting: [60, '正在连接房间与读取存档…', 'Connecting and loading your save…'],
    treadmills: [68, '正在准备训练设施…', 'Preparing training facilities…'],
    plots: [73, '正在准备牧场…', 'Preparing pastures…'],
    pickaxes: [78, '正在加载蛋与工具…', 'Loading eggs and tools…'],
    weapons: [85, '正在准备装备与界面…', 'Preparing equipment and menus…'],
    guards: [90, '正在准备守卫与玩法…', 'Preparing guards and gameplay…'],
    ready: [100, '准备完成', 'Ready'],
  };
  let current = 'boot', value = 0, failed = false, stopped = false, lastChange = Date.now();
  const zh = () => document.documentElement.lang.startsWith('zh');
  function render() {
    label.textContent = failed ? (zh() ? '加载失败，请重试' : 'Loading failed. Please retry.') : stages[current][zh() ? 1 : 2];
    percent.textContent = `${value}%`;
    bar.setAttribute('aria-valuenow', String(value));
    bar.setAttribute('aria-label', zh() ? '游戏启动进度' : 'Game startup progress');
    fill.style.width = `${value}%`;
    note.textContent = !failed && Date.now() - lastChange > 20000
      ? (zh() ? '此步骤耗时较长，请稍候…' : 'This step is taking longer. Please wait…')
      : (zh() ? '启动进度' : 'Startup progress');
    retry.textContent = zh() ? '重新加载' : 'Reload';
  }
  retry.onclick = () => location.reload();
  const languageObserver = new MutationObserver(render);
  languageObserver.observe(document.documentElement, {attributes: true, attributeFilter: ['lang']});
  const timer = setInterval(render, 1000);
  function stop() { stopped = true; clearInterval(timer); languageObserver.disconnect(); }
  window.gameLoading = {
    stage(key) {
      if (stopped || failed || !stages[key]) return;
      current = key; value = Math.max(value, stages[key][0]); lastChange = Date.now(); render();
    },
    mapProgress(event) {
      if (stopped || failed || current !== 'map-model' || !(event.total > 0)) return;
      // Download is only part of map loading: reserve 37–45 for parsing/textures.
      const next = Math.max(value, 12 + Math.floor(25 * Math.min(1, event.loaded / event.total)));
      if (next > value) lastChange = Date.now();
      value = next; render();
    },
    fail() { if (stopped) return; failed = true; retry.hidden = false; render(); stop(); },
    finish() { stop(); root.remove(); },
  };
  render();
})();
