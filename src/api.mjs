// High-level API shared by the CLI and the MCP server.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadData, loadDescriptions } from './engine/gamedata.mjs';
import { abilityScripts } from './engine/registry.mjs';
import { runScenario, sheet, needsScript, resolveUnitName } from './scenario.mjs';
import { runBatch, Pool, defaultWorkers, expandVariations } from './batch.mjs';
import { coverage } from './coverage.mjs';
import { sandboxExec, listSessions } from './sandbox.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.resolve(here, '..');
export const RESULTS_DIR = path.join(ROOT, 'results');
export const VERSION = '1.0.0';

let pool = null;
let poolSize = 0;
function getPool(workers) {
  const n = Math.max(1, Math.min(64, workers || defaultWorkers()));
  if (pool && poolSize !== n) { pool.close(); pool = null; }
  if (!pool) { pool = new Pool(n); poolSize = n; }
  return pool;
}
export async function shutdown() { if (pool) { await pool.close(); pool = null; } }

export const data = () => loadData();

export const GUIDE = {
  scenario: {
    units: [{ id: 'a', team: 0, unit: 'phantom_assassin', level: 20, items: ['desolator', 'black_king_bar', { name: 'power_treads', attr: 'agi' }], neutral: [{ name: 'enhancement_brawny', level: 2 }],
      talents: 'none | first | second | all | "1-2-1-2" | [talent names]', skills: { phantom_assassin_stifling_dagger: 4 }, scepter: false, shard: false, pos: [0, 0], hp: 1, mana: 1,
      ai: 'fight | attack | idle | { mode, focus: "nearest|lowest_hp|heroes_first", target: "<unit id>", abilities: "all|none|[names]", items: "all|none|[names]", order: [cast priority names] }', count: 1 }],
    rules: { maxTime: 120, end: 'team_dead | first_death | time | { unit_dead: "<id>" }', regen: true, freeSpells: false, day: true, talents: 'default for all heroes', ai: 'default for all units' },
    distance: 600,
  },
  batch: { scenario: '<scenario>', runs: 1000, seed: 1, vary: { 'units.0.unit': ['sven', 'axe'], 'units.0.items': [['desolator'], ['greater_crit']] }, zip: { 'units.0.level': [10, 20], 'units.1.level': [10, 20] }, workers: 6 },
  notes: [
    'Names accept internal names (npc_dota_hero_sven, item_desolator), short names (sven, desolator) or display names ("Anti-Mage", "Black King Bar").',
    'Every ability and item effect has a script with a fidelity label: full, approx (simplified geometry / timing or a stated assumption), partial (a tooltip clause is missing), n/a (no meaning in an arena fight). sim_coverage with `hero` shows the label and note of each ability.',
    'Results list "partiallyModelled" (abilities of the participants whose script misses a tooltip clause) and "notModelled" (no script at all, normally empty): treat conclusions that depend on them with care.',
    'Nothing was checked against the live game: "full" means every tooltip clause is modelled, not that the behaviour was compared in a match.',
    'rules.gameTime ("mm:ss") sets the match clock: growth of jungle creeps and Roshan, neutral ability levels. rules.detectAll = false makes invisibility hide units.',
    'For step-by-step control by an external agent use the environment server (simlab env, docs/ENV.md) or the sandbox tool.',
    'vary = cartesian product over JSON paths of the scenario; zip = lists advanced together. Total scenarios = variations x runs.',
    'Units fight on an open plane (no terrain, vision, trees or creep waves). Team 0 starts at x=0, team 1 at x=distance.',
  ],
};

export function info() {
  const d = data();
  const c = coverage(d).summary;
  return { name: 'Dota2_sandbox simlab', version: VERSION, dataBuild: { ClientVersion: d.meta.ClientVersion, VersionDate: d.meta.VersionDate, source: d.meta.source, compiledAt: d.meta.compiledAt }, counts: d.meta.counts, coverage: c, cpuThreads: defaultWorkers() + 1, guide: GUIDE };
}

export function list({ kind = 'heroes', query = '', limit = 400 } = {}) {
  const d = data();
  const q = String(query || '').toLowerCase();
  const match = (...xs) => !q || xs.some((x) => x && String(x).toLowerCase().includes(q));
  let rows = [];
  if (kind === 'heroes') {
    rows = Object.values(d.heroes).filter((h) => h.enabled && match(h.name, h.dname, h.roles, h.attr)).map((h) => ({ name: h.name.replace('npc_dota_hero_', ''), display: h.dname, attr: h.attr, attack: h.atk, range: h.range, roles: h.roles, abilitiesModelled: `${h.abilities.filter((a) => abilityScripts.has(a)).length}/${h.abilities.length}` }));
  } else if (kind === 'units') {
    rows = Object.values(d.units).filter((u) => match(u.name, u.dname, u.baseClass)).map((u) => ({ name: u.name.replace('npc_dota_', ''), display: u.dname, level: u.level, hp: u.hp, armor: u.armor, damage: [u.dmgMin, u.dmgMax], attack: u.atk, neutral: u.neutral || undefined, ancient: u.ancient || undefined, class: u.baseClass }));
  } else if (kind === 'items' || kind === 'neutral_items') {
    const cur = new Map();
    for (const [tier, t] of Object.entries(d.neutral.tiers)) { for (const a of t.artifacts) cur.set(a, { tier: Number(tier), kind: 'artifact' }); for (const [e, v] of Object.entries(t.enchants)) if (!cur.has(e)) cur.set(e, { tier: Number(tier), kind: 'enchantment', level: v.level }); }
    for (const a of Object.values(d.abilities)) {
      if (!a.item || a.recipe || a.obsolete) continue;
      const n = cur.get(a.name);
      if (kind === 'neutral_items' ? !n : (a.artifact || a.enchant || a.noBuy || a.cost <= 0)) continue;
      if (!match(a.name, a.dname)) continue;
      const sc = abilityScripts.get(a.name);
      rows.push({ name: a.name.replace('item_', ''), display: a.dname, cost: n ? undefined : a.cost, tier: n ? n.tier : undefined, type: n ? n.kind : undefined, effect: sc ? (sc.fid === 'n/a' ? 'not relevant' : sc.fid || 'modelled') : needsScript(a) ? 'NOT modelled (stats only)' : 'stats only' });
    }
    rows.sort((a, b) => (a.cost ?? a.tier * 1000) - (b.cost ?? b.tier * 1000));
  } else if (kind === 'modifiers') {
    throw new Error('use sim_describe for a specific ability');
  } else throw new Error('kind must be heroes | units | items | neutral_items');
  return { kind, total: rows.length, rows: rows.slice(0, limit) };
}

const fmtVals = (vals) => { const o = {}; for (const [k, e] of Object.entries(vals)) o[k] = Array.isArray(e) ? (e.length === 1 ? e[0] : e) : e; return o; };

export function describe({ name }) {
  const d = data(); const ds = loadDescriptions();
  const strip = (s) => (s || '').replace(/<[^>]+>/g, ' ').replace(/\\n/g, ' ').replace(/\s+/g, ' ').trim();
  const abil = (n) => { const a = d.abilities[n]; if (!a) return { name: n, missing: true }; const sc = abilityScripts.get(n); const de = ds[n] || {}; return { name: n, display: a.dname, behavior: a.behavior.join('|'), damageType: a.dmg, targetTeam: a.team, immunity: a.immunity, type: a.type, innate: a.innate, maxLevel: a.maxLevel, values: fmtVals(a.vals), description: strip(de.desc), scepter: strip(de.scepter) || undefined, shard: strip(de.shard) || undefined, notes: de.notes ? de.notes.map(strip) : undefined, modelled: !!sc, fidelity: sc ? sc.fid || 'approx' : undefined, modelNote: sc ? sc.note : undefined }; };
  const un = d.resolve('unit', name);
  if (un) {
    const u = d.heroes[un] || d.units[un];
    const out = { kind: u.hero ? 'hero' : 'unit', ...u };
    out.abilities = (u.abilities || []).map(abil);
    if (u.talents) out.talents = u.talents.map((t, i) => ({ index: i, level: 10 + 5 * (i >> 1), name: t, text: t && d.abilities[t] ? d.abilities[t].dname : null }));
    return out;
  }
  const it = d.resolve('item', name);
  if (it) { const a = d.abilities[it]; return { kind: 'item', cost: a.cost, components: a.comps, recipeCost: a.recipeCost, statTokens: a.tokens, ...abil(it) }; }
  const ab = d.resolve('ability', name);
  if (ab) return { kind: 'ability', hero: d.abilities[ab].hero, ...abil(ab) };
  throw new Error(`nothing named "${name}"`);
}

export function charSheet(spec) { return sheet(data(), spec); }

export function run({ scenario, seed = 1, log = false, logLimit = 400 }) {
  const r = runScenario(data(), scenario, seed, { log, logLimit: log ? Math.max(50, logLimit) : 0 });
  return r;
}

// ---------------------------------------------------------------- batches (sync or background jobs)
const jobs = new Map();
let nextJob = 1;

function saveResult(tag, res) {
  fs.mkdirSync(RESULTS_DIR, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const file = path.join(RESULTS_DIR, `${stamp}_${String(tag || 'batch').replace(/[^\w-]+/g, '_').slice(0, 40)}.json`);
  fs.writeFileSync(file, JSON.stringify(res));
  return file;
}

function compact(res, { top = 40, sort = null } = {}) {
  let rows = res.results;
  if (sort === 'winrate') rows = rows.slice().sort((a, b) => b.winRate[0] - a.winRate[0]);
  else if (sort === 'time') rows = rows.slice().sort((a, b) => a.time.mean - b.time.mean);
  const lite = rows.slice(0, top).map((r) => ({ label: r.label, runs: r.runs, winRate: r.winRate, timeouts: r.timeouts || undefined, time: r.time.mean, p10_p90: [r.time.p10, r.time.p90], units: r.units.map((u) => ({ id: u.id, unit: u.unit.replace('npc_dota_hero_', '').replace('npc_dota_', ''), survival: u.survival, hpLeft: u.hpPctWhenAlive, dealt: u.dealt, dps: u.dps })), notModelled: r.notModelled && r.notModelled.length ? r.notModelled.map((x) => `${x.unit}: ${x.missing.join(',')}`) : undefined,
    partiallyModelled: r.partiallyModelled ? r.partiallyModelled.map((x) => `${x.unit}: ${x.abilities.join(',')}`) : undefined }));
  return { scenarios: res.scenarios, variations: res.variations, runsPerVariation: res.runsPerVariation, seconds: res.seconds, scenariosPerSecond: res.scenariosPerSecond, workers: res.workers, errors: res.errors.slice(0, 20), errorCount: res.errors.length, shown: lite.length, results: lite, file: res.file };
}

export async function batch(job, opts = {}) {
  if (!job || !job.scenario) throw new Error('batch needs { scenario, runs, vary? }');
  const variations = expandVariations(job).length;
  const total = variations * (job.runs || 100);
  if (total > 50_000_000) throw new Error(`too many scenarios (${total}); split the job`);
  const p = getPool(job.workers);
  const exec = async (onProgress) => { const res = await runBatch(job, { pool: p, onProgress }); res.file = saveResult(job.name, res); return res; };
  if (job.async) {
    const id = `job${nextJob++}`;
    const j = { id, status: 'running', done: 0, total, started: Date.now(), name: job.name };
    jobs.set(id, j);
    exec((d) => { j.done = d; }).then((res) => { j.status = 'done'; j.result = res; j.seconds = res.seconds; }).catch((e) => { j.status = 'failed'; j.error = String(e && e.message ? e.message : e); });
    return { job: id, status: 'running', total, variations };
  }
  const res = await exec(opts.onProgress);
  return compact(res, job);
}

export function jobStatus({ job, top, sort }) {
  if (!job) return { jobs: [...jobs.values()].map((j) => ({ job: j.id, name: j.name, status: j.status, done: j.done, total: j.total })) };
  const j = jobs.get(job);
  if (!j) throw new Error(`unknown job ${job}`);
  if (j.status !== 'done') return { job: j.id, status: j.status, done: j.done, total: j.total, elapsed: Math.round((Date.now() - j.started) / 100) / 10, error: j.error };
  return { job: j.id, status: 'done', ...compact(j.result, { top: top ?? 40, sort }) };
}

// every `a` setup against every `b` setup; returns a win-rate matrix for side a
export async function matrix({ a, b, common = {}, aCommon = {}, bCommon = {}, rules = {}, distance, runs = 100, seed = 1, workers, name }) {
  const d = data();
  const norm = (x) => (typeof x === 'string' ? { unit: x } : x);
  const A = a.map(norm); const B = (b || a).map(norm);
  for (const x of A.concat(B)) resolveUnitName(d, x.unit);
  const variations = [];
  for (const x of A) for (const y of B) variations.push({ label: `${x.label || x.unit} | ${y.label || y.unit}`, set: { 'units.0': { id: 'a', team: 0, ...common, ...aCommon, ...x }, 'units.1': { id: 'b', team: 1, ...common, ...bCommon, ...y } } });
  const job = { name: name || 'matrix', scenario: { units: [{}, {}], rules: { maxTime: 120, ...rules }, distance }, variations, runs, seed, workers };
  const p = getPool(workers);
  const res = await runBatch(job, { pool: p });
  res.file = saveResult(job.name, res);
  const rows = A.map((x) => x.label || x.unit); const cols = B.map((x) => x.label || x.unit);
  const win = rows.map(() => cols.map(() => null)); const time = rows.map(() => cols.map(() => null));
  res.results.forEach((r, i) => { const ri = Math.floor(i / cols.length); const ci = i % cols.length; win[ri][ci] = r.winRate[0]; time[ri][ci] = r.time.mean; });
  const avg = rows.map((_, i) => Math.round(win[i].reduce((s, v) => s + (v ?? 0), 0) / cols.length * 1000) / 1000);
  const ranking = rows.map((r, i) => ({ unit: r, avgWinRate: avg[i] })).sort((x, y) => y.avgWinRate - x.avgWinRate);
  const out = { scenarios: res.scenarios, seconds: res.seconds, scenariosPerSecond: res.scenariosPerSecond, rows, cols, ranking: ranking.slice(0, 60), errors: res.errors.slice(0, 10), file: res.file };
  if (rows.length * cols.length <= 400) { out.winRate = win; out.meanTime = time; }
  else out.note = 'matrix too large to inline; full per-pair results are in the file';
  return out;
}

export function sandbox({ session, commands }) { return sandboxExec(data(), session, commands || []); }
export function sessions() { return listSessions(); }
export function coverageReport({ hero } = {}) {
  const c = coverage(data());
  if (hero) { const n = resolveUnitName(data(), hero); return c.heroes.find((h) => h.hero === n); }
  return { summary: c.summary, heroes: c.heroes.map((h) => ({ hero: h.hero.replace('npc_dota_hero_', ''), modelled: `${h.modelled}/${h.total}`, partial: h.abilities.filter((a) => a.fid === 'partial').map((a) => a.name), missing: h.abilities.filter((a) => !a.modelled).map((a) => a.name) })),
    partialItems: c.itemEntries.filter((e) => e.fid === 'partial').map((e) => ({ name: e.name, note: e.note })), partialUnitAbilities: c.unitEntries.filter((e) => e.fid === 'partial').map((e) => ({ name: e.name, note: e.note })),
    itemsNotModelled: c.items.notModelled, neutralItemsNotModelled: c.items.neutralNotModelled };
}
