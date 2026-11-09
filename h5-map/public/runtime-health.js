// Small, best-effort client diagnostics. Installed before the module graph loads.
(() => {
  const KEY = 'knockegg_runtime_health_v1';
  const MAX_QUEUE = 8, MAX_AGE = 24 * 60 * 60 * 1000;
  const canvas = document.querySelector('canvas');
  const bytes = new TextEncoder();
  const run = (() => { try { const n = new Uint32Array(1); crypto.getRandomValues(n); return n[0].toString(16).padStart(8, '0'); } catch { return (Date.now() >>> 0).toString(16); } })();
  let connection, stage = 'boot', phase = 'boot', lastFrame = 0, readyAt = 0, firstFrame = false, stalled = false;
  let sent = 0, windowAt = Date.now(), lastBeat = 0;
  const recent = new Map();
  const clean = value => {
    const source = String(value || '')
      .replace(/https?:\/\/\S+/gi, '<url>')
      .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '<email>')
      .replace(/\b(?:token|password|secret|auth|key|user|role|name|id)\s*[:=]\s*\S+/gi, '<redacted>')
      .replace(/(['"`])[^'"`\r\n]{0,120}\1/g, '<value>')
      .replace(/\b[0-9a-f]{16,}\b/gi, '<id>')
      .replace(/\b\d{5,}\b/g, '<n>')
      .replace(/[\r\n\t\x00-\x1f]/g, ' ');
    let result = '', size = 0;
    for (const char of source) { const next = bytes.encode(char).length; if (size + next > 120) break; result += char; size += next; }
    return result;
  };
  const script = value => { try { return new URL(value, location.href).pathname.split('/').pop().slice(0, 50); } catch { return ''; } };
  const number = (value, max) => Number.isFinite(value) ? Math.max(0, Math.min(max, Math.round(value))) : 0;
  const snapshot = () => ({width:number(canvas?.width, 10000), height:number(canvas?.height, 10000), dpr:number((window.devicePixelRatio || 1) * 100, 400) / 100});
  let queue = [];
  try { const old = JSON.parse(localStorage.getItem(KEY) || '[]'); if (Array.isArray(old)) queue = old.filter(e => e && Date.now() - e.at < MAX_AGE).slice(-MAX_QUEUE); } catch {}
  const persist = () => { try { if (queue.length) localStorage.setItem(KEY, JSON.stringify(queue)); else localStorage.removeItem(KEY); } catch {} };
  const flush = () => {
    const room = connection?.session?.room;
    if (!connection?.session?.ready || !room) return;
    while (queue.length) {
      try { room.sendControl(11, bytes.encode(JSON.stringify(queue[0]))); queue.shift(); persist(); }
      catch { break; }
    }
  };
  const report = (kind, fields = {}, keep = false) => {
    try {
      const now = Date.now(); if (now - windowAt >= 60000) { windowAt = now; sent = 0; recent.clear(); }
      if (!keep) { flush(); if (!connection?.session?.ready || !connection.session.room || queue.length) return; }
      if (sent >= 12) return;
      const signature = `${kind}:${fields.name || ''}:${fields.message || ''}:${fields.file || ''}`;
      if (recent.has(signature) && now - recent.get(signature) < 30000) return;
      recent.set(signature, now); sent++;
      const event = {kind, run, at:now, ms:number(performance.now(), 3600000), stage, phase, ...snapshot(), ...fields};
      if (queue.length >= MAX_QUEUE) queue.shift(); queue.push(event);
      if (keep) persist();
      flush();
      // Normal milestones and heartbeats need no replay after the page closes.
      if (!keep && queue.includes(event)) { queue.splice(queue.indexOf(event), 1); persist(); }
    } catch {}
  };
  const error = (kind, value, file = '', line = 0, column = 0) => {
    try { const err = value instanceof Error ? value : null;
      report(kind, {name:clean(err?.name || value?.name || 'Error').slice(0, 30), message:clean(err?.message || value?.message || value), file:script(file || err?.fileName || ''), line:number(line, 100000), column:number(column, 100000)}, true);
    } catch {}
  };
  addEventListener('error', e => error('script_error', e.error || e.message, e.filename, e.lineno, e.colno));
  addEventListener('unhandledrejection', e => error('promise_error', e.reason));
  canvas?.addEventListener('webglcontextlost', () => report('webgl_lost', {}, true));
  canvas?.addEventListener('webglcontextrestored', () => report('webgl_restored', {}, true));
  setInterval(() => {
    if (!readyAt || document.hidden || window.gameHostState?.paused) return;
    const lag = performance.now() - (lastFrame || readyAt);
    if (lag > 8000 && !stalled) { stalled = true; report('frame_stall', {lagMs:number(lag, 600000)}, true); }
  }, 5000);
  window.gameHealth = {
    stage(value) { stage = String(value).slice(0, 32); },
    phase(value) { phase = String(value).slice(0, 32); },
    ready() { readyAt = performance.now(); report('ready'); },
    error,
    bind(value) { try { connection = value; flush(); value.observe?.(type => { if (type === 'status') flush(); }); } catch {} },
    frame(renderer) {
      try { const now = performance.now(); lastFrame = now;
        if (!readyAt) return;
        if (stalled) { stalled = false; report('frame_resumed'); }
        if (!firstFrame) { firstFrame = true; report('first_frame'); }
        if (now - lastBeat >= 60000) {
          lastBeat = now; const gl = renderer?.getContext?.();
          report('heartbeat', {textures:number(renderer?.info?.memory?.textures, 100000), geometries:number(renderer?.info?.memory?.geometries, 100000), programs:number(renderer?.info?.programs?.length, 100000), glError:number(gl?.getError?.(), 65535), contextLost:!!gl?.isContextLost?.()});
        }
      } catch {}
    },
    flush,
  };
})();
