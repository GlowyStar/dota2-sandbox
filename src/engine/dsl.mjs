// Small helper layer used by the content scripts (src/scripts/*). Keeps each ability to a few lines.
import { defAbility, defModifier, ST } from './registry.mjs';
import * as C from './constants.mjs';

export { defAbility, defModifier, ST, C };
export const { PHYSICAL, MAGICAL, PURE, F_ATTACK, F_NO_AMP, F_REFLECT, F_HP_LOSS, F_NO_LIFESTEAL, F_NON_LETHAL, F_SECONDARY, F_PIERCE, F_NO_ARMOR } = C;

// resolve "value spec": number | ability value name | function(src)
export const val = (x, src) => (typeof x === 'number' ? x : typeof x === 'string' ? src.v(x) : x(src));
export const neg = (name) => (m) => -Math.abs(m.v(name));
export const pct = (name) => (m) => m.v(name) / 100;
export const perStack = (name) => (m) => m.v(name) * m.stacks;
// item on-hit values flagged apply_effectiveness scale with the attack's Item Potency (7.42)
export const pot = (name) => (m) => m.v(name) * m.potency / 100;

function statsFrom(map) {
  if (typeof map === 'function') return map;
  const keys = Object.keys(map);
  return (m) => { const o = {}; for (let i = 0; i < keys.length; i++) { const k = keys[i]; o[k] = val(map[k], m); } return o; };
}

export function modifier(name, def = {}) {
  const d = { ...def };
  if (def.stats) d.stats = statsFrom(def.stats);
  return defModifier(name, d);
}
export const buff = (name, def = {}) => modifier(name, { purge: 'basic', ...def });
export const debuff = (name, def = {}) => modifier(name, { debuff: true, ...def });

// passive ability = one hidden intrinsic modifier named modifier_<ability>
export function passive(name, def = {}) {
  const { fid, note, requires, illusion, ...md } = def;
  modifier('modifier_' + name, { hidden: true, ...md });
  return defAbility(name, { mods: ['modifier_' + name], fid, note, requires, illusion });
}
export const active = (name, script) => defAbility(name, script);

// ---------------------------------------------------------------- effect helpers (inside cast / hooks)
export const world = (x) => (x.owner ? x.owner.world : x.parent ? x.parent.world : x.world);
export function hit(ab, t, amount, type, flags = 0) { return ab.owner.world.damage(ab.owner, t, amount, type || ab.dmgType, flags, ab); }
export function addMod(ab, t, mod, duration, extra) { return t.addModifier(mod, extra ? { caster: ab.owner, ability: ab, duration, ...extra } : { caster: ab.owner, ability: ab, duration }); }
export function stun(ab, t, duration) { return duration > 0 ? addMod(ab, t, 'modifier_stunned', duration) : null; }
export function enemiesNear(ab, x, y, radius) { return ab.owner.world.enemiesInRadius(ab.owner, x, y, radius); }
export function alliesNear(ab, x, y, radius) { return ab.owner.world.alliesInRadius(ab.owner, x, y, radius); }
export function mhit(m, t, amount, type, flags = 0) { return m.parent.world.damage(m.caster, t, amount, type || (m.ability ? m.ability.dmgType : MAGICAL), flags, m.ability); }

// ---------------------------------------------------------------- common ability shapes
// Direct damage (+ optional stun / debuff) on a unit, around a point, or around the caster.
//   o: { damage, type, stun, mod, modDur, radius, center: 'target'|'self'|'point', speed, also(ab,t), prio, cond, ai, fid, note }
export function nuke(name, o) {
  const apply = (ab, t) => {
    if (!t.alive) return;
    if (t.st[ST.IMMUNE] > 0 && !ab.pierces && t.team !== ab.owner.team) {
      // debuff immunity: no debuff; damage still lands for area effects (reduced by the immunity's magic resistance)
      if (o.damage !== undefined && o.radius) hit(ab, t, val(o.damage, ab), o.type);
      return;
    }
    if (o.stun !== undefined) stun(ab, t, val(o.stun, ab));
    if (o.mod) addMod(ab, t, o.mod, o.modDur !== undefined ? val(o.modDur, ab) : undefined);
    if (o.damage !== undefined) { const d = val(o.damage, ab); if (d > 0) hit(ab, t, d, o.type); }
    if (o.also) o.also(ab, t);
  };
  return defAbility(name, {
    prio: o.prio, cond: o.cond, ai: o.ai, fid: o.fid, note: o.note, radius: o.center === 'self' ? o.radius : undefined, channel: o.channel, engage: o.engage,
    cast(ab, t, x, y) {
      const w = ab.owner.world;
      const run = (tt) => {
        if (o.radius) {
          const r = val(o.radius, ab);
          const cx = o.center === 'self' ? ab.owner.x : tt ? tt.x : x; const cy = o.center === 'self' ? ab.owner.y : tt ? tt.y : y;
          if (o.skillshot && !tt && w.skillshotHit < 1 && !w.rng.chance(w.skillshotHit)) return;
          const es = enemiesNear(ab, cx, cy, r);
          for (let i = 0; i < es.length; i++) apply(ab, es[i]);
        } else if (tt) apply(ab, tt);
        if (o.after) o.after(ab, tt, x, y);
      };
      if (o.speed && t) w.projectile(ab.owner, t, val(o.speed, ab), run);
      else if (o.delay) w.after(val(o.delay, ab), () => run(t));
      else run(t);
    },
  });
}

// Self buff: cast applies `mod` to the caster for `duration`.
export function selfBuff(name, o) {
  return defAbility(name, {
    prio: o.prio, fid: o.fid, note: o.note, engage: o.engage, radius: o.radius,
    ai: o.ai || ((ab, u) => (u.hasModifier(o.mod) ? null : true)),
    cond: o.cond,
    cast(ab) { addMod(ab, ab.owner, o.mod, o.duration !== undefined ? val(o.duration, ab) : undefined); if (o.also) o.also(ab); },
  });
}

// ---------------------------------------------------------------- common modifier shapes
export function critHook(chance, mult) {
  return function onAttack(m, rec) {
    if (rec.target.isBuilding) return;
    if (m.roll(val(chance, m))) { const c = val(mult, m) / 100; if (c > rec.crit) rec.crit = c; }
  };
}

// chance on hit to stun (+ bonus damage); `cd` = internal cooldown
export function bashHook(o) {
  return function onAttackLanded(m, rec) {
    const t = rec.target; const w = m.parent.world;
    if (!t.alive || t.isBuilding) return;
    if (o.cd !== undefined) { if (w.time < m.x) return; }
    if (!m.roll(val(o.chance, m) * (o.potency ? rec.potency / 100 : 1))) return;
    if (o.cd !== undefined) m.x = w.time + val(o.cd, m);
    if (o.damage !== undefined) { const d = val(o.damage, m); if (d > 0) w.damage(m.parent, t, d, o.type || MAGICAL, 0, m.ability); }
    if (t.alive && o.stun !== undefined) { if (!(t.st[ST.IMMUNE] > 0 && !o.pierce)) t.addModifier('modifier_stunned', { caster: m.parent, ability: m.ability, duration: val(o.stun, m), pierce: o.pierce }); }
  };
}

// damage over time debuff
export function dot(name, o) {
  return debuff(name, {
    interval: o.interval ?? 1, purge: o.purge, multi: o.multi, stats: o.stats, state: o.state, statusResist: o.statusResist,
    onThink(m) { const d = val(o.damage, m) * (o.perStack ? m.stacks : 1); if (d > 0) mhit(m, m.parent, d, o.type, o.flags || 0); if (o.tick) o.tick(m); },
    onCreated: o.onCreated, onRefresh: o.onRefresh, onDestroy: o.onDestroy, maxStacks: o.maxStacks,
  });
}

// aura: owner keeps `child` applied to units in radius (re-applied every 0.5 s, lingers 0.5 s)
export function aura(name, o) {
  const iv = o.interval ?? 0.5;
  return modifier(name, {
    hidden: true, interval: iv, thinkNow: true, ...o.extra,
    onThink(m) {
      const u = m.parent; const w = u.world;
      const r = val(o.radius, m);
      const list = o.team === 'enemy' ? w.inRadius(u.x, u.y, r, u.team, true) : w.inRadius(u.x, u.y, r, u.team, false);
      for (let i = 0; i < list.length; i++) {
        const t = list[i];
        if (t === u && o.self === false) continue;
        if (o.filter && !o.filter(t, m)) continue;
        t.addModifier(o.child, { caster: u, ability: m.ability, duration: iv + 0.5 });
      }
    },
  });
}

// cone cleave in front of the attacker (widths are full widths, as in the shipped item data); ignores armor
export function cleave(attacker, target, damage, startW, endW, dist, ability) {
  const w = attacker.world;
  const dx = target.x - attacker.x; const dy = target.y - attacker.y;
  const d = Math.sqrt(dx * dx + dy * dy) || 1; const ux = dx / d; const uy = dy / d;
  const us = w.units;
  for (let i = 0; i < us.length; i++) {
    const e = us[i];
    if (!e.alive || e.team === attacker.team || e === target || e.isBuilding) continue;
    const rx = e.x - attacker.x; const ry = e.y - attacker.y;
    const along = rx * ux + ry * uy;
    if (along < 0 || along > dist) continue;
    const half = (startW + (endW - startW) * (along / dist)) / 2;
    // [L] measured in Hero Demo: cleave damage is reduced by the armor of each unit it hits
    if (Math.abs(rx * uy - ry * ux) <= half + e.def.hull) w.damage(attacker, e, damage, PHYSICAL, F_SECONDARY, ability);
  }
}

// absorb shield: kind = 'all' | 'physical' | 'magical'; amount from m.data.left
export function barrier(name, kind, extra = {}) {
  return modifier(name, {
    purge: 'basic', ...extra,
    postMit(m, d) {
      if (d.amount <= 0 || (d.flags & F_HP_LOSS)) return;
      if (kind === 'physical' && d.type !== PHYSICAL) return;
      if (kind === 'magical' && d.type !== MAGICAL) return;
      const a = Math.min(d.amount, m.data.left);
      d.amount -= a; m.data.left -= a;
      if (m.data.left <= 1e-6) m.remove();
    },
  });
}
export function giveBarrier(ab, t, mod, amount, duration) { return t.addModifier(mod, { caster: ab.owner, ability: ab, duration, data: { left: amount } }); }

// instant attack helper (extra attacks that are not part of the normal attack cycle)
export function extraAttack(attacker, target, opts) { if (attacker.alive && target.alive) attacker.world.launchAttack(attacker, target, opts); }

// AI helper for gap closers (blink / leap / charge): cast when the target is out of attack reach by more than `min`
export const gapAI = (min = 200) => (ab, u, t) => { if (!t) return null; const gap = u.rangeTo(t) - u.attackRange; if (gap <= min) return null; const r = ab.castRange(); return r > 0 && u.distTo(t) > r + 400 ? null : (ab.def.behavior.includes('UNIT_TARGET') ? { target: t } : { x: t.x, y: t.y }); };
// AI helper: cast when own health fraction is below `frac`
export const lowHpAI = (frac) => (ab, u) => (u.hp / u.maxHp < frac ? true : null);
// AI helper: cast only when the target is within `key` (ability value name or number) of the caster
export const nearAI = (key, pad = 0) => (ab, u, t) => (t && u.distTo(t) <= (typeof key === 'number' ? key : ab.v(key)) + pad ? true : null);

// Area effect that persists at a point: calls tick(enemy) for every enemy inside, every `interval`, for `duration`.
export function zone(ab, x, y, o) {
  const u = ab.owner; const w = u.world;
  const n = Math.max(1, Math.round(val(o.duration, ab) / o.interval));
  const r = val(o.radius, ab);
  for (let i = 0; i < n; i++) {
    w.after((o.delay ? val(o.delay, ab) : 0) + i * o.interval, () => {
      const list = o.allies ? w.inRadius(x, y, r, u.team, false) : w.inRadius(x, y, r, u.team, true);
      for (let k = 0; k < list.length; k++) o.tick(list[k], i);
    });
  }
}
// bounce from unit to unit: calls fn(target, index) for up to `count` distinct enemies within `range` of the previous one
export function chain(u, first, count, range, fn, delay = 0) {
  const w = u.world; const seen = new Set(); let cur = first; let i = 0;
  const step = () => {
    if (!cur || i >= count) return;
    seen.add(cur);
    if (cur.alive) fn(cur, i);
    i++;
    let best = null; let bd = range * range;
    for (const e of w.units) { if (!e.alive || e.team === u.team || seen.has(e) || e.st[ST.OUT] > 0) continue; const dx = e.x - cur.x; const dy = e.y - cur.y; const d = dx * dx + dy * dy; if (d <= bd) { bd = d; best = e; } }
    cur = best;
    if (cur && i < count) { if (delay > 0) w.after(delay, step); else step(); }
  };
  step();
}

// ---------------------------------------------------------------- more helpers
export const silence = (ab, t, d) => addMod(ab, t, 'modifier_silenced', d);
export const root = (ab, t, d) => addMod(ab, t, 'modifier_rooted', d);
export const disarm = (ab, t, d) => addMod(ab, t, 'modifier_disarmed', d);
export const fear = (ab, t, d) => addMod(ab, t, 'modifier_feared', d);
export const taunt = (ab, t, d) => addMod(ab, t, 'modifier_taunted', d);
export const hex = (ab, t, d, ms = 140) => addMod(ab, t, 'modifier_hexed', d, { data: { ms } });
export const healUnit = (ab, t, amount) => t.heal(amount, ab.owner, ab);
// push `e` away from (fx, fy) by `dist` (negative = pull towards the point)
export function knockback(e, fx, fy, dist) {
  if (e.st[ST.ROOT] > 0 && dist > 0) return;
  const dx = e.x - fx; const dy = e.y - fy; const d = Math.sqrt(dx * dx + dy * dy);
  if (d < 1e-6) { e.x += dist; return; }
  const k = dist < 0 ? Math.max(dist, -d) : dist;
  e.x += dx / d * k; e.y += dy / d * k;
}
// enemies of ab.owner within `width` (full width) of the segment (x1,y1)-(x2,y2)
export function enemiesInLine(ab, x1, y1, x2, y2, width) {
  const u = ab.owner; const out = []; const us = u.world.units;
  const vx = x2 - x1; const vy = y2 - y1; const len2 = vx * vx + vy * vy || 1; const half = width / 2;
  for (let i = 0; i < us.length; i++) {
    const e = us[i];
    if (!e.alive || e.team === u.team || e.st[ST.OUT] > 0) continue;
    let k = ((e.x - x1) * vx + (e.y - y1) * vy) / len2; if (k < 0) k = 0; else if (k > 1) k = 1;
    const px = x1 + vx * k - e.x; const py = y1 + vy * k - e.y;
    if (px * px + py * py <= (half + e.def.hull) * (half + e.def.hull)) out.push(e);
  }
  return out;
}
// line skillshot from the caster towards (x, y) with fixed `length`
export function lineFromCaster(ab, x, y, length, width) {
  const u = ab.owner; const dx = x - u.x; const dy = y - u.y; const d = Math.sqrt(dx * dx + dy * dy) || 1;
  return enemiesInLine(ab, u.x, u.y, u.x + dx / d * length, u.y + dy / d * length, width);
}
export const summon = (ab, unitName, opts) => ab.owner.world.summon(ab.owner, unitName, opts);
// Attack modifier that costs mana per attack ("orb", autocast assumed on).
//   o: { launch(m, rec), land(m, rec), free: true when it costs nothing, buildings: false }
export function orbHooks(o) {
  return {
    onAttack(m, rec) {
      const u = m.parent;
      if (rec.secondary || (rec.target.isBuilding && !o.buildings)) return;
      if (!o.free && !u.world.freeSpells) { const cost = m.ability.manaCost(); if (u.mana < cost) return; u.mana -= cost; }
      (rec.data ||= {})[m.name] = true;
      if (o.launch) o.launch(m, rec);
    },
    onAttackLanded(m, rec) { if (rec.data && rec.data[m.name] && rec.target.alive && o.land) o.land(m, rec); },
  };
}
