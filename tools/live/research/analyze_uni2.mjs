import fs from 'node:fs';
import { loadData } from '../../../src/engine/gamedata.mjs';
const live = JSON.parse(fs.readFileSync('tools/live/out/static_live.json', 'utf8'));
const data = loadData();
for (const rec of Object.values(live)) {
  const h = data.heroes[rec.hero]; if (h.attr !== 'all') continue;
  let lo = 0, hi = 9; const rows = [];
  for (const s of rec.stats) { const sum = s.str + s.agi + s.int; const add = s.dmgMin - h.dmgMin; lo = Math.max(lo, add / sum); hi = Math.min(hi, (add + 1) / sum); rows.push(`${s.level}:${add}/${sum.toFixed(1)}`); }
  console.log(`${rec.hero.replace('npc_dota_hero_', '').padEnd(14)} c in [${lo.toFixed(5)}, ${hi.toFixed(5)}) ${lo < hi ? 'consistent' : 'INCONSISTENT'}  base ${h.dmgMin}  ${rows.slice(0, 6).join(' ')}`);
}
