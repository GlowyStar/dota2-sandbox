// What the engine models and how closely (generated from the script registry + data pack; nothing hand-maintained).
// Every script carries a fidelity label:
//   full    - every clause of the tooltip is modelled; the note (if any) only states an interpretation or a usage assumption
//   approx  - every clause is present, with simplified geometry / timing or a stated assumption
//   partial - at least one clause of the tooltip is missing (the note says which)
//   n/a     - has no meaning in an arena fight (economy, map movement, vision, helper buttons)
import { abilityScripts } from './engine/registry.mjs';
import { needsScript, namedInScripts } from './scenario.mjs';
import './scripts/index.mjs';


const LABELS = ['full', 'approx', 'partial', 'n/a'];
const newTally = () => ({ full: 0, approx: 0, partial: 0, 'n/a': 0, unlabelled: 0, missing: 0 });
function entry(data, name) {
  const sc = abilityScripts.get(name);
  const e = { name, dname: (data.abilities[name] || {}).dname, modelled: !!sc };
  if (sc) { e.fid = LABELS.includes(sc.fid) ? sc.fid : 'unlabelled'; if (sc.note) e.note = sc.note; if (sc.manual) e.manual = true; }
  return e;
}
const count = (tally, e) => { tally[e.modelled ? e.fid : 'missing']++; };

export function coverage(data) {
  const talentRefs = new Set();
  for (const a of Object.values(data.abilities)) for (const e of Object.values(a.vals)) if (e && e.t) for (const k of Object.keys(e.t)) talentRefs.add(k);

  // ---- heroes
  const heroes = []; const heroTally = newTally(); let talentsTotal = 0; let talentsMissing = 0;
  for (const h of Object.values(data.heroes)) {
    if (!h.enabled) continue;
    const abs = h.abilities.map((n) => entry(data, n));
    for (const a of abs) count(heroTally, a);
    // a talent is modelled when it is a standard stat talent, when an ability value references it, or when a script registers or checks it
    const talents = h.talents.filter(Boolean).map((t) => ({ name: t, modelled: !t.startsWith('special_bonus_unique') || talentRefs.has(t) || abilityScripts.has(t) || namedInScripts(t) }));
    talentsTotal += talents.length; talentsMissing += talents.filter((t) => !t.modelled).length;
    heroes.push({ hero: h.name, dname: h.dname, abilities: abs, modelled: abs.filter((a) => a.modelled).length, total: abs.length, talentsNotModelled: talents.filter((t) => !t.modelled).map((t) => t.name) });
  }

  // ---- items (current shop items and the current neutral pool)
  const pool = new Set();
  for (const t of Object.values(data.neutral.tiers)) { for (const a of t.artifacts) pool.add(a); for (const e of Object.keys(t.enchants)) pool.add(e); }
  const items = { statsOnly: [], scripted: [], notModelled: [], neutralScripted: [], neutralStatsOnly: [], neutralNotModelled: [] };
  const shopTally = { ...newTally(), statsOnly: 0 }; const neutralTally = { ...newTally(), statsOnly: 0 };
  const itemEntries = [];
  for (const a of Object.values(data.abilities)) {
    if (!a.item || a.recipe || a.obsolete) continue;
    const neutral = !!(a.artifact || a.enchant);
    if (neutral ? !pool.has(a.name) : (a.noBuy || a.cost <= 0)) continue;
    const e = entry(data, a.name); e.neutral = neutral;
    const tally = neutral ? neutralTally : shopTally;
    let bucket;
    if (e.modelled) { tally[e.fid]++; bucket = 'scripted'; }
    else if (needsScript(a)) { tally.missing++; bucket = 'notModelled'; }
    else { tally.statsOnly++; bucket = 'statsOnly'; e.fid = 'full'; e.statsOnly = true; }
    items[neutral ? 'neutral' + bucket[0].toUpperCase() + bucket.slice(1) : bucket].push(a.name);
    itemEntries.push(e);
  }

  // ---- creep / summon abilities (abilities carried by non-hero units)
  const unitAb = new Set();
  for (const u of Object.values(data.units)) for (const a of u.abilities || []) unitAb.add(a);
  const unitTally = newTally(); const unitEntries = [];
  for (const n of unitAb) { const e = entry(data, n); count(unitTally, e); unitEntries.push(e); }

  const fully = heroes.filter((h) => h.modelled === h.total).length;
  const sum = (t) => Object.values(t).reduce((x, y) => x + y, 0);
  return {
    summary: {
      heroes: heroes.length, heroesFullyModelled: fully,
      heroAbilities: sum(heroTally), heroAbilitiesModelled: sum(heroTally) - heroTally.missing, heroAbilityFidelity: heroTally,
      heroTalents: talentsTotal, heroTalentsNotModelled: talentsMissing,
      shopItems: sum(shopTally), shopItemsNotModelled: shopTally.missing, shopItemFidelity: shopTally,
      neutralItems: sum(neutralTally), neutralItemsNotModelled: neutralTally.missing, neutralItemFidelity: neutralTally,
      unitAbilities: unitAb.size, unitAbilitiesModelled: unitAb.size - unitTally.missing, unitAbilityFidelity: unitTally,
      scriptsRegistered: abilityScripts.size,
      labels: 'full = every tooltip clause modelled; approx = all clauses with simplified geometry / timing or a stated assumption; partial = a clause is missing; n/a = no meaning in an arena fight; statsOnly = the item is plain stat bonuses (exact)',
      note: 'Base stats, levels, attributes, attack cycle, armor/magic resistance and all "+stat" item bonuses apply to every hero, unit and item regardless of this table.',
    },
    heroes, items, itemEntries, unitEntries,
  };
}

const esc = (s) => String(s).replace(/\|/g, '/').replace(/\r?\n/g, ' ');
const tallyLine = (t) => `full ${t.full}, approx ${t.approx}, partial ${t.partial}, n/a ${t['n/a']}` + (t.statsOnly ? `, plain stat bonuses ${t.statsOnly}` : '') + (t.unlabelled ? `, unlabelled ${t.unlabelled}` : '') + `, not modelled ${t.missing}`;

export function coverageMarkdown(data) {
  const c = coverage(data); const s = c.summary;
  const name = (e) => esc(e.dname || e.name);
  const mark = (e) => name(e) + (!e.modelled ? ' (NOT MODELLED)' : e.fid === 'full' ? '' : ` (${e.fid})`);
  const lines = ['# Coverage', '',
    `Generated from game build ${data.meta.ClientVersion || '?'} (${data.meta.VersionDate || ''}) by \`simlab coverage --write\`. Do not edit by hand.`, '',
    'Labels:', '',
    '- **full**: every clause of the tooltip is modelled; a note only states an interpretation or a usage assumption',
    '- **approx**: every clause is present, with simplified geometry or timing, or with a stated assumption',
    '- **partial**: at least one clause of the tooltip is missing (the note says which)',
    '- **n/a**: no meaning in an arena fight (economy, map movement, vision, helper buttons)', '',
    '## Summary', '',
    '| Content | Total | Breakdown |', '|---|---|---|',
    `| Heroes | ${s.heroes} | ${s.heroesFullyModelled} have a script for every ability; base stats, growth and attacks are exact for all |`,
    `| Hero abilities | ${s.heroAbilities} | ${tallyLine(s.heroAbilityFidelity)} |`,
    `| Hero talents | ${s.heroTalents} | ${s.heroTalents - s.heroTalentsNotModelled} applied, ${s.heroTalentsNotModelled} without effect |`,
    `| Shop items | ${s.shopItems} | ${tallyLine(s.shopItemFidelity)} |`,
    `| Neutral items and enchantments (current pool) | ${s.neutralItems} | ${tallyLine(s.neutralItemFidelity)} |`,
    `| Creep and summon abilities | ${s.unitAbilities} | ${tallyLine(s.unitAbilityFidelity)} |`, '',
    'Not part of the simulator at all: map, terrain, trees, fog of war and vision, gold and experience, respawn, buildings behaviour, couriers, runes on a timer.', '',
    '## Heroes', '', '| Hero | Abilities (label shown unless full) | Talents without effect |', '|---|---|---|'];
  const heroes = c.heroes.slice().sort((a, b) => (a.dname || a.hero).localeCompare(b.dname || b.hero));
  for (const h of heroes) lines.push(`| ${esc(h.dname || h.hero)} | ${h.abilities.map(mark).join(', ') || '-'} | ${h.talentsNotModelled.length ? h.talentsNotModelled.join(', ') : '-'} |`);

  const section = (title, list) => {
    lines.push('', `## ${title}`, '');
    if (!list.length) { lines.push('None.'); return; }
    lines.push('| Ability | Owner | What is missing or assumed |', '|---|---|---|');
    for (const [owner, e] of list) lines.push(`| ${name(e)} (\`${e.name}\`) | ${esc(owner)} | ${esc(e.note || '')} |`);
  };
  const all = [];
  for (const h of heroes) for (const a of h.abilities) all.push([h.dname || h.hero, a]);
  for (const e of c.itemEntries) all.push([e.neutral ? 'neutral item' : 'shop item', e]);
  for (const e of c.unitEntries) all.push(['creep / summon', e]);
  section('Partial: a tooltip clause is missing', all.filter(([, e]) => e.fid === 'partial'));
  section('Not applicable in an arena fight', all.filter(([, e]) => e.fid === 'n/a'));
  section('Not modelled', all.filter(([, e]) => !e.modelled && !e.statsOnly));

  lines.push('', '## Notes on approximated abilities', '',
    'Every approximation is stated per ability. Ask for one hero with `simlab coverage <hero>` or the MCP tool `sim_coverage` (`hero` argument) to read the notes of its abilities.', '');
  const nm = (n) => (data.abilities[n].dname || n);
  lines.push('## Items that are plain stat bonuses (exact, no script needed)', '', [...c.items.statsOnly, ...c.items.neutralStatsOnly].map(nm).join(', ') || '-', '');
  return lines.join('\n');
}
