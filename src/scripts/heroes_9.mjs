// Hero abilities, part 9: Arc Warden, Phoenix, Enchantress, Broodmother, Ember Spirit, Magnus, Pangolier, Silencer, Warlock,
// Bloodseeker, Omniknight, Treant Protector (and the abilities of the units they summon).
// Every number is read from the shipped data by value name. Literals are structural only (think intervals, small spawn offsets)
// or tooltip-only numbers that have no data value; each of those is explained next to it and in the ability's `note`.
import { defAbility, modifier, buff, debuff, passive, nuke, val, hit, addMod, stun, silence, healUnit, enemiesNear, enemiesInLine, knockback, mhit,
  zone, cleave, barrier, giveBarrier, summon, ST, PHYSICAL, MAGICAL, PURE,
  F_ATTACK, F_NO_AMP, F_REFLECT, F_HP_LOSS, F_NO_LIFESTEAL, F_NON_LETHAL, F_SECONDARY, F_PIERCE } from '../engine/dsl.mjs';

const na = (name, note) => defAbility(name, { fid: 'n/a', note });
const SELF = { target: null };                 // ai result for no-target abilities
const NO_CAP = 1e6;                            // "ignores the movement speed limit"
const CREEP_LIFESTEAL = 0.6;                   // the factor the engine applies to attack lifesteal against creeps ("standard creep lifesteal factor")
const hyp = (dx, dy) => Math.sqrt(dx * dx + dy * dy);
// an order the game refuses: mana and cooldown are given back
function refund(ab) { const u = ab.owner; if (u.world.freeSpells) return; ab.cdEnd = 0; u.mana += ab.manaCost(); }
const immune = (e) => e.st[ST.IMMUNE] > 0;
const frac = (u) => u.hp / u.maxHp;
// the enemy a unit is currently fighting; stands in for "facing" (the sandbox has no facing)
const foe = (u) => {
  let t = u.orderTarget;
  if (!(t && t.alive && t.team !== u.team)) t = u.ai && u.ai.target;
  return t && t.alive && t.team !== u.team ? t : u.world.nearestEnemy(u);
};
// nearest enemy hero (illusions excluded) within r of u; ultimates look for heroes even when the current attack target is a creep
const heroNear = (u, r) => {
  let best = null; const us = u.world.units;
  for (let i = 0; i < us.length; i++) { const e = us[i]; if (e.alive && e.team !== u.team && e.isHero && !e.isIllusion && e.st[ST.OUT] === 0 && u.distTo(e) <= r && (!best || u.distTo(e) < u.distTo(best))) best = e; }
  return best;
};
const dirTo = (u, t) => { if (!t) return [1, 0]; const d = hyp(t.x - u.x, t.y - u.y); return d > 1e-6 ? [(t.x - u.x) / d, (t.y - u.y) / d] : [1, 0]; };
const segDist = (px, py, x1, y1, x2, y2) => { const vx = x2 - x1; const vy = y2 - y1; let k = ((px - x1) * vx + (py - y1) * vy) / (vx * vx + vy * vy || 1); k = k < 0 ? 0 : k > 1 ? 1 : k; return hyp(x1 + vx * k - px, y1 + vy * k - py); };
// units (any team, filtered by pred) whose hull touches the segment; width is the full width
function unitsInLine(w, x1, y1, x2, y2, width, pred) {
  const out = []; const us = w.units;
  for (let i = 0; i < us.length; i++) { const e = us[i]; if (e.alive && e.st[ST.OUT] === 0 && pred(e) && segDist(e.x, e.y, x1, y1, x2, y2) <= width / 2 + e.def.hull) out.push(e); }
  return out;
}
// Damage over time that totals dps x the time the debuff really lasted: paid on every think and once more when it expires.
function tickDps(m, perSec, type, flags = 0) {
  const p = m.parent; const now = p.world.time; const dt = now - m.x; m.x = now;
  return dt > 1e-9 && perSec > 0 && p.alive ? mhit(m, p, perSec * dt, type, flags) : 0;
}
//   o: { interval, dps, type, flags, cond(m) (damage only while true), tick(m), stats, state, ... }   uses the slot m.x
const dpsDebuff = (name, o) => debuff(name, {
  interval: o.interval, stats: o.stats, state: o.state, purge: o.purge, pierce: o.pierce, multi: o.multi, statusResist: o.statusResist,
  onCreated(m, opts) { m.x = m.parent.world.time; if (o.onCreated) o.onCreated(m, opts); },
  onThink(m) { if (!o.cond || o.cond(m)) tickDps(m, val(o.dps, m), o.type, o.flags); else m.x = m.parent.world.time; if (o.tick && !m.removed) o.tick(m); },
  onDestroy(m, expired) { if (expired && (!o.cond || o.cond(m))) tickDps(m, val(o.dps, m), o.type, o.flags); if (o.onDestroy) o.onDestroy(m, expired); },
  onDeath: o.onDeath, onCast: o.onCast, onRefresh: o.onRefresh,
});
// Damage over time paid on a fixed schedule as the game's modifier thinks do: dps x every, the first tick `every` after the
// debuff was applied, the next ones every `every` from there (not rounded to whole server ticks: 0.25 s alternates 7 / 8 ticks),
// one more on expiry only when it falls on the schedule. Refreshing keeps the schedule. Thinks every server tick.
//   o: { every, dps, type, flags, tick(m) (every server tick, before the damage), stats, state, ... }   uses the slot m.x (next tick time)
const SERVER_TICK = 1 / 30;
const schedTick = (m, o) => { m.x += val(o.every, m); if (m.parent.alive) mhit(m, m.parent, val(o.dps, m) * val(o.every, m), o.type, o.flags); };
const schedDot = (name, o) => debuff(name, {
  interval: SERVER_TICK, stats: o.stats, state: o.state, purge: o.purge, pierce: o.pierce, multi: o.multi, statusResist: o.statusResist,
  onCreated(m) { m.x = m.parent.world.time + val(o.every, m); },
  onThink(m) { if (o.tick) o.tick(m); if (!m.removed && m.parent.world.time >= m.x - 1e-6) schedTick(m, o); },
  onDestroy(m, expired) { if (expired && m.parent.world.time >= m.x - 1e-6) schedTick(m, o); if (o.onDestroy) o.onDestroy(m, expired); },
  onDeath: o.onDeath, onCast: o.onCast,
});
// Linear projectile: a front `width` wide travels from (x0, y0) along the unit vector (dx, dy) for `length` at `speed`;
// fn(e) runs once for every enemy the front passes, done() when it reaches the end. Advanced once per world tick.
function wave(ab, x0, y0, dx, dy, length, speed, width, fn, done) {
  const u = ab.owner; const w = u.world; const seen = new Set(); const t0 = w.time; let pos = 0;
  const run = () => {
    const from = pos; pos = Math.min(length, speed * (w.time - t0));
    const us = w.units;
    for (let i = 0; i < us.length; i++) {
      const e = us[i];
      if (!e.alive || e.team === u.team || e.st[ST.OUT] > 0 || seen.has(e)) continue;
      const rx = e.x - x0; const ry = e.y - y0; const along = rx * dx + ry * dy; const h = e.def.hull;
      if (along < from - h || along > pos + h || Math.abs(rx * dy - ry * dx) > width / 2 + h) continue;
      seen.add(e); fn(e);
    }
    if (pos < length) w.after(w.dt, run); else if (done) done();
  };
  run();
}

// ================================================================ Arc Warden
// the Scepter silence: present while the target is alone, gone together with Flux (the game's modifier_arc_warden_flux_alone)
debuff('modifier_arc_warden_flux_alone', { multi: 'perCaster', state: ['SILENCE'], statusResist: false, purge: 'none' });
const fluxAlone = (t, r) => { const us = t.world.units; for (let i = 0; i < us.length; i++) { const o = us[i]; if (o !== t && o.alive && o.team === t.team && !o.isBuilding && o.st[ST.OUT] === 0 && t.distTo(o) <= r) return false; } return true; };
// [L] measured in Hero Demo: Flux deals damage_per_second x think_interval when it is applied, every think_interval after that and
// once more at the moment it expires (duration 6 = 13 instances)
function fluxTick(m) {
  const t = m.parent; if (!t.alive) return;
  const alone = fluxAlone(t, m.v('search_radius'));
  const sm = t.findModifier('modifier_arc_warden_flux_alone', m.caster);
  if (alone && m.v('applies_silence') > 0) { if (!sm) t.addModifier('modifier_arc_warden_flux_alone', { caster: m.caster, ability: m.ability }); } else if (sm) sm.remove();
  if (alone) mhit(m, t, m.v('damage_per_second') * m.v('think_interval'), MAGICAL);
}
debuff('modifier_arc_warden_flux', {
  multi: 'perCaster', interval: (m) => m.v('think_interval'),
  stats: (m) => ({ msPct: -m.v('move_speed_slow_pct') }),
  onCreated: fluxTick, onThink: fluxTick,
  onDestroy(m, expired) { if (expired) fluxTick(m); const sm = m.parent.findModifier('modifier_arc_warden_flux_alone', m.caster); if (sm) sm.remove(); },
});
defAbility('arc_warden_flux', {
  prio: 55, fid: 'full', note: 'the slow always applies, damage (and the Scepter silence) only while no other unit of the target\'s team is within search_radius, checked when applied, every think_interval and when it expires; Flux from different casters (Arc Warden and his Tempest Double) stacks',
  ai: (ab, u, t) => (t && !immune(t) && !t.findModifier('modifier_arc_warden_flux', u) ? { target: t } : null),
  cast(ab, t) { addMod(ab, t, 'modifier_arc_warden_flux', ab.v('duration')); },
});
// the buff remembers every field its carrier stands in: { x, y, r, end }
buff('modifier_arc_warden_magnetic_field_buff', {
  purge: 'none', stats: (m) => ({ as: m.v('attack_speed_bonus') }),
  onRefresh(m, o) { if (o && o.data) for (const f of o.data.fields) if (!m.data.fields.includes(f)) m.data.fields.push(f); },
  onPreAttacked(m, rec) {
    const u = m.parent; const a = rec.attacker; const w = u.world; const fs = m.data.fields;
    if (rec.trueStrike || a.st[ST.TRUESTRIKE] > 0 || a.team === u.team) return;
    for (let i = fs.length - 1; i >= 0; i--) {
      const f = fs[i];
      if (f.end < w.time) { fs.splice(i, 1); continue; }
      if (hyp(u.x - f.x, u.y - f.y) <= f.r && hyp(a.x - f.x, a.y - f.y) > f.r && m.roll(m.v('evasion_chance'))) {
        rec.cancel = true; rec.missed = true; a.mMisses++;
        if (w.log) w.logEvent('miss', a, u, m.ability.name, 0);
        return;
      }
    }
  },
});
defAbility('arc_warden_magnetic_field', {
  prio: 75, fid: 'approx', note: 'cast on Arc Warden\'s own position when a fight starts; attacks from attackers standing outside the field are evaded when they land (True Strike goes through; no on-miss hooks fire); rune pulling has no effect in the sandbox',
  ai: (ab, u, t) => (t && !u.hasModifier('modifier_arc_warden_magnetic_field_buff') && u.rangeTo(t) <= Math.max(u.attackRange, t.attackRange) + 150 ? { x: u.x, y: u.y } : null),
  cast(ab, t, x, y) {
    const u = ab.owner; const f = { x, y, r: ab.v('radius'), end: u.world.time + ab.v('duration') };
    zone(ab, x, y, { radius: 'radius', duration: 'duration', interval: 0.25, allies: true, tick: (a) => { if (a.isBuilding && !(ab.v('affects_buildings') > 0)) return; a.addModifier('modifier_arc_warden_magnetic_field_buff', { caster: u, ability: ab, duration: 0.3, data: { fields: [f] } }); } });
  },
});
debuff('modifier_arc_warden_spark_wraith_slow', { stats: (m) => ({ msPct: -m.v('move_speed_slow_pct') }) });
defAbility('arc_warden_spark_wraith', {
  prio: 45, fid: 'approx', note: 'placed where the target is expected to be once the wraith has materialized; it then checks its radius every think_interval and flies to the closest enemy (damage + slow); a wraith whose target dies while it is in flight is lost',
  ai: (ab, u, t) => {
    if (!t) return null;
    const d = u.distTo(t); if (d > ab.castRange()) return null;
    const lead = Math.max(0, Math.min(t.ms * ab.v('base_activation_delay'), d - (t.attackRange + t.def.hull + u.def.hull)));   // a chasing target walks towards the caster
    const k = d > 0 ? lead / d : 0;
    return { x: t.x + (u.x - t.x) * k, y: t.y + (u.y - t.y) * k };
  },
  cast(ab, t, x, y) {
    const u = ab.owner; const w = u.world; const end = w.time + ab.v('base_activation_delay') + ab.v('duration');
    const seek = () => {
      if (w.time > end + 1e-6) return;
      let best = null; let bd = Infinity;
      for (const e of w.inRadius(x, y, ab.v('radius'), u.team, true)) {
        if (e.isBuilding || immune(e) || !e.targetable() || e.st[ST.INVULN] > 0) continue;
        const d = hyp(e.x - x, e.y - y); if (d < bd) { bd = d; best = e; }
      }
      if (!best) { w.after(ab.v('think_interval'), seek); return; }
      w.projectile({ x, y }, best, ab.v('wraith_speed_base'), (e) => { addMod(ab, e, 'modifier_arc_warden_spark_wraith_slow', ab.v('ministun_duration')); hit(ab, e, ab.v('spark_damage_base'), MAGICAL); });
    };
    w.after(ab.v('base_activation_delay'), seek);
  },
});
passive('arc_warden_runic_infusion', {
  fid: 'approx', note: 'a Power Rune activation is detected by polling (0.25 s) for the sandbox rune buffs (modifier_rune_*) on Arc Warden or his Tempest Double; each one adds a permanent stack; stacks can be preset with the unit option stacks: { arc_warden_runic_infusion: N }',
  interval: 0.25,
  onCreated(m) { m.data = new Map(); },
  stats: (m) => ({ all: m.v('all_attribute_bonus_per_stack') * m.stacks }),
  onThink(m) {
    const u = m.parent; const seen = m.data;
    for (const r of u.mods) {
      if (!r.name.startsWith('modifier_rune_')) continue;
      const prev = seen.get(r.name);
      const fresh = !prev || prev.created !== r.created || r.dieTime > prev.die + 0.2;
      seen.set(r.name, { created: r.created, die: r.dieTime });
      if (!fresh || (r.data && r.data.noInfusion)) continue;
      const home = u.hasModifier('modifier_arc_warden_tempest_double') && u.owner ? u.owner.findModifier('modifier_arc_warden_runic_infusion') : m;   // a Tempest Double feeds the original
      if (home) home.setStacks(home.stacks + m.v('bonus_stacks_per_rune_pickup'));
    }
  },
});
// data.ai: the controller of an uncontrolled double, held back while it is invisible (an idle invisible unit does not acquire targets)
buff('modifier_arc_warden_tempest_double_invis', { purge: 'none', state: ['INVIS'], onAttack(m) { m.remove(); }, onCast(m) { m.remove(); }, onDestroy(m) { if (m.data && m.data.ai && m.parent.alive) m.parent.ai = m.data.ai; } });
// "Fracturing" on the double: m.x = its total lifetime
modifier('modifier_arc_warden_tempest_double', {
  purge: 'none', interval: 0.5,
  stats: (m) => { if (!(m.v('has_debuff') > 0) || !(m.x > 0)) return {}; const k = Math.min(1, (m.parent.world.time - m.created) / m.x); return { msPct: -m.v('max_slow') * k, miss: m.v('max_blind_chance') * k }; },
  onThink(m) { m.parent.dirty = true; },
});
// "except most consumables and items that drop on death" / modifier tooltip: "with the exception of Gem of True Sight and Divine Rapier"
const doubleSkipsItem = (it) => it.def.quality === 'consumable' || it.name === 'item_rapier' || it.name === 'item_gem';
defAbility('arc_warden_tempest_double', {
  prio: 88, fid: 'approx', note: 'the double is a second Arc Warden unit (not an illusion): same level, abilities, talents, Scepter/Shard and items (no consumables, Divine Rapier or Gem), spawned with Arc Warden\'s current health and mana, full damage dealt and taken, controlled by a copy of his controller, damage credited to Arc Warden; it cannot cast Tempest Double or use Refresher Orb; its ability and item cooldowns are its own and carry over from one double to the next (the first double starts with everything ready); simplifications: the fracture slow / miss chance is assumed to grow linearly to the maximum over the lifetime, the Shard runes use the sandbox haste and arcane rune buffs (the invisibility rune only matters with detectAll off), temporary buffs on Arc Warden are not copied',
  ai: (ab, u, t) => (t && !(ab.data && ab.data.alive) && u.distTo(t) <= u.attackRange + ab.castRange() ? { x: u.x, y: u.y + 90 } : null),
  cast(ab, t, x, y) {
    const u = ab.owner; const w = u.world;
    if (u.hasModifier('modifier_arc_warden_tempest_double')) return;                       // a double cannot make doubles
    const prev = ab.data;                                                                  // the previous double keeps its own cooldown state
    if (prev && prev.alive) w.kill(prev, null, null, true);
    const skills = {}; for (const a of u.abilities) skills[a.name] = a.level;
    const d = w.spawn(u.name, u.team, { x, y, level: u.level, skills, ovr: u.ovr || undefined, tag: `${u.tag || u.name}~double${w.nextId}` });
    d.isSummon = true; d.owner = u; d.counts = false; d.attrLevels = u.attrLevels;
    if (u.talents.size) d.setTalents([...u.talents]);
    d.setUpgrades(u.hasScepter, u.hasShard);
    for (const it of u.items) { if (doubleSkipsItem(it)) continue; const n = d.addItem(it.name, { level: it.level, slot: it.slot, attr: it.attr, charges: it.charges }); if (n && it.name === 'item_refresher') n.ai = false; }
    const own = d.findAbility(ab.name); if (own) own.ai = false;
    if (prev) for (const key of ['abilities', 'items']) for (const a of d[key]) {            // "separate item and ability cooldowns": they carry over to the next double
      const o = prev[key].find((x) => x.name === a.name); if (!o) continue;
      a.cdEnd = o.cdEnd;
      if (!a.isItem && a.v('AbilityCharges') > 0) { a.charges = o.charges; a.chargeEnd = o.chargeEnd; }
    }
    const ri = u.findModifier('modifier_arc_warden_runic_infusion'); const dri = d.findModifier('modifier_arc_warden_runic_infusion');
    if (ri && dri) dri.setStacks(ri.stacks);
    const dur = ab.v('duration');
    const fm = d.addModifier('modifier_arc_warden_tempest_double', { caster: u, ability: ab, duration: dur }); if (fm) fm.x = dur;
    // the double of a controlled Arc Warden gets a copy of his controller; without one it behaves like any unit nobody
    // commands: it attacks what is near, casts nothing and, while invisible, does not attack at all [L]
    const s = u.ai;
    if (w.makeAI) { d.ai = w.makeAI(s ? { mode: s.mode, focus: s.focus, abilities: s.abilities, items: s.items, order: s.order, retarget: s.retarget } : 'attack'); if (s && s.fixedTarget) d.ai.fixedTarget = s.fixedTarget; }
    const rd = ab.v('rune_duration');
    if (rd > 0) {
      if (ab.v('haste_rune') > 0) d.addModifier('modifier_rune_haste', { duration: rd, data: { noInfusion: true } });
      if (ab.v('arcane_rune') > 0) d.addModifier('modifier_rune_arcane', { duration: rd, data: { noInfusion: true } });
      if (ab.v('invis_rune') > 0) { const held = s ? null : d.ai; if (held) d.ai = null; d.addModifier('modifier_arc_warden_tempest_double_invis', { ability: ab, duration: rd, data: { ai: held } }); }
    }
    d.recompute(); d.hp = Math.max(1, Math.min(d.maxHp, u.hp)); d.mana = Math.min(d.maxMana, u.mana);
    d.lifeEnd = w.time + dur;
    ab.data = d;
  },
});

// ================================================================ Phoenix
// Health costs: label "%HP COST"; taken as a percentage of current health that cannot kill (the tooltip does not name the base).
const phoenixCost = (ab, pct) => { const u = ab.owner; if (pct > 0 && u.hp > 1) u.world.damage(u, u, u.hp * pct / 100, PURE, F_HP_LOSS | F_NON_LETHAL, ab); };
dpsDebuff('modifier_phoenix_icarus_dive_burn', { interval: (m) => m.v('burn_tick_interval'), dps: 'damage_per_second', type: MAGICAL, stats: (m) => ({ msPct: -m.v('slow_movement_speed_pct') }) });
// data: { x0, y0, ux, uy, L, W, T }  Phoenix flies an ellipse of length L and width W in T seconds and ends where it started
// [L] measured in Hero Demo: no root / disarm state during the dive (the flight path is forced every tick)
modifier('modifier_phoenix_icarus_dive', {
  purge: 'none', interval: (m) => m.parent.world.dt, thinkNow: true,
  onThink(m) {
    const u = m.parent; const w = u.world; const d = m.data;
    const th = 2 * Math.PI * Math.min(1, (w.time - m.created) / d.T);
    const fx = d.L / 2 * (1 - Math.cos(th)); const fy = d.W / 2 * Math.sin(th);
    u.x = d.x0 + d.ux * fx - d.uy * fy; u.y = d.y0 + d.uy * fx + d.ux * fy;
    for (const e of w.enemiesInRadius(u, u.x, u.y, m.v('hit_radius'))) if (!e.isBuilding) e.addModifier('modifier_phoenix_icarus_dive_burn', { caster: u, ability: m.ability, duration: m.v('burn_duration') });
  },
  onDestroy(m, expired) { if (expired && m.parent.alive) { m.parent.x = m.data.x0; m.parent.y = m.data.y0; } },
});
defAbility('phoenix_icarus_dive', {
  prio: 56, fid: 'approx', note: 'Phoenix flies an ellipse (dash_length x dash_width) in dive_duration and returns to its start; the arc is aimed so that it passes over the target; enemies within hit_radius of Phoenix are burned and slowed; health cost taken as % of current health; the dive is not stopped by disables and is never cancelled early (except by Supernova)',
  ai: (ab, u, t) => (t && frac(u) > 0.3 && !u.hasModifier('modifier_phoenix_icarus_dive') && !u.hasModifier('modifier_phoenix_sun_ray') && !t.hasModifier('modifier_phoenix_icarus_dive_burn') && u.distTo(t) <= ab.v('dash_length') + ab.v('hit_radius') / 2 ? { x: t.x, y: t.y } : null),
  cast(ab, t, x, y) {
    const u = ab.owner; const L = ab.v('dash_length'); const W = ab.v('dash_width');
    const D = hyp(x - u.x, y - u.y); let ang = D > 1 ? Math.atan2(y - u.y, x - u.x) : 0;
    const A = L * L / 4; const B = W * W / 4;
    if (D > 1 && D < L && A > B) {             // rotate the aim so that the outgoing half of the ellipse passes through the point
      const s = (-B + Math.sqrt(B * B + (A - B) * D * D)) / (A - B); const c = Math.max(-1, Math.min(1, 1 - s));
      ang -= Math.atan2(W / 2 * Math.sqrt(1 - c * c), L / 2 * (1 - c));
    }
    phoenixCost(ab, ab.v('hp_cost_perc'));
    u.addModifier('modifier_phoenix_icarus_dive', { ability: ab, duration: ab.v('dive_duration'), data: { x0: u.x, y0: u.y, ux: Math.cos(ang), uy: Math.sin(ang), L, W, T: ab.v('dive_duration') } });
  },
});
na('phoenix_icarus_dive_stop', 'cancels the dive early; the dive always runs its full course here');
buff('modifier_phoenix_fire_spirits', { purge: 'none' });                 // stacks = spirits left
dpsDebuff('modifier_phoenix_fire_spirits_burn', { interval: (m) => m.v('tick_interval'), dps: 'damage_per_second', type: MAGICAL, stats: (m) => ({ asSlow: -Math.abs(m.v('attackspeed_slow')) }) });
defAbility('phoenix_fire_spirits', {
  prio: 62, fid: 'approx', note: 'summons spirit_count spirits (the data value is 5, the tooltip text says 4) that are launched one at a time with Launch Fire Spirit; health cost taken as % of current health; the Shard line in the tooltip (passive, charge based) has no values and no Shard flag in the data and is not modelled',
  ai: (ab, u, t) => (t && frac(u) > 0.3 && !u.hasModifier('modifier_phoenix_fire_spirits') && u.distTo(t) <= ab.castRange() ? SELF : null),
  cast(ab) {
    const u = ab.owner; const l = u.findAbility('phoenix_launch_fire_spirit');
    if (l && l.level !== ab.level) l.setLevel(ab.level);                  // the launch sub-ability follows Fire Spirits
    phoenixCost(ab, ab.v('hp_cost_perc'));
    const m = addMod(ab, u, 'modifier_phoenix_fire_spirits', ab.v('spirit_duration')); if (m) m.setStacks(ab.v('spirit_count'));
  },
});
defAbility('phoenix_launch_fire_spirit', {
  prio: 61, fid: 'approx', note: 'one spirit per cast while Fire Spirits is active, sent at the target when it is not already burning; the flight is a delay of distance / spirit_speed; values are read from Fire Spirits',
  ai: (ab, u, t, w) => { const m = u.findModifier('modifier_phoenix_fire_spirits'); return t && m && m.stacks > 0 && !(ab.data > w.time) && !t.hasModifier('modifier_phoenix_fire_spirits_burn') && u.distTo(t) <= ab.castRange() ? { x: t.x, y: t.y } : null; },
  cast(ab, t, x, y) {
    const u = ab.owner; const w = u.world; const m = u.findModifier('modifier_phoenix_fire_spirits'); const fs = u.findAbility('phoenix_fire_spirits');
    if (!m || m.stacks < 1 || !fs) return;
    if (m.stacks <= 1) m.remove(); else m.setStacks(m.stacks - 1);
    const delay = hyp(x - u.x, y - u.y) / fs.v('spirit_speed'); ab.data = w.time + delay;
    w.after(delay, () => {
      if (w.skillshotHit < 1 && !w.rng.chance(w.skillshotHit)) return;
      for (const e of enemiesNear(fs, x, y, fs.v('radius'))) if (!e.isBuilding) addMod(fs, e, 'modifier_phoenix_fire_spirits_burn', fs.v('duration'));
    });
  },
});
// m.z = beam direction (radians), m.y = ticks done, m.data = { x, y } where Phoenix stands.
// [L] measured in Hero Demo: Phoenix is disarmed and stands still (speed 0, not rooted); every tick deals
// (base_damage + hp_perc_damage % of max health) x tick_interval x (1 + ticks done x tick_interval / duration), i.e. the damage grows
// linearly to twice its listed value; the health cost (hp_cost_perc_per_second % of current health) is health removal, not damage.
modifier('modifier_phoenix_sun_ray', {
  purge: 'none', state: ['DISARM'], interval: (m) => m.v('tick_interval'),
  onCreated(m) { m.data = { x: m.parent.x, y: m.parent.y }; },
  onThink(m) {
    const u = m.parent; const w = u.world; const ab = m.ability; const st = u.st; const tick = m.v('tick_interval');
    if (st[ST.STUN] > 0 || st[ST.SILENCE] > 0 || st[ST.HEX] > 0 || st[ST.SLEEP] > 0) { m.remove(); return; }
    u.x = m.data.x; u.y = m.data.y;
    const t = foe(u);
    if (t) { let diff = Math.atan2(t.y - u.y, t.x - u.x) - m.z; diff = Math.atan2(Math.sin(diff), Math.cos(diff)); const turn = m.v('turn_rate') * Math.PI / 180 * tick; m.z += Math.max(-turn, Math.min(turn, diff)); }
    if (u.hp > 1) u.hp = Math.max(1, u.hp * (1 - m.v('hp_cost_perc_per_second') * tick / 100));
    m.y++; const k = 1 + m.y * tick / m.v('AbilityDuration');
    const len = ab.castRange(); const x2 = u.x + Math.cos(m.z) * len; const y2 = u.y + Math.sin(m.z) * len;
    for (const e of unitsInLine(w, u.x, u.y, x2, y2, m.v('radius'), (o) => o !== u && !o.isBuilding && !o.hasModifier('modifier_phoenix_supernova_sun'))) {
      if (e.team === u.team) e.heal((m.v('base_heal') + e.maxHp * m.v('hp_perc_heal') / 100) * tick * k, u, ab);
      else mhit(m, e, (m.v('base_damage') + e.maxHp * m.v('hp_perc_damage') / 100) * tick * k, MAGICAL);
    }
  },
});
const sunRayStart = (ab, x, y) => { const u = ab.owner; const m = u.addModifier('modifier_phoenix_sun_ray', { ability: ab, duration: ab.v('AbilityDuration') }); if (m) m.z = Math.atan2(y - u.y, x - u.x); };
defAbility('phoenix_sun_ray', {
  prio: 50, fid: 'approx', note: 'beam of cast-range length and `radius` width from Phoenix, ticking every tick_interval; damage and heal grow linearly from 1x to 2x over the duration (measured live; the heal ramp is assumed to be the same); the beam follows the current target at turn_rate degrees per second (unit assumed); Phoenix stands still and cannot attack while firing; health cost taken as % of current health (health removal); Shard: fired automatically from the sun during Supernova when it is ready',
  ai: (ab, u, t) => (t && frac(u) > 0.35 && !u.hasModifier('modifier_phoenix_sun_ray') && !u.hasModifier('modifier_phoenix_icarus_dive') && u.distTo(t) <= ab.castRange() - 100 ? { x: t.x, y: t.y } : null),
  cast(ab, t, x, y) { sunRayStart(ab, x, y); },
});
na('phoenix_sun_ray_toggle_move', 'toggles slow forward movement during Sun Ray; Phoenix stays in place while firing');
na('phoenix_sun_ray_stop', 'stops Sun Ray early; the ray always runs until it ends or is interrupted');
// [L] measured in Hero Demo: an aura (only while Phoenix is missing health) that keeps a burn on enemies within radius; the burn
// lingers 0.5 s and deals damage_pct % of Phoenix's missing health x tick_interval every tick_interval from the moment it was applied
debuff('modifier_phoenix_dying_light_debuff', { purge: 'none', statusResist: false, interval: (m) => m.v('tick_interval'),
  onThink(m) { const c = m.caster; const miss = c.maxHp - c.hp; if (miss > 0 && c.alive) mhit(m, m.parent, miss * m.v('damage_pct') / 100 * m.v('tick_interval'), MAGICAL); } });
passive('phoenix_dying_light', {
  fid: 'full', note: 'aura while Phoenix is missing health; the burn lingers 0.5 s and ticks on its own clock (measured live)', interval: (m) => m.parent.world.dt,
  onThink(m) { const u = m.parent; if (u.hp >= u.maxHp - 1e-6) return; for (const e of u.world.enemiesInRadius(u, u.x, u.y, m.v('radius'))) if (!e.isBuilding) e.addModifier('modifier_phoenix_dying_light_debuff', { caster: u, ability: m.ability, duration: SUN_LINGER }); },
});
// Pip health (tooltip: "Creeps and illusions deal 25% damage to the sun"; shipped 7.42 notes: hero attacks remove 1 pip, creep and illusion attacks 1/4).
const PIP_FULL = 1; const PIP_QUARTER = 0.25;
// on the sun: data = { inside: [units reborn with it] }
modifier('modifier_phoenix_supernova_sun', {
  purge: 'none',
  postMit(m, d) { const s = d.src; d.amount = s && (d.flags & F_ATTACK) && !(d.flags & F_SECONDARY) ? ((s.isHero && !s.isIllusion) || s.isBuilding || s.name === 'npc_dota_roshan' ? PIP_FULL : PIP_QUARTER) : 0; },
  onDeath(m, ev) { const w = m.parent.world; for (const h of m.data.inside) { if (!h.alive) continue; h.removeModifierByName('modifier_phoenix_supernova_hiding'); w.kill(h, ev.killer, m.ability); } },
});
// [L] measured in Hero Demo: the sun is an aura that keeps a burn on enemies in aura_radius; the burn lingers 0.5 s after the
// sun is gone and deals damage_per_sec x tick_interval every tick_interval from the moment it was applied (6 s = 32 instances)
const SUN_LINGER = 0.5;
debuff('modifier_phoenix_sun_debuff', { purge: 'none', statusResist: false, interval: (m) => m.v('tick_interval'), onThink(m) { mhit(m, m.parent, m.v('damage_per_sec') * m.v('tick_interval'), MAGICAL); } });
const sunBurn = (m) => { const u = m.parent; const d = m.data; for (const e of u.world.enemiesInRadius(u, d.egg.x, d.egg.y, m.v('aura_radius'))) if (!e.isBuilding) e.addModifier('modifier_phoenix_sun_debuff', { caster: u, ability: m.ability, duration: SUN_LINGER }); };
// on Phoenix (and the Scepter ally): data = { egg, primary }; live states inside the sun: out of game, invulnerable, rooted,
// disarmed, muted, invisible, ethereal
modifier('modifier_phoenix_supernova_hiding', {
  purge: 'none', state: ['OUT', 'INVULN', 'ROOT', 'DISARM', 'MUTE', 'INVIS', 'ETHEREAL'], interval: (m) => m.parent.world.dt,
  onCreated(m) { if (m.data.primary) sunBurn(m); },
  onThink(m) {
    const d = m.data; if (!d.primary) return;
    const u = m.parent; const w = u.world;
    sunBurn(m);
    const sr = u.hasShard ? u.findAbility('phoenix_sun_ray') : null;              // Shard: Sun Ray may be cast during Supernova
    if (sr && sr.level > 0 && sr.ready() && !u.hasModifier('modifier_phoenix_sun_ray')) {
      const t = w.nearestEnemy(u, sr.castRange());
      if (t) { if (!w.freeSpells) u.mana = Math.max(0, u.mana - sr.manaCost()); sr.startCooldown(); if (w.log) w.logEvent('cast', u, null, sr.name, 0); sunRayStart(sr, t.x, t.y); }
    }
  },
  onDestroy(m, expired) {
    const u = m.parent; const d = m.data; const w = u.world; const ab = m.ability;
    if (!expired || !u.alive) return;
    if (d.primary) {
      for (const e of w.enemiesInRadius(u, d.egg.x, d.egg.y, m.v('aura_radius'))) { if (e.isBuilding) continue; if (e.alive) stun(ab, e, m.v('stun_duration')); }
      if (d.egg.alive) w.kill(d.egg, null, null, true);
    }
    u.recompute(); u.hp = u.maxHp; u.mana = u.maxMana;                            // reborn: full health and mana, abilities refreshed
    for (const a of u.abilities) { if (a.name === 'phoenix_supernova') continue; a.cdEnd = 0; if (a.v('AbilityCharges') > 0) a.charges = a.v('AbilityCharges'); }
  },
});
defAbility('phoenix_supernova', {
  prio: 95, fid: 'approx', note: 'the sun is a summoned unit with pip health: an attack of a hero removes 1 pip, of a creep or illusion 1/4 (tooltip-only number, also in the 7.42 notes), spells do nothing to it; Phoenix is out of play inside it and dies if the sun is destroyed; on the explosion every ability except Supernova itself is refreshed; cast below 40% health with an enemy in burn range; Scepter: cast on a wounded allied hero in range when there is one (the engine walks to the base 450 cast range, the Scepter tooltip value says 500)',
  ai: (ab, u, t, w) => {
    if (!t || frac(u) > 0.4 || u.distTo(t) > ab.v('aura_radius')) return null;
    if (u.hasScepter) {
      let best = null;
      for (const a of w.units) if (a !== u && a.alive && a.team === u.team && a.isHero && !a.isIllusion && a.st[ST.OUT] === 0 && u.distTo(a) <= ab.v('cast_range_tooltip_scepter') && frac(a) < 0.5 && (!best || frac(a) < frac(best))) best = a;
      if (best) return { target: best };
      return { target: u };                                                       // with the Scepter it is a unit-target spell: on himself
    }
    return SELF;
  },
  cast(ab, t) {
    const u = ab.owner; const sc = u.hasScepter;
    // with the Scepter Supernova is a unit-target spell: an order without a target is not carried out in the game
    if (sc && !t) { if (!u.world.freeSpells) u.mana = Math.min(u.maxMana, u.mana + ab.manaCost()); ab.cdEnd = 0; return; }
    u.removeModifierByName('modifier_phoenix_icarus_dive');
    if (!u.hasShard) u.removeModifierByName('modifier_phoenix_sun_ray');
    const inside = [u]; if (sc && t && t !== u && t.alive && t.team === u.team && t.isHero) inside.push(t);
    const egg = summon(ab, 'npc_dota_phoenix_sun', { x: u.x, y: u.y, ovr: { hp: sc ? ab.v('max_hero_attacks_scepter') : ab.v('max_hero_attacks') } });
    egg.ai = null;
    egg.addModifier('modifier_phoenix_supernova_sun', { caster: u, ability: ab, data: { inside } });
    for (const h of inside) {
      h.purge({ debuffs: true, strong: true });
      h.stop(); h.x = u.x; h.y = u.y;
      h.addModifier('modifier_phoenix_supernova_hiding', { caster: u, ability: ab, duration: ab.v('AbilityDuration'), data: { egg, primary: h === u } });
    }
  },
});

// ================================================================ Enchantress
passive('enchantress_impetus', {
  fid: 'full', note: 'autocast assumed on: every attack while off cooldown, with enough mana, not silenced and against a target that is not debuff immune',
  onAttack(m, rec) {
    const u = m.parent; const ab = m.ability; const t = rec.target;
    if (rec.secondary || t.isBuilding || immune(t)) return;
    if (!(rec.fromAbility && rec.fromAbility.name === 'enchantress_bunny_hop')) {       // Sproink attacks are always Impetus attacks
      if (!ab.cdReady() || u.isSilenced()) return;
      if (!u.world.freeSpells) { const c = ab.manaCost(); if (u.mana < c) return; u.mana -= c; }
      ab.startCooldown();
    }
    (rec.data ||= {}).impetus = m;
  },
  onAttackLanded(m, rec) {
    const t = rec.target;
    if (!(rec.data && rec.data.impetus === m) || !t.alive) return;
    mhit(m, t, Math.min(m.parent.distTo(t), m.v('distance_cap')) * m.v('distance_damage_pct') / 100 * (t.isIllusion ? m.v('illusion_damage_multiplier') : 1), PURE);
  },
});
debuff('modifier_enchantress_enchant_slow', { stats: (m) => ({ msPct: -Math.abs(m.v('slow_movement_speed')) }) });
// on Enchantress and her units while a hero is enchanted: bonus range against that hero
// [L] measured in Hero Demo: the bonus is not part of her attack range while she is not attacking the enchanted hero
const ORDER_ATTACK = 1;                        // the engine's attack order code
modifier('modifier_enchantress_enchant_range', { hidden: true, purge: 'none', dynamic: true, stats: (m) => { const t = m.parent.orderTarget; return m.parent.order === ORDER_ATTACK && t && t.alive && t.findModifier('modifier_enchantress_enchant_slow', m.caster) ? { attackRange: m.v('attack_range_bonus') } : {}; } });
const enchantTalents = (m) => ({ hp: m.v('bonus_health'), dmg: m.v('bonus_damage'), armor: m.v('bonus_armor'), as: m.v('bonus_attackspeed') });   // "... for Enchantress and her units" talents
modifier('modifier_enchantress_enchant', { hidden: true, stats: enchantTalents });
modifier('modifier_enchantress_enchant_controlled', { purge: 'none', stats: (m) => { const o = enchantTalents(m); o.hp += m.v('enchant_health'); o.dmg += m.v('enchant_damage'); return o; } });
const enchantCreep = (ab, t) => !t.heroLike && !t.isBuilding && t.canAttack && !t.def.ancient && t.level <= ab.v('level_req');
function enchantConvert(ab, c) {
  const u = ab.owner; const w = u.world;
  for (const o of w.units) {                                  // nobody keeps fighting a unit that changed sides
    if (o === c) continue;
    if (o.ai) { if (o.ai.target === c) o.ai.target = null; if (o.ai.fixedTarget === c) o.ai.fixedTarget = null; }
    if (o.orderTarget === c) o.stop();
  }
  // if this was the last unit that counted for its team, tell the scenario so that it re-checks the win condition
  if (c.counts && w.onDeath && !w.units.some((o) => o !== c && o.alive && o.counts && o.team === c.team)) w.onDeath(c, u);
  c.stop(); c.team = u.team; c.owner = u; c.isSummon = true; c.counts = false;
  if (c.ai) { c.ai.target = null; c.ai.fixedTarget = null; } else if (w.makeAI) c.ai = w.makeAI('fight');
  c.addModifier('modifier_enchantress_enchant_controlled', { caster: u, ability: ab });
  c.lifeEnd = Math.min(c.lifeEnd, w.time + ab.v('dominate_duration'));
  const list = (ab.data || []).filter((x) => x.alive && x.owner === u && x !== c); list.push(c);
  while (list.length > ab.v('max_creeps')) w.kill(list.shift(), null, null, true);
  ab.data = list;
}
defAbility('enchantress_enchant', {
  mods: ['modifier_enchantress_enchant'], prio: 60, fid: 'approx', note: 'heroes: basic dispel of buffs, slow, and bonus attack range for Enchantress and her units while that hero is their order target; creeps (non-ancient, non-hero units up to level_req) and illusions change sides, get the creep bonuses and die when dominate_duration ends; beyond max_creeps the oldest one dies; experience share not modelled',
  ai: (ab, u, t) => { if (!t || immune(t)) return null; if (t.isIllusion || enchantCreep(ab, t)) return { target: t }; return t.heroLike && !t.hasModifier('modifier_enchantress_enchant_slow') ? { target: t } : null; },
  cast(ab, t) {
    const u = ab.owner;
    if (t.isIllusion || enchantCreep(ab, t)) { enchantConvert(ab, t); return; }
    if (!t.heroLike) return;
    t.purge({ debuffs: false, buffs: true });
    const sm = addMod(ab, t, 'modifier_enchantress_enchant_slow', ab.v('slow_duration'));
    if (!sm) return;
    const left = sm.remaining();
    for (const a of [u, ...(ab.data || [])]) if (a.alive) addMod(ab, a, 'modifier_enchantress_enchant_range', left);
  },
});
buff('modifier_enchantress_natures_attendants', {
  purge: 'none', interval: (m) => m.v('heal_interval'), stats: (m) => ({ ms: m.v('movespeed') }),
  onThink(m) {
    const u = m.parent; const w = u.world; const per = m.v('heal') * m.v('heal_interval');
    const pool = w.inRadius(u.x, u.y, m.v('radius'), u.team, false).filter((a) => !a.isBuilding && a.hp < a.maxHp - 1e-6);
    for (let i = m.v('wisp_count'); i > 0 && pool.length; i--) {
      const k = w.rng.int(0, pool.length - 1); const a = pool[k];
      a.heal(per, u, m.ability);
      if (a.hp >= a.maxHp - 1e-6) pool.splice(k, 1);
    }
  },
});
const ATTENDANTS_EXTRA = 0.5;                  // [L] measured in Hero Demo: the wisps stay heal_duration + 0.5 s (13 -> 13.5)
defAbility('enchantress_natures_attendants', {
  prio: 40, fid: 'approx', note: 'label "HEAL PER SECOND" is taken per wisp: every heal_interval each of the wisp_count wisps heals one random friendly unit in the radius that is not at full health',
  ai: (ab, u, t, w) => { if (u.hasModifier('modifier_enchantress_natures_attendants')) return null; if (frac(u) < 0.65) return SELF; for (const a of w.inRadius(u.x, u.y, ab.v('radius'), u.team, false)) if (a.isHero && !a.isIllusion && frac(a) < 0.5) return SELF; return null; },
  cast(ab) { addMod(ab, ab.owner, 'modifier_enchantress_natures_attendants', ab.v('heal_duration') + ATTENDANTS_EXTRA); },
});
defAbility('enchantress_bunny_hop', {
  prio: 65, fid: 'approx', note: 'used when an enemy has come within 350 units (AI assumption): a leap of hop_distance directly away from the current target (one step), then on landing Impetus attacks at the attack_targets furthest enemies in attack range + bonus; the dodge removes attack and spell projectiles that are in flight towards her',
  ai: (ab, u, t) => (t && u.distTo(t) <= 350 ? SELF : null),
  cast(ab) {
    const u = ab.owner; const w = u.world;
    const ps = w.projectiles; if (Array.isArray(ps)) for (let i = ps.length - 1; i >= 0; i--) if (ps[i].target === u) ps.splice(i, 1);   // disjoint (the engine has no API for it)
    const t = foe(u); if (t) knockback(u, t.x, t.y, ab.v('hop_distance'));
    // [L] measured in Hero Demo: the Impetus attacks leave when she lands (hop_duration), from the landing point
    w.after(Math.max(0, ab.v('hop_duration') - w.dt), () => {
      if (!u.alive) return;
      const reach = u.attackRange + ab.v('bonus_attack_range') + u.def.hull;
      const es = []; for (const e of w.units) if (e.alive && e.team !== u.team && !e.isBuilding && e.attackableBy(u) && u.distTo(e) <= reach + e.def.hull) es.push(e);
      es.sort((a, b) => u.distTo(b) - u.distTo(a));
      for (const e of es.slice(0, ab.v('attack_targets'))) w.launchAttack(u, e, { fromAbility: ab });
    });
  },
});
// creeps of every team attack the rooted unit: TAUNT makes the engine attack the modifier's caster, which is the victim here
modifier('modifier_enchantress_little_friends', { purge: 'none', state: ['TAUNT'], stats: (m) => ({ as: m.v('bonus_attack_speed'), msPct: m.v('bonus_move_speed') }) });
defAbility('enchantress_little_friends', {
  prio: 70, fid: 'full', note: 'creeps = every non-hero unit that can attack, of any team, within the radius of the target',
  ai: (ab, u, t) => (t && t.heroLike && !immune(t) && !(t.st[ST.ROOT] > 0) ? { target: t } : null),
  cast(ab, t) {
    const u = ab.owner; const w = u.world; let n = 0;
    for (const c of w.units) {
      if (!c.alive || c === t || c.heroLike || c.isBuilding || !c.canAttack || c.st[ST.OUT] > 0 || c.distTo(t) > ab.v('radius')) continue;
      n++; c.addModifier('modifier_enchantress_little_friends', { caster: t, ability: ab, duration: ab.v('duration') });
    }
    addMod(ab, t, 'modifier_rooted', Math.min(ab.v('max_root'), ab.v('root_base_duration') + ab.v('root_per_target') * n));
  },
});
debuff('modifier_enchantress_untouchable_slow', { pierce: true, stats: (m) => ({ asSlow: -Math.abs(m.v('slow_attack_speed')) }) });
passive('enchantress_untouchable', {
  fid: 'approx', note: 'there is no hook for "an attack against me starts": enemies winding up an attack on Enchantress are found by polling every 0.05 s and the running attack is re-timed with the slowed attack speed',
  interval: 0.05,
  onThink(m) {
    const u = m.parent; const us = u.world.units;
    for (let i = 0; i < us.length; i++) {
      const a = us[i];
      if (!a.alive || a.team === u.team || !a.winding || a.attackTarget !== u) continue;
      const had = a.hasModifier('modifier_enchantress_untouchable_slow');
      const d = a.addModifier('modifier_enchantress_untouchable_slow', { caster: u, ability: m.ability, duration: m.v('slow_duration') });
      if (d && !had) { a.recompute(); a.hitTime = a.attackStart + a.attackPoint; a.nextAttackTime = a.attackStart + a.attackInterval; }
    }
  },
});
modifier('modifier_enchantress_rabblerouser_buff', { hidden: true, purge: 'none', outgoing(m, d) { const t = d.dst; if (t.isHero && t.team !== m.caster.team && !(d.flags & F_HP_LOSS)) d.amount *= 1 + m.v('damage_amp') / 100; } });
passive('enchantress_rabblerouser', {
  fid: 'approx', note: 'map-wide: unowned neutral creeps (not Roshan) and every unit under Enchantress\'s control deal damage_amp % more damage to heroes that are her enemies; refreshed once per second',
  interval: 1, thinkNow: true,
  onThink(m) { const u = m.parent; for (const o of u.world.units) if (o.alive && o !== u && (o.owner === u || (o.def.neutral === 1 && !o.owner))) o.addModifier('modifier_enchantress_rabblerouser_buff', { caster: u, ability: m.ability, duration: 1.5 }); },
});

// ================================================================ Broodmother
const AURA_LINGER = 0.5;                       // [L] measured in Hero Demo: an aura's effect stays 0.5 s after the aura is gone
modifier('modifier_broodmother_insatiable_hunger_spider', { purge: 'none', stats: (m) => ({ lifesteal: m.v('lifesteal_pct') }) });
// the bonus itself is the aura's effect on Broodmother (stacks = Shard steps)
buff('modifier_broodmother_insatiable_hunger', {
  purge: 'none',
  stats: (m) => { const b = m.v('bat_bonus'); return { dmgBasePct: m.v('bonus_damage') + m.v('shard_damage_per_tick') * m.stacks, lifesteal: m.v('lifesteal_pct'), bat: b > 0 ? m.parent.def.bat - b : 0 }; },
});
const hungerSteps = (m) => { const iv = m.v('shard_damage_tick_interval'); const b = m.parent.findModifier('modifier_broodmother_insatiable_hunger'); if (iv > 0 && b) b.setStacks(Math.floor((m.parent.world.time - m.created + 1e-6) / iv)); };
buff('modifier_broodmother_insatiable_hunger_aura', {
  purge: 'none', interval: 0.25, thinkNow: true,
  onCreated(m) { const b = m.parent.addModifier('modifier_broodmother_insatiable_hunger', { ability: m.ability }); if (b) { b.dieTime = Infinity; b.setStacks(0); } },
  onRefresh(m) { m.created = m.parent.world.time; const b = m.parent.addModifier('modifier_broodmother_insatiable_hunger', { ability: m.ability }); if (b) { b.dieTime = Infinity; b.setStacks(0); } },
  onThink(m) {
    const u = m.parent; const w = u.world;
    hungerSteps(m);                                                                  // Shard: the bonus grows every interval
    for (const a of w.inRadius(u.x, u.y, m.v('aura_radius'), u.team, false)) if (a.owner === u && a.canAttack && !a.isIllusion) a.addModifier('modifier_broodmother_insatiable_hunger_spider', { caster: u, ability: m.ability, duration: AURA_LINGER });
  },
  onDestroy(m, expired) { const b = m.parent.findModifier('modifier_broodmother_insatiable_hunger'); if (!b) return; if (expired) hungerSteps(m); b.setDuration(AURA_LINGER); },
});
defAbility('broodmother_insatiable_hunger', {
  prio: 70, fid: 'full', note: 'bonus_damage is a percentage of base attack damage (label); the buff is an aura on Broodmother whose effect (damage, lifesteal, Shard steps including the one at the end) stays 0.5 s after it ends, as in the live game; the spiderling lifesteal is refreshed every 0.25 s',
  ai: (ab, u, t) => (t && !u.hasModifier('modifier_broodmother_insatiable_hunger_aura') && u.rangeTo(t) <= u.attackRange + 100 ? SELF : null),
  cast(ab) { addMod(ab, ab.owner, 'modifier_broodmother_insatiable_hunger_aura', ab.v('duration')); },
});
buff('modifier_broodmother_spin_web_buff', { purge: 'none', stats: (m) => ({ msPct: m.v('bonus_movespeed'), msMax: m.v('break_move_cap') > 0 ? NO_CAP : 0 }) });
// on the web unit: out of play (cannot be hit or counted), buffs Broodmother and her units inside
modifier('modifier_broodmother_spin_web', {
  hidden: true, purge: 'none', state: ['OUT', 'INVULN'], interval: 0.25, thinkNow: true,
  onThink(m) { const web = m.parent; const o = m.caster; for (const a of web.world.inRadius(web.x, web.y, m.v('radius'), web.team, false)) if (a === o || a.owner === o) a.addModifier('modifier_broodmother_spin_web_buff', { caster: o, ability: m.ability, duration: 0.5 }); },
});
defAbility('broodmother_spin_web', {
  prio: 90, fid: 'approx', note: 'a web is a summoned unit that cannot be attacked; Broodmother, her spiders and illusions inside get the movement bonus (and no speed limit with the talent); one web is spun on her own position when she fights outside her webs; turn rate and free pathing have no effect here, webs need not touch, the oldest web disappears above the limit',
  ai: (ab, u, t) => (t && !u.hasModifier('modifier_broodmother_spin_web_buff') && u.distTo(t) <= ab.v('radius') ? { x: u.x, y: u.y } : null),
  cast(ab, t, x, y) {
    const u = ab.owner; const w = u.world;
    const web = summon(ab, 'npc_dota_broodmother_web', { x, y }); web.ai = null;
    web.addModifier('modifier_broodmother_spin_web', { caster: u, ability: ab });
    const list = (ab.data || []).filter((e) => e.alive); list.push(web);
    while (list.length > ab.v('count')) w.kill(list.shift(), null, null, true);
    ab.data = list;
  },
});
na('broodmother_spin_web_destroy', 'manual removal of a web; webs are only removed when the limit is exceeded');
debuff('modifier_broodmother_incapacitating_bite_debuff', {
  stats: (m) => ({ miss: m.v('miss_chance'), msPct: -Math.abs(m.v('bonus_movespeed')) }),
  preMit(m, d) { if ((d.flags & F_ATTACK) && !(d.flags & F_SECONDARY) && d.amount > 0) d.amount += m.v('attack_damage'); },
});
passive('broodmother_incapacitating_bite', {
  fid: 'full', note: 'the attack bonus is added to every attack that hits the bitten unit, before armor',
  onAttackLanded(m, rec) { const t = rec.target; if (t.alive && !t.isBuilding) t.addModifier('modifier_broodmother_incapacitating_bite_debuff', { caster: m.parent, ability: m.ability, duration: m.v('duration') }); },
});
// [L] measured in Hero Demo: a sprung snare first slows its victim to the minimum speed for 0.25 s, then roots it for the rest of
// root_duration; damage_per_second is dealt once per second, the first time when the root starts (3 instances in 3 s)
const SNARE_DELAY = 0.25; const SNARE_TICK = 1;
debuff('modifier_broodmother_sticky_snare_hold', { hidden: true, state: ['ROOT'], statusResist: false, purge: 'none' });
debuff('modifier_broodmother_sticky_snare_root', {
  interval: SNARE_TICK, stats: (m) => (m.z === 0 ? { msPct: -100 } : {}),
  onCreated(m) { m.nextThink = m.parent.world.time + SNARE_DELAY; },
  onThink(m) {
    const t = m.parent;
    if (m.z === 0) { m.z = 1; t.dirty = true; t.addModifier('modifier_broodmother_sticky_snare_hold', { caster: m.caster, ability: m.ability, duration: m.remaining() }); }
    mhit(m, t, m.v('damage_per_second') * SNARE_TICK, MAGICAL);
  },
  onDestroy(m) { m.parent.removeModifierByName('modifier_broodmother_sticky_snare_hold'); },
});
defAbility('broodmother_sticky_snare', {
  prio: 58, fid: 'approx', note: 'a web line of length `width` is laid across the path to the target hero (through its position) when one of her webs covers that spot; after formation_delay the first enemy hero touching or crossing it (checked every 0.1 s) is caught for root_duration (0.25 s at minimum speed, then rooted, with damage once per second, as measured live) together with every other hero on the line at that moment, then the line is gone (the tooltip gives no time for how long a sprung line stays); lines last until sprung, the oldest is removed above `count`; no channel time is modelled (the data lists none)',
  ai: (ab, u, t) => {
    const sw = u.findAbility('broodmother_spin_web');
    if (!t || !t.isHero || immune(t) || t.st[ST.ROOT] > 0 || t.hasModifier('modifier_broodmother_sticky_snare_root') || !sw || !sw.data) return null;
    if (!sw.data.some((web) => web.alive && hyp(web.x - t.x, web.y - t.y) <= sw.v('radius'))) return null;
    if (ab.data && ab.data.some((l) => !l.dead && segDist(t.x, t.y, l.x1, l.y1, l.x2, l.y2) < 100)) return null;      // one line per spot
    return { x: t.x, y: t.y };
  },
  cast(ab, t, x, y) {
    const u = ab.owner; const w = u.world; const [fx, fy] = dirTo(u, { x, y }); const h = ab.v('width') / 2;
    const line = { x1: x - fy * h, y1: y + fx * h, x2: x + fy * h, y2: y - fx * h, dead: false, side: new Map() };
    const list = (ab.data || []).filter((l) => !l.dead); list.push(line);
    while (list.length > ab.v('count')) list.shift().dead = true;
    ab.data = list;
    const poll = () => {
      if (line.dead) return;
      const caught = [];
      for (const e of w.units) {
        if (!e.alive || e.team === u.team || !e.isHero || e.st[ST.OUT] > 0) continue;
        const along = (e.x - line.x1) * fy - (e.y - line.y1) * fx;                               // position along the line (0 .. width)
        const side = (e.x - x) * fx + (e.y - y) * fy;                                             // signed distance from the line
        const prev = line.side.get(e); line.side.set(e, side);
        if (along < -e.def.hull || along > 2 * h + e.def.hull) continue;
        if (Math.abs(side) <= e.def.hull || (prev !== undefined && prev * side < 0)) caught.push(e);
      }
      if (!caught.length) { w.after(0.1, poll); return; }
      line.dead = true;
      for (const e of caught) if (!immune(e)) addMod(ab, e, 'modifier_broodmother_sticky_snare_root', ab.v('root_duration'));
    };
    w.after(ab.v('formation_delay'), poll);
  },
});
modifier('modifier_broodmother_spiders_milk_heal', {
  multi: 'independent', purge: 'none', interval: (m) => m.v('tick_rate'),
  onThink(m) { const u = m.parent; u.heal(m.data.perSec * m.v('tick_rate') * (1 + u.lifestealAmp / 100), m.caster, m.ability, true); },
});
passive('broodmother_spiders_milk', {
  fid: 'full', note: 'the listed percentage of the victim\'s max health is healed per second (in tick_rate steps) and counts as lifesteal (amplified by lifesteal amplification)',
  onAnyDeath(m, ev) {
    const u = m.parent; const v = ev.victim; const k = ev.killer; const r = m.v('kill_heal_aoe');
    if (!k || v.team === u.team || v.isBuilding || !(k === u || (k.owner === u && u.distTo(k) <= r))) return;
    const perSec = v.maxHp * m.v('kill_heal_heroes') / 100 * (v.heroLike ? 1 : 1 - m.v('kill_creeps_penalty') / 100);
    for (const a of u.world.units) if (a.alive && (a === u || a.owner === u) && a.st[ST.OUT] === 0 && a.distTo(v) <= r) a.addModifier('modifier_broodmother_spiders_milk_heal', { caster: u, ability: m.ability, duration: m.v('kill_heal_duration') + 0.02, data: { perSec } });
  },
});
// spiderlings hatch for `brood` (the ultimate's owner); their Poison Sting follows the ultimate's level
function spawnSpiderlings(ult, x, y, n, life) {
  const w = ult.owner.world; const def = w.unitDef('npc_dota_broodmother_spiderling');
  for (let i = 0; i < n; i++) {
    const s = summon(ult, 'npc_dota_broodmother_spiderling', { x: x + 45 * Math.cos(i * 2.4), y: y + 45 * Math.sin(i * 2.4), duration: life,
      ovr: { hp: def.hp + ult.v('hp_bonus'), dmgMin: def.dmgMin + ult.v('damage_bonus'), dmgMax: def.dmgMax + ult.v('damage_bonus') } });
    for (const a of s.abilities) { a.maxLevel = Math.max(a.maxLevel, ult.maxLevel); a.setLevel(Math.max(1, ult.level)); }
  }
}
debuff('modifier_broodmother_spawn_spiderlings', { onDestroy(m) { const t = m.parent; if (!t.alive) spawnSpiderlings(m.ability, t.x, t.y, m.v('count'), m.v('spiderling_duration')); } });
debuff('modifier_broodmother_spawn_spiderlings_slow', { stats: (m) => ({ msPct: -m.v('movement_speed') }) });
defAbility('broodmother_spawn_spiderlings', {
  prio: 80, fid: 'full', note: 'spiderlings are summoned units (unit health + hp_bonus, unit damage + damage_bonus) with Poison Sting and Spawn Spiderling at the ultimate\'s level; they hatch around the corpse',
  cast(ab, t) {
    const u = ab.owner;
    u.world.projectile(u, t, ab.v('projectile_speed'), (tt) => {
      addMod(ab, tt, 'modifier_broodmother_spawn_spiderlings', ab.v('buff_duration'));
      addMod(ab, tt, 'modifier_broodmother_spawn_spiderlings_slow', ab.v('slow_duration'));
      hit(ab, tt, ab.v('damage'), MAGICAL);
    });
  },
});
debuff('modifier_broodmother_poison_sting_debuff', { stats: (m) => ({ msPct: -Math.abs(m.v('movement_speed')) }) });
passive('broodmother_poison_sting', {
  fid: 'full', note: 'the slow of several spiderlings does not stack',
  onAttackLanded(m, rec) { const t = rec.target; if (t.alive && !t.isBuilding) t.addModifier('modifier_broodmother_poison_sting_debuff', { caster: m.parent, ability: m.ability, duration: t.heroLike ? m.v('duration_hero') : m.v('duration') }); },
});
debuff('modifier_broodmother_spawn_spiderite_debuff', {
  onDestroy(m) {
    const t = m.parent; if (t.alive) return;
    const sp = m.caster; const brood = sp.owner || sp; const ult = brood.findAbility('broodmother_spawn_spiderlings');
    if (ult) spawnSpiderlings(ult, t.x, t.y, 1, m.v('spiderite_duration'));
    else sp.world.summon(sp, 'npc_dota_broodmother_spiderling', { x: t.x, y: t.y, duration: m.v('spiderite_duration') });
  },
});
passive('broodmother_spawn_spiderite', {
  fid: 'full', note: 'follows the current tooltip: a unit that dies with the debuff spawns one more Spiderling (not the weaker spiderite unit that is still in the data) for the spiderling\'s owner',
  onAttackLanded(m, rec) { const t = rec.target; if (t.alive && !t.isBuilding) t.addModifier('modifier_broodmother_spawn_spiderite_debuff', { caster: m.parent, ability: m.ability, duration: m.v('buff_duration') }); },
});

// ================================================================ Ember Spirit
// [L] measured in Hero Demo: the chains last duration + 0.05 s (2.75 -> 2.8, 3.55 -> 3.6) and deal damage_per_second x tick_interval
// every tick_interval, the first time one interval after they are applied (2.8 s = 5 instances)
const CHAINS_EXTRA = 0.05;
debuff('modifier_ember_spirit_searing_chains', { state: ['ROOT'], interval: (m) => m.v('tick_interval'), onThink(m) { mhit(m, m.parent, m.v('damage_per_second') * m.v('tick_interval'), MAGICAL); } });
defAbility('ember_spirit_searing_chains', {
  prio: 75, fid: 'full', note: 'two random enemies in the radius; the root lasts duration + 0.05 s and burns once per tick_interval (both measured live)',
  ai: (ab, u, t) => (t && !immune(t) && u.distTo(t) <= ab.v('radius') - 30 ? SELF : null),
  cast(ab) {
    const u = ab.owner; const w = u.world;
    const pool = enemiesNear(ab, u.x, u.y, ab.v('radius')).filter((e) => !e.isBuilding && !immune(e) && (e.st[ST.INVIS] === 0 || w.detectAll));
    for (let i = ab.v('unit_count'); i > 0 && pool.length; i--) { const e = pool.splice(w.rng.int(0, pool.length - 1), 1)[0]; addMod(ab, e, 'modifier_ember_spirit_searing_chains', ab.v('duration') + CHAINS_EXTRA); }
  },
});
// data: { targets, i, x0, y0 }  one attack per target every attack_interval (the first at once), then back to the start one
// interval after the last attack. [L] measured in Hero Demo: invulnerable and disarmed meanwhile, standing next to the target
// (his Immolation burns there), one target = 0.25 s
modifier('modifier_ember_spirit_sleight_of_fist', {
  purge: 'none', state: ['DISARM', 'INVULN'], interval: (m) => m.v('attack_interval'), thinkNow: true,
  onThink(m) {
    const u = m.parent; const w = u.world; const d = m.data;
    while (d.i < d.targets.length && !(d.targets[d.i].alive && d.targets[d.i].attackableBy(u))) d.i++;
    if (d.i >= d.targets.length) { m.remove(); return; }
    const t = d.targets[d.i++]; const [fx, fy] = dirTo(t, { x: d.x0, y: d.y0 }); const gap = u.def.hull + t.def.hull + 10;
    u.x = t.x + fx * gap; u.y = t.y + fy * gap;
    w.launchAttack(u, t, { instant: true, fromAbility: m.ability, flat: t.isHero ? m.v('bonus_hero_damage') : 0, potency: u.itemPotency * m.v('attack_effectiveness') / 100 });
  },
  onDestroy(m) { const u = m.parent; if (u.alive) { u.x = m.data.x0; u.y = m.data.y0; } },
});
defAbility('ember_spirit_sleight_of_fist', {
  prio: 65, fid: 'approx', note: 'Ember Spirit jumps from target to target (nearest first; the game\'s order is not known) with one regular attack each (bonus_hero_damage added to the attack against heroes, attack_effectiveness % item potency), is invulnerable and disarmed meanwhile, and returns one attack_interval after the last attack',
  ai: (ab, u, t) => {
    if (!t || u.hasModifier('modifier_ember_spirit_sleight_of_fist') || u.hasModifier('modifier_ember_spirit_activate_fire_remnant')) return null;
    const d = u.distTo(t); const r = ab.castRange(); if (d > r + ab.v('radius') - 50) return null;
    const k = d > r ? r / d : 1; return { x: u.x + (t.x - u.x) * k, y: u.y + (t.y - u.y) * k };
  },
  cast(ab, t, x, y) {
    const u = ab.owner;
    const targets = enemiesNear(ab, x, y, ab.v('radius')).filter((e) => !e.isBuilding && e.attackableBy(u)).sort((a, b) => u.distTo(a) - u.distTo(b));
    if (targets.length) u.addModifier('modifier_ember_spirit_sleight_of_fist', { ability: ab, duration: targets.length * ab.v('attack_interval') + 1, data: { targets, i: 0, x0: u.x, y0: u.y } });
  },
});
// [L] measured in Hero Demo: every tick_interval (first one interval after the cast) the guard puts a burn of linger_duration on the
// enemies in its radius; the burn deals damage_per_second x tick_interval every tick_interval on its own clock (18 s = 90 instances)
debuff('modifier_ember_spirit_flame_guard_burn', { purge: 'none', interval: (m) => m.v('tick_interval'), onThink(m) { mhit(m, m.parent, m.v('damage_per_second') * m.v('tick_interval'), MAGICAL); } });
// m.x = magic damage the guard can still absorb
buff('modifier_ember_spirit_flame_guard', {
  interval: (m) => m.v('tick_interval'),
  onCreated(m) { m.x = m.v('absorb_amount'); }, onRefresh(m) { m.x = m.v('absorb_amount'); },
  // [L] measured in Hero Demo: the guard absorbs shield_pct_absorb % of the magical damage after magic resistance, and that
  // (post-resistance) amount is what is taken from absorb_amount
  postMit(m, d) {
    if (d.type !== MAGICAL || d.amount <= 0 || (d.flags & F_HP_LOSS)) return;
    const a = Math.min(d.amount * m.v('shield_pct_absorb') / 100, m.x);
    d.amount -= a; m.x -= a;
    if (m.x <= 1e-6) m.remove();
  },
  onThink(m) { const u = m.parent; for (const e of u.world.enemiesInRadius(u, u.x, u.y, m.v('radius'))) if (!e.isBuilding) e.addModifier('modifier_ember_spirit_flame_guard_burn', { caster: u, ability: m.ability, duration: m.v('linger_duration') }); },
});
defAbility('ember_spirit_flame_guard', {
  prio: 60, fid: 'full', note: 'absorbs shield_pct_absorb % of incoming magical damage after magic resistance until absorb_amount is used up (measured live), then the guard and its burn end; the burn lingers linger_duration after an enemy leaves',
  ai: (ab, u, t) => (t && !u.hasModifier('modifier_ember_spirit_flame_guard') && u.distTo(t) <= ab.v('radius') ? SELF : null),
  cast(ab) { addMod(ab, ab.owner, 'modifier_ember_spirit_flame_guard', ab.v('duration')); },
});
// [L] measured in Hero Demo: Immolation is an aura that keeps a 0.1 s burn debuff on the enemies in the radius (re-applied all the
// time); the debuff deals damage x tick_interval every tick_interval counted from the moment it was put on, so an enemy that is
// only touched for less than one interval takes nothing. One debuff per enemy: Ember Spirit and Shard remnants do not stack.
const IMMOLATION_STICK = 0.1;
debuff('modifier_ember_spirit_immolation_debuff', { purge: 'none', statusResist: false, interval: (m) => m.v('tick_interval'), onThink(m) { mhit(m, m.parent, m.v('damage') * m.v('tick_interval'), MAGICAL); } });
function immolate(im, x, y, stick) {
  const u = im.owner;
  for (const e of u.world.inRadius(x, y, im.v('radius'), u.team, true)) if (!e.isBuilding) e.addModifier('modifier_ember_spirit_immolation_debuff', { caster: u, ability: im, duration: stick });
}
passive('ember_spirit_immolation', {
  fid: 'full', note: 'an aura that keeps a 0.1 s burn on enemies in the radius, ticking every tick_interval from the moment it is applied (as measured live); burns from Ember Spirit and from Shard remnants are assumed not to stack on one enemy',
  interval: (m) => m.parent.world.dt,
  onThink(m) { immolate(m.ability, m.parent.x, m.parent.y, IMMOLATION_STICK); },
});
// Fire Remnants are summoned marker units (out of play). On the remnant: data = { tx, ty, speed, moving }
modifier('modifier_ember_spirit_fire_remnant', {
  hidden: true, purge: 'none', state: ['OUT', 'INVULN'], interval: 0.1,
  onThink(m) {
    const r = m.parent; const d = m.data; const c = m.caster;
    if (d.moving) {
      const dist = hyp(d.tx - r.x, d.ty - r.y); const step = d.speed * 0.1;
      if (dist <= step) { r.x = d.tx; r.y = d.ty; d.moving = false; } else { r.x += (d.tx - r.x) / dist * step; r.y += (d.ty - r.y) / dist * step; return; }
    }
    if (!(m.v('apply_immolation_to_remnant') > 0)) return;                          // Shard: a resting remnant burns with Immolation (Break does not stop it)
    const im = c.findAbility('ember_spirit_immolation'); if (!im || im.level < 1) return;
    immolate(im, r.x, r.y, 0.1 + r.world.dt);                                      // this think runs every 0.1 s: keep the burn up until the next one
  },
});
function emberRemnant(fr, x0, y0, tx, ty, speed) {
  const r = summon(fr, 'npc_dota_ember_spirit_remnant', { x: x0, y: y0, duration: fr.v('duration') });
  r.ai = null;
  r.addModifier('modifier_ember_spirit_fire_remnant', { caster: fr.owner, ability: fr, data: { tx, ty, speed, moving: speed > 0 } });
  fr.data = (fr.data || []).filter((e) => e.alive); fr.data.push(r);
  return r;
}
// on Ember Spirit: Scepter charge limit and the Shard effects
modifier('modifier_ember_spirit_fire_remnant_charges', {
  hidden: true, purge: 'none', interval: 0.5, thinkNow: true,
  onThink(m) {
    const ab = m.ability; const u = m.parent; const w = u.world; const sc = m.v('scepter_max_charges'); const sr = m.v('scepter_range');
    if (sr > 0 && ab.vals.AbilityCastRange !== sr) ab.vals.AbilityCastRange = sr; // Scepter cast range (the engine reads the cast range from this value)
    if (!(sc > 0) || ab.vals.AbilityCharges === sc) return;
    ab.vals.AbilityCharges = sc;                                                  // the engine reads the charge limit from this value
    if (w.time < 1) ab.charges = sc; else if (ab.chargeEnd === 0) ab.chargeEnd = w.time + ab.v('AbilityChargeRestoreTime') * u.cdrMul;
  },
  onAnyDeath(m, ev) {
    const u = m.parent; const v = ev.victim; const ab = m.ability; const r = m.v('shard_charge_radius');
    if (r > 0 && v.isHero && !v.isIllusion && v.team !== u.team && u.distTo(v) <= r && ab.charges < ab.v('AbilityCharges')) ab.charges++;
  },
  onDeath(m) { const u = m.parent; const ab = m.ability; if (m.v('shard_charge_radius') > 0) u.world.after(0, () => { if (!u.alive) emberRemnant(ab, u.x, u.y, u.x, u.y, 0); }); },
});
defAbility('ember_spirit_fire_remnant', {
  mods: ['modifier_ember_spirit_fire_remnant_charges'], prio: 50, fid: 'approx', note: 'a remnant is a marker unit that runs to the point at speed_multiplier % of Ember Spirit\'s speed (x scepter_speed_multiplier) and waits there for `duration`; thrown at hero targets within cast range while charges last; Scepter: the charge limit and the cast range are patched into the ability\'s AbilityCharges / AbilityCastRange values (checked every 0.5 s); Shard: a charge returns when an enemy hero dies within shard_charge_radius, a resting remnant burns with Immolation, and a remnant appears where Ember Spirit dies',
  ai: (ab, u, t) => (t && t.heroLike && ab.cdReady() && u.distTo(t) <= ab.castRange() && !u.hasModifier('modifier_ember_spirit_activate_fire_remnant') ? { x: t.x, y: t.y } : null),
  cast(ab, t, x, y) {
    const u = ab.owner; const act = u.findAbility('ember_spirit_activate_fire_remnant'); const k = ab.v('scepter_speed_multiplier');
    if (act && act.level !== ab.level) act.setLevel(ab.level);                    // the activation sub-ability follows the ultimate (mana cost)
    emberRemnant(ab, u.x, u.y, x, y, u.ms * ab.v('speed_multiplier') / 100 * (k > 0 ? k : 1));
  },
});
// [L] measured in Hero Demo: invulnerable (not rooted / disarmed) while dashing between remnants; the explosion uses the damage of
// Activate Fire Remnant itself (a scene where only Fire Remnant was raised exploded for the level-1 100)
modifier('modifier_ember_spirit_activate_fire_remnant', { purge: 'none', state: ['INVULN'] });
defAbility('ember_spirit_activate_fire_remnant', {
  prio: 52, fid: 'approx', note: 'Ember Spirit visits every remnant at `speed` (nearest first, the one closest to the targeted point last), each explodes for the ultimate\'s damage and radius when he arrives; used when a resting remnant has the target in its radius and either no charge is left or the target is out of attack reach; the dash is not interrupted by disables',
  ai: (ab, u, t) => {
    const fr = u.findAbility('ember_spirit_fire_remnant');
    if (!t || !fr || fr.level < 1 || !fr.data || u.hasModifier('modifier_ember_spirit_activate_fire_remnant')) return null;
    if (ab.level !== fr.level) ab.setLevel(fr.level);
    const near = fr.data.some((r) => r.alive && !r.mods.some((x) => x.data && x.data.moving) && hyp(r.x - t.x, r.y - t.y) <= fr.v('radius'));
    return near && (fr.charges < 1 || u.rangeTo(t) > u.attackRange + 300) ? { x: t.x, y: t.y } : null;
  },
  cast(ab, t, x, y) {
    const u = ab.owner; const w = u.world; const fr = u.findAbility('ember_spirit_fire_remnant');
    const rest = fr && fr.data ? fr.data.filter((r) => r.alive) : [];
    if (!rest.length) return;
    let last = rest[0]; for (const r of rest) if (hyp(r.x - x, r.y - y) < hyp(last.x - x, last.y - y)) last = r;
    rest.splice(rest.indexOf(last), 1);
    const order = []; let cx = u.x; let cy = u.y;
    while (rest.length) { let bi = 0; for (let i = 1; i < rest.length; i++) if (hyp(rest[i].x - cx, rest[i].y - cy) < hyp(rest[bi].x - cx, rest[bi].y - cy)) bi = i; const r = rest.splice(bi, 1)[0]; order.push(r); cx = r.x; cy = r.y; }
    order.push(last);
    let at = 0; cx = u.x; cy = u.y;
    for (const r of order) {
      for (const x2 of r.mods) if (x2.data && x2.data.moving) x2.data.moving = false;      // a running remnant stops where it is
      const rx = r.x; const ry = r.y;
      at += hyp(rx - cx, ry - cy) / ab.v('speed'); cx = rx; cy = ry;
      w.after(at, () => {
        if (r.alive) w.kill(r, null, null, true);
        if (!u.alive) return;
        u.x = rx; u.y = ry;
        for (const e of enemiesNear(ab, rx, ry, ab.v('radius'))) if (!e.isBuilding) hit(ab, e, ab.v('damage'), MAGICAL);
      });
    }
    fr.data = [];
    u.addModifier('modifier_ember_spirit_activate_fire_remnant', { ability: ab, duration: at + 0.02 });
  },
});

// ================================================================ Magnus
debuff('modifier_magnataur_shockwave_slow', { stats: (m) => ({ msPct: -m.v('movement_slow') }) });
defAbility('magnataur_shockwave', {
  prio: 55, fid: 'approx', note: 'a front shock_width wide travels cast-range distance at shock_speed and hits every enemy it passes once (damage, pull of pull_distance towards Magnus, slow for basic_slow_duration, the labelled "SLOW DURATION"); with the talent it returns from the far end for length + return_shockwave_bonus_distance with return_damage_pct % damage and the same pull and slow',
  ai: (ab, u, t) => (t && u.distTo(t) <= ab.castRange() - 100 ? { target: t } : null),
  cast(ab, t, x, y) {
    const u = ab.owner; const x0 = u.x; const y0 = u.y; const [dx, dy] = dirTo(u, t || { x, y });
    const L = ab.castRange(); const speed = ab.v('shock_speed'); const width = ab.v('shock_width');
    const strike = (e, k) => {
      if (e.isBuilding) return;
      hit(ab, e, ab.v('shock_damage') * k, MAGICAL);
      if (!e.alive || immune(e)) return;
      addMod(ab, e, 'modifier_magnataur_shockwave_slow', ab.v('basic_slow_duration'));
      knockback(e, u.x, u.y, -ab.v('pull_distance'));
    };
    wave(ab, x0, y0, dx, dy, L, speed, width, (e) => strike(e, 1), () => {
      const k = ab.v('return_damage_pct') / 100;
      if (k > 0) wave(ab, x0 + dx * L, y0 + dy * L, -dx, -dy, L + ab.v('return_shockwave_bonus_distance'), speed, width, (e) => strike(e, k));
    });
  },
});
const empowerCleave = (m, rec, k) => { const u = m.parent; if (u.melee && rec.damage > 0) cleave(u, rec.target, rec.damage * m.v('cleave_damage_pct') * k / 100, m.v('cleave_starting_width'), m.v('cleave_ending_width'), m.v('cleave_distance'), m.ability); };
buff('modifier_magnataur_empower', { stats: (m) => ({ dmgBasePct: m.v('bonus_damage_pct') }), onAttackLanded(m, rec) { empowerCleave(m, rec, 1); } });
modifier('modifier_magnataur_empower_self', {
  hidden: true, stats: (m) => ({ dmgBasePct: m.v('bonus_damage_pct') * (1 + m.v('self_multiplier') / 100) }),
  onAttackLanded(m, rec) { empowerCleave(m, rec, 1 + m.v('self_multiplier') / 100); },
});
defAbility('magnataur_empower', {
  mods: ['modifier_magnataur_empower_self'], requires: (ab) => ab.v('always_on') > 0, prio: 45, fid: 'full', note: 'always on Magnus with self_multiplier % larger values; cast on the allied hero without Empower in range (melee heroes first), never on himself; the unused self-bonus stack values (stack duration 0) are ignored',
  ai: (ab, u, t, w) => {
    if (!t) return null;
    let best = null;
    for (const a of w.units) if (a !== u && a.alive && a.team === u.team && a.isHero && !a.isIllusion && a.st[ST.OUT] === 0 && !a.hasModifier('modifier_magnataur_empower') && u.distTo(a) <= ab.castRange() + 300 && (!best || (a.melee && !best.melee))) best = a;
    return best ? { target: best } : null;
  },
  cast(ab, t) { if (t && t !== ab.owner) addMod(ab, t, 'modifier_magnataur_empower', ab.v('empower_duration')); },
});
debuff('modifier_magnataur_skewer_slow', { stats: (m) => ({ msPct: -m.v('slow_pct') }) });
// [L] measured in Hero Demo: Magnus is stunned and disarmed (not rooted) while he runs; a picked-up hero is stunned while carried and
// ends the skewer's full travel distance from where it stood; the distance bonus uses the distance from Magnus's starting point to
// the hero's final position (skewer_damage + damage_distance_pct % of it: 320 + 15% x 380 in the recorded scene)
debuff('modifier_magnataur_skewer_impact', { purge: 'none', statusResist: false, state: ['STUN'] });
// data: { ux, uy, left, x0, y0, total, got: Map(enemy -> where it was picked up) }
modifier('modifier_magnataur_skewer', {
  purge: 'none', state: ['STUN', 'DISARM'], interval: (m) => m.parent.world.dt, thinkNow: true,
  onThink(m) {
    const u = m.parent; const w = u.world; const d = m.data; const st = u.st;
    if (st[ST.STUN] > 1 || st[ST.HEX] > 0 || st[ST.OUT] > 0) { m.remove(); return; }                 // "interrupted if Magnus is stunned, hexed or banished" (one stun is his own)
    const step = Math.min(d.left, m.v('skewer_speed') * w.dt);
    u.x += d.ux * step; u.y += d.uy * step; d.left -= step;
    for (const e of w.enemiesInRadius(u, u.x, u.y, m.v('skewer_radius'))) if (e.heroLike && !immune(e) && !d.got.has(e)) { d.got.set(e, { x: e.x, y: e.y }); addMod(m.ability, e, 'modifier_magnataur_skewer_impact', d.total / m.v('skewer_speed') + 0.1); }
    const moved = d.total - d.left;
    for (const [e, from] of d.got) if (e.alive) { const k = Math.min(d.total, moved + (d.total - moved > 1e-6 ? w.dt * m.v('skewer_speed') : 0)); e.x = from.x + d.ux * k; e.y = from.y + d.uy * k; }
    if (d.left <= 1e-6) m.remove();
  },
  onDestroy(m) {
    const ab = m.ability; const d = m.data;
    for (const [e, from] of m.data.got) {
      if (!e.alive) continue;
      e.x = from.x + d.ux * d.total; e.y = from.y + d.uy * d.total;
      e.removeModifierByName('modifier_magnataur_skewer_impact');
      hit(ab, e, ab.v('skewer_damage') + hyp(e.x - d.x0, e.y - d.y0) * ab.v('damage_distance_pct') / 100, MAGICAL);
      if (e.alive) addMod(ab, e, 'modifier_magnataur_skewer_slow', ab.v('slow_duration'));
    }
  },
});
defAbility('magnataur_skewer', {
  prio: 60, fid: 'approx', note: 'Magnus runs at skewer_speed to a point 200 units behind the target (AI choice, up to `range`); Magnus is stunned and disarmed while running (live); heroes within skewer_radius are stunned while carried and end the full travel distance from where they stood, then are damaged (skewer_damage + damage_distance_pct % of the distance from the start point of Magnus to their end position, measured live) and slowed; Shard tree / cliff damage is not modelled (no terrain)',
  ai: (ab, u, t) => {
    const h = t && t.heroLike ? t : t && heroNear(u, ab.v('range') - 50);
    if (!h || immune(h) || u.hasModifier('modifier_magnataur_skewer')) return null;
    const d = u.distTo(h); if (d > ab.v('range') - 50) return null;
    const k = Math.min(ab.v('range'), d + 200) / (d || 1);
    return { x: u.x + (h.x - u.x) * k, y: u.y + (h.y - u.y) * k };
  },
  cast(ab, t, x, y) {
    const u = ab.owner; const d = hyp(x - u.x, y - u.y); if (d < 1) return;
    // [L] measured in Hero Demo: the run covers whole server ticks only (200 units at 900/s = 6 ticks = 180 units)
    const per = ab.v('skewer_speed') * u.world.dt; const total = Math.max(per, Math.floor(Math.min(d, ab.v('range')) / per + 1e-6) * per);
    u.addModifier('modifier_magnataur_skewer', { ability: ab, duration: ab.v('range') / ab.v('skewer_speed') + 1, data: { ux: (x - u.x) / d, uy: (y - u.y) / d, left: total, total, x0: u.x, y0: u.y, got: new Map() } });
  },
});
defAbility('magnataur_horn_toss', {
  prio: 62, fid: 'approx', note: '"in front" = within the pull_angle arc around the direction to Magnus\'s current target; tossed enemies land destination_offset behind him, are damaged and stunned for air_duration + stun_duration; the unlabelled slow values in the data are not applied (the tooltip only mentions the stun)',
  ai: (ab, u, t) => (t && !immune(t) && u.distTo(t) <= ab.v('radius') - 30 ? SELF : null),
  cast(ab) {
    const u = ab.owner; const [fx, fy] = dirTo(u, foe(u)); const cosHalf = Math.cos(ab.v('pull_angle') / 2 * Math.PI / 180);
    for (const e of enemiesNear(ab, u.x, u.y, ab.v('radius'))) {
      if (e.isBuilding) continue;
      const d = u.distTo(e); if (d > 1e-6 && ((e.x - u.x) * fx + (e.y - u.y) * fy) / d < cosHalf) continue;
      hit(ab, e, ab.v('damage'), MAGICAL);
      if (!e.alive || immune(e)) continue;
      e.x = u.x - fx * ab.v('destination_offset'); e.y = u.y - fy * ab.v('destination_offset');
      stun(ab, e, ab.v('air_duration') + ab.v('stun_duration'));
    }
  },
});
passive('magnataur_solid_core', { fid: 'partial', note: 'slow resistance is modelled; the knockback reduction is not (forced movement is applied directly by other scripts, there is no hook to scale it)', stats: (m) => ({ slowRes: m.v('slow_resistance') }) });
buff('modifier_magnataur_reverse_polarity_stats', { purge: 'none', multi: 'stack', stats: (m) => ({ all: m.v('stats_per_stack') * m.stacks }) });
defAbility('magnataur_reverse_polarity', {
  prio: 90, fid: 'approx', note: 'every enemy within pull_radius is placed directly in front of Magnus (towards his current target), stunned for hero_stun_duration (creeps too) and damaged; cast only when an enemy hero is inside the radius',
  ai: (ab, u, t) => (t && heroNear(u, ab.v('pull_radius') - 30) ? SELF : null),
  cast(ab) {
    const u = ab.owner; const [fx, fy] = dirTo(u, foe(u)); let heroes = 0;
    for (const e of enemiesNear(ab, u.x, u.y, ab.v('pull_radius'))) {
      if (e.isBuilding) continue;
      const off = u.def.hull + e.def.hull + 10; e.x = u.x + fx * off; e.y = u.y + fy * off;
      stun(ab, e, ab.v('hero_stun_duration')); hit(ab, e, ab.v('polarity_damage'), MAGICAL);
      if (e.isHero && !e.isIllusion) heroes++;
    }
    if (heroes > 0 && ab.v('stats_per_stack') > 0) u.addModifier('modifier_magnataur_reverse_polarity_stats', { ability: ab, duration: ab.v('stat_buff_duration'), stacks: heroes });
  },
});

// ================================================================ Pangolier
debuff('modifier_pangolier_swashbuckle_slow', { stats: (m) => ({ msPct: -m.v('slow_percent') }) });
// `strikes` slashes along a line from (x0, y0): each is an attack that deals `damage` (+ attack_damage % of attack damage) with reduced item potency
// `lead`: an extra slash at once, the `strikes` slashes then start one server tick later
function swashbuckle(sw, x0, y0, ang, strikes, k, lead = false) {
  const u = sw.owner; const w = u.world; const L = sw.v('range'); const x1 = x0 + Math.cos(ang) * L; const y1 = y0 + Math.sin(ang) * L;
  const at = []; if (lead) at.push(0); for (let i = 0; i < strikes; i++) at.push((lead ? w.dt : 0) + i * sw.v('attack_interval'));
  for (const d of at) w.after(d, () => {
    if (!u.alive) return;
    for (const e of enemiesInLine(sw, x0, y0, x1, y1, sw.v('start_radius') * 2)) {
      if (e.isBuilding || !e.attackableBy(u)) continue;
      const r = w.launchAttack(u, e, { instant: true, fromAbility: sw, mult: sw.v('attack_damage') / 100 * k, add: sw.v('damage') * k, potency: u.itemPotency * sw.v('potency') / 100 });
      if (!r.missed && e.alive) addMod(sw, e, 'modifier_pangolier_swashbuckle_slow', sw.v('slow_duration'));
    }
  });
}
// [L] measured in Hero Demo: Pangolier is stunned (cannot act) from the cast until 0.17 s after the last slash; the dash ends with
// one slash more than `strikes` (5 hits with strikes = 4), the others follow one server tick later every attack_interval
const SWASH_RECOVER = 0.17;
modifier('modifier_pangolier_swashbuckle_stunned', { purge: 'none', state: ['STUN'] });
modifier('modifier_pangolier_shield_crash_jump', { purge: 'none', state: ['STUN'] });
defAbility('pangolier_swashbuckle', {
  prio: 86, fid: 'approx', note: 'measured live: stunned from the cast until shortly after the last slash, and the dash end adds one slash to `strikes` (assumed to hit the whole line); dashes to just short of the target, then slashes a line of length `range` and half-width start_radius (value name; the label calls it "slash width") towards it; every slash is an attack for the listed damage that carries on-hit effects at `potency` % item potency (its damage is not a multiple of attack damage, so crits do not scale it); the dash is a jump followed by a delay of distance / dash_speed',
  ai: (ab, u, t) => {
    if (!t || u.hasModifier('modifier_pangolier_gyroshell') || u.hasModifier('modifier_pangolier_rollup')) return null;
    const d = u.distTo(t); if (d > ab.v('dash_range') + ab.v('range') / 2) return null;
    const go = Math.max(0, Math.min(ab.v('dash_range'), d - (u.def.hull + t.def.hull + 60))); const k = d > 0 ? go / d : 0;
    return { x: u.x + (t.x - u.x) * k, y: u.y + (t.y - u.y) * k };
  },
  cast(ab, t, x, y) {
    const u = ab.owner; const w = u.world;
    u.removeModifierByName('modifier_pangolier_gyroshell');                         // "Casting Swashbuckle during Rolling Thunder ends Rolling Thunder"
    const d = hyp(x - u.x, y - u.y); const go = Math.min(d, ab.v('dash_range') + u.castRangeBonus); const dashAng = Math.atan2(y - u.y, x - u.x);
    if (d > 1e-6 && !(u.st[ST.ROOT] > 0)) { u.x += (x - u.x) / d * go; u.y += (y - u.y) / d * go; }
    const sx = u.x; const sy = u.y; const f = foe(u); const ang = f ? Math.atan2(f.y - sy, f.x - sx) : dashAng;
    const dash = go / ab.v('dash_speed');
    u.addModifier('modifier_pangolier_swashbuckle_stunned', { ability: ab, duration: dash + ab.v('strikes') * ab.v('attack_interval') + SWASH_RECOVER });
    w.after(dash, () => swashbuckle(ab, sx, sy, ang, ab.v('strikes'), 1, true));
  },
});
barrier('modifier_pangolier_shield_crash_barrier', 'all');
const SCEPTER_SWASH_DIRECTIONS = 4; const SCEPTER_SWASH_STRIKES = 2;      // tooltip text only: "a 2-attack Swashbuckle every 90 degrees"
defAbility('pangolier_shield_crash', {
  prio: 84, fid: 'approx', note: 'lands after jump_duration, jump_horizontal_distance towards the current target (no extra displacement while rolling), damaging the radius; the barrier (hero_shield, replacing an old one) is granted when at least one real enemy hero is hit; Scepter: four 2-slash Swashbuckles at right angles (counts from the tooltip text), the first towards the target, at (100 - damage_penalty) % damage',
  ai: (ab, u, t) => (t && u.distTo(t) <= ab.v('jump_horizontal_distance') + ab.v('radius') - 100 ? SELF : null),
  cast(ab) {
    const u = ab.owner; const w = u.world; const rolling = u.hasModifier('modifier_pangolier_gyroshell');
    const f = foe(u); const ang = f ? Math.atan2(f.y - u.y, f.x - u.x) : 0; const jd = rolling ? ab.v('jump_duration_gyroshell') : ab.v('jump_duration');
    if (!rolling) u.addModifier('modifier_pangolier_shield_crash_jump', { ability: ab, duration: jd - u.world.dt });   // [L] cannot act while in the air (0.37 s live)
    w.after(jd, () => {
      if (!u.alive) return;
      if (!rolling && !(u.st[ST.ROOT] > 0)) { u.x += Math.cos(ang) * ab.v('jump_horizontal_distance'); u.y += Math.sin(ang) * ab.v('jump_horizontal_distance'); }
      let heroHit = false;
      for (const e of enemiesNear(ab, u.x, u.y, ab.v('radius'))) { if (e.isBuilding) continue; hit(ab, e, ab.v('damage'), PHYSICAL); if (e.isHero && !e.isIllusion) heroHit = true; }
      if (heroHit) { u.removeModifierByName('modifier_pangolier_shield_crash_barrier'); giveBarrier(ab, u, 'modifier_pangolier_shield_crash_barrier', ab.v('base_shield') + ab.v('hero_shield'), ab.v('duration')); }
      const sw = u.findAbility('pangolier_swashbuckle');
      if (u.hasScepter && sw && sw.level > 0) for (let i = 0; i < SCEPTER_SWASH_DIRECTIONS; i++) swashbuckle(sw, u.x, u.y, ang + i * 2 * Math.PI / SCEPTER_SWASH_DIRECTIONS, SCEPTER_SWASH_STRIKES, 1 - sw.v('damage_penalty') / 100);
    });
  },
});
debuff('modifier_pangolier_lucky_shot_debuff', { stats: (m) => ({ asSlow: -m.v('attack_slow'), armor: -m.v('armor') }) });
passive('pangolier_lucky_shot', {
  fid: 'full', note: 'rolled (pseudo-random) on every instance of damage from Pangolier\'s attacks and abilities, not from items',
  onDealDamage(m, d) {
    const t = d.dst;
    if (d.dealt <= 0 || !t.alive || t.team === m.parent.team || t.isBuilding || (d.flags & (F_REFLECT | F_HP_LOSS)) || (d.ability && d.ability.isItem && !(d.flags & F_ATTACK))) return;
    if (m.roll(m.v('chance_pct'))) t.addModifier('modifier_pangolier_lucky_shot_debuff', { caster: m.parent, ability: m.ability, duration: m.v('duration') });
  },
});
// lockout: an enemy cannot be struck again by Rolling Thunder "until the previous stun duration ends"
modifier('modifier_pangolier_gyroshell_hit', { hidden: true, purge: 'none' });
function gyroHit(u, ult, e, fromX, fromY) {
  if (!e.alive || e.isBuilding || e.hasModifier('modifier_pangolier_gyroshell_hit')) return;
  const lock = ult.v('bounce_duration') + ult.v('stun_duration');
  e.addModifier('modifier_pangolier_gyroshell_hit', { caster: u, ability: ult, duration: lock });
  hit(ult, e, ult.v('AbilityDamage') + ((u.dmgMin + u.dmgMax) / 2 + u.dmgBonus) * ult.v('damage_pct') / 100, PHYSICAL);
  if (!e.alive || immune(e)) return;
  knockback(e, fromX, fromY, ult.v('knockback_radius'));
  stun(ult, e, lock);
}
// m.z = heading (radians)
buff('modifier_pangolier_gyroshell', {
  purge: 'none', state: ['IMMUNE', 'DISARM', 'ROOT'], interval: (m) => m.v('tick_interval'),
  stats: (m) => ({ mr: m.v('magic_resistance') }),
  onCreated(m) { const u = m.parent; u.purge({ debuffs: true }); const t = foe(u); m.z = t ? Math.atan2(t.y - u.y, t.x - u.x) : 0; },
  onThink(m) {
    const u = m.parent; const w = u.world; const tick = m.v('tick_interval'); const st = u.st;
    if (!(st[ST.STUN] > 0 || st[ST.SLEEP] > 0 || st[ST.HEX] > 0 || u.hasModifier('modifier_pangolier_rollup'))) {
      const full = m.v('forward_move_speed'); const speed = full * Math.min(1, (w.time - m.created) / (m.v('move_speed_ramp_up_time') || 1e-9));
      const t = foe(u);
      if (t) {
        let diff = Math.atan2(t.y - u.y, t.x - u.x) - m.z; diff = Math.atan2(Math.sin(diff), Math.cos(diff));
        const rate = m.v('turn_rate') * Math.PI / 180; const R = full / rate; const s = diff >= 0 ? 1 : -1;
        const cx = u.x - Math.sin(m.z) * R * s; const cy = u.y + Math.cos(m.z) * R * s;          // centre of the tightest turn towards the target
        if (hyp(t.x - cx, t.y - cy) >= R - m.v('hit_radius') / 2) m.z += Math.max(-rate * tick, Math.min(rate * tick, diff));   // else roll on straight until the turn can reach it
      }
      u.x += Math.cos(m.z) * speed * tick; u.y += Math.sin(m.z) * speed * tick;
    }
    for (const e of w.enemiesInRadius(u, u.x, u.y, m.v('hit_radius'))) gyroHit(u, m.ability, e, u.x, u.y);
  },
});
defAbility('pangolier_gyroshell', {
  prio: 80, fid: 'approx', note: 'Pangolier steers at his current target with forward_move_speed (linear ramp-up) and turn_rate degrees per second, cannot attack, and strikes enemies within hit_radius: AbilityDamage + damage_pct % of his average attack damage (physical), knockback, and a stun of bounce_duration + stun_duration that also locks the enemy against the next strike; debuff immune enemies only take the damage; no walls, so no ricochet',
  ai: (ab, u, t) => (t && !u.hasModifier('modifier_pangolier_gyroshell') && u.distTo(t) <= ab.v('forward_move_speed') ? SELF : null),
  cast(ab) { addMod(ab, ab.owner, 'modifier_pangolier_gyroshell', ab.v('duration')); },
});
na('pangolier_gyroshell_stop', 'ends Rolling Thunder early; the roll always lasts its duration (or until Swashbuckle is cast)');
// m.x = time until which he is still rolling away from the last attacker
buff('modifier_pangolier_rollup', {
  purge: 'none', state: ['IMMUNE', 'DISARM', 'ROOT'], stats: (m) => ({ mr: m.v('magic_resistance') }),
  onAttacked(m, rec) {
    const u = m.parent; const w = u.world; const a = rec.attacker;
    if (w.time < m.x || !a || a.team === u.team) return;
    m.x = w.time + m.v('rollup_bounce_duration') + m.v('jump_recover_time');
    const [fx, fy] = dirTo(a, u); const dist = m.v('forward_move_speed') * m.v('rollup_bounce_duration');
    const x1 = u.x + fx * dist; const y1 = u.y + fy * dist; const ult = u.findAbility('pangolier_gyroshell');
    if (ult && ult.level > 0) for (const e of enemiesInLine(m.ability, u.x, u.y, x1, y1, m.v('hit_radius') * 2)) if (e !== a) gyroHit(u, ult, e, u.x, u.y);
    u.x = x1; u.y = y1;
  },
});
defAbility('pangolier_rollup', {
  prio: 35, fid: 'approx', note: 'debuff immunity and magic resistance for `duration`, no attacks or movement; when attacked he rolls forward_move_speed x rollup_bounce_duration away from the attacker in one step and enemies on that path take a Rolling Thunder strike with the ultimate\'s values (the ability\'s own stun_duration list is not used); during Rolling Thunder it pauses the roll; used below 35% health while being hit',
  ai: (ab, u, t, w) => (t && frac(u) < 0.35 && w.time - u.lastHurt < 1 && !u.hasModifier('modifier_pangolier_rollup') && !u.hasModifier('modifier_pangolier_gyroshell') ? SELF : null),
  cast(ab) { addMod(ab, ab.owner, 'modifier_pangolier_rollup', ab.v('duration')); },
});
na('pangolier_rollup_stop', 'ends Roll Up early; it always lasts its duration');
passive('pangolier_fortune_favors_the_bold', {
  fid: 'partial', note: 'only critical strikes are covered: a crit rolled by an attacker within aura_radius is cancelled with chance_reduce % probability; other random on-attack effects (bashes, procs) are rolled inside other scripts and cannot be intercepted',
  onPreAttacked(m, rec) { const u = m.parent; const a = rec.attacker; if (rec.crit > 1 && a.team !== u.team && u.distTo(a) <= m.v('aura_radius') && u.world.rng.chance(Math.abs(m.v('chance_reduce')) / 100)) rec.crit = 1; },
});

// ================================================================ Silencer
// Brain drain needs to know, when an enemy hero dies, whether it carried a Silencer debuff and whether it was silenced.
// Modifiers are already gone when the death event fires, so every Silencer debuff takes this snapshot just before its carrier dies.
function silencerSnap(m) {
  const c = m.caster; const bd = c && c.findModifier('modifier_silencer_brain_drain');
  if (bd) bd.data.set(m.parent, { t: m.parent.world.time, silenced: m.parent.st[ST.SILENCE] > 0 });
}
// [L] measured in Hero Demo: the curse deals `damage` once per second, the first tick one second after it is applied and the
// last one on expiry (6 ticks for 6 s, 8 for 8 s with the talent)
schedDot('modifier_silencer_curse_of_the_silent', {
  every: 1, dps: 'damage', type: MAGICAL, stats: (m) => ({ msPct: -Math.abs(m.v('movespeed')) }),
  tick(m) { if (m.parent.st[ST.SILENCE] > 0) m.dieTime += m.parent.world.dt; },                       // the timer is paused while the target is silenced (the damage goes on)
  onCast(m, ev) { if (!ev.ability.isItem) m.setDuration(m.remaining() + m.v('penalty_duration')); },
  onDeath: silencerSnap,
});
defAbility('silencer_curse_of_the_silent', {
  prio: 55, fid: 'full', note: 'application_damage on cast, then damage once per second (first tick one second later, last on expiry, measured); the timer is paused while the target is silenced; every spell (not item) the target casts adds penalty_duration',
  ai: (ab, u, t) => (t && !t.hasModifier('modifier_silencer_curse_of_the_silent') ? { x: t.x, y: t.y } : null),
  cast(ab, t, x, y) { for (const e of enemiesNear(ab, x, y, ab.v('radius'))) { if (e.isBuilding) continue; addMod(ab, e, 'modifier_silencer_curse_of_the_silent', ab.v('duration')); hit(ab, e, ab.v('application_damage'), MAGICAL); } },
});
// one instance per glaive: m.x = intelligence moved
debuff('modifier_silencer_glaives_of_wisdom_debuff', { multi: 'independent', purge: 'none', statusResist: false, stats: (m) => ({ int: -m.x }), onDeath: silencerSnap });
buff('modifier_silencer_glaives_of_wisdom_buff', { multi: 'independent', purge: 'none', stats: (m) => ({ int: m.x }) });
function glaiveEffect(m, t) {
  const u = m.parent; if (u.dirty) u.recompute();
  if (t.alive) mhit(m, t, u.int * m.v('intellect_damage_pct') / 100, MAGICAL);
  if (!t.alive || !t.isHero || t.isIllusion) return;
  const dur = m.v('int_steal_duration');
  const d = t.addModifier('modifier_silencer_glaives_of_wisdom_debuff', { caster: u, ability: m.ability, duration: dur });
  if (!d) return;
  d.x = m.v('int_steal'); t.dirty = true;
  const b = u.addModifier('modifier_silencer_glaives_of_wisdom_buff', { ability: m.ability, duration: dur });
  if (b) { b.x = d.x; u.dirty = true; }
}
passive('silencer_glaives_of_wisdom', {
  fid: 'full', note: 'autocast assumed on (mana per attack, not while silenced); every glaive moves int_steal intelligence for int_steal_duration with its own timer (real heroes only); Shard: the bounce is a secondary attack (full attack damage, no other on-hit effects) on a random enemy within bounce_range that also carries the glaive effect',
  onAttack(m, rec) {
    const u = m.parent;
    if (rec.secondary || rec.target.isBuilding || u.isSilenced()) return;
    if (!u.world.freeSpells) { const c = m.ability.manaCost(); if (u.mana < c) return; u.mana -= c; }
    (rec.data ||= {}).glaive = m;
  },
  onAttackLanded(m, rec) {
    if (!(rec.data && rec.data.glaive === m)) return;
    const u = m.parent; const w = u.world; let from = rec.target; const hitSet = new Set([from]);
    glaiveEffect(m, from);
    for (let i = m.v('bounce_count'); i > 0; i--) {
      const pool = w.inRadius(from.x, from.y, m.v('bounce_range'), u.team, true).filter((e) => !hitSet.has(e) && !e.isBuilding && e.attackableBy(u));
      if (!pool.length || !u.alive) break;
      const e = pool[w.rng.int(0, pool.length - 1)]; hitSet.add(e);
      const r = w.launchAttack(u, e, { instant: true, secondary: true, fromAbility: m.ability });
      if (!r.missed) glaiveEffect(m, e);
      from = e;
    }
  },
});
debuff('modifier_silencer_last_word_silence', { state: ['SILENCE'], onDeath: silencerSnap });
function lastWordTrigger(m) {
  if (m.y === 1) return; m.y = 1;
  const t = m.parent; const c = m.caster; const ab = m.ability;
  if (t.alive) {
    if (c.dirty) c.recompute(); if (t.dirty) t.recompute();
    const dmg = ab.v('damage') + Math.max(0, c.int - t.int) * ab.v('int_multiplier');
    // [L] measured in Hero Demo: the silence lands before the damage, so Brain Drain's damage_pct already amplifies it (657 = 548 x 1.2)
    addMod(ab, t, 'modifier_silencer_last_word_silence', ab.v('duration'));
    hit(ab, t, dmg, MAGICAL);
  }
  m.remove();
}
// m.y = 1 once triggered, m.z = 1 while waiting for a channel to finish
debuff('modifier_silencer_last_word', {
  interval: 0.1,
  onCast(m, ev) { if (ev.ability.isItem) return; if (ev.ability.script && ev.ability.script.channel) m.z = 1; else lastWordTrigger(m); },
  onThink(m) { if (m.z === 1 && !m.parent.channelAb) lastWordTrigger(m); },
  onDestroy(m, expired) { if (expired) lastWordTrigger(m); },
  onDeath: silencerSnap,
});
defAbility('silencer_last_word', {
  prio: 65, fid: 'full', note: 'triggers when the target finishes casting a spell (after the channel for channelled spells; items do not count) or when the timer runs out; a dispelled enchantment does nothing; vision is not modelled',
  ai: (ab, u, t) => { const h = t && t.heroLike ? t : t && heroNear(u, ab.castRange()); return h && !immune(h) && !h.hasModifier('modifier_silencer_last_word') && !(h.st[ST.SILENCE] > 0) ? (ab.v('radius') > 0 ? { x: h.x, y: h.y } : { target: h }) : null; },
  // [L] measured in Hero Demo: with the radius talent Last Word is a point-target area spell; an order on a unit is refused
  cast(ab, t, x, y) {
    const r = ab.v('radius');
    if (r > 0 ? !!t : !t) { refund(ab); return; }
    for (const e of r > 0 ? enemiesNear(ab, x, y, r) : [t]) if (!e.isBuilding) addMod(ab, e, 'modifier_silencer_last_word', ab.v('debuff_duration'));
  },
});
// stacks = intelligence stolen for good; data = Map(victim -> snapshot); not disabled by Break
modifier('modifier_silencer_brain_drain', {
  hidden: true, purge: 'none', breakable: false,
  onCreated(m) { m.data = new Map(); },
  stats: (m) => ({ int: m.stacks }),
  onAnyDeath(m, ev) {
    const u = m.parent; const v = ev.victim;
    if (!v.isHero || v.isIllusion || v.team === u.team) return;
    const snap = m.data.get(v); const marked = !!snap && snap.t === u.world.time; m.data.delete(v);
    if (!marked && u.distTo(v) > m.v('permanent_int_steal_range')) return;
    m.setStacks(m.stacks + m.v('permanent_int_steal_amount') + (marked && snap.silenced ? m.v('silenced_bonus_int_steal_amount') : 0));
  },
});
modifier('modifier_silencer_brain_drain_amp', {
  hidden: true, purge: 'none',
  outgoing(m, d) { const t = d.dst; if (t.team !== m.parent.team && t.st[ST.SILENCE] > 0 && !(d.flags & F_HP_LOSS)) d.amount *= 1 + m.v('damage_pct') / 100; },
  postMit(m, d) { const s = d.src; if (s && s.team !== m.parent.team && s.st[ST.SILENCE] > 0 && !(d.flags & F_HP_LOSS)) d.amount *= 1 - m.v('damage_pct') / 100; },
});
defAbility('silencer_brain_drain', {
  mods: ['modifier_silencer_brain_drain', 'modifier_silencer_brain_drain_amp'], fid: 'approx', note: 'damage dealt to / taken from silenced enemies is scaled by damage_pct (this part is disabled by Break); permanent intelligence is gained when a real enemy hero dies in range or with a Silencer debuff on it (the victim\'s own loss is not applied, it is dead); the extra point for a silenced victim is only detected when the victim carried one of Silencer\'s debuffs; the Shard line in the tooltip has no value in the data and is not modelled; preset with stacks: { silencer_brain_drain: N }',
});
debuff('modifier_silencer_global_silence_debuff', { pierce: true, state: ['SILENCE'], onDeath: silencerSnap });
defAbility('silencer_global_silence', {
  prio: 85, fid: 'full', note: 'every enemy unit is silenced through debuff immunity (a dispel, e.g. activating Black King Bar, removes it); Scepter: Arcane Curse (if learned) on enemy heroes for the same duration; cast when an enemy hero is within 1200 of Silencer (AI assumption)',
  ai: (ab, u, t) => (t && heroNear(u, 1200) ? SELF : null),
  cast(ab) {
    const u = ab.owner; const dur = ab.v('AbilityDuration'); const curse = u.findAbility('silencer_curse_of_the_silent');
    for (const e of u.world.units) {
      if (!e.alive || e.team === u.team || e.isBuilding) continue;
      addMod(ab, e, 'modifier_silencer_global_silence_debuff', dur);
      if (ab.v('applies_curse') > 0 && e.isHero && curse && curse.level > 0) addMod(curse, e, 'modifier_silencer_curse_of_the_silent', dur);
    }
  },
});

// ================================================================ Warlock
// Eldritch Summoning: one minor imp per enemy that dies with a Warlock spell on it (hooked into the debuffs below).
const impDone = new WeakMap();                                                    // victim -> death time already answered
const impBlast = new WeakSet();                                                   // units being hit by an imp explosion right now (7.36 notes: "Imp explosions cannot spawn Minor Imps")
function warlockImp(wl, x, y) {
  const es = wl.findAbility('warlock_eldritch_summoning');
  if (!es || es.level < 1) return null;
  const w = wl.world;
  const imp = summon(es, 'npc_dota_warlock_minor_imp', { x, y, ovr: { hp: es.v('imp_health'), ms: es.v('imp_speed') } });
  imp.addModifier('modifier_warlock_imp_explode_timer', { caster: wl, ability: es, duration: es.v('minor_imp_duration') });
  let best = null;                                                                // "favoring fatally bonded heroes"
  for (const e of w.units) if (e.alive && e.team !== wl.team && e.isHero && e.attackableBy(imp) && e.findModifier('modifier_warlock_fatal_bonds', wl) && (!best || imp.distTo(e) < imp.distTo(best))) best = e;
  if (best && imp.ai) imp.ai.fixedTarget = best;
  return imp;
}
function warlockAfflicted(m) {
  const v = m.parent; const wl = m.caster;
  if (v.alive || !wl || v.isBuilding || v.team === wl.team || impBlast.has(v) || impDone.get(v) === v.deathTime) return;
  impDone.set(v, v.deathTime);
  warlockImp(wl, v.x, v.y);
}
function impExplode(m) {
  if (m.x === 1) return; m.x = 1;
  const imp = m.parent; const w = imp.world; const wl = imp.owner; const es = wl && wl.findAbility('warlock_eldritch_summoning');
  const x = imp.x; const y = imp.y; const dmg = es && es.level > 0 ? es.v('imp_explode') : 0; const team = imp.team;
  // the imp's own value has no area bonus; Warlock's is added (assumed like the golem's, which was measured; not double-counted)
  const r = m.v('explosion_radius') + (wl ? wl.aoeBonus : 0); const weak = 1 - m.v('explosion_nonhero_reduce') / 100;
  if (imp.alive) w.kill(imp, null, null, true);
  if (dmg > 0) w.after(m.v('explosion_delay'), () => { for (const e of w.inRadius(x, y, r, team, true)) if (!e.isBuilding) { impBlast.add(e); w.damage(wl, e, dmg * (e.isHero ? 1 : weak), MAGICAL, 0, es); impBlast.delete(e); } });
}
modifier('modifier_warlock_imp_explode_timer', { hidden: true, purge: 'none', onDestroy(m, expired) { const p = m.parent.findModifier('modifier_warlock_imp_explode'); if (expired && p) impExplode(p); } });
passive('warlock_imp_explode', {
  fid: 'approx', note: 'the imp runs at the nearest enemy (a fatally bonded hero first) and explodes when it starts its first attack, when its lifetime ends, or when it is killed by anything but an enemy hero; explosion damage comes from the owner\'s Eldritch Summoning and is halved against non-heroes, after explosion_delay; an imp spawned without a Warlock has no explosion value and simply attacks',
  onAttackStart(m) { const o = m.parent.owner; if (o && o.findAbility('warlock_eldritch_summoning')) impExplode(m); },      // an imp without a Warlock just attacks
  onDeath(m, ev) { const k = ev.killer; if (k && k.isHero && k.team !== m.parent.team) m.x = 1; else impExplode(m); },
});
passive('warlock_imp_explode_major', {
  fid: 'approx', note: 'no tooltip text in the data and no current Warlock ability summons this unit: modelled from the value names only (per-level health / damage / speed bonuses; explosion on death after explosion_delay for explosion_dmg in explosion_radius, reduced against non-heroes)',
  stats: (m) => ({ hp: m.v('bonus_hp'), dmg: m.v('bonus_dmg'), ms: m.v('bonus_movespeed') }),
  onDeath(m) {
    if (m.x === 1) return; m.x = 1;
    const imp = m.parent; const w = imp.world; const x = imp.x; const y = imp.y; const src = imp.owner || imp; const ab = m.ability; const team = imp.team;
    const dmg = m.v('explosion_dmg'); const r = m.v('explosion_radius'); const weak = 1 - m.v('explosion_nonhero_reduce') / 100;
    w.after(m.v('explosion_delay'), () => { for (const e of w.inRadius(x, y, r, team, true)) if (!e.isBuilding) w.damage(src, e, dmg * (e.isHero ? 1 : weak), MAGICAL, 0, ab); });
  },
});
passive('warlock_eldritch_summoning', { fid: 'approx', note: 'an enemy unit that dies while carrying Fatal Bonds, Shadow Word or the Upheaval slow leaves a minor imp (one per death, none for a unit killed by an imp explosion); the Chaotic Offering stun and the golem\'s burn do not count as afflictions here; imps are uncontrolled summoned units, see Eldritch Explosion' });
// data = { group: [bound units], pre: Map(damage event -> amount before mitigation) }
debuff('modifier_warlock_fatal_bonds', {
  multi: 'perCaster',
  onCreated(m) { m.data ||= { group: [m.parent] }; m.data.pre = new Map(); },
  onRefresh(m, o) { if (o && o.data) m.data.group = o.data.group; },
  preMit(m, d) { if (!(d.flags & (F_REFLECT | F_HP_LOSS))) m.data.pre.set(d, d.amount); },
  onTakeDamage(m, d) {
    const pre = m.data.pre.get(d); m.data.pre.delete(d);
    if (!(pre > 0) || d.dealt <= 0 || (d.flags & (F_REFLECT | F_HP_LOSS))) return;
    const p = m.parent; const w = p.world; const share = pre * m.v('damage_share_percentage') / 100; const type = d.type;
    for (const o of m.data.group.slice()) if (o !== p && o.alive && o.findModifier('modifier_warlock_fatal_bonds', m.caster)) w.damage(m.caster, o, share, type, F_REFLECT | F_NO_AMP | F_NO_LIFESTEAL, m.ability);
  },
  onDestroy: warlockAfflicted,
});
defAbility('warlock_fatal_bonds', {
  prio: 75, fid: 'approx', note: 'binds the target and the nearest other enemies within search_aoe (`count` units in total); the share is taken from the damage before the victim\'s own armor / resistances and dealt to the others as reflected damage of the same type (reduced by their own defenses, no spell amplification, no lifesteal); direct health removal is not shared; cast only when at least two enemies can be bound; vision is not modelled',
  ai: (ab, u, t) => (t && !immune(t) && !t.findModifier('modifier_warlock_fatal_bonds', u) && enemiesNear(ab, t.x, t.y, ab.v('search_aoe')).filter((e) => !e.isBuilding && !immune(e)).length >= 2 ? { target: t } : null),
  cast(ab, t) {
    const u = ab.owner;
    const others = enemiesNear(ab, t.x, t.y, ab.v('search_aoe')).filter((e) => e !== t && !e.isBuilding).sort((a, b) => t.distTo(a) - t.distTo(b));
    const group = [];
    for (const e of [t, ...others]) { if (group.length >= ab.v('count')) break; if (addMod(ab, e, 'modifier_warlock_fatal_bonds', ab.v('duration'), { data: { group } })) group.push(e); }
  },
});
// heal / damage per second in tick_interval steps around the carrier (m.x = last pulse time)
function shadowWordPulse(m) {
  const p = m.parent; const c = m.caster; const w = p.world; const now = w.time; const dt = now - m.x; m.x = now;
  if (dt <= 1e-9) return;
  const amt = m.v('damage') * dt; const r = m.v('spell_aoe');
  for (const o of w.inRadius(p.x, p.y, r, c.team, false)) if (!o.isBuilding) o.heal(amt, c, m.ability);
  for (const e of w.inRadius(p.x, p.y, r, c.team, true)) if (!e.isBuilding) mhit(m, e, amt, MAGICAL);
}
const shadowWord = { interval: (m) => m.v('tick_interval'), onCreated(m) { m.x = m.parent.world.time; }, onThink: shadowWordPulse };
buff('modifier_warlock_shadow_word_buff', { ...shadowWord, stats: (m) => ({ msPct: m.v('shard_movement_speed_pct') }), onDestroy(m, expired) { if (expired) shadowWordPulse(m); } });
debuff('modifier_warlock_shadow_word_debuff', { ...shadowWord, stats: (m) => ({ msPct: -m.v('shard_movement_speed_pct') }), onDestroy(m, expired) { if (expired) shadowWordPulse(m); warlockAfflicted(m); } });
defAbility('warlock_shadow_word', {
  prio: 55, fid: 'full', note: 'the value is per second (shipped notes), paid every tick_interval to every unit within spell_aoe of the carrier: Warlock\'s allies are healed, his enemies damaged; the talent changes the carrier\'s movement speed (+ on allies, - on enemies); the Scepter line in the tooltip refers to values that are not in the data and is not modelled; the AI heals the most wounded allied hero below 75%, otherwise curses the target',
  ai: (ab, u, t, w) => {
    let best = null;
    for (const a of w.units) if (a.alive && a.team === u.team && a.heroLike && !a.isIllusion && a.st[ST.OUT] === 0 && frac(a) < 0.75 && !a.hasModifier('modifier_warlock_shadow_word_buff') && u.distTo(a) <= ab.castRange() + 200 && (!best || frac(a) < frac(best))) best = a;
    if (best) return { target: best };
    return t && !immune(t) && !t.hasModifier('modifier_warlock_shadow_word_debuff') ? { target: t } : null;
  },
  cast(ab, t) { const tt = t || ab.owner; addMod(ab, tt, tt.team === ab.owner.team ? 'modifier_warlock_shadow_word_buff' : 'modifier_warlock_shadow_word_debuff', ab.v('duration')); },
});
const UPHEAVAL_AS_CAP = 70;                    // talent tooltip text only: "Maximum of +70 Attack Speed" (no data value)
const upheavalData = { onRefresh(m, o) { if (o && o.data) { m.data = o.data; m.parent.dirty = true; } } };
debuff('modifier_warlock_upheaval_slow', { ...upheavalData, stats: (m) => ({ msPct: -m.data.v }), onDestroy: warlockAfflicted });
modifier('modifier_warlock_upheaval_ally', { ...upheavalData, purge: 'none', stats: (m) => ({ as: m.data.v }) });
// on Warlock while he channels: data = { x, y }; m.x = damage ticks done, m.y = Shard imps spawned
modifier('modifier_warlock_upheaval', {
  purge: 'none', interval: 0.25, thinkNow: true,
  onThink(m) {
    const u = m.parent; const w = u.world; const d = m.data; const el = w.time - m.created; const r = m.v('aoe'); const linger = m.v('duration');
    const slow = Math.min(m.v('max_slow'), m.v('slow_per_second') * el);
    const es = w.enemiesInRadius(u, d.x, d.y, r).filter((e) => !e.isBuilding);
    for (const e of es) e.addModifier('modifier_warlock_upheaval_slow', { caster: u, ability: m.ability, duration: linger, data: { v: slow } });
    const aps = m.v('aspd_per_second');
    if (aps > 0) { const as = Math.min(UPHEAVAL_AS_CAP, aps * el); for (const a of w.alliesInRadius(u, d.x, d.y, r)) if (!a.isBuilding) a.addModifier('modifier_warlock_upheaval_ally', { caster: u, ability: m.ability, duration: linger, data: { v: as } }); }
    const ti = m.v('damage_tick_interval');
    // [L] measured in Hero Demo: ticks at +1 s .. +15 s of a 16 s channel, none when the channel ends
    while (ti > 0 && el + 1e-6 >= (m.x + 1) * ti && (m.x + 1) * ti < m.v('AbilityChannelTime') - 1e-6) { m.x++; const dmg = Math.min(m.v('max_damage'), m.v('base_damage') + m.v('damage_per_second') * m.x * ti) * ti; for (const e of es) if (e.alive) mhit(m, e, dmg, MAGICAL); }
    const ii = m.v('imps_interval');
    while (u.hasShard && ii > 0 && el + 1e-6 >= (m.y + 1) * ii) { m.y++; warlockImp(u, d.x, d.y); }
  },
});
defAbility('warlock_upheaval', {
  prio: 40, fid: 'approx', note: 'channelled for the full channel time unless interrupted (the AI never stops early); slow = slow_per_second x seconds channelled up to max_slow, re-applied every 0.25 s and lingering `duration`; damage every damage_tick_interval = base_damage + damage_per_second x seconds channelled up to max_damage; talent: allies inside gain attack speed per second channelled, capped at the +70 named only in the talent tooltip; Shard: a minor imp at the centre every imps_interval',
  channel: true,
  ai: (ab, u, t) => (t && u.distTo(t) <= ab.castRange() + ab.v('aoe') / 2 ? { x: t.x, y: t.y } : null),
  cast(ab, t, x, y) { ab.owner.addModifier('modifier_warlock_upheaval', { ability: ab, duration: ab.v('AbilityChannelTime') + 0.02, data: { x, y } }); },
  channelEnd(ab) { ab.owner.removeModifierByName('modifier_warlock_upheaval'); },
});
modifier('modifier_warlock_rain_of_chaos_golem', { hidden: true, purge: 'none', stats: (m) => ({ slowRes: m.v('bonus_slow_resistance'), dmgTaken: -m.v('bonus_damage_resist'), mr: m.v('bonus_magic_resistance') }) });
function warlockGolem(ab, x, y, hp, dmg) {
  const u = ab.owner; const def = u.world.unitDef('npc_dota_warlock_golem'); const half = (def.dmgMax - def.dmgMin) / 2;      // keep the unit's own damage spread
  const g = summon(ab, 'npc_dota_warlock_golem', { x, y, duration: ab.v('golem_duration'), abilityLevel: Math.max(1, ab.level),
    ovr: { hp, dmgMin: dmg - half, dmgMax: dmg + half, armor: ab.v('golem_armor') + ab.v('bonus_armor'), ms: ab.v('golem_movement_speed'), hpRegen: ab.v('golem_health_regen') } });
  g.addModifier('modifier_warlock_rain_of_chaos_golem', { caster: u, ability: ab });
  return g;
}
// talent: "Summons a Golem on death"
modifier('modifier_warlock_rain_of_chaos', { hidden: true, purge: 'none', onDeath(m) { const u = m.parent; const ab = m.ability; if (m.v('golem_on_death') > 0) u.world.after(0, () => { if (!u.alive) warlockGolem(ab, u.x, u.y, ab.v('golem_hp'), ab.v('golem_dmg')); }); } });
defAbility('warlock_rain_of_chaos', {
  mods: ['modifier_warlock_rain_of_chaos'], prio: 90, fid: 'approx', note: 'after stun_delay the enemies in the area are stunned (through debuff immunity) and the golem(s) appear: summoned units with the listed health, damage (the unit\'s +-spread kept), armor, speed and regeneration, the unit\'s own magic resistance, slow resistance, Flaming Fists and Permanent Immolation at the ultimate\'s level; Scepter: number_of_golems_scepter golems with the Scepter health / damage; the death talent summons one normal golem; trees are not modelled',
  ai: (ab, u, t) => { const h = t && heroNear(u, ab.castRange() + 200); return h ? { x: h.x, y: h.y } : null; },
  cast(ab, t, x, y) {
    const u = ab.owner; const sc = ab.v('number_of_golems_scepter') > 0; const n = sc ? ab.v('number_of_golems_scepter') : 1;
    u.world.after(ab.v('stun_delay'), () => {
      for (const e of enemiesNear(ab, x, y, ab.v('aoe'))) if (!e.isBuilding) stun(ab, e, ab.v('stun_duration'));
      for (let i = 0; i < n; i++) warlockGolem(ab, x + (i - (n - 1) / 2) * 120, y, sc ? ab.v('golem_hp_scepter') : ab.v('golem_hp'), sc ? ab.v('golem_dmg_scepter') : ab.v('golem_dmg'));
    });
  },
});
// The golem's area values grow with Warlock's own area bonus: `ab.v()` reads the golem's (none), so Warlock's flat bonus is added here.
// [L] measured in Hero Demo with Chasm Stone (+40): an enemy 344 from the golem burns (300 + 40 + hull 24), without it one 340 away does not.
const golemRadius = (m, name) => m.v(name) + (m.parent.owner ? m.parent.owner.aoeBonus : 0);
passive('warlock_golem_flaming_fists', {
  fid: 'full', note: 'every attack deals the pure damage to all enemies within the radius of the attacked unit (measured: centred on the target, not on the golem), as its own instance just before the attack\'s damage; Warlock\'s area bonus is assumed to apply as it does for Permanent Immolation',
  // [L] measured in Hero Demo: an enemy 270 from the golem and 390 from its target is not hit; the target takes the 60 just before the attack
  outgoing(m, d) {
    const g = m.parent; const rec = d.rec; const t = d.dst;
    if (!rec || !(d.flags & F_ATTACK) || rec.secondary || rec.attacker !== g || t.team === g.team) return;
    for (const e of g.world.inRadius(t.x, t.y, golemRadius(m, 'radius'), g.team, true)) if (!e.isBuilding) g.world.damage(g, e, m.v('damage'), PURE, F_PIERCE, m.ability);
  },
});
// [L] measured in Hero Demo: the aura puts a 0.5 s debuff on the enemies inside (refreshed while they stay, one per enemy for all golems);
// it burns aura_damage x tick_interval every tick_interval from tick_interval after it was applied
const IMMOLATION_LINGER = 0.5;
schedDot('modifier_warlock_golem_permanent_immolation_debuff', { every: 'tick_interval', dps: 'aura_damage', type: MAGICAL, statusResist: false });
passive('warlock_golem_permanent_immolation', {
  fid: 'full', note: 'aura of aura_radius (+ Warlock\'s area bonus, measured) around the golem: a 0.5 s lingering debuff that burns every tick_interval from tick_interval after it was applied; the auras of several golems do not stack on an enemy',
  interval: SERVER_TICK,
  onThink(m) {
    const g = m.parent; const w = g.world;
    for (const e of w.inRadius(g.x, g.y, golemRadius(m, 'aura_radius'), g.team, true)) if (!e.isBuilding) e.addModifier('modifier_warlock_golem_permanent_immolation_debuff', { caster: g, ability: m.ability, duration: IMMOLATION_LINGER });
  },
});

// ================================================================ Bloodseeker
const BLOODRAGE_TICK = 0.75;                   // [L] measured in Hero Demo: the health cost is taken every 0.75 s (10 times in 8 s), nothing when it is applied or expires
buff('modifier_bloodseeker_bloodrage', {
  interval: BLOODRAGE_TICK, stats: (m) => ({ as: m.v('attack_speed'), spellAmp: m.v('spell_amp') }),
  onThink(m) { const u = m.parent; u.world.damage(u, u, u.maxHp * m.v('damage_pct') / 100 * BLOODRAGE_TICK, PURE, F_NO_AMP | F_NON_LETHAL, m.ability); },
  onAttackLanded(m, rec) { const t = rec.target; const p = m.v('max_health_dmg_pct'); if (p > 0 && t.alive && !t.isBuilding) mhit(m, t, t.maxHp * p / 100, PURE); },
});
defAbility('bloodseeker_bloodrage', {
  prio: 70, fid: 'full', note: 'the cost is pure, non-lethal self-damage of damage_pct % of max health per second, taken every 0.75 s (measured live) and not amplified; Shard: attacks add max_health_dmg_pct % of the target\'s max health as pure damage through debuff immunity',
  ai: (ab, u, t) => (t && !u.hasModifier('modifier_bloodseeker_bloodrage') && u.rangeTo(t) <= u.attackRange + 300 ? SELF : null),
  cast(ab) { addMod(ab, ab.owner, 'modifier_bloodseeker_bloodrage', ab.v('duration')); },
});
nuke('bloodseeker_blood_bath', {
  prio: 60, fid: 'full', note: 'the ritual is centred between Bloodseeker and a target that still has to walk to him, otherwise on the target',
  radius: 'radius', delay: 'delay', skillshot: true, damage: 'damage', type: PURE, also: (ab, t) => { if (t.alive) silence(ab, t, ab.v('silence_duration')); },
  ai: (ab, u, t) => { if (!t || u.distTo(t) > ab.castRange()) return null; const k = u.rangeTo(t) > t.attackRange + 100 ? 0.5 : 0; return { x: t.x + (u.x - t.x) * k, y: t.y + (u.y - t.y) * k }; },
});
passive('bloodseeker_thirst', {
  fid: 'approx', note: 'movement bonus per enemy hero (not illusions, anywhere on the map) grows linearly from 0 at min_bonus_pct % health to the full value at max_bonus_pct %, lingers linger_duration after that hero dies, and removes the speed limit; vision / True Sight are not modelled',
  dynamic: true,
  onCreated(m) { m.data = []; },
  stats: (m) => {
    const u = m.parent; const w = u.world; const hi = m.v('min_bonus_pct'); const lo = m.v('max_bonus_pct'); let k = 0;
    const us = w.units;
    for (let i = 0; i < us.length; i++) { const e = us[i]; if (!e.alive || e.team === u.team || !e.isHero || e.isIllusion) continue; const p = e.hp / e.maxHp * 100; if (p < hi) k += Math.min(1, (hi - p) / (hi - lo)); }
    for (let i = m.data.length - 1; i >= 0; i--) if (m.data[i] > w.time) k++; else m.data.splice(i, 1);
    return { msPct: m.v('bonus_movement_speed') * k, msMax: NO_CAP };
  },
  onAnyDeath(m, ev) { const v = ev.victim; if (v.team !== m.parent.team && v.isHero && !v.isIllusion) m.data.push(m.parent.world.time + m.v('linger_duration')); },
});
function sanguivoreHeal(m, v, k) {
  const u = m.parent;
  if (!u.alive || v.isBuilding || v.team === u.team) return;
  u.heal((m.v('base_heal') + v.maxHp * m.v('heal_hp_pct') / 100) * k * (v.heroLike ? 1 : 1 - m.v('creep_lifesteal_reduction_pct') / 100) * (1 + u.lifestealAmp / 100), u, m.ability, true);
}
passive('bloodseeker_sanguivore', {
  fid: 'full', note: 'the heal counts as lifesteal (lifesteal amplification applies, creep reduction from the data); half values when an ally kills an enemy hero within half_bonus_aoe',
  onKill(m, ev) { sanguivoreHeal(m, ev.victim, 1); },
  onAnyDeath(m, ev) { const u = m.parent; const v = ev.victim; const k = ev.killer; if (k && k !== u && k.team === u.team && v.isHero && !v.isIllusion && u.distTo(v) <= m.v('half_bonus_aoe')) sanguivoreHeal(m, v, 0.5); },
});
// m.x, m.y = position at the last check
debuff('modifier_bloodseeker_rupture', {
  purge: 'none', interval: 0.25,
  onCreated(m) { m.x = m.parent.x; m.y = m.parent.y; },
  onThink(m) { ruptureMove(m); },
  onDestroy(m, expired) { if (expired && m.parent.alive) ruptureMove(m); },
});
function ruptureMove(m) {
  const t = m.parent; const d = hyp(t.x - m.x, t.y - m.y); m.x = t.x; m.y = t.y;
  if (d > 0.5) mhit(m, t, Math.min(m.v('damage_cap_amount'), d * m.v('movement_damage_pct') / 100), PURE, F_NO_AMP);
}
defAbility('bloodseeker_rupture', {
  prio: 85, fid: 'approx', note: 'initial pure damage of hp_pct % of current health; the distance moved (including forced movement) is checked every 0.25 s and movement_damage_pct % of it is dealt as pure damage, with the unlabelled damage_cap_amount applied as a cap per check; neither part is amplified (the data flags them as not scaling with spell damage)',
  ai: (ab, u, t) => { const h = t && t.heroLike ? t : t && heroNear(u, ab.castRange() + 200); return h && !h.hasModifier('modifier_bloodseeker_rupture') ? { target: h } : null; },
  cast(ab, t) { hit(ab, t, t.hp * ab.v('hp_pct') / 100, PURE, F_NO_AMP); if (t.alive) addMod(ab, t, 'modifier_bloodseeker_rupture', ab.v('duration')); },
});

// ================================================================ Omniknight
function purify(ab, t, k) {
  if (!t.alive) return;
  const amt = ab.v('heal') * k;
  healUnit(ab, t, amt);
  // [L] measured in Hero Demo: a target dummy 283 from the centre (radius 260) is hit: the area reaches the edge of a unit's hull
  const r = ab.v('radius');
  for (const e of enemiesNear(ab, t.x, t.y, r + 100)) if (!e.isBuilding && t.distTo(e) - e.def.hull <= r) hit(ab, e, amt, PURE);
}
defAbility('omniknight_purification', {
  prio: 60, fid: 'full', note: 'AI: heals the most wounded allied hero in range once one is missing 30% health, otherwise uses it on himself (or an ally) standing next to the target as a nuke',
  ai: (ab, u, t, w) => {
    let best = null; let near = null;
    for (const a of w.units) {
      if (!a.alive || a.team !== u.team || !a.heroLike || a.isIllusion || a.st[ST.OUT] > 0 || u.distTo(a) > ab.castRange() + 100) continue;
      if (frac(a) < 0.7 && (!best || frac(a) < frac(best))) best = a;
      if (t && !near && a.distTo(t) <= ab.v('radius')) near = a;
    }
    return best ? { target: best } : near ? { target: near } : null;
  },
  cast(ab, t) {
    const tt = t || ab.owner; purify(ab, tt, 1);
    if (ab.v('recast_delay') > 0) ab.owner.world.after(ab.v('recast_delay'), () => purify(ab, tt, ab.v('recast_effectiveness_pct') / 100));
  },
});
buff('modifier_omniknight_martyr', { state: ['IMMUNE'], stats: (m) => ({ mr: m.v('magic_resist'), hpRegen: m.v('base_hpregen') }), onCreated(m) { m.parent.purge({ debuffs: true }); } });
defAbility('omniknight_martyr', {
  prio: 82, fid: 'approx', note: 'debuff immunity, magic resistance and health regeneration; debuffs already on the target are removed with a basic dispel to stand in for "have no effect while immune" (the tooltip does not mention a dispel); cast on an allied hero (or himself) that is below 60% health and was hit within the last 1.5 s',
  ai: (ab, u, t, w) => {
    if (!t) return null;
    let best = null;
    for (const a of w.units) if (a.alive && a.team === u.team && a.isHero && !a.isIllusion && a.st[ST.OUT] === 0 && !immune(a) && frac(a) < 0.6 && w.time - a.lastHurt < 1.5 && u.distTo(a) <= ab.castRange() + 200 && (!best || frac(a) < frac(best))) best = a;
    return best ? { target: best } : null;
  },
  cast(ab, t) { addMod(ab, t || ab.owner, 'modifier_omniknight_martyr', ab.v('duration')); },
});
debuff('modifier_omniknight_hammer_of_purity_slow', { stats: (m) => ({ msPct: -m.v('movement_slow') }) });
modifier('modifier_omniknight_hammer_of_purity_heal', { multi: 'independent', purge: 'none', interval: (m) => m.v('heal_duration') / m.v('total_ticks'), onThink(m) { m.parent.heal(m.data.per, m.parent, m.ability); } });
passive('omniknight_hammer_of_purity', {
  fid: 'approx', note: 'autocast assumed on: every attack while off cooldown adds pure damage = bonus_damage + base_damage % of the attack\'s white damage (through debuff immunity) and a short slow, and heals Omniknight for heal_pct % of attack + pure damage dealt over heal_duration (x0.6 against non-heroes, the engine\'s creep lifesteal factor; the 7.42 notes say 40% instead); attack_range_bonus is not an attack range bonus in the live game (his attack range stays 150 while the hammer is ready) and is not applied',
  onAttack(m, rec) { if (rec.secondary || rec.target.isBuilding || !m.ability.cdReady()) return; m.ability.startCooldown(); m.parent.dirty = true; (rec.data ||= {}).hammer = { m, white: rec.white }; },
  onAttackLanded(m, rec) {
    const h = rec.data && rec.data.hammer; if (!h || h.m !== m) return;
    const u = m.parent; const t = rec.target; let dealt = rec.dealt;
    if (t.alive) dealt += mhit(m, t, m.v('bonus_damage') + h.white * m.v('base_damage') / 100, PURE);
    if (t.alive) t.addModifier('modifier_omniknight_hammer_of_purity_slow', { caster: u, ability: m.ability, duration: m.v('duration') });
    const total = dealt * m.v('heal_pct') / 100 * (t.heroLike ? 1 : CREEP_LIFESTEAL);
    if (total > 0) u.addModifier('modifier_omniknight_hammer_of_purity_heal', { ability: m.ability, duration: m.v('heal_duration') + 0.02, data: { per: total / m.v('total_ticks') } });
  },
});
debuff('modifier_omniknight_degen_aura_debuff', { purge: 'none', statusResist: false, stats: (m) => ({ msPct: -m.v('speed_bonus') }) });
passive('omniknight_degen_aura', {
  fid: 'full', note: 'aura refreshed every 0.25 s; the slow lingers linger_duration',
  interval: 0.25, thinkNow: true,
  onThink(m) { const u = m.parent; for (const e of u.world.enemiesInRadius(u, u.x, u.y, m.v('radius'))) if (!e.isBuilding) e.addModifier('modifier_omniknight_degen_aura_debuff', { caster: u, ability: m.ability, duration: m.v('linger_duration') }); },
});
modifier('modifier_omniknight_guardian_angel_buff', { purge: 'none', stats: (m) => ({ restore: m.v('heal_and_regen_amp') }), preMit(m, d) { if (d.type === PHYSICAL && !(d.flags & F_HP_LOSS)) d.amount = 0; } });
buff('modifier_omniknight_guardian_angel', {
  purge: 'none', interval: 0.1, thinkNow: true,
  onThink(m) {
    const u = m.parent; const glob = m.v('is_global') > 0; const r = m.v('radius');
    for (const a of u.world.units) {
      if (!a.alive || a.team !== u.team || a.st[ST.OUT] > 0 || (a.isBuilding && !(m.v('affects_buildings') > 0)) || (!glob && u.distTo(a) > r)) continue;
      a.addModifier('modifier_omniknight_guardian_angel_buff', { caster: u, ability: m.ability, duration: 0.15 });
    }
  },
});
defAbility('omniknight_guardian_angel', {
  prio: 90, fid: 'full', note: 'aura around Omniknight (refreshed every 0.1 s, no linger): allies inside take no physical damage; Scepter: global, includes buildings and amplifies their health restoration; cast when he or an allied hero in the radius is below 60% health and was hit within the last 1.5 s',
  ai: (ab, u, t, w) => {
    if (!t || u.hasModifier('modifier_omniknight_guardian_angel')) return null;
    for (const a of w.units) if (a.alive && a.team === u.team && a.isHero && !a.isIllusion && frac(a) < 0.6 && w.time - a.lastHurt < 1.5 && (ab.v('is_global') > 0 || u.distTo(a) <= ab.v('radius'))) return SELF;
    return null;
  },
  cast(ab) { addMod(ab, ab.owner, 'modifier_omniknight_guardian_angel', ab.v('duration')); },
});

// ================================================================ Treant Protector
// [L] measured in Hero Demo: an enemy on the vines carries modifier_treant_natures_grasp_damage (0.5 s, refreshed while it
// stays on them): the slow, and damage_per_second x 0.25 every 0.25 s from 0.25 s after it was first latched
const GRASP_LINGER = 0.5; const GRASP_EVERY = 0.25;
schedDot('modifier_treant_natures_grasp_damage', { every: GRASP_EVERY, dps: 'damage_per_second', type: MAGICAL, stats: (m) => ({ msPct: -m.v('movement_slow') }) });
buff('modifier_treant_natures_guise_buff', { purge: 'none', stats: (m) => ({ msPct: m.v('movement_bonus') }) });
defAbility('treant_natures_grasp', {
  prio: 50, fid: 'approx', note: 'the vines are one line from Treant to the target point, latch_range to either side, latching from initial_latch_delay after the cast for vines_duration (checked every creation_interval); enemies on them get the damage / slow debuff (0.5 s linger, damage every 0.25 s, measured); the vines do not grow one by one, so the first latch can be up to one check late on far targets; Nature\'s Guise treats them as trees',
  ai: (ab, u, t) => { if (!t || t.hasModifier('modifier_treant_natures_grasp_damage')) return null; const d = u.distTo(t); if (d > ab.castRange()) return null; const k = Math.min(ab.castRange(), d + 200) / (d || 1); return { x: u.x + (t.x - u.x) * k, y: u.y + (t.y - u.y) * k }; },
  cast(ab, t, x, y) {
    const u = ab.owner; const w = u.world; const x1 = u.x; const y1 = u.y; const iv = ab.v('creation_interval') || 0.1; const n = Math.max(1, Math.round(ab.v('vines_duration') / iv)) + 1;
    const guise = u.findAbility('treant_natures_guise');
    for (let i = 0; i < n; i++) w.after(ab.v('initial_latch_delay') + i * iv, () => {
      for (const e of enemiesInLine(ab, x1, y1, x, y, ab.v('latch_range') * 2)) { if (e.isBuilding) continue; addMod(ab, e, 'modifier_treant_natures_grasp_damage', GRASP_LINGER); }
      if (guise && guise.level > 0 && u.alive && segDist(u.x, u.y, x1, y1, x, y) <= guise.v('radius')) u.addModifier('modifier_treant_natures_guise_buff', { ability: guise, duration: iv + 0.1 });
    });
  },
});
debuff('modifier_treant_leech_seed_debuff', { state: ['ROOT', 'DISARM'] });
passive('treant_leech_seed', {
  fid: 'approx', note: 'autocast assumed on (cooldown, mana, not silenced, target not debuff immune): bonus magic damage, root + disarm, and healing_pulse_count pulses spread evenly from application to the end of the debuff (2 = start and end); each pulse heals up to max_heal_units allies within the radius of the seeded unit (heroes first, then nearest) for flat_heal + leech_heal % of the attack damage and bonus damage dealt, arriving after distance / projectile_speed',
  onAttack(m, rec) {
    const u = m.parent; const ab = m.ability; const t = rec.target;
    if (rec.secondary || t.isBuilding || immune(t) || !ab.cdReady() || u.isSilenced()) return;
    if (!u.world.freeSpells) { const c = ab.manaCost(); if (u.mana < c) return; u.mana -= c; }
    ab.startCooldown(); (rec.data ||= {}).seed = m;
  },
  onAttackLanded(m, rec) {
    if (!(rec.data && rec.data.seed === m)) return;
    const u = m.parent; const w = u.world; const t = rec.target; const ab = m.ability; let dealt = rec.dealt;
    if (t.alive) dealt += mhit(m, t, m.v('leech_damage'), MAGICAL);
    const sm = t.alive ? t.addModifier('modifier_treant_leech_seed_debuff', { caster: u, ability: ab, duration: m.v('duration') }) : null;
    const span = sm ? sm.remaining() : 0; const n = m.v('healing_pulse_count'); const heal = m.v('flat_heal') + dealt * m.v('leech_heal') / 100;
    const pulse = () => {
      const pool = w.inRadius(t.x, t.y, m.v('radius'), u.team, false).filter((a) => !a.isBuilding).sort((a, b) => (b.isHero - a.isHero) || (a.distTo(t) - b.distTo(t)));
      for (const a of pool.slice(0, m.v('max_heal_units'))) w.projectile({ x: t.x, y: t.y }, a, m.v('projectile_speed'), (aa) => aa.heal(heal, u, ab));
    };
    for (let i = 0; i < n; i++) { const at = n > 1 ? span * i / (n - 1) : 0; if (at <= 0) pulse(); else w.after(at, pulse); }
  },
});
// m.x = damage the armor still blocks per instance
buff('modifier_treant_living_armor', {
  stats: (m) => ({ hpRegen: m.v('heal_per_second') }),
  onCreated(m) { m.x = m.v('damage_block_base'); }, onRefresh(m) { m.x = m.v('damage_block_base'); },
  preMit(m, d) {
    const s = d.src;
    if (!s || s === m.parent || d.amount < m.v('damage_block_threshold') || (d.flags & F_HP_LOSS) || !(s.heroLike || s.isSummon || s.isIllusion || s.owner)) return;
    d.amount = Math.max(0, d.amount - m.x); m.x -= m.v('damage_block_loss');
    if (m.x <= 1e-6) m.remove();
  },
});
defAbility('treant_living_armor', {
  prio: 55, fid: 'approx', note: 'heal per second is applied as health regeneration; the block is taken off every damage instance of at least damage_block_threshold (before armor / resistances) from heroes, illusions and summoned or owned units, then shrinks by damage_block_loss and the buff ends at 0; the Shard line in the tooltip has a zero value and no Shard flag in the data and is not modelled; cast on the allied hero (or himself) hit within the last 2 s with the lowest health',
  ai: (ab, u, t, w) => {
    let best = null;
    for (const a of w.units) if (a.alive && a.team === u.team && a.isHero && !a.isIllusion && a.st[ST.OUT] === 0 && w.time - a.lastHurt < 2 && !a.hasModifier('modifier_treant_living_armor') && (!best || frac(a) < frac(best))) best = a;
    return best ? { target: best } : null;
  },
  cast(ab, t, x, y) {
    const u = ab.owner; const w = u.world; const r = ab.v('aoe_radius');
    let tt = t; if (!tt) { for (const a of w.units) if (a.alive && a.team === u.team && (a.isHero || a.isBuilding) && (!tt || hyp(a.x - x, a.y - y) < hyp(tt.x - x, tt.y - y))) tt = a; }
    if (!tt) return;
    const list = r > 0 ? w.inRadius(tt.x, tt.y, r, u.team, false).filter((a) => a === tt || a.isHero || a.isBuilding) : [tt];
    for (const a of list) addMod(ab, a, 'modifier_treant_living_armor', ab.v('duration'));
  },
});
na('treant_eyes_in_the_forest', 'vision ward in a tree; no trees or vision in the sandbox');
defAbility('treant_natures_guise', { fid: 'partial', note: 'in the game Treant has +movement_bonus % speed while a tree is within radius (and walks through trees); the Hero Demo arena has trees, so live Treant runs at 308 instead of 280 in every recorded scene; the sandbox has no trees: only the bonus near his own Nature\'s Grasp vines (which count as trees) is modelled; tree walking and the invisibility active are not' });
// [L] measured in Hero Demo: `damage` once per second, the first tick one second after the root, the last on expiry (5 for 5 s)
schedDot('modifier_treant_overgrowth', { pierce: true, state: ['ROOT', 'DISARM'], every: 1, dps: 'damage', type: MAGICAL });
// Scepter: "Super Bloom"
buff('modifier_treant_overgrowth_bloom', {
  purge: 'none',
  apply(m, s, u) {
    s.str += (u.baseAttr('str') + u.attrLevels * 2 + s.str) * m.v('strength_bonus') / 100;
    const v = m.v('movement_speed'); if (v > 0) { if (v > s.msAbs) s.msAbs = v; if (s.msCap === 0 || v < s.msCap) s.msCap = v; }
  },
  onAttackLanded(m, rec) {
    const u = m.parent; const t = rec.target; const r = m.v('splash_radius');
    if (r > 0 && rec.damage > 0) for (const e of u.world.inRadius(t.x, t.y, r, u.team, true)) if (e !== t && !e.isBuilding) u.world.damage(u, e, rec.damage * m.v('splash_pct') / 100, PHYSICAL, F_SECONDARY, m.ability);
  },
});
defAbility('treant_overgrowth', {
  prio: 88, fid: 'approx', note: 'root + disarm through debuff immunity with `damage` once per second (first tick one second after the root, last on expiry, measured); Scepter bloom: fixed movement speed, splash around the attack target (reduced by armor), and strength_bonus % of the strength from level, items and modifiers applied before it; phased movement has no effect here; cast when an enemy hero is at least 150 inside the radius',
  ai: (ab, u, t) => (t && heroNear(u, ab.v('radius') - 150) ? SELF : null),
  cast(ab) {
    const u = ab.owner;
    for (const e of enemiesNear(ab, u.x, u.y, ab.v('radius'))) if (!e.isBuilding) addMod(ab, e, 'modifier_treant_overgrowth', ab.v('duration'));
    if (ab.v('bloom_duration') > 0) addMod(ab, u, 'modifier_treant_overgrowth_bloom', ab.v('bloom_duration'));
  },
});
na('treant_lifebomb_explode', 'no values and no tooltip in the data; the life bomb unit is not created by any current Treant ability');
