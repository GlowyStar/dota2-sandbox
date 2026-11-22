#!/usr/bin/env node
// simlab command line. Run "simlab help" for the command list.
import fs from 'node:fs';
import path from 'node:path';

const argv = process.argv.slice(2);
const cmd = argv[0] || 'help';
const flags = {}; const pos = [];
for (let i = 1; i < argv.length; i++) {
  const a = argv[i];
  if (a.startsWith('--')) { const k = a.slice(2); const nx = argv[i + 1]; if (nx === undefined || nx.startsWith('--')) flags[k] = true; else { flags[k] = nx; i++; } }
  else pos.push(a);
}
const num = (k, d) => (flags[k] !== undefined ? Number(flags[k]) : d);
const list = (k) => (flags[k] ? String(flags[k]).split(',').map((s) => s.trim()).filter(Boolean) : []);
const out = (o) => console.log(typeof o === 'string' ? o : JSON.stringify(o, null, flags.compact ? 0 : 1));
const readJson = (f) => JSON.parse(fs.readFileSync(f, 'utf8'));

const HELP = `simlab - headless combat simulator built from Dota 2 game data

  simlab build-data [--game <.../dota 2 beta/game/dota>] [--folder <extracted files>]   rebuild data/ from the installed game
  simlab info                                   data build, counts, coverage summary
  simlab list heroes|units|items|neutral_items [query]
  simlab describe <name>                        data + tooltip for a hero / unit / item / ability
  simlab sheet <unit> [--level N] [--items a,b] [--talents first]
  simlab run <scenario.json> [--seed N] [--log]
  simlab batch <job.json> [--workers N] [--top N] [--sort winrate|time]
  simlab matrix --a h1,h2 [--b h3,h4] [--level N] [--items a,b] [--runs N] [--workers N]
  simlab bench [--runs 1000000] [--workers N] [--level 20]     throughput test (all heroes vs all heroes)
  simlab validate [--feed <valve_datafeed/english/heroes>]      cross-check stats against Valve's numbers
  simlab coverage [--write]                     what is modelled (writes COVERAGE.md with --write)
  simlab mcp                                    start the MCP server on stdio
  simlab env                                    start the environment server for ML agents (JSON lines on stdio, see docs/ENV.md)
`;

async function main() {
  if (cmd === 'help' || cmd === '--help' || cmd === '-h') { console.log(HELP); return; }
  if (cmd === 'build-data') {
    const { writeGameData } = await import('./data/compile.mjs');
    const { DATA_DIR } = await import('./engine/gamedata.mjs');
    const meta = writeGameData(DATA_DIR, { game: flags.game, folder: flags.folder, log: (s) => console.error(s) });
    out(meta); return;
  }
  if (cmd === 'mcp') { const { startMcp } = await import('./mcp.mjs'); startMcp(); return; }
  if (cmd === 'env') { const { startEnvServer } = await import('./env.mjs'); startEnvServer(); return; }
  const api = await import('./api.mjs');
  try {
    switch (cmd) {
      case 'info': out(api.info()); break;
      case 'list': out(api.list({ kind: pos[0] || 'heroes', query: pos[1] || flags.query || '' })); break;
      case 'describe': out(api.describe({ name: pos.join(' ') })); break;
      case 'sheet': out(api.charSheet({ unit: pos[0], level: num('level', 1), items: list('items'), talents: flags.talents || 'none', scepter: !!flags.scepter, shard: !!flags.shard })); break;
      case 'run': out(api.run({ scenario: readJson(pos[0]), seed: num('seed', 1), log: !!flags.log, logLimit: num('logLimit', 400) })); break;
      case 'batch': { const job = readJson(pos[0]); if (flags.workers) job.workers = num('workers'); if (flags.runs) job.runs = num('runs'); if (flags.top) job.top = num('top'); if (flags.sort) job.sort = flags.sort; out(await api.batch(job, { onProgress: progress })); break; }
      case 'matrix': { const common = { level: num('level', 1) }; if (flags.items) common.items = list('items'); if (flags.talents) common.talents = flags.talents; out(await api.matrix({ a: list('a'), b: flags.b ? list('b') : undefined, common, runs: num('runs', 100), workers: flags.workers ? num('workers') : undefined })); break; }
      case 'bench': await bench(api); break;
      case 'validate': await validate(api); break;
      case 'coverage': { const { coverageMarkdown } = await import('./coverage.mjs'); if (flags.write) { const f = path.join(api.ROOT, 'COVERAGE.md'); fs.writeFileSync(f, coverageMarkdown(api.data())); console.log('written', f); } out(api.coverageReport({ hero: pos[0] }).summary || api.coverageReport({ hero: pos[0] })); break; }
      default: console.error(`unknown command "${cmd}"\n`); console.log(HELP); process.exitCode = 2;
    }
  } finally { await api.shutdown(); }
}

let lastP = 0;
function progress(done, total) { const now = Date.now(); if (now - lastP > 1000 || done === total) { lastP = now; process.stderr.write(`\r${done}/${total} (${(done / total * 100).toFixed(1)}%)   `); if (done === total) process.stderr.write('\n'); } }

async function bench(api) {
  const d = api.data();
  const heroes = Object.values(d.heroes).filter((h) => h.enabled).map((h) => h.name);
  const target = num('runs', 1000000);
  const runs = Math.max(1, Math.round(target / (heroes.length * heroes.length)));
  const job = { name: 'bench', scenario: { units: [{ id: 'a', team: 0, unit: heroes[0], level: num('level', 20), items: list('items') }, { id: 'b', team: 1, unit: heroes[1], level: num('level', 20), items: list('items') }], rules: { maxTime: 90 } },
    vary: { 'units.0.unit': heroes, 'units.1.unit': heroes }, runs, seed: num('seed', 1), workers: flags.workers ? num('workers') : undefined, top: 3 };
  const res = await api.batch(job, { onProgress: progress });
  out({ scenarios: res.scenarios, variations: res.variations, runsPerVariation: res.runsPerVariation, seconds: res.seconds, scenariosPerSecond: res.scenariosPerSecond, workers: res.workers, errors: res.errorCount, file: res.file });
}

async function validate(api) {
  const feedDir = flags.feed || path.resolve(api.ROOT, '../Dota2_data/raw/valve_datafeed/english/heroes');
  if (!fs.existsSync(feedDir)) { console.error(`datafeed folder not found: ${feedDir} (pass --feed)`); process.exitCode = 2; return; }
  const d = api.data(); let checked = 0; const bad = [];
  for (const f of fs.readdirSync(feedDir)) {
    const h = JSON.parse(fs.readFileSync(path.join(feedDir, f), 'utf8')).result.data.heroes[0];
    const def = d.heroes[h.name];
    if (!def) { bad.push([h.name, 'missing in data pack']); continue; }
    const s = api.charSheet({ unit: h.name, level: 1, noAbilities: true });
    const uni = def.attr === 'all';
    const exp = { hp: h.max_health, mana: h.max_mana, hpRegen: h.health_regen, manaRegen: h.mana_regen, armor: h.armor, damageMin: uni ? null : h.damage_min, damageMax: uni ? null : h.damage_max, moveSpeed: h.movement_speed, attackRange: h.attack_range };
    for (const [k, v] of Object.entries(exp)) { if (v === null) continue; if (Math.abs(s[k] - v) > 0.011) bad.push([h.name, k, s[k], v]); }
    if (Math.abs(def.bat - h.attack_rate) > 1e-6) bad.push([h.name, 'bat', def.bat, h.attack_rate]);
    checked++;
  }
  out({ heroesChecked: checked, fields: 'hp, mana, hpRegen, manaRegen, armor, damageMin/Max (non-universal), moveSpeed, attackRange, base attack time', mismatches: bad.length, details: bad.slice(0, 30) });
  process.exitCode = bad.length ? 1 : 0;
}

main().catch((e) => { console.error(e && e.stack ? e.stack : e); process.exit(1); });
