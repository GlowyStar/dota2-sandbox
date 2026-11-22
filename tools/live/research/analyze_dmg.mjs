import fs from 'node:fs';
import { loadData } from '../../../src/engine/gamedata.mjs';
const live = JSON.parse(fs.readFileSync('tools/live/out/static_live.json', 'utf8'));
const data = loadData();
const f = Math.fround;
// attribute bonus schedule from all 30 levels
const cnt = {};
for (const rec of Object.values(live)) { if (/invoker|ogre_magi|morphling/.test(rec.hero)) continue; const h = data.heroes[rec.hero]; for (const s of rec.stats) { const n = Math.round((s.agi - h.agi - h.agiGain * (s.level - 1)) / 2); (cnt[s.level] ||= {})[n] = ((cnt[s.level] || {})[n] || 0) + 1; } }
const sched = []; let prev = 0;
for (let L = 1; L <= 30; L++) { const best = Number(Object.entries(cnt[L]).sort((a, b) => b[1] - a[1])[0][0]); if (best > prev) sched.push(L); prev = best; }
console.log('attribute bonus levels:', JSON.stringify(sched));
const nAt = (L) => sched.filter((x) => x <= L).length;
// candidate float32 formulas for the attribute used by the damage formula
const cands = {
  'double':        (b, g, L, n) => b + g * (L - 1) + 2 * n,
  'f32 mult':      (b, g, L, n) => f(f(b) + f(f(g) * (L - 1))) + 2 * n,
  'f32 mult+bonus':(b, g, L, n) => f(f(f(b) + f(f(g) * (L - 1))) + 2 * n),
  'f32 iterative': (b, g, L, n) => { let a = f(b); for (let i = 1; i < L; i++) a = f(a + f(g)); return a + 2 * n; },
  'f32 iter+bonus in order': (b, g, L, n) => { let a = f(b); let k = 0; for (let l = 2; l <= L; l++) { a = f(a + f(g)); if (sched.includes(l)) a = f(a + 2); } return a; },
};
const score = {}; let total = 0; const missBest = [];
for (const rec of Object.values(live)) {
  const h = data.heroes[rec.hero]; if (h.attr === 'all') continue;
  const [b, g] = h.attr === 'str' ? [h.str, h.strGain] : h.attr === 'agi' ? [h.agi, h.agiGain] : [h.int, h.intGain];
  for (const s of rec.stats) {
    total++;
    const add = s.dmgMin - h.dmgMin;
    const n = nAt(s.level);
    for (const [k, fn] of Object.entries(cands)) { if (Math.floor(fn(b, g, s.level, n)) === add) score[k] = (score[k] || 0) + 1; else if (k === 'f32 iterative' && missBest.length < 12) missBest.push(`${rec.hero.replace('npc_dota_hero_', '')} L${s.level}: added ${add}, formula ${fn(b, g, s.level, n)}, live attr ${h.attr === 'str' ? s.str : h.attr === 'agi' ? s.agi : s.int}`); }
  }
}
console.log('single-attribute heroes, floor(attribute) with different float handling; n =', total, JSON.stringify(score));
console.log(missBest.join('\n'));
// the same candidates for health: hp - base = 20 * floor(str)
const hs = {}; let ht = 0;
for (const rec of Object.values(live)) {
  const h = data.heroes[rec.hero];
  for (const s of rec.stats) { ht++; const n = nAt(s.level); for (const [k, fn] of Object.entries(cands)) if (Math.abs(h.hp + 20 * Math.floor(fn(h.str, h.strGain, s.level, n)) - s.hp) < 0.6) hs[k] = (hs[k] || 0) + 1; }
}
console.log('health = base + 20 * floor(str); n =', ht, JSON.stringify(hs));
