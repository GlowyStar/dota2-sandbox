// Hero abilities, part 5: Invoker, Chen, Monkey King, Alchemist, Death Prophet, Hoodwink, Muerta, Clockwerk, Tiny, Abaddon, Jakiro,
// Shadow Shaman. Every number is read from the shipped data by value name. Literals are structural only (tick steps, geometry) or
// quoted from a tooltip note that carries no value name; each of those is explained in the `note` of the ability that uses it.
// Where the tooltip leaves a unit (flat or %) or a detail open, the shipped value labels, modifier tooltips and patch-note texts were
// used to settle it; one flight-geometry constant (Exorcism spirits) is an outright assumption and is marked as such.
// Trees: the sandbox has none. Trees planted by an ability (Hoodwink) are tracked exactly; where an ability cannot be used at all
// without a tree (Tiny's Tree Grab / Tree Volley, Monkey King's perch) a tree within reach is assumed and the note says so.
import { defAbility, modifier, buff, debuff, passive, hit, addMod, stun, root, hex, enemiesNear, alliesNear, mhit, dot, aura, zone, knockback,
  summon, nearAI, ST, C, PHYSICAL, MAGICAL, PURE, F_ATTACK, F_HP_LOSS, F_SECONDARY, F_PIERCE } from '../engine/dsl.mjs';

const na = (name, note) => defAbility(name, { fid: 'n/a', note });

// ---------------------------------------------------------------- shared helpers
const NT = { target: null };                                   // decision for a no-target cast whose range was already checked
const realHero = (e) => e.isHero && !e.isIllusion;
const canHit = (ab, t) => !!t && t.targetable() && (ab.pierces || !(t.st[ST.IMMUNE] > 0));
const tgt = (ab, t) => (canHit(ab, t) ? { target: t } : null); // unit-target decision that never retries against debuff immunity
const avgDamage = (u) => (u.dmgMin + u.dmgMax) / 2 + u.dmgBonus;
// rules.skillshotHit: chance that a dodgeable ground / line spell was aimed well (1 = always)
const aimed = (w) => !(w.skillshotHit < 1) || w.rng.chance(w.skillshotHit);
function dirTo(ax, ay, bx, by) {
  const dx = bx - ax; const dy = by - ay; const d = Math.sqrt(dx * dx + dy * dy);
  return d > 1e-6 ? { x: dx / d, y: dy / d, d } : { x: 1, y: 0, d: 0 };
}
const curTarget = (u) => (u.ai && u.ai.target && u.ai.target.alive ? u.ai.target : u.world.nearestEnemy(u));
// where `t` will be in `T` seconds if it keeps walking towards whatever it is attacking (used to lead delayed spells)
function predict(t, T) {
  const g = t.orderTarget;
  if (!(T > 0) || !g || !g.alive || t.cantAct() || t.st[ST.ROOT] > 0 || !(t.ms > 0)) return { x: t.x, y: t.y };
  const f = dirTo(t.x, t.y, g.x, g.y);
  const go = Math.min(t.ms * T, Math.max(0, f.d - (t.attackRange + t.def.hull + g.def.hull)));
  return { x: t.x + f.x * go, y: t.y + f.y * go };
}
// units of the other team (or of u's team when `allies`) swept by a circle that moves from (x1, y1) along the unit vector (ux, uy)
// for `len` while its radius goes from r0 to r1 (a line when r0 = r1, a cone otherwise; both ends are rounded, so the reach is
// len + r1). Returns [{ e, along }] sorted by distance along the axis.
function inCone(u, x1, y1, ux, uy, len, r0, r1, allies = false) {
  const out = []; const us = u.world.units;
  for (let i = 0; i < us.length; i++) {
    const e = us[i];
    if (!e.alive || e === u || (e.team === u.team) !== allies || e.st[ST.OUT] > 0) continue;
    const rx = e.x - x1; const ry = e.y - y1;
    const along = rx * ux + ry * uy;
    const k = along <= 0 || !(len > 0) ? 0 : along >= len ? 1 : along / len;
    const px = rx - ux * len * k; const py = ry - uy * len * k; // offset from the nearest point of the axis
    const lim = r0 + (r1 - r0) * k + e.def.hull;
    if (px * px + py * py <= lim * lim) out.push({ e, along: len * k });
  }
  return out.sort((a, b) => a.along - b.along);
}
// distance from a unit to the segment (x1,y1)-(x2,y2)
function segDist(e, x1, y1, x2, y2) {
  const vx = x2 - x1; const vy = y2 - y1; const l2 = vx * vx + vy * vy || 1;
  let k = ((e.x - x1) * vx + (e.y - y1) * vy) / l2; if (k < 0) k = 0; else if (k > 1) k = 1;
  const px = x1 + vx * k - e.x; const py = y1 + vy * k - e.y;
  return Math.sqrt(px * px + py * py);
}
// "Linked" / hidden sub-abilities level together with their main ability in the game; the engine levels every ability separately.
function syncLevel(sub, main) { if (sub && main && sub.level !== main.level) sub.setLevel(main.level); }
// lowest-health allied hero (optionally including the caster) within `range` of the caster
function weakestAlly(u, range, self = true, filter = null) {
  let best = null; let bp = Infinity;
  for (const a of u.world.units) {
    if (!a.alive || a.team !== u.team || !a.isHero || a.isIllusion || (a === u && !self) || u.distTo(a) > range || (filter && !filter(a))) continue;
    const p = a.hp / a.maxHp; if (p < bp) { bp = p; best = a; }
  }
  return best;
}
// units of the caster's team that are currently attacking / chasing `t` (1 = the engine's attack order)
const attackersOf = (t, team) => t.world.units.filter((a) => a.alive && a.team === team && a.order === 1 && a.orderTarget === t);
// The engine pays for a cast and starts its cooldown before the script runs. An order the game refuses (a target the ability
// cannot be used on) is undone here: mana, cooldown and charge are given back and nothing else happens.
function refuseCast(ab) {
  const u = ab.owner;
  if (u.world.freeSpells) return;
  u.mana = Math.min(u.maxMana, u.mana + ab.manaCost());
  const mc = ab.vals.AbilityCharges || 0;
  if (mc > 0 && ab.charges < mc) { ab.charges++; if (ab.charges >= mc) ab.chargeEnd = 0; }
  ab.cdEnd = 0; ab.casts--; u.mCasts--;
}

// ================================================================ Invoker
// Model. Orb levels are the levels of invoker_quas / _wex / _exort; every invoked spell reads its numbers at those levels through the
// `levelkey` of each value (iv). Invoke is modelled as a pair of slots: Invoker holds max_invoked_spells spells, swapping one in costs
// the Invoke cooldown (reduced per orb level); he enters a fight with two spells already invoked. Active orb instances are assumed
// fixed: the three instances are spread evenly over the learned orbs (one Quas, one Wex, one Exort once all three are learned).
// Aghanim's Scepter / Shard: Invoker picks one of three options (1 = Quas, 2 = Wex, 3 = Exort; `var` entries in the data). Option 3 is
// assumed unless the unit carries modifier_invoker_invoke_scepter_option / _shard_option with stacks 1..3 (scenario `mods`); with
// rules.fresh no Scepter option is picked yet (as live: the game waits for the player's choice and grants nothing meanwhile).
const INV_ORBS = { quaslevel: 'invoker_quas', wexlevel: 'invoker_wex', exortlevel: 'invoker_exort' };
const INV_KEY = { invoker_quas: 'quaslevel', invoker_wex: 'wexlevel', invoker_exort: 'exortlevel' };
const INV_OPTION = { invoker_quas: 1, invoker_wex: 2, invoker_exort: 3 };
const INV_DEFAULT_OPTION = 3;
const INV_ORB_SLOTS = 3; // "Invoker can only have 3 of any instance" (tooltip note; no value carries it)
for (const kind of ['scepter', 'shard']) modifier(`modifier_invoker_invoke_${kind}_option`, { hidden: true, purge: 'none', onCreated(m) { m.parent.dirty = true; } });

function invOption(u, kind) {
  if (kind === 'scepter' ? !u.hasScepter : !u.hasShard) return 0;
  const m = u.findModifier(`modifier_invoker_invoke_${kind}_option`);
  if (m && m.stacks >= 1 && m.stacks <= 3) return m.stacks;
  // [L] measured in Hero Demo (invoker_exort.sc): a Scepter that was just given carries modifier_item_aghanims_scepter_wait_for_upgrade_selected
  // and grants nothing (Exort stayed level 8) until the player picks an option; a freshly appeared hero therefore has none
  if (kind === 'scepter' && u.world.fresh) return 0;
  return INV_DEFAULT_OPTION;
}
// same operators as the engine's value resolution
function invOp(v, mod, lvl) {
  const a = mod[2]; const x = a[Math.min(lvl, a.length) - 1];
  if (mod[1]) return mod[0] === '=' ? x : v * (1 + x / 100);
  return mod[0] === '=' ? x : mod[0] === 'x' ? v * x : v + x;
}
function invOrbLevel(u, key) {
  const a = u.findAbility(INV_ORBS[key]);
  if (!a || a.level < 1) return 0;
  const e = a.def.vals.scepter_bonus_levels; const k = 'scepter_' + invOption(u, 'scepter');
  return a.level + (e && e.var && e.var[k] && INV_OPTION[a.name] === invOption(u, 'scepter') ? invOp(e.v[0], e.var[k], 1) : 0);
}
// Invoker value: entry picked by the orb level named in `levelkey`, then talents and the chosen Scepter / Shard option
function iv(ab, name) {
  const e = ab.def.vals[name]; const u = ab.owner;
  if (e === undefined) return 0;
  if (Array.isArray(e)) return ab.v(name);
  let lvl = e.levelkey ? invOrbLevel(u, e.levelkey) : INV_KEY[ab.name] ? invOrbLevel(u, INV_KEY[ab.name]) : ab.level;
  if (lvl < 1) lvl = 1;
  let v = e.v[Math.min(lvl, e.v.length) - 1];
  if (e.t && u.talents.size) for (const tn in e.t) if (u.talents.has(tn)) v = invOp(v, e.t[tn], lvl);
  if (e.var) { const sc = 'scepter_' + invOption(u, 'scepter'); const sh = 'shard_' + invOption(u, 'shard'); for (const k in e.var) if (k === sc || k === sh) v = invOp(v, e.var[k], lvl); }
  return v;
}
// orbs actually invoked (cast) by this Invoker, oldest first; null until he casts one
const INV_CAST = new WeakMap();
function invInstances(u, orb) {
  const cast = INV_CAST.get(u);
  if (cast) { let k = 0; for (const o of cast) if (o === orb) k++; return k; }
  if (u.world.fresh) return 0; // [L] a Invoker that has just appeared has no orb instance (Hero Demo)
  const learned = Object.values(INV_ORBS).filter((n) => { const a = u.findAbility(n); return a && a.level > 0; });
  let n = 0;
  for (let i = 0; i < INV_ORB_SLOTS && learned.length; i++) if (learned[i % learned.length] === orb) n++;
  return n;
}
const INV_ORB_NOTE = 'per-level attribute (+1 level with the matching Scepter option); casting the orb adds an instance (at most 3, the oldest is replaced), as measured live. Before any orb is cast the instances are absent with rules.fresh (as live) and otherwise assumed spread evenly over the learned orbs (1 Quas + 1 Wex + 1 Exort once all are learned). manual: the controller does not juggle orbs';
function invOrbCast(ab) {
  const u = ab.owner; const list = INV_CAST.get(u) || [];
  list.push(ab.name);
  while (list.length > INV_ORB_SLOTS) list.shift();
  INV_CAST.set(u, list); u.dirty = true;
}
const invOrb = (name, stats) => {
  modifier('modifier_' + name, { hidden: true, stats });
  defAbility(name, { mods: ['modifier_' + name], illusion: true, manual: true, fid: 'approx', note: INV_ORB_NOTE, cast: invOrbCast });
};
invOrb('invoker_quas', (m) => ({ str: m.v('strength_bonus') * invOrbLevel(m.parent, 'quaslevel'), hpRegen: iv(m.ability, 'hp_regen_per_instance') * invInstances(m.parent, 'invoker_quas') }));
invOrb('invoker_wex', (m) => { const n = invInstances(m.parent, 'invoker_wex'); return { agi: m.v('agility_bonus') * invOrbLevel(m.parent, 'wexlevel'), msPct: iv(m.ability, 'move_speed_per_instance') * n, as: iv(m.ability, 'attack_speed_per_instance') * n }; });
invOrb('invoker_exort', (m) => ({ int: m.v('intelligence_bonus') * invOrbLevel(m.parent, 'exortlevel'), dmg: iv(m.ability, 'bonus_damage_per_instance') * invInstances(m.parent, 'invoker_exort') }));
na('invoker_empty1', 'placeholder slot for an invoked spell');
na('invoker_empty2', 'placeholder slot for an invoked spell');
defAbility('invoker_invoke', {
  fid: 'approx', manual: true,
  // an explicit Invoke order (scenario / scene): the cooldown starts with the orb reduction, nothing is swapped in (no orb combination is tracked)
  cast(ab) { const u = ab.owner; const w = u.world; if (w.freeSpells) return; let levels = 0; for (const k in INV_ORBS) levels += invOrbLevel(u, k); ab.cdEnd = w.time + Math.max(0, ab.v('AbilityCooldown') - ab.v('cooldown_reduction_per_orb') * levels) * u.cdrMul; },
  note: 'not cast as a separate order: the controller invokes a spell the moment it wants to cast one that is not held (logged as a cast). Two slots (max_invoked_spells); the held spell with the longer remaining cooldown is replaced; cooldown = AbilityCooldown - cooldown_reduction_per_orb x total orb levels; the fight starts with the two most wanted spells already invoked; a spell ordered directly while not held is invoked on the spot even if Invoke is on cooldown. Orb juggling takes no time. The bonus ability points at levels 6/12/18 are NOT granted (the engine decides the skill build). Scepter/Shard: option 3 (Exort) unless modifier_invoker_invoke_scepter_option / _shard_option (stacks 1-3) is present',
});

const INV_WANT = {}; const INV_PRIO = []; const invNeeds = new Map();
function invLearned(ab) {
  let need = invNeeds.get(ab.name);
  if (!need) { const s = new Set(); for (const e of Object.values(ab.def.vals)) if (e && e.levelkey) s.add(INV_ORBS[e.levelkey]); need = [...s]; invNeeds.set(ab.name, need); }
  for (const o of need) { const a = ab.owner.findAbility(o); if (!a || a.level < 1) return false; }
  return true;
}
function invState(u) {
  const inv = u.findAbility('invoker_invoke');
  if (!inv || inv.level < 1) return null;
  return inv.data || (inv.data = { slots: [], init: false, inv });
}
const invAllowed = (u, a) => !u.ai || !u.ai.castables || u.ai.castables.includes(a);
function invDo(u, ab, st) {
  const inv = st.inv; const w = u.world;
  if (st.slots.includes(ab.name)) return;
  if (st.slots.length >= inv.v('max_invoked_spells')) {
    let drop = 0; let worst = -1;
    for (let i = 0; i < st.slots.length; i++) { const h = u.findAbility(st.slots[i]); const cd = h ? h.cdRemaining() : 0; if (cd >= worst) { worst = cd; drop = i; } }
    st.slots.splice(drop, 1);
  }
  st.slots.unshift(ab.name);
  if (!w.freeSpells) { let levels = 0; for (const k in INV_ORBS) levels += invOrbLevel(u, k); inv.cdEnd = w.time + Math.max(0, inv.v('AbilityCooldown') - inv.v('cooldown_reduction_per_orb') * levels) * u.cdrMul; }
  inv.casts++; u.mCasts++;
  if (w.log) w.logEvent('cast', u, null, inv.name, 0);
}
function invInit(u, t, w, st) {
  st.init = true;
  const all = INV_PRIO.slice().sort((a, b) => b[1] - a[1]).map((p) => u.findAbility(p[0])).filter((a) => a && a.level > 0 && invLearned(a) && invAllowed(u, a) && !(a.script.manual && !(u.ai && u.ai.castables && u.ai.castables.includes(a))));
  const max = st.inv.v('max_invoked_spells');
  for (const a of all.filter((x) => INV_WANT[x.name](x, u, t, w)).concat(all)) { if (st.slots.length >= max) break; if (!st.slots.includes(a.name)) st.slots.push(a.name); }
}
function invSpell(name, o) {
  INV_WANT[name] = o.want; INV_PRIO.push([name, o.prio]);
  defAbility(name, {
    prio: o.prio, manual: o.manual, fid: o.fid, note: o.note,
    ai(ab, u, t, w) {
      const st = invState(u);
      if (!st || !invLearned(ab)) return null;
      if (!st.init) { if (!t) return null; invInit(u, t, w, st); }
      if (name !== 'invoker_tornado' && invTornadoFlying(u, w)) return null; // wait and see whom the Tornado picks up
      const d = o.want(ab, u, t, w);
      if (!d) return null;
      if (st.slots.includes(name)) return d;
      if (!w.freeSpells && !st.inv.cdReady()) return null;
      // spend what is already invoked before swapping it out
      for (const hn of st.slots) { const h = u.findAbility(hn); if (h && h.ready() && invAllowed(u, h) && INV_WANT[hn](h, u, t, w)) return null; }
      invDo(u, ab, st);
      return d;
    },
    cast(ab, t, x, y) { const st = invState(ab.owner); if (st && !st.slots.includes(name)) invDo(ab.owner, ab, st); o.cast(ab, t, x, y); },
  });
}

// combo timing around his own Tornado: nothing else is started while it flies; delayed spells are then timed to land with the victim
const invTornadoFlying = (u, w) => { const tor = u.findAbility('invoker_tornado'); return !!(tor && tor.data && w.time < tor.data.flight); };
function invLifted(u) {
  const tor = u.findAbility('invoker_tornado'); const e = tor && tor.data ? tor.data.e : null;
  const m = e && e.alive ? e.findModifier('modifier_invoker_tornado', u) : null;
  return m ? { e, left: m.remaining() } : null;
}

// --- Cold Snap
function coldSnapFreeze(m) {
  const t = m.parent; const ab = m.ability;
  m.x = t.world.time + iv(ab, 'freeze_cooldown');
  t.addModifier('modifier_stunned', { caster: m.caster, ability: ab, duration: ab.v('freeze_duration') });
  m.y = 1; mhit(m, t, iv(ab, 'freeze_damage'), MAGICAL); m.y = 0;
}
debuff('modifier_invoker_cold_snap', {
  onCreated(m) { coldSnapFreeze(m); },
  onTakeDamage(m, d) { if (m.y === 1 || !(m.parent.hp > 0) || d.dealt <= m.v('damage_trigger') || m.parent.world.time + 1e-9 < m.x) return; coldSnapFreeze(m); },
});
invSpell('invoker_cold_snap', {
  prio: 72, fid: 'full',
  want: (ab, u, t) => (t && !t.hasModifier('modifier_invoker_cold_snap') ? tgt(ab, t) : null),
  cast(ab, t) { t.removeModifierByName('modifier_invoker_cold_snap'); addMod(ab, t, 'modifier_invoker_cold_snap', iv(ab, 'duration')); },
});

// --- Ghost Walk
debuff('modifier_invoker_ghost_walk_slow', { purge: 'none', stats: (m) => ({ msPct: m.data.slow }) });
buff('modifier_invoker_ghost_walk', {
  purge: 'none', state: ['INVIS'], interval: 0.5, thinkNow: true,
  stats: (m) => ({ hpRegen: iv(m.ability, 'health_regen'), manaRegen: iv(m.ability, 'mana_regen'), msPct: iv(m.ability, 'self_slow') }),
  onThink(m) {
    const u = m.parent; const ab = m.ability; const wall = u.findAbility('invoker_ice_wall');
    const burn = iv(ab, 'apply_ice_wall_debuff') > 0 && wall ? iv(wall, 'damage_per_second') * iv(ab, 'ice_wall_damage_multiplier') * 0.5 : 0;
    for (const e of u.world.enemiesInRadius(u, u.x, u.y, ab.v('area_of_effect'))) {
      e.addModifier('modifier_invoker_ghost_walk_slow', { caster: u, ability: ab, duration: ab.v('aura_fade_time'), data: { slow: iv(ab, 'enemy_slow') } });
      if (burn > 0 && realHero(e) && !(e.st[ST.IMMUNE] > 0)) u.world.damage(u, e, burn, MAGICAL, 0, ab);
    }
  },
  onAttack(m) { m.remove(); },
  onCast(m, ev) { if (ev.ability !== m.ability) m.remove(); },
});
invSpell('invoker_ghost_walk', {
  prio: 20, manual: true, fid: 'approx',
  note: 'manual (escape tool: the default controller never retreats; list it explicitly to use it). Invisibility ends on the first attack or cast, as for other invisibility in this sandbox (the tooltip does not state the break rule); regen, self speed change and the slow aura (0.5 s pulses, lingering aura_fade_time) are modelled; Shard option 1: Ice Wall DPS x multiplier to enemy heroes in the area',
  want: (ab, u) => (u.hp / u.maxHp < 0.35 && !u.hasModifier('modifier_invoker_ghost_walk') ? NT : null),
  cast(ab) { addMod(ab, ab.owner, 'modifier_invoker_ghost_walk', ab.v('duration')); },
});

// --- Tornado
debuff('modifier_invoker_tornado', {
  purge: 'none', state: ['OUT', 'INVULN'],
  onDestroy(m) { const t = m.parent; if (t.alive) mhit(m, t, m.data.dmg, MAGICAL); },
});
invSpell('invoker_tornado', {
  prio: 78, fid: 'approx',
  note: 'straight line from Invoker through the target point: enemies within area_of_effect of the path are lifted when the tornado reaches them (invulnerable and out of play for lift_duration, damage on landing, basic dispel of their buffs). Scepter option 2: twisters every twister_distance_interval along the path deal twister_damage per second (half to creeps) in twister_radius for twister_duration',
  want: (ab, u, t) => (t && !t.cantAct() && !(t.st[ST.IMMUNE] > 0) && u.distTo(t) <= iv(ab, 'travel_distance') ? { x: t.x, y: t.y } : null),
  cast(ab, t, x, y) {
    const u = ab.owner; const w = u.world; const len = iv(ab, 'travel_distance'); const speed = ab.v('travel_speed'); const r = ab.v('area_of_effect');
    const d = dirTo(u.x, u.y, x, y); const sx = u.x; const sy = u.y; const ex = sx + d.x * len; const ey = sy + d.y * len;
    const dmg = ab.v('base_damage') + iv(ab, 'quas_damage') + iv(ab, 'wex_damage'); const lift = iv(ab, 'lift_duration');
    const st = (ab.data = { e: null, flight: w.time });
    if (aimed(w)) {
      for (const h of inCone(u, sx, sy, d.x, d.y, len, r, r)) {
        st.flight = Math.max(st.flight, w.time + h.along / speed + 0.05);
        w.after(h.along / speed, () => {
          const e = h.e;
          if (!e.alive || e.st[ST.OUT] > 0 || e.st[ST.IMMUNE] > 0 || segDist(e, sx, sy, ex, ey) > r + e.def.hull) return;
          e.purge({ debuffs: false, buffs: true });
          if (e.addModifier('modifier_invoker_tornado', { caster: u, ability: ab, duration: lift, data: { dmg } }) && (!st.e || (e.isHero && !st.e.isHero))) st.e = e;
        });
      }
    }
    const gap = iv(ab, 'twister_distance_interval');
    if (gap > 0) {
      const tick = ab.v('twister_tick_rate'); const life = iv(ab, 'twister_duration'); const tr = ab.v('twister_radius'); const dps = iv(ab, 'twister_damage'); const count = Math.floor(len / gap);
      for (let i = 1; i * tick <= len / speed + life + 1e-6; i++) {
        w.after(i * tick, () => {
          const now = i * tick;
          for (const e of w.units) {
            if (!e.alive || e.team === u.team || e.st[ST.OUT] > 0) continue;
            const along = (e.x - sx) * d.x + (e.y - sy) * d.y;
            const k = Math.min(count, Math.max(1, Math.round(along / gap)));
            const born = k * gap / speed;
            if (count < 1 || now < born || now > born + life) continue;
            const px = sx + d.x * k * gap - e.x; const py = sy + d.y * k * gap - e.y;
            if (px * px + py * py <= (tr + e.def.hull) * (tr + e.def.hull)) hit(ab, e, dps * tick * (e.heroLike ? 1 : 0.5), MAGICAL);
          }
        });
      }
    }
  },
});

// --- E.M.P.
invSpell('invoker_emp', {
  prio: 68, fid: 'full', note: 'cast on a target that still has at least half of mana_burned; on a Tornado victim it is timed to go off after the landing',
  want(ab, u, t) {
    const L = invLifted(u); const x = L ? L.e : t;
    if (!x || x.maxMana <= 0 || x.mana < iv(ab, 'mana_burned') * 0.5 || x.st[ST.IMMUNE] > 0 || (L && iv(ab, 'delay') < L.left)) return null;
    return { x: x.x, y: x.y };
  },
  cast(ab, t, x, y) {
    const u = ab.owner; const w = u.world; const delay = iv(ab, 'delay'); const r = ab.v('area_of_effect'); const drag = iv(ab, 'drag_speed');
    if (drag > 0) { const step = 0.1; for (let k = 1; k * step < delay; k++) w.after(k * step, () => { for (const e of enemiesNear(ab, x, y, r)) if (!(e.st[ST.IMMUNE] > 0)) knockback(e, x, y, -drag * step); }); }
    w.after(delay, () => {
      if (!aimed(w)) return;
      let got = 0;
      for (const e of enemiesNear(ab, x, y, r)) {
        if (e.st[ST.IMMUNE] > 0 || e.maxMana <= 0) continue;
        const burned = e.burnMana(iv(ab, 'mana_burned'));
        if (burned <= 0) continue;
        hit(ab, e, burned * iv(ab, 'damage_per_mana_pct') / 100, MAGICAL);
        if (realHero(e)) got += burned;
      }
      if (got > 0 && u.alive) u.giveMana(got * ab.v('self_mana_restore_pct') / 100);
    });
  },
});

// --- Alacrity
buff('modifier_invoker_alacrity', { stats: (m) => ({ as: m.data.as, dmg: m.data.dmg, attackRange: m.data.range }) });
invSpell('invoker_alacrity', {
  prio: 60, fid: 'full', note: 'cast on the allied hero within range with the highest attack DPS (Invoker included)',
  want(ab, u, t) {
    if (!t) return null;
    let best = null; let bd = 0;
    for (const a of u.world.units) {
      if (!a.alive || a.team !== u.team || !a.isHero || a.isIllusion || !a.canAttack || a.hasModifier('modifier_invoker_alacrity') || u.distTo(a) > ab.castRange()) continue;
      const dps = avgDamage(a) / a.attackInterval; if (dps > bd) { bd = dps; best = a; }
    }
    return best ? { target: best } : null;
  },
  cast(ab, t) { const tt = t || ab.owner; tt.removeModifierByName('modifier_invoker_alacrity'); tt.addModifier('modifier_invoker_alacrity', { caster: ab.owner, ability: ab, duration: ab.v('duration'), data: { as: iv(ab, 'bonus_attack_speed'), dmg: iv(ab, 'bonus_damage'), range: iv(ab, 'bonus_attack_range') } }); },
});

// --- Chaos Meteor
dot('modifier_invoker_chaos_meteor_burn', { damage: (m) => m.data.dps, type: MAGICAL, interval: 1 });
invSpell('invoker_chaos_meteor', {
  prio: 75, fid: 'approx',
  note: 'the meteor lands after land_time, then rolls away from Invoker at travel_speed for travel_distance, hitting enemies under it every damage_interval; the burn is one refreshed debuff ticking once per second; extra meteors from the talent land on the same spot and roll the same way (their real spread is not in the data)',
  want(ab, u, t) {
    const L = invLifted(u);
    if (L) return ab.v('land_time') + ab.v('AbilityCastPoint') >= L.left ? { x: L.e.x, y: L.e.y } : null;
    return t ? predict(t, ab.v('land_time')) : null;
  },
  cast(ab, t, x, y) {
    const u = ab.owner; const w = u.world; const d = dirTo(u.x, u.y, x, y); const n = Math.max(1, Math.round(iv(ab, 'meteor_count')));
    const step = ab.v('damage_interval'); const speed = ab.v('travel_speed'); const dist = iv(ab, 'travel_distance'); const r = iv(ab, 'area_of_effect');
    for (let k = 0; k < n; k++) {
      w.after(ab.v('land_time'), () => {
        if (!aimed(w)) return;
        for (let i = 0; i * step * speed <= dist + 1e-6; i++) {
          w.after(i * step, () => {
            for (const e of enemiesNear(ab, x + d.x * speed * i * step, y + d.y * speed * i * step, r)) {
              hit(ab, e, iv(ab, 'main_damage'), MAGICAL);
              if (e.alive) e.addModifier('modifier_invoker_chaos_meteor_burn', { caster: u, ability: ab, duration: ab.v('burn_duration') + 0.05, data: { dps: iv(ab, 'burn_dps') } });
            }
          });
        }
      });
    }
  },
});

// --- Forge Spirit (the spirit's armor melt is the unit ability forged_spirit_melting_strike; a fallback applies it when that ability has no script)
debuff('modifier_invoker_forge_spirit_melt_debuff', { purge: 'none', multi: 'stack', maxStacks: (m) => m.data.max || Infinity, stats: (m) => ({ armor: -m.data.per * m.stacks }) });
modifier('modifier_invoker_forge_spirit_melt', {
  hidden: true, purge: 'none',
  onAttackLanded(m, rec) {
    const t = rec.target; const sa = m.parent.findAbility('forged_spirit_melting_strike');
    if (!t.alive || !t.isHero || !sa) return;
    t.addModifier('modifier_invoker_forge_spirit_melt_debuff', { caster: m.parent, ability: m.ability, duration: sa.v('duration'), data: { per: iv(m.ability, 'armor_per_attack'), max: sa.v('max_armor_removed') } });
  },
});
function invForge(u, n, x, y) {
  const fs = u.findAbility('invoker_forge_spirit'); const w = u.world;
  if (!fs) return;
  const list = (fs.data ||= []);
  for (let i = 0; i < n; i++) {
    const dmg = iv(fs, 'spirit_damage');
    const s = w.summon(u, 'npc_dota_invoker_forged_spirit', { x: x + 70 * (i - (n - 1) / 2), y: y + 60, duration: iv(fs, 'spirit_duration'), abilityLevel: Math.max(1, invOrbLevel(u, 'exortlevel')),
      ovr: { hp: iv(fs, 'spirit_hp'), mana: iv(fs, 'spirit_mana'), armor: iv(fs, 'spirit_armor'), range: iv(fs, 'spirit_attack_range'), dmgMin: dmg, dmgMax: dmg } });
    const carried = []; // talents of Invoker that modify values of the spirit's own abilities
    for (const a of s.abilities) for (const e of Object.values(a.def.vals)) if (e && e.t) for (const tn in e.t) if (u.talents.has(tn) && !carried.includes(tn)) carried.push(tn);
    if (carried.length) s.setTalents(carried);
    const melt = s.findAbility('forged_spirit_melting_strike');
    if (melt && !melt.script) s.addModifier('modifier_invoker_forge_spirit_melt', { caster: u, ability: fs });
    s.recompute(); s.hp = s.maxHp; s.mana = s.maxMana;
    list.push(s);
  }
}
invSpell('invoker_forge_spirit', {
  prio: 66, fid: 'approx',
  note: 'spirit count = lower of extra_spirit_count_quas / _exort (the tooltip labels them "spirit count"); health, range, duration by Quas, damage, armor, mana by Exort; a new cast replaces living spirits. Armor melt comes from the spirit\'s own ability forged_spirit_melting_strike (level = Exort level, capped at 8; scripted elsewhere); when that ability has no script a built-in fallback applies armor_per_attack per hit, up to max_armor_removed stacks',
  want(ab, u, t) { if (!t || u.distTo(t) > 1000) return null; return (ab.data || []).some((s) => s.alive) ? null : NT; },
  cast(ab) {
    const u = ab.owner;
    for (const s of ab.data || []) if (s.alive) u.world.kill(s, null, null, true);
    ab.data = [];
    invForge(u, Math.max(1, Math.min(iv(ab, 'extra_spirit_count_quas'), iv(ab, 'extra_spirit_count_exort'))), u.x, u.y);
  },
});

// --- Sun Strike
function invSunStrike(ab, x, y, pct) {
  const u = ab.owner; const w = u.world;
  w.after(ab.v('delay'), () => {
    if (!aimed(w)) return;
    const es = enemiesNear(ab, x, y, ab.v('area_of_effect'));
    if (!es.length) return;
    const dmg = iv(ab, 'damage') * pct / es.length; let hero = false;
    for (const e of es) if (hit(ab, e, dmg, PURE) > 0 && realHero(e)) hero = true;
    if (hero && iv(ab, 'create_forged_spirit_on_hero_damage') > 0 && u.alive) invForge(u, 1, x, y);
  });
}
invSpell('invoker_sun_strike', {
  prio: 62, fid: 'approx',
  note: 'aimed at where the target will be after the delay; damage split evenly over all enemies hit. Scepter option 3 (Cataclysm): used instead of the normal strike when at least two enemy heroes are alive: cataclysm_count strikes of cataclysm_damage_pct at a random point cataclysm_min_range-cataclysm_max_range from every enemy hero, cooldown cataclysm_cooldown. Shard option 3: every strike that damages an enemy hero leaves one Forge Spirit (it does not replace existing spirits)',
  want(ab, u, t) {
    const L = invLifted(u);
    if (L) return ab.v('delay') + ab.v('AbilityCastPoint') >= L.left ? { x: L.e.x, y: L.e.y } : null;
    return t ? predict(t, ab.v('delay') + ab.v('AbilityCastPoint')) : null;
  },
  cast(ab, t, x, y) {
    const u = ab.owner; const w = u.world; const n = iv(ab, 'cataclysm_count');
    const heroes = n > 0 ? w.units.filter((e) => e.alive && e.team !== u.team && realHero(e)) : [];
    if (heroes.length < 2) { invSunStrike(ab, x, y, 1); return; }
    for (const h of heroes) {
      for (let i = 0; i < n; i++) {
        const a = w.rng.next() * 2 * Math.PI; const r = ab.v('cataclysm_min_range') + (ab.v('cataclysm_max_range') - ab.v('cataclysm_min_range')) * w.rng.next();
        invSunStrike(ab, h.x + Math.cos(a) * r, h.y + Math.sin(a) * r, ab.v('cataclysm_damage_pct') / 100);
      }
    }
    if (!w.freeSpells) ab.cdEnd = w.time + ab.v('cataclysm_cooldown') * u.cdrMul;
  },
});

// --- Ice Wall
debuff('modifier_invoker_ice_wall_slow', { purge: 'none', stats: (m) => ({ msPct: m.data.slow }) });
invSpell('invoker_ice_wall', {
  prio: 73, fid: 'approx',
  note: 'no facing in the sandbox: the wall is placed wall_place_distance from Invoker towards his current target, perpendicular to that line; enemies within wall_width of the wall line are slowed (slow_duration, refreshed) and take damage_per_second in tick_interval steps. Scepter option 1 (Ice Floe): centred on the target (up to vector_cast_range away), appears after glacier_formation_delay, and roots + damages an enemy hero once after it has stayed inside for root_delay',
  want(ab, u, t) {
    if (!t) return null;
    const d = u.distTo(t); const floe = iv(ab, 'vector_cast_range');
    if (floe > 0) return d <= floe ? NT : null;
    return Math.abs(d - ab.v('wall_place_distance')) <= iv(ab, 'wall_width') ? NT : null;
  },
  cast(ab) {
    const u = ab.owner; const w = u.world; const t = curTarget(u); const f = t ? dirTo(u.x, u.y, t.x, t.y) : { x: 1, y: 0, d: 0 };
    const floe = iv(ab, 'vector_cast_range'); const place = floe > 0 ? Math.min(f.d, floe) : ab.v('wall_place_distance'); const delay = floe > 0 ? ab.v('glacier_formation_delay') : 0;
    const cx = u.x + f.x * place; const cy = u.y + f.y * place; const half = ab.v('wall_total_length') / 2;
    const x1 = cx - f.y * half; const y1 = cy + f.x * half; const x2 = cx + f.y * half; const y2 = cy - f.x * half;
    const width = iv(ab, 'wall_width'); const tick = ab.v('tick_interval'); const slow = iv(ab, 'slow'); const dps = iv(ab, 'damage_per_second');
    const rootDelay = iv(ab, 'root_delay'); const stay = new Map(); const done = new Set();
    const n = Math.round(iv(ab, 'duration') / tick);
    for (let i = 0; i <= n; i++) {
      w.after(delay + i * tick, () => {
        const inside = w.units.filter((e) => e.alive && e.team !== u.team && e.st[ST.OUT] === 0 && segDist(e, x1, y1, x2, y2) <= width + e.def.hull);
        for (const e of stay.keys()) if (!inside.includes(e)) stay.delete(e);
        for (const e of inside) {
          e.addModifier('modifier_invoker_ice_wall_slow', { caster: u, ability: ab, duration: ab.v('slow_duration'), data: { slow } });
          if (i > 0) hit(ab, e, dps * tick, MAGICAL);
          if (!(rootDelay > 0) || !realHero(e) || done.has(e) || !e.alive) continue;
          const acc = (stay.has(e) ? stay.get(e) : -tick) + tick; stay.set(e, acc);
          if (acc + 1e-9 >= rootDelay) { done.add(e); root(ab, e, iv(ab, 'root_duration')); hit(ab, e, iv(ab, 'root_damage'), MAGICAL); }
        }
      });
    }
  },
});

// --- Deafening Blast
modifier('modifier_invoker_deafening_blast_knockback', {
  debuff: true, purge: 'none', statusResist: false, state: ['ROOT'],
  onDestroy(m) { const t = m.parent; if (t.alive && m.data && m.data.disarm > 0) t.addModifier('modifier_invoker_deafening_blast_disarm', { caster: m.caster, ability: m.ability, duration: m.data.disarm }); },
});
debuff('modifier_invoker_deafening_blast_disarm', { state: ['DISARM'] });
invSpell('invoker_deafening_blast', {
  prio: 70, fid: 'approx',
  note: 'wave from Invoker towards the target, radius_start to radius_end over travel_distance, reaching each enemy after distance / travel_speed; the knockback distance is not in the data, so the knockback is modelled as "cannot move" for knockback_duration (undispellable, no displacement), followed by the dispellable disarm; the radial talent hits every enemy within travel_distance',
  want: (ab, u, t) => (t && u.distTo(t) <= ab.v('travel_distance') - 50 ? { x: t.x, y: t.y } : null),
  cast(ab, t, x, y) {
    const u = ab.owner; const w = u.world; const len = ab.v('travel_distance'); const speed = ab.v('travel_speed');
    if (!aimed(w)) return;
    let hits;
    if (iv(ab, 'radial_count') > 1) hits = w.inRadius(u.x, u.y, len + ab.v('radius_end'), u.team, true).map((e) => ({ e, along: u.distTo(e) }));
    else { const d = dirTo(u.x, u.y, x, y); hits = inCone(u, u.x, u.y, d.x, d.y, len, ab.v('radius_start'), ab.v('radius_end')); }
    for (const h of hits) {
      w.after(h.along / speed, () => {
        const e = h.e;
        if (!e.alive) return;
        hit(ab, e, iv(ab, 'damage'), MAGICAL);
        if (e.alive) addMod(ab, e, 'modifier_invoker_deafening_blast_knockback', iv(ab, 'knockback_duration'), { data: { disarm: iv(ab, 'disarm_duration') } });
      });
    }
  },
});

// ================================================================ Chen
const chenControlled = (u) => u.world.units.filter((a) => a.alive && a.owner === u && a.team === u.team && !a.isHero && !a.isIllusion);
// Zealot passive: bonuses for non-hero units under Chen's control (values live on Chen's chen_zealot)
modifier('modifier_chen_zealot_creep', {
  purge: 'none',
  apply(m, s, u) {
    const need = m.v('health_min') - ((u.ovr && u.ovr.hp !== undefined ? u.ovr.hp : u.def.hp) + s.hp);
    if (need > 0) s.hp += need;
    s.ms += m.v('movement_speed_bonus'); s.dmgBasePct += m.v('damage_bonus'); s.spellAmp += m.v('damage_bonus');
  },
});
modifier('modifier_chen_zealot_anointed', { purge: 'none', stats: (m) => ({ dmgBase: m.v('damage'), hpPct: m.v('bonus_hp') }) });
function chenBless(u, e) { const z = u.findAbility('chen_zealot'); if (z && z.level > 0) e.addModifier('modifier_chen_zealot_creep', { caster: u, ability: z }); }
function chenZealot(ab) {
  const u = ab.owner; const st = (ab.data ||= { z: null });
  if (st.z && st.z.alive) return st.z;
  const z = summon(ab, 'npc_dota_chen_zealot', { x: u.x + 90, y: u.y + 60, ai: 'fight' });
  z.heroLike = true; // "Anointed Zealot is considered a creep-hero"
  chenBless(u, z);
  z.addModifier('modifier_chen_zealot_anointed', { caster: u, ability: ab });
  z.addAbility('chen_martyrdom', 1); z.refreshAI();
  z.recompute(); z.hp = z.maxHp;
  st.z = z;
  return z;
}
// [L] a Chen that has just appeared owns no unit (Hero Demo): the Zealot he "starts the fight with" exists only outside rules.fresh
modifier('modifier_chen_zealot', { hidden: true, purge: 'none', interval: 0.5, thinkNow: true, onThink(m) { if (m.x === 0) { m.x = 1; if (!m.parent.world.fresh) chenZealot(m.ability); } } });
defAbility('chen_zealot', {
  mods: ['modifier_chen_zealot'], prio: 70, engage: false, fid: 'approx',
  note: 'outside rules.fresh Chen starts the fight with an Anointed Zealot (npc_dota_chen_zealot, melee lane creep stats without game-time upgrades) at his side and the active respawns it after it died; with rules.fresh he owns nothing, as in the live game, and the active anoints the oldest persuaded creep that is not anointed yet (with nothing to anoint it only starts its cooldown, as measured live). Controlled non-hero units (the Zealot and persuaded creeps) get the health minimum, flat move speed and % base damage / spell amp; the Anointed Zealot also gets the bonus base damage, the talent health % and Martyrdom. Immunity to instant-kill effects is not modelled',
  ai: (ab, u, t) => (t && ab.data && ab.data.z && !ab.data.z.alive ? NT : null),
  cast(ab) {
    const u = ab.owner; const st = (ab.data ||= { z: null });
    const hp = u.findAbility('chen_holy_persuasion');
    const k = ((hp && Array.isArray(hp.data) && hp.data) || []).find((x) => x.alive && x.team === u.team && !x.hasModifier('modifier_chen_zealot_anointed'));
    if (k && !(st.z && st.z.alive)) {
      k.heroLike = true;
      k.addModifier('modifier_chen_zealot_anointed', { caster: u, ability: ab });
      if (!k.findAbility('chen_martyrdom')) { k.addAbility('chen_martyrdom', 1); k.refreshAI(); }
      k.recompute();
      st.z = k;
      return;
    }
    if (!u.world.fresh) chenZealot(ab);
  },
});
defAbility('chen_martyrdom', {
  prio: 50, fid: 'approx',
  note: 'Zealot ability (added when the Zealot is created). Used to finish an enemy hero, on its target when the Zealot is below 30% health, or to heal an allied hero below 25% health. The data gives no damage type: magical assumed',
  ai(ab, u, t) {
    const reach = ab.castRange() + 150;
    if (t && u.distTo(t) <= reach && canHit(ab, t) && (u.hp / u.maxHp < 0.3 || (t.isHero && t.hp <= (ab.v('base_value') + u.hp * ab.v('current_hp_pct') / 100) * (1 - t.mr)))) return { target: t };
    const a = weakestAlly(u, reach, false);
    return a && a.hp / a.maxHp < 0.25 ? { target: a } : null;
  },
  cast(ab, t) {
    const u = ab.owner; const w = u.world; const amount = ab.v('base_value') + u.hp * ab.v('current_hp_pct') / 100;
    w.projectile(u, t, ab.v('speed'), (tt) => { if (tt.team === u.team) tt.heal(amount * ab.v('heal_factor') / 100, u, ab); else hit(ab, tt, amount, MAGICAL); });
    w.kill(u, null, ab, true);
  },
});

buff('modifier_chen_penitence_haste', { purge: 'none', stats: (m) => ({ as: m.v('bonus_attack_speed') }) });
debuff('modifier_chen_penitence', {
  interval: 0.25, thinkNow: true, stats: (m) => ({ msPct: m.v('bonus_movement_speed') }),
  onThink(m) { for (const a of attackersOf(m.parent, m.caster.team)) a.addModifier('modifier_chen_penitence_haste', { caster: m.caster, ability: m.ability, duration: 0.5 }); },
});
defAbility('chen_penitence', {
  prio: 60, fid: 'full', note: 'the attack speed bonus is held by every ally whose current order targets the slowed unit',
  ai: (ab, u, t) => (t && !t.hasModifier('modifier_chen_penitence') ? tgt(ab, t) : null),
  cast(ab, t) { const u = ab.owner; u.world.projectile(u, t, ab.v('speed'), (tt) => { hit(ab, tt, ab.v('damage')); if (tt.alive) addMod(ab, tt, 'modifier_chen_penitence', ab.v('duration')); }); },
});

function chenCreepOk(ab, e) {
  const u = ab.owner; const d = e && e.def;
  if (!e || !e.alive || e.team === u.team || e.isHero || e.heroLike || e.isBuilding || e.isIllusion || e.isSummon) return false;
  if (!/^npc_dota_creep/.test(d.baseClass || '') || d.rel !== 'default' || d.noDominate || e.level > ab.v('level_req')) return false;
  if (d.ancient) {
    const hog = u.findAbility('chen_hand_of_god'); const cap = hog && hog.level > 0 ? hog.v('ancient_creeps_scepter') : 0;
    if (!(cap > (ab.data || []).filter((x) => x.alive && x.def.ancient).length)) return false;
  }
  return true;
}
defAbility('chen_holy_persuasion', {
  prio: 65, fid: 'approx',
  note: 'converts an enemy / neutral creep that is in the scenario: lane or neutral creep, not summoned, level <= level_req, Ancients only with Shard (as many as ancient_creeps_scepter on Hand of God). The creep changes team with full mana, gets the Zealot bonuses, stops counting for the win condition; above max_units the oldest one dies. Shard: creep abilities that have a second level are set to creep_ability_level. Chen does not bring pre-persuaded creeps into a fight. Bounty share, unsummoning and the creep teleport (self-cast) are not modelled (economy / map movement)',
  ai(ab, u, t) {
    if (!t) return null;
    let best = null; let bd = ab.castRange() + 400;
    for (const e of u.world.units) { if (!chenCreepOk(ab, e)) continue; const d = u.distTo(e); if (d < bd) { bd = d; best = e; } }
    return best ? { target: best } : null;
  },
  cast(ab, t) {
    const u = ab.owner; const w = u.world;
    if (!chenCreepOk(ab, t)) { refuseCast(ab); return; } // [L] the order is refused on anything but a creep it can convert (measured on a hero)
    ab.data = (ab.data || []).filter((x) => x.alive && x.team === u.team);
    while (ab.data.length >= ab.v('max_units')) w.kill(ab.data.shift(), null, ab, true);
    t.team = u.team; t.owner = u; t.isSummon = true; t.counts = false;
    t.stop(); t.attackTarget = null;
    if (t.ai) { t.ai.target = null; t.ai.fixedTarget = null; }
    for (const o of w.units) {
      if (o === t) continue;
      if (o.orderTarget === t) o.stop();
      if (o.attackTarget === t) o.attackTarget = null;
      if (o.ai && o.ai.target === t) o.ai.target = null;
      if (o.ai && o.ai.fixedTarget === t && o.team === u.team) o.ai.fixedTarget = null;
    }
    // Shard: "levels up some abilities of creeps by 1 level" (creep_ability_level = 2 is that rule for a level 1 ability)
    if (ab.v('creep_ability_level') > 0) for (const a of t.abilities) if (a.level > 0 && a.level < a.maxLevel && a.name !== 'neutral_upgrade') a.setLevel(a.level + 1);
    chenBless(u, t);
    t.recompute(); t.mana = t.maxMana;
    ab.data.push(t);
  },
});

modifier('modifier_chen_divine_favor_aura', { purge: 'none', stats: (m) => ({ hpRegen: m.v('heal_rate') }) });
aura('modifier_chen_divine_favor', { radius: 'aura_radius', team: 'ally', child: 'modifier_chen_divine_favor_aura' });
buff('modifier_chen_divine_favor_buff', { purge: 'none', stats: (m) => ({ armor: m.v('bonus_armor'), restore: m.v('heal_amp') }) });
defAbility('chen_divine_favor', {
  mods: ['modifier_chen_divine_favor'], prio: 45, fid: 'approx',
  note: 'regen aura exact; the active gives armor and amplifies all health restoration received (heals and regeneration; in this engine that also covers lifesteal). Cast on the weakest allied hero below 75% health, otherwise on Chen (which also buffs every unit he controls) when the enemy is near',
  ai(ab, u, t) {
    if (!t) return null;
    const ok = (a) => !a.isImmune() && !a.hasModifier('modifier_chen_divine_favor_buff');
    const a = weakestAlly(u, ab.castRange(), true, ok);
    if (a && a.hp / a.maxHp < 0.75) return { target: a };
    return ok(u) && u.distTo(t) < 900 ? { target: u } : null;
  },
  cast(ab, t) { const u = ab.owner; const tt = t || u; for (const a of tt === u ? [u, ...chenControlled(u)] : [tt]) addMod(ab, a, 'modifier_chen_divine_favor_buff', ab.v('duration')); },
});

buff('modifier_chen_hand_of_god', {
  purge: 'none', interval: 1,
  onThink(m) {
    const t = m.parent; const c = m.caster;
    const near = t !== c && t.hasModifier('modifier_chen_hand_of_god_immune'); // set by the channel on nearby allies
    t.heal(m.v('heal_per_second') * (near ? 1 + m.v('nearby_hot_boost') / 100 : 1), c, m.ability);
  },
});
buff('modifier_chen_hand_of_god_immune', { purge: 'none', state: ['IMMUNE'], stats: (m) => ({ mr: m.v('debuff_immune_resist') }) });
modifier('modifier_chen_hand_of_god_channel', {
  hidden: true, purge: 'none', interval: 0.25, thinkNow: true,
  onThink(m) {
    const u = m.parent;
    if (u.channelAb !== m.ability) { m.remove(); return; }
    for (const a of u.world.inRadius(u.x, u.y, m.v('debuff_immune_radius'), u.team, false)) if (a !== u) a.addModifier('modifier_chen_hand_of_god_immune', { caster: u, ability: m.ability, duration: 0.5 });
  },
});
defAbility('chen_hand_of_god', {
  prio: 88, engage: false, fid: 'full', channel: (ab) => ab.v('AbilityChannelTime'),
  note: 'cast when an allied hero is below 45% health; with Scepter Chen channels for the full AbilityChannelTime',
  ai(ab, u, t) { if (!t) return null; const a = weakestAlly(u, Infinity); return a && a.hp / a.maxHp < 0.45 ? NT : null; },
  cast(ab) {
    const u = ab.owner; const mine = chenControlled(u);
    for (const a of u.world.units) {
      if (!a.alive || a.team !== u.team) continue;
      const own = a === u || mine.includes(a);
      if (!own && !realHero(a)) continue;
      if (ab.v('does_purge') > 0) a.purge({ debuffs: true, strong: true });
      a.heal(own && ab.v('full_heal_on_chen_and_creeps') > 0 ? a.maxHp : ab.v('heal_amount'), u, ab);
      a.addModifier('modifier_chen_hand_of_god', { caster: u, ability: ab, duration: ab.v('hot_duration') + 0.05 });
    }
    if (ab.v('AbilityChannelTime') > 0) u.addModifier('modifier_chen_hand_of_god_channel', { ability: ab });
  },
  channelEnd(ab) { ab.owner.removeModifierByName('modifier_chen_hand_of_god_channel'); },
});

// ================================================================ Monkey King
const MK_ULT = 'modifier_monkey_king_wukongs_command_buff';
const mkSoldierHit = (rec) => !!rec.fromAbility && rec.fromAbility.name === 'monkey_king_wukongs_command';
const mkJingu = (u) => u.findModifier('modifier_monkey_king_jingu_mastery_buff') || u.findModifier('modifier_monkey_king_jingu_mastery_buff_locked');
debuff('modifier_monkey_king_primal_spring_slow', { stats: (m) => ({ msPct: -m.data.slow }) });
// Primal Spring impact at (x, y) with `power` (0..1) of a full channel; its level follows Tree Dance
function mkSpring(u, x, y, power, targets = null) {
  const ps = u.findAbility('monkey_king_primal_spring'); const td = u.findAbility('monkey_king_tree_dance');
  if (!ps || !td || td.level < 1) return;
  syncLevel(ps, td);
  for (const e of targets || enemiesNear(ps, x, y, ps.v('impact_radius'))) {
    if (!e.alive) continue;
    hit(ps, e, ps.v('impact_damage') * power, MAGICAL);
    if (e.alive) e.addModifier('modifier_monkey_king_primal_spring_slow', { caster: u, ability: ps, duration: ps.v('impact_slow_duration'), data: { slow: ps.v('impact_movement_slow') * power } });
  }
}
modifier('modifier_monkey_king_boundless_strike', { hidden: true, purge: 'none', onAttack(m, rec) { if (rec.fromAbility !== m.ability) return; const c = m.v('strike_crit_mult') / 100; if (c > rec.crit) rec.crit = c; } });
defAbility('monkey_king_boundless_strike', {
  mods: ['modifier_monkey_king_boundless_strike'], prio: 80, fid: 'approx',
  note: 'line strike_cast_range long and strike_radius to each side: every enemy in it is stunned and takes an instant True Strike attack with the critical multiplier; strike_flat_damage is added after the critical multiplier (the order is not stated). Each such hit counts for Jingu Mastery and one Jingu charge is spent per cast. Debuff-immune enemies take the attack but no stun. Shard: Primal Spring at spring_channel_pct power on the enemies along the staff and around its end; the alt-cast leap is not modelled',
  ai: (ab, u, t) => (t && !t.cantAct() && u.distTo(t) <= ab.v('strike_cast_range') - 100 ? { x: t.x, y: t.y } : null),
  cast(ab, t, x, y) {
    const u = ab.owner; const w = u.world; const d = dirTo(u.x, u.y, x, y); const len = ab.v('strike_cast_range'); const r = ab.v('strike_radius');
    if (!aimed(w)) return;
    const hits = inCone(u, u.x, u.y, d.x, d.y, len, r, r).map((h) => h.e);
    for (const e of hits) {
      stun(ab, e, ab.v('stun_duration'));
      if (e.attackableBy(u)) w.launchAttack(u, e, { instant: true, fromAbility: ab, trueStrike: true, add: ab.v('strike_flat_damage') });
    }
    if (u.hasShard) {
      const ps = u.findAbility('monkey_king_primal_spring');
      const set = new Set(hits);
      if (ps) for (const e of enemiesNear(ps, u.x + d.x * len, u.y + d.y * len, ps.v('impact_radius'))) set.add(e);
      mkSpring(u, 0, 0, ab.v('spring_channel_pct') / 100, [...set]);
    }
  },
});
const mkOwned = (s) => !!s && (s.isHero || s.isSummon || s.isIllusion || s.owner !== null);
passive('monkey_king_tree_dance', {
  fid: 'n/a', note: 'jumping between trees is map movement and the sandbox has no trees; the modifier only records when Monkey King was last damaged by a hero or a player-controlled unit (jump_damage_cooldown), which gates Primal Spring',
  onCreated(m) { m.x = -100; },
  onTakeDamage(m, d) { if (d.dealt > 0 && d.src && d.src !== m.parent && mkOwned(d.src)) m.x = m.parent.world.time; },
});
defAbility('monkey_king_primal_spring', {
  prio: 95, channel: (ab) => (ab.data && ab.data.refused ? 0 : ab.v('AbilityChannelTime')), fid: 'approx',
  note: 'the sandbox has no trees: outside rules.fresh a tree next to Monkey King is assumed, so the spring is channelled from where he stands (the hop onto the tree takes no time); with rules.fresh he stands on the ground and the order is refused, as in the live game. Used as an opener: only when Tree Dance is learned and he took no damage from heroes / player units for jump_damage_cooldown. Always the full channel, aimed at where the target will be; he then flies at spring_leap_speed and lands there. Damage and slow % scale with channel power (the slow duration, labelled a maximum, is not scaled). Level follows Tree Dance',
  ai(ab, u, t, w) {
    const td = u.findAbility('monkey_king_tree_dance'); const tr = u.findModifier('modifier_monkey_king_tree_dance');
    if (!t || !td || td.level < 1 || u.hasModifier(MK_ULT) || (tr && w.time - tr.x < td.v('jump_damage_cooldown'))) return null;
    syncLevel(ab, td);
    const p = predict(t, ab.v('AbilityChannelTime'));
    return dirTo(u.x, u.y, p.x, p.y).d <= ab.castRange() ? p : null;
  },
  cast(ab, t, x, y) {
    const u = ab.owner; const lv = ab.level;
    // [L] measured in Hero Demo: on the ground (not perched on a tree) the order does nothing
    if (u.world.fresh) { refuseCast(ab); ab.data = { refused: true }; return; }
    syncLevel(ab, u.findAbility('monkey_king_tree_dance'));
    if (ab.level !== lv && !u.world.freeSpells) ab.cdEnd = u.world.time + ab.cooldown(); // ordered directly before the level was synced
    ab.data = { x, y };
  },
  channelEnd(ab, interrupted) {
    const u = ab.owner; const p = ab.data; const td = u.findAbility('monkey_king_tree_dance');
    if (interrupted || !p || p.refused || !td) return;
    u.world.after(dirTo(u.x, u.y, p.x, p.y).d / td.v('spring_leap_speed'), () => { if (!u.alive) return; u.x = p.x; u.y = p.y; mkSpring(u, p.x, p.y, 1); });
  },
});
na('monkey_king_primal_spring_early', 'helper that releases Primal Spring early; the spring is always fully channelled');

debuff('modifier_monkey_king_jingu_mastery_hit', { multi: 'stack', purge: 'none', pierce: true, statusResist: false });
const mkJinguBuff = {
  multi: 'stack',
  onAttack(m, rec) { if (rec.secondary || mkSoldierHit(rec) || rec.target.isBuilding) return; rec.flat += m.v('bonus_damage'); (rec.data ||= {}).jingu = m; },
  onAttackLanded(m, rec) {
    if (!(rec.data && rec.data.jingu === m)) return;
    // same creep factor as the engine's own lifesteal
    if (rec.dealt > 0) m.parent.heal(rec.dealt * m.v('lifesteal') / 100 * (rec.target.heroLike ? 1 : 0.6), m.parent, m.ability, true);
    const fa = rec.fromAbility;
    if (fa && fa.name === 'monkey_king_boundless_strike') { if (m.z === fa.casts) return; m.z = fa.casts; }
    if (m.stacks <= 1) m.remove(); else m.setStacks(m.stacks - 1);
  },
};
buff('modifier_monkey_king_jingu_mastery_buff', { ...mkJinguBuff });
buff('modifier_monkey_king_jingu_mastery_buff_locked', { ...mkJinguBuff, purge: 'none' });
passive('monkey_king_jingu_mastery', {
  fid: 'approx', note: 'counter on enemy heroes (undispellable, refreshed per hit), required_hits grant `charges` attacks with bonus damage and lifesteal for max_duration (dispellable unless the talent is taken). Hits made while the charged buff is active do not build the counter (long-standing behaviour, not stated in the tooltip); the lifesteal uses the same creep factor as the engine',
  onAttackLanded(m, rec) {
    const u = m.parent; const t = rec.target;
    if (rec.secondary || !t.alive || !t.isHero || mkSoldierHit(rec) || mkJingu(u)) return;
    const d = t.addModifier('modifier_monkey_king_jingu_mastery_hit', { caster: u, ability: m.ability, duration: m.v('counter_duration'), pierce: true });
    if (!d || d.stacks < m.v('required_hits')) return;
    d.remove();
    u.addModifier(m.v('buff_is_undispellable') > 0 ? 'modifier_monkey_king_jingu_mastery_buff_locked' : 'modifier_monkey_king_jingu_mastery_buff', { ability: m.ability, duration: m.v('max_duration'), stacks: m.v('charges') });
  },
});

// [L] measured in Hero Demo: the disguise (modifier_monkey_king_transform in the game) has no duration and gives `movespeed` % move
// speed; the invul_duration damage immunity is not the invulnerable state (the unit never reports it), so it is a damage hook here
modifier('modifier_monkey_king_mischief', { hidden: true, purge: 'none', postMit(m, d) { if (!(d.flags & F_HP_LOSS)) d.amount = 0; } });
const MK_DISGUISE = 'modifier_monkey_king_mischief_transform';
modifier(MK_DISGUISE, {
  purge: 'none', stats: (m) => ({ msPct: m.v('movespeed') }),
  onTakeDamage(m, d) { if (d.dealt > 0) m.remove(); },
  onAttackStart(m) { m.remove(); },
  onCast(m, ev) { if (ev.ability !== m.ability) m.remove(); },
});
defAbility('monkey_king_mischief', {
  manual: true, fid: 'approx', note: 'manual (a disguise has no meaning without vision; the default controller cannot time a dodge): the disguise lasts until he takes damage, starts an attack or casts anything else and gives `movespeed` % move speed; no damage is taken for invul_duration after the cast. What the disguise looks like and who can see through it is not modelled',
  cast(ab) { const u = ab.owner; addMod(ab, u, 'modifier_monkey_king_mischief', ab.v('invul_duration')); u.addModifier(MK_DISGUISE, { ability: ab }); },
});
defAbility('monkey_king_untransform', { manual: true, fid: 'approx', note: 'ends the Mischief disguise (the game swaps this button in while he is disguised; here it can be ordered at any time)', cast(ab) { ab.owner.removeModifierByName(MK_DISGUISE); } });

// Soldiers are not units: each one is a fixed position from which Monkey King's own attack is launched at a fixed rate.
function mkSoldiers(u, ab, list, now) {
  const w = u.world; const jm = u.findAbility('monkey_king_jingu_mastery'); const own = u.hasScepter && jm && jm.level > 0;
  for (const s of list) {
    if (now < s.from || now >= s.until || now + 1e-9 < s.next) continue;
    let best = null; let bd = Infinity;
    for (const e of w.units) {
      if (!e.alive || e.team === u.team || !e.isHero || !e.attackableBy(u)) continue;
      const dx = e.x - s.x; const dy = e.y - s.y; const d = Math.sqrt(dx * dx + dy * dy);
      if (d <= u.attackRange + u.def.hull + e.def.hull && d < bd) { bd = d; best = e; }
    }
    if (!best) continue;
    s.next = (now - s.next < 2 * w.dt ? s.next : now) + ab.v('attack_speed') + 2 * w.dt;
    const charged = own && s.charges > 0;
    const rec = w.launchAttack(u, best, { instant: true, fromAbility: ab, flat: charged ? jm.v('bonus_damage') : 0 });
    if (!own || rec.missed) continue;
    if (charged) { s.charges--; continue; }
    const n = (s.hits.get(best) || 0) + 1;
    if (n >= jm.v('required_hits')) { s.hits.delete(best); s.charges = jm.v('charges'); } else s.hits.set(best, n);
  }
}
// [L] measured in Hero Demo (three recordings, five ring soldiers on one target): a soldier's first hit lands 0.8-1.1 s after it reached
// its place and its hits then repeat every 35 server ticks: attack_speed (1.1 s) plus two ticks.
const MK_SOLDIER_FIRST = 0.9;
const mkSoldier = (x, y, from, until) => ({ x, y, from, until, next: from + MK_SOLDIER_FIRST, charges: 0, hits: new Map() });
buff(MK_ULT, {
  purge: 'none', interval: 1 / 30, stats: (m) => ({ armor: m.v('bonus_armor') }),
  onThink(m) {
    const u = m.parent; const d = m.data;
    if (dirTo(u.x, u.y, d.cx, d.cy).d > d.outer) { m.remove(); return; }
    mkSoldiers(u, m.ability, d.soldiers, u.world.time);
  },
});
modifier('modifier_monkey_king_wukongs_command', {
  hidden: true, purge: 'none', interval: 1 / 30,
  onCreated(m) { m.data = []; m.x = m.parent.world.time + m.v('scepter_spawn_interval'); },
  onThink(m) {
    const u = m.parent; const now = u.world.time; const ab = m.ability;
    if (now + 1e-9 >= m.x) {
      m.x = now + ab.v('scepter_spawn_interval');
      const ps = u.findAbility('monkey_king_primal_spring');
      if (!(u.st[ST.INVIS] > 0) && !(ps && u.channelAb === ps)) m.data.push(mkSoldier(u.x, u.y, now, now + ab.v('scepter_spawn_duration')));
    }
    m.data = m.data.filter((s) => now < s.until);
    mkSoldiers(u, ab, m.data, now);
  },
});
defAbility('monkey_king_wukongs_command', {
  mods: ['modifier_monkey_king_wukongs_command'], requires: (ab) => ab.owner.hasScepter && ab.v('scepter_spawn_interval') > 0, prio: 85, fid: 'approx',
  note: 'soldiers are fixed positions, not units: num_first_soldiers / num_second_soldiers (/ third ring with the talent) evenly spaced on the rings around the cast point (first soldier of each ring at angle 0; they arrive after radius / move_speed). Every attack_speed seconds a soldier launches Monkey King\'s own attack (with his on-hit effects, including Basher-type items, which real soldiers do not copy) at the nearest enemy hero within his attack range of the soldier. No Jingu Mastery for soldiers. Centre = target position, at most cast_range away; the spell ends when he is further than the outer ring from the centre. Scepter: a soldier lasting scepter_spawn_duration is left at his position every scepter_spawn_interval (not while invisible or channelling Primal Spring); with Scepter every soldier builds its own Jingu counter and charges (bonus damage only, no lifesteal); building attacks are not modelled',
  ai: (ab, u, t) => (t && t.isHero && !u.hasModifier(MK_ULT) && u.distTo(t) <= ab.v('cast_range') ? { x: t.x, y: t.y } : null),
  cast(ab, t, x, y) {
    const u = ab.owner; const now = u.world.time; const f = dirTo(u.x, u.y, x, y); const k = Math.min(f.d, ab.v('cast_range'));
    const cx = u.x + f.x * k; const cy = u.y + f.y * k; const soldiers = []; let outer = 0;
    for (const [r, n] of [[ab.v('first_radius'), ab.v('num_first_soldiers')], [ab.v('second_radius'), ab.v('num_second_soldiers')], [ab.v('third_radius'), ab.v('num_third_soldiers')]]) {
      if (!(r > 0) || !(n > 0)) continue;
      if (r > outer) outer = r;
      for (let i = 0; i < n; i++) { const a = 2 * Math.PI * i / n; soldiers.push(mkSoldier(cx + Math.cos(a) * r, cy + Math.sin(a) * r, now + r / ab.v('move_speed'), Infinity)); }
    }
    u.removeModifierByName(MK_ULT);
    u.addModifier(MK_ULT, { ability: ab, duration: ab.v('duration'), data: { cx, cy, outer, soldiers } });
  },
});
modifier('modifier_monkey_king_transfiguration', { purge: 'none', state: ['INVULN', 'DISARM', 'SILENCE', 'MUTE'] });
defAbility('monkey_king_transfiguration', {
  prio: 30, fid: 'approx',
  note: 'only during Wukong\'s Command, after initial_cooldown: Monkey King swaps places with the ring soldier nearest to the chosen point and is invulnerable, unable to attack or cast for transfiguration_duration. Used below 40% health, towards his current target',
  ai(ab, u, t, w) { const b = u.findModifier(MK_ULT); return b && t && u.st[ST.ROOT] === 0 && u.hp / u.maxHp < 0.4 && w.time - b.created >= ab.v('initial_cooldown') ? { x: t.x, y: t.y } : null; },
  cast(ab, t, x, y) {
    const u = ab.owner; const b = u.findModifier(MK_ULT); const now = u.world.time;
    if (!b) return;
    let best = null; let bd = Infinity;
    for (const s of b.data.soldiers) { if (now < s.from) continue; const d = (s.x - x) * (s.x - x) + (s.y - y) * (s.y - y); if (d < bd) { bd = d; best = s; } }
    if (!best) return;
    const ox = u.x; const oy = u.y; u.x = best.x; u.y = best.y; best.x = ox; best.y = oy;
    addMod(ab, u, 'modifier_monkey_king_transfiguration', ab.v('transfiguration_duration'));
  },
});

// ================================================================ Alchemist
const ALCH_BREW = 'modifier_alchemist_unstable_concoction';
debuff('modifier_alchemist_corrosive_weaponry_debuff', { multi: 'stack', maxStacks: (m) => m.v('max_stacks'), stats: (m) => ({ msPct: -m.v('slow_per_stack') * m.stacks, dmgBasePct: -m.v('attack_dmg_per_stack') * m.stacks }) });
function alchCorrode(u, e, n) {
  const cw = u.findAbility('alchemist_corrosive_weaponry');
  if (!cw || cw.level < 1 || !e.alive || e.isBuilding || !(n > 0) || u.st[ST.BREAK] > 0) return;
  e.addModifier('modifier_alchemist_corrosive_weaponry_debuff', { caster: u, ability: cw, duration: cw.v('debuff_duration'), stacks: Math.min(n, cw.v('max_stacks')) });
}
passive('alchemist_corrosive_weaponry', { fid: 'full', note: 'stacks from attacks (stacks_per_attack), Acid Spray ticks (1) and Unstable Concoction (1 per second brewed, rounded up)', onAttackLanded(m, rec) { if (!rec.secondary) alchCorrode(m.parent, rec.target, m.v('stacks_per_attack')); } });
debuff('modifier_alchemist_acid_spray', { purge: 'none', stats: (m) => ({ armor: -m.v('armor_reduction') }) });
// [L] measured in Hero Demo: the first damage tick lands with the cast and before the armor reduction (40, then 50.59 on a 0-armor
// target at level 4), the last one when the area ends (duration / tick_rate + 1 ticks); the armor reduction is an aura that
// lingers 0.5 s after the area is gone. The aura is refreshed twice per second here (its linger time).
const ALCH_ACID_LINGER = 0.5;
defAbility('alchemist_acid_spray', {
  prio: 55, fid: 'full', note: 'duration / tick_rate + 1 damage ticks (the first with the cast, before the armor reduction applies; the last when the area ends); armor reduction while inside and for 0.5 s after (measured live). Every damage tick also applies one Corrosive Weaponry stack (7.38 patch note: "Acid Spray applies 1 stack per second")',
  ai: (ab, u, t) => (t && !t.hasModifier('modifier_alchemist_acid_spray') ? { x: t.x, y: t.y } : null),
  cast(ab, t, x, y) {
    const u = ab.owner; const w = u.world; const tick = ab.v('tick_rate'); const r = ab.v('radius');
    const n = Math.round(ab.v('duration') / ALCH_ACID_LINGER); const every = Math.max(1, Math.round(tick / ALCH_ACID_LINGER));
    for (let i = 0; i <= n; i++) {
      w.after(i * ALCH_ACID_LINGER, () => {
        for (const e of w.enemiesInRadius(u, x, y, r)) {
          if (i % every === 0) { hit(ab, e, ab.v('damage'), PHYSICAL); alchCorrode(u, e, 1); }
          if (e.alive) e.addModifier('modifier_alchemist_acid_spray', { caster: u, ability: ab, duration: ALCH_ACID_LINGER + (i < n ? 2 * w.dt : 0), noResist: true });
        }
      });
    }
  },
});
function alchHero(u, range, ab) {
  let best = null; let bd = range;
  for (const e of u.world.units) { if (!e.alive || e.team === u.team || !realHero(e) || !e.targetable() || (ab && !canHit(ab, e))) continue; const d = u.distTo(e); if (d <= bd) { bd = d; best = e; } }
  return best;
}
buff(ALCH_BREW, {
  purge: 'none', stats: (m) => ({ msPct: m.v('move_speed') }),
  onDestroy(m, expired) {
    const u = m.parent; const ab = m.ability;
    if (!expired || !u.alive) return; // not thrown in time: it explodes on Alchemist
    const th = u.findAbility('alchemist_unstable_concoction_throw') || ab;
    u.addModifier('modifier_stunned', { caster: u, ability: th, duration: th.v('max_stun') });
    u.world.damage(u, u, th.v('max_damage'), PHYSICAL, 0, th);
  },
});
defAbility('alchemist_unstable_concoction', {
  prio: 75, engage: false, fid: 'approx',
  note: 'brewing starts when an enemy hero is near; the concoction is thrown at full brew (brew_time) or earlier when Alchemist drops below 25% health; stun and damage scale linearly from min to max with brew time; if it is not thrown by this ability\'s brew_explosion (5.5 s, measured live) it explodes on Alchemist alone for the maximum stun and damage. Stun and damage numbers are those of the hidden throw ability (measured live: its max_stun, damage credited to it); the radius is this ability\'s',
  ai: (ab, u, t) => (t && !u.hasModifier(ALCH_BREW) && alchHero(u, ab.castRange() + 250) ? NT : null),
  cast(ab) { const u = ab.owner; syncLevel(u.findAbility('alchemist_unstable_concoction_throw'), ab); addMod(ab, u, ALCH_BREW, ab.v('brew_explosion')); },
});
defAbility('alchemist_unstable_concoction_throw', {
  prio: 96, fid: 'approx', note: 'second half of Unstable Concoction (level follows it); thrown at the nearest enemy hero',
  ai(ab, u) {
    const m = u.findModifier(ALCH_BREW);
    if (!m || (u.world.time - m.created < m.ability.v('brew_time') - ab.v('AbilityCastPoint') && u.hp / u.maxHp > 0.25)) return null;
    const h = alchHero(u, ab.castRange() + 600, ab);
    return h ? { target: h } : null;
  },
  cast(ab, t) {
    const u = ab.owner; const w = u.world; const m = u.findModifier(ALCH_BREW);
    if (!m) return;
    const main = m.ability; const brewed = w.time - m.created; const p = Math.min(1, brewed / main.v('brew_time'));
    m.remove();
    w.projectile(u, t, ab.v('projectile_speed'), (tt) => {
      for (const e of enemiesNear(main, tt.x, tt.y, main.v('radius'))) {
        stun(ab, e, ab.v('min_stun') + (ab.v('max_stun') - ab.v('min_stun')) * p);
        hit(ab, e, ab.v('min_damage') + (ab.v('max_damage') - ab.v('min_damage')) * p, PHYSICAL);
        const cw = u.findAbility('alchemist_corrosive_weaponry');
        if (cw) alchCorrode(u, e, Math.max(1, Math.ceil(brewed - 1e-6)) * cw.v('one_tooltip'));
      }
    });
  },
});
buff('modifier_alchemist_berserk_potion', { purge: 'none', stats: (m) => ({ as: m.v('attack_speed'), ms: m.v('move_speed'), hpRegen: m.v('hp_regen') }) });
defAbility('alchemist_berserk_potion', {
  prio: 50, fid: 'approx', note: 'thrown at the weakest allied hero below 60% health, otherwise at the allied hero with the highest attack DPS (Alchemist included); basic dispel + undispellable buff. move_speed is applied as flat movement speed (the data does not say flat or %)',
  ai(ab, u, t) {
    if (!t || u.distTo(t) > 1000) return null;
    const ok = (a) => !a.hasModifier('modifier_alchemist_berserk_potion');
    const weak = weakestAlly(u, ab.castRange(), true, ok);
    if (weak && weak.hp / weak.maxHp < 0.6) return { target: weak };
    let best = null; let bd = 0;
    for (const a of u.world.units) { if (!a.alive || a.team !== u.team || !realHero(a) || !a.canAttack || !ok(a) || u.distTo(a) > ab.castRange()) continue; const dps = avgDamage(a) / a.attackInterval; if (dps > bd) { bd = dps; best = a; } }
    return best ? { target: best } : null;
  },
  cast(ab, t) {
    const u = ab.owner; const tt = t || u;
    const land = (x) => { x.purge({ debuffs: true }); addMod(ab, x, 'modifier_alchemist_berserk_potion', ab.v('duration')); };
    if (tt === u) land(u); else u.world.projectile(u, tt, ab.v('projectile_speed'), land);
  },
});
passive('alchemist_goblins_greed', {
  fid: 'approx', note: 'gold is not modelled (economy). Kills made in the fight build the Extra Bonus Gold stacks (one per kill, kept for `duration`, at most (bonus_gold_cap - bonus_gold) / bonus_bonus_gold); they only matter through the talent that gives damage per stack. Scepter: melting it for an ally is not modelled; merely holding a Scepter gives nothing (measured live: no bonus damage)',
  interval: 1,
  // [L] measured in Hero Demo: the game's stack count is the current bonus gold (bonus_gold = 2 on a fresh hero) and the talent's
  // damage is per such stack (+6 at the start); each kill in the window adds bonus_bonus_gold up to bonus_gold_cap
  stats: (m) => ({ dmg: m.v('damage') * Math.min(m.v('bonus_gold_cap'), m.v('bonus_gold') + m.stacks * m.v('bonus_bonus_gold')) }),
  onThink(m) { if (m.stacks > 0 && m.parent.world.time >= m.x) m.setStacks(0); },
  onKill(m, ev) {
    const v = ev.victim;
    if (v.isIllusion || v.team === m.parent.team || !(m.v('bonus_bonus_gold') > 0)) return;
    m.setStacks(Math.min(Math.floor((m.v('bonus_gold_cap') - m.v('bonus_gold')) / m.v('bonus_bonus_gold')), m.stacks + 1));
    m.x = m.parent.world.time + m.v('duration');
  },
});
buff('modifier_alchemist_chemical_rage', { purge: 'none', stats: (m) => ({ bat: m.v('base_attack_time'), ms: m.v('bonus_movespeed'), hpRegen: m.v('bonus_health_regen'), manaRegen: m.v('bonus_mana_regen'), hp: m.v('bonus_health') }) });
// [L] measured in Hero Demo: for transformation_time Alchemist reports the stunned state; the buff and its duration start after it
modifier('modifier_alchemist_chemical_rage_transform', {
  purge: 'none', state: ['STUN'],
  onDestroy(m, expired) { const u = m.parent; if (expired && u.alive) u.addModifier('modifier_alchemist_chemical_rage', { ability: m.ability, duration: m.v('duration') }); },
});
defAbility('alchemist_chemical_rage', {
  prio: 90, engage: false, fid: 'approx', note: 'basic dispel on cast, transformation_time during which he cannot act (the game reports him stunned; the projectile dodge is not modelled), then base attack time, flat move speed and regeneration for the duration',
  ai: (ab, u, t) => (t && u.distTo(t) < 900 && !u.hasModifier('modifier_alchemist_chemical_rage') && !u.hasModifier('modifier_alchemist_chemical_rage_transform') ? NT : null),
  cast(ab) { const u = ab.owner; u.purge({ debuffs: true }); u.addModifier('modifier_alchemist_chemical_rage_transform', { ability: ab, duration: ab.v('transformation_time') }); },
});

// ================================================================ Death Prophet
debuff('modifier_death_prophet_carrion_swarm_slow', { stats: (m) => ({ msPct: -m.v('slow_movement_pct') }) });
defAbility('death_prophet_carrion_swarm', {
  prio: 55, fid: 'full', note: 'cone from start_radius to end_radius over range; each enemy is hit when the swarm reaches it. Shard: charges with the 1 s cooldown between uses',
  ai: (ab, u, t) => (t ? { x: t.x, y: t.y } : null),
  cast(ab, t, x, y) {
    const u = ab.owner; const w = u.world; const d = dirTo(u.x, u.y, t ? t.x : x, t ? t.y : y);
    if (ab.v('AbilityCharges') > 0 && !w.freeSpells) ab.cdEnd = w.time + ab.cooldown(); // the engine caps the lockout between charges at 0.5 s
    if (!aimed(w)) return;
    for (const h of inCone(u, u.x, u.y, d.x, d.y, ab.v('range'), ab.v('start_radius'), ab.v('end_radius'))) {
      // the swarm connects when its front edge (the cone's radius at that point) reaches the unit
      const rk = ab.v('start_radius') + (ab.v('end_radius') - ab.v('start_radius')) * Math.min(1, h.along / Math.max(1, ab.v('range')));
      w.after(Math.max(0, h.along - rk - h.e.def.hull) / ab.v('speed'), () => {
        const e = h.e;
        if (!e.alive) return;
        hit(ab, e, ab.v('damage'), MAGICAL);
        if (e.alive && ab.v('apply_debuff') > 0) addMod(ab, e, 'modifier_death_prophet_carrion_swarm_slow', ab.v('slow_duration'));
      });
    }
  },
});
defAbility('death_prophet_silence', {
  prio: 75, fid: 'full',
  ai: (ab, u, t) => (t && t.isHero && !t.isSilenced() && !(t.st[ST.IMMUNE] > 0) ? { x: t.x, y: t.y } : null),
  cast(ab, t, x, y) {
    const u = ab.owner; const w = u.world;
    w.after(dirTo(u.x, u.y, x, y).d / ab.v('projectile_speed'), () => { if (aimed(w)) for (const e of enemiesNear(ab, x, y, ab.v('radius'))) addMod(ab, e, 'modifier_silenced', ab.v('AbilityDuration')); });
  },
});
const DP_SIPHON = 'modifier_death_prophet_spirit_siphon';
buff('modifier_death_prophet_spirit_siphon_haste', { purge: 'none', multi: 'stack', stats: (m) => ({ as: m.v('attack_slow') * m.stacks }) });
debuff(DP_SIPHON, {
  purge: 'none', pierce: true, multi: 'perCaster', interval: 0.25, stats: (m) => ({ asSlow: -m.v('attack_slow') }),
  onCreated(m) { if (m.v('attack_slow') > 0 && realHero(m.parent) && m.caster.addModifier('modifier_death_prophet_spirit_siphon_haste', { ability: m.ability })) m.z = 1; },
  onDestroy(m) {
    const b = m.z === 1 ? m.caster.findModifier('modifier_death_prophet_spirit_siphon_haste') : null;
    if (b) { if (b.stacks <= 1) b.remove(); else b.setStacks(b.stacks - 1); }
  },
  onThink(m) {
    const t = m.parent; const c = m.caster; const ab = m.ability;
    if (!c.alive || c.distTo(t) > ab.castRange() + ab.v('siphon_buffer')) { m.remove(); return; }
    const per = (ab.v('damage') + t.maxHp * ab.v('max_health_damage_pct') / 100) * 0.25;
    mhit(m, t, per, MAGICAL);
    c.heal(per, c, ab);
  },
});
defAbility('death_prophet_spirit_siphon', {
  prio: 60, fid: 'approx',
  note: 'link ticking 4 times per second: damage per second to the target and the same unmitigated amount healed; breaks beyond cast range + siphon_buffer; one link per target, charges spread over enemy heroes. Scepter: the max-health drain is added to both damage and heal (the tooltip does not say whether that part heals) and each linked enemy hero gives Death Prophet attack_slow attack speed while it loses the same (creeps only lose it)',
  ai(ab, u, t) {
    if (!t) return null;
    const ok = (e) => e.alive && e.targetable() && !e.findModifier(DP_SIPHON, u) && u.distTo(e) <= ab.castRange() + 250;
    if (ok(t)) return { target: t };
    for (const e of u.world.units) if (e.team !== u.team && realHero(e) && ok(e)) return { target: e };
    return null;
  },
  cast(ab, t) { addMod(ab, t, DP_SIPHON, ab.v('haunt_duration') + 0.05, { pierce: true }); },
});
passive('death_prophet_witchcraft', {
  illusion: true, fid: 'approx',
  note: 'every attack sends `spirits` ghosts at spirit_speed that deal attack_damage_pct of her average attack damage and heal her for heal_percent of the damage dealt once they have flown back. The data gives no damage type: physical assumed (as Exorcism). Movement speed bonus exact',
  stats: (m) => ({ msPct: m.v('movement_speed_pct') }),
  onAttack(m, rec) {
    const u = m.parent; const w = u.world; const t = rec.target;
    if (rec.secondary) return;
    for (let i = 0; i < m.v('spirits'); i++) {
      w.projectile(u, t, m.v('spirit_speed'), (tt) => {
        const dealt = w.damage(u, tt, avgDamage(u) * u.dmgOutMul * m.v('attack_damage_pct') / 100 * (tt.isBuilding ? m.v('building_damage_pct') / 100 : 1), PHYSICAL, 0, m.ability);
        if (dealt > 0) w.after(Math.max(0.1, u.distTo(tt) / m.v('spirit_speed')), () => { if (u.alive) u.heal(dealt * m.v('heal_percent') / 100, u, m.ability); });
      });
    }
  },
});
const DP_EXORCISM = 'modifier_death_prophet_exorcism';
buff(DP_EXORCISM, {
  purge: 'none', stats: (m) => (m.v('unslowable') > 0 ? { slowRes: 100 } : {}),
  onCreated(m) { m.data = { dealt: 0 }; },
  onDestroy(m, expired) { const u = m.parent; if (expired && u.alive && m.data.dealt > 0) u.heal(m.data.dealt * m.v('heal_percent') / 100, u, m.ability); },
});
// A spirit flies at spirit_speed and cannot reverse on the spot. Its turn rate is not in the data: a turning circle of this radius is
// ASSUMED at both ends of every trip (a round trip to a target 300 away then takes about 2.3 s instead of 1.1 s).
const DP_SPIRIT_TURN_RADIUS = 100;
// one spirit: fly to a random enemy in the radius, hit it, turn, fly back, turn, repeat while the spell lasts
function dpSpirit(m) {
  const u = m.parent; const w = u.world;
  if (m.removed || !u.alive) return;
  const es = w.inRadius(u.x, u.y, m.v('radius'), u.team, true).filter((e) => e.st[ST.INVULN] === 0);
  if (!es.length) { w.after(0.5, () => dpSpirit(m)); return; }
  const e = es[w.rng.int(0, es.length - 1)]; const speed = m.v('spirit_speed'); const turn = Math.PI * DP_SPIRIT_TURN_RADIUS / speed;
  w.after(Math.max(0.1, u.distTo(e) / speed), () => {
    if (m.removed) return;
    if (e.alive) {
      const wc = u.findAbility('death_prophet_witchcraft');
      m.data.dealt += w.damage(u, e, w.rng.int(m.v('min_damage'), m.v('max_damage')) * (e.isBuilding && wc ? wc.v('building_damage_pct') / 100 : 1), PHYSICAL, 0, m.ability);
    }
    w.after(turn + u.distTo(e) / speed + turn, () => dpSpirit(m));
  });
}
defAbility('death_prophet_exorcism', {
  prio: 85, fid: 'approx',
  note: 'spirits are not units: one appears every ghost_spawn_rate and then repeats "fly to a random enemy within radius at spirit_speed, hit for min_damage-max_damage, fly back to her". The data has no turn rate for the spirits, so a turning circle of 100 units at both ends of each trip is ASSUMED (not a data value); the hit rate, and with it the total damage, depends directly on that assumption. Heal of heal_percent of the damage dealt when the spell expires. Building damage uses Witchcraft\'s building_damage_pct (the tooltip says 50%)',
  ai: nearAI('radius', -100),
  cast(ab) {
    const u = ab.owner; const w = u.world;
    u.removeModifierByName(DP_EXORCISM);
    const m = addMod(ab, u, DP_EXORCISM, ab.v('AbilityDuration'));
    for (let i = 0; i < ab.v('spirits'); i++) w.after(i * ab.v('ghost_spawn_rate'), () => dpSpirit(m));
  },
});

// ================================================================ Hoodwink
// Trees planted by Acorn Shot (point cast) and by a popped Decoy are the only trees that exist; they are kept on the Acorn Shot ability.
const HW_TREE_LIFE = 20; // "The planted tree lasts for 20 seconds." (Acorn Shot tooltip note; no value carries it)
function hwTrees(u) {
  const a = u.findAbility('hoodwink_acorn_shot');
  if (!a) return [];
  const st = (a.data ||= { trees: [] }); const now = u.world.time;
  if (st.trees.length) st.trees = st.trees.filter((t) => t.until > now);
  return st.trees;
}
// `delay`: the acorn is still flying (the controller may already plan with the tree; effects need it standing)
function hwPlant(u, x, y, delay = 0) { const now = u.world.time; if (u.findAbility('hoodwink_acorn_shot')) hwTrees(u).push({ x, y, from: now + delay, until: now + delay + HW_TREE_LIFE, busy: 0 }); }
function hwTreeNear(u, x, y, r, free = false, standing = true) {
  let best = null; let bd = r * r; const now = u.world.time;
  for (const t of hwTrees(u)) { if ((free && t.busy > now) || (standing && t.from > now + 1e-9)) continue; const d = (t.x - x) * (t.x - x) + (t.y - y) * (t.y - y); if (d <= bd) { bd = d; best = t; } }
  return best;
}
debuff('modifier_hoodwink_acorn_shot_slow', { stats: (m) => ({ msPct: -m.v('slow') }) });
function hwAcornHit(ab, e) {
  const u = ab.owner;
  if (!e.alive || !e.attackableBy(u)) return;
  const rec = u.world.launchAttack(u, e, { instant: true, fromAbility: ab, mult: ab.v('base_damage_pct') / 100, add: ab.v('acorn_shot_damage') });
  if (!rec.missed && e.alive) addMod(ab, e, 'modifier_hoodwink_acorn_shot_slow', ab.v('debuff_duration'));
}
function hwAcornBounce(ab, fx, fy, last, left) {
  const u = ab.owner; const w = u.world;
  if (left <= 0) return;
  let best = null; let bd = ab.v('bounce_range');
  for (const e of w.units) {
    if (!e.alive || e.team === u.team || e === last || !e.attackableBy(u)) continue;
    const d = Math.sqrt((e.x - fx) * (e.x - fx) + (e.y - fy) * (e.y - fy));
    if (d <= bd) { bd = d; best = e; }
  }
  if (best) w.after(ab.v('bounce_delay') + bd / ab.v('projectile_speed'), () => { hwAcornHit(ab, best); hwAcornBounce(ab, best.x, best.y, best, left - 1); });
}
defAbility('hoodwink_acorn_shot', {
  prio: 83, fid: 'approx',
  note: 'unit cast: an attack at base_damage_pct of her attack damage + acorn_shot_damage (on-hit effects apply) and the slow, then bounce_count bounces to the nearest other enemy within bounce_range (the unit just hit is skipped, so two enemies trade bounces). Point cast: plants a tree (20 s, from the tooltip note) and makes bounce_count bounces from it. The controller point-casts on the target when Bushwhack is about to be ready and no planted tree is near; it holds the acorn for that combo unless Bushwhack\'s cooldown is longer than its own',
  ai(ab, u, t, w) {
    if (!t) return null;
    const bw = u.findAbility('hoodwink_bushwhack');
    if (bw && bw.level > 0 && (w.freeSpells || u.mana >= ab.manaCost() + bw.manaCost())) {
      if (bw.cdRemaining() > 1) return bw.cdRemaining() > ab.cooldown() ? tgt(ab, t) : null;
      const p = predict(t, 1.2); // acorn flight + Bushwhack cast point and flight (controller lead time)
      if (hwTreeNear(u, p.x, p.y, bw.v('trap_radius') - 75, false, false)) return null;
      return dirTo(u.x, u.y, p.x, p.y).d <= ab.castRange() + 150 ? p : null;
    }
    return tgt(ab, t);
  },
  cast(ab, t, x, y) {
    const u = ab.owner; const w = u.world; const n = ab.v('bounce_count');
    if (t) w.projectile(u, t, ab.v('projectile_speed'), (tt) => { hwAcornHit(ab, tt); hwAcornBounce(ab, tt.x, tt.y, tt, n); });
    else { const fly = dirTo(u.x, u.y, x, y).d / ab.v('projectile_speed'); hwPlant(u, x, y, fly); w.after(fly, () => hwAcornBounce(ab, x, y, null, n)); }
  },
});
// [L] measured in Hero Demo (level 4: six hits of total_damage / 6 every 0.3 s during the 2 s stun): one hit every animation_rate,
// each total_damage / (whole number of animation_rate steps in debuff_duration)
modifier('modifier_hoodwink_bushwhack', {
  debuff: true, purge: 'strong', state: ['STUN'], interval: (m) => m.v('animation_rate'),
  onCreated(m) { m.x = m.v('total_damage') / Math.max(1, Math.floor(m.v('debuff_duration') / m.v('animation_rate') + 1e-6)); },
  onThink(m) { mhit(m, m.parent, m.x, MAGICAL); },
});
defAbility('hoodwink_bushwhack', {
  prio: 84, fid: 'approx',
  note: 'the net lands after distance / projectile_speed. It only catches enemies when a tree stands inside trap_radius, and the sandbox has no natural trees: only trees planted by Acorn Shot (or left by a popped Decoy) count. Caught enemies are pulled to the nearest such tree, stunned, and take one hit every animation_rate, each total_damage / (number of whole animation_rate steps in debuff_duration), as measured live; a shortened stun loses the hits it no longer reaches. Vision loss and freeing by cutting the tree are not modelled',
  ai(ab, u, t) {
    if (!t || t.cantAct() || t.st[ST.IMMUNE] > 0) return null;
    const p = predict(t, ab.v('AbilityCastPoint') + u.distTo(t) / ab.v('projectile_speed'));
    if (!hwTreeNear(u, p.x, p.y, ab.v('trap_radius') - 25, false, false)) return null;
    return dirTo(u.x, u.y, p.x, p.y).d <= ab.castRange() + 100 ? p : null;
  },
  cast(ab, t, x, y) {
    const u = ab.owner; const w = u.world; const r = ab.v('trap_radius');
    w.after(dirTo(u.x, u.y, x, y).d / ab.v('projectile_speed'), () => {
      if (!aimed(w) || !hwTreeNear(u, x, y, r)) return;
      for (const e of enemiesNear(ab, x, y, r)) {
        const tr = hwTreeNear(u, e.x, e.y, 2 * r);
        const m = addMod(ab, e, 'modifier_hoodwink_bushwhack', ab.v('debuff_duration'));
        if (!m || !tr) continue;
        knockback(e, tr.x, tr.y, -Math.max(0, Math.sqrt((e.x - tr.x) * (e.x - tr.x) + (e.y - tr.y) * (e.y - tr.y)) - e.def.hull));
        tr.busy = Math.max(tr.busy, m.dieTime);
      }
    });
  },
});
buff('modifier_hoodwink_scurry', { stats: (m) => ({ msPct: m.v('movement_speed_pct') }) });
defAbility('hoodwink_scurry', {
  prio: 100, engage: false, fid: 'approx', note: 'movement speed only (phased movement and tree-walking have no meaning without collision and trees); used to close in on a target that is out of attack range',
  ai: (ab, u, t) => (t && !u.hasModifier('modifier_hoodwink_scurry') && u.rangeTo(t) > u.attackRange + 100 ? NT : null),
  cast(ab) { addMod(ab, ab.owner, 'modifier_hoodwink_scurry', ab.v('duration')); },
});
// Sharpshooter bolt from (sx, sy) towards (tx, ty): flies through creeps (half damage), stops at the first enemy hero
debuff('modifier_hoodwink_sharpshooter_debuff', { state: ['BREAK'], stats: (m) => ({ msPct: -m.v('slow_move_pct') }) });
function hwBolt(ss, sx, sy, tx, ty, power, mult) {
  const u = ss.owner; const w = u.world; const d = dirTo(sx, sy, tx, ty);
  if (!aimed(w)) return;
  for (const h of inCone(u, sx, sy, d.x, d.y, ss.v('arrow_range'), ss.v('arrow_width'), ss.v('arrow_width'))) {
    const e = h.e;
    // the bolt connects when its edge (arrow_width) reaches the unit
    w.after(Math.max(0, h.along - ss.v('arrow_width') - e.def.hull) / ss.v('arrow_speed'), () => {
      if (!e.alive) return;
      hit(ss, e, ss.v('max_damage') * power * mult * (e.isHero ? 1 : 0.5), MAGICAL);
      if (e.alive) addMod(ss, e, 'modifier_hoodwink_sharpshooter_debuff', ss.v('max_slow_debuff_duration') * power);
    });
    if (e.isHero) break;
  }
}
// [L] measured in Hero Demo: the wind-up lasts misfire_time unless she releases it (End Sharpshooter); power grows from base_power to
// 1 over max_charge_time and stays there; while winding up she only reports the disarmed state. Her other abilities and items are
// taken away from the controller for that time (the game replaces the ability bar).
const HW_WINDUP = 'modifier_hoodwink_sharpshooter_windup';
function hwFire(m) {
  const u = m.parent; const ab = m.ability; const d = m.data;
  if (d.fired) return;
  d.fired = true;
  const el = u.world.time - m.created;
  const power = Math.min(1, ab.v('base_power') + (1 - ab.v('base_power')) * el / ab.v('max_charge_time'));
  const t = d.t && d.t.alive ? d.t : curTarget(u); const tx = t ? t.x : d.x; const ty = t ? t.y : d.y;
  hwBolt(ab, u.x, u.y, tx, ty, power, 1);
  if (u.st[ST.ROOT] === 0) knockback(u, tx, ty, ab.v('recoil_distance'));
}
buff(HW_WINDUP, {
  purge: 'none', state: ['DISARM'],
  onCreated(m) {
    const u = m.parent; const d = (m.data ||= {});
    d.locked = [];
    for (const a of [...u.abilities, ...u.items]) if (a.ai && a.name !== 'hoodwink_sharpshooter_release') { a.ai = false; d.locked.push(a); }
    u.refreshAI();
  },
  onDestroy(m) {
    const u = m.parent;
    for (const a of m.data.locked) a.ai = true;
    u.refreshAI();
    if (u.alive) hwFire(m);
  },
});
defAbility('hoodwink_sharpshooter', {
  prio: 82, fid: 'approx',
  note: 'she winds up (disarmed, her other abilities unavailable) until End Sharpshooter is used or misfire_time has passed; power (damage and debuff duration) grows linearly from base_power to full over max_charge_time. The default controller releases at full charge; without a release the bolt goes off at misfire_time, as measured live. The bolt is aimed at the target\'s position when it is released (the turn_rate limit on aiming is not modelled), arrow_width is its collision radius, it stops at the first enemy hero (illusions count) and deals half damage to non-hero units on the way (the "half" is tooltip text, no value); break + slow for max_slow_debuff_duration x power; recoil moves her recoil_distance away at once unless rooted',
  ai: (ab, u, t) => (t && t.isHero && !(t.st[ST.IMMUNE] > 0) && u.distTo(t) <= ab.v('arrow_range') ? { x: t.x, y: t.y } : null),
  cast(ab, t, x, y) { const u = ab.owner; addMod(ab, u, HW_WINDUP, ab.v('misfire_time'), { data: { t: curTarget(u), x, y } }); },
});
defAbility('hoodwink_sharpshooter_release', {
  prio: 99, engage: false, fid: 'full', note: 'releases the wound-up Sharpshooter bolt with the power reached so far; the controller uses it at full charge',
  ai(ab, u) { const m = u.findModifier(HW_WINDUP); const ss = u.findAbility('hoodwink_sharpshooter'); return m && ss && u.world.time - m.created + 1e-9 >= ss.v('max_charge_time') ? NT : null; },
  cast(ab) { const m = ab.owner.findModifier(HW_WINDUP); if (m) m.remove(); else refuseCast(ab); },
});
buff('modifier_hoodwink_decoy_invis', { purge: 'none', state: ['INVIS'], stats: (m) => ({ msPct: m.v('movement_speed') }), onAttack(m) { m.remove(); }, onCast(m, ev) { if (ev.ability !== m.ability) m.remove(); } });
function hwDecoyPop(m, enemy) {
  const d = m.parent; const u = m.caster; const ab = m.ability; const w = d.world;
  if (m.z === 1) return;
  m.z = 1;
  hwPlant(u, d.x, d.y);
  if (enemy && enemy.alive) {
    const x = enemy.x; const y = enemy.y;
    w.after(dirTo(d.x, d.y, x, y).d / ab.v('projectile_speed'), () => { for (const e of enemiesNear(ab, x, y, ab.v('decoy_detonate_radius'))) stun(ab, e, ab.v('decoy_stun_duration')); });
  }
  w.kill(d, null, null, true);
}
modifier('modifier_hoodwink_decoy', {
  hidden: true, purge: 'none', interval: 0.1,
  onCreated(m) { m.x = m.parent.world.time; },
  onThink(m) {
    const d = m.parent; const u = m.caster; const ss = u.findAbility('hoodwink_sharpshooter');
    // [L] measured in Hero Demo: the decoy never releases early, its bolt goes off at misfire_time with full power; an unlearned
    // Sharpshooter still fires with its level 1 values
    if (m.y === 1 || !ss || d.world.time - m.x + 1e-9 < ss.v('misfire_time')) return;
    m.y = 1;
    let best = null; let bd = ss.v('arrow_range');
    for (const e of d.world.units) { if (!e.alive || e.team === d.team || !realHero(e)) continue; const dist = d.distTo(e); if (dist <= bd) { bd = dist; best = e; } }
    if (best) hwBolt(ss, d.x, d.y, best.x, best.y, 1, m.v('sharpshooter_damage_pct') / 100);
  },
  onPreAttacked(m, rec) { rec.cancel = true; hwDecoyPop(m, rec.attacker); },
  onSpellTargeted(m, ev) { hwDecoyPop(m, ev.caster); },
});
defAbility('hoodwink_decoy', {
  prio: 40, engage: false, fid: 'approx',
  note: 'Hoodwink turns invisible with bonus speed (ends on her first attack or cast, as other invisibility here) and leaves a decoy illusion that does not attack. After Sharpshooter\'s misfire_time (measured live) the decoy fires a full-power Sharpshooter bolt at sharpshooter_damage_pct at the nearest enemy hero. If the decoy is attacked or targeted by a spell first it is destroyed, leaves a tree where it stood (7.30 patch note) and throws a lesser Bushwhack at the attacker: enemies within decoy_detonate_radius are stunned for decoy_stun_duration (no damage value exists; the tree requirement is not applied)',
  ai: (ab, u, t) => (t && t.isHero && u.distTo(t) < 900 && !u.hasModifier('modifier_hoodwink_decoy_invis') ? NT : null),
  cast(ab) {
    const u = ab.owner;
    const d = u.world.createIllusion(u, { duration: ab.v('duration'), outPct: ab.v('images_do_damage_percent') - 100, inPct: ab.v('images_take_damage_percent') - 100, x: u.x, y: u.y });
    d.ai = null;
    d.addModifier('modifier_hoodwink_decoy', { caster: u, ability: ab });
    addMod(ab, u, 'modifier_hoodwink_decoy_invis', ab.v('duration'));
  },
});
debuff('modifier_hoodwink_hunters_boomerang', { stats: (m) => ({ msPct: -m.v('slow_pct'), magicTakenPct: m.v('spell_amp') }) });
defAbility('hoodwink_hunters_boomerang', {
  prio: 62, fid: 'approx',
  note: 'the arc (spread) is flattened to the straight line from Hoodwink to the target: every enemy within radius of it is hit once on the way out, when the edge of the boomerang reaches it (flight time = distance / speed, kept between min_throw_duration and max_throw_duration); the return trip adds nothing. The mark is applied before the damage, so the boomerang\'s own hit is already amplified (measured live: 200 x 1.15). The spell damage vulnerability is applied to magical damage only',
  ai: (ab, u, t) => (t && !t.hasModifier('modifier_hoodwink_hunters_boomerang') ? tgt(ab, t) : null),
  cast(ab, t, x, y) {
    const u = ab.owner; const w = u.world; const f = dirTo(u.x, u.y, t ? t.x : x, t ? t.y : y); const r = ab.v('radius');
    const dur = Math.min(ab.v('max_throw_duration'), Math.max(ab.v('min_throw_duration'), f.d / ab.v('speed')));
    for (const h of inCone(u, u.x, u.y, f.x, f.y, f.d, r, r)) {
      w.after(f.d > 0 ? dur * Math.min(1, Math.max(0, h.along - r - h.e.def.hull) / f.d) : 0, () => {
        const e = h.e;
        if (!e.alive) return;
        addMod(ab, e, 'modifier_hoodwink_hunters_boomerang', ab.v('mark_duration'));
        hit(ab, e, ab.v('damage'), MAGICAL);
      });
    }
  },
});
passive('hoodwink_mistwoods_wayfarer', {
  fid: 'partial', note: 'needs a tree within `radius` of Hoodwink and the sandbox has no natural trees: only a tree planted by Acorn Shot / Decoy can take a redirected attack (it is destroyed; a tree holding a Bushwhack is not used). Redirection next to natural trees, the normal case in the game, is therefore missing and the passive is rarely active',
  onPreAttacked(m, rec) {
    const u = m.parent; const tr = hwTreeNear(u, u.x, u.y, m.v('radius'), true);
    if (!tr || !m.roll(m.v('redirect_chance'))) return;
    rec.cancel = true; tr.until = 0;
  },
});

// ================================================================ Muerta
// The engine's ETHEREAL state always disarms and can never be attacked, so Muerta's own ethereal effects (Pierce the Veil on herself,
// Spectral Slug on a target) are built from hooks instead: physical damage is nullified, attacks by others are negated, and her
// attacks are converted to magical damage whenever she or her target is in one of those two states.
const MU_VEIL = 'modifier_muerta_pierce_the_veil_buff'; const MU_SLUG = 'modifier_muerta_spectral_slug';
debuff('modifier_muerta_dead_shot_slow', { stats: (m) => ({ msPct: m.v('impact_slow_percent') }) });
defAbility('muerta_dead_shot', {
  prio: 62, fid: 'approx',
  note: 'bullet at `speed`: damage + slow on the unit it strikes, then a ricochet of 1.5x cast range (ricochet_distance_multiplier) towards the enemy hero nearest to the impact (the vector a player would pick): every enemy within the ricochet radius takes the damage, the first hero is feared and stops it (with Scepter it expands, keeps going and fears every hero). When the target hero has another enemy within range the controller shoots that unit to bounce into the hero. Fear only removes the unit\'s actions (the engine does not move feared units); trees cannot be targeted (none exist)',
  ai(ab, u, t) {
    if (!t) return null;
    if (t.isHero) { // bounce it off another enemy into the hero
      let best = null; let bd = ab.castRange() * ab.v('ricochet_distance_multiplier');
      for (const e of u.world.units) {
        if (!e.alive || e.team === u.team || e === t || !e.targetable() || !canHit(ab, e) || u.distTo(e) > ab.castRange() + 100) continue;
        const d = e.distTo(t); if (d < bd) { bd = d; best = e; }
      }
      if (best) return { target: best };
    }
    return tgt(ab, t);
  },
  cast(ab, t) {
    const u = ab.owner; const w = u.world; const speed = ab.v('speed');
    w.projectile(u, t, speed, (tt) => {
      hit(ab, tt, ab.v('damage'), MAGICAL);
      if (tt.alive) addMod(ab, tt, 'modifier_muerta_dead_shot_slow', ab.v('impact_slow_duration'));
      const len = ab.castRange() * ab.v('ricochet_distance_multiplier'); let aim = null; let bd = len;
      for (const e of w.units) { if (!e.alive || e.team === u.team || e === tt || !e.isHero || e.st[ST.OUT] > 0) continue; const d = tt.distTo(e); if (d < bd) { bd = d; aim = e; } }
      if (!aim) return;
      const d = dirTo(tt.x, tt.y, aim.x, aim.y); const r0 = ab.v('ricochet_radius_start');
      const r1 = Math.max(ab.v('ricochet_radius_end'), r0 + ab.v('ricochet_radius_expansion_per_second') * len / speed);
      for (const h of inCone(u, tt.x, tt.y, d.x, d.y, len, r0, r1)) {
        const e = h.e;
        if (e === tt) continue;
        w.after(h.along / speed, () => { if (!e.alive) return; hit(ab, e, ab.v('damage'), MAGICAL); if (e.alive && e.isHero) addMod(ab, e, 'modifier_feared', ab.v('ricochet_fear_duration')); });
        if (e.isHero && !(ab.v('scepter_pierces') > 0)) break;
      }
    });
  },
});
debuff('modifier_muerta_the_calling_slow', { stats: (m) => ({ msPct: m.v('aura_movespeed_slow') }) });
defAbility('muerta_the_calling', {
  prio: 66, fid: 'approx',
  note: 'num_revenants points evenly spaced on a circle of dead_zone_distance around the cast point, turning at speed_initial rising by `acceleration` per second up to speed_max (read as radians per second; the data gives no unit); an enemy takes the damage and silence each time a revenant comes within hit_radius of it. The slow covers dead_zone_distance + hit_radius around the point (no area value exists). The controller places the centre dead_zone_distance away from where the target is heading (its position 2 s ahead), on Muerta\'s side, so that the target ends up on the revenants\' path rather than in the dead zone',
  ai(ab, u, t) {
    if (!t || t.hasModifier('modifier_muerta_the_calling_slow')) return null;
    const p = predict(t, 2); const f = dirTo(t.x, t.y, u.x, u.y); const k = ab.v('dead_zone_distance'); const cx = p.x + f.x * k; const cy = p.y + f.y * k;
    return dirTo(u.x, u.y, cx, cy).d <= ab.castRange() + 200 ? { x: cx, y: cy } : null;
  },
  cast(ab, t, x, y) {
    const u = ab.owner; const w = u.world; const n = ab.v('num_revenants'); const R = ab.v('dead_zone_distance'); const hr = ab.v('hit_radius'); const step = 0.1;
    let angle = ab.v('rotation_initial'); const touching = new Set(); const turn = ab.v('rotation_direction') || 1;
    for (let i = 0; i * step <= ab.v('duration') + 1e-6; i++) {
      w.after(i * step, () => {
        angle += turn * Math.min(ab.v('speed_max'), ab.v('speed_initial') + ab.v('acceleration') * i * step) * step;
        const es = enemiesNear(ab, x, y, R + hr);
        for (const e of es) addMod(ab, e, 'modifier_muerta_the_calling_slow', 0.5);
        for (let k = 0; k < n; k++) {
          const a = angle + 2 * Math.PI * k / n; const rx = x + Math.cos(a) * R; const ry = y + Math.sin(a) * R;
          for (const e of es) {
            const key = k + ':' + e.id; const lim = hr + e.def.hull;
            const inside = (e.x - rx) * (e.x - rx) + (e.y - ry) * (e.y - ry) <= lim * lim;
            if (!inside) { touching.delete(key); continue; }
            if (touching.has(key) || !e.alive) continue;
            touching.add(key);
            hit(ab, e, ab.v('damage'), MAGICAL);
            if (e.alive) addMod(ab, e, 'modifier_silenced', ab.v('silence_duration'));
          }
        }
      });
    }
  },
});
passive('muerta_gunslinger', {
  fid: 'full', note: 'toggle assumed on; the second shot is a full attack (on-hit effects apply) at another enemy within attack range + target_search_bonus_range (heroes first, then units, then buildings), or at the same target when there is none',
  onAttack(m, rec) {
    const u = m.parent; const w = u.world;
    if (rec.secondary || rec.fromAbility === m.ability || !m.roll(m.v('double_shot_chance'))) return;
    const reach = u.attackRange + m.v('target_search_bonus_range') + u.def.hull; let best = null; let bs = Infinity;
    for (const e of w.units) {
      if (!e.alive || e.team === u.team || e === rec.target || !e.attackableBy(u)) continue;
      const d = u.distTo(e);
      if (d > reach + e.def.hull) continue;
      const score = (e.isHero ? 0 : e.isBuilding ? 2e6 : 1e6) + d;
      if (score < bs) { bs = score; best = e; }
    }
    w.launchAttack(u, best || rec.target, { fromAbility: m.ability, add: m.v('bonus_damage') });
  },
});
modifier(MU_SLUG, {
  debuff: true, state: ['DISARM'], stats: (m) => ({ msPct: m.v('slow_pct'), magicTakenPct: -m.v('bonus_spell_damage_pct') }),
  onPreAttacked(m, rec) { if (!rec.attacker.hasModifier('modifier_muerta_pierce_the_veil')) rec.cancel = true; },
  preMit(m, d) { if (d.type === PHYSICAL) d.amount = 0; },
});
defAbility('muerta_spectral_slug', {
  prio: 64, fid: 'approx',
  note: 'damage, knockback (never beyond Muerta\'s attack reach) and the ethereal debuff: the target cannot attack, takes no physical damage, is slowed and takes more magical damage; attacks by anyone but Muerta are negated (the engine cannot make them retarget). Because it switches off her allies\' physical damage, the controller only uses it during Pierce the Veil or when no other allied hero is near',
  ai(ab, u, t) {
    if (!t || !t.isHero || t.hasModifier(MU_SLUG)) return null;
    if (!u.hasModifier(MU_VEIL) && u.world.units.some((a) => a !== u && a.alive && a.team === u.team && realHero(a) && a.distTo(t) < 1200)) return null;
    return tgt(ab, t);
  },
  cast(ab, t) {
    const u = ab.owner;
    u.world.projectile(u, t, ab.v('projectile_speed'), (tt) => {
      // [L] measured in Hero Demo: the debuff lands first, so the slug's own damage is already amplified (125 -> 112.5 on 25% resistance)
      addMod(ab, tt, MU_SLUG, ab.v('duration'));
      hit(ab, tt, ab.v('damage'), MAGICAL);
      if (!tt.alive) return;
      knockback(tt, u.x, u.y, Math.max(0, Math.min(ab.v('knockback_distance'), u.attackRange + u.def.hull + tt.def.hull - u.distTo(tt))));
    });
  },
});
modifier('modifier_muerta_pierce_the_veil', {
  hidden: true, purge: 'none',
  outgoing(m, d) {
    if (!(d.flags & F_ATTACK)) return;
    const veil = m.parent.hasModifier(MU_VEIL);
    if (veil && d.dst.isBuilding) { d.amount = 0; return; }
    if (d.type === PHYSICAL && (veil || d.dst.hasModifier(MU_SLUG))) d.type = MAGICAL;
  },
});
buff(MU_VEIL, { purge: 'none', stats: (m) => ({ dmgBasePct: m.v('base_damage_percent') }), onPreAttacked(m, rec) { rec.cancel = true; }, preMit(m, d) { if (d.type === PHYSICAL) d.amount = 0; } });
modifier('modifier_muerta_pierce_the_veil_transform', { purge: 'none', state: ['STUN'] });
defAbility('muerta_pierce_the_veil', {
  mods: ['modifier_muerta_pierce_the_veil'], prio: 86, fid: 'approx',
  note: 'basic dispel, bonus base damage, all her attack damage magical for the duration; she takes no physical damage and attacks against her are negated (attackers do not retarget as they would against a real ethereal unit). Passive part: her attacks are also magical against a Spectral Slug target; attacking units made ethereal by other sources (Ghost Scepter etc.) is not possible in this engine. Her lifesteal keeps working on these attacks with the attack creep factor. Phased movement and the transformation dodge are not modelled; building attacks deal nothing while transformed. The Shard text in the data is stale (it names values that do not exist)',
  ai: (ab, u, t) => (t && t.isHero && !u.hasModifier(MU_VEIL) && u.rangeTo(t) <= u.attackRange + 150 ? NT : null),
  // [L] measured in Hero Demo: the buff lasts duration + transform_duration from the cast and she is stunned for transform_duration
  cast(ab) { const u = ab.owner; u.purge({ debuffs: true }); addMod(ab, u, MU_VEIL, ab.v('duration') + ab.v('transform_duration')); addMod(ab, u, 'modifier_muerta_pierce_the_veil_transform', ab.v('transform_duration')); },
});
passive('muerta_supernatural', {
  fid: 'full', note: 'stacks start at 0 (use the unit option stacks: { muerta_supernatural: N } for a late-game Muerta); the loss of half the stacks on her death has no effect inside one fight',
  stats: (m) => ({ spellAmp: m.v('spell_amp_per_stack') * m.stacks }),
  onAnyDeath(m, ev) {
    const u = m.parent; const v = ev.victim;
    if (!u.alive || v.team === u.team || !realHero(v) || u.distTo(v) > m.v('stack_collection_range')) return;
    m.setStacks(Math.min(m.v('max_stacks'), m.stacks + 1));
  },
});
na('muerta_ofrenda_destroy', 'ability of the Ofrenda altar (respawn point choice): no combat effect');

// ================================================================ Clockwerk
const CW_OC = 'modifier_rattletrap_overclocking';
const cwOver = (u) => (u.hasModifier(CW_OC) ? u.findAbility('rattletrap_overclocking') : null);
// [L] measured in Hero Demo: the first pulse comes with the cast (duration / interval + 1 pulses) and each pulse stuns for 0.1 s
const CW_BATTERY_STUN = 0.1;
buff('modifier_rattletrap_battery_assault', {
  purge: 'none', interval: (m) => m.v('interval'), thinkNow: true,
  onThink(m) {
    const u = m.parent; const w = u.world; const oc = cwOver(u);
    const es = w.enemiesInRadius(u, u.x, u.y, oc ? m.v('overclocking_radius') : m.v('radius')).filter((e) => e.st[ST.INVULN] === 0 && e.st[ST.IMMUNE] === 0 && !e.isBuilding);
    if (!es.length) return;
    for (const e of oc ? es : [es[w.rng.int(0, es.length - 1)]]) {
      mhit(m, e, m.v('damage') * (e.heroLike ? 1 : m.v('creep_damage_multiplier')), MAGICAL);
      if (e.alive) e.addModifier('modifier_stunned', { caster: u, ability: m.ability, duration: CW_BATTERY_STUN });
    }
  },
});
defAbility('rattletrap_battery_assault', {
  prio: 60, fid: 'approx', note: 'one random enemy in the radius every `interval` (all of them while Overclocked, in the larger radius); the ministun has no duration in the data and is modelled as a one-tick stun (it interrupts casts, channels and attack wind-ups)',
  ai: nearAI('radius', -25),
  cast(ab) { const u = ab.owner; u.removeModifierByName('modifier_rattletrap_battery_assault'); addMod(ab, u, 'modifier_rattletrap_battery_assault', ab.v('duration') + 0.05); },
});
// Power Cogs: the ring is not made of units. Enemies inside when it forms cannot leave it; enemies outside are shocked once when they
// come within trigger_distance of the ring and cannot walk in until they have spent attacks_to_destroy attacks' worth of time at it.
buff('modifier_rattletrap_power_cogs', {
  purge: 'none', interval: 0.1, thinkNow: true,
  late(m, s, u) { const oc = cwOver(u); if (oc) s.armor += ((u.ovr && u.ovr.armor !== undefined ? u.ovr.armor : u.def.armor) + C.ARMOR_PER_AGI * u.agi + s.armor) * oc.v('bonus_armor_pct') / 100; },
  onCreated(m) {
    const u = m.parent; const ab = m.ability; const oc = !!cwOver(u);
    const r = oc ? ab.v('cogs_radius_overclock') : ab.v('cogs_radius');
    m.data = { cx: u.x, cy: u.y, r, oc, trig: oc ? ab.v('trigger_distance_overclock') : ab.v('trigger_distance'), inside: new Set(u.world.enemiesInRadius(u, u.x, u.y, r)), shocked: new Set(), blocked: new Map(), free: new Set() };
  },
  onThink(m) {
    const u = m.parent; const d = m.data; const ab = m.ability;
    if (dirTo(d.cx, d.cy, u.x, u.y).d > d.r) { m.remove(); return; } // Clockwerk walked out over his cogs
    const shock = (e, push) => {
      d.shocked.add(e);
      const burned = e.burnMana(ab.v('mana_burn'));
      mhit(m, e, ab.v('damage') + burned * ab.v('mana_burn_as_damage_pct') / 100, MAGICAL);
      if (e.alive) knockback(e, d.cx, d.cy, push);
    };
    for (const e of u.world.units) {
      if (!e.alive || e.team === u.team || e.isBuilding || e.st[ST.OUT] > 0 || e.st[ST.INVULN] > 0) continue;
      const f = dirTo(d.cx, d.cy, e.x, e.y);
      if (d.inside.has(e)) {
        if (d.oc && !d.shocked.has(e) && f.d >= d.r - d.trig) { shock(e, -(ab.v('push_length') - ab.v('inside_cogs_distance_reduction'))); continue; }
        const lim = Math.max(0, d.r - e.def.hull);
        if (f.d > lim) { e.x = d.cx + f.x * lim; e.y = d.cy + f.y * lim; }
        continue;
      }
      if (d.free.has(e)) continue;
      if (!d.shocked.has(e) && f.d <= d.r + d.trig) { shock(e, ab.v('push_length')); continue; }
      const lim = d.r + e.def.hull;
      if (f.d < lim) {
        e.x = d.cx + f.x * lim; e.y = d.cy + f.y * lim;
        const held = (d.blocked.get(e) || 0) + 0.1; d.blocked.set(e, held);
        if (held >= ab.v('attacks_to_destroy') * e.attackInterval) d.free.add(e);
      }
    }
  },
});
defAbility('rattletrap_power_cogs', {
  prio: 78, fid: 'partial',
  note: 'the cogs are not units: enemies inside cogs_radius at the cast are held inside the ring; an enemy outside is shocked once (damage + mana_burn, plus mana_burn_as_damage_pct of the mana burned, instant push of push_length) when it comes within trigger_distance of the ring, and afterwards cannot walk in until it has stood at the ring for attacks_to_destroy of its own attack intervals. The ring is dropped when Clockwerk leaves it. Overclocked: larger ring, smaller trigger distance, enemies inside that touch it are shocked once towards the centre, and Clockwerk gains bonus_armor_pct armor. NOT modelled: single cogs being attacked or powering down one by one, Clockwerk launching a cog with an attack (projectile_distance), allies being blocked',
  ai(ab, u, t) { const oc = cwOver(u); return t && !u.hasModifier('modifier_rattletrap_power_cogs') && u.distTo(t) <= (oc ? ab.v('cogs_radius_overclock') : ab.v('cogs_radius')) - 15 ? NT : null; },
  cast(ab) { addMod(ab, ab.owner, 'modifier_rattletrap_power_cogs', ab.v('duration')); },
});
debuff('modifier_rattletrap_rocket_flare_slow', { stats: (m) => ({ msPct: -m.v('slow_pct') }) });
defAbility('rattletrap_rocket_flare', {
  prio: 45, fid: 'approx', note: 'global rocket at `speed`, aimed where the target will be; vision is not modelled. Overclocked: damage and slow duration raised, and rocket_flare_rockets extra rockets land beside the target point (offset = rocket_flare_offset_pct of the flare radius, perpendicular to the flight line; the data does not say what the percentage refers to)',
  ai: (ab, u, t) => (t ? predict(t, ab.v('AbilityCastPoint') + u.distTo(t) / ab.v('speed')) : null),
  cast(ab, t, x, y) {
    const u = ab.owner; const w = u.world; const oc = cwOver(u); const f = dirTo(u.x, u.y, x, y); const sx = u.x; const sy = u.y;
    const dmg = ab.v('damage') * (oc ? 1 + oc.v('rocket_flare_damage_pct') / 100 : 1); const slow = ab.v('slow_duration') * (oc ? 1 + oc.v('rocket_flare_duration_pct') / 100 : 1);
    const fire = (px, py, delay) => w.after(delay + dirTo(sx, sy, px, py).d / ab.v('speed'), () => {
      if (!aimed(w)) return;
      for (const e of enemiesNear(ab, px, py, ab.v('radius'))) { hit(ab, e, dmg, MAGICAL); if (e.alive) addMod(ab, e, 'modifier_rattletrap_rocket_flare_slow', slow); }
    });
    fire(x, y, 0);
    if (!oc) return;
    const off = ab.v('radius') * oc.v('rocket_flare_offset_pct') / 100;
    for (let i = 0; i < oc.v('rocket_flare_rockets'); i++) { const k = (i % 2 ? -1 : 1) * (Math.floor(i / 2) + 1) * off; fire(x - f.y * k, y + f.x * k, oc.v('rocket_flare_interval') * (i + 1)); }
  },
});
buff(CW_OC, {
  purge: 'none', stats: () => ({}),
  onDestroy(m, expired) { const u = m.parent; if (expired && u.alive) u.addModifier('modifier_rattletrap_overclocking_overheated', { ability: m.ability, duration: m.v('debuff_duration') }); },
});
modifier('modifier_rattletrap_overclocking_overheated', { purge: 'none', stats: () => ({ msCap: C.MS_MIN, asSlow: -C.AS_MAX }) });
defAbility('rattletrap_overclocking', {
  prio: 92, engage: false, fid: 'approx',
  note: 'used when a fight starts. While active it changes Battery Assault, Power Cogs, Rocket Flare, Hookshot and Jetpack as their notes say. When it runs out Clockwerk is "slowed to a crawl" for debuff_duration: no magnitude exists in the data, so he drops to the engine\'s minimum movement and attack speed',
  ai: (ab, u, t) => (t && u.distTo(t) < 1000 && !u.hasModifier(CW_OC) && !u.hasModifier('modifier_rattletrap_overclocking_overheated') ? NT : null),
  cast(ab) { addMod(ab, ab.owner, CW_OC, ab.v('buff_duration')); },
});
buff('modifier_rattletrap_jetpack', {
  state: ['DISARM'],
  stats: (m) => { const oc = cwOver(m.parent); return { msPct: oc ? oc.v('jetpack_bonus_speed') : m.v('bonus_speed') }; },
  // [L] measured in Hero Demo: the jetpack (and its disarm) lasts its full duration; it is not switched off early
});
defAbility('rattletrap_jetpack', {
  prio: 98, engage: false, fid: 'approx', note: 'gap closer: bonus movement speed (the Overclocked value while Overclocked) and no attacks for the full duration (measured live; the game also flies him forward on his own, which is not modelled). Flying movement, vision and the turn-rate limit have no meaning here',
  ai: (ab, u, t) => (t && !u.hasModifier('modifier_rattletrap_jetpack') && u.rangeTo(t) > u.attackRange + 350 ? NT : null),
  cast(ab) { addMod(ab, ab.owner, 'modifier_rattletrap_jetpack', ab.v('duration')); },
});
na('rattletrap_jetpack_toggle', 'helper that toggles Jetpack; switching off is done by the Jetpack script itself');
// first unit, friend or foe, that the hook meets on its way towards (x, y)
function cwHookFirst(ab, x, y) {
  const u = ab.owner; const d = dirTo(u.x, u.y, x, y); const len = ab.castRange(); const latch = ab.v('latch_radius');
  return inCone(u, u.x, u.y, d.x, d.y, len, latch, latch).concat(inCone(u, u.x, u.y, d.x, d.y, len, latch, latch, true)).sort((a, b) => a.along - b.along)[0];
}
modifier('modifier_rattletrap_hookshot_travel', { purge: 'none', state: ['SILENCE', 'DISARM'] });
defAbility('rattletrap_hookshot', {
  prio: 100, fid: 'approx',
  note: 'gap closer on a hero out of reach: the hook latches the first unit within latch_radius of the line (an ally in the way would be latched instead, so the controller only fires when the first unit on the line is an enemy); Clockwerk arrives after twice the hook flight time, then every enemy within stun_radius of the hit unit or of his flight path is stunned and damaged (pierces debuff immunity). Overclocked: radius and stun duration raised',
  ai(ab, u, t) {
    if (!t || !t.isHero || u.rangeTo(t) - u.attackRange <= 200 || u.distTo(t) > ab.castRange()) return null;
    const first = cwHookFirst(ab, t.x, t.y);
    return first && first.e.team !== u.team ? { x: t.x, y: t.y } : null; // never into an ally standing in the way
  },
  cast(ab, t, x, y) {
    const u = ab.owner; const w = u.world;
    if (!aimed(w)) return;
    const first = cwHookFirst(ab, x, y);
    if (!first) return;
    const sx = u.x; const sy = u.y; const oc = cwOver(u);
    const r = ab.v('stun_radius') * (oc ? 1 + oc.v('hookshot_radius_bonus_pct') / 100 : 1); const dur = ab.v('duration') * (oc ? 1 + oc.v('hookshot_duration_bonus_pct') / 100 : 1);
    // [L] measured in Hero Demo: the latched enemy is stunned from the moment the hook reaches it, for duration + Clockwerk's travel;
    // while he travels he is silenced and disarmed; the damage (and the stun of the others) comes when he arrives
    const fly = first.along / ab.v('speed');
    w.after(fly, () => {
      const tt = first.e;
      if (!u.alive) return;
      u.addModifier('modifier_rattletrap_hookshot_travel', { ability: ab, duration: fly });
      if (tt.alive && tt.team !== u.team) tt.addModifier('modifier_stunned', { caster: u, ability: ab, duration: dur + fly, pierce: true });
    });
    w.after(2 * fly, () => {
      const tt = first.e;
      if (!u.alive) return;
      u.jumpTo(tt, Infinity, u.def.hull + tt.def.hull);
      if (tt.team === u.team) return;
      const es = new Set(enemiesNear(ab, tt.x, tt.y, r));
      for (const e of w.units) if (e.alive && e.team !== u.team && e.st[ST.OUT] === 0 && segDist(e, sx, sy, u.x, u.y) <= r + e.def.hull) es.add(e);
      for (const e of es) { if (e !== tt) e.addModifier('modifier_stunned', { caster: u, ability: ab, duration: dur, pierce: true }); hit(ab, e, ab.v('damage'), MAGICAL); }
    });
  },
});
passive('rattletrap_armor_power', {
  fid: 'approx', note: 'all damage Clockwerk deals (attacks and spells) is multiplied by 1 + damage_per_armor% per point of his current armor; consuming Chainmails is an item action and is not modelled',
  outgoing(m, d) { const a = m.parent.armor; if (a > 0) d.amount *= 1 + a * m.v('damage_per_armor') / 100; },
});

// ================================================================ Tiny
const TINY_TREE = 'modifier_tiny_tree_grab';
defAbility('tiny_avalanche', {
  prio: 68, fid: 'full',
  ai: (ab, u, t) => (t ? predict(t, u.distTo(t) / ab.v('projectile_speed')) : null),
  cast(ab, t, x, y) {
    const u = ab.owner; const w = u.world; const n = ab.v('tick_count');
    w.after(dirTo(u.x, u.y, x, y).d / ab.v('projectile_speed'), () => {
      if (!aimed(w)) return;
      for (let i = 0; i < n; i++) w.after(i * ab.v('tick_interval'), () => { for (const e of enemiesNear(ab, x, y, ab.v('radius'))) { stun(ab, e, ab.v('stun_duration')); hit(ab, e, ab.v('avalanche_damage') / n, MAGICAL); } });
    });
  },
});
modifier('modifier_tiny_toss', { purge: 'none', statusResist: false, state: ['STUN'] });
debuff('modifier_tiny_toss_land', { stats: (m) => ({ msPct: -m.v('land_movement_slow'), asSlow: -m.v('land_attack_slow') }) });
function tinyLandSlow(u, e) {
  const g = u.findAbility('tiny_grow');
  if (g && e.alive && g.v('land_debuff_duration') > 0) e.addModifier('modifier_tiny_toss_land', { caster: u, ability: g, duration: g.v('land_debuff_duration') });
}
function tinyGrab(u, ab) {
  let best = null; let bd = ab.v('grab_radius');
  for (const e of u.world.units) {
    if (e === u || !e.alive || e.isBuilding || e.def.rel === 'ward' || e.st[ST.OUT] > 0 || e.st[ST.INVULN] > 0 || e.st[ST.IMMUNE] > 0) continue;
    const d = u.distTo(e); if (d <= bd) { bd = d; best = e; }
  }
  return best;
}
defAbility('tiny_toss', {
  prio: 72, fid: 'approx',
  note: 'grabs the nearest unit within grab_radius (ally or enemy, not debuff immune; it may be the target itself; with nobody there the order is refused, live), which is helpless in the air for `duration` and lands on the target: enemies within radius take toss_damage + Grow\'s toss_bonus_damage (an allied passenger takes none). Shard: the other enemies take toss_land_damage_pct more and are slowed. Buildings take 33% (tooltip note). The controller only tosses when the unit it would grab is an enemy; runes and the no-target talent are not modelled',
  ai(ab, u, t) { if (!t) return null; const g = tinyGrab(u, ab); return g && g.team !== u.team && u.distTo(t) <= ab.castRange() + 100 ? { target: t } : null; },
  cast(ab, t) {
    const u = ab.owner; const w = u.world; const g = tinyGrab(u, ab);
    if (!g) { refuseCast(ab); return; } // [L] measured in Hero Demo (tiny_toss): nothing within grab_radius = the order is refused (no mana, no cooldown)
    g.addModifier('modifier_tiny_toss', { caster: u, ability: ab, duration: ab.v('duration') });
    w.after(ab.v('duration'), () => {
      const lx = t.x; const ly = t.y; const grow = u.findAbility('tiny_grow');
      if (g.alive && g !== t) { g.x = lx + g.def.hull + t.def.hull; g.y = ly; }
      const dmg = ab.v('toss_damage') + (grow && grow.level > 0 ? grow.v('toss_bonus_damage') : 0);
      for (const e of enemiesNear(ab, lx, ly, ab.v('radius'))) {
        hit(ab, e, dmg * (e === g ? 1 : 1 + ab.v('toss_land_damage_pct') / 100) * (e.isBuilding ? 0.33 : 1), MAGICAL);
        if (e !== g) tinyLandSlow(u, e);
      }
    });
  },
});
function tinyTreeGone(u) { const tg = u.findAbility('tiny_tree_grab'); if (tg && !u.world.freeSpells) { tg.cdEnd = 0; tg.startCooldown(); } }
buff(TINY_TREE, {
  purge: 'none', multi: 'stack',
  stats: (m) => ({ attackRange: Math.max(0, m.v('attack_range') - m.parent.def.range), dmgBase: m.v('bonus_damage') }),
  outgoing(m, d) { if ((d.flags & F_ATTACK) && d.dst.isBuilding) d.amount *= 1 + m.v('bonus_damage_buildings') / 100; },
  onAttack(m, rec) { if (!rec.secondary && !rec.fromAbility) (rec.data ||= {}).tree = m; },
  onAttackLanded(m, rec) {
    const u = m.parent;
    if (!(rec.data && rec.data.tree === m)) return;
    if (rec.damage > 0) {
      const d = dirTo(u.x, u.y, rec.target.x, rec.target.y); const half = m.v('splash_width') / 2;
      for (const h of inCone(u, u.x + d.x * half, u.y + d.y * half, d.x, d.y, Math.max(0, m.v('splash_range') - 2 * half), half, half)) if (h.e !== rec.target && !h.e.isBuilding) u.world.damage(u, h.e, rec.damage * m.v('splash_pct') / 100, PHYSICAL, F_SECONDARY, m.ability);
    }
    if (m.stacks <= 1) { m.remove(); tinyTreeGone(u); } else m.setStacks(m.stacks - 1);
  },
  onAttackMiss(m, rec) { if (!(rec.data && rec.data.tree === m)) return; if (m.stacks <= 1) { m.remove(); tinyTreeGone(m.parent); } else m.setStacks(m.stacks - 1); },
});
defAbility('tiny_tree_grab', {
  prio: 60, fid: 'approx',
  note: 'the sandbox has no trees: outside rules.fresh a tree within reach is assumed, so Tiny grabs one when a fight starts and again whenever the cooldown allows (under rules.fresh the order is refused, as in the treeless test arena; the held-tree numbers are therefore not verified live). attack_count attacks with the attack range, bonus base damage, building damage bonus and a splash of splash_pct to enemies in the splash_width x splash_range strip in front of him (reduced by their armor). The cooldown starts when the tree is used up or thrown',
  ai: (ab, u, t) => (t && !u.hasModifier(TINY_TREE) && u.distTo(t) < 1200 ? { target: u } : null),
  cast(ab) {
    const u = ab.owner;
    if (u.world.fresh) { refuseCast(ab); return; } // [L] measured in Hero Demo (tiny_tree_grab): no tree within reach in the test arena = the order is refused
    syncLevel(u.findAbility('tiny_toss_tree'), ab);
    u.removeModifierByName(TINY_TREE);
    u.addModifier(TINY_TREE, { ability: ab, stacks: ab.v('attack_count') });
    if (!u.world.freeSpells) ab.cdEnd = u.world.time + 1e6;
  },
});
// a thrown tree landing at (x, y): Tiny's attack with Tree Throw's bonus damage. With a target it is a full attack on it plus splash; without one every enemy in the radius takes the attack without on-hit effects.
function tinyTreeHit(tt, x, y, r, target, credit = tt) {
  const u = tt.owner; const w = u.world; const tg = u.findAbility('tiny_tree_grab');
  // [L] measured in Hero Demo (tiny_tree_channel): with Tree Grab unlearned a Tree Volley tree deals Tiny's plain attack (no Tree Throw bonus)
  const flat = tt.level > 0 ? tt.v('bonus_damage') : 0; let main = 0;
  if (target && target.alive && target.attackableBy(u)) main = w.launchAttack(u, target, { instant: true, fromAbility: credit, flat }).damage;
  for (const e of enemiesNear(tt, x, y, r)) {
    if (e !== target) { if (target) { if (main > 0) w.damage(u, e, main * (tg ? tg.v('splash_pct') : 100) / 100, PHYSICAL, F_SECONDARY, credit); } else if (e.attackableBy(u)) w.launchAttack(u, e, { instant: true, secondary: true, fromAbility: credit, flat }); }
    tinyLandSlow(u, e);
  }
}
defAbility('tiny_toss_tree', {
  prio: 74, fid: 'approx',
  note: 'throws the held tree (ends Tree Grab and starts its cooldown): a full attack on the target with bonus_damage, splash of Tree Grab\'s splash_pct to enemies within splash_radius; Shard adds damage, radius and the landing slow. The controller throws the last charge instead of swinging it. Level follows Tree Grab',
  ai(ab, u, t) { const m = u.findModifier(TINY_TREE); return t && m && m.stacks <= 1 && u.distTo(t) <= ab.castRange() + 100 ? tgt(ab, t) : null; },
  cast(ab, t) {
    const u = ab.owner; const m = u.findModifier(TINY_TREE);
    if (!m) return;
    syncLevel(ab, m.ability); m.remove(); tinyTreeGone(u);
    u.world.projectile(u, t, ab.v('speed'), (tt) => tinyTreeHit(ab, tt.x, tt.y, ab.v('splash_radius'), tt));
  },
});
defAbility('tiny_tree_channel', {
  prio: 76, channel: true, fid: 'approx',
  note: 'the sandbox has no trees: enough trees within tree_grab_radius for a full volley are assumed. One tree at the start of the channel and then every `interval` flies at `speed` to the target point (from Tiny: the real flight starts at the tree, so live arrival times differ by the tree positions); each one deals Tiny\'s attack with Tree Throw\'s bonus damage (none while Tree Grab is unlearned, live) to every enemy within splash_radius of the point (no on-hit effects), plus the Shard landing slow. Used as an opener while the target hero is out of reach',
  ai(ab, u, t) { return t && t.isHero && u.rangeTo(t) - u.attackRange > 250 && u.distTo(t) <= ab.castRange() ? predict(t, 1) : null; },
  cast(ab, t, x, y) {
    const u = ab.owner; const w = u.world; const tt = u.findAbility('tiny_toss_tree'); const token = (ab.data = { on: true });
    if (!tt) return;
    syncLevel(tt, u.findAbility('tiny_tree_grab'));
    // [L] measured in Hero Demo: the first tree leaves when the channel starts, then one every interval (channel / interval trees)
    const n = Math.round(ab.v('AbilityChannelTime') / ab.v('interval'));
    for (let i = 0; i < n; i++) w.after(i * ab.v('interval'), () => { if (token.on && u.alive) w.after(dirTo(u.x, u.y, x, y).d / ab.v('speed'), () => tinyTreeHit(tt, x, y, ab.v('splash_radius'), null, ab)); });
  },
  channelEnd(ab) { if (ab.data) ab.data.on = false; },
});
passive('tiny_insurmountable', {
  fid: 'full',
  late(m, s, u) {
    s.slowResMul *= 1 - Math.min(100, u.str * m.v('str_to_slow_resist_pct') / 100) / 100;
    s.statusResMul *= 1 - Math.min(100, u.str * m.v('str_to_status_resist_pct') / 100) / 100;
    s.asSlow *= Math.max(0, s.slowResMul); // slow resistance also weakens attack speed slows (Grow's reduction goes through `as`, untouched)
  },
});
passive('tiny_grow', {
  fid: 'full', note: 'attack_speed_reduction is a percentage of his total attack speed (7.39 patch note: "from 30% to 35%")',
  stats: { armor: 'bonus_armor', dmg: 'bonus_damage', ms: 'move_speed' },
  late(m, s, u) { s.as += (u.def.baseAs + C.AS_PER_AGI * u.agi + s.as + s.asSlow) * m.v('attack_speed_reduction') / 100; },
});

// ================================================================ Abaddon
const AB_BT = 'modifier_abaddon_borrowed_time_active'; const AB_SHIELD = 'modifier_abaddon_aphotic_shield';
// `a` points of damage (or health cost) taken by the barrier; Shard: part of it is dealt to nearby enemies
function abShieldTook(m, a, reflected = false) {
  const t = m.parent; const pct = m.v('absorb_to_damage');
  m.data.left -= a;
  // absorbed reflected damage is not turned into damage again (it would bounce between the shield and a damage-return effect forever)
  if (pct > 0 && a > 0 && !reflected) for (const e of t.world.enemiesInRadius(m.caster, t.x, t.y, m.v('absorb_damage_aoe'))) mhit(m, e, a * pct / 100, MAGICAL, C.F_REFLECT);
  if (m.data.left <= 1e-6) m.remove();
}
buff(AB_SHIELD, {
  postMit(m, d) {
    if (d.amount <= 0 || (d.flags & F_HP_LOSS) || m.parent.hasModifier(AB_BT)) return; // no absorption during Borrowed Time (tooltip note)
    const a = Math.min(d.amount, m.data.left);
    d.amount -= a; abShieldTook(m, a, (d.flags & C.F_REFLECT) !== 0);
  },
  onDestroy(m) { const t = m.parent; for (const e of t.world.enemiesInRadius(m.caster, t.x, t.y, m.v('radius'))) mhit(m, e, m.v('damage_absorb'), MAGICAL); },
});
defAbility('abaddon_aphotic_shield', {
  prio: 70, fid: 'full', note: 'cast on the weakest allied hero below 85% health, otherwise on Abaddon when the enemy is near',
  ai(ab, u, t) {
    if (!t) return null;
    const ok = (a) => !a.isImmune() && !a.hasModifier(AB_SHIELD);
    const a = weakestAlly(u, ab.castRange(), true, ok);
    if (a && a.hp / a.maxHp < 0.85) return { target: a };
    return ok(u) && u.distTo(t) < 700 ? { target: u } : null;
  },
  cast(ab, t) {
    const u = ab.owner; const tt = t || u;
    tt.purge({ debuffs: true, strong: true });
    tt.removeModifierByName(AB_SHIELD);
    tt.addModifier(AB_SHIELD, { caster: u, ability: ab, duration: ab.v('duration'), data: { left: ab.v('damage_absorb') } });
  },
});
buff('modifier_abaddon_death_coil_haste', { stats: (m) => ({ msPct: m.v('movement_speed_pct') }) });
debuff('modifier_abaddon_death_coil_slow', { stats: (m) => ({ msPct: -m.v('movement_speed_pct') }) });
const abCoilCost = (ab) => ab.v('damage_heal') * ab.v('self_damage_pct') / 100;
defAbility('abaddon_death_coil', {
  prio: 58, fid: 'approx',
  note: 'heals the weakest other allied hero below 60% health, otherwise nukes the target; the health cost (self_damage_pct of the amount) is taken from his own Aphotic Shield first and never kills him (other barriers are not drained). Scepter: every unit within effect_radius of the target is affected (allies healed and hasted, Abaddon excluded; enemies damaged, slowed and hit by an instant attack at `potency` item potency; cleave is not excluded)',
  ai(ab, u, t) {
    if (u.hp <= abCoilCost(ab) * 2 && !u.hasModifier(AB_BT)) return null;
    const a = weakestAlly(u, ab.castRange(), false);
    if (a && a.hp / a.maxHp < 0.6) return { target: a };
    return t ? tgt(ab, t) : null;
  },
  cast(ab, t) {
    const u = ab.owner; const w = u.world; let cost = abCoilCost(ab); const sh = u.findModifier(AB_SHIELD);
    if (sh) { const a = Math.min(cost, sh.data.left); cost -= a; abShieldTook(sh, a); }
    if (cost > 0) w.damage(u, u, cost, PURE, F_HP_LOSS | C.F_NON_LETHAL, ab); // [L] the game records it as damage from Death Coil to Abaddon
    w.projectile(u, t, ab.v('missile_speed'), (tt) => {
      const r = ab.v('effect_radius'); const amount = ab.v('damage_heal'); const dur = ab.v('duration');
      const friends = r > 0 ? alliesNear(ab, tt.x, tt.y, r).filter((a) => a !== u) : tt.team === u.team ? [tt] : [];
      const foes = r > 0 ? enemiesNear(ab, tt.x, tt.y, r) : tt.team !== u.team ? [tt] : [];
      for (const a of friends) { a.heal(amount, u, ab); addMod(ab, a, 'modifier_abaddon_death_coil_haste', dur); }
      for (const e of foes) {
        hit(ab, e, amount, MAGICAL);
        if (!e.alive) continue;
        addMod(ab, e, 'modifier_abaddon_death_coil_slow', dur);
        if (ab.v('perform_attack') > 0 && u.alive && e.attackableBy(u)) w.launchAttack(u, e, { instant: true, fromAbility: ab, mult: ab.v('damage_percentage_on_perform_attack') / 100, potency: ab.v('potency') });
      }
    });
  },
});
buff('modifier_abaddon_frostmourne_buff', { purge: 'none', stats: (m) => ({ as: m.parent === m.caster ? m.v('curse_self_attack_speed') : m.v('curse_attack_speed') }) });
const abCurseHaste = (m) => { for (const a of attackersOf(m.parent, m.caster.team)) a.addModifier('modifier_abaddon_frostmourne_buff', { caster: m.caster, ability: m.ability, duration: m.v('curse_interval') + 0.1 }); };
debuff('modifier_abaddon_frostmourne_debuff', {
  interval: (m) => m.v('curse_interval'), stats: (m) => ({ msPct: -m.v('curse_slow') }),
  onCreated(m) { abCurseHaste(m); }, onRefresh(m) { abCurseHaste(m); },
  onThink(m) { const t = m.parent; if (!t.isBuilding) mhit(m, t, m.v('curse_dps') * m.v('curse_interval'), MAGICAL); abCurseHaste(m); },
});
passive('abaddon_frostmourne', {
  fid: 'full', note: 'the attack speed bonus is held by every unit of Abaddon\'s team whose current order targets the cursed unit (Abaddon gets his own, larger value); not applied by illusions',
  onAttackLanded(m, rec) { const t = rec.target; if (!rec.secondary && t.alive) t.addModifier('modifier_abaddon_frostmourne_debuff', { caster: m.parent, ability: m.ability, duration: m.v('curse_duration') + 0.05 }); },
});
debuff('modifier_abaddon_withering_mist_debuff', {
  dynamic: true,
  stats: (m) => { const t = m.parent; const lo = m.v('min_heal_reduction_pct'); return { restore: -(lo + (m.v('max_heal_reduction_pct') - lo) * (1 - Math.max(0, Math.min(1, t.hp / t.maxHp)))) }; },
});
passive('abaddon_withering_mist', {
  fid: 'full',
  onDealDamage(m, d) {
    const t = d.dst;
    if (t.team === m.parent.team || !t.alive || d.dealt <= 0 || (d.ability && d.ability.isItem)) return;
    t.addModifier('modifier_abaddon_withering_mist_debuff', { caster: m.parent, ability: m.ability, duration: m.v('duration') });
  },
});
buff(AB_BT, { purge: 'none', postMit(m, d) { if (d.amount <= 0 || (d.flags & F_HP_LOSS)) return; const a = d.amount; d.amount = 0; m.parent.heal(a, m.parent, m.ability); } });
function abBorrowedTime(ab) { const u = ab.owner; u.purge({ debuffs: true, strong: true }); u.addModifier(AB_BT, { ability: ab, duration: ab.v('duration') }); }
modifier('modifier_abaddon_borrowed_time', {
  hidden: true, purge: 'none',
  onTakeDamage(m, d) { const u = m.parent; const ab = m.ability; if (u.hp <= 0 || u.hp >= ab.v('hp_threshold') || u.hasModifier(AB_BT) || !ab.cdReady()) return; ab.startCooldown(); abBorrowedTime(ab); },
});
defAbility('abaddon_borrowed_time', {
  mods: ['modifier_abaddon_borrowed_time'], manual: true, prio: 97, fid: 'full',
  note: 'the automatic activation is modelled: when damage leaves him alive below hp_threshold and the cooldown is ready (not while Broken) he gets the strong dispel and all damage heals him for the duration. Manual early activation is left to explicit orders, hence `manual`',
  ai: (ab, u) => (u.hp < ab.v('hp_threshold') * 1.5 && !u.hasModifier(AB_BT) ? NT : null),
  cast(ab) { abBorrowedTime(ab); },
});

// ================================================================ Jakiro
const JK_FROST = 'modifier_jakiro_liquid_ice_debuff';
debuff('modifier_jakiro_dual_breath_slow', { stats: (m) => ({ msPct: m.v('slow_movement_speed_pct'), asSlow: m.v('slow_attack_speed_pct') }) });
dot('modifier_jakiro_dual_breath_burn', { damage: (m) => m.v('burn_damage') * 0.5, type: MAGICAL, interval: 0.5 });
defAbility('jakiro_dual_breath', {
  prio: 60, fid: 'full', note: 'cone from start_radius to end_radius over the cast range; the ice wave (slow) reaches each enemy at `speed`, the fire wave (burn, ticking twice per second) follows fire_delay later',
  ai: (ab, u, t) => (t ? { x: t.x, y: t.y } : null),
  cast(ab, t, x, y) {
    const u = ab.owner; const w = u.world; const d = dirTo(u.x, u.y, t ? t.x : x, t ? t.y : y); const dur = ab.v('AbilityDuration');
    if (!aimed(w)) return;
    for (const h of inCone(u, u.x, u.y, d.x, d.y, ab.castRange(), ab.v('start_radius'), ab.v('end_radius'))) {
      const e = h.e;
      w.after(h.along / ab.v('speed'), () => { if (e.alive) addMod(ab, e, 'modifier_jakiro_dual_breath_slow', dur); });
      w.after(ab.v('fire_delay') + h.along / ab.v('speed_fire'), () => { if (e.alive) addMod(ab, e, 'modifier_jakiro_dual_breath_burn', dur + 0.05); });
    }
  },
});
defAbility('jakiro_ice_path', {
  prio: 72, fid: 'full', note: 'path = line from Jakiro through the target point, as long as the cast range and path_radius to each side; it appears after path_delay and for path_duration stuns and damages each enemy once on touch (the stun never outlasts the path)',
  ai: (ab, u, t) => (t && !t.cantAct() && !(t.st[ST.IMMUNE] > 0) ? predict(t, ab.v('AbilityCastPoint') + ab.v('path_delay')) : null),
  cast(ab, t, x, y) {
    const u = ab.owner; const w = u.world; const d = dirTo(u.x, u.y, x, y); const sx = u.x; const sy = u.y; const len = ab.castRange(); const r = ab.v('path_radius');
    const life = ab.v('path_duration'); const done = new Set(); const step = 0.1;
    if (!aimed(w)) return;
    for (let i = 0; i * step <= life + 1e-6; i++) {
      w.after(ab.v('path_delay') + i * step, () => {
        for (const h of inCone(u, sx, sy, d.x, d.y, len, r, r)) {
          const e = h.e;
          if (done.has(e) || e.st[ST.IMMUNE] > 0) continue;
          done.add(e);
          stun(ab, e, Math.max(step, Math.min(ab.v('stun_duration'), life - i * step)));
          hit(ab, e, ab.v('damage'), MAGICAL);
        }
      });
    }
  },
});
debuff('modifier_jakiro_liquid_fire_debuff', {
  interval: (m) => m.v('tick_rate'), stats: (m) => ({ asSlow: m.v('slow_attack_speed_pct') }),
  onThink(m) { const t = m.parent; mhit(m, t, (t.isBuilding ? m.v('damage') * m.v('building_dmg_pct') / 100 : m.v('damage') + t.maxHp * m.v('pct_health_damage') / 100) * m.v('tick_rate'), MAGICAL); },
});
modifier(JK_FROST, {
  debuff: true, interval: (m) => m.v('tick_rate'), stats: (m) => ({ msPct: -m.v('movement_slow') }),
  preMit(m, d) { if (m.y === 1 || d.src !== m.caster || d.amount <= 0 || (d.ability && d.ability.isItem)) return; d.amount += m.v('bonus_instance_damage_from_other_abilities'); },
  onThink(m) { const t = m.parent; const p = m.v('pct_health_damage'); if (p > 0) { m.y = 1; mhit(m, t, t.maxHp * p / 100 * m.v('tick_rate'), MAGICAL); m.y = 0; } },
});
const jkReady = (ab, u) => !!ab && ab.level > 0 && ab.cdReady() && !u.isSilenced() && (u.world.freeSpells || u.mana >= ab.manaCost());
function jkPay(ab, u) { if (!u.world.freeSpells) u.mana -= ab.manaCost(); ab.startCooldown(); }
const jkHooks = {
  onAttack(m, rec) {
    const u = m.parent;
    if (rec.secondary || rec.fromAbility || (rec.data && rec.data.jk)) return;
    (rec.data ||= {}).jk = 1;
    const fire = u.findAbility('jakiro_liquid_fire'); const ice = u.findAbility('jakiro_liquid_ice');
    if (!fire || !ice) return;
    const L = Math.max(fire.level, ice.level); // linked abilities share one level
    if (fire.level !== L) fire.setLevel(L);
    if (ice.level !== L) ice.setLevel(L);
    let useFire = jkReady(fire, u); let useIce = jkReady(ice, u) && !rec.target.isBuilding;
    if (fire.v('shares_cooldown') > 0 && useFire && useIce) { if (fire.data === 'fire') useFire = false; else useIce = false; }
    if (useFire) { jkPay(fire, u); if (fire.v('shares_cooldown') > 0 && !u.world.freeSpells) ice.cdEnd = fire.cdEnd; fire.data = 'fire'; rec.data.jkFire = 1; }
    if (useIce && jkReady(ice, u)) { jkPay(ice, u); if (ice.v('shares_cooldown') > 0 && !u.world.freeSpells) fire.cdEnd = ice.cdEnd; fire.data = 'ice'; rec.add += ice.v('damage'); rec.data.jkIce = 1; }
  },
  onAttackLanded(m, rec) {
    const u = m.parent; const t = rec.target; const dd = rec.data;
    if (!dd || dd.jk !== 1) return;
    dd.jk = 2;
    if (dd.jkFire) { const fire = u.findAbility('jakiro_liquid_fire'); for (const e of u.world.enemiesInRadius(u, t.x, t.y, fire.v('radius'))) addMod(fire, e, 'modifier_jakiro_liquid_fire_debuff', fire.v('AbilityDuration') + 0.05); }
    if (dd.jkIce && t.alive) { const ice = u.findAbility('jakiro_liquid_ice'); addMod(ice, t, JK_FROST, ice.v('duration') + 0.05); }
  },
};
const JK_ORB_NOTE = 'autocast assumed on: used on the first attack after the cooldown (mana is spent). Liquid Fire and Liquid Frost are linked (one shared level) and share a cooldown unless the Shard is owned: without it they are used alternately, Liquid Fire first';
passive('jakiro_liquid_fire', { ...jkHooks, fid: 'approx', note: JK_ORB_NOTE + '. Burn (plus the talent\'s max-health part) every tick_rate and the attack slow on all enemies within radius of the target, buildings included' });
passive('jakiro_liquid_ice', { ...jkHooks, fid: 'approx', note: JK_ORB_NOTE + '. Impact damage is added to the attack; the chilled unit is slowed and takes bonus_instance_damage_from_other_abilities more from every instance of damage Jakiro deals (attacks and abilities, not items, not Liquid Frost itself), added before resistances and not spell-amplified' });
passive('jakiro_double_trouble', {
  fid: 'approx', note: 'every regular attack is two attacks second_attack_delay apart, each with on-hit effects; attack_damage_reduction lowers his base attack damage permanently (measured live: the attack damage stat of the game already shows it, 166 -> 133 at level 30), so it also applies to attacks launched by abilities; the second one does not ignore damage block',
  stats: (m) => ({ dmgBasePct: -m.v('attack_damage_reduction') }),
  onAttack(m, rec) {
    const u = m.parent; const t = rec.target;
    if (rec.secondary || rec.fromAbility) return;
    u.world.after(m.v('second_attack_delay'), () => { if (u.alive && t.alive && t.attackableBy(u) && !u.isDisarmed()) u.world.launchAttack(u, t, { fromAbility: m.ability }); });
  },
});
debuff('modifier_jakiro_macropyre_ice_slow', { pierce: true, stats: (m) => ({ msPct: -m.v('ice_edge_movement_slow') }) });
defAbility('jakiro_macropyre', {
  prio: 82, fid: 'approx',
  note: 'flames = strip from Jakiro through the target point, as long as the cast range and path_width wide; `damage` per second in burn_interval steps to enemies inside and for linger_duration after they leave. Scepter: longer, pure, piercing, and two ice lines along the edges (ice_edge_path_offset outside the flames, ice_edge_path_radius to each side) slow enemies standing on them',
  ai: (ab, u, t) => (t && t.isHero && u.distTo(t) <= ab.castRange() - 200 ? { x: t.x, y: t.y } : null),
  cast(ab, t, x, y) {
    const u = ab.owner; const w = u.world; const d = dirTo(u.x, u.y, x, y); const sx = u.x; const sy = u.y; const len = ab.castRange(); const half = ab.v('path_width') / 2;
    const step = ab.v('burn_interval'); const life = ab.v('duration'); const linger = ab.v('linger_duration'); const pure = ab.v('pure_damage_type') > 0; const last = new Map();
    for (let i = 0; i * step <= life + linger + 1e-6; i++) {
      w.after(i * step, () => {
        const now = i * step;
        if (now <= life + 1e-6) for (const h of inCone(u, sx, sy, d.x, d.y, len, half, half)) last.set(h.e, now);
        if (i > 0) for (const [e, seen] of last) if (e.alive && now - seen <= linger + 1e-6) hit(ab, e, ab.v('damage') * step, pure ? PURE : MAGICAL, pure ? F_PIERCE : 0);
      });
    }
    const edge = ab.v('ice_edge_path_radius');
    if (!(edge > 0)) return;
    const off = half + ab.v('ice_edge_path_offset');
    for (let i = 0; i * 0.1 <= life + 1e-6; i++) {
      w.after(i * 0.1, () => {
        for (const e of w.units) {
          if (!e.alive || e.team === u.team || e.st[ST.OUT] > 0) continue;
          const rx = e.x - sx; const ry = e.y - sy; const along = rx * d.x + ry * d.y;
          if (along < 0 || along > len || Math.abs(Math.abs(rx * d.y - ry * d.x) - off) > edge + e.def.hull) continue;
          e.addModifier('modifier_jakiro_macropyre_ice_slow', { caster: u, ability: ab, duration: ab.v('ice_edge_linger_duration'), pierce: true });
        }
      });
    }
  },
});

// ================================================================ Shadow Shaman
defAbility('shadow_shaman_ether_shock', {
  prio: 55, fid: 'approx', note: 'the target plus the nearest other enemies inside a cone from Shadow Shaman towards it (start_radius widening to end_radius over end_distance), `targets` units in total',
  ai: (ab, u, t) => (t ? tgt(ab, t) : null),
  cast(ab, t) {
    const u = ab.owner; const d = dirTo(u.x, u.y, t.x, t.y);
    const more = inCone(u, u.x, u.y, d.x, d.y, Math.max(d.d, ab.v('end_distance')), ab.v('start_radius'), ab.v('end_radius')).map((h) => h.e).filter((e) => e !== t && !(e.st[ST.IMMUNE] > 0));
    for (const e of [t, ...more].slice(0, ab.v('targets'))) hit(ab, e, ab.v('damage'), MAGICAL);
  },
});
// [L] measured in Hero Demo: the hexed unit also reports the silenced, disarmed and muted states
debuff('modifier_shadow_shaman_voodoo_hex', { purge: 'strong', state: ['HEX', 'SILENCE', 'DISARM', 'MUTE'], stats: (m) => ({ msCap: (m.data && m.data.ms) || 140 }) });
defAbility('shadow_shaman_voodoo', {
  prio: 86, fid: 'full', note: 'illusions are destroyed outright; the "Hex Breaks" talent adds Break for the same time. Own hex modifier (strong dispel only, as the data says) that also carries silence, disarm and mute, as the game reports them',
  ai: (ab, u, t) => (t && t.isHero && !t.cantAct() ? tgt(ab, t) : null),
  cast(ab, t) {
    const u = ab.owner;
    if (t.isIllusion) { u.world.kill(t, u, ab); return; }
    const m = addMod(ab, t, 'modifier_shadow_shaman_voodoo_hex', ab.v('duration'), { data: { ms: ab.v('movespeed') } });
    if (m && u.talents.has('special_bonus_unique_shadow_shaman_7')) addMod(ab, t, 'modifier_break', m.remaining(), { noResist: true });
  },
});
// [L] measured in Hero Demo: a tick of total_damage / channel_time x tick_interval lands when the target is shackled and then every
// tick_interval (channel_time / tick_interval ticks over a full channel, none when it ends); the Scepter shock also fires at once
// and then every scepter_shock_interval (5 shocks over 4.2 s)
function ssShackleTick(m) {
  const t = m.parent; const c = m.caster; const ab = m.ability;
  const dealt = mhit(m, t, ab.v('total_damage') / ab.v('channel_time') * ab.v('tick_interval'), MAGICAL);
  if (dealt > 0 && c.alive) c.heal(dealt * ab.v('heal_percentage') / 100, c, ab);
}
modifier('modifier_shadow_shaman_shackles', {
  debuff: true, purge: 'strong', state: ['STUN'], interval: (m) => m.v('tick_interval'), thinkNow: true,
  onCreated(m) { m.y = -Infinity; },
  onThink(m) {
    const t = m.parent; const c = m.caster; const ab = m.ability; const now = t.world.time;
    if (!c.alive || c.channelAb !== ab) { m.remove(); return; }
    ssShackleTick(m);
    const every = ab.v('scepter_shock_interval'); const es = c.findAbility('shadow_shaman_ether_shock');
    if (!(every > 0) || now - m.y + 1e-9 < every) return;
    m.y = now;
    if (es && es.level > 0) for (const e of t.world.enemiesInRadius(c, t.x, t.y, ab.v('scepter_shock_radius'))) if (e !== t) t.world.damage(c, e, es.v('damage') * ab.v('scepter_shock_pct') / 100, MAGICAL, 0, ab); // [L] credited to Shackles (Hero Demo)
  },
  onDestroy(m) { const c = m.caster; if (c.channelAb === m.ability && typeof c.endChannel === 'function') c.endChannel(true); },
});
defAbility('shadow_shaman_shackles', {
  prio: 80, channel: (ab) => ab.v('channel_time'), fid: 'approx',
  note: 'the target is fully disabled while Shadow Shaman channels; total_damage is dealt in equal ticks every tick_interval starting when the target is shackled (channel_time / tick_interval ticks, measured live) and heals him for heal_percentage of what was dealt; the channel stops when the target is freed. Scepter: at once and then every scepter_shock_interval the other enemies within scepter_shock_radius of the target take scepter_shock_pct of Ether Shock\'s damage (credited to Shackles; live the gaps are 0.9 or 1.0 s, not reproduced); casting it on allies or wards is not used by the controller',
  ai: (ab, u, t) => (t && t.isHero && !t.cantAct() ? tgt(ab, t) : null),
  cast(ab, t) { ab.data = t; addMod(ab, t, 'modifier_shadow_shaman_shackles', ab.v('channel_time') + 0.2); },
  channelEnd(ab) { const t = ab.data; ab.data = null; if (t) { const m = t.findModifier('modifier_shadow_shaman_shackles', ab.owner); if (m) m.remove(); } },
});
buff('modifier_shadow_shaman_fowl_play_chicken', { purge: 'none', state: ['HEX'], stats: (m) => ({ msPct: m.v('movespeed_bonus_pct') }) });
buff('modifier_shadow_shaman_fowl_play_guard', { purge: 'none', postMit(m, d) { if (d.amount > 0) d.amount *= Math.max(0, 1 - m.v('damage_reduction_pct') / 100); } });
passive('shadow_shaman_fowl_play', {
  fid: 'approx',
  note: 'on lethal damage (cooldown ready, not Culling Blade / Reaper\'s Scythe): strong dispel, survives at 1 health as a chicken for hex_duration (cannot attack, cast or use items, bonus move speed), takes no damage for damage_reduction_duration, and total_chickens - 1 decoy illusions that do nothing appear next to him. Enemies keep their current target (the confusion itself cannot be modelled). The Shard text in the data is stale',
  onDeath(m, ev) {
    const u = m.parent; const ab = m.ability;
    if (ev.prevent || !ab.cdReady() || (ev.ability && /^(axe_culling_blade|necrolyte_reapers_scythe)$/.test(ev.ability.name))) return;
    ev.prevent = true; u.hp = 1; ab.startCooldown();
    u.purge({ debuffs: true, strong: true });
    u.addModifier('modifier_shadow_shaman_fowl_play_chicken', { ability: ab, duration: ab.v('hex_duration') });
    u.addModifier('modifier_shadow_shaman_fowl_play_guard', { ability: ab, duration: ab.v('damage_reduction_duration') });
    for (let i = 1; i < ab.v('total_chickens'); i++) {
      const c = u.world.createIllusion(u, { duration: ab.v('hex_duration'), outPct: -100, inPct: ab.v('ally_chicken_images_take_damage_percent') - 100, x: u.x + (i % 2 ? 70 : -70), y: u.y + 40 * i });
      c.ai = null;
    }
  },
});
// Serpent Wards: stationary units with pip health (a hero attack removes 1, anything else attacking 0.25, nothing else hurts them)
modifier('modifier_shadow_shaman_mass_serpent_ward_unit', {
  hidden: true, purge: 'none', state: ['IMMUNE'], interval: 0.2, thinkNow: true,
  stats: (m) => ({ attackRange: m.v('bonus_attack_range') }),
  postMit(m, d) { if (d.amount <= 0) return; const s = d.src; d.amount = !(d.flags & F_ATTACK) || (d.flags & F_SECONDARY) ? 0 : s && realHero(s) ? 1 : 0.25; },
  onThink(m) {
    const wd = m.parent; const ai = wd.ai;
    if (!ai) return;
    const reach = (e) => wd.distTo(e) <= wd.attackRange + wd.def.hull + e.def.hull;
    const cur = ai.target;
    if (cur && cur.alive && cur.attackableBy(wd) && reach(cur)) return;
    let best = null; let bs = Infinity;
    for (const e of wd.world.units) { if (!e.alive || e.team === wd.team || !e.attackableBy(wd) || !reach(e)) continue; const s = (e.isHero ? 0 : 1e6) + wd.distTo(e); if (s < bs) { bs = s; best = e; } }
    if (best) ai.target = best;
  },
  onAttack(m, rec) {
    const wd = m.parent; let n = m.v('bonus_attack_targets');
    if (rec.secondary || rec.fromAbility || !(n > 0)) return;
    for (const e of wd.world.units) {
      if (n <= 0) break;
      if (!e.alive || e.team === wd.team || e === rec.target || !e.attackableBy(wd) || wd.distTo(e) > wd.attackRange + wd.def.hull + e.def.hull) continue;
      wd.world.launchAttack(wd, e, { fromAbility: m.ability }); n--;
    }
  },
});
function ssWard(ult, x, y, life, mega) {
  const u = ult.owner; const dmg = ult.v('ward_damage_tooltip') * (mega ? ult.v('mega_ward_multiplier_damage') : 1);
  const wd = summon(ult, 'npc_dota_shadow_shaman_ward_1', { x, y, duration: life, ovr: { hp: ult.v('ward_health') * (mega ? ult.v('mega_ward_multiplier_health') : 1), dmgMin: dmg, dmgMax: dmg } });
  wd.addModifier('modifier_shadow_shaman_mass_serpent_ward_unit', { caster: u, ability: ult });
  wd.recompute(); wd.hp = wd.maxHp;
  return wd;
}
defAbility('shadow_shaman_mass_serpent_ward', {
  prio: 90, fid: 'approx',
  note: 'ward_count wards (unit npc_dota_shadow_shaman_ward_1 with ward_damage_tooltip damage and its Piercing attack type) evenly on a circle of spawn_radius around the point. Pip health = ward_health: a hero attack removes 1, attacks by creeps / illusions / summons 0.25 (the 25% is tooltip text), spells and splash nothing. Wards attack the nearest enemy hero in range, else the nearest enemy; talents add range and an extra target per attack',
  ai: (ab, u, t) => (t && t.isHero && u.distTo(t) <= ab.castRange() + 300 ? { x: t.x, y: t.y } : null),
  cast(ab, t, x, y) { const n = ab.v('ward_count'); for (let i = 0; i < n; i++) { const a = 2 * Math.PI * i / n; ssWard(ab, x + Math.cos(a) * ab.v('spawn_radius'), y + Math.sin(a) * ab.v('spawn_radius'), ab.v('duration'), false); } },
});
defAbility('shadow_shaman_urnaconda', {
  prio: 68, fid: 'approx', note: 'the jar lands after distance / speed: impact_damage in impact_radius (the data gives no damage type: magical assumed) and one Massive Serpent Ward with mega_ward_multiplier_damage / _health times the ward values of the current Mass Serpent Ward level (no ward while the ultimate is unlearned: live only the impact lands); damage per hit and attack count verified live at ultimate level 3',
  ai: (ab, u, t) => (t ? predict(t, ab.v('AbilityCastPoint') + u.distTo(t) / ab.v('speed')) : null),
  cast(ab, t, x, y) {
    const u = ab.owner; const w = u.world; const ult = u.findAbility('shadow_shaman_mass_serpent_ward');
    w.after(dirTo(u.x, u.y, x, y).d / ab.v('speed'), () => {
      for (const e of enemiesNear(ab, x, y, ab.v('impact_radius'))) hit(ab, e, ab.v('impact_damage'), MAGICAL);
      // [L] measured in Hero Demo: with Mass Serpent Ward unlearned the jar only deals its impact damage (no ward attack follows)
      if (ult && ult.level > 0) ssWard(ult, x, y, ab.v('ward_duration'), true);
    });
  },
});

