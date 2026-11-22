// Runs every scene of a directory in the simulator only and reports the ones that fail or do nothing.
//   node tools/live/sim_dry.mjs [--dir tools/live/specs/items]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadData } from '../../src/engine/gamedata.mjs';
import { runSimScene } from './sim_scene.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const flag = (k, d) => { const i = args.indexOf('--' + k); return i >= 0 ? args[i + 1] : d; };
const dir = path.resolve(flag('dir', path.join(here, 'specs', 'items')));
const data = loadData();
let n = 0; let failed = 0; let silent = 0;
for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.json')).sort()) {
  const spec = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
  n++;
  try {
    const sim = runSimScene(spec, data);
    const orders = sim.ev.filter((e) => e.k === 'order');
    const refused = orders.filter((e) => e.ok === false || e.ready === false);
    if (spec.kind === 'cast' && refused.length) { silent++; console.log(`REFUSED ${spec.id}: ${JSON.stringify(refused[0]).slice(0, 160)}`); }
  } catch (e) { failed++; console.log(`ERROR ${spec.id}: ${String(e.stack || e).split('\n').slice(0, 3).join(' | ')}`); }
}
console.log(JSON.stringify({ dir: path.basename(dir), scenes: n, failed, refused: silent }));
