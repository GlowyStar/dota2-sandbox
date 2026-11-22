// Checker for unit (creep / summon) ability scripts and item scripts.
//   node tools/unit_check.mjs unit <unit> [<unit>...]
//   node tools/unit_check.mjs item <item> [<item>...]
//   node tools/unit_check.mjs ability <unit ability> [...]     (finds the units that carry it)
// Runs a few fights with the combat log on and reports script errors, unregistered abilities and cast counts.
import { loadData } from '../src/engine/gamedata.mjs';
import { runScenario, needsScript } from '../src/scenario.mjs';
import { abilityScripts } from '../src/engine/registry.mjs';

const data = loadData();
const [mode, ...names] = process.argv.slice(2);
let bad = 0;

function fights(mk, who) {
  const errors = []; const casts = {}; let dealt = 0; let runs = 0;
  for (let s = 1; s <= 6; s++) {
    try {
      const r = runScenario(data, mk(s), 500 + s, { log: true, logLimit: 20000 });
      runs++;
      for (const u of r.units) for (const k of ['hp', 'dealt', 'taken', 'healed']) if (!Number.isFinite(u[k])) errors.push(`NaN ${k} on ${u.id}`);
      for (const u of r.units) if (u.id.startsWith(who)) dealt += u.dealt;
      for (const e of r.log) if (e.e === 'cast' && e.a && e.a.startsWith(who)) casts[e.w] = (casts[e.w] || 0) + 1;
    } catch (e) { errors.push(String(e.stack || e).split('\n').slice(0, 3).join(' | ')); }
  }
  return { errors: [...new Set(errors)], casts, dealt: Math.round(dealt / Math.max(1, runs)), runs };
}

if (mode === 'unit' || mode === 'ability') {
  let units = names;
  if (mode === 'ability') units = [...new Set(names.flatMap((a) => Object.values(data.units).filter((u) => (u.abilities || []).includes(a)).slice(0, 2).map((u) => u.name)))];
  for (const un of units) {
    const name = data.resolve('unit', un);
    const def = name && (data.units[name] || data.heroes[name]);
    if (!def) { console.log(`${un}: unknown unit`); bad++; continue; }
    const r = fights((s) => ({ units: [{ id: 'x', team: 0, unit: name, count: 1 + (s % 3) }, { id: 'ally', team: 0, unit: 'npc_dota_neutral_kobold', count: 2 },
      { id: 'h', team: 1, unit: s % 2 ? 'sven' : 'lina', level: 6 + s * 3 }, { id: 'c', team: 1, unit: 'npc_dota_creep_badguys_melee', count: 2 }], rules: { maxTime: 40, gameTime: `${s * 8}:00` } }), 'x');
    const missing = (def.abilities || []).filter((a) => !abilityScripts.has(a));
    const ok = !r.errors.length && !missing.length;
    if (!ok) bad++;
    console.log(`${ok ? 'OK  ' : 'FAIL'} ${name.replace('npc_dota_', '').padEnd(34)} dealt/run=${r.dealt} casts=${JSON.stringify(r.casts)}` + (missing.length ? `\n     NO SCRIPT: ${missing.join(', ')}` : '') + (r.errors.length ? `\n     ERRORS: ${r.errors.slice(0, 3).join('\n       ')}` : ''));
  }
} else if (mode === 'item') {
  for (const it of names) {
    const name = data.resolve('item', it);
    const def = name && data.abilities[name];
    if (!def) { console.log(`${it}: unknown item`); bad++; continue; }
    const carriers = ['juggernaut', 'sniper', 'lina', 'sven', 'crystal_maiden', 'medusa'];
    const r = fights((s) => ({ units: [{ id: 'x', team: 0, unit: carriers[s - 1], level: 10 + s * 3, items: [{ name, level: def.maxLevel ? Math.min(def.maxLevel, 1 + (s % 4)) : 1 }] }, { id: 'ally', team: 0, unit: 'lich', level: 12 },
      { id: 'h', team: 1, unit: s % 2 ? 'axe' : 'zuus', level: 10 + s * 3, items: ['black_king_bar'] }, { id: 'c', team: 1, unit: 'npc_dota_neutral_centaur_khan', count: 2 }], rules: { maxTime: 40 } }), 'x');
    const sc = abilityScripts.get(name);
    const ok = !r.errors.length && (!!sc || !needsScript(def));
    if (!ok) bad++;
    console.log(`${ok ? 'OK  ' : 'FAIL'} ${name.replace('item_', '').padEnd(28)} script=${sc ? sc.fid || 'yes' : needsScript(def) ? 'MISSING' : 'stats only'} dealt/run=${r.dealt} casts=${JSON.stringify(r.casts)}` + (r.errors.length ? `\n     ERRORS: ${r.errors.slice(0, 3).join('\n       ')}` : ''));
  }
} else { console.log('usage: node tools/unit_check.mjs unit|ability|item <names...>'); bad = 1; }
process.exitCode = bad ? 1 : 0;
