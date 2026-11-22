// Generates one scene spec per hero ability (tools/live/specs/auto/<ability>[.variant].json).
//   node tools/live/gen_specs.mjs [--hero lina]
// Castable abilities: a level 30 hero with only that ability learned (max level) casts it once on / at / near a Target Dummy.
// Passive abilities: the hero attacks the dummy for a few seconds.
// Variants: base; .tal (all talents) when a talent changes one of the ability's values; .sc / .sh when Scepter / Shard does.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadData } from '../../src/engine/gamedata.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const out = path.join(here, 'specs', 'auto');
const args = process.argv.slice(2);
const only = args.includes('--hero') ? args[args.indexOf('--hero') + 1] : null;
const data = loadData();
fs.mkdirSync(out, { recursive: true });
if (!only) for (const f of fs.readdirSync(out)) fs.unlinkSync(path.join(out, f));

const arr = (e) => (e === undefined ? [] : Array.isArray(e) ? e : e.v);
const top = (e) => { const a = arr(e); return a.length ? a[a.length - 1] : 0; };
const DUMMY = 'npc_dota_hero_target_dummy';
let n = 0; const skipped = [];

for (const h of Object.values(data.heroes)) {
  if (!h.enabled) continue;
  const short = h.name.replace('npc_dota_hero_', '');
  if (only && short !== only) continue;
  for (const an of h.abilities) {
    const d = data.abilities[an];
    if (!d) continue;
    const b = d.behavior;
    const max = d.liveMax ?? d.maxLevel ?? (d.type === 'ultimate' ? 3 : 4);
    if (max < 1) { skipped.push(`${an}: no levels`); continue; }
    const passive = b.includes('PASSIVE');
    const hidden = b.includes('HIDDEN');
    // helper buttons (release / cancel / end ...) only make sense in the middle of their parent ability
    if (hidden && !passive && !d.bySc && !d.bySh) { skipped.push(`${an}: hidden helper`); continue; }
    const mk = (variant) => {
      const range = top(d.vals.AbilityCastRange);
      const dist = range > 0 ? Math.max(150, Math.min(500, range - 50)) : 200;
      const durs = Object.entries(d.vals).filter(([k]) => /duration|channel|AbilityChannelTime/i.test(k)).map(([, e]) => top(e)).filter((x) => x > 0 && x < 100);
      const longest = durs.length ? Math.max(...durs) : 0;
      const duration = Math.round(Math.max(8, Math.min(22, longest + 3)) * 10) / 10;
      const caster = { tag: 'c', name: h.name, team: 0, x: 0, y: 0, level: 30, abilities: { [an]: max }, face: [dist, 0] };
      if (variant === 'tal') caster.talents = 'all';
      if (variant === 'sc' || d.bySc) caster.scepter = true;
      if (variant === 'sh' || d.bySh) caster.shard = true;
      const units = [caster, { tag: 't', name: DUMMY, team: 1, x: dist, y: 0, face: [0, 0] }];
      const team = d.team || '';
      const allyOnly = team.includes('FRIENDLY') && !team.includes('ENEMY') && !team.includes('BOTH');
      let action;
      if (passive) action = { t: 0.5, unit: 'c', type: 'attack', target: 't' };
      else if (b.includes('TOGGLE')) action = { t: 0.5, unit: 'c', type: 'cast', ability: an, toggle: true };
      else if (b.includes('UNIT_TARGET') && !b.includes('POINT')) {
        if (allyOnly) { units.push({ tag: 'a', name: DUMMY, team: 0, x: Math.min(dist, 300), y: 200, face: [0, 0] }); action = { t: 0.5, unit: 'c', type: 'cast', ability: an, target: 'a' }; }
        else action = { t: 0.5, unit: 'c', type: 'cast', ability: an, target: 't' };
      } else if (b.includes('POINT')) action = { t: 0.5, unit: 'c', type: 'cast', ability: an, pos: [dist, 0] };
      else if (b.includes('NO_TARGET')) action = { t: 0.5, unit: 'c', type: 'cast', ability: an };
      else return null;
      if (passive) { units[1].x = Math.min(dist, 150); caster.face = [units[1].x, 0]; }
      // a melee caster also hits the dummy after the cast, to show on-hit parts of the ability
      const actions = [action];
      const id = an + (variant ? '.' + variant : '');
      return { id, hero: short, ability: an, kind: passive ? 'attack' : 'cast', variant: variant || 'base', units, actions, duration: passive ? 8 : duration };
    };
    const variants = [null];
    const vals = Object.values(d.vals);
    if (vals.some((e) => e && e.t) && !d.bySc && !d.bySh) variants.push('tal');
    if ((d.hasSc || vals.some((e) => e && e.sc)) && !d.bySc) variants.push('sc');
    if ((d.hasSh || vals.some((e) => e && e.sh)) && !d.bySh) variants.push('sh');
    for (const v of variants) {
      const spec = mk(v);
      if (!spec) { if (!v) skipped.push(`${an}: no cast mode (${b.join('|')})`); continue; }
      fs.writeFileSync(path.join(out, spec.id + '.json'), JSON.stringify(spec));
      n++;
    }
  }
}
console.log(`specs written: ${n}; skipped abilities: ${skipped.length}`);
if (args.includes('--verbose')) console.log(skipped.join('\n'));
