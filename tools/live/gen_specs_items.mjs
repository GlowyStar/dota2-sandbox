// Generates scene specs for items and for creep / summon abilities.
//   node tools/live/gen_specs_items.mjs          -> tools/live/specs/items/*.json and tools/live/specs/units/*.json
// Items: a level 20 Sven carries the item; an attack scene (10 s on the Target Dummy) for every item and, for items with an
// active, a cast scene. Unit abilities: the first unit that carries the ability attacks or casts on the dummy.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadData } from '../../src/engine/gamedata.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const data = loadData();
const DUMMY = 'npc_dota_hero_target_dummy';
const arr = (e) => (e === undefined ? [] : Array.isArray(e) ? e : e.v);
const top = (e) => { const a = arr(e); return a.length ? a[a.length - 1] : 0; };
const clean = (dir) => { fs.mkdirSync(dir, { recursive: true }); for (const f of fs.readdirSync(dir)) fs.unlinkSync(path.join(dir, f)); };

// ---- items of the current shop and neutral pool
const pool = new Set();
for (const t of Object.values(data.neutral.tiers)) { for (const a of t.artifacts) pool.add(a); for (const e of Object.keys(t.enchants)) pool.add(e); }
const itemsDir = path.join(here, 'specs', 'items'); clean(itemsDir);
let nItems = 0;
for (const d of Object.values(data.abilities)) {
  if (!d.item || d.recipe || d.obsolete) continue;
  const neutral = !!(d.artifact || d.enchant);
  if (neutral ? !pool.has(d.name) : (d.noBuy || d.cost <= 0)) continue;
  const b = d.behavior;
  const passive = b.includes('PASSIVE') || !(b.includes('UNIT_TARGET') || b.includes('POINT') || b.includes('NO_TARGET') || b.includes('TOGGLE'));
  const base = () => ({ tag: 'c', name: 'npc_dota_hero_sven', team: 0, x: 0, y: 0, level: 20, abilities: {}, items: [d.name], face: [150, 0] });
  const write = (spec) => { fs.writeFileSync(path.join(itemsDir, spec.id + '.json'), JSON.stringify(spec)); nItems++; };
  // attack scene: on-hit effects and stat bonuses
  write({ id: d.name + '.attack', item: d.name, kind: 'attack', units: [base(), { tag: 't', name: DUMMY, team: 1, x: 150, y: 0, face: [0, 0] }],
    actions: [{ t: 0.5, unit: 'c', type: 'attack', target: 't' }], duration: 10 });
  if (!passive) {
    const range = top(d.vals.AbilityCastRange);
    const dist = range > 0 ? Math.max(150, Math.min(500, range - 50)) : 200;
    const team = d.team || '';
    const allyOnly = team.includes('FRIENDLY') && !team.includes('ENEMY') && !team.includes('BOTH');
    const durs = Object.entries(d.vals).filter(([k]) => /duration/i.test(k)).map(([, e]) => top(e)).filter((x) => x > 0 && x < 100);
    const duration = Math.round(Math.max(8, Math.min(22, (durs.length ? Math.max(...durs) : 0) + 3)) * 10) / 10;
    const c = base(); c.face = [dist, 0];
    const units = [c, { tag: 't', name: DUMMY, team: 1, x: dist, y: 0, face: [0, 0] }];
    let action;
    if (b.includes('TOGGLE')) action = { t: 0.5, unit: 'c', type: 'cast', ability: d.name, toggle: true };
    else if (b.includes('UNIT_TARGET') && !b.includes('POINT')) {
      if (allyOnly) { units.push({ tag: 'a', name: DUMMY, team: 0, x: Math.min(dist, 300), y: 200, face: [0, 0] }); action = { t: 0.5, unit: 'c', type: 'cast', ability: d.name, target: 'a' }; }
      else action = { t: 0.5, unit: 'c', type: 'cast', ability: d.name, target: 't' };
    } else if (b.includes('POINT')) action = { t: 0.5, unit: 'c', type: 'cast', ability: d.name, pos: [dist, 0] };
    else action = { t: 0.5, unit: 'c', type: 'cast', ability: d.name };
    write({ id: d.name + '.cast', item: d.name, kind: 'cast', units, actions: [action], duration });
  }
}

// ---- creep / summon abilities
const unitsDir = path.join(here, 'specs', 'units'); clean(unitsDir);
const seen = new Set(); let nUnits = 0;
for (const u of Object.values(data.units)) {
  if (u.atk === 'none' && !(u.abilities || []).length) continue;
  if (/tower|fort|barracks|building|fountain|filler/.test(u.baseClass || '')) continue;
  for (const an of u.abilities || []) {
    if (seen.has(an)) continue;
    const d = data.abilities[an];
    if (!d || d.hero) continue;
    seen.add(an);
    const b = d.behavior;
    const passive = b.includes('PASSIVE') || !(b.includes('UNIT_TARGET') || b.includes('POINT') || b.includes('NO_TARGET') || b.includes('TOGGLE'));
    const dist = Math.max(100, Math.min(350, (u.range || 150) - 20));
    const units = [{ tag: 'c', name: u.name, team: 0, x: 0, y: 0, face: [dist, 0] }, { tag: 't', name: DUMMY, team: 1, x: dist, y: 0, face: [0, 0] }];
    let action = { t: 0.5, unit: 'c', type: 'attack', target: 't' };
    if (!passive) {
      const team = d.team || '';
      const allyOnly = team.includes('FRIENDLY') && !team.includes('ENEMY') && !team.includes('BOTH');
      if (b.includes('UNIT_TARGET') && !b.includes('POINT')) {
        if (allyOnly) { units.push({ tag: 'a', name: DUMMY, team: 0, x: 150, y: 200, face: [0, 0] }); action = { t: 0.5, unit: 'c', type: 'cast', ability: an, target: 'a' }; }
        else action = { t: 0.5, unit: 'c', type: 'cast', ability: an, target: 't' };
      } else if (b.includes('POINT')) action = { t: 0.5, unit: 'c', type: 'cast', ability: an, pos: [dist, 0] };
      else if (b.includes('TOGGLE')) action = { t: 0.5, unit: 'c', type: 'cast', ability: an, toggle: true };
      else action = { t: 0.5, unit: 'c', type: 'cast', ability: an };
    }
    const actions = passive ? [action] : [action, { t: 4.0, unit: 'c', type: 'attack', target: 't' }];
    fs.writeFileSync(path.join(unitsDir, an + '.json'), JSON.stringify({ id: 'unit.' + an, unitAbility: an, carrier: u.name, kind: passive ? 'attack' : 'cast', units, actions, duration: 10 }));
    nUnits++;
  }
}
console.log(`item scenes: ${nItems}; unit ability scenes: ${nUnits}`);
