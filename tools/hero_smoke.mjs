// Smoke test: each listed hero fights a durable dummy-ish opponent with full AI; prints casts and damage split, catches script errors.
import { loadData } from '../src/engine/gamedata.mjs';
import { runScenario } from '../src/scenario.mjs';
const data = loadData();
const heroes = process.argv.slice(2);
for (const h of heroes) {
  for (const [lvl, opp] of [[20, 'axe'], [12, 'lich']]) {
    try {
      const r = runScenario(data, { units: [{ id: 'a', team: 0, unit: h, level: lvl, talents: 'first' }, { id: 'b', team: 1, unit: opp, level: lvl, ai: 'attack' }], rules: { maxTime: 90 } }, 11, { log: true, logLimit: 3000 });
      const a = r.units[0];
      const casts = {}; for (const e of r.log) if (e.e === 'cast' && e.a === 'a') casts[e.w.replace(/^[a-z]+_/, '')] = (casts[e.w.replace(/^[a-z]+_/, '')] || 0) + 1;
      const miss = (r.notModelled || []).filter((x) => x.unit === 'a').map((x) => x.missing.join(',')).join('');
      console.log(`${h.padEnd(18)} L${lvl} vs ${opp.padEnd(5)} win=${r.winner} t=${String(r.time).padEnd(7)} dealt=${String(a.dealt).padEnd(7)} P/M/Pu=${a.physical}/${a.magical}/${a.pure} crits=${a.crits} heal=${a.healed} casts=${JSON.stringify(casts)}${miss ? ' MISSING:' + miss : ''}`);
    } catch (e) { console.log(`${h} L${lvl} ERROR ${e.stack.split('\n').slice(0, 5).join(' | ')}`); }
  }
}
