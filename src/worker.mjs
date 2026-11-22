// Worker thread: runs chunks of seeded scenarios and returns raw aggregates.
import { parentPort } from 'node:worker_threads';
import { loadData } from './engine/gamedata.mjs';
import { applyVariation, runChunk } from './batch.mjs';

const data = loadData();

// where an error happened: the two innermost stack frames, shortened to paths inside src/
function where(e) {
  if (!e || !e.stack) return '';
  return String(e.stack).split('\n').slice(1, 3).map((x) => x.trim().replace(/^at /, '').replace(/file:\/\/\/.*?\/src\//, 'src/')).join(' <- ');
}

parentPort.on('message', (task) => {
  try {
    if (task.type === 'chunks') {
      const results = [];
      for (const it of task.items) {
        try {
          const spec = applyVariation(task.scenario, it.set);
          const { agg, meta } = runChunk(data, spec, task.baseSeed, it.vi, it.from, it.to);
          results.push({ vi: it.vi, from: it.from, to: it.to, agg, meta });
        } catch (e) {
          results.push({ vi: it.vi, from: it.from, to: it.to, error: String(e && e.message ? e.message : e), at: where(e) });
        }
      }
      parentPort.postMessage({ results });
    } else parentPort.postMessage({ error: 'unknown task type' });
  } catch (e) {
    parentPort.postMessage({ error: String(e && e.stack ? e.stack : e) });
  }
});
