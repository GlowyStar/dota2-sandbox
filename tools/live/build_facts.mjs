// Builds data/live_facts.json from the live game dumps in tools/live/out (static_live.json, values_live.json).
// These are facts the game data files do not contain and that were read from the running game in Hero Demo:
// ability max levels, which abilities follow the level of another one, the levels abilities have on an untouched hero,
// the attribute bonus schedule and the pause between uses of charge abilities.
//   node tools/live/build_facts.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..', '..');
const stat = JSON.parse(fs.readFileSync(path.join(here, 'out', 'static_live.json'), 'utf8'));
const vals = JSON.parse(fs.readFileSync(path.join(here, 'out', 'values_live.json'), 'utf8'));
const data = JSON.parse(fs.readFileSync(path.join(root, 'data', 'gamedata.json'), 'utf8'));
const skip = (n) => /^plus_|^ability_|portal_warp$/.test(n);

// ---- attribute bonus schedule (majority over heroes) and heroes without it
const count = {};
const extra = (rec, s) => { const h = data.heroes[rec.hero]; return Math.round((s.agi - h.agi - h.agiGain * (s.level - 1)) / 2); };
for (const rec of Object.values(stat)) for (const s of rec.stats) { const n = extra(rec, s); (count[s.level] ||= {})[n] = ((count[s.level] || {})[n] || 0) + 1; }
const attributeBonusLevels = []; let prev = 0;
for (let L = 1; L <= 30; L++) { const best = Number(Object.entries(count[L]).sort((a, b) => b[1] - a[1])[0][0]); if (best > prev) for (let k = prev; k < best; k++) attributeBonusLevels.push(L); prev = best; }
const noAttributeBonus = Object.values(stat).filter((rec) => extra(rec, rec.stats[rec.stats.length - 1]) === 0).map((rec) => rec.hero);

// ---- max levels, levels on an untouched hero, level links
const maxLevel = {}; const fresh = {}; const follow = {};
for (const rec of Object.values(stat)) {
  for (const [an, m] of Object.entries(rec.meta)) if (!skip(an)) maxLevel[an] = m.max;
  for (const [an, lv] of Object.entries(rec.fresh30)) if (!skip(an) && lv > 0) fresh[an] = lv;
  for (const [lead, per] of Object.entries(rec.links)) {
    if (skip(lead)) continue;
    const max = rec.meta[lead].max;
    for (let L = 1; L <= max; L++) for (const [other, lv] of Object.entries(per[String(L)] || {})) {
      if (skip(other)) continue;
      const arr = ((follow[lead] ||= {})[other] ||= new Array(max).fill(null));
      arr[L - 1] = lv;
    }
  }
}
// a follower keeps its last level when the leader's next level did not move it
for (const fs2 of Object.values(follow)) for (const arr of Object.values(fs2)) { let last = null; for (let i = 0; i < arr.length; i++) { if (arr[i] === null) arr[i] = last; else last = arr[i]; } }

// ---- pause between uses of an ability that has charges: the cooldown the game reports while charges are present
const chargeLockout = {};
for (const rec of Object.values(vals)) for (const [an, a] of Object.entries(rec.abilities)) {
  const top = a.lv[a.lv.length - 1];
  if (top && top.v && top.v.AbilityCharges > 0) { const v = Math.round(top.cd * 1000) / 1000; if (chargeLockout[an] === undefined || v > chargeLockout[an]) chargeLockout[an] = v; }
}

const facts = {
  about: 'Read from the running game (Hero Demo) with tools/live; regenerate after a patch with tools/live/collect_*.py and build_facts.mjs',
  build: data.meta.ClientVersion, collected: new Date().toISOString().slice(0, 10),
  attributeBonusLevels, noAttributeBonus, maxLevel, fresh, follow, chargeLockout,
};
fs.writeFileSync(path.join(root, 'data', 'live_facts.json'), JSON.stringify(facts));
console.log(JSON.stringify({ build: facts.build, attributeBonusLevels, noAttributeBonus, maxLevels: Object.keys(maxLevel).length, fresh: Object.keys(fresh).length,
  leaders: Object.keys(follow).length, chargeLockout }, null, 0));
