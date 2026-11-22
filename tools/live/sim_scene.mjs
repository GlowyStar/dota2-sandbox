// Runs a scene spec in the simulator and records it in the same event format as the live recorder (simlab_scene.lua).
//   node tools/live/sim_scene.mjs <spec.json> [out.json]
// A spec: { id, units: [{ tag, name, team, x, y, level, abilities: { name: level }, talents: "all" | [names], scepter, shard, items, face }],
//           actions: [{ t, unit, type: cast|attack|move|stop|hold, ability, target, pos, toggle }], duration }
import fs from 'node:fs';
import { loadData } from '../../src/engine/gamedata.mjs';
import { buildWorld } from '../../src/scenario.mjs';
import { ST } from '../../src/engine/registry.mjs';
import { modifier } from '../../src/engine/dsl.mjs';

// [L] The Hero Demo target dummy cannot die, and its health is back at the maximum one server tick after any damage.
const DUMMY = 'npc_dota_hero_target_dummy';
modifier('modifier_simlab_target_dummy', { hidden: true, onDeath(m, ev) { ev.prevent = true; } });

const r2 = (x) => Math.round(x * 100) / 100;
const STATES = [['stun', (u) => u.st[ST.STUN] > 0 || u.st[ST.SLEEP] > 0], ['silence', (u) => u.st[ST.SILENCE] > 0], ['root', (u) => u.st[ST.ROOT] > 0], ['disarm', (u) => u.st[ST.DISARM] > 0],
  ['hex', (u) => u.st[ST.HEX] > 0], ['mute', (u) => u.st[ST.MUTE] > 0], ['invuln', (u) => u.st[ST.INVULN] > 0], ['immune', (u) => u.st[ST.IMMUNE] > 0], ['invis', (u) => u.st[ST.INVIS] > 0],
  ['break', (u) => u.st[ST.BREAK] > 0], ['ethereal', (u) => u.st[ST.ETHEREAL] > 0], ['fear', (u) => u.st[ST.FEAR] > 0], ['taunt', (u) => u.st[ST.TAUNT] > 0], ['out', (u) => u.st[ST.OUT] > 0]];

export function runSimScene(spec, data = loadData()) {
  const units = spec.units.map((s) => {
    const items = [...(s.items || [])];
    if (s.scepter) items.unshift('item_ultimate_scepter');
    if (s.shard) items.unshift('item_aghanims_shard');
    return { id: s.tag, team: s.team, unit: s.name, level: s.level || 1, pos: [s.x, s.y], skills: s.abilities || {}, items, ai: 'idle', talents: 'none' };
  });
  const w = buildWorld(data, { units, rules: { maxTime: spec.duration + 5, fresh: true, gameTime: spec.gameTime || 0 } }, spec.seed || 1, { log: true, logLimit: 100000 });
  // [L] units the recorder creates by script keep level-1 abilities whatever the clock (measured: Granite Aura at 3 h);
  // only camp spawns level up with the clock
  if (spec.gameTime > 0) for (const u of w.units) if (u.findAbility('neutral_upgrade')) for (const a of u.abilities) if (a.name !== 'neutral_upgrade' && a.level > 1) a.setLevel(1);
  for (const s of spec.units) {
    const u = w.byTag.get(s.tag);
    if (!u.isHero) continue;
    // the live unit only has the talents the spec names (nothing is granted by level)
    const tal = s.talents === 'all' ? (u.def.talents || []).filter(Boolean) : Array.isArray(s.talents) ? s.talents : [];
    u.setTalents(tal);
    u.recompute(); u.hp = u.maxHp; u.mana = u.maxMana;
  }
  const dummies = w.units.filter((u) => u.name === DUMMY);
  for (const u of dummies) u.addModifier('modifier_simlab_target_dummy', {});
  const ev = []; const last = {}; const hpS = {}; const mods = {}; const watch = {};
  const push = (e) => { e.t = Math.round(w.time * 1000) / 1000; ev.push(e); };
  // units that appear during the scene are named like on the live side: <owner tag>~<unit name>
  const tagOf = (u) => { if (!u) return null; if (w.byTag.get(u.tag) === u) return u.tag; const o = u.owner; return `${o && w.byTag.get(o.tag) === o ? o.tag : '?'}~${u.name}`; };
  const normTag = (t) => { if (t === null || t === undefined) return t; const u = w.byTag.get(t) || w.units.find((x) => x.tag === t); return u ? tagOf(u) : t; };
  const snapshot = (u) => {
    if (u.dirty) u.recompute();
    return { alive: u.alive ? 1 : 0, maxHp: Math.round(u.maxHp), maxMana: r2(u.maxMana), ms: r2(u.ms), armor: r2(u.armor), as: r2(u.attackSpeed), dmg: r2((u.dmgMin + u.dmgMax) / 2 + u.dmgBonus),
      range: r2(u.attackRange), mrBase: r2(u.mr * 100), evasion: r2(u.evasion), statusRes: r2(u.statusRes), spellAmp: r2(u.spellAmp / 100), hpRegen: r2(u.hpRegen), manaRegen: r2(u.manaRegen),
      st: STATES.filter(([, f]) => f(u)).map(([n]) => n).join(','), x: Math.round(u.x), y: Math.round(u.y) };
  };
  const sample = () => {
    for (const u of w.units) {
      if (w.byTag.get(u.tag) !== u) continue;   // like the live recorder: only the units of the spec are sampled
      const tag = u.tag;
      const snap = snapshot(u);
      const l = last[tag]; let d = null;
      if (!l) d = snap; else for (const k in snap) if (l[k] !== snap[k]) (d ||= {})[k] = snap[k];
      if (d) push({ k: 's', u: tag, d });
      last[tag] = snap;
      const hs = hpS[tag];
      if (!hs) { hpS[tag] = { hp: u.hp, mana: u.mana, n: 0 }; push({ k: 'h', u: tag, hp: r2(u.hp), mana: r2(u.mana) }); }
      else {
        hs.n++;
        const quiet = Math.abs(u.hp - hs.hp) <= Math.abs(snap.hpRegen) * 0.05 + 0.6 && Math.abs(u.mana - hs.mana) <= Math.abs(snap.manaRegen) * 0.05 + 0.6;
        if (!quiet || hs.n >= 15) { push({ k: 'h', u: tag, hp: r2(u.hp), mana: r2(u.mana) }); hs.n = 0; }
        hs.hp = u.hp; hs.mana = u.mana;
      }
      const mm = (mods[tag] ||= new Map()); const seen = new Set();
      for (const m of u.mods) {
        if (m.def.hidden) continue;
        seen.add(m);
        const rec = mm.get(m);
        if (!rec) { mm.set(m, { stacks: m.stacks, born: w.time }); push({ k: 'm+', u: tag, name: m.name, dur: m.dieTime === Infinity ? -1 : r2(m.dieTime - m.created), stacks: m.stacks, by: tagOf(m.caster), ab: m.ability ? m.ability.name : undefined, debuff: m.def.debuff ? 1 : 0 }); }
        else if (rec.stacks !== m.stacks) { rec.stacks = m.stacks; push({ k: 'ms', u: tag, name: m.name, stacks: m.stacks }); }
      }
      for (const [m, rec] of mm) if (!seen.has(m)) { push({ k: 'm-', u: tag, name: m.name, life: r2(w.time - rec.born) }); mm.delete(m); }
    }
    for (const [tag, list] of Object.entries(watch)) {
      const u = w.byTag.get(tag); if (!u) continue;
      for (const [an, wt] of Object.entries(list)) {
        const ab = u.findAbility(an); if (!ab) continue;
        const cd = r2(ab.cdRemaining()); const ch = ab.charges || 0; const tg = ab.toggled ? 1 : 0; const chn = u.channelAb === ab ? 1 : 0; const ph = u.castAb === ab ? 1 : 0;
        if ((cd > 0) !== (wt.cd > 0) || cd > wt.cd + 0.001 || ch !== wt.ch || tg !== wt.tg || chn !== wt.chn || ph !== wt.ph) push({ k: 'a', u: tag, ab: an, cd, charges: ch, toggle: tg, channel: chn, phase: ph });
        Object.assign(wt, { cd, ch, tg, chn, ph });
      }
    }
  };
  const order = (a) => {
    const u = w.byTag.get(a.unit);
    if (!u) return;
    if (a.type === 'cast') {
      const key = data.resolve('ability', a.ability) || data.resolve('item', a.ability) || a.ability;
      const ab = u.findAbility(key);
      if (!ab) { push({ k: 'order_failed', u: a.unit, why: 'no ability ' + a.ability }); return; }
      (watch[a.unit] ||= {})[a.ability] ||= { cd: 0, ch: ab.charges || 0, tg: 0, chn: 0, ph: 0 };
      const t = a.target ? w.byTag.get(a.target) : null;
      push({ k: 'order', u: a.unit, type: 'cast', ab: a.ability, mana: r2(u.mana), ready: ab.ready() ? 1 : 0, level: ab.level, manaCost: r2(ab.manaCost()), cdFull: r2(ab.useCooldown()), castPoint: r2(ab.castPoint()) });
      if (!ab.script || !(ab.script.cast || ab.script.ai)) { push({ k: 'order_failed', u: a.unit, why: 'ability has no cast script' }); return; }
      if (a.pos) u.cast(ab, t, a.pos[0], a.pos[1]); else if (t) u.cast(ab, t, t.x, t.y); else u.cast(ab, null);
    } else if (a.type === 'attack') { const t = w.byTag.get(a.target); if (t) u.attack(t); push({ k: 'order', u: a.unit, type: 'attack', target: a.target }); }
    else if (a.type === 'move') { u.moveTo(a.pos[0], a.pos[1]); push({ k: 'order', u: a.unit, type: 'move' }); }
    else if (a.type === 'stop') { u.stop(); push({ k: 'order', u: a.unit, type: 'stop' }); }
    else if (a.type === 'hold') { u.hold(); push({ k: 'order', u: a.unit, type: 'hold' }); }
  };
  const actions = [...(spec.actions || [])].sort((a, b) => a.t - b.t);
  let ai = 0; let logPos = 0;
  const ticks = Math.round(spec.duration / w.dt);
  let error = null;
  try {
    for (let i = 0; i <= ticks; i++) {
      while (ai < actions.length && actions[ai].t <= w.time + 1e-9) order(actions[ai++]);
      for (const u of dummies) if (u.alive && u.hp < u.maxHp) u.hp = u.maxHp;
      w.tick();
      for (; logPos < w.log.length; logPos++) { const e = w.log[logPos]; if (e.e === 'dmg') ev.push({ k: 'df', t: e.t, to: normTag(e.b), by: normTag(e.a), ab: e.w && !/^attack/.test(e.w) ? e.w.replace(' (crit)', '') : undefined, crit: / \(crit\)$/.test(e.w || '') ? 1 : undefined, v: r2(e.v) }); else if (e.e === 'heal' && e.v >= 1) ev.push({ k: 'heal', t: e.t, to: normTag(e.b), by: normTag(e.a), ab: e.w || undefined, v: r2(e.v) }); }
      sample();
    }
  } catch (e) { error = String(e && e.stack ? e.stack : e).split('\n').slice(0, 3).join(' | '); }
  const us = {};
  for (const u of w.units) us[u.tag] = { name: u.name, team: u.team, level: u.level };
  return { id: spec.id, units: us, duration: spec.duration, ev, error: error || undefined };
}

if (process.argv[1] && process.argv[1].replace(/\\/g, '/').endsWith('tools/live/sim_scene.mjs')) {
  const spec = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
  const rec = runSimScene(spec);
  if (process.argv[3]) fs.writeFileSync(process.argv[3], JSON.stringify(rec)); else console.log(JSON.stringify(rec));
}
