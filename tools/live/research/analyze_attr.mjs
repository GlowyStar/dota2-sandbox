import fs from 'node:fs';
import { loadData } from '../../../src/engine/gamedata.mjs';
const live = JSON.parse(fs.readFileSync('tools/live/out/static_live.json', 'utf8'));
const data = loadData();
// attribute bonus count by level: (live - base - gain*(L-1)) / 2, majority over heroes and attributes
const byLevel = {};
for (const rec of Object.values(live)) {
  const h = data.heroes[rec.hero];
  if (/invoker|ogre_magi/.test(rec.hero)) continue;
  for (const s of rec.stats) for (const [k, b, g] of [['str', h.str, h.strGain], ['agi', h.agi, h.agiGain], ['int', h.int, h.intGain]]) {
    const n = Math.round((s[k] - b - g * (s.level - 1)) / 2 * 100) / 100;
    ((byLevel[s.level] ||= {})[n] ||= 0); byLevel[s.level][n]++;
  }
}
console.log('attribute bonus count by hero level (value: how many hero-attributes show it):');
console.log(Object.entries(byLevel).map(([L, c]) => `L${L}: ${Object.entries(c).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([n, k]) => `${n}x${k}`).join(' ')}`).join('\n'));
const inv = live['npc_dota_hero_invoker'];
const hi = data.heroes['npc_dota_hero_invoker'];
console.log('invoker:', inv.stats.map((s) => `L${s.level}:${((s.str - hi.str - hi.strGain * (s.level - 1)) / 2).toFixed(1)}`).join(' '));
// damage: what is added to the base damage?
const rows = [];
for (const rec of Object.values(live)) {
  const h = data.heroes[rec.hero];
  for (const s of rec.stats) {
    const add = s.dmgMin - h.dmgMin;
    const prim = h.attr === 'str' ? s.str : h.attr === 'agi' ? s.agi : h.attr === 'int' ? s.int : null;
    if (prim !== null) { if (add !== Math.floor(prim + 1e-6)) rows.push(`${rec.hero.replace('npc_dota_hero_', '')}(${h.attr}) L${s.level}: added ${add}, attribute ${prim}`); }
  }
}
console.log('\nsingle-attribute heroes where added damage != floor(attribute): ' + rows.length);
console.log(rows.slice(0, 30).join('\n'));
// universal heroes: candidate formulas
const cand = { 'floor(0.45*sum)': (s) => Math.floor(0.45 * (s.str + s.agi + s.int) + 1e-6), 'sum of floor(0.45*attr)': (s) => Math.floor(0.45 * s.str + 1e-6) + Math.floor(0.45 * s.agi + 1e-6) + Math.floor(0.45 * s.int + 1e-6),
  'floor(0.45*sum of floors)': (s) => Math.floor(0.45 * (Math.floor(s.str + 1e-6) + Math.floor(s.agi + 1e-6) + Math.floor(s.int + 1e-6)) + 1e-6), 'round(0.45*sum)': (s) => Math.round(0.45 * (s.str + s.agi + s.int)) };
const score = {}; let nU = 0;
for (const rec of Object.values(live)) {
  const h = data.heroes[rec.hero]; if (h.attr !== 'all') continue;
  for (const s of rec.stats) { nU++; const add = s.dmgMin - h.dmgMin; for (const [k, f] of Object.entries(cand)) if (f(s) === add) score[k] = (score[k] || 0) + 1; }
}
console.log('\nuniversal heroes, n =', nU, JSON.stringify(score));
