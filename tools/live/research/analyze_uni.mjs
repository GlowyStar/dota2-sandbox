import fs from 'node:fs';
import { loadData } from '../../../src/engine/gamedata.mjs';
const live = JSON.parse(fs.readFileSync('tools/live/out/static_live.json', 'utf8'));
const data = loadData();
const f = Math.fround; const sched = [15, 16, 17, 19, 20, 21, 22];
const it = (b, g, L) => { let a = f(b); for (let i = 1; i < L; i++) a = f(a + f(g)); return a + 2 * sched.filter((x) => x <= L).length; };
const dbl = (b, g, L) => b + g * (L - 1) + 2 * sched.filter((x) => x <= L).length;
const cands = {
  'floor(0.45*(sum f32-iter))': (S, A, I) => Math.floor(0.45 * (S + A + I)),
  'floor(f32(0.45)*f32(sum))': (S, A, I) => Math.floor(f(f(0.45) * f(S + A + I))),
  'floor(f32 sum of f32(0.45*x))': (S, A, I) => Math.floor(f(f(f(f(0.45) * f(S)) + f(f(0.45) * f(A))) + f(f(0.45) * f(I)))),
  'sum floor(0.45*x)': (S, A, I) => Math.floor(0.45 * S) + Math.floor(0.45 * A) + Math.floor(0.45 * I),
};
const score = {}; const scoreD = {}; let n = 0; const miss = [];
for (const rec of Object.values(live)) {
  const h = data.heroes[rec.hero]; if (h.attr !== 'all') continue;
  for (const s of rec.stats) {
    n++; const add = s.dmgMin - h.dmgMin;
    const S = it(h.str, h.strGain, s.level), A = it(h.agi, h.agiGain, s.level), I = it(h.int, h.intGain, s.level);
    const Sd = dbl(h.str, h.strGain, s.level), Ad = dbl(h.agi, h.agiGain, s.level), Id = dbl(h.int, h.intGain, s.level);
    for (const [k, fn] of Object.entries(cands)) { if (fn(S, A, I) === add) score[k] = (score[k] || 0) + 1; if (fn(Sd, Ad, Id) === add) scoreD[k] = (scoreD[k] || 0) + 1; }
    if (cands['floor(f32(0.45)*f32(sum))'](S, A, I) !== add && miss.length < 14) miss.push(`${rec.hero.replace('npc_dota_hero_', '')} L${s.level}: added ${add}, 0.45*sum ${(0.45 * (S + A + I)).toFixed(4)} live attrs ${s.str}/${s.agi}/${s.int} calc ${S.toFixed(3)}/${A.toFixed(3)}/${I.toFixed(3)}`);
  }
}
console.log('universal heroes n =', n, '\n f32 iterative attrs:', JSON.stringify(score), '\n double attrs:', JSON.stringify(scoreD));
console.log(miss.join('\n'));
const heroesU = Object.values(data.heroes).filter((h) => h.enabled && h.attr === 'all').map((h) => h.name.replace('npc_dota_hero_', ''));
console.log('universal heroes:', heroesU.join(' '));
