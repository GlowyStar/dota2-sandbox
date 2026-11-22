import fs from 'node:fs';
import { loadData } from '../../../src/engine/gamedata.mjs';
const live = JSON.parse(fs.readFileSync('tools/live/out/values_live.json', 'utf8'));
const data = loadData();
// abilities that have a level on a freshly created hero (nothing skilled): level 1 hero vs level 30 hero
const byHero = {};
for (const rec of Object.values(live)) {
  if (rec.variant !== 'A' && rec.variant !== 'B') continue;
  for (const [an, a] of Object.entries(rec.abilities)) if (a.cur > 0 && !/^plus_|^ability_|portal_warp/.test(an)) ((byHero[rec.hero] ||= {})[an] ||= {})[rec.variant] = a.cur;
}
const diffLv = []; const all = [];
for (const [h, abs] of Object.entries(byHero)) for (const [an, lv] of Object.entries(abs)) { const d = data.abilities[an] || {}; const row = `${an} A=${lv.A ?? 0} B=${lv.B ?? 0} max=${d.maxLevel ?? '-'} innate=${d.innate || 0} dep=${d.dep || '-'} beh=${(d.behavior || []).filter((b) => /HIDDEN|NOT_LEARN|PASSIVE/.test(b)).join('+')}`; all.push(row); if ((lv.A ?? 0) !== (lv.B ?? 0)) diffLv.push(row); }
console.log('auto-levelled abilities on a fresh hero:', all.length);
console.log('level differs between hero level 1 and 30 (' + diffLv.length + '):\n' + diffLv.join('\n'));
const notInnate = all.filter((r) => / innate=0 /.test(r));
console.log('\nnon-innate with a level (' + notInnate.length + '):\n' + notInnate.slice(0, 60).join('\n'));
