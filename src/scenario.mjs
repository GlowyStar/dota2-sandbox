// Scenario spec (plain JSON) -> World, plus single-run execution and result extraction.
import { World } from './engine/core.mjs';
import { makeAI } from './engine/ai.mjs';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ST, abilityScripts } from './engine/registry.mjs';
import * as C from './engine/constants.mjs';
import './scripts/index.mjs';

export function resolveUnitName(data, name) {
  const r = data.resolve('unit', name);
  if (!r) throw new Error(`unknown unit "${name}" (use the list tool to see valid names)`);
  return r;
}
export function resolveItemName(data, name) {
  const r = data.resolve('item', name);
  if (!r) throw new Error(`unknown item "${name}"`);
  return r;
}

function pickTalents(def, level, spec) {
  const out = [];
  const tal = def.talents || [];
  const tiers = [10, 15, 20, 25];
  if (Array.isArray(spec)) {
    for (const s of spec) {
      if (typeof s === 'number') { if (tal[s]) out.push(tal[s]); continue; }
      const found = tal.find((t) => t && (t === s || t.endsWith(s)));
      if (!found) throw new Error(`talent "${s}" not found on ${def.name}; options: ${tal.filter(Boolean).join(', ')}`);
      out.push(found);
    }
  } else if (spec && spec !== 'none') {
    let picks;
    if (spec === 'first') picks = [0, 0, 0, 0];
    else if (spec === 'second') picks = [1, 1, 1, 1];
    else if (spec === 'all') picks = null;
    else if (/^[12x]([-,]?[12x]){0,3}$/.test(spec)) picks = spec.replace(/[-,]/g, '').split('').map((c) => (c === 'x' ? -1 : Number(c) - 1));
    else throw new Error(`bad talents spec "${spec}" (use none | first | second | all | "1-2-1-2" | [names])`);
    for (let i = 0; i < 4; i++) {
      if (level < tiers[i]) break;
      if (picks === null) { if (tal[2 * i]) out.push(tal[2 * i]); if (tal[2 * i + 1]) out.push(tal[2 * i + 1]); continue; }
      const p = picks[i] ?? picks[picks.length - 1];
      if (p >= 0 && tal[2 * i + p]) out.push(tal[2 * i + p]);
    }
  }
  // levels 27-30 grant the remaining talent of each tier
  for (let i = 0; i < 4; i++) if (level >= 27 + i) for (const k of [2 * i, 2 * i + 1]) if (tal[k] && !out.includes(tal[k])) out.push(tal[k]);
  return out;
}

// mm:ss or seconds -> seconds
export function parseTime(t) { if (t === undefined || t === null) return 0; if (typeof t === 'number') return t; const m = /^(\d+):(\d+)$/.exec(String(t)); return m ? Number(m[1]) * 60 + Number(m[2]) : Number(t) || 0; }

export function setupUnit(world, us, index, teamIndex, defaults) {
  const data = world.data;
  const name = resolveUnitName(data, us.unit || us.hero || us.name);
  const team = us.team ?? 0;
  const pos = us.pos || [team === 0 ? 0 : defaults.distance, (teamIndex - (defaults.teamSize[team] - 1) / 2) * 120];
  const def = data.heroes[name] || data.units[name];
  const level = us.level || (def.hero ? 1 : def.level || 1);
  const u = world.spawn(name, team, { tag: us.id || `${team === 0 ? 'A' : 'B'}${teamIndex + 1}`, x: pos[0], y: pos[1], level, skills: us.skills, prio: us.prio, ovr: us.override });
  u.counts = us.counts !== false;
  if (def.hero) {
    const tl = pickTalents(def, level, us.talents ?? defaults.talents ?? 'none');
    if (tl.length) u.setTalents(tl);
    if (us.attrLevels !== undefined) u.attrLevels = us.attrLevels;
  }
  if (us.scepter || us.shard) u.setUpgrades(!!us.scepter, !!us.shard);
  if (us.noAbilities) for (const a of u.abilities) a.setLevel(0); // base stats only (innate passives off)
  for (const it of us.items || []) {
    const o = typeof it === 'string' ? { name: it } : it;
    u.addItem(resolveItemName(data, o.name), o);
  }
  if (us.neutral) {
    const arr = Array.isArray(us.neutral) ? us.neutral : [us.neutral];
    for (const it of arr) { const o = typeof it === 'string' ? { name: it } : it; u.addItem(resolveItemName(data, o.name), { ...o, slot: 'neutral' }); }
  }
  for (const m of us.mods || []) u.addModifier(m.name, { duration: m.duration, stacks: m.stacks });
  // explicit stack counts of passive abilities, e.g. { nevermore_necromastery: 12 }
  for (const [an, n] of Object.entries(us.stacks || {})) { const ab = u.findAbility(data.resolve('ability', an) || an); if (ab && ab.mods[0]) ab.mods[0].setStacks(n); }
  if (us.invulnerable) u.st[ST.INVULN]++;
  u.recompute();
  u.hp = u.maxHp; u.mana = u.maxMana;
  if (us.hp !== undefined) u.hp = us.hp <= 1 ? u.maxHp * us.hp : Math.min(u.maxHp, us.hp);
  if (us.mana !== undefined) u.mana = us.mana <= 1 ? u.maxMana * us.mana : Math.min(u.maxMana, us.mana);
  const ai = us.ai ?? defaults.ai ?? 'fight';
  if (ai !== 'idle' && ai !== 'none') {
    u.ai = makeAI(ai);
    u._focusTag = typeof ai === 'object' && ai.target ? ai.target : null;
  }
  return u;
}

export function buildWorld(data, spec, seed = 1, opts = {}) {
  const rules = spec.rules || {};
  const w = new World(data, { seed, tick: rules.tick, regen: rules.regen, freeSpells: rules.freeSpells, day: rules.day, log: opts.log, logLimit: opts.logLimit, skillshotHit: rules.skillshotHit, detectAll: rules.detectAll, fresh: rules.fresh });
  w.makeAI = makeAI;
  w.gameTime = parseTime(rules.gameTime);
  const teamSize = [0, 0, 0, 0];
  const expanded = [];
  for (const us of spec.units || []) { const n = us.count || 1; for (let i = 0; i < n; i++) { expanded.push(n > 1 ? { ...us, id: us.id ? `${us.id}${i + 1}` : undefined } : us); teamSize[us.team ?? 0]++; } }
  const defaults = { distance: spec.distance ?? rules.distance ?? 600, teamSize, talents: rules.talents, ai: rules.ai };
  const counters = [0, 0, 0, 0];
  const byTag = new Map();
  for (const us of expanded) { const t = us.team ?? 0; const u = setupUnit(w, us, expanded.indexOf(us), counters[t]++, defaults); byTag.set(u.tag, u); }
  for (const u of w.units) if (u.ai && u._focusTag) u.ai.fixedTarget = byTag.get(u._focusTag) || null;
  w.byTag = byTag;
  return w;
}

function teamsAlive(w) {
  let mask = 0;
  const us = w.units;
  for (let i = 0; i < us.length; i++) { const u = us[i]; if (u.alive && u.counts) mask |= 1 << u.team; }
  return mask;
}

export function runWorld(w, spec) {
  const rules = spec.rules || {};
  const maxTime = rules.maxTime ?? 120;
  const end = rules.end || 'team_dead';
  const maxTicks = Math.round(maxTime / w.dt);
  let winner = -1; let ended = 'timeout';
  let deaths = 0;
  w.onDeath = (u) => { if (u.counts) deaths++; };
  const watch = typeof end === 'object' && end.unit_dead ? w.byTag.get(end.unit_dead) : null;
  for (let i = 0; i < maxTicks; i++) {
    w.tick();
    if (deaths > 0) {
      if (watch) { if (!watch.alive) { ended = 'unit_dead'; winner = watch.team === 0 ? 1 : 0; break; } }
      else if (end === 'first_death') { ended = 'first_death'; const m = teamsAlive(w); winner = lastDeadTeam(w) === 0 ? 1 : 0; if (m === 0) winner = -1; break; }
      else if (end !== 'time') {
        const m = teamsAlive(w);
        if ((m & (m - 1)) === 0) { ended = 'team_dead'; winner = m === 0 ? -1 : Math.log2(m) | 0; break; }
      }
      deaths = 0;
    }
  }
  return { winner, ended, time: w.time };
}

function lastDeadTeam(w) { let t = -1; let best = -1; for (const u of w.units) if (!u.alive && u.counts && u.deathTime >= best) { best = u.deathTime; t = u.team; } return t; }

const r1 = (x) => Math.round(x * 10) / 10;

export function unitResult(u) {
  return {
    id: u.tag, unit: u.name, team: u.team, level: u.level, alive: u.alive, hp: r1(u.hp), maxHp: r1(u.maxHp), mana: r1(u.mana),
    deathTime: u.deathTime < 0 ? null : Math.round(u.deathTime * 1000) / 1000,
    dealt: r1(u.mDealt), physical: r1(u.mPhys), magical: r1(u.mMagic), pure: r1(u.mPure), taken: r1(u.mTaken), healed: r1(u.mHealed),
    attacks: u.mAttacks, hits: u.mHits, misses: u.mMisses, crits: u.mCrits, casts: u.mCasts, kills: u.mKills,
  };
}

export function runScenario(data, spec, seed = 1, opts = {}) {
  const w = buildWorld(data, spec, seed, opts);
  const r = runWorld(w, spec);
  const out = { seed, ...r, time: Math.round(r.time * 1000) / 1000, units: w.units.filter((u) => u.counts).map(unitResult) };
  const unscripted = unscriptedReport(w);
  if (unscripted.length) out.notModelled = unscripted;
  const partial = partialReport(w);
  if (partial.length) out.partiallyModelled = partial;
  if (w.warnings.size) out.warnings = [...w.warnings];
  if (w.log) out.log = w.log;
  return out;
}

// abilities / item effects present on the units of this scenario that the engine does not model
export function unscriptedReport(w) {
  const out = [];
  const seen = new Set();
  for (const u of w.units) {
    if (!u.counts) continue;
    const miss = [];
    for (const a of u.abilities) if (!a.script && a.level > 0 && !a.def.talent && !/^(generic_hidden|special_bonus_attributes)$/.test(a.name)) miss.push(a.name);
    for (const a of u.items) if (!a.script && needsScript(a.def)) miss.push(a.name);
    for (const t of u.talents) if (t.startsWith('special_bonus_unique') && !talentKnown(w.data, t)) miss.push(t);
    const key = u.name + '|' + miss.join(',');
    if (miss.length && !seen.has(key)) { seen.add(key); out.push({ unit: u.tag, missing: miss }); }
  }
  return out;
}

// learned abilities and carried items of this scenario whose script is labelled `partial` (a tooltip clause is missing)
export function partialReport(w) {
  const out = [];
  const seen = new Set();
  for (const u of w.units) {
    if (!u.counts) continue;
    const list = [];
    for (const a of u.abilities) if (a.script && a.script.fid === 'partial' && a.level > 0) list.push(a.name);
    for (const a of u.items) if (a.script && a.script.fid === 'partial') list.push(a.name);
    const key = u.name + '|' + list.join(',');
    if (list.length && !seen.has(key)) { seen.add(key); out.push({ unit: u.tag, abilities: list }); }
  }
  return out;
}

// script sources, read once: a talent that a script checks by name (unit.talents.has('special_bonus_unique_x')) is found there
let scriptText = null;
export function namedInScripts(name) {
  if (scriptText === null) {
    const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), 'scripts');
    scriptText = fs.readdirSync(dir).filter((f) => f.endsWith('.mjs')).map((f) => fs.readFileSync(path.join(dir, f), 'utf8')).join(' ');
  }
  return scriptText.includes(`'${name}'`);
}

// a talent has an effect when an ability value references it, a script registers it, or a script checks it by name
export function talentKnown(data, t) { return talentReferenced(data, t) || abilityScripts.has(t) || namedInScripts(t); }

// an item needs a script when it has values beyond plain stat bonuses
export function needsScript(def) {
  const tok = def.tokens || {};
  for (const k of Object.keys(def.vals)) {
    if (tok[k]) continue;
    if (/^(AbilityCooldown|AbilityManaCost|AbilityCastRange|AbilityCastPoint|max_level|model_scale|tooltip_|AbilityChannelTime|AbilityCharges)/.test(k)) { if (/^Ability(Cooldown|ManaCost)/.test(k)) return true; continue; }
    return true;
  }
  return false;
}

let talentRefCache = null;
function talentReferenced(data, t) {
  if (!talentRefCache) {
    talentRefCache = new Set();
    for (const a of Object.values(data.abilities)) for (const e of Object.values(a.vals)) if (e && e.t) for (const k of Object.keys(e.t)) talentRefCache.add(k);
  }
  return talentRefCache.has(t);
}

// Static character sheet (what the in-game stats panel would show) for a unit setup.
export function sheet(data, us) {
  const w = new World(data, { seed: 1 });
  const u = setupUnit(w, { ...us, ai: 'idle' }, 0, 0, { distance: 0, teamSize: [1, 0, 0, 0] });
  u.recompute();
  const avg = (u.dmgMin + u.dmgMax) / 2 + u.dmgBonus;
  const r2 = (x) => Math.round(x * 100) / 100;
  return {
    unit: u.name, name: u.def.dname, level: u.level, attr: u.attr,
    str: r2(u.str), agi: r2(u.agi), int: r2(u.int),
    hp: r2(u.maxHp), hpRegen: r2(u.hpRegen), mana: r2(u.maxMana), manaRegen: r2(u.manaRegen),
    armor: r2(u.armor), physResist: r2(1 - C.armorMult(u.armor)), magicResist: r2(u.mr), evasion: r2(u.evasion), statusResist: r2(u.statusRes),
    damageMin: r2(u.dmgMin + u.dmgBonus), damageMax: r2(u.dmgMax + u.dmgBonus), damageAvg: r2(avg),
    attackSpeed: r2(u.attackSpeed), attackInterval: r2(u.attackInterval * 1000) / 1000, attackPoint: r2(u.attackPoint * 1000) / 1000, attackRange: u.attackRange,
    dpsRaw: r2(avg / u.attackInterval), ehpPhysical: r2(u.maxHp / C.armorMult(u.armor)), ehpMagical: r2(u.maxHp / (1 - u.mr)),
    moveSpeed: r2(u.ms), spellAmp: r2(u.spellAmp), lifesteal: r2(u.lifesteal), castRangeBonus: u.castRangeBonus, itemPotency: u.itemPotency,
    talents: [...u.talents], abilities: u.abilities.filter((a) => !a.hidden || a.level > 0).map((a) => ({ name: a.name, level: a.level, modelled: !!a.script })),
    items: u.items.map((a) => ({ name: a.name, modelled: !!a.script || !needsScript(a.def) })),
  };
}
