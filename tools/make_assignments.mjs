// Splits the not-yet-modelled content into assignment files under docs/assignments (authoring aid).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

process.env.SIMLAB_SCRIPTS = 'none';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { loadData } = await import('../src/engine/gamedata.mjs');
const { abilityScripts } = await import('../src/engine/registry.mjs');
const { needsScript } = await import('../src/scenario.mjs');
const d = loadData();
const out = path.join(root, 'docs/assignments');
fs.mkdirSync(out, { recursive: true });

const C3 = 'invoker meepo morphling rubick arc_warden lone_druid brewmaster wisp chen techies tinker visage phoenix earth_spirit shadow_demon kez monkey_king ringmaster largo dark_seer enchantress furion puck oracle'.split(' ');
const C1 = 'abaddon abyssal_underlord ancient_apparition bane bloodseeker centaur dazzle earthshaker jakiro leshrac lich night_stalker omniknight pugna queenofpain sand_king shadow_shaman skywrath_mage spirit_breaker tidehunter treant vengefulspirit venomancer witch_doctor'.split(' ');
const heroes = Object.values(d.heroes).filter((h) => h.enabled).map((h) => h.name.replace('npc_dota_hero_', ''));
const todo = heroes.filter((h) => !d.heroes['npc_dota_hero_' + h].abilities.some((a) => abilityScripts.has(a)));
const C2 = todo.filter((h) => !C3.includes(h) && !C1.includes(h));
console.log('todo', todo.length, 'C3', C3.filter((h) => todo.includes(h)).length, 'C2', C2.length, 'C1', C1.filter((h) => todo.includes(h)).length);
const GROUPS = 8;
const groups = Array.from({ length: GROUPS }, () => []);
let i = 0;
for (const list of [C3.filter((h) => todo.includes(h)), C2, C1.filter((h) => todo.includes(h))]) for (const h of list) groups[i++ % GROUPS].push(h);

// unit abilities grouped by the hero whose name they start with
const unitAb = new Map();
for (const u of Object.values(d.units)) for (const a of u.abilities || []) { if (!unitAb.has(a)) unitAb.set(a, []); unitAb.get(a).push(u.name); }
const heroAbSet = new Set();
for (const h of Object.values(d.heroes)) for (const a of h.abilities) heroAbSet.add(a);
const alias = { skeleton_king: ['skeleton_king', 'wraith_king'], doom_bringer: ['doom_bringer', 'doom'], abyssal_underlord: ['abyssal_underlord', 'underlord'], centaur: ['centaur_warrunner'], necrolyte: ['necrolyte'] };
const owner = (a) => {
  let best = null;
  for (const h of heroes) for (const p of (alias[h] || [h])) if (a.startsWith(p + '_') && (!best || p.length > best[1].length)) best = [h, p];
  return best ? best[0] : null;
};
const byHero = {}; const generic = [];
for (const a of unitAb.keys()) { if (abilityScripts.has(a) || heroAbSet.has(a)) continue; const o = owner(a); if (o) (byHero[o] ||= []).push(a); else generic.push(a); }
const done = heroes.filter((h) => !todo.includes(h));
const unitsOf = (a) => [...new Set(unitAb.get(a))].slice(0, 3).map((x) => x.replace('npc_dota_', '')).join(',');

groups.forEach((g, gi) => {
  const n = gi + 5;
  const lines = ['# Assignment heroes_' + n, '', 'File to create (the only file you may edit): `src/scripts/heroes_' + n + '.mjs`',
    'Check with: `SIMLAB_SCRIPTS=heroes_' + n + ' node tools/hero_check.mjs -v ' + g.join(' ') + '`', '', '## Heroes', ''];
  for (const h of g) {
    const def = d.heroes['npc_dota_hero_' + h];
    lines.push('- **' + h + '** (' + def.dname + '): ' + def.abilities.join(', '));
    if (byHero[h]) lines.push('  - abilities carried by units this hero summons (yours to script as well): ' + byHero[h].map((a) => a + ' [' + unitsOf(a) + ']').join(', '));
  }
  fs.writeFileSync(path.join(out, 'heroes_' + n + '.md'), lines.join('\n') + '\n');
  console.log('heroes_' + n + ': ' + g.join(' '));
});

{
  const lines = ['# Assignment gaps (first 31 heroes)', '', 'Files you own (the only files you may edit): `src/scripts/heroes_1.mjs`, `heroes_2.mjs`, `heroes_3.mjs`, `heroes_4.mjs`', '', '## Abilities without a script', ''];
  for (const h of done) {
    const def = d.heroes['npc_dota_hero_' + h];
    const miss = def.abilities.filter((a) => !abilityScripts.has(a)); const su = byHero[h] || [];
    if (miss.length || su.length) lines.push('- **' + h + '**: ' + (miss.join(', ') || '-') + (su.length ? ' | summoned-unit abilities: ' + su.map((a) => a + ' [' + unitsOf(a) + ']').join(', ') : ''));
  }
  lines.push('', '## Abilities currently marked partial or n/a (improve where the tooltip allows)', '');
  for (const h of done) {
    const def = d.heroes['npc_dota_hero_' + h];
    const p = def.abilities.filter((a) => { const s = abilityScripts.get(a); return s && (s.fid === 'partial' || s.fid === 'n/a'); });
    if (p.length) lines.push('- ' + h + ': ' + p.map((a) => a + ' (' + abilityScripts.get(a).fid + ': ' + (abilityScripts.get(a).note || '') + ')').join('; '));
  }
  fs.writeFileSync(path.join(out, 'gaps.md'), lines.join('\n') + '\n');
}

fs.writeFileSync(path.join(out, 'units_2.md'), ['# Assignment units_2', '', 'File to create (the only file you may edit): `src/scripts/units_2.mjs`', '',
  '## Unit abilities to script (' + generic.length + ')', '', ...generic.sort().map((a) => '- ' + a + ' [' + unitsOf(a) + ']')].join('\n') + '\n');

const cur = new Map();
for (const [tier, t] of Object.entries(d.neutral.tiers)) {
  for (const a of t.artifacts) cur.set(a, 'artifact tier ' + tier);
  for (const [e, v] of Object.entries(t.enchants)) if (!cur.has(e)) cur.set(e, 'enchantment (tier ' + tier + '+, level ' + v.level + ')');
}
const shop = []; const arts = []; const ench = [];
for (const a of Object.values(d.abilities)) {
  if (!a.item || a.recipe || a.obsolete || abilityScripts.has(a.name) || !needsScript(a)) continue;
  const n = cur.get(a.name);
  if (n) (a.enchant ? ench : arts).push('- ' + a.name + ' (' + a.dname + ') - ' + n);
  else if (!a.noBuy && a.cost > 0 && !a.artifact && !a.enchant) shop.push('- ' + a.name + ' (' + a.dname + '), cost ' + a.cost);
}
fs.writeFileSync(path.join(out, 'neutral_1.md'), ['# Assignment neutral_1', '', 'File to create (the only file you may edit): `src/scripts/neutral_1.mjs`', '',
  '## Neutral artifacts of the current pool (' + arts.length + ')', '', ...arts].join('\n') + '\n');
fs.writeFileSync(path.join(out, 'items_2.md'), ['# Assignment items_2', '', 'File to create (the only file you may edit): `src/scripts/items_2.mjs`', '',
  '## Shop items without an effect script (' + shop.length + ')', '', ...shop, '', '## Neutral enchantments (' + ench.length + ')', '', ...ench].join('\n') + '\n');
console.log('first heroes with gaps', done.length, '| generic unit abilities', generic.length, '| hero-owned unit abilities', Object.values(byHero).flat().length, '| shop', shop.length, 'artifacts', arts.length, 'enchants', ench.length);
