// Interactive sandbox sessions (hero-demo style): spawn anything, give items, issue orders, step time, inspect.
import { World, ORDER } from './engine/core.mjs';
import { makeAI } from './engine/ai.mjs';
import { ST } from './engine/registry.mjs';
import { setupUnit, resolveItemName, unitResult, parseTime } from './scenario.mjs';
import * as C from './engine/constants.mjs';

const r1 = (x) => Math.round(x * 10) / 10;
const sessions = new Map();
let nextSession = 1;

export function unitState(u, verbose = false) {
  if (u.dirty) u.recompute();
  const w = u.world;
  const s = {
    id: u.tag, unit: u.name, team: u.team, level: u.level, alive: u.alive, hp: r1(u.hp), maxHp: r1(u.maxHp), mana: r1(u.mana), maxMana: r1(u.maxMana),
    pos: [Math.round(u.x), Math.round(u.y)],
    order: Object.keys(ORDER).find((k) => ORDER[k] === u.order), target: u.orderTarget ? u.orderTarget.tag : null,
  };
  const states = Object.keys(ST).filter((k) => u.st[ST[k]] > 0);
  if (states.length) s.states = states;
  const mods = u.mods.filter((m) => !m.def.hidden).map((m) => ({ name: m.name, stacks: m.stacks || undefined, left: m.dieTime === Infinity ? undefined : r1(m.dieTime - w.time) }));
  if (mods.length) s.modifiers = mods;
  if (verbose) {
    Object.assign(s, { armor: r1(u.armor), magicResist: Math.round(u.mr * 1000) / 1000, damage: [r1(u.dmgMin + u.dmgBonus), r1(u.dmgMax + u.dmgBonus)], attackSpeed: r1(u.attackSpeed), attackInterval: Math.round(u.attackInterval * 1000) / 1000, moveSpeed: r1(u.ms), attackRange: u.attackRange, hpRegen: r1(u.hpRegen), manaRegen: r1(u.manaRegen), str: r1(u.str), agi: r1(u.agi), int: r1(u.int) });
    s.abilities = u.abilities.filter((a) => a.level > 0 || !a.hidden).map((a) => ({ name: a.name, level: a.level, cd: r1(a.cdRemaining()), mana: r1(a.manaCost()), modelled: !!a.script, passive: a.passive || undefined }));
    s.items = u.items.map((a) => ({ name: a.name, cd: r1(a.cdRemaining()), charges: a.charges || undefined }));
    s.dealt = r1(u.mDealt); s.taken = r1(u.mTaken);
  }
  return s;
}

function getSession(id) {
  const s = sessions.get(id);
  if (!s) throw new Error(`no sandbox session "${id}" (use op "new" first)`);
  return s;
}
// units spawned by the session are found by id; summoned units, illusions and clones by the id that `state` lists for them
const unitOf = (s, id) => {
  const w = s.world;
  const u = w.byTag.get(id) || w.units.find((x) => x.tag === id && x.alive) || w.units.find((x) => x.tag === id);
  if (!u) throw new Error(`no unit "${id}" in this sandbox; units: ${w.units.filter((x) => x.alive).map((x) => x.tag).join(', ')}`);
  return u;
};

export function sandboxExec(data, sessionId, commands) {
  let s = sessionId ? sessions.get(sessionId) : null;
  const out = [];
  for (const c of commands) {
    const op = c.op;
    if (op === 'new') {
      const id = c.session || sessionId || `sb${nextSession++}`;
      const w = new World(data, { seed: c.seed ?? 1, log: true, logLimit: c.logLimit || 20000, regen: c.regen, freeSpells: c.freeSpells, day: c.day });
      w.makeAI = makeAI; w.byTag = new Map(); w.gameTime = parseTime(c.gameTime);
      s = { id, world: w, counters: [0, 0, 0, 0] };
      sessions.set(id, s); sessionId = id;
      out.push({ op, session: id });
      continue;
    }
    if (!s) s = getSession(sessionId);
    const w = s.world;
    switch (op) {
      case 'spawn': {
        const n = c.count || 1; const made = [];
        for (let i = 0; i < n; i++) {
          const team = c.team ?? 0;
          const idx = s.counters[team]++;
          const spec = { ai: 'idle', ...c, id: c.id ? (n > 1 ? `${c.id}${i + 1}` : c.id) : undefined, pos: c.pos ? [c.pos[0], c.pos[1] + i * 100] : [team === 0 ? 0 : 600, idx * 120] };
          const u = setupUnit(w, spec, 0, idx, { distance: 600, teamSize: [1, 1, 1, 1] });
          if (w.byTag.has(u.tag)) u.tag = `${u.tag}_${u.id}`;
          w.byTag.set(u.tag, u);
          if (spec.ai && typeof spec.ai === 'object' && spec.ai.target) u.ai.fixedTarget = w.byTag.get(spec.ai.target) || null;
          made.push(u.tag);
        }
        out.push({ op, ids: made });
        break;
      }
      case 'remove': { const u = unitOf(s, c.id); w.kill(u, null, null, true); w.byTag.delete(c.id); out.push({ op, id: c.id }); break; }
      case 'give': { const u = unitOf(s, c.id); for (const it of [].concat(c.item || c.items)) { const o = typeof it === 'string' ? { name: it } : it; u.addItem(resolveItemName(data, o.name), o); } if (u.ai && u.ai.castables) u.ai.castables = null; out.push({ op, id: c.id, items: u.items.map((x) => x.name) }); break; }
      case 'take': { const u = unitOf(s, c.id); out.push({ op, removed: u.removeItem(resolveItemName(data, c.item)) }); break; }
      case 'set': {
        const u = unitOf(s, c.id);
        if (c.level !== undefined) u.setLevel(c.level, { skills: c.skills, prio: c.prio });
        if (c.scepter !== undefined || c.shard !== undefined) u.setUpgrades(c.scepter ?? u.hasScepter, c.shard ?? u.hasShard);
        if (c.talents) u.setTalents(c.talents.map((t) => (typeof t === 'number' ? u.def.talents[t] : u.def.talents.find((x) => x && (x === t || x.endsWith(t))) || t)));
        if (c.invulnerable !== undefined) { const has = u.st[ST.INVULN] > 0; if (c.invulnerable && !has) u.st[ST.INVULN]++; else if (!c.invulnerable && has) u.st[ST.INVULN]--; }
        if (c.pos) { u.x = c.pos[0]; u.y = c.pos[1]; }
        if (c.team !== undefined) u.team = c.team;
        if (c.ai !== undefined) { u.ai = c.ai === 'idle' || c.ai === 'none' ? null : makeAI(c.ai); if (u.ai && typeof c.ai === 'object' && c.ai.target) u.ai.fixedTarget = w.byTag.get(c.ai.target) || null; }
        u.recompute();
        if (c.hp !== undefined) u.hp = c.hp <= 1 ? u.maxHp * c.hp : Math.min(u.maxHp, c.hp);
        if (c.mana !== undefined) u.mana = c.mana <= 1 ? u.maxMana * c.mana : Math.min(u.maxMana, c.mana);
        out.push({ op, unit: unitState(u, true) });
        break;
      }
      case 'mod': { const u = unitOf(s, c.id); const m = u.addModifier(c.name, { duration: c.duration, stacks: c.stacks, data: c.data, caster: c.caster ? unitOf(s, c.caster) : u }); out.push({ op, applied: !!m }); break; }
      case 'rune': { const u = unitOf(s, c.id); const map = { doubledamage: ['modifier_rune_doubledamage', 45], dd: ['modifier_rune_doubledamage', 45], haste: ['modifier_rune_haste', 22], regen: ['modifier_rune_regen', 30], arcane: ['modifier_rune_arcane', 50] }; const r = map[c.rune]; if (!r) throw new Error(`rune must be one of ${Object.keys(map).join(', ')}`); u.addModifier(r[0], { duration: c.duration ?? r[1] }); out.push({ op, rune: c.rune }); break; }
      case 'refresh': { for (const u of c.id ? [unitOf(s, c.id)] : w.units.filter((x) => x.alive)) { u.recompute(); u.hp = u.maxHp; u.mana = u.maxMana; for (const a of u.abilities.concat(u.items)) { a.cdEnd = 0; if (a.vals.AbilityCharges > 0) a.charges = a.vals.AbilityCharges; } } out.push({ op }); break; }
      case 'free_spells': w.freeSpells = c.on !== false; out.push({ op, on: w.freeSpells }); break;
      case 'regen': w.regen = c.on !== false; out.push({ op, on: w.regen }); break;
      case 'order': {
        const u = unitOf(s, c.id);
        const t = c.target ? unitOf(s, c.target) : null;
        if (c.type === 'attack') { if (!t) throw new Error('attack order needs "target"'); u.attack(t); }
        else if (c.type === 'move') u.moveTo(c.pos[0], c.pos[1]);
        else if (c.type === 'stop') u.stop();
        else if (c.type === 'hold') u.hold();
        else if (c.type === 'cast') {
          const key = data.resolve('ability', c.ability) || data.resolve('item', c.ability);
          const ab = key && u.findAbility(key);
          if (!ab) throw new Error(`unit ${c.id} has no ability/item "${c.ability}"; has: ${u.abilities.concat(u.items).map((a) => a.name).join(', ')}`);
          if (!ab.script || !ab.script.cast) throw new Error(`"${ab.name}" is not modelled as a castable ability`);
          if (!ab.ready()) throw new Error(`"${ab.name}" is not ready (level ${ab.level}, cooldown ${r1(ab.cdRemaining())}s, mana ${r1(u.mana)}/${r1(ab.manaCost())})`);
          u.cast(ab, t, c.pos ? c.pos[0] : t ? t.x : u.x, c.pos ? c.pos[1] : t ? t.y : u.y);
        } else throw new Error('order type must be attack | move | cast | stop | hold');
        out.push({ op, id: c.id, type: c.type });
        break;
      }
      case 'step': {
        const before = w.log.length;
        const until = c.until; // { dead: id } | { anyDead: true }
        const secs = Math.min(c.seconds ?? 1, 600);
        const stop = until ? (ww) => (until.dead ? !unitOf(s, until.dead).alive : ww.units.some((u) => !u.alive && u.counts)) : null;
        const stopped = w.run(secs, stop);
        out.push({ op, time: Math.round(w.time * 1000) / 1000, stoppedEarly: stopped, newLogEntries: w.log.length - before });
        break;
      }
      case 'state': out.push({ op, time: Math.round(w.time * 1000) / 1000, units: (c.id ? [unitOf(s, c.id)] : w.units.filter((u) => u.counts || u.alive)).map((u) => unitState(u, !!c.verbose || !!c.id)) }); break;
      case 'log': { const n = c.last || 40; let L = w.log; if (c.filter) L = L.filter((e) => e.e === c.filter || e.a === c.filter || e.b === c.filter); out.push({ op, total: w.log.length, entries: L.slice(-n) }); break; }
      case 'results': out.push({ op, time: w.time, units: w.units.filter((u) => u.counts).map(unitResult) }); break;
      case 'close': sessions.delete(s.id); out.push({ op, closed: s.id }); s = null; break;
      default: throw new Error(`unknown sandbox op "${op}". Ops: new, spawn, remove, give, take, set, mod, rune, refresh, free_spells, regen, order, step, state, log, results, close`);
    }
  }
  return { session: s ? s.id : null, out };
}

export function listSessions() { return [...sessions.values()].map((s) => ({ session: s.id, time: s.world.time, units: s.world.units.length })); }
