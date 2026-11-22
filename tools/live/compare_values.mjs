// Compares the live game's resolved ability values and hero stats (tools/live/out/values_live.json, written by
// collect_values.py) with what the simulator computes for the same setup.
//   node tools/live/compare_values.mjs [--hero lina] [--show 40]
// Writes tools/live/out/values_diff.json and prints a summary.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadData } from '../../src/engine/gamedata.mjs';
import { buildWorld } from '../../src/scenario.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const flag = (k, d) => { const i = args.indexOf('--' + k); return i >= 0 ? args[i + 1] : d; };
const only = flag('hero', null); const show = Number(flag('show', 40));
const live = JSON.parse(fs.readFileSync(path.join(here, 'out', 'values_live.json'), 'utf8'));
const data = loadData();

const VARIANT = { A: { level: 1 }, B: { level: 30 }, C: { level: 30, talents: true }, D: { level: 30, scepter: true }, E: { level: 30, shard: true } };
const close = (a, b) => Math.abs(a - b) <= 0.011 + 2e-4 * Math.max(Math.abs(a), Math.abs(b));
const diffs = [];           // { hero, variant, ability, level, key, live, sim }
const missing = [];         // structural problems
let nValues = 0; let nStats = 0; let nStd = 0;
const statDiffs = [];
const stdDiffs = [];        // cooldown / mana cost / cast point / channel time getters (the game computes some of them in code)

for (const [id, rec] of Object.entries(live)) {
  const [hero, variant] = [rec.hero, rec.variant];
  if (only && !hero.endsWith(only)) continue;
  const cfg = VARIANT[variant];
  const w = buildWorld(data, { units: [{ id: 'a', unit: hero, level: cfg.level, talents: cfg.talents ? 'all' : 'none', items: cfg.scepter ? ['item_ultimate_scepter'] : cfg.shard ? ['item_aghanims_shard'] : [], skills: {}, ai: 'idle' }] }, 1);
  const u = w.byTag.get('a');
  if (!cfg.talents) u.setTalents([]);          // the live unit of this variant has no talents, even at level 30
  // attribute bonuses come with the hero level in the live game (nothing has to be skilled); Invoker has none
  u.attrLevels = hero === 'npc_dota_hero_invoker' ? 0 : [17, 19, 21, 22, 23, 24, 26].filter((x) => cfg.level >= x).length;
  // mirror the ability levels the live unit had when its stats were read
  for (const [an, a] of Object.entries(rec.abilities)) { const ab = u.findAbility(an); if (ab && ab.level !== a.cur) { if (a.cur > ab.maxLevel) ab.maxLevel = a.cur; ab.setLevel(a.cur); } }
  u.dirty = true; u.recompute();

  // ---- stats (variants without talents / items only)
  if (variant === 'A' || variant === 'B') {
    const s = rec.stats;
    const pairs = { str: u.str, agi: u.agi, int: u.int, hp: u.maxHp, mana: u.maxMana, hpRegen: u.hpRegen, manaRegen: u.manaRegen, armor: u.armor,
      dmgMin: u.dmgMin, dmgMax: u.dmgMax, as: u.attackSpeed, spa: u.attackInterval, range: u.attackRange, ms: u.ms, mrBase: u.mr * 100 };
    for (const [k, sim] of Object.entries(pairs)) {
      if (s[k] === undefined || s[k] === null) continue;
      nStats++;
      // the game shows whole numbers for attributes, damage and health
      const lv = s[k]; const tol = ['str', 'agi', 'int', 'hp', 'mana', 'dmgMin', 'dmgMax', 'as', 'ms'].includes(k) ? 1.0 : 0.02;
      if (Math.abs(lv - sim) > tol + 1e-9) statDiffs.push({ hero, variant, key: k, live: lv, sim: Math.round(sim * 1000) / 1000 });
    }
  }

  // ---- ability values
  for (const [an, a] of Object.entries(rec.abilities)) {
    if (/^plus_/.test(an) || an === 'ability_capture' || an === 'abyssal_underlord_portal_warp' || an === 'twin_gate_portal_warp' || an === 'ability_lamp_use' || an === 'ability_pluck_famango') continue;
    const ab = u.findAbility(an);
    if (!ab) { missing.push({ hero, variant, ability: an, problem: 'ability not on the simulated hero' }); continue; }
    if (ab.maxLevel !== a.max && variant === 'A') missing.push({ hero, variant, ability: an, problem: `max level live ${a.max} sim ${ab.maxLevel}` });
    const keep = ab.level;
    for (let L = 1; L <= a.max; L++) {
      const lv = a.lv[L - 1];
      if (L > ab.maxLevel) ab.maxLevel = L;
      ab.setLevel(L);
      const std = [['AbilityCooldown', lv.cd, ab.v('AbilityCooldown')], ['AbilityManaCost', lv.mc, ab.v('AbilityManaCost')], ['AbilityCastPoint', lv.cp, ab.v('AbilityCastPoint')], ['AbilityChannelTime', lv.ch, ab.v('AbilityChannelTime')]];
      for (const [k, l, s] of std) { nStd++; if (!close(l, s)) stdDiffs.push({ hero, variant, ability: an, level: L, key: k, live: l, sim: s }); }
      for (const [k, l] of Object.entries(lv.v)) {
        if (l === null || /tooltip|^current_|^total_max_heal$/.test(k)) continue;   // display-only values the game computes for the tooltip
        let s = ab.vals[k];
        nValues++;
        // the game adds area bonuses to the values it flags as area-scaled
        if (s !== undefined && !close(l, s) && ab.def.aoe && ab.def.aoe.includes(k) && u.aoeBonus && close(l, s + u.aoeBonus)) s += u.aoeBonus;
        if (s === undefined) { diffs.push({ hero, variant, ability: an, level: L, key: k, live: l, sim: null }); continue; }
        if (!close(l, s)) diffs.push({ hero, variant, ability: an, level: L, key: k, live: l, sim: Math.round(s * 1e5) / 1e5 });
      }
    }
    ab.setLevel(keep);
  }
}

// group value diffs by ability + key
const groups = new Map();
for (const d of diffs) {
  const k = `${d.ability}.${d.key}`;
  let g = groups.get(k);
  if (!g) groups.set(k, g = { ability: d.ability, key: d.key, hero: d.hero.replace('npc_dota_hero_', ''), variants: new Set(), n: 0, examples: [] });
  g.n++; g.variants.add(d.variant);
  if (g.examples.length < 3) g.examples.push(`${d.variant}/L${d.level}: live ${d.live} sim ${d.sim}`);
}
const list = [...groups.values()].map((g) => ({ ...g, variants: [...g.variants].sort().join('') })).sort((a, b) => b.n - a.n);
const byVariant = {};
for (const d of diffs) byVariant[d.variant] = (byVariant[d.variant] || 0) + 1;
const stdGroups = new Map();
for (const d of stdDiffs) { const k = `${d.ability}.${d.key}`; let g = stdGroups.get(k); if (!g) stdGroups.set(k, g = { ability: d.ability, key: d.key, variants: new Set(), n: 0, examples: [] }); g.n++; g.variants.add(d.variant); if (g.examples.length < 3) g.examples.push(`${d.variant}/L${d.level}: live ${d.live} sim ${d.sim}`); }
const stdList = [...stdGroups.values()].map((g) => ({ ...g, variants: [...g.variants].sort().join('') }));
const out = { compared: { values: nValues, standardKeys: nStd, stats: nStats }, valueDiffs: diffs.length, distinct: list.length, byVariant, stdDiffs: stdDiffs.length, stdDistinct: stdList.length, statDiffs: statDiffs.length, structural: missing.length };
fs.writeFileSync(path.join(here, 'out', 'values_diff.json'), JSON.stringify({ summary: out, groups: list, std: stdList, statDiffs, structural: missing }, null, 1));
console.log(JSON.stringify(out));
const nullSim = list.filter((g) => g.examples[0].endsWith('sim null'));
console.log(`value names unknown to the simulator: ${nullSim.length}; resolved differently: ${list.length - nullSim.length}`);
for (const g of list.filter((x) => !x.examples[0].endsWith('sim null')).slice(0, show)) console.log(`  ${g.ability}.${g.key} [${g.variants}] x${g.n}: ${g.examples.join(' | ')}`);
if (nullSim.length) console.log('unknown names (first 15): ' + nullSim.slice(0, 15).map((g) => `${g.ability}.${g.key}`).join(', '));
if (statDiffs.length) { console.log('stat diffs (first 25):'); for (const s of statDiffs.slice(0, 25)) console.log(`  ${s.hero.replace('npc_dota_hero_', '')} ${s.variant} ${s.key}: live ${s.live} sim ${s.sim}`); }
if (missing.length) { console.log('structural (first 25):'); for (const m of missing.slice(0, 25)) console.log(`  ${m.hero.replace('npc_dota_hero_', '')} ${m.variant} ${m.ability}: ${m.problem}`); }
