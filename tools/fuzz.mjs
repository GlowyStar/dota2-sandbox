// Random fights across the whole content: heroes, creeps, shop and neutral items, talents, Scepter / Shard, rule switches.
//   node tools/fuzz.mjs [--n 20000] [--seed 1] [--workers 6] [--maxTime 40]
// Every scenario is generated from the seed, so a failing one can be reproduced: the report prints its JSON and run seed
// (save the JSON to a file and run `simlab run <file> --seed <seed>`). Exit code 1 if any fight threw an error.
import { loadData } from '../src/engine/gamedata.mjs';
import { runBatch, runSeed, Pool } from '../src/batch.mjs';
import { Rng } from '../src/engine/rng.mjs';

const args = process.argv.slice(2);
const flag = (k, d) => { const i = args.indexOf('--' + k); return i >= 0 ? Number(args[i + 1]) : d; };
const N = flag('n', 20000); const seed = flag('seed', 1); const workers = flag('workers', 6); const maxTime = flag('maxTime', 40);
const ROUND = 25000;   // scenarios generated and run per round (keeps memory flat for large N)

const data = loadData();
const heroes = Object.values(data.heroes).filter((h) => h.enabled).map((h) => h.name);
const units = Object.values(data.units).filter((u) => u.atk !== 'none' && u.hp > 1 && !/tower|fort|barracks|building|fountain/.test(u.baseClass || '')).map((u) => u.name);
const artifacts = [...new Set(Object.values(data.neutral.tiers).flatMap((t) => t.artifacts))];
const enchants = [...new Set(Object.values(data.neutral.tiers).flatMap((t) => Object.keys(t.enchants)))];
const shop = Object.values(data.abilities).filter((a) => a.item && !a.recipe && !a.obsolete && !a.artifact && !a.enchant && !a.noBuy && a.cost > 0).map((a) => a.name);

const rng = new Rng(seed);
const pick = (a) => a[rng.int(0, a.length - 1)];
const chance = (p) => rng.next() < p;
function hero(id, team) {
  const level = chance(0.15) ? 30 : rng.int(1, 30);
  const u = { id, team, unit: pick(heroes), level, talents: pick(['none', 'first', 'second', 'all', '1-2-1-2']), scepter: chance(0.35), shard: chance(0.35), items: [] };
  const n = chance(0.2) ? 0 : rng.int(1, 6);
  for (let i = 0; i < n; i++) u.items.push(pick(shop));
  if (chance(0.4)) { u.neutral = [pick(artifacts)]; if (chance(0.6)) u.neutral.push(pick(enchants)); }
  if (chance(0.15)) u.ai = 'attack';
  if (chance(0.1)) u.hp = 0.2 + rng.next() * 0.7;
  return u;
}
function team(t) {
  const out = []; const n = rng.int(1, 3);
  for (let i = 0; i < n; i++) out.push(hero(`${t ? 'b' : 'a'}${i + 1}`, t));
  if (chance(0.25)) out.push({ id: `${t ? 'b' : 'a'}c`, team: t, unit: pick(units), count: rng.int(1, 3) });
  return out;
}
function scenario() {
  const rules = { maxTime, distance: rng.int(200, 1500), gameTime: `${rng.int(0, 55)}:00` };
  if (chance(0.08)) rules.freeSpells = true;
  if (chance(0.1)) rules.detectAll = false;
  if (chance(0.1)) rules.day = false;
  if (chance(0.05)) rules.regen = false;
  return { units: [...team(0), ...team(1)], rules };
}

const t0 = Date.now();
const pool = new Pool(workers);
const groups = new Map(); let errors = 0; let done = 0; let last = 0;
for (let round = 0; done < N; round++) {
  const n = Math.min(ROUND, N - done);
  const variations = [];
  for (let i = 0; i < n; i++) variations.push({ label: String(i), set: scenario() });
  const roundSeed = seed + round * 7919;
  const res = await runBatch({ scenario: { units: [], rules: {} }, variations, runs: 1, seed: roundSeed, chunk: 50 },
    { pool, onProgress: (d) => { if (Date.now() - last > 2000) { last = Date.now(); process.stderr.write(`\r${done + d}/${N}   `); } } });
  for (const e of res.errors) {
    errors++;
    const key = `${e.error} @ ${e.at || ''}`;
    const g = groups.get(key);
    if (g) g.n++; else { const vi = Number(e.variation); groups.set(key, { n: 1, seed: runSeed(roundSeed, vi, 0), scenario: variations[vi].set }); }
  }
  done += n;
}
await pool.close();
process.stderr.write(`\r${done}/${N}   \n`);
console.log(`fights: ${N}, seconds: ${((Date.now() - t0) / 1000).toFixed(1)}, errors: ${errors} (${groups.size} distinct)`);
for (const [k, g] of [...groups].sort((a, b) => b[1].n - a[1].n).slice(0, 15)) console.log(`\n${g.n}x ${k}\n  reproduce with seed ${g.seed}: ${JSON.stringify(g.scenario)}`);
process.exitCode = errors ? 1 : 0;
