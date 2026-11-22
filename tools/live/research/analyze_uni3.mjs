import fs from 'node:fs';
import { loadData } from '../../../src/engine/gamedata.mjs';
const live = JSON.parse(fs.readFileSync('tools/live/out/static_live.json', 'utf8'));
const data = loadData();
const f = Math.fround; const sched = [15, 16, 17, 19, 20, 21, 22];
const it = (b, g, L) => { let a = f(b); for (let i = 1; i < L; i++) a = f(a + f(g)); return a + 2 * sched.filter((x) => x <= L).length; };
const cands = {
  'floor(0.45 * sum of floor(attr))': (S, A, I) => Math.floor(0.45 * (Math.floor(S) + Math.floor(A) + Math.floor(I)) + 1e-9),
  'floor(f32(0.45) * sum of floor(attr))': (S, A, I) => Math.floor(f(f(0.45) * (Math.floor(S) + Math.floor(A) + Math.floor(I)))),
  'floor(0.45*S)+floor(0.45*A)+floor(0.45*I) on floors': (S, A, I) => Math.floor(0.45 * Math.floor(S) + 1e-9) + Math.floor(0.45 * Math.floor(A) + 1e-9) + Math.floor(0.45 * Math.floor(I) + 1e-9),
};
const score = {}; let n = 0; const miss = {};
for (const rec of Object.values(live)) {
  const h = data.heroes[rec.hero]; if (h.attr !== 'all') continue;
  for (const s of rec.stats) {
    n++; const add = s.dmgMin - h.dmgMin;
    const S = it(h.str, h.strGain, s.level), A = it(h.agi, h.agiGain, s.level), I = it(h.int, h.intGain, s.level);
    for (const [k, fn] of Object.entries(cands)) { if (fn(S, A, I) === add) score[k] = (score[k] || 0) + 1; else (miss[k] ||= []).push(`${rec.hero.replace('npc_dota_hero_', '')} L${s.level} live ${add} got ${fn(S, A, I)} (${S.toFixed(4)}/${A.toFixed(4)}/${I.toFixed(4)})`); }
  }
}
console.log('n =', n, JSON.stringify(score));
for (const [k, m] of Object.entries(miss)) { const heroes = [...new Set(m.map((x) => x.split(' ')[0]))]; console.log(`\n${k}: misses ${m.length} in ${heroes.length} heroes: ${heroes.join(', ')}\n  ` + m.filter((x) => !/void_spirit|venomancer|snapfire/.test(x)).slice(0, 10).join('\n  ')); }
