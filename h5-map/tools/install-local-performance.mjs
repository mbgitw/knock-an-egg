// Instrument a disposable compiled test copy. Never modify public or builda-draft.
import fs from 'node:fs/promises';
import path from 'node:path';
const root = path.resolve(import.meta.dirname, '..');
const relative = process.argv[2] || 'build/test-shell-20261029';
const target = path.resolve(root, relative);
if (path.dirname(target) !== path.join(root, 'build') || !path.basename(target).startsWith('test-shell-')) throw Error('Use a dedicated build/test-shell-* directory');
const file = path.join(target, 'app.js');
let source = await fs.readFile(file, 'utf8');
if (!source.includes('LOCAL_PERFORMANCE_ONLY')) {
  const replace = (from, to) => {
    if (source.split(from).length !== 2) throw Error(`Local instrumentation anchor changed: ${from}`);
    source = source.replace(from, to);
  };
  replace('renderer.setAnimationLoop((now) => {', 'const localPerformance = createLocalPerformance(renderer);\nrenderer.setAnimationLoop((now) => {');
  replace('frameMetrics.begin();', 'frameMetrics.begin();\n    localPerformance.begin(now, canvas.dataset.ready === "true" && !!player && (!online || online.session.ready));');
  replace('online == null ? void 0 : online.update(dt);', 'localPerformance.admit();\n      online == null ? void 0 : online.update(dt);');
  replace('if (environment) environment.render(camera);', 'localPerformance.beforeRender();\n    if (environment) environment.render(camera);');
  replace('else renderer.render(scene, camera);', 'else renderer.render(scene, camera);\n    localPerformance.afterRender();');
  replace('frameMetrics.end();', 'localPerformance.end();\n    frameMetrics.end();');
  replace('_r.error("frame_error", error);', '_r.error("frame_error", error);\n    localPerformance.error();');
  source = '// LOCAL_PERFORMANCE_ONLY\nimport {createLocalPerformance} from "./local-performance-only.js";\n' + source;
}
await fs.copyFile(path.join(root, 'tools/local-performance/panel.js'), path.join(target, 'local-performance-only.js'));
await fs.writeFile(file, source);
await fs.writeFile(path.join(target, 'LOCAL_ONLY_DO_NOT_PUBLISH.txt'), 'This test copy contains local performance instrumentation. Publish only a fresh build/builda-draft export.\n');
// Release input and last release export must not contain any of this instrumentation.
for (const folder of ['public', 'build/builda-draft']) {
  const entry = await fs.readFile(path.join(root, folder, 'app.js'), 'utf8');
  if (entry.includes('LOCAL_PERFORMANCE_ONLY') || entry.includes('createLocalPerformance')) throw Error(`Performance instrumentation leaked into ${folder}`);
  try { await fs.access(path.join(root, folder, 'local-performance-only.js')); throw Error(`Panel leaked into ${folder}`); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
}
console.log(`Local performance enabled: ${relative}; public and builda-draft contain no panel.`);
