import fs from 'node:fs';
import { loadData } from '../../../src/engine/gamedata.mjs';
const live = JSON.parse(fs.readFileSync('tools/live/out/values_live.json', 'utf8'));
const data = loadData();
const maxLen = (vals) => { let n = 0; for (const k in vals) { const e = vals[k]; const a = Array.isArray(e) ? e : e.v; if (a.length > n) n = a.length; } return n; };
// 1. max level hypothesis: explicit MaxLevel, else longest value array
let ok = 0; const bad = [];
for (const rec of Object.values(live)) {
  if (rec.variant !== 'A') continue;
  for (const [an, a] of Object.entries(rec.abilities)) {
    const d = data.abilities[an]; if (!d) continue;
    const guess = d.maxLevel ?? Math.max(1, maxLen(d.vals));
    if (guess === a.max) ok++; else bad.push(`${an}: live ${a.max} guess ${guess} (kv ${d.maxLevel}, type ${d.type}, innate ${d.innate || 0}, len ${maxLen(d.vals)})`);
  }
}
console.log('maxLevel hypothesis ok', ok, 'bad', bad.length); console.log(bad.slice(0, 40).join('\n'));
// 2. attribute bonus: live level-30 str minus (base + 29 * gain)
const rows = [];
for (const rec of Object.values(live)) {
  if (rec.variant !== 'B') continue;
  const h = data.heroes[rec.hero];
  rows.push([rec.hero.replace('npc_dota_hero_', ''), +(rec.stats.str - (h.str + 29 * h.strGain)).toFixed(2), +(rec.stats.agi - (h.agi + 29 * h.agiGain)).toFixed(2), +(rec.stats.int - (h.int + 29 * h.intGain)).toFixed(2)]);
}
const odd = rows.filter((r) => Math.abs(r[1] - 14) > 0.06 || Math.abs(r[2] - 14) > 0.06 || Math.abs(r[3] - 14) > 0.06);
console.log('heroes whose level-30 attributes are not base + growth + 14:', odd.length, JSON.stringify(odd.slice(0, 30)));
// 3. charges: live cooldown where the simulator sees charges
for (const rec of Object.values(live)) {
  for (const [an, a] of Object.entries(rec.abilities)) {
    const d = data.abilities[an]; if (!d || !d.vals.AbilityCharges) continue;
    const L = a.lv[a.lv.length - 1];
    const ch = L.v.AbilityCharges;
    if (ch > 0) console.log(`charges ${an} [${rec.variant}] live charges=${ch} cd=${L.cd} ecd=${L.ecd} restore=${L.v.AbilityChargeRestoreTime} kvcd=${JSON.stringify(d.vals.AbilityCooldown)}`.slice(0, 200));
  }
}
