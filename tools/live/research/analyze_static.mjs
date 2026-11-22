// Tests the simulator's stat formulas and level rules against the live dump (tools/live/out/static_live.json).
//   node tools/live/analyze_static.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadData } from '../../../src/engine/gamedata.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const live = JSON.parse(fs.readFileSync(path.join(here, '..', 'out', 'static_live.json'), 'utf8'));
const data = loadData();
const ATTR_LEVELS = [17, 19, 21, 22, 23, 24, 26];

// ---- 1. attributes by level
let attrOk = 0; const attrBad = [];
for (const rec of Object.values(live)) {
  const h = data.heroes[rec.hero];
  for (const s of rec.stats) {
    const n = ATTR_LEVELS.filter((x) => s.level >= x).length;
    for (const [k, base, gain] of [['str', h.str, h.strGain], ['agi', h.agi, h.agiGain], ['int', h.int, h.intGain]]) {
      const exp = base + gain * (s.level - 1) + 2 * n;
      if (Math.abs(exp - s[k]) < 0.051) attrOk++; else attrBad.push(`${rec.hero.replace('npc_dota_hero_', '')} L${s.level} ${k}: live ${s[k]} expected ${exp.toFixed(2)}`);
    }
  }
}
console.log(`attributes = base + gain*(L-1) + 2 per attribute level: ok ${attrOk}, differ ${attrBad.length}`);
console.log('  ' + attrBad.slice(0, 12).join('\n  '));

// ---- 2. derived stats: which rounding of the attribute does the game use?
const tests = {
  hp: { floor: 0, round: 0, raw: 0, n: 0, bad: [] }, mana: { floor: 0, round: 0, raw: 0, n: 0, bad: [] },
  hpRegen: { floor: 0, round: 0, raw: 0, n: 0, bad: [] }, manaRegen: { floor: 0, round: 0, raw: 0, n: 0, bad: [] },
  armor: { floor: 0, round: 0, raw: 0, n: 0, bad: [] }, as: { floor: 0, round: 0, raw: 0, n: 0, bad: [] },
  mrBase: { floor: 0, round: 0, raw: 0, n: 0, bad: [] }, dmgMin: { floor: 0, round: 0, raw: 0, n: 0, bad: [] },
};
const eq = (a, b, tol) => Math.abs(a - b) <= tol;
for (const rec of Object.values(live)) {
  const h = data.heroes[rec.hero];
  for (const s of rec.stats) {
    const forms = (attr, f) => ({ floor: f(Math.floor(attr + 1e-6)), round: f(Math.round(attr)), raw: f(attr) });
    const prim = h.attr === 'str' ? s.str : h.attr === 'agi' ? s.agi : h.attr === 'int' ? s.int : null;
    const cases = {
      hp: [s.hp, forms(s.str, (x) => h.hp + 20 * x), 0.6],
      mana: [s.mana, forms(s.int, (x) => h.mana + 12 * x), 0.6],
      hpRegen: [s.hpRegen, forms(s.str, (x) => h.hpRegen + 0.1 * x), 0.006],
      manaRegen: [s.manaRegen, forms(s.int, (x) => h.manaRegen + 0.05 * x), 0.006],
      armor: [s.armor, forms(s.agi, (x) => h.armor + x / 6), 0.006],
      as: [s.as, forms(s.agi, (x) => h.baseAs + x), 0.6],
      mrBase: [s.mrBase, forms(s.int, (x) => h.mr + 0.125 * x), 0.006],
    };
    if (prim !== null) cases.dmgMin = [s.dmgMin, forms(prim, (x) => h.dmgMin + x), 0.6];
    else cases.dmgMin = [s.dmgMin, { floor: h.dmgMin + Math.floor(0.45 * (s.str + s.agi + s.int) + 1e-6), round: h.dmgMin + Math.round(0.45 * (s.str + s.agi + s.int)), raw: h.dmgMin + 0.45 * (s.str + s.agi + s.int) }, 0.6];
    for (const [k, [lv, f, tol]] of Object.entries(cases)) {
      if (lv === undefined || lv === null) continue;
      const t = tests[k]; t.n++;
      let any = false;
      for (const m of ['floor', 'round', 'raw']) if (eq(lv, f[m], tol)) { t[m]++; any = true; }
      if (!any && t.bad.length < 400) t.bad.push(`${rec.hero.replace('npc_dota_hero_', '')} L${s.level}: live ${lv} floor ${(+f.floor).toFixed(3)} raw ${(+f.raw).toFixed(3)}`);
    }
  }
}
for (const [k, t] of Object.entries(tests)) {
  const heroes = new Set(t.bad.map((b) => b.split(' ')[0]));
  console.log(`${k}: n ${t.n} | floor(attr) ${t.floor} | round(attr) ${t.round} | raw attr ${t.raw} | none ${t.bad.length} (${heroes.size} heroes: ${[...heroes].slice(0, 14).join(', ')})`);
}
console.log('examples hp none:', tests.hp.bad.slice(0, 6).join(' ; '));
console.log('examples dmg none:', tests.dmgMin.bad.slice(0, 8).join(' ; '));
console.log('examples armor none:', tests.armor.bad.slice(0, 6).join(' ; '));

// ---- 3. attack interval
let spaOk = 0; const spaBad = [];
for (const rec of Object.values(live)) for (const s of rec.stats) { const exp = s.bat / (s.as / 100); if (Math.abs(exp - s.spa) < 0.002) spaOk++; else spaBad.push(`${rec.hero.replace('npc_dota_hero_', '')} L${s.level} live ${s.spa} bat/(as/100) ${exp.toFixed(4)}`); }
console.log(`attack interval = BAT / (AS / 100): ok ${spaOk}, differ ${spaBad.length} ${spaBad.slice(0, 4).join(' ; ')}`);

// ---- 4. level links and automatic levels -> data/live_facts.json
const follow = {}; const fresh = {}; const maxLevel = {};
for (const rec of Object.values(live)) {
  for (const [an, m] of Object.entries(rec.meta)) maxLevel[an] = m.max;
  for (const [an, lv] of Object.entries(rec.fresh30)) if (lv > 0 && !/^plus_|^ability_|portal_warp/.test(an)) fresh[an] = [rec.fresh1[an] ?? 0, lv];
  for (const [lead, per] of Object.entries(rec.links)) {
    for (const [L, moved] of Object.entries(per)) for (const [other, lv] of Object.entries(moved)) ((follow[lead] ||= {})[other] ||= {})[L] = lv;
  }
}
const nFollow = Object.values(follow).reduce((s, x) => s + Object.keys(x).length, 0);
console.log(`\nlevel links: ${Object.keys(follow).length} leading abilities, ${nFollow} follower pairs; auto-levelled on a fresh hero: ${Object.keys(fresh).length}`);
const rows = [];
for (const [lead, fs2] of Object.entries(follow)) for (const [o, lv] of Object.entries(fs2)) rows.push(`${lead} -> ${o}: ${Object.entries(lv).map(([L, v]) => `${L}:${v}`).join(' ')}`);
console.log(rows.join('\n'));
fs.writeFileSync(path.join(here, '..', 'out', 'links.json'), JSON.stringify({ follow, fresh, maxLevel }, null, 1));
