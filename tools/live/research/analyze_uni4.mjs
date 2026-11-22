import fs from 'node:fs';
import { loadData } from '../../../src/engine/gamedata.mjs';
const live = JSON.parse(fs.readFileSync('tools/live/out/static_live.json', 'utf8'));
const data = loadData();
const f = Math.fround; const sched = [15, 16, 17, 19, 20, 21, 22];
const it = (b, g, L) => { let a = f(b); for (let i = 1; i < L; i++) a = f(a + f(g)); return a + 2 * sched.filter((x) => x <= L).length; };
const cands = {
  'floor(0.45 * floor(f32 sum))': (S, A, I) => Math.floor(0.45 * Math.floor(f(f(S + A) + I)) + 1e-9),
  'floor(f32(0.45) * floor(f32 sum))': (S, A, I) => Math.floor(f(f(0.45) * Math.floor(f(f(S + A) + I)))),
  'floor(0.45 * floor(double sum of f32 attrs))': (S, A, I) => Math.floor(0.45 * Math.floor(S + A + I) + 1e-9),
};
const score = {}; let n = 0; const miss = [];
for (const rec of Object.values(live)) {
  const h = data.heroes[rec.hero]; if (h.attr !== 'all') continue;
  for (const s of rec.stats) {
    n++; const add = s.dmgMin - h.dmgMin;
    const S = it(h.str, h.strGain, s.level), A = it(h.agi, h.agiGain, s.level), I = it(h.int, h.intGain, s.level);
    for (const [k, fn] of Object.entries(cands)) { if (fn(S, A, I) === add) score[k] = (score[k] || 0) + 1; else if (k === 'floor(0.45 * floor(double sum of f32 attrs))') miss.push(`${rec.hero.replace('npc_dota_hero_', '')} L${s.level} live ${add} got ${fn(S, A, I)} sum ${(S + A + I).toFixed(5)}`); }
  }
}
console.log('n =', n, JSON.stringify(score));
const heroes = [...new Set(miss.map((x) => x.split(' ')[0]))];
console.log('misses', miss.length, 'heroes', heroes.join(', ')); console.log(miss.filter((x) => !/void_spirit/.test(x)).slice(0, 16).join('\n'));
