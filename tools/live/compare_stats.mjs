// Compares hero stats at every level (live: untouched hero, nothing skilled, read one second after it appeared) with the simulator.
//   node tools/live/compare_stats.mjs [--hero axe] [--show 40]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadData } from '../../src/engine/gamedata.mjs';
import { buildWorld } from '../../src/scenario.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const flag = (k, d) => { const i = args.indexOf('--' + k); return i >= 0 ? args[i + 1] : d; };
const only = flag('hero', null); const show = Number(flag('show', 40));
const live = JSON.parse(fs.readFileSync(path.join(here, 'out', 'static_live.json'), 'utf8'));
const data = loadData();

// [key, simulator value, tolerance]; whole numbers on the game side for health, mana and damage
const KEYS = (u) => ({
  str: [u.str, 0.011], agi: [u.agi, 0.011], int: [u.int, 0.011], hp: [u.maxHp, 0.5], mana: [u.maxMana, 0.5], hpRegen: [u.hpRegen, 0.006], manaRegen: [u.manaRegen, 0.006],
  armor: [u.armor, 0.006], dmgMin: [u.dmgMin, 0.5], dmgMax: [u.dmgMax, 0.5], as: [u.attackSpeed, 0.51], spa: [u.attackInterval, 0.002], range: [u.attackRange, 0.5], ms: [u.ms, 0.5],
  mrBase: [u.mr * 100, 0.02], evasion: [u.evasion, 0.002], statusRes: [u.statusRes, 0.002], spellAmp: [u.spellAmp / 100, 0.002], castRange: [u.castRangeBonus, 0.5],
});
let n = 0; const diffs = [];
for (const rec of Object.values(live)) {
  if (only && !rec.hero.endsWith(only)) continue;
  for (const s of rec.stats) {
    const w = buildWorld(data, { units: [{ id: 'a', unit: rec.hero, level: s.level, skills: {}, ai: 'idle' }], rules: { maxTime: 5, fresh: true } }, 1);
    const u = w.byTag.get('a');
    u.setTalents([]);
    w.run(1.0);
    u.recompute();
    for (const [k, [sim, tol]] of Object.entries(KEYS(u))) {
      const lv = s[k];
      if (lv === undefined || lv === null) continue;
      n++;
      if (Math.abs(lv - sim) > tol) diffs.push({ hero: rec.hero.replace('npc_dota_hero_', ''), level: s.level, key: k, live: lv, sim: Math.round(sim * 1000) / 1000 });
    }
  }
}
const byHero = new Map();
for (const d of diffs) { let g = byHero.get(d.hero); if (!g) byHero.set(d.hero, g = { n: 0, keys: new Map() }); g.n++; const k = g.keys.get(d.key) || []; k.push(d); g.keys.set(d.key, k); }
console.log(JSON.stringify({ compared: n, differences: diffs.length, heroes: byHero.size }));
const rows = [...byHero.entries()].sort((a, b) => b[1].n - a[1].n);
for (const [h, g] of rows.slice(0, show)) {
  console.log(`${h} (${g.n}): ` + [...g.keys.entries()].map(([k, ds]) => `${k} x${ds.length} [L${ds[0].level}: live ${ds[0].live} sim ${ds[0].sim}${ds.length > 1 ? `; L${ds[ds.length - 1].level}: live ${ds[ds.length - 1].live} sim ${ds[ds.length - 1].sim}` : ''}]`).join('  '));
}
fs.writeFileSync(path.join(here, 'out', 'stats_diff.json'), JSON.stringify(diffs));
