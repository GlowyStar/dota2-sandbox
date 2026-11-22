// Strict per-hero checker for ability scripts.
//   node tools/hero_check.mjs <hero> [<hero> ...]      (set SIMLAB_SCRIPTS=<your file> while authoring)
// For every hero it runs fights at several levels, with and without Scepter/Shard, against different opponents and reports:
//   - script errors (exceptions), NaN values
//   - abilities of the hero that have no script at all
//   - castable abilities that were never cast in any run (usually a broken `ai` condition)
// Exit code 1 if anything is wrong.
import { loadData } from '../src/engine/gamedata.mjs';
import { runScenario } from '../src/scenario.mjs';
import { abilityScripts } from '../src/engine/registry.mjs';

const data = loadData();
const args = process.argv.slice(2);
const verbose = args.includes('-v');
const heroes = args.filter((a) => a !== '-v');
let bad = 0;

for (const hn of heroes) {
  const name = data.resolve('unit', hn);
  const def = name && data.heroes[name];
  if (!def) { console.log(`${hn}: unknown hero`); bad++; continue; }
  const errors = []; const casts = {}; let dealt = 0; let runs = 0;
  const opponents = [
    [{ id: 'b', team: 1, unit: 'axe', items: ['heart'] }],
    [{ id: 'b', team: 1, unit: 'sniper' }, { id: 'c', team: 1, unit: 'crystal_maiden' }],
    [{ id: 'b', team: 1, unit: 'npc_dota_neutral_centaur_khan', count: 3 }, { id: 'd', team: 1, unit: 'lina' }],
  ];
  for (const level of [1, 6, 12, 18, 25, 30]) {
    for (const up of [false, true]) {
      for (let oi = 0; oi < opponents.length; oi++) {
        const opp = opponents[oi].map((o) => ({ ...o, level: o.unit.startsWith('npc_') ? undefined : level }));
        const spec = { units: [{ id: 'a', team: 0, unit: name, level, scepter: up, shard: up, talents: level >= 25 ? 'all' : oi % 2 ? 'second' : 'first', items: up ? ['black_king_bar', 'power_treads'] : [] },
          { id: 'ally', team: 0, unit: 'sven', level, ai: 'attack' }, ...opp], rules: { maxTime: 45 } };
        try {
          const r = runScenario(data, spec, 1000 + level * 7 + oi, { log: true, logLimit: 20000 });
          runs++;
          for (const u of r.units) for (const k of ['hp', 'dealt', 'taken', 'healed']) if (!Number.isFinite(u[k])) errors.push(`NaN ${k} on ${u.id} (level ${level})`);
          dealt += r.units[0].dealt;
          for (const e of r.log) if (e.e === 'cast' && e.a === 'a') casts[e.w] = (casts[e.w] || 0) + 1;
        } catch (e) { errors.push(`level ${level}${up ? ' +aghs' : ''} vs#${oi}: ${String(e.stack || e).split('\n').slice(0, 3).join(' | ')}`); }
      }
    }
  }
  const missing = def.abilities.filter((a) => !abilityScripts.has(a));
  const castable = def.abilities.filter((a) => { const sc = abilityScripts.get(a); return sc && (sc.cast || sc.ai) && !sc.manual; });
  const neverCast = castable.filter((a) => !casts[a]);
  const ok = !errors.length && !missing.length;
  if (!ok) bad++;
  console.log(`${ok ? 'OK  ' : 'FAIL'} ${name.replace('npc_dota_hero_', '').padEnd(20)} runs=${runs} dealt/run=${Math.round(dealt / Math.max(1, runs))}` +
    (missing.length ? `\n     NO SCRIPT: ${missing.join(', ')}` : '') + (neverCast.length ? `\n     never cast: ${neverCast.join(', ')}` : '') + (errors.length ? `\n     ERRORS (${errors.length}): ${[...new Set(errors)].slice(0, 4).join('\n       ')}` : ''));
  if (verbose) console.log('     casts: ' + Object.entries(casts).map(([k, v]) => `${k.replace(name.replace('npc_dota_hero_', '') + '_', '')}=${v}`).join(' ') + '\n     fidelity: ' + def.abilities.map((a) => `${a.replace(name.replace('npc_dota_hero_', '') + '_', '')}:${(abilityScripts.get(a) || {}).fid || '?'}`).join(' '));
}
process.exitCode = bad ? 1 : 0;
