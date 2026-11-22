// Hero abilities, part 4: Viper, Huskar, Dragon Knight, Spectre, Terrorblade, Shadow Fiend, Ogre Magi, Necrophos
// (+ the Ogre Frostmage creep ability ogre_magi_frost_armor).
// Reviewed clause by clause against the 7.42 tooltips (build 6983). Every number is read from the shipped data by value name;
// the few structural literals (think intervals, geometry) are named in the `note` of the ability that uses them.
import { defAbility, modifier, buff, debuff, passive, selfBuff, hit, addMod, stun, silence, enemiesNear, alliesNear, enemiesInLine, knockback, mhit, aura,
  ST, C, PHYSICAL, MAGICAL, PURE, F_ATTACK, F_NO_AMP, F_REFLECT, F_HP_LOSS, F_NO_LIFESTEAL, F_NON_LETHAL, F_SECONDARY } from '../engine/dsl.mjs';

// ---------------------------------------------------------------- shared helpers (same conventions as heroes_3.mjs)
const immune = (t) => t.st[ST.IMMUNE] > 0;
const realHero = (t) => t.isHero && !t.isIllusion;
// The engine silently refuses a unit-target spell that does not pierce on a debuff-immune enemy and the order would be retried
// forever, so every hand-written `ai` has to check this before returning { target }.
const canTarget = (ab, t) => !!t && t.alive && !t.isBuilding && (ab.pierces || !immune(t));
// A non-piercing effect that arrives later (projectile, delay) does nothing to an enemy that became debuff immune meanwhile.
const blocked = (ab, t) => immune(t) && !ab.pierces && t.team !== ab.owner.team;
// rules.skillshotHit: chance that a ground-aimed skillshot with travel time or delay finds its targets (default 1)
const dodged = (w) => w.skillshotHit < 1 && !w.rng.chance(w.skillshotHit);
const enemyHeroAlive = (u) => u.world.units.some((e) => e.alive && e.team !== u.team && realHero(e));
// long-cooldown single-target spells are kept for heroes while an enemy hero is alive
const worth = (u, t) => realHero(t) || !enemyHeroAlive(u);
const dispellable = (m) => m.def.debuff && (m.def.purge || 'basic') === 'basic';
// value of the ability's current level straight from the data table (before talents / upgrades)
const baseVal = (ab, key) => { const e = ab.def.vals[key]; const arr = Array.isArray(e) ? e : e.v; return arr[Math.max(1, Math.min(arr.length, ab.level)) - 1]; };

// Periodic effects. The engine removes an expiring modifier before running a think that is due at the same instant, which
// silently drops the last tick of a damage-over-time effect (6 s at 1 tick/s gave 5 ticks). `ticker` restores that tick.
// With `every` > 1, `fast` runs on each think and `tick` on every n-th one (m.z counts the thinks).
function ticker(interval, tick, every = 1, fast = null) {
  return {
    interval,
    onThink(m) { if (fast) fast(m); if (++m.z >= every) { m.z = 0; tick(m); } },
    onDestroy(m, expired) { if (expired && m.parent.alive && m.z + 1 >= every && m.nextThink <= m.dieTime + 1e-6) tick(m); },
  };
}

// Facing. The sandbox has no facing, so a unit is taken to face the unit it is currently ordered to attack or cast on.
const facingTarget = (u) => {
  let t = u.orderTarget; if (t && t.alive && t !== u) return t;
  const ai = u.ai; t = ai ? (ai.fixedTarget && ai.fixedTarget.alive ? ai.fixedTarget : ai.target) : null; if (t && t.alive && t !== u) return t;
  t = u.attackTarget; return t && t.alive && t !== u ? t : null;
};

// Enemies swept by a wave that travels `len` from the caster towards (x, y) at `speed` while its radius changes linearly from r0
// to r1 (round ends, like the game's linear projectiles). Returns [[enemy, seconds until the wave touches it], ...]; evaluated at
// cast time. The game moves a linear projectile once per server tick, starting in the tick it is created, and hits what its circle
// touches: the delay is a whole number of ticks and is shorter than distance / speed by the wave's radius.
// [L] measured in Hero Demo: Breathe Fire (speed 1050, radius 150 -> 250 over 750) hits a unit 500 away 8 ticks after the cast.
function inWave(u, x, y, len, r0, r1, speed) {
  let dx = x - u.x; let dy = y - u.y; const d = Math.hypot(dx, dy);
  if (d < 1e-6) { dx = 1; dy = 0; } else { dx /= d; dy /= d; }
  const out = []; const us = u.world.units; const dt = u.world.dt; const step = speed * dt; const steps = Math.max(1, Math.ceil(len / step - 1e-6));
  for (let i = 0; i < us.length; i++) {
    const e = us[i];
    if (!e.alive || e.team === u.team || e.isBuilding || e.st[ST.OUT] > 0) continue;
    const rx = e.x - u.x; const ry = e.y - u.y;
    for (let n = 0; n <= steps; n++) {
      const k = Math.min(len, n * step); const px = rx - dx * k; const py = ry - dy * k;
      const r = r0 + (r1 - r0) * (k / len) + e.def.hull;
      if (px * px + py * py <= r * r) { out.push([e, Math.max(0, n - 1) * dt]); break; }
    }
  }
  return out;
}

// Abilities flagged PASSIVE in the data that gain an active part with Scepter / Shard cannot go through the engine's cast
// pipeline (Ability.ready() is false for passives). Their active part is started from the passive modifier's think instead,
// and only for units whose controller is allowed to use that ability. The internal cooldown end is kept in m[slot].
function aiMay(u, name) {
  const ai = u.ai;
  if (!ai || ai.mode !== 'fight') return false;
  return ai.abilities === 'all' || (Array.isArray(ai.abilities) && ai.abilities.includes(name)) || (Array.isArray(ai.order) && ai.order.includes(name));
}
function innerCast(m, slot, manaKey, cdKey) {
  const u = m.parent; const w = u.world; const ab = m.ability;
  if (w.time + 1e-9 < m[slot] || u.cantAct() || u.isSilenced() || u.channelAb || u.castAb || !aiMay(u, ab.name)) return false;
  if (!w.freeSpells) {
    const cost = manaKey ? m.v(manaKey) * (1 - u.manaCostRed / 100) : 0;
    if (u.mana + 1e-9 < cost) return false;
    u.mana -= cost; m[slot] = w.time + m.v(cdKey) * u.cdrMul;
  }
  ab.casts++; u.mCasts++;
  if (w.log) w.logEvent('cast', u, null, ab.name, 0);
  return true;
}

// Fear. The engine's fear state only takes the unit's actions away; feared units are deliberately not moved by these scripts:
// the engine's attack order never starts an attack on a target that keeps moving away (the attacker steps to the edge of its
// range and waits for the next tick), so a running unit could not be hit by any melee unit for the whole fear.

// ================================================================ Viper
const POISON = 'modifier_viper_poison_attack_debuff';
debuff(POISON, {
  multi: 'stack', maxStacks: (m) => m.v('max_stacks'),
  stats: (m) => ({ msPct: -m.v('movement_speed') * m.stacks, mr: -m.v('magic_resistance') * m.stacks, armor: -m.v('shard_armor_reduction') * m.stacks }),
  ...ticker(1, (m) => mhit(m, m.parent, m.v('damage') * m.stacks * (m.parent.isBuilding ? m.v('shard_building_dmg_pct') / 100 : 1), MAGICAL)),
});
passive('viper_poison_attack', {
  fid: 'full', note: 'autocast assumed on (mana per attack); the +bonus_range of the orb is kept as a permanent attack range bonus',
  stats: { attackRange: 'bonus_range' },
  onAttack(m, rec) {
    const u = m.parent; const t = rec.target;
    if (immune(t) || (t.isBuilding && m.v('shard_building_dmg_pct') <= 0)) return;      // Shard: also affects buildings (reduced damage)
    if (!u.world.freeSpells) { const cost = m.ability.manaCost(); if (u.mana < cost) return; u.mana -= cost; }
    (rec.data ||= {}).vpoison = m;
  },
  onAttackLanded(m, rec) { if (rec.data && rec.data.vpoison === m && rec.target.alive) rec.target.addModifier(POISON, { caster: m.parent, ability: m.ability, duration: m.v('duration') }); },
});

// Nethertoxin. Pools pulse every 0.5 s and keep a debuff on the units inside; the debuff's age is the time the unit has spent in
// the pool and the debuff deals the damage itself, so several pools never stack. Pools are listed on the ability (ab.data) for the
// Scepter part of Corrosive Skin.
const TOXIN = 'modifier_viper_nethertoxin_debuff'; const TOXIN_STEP = 0.5;
const toxinDps = (m) => m.v('min_damage') + (m.v('max_damage') - m.v('min_damage')) * Math.min(1, Math.max(0, m.parent.world.time - m.created - TOXIN_STEP / 2) / m.v('max_duration'));
debuff(TOXIN, { statusResist: false, stats: (m) => ({ asSlow: -m.v('attack_slow') }), ...ticker(TOXIN_STEP, (m) => mhit(m, m.parent, toxinDps(m) * TOXIN_STEP, MAGICAL)) });
function toxinPool(nt, x, y) {
  const u = nt.owner; const w = u.world; const dur = nt.v('duration'); const n = Math.max(1, Math.round(dur / TOXIN_STEP));
  const pool = { x, y, r: nt.v('radius'), start: w.time, until: w.time + dur };
  nt.data = (nt.data || []).filter((p) => p.until >= w.time); nt.data.push(pool);
  const pulse = () => {
    pool.r = nt.v('radius') + (nt.v('expand_interval') > 0 ? nt.v('radius_increase') * Math.floor((w.time - pool.start) / nt.v('expand_interval') + 1e-6) : 0);      // talent: growing radius
    for (const e of w.inRadius(x, y, pool.r, u.team, true)) {
      if (e.isBuilding) continue;
      if (immune(e)) hit(nt, e, nt.v('min_damage') * TOXIN_STEP, MAGICAL);       // area damage still lands on debuff-immune units, without the ramp
      else e.addModifier(TOXIN, { caster: u, ability: nt, duration: TOXIN_STEP + 1e-6 });
    }
  };
  pulse(); for (let i = 1; i < n; i++) w.after(i * TOXIN_STEP, pulse);
}
defAbility('viper_nethertoxin', {
  fid: 'approx', note: 'the pool pulses every 0.5 s; a unit\'s damage per second grows from min_damage to max_damage over max_duration seconds spent inside and restarts when it leaves', prio: 50,
  ai: (ab, u, t) => (t && !t.isBuilding && !t.hasModifier(TOXIN) ? { x: t.x, y: t.y } : null),
  cast(ab, t, x, y) { const u = ab.owner; u.world.after(Math.hypot(x - u.x, y - u.y) / ab.v('projectile_speed'), () => toxinPool(ab, x, y)); },
});

// Corrosive Skin. Debuff: m.x = attack slow factor (Scepter: effect_multiplier while within effect_multiplier_distance of Viper),
// re-checked every 0.5 s, damage every second. Passive: m.x = Scepter bonus share, m.y = seconds Viper has stood in his Nethertoxin.
const CSKIN = 'modifier_viper_corrosive_skin_debuff';
const skinNear = (m) => { const c = m.caster; const k = m.v('effect_multiplier') > 0 && m.parent.distTo(c) <= m.v('effect_multiplier_distance') ? m.v('effect_multiplier') : 1; if (k !== m.x) { m.x = k; m.parent.dirty = true; } };
const skinBonus = (viper) => { const p = viper.findModifier('modifier_viper_corrosive_skin'); return p ? 1 + p.x : 1; };
// "Damage done by this ability is considered reflected damage" (no lifesteal, cannot be reflected)
const skinTick = ticker(0.5, (m) => mhit(m, m.parent, m.v('damage') * skinBonus(m.caster), MAGICAL, F_REFLECT), 2, skinNear);
debuff(CSKIN, { ...skinTick, stats: (m) => ({ asSlow: -m.v('bonus_attack_speed') * (m.x || 1) }), onCreated: skinNear });
const corrode = (cs, e, duration) => e.addModifier(CSKIN, { caster: cs.owner, ability: cs, duration });
passive('viper_corrosive_skin', {
  fid: 'full', note: 'Scepter: the bonus in Nethertoxin grows linearly to nethertoxin_bonus_pct and is lost when Viper leaves the pool; distance and pool checks run every 0.5 s',
  interval: 0.5,
  stats: (m) => ({ mr: m.v('bonus_magic_resistance') * (1 + m.x) }),
  onThink(m) {
    const u = m.parent; const pct = m.v('nethertoxin_bonus_pct'); let k = 0;
    if (pct > 0) {
      const nt = u.findAbility('viper_nethertoxin'); const now = u.world.time; let inside = false;
      for (const p of (nt && nt.data) || []) if (p.until >= now && (u.x - p.x) ** 2 + (u.y - p.y) ** 2 <= p.r * p.r) { inside = true; break; }
      m.y = inside ? m.y + 0.5 : 0;
      k = pct / 100 * Math.min(1, m.y / m.v('nethertoxin_bonus_pct_max_duration_tooltip'));
    }
    if (k !== m.x) { m.x = k; u.dirty = true; }
  },
  onTakeDamage(m, d) {
    const u = m.parent; const s = d.src;
    if (s && s.alive && s !== u && s.team !== u.team && !s.isBuilding && !(d.flags & (F_REFLECT | F_HP_LOSS)) && u.distTo(s) <= m.v('max_range')) corrode(m.ability, s, m.v('duration'));
  },
});

defAbility('viper_nose_dive', {
  fid: 'approx', note: 'Viper is placed on the target point when the dive lands (distance / dive_speed after the cast) and is not locked during the flight', prio: 70,
  ai: (ab, u, t) => (t && !t.isBuilding && !(u.st[ST.ROOT] > 0) ? { x: t.x, y: t.y } : null),
  cast(ab, t, x, y) {
    const u = ab.owner;
    u.world.after(Math.hypot(x - u.x, y - u.y) / ab.v('dive_speed'), () => {
      if (!u.alive) return;
      if (!(u.st[ST.ROOT] > 0)) { u.x = x; u.y = y; }
      const nt = u.findAbility('viper_nethertoxin'); const cs = u.findAbility('viper_corrosive_skin');
      if (nt && nt.level > 0) toxinPool(nt, u.x, u.y);              // releases a Nethertoxin of the current level
      if (cs && cs.level > 0) for (const e of enemiesNear(ab, u.x, u.y, ab.v('corrosive_radius'))) if (!e.isBuilding) corrode(cs, e, ab.v('effect_duration'));
    });
  },
});
passive('viper_predator', {
  fid: 'full',
  // [L] measured in Hero Demo: the bonus is its own physical instance, dealt just before the attack's damage and computed on the
  // health the target has before that attack
  outgoing(m, d) {
    const rec = d.rec; const t = d.dst;
    if (!rec || !(d.flags & F_ATTACK) || rec.secondary || rec.attacker !== m.parent || !t.isHero || immune(t) || t.team === m.parent.team) return;
    const x = m.v('damage') * (1 - t.hp / t.maxHp) * 100;
    if (x > 0) m.parent.world.damage(m.parent, t, x, PHYSICAL, 0, m.ability);
  },
});

// Viper Strike. m.x = share of the slow that is left (fades linearly over the duration, updated every 0.5 s), m.y = 1 while it breaks.
const STRIKE = 'modifier_viper_viper_strike_debuff';
const strikeFade = (m) => { const k = Math.max(0, m.remaining() / Math.max(0.01, m.dieTime - m.created)); if (k !== m.x) { m.x = k; m.parent.dirty = true; } };
const strikeTick = ticker(0.5, (m) => mhit(m, m.parent, m.v('damage'), MAGICAL), 2, strikeFade);
debuff(STRIKE, {
  pierce: true, purge: 'none', ...strikeTick,
  stats: (m) => ({ msPct: -m.v('bonus_movement_speed') * m.x, asSlow: -m.v('bonus_attack_speed') * m.x }),
  onCreated(m) { const t = m.parent; m.x = 1; if (m.v('does_break') > 0) { t.st[ST.BREAK]++; m.y = 1; t.dirty = true; } },
  onDestroy(m, expired) { const t = m.parent; if (m.y === 1) { t.st[ST.BREAK]--; t.dirty = true; } strikeTick.onDestroy(m, expired); },
});
defAbility('viper_viper_strike', {
  fid: 'approx', note: 'the tooltip only says the slow reduces over the duration: it is faded linearly to zero, in 0.5 s steps', prio: 80,
  ai: (ab, u, t) => (t && !t.isBuilding && worth(u, t) && !t.hasModifier(STRIKE) ? { target: t } : null),
  cast(ab, t) { const u = ab.owner; u.world.projectile(u, t, ab.v('projectile_speed'), (tt) => addMod(ab, tt, STRIKE, ab.v('duration'))); },
});

// ================================================================ Huskar
// Blood Magic: "Huskar's Health Costs are Magical Damage and can be reduced by Magic Resist"; a cost never kills him.
const bloodCost = (u, amount, ab) => (amount > 0 ? u.world.damage(u, u, amount, MAGICAL, F_NON_LETHAL | F_NO_AMP, ab) : 0);

defAbility('huskar_inner_fire', {
  fid: 'approx', note: 'the knockback is applied instantly (enemies are not kept in motion for knockback_duration)', prio: 60,
  // the data gives this no-target spell a cast range and the engine would walk Huskar towards (0, 0), so the AI "targets" his own position
  ai: (ab, u, t) => (t && u.distTo(t) <= ab.v('radius') - 150 ? { x: u.x, y: u.y } : null),
  cast(ab) {
    const u = ab.owner;
    bloodCost(u, ab.v('health_cost'), ab);
    for (const e of enemiesNear(ab, u.x, u.y, ab.v('radius') + 64)) {
      if (e.isBuilding || u.distTo(e) > ab.v('radius') + e.def.hull) continue;      // [L] measured in Hero Demo: the unit's collision radius counts
      hit(ab, e, ab.v('damage'), MAGICAL);
      if (!e.alive || immune(e)) continue;
      silence(ab, e, ab.v('disarm_duration'));                      // 7.42 text: "dealing damage and silencing them" (the value kept its old name)
      knockback(e, u.x, u.y, Math.max(ab.v('min_knockback_distance'), ab.v('knockback_distance') - u.distTo(e)));      // knocked back TO knockback_distance
    }
  },
});

// Burning Spear: one debuff per target, m.data = expiry time of every spear; each burns for `duration`, all tick together once per second.
const SPEAR = 'modifier_huskar_burning_spear_debuff';
debuff(SPEAR, {
  purge: 'none', interval: 1, onCreated(m) { m.data = []; },
  onThink(m) {
    const t = m.parent; const now = t.world.time;
    m.data = m.data.filter((exp) => exp >= now - 1e-6);
    const n = m.data.length; m.stacks = n;
    if (!n) { m.remove(); return; }
    // flat burn plus a share of the target's max health per spear ("does not deal extra Max Health Burn Damage to Roshan")
    mhit(m, t, (m.v('burn_damage') + (t.name === 'npc_dota_roshan' ? 0 : t.maxHp * m.v('burn_damage_max_pct') / 100)) * n, MAGICAL);
  },
});
passive('huskar_burning_spear', {
  fid: 'full', note: 'autocast assumed on; all spears on a target tick together once per second',
  onAttack(m, rec) {
    const u = m.parent; const t = rec.target;
    if (t.isBuilding || immune(t)) return;
    (rec.data ||= {}).spear = m;
    bloodCost(u, u.maxHp * m.v('max_health_cost') / 100, m.ability);          // % of MAX health, as magical damage to himself
  },
  onAttackLanded(m, rec) {
    const t = rec.target; const u = m.parent;
    if (!(rec.data && rec.data.spear === m) || !t.alive) return;
    const d = t.addModifier(SPEAR, { caster: u, ability: m.ability });
    if (d) { d.data.push(t.world.time + m.v('duration') * (1 - t.stats().statusRes) * (1 + u.debuffAmp / 100)); d.stacks = d.data.length; }
  },
});

// Berserker's Blood. m.x = share of the bonus (0 at full health, 1 below hp_threshold_max), refreshed every 0.1 s; m.y = Shard cooldown end.
const CAUTERIZE = 'modifier_huskar_berserkers_blood_cauterize';
buff(CAUTERIZE, { purge: 'none', onDestroy(m, expired) { const u = m.parent; if (expired && u.alive) u.heal(m.x, u, m.ability); } });       // m.x = heal on expiry
passive('huskar_berserkers_blood', {
  fid: 'full', note: 'health is sampled every 0.1 s. Shard: the ability is flagged passive, so AI units activate it automatically when it is off cooldown, an enemy is near and Huskar has a dispellable debuff or more than half of his health',
  interval: 0.1, thinkNow: true,
  onThink(m) {
    const u = m.parent;
    const k = Math.min(1, Math.max(0, (1 - u.hp / u.maxHp) / (1 - m.v('hp_threshold_max') / 100)));
    if (Math.abs(k - m.x) > 0.004 || (k !== m.x && (k === 0 || k === 1))) { m.x = k; u.dirty = true; }
    if (m.v('activatable') <= 0 || u.hasModifier(CAUTERIZE)) return;
    const t = facingTarget(u);
    if (!t || t.team === u.team || u.rangeTo(t) > u.attackRange + 200) return;
    let debuffs = 0; for (const x of u.mods) if (dispellable(x)) debuffs++;
    if ((!debuffs && u.hp / u.maxHp <= 0.5) || !innerCast(m, 'y', null, 'activation_cooldown')) return;
    u.purge({ debuffs: true });                                      // basic dispel, then the health cost, then the delayed heal
    const lost = bloodCost(u, u.hp * m.v('activation_healthcost_pct') / 100, m.ability);
    const c = u.addModifier(CAUTERIZE, { ability: m.ability, duration: m.v('activation_delay') });
    if (c) c.x = lost + u.maxHp * m.v('activation_heal_pct_per_debuff') / 100 * debuffs;
  },
  late(m, s, u) {
    const k = m.x; if (k <= 0) return;
    s.as += m.v('maximum_attack_speed') * k;
    s.mrMul *= 1 - m.v('maximum_magic_resist') * k / 100;
    s.hpRegen += u.str * m.v('maximum_health_regen') / 100 * k;      // "Health regen is a percentage of your strength"
  },
});
passive('huskar_blood_magic', {
  fid: 'full', illusion: true,
  late(m, s) { s.manaPct = -100; s.manaCostRed += 100; },            // no mana pool; mana costs never block a cast ...
  onCast(m, ev) {                                                    // ... item mana costs are paid in health instead
    const u = m.parent; const a = ev.ability;
    if (a.isItem && !u.world.freeSpells) bloodCost(u, a.v('AbilityManaCost') * Math.max(0, 2 - u.manaCostRed / 100), m.ability);
  },
});

// Life Break. The leap is a channel-like lock: Huskar, debuff immune, flies at charge_speed towards the target (following it when it
// moves) and hits on arrival. A disable stops the leap (whatever interrupts a channel in the engine), and so does a target that
// jumps further than LIFE_BREAK_JUMP between two ticks. m.x / m.y = the target's position at the last tick, m.z = time of that tick.
const LIFE_BREAK_JUMP = 1400;      // "the target moves more than 1400 units in 0.015 seconds": the number exists only in the tooltip note
// [L] measured in Hero Demo: the leap ends 55 units from the centre of a hero-sized target (the two collision radii + 7); Huskar is
// disarmed as well as debuff immune while he flies, and the hit lands in the tick he arrives.
const LIFE_BREAK_PAD = 7;
const lifeBreakLeft = (u, t) => u.distTo(t) - u.def.hull - t.def.hull - LIFE_BREAK_PAD;      // distance still to fly
// an attack order given by an ability is only carried out by a unit that has a controller (scene units have none: like in the live
// recordings, where a unit that was not ordered to attack is stopped)
const orderAttack = (u, t) => { if (u.ai) u.attack(t); };
debuff('modifier_huskar_life_break_slow', { pierce: true, stats: (m) => ({ msPct: m.v('movespeed'), asSlow: -m.v('attack_speed') }) });
debuff('modifier_huskar_life_break_taunt', { pierce: true, state: ['TAUNT'] });
buff('modifier_huskar_life_break_charge', {
  purge: 'none', state: ['IMMUNE', 'DISARM'], stats: (m) => ({ mr: m.v('immunity_resist') }), interval: (m) => m.parent.world.dt,
  onCreated(m) { const t = m.data; m.x = t.x; m.y = t.y; m.z = m.parent.world.time; },
  onThink(m) {
    const u = m.parent; const ab = m.ability; const t = m.data; const now = u.world.time;
    if (u.channelAb !== ab) { m.remove(); return; }
    if (!t.alive || Math.hypot(t.x - m.x, t.y - m.y) > LIFE_BREAK_JUMP) { u.endChannel(true); return; }
    const step = ab.v('charge_speed') * (now - m.z); const left = lifeBreakLeft(u, t);
    m.x = t.x; m.y = t.y; m.z = now;
    const go = Math.max(0, Math.min(step, left)); const d = u.distTo(t) || 1;
    u.x += (t.x - u.x) / d * go; u.y += (t.y - u.y) / d * go;
    if (left <= step + 1e-6) u.endChannel(false);
  },
});
// Scepter cast range: the engine has no per-ability cast range bonus, so the value is written into the ability's own cast range
modifier('modifier_huskar_life_break', { hidden: true, interval: 1, thinkNow: true, onThink(m) { const ab = m.ability; const want = baseVal(ab, 'AbilityCastRange') + ab.v('cast_range_bonus'); if (ab.vals.AbilityCastRange !== want) ab.vals.AbilityCastRange = want; } });
function lifeBreakHit(ab, t) {
  const u = ab.owner;
  if (!u.alive || !t || !t.alive) return;
  hit(ab, t, t.hp * ab.v('health_damage'), MAGICAL);
  bloodCost(u, u.hp * ab.v('health_cost_percent'), ab);
  if (t.alive) {
    addMod(ab, t, 'modifier_huskar_life_break_slow', ab.v('AbilityDuration'));
    if (ab.v('taunt_duration') > 0) addMod(ab, t, 'modifier_huskar_life_break_taunt', ab.v('taunt_duration'));        // Scepter
  }
  orderAttack(u, t);
}
defAbility('huskar_life_break', {
  mods: ['modifier_huskar_life_break'], prio: 85,
  fid: 'full', note: 'the leap ends early when Huskar is stunned, hexed, silenced, put to sleep or removed from play (whatever interrupts a channel in the engine), or when the target jumps more than 1400 units within one tick (that distance exists only in the tooltip note, not as a data value)',
  ai: (ab, u, t) => (t && !t.isBuilding && worth(u, t) ? { target: t } : null),
  channel: (ab) => (ab.data ? Infinity : 0),                         // the leap lasts until the charge modifier ends it
  cast(ab, t) {
    const u = ab.owner;
    u.purge({ debuffs: true });                                      // "DISPEL TYPE: Basic Dispel"
    ab.data = null;
    if (lifeBreakLeft(u, t) <= 0) { lifeBreakHit(ab, t); return; }
    ab.data = t;
    u.addModifier('modifier_huskar_life_break_charge', { ability: ab, data: t });
  },
  channelEnd(ab, interrupted) {
    const t = ab.data; ab.data = null;
    ab.owner.removeModifierByName('modifier_huskar_life_break_charge');
    if (!interrupted && t) lifeBreakHit(ab, t);
  },
});

// ================================================================ Dragon Knight
debuff('modifier_dragon_knight_breathe_fire_debuff', { stats: (m) => ({ dmgOutPct: -m.v('reduction') }) });
defAbility('dragon_knight_breathe_fire', {
  fid: 'approx', note: 'the breath is a wave from Dragon Knight (start_radius -> end_radius over range); enemies inside it at cast time are hit when it reaches them', prio: 55,
  ai: (ab, u, t) => (t && u.distTo(t) <= ab.v('range') ? { x: t.x, y: t.y } : null),      // ground cast: does not trigger spell block
  cast(ab, t, x, y) {
    const u = ab.owner; const w = u.world;
    if (t) { x = t.x; y = t.y; }
    if (dodged(w)) return;
    for (const [e, delay] of inWave(u, x, y, ab.v('range'), ab.v('start_radius'), ab.v('end_radius'), ab.v('speed'))) {
      w.after(delay, () => { if (!e.alive) return; hit(ab, e, ab.v('damage'), MAGICAL); if (e.alive) addMod(ab, e, 'modifier_dragon_knight_breathe_fire_debuff', ab.v('duration')); });
    }
  },
});
defAbility('dragon_knight_dragon_tail', {
  fid: 'full', prio: 70,
  ai: (ab, u, t) => (canTarget(ab, t) ? { target: t } : null),
  cast(ab, t) {
    const u = ab.owner;
    const land = () => {                                             // "stunning and damaging it and units close to it"
      // [L] measured in Hero Demo: a unit counts as close when its collision radius reaches into `aoe` around the target
      const list = enemiesNear(ab, t.x, t.y, ab.v('aoe') + 64).filter((e) => e !== t && !e.isBuilding && e.distTo(t) <= ab.v('aoe') + e.def.hull);
      if (t.alive && !blocked(ab, t)) list.unshift(t);
      for (const e of list) { stun(ab, e, ab.v('stun_duration')); hit(ab, e, ab.v('damage'), MAGICAL); }
    };
    if (u.melee) land(); else u.world.projectile(u, t, ab.v('projectile_speed'), land);      // thrown as a projectile in dragon form
  },
});
passive('dragon_knight_wyrms_wrath', {
  fid: 'full', stats: { aoe: 'bonus_aoe' },
  // [L] measured in Hero Demo: the magic damage is its own instance and is dealt just before the attack's damage
  outgoing(m, d) { const rec = d.rec; const t = d.dst; if (rec && (d.flags & F_ATTACK) && !rec.secondary && rec.attacker === m.parent && !t.isBuilding && t.team !== m.parent.team) mhit(m, t, m.v('magic_damage'), MAGICAL); },
});
const FIREBALL = 'modifier_dragon_knight_fireball_burn';
// [L] measured in Hero Demo: an enemy that enters the fire takes one full `damage` at once, then damage x burn_interval every
// burn_interval counted from its entry, until linger_duration after it left; the area is checked every tick (collision radius included)
debuff(FIREBALL, { statusResist: false, onCreated(m) { mhit(m, m.parent, m.v('damage'), MAGICAL); }, ...ticker((m) => m.v('burn_interval'), (m) => mhit(m, m.parent, m.v('damage') * m.v('burn_interval'), MAGICAL)) });
defAbility('dragon_knight_fireball', {
  fid: 'full', note: 'debuff-immune enemies in the fire take damage x burn_interval every burn_interval without the burn (not measured)', prio: 50,
  cast(ab, t, x, y) {
    const u = ab.owner; const w = u.world; const iv = ab.v('burn_interval'); const per = Math.max(1, Math.round(iv / w.dt)); const steps = Math.round(ab.v('duration') / w.dt);
    const scan = (i) => {
      const r = ab.v('radius');
      for (const e of w.units) {
        if (!e.alive || e.team === u.team || e.isBuilding || e.st[ST.OUT] > 0 || (e.x - x) ** 2 + (e.y - y) ** 2 > (r + e.def.hull) ** 2) continue;
        if (immune(e)) { if (i % per === 0) hit(ab, e, ab.v('damage') * iv, MAGICAL); } else addMod(ab, e, FIREBALL, ab.v('linger_duration'));
      }
    };
    scan(0); for (let i = 1; i <= steps; i++) w.after(i * w.dt, () => scan(i));
  },
});
const EDF = 'modifier_dragon_knight_elder_dragon_form';
passive('dragon_knight_dragon_blood', {
  fid: 'full',
  stats: (m) => { const k = m.parent.hasModifier(EDF) ? 1 + m.v('regen_and_armor_multiplier_during_dragon_form') / 100 : 1; return { hpRegen: m.v('health_regen') * k, armor: m.v('armor') * k }; },
});
// Elder Dragon Form: every level adds a breath; with Scepter the form is one level higher (the data carries a 4th column, the Black Dragon)
const edf = (ab, key) => { const e = ab.def.vals[key]; const arr = Array.isArray(e) ? e : e.v; return arr[Math.max(1, Math.min(arr.length, ab.level + (ab.owner.hasScepter ? ab.v('scepter_bonus_levels') : 0))) - 1]; };
const EDF_ACID = 'modifier_dragon_knight_elder_dragon_form_corrosive'; const EDF_FROST = 'modifier_dragon_knight_elder_dragon_form_frost';
debuff(EDF_ACID, { pierce: true, ...ticker(1, (m) => mhit(m, m.parent, edf(m.ability, 'corrosive_damage_per_second'), MAGICAL)) });
debuff(EDF_FROST, { pierce: true, stats: (m) => ({ msPct: -edf(m.ability, 'frost_bonus_movement_speed'), asSlow: -edf(m.ability, 'frost_bonus_attack_speed') }) });
buff(EDF, {
  purge: 'none',
  stats: (m) => ({ attackRange: m.v('bonus_attack_range'), ms: edf(m.ability, 'bonus_movement_speed'), mr: edf(m.ability, 'magic_resistance'), castRange: m.v('bonus_ability_cast_range') }),
  onCreated(m) { const u = m.parent; m.z = u.melee ? 1 : 0; u.melee = false; u.dirty = true; },
  onDestroy(m) { const u = m.parent; if (m.z === 1) u.melee = true; u.dirty = true; },
  onAttackLanded(m, rec) {
    if (rec.secondary) return;
    const u = m.parent; const ab = m.ability; const t = rec.target; const w = u.world;
    const breath = (e) => {
      if (!e.alive) return;
      e.addModifier(EDF_ACID, { caster: u, ability: ab, duration: edf(ab, 'corrosive_duration') });                    // green: corrosive, also on buildings
      const fd = edf(ab, 'frost_duration'); if (fd > 0 && !e.isBuilding) e.addModifier(EDF_FROST, { caster: u, ability: ab, duration: fd });      // blue: frost, pierces immunity
    };
    breath(t);
    const r = edf(ab, 'ranged_splash_radius');                       // red: splash
    if (r > 0 && rec.damage > 0) for (const e of w.inRadius(t.x, t.y, r, u.team, true)) { if (e === t || e.isBuilding) continue; w.damage(u, e, rec.damage * edf(ab, 'ranged_splash_damage_pct') / 100, PHYSICAL, F_SECONDARY, ab); breath(e); }
  },
});
selfBuff('dragon_knight_elder_dragon_form', {
  fid: 'full', note: 'the corrosive and frost breaths are also applied to the units hit by the splash; free pathing (Black Dragon) has no meaning on the open plane', prio: 90, engage: false,
  mod: EDF, duration: 'duration', ai: (ab, u, t) => (t && !u.hasModifier(EDF) ? true : null),
});

// ================================================================ Spectre
// Spectral Dagger. The dagger lays a Shadow Path along its flight (path_radius wide, dagger_path_duration long); enemies in it are
// slowed and Spectre is hasted, and both keep the effect buff_persistence seconds after leaving. A hero hit by the dagger is slowed
// for hero_path_duration (its own trailing path is not laid out). [L] measured in Hero Demo: the path is checked every 0.2 s, the first
// check 0.2 s after the cast; the slow of the path and of the hit do not add up.
const DAGGER_STEP = 0.2;
debuff('modifier_spectre_spectral_dagger_slow', { keepLonger: true, stats: (m) => ({ msPct: -m.v('bonus_movespeed') }) });
buff('modifier_spectre_spectral_dagger_buff', { keepLonger: true, stats: { msPct: 'bonus_movespeed' } });
function daggerPath(ab, x1, y1, x2, y2) {
  const u = ab.owner; const w = u.world; const t0 = w.time; const len = Math.hypot(x2 - x1, y2 - y1) || 1; const speed = ab.v('speed');
  const n = Math.floor(ab.v('dagger_path_duration') / DAGGER_STEP + 1e-6);
  const dx = (x2 - x1) / len; const dy = (y2 - y1) / len;
  const inPath = (e, k) => { let a = (e.x - x1) * dx + (e.y - y1) * dy; a = Math.max(0, Math.min(k, a)); const r = ab.v('path_radius') + e.def.hull; return (e.x - x1 - dx * a) ** 2 + (e.y - y1 - dy * a) ** 2 <= r * r; };
  for (let i = 1; i <= n; i++) w.after(i * DAGGER_STEP, () => {
    const k = Math.min(len, speed * (w.time - t0)); const keep = ab.v('buff_persistence');
    for (const e of w.units) {
      if (!e.alive || e.isBuilding || e.st[ST.OUT] > 0 || !inPath(e, k)) continue;
      if (e.team !== u.team) addMod(ab, e, 'modifier_spectre_spectral_dagger_slow', keep);
      else if (e === u) addMod(ab, u, 'modifier_spectre_spectral_dagger_buff', keep);
    }
  });
}
defAbility('spectre_spectral_dagger', {
  fid: 'approx', note: 'the path runs along the dagger\'s flight to the cast point; a hit hero is slowed for hero_path_duration but its trailing path is not laid out; only Spectre (not her allies) is hasted', prio: 60,
  ai: (ab, u, t) => (t && !t.isBuilding ? { x: t.x, y: t.y } : null),       // ground cast: does not trigger spell block
  cast(ab, t, x, y) {
    const u = ab.owner; const w = u.world; const r = ab.v('dagger_radius');
    if (!t) { let bd = Infinity; for (const e of w.inRadius(x, y, r, u.team, true)) { if (!e.isHero) continue; const d = (e.x - x) ** 2 + (e.y - y) ** 2; if (d < bd) { bd = d; t = e; } } }      // a hero under the cursor is followed
    if (t) { x = t.x; y = t.y; } else if (dodged(w)) return;
    for (const e of enemiesInLine(ab, u.x, u.y, x, y, 2 * r)) {
      if (e.isBuilding) continue;
      w.after(Math.max(0, u.distTo(e) - r - e.def.hull) / ab.v('speed'), () => { if (!e.alive) return; hit(ab, e, ab.v('damage'), MAGICAL); if (e.alive && e.isHero) addMod(ab, e, 'modifier_spectre_spectral_dagger_slow', ab.v('hero_path_duration')); });
    }
    daggerPath(ab, u.x, u.y, x, y);
  },
});

// talent: +% outgoing damage of all Spectre illusions (the value sits on Desolate)
const spectreIllusionBonus = (u) => { const d = u.findAbility('spectre_desolate'); return d && d.level > 0 ? d.v('illusion_damage_outgoing') : 0; };
const STEP_ILL = 'modifier_spectre_shadow_step_illusion'; const HAUNT_ILL = 'modifier_spectre_haunt_illusion';
modifier(STEP_ILL, { hidden: true, purge: 'none', stats: (m) => ({ msPct: m.v('bonus_move_speed_illusion_pct') }) });
modifier(HAUNT_ILL, { hidden: true, purge: 'none', interval: 0.25, onThink(m) { const t = m.data; if (m.v('destroy_if_target_is_dead') > 0 && t && !t.alive) m.parent.world.kill(m.parent, null, null, true); } });     // m.data = haunted hero
defAbility('spectre_shadow_step', {
  fid: 'full', prio: 50,
  ai: (ab, u, t) => (t && t.isHero ? { target: t } : null),          // heroes only
  cast(ab, t) {
    const u = ab.owner; const w = u.world;
    // [L] measured in Hero Demo: the illusion appears when the shadow reaches attack range of the target
    w.after(Math.max(0, u.rangeTo(t) - u.attackRange) / ab.v('move_speed'), () => {
      if (!t.alive || !u.alive) return;
      const ill = w.createIllusion(u, { duration: ab.v('duration'), outPct: ab.v('illusion_outgoing_damage') - 100 + spectreIllusionBonus(u), inPct: ab.v('illusion_damage_incoming'), potency: ab.v('illusion_effectiveness'), x: t.x + 60, y: t.y, target: t });
      ill.addModifier(STEP_ILL, { caster: u, ability: ab });
    });
  },
});

// Dispersion. m.y = Shard cooldown end, m.z = 1 while she is dispersing (re-entry guard).
const DISP_BOOST = 'modifier_spectre_dispersion_boost';
buff(DISP_BOOST, { purge: 'none' });
passive('spectre_dispersion', {
  fid: 'full', note: 'Shard: the ability is flagged passive, so AI units activate the boost automatically (off cooldown, mana, hurt by an enemy hero within the last second)',
  interval: 0.25,
  preMit(m, d) {                                                     // "Damage is reflected before reductions, and is returned as the same damage type"
    const u = m.parent; const w = u.world;
    // reflected damage is never reflected again (Dispersion of another Spectre arrives without the flag when she is debuff immune, see below)
    if (d.amount <= 0 || d.src === u || (d.flags & F_REFLECT) || m.z === 1 || (d.ability && d.ability.name === m.ability.name)) return;
    const refl = d.amount * m.v('damage_reflection_pct') * (u.hasModifier(DISP_BOOST) ? 1 + m.v('activation_bonus_pct') / 100 : 1) / 100;
    d.amount -= refl;                                                // "The reflected damage is not dealt to Spectre"
    const lo = m.v('min_radius'); const hi = m.v('max_radius');
    m.z = 1;
    for (const e of w.inRadius(u.x, u.y, hi, u.team, true)) {
      if (e.isBuilding) continue;
      const dist = u.distTo(e); const k = dist <= lo ? 1 : 1 - (dist - lo) / (hi - lo);
      // reflected damage: no lifesteal, cannot be reflected. The engine drops reflected damage on debuff-immune units, which Dispersion pierces.
      if (k > 0) w.damage(u, e, refl * k, d.type, F_NO_AMP | (immune(e) ? F_NO_LIFESTEAL : F_REFLECT), m.ability);
    }
    m.z = 0;
  },
  onThink(m) {
    const u = m.parent;
    if (m.v('activation_duration') <= 0 || u.hasModifier(DISP_BOOST) || u.world.time - u.lastHurt > 1) return;
    if (innerCast(m, 'y', 'activation_manacost', 'activation_cooldown')) u.addModifier(DISP_BOOST, { ability: m.ability, duration: m.v('activation_duration') });
  },
});

// Reality: jump into the place of a Shadow Step / Haunt illusion
debuff('modifier_spectre_reality_fear', { state: ['FEAR'], stats: (m) => ({ msPct: -m.x }) });      // m.x = fear_movespeed_slow of the Haunt that caused it
const spectreIllusions = (u) => u.world.units.filter((e) => e.alive && e.isIllusion && e.owner === u && (e.hasModifier(HAUNT_ILL) || e.hasModifier(STEP_ILL)));
const nearestTo = (list, x, y) => { let best = null; let bd = Infinity; for (const i of list) { const d = (i.x - x) ** 2 + (i.y - y) ** 2; if (d < bd) { bd = d; best = i; } } return best; };
defAbility('spectre_reality', {
  fid: 'approx', note: 'the swap is instant; the AI uses it only to reach a target that is out of attack range. Scepter fear: feared units lose their actions but stand still (the engine\'s fear does not make them run)', prio: 96,
  ai: (ab, u, t) => {
    if (!t || u.st[ST.ROOT] > 0 || u.rangeTo(t) <= u.attackRange + 100) return null;
    const i = nearestTo(spectreIllusions(u), t.x, t.y);
    return i && i.distTo(t) < u.distTo(t) - 200 ? { x: i.x, y: i.y } : null;
  },
  cast(ab, t, x, y) {
    const u = ab.owner; const w = u.world; const i = nearestTo(spectreIllusions(u), x, y);
    // [L] measured in Hero Demo: with no Shadow Step / Haunt illusion the order does nothing: no cooldown starts
    if (!i) { ab.cdEnd = 0; if (!w.freeSpells) u.mana += ab.manaCost(); ab.casts--; u.mCasts--; return; }
    const hm = i.findModifier(HAUNT_ILL); const victim = hm ? hm.data : i.ai ? i.ai.fixedTarget : null;
    u.x = i.x; u.y = i.y;
    w.kill(i, null, null, true);
    const haunt = u.findAbility('spectre_haunt');
    if (hm && haunt && haunt.data && haunt.data.fear) {              // Scepter: the first Reality on a Haunt illusion of each Haunt fears around the target
      haunt.data.fear = false;
      const c = victim && victim.alive ? victim : u;
      for (const e of enemiesNear(haunt, c.x, c.y, haunt.v('fear_aoe'))) { if (e.isBuilding) continue; const f = addMod(ab, e, 'modifier_spectre_reality_fear', haunt.v('fear_duration')); if (f) { f.x = haunt.v('fear_movespeed_slow'); e.dirty = true; } }
    }
    if (victim && victim.alive && victim.team !== u.team) u.attack(victim);
  },
});
passive('spectre_desolate', {
  fid: 'approx', note: 'any allied unit of the target counts as company (illusions too, ward-type units and buildings do not); illusions deal the full amount', illusion: true,
  // [L] measured in Hero Demo: the pure damage is its own instance, dealt just before the attack's damage
  outgoing(m, d) {
    const u = m.parent; const t = d.dst; const rec = d.rec;
    if (!rec || !(d.flags & F_ATTACK) || rec.secondary || rec.attacker !== u || !t.alive || t.isBuilding || t.team === u.team) return;
    const r = m.v('radius');
    for (const a of u.world.units) if (a !== t && a.alive && a.team === t.team && !a.isBuilding && a.def.atk !== 'none' && !(a.st[ST.OUT] > 0) && t.distTo(a) <= r) return;
    u.world.damage(u, t, m.v('bonus_damage'), PURE, 0, m.ability);
  },
});
defAbility('spectre_haunt', {
  fid: 'full', prio: 85, engage: false,
  ai: (ab, u, t) => (t && enemyHeroAlive(u) ? true : null),
  cast(ab) {
    const u = ab.owner; const w = u.world;
    ab.data = { fear: ab.v('fear_duration') > 0 };
    for (const e of w.units.slice()) {
      if (!e.alive || e.team === u.team || !realHero(e) || e.st[ST.OUT] > 0) continue;
      const ill = w.createIllusion(u, { duration: ab.v('duration'), outPct: ab.v('illusion_damage_outgoing') + spectreIllusionBonus(u), inPct: ab.v('illusion_damage_incoming'), potency: ab.v('illusion_effectiveness'), x: e.x + 60, y: e.y, target: e });
      ill.addModifier(HAUNT_ILL, { caster: u, ability: ab, data: e });
    }
  },
});

// ================================================================ Terrorblade
const META = 'modifier_terrorblade_metamorphosis'; const META_ILL = 'modifier_terrorblade_metamorphosis_illusion';
const ZEAL = 'modifier_terrorblade_demon_zeal'; const ZEAL_ILL = 'modifier_terrorblade_demon_zeal_illusion';
// illusions of Terrorblade himself that he owns (Reflection illusions are illusions of enemy heroes)
const tbImages = (u, r) => u.world.units.filter((i) => i.alive && i.isIllusion && i.owner === u && i.name === u.name && u.distTo(i) <= r);

// Reflection: the reflection lives exactly as long as the slow on its source (m.data = the reflection)
const REFL = 'modifier_terrorblade_reflection_slow';
debuff(REFL, { stats: (m) => ({ msPct: -m.v('move_slow'), asSlow: -m.v('attack_slow') }), onDestroy(m) { const i = m.data; if (i && i.alive) i.world.kill(i, null, null, true); } });
// "Reflections can only attack their source" (m.data = the source): whatever else the controller makes one swing at takes no damage
modifier('modifier_terrorblade_reflection_illusion', { hidden: true, purge: 'none', outgoing(m, d) { if (d.dst !== m.data) d.amount = 0; } });
defAbility('terrorblade_reflection', {
  fid: 'full', note: 'a reflection is locked on its source; while the source cannot be attacked the engine\'s controller may point it at another unit, which then takes no damage from it', prio: 55,
  ai: (ab, u, t) => (t && realHero(t) && !immune(t) && !t.hasModifier(REFL) ? { x: t.x, y: t.y } : null),
  cast(ab, t, x, y) {
    const u = ab.owner; const w = u.world; const dur = ab.v('illusion_duration');
    for (const e of w.inRadius(x, y, ab.v('range'), u.team, true)) {
      if (!realHero(e) || immune(e)) continue;
      e.removeModifierByName(REFL);
      const ill = w.createIllusion(e, { team: u.team, owner: u, duration: dur, outPct: ab.v('illusion_outgoing_damage'), inPct: 0, potency: ab.v('illusion_effectiveness'), x: e.x + 70, y: e.y, target: e, invulnerable: true });
      ill.st[ST.UNTARGETABLE]++;                                     // "Reflections are untargetable, invulnerable illusions"
      ill.addModifier('modifier_terrorblade_reflection_illusion', { caster: u, ability: ab, data: e });
      if (!e.addModifier(REFL, { caster: u, ability: ab, duration: dur, data: ill })) w.kill(ill, null, null, true);
    }
  },
});
defAbility('terrorblade_conjure_image', {
  fid: 'full', prio: 45, engage: false, ai: (ab, u, t) => (t ? true : null),
  cast(ab) { const u = ab.owner; u.world.createIllusion(u, { duration: ab.v('illusion_duration'), outPct: ab.v('illusion_outgoing_damage'), inPct: ab.v('illusion_incoming_damage') }); },
});

// Metamorphosis: Terrorblade and, through an aura, his own illusions within metamorph_aura_tooltip turn ranged
const metaStats = (m) => ({ attackRange: m.v('bonus_range'), dmg: m.v('bonus_damage'), bat: m.v('base_attack_time') });
const toRanged = (m) => { const u = m.parent; m.z = u.melee ? 1 : 0; u.melee = false; u.dirty = true; };
const toMelee = (m) => { const u = m.parent; if (m.z === 1) u.melee = true; u.dirty = true; };
buff(META, {
  purge: 'none', keepLonger: true, stats: metaStats, interval: 0.25, thinkNow: true,
  onCreated(m) { toRanged(m); m.parent.removeModifierByName(ZEAL); },         // "Metamorphosis will remove Demon Zeal"
  onDestroy: toMelee,
  onThink(m) { const u = m.parent; for (const i of tbImages(u, m.v('metamorph_aura_tooltip'))) i.addModifier(META_ILL, { caster: u, ability: m.ability, duration: 0.5 }); },
});
modifier(META_ILL, { hidden: true, purge: 'none', stats: metaStats, onCreated: toRanged, onDestroy: toMelee });
// [L] measured in Hero Demo: Terrorblade is stunned for transformation_time and only then takes the demon form; the form ends
// `duration` after the cast
modifier('modifier_terrorblade_metamorphosis_transform', { purge: 'none', state: ['STUN'], onDestroy(m) { const u = m.parent; if (u.alive) addMod(m.ability, u, META, Math.max(0.01, m.ability.v('duration') - m.ability.v('transformation_time'))); } });
defAbility('terrorblade_metamorphosis', {
  fid: 'full', note: 'illusions follow his form through a 0.25 s aura check', prio: 90, engage: false,
  ai: (ab, u, t) => (t && !u.hasModifier(META) && !u.hasModifier('modifier_terrorblade_metamorphosis_transform') ? true : null),
  cast(ab) { const u = ab.owner; if (u.hasModifier(META)) { addMod(ab, u, META, ab.v('duration')); return; } addMod(ab, u, 'modifier_terrorblade_metamorphosis_transform', ab.v('transformation_time')); },
});
const zealStats = (m) => ({ as: m.v('berserk_bonus_attack_speed'), ms: m.v('berserk_bonus_movement_speed'), hpRegen: m.v('hp_regen') });
buff(ZEAL, {
  purge: 'none', stats: zealStats, interval: 0.25, thinkNow: true,
  onThink(m) { const u = m.parent; for (const i of tbImages(u, m.v('radius'))) i.addModifier(ZEAL_ILL, { caster: u, ability: m.ability, duration: 0.5 }); },
});
modifier(ZEAL_ILL, { hidden: true, purge: 'none', stats: zealStats });
defAbility('terrorblade_demon_zeal', {
  fid: 'full', prio: 60,
  ai: (ab, u, t) => (t && !u.hasModifier(META) && !u.hasModifier(ZEAL) && u.rangeTo(t) <= u.attackRange + 300 ? true : null),
  cast(ab) {
    const u = ab.owner;
    if (u.hasModifier(META)) return;                                 // "Can't be cast while in Metamorphosis"
    u.world.damage(u, u, u.hp * ab.v('health_cost_pct') / 100, PURE, F_HP_LOSS | F_NON_LETHAL, ab);       // costs part of his current health
    addMod(ab, u, ZEAL, ab.v('duration'));
  },
});
debuff('modifier_terrorblade_terror_wave_fear', { state: ['FEAR', 'SILENCE', 'DISARM', 'MUTE'] });      // [L] measured in Hero Demo: a feared unit is also silenced, disarmed and muted
defAbility('terrorblade_terror_wave', {
  fid: 'approx', note: 'feared heroes lose their actions but stand still (the engine\'s fear does not make them run)', prio: 88, engage: false,
  ai: (ab, u, t) => (t && enemyHeroAlive(u) && u.distTo(t) <= 800 ? true : null),
  cast(ab) {
    const u = ab.owner; const w = u.world; const ox = u.x; const oy = u.y;
    for (const e of w.inRadius(ox, oy, ab.v('scepter_radius'), u.team, true)) {
      if (!e.isHero) continue;                                       // "forcing enemy heroes to become Feared upon impact and dealing damage"
      w.after(ab.v('scepter_spawn_delay') + Math.hypot(e.x - ox, e.y - oy) / ab.v('scepter_speed'), () => { if (!e.alive) return; addMod(ab, e, 'modifier_terrorblade_terror_wave_fear', ab.v('fear_duration')); hit(ab, e, ab.v('damage'), MAGICAL); });
    }
    const meta = u.findAbility('terrorblade_metamorphosis');
    if (meta && meta.level > 0) addMod(meta, u, META, ab.v('scepter_meta_duration'));
  },
});
// "Debuff Immune enemies don't get their HP modified": Sunder can be cast on them (the data flags it as not piercing, and the engine
// refuses such a cast), so the ability is marked as piercing and the cast itself leaves an immune enemy's health alone.
modifier('modifier_terrorblade_sunder', { hidden: true, purge: 'none', onCreated(m) { m.ability.pierces = true; } });
defAbility('terrorblade_sunder', {
  mods: ['modifier_terrorblade_sunder'],
  fid: 'full', note: 'a debuff-immune enemy can be chosen: Terrorblade takes its health percentage and the enemy keeps its own (tooltip note). The AI swaps when Terrorblade is below 30% health and the target has at least 20 points more', prio: 95,
  ai: (ab, u, t) => (canTarget(ab, t) && t.isHero && u.hp / u.maxHp < 0.3 && t.hp / t.maxHp > u.hp / u.maxHp + 0.2 ? { target: t } : null),
  cast(ab, t) {
    const u = ab.owner;
    if (!t || t === u) return;
    const min = ab.v('hit_point_minimum_pct') / 100; const a = u.hp / u.maxHp; const b = t.hp / t.maxHp; const foe = t.team !== u.team;
    u.hp = u.maxHp * Math.max(min, b);
    if (!(foe && immune(t))) t.hp = Math.max(1, t.maxHp * Math.max(foe && ab.v('ignore_minimum_pct_for_enemies') > 0 ? 0 : min, a));
  },
});
modifier('modifier_terrorblade_dark_unity_buff', { hidden: true, purge: 'none', stats: { dmgBasePct: 'inside_radius_bonus_damage_pct' } });
aura('modifier_terrorblade_dark_unity', { radius: (m) => m.v('radius'), team: 'ally', child: 'modifier_terrorblade_dark_unity_buff', self: false, filter: (t, m) => t.isIllusion && t.owner === m.parent });
defAbility('terrorblade_dark_unity', { mods: ['modifier_terrorblade_dark_unity'], fid: 'full', note: 'aura checked every 0.5 s; covers every illusion Terrorblade owns, Reflections included' });

// ================================================================ Shadow Fiend
const necro = (u) => u.findModifier('modifier_nevermore_necromastery');
const soulCount = (u) => { const nm = necro(u); return nm ? nm.stacks : 0; };
// one stacking debuff shared by the three Shadowrazes (named after the first one)
debuff('modifier_nevermore_shadowraze1_debuff', { multi: 'stack', stats: (m) => ({ msPct: -m.v('movement_speed_debuff') * m.stacks }) });
for (const n of [1, 2, 3]) {
  defAbility('nevermore_shadowraze' + n, {
    fid: 'approx', note: 'no facing in the sandbox: the raze lands shadowraze_range away in the direction of the unit Shadow Fiend is attacking or casting on. The three Shadowrazes share one level (the highest of the three)', prio: 50 + n, engage: false,
    ai: (ab, u, t) => (t && !t.isBuilding && Math.abs(u.distTo(t) - ab.v('shadowraze_range')) <= ab.v('shadowraze_radius') - 30 ? true : null),
    cast(ab) {
      const u = ab.owner; const w = u.world; const f = facingTarget(u); const t = f && f.team !== u.team ? f : w.nearestEnemy(u);
      if (!t || dodged(w)) return;
      const d = u.distTo(t) || 1; const r = ab.v('shadowraze_range'); let heroes = 0;
      for (const e of enemiesNear(ab, u.x + (t.x - u.x) / d * r, u.y + (t.y - u.y) / d * r, ab.v('shadowraze_radius'))) {
        if (e.isBuilding) continue;
        const s = e.findModifier('modifier_nevermore_shadowraze1_debuff');
        hit(ab, e, ab.v('shadowraze_damage') + ab.v('damage_per_soul') * soulCount(u) + ab.v('stack_bonus_damage') * (s ? s.stacks : 0), MAGICAL);
        if (ab.v('procs_attack') > 0 && e.alive) w.launchAttack(u, e, { instant: true, secondary: true, trueStrike: true, fromAbility: ab });      // talent: applies attack damage, no attack modifiers
        if (e.alive) addMod(ab, e, 'modifier_nevermore_shadowraze1_debuff', ab.v('duration'));
        if (realHero(e)) heroes++;
      }
      const cut = ab.v('cooldown_reduction_on_hero_hit') * heroes;    // Shard: this raze's cooldown per enemy hero hit
      if (cut > 0 && ab.cdEnd > w.time) ab.cdEnd = Math.max(w.time, ab.cdEnd - cut);
    },
  });
}

// Feast of Souls. m.data = souls taken from each enemy; m.z = cast speed factor while the talent speeds up his casts.
const FEAST = 'modifier_nevermore_frenzy';
buff(FEAST, {
  stats: { as: 'bonus_attack_speed', msPct: 'bonus_move_speed' },
  interval: (m) => m.v('soul_collection_interval'),
  onCreated(m) {
    m.data = new Map();
    const k = m.v('cast_speed_pct') / 100;                           // talent: cast speed (the engine has no such stat: cast points are scaled while the buff lasts)
    if (k > 0 && k !== 1) { m.z = k; for (const a of m.parent.abilities) if (a.vals.AbilityCastPoint > 0) a.vals.AbilityCastPoint /= k; }
  },
  onThink(m) {
    const u = m.parent; const nm = necro(u);
    let left = Math.min(m.v('soul_collection_per_interval'), m.v('max_collection_count') - m.data.size);
    if (!nm || left <= 0) return;
    const es = u.world.inRadius(u.x, u.y, m.v('soul_collection_radius'), u.team, true).filter((e) => !e.isBuilding && e.def.atk !== 'none' && !m.data.has(e)).sort((a, b) => u.distTo(a) - u.distTo(b));
    for (const e of es) {
      if (left-- <= 0) break;
      const n = realHero(e) ? m.v('soul_collection_per_hero') : m.v('soul_collection_per_creep');
      m.data.set(e, n); nm.setStacks(nm.stacks + n);
      if (m.v('heal_per_soul') > 0) u.heal(m.v('heal_per_soul') * n, u, m.ability);
    }
  },
  onDestroy(m) {
    const u = m.parent;
    if (m.z > 0) for (const a of u.abilities) a.refresh();
    const nm = necro(u); if (!nm || !u.alive) return;
    let lost = 0; for (const [e, n] of m.data) if (e.alive) lost += n;                   // souls of owners that are still alive are lost at once
    nm.setStacks(Math.max(0, nm.stacks - lost));
    u.world.after(m.v('linger_duration'), () => { const x = necro(u); if (x && u.alive && x.stacks > x.v('necromastery_max_souls')) x.setStacks(x.v('necromastery_max_souls')); });
  },
});
selfBuff('nevermore_frenzy', { fid: 'full', note: 'souls are collected from the nearest enemies first', prio: 60, mod: FEAST, duration: 'duration' });

modifier('modifier_nevermore_dark_lord_debuff', { debuff: true, pierce: true, purge: 'none', statusResist: false, stats: (m) => ({ armor: m.v('presence_armor_reduction'), mr: m.v('presence_magic_resistance_reduction') }) });
aura('modifier_nevermore_dark_lord', { radius: (m) => m.v('presence_radius'), team: 'enemy', child: 'modifier_nevermore_dark_lord_debuff', filter: (t) => !t.isBuilding });
defAbility('nevermore_dark_lord', { mods: ['modifier_nevermore_dark_lord'], fid: 'full' });

// Requiem of Souls: one line per soul, spread evenly around Shadow Fiend; every line is a wave whose radius grows from
// requiem_line_width_start to requiem_line_width_end over requiem_radius. Each line that covers a unit damages it.
debuff('modifier_nevermore_requiem_fear', { state: ['FEAR'] });
debuff('modifier_nevermore_requiem_slow', { stats: { msPct: 'requiem_reduction_ms' } });
const requiemLines = (ab, n) => Math.floor(Math.min(n, ab.v('max_soul_release')) / ab.v('requiem_soul_conversion'));
function requiem(ab, lines, onDeath) {
  const u = ab.owner; const w = u.world;
  if (lines <= 0) return;
  const R = ab.v('requiem_radius'); const r0 = ab.v('requiem_line_width_start'); const r1 = ab.v('requiem_line_width_end');
  const speed = ab.v('requiem_line_speed'); const ox = u.x; const oy = u.y; const dmg = ab.v('AbilityDamage');
  const t = facingTarget(u); const a0 = t ? Math.atan2(t.y - oy, t.x - ox) : 0;       // the first line points at the unit he faces
  const back = !onDeath && ab.v('requiem_damage_pct_scepter') > 0;                    // Scepter: the lines return and heal him
  for (const e of w.inRadius(ox, oy, R + r1 + 64, u.team, true)) {
    if (e.isBuilding) continue;
    const dx = e.x - ox; const dy = e.y - oy; let n = 0;
    for (let i = 0; i < lines; i++) {
      const a = a0 + 2 * Math.PI * i / lines; const ux = Math.cos(a); const uy = Math.sin(a);
      let k = dx * ux + dy * uy; if (k < 0) k = 0; else if (k > R) k = R;
      const px = dx - ux * k; const py = dy - uy * k; const r = r0 + (r1 - r0) * (k / R) + e.def.hull;
      if (px * px + py * py <= r * r) n++;
    }
    if (!n) continue;
    const d = Math.hypot(dx, dy);
    w.after(d / speed, () => {
      for (let i = 0; i < n && e.alive; i++) hit(ab, e, dmg, MAGICAL);
      if (!e.alive || onDeath) return;                               // "Fear and movement slow do not apply if the Requiem was released on death"
      const bonus = ab.v('requiem_duration_per_soul') * (n - 1);      // longer for every additional soul that hit
      addMod(ab, e, 'modifier_nevermore_requiem_fear', ab.v('requiem_fear_duration') + bonus);
      addMod(ab, e, 'modifier_nevermore_requiem_slow', ab.v('requiem_slow_duration') + bonus);
    });
    if (back) w.after((2 * R - d) / speed, () => {
      let dealt = 0; for (let i = 0; i < n && e.alive; i++) dealt += hit(ab, e, dmg * ab.v('requiem_damage_pct_scepter') / 100, MAGICAL);
      if (dealt > 0 && u.alive) u.heal(dealt * ab.v('requiem_heal_pct_scepter') / 100, u, ab);
    });
  }
}
defAbility('nevermore_requiem', {
  fid: 'approx', note: 'lines are spread evenly, the first one towards the unit Shadow Fiend faces, and are evaluated at cast time (width values taken as radii); every line covering a unit hits it when the wave arrives. Feared units lose their actions but stand still (the engine\'s fear does not make them run), so the equally long movement slow changes nothing. Scepter: the returning lines hit the same units again; the on-death Requiem (half the lines, no fear) does not return', prio: 70, ai: (ab, u, t) => (t && u.distTo(t) <= ab.v('requiem_line_width_end') + 50 ? true : null),
  cast(ab) { requiem(ab, requiemLines(ab, soulCount(ab.owner)), false); },
});
// The three Shadowrazes are one skill in the game (one level, one skill point per level) but three abilities in the data. The engine's
// skill build treats abilities joined by LinkedAbility as one skill, so the default build is already right; this only keeps the three
// at one level (the highest) when something sets them apart, e.g. a runtime level change of a single raze.
// Runs from the always-present Necromastery modifier; m.data = the three razes.
function syncRazes(m) {
  if (!m.data) m.data = [1, 2, 3].map((n) => m.parent.findAbility('nevermore_shadowraze' + n)).filter(Boolean);
  const rz = m.data; let top = 0;
  for (const a of rz) if (a.level > top) top = a.level;
  for (const a of rz) if (a.level !== top) a.setLevel(top);
}
// Necromastery. m.z = the maximum the modifier was last filled to (talents arrive after it is created, before the fight starts).
passive('nevermore_necromastery', {
  fid: 'full', note: 'Shadow Fiend starts with the maximum number of souls (none with rules.fresh); the unit option stacks: { nevermore_necromastery: N } sets another count',
  breakable: false,                                                  // "Break does not disable the bonuses from existing stacks", only new souls
  interval: 0.5, thinkNow: true, onThink: syncRazes,
  onCreated(m) { m.z = m.v('necromastery_max_souls'); m.stacks = m.parent.world.fresh ? 0 : m.z; },
  stats: (m) => {
    const max = m.v('necromastery_max_souls');
    if (m.z !== max) { if (m.parent.world.time === 0 && m.stacks === m.z) m.stacks = max; m.z = max; }
    return { dmg: m.v('necromastery_damage_per_soul') * m.stacks };
  },
  onKill(m, ev) {
    const u = m.parent; const max = m.v('necromastery_max_souls');
    if (u.st[ST.BREAK] > 0 || m.stacks >= max || ev.victim.def.atk === 'none') return;
    m.setStacks(Math.min(max, m.stacks + (realHero(ev.victim) ? m.v('souls_per_hero_kill') : m.v('souls_per_kill'))));
  },
  onDestroy(m) {                                                     // "Requiem of Souls is automatically cast whenever Shadow Fiend dies"
    const u = m.parent; const rq = u.findAbility('nevermore_requiem');
    if (!u.alive && rq && rq.level > 0) requiem(rq, Math.floor(requiemLines(rq, m.stacks) * rq.v('soul_death_release')), true);
  },
});

// ================================================================ Ogre Magi
// Multicast: one roll against nested thresholds (4x, then 3x, then 2x); every strength_for_one_pct Strength adds one_tooltip % to each
function multicast(ab) {
  const u = ab.owner; const mc = u.findAbility('ogre_magi_multicast');
  if (!mc || mc.level < 1 || u.st[ST.BREAK] > 0) return 1;
  const bonus = u.str / mc.v('strength_for_one_pct') * mc.v('one_tooltip'); const roll = u.world.rng.next() * 100;
  for (const n of [4, 3, 2]) {
    const c = mc.v('multicast_' + n + '_times');
    if (c > 0 && roll < c + bonus) { if (u.world.log) u.world.logEvent('multicast', u, null, ab.name, n); return n; }
  }
  return 1;
}
defAbility('ogre_magi_multicast', { fid: 'partial', note: 'applied to Fireblast, Unrefined Fireblast, Ignite, Bloodlust and Fire Shield; targeted items are not multicast' });

// one cast = 1..4 blasts on the same target, multicast_delay apart
function fireblast(ab, t, dmg) {
  const u = ab.owner; const n = multicast(ab);
  const blast = () => { if (!t.alive || blocked(ab, t)) return; stun(ab, t, ab.v('stun_duration')); hit(ab, t, dmg, MAGICAL); };
  blast(); for (let i = 1; i < n; i++) u.world.after(i * ab.v('multicast_delay'), blast);
}
modifier('modifier_ogre_magi_fireblast', {
  hidden: true, interval: 1, thinkNow: true,
  onThink(m) { const ab = m.ability; const want = baseVal(ab, 'AbilityCastPoint') / (1 + ab.v('bonus_cast_speed') / 100); if (ab.vals.AbilityCastPoint !== want) ab.vals.AbilityCastPoint = want; },      // Scepter: cast speed
  onAttackLanded(m, rec) {                                           // talent: chance to Fireblast on attack
    const t = rec.target; const ab = m.ability;
    if (rec.secondary || !t.alive || t.isBuilding || immune(t) || !m.roll(m.v('fireblast_proc'))) return;
    fireblast(ab, t, ab.v('fireblast_damage'));
  },
});
defAbility('ogre_magi_fireblast', {
  mods: ['modifier_ogre_magi_fireblast'], prio: 60,
  fid: 'full', note: 'talent: the Fireblast released by an attack is free and can multicast',
  ai: (ab, u, t) => (canTarget(ab, t) ? { target: t } : null),
  cast(ab, t) { fireblast(ab, t, ab.v('fireblast_damage')); },
});

const IGNITE = 'modifier_ogre_magi_ignite_debuff';
// [L] measured in Hero Demo: the first burn is dealt on impact, then one per second; the last one at the end of the duration
debuff(IGNITE, { stats: { msPct: 'slow_movement_speed_pct' }, thinkNow: true, ...ticker(1, (m) => mhit(m, m.parent, m.v('burn_damage'), MAGICAL)) });
function ignite(ab, e) {
  const u = ab.owner;
  u.world.projectile(u, e, ab.v('projectile_speed'), (t) => {
    if (blocked(ab, t)) return;
    const ex = t.findModifier(IGNITE);
    if (ex) ex.setDuration(ex.remaining() + ab.v('duration') * (1 - t.stats().statusRes) * (1 + u.debuffAmp / 100));      // "adds to the burn duration"
    else addMod(ab, t, IGNITE, ab.v('duration'));
  });
}
defAbility('ogre_magi_ignite', {
  fid: 'approx', note: 'besides the target one random other enemy within ignite_multicast_aoe of Ogre Magi is hit; each multicast throws one more flask at a random enemy in that area, multicast_delay apart', prio: 50,
  ai: (ab, u, t) => (canTarget(ab, t) ? { target: t } : null),
  cast(ab, t) {
    const u = ab.owner; const w = u.world; const n = multicast(ab);
    const pick = (skip) => { const o = enemiesNear(ab, u.x, u.y, ab.v('ignite_multicast_aoe')).filter((e) => e !== skip && !e.isBuilding && !immune(e) && e.def.atk !== 'none'); return o.length ? o[w.rng.int(0, o.length - 1)] : null; };
    ignite(ab, t);
    const other = pick(t); if (other) ignite(ab, other);
    for (let i = 1; i < n; i++) w.after(i * ab.v('multicast_delay'), () => { const e = pick(null); if (e) ignite(ab, e); });
  },
});

const LUST = 'modifier_ogre_magi_bloodlust_buff';
buff(LUST, { stats: (m) => ({ msPct: m.v('bonus_movement_speed'), as: m.parent === m.caster ? m.v('self_bonus') : m.v('bonus_attack_speed') }) });
// multicast on an allied buff: random other allies around Ogre Magi receive it as well
function buffAllies(ab, first, mod, aoeKey) {
  const u = ab.owner; const n = multicast(ab); const targets = [first];
  if (n > 1) { const pool = alliesNear(ab, u.x, u.y, ab.v(aoeKey)).filter((a) => a !== first && !a.isBuilding && a.def.atk !== 'none'); while (targets.length < n && pool.length) targets.push(pool.splice(u.world.rng.int(0, pool.length - 1), 1)[0]); }
  for (const a of targets) addMod(ab, a, mod, ab.v('duration'));
}
defAbility('ogre_magi_bloodlust', {
  fid: 'full', note: 'self_bonus is taken as the attack speed Ogre Magi gets instead of bonus_attack_speed; towers do not exist in the sandbox', prio: 70,
  ai: (ab, u, t) => {
    if (!t) return null;
    if (!u.hasModifier(LUST)) return { target: u };
    let best = null;
    for (const a of u.world.units) if (a !== u && a.alive && a.team === u.team && a.heroLike && a.def.atk !== 'none' && !a.hasModifier(LUST) && u.distTo(a) <= ab.castRange() && (!best || (realHero(a) && !realHero(best)))) best = a;
    return best ? { target: best } : null;
  },
  cast(ab, t) { buffAllies(ab, t || ab.owner, LUST, 'multicast_bloodlust_aoe'); },
});

// Unrefined Fireblast costs scepter_mana % of the current mana: the listed mana cost follows the current mana every tick
modifier('modifier_ogre_magi_unrefined_fireblast', { hidden: true, interval: (m) => m.parent.world.dt, thinkNow: true, onThink(m) { m.ability.vals.AbilityManaCost = m.parent.mana * m.ability.v('scepter_mana') / 100; } });
defAbility('ogre_magi_unrefined_fireblast', {
  mods: ['modifier_ogre_magi_unrefined_fireblast'], fid: 'full', prio: 58,
  ai: (ab, u, t) => (canTarget(ab, t) ? { target: t } : null),
  cast(ab, t) {
    const u = ab.owner;
    fireblast(ab, t, ab.v('base_damage') + ab.v('str_multiplier') * u.str);
  },
});

// Fire Shield: m.stacks = attacks of enemy heroes still to be absorbed
const SHIELD = 'modifier_ogre_magi_smash_buff';
buff(SHIELD, {
  onCreated(m) { m.stacks = m.v('attacks'); }, onRefresh(m) { m.stacks = m.v('attacks'); },
  postMit(m, d) {
    const u = m.parent; const s = d.src; const ab = m.ability;
    if (d.amount <= 0 || !(d.flags & F_ATTACK) || (d.flags & F_SECONDARY) || !s || !s.isHero || s.team === u.team) return;
    d.amount *= 1 - m.v('damage_absorb_pct') / 100;
    u.world.projectile(u, s, m.v('projectile_speed'), (t) => { if (!blocked(ab, t)) hit(ab, t, ab.v('damage'), MAGICAL); });       // fireball at the attacker
    if (--m.stacks <= 0) m.remove();
  },
});
defAbility('ogre_magi_smash', {
  fid: 'full', note: 'the AI shields Ogre Magi himself; attacks of illusions count as attacks of enemy heroes', prio: 65,
  ai: (ab, u, t) => (t && enemyHeroAlive(u) && !u.hasModifier(SHIELD) ? { target: u } : null),
  cast(ab, t) { buffAllies(ab, t || ab.owner, SHIELD, 'multicast_fireshield_aoe'); },
});

passive('ogre_magi_dumb_luck', {
  fid: 'full',
  late(m, s, u) {
    u.int = 0;                                                       // "Ogre Magi's max Intelligence is 0": whatever Intelligence he picked up gives nothing
    s.mana += Math.floor(u.str + 1e-6) * m.v('mana_per_str'); s.manaRegen += u.str * m.v('mana_regen_per_str');
  },
});

// ---- Ogre Frostmage (neutral creep): Ice Armor
const ICE = 'modifier_ogre_magi_frost_armor_buff';
debuff('modifier_ogre_magi_frost_armor_slow', { stats: { msPct: 'movespeed_slow', asSlow: 'attackspeed_slow' } });
buff(ICE, {
  stats: { armor: 'armor_bonus' },
  onAttacked(m, rec) { const a = rec.attacker; if (a.alive && a.team !== m.parent.team && !a.isBuilding) a.addModifier('modifier_ogre_magi_frost_armor_slow', { caster: m.caster, ability: m.ability, duration: m.v('slow_duration') }); },
});
defAbility('ogre_magi_frost_armor', {
  fid: 'full', note: 'slows every enemy whose attack hits the armored unit, as the ability tooltip says (the buff\'s own tooltip mentions melee attackers only); the creep armors itself first, then allies in range', prio: 40,
  ai: (ab, u, t) => {
    if (!t) return null;
    if (!u.hasModifier(ICE)) return { target: u };
    for (const a of u.world.units) if (a.alive && a.team === u.team && !a.isBuilding && a.def.atk !== 'none' && !a.hasModifier(ICE) && u.distTo(a) <= ab.castRange()) return { target: a };
    return null;
  },
  cast(ab, t) { addMod(ab, t || ab.owner, ICE, ab.v('duration')); },
});

// ================================================================ Necrophos
// Death Pulse: a wave from (x, y) that reaches every unit in the area at projectile_speed, damaging enemies and healing allies
function deathPulse(dp, x, y) {
  const u = dp.owner; const w = u.world; const r = dp.v('area_of_effect'); const speed = dp.v('projectile_speed'); const from = { x, y };
  for (const e of enemiesNear(dp, x, y, r)) if (!e.isBuilding) w.projectile(from, e, speed, (t) => hit(dp, t, dp.v('AbilityDamage'), MAGICAL));
  for (const a of alliesNear(dp, x, y, r)) if (!a.isBuilding) w.projectile(from, a, speed, (t) => t.heal(dp.v('heal'), u, dp));
}
defAbility('necrolyte_death_pulse', {
  fid: 'full', prio: 55, engage: false,
  ai: (ab, u, t) => (t && u.distTo(t) <= ab.v('area_of_effect') - 50 ? true : null),
  cast(ab) { deathPulse(ab, ab.owner.x, ab.owner.y); },
});
const SHROUD = 'modifier_necrolyte_ghost_shroud';
debuff('modifier_necrolyte_ghost_shroud_slow', { statusResist: false, stats: (m) => ({ msPct: -m.v('movement_speed') }) });
buff(SHROUD, {
  state: ['ETHEREAL', 'DISARM'], interval: 0.5, thinkNow: true,
  stats: (m) => ({ restore: m.v('heal_bonus'), magicTakenPct: -m.v('bonus_damage') }),
  onThink(m) { const u = m.parent; for (const e of u.world.inRadius(u.x, u.y, m.v('slow_aoe'), u.team, true)) if (!e.isBuilding) e.addModifier('modifier_necrolyte_ghost_shroud_slow', { caster: u, ability: m.ability, duration: 1 }); },
});
selfBuff('necrolyte_ghost_shroud', {
  fid: 'full', note: 'the AI uses it below 40% health; the slow aura is refreshed every 0.5 s', prio: 30, engage: false,
  mod: SHROUD, duration: 'duration', ai: (ab, u, t) => (t && u.hp / u.maxHp < 0.4 && !u.hasModifier(SHROUD) ? true : null),
});
// Heartstopper Aura. [L] measured in Hero Demo: enemies in the aura carry an effect that lingers 0.5 s and deals a magical damage
// instance (reduced by magic resistance) every 0.2 s: aura_damage % of their max health per second, with Scepter plus a share of
// Necrophos' current health regeneration per second.
const HEART = 'modifier_necrolyte_heartstopper_aura_debuff'; const HEART_TICK = 0.2; const HEART_LINGER = 0.5; const HEART_SCAN = 0.1;
modifier(HEART, {
  debuff: true, pierce: true, purge: 'none', statusResist: false, interval: HEART_TICK,
  stats: (m) => ({ restore: -m.v('heal_reduction_pct') }),
  onThink(m) {
    const u = m.caster; const e = m.parent;
    if (!u.alive) return;
    const extra = u.hpRegen > 0 ? u.hpRegen * m.v('heal_regen_to_damage') / 100 : 0;      // Scepter
    mhit(m, e, (e.maxHp * m.v('aura_damage') / 100 + extra) * HEART_TICK, MAGICAL);
  },
});
passive('necrolyte_heartstopper_aura', {
  fid: 'full', note: 'the aura is re-checked every 0.1 s (its effect lingers up to 0.5 s after leaving); the regen-reduction talent is modelled as reduced health restoration',
  interval: HEART_SCAN, thinkNow: true,
  onThink(m) {
    const u = m.parent; const w = u.world;
    for (const e of w.inRadius(u.x, u.y, m.v('aura_radius'), u.team, true)) {
      if (e.isBuilding || e.def.ancient || e.def.rel === 'ward' || e.st[ST.INVULN] > 0) continue;       // "Does not affect ancient creeps"
      e.addModifier(HEART, { caster: u, ability: m.ability, duration: HEART_LINGER });
    }
  },
});
buff('modifier_necrolyte_death_seeker', { state: ['ETHEREAL'], stats: (m) => ({ mr: -m.v('magic_resistance_reduction') }) });
defAbility('necrolyte_death_seeker', {
  fid: 'approx', note: 'projectile_multiplier is taken as the speed of the large pulse relative to Death Pulse\'s projectile speed; Necrophos is placed on the target\'s position when it arrives and releases a Death Pulse of the current level there. The AI uses it on targets outside Death Pulse range', prio: 52,
  ai: (ab, u, t) => { const dp = u.findAbility('necrolyte_death_pulse'); return canTarget(ab, t) && dp && dp.level > 0 && !(u.st[ST.ROOT] > 0) && u.distTo(t) > dp.v('area_of_effect') - 50 ? { target: t } : null; },
  cast(ab, t) {
    const u = ab.owner; const dp = u.findAbility('necrolyte_death_pulse'); const x = t.x; const y = t.y;
    if (!dp || dp.level < 1) return;                                 // [L] measured in Hero Demo: without Death Pulse learned the cast does nothing
    addMod(ab, u, 'modifier_necrolyte_death_seeker', ab.v('ethereal_duration'));
    u.world.after(Math.hypot(x - u.x, y - u.y) / (dp.v('projectile_speed') * ab.v('projectile_multiplier') / 100), () => { if (!u.alive) return; if (!(u.st[ST.ROOT] > 0)) { u.x = x; u.y = y; } if (dp.level > 0) deathPulse(dp, u.x, u.y); });
  },
});
buff('modifier_necrolyte_sadist_stack', { multi: 'independent', purge: 'none', stats: (m) => ({ hpRegen: m.v('regen'), manaRegen: m.v('regen') }) });
passive('necrolyte_sadist', {
  fid: 'full',
  onKill(m, ev) {
    const u = m.parent; const v = ev.victim;
    if (v.def.atk === 'none' || v.isBuilding) return;
    const n = realHero(v) ? m.v('hero_multiplier') : 1;               // "Hero kills multiply the effect"
    for (let i = 0; i < n; i++) u.addModifier('modifier_necrolyte_sadist_stack', { ability: m.ability, duration: m.v('regen_duration') });
  },
});
modifier('modifier_necrolyte_reapers_scythe_regen', { multi: 'stack', purge: 'none', stats: (m) => ({ hpRegen: m.v('hp_per_kill') * m.stacks, manaRegen: m.v('mana_per_kill') * m.stacks }) });
// [L] measured in Hero Demo: the stun lasts stun_duration + 0.05 s and the damage is dealt stun_duration after the cast
const SCYTHE_PAD = 0.05;
debuff('modifier_necrolyte_reapers_scythe', {
  state: ['STUN'], purge: 'none', interval: (m) => Math.max(m.parent.world.dt, m.dieTime - m.created - SCYTHE_PAD - 1e-6),
  onThink(m) {                                                       // "Damage is dealt at the end of the stun"
    const t = m.parent; const u = m.caster; const ab = m.ability;
    if (m.x === 1 || !t.alive) return;
    m.x = 1;
    hit(ab, t, (t.maxHp - t.hp) * ab.v('damage_per_health'), MAGICAL);
    if (!t.alive && realHero(t) && u.alive) u.addModifier('modifier_necrolyte_reapers_scythe_regen', { ability: ab });
  },
});
defAbility('necrolyte_reapers_scythe', {
  fid: 'full', note: 'the AI casts it when the damage at the current missing health would already kill', prio: 95,
  ai: (ab, u, t) => (canTarget(ab, t) && t.isHero && (t.maxHp - t.hp) * ab.v('damage_per_health') * (1 - t.mr) * (1 + u.spellAmp / 100) >= t.hp ? { target: t } : null),
  cast(ab, t) { addMod(ab, t, 'modifier_necrolyte_reapers_scythe', ab.v('stun_duration') + SCYTHE_PAD); },
});
