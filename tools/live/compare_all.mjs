// Runs every recorded scene in the simulator and compares it with the live recording.
//   node tools/live/compare_all.mjs [--hero lina] [--only id] [--owner items_2] [--dir tools/live/specs/auto] [--show 3] [--quiet]
// Writes tools/live/out/report.json and prints a per-hero summary (and, with --hero / --only, every difference).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadData } from '../../src/engine/gamedata.mjs';
import { runSimScene } from './sim_scene.mjs';
import { compareScene } from './compare_scene.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const flag = (k, d) => { const i = args.indexOf('--' + k); return i >= 0 ? args[i + 1] : d; };
const dir = path.resolve(flag('dir', path.join(here, 'specs', 'auto')));
const hero = flag('hero', null); const only = flag('only', null); const show = Number(flag('show', hero || only ? 99 : 0));
const data = loadData();
// --owner <script file name>: only the scenes whose ability / item is registered in that script file
const owner = flag('owner', null);
const ownerText = owner ? fs.readFileSync(path.join(here, '..', '..', 'src', 'scripts', owner.replace(/[.]mjs$/, '') + '.mjs'), 'utf8') : null;
const owned = (name) => !ownerText || ownerText.includes(`'${name}'`) || ownerText.includes(`'${name.replace(/^item_/, '')}'`);
const scenes = path.join(here, 'out', 'scenes');
const results = [];
for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.json')).sort()) {
  const spec = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
  const group = spec.hero || spec.item || spec.unitAbility || '?';
  if (hero && group !== hero) continue;
  if (only && spec.id !== only) continue;
  if (!owned(spec.ability || spec.item || spec.unitAbility || '')) continue;
  const lf = path.join(scenes, spec.id + '.live.json');
  if (!fs.existsSync(lf)) continue;
  const live = JSON.parse(fs.readFileSync(lf, 'utf8'));
  let sim;
  // a live scene recorded with the demo's match clock is replayed at that clock
  const simSpec = typeof live.clock === 'number' && live.clock > 0 ? { ...spec, gameTime: live.clock } : spec;
  try { sim = runSimScene(simSpec, data); } catch (e) { sim = { id: spec.id, units: {}, duration: spec.duration, ev: [], error: String(e.message || e) }; }
  const cmp = compareScene(live, sim);
  results.push({ id: spec.id, hero: group, ability: spec.ability || spec.item || spec.unitAbility, kind: spec.kind, variant: spec.variant, score: cmp.score, findings: cmp.findings });
}
const byHero = new Map();
for (const r of results) { let g = byHero.get(r.hero); if (!g) byHero.set(r.hero, g = { scenes: 0, match: 0, score: 0, kinds: {} }); g.scenes++; if (!r.findings.length) g.match++; g.score += r.score; for (const f of r.findings) g.kinds[f.kind] = (g.kinds[f.kind] || 0) + 1; }
const kinds = {};
for (const r of results) for (const f of r.findings) kinds[f.kind] = (kinds[f.kind] || 0) + 1;
const total = { scenes: results.length, match: results.filter((r) => !r.findings.length).length, findings: results.reduce((s, r) => s + r.findings.length, 0), kinds };
if (!hero && !only && !owner) fs.writeFileSync(path.join(here, 'out', `report_${path.basename(dir)}.json`), JSON.stringify({ total, results }, null, 0));
console.log(JSON.stringify(total));
if (!args.includes('--quiet')) {
  const rows = [...byHero.entries()].sort((a, b) => b[1].score - a[1].score);
  for (const [h, g] of rows) console.log(`${h.padEnd(20)} ${String(g.match).padStart(2)}/${String(g.scenes).padEnd(2)} match  score ${String(g.score).padStart(4)}  ${Object.entries(g.kinds).sort((a, b) => b[1] - a[1]).map(([k, n]) => `${k} ${n}`).join(', ')}`);
}
if (show) for (const r of results) { if (!r.findings.length) { console.log(`\n${r.id}: MATCH`); continue; } console.log(`\n${r.id} (${r.kind}): score ${r.score}`); for (const f of r.findings.slice(0, show)) console.log(`  [${f.kind}] ${f.text}`); }
