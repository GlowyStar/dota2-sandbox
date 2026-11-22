// Mass simulation: variations x seeded runs, executed on a pool of worker threads, aggregated per variation.
import os from 'node:os';
import { Worker } from 'node:worker_threads';
import { buildWorld, runWorld, unscriptedReport, partialReport } from './scenario.mjs';

const WORKER_URL = new URL('./worker.mjs', import.meta.url);

// ---------------------------------------------------------------- variations
export function setPath(obj, path, value) {
  const parts = path.split('.');
  let o = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    const k = /^\d+$/.test(parts[i]) ? Number(parts[i]) : parts[i];
    if (o[k] === undefined || o[k] === null) o[k] = /^\d+$/.test(parts[i + 1]) ? [] : {};
    o = o[k];
  }
  const last = parts[parts.length - 1];
  o[/^\d+$/.test(last) ? Number(last) : last] = value;
}

const short = (v) => (typeof v === 'string' ? v : Array.isArray(v) ? v.map(short).join('+') || '-' : v && typeof v === 'object' ? (v.name || v.unit || JSON.stringify(v)) : String(v));

// vary: { "units.0.unit": ["sven","axe"], "units.0.level": [10, 20] }  -> cartesian product
// zip:  same shape, but values are taken index by index (all lists must have the same length)
export function expandVariations(job) {
  const out = [];
  if (Array.isArray(job.variations)) {
    for (const v of job.variations) out.push({ label: v.label || Object.values(v.set || {}).map(short).join(' | '), set: v.set || {} });
  } else out.push({ label: '', set: {} });
  const mult = (list, key, values) => {
    const next = [];
    for (const base of list) for (const val of values) next.push({ label: (base.label ? base.label + ' | ' : '') + short(val), set: { ...base.set, [key]: val } });
    return next;
  };
  let cur = out;
  if (job.zip) {
    const keys = Object.keys(job.zip);
    const n = job.zip[keys[0]].length;
    const next = [];
    for (const base of cur) for (let i = 0; i < n; i++) { const set = { ...base.set }; const lab = []; for (const k of keys) { set[k] = job.zip[k][i]; lab.push(short(job.zip[k][i])); } next.push({ label: (base.label ? base.label + ' | ' : '') + lab.join(' | '), set }); }
    cur = next;
  }
  if (job.vary) for (const [k, vals] of Object.entries(job.vary)) cur = mult(cur, k, vals);
  return cur;
}

export function applyVariation(scenario, set) {
  const spec = structuredClone(scenario);
  for (const [k, v] of Object.entries(set)) setPath(spec, k, structuredClone(v));
  return spec;
}

export const runSeed = (base, vi, ri) => (Math.imul(base | 0, 0x9e3779b1) + Math.imul(vi + 1, 0x85ebca77) + Math.imul(ri + 1, 0xc2b2ae3d)) >>> 0;

// ---------------------------------------------------------------- aggregation (runs inside workers)
const TBINS = 120;
export function newAgg(nUnits, maxTime) {
  return { n: 0, wins: [0, 0], draws: 0, timeouts: 0, tSum: 0, tMin: Infinity, tMax: 0, tHist: new Array(TBINS).fill(0), maxTime,
    units: Array.from({ length: nUnits }, () => ({ alive: 0, hpPct: 0, dealt: 0, taken: 0, healed: 0, phys: 0, magic: 0, pure: 0, casts: 0, hits: 0, crits: 0, misses: 0, deathT: 0 })) };
}

export function accumulate(agg, w, r, counted) {
  agg.n++;
  if (r.winner === 0 || r.winner === 1) agg.wins[r.winner]++; else if (r.ended === 'timeout') agg.timeouts++; else agg.draws++;
  agg.tSum += r.time; if (r.time < agg.tMin) agg.tMin = r.time; if (r.time > agg.tMax) agg.tMax = r.time;
  let b = Math.floor((r.time / agg.maxTime) * TBINS); if (b >= TBINS) b = TBINS - 1; agg.tHist[b]++;
  for (let i = 0; i < counted.length; i++) {
    const u = counted[i]; const a = agg.units[i];
    if (u.alive) { a.alive++; a.hpPct += u.hp / u.maxHp; } else a.deathT += u.deathTime;
    a.dealt += u.mDealt; a.taken += u.mTaken; a.healed += u.mHealed; a.phys += u.mPhys; a.magic += u.mMagic; a.pure += u.mPure;
    a.casts += u.mCasts; a.hits += u.mHits; a.crits += u.mCrits; a.misses += u.mMisses;
  }
}

export function mergeAgg(a, b) {
  if (!a) return b;
  a.n += b.n; a.wins[0] += b.wins[0]; a.wins[1] += b.wins[1]; a.draws += b.draws; a.timeouts += b.timeouts;
  a.tSum += b.tSum; a.tMin = Math.min(a.tMin, b.tMin); a.tMax = Math.max(a.tMax, b.tMax);
  for (let i = 0; i < TBINS; i++) a.tHist[i] += b.tHist[i];
  for (let i = 0; i < a.units.length; i++) { const x = a.units[i]; const y = b.units[i]; for (const k in x) x[k] += y[k]; }
  return a;
}

const r3 = (x) => Math.round(x * 1000) / 1000;
const r1 = (x) => Math.round(x * 10) / 10;
function quantile(agg, q) {
  let acc = 0; const target = agg.n * q;
  for (let i = 0; i < TBINS; i++) { acc += agg.tHist[i]; if (acc >= target) return r1(((i + 0.5) / TBINS) * agg.maxTime); }
  return agg.maxTime;
}

export function finalize(label, agg, meta) {
  const n = agg.n || 1;
  return {
    label, runs: agg.n,
    winRate: [r3(agg.wins[0] / n), r3(agg.wins[1] / n)], draws: agg.draws, timeouts: agg.timeouts,
    time: { mean: r3(agg.tSum / n), min: r3(agg.tMin), max: r3(agg.tMax), p10: quantile(agg, 0.1), p50: quantile(agg, 0.5), p90: quantile(agg, 0.9) },
    units: agg.units.map((a, i) => ({
      id: meta.units[i].id, unit: meta.units[i].unit, team: meta.units[i].team,
      survival: r3(a.alive / n), hpPctWhenAlive: a.alive ? r3(a.hpPct / a.alive) : null, deathTime: n - a.alive ? r3(a.deathT / (n - a.alive)) : null,
      dealt: r1(a.dealt / n), dps: r1(a.dealt / Math.max(1e-9, agg.tSum)), taken: r1(a.taken / n), healed: r1(a.healed / n),
      physical: r1(a.phys / n), magical: r1(a.magic / n), pure: r1(a.pure / n), casts: r3(a.casts / n), hits: r3(a.hits / n), crits: r3(a.crits / n), misses: r3(a.misses / n),
    })),
    notModelled: meta.notModelled,
    partiallyModelled: meta.partial && meta.partial.length ? meta.partial : undefined,
  };
}

// runs one variation for seeds [from, to) and returns the raw aggregate (+ meta of the first run)
export function runChunk(data, spec, baseSeed, vi, from, to) {
  const maxTime = (spec.rules && spec.rules.maxTime) ?? 120;
  let agg = null; let meta = null;
  for (let ri = from; ri < to; ri++) {
    const w = buildWorld(data, spec, runSeed(baseSeed, vi, ri));
    const counted = w.units.filter((u) => u.counts);
    if (agg === null) {
      agg = newAgg(counted.length, maxTime);
      meta = { units: counted.map((u) => ({ id: u.tag, unit: u.name, team: u.team })), notModelled: unscriptedReport(w), partial: partialReport(w) };
    }
    const r = runWorld(w, spec);
    accumulate(agg, w, r, counted);
  }
  return { agg, meta };
}

// ---------------------------------------------------------------- pool
export function defaultWorkers() { return Math.max(1, Math.min(os.availableParallelism ? os.availableParallelism() : os.cpus().length, 32) - 1); }

export class Pool {
  constructor(size = defaultWorkers()) {
    this.size = size; this.workers = []; this.idle = []; this.queue = []; this.closed = false;
    for (let i = 0; i < size; i++) {
      const w = new Worker(WORKER_URL);
      w.on('message', (msg) => this._done(w, msg));
      w.on('error', (err) => { const t = w._task; w._task = null; if (t) t.reject(err); });
      this.workers.push(w); this.idle.push(w);
    }
  }
  exec(task) { return new Promise((resolve, reject) => { this.queue.push({ task, resolve, reject }); this._pump(); }); }
  _pump() { while (this.idle.length && this.queue.length) { const w = this.idle.pop(); const t = this.queue.shift(); w._task = t; w.postMessage(t.task); } }
  _done(w, msg) { const t = w._task; w._task = null; this.idle.push(w); if (msg && msg.error) t.reject(new Error(msg.error)); else t.resolve(msg); this._pump(); }
  async close() { this.closed = true; await Promise.all(this.workers.map((w) => w.terminate())); }
}

// job: { scenario, runs, seed, vary / zip / variations, workers, chunk }
export async function runBatch(job, { pool = null, onProgress = null, signal = null } = {}) {
  const t0 = Date.now();
  const runs = Math.max(1, job.runs | 0 || 100);
  const baseSeed = job.seed ?? 1;
  const variations = expandVariations(job);
  const total = variations.length * runs;
  const own = pool === null;
  const p = pool || new Pool(job.workers || defaultWorkers());
  const chunk = job.chunk || Math.max(50, Math.min(2000, Math.ceil(total / (p.size * 8))));
  const aggs = new Array(variations.length).fill(null);
  const metas = new Array(variations.length).fill(null);
  const errors = [];
  let done = 0;
  const tasks = [];
  // group small variations into one task to cut message overhead
  let bundle = [];
  let bundleRuns = 0;
  const flush = () => {
    if (!bundle.length) return;
    const items = bundle; bundle = []; bundleRuns = 0;
    tasks.push(p.exec({ type: 'chunks', scenario: job.scenario, baseSeed, items }).then((res) => {
      for (const r of res.results) {
        if (r.error) { errors.push({ variation: variations[r.vi].label, error: r.error, at: r.at }); continue; }
        aggs[r.vi] = mergeAgg(aggs[r.vi], r.agg);
        if (!metas[r.vi]) metas[r.vi] = r.meta;
        done += r.to - r.from;
      }
      if (onProgress) onProgress(done, total);
    }));
  };
  for (let vi = 0; vi < variations.length; vi++) {
    for (let from = 0; from < runs; from += chunk) {
      if (signal && signal.aborted) break;
      const to = Math.min(runs, from + chunk);
      bundle.push({ vi, set: variations[vi].set, from, to });
      bundleRuns += to - from;
      if (bundleRuns >= chunk) flush();
    }
  }
  flush();
  await Promise.all(tasks);
  if (own) await p.close();
  const results = [];
  for (let vi = 0; vi < variations.length; vi++) if (aggs[vi]) results.push(finalize(variations[vi].label, aggs[vi], metas[vi]));
  const ms = Date.now() - t0;
  return { scenarios: done, variations: variations.length, runsPerVariation: runs, seconds: r3(ms / 1000), scenariosPerSecond: Math.round(done / Math.max(0.001, ms / 1000)), workers: p.size, errors, results };
}
