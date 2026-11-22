// Neutral artifacts of the current pool (patch 7.42, assignment neutral_1): everything the plain stat tokens cannot express.
// Behaviour follows the current tooltip of each item. Where a tooltip is silent, the patch notes shipped with the game are used
// and the item's `note` names the patch. Numbers are read from the data pack by name. Two kinds of numbers are not ability values
// and are explained where they are used: the "3 seconds" of Flicker / Tumbler's Toy (a literal in the tooltip text) and the stats of
// the Book of the Dead summons (printed only in the tooltip notes and read from that text). Tick lengths and spawn offsets are chosen.
import { defAbility, modifier, buff, debuff, passive, neg, hit, addMod, mhit, aura, zone, barrier, giveBarrier, C, ST,
  PHYSICAL, MAGICAL, PURE, F_ATTACK, F_NO_AMP, F_REFLECT, F_HP_LOSS, F_NON_LETHAL, F_SECONDARY } from '../engine/dsl.mjs';
import { loadDescriptions } from '../engine/gamedata.mjs';

const I = (n) => 'item_' + n;

// ---------------------------------------------------------------- shared helpers
// Dormant Curio: the next crafted artifact carries the Unleashed enchantment (item_enhancement_curious). Values the item data flags
// with apply_curio_bonus (`curio` in the data pack) are then amplified by the enchantment's item_potency percent.
const UNLEASHED = 'item_enhancement_curious';
function curio(ab) {
  const its = ab.owner.items;
  for (let i = 0; i < its.length; i++) { const it = its[i]; if (it.name === UNLEASHED && it.slot !== 'backpack') return 1 + it.v('item_potency') / 100; }
  return 1;
}
// value `name` of the artifact behind `src` (the item itself or one of its modifiers), Unleashed boost included when the value is flagged
function cv(src, name, flagged) {
  const ab = src.def && src.def.vals ? src : src.ability;
  if (!ab) return 0;
  const e = ab.def.vals[name];
  return flagged || (e && e.curio) ? ab.v(name) * curio(ab) : ab.v(name);
}

// chosen tick lengths (structural, not game values)
const POLL = 0.1;       // how often a cooldown-driven passive looks for targets / a restore-over-time effect pays out
const AURA_TICK = 0.5;  // area effects are re-applied on the usual aura rhythm
// "3 seconds" after player damage: written as a literal in the Flicker and Tumbler's Toy tooltips, the item data has no value for it
const PLAYER_DAMAGE_WINDOW = 3;

const isRoshan = (u) => u.name === 'npc_dota_roshan';
// ROOT_DISABLES items cannot be cast while rooted; the engine does not check that flag, so such a cast is undone
const rootedCast = (ab) => { if (!ab.owner.isRooted()) return false; ab.cdEnd = 0; return true; };
// "player controlled" / "player source": a hero, an illusion, or anything one of them summoned (the reading items.mjs uses)
const playerUnit = (u) => { let o = u; while (o.owner && o.owner !== o) o = o.owner; return o.heroLike; };
const enemyPlayerDamage = (m, d) => !!d.src && d.src.team !== m.parent.team && playerUnit(d.src) && !(d.flags & F_HP_LOSS);
// "cannot be used for N seconds after taking damage": a minimum remaining cooldown, the way Blink Dagger does it
const lockout = (m, seconds) => { if (m.ability.cdRemaining() < seconds) m.ability.startCooldown(seconds); };
// what a basic dispel can remove
const dispellable = (m) => (m.def.purge || (m.def.debuff ? 'basic' : 'none')) === 'basic';
const hasDebuff = (u) => u.mods.some((m) => m.def.debuff && dispellable(m));
const hasBuff = (u) => u.mods.some((m) => !m.def.debuff && dispellable(m));
const canBeHit = (e, w) => e.targetable() && e.st[ST.INVULN] === 0 && !e.isBuilding && (e.st[ST.INVIS] === 0 || w.detectAll);

// The sandbox has no facing: "forward" is the direction of the point the cast was aimed at, else of the last attack target,
// else of the nearest enemy.
function forward(u, x, y) {
  let dx = x - u.x; let dy = y - u.y;
  if (dx * dx + dy * dy < 1) {
    const t = u.attackTarget && u.attackTarget.alive ? u.attackTarget : u.world.nearestEnemy(u);
    if (!t) return null;
    dx = t.x - u.x; dy = t.y - u.y;
  }
  const d = Math.sqrt(dx * dx + dy * dy);
  return d < 1e-6 ? null : [dx / d, dy / d];
}

// Periodic effect that pays in equal ticks, the last one exactly at expiry. The engine expires a modifier before it lets it think,
// so the tick that coincides with the expiry is delivered from onDestroy (m.z counts the ticks done).
function ticks(interval, tick) {
  const iv = (m) => (typeof interval === 'function' ? interval(m) : interval);
  return {
    interval,
    onThink(m) { m.z++; tick(m); },
    onDestroy(m, expired) {
      const i = iv(m);
      if (expired && i > 0 && m.parent.alive && m.z < Math.floor((m.dieTime - m.created) / i + 1e-6)) { m.z++; tick(m); }
    },
  };
}

// Direct health loss ("classified as HP Loss, does not break Blink Dagger", 7.39 patch note on Jidi Pollen Bag): the engine stamps
// lastHurt for every damage instance of an enemy hero, so the stamp is put back.
function healthLoss(src, dst, amount, type, flags, ab) {
  const stamp = dst.lastHurt;
  const dealt = dst.world.damage(src, dst, amount, type, flags | F_HP_LOSS, ab);
  dst.lastHurt = stamp;
  return dealt;
}

// Forced movement: the unit travels data.left units along (data.ux, data.uy) at data.speed; whatever is left when the modifier ends
// is covered at once (the last step coincides with the expiry).
function slideStep(m, step) {
  const d = m.data;
  if (!d) return;
  if (step > d.left) step = d.left;
  if (step <= 0) return;
  m.parent.x += d.ux * step; m.parent.y += d.uy * step; d.left -= step;
}
const slideDef = {
  purge: 'none', multi: 'independent', interval: (m) => m.parent.world.dt,
  onThink(m) { if (m.data) slideStep(m, m.data.speed * m.parent.world.dt); },
  onDestroy(m) { if (m.parent.alive) slideStep(m, Infinity); },
};
function slide(ab, t, mod, dir, dist, time) {
  if (!dir || dist <= 0) return;
  if (!(time > 0)) { t.x += dir[0] * dist; t.y += dir[1] * dist; return; }
  t.addModifier(mod, { caster: ab.owner, ability: ab, duration: time, data: { ux: dir[0], uy: dir[1], left: dist, speed: dist / time } });
}

// ================================================================ tier 1
// Chipped Vest: flat return damage to every attacker that hits the wearer (reflected damage: no lifesteal, cannot be reflected)
passive(I('chipped_vest'), {
  fid: 'approx', note: 'the damage type is not in the data: physical assumed',
  onAttacked(m, rec) {
    const u = m.parent; const a = rec.attacker;
    if (!a.alive || a.isBuilding || a.team === u.team) return;
    u.world.damage(u, a, a.heroLike ? m.v('damage_return_hero') : m.v('damage_return_creep'), PHYSICAL, F_REFLECT | F_NO_AMP, m.ability);
  },
});

// Possessed Mask: flat heal per attack. "This counts as lifesteal and is manipulated by Health Restoration" (7.41 patch note).
passive(I('possessed_mask'), {
  fid: 'approx', note: 'flat heal per landed attack on an enemy unit; counts as lifesteal (7.41 patch note): lifesteal amplification and Health Restoration apply, but the lifesteal penalty against creeps is not applied to the flat amount (not stated either way)',
  onAttackLanded(m, rec) {
    const u = m.parent; const t = rec.target;
    if (t.isBuilding || t.team === u.team) return;
    u.heal(m.v('lifesteal') * (1 + u.lifestealAmp / 100), u, m.ability, true);
  },
});

// Ash Legion Shield: physical barrier for allied player-controlled units around the caster, who walks slower meanwhile
barrier('modifier_item_ash_legion_shield_barrier', 'physical');
modifier('modifier_item_ash_legion_shield_slow', { purge: 'none', stats: { ms: neg('slow') } });
defAbility(I('ash_legion_shield'), {
  prio: 55, fid: 'full',
  cast(ab) {
    const u = ab.owner; const dur = ab.v('duration');
    addMod(ab, u, 'modifier_item_ash_legion_shield_slow', dur);
    for (const a of u.world.inRadius(u.x, u.y, ab.v('block_radius'), u.team, false)) if (playerUnit(a)) giveBarrier(ab, a, 'modifier_item_ash_legion_shield_barrier', ab.v('block_amount'), dur);
  },
});

// Dormant Curio: see curio() above
defAbility(I('dormant_curio'), { fid: 'n/a', note: 'acts only when the next artifact is crafted; its result is the Unleashed enchantment (item_enhancement_curious), which the artifacts of this file honour when their owner carries it' });
defAbility(UNLEASHED, { fid: 'full', note: 'amplifies the values its artifact flags with apply_curio_bonus by item_potency percent; the boost is applied by the artifact scripts (curio() in this file), none of the flagged values is a plain stat bonus' });
defAbility(I('red_ledger'), { fid: 'n/a', note: 'gold bounties for hero kills: economy only' });
defAbility(I('foragers_kit'), { fid: 'n/a', note: 'foraging trees on the map for consumables and gold: map and economy' });

// Weighted Dice: +max base damage, and the base damage of every attack is rolled roll_count times, keeping the highest
passive(I('weighted_dice'), {
  fid: 'full', note: 'applied when each attack rolls its base damage (the character sheet does not show it); the creep bounty part is economy',
  onAttack(m, rec) {
    const a = m.parent; const rng = a.world.rng;
    const lo = Math.floor(a.dmgMin + 1e-9); const hi = Math.floor(a.dmgMax + 1e-9) + m.v('bonus_max_damage');
    let best = rng.int(lo, hi);
    for (let i = m.v('roll_count'); i > 1; i--) { const r = rng.int(lo, hi); if (r > best) best = r; }
    rec.white = best + (a.dmgMin - lo);
  },
});

// Pollywog Charm: health regeneration on an ally
buff('modifier_item_polliwog_charm_buff', { stats: { hpRegen: 'regen_boost' } });
defAbility(I('polliwog_charm'), {
  prio: 30, fid: 'approx', note: 'no water in the sandbox: the movement speed part never applies; AI: on the most damaged ally in cast range that is missing at least the full heal',
  ai(ab, u) {
    const r = ab.castRange(); let best = null; let miss = ab.v('regen_boost') * ab.v('duration');
    for (const a of u.world.inRadius(u.x, u.y, r, u.team, false)) {
      if (a.isBuilding || a.hasModifier('modifier_item_polliwog_charm_buff')) continue;
      if (a.maxHp - a.hp >= miss) { miss = a.maxHp - a.hp; best = a; }
    }
    return best ? { target: best } : null;
  },
  cast(ab, t) { addMod(ab, t || ab.owner, 'modifier_item_polliwog_charm_buff', ab.v('duration')); },
});

// Seeds of Serenity: an area that regenerates allies standing in it (amount fixed at cast time)
modifier('modifier_item_seeds_of_serenity_buff', { purge: 'none', stats: (m) => ({ hpRegen: m.data ? m.data.regen : 0 }) });
const seedsRegen = (ab) => cv(ab, 'aura_health_regen') + ab.owner.stats().hpRegen * cv(ab, 'aura_health_regen_pct') / 100;
defAbility(I('seeds_of_serenity'), {
  prio: 40, fid: 'full', note: 'AI: planted under the caster when an ally in the area is missing at least what one cast would restore',
  ai(ab, u) {
    const need = seedsRegen(ab) * ab.v('duration');
    return u.world.inRadius(u.x, u.y, ab.v('radius'), u.team, false).some((a) => !a.isBuilding && a.maxHp - a.hp >= need) ? { x: u.x, y: u.y } : null;
  },
  cast(ab, t, x, y) {
    const u = ab.owner; const regen = seedsRegen(ab);
    zone(ab, x, y, { radius: 'radius', duration: 'duration', interval: AURA_TICK, allies: true,
      tick: (a) => { if (!a.isBuilding) a.addModifier('modifier_item_seeds_of_serenity_buff', { caster: u, ability: ab, duration: AURA_TICK, data: { regen } }); } });
  },
});

// Kobold Cup: movement speed for all allies around the caster
buff('modifier_item_kobold_cup_buff', { stats: { msPct: 'movespeed_pct' } });
defAbility(I('kobold_cup'), {
  prio: 25, engage: false, fid: 'full', note: 'AI: used while the target is out of attack reach',
  ai: (ab, u, t) => (t && u.rangeTo(t) > u.attackRange && !u.hasModifier('modifier_item_kobold_cup_buff') ? true : null),
  cast(ab) { const u = ab.owner; for (const a of u.world.inRadius(u.x, u.y, ab.v('buff_radius'), u.team, false)) if (!a.isBuilding) addMod(ab, a, 'modifier_item_kobold_cup_buff', ab.v('buff_duration')); },
});

// Stonefeather Satchel: toggles between Feathers (movement speed, longer forced movement) and Rocks (armor, shorter forced movement)
// The state is the stack count of the intrinsic modifier: 0 = Feathers, 1 = Rocks (so a scenario can start with Rocks through
// stacks: { item_stonefeather_satchel: 1 }).
modifier('modifier_item_stonefeather_satchel', { hidden: true, stats: (m) => (m.stacks > 0 ? { armor: m.v('rocks_armor') } : { ms: m.v('feather_movespeed') }) });
const satchel = (u) => u.findModifier('modifier_item_stonefeather_satchel');
defAbility(I('stonefeather_satchel'), {
  mods: ['modifier_item_stonefeather_satchel'], prio: 10, engage: false, fid: 'partial',
  note: 'movement speed / armor toggle modelled (starts with Feathers, or with Rocks through scenario stacks: { item_stonefeather_satchel: 1 }; AI holds Rocks while in attack reach, Feathers while chasing). The forced-movement distance change is NOT applied, except to this file\'s Psychic Push: the engine has no such stat',
  ai(ab, u, t) { const m = satchel(u); if (!t || !m) return null; return (m.stacks > 0) !== (u.rangeTo(t) <= u.attackRange) ? true : null; },
  cast(ab) { const m = satchel(ab.owner); if (m) m.setStacks(m.stacks > 0 ? 0 : 1); },
});
// forced-movement distance multiplier of a unit (only the satchel changes it)
function forcedMove(t) {
  const m = satchel(t);
  if (!m) return 1;
  const k = cv(m, 'knockback_resistance') / 100;
  return m.stacks > 0 ? 1 - k : 1 + k;
}

// Tumbler's Toy: short leap forward, locked for a moment after player damage
modifier('modifier_item_pogo_stick', { hidden: true, onTakeDamage(m, d) { if (enemyPlayerDamage(m, d)) lockout(m, PLAYER_DAMAGE_WINDOW); } });
modifier('modifier_item_pogo_stick_leap', { ...slideDef });
defAbility(I('pogo_stick'), {
  mods: ['modifier_item_pogo_stick'], prio: 100, engage: false, fid: 'approx',
  note: 'no facing: leaps straight towards the aimed point (the current target) at leap_speed, the acceleration value is ignored and the hero is free to act meanwhile; the lock after player damage is a 3 s minimum cooldown (3 s is a tooltip literal); AI: gap closer, used when the gap is at least the leap distance',
  ai: (ab, u, t) => (t && !u.isRooted() && u.rangeTo(t) - u.attackRange >= cv(ab, 'leap_distance') ? { x: t.x, y: t.y } : null),
  cast(ab, t, x, y) {
    const u = ab.owner; const d = cv(ab, 'leap_distance'); const v = ab.v('leap_speed');
    if (!rootedCast(ab)) slide(ab, u, 'modifier_item_pogo_stick_leap', forward(u, x, y), d, v > 0 ? d / v : 0);
  },
});

// ================================================================ tier 2
// Psychic Headband: pushes the target away from the caster
modifier('modifier_item_psychic_headband_push', { ...slideDef });
defAbility(I('psychic_headband'), {
  prio: 45, noBlock: true, fid: 'approx',
  note: 'the pushed unit is not prevented from acting while it slides; flagged noBlock, which Linken\'s Sphere and Lotus Orb honour, but spell blocks written without that flag (Roshan, hero abilities) can still stop the cast; AI: only a ranged owner uses it, to push a melee attacker out of reach',
  ai: (ab, u, t) => (t && !u.melee && t.melee && !t.isImmune() && t.rangeTo(u) <= t.attackRange ? { target: t } : null),
  cast(ab, t) {
    const u = ab.owner;
    if (!t || t === u) return;
    const dx = t.x - u.x; const dy = t.y - u.y; const d = Math.sqrt(dx * dx + dy * dy);
    slide(ab, t, 'modifier_item_psychic_headband_push', d > 1e-6 ? [dx / d, dy / d] : [1, 0], cv(ab, 'push_length') * forcedMove(t), ab.v('push_duration'));
  },
});

// Safety Bubble: barrier against enemy damage that refills after a quiet period
function bubbleSync(m) { const b = m.data; if (m.parent.world.time - b.last >= m.v('restore_time')) b.left = cv(m, 'shield'); }
passive(I('safety_bubble'), {
  fid: 'full', barrierKeep: true, barrierSync: bubbleSync,
  onCreated(m) { m.data = { left: 0, last: -Infinity }; },
  postMit(m, d) {
    if (d.amount <= 0 || (d.flags & F_HP_LOSS)) return;
    const u = m.parent; const b = m.data;
    bubbleSync(m);
    b.last = u.world.time;
    if (!d.src || d.src.team === u.team) return;   // only enemy damage is absorbed; self-inflicted damage bypasses the barrier
    const a = Math.min(d.amount, b.left);
    d.amount -= a; b.left -= a;
  },
});

// Metamorphic Mandible: insect form (magic resistance and speed for a share of the armor)
modifier('modifier_item_metamorphic_mandible', {
  hidden: true,
  onCreated(m) { m.data = []; },
  // recent enemy damage by type, for the AI rule only
  onTakeDamage(m, d) {
    if (!d.src || d.src.team === m.parent.team || (d.flags & F_HP_LOSS)) return;
    const log = m.data; const now = m.parent.world.time; const keep = now - cv(m, 'duration');
    while (log.length && log[0][0] < keep) log.shift();
    log.push([now, d.type === PHYSICAL ? d.dealt : 0, d.type === MAGICAL ? d.dealt : 0]);
  },
});
buff('modifier_item_metamorphic_mandible_active', {
  stats: (m) => ({ mr: m.v('bonus_magic_resistance'), msPct: m.v('bonus_movespeed') }),
  late(m, s, u) {
    const armor = (u.ovr && u.ovr.armor !== undefined ? u.ovr.armor : u.def.armor) + C.ARMOR_PER_AGI * u.agi + s.armor;
    if (armor > 0) s.armor -= armor * m.v('armor_decrease') / 100;
  },
});
defAbility(I('metamorphic_mandible'), {
  mods: ['modifier_item_metamorphic_mandible'], prio: 40, fid: 'full',
  note: 'AI: used when the wearer took more magical than physical damage from enemies during the last <duration> seconds; the size change is cosmetic',
  ai(ab, u) {
    const m = u.findModifier('modifier_item_metamorphic_mandible');
    if (!m || u.hasModifier('modifier_item_metamorphic_mandible_active')) return null;
    const since = u.world.time - cv(ab, 'duration'); let phys = 0; let mag = 0;
    for (const e of m.data) if (e[0] >= since) { phys += e[1]; mag += e[2]; }
    return mag > phys ? {} : null;
  },
  cast(ab) { addMod(ab, ab.owner, 'modifier_item_metamorphic_mandible_active', cv(ab, 'duration')); },
});

// Jidi Pollen Bag: enemies around lose Health Restoration and a share of their maximum health (direct health loss, cannot kill)
// [L] measured in Hero Demo: duration / interval + 1 ticks (the first on application, the last at expiry) share hp_damage of the
// maximum health equally (9% over 10 ticks of 0.9%), and magic resistance reduces them (37.93 per tick on the 25% dummy)
const jidiTick = (m) => {
  const t = m.parent; const n = Math.round(m.v('debuff_duration') / m.v('damage_interval')) + 1;
  const stamp = t.lastHurt;   // health loss: does not count as damage for Blink Dagger and the like
  t.world.damage(m.caster, t, t.maxHp * cv(m, 'hp_damage') / 100 / n, MAGICAL, F_NON_LETHAL, m.ability);
  t.lastHurt = stamp;
};
debuff('modifier_item_jidi_pollen_bag_debuff', {
  stats: (m) => ({ restore: -m.v('health_regen_loss') }),
  interval: (m) => m.v('damage_interval'), thinkNow: true,
  onThink: jidiTick,
  onDestroy(m, expired) { if (expired && m.parent.alive && m.nextThink <= m.dieTime + 1e-6) jidiTick(m); },
});
defAbility(I('jidi_pollen_bag'), {
  prio: 50, radius: 'debuff_radius', fid: 'full',
  cast(ab) { const u = ab.owner; for (const e of u.world.inRadius(u.x, u.y, ab.v('debuff_radius'), u.team, true)) if (!e.isBuilding) addMod(ab, e, 'modifier_item_jidi_pollen_bag_debuff', ab.v('debuff_duration')); },
});

// Brick: takes health off the target's barriers, then deals physical damage
function breakBarriers(t, amount) {
  for (const m of t.mods.slice()) {
    if (amount <= 0) break;
    // a barrier = a modifier that absorbs damage (postMit) out of a pool kept in data.left (the convention of the dsl barrier helper)
    if (m.removed || typeof m.def.postMit !== 'function' || !m.data || typeof m.data.left !== 'number') continue;
    if (m.def.barrierSync) m.def.barrierSync(m);
    const a = Math.min(amount, m.data.left);
    if (a <= 0) continue;
    m.data.left -= a; amount -= a;
    if (typeof m.data.last === 'number') m.data.last = t.world.time;   // Safety Bubble: losing barrier health restarts its refill timer
    if (m.data.left <= 1e-6 && !m.def.barrierKeep) m.remove();
  }
}
defAbility(I('brick'), {
  prio: 50, fid: 'approx',
  note: 'barriers lose health in the order they were applied instead of magical, then physical, then all-damage: the engine does not expose the kind of a barrier',
  cast(ab, t) { const u = ab.owner; u.world.projectile(u, t, ab.v('projectile_speed'), (tt) => { breakBarriers(tt, cv(ab, 'barrier_damage')); hit(ab, tt, cv(ab, 'damage'), PHYSICAL); }); },
});

// Crippling Crossbow: small nuke, fading slow, constant Health Restoration reduction
debuff('modifier_item_crippling_crossbow_debuff', {
  dynamic: true,
  stats: (m) => ({ msPct: -m.v('slow_pct') * Math.max(0, m.remaining() / Math.max(0.01, m.dieTime - m.created)), restore: -cv(m, 'heal_reduce') }),
});
defAbility(I('crippling_crossbow'), {
  prio: 45, fid: 'full', note: 'the slow fades linearly to zero',
  cast(ab, t) { const u = ab.owner; u.world.projectile(u, t, ab.v('projectile_speed'), (tt) => { hit(ab, tt, ab.v('damage')); if (tt.alive) addMod(ab, tt, 'modifier_item_crippling_crossbow_debuff', ab.v('duration')); }); },
});

// Imp Claw: the next attack is a critical strike. The cooldown starts when the empowered attack is launched (so that a second
// projectile in the air is not empowered as well) and is given back when that attack misses, like the other "next attack" items here.
passive(I('imp_claw'), {
  fid: 'full', note: 'a missed attack does not spend the critical strike (the tooltip does not say)',
  onAttack(m, rec) {
    if (rec.target.isBuilding || !m.ability.cdReady()) return;
    const c = cv(m, 'crit_multiplier') / 100;
    if (c > rec.crit) rec.crit = c;
    (rec.data ||= {}).impClaw = m;
    m.ability.startCooldown();
  },
  onAttackMiss(m, rec) { if (rec.data && rec.data.impClaw === m) m.ability.cdEnd = 0; },
});

// Gunpowder Gauntlet: the next attack that lands adds magical damage and splashes around the target.
// "also deals [splash %] of the bonus magical damage to enemies in the splash radius", "the original target isn't affected by the
// splash", "splash damage bypasses physical damage block" (7.38 / 7.38b patch notes)
passive(I('gunpowder_gauntlets'), {
  fid: 'full', note: 'splash targets take the splash share of the attack damage as physical damage (reduced by their own armor, not by damage block) and the same share of the bonus magical damage (7.38b patch note); a miss does not spend the proc',
  onAttackLanded(m, rec) {
    const u = m.parent; const w = u.world; const t = rec.target;
    if (t.isBuilding || !m.ability.cdReady()) return;
    m.ability.startCooldown();
    const bonus = cv(m, 'bonus_damage'); const k = m.v('splash_pct') / 100;
    const near = w.enemiesInRadius(u, t.x, t.y, m.v('splash_radius'));
    if (t.alive) mhit(m, t, bonus, MAGICAL);
    for (const e of near) {
      if (e === t || e.isBuilding) continue;
      w.damage(u, e, rec.damage * k, PHYSICAL, F_SECONDARY, m.ability);
      if (e.alive) mhit(m, e, bonus * k, MAGICAL);
    }
  },
});

// Defiant Shell: counter-attack when attacked. "Can't proc attack modifiers" (7.40 patch note).
// The shipped item data flags counter_damage with apply_curio_bonus "true" (not "1"), which the data pack drops: the boost is applied here.
passive(I('defiant_shell'), {
  fid: 'approx',
  note: 'counter-attacks the attacker when it is in attack range, otherwise the nearest enemy in range (the tooltip only says "a target"); the counter is a secondary attack (no attack modifiers, 7.40 patch note), so the target\'s own on-attacked effects do not react to it either',
  onAttacked(m, rec) {
    const u = m.parent; const ab = m.ability; const w = u.world;
    if (!ab.cdReady() || !u.canAttack || u.isDisarmed()) return;
    const inReach = (e) => !!e && e.alive && e.team !== u.team && e.attackableBy(u) && u.rangeTo(e) <= u.attackRange;
    let t = rec.attacker;
    if (!inReach(t)) { t = w.nearestEnemy(u); if (!inReach(t)) return; }
    ab.startCooldown();
    w.launchAttack(u, t, { secondary: true, mult: cv(m, 'counter_damage', true) / 100, fromAbility: ab });
  },
});

// Partisan's Brand: more spell damage against heroes and the units they control
passive(I('partisans_brand'), {
  fid: 'full',
  outgoing(m, d) { if (!(d.flags & (F_ATTACK | F_REFLECT)) && d.dst !== m.parent && playerUnit(d.dst)) d.amount *= 1 + cv(m, 'bonus_damage_pct') / 100; },
});

// Spellslinger: part of the mana spent on a cast comes back in ticks ("mana recovery duration cannot be modified", 7.41 patch note)
modifier('modifier_item_spellslinger_restore', {
  hidden: true, multi: 'independent', purge: 'none',
  ...ticks((m) => m.v('restore_tickrate'), (m) => { if (m.data) m.parent.giveMana(m.data.total * m.v('restore_tickrate') / m.v('duration')); }),
});
passive(I('spellslinger'), {
  fid: 'full', note: 'item mana costs count as well',
  onCast(m, ev) {
    const u = m.parent;
    if (u.world.freeSpells) return;
    const cost = ev.ability.manaCost();
    if (cost > 0) u.addModifier('modifier_item_spellslinger_restore', { ability: m.ability, duration: m.v('duration'), data: { total: cost * cv(m, 'mana_pct') / 100 } });
  },
});

// Mana Draught: mana over time, lost when an enemy hero or Roshan hurts the drinker
modifier('modifier_item_mana_draught_buff', {
  purge: 'none',
  ...ticks(POLL, (m) => { if (m.data) m.parent.giveMana(m.data.total * POLL / m.data.duration); }),
  onTakeDamage(m, d) { const s = d.src; if (s && s.team !== m.parent.team && (s.heroLike || isRoshan(s)) && !(d.flags & F_HP_LOSS)) m.remove(); },
});
const draughtTotal = (ab) => ab.v('mana_restore') + ab.owner.stats().maxMana * cv(ab, 'mana_restore_pct') / 100;
defAbility(I('mana_draught'), {
  prio: 20, fid: 'approx',
  note: 'lost on any damage from an enemy hero or Roshan (7.38 patch note; the tooltip says "attacked"); no water in the sandbox: Fill Up never applies; AI: drinks itself when the whole amount fits and no enemy hero has hurt it during the last heal_duration seconds',
  ai(ab, u) {
    if (u.hasModifier('modifier_item_mana_draught_buff') || u.world.time - u.lastHurt < ab.v('heal_duration')) return null;
    return u.maxMana - u.mana >= draughtTotal(ab) ? { target: u } : null;
  },
  cast(ab, t) { const dur = ab.v('heal_duration'); (t || ab.owner).addModifier('modifier_item_mana_draught_buff', { caster: ab.owner, ability: ab, duration: dur, data: { total: draughtTotal(ab), duration: dur } }); },
});

// ================================================================ tier 3
// Prophet's Pendulum: a share of every damage instance is paid later, in ticks, as direct health loss.
// "Damage ticks every 1 second and is lethal" (7.41), "non-lethal if the incoming damage source was non-lethal" (7.41d patch notes)
passive(I('prophets_pendulum'), {
  fid: 'full', note: 'every instance pays its delayed share in equal ticks as direct health loss credited to the original source',
  postMit(m, d) {
    if (d.amount <= 0 || (d.flags & F_HP_LOSS)) return;
    const u = m.parent; const w = u.world; const ab = m.ability;
    const part = d.amount * cv(m, 'delay_pct') / 100;
    const iv = m.v('damage_interval'); const n = iv > 0 ? Math.round(m.v('delay_time') / iv) : 0;
    if (part <= 0 || n < 1) return;
    d.amount -= part;
    const src = d.src; const type = d.type; const flags = d.flags & F_NON_LETHAL;
    for (let i = 1; i <= n; i++) w.after(i * iv, () => { if (u.alive) healthLoss(src, u, part / n, type, flags, ab); });
  },
});

// Dandelion Amulet: blocks magical damage of one big instance per cooldown (same shape as Infused Raindrops in items.mjs)
passive(I('dandelion_amulet'), {
  fid: 'approx', note: 'the block and the minimum-damage test are applied before magic resistance (the tooltip does not give the order)',
  preMit(m, d) {
    if (d.type !== MAGICAL || d.amount <= m.v('min_damage') || !m.ability.cdReady()) return;
    d.amount = Math.max(0, d.amount - cv(m, 'magic_block'));
    m.ability.startCooldown();
  },
});

// Idol of Scree'auk: slow resistance and evasion
buff('modifier_item_idol_of_screeauk_active', { stats: { slowRes: 'slow_resist', evasion: 'evasion' } });
defAbility(I('idol_of_screeauk'), {
  prio: 40, fid: 'full', note: 'phased movement has no meaning without unit collision',
  cond: (ab, u) => !u.hasModifier('modifier_item_idol_of_screeauk_active'),
  cast(ab) { addMod(ab, ab.owner, 'modifier_item_idol_of_screeauk_active', cv(ab, 'duration')); },
});

// Balmhook: unit-target casts on allies leave a regeneration buff on them
buff('modifier_item_balmhook_buff', { stats: (m) => ({ hpRegen: cv(m, 'bonus_health_regen') }) });
passive(I('balmhook'), {
  fid: 'approx', note: 'a cast aimed at the wearer itself counts as targeting a friendly unit, and item casts count as spells (neither is stated)',
  onCast(m, ev) { const t = ev.target; if (t && t.alive && t.team === m.parent.team) t.addModifier('modifier_item_balmhook_buff', { caster: m.parent, ability: m.ability, duration: m.v('buff_duration') }); },
});

// Rattlecage: after enough damage taken, projectiles at random enemies nearby (reflected damage)
debuff('modifier_item_rattlecage_slow', { stats: (m) => ({ msPct: -m.v('slow'), asSlow: -m.v('slow') }) });
passive(I('rattlecage'), {
  fid: 'approx',
  note: 'one volley per damage instance that crosses the threshold, the excess is carried over; the counter is cleared after damage_reset_interval seconds without damage (a value the tooltip does not mention)',
  onCreated(m) { m.y = -Infinity; },
  onTakeDamage(m, d) {
    const u = m.parent; const w = u.world; const ab = m.ability;
    if ((d.flags & F_HP_LOSS) || d.dealt <= 0) return;
    if (w.time - m.y > m.v('damage_reset_interval')) m.x = 0;
    m.y = w.time; m.x += d.dealt;
    const thr = m.v('damage_threshold');
    if (thr <= 0 || m.x < thr || u.hp <= 0) return;
    m.x -= thr;
    // random targets, heroes first
    const pool = w.enemiesInRadius(u, u.x, u.y, m.v('radius')).filter((e) => canBeHit(e, w));
    const picks = [];
    for (const group of [pool.filter((e) => e.heroLike), pool.filter((e) => !e.heroLike)]) {
      while (group.length && picks.length < m.v('target_count')) picks.push(group.splice(w.rng.int(0, group.length - 1), 1)[0]);
    }
    const dmg = cv(m, 'projectile_damage'); const dur = m.v('slow_duration');
    for (const e of picks) {
      w.projectile(u, e, m.v('projectile_speed'), (tt) => {
        w.damage(u, tt, dmg, PHYSICAL, F_REFLECT | F_NO_AMP, ab);
        if (tt.alive) tt.addModifier('modifier_item_rattlecage_slow', { caster: u, ability: ab, duration: dur });
      });
    }
  },
});

// Stormcrafter: zaps enemies in range on a fixed rhythm. "Strike interval no longer decreases with cooldown reduction" (7.36b),
// "dealing ... magic damage" (7.41 patch notes)
debuff('modifier_item_stormcrafter_slow', { stats: { msPct: neg('slow') } });
passive(I('stormcrafter'), {
  fid: 'approx', note: 'zaps the nearest enemies (the tooltip does not say how targets are chosen); looks for targets every 0.1 s; the interval ignores cooldown reduction (7.36b patch note)',
  interval: POLL,
  onThink(m) {
    const u = m.parent; const ab = m.ability; const w = u.world;
    if (!ab.cdReady()) return;
    const es = w.enemiesInRadius(u, u.x, u.y, m.v('range')).filter((e) => canBeHit(e, w));
    if (!es.length) return;
    es.sort((a, b) => u.distTo(a) - u.distTo(b));
    ab.startCooldown(m.v('AbilityCooldown'));
    for (let i = 0; i < es.length && i < m.v('max_targets'); i++) {
      const e = es[i];
      mhit(m, e, cv(m, 'damage'), MAGICAL);
      if (e.alive) e.addModifier('modifier_item_stormcrafter_slow', { caster: u, ability: ab, duration: m.v('slow_duration') });
    }
  },
});

// Enchanter's Bauble: the enchantment's plain stat bonuses (the stat tokens the engine applies) grow by the current bonus
passive(I('enchanters_bauble'), {
  fid: 'partial',
  note: 'raises only the plain stat bonuses of the enchantment (its stat tokens); enchantment effects that are scripted elsewhere are NOT amplified. Number of re-crafts = scenario stacks: { item_enchanters_bauble: n }, 0 (first craft) by default',
  apply(m, s, u) {
    const ab = m.ability;
    const k = (ab.v('enchantment_bonus_base') + cv(ab, 'enchantment_bonus_growth') * m.stacks) / 100;   // stacks = times re-crafted
    for (const it of u.items) {
      if (!it.def.enchant || it.slot === 'backpack') continue;
      const own = new s.constructor();   // what this enchantment contributes on its own
      it.applyItemStats(own, u);
      for (const key in own) {
        const v = own[key];
        if (key.endsWith('Mul')) { if (v > 0 && v < 1) s[key] *= (1 - (1 - v) * (1 + k)) / v; }                    // resistances and other multiplicative families
        else if (key === 'msPctItem' || key === 'msBoots') { if (v * (1 + k) > s[key]) s[key] = v * (1 + k); }     // "highest one counts" families
        else if (v > 0) s[key] += v * k;
      }
    }
  },
});

// Ceremonial Robe: enemies around have less status resistance and magic resistance
modifier('modifier_item_ceremonial_robe_aura', {
  debuff: true, pierce: true, purge: 'none', statusResist: false,
  stats: (m) => ({ statusRes: -cv(m, 'status_resistance'), mr: -cv(m, 'magic_resistance') }),
});
aura('modifier_item_ceremonial_robe', { radius: (m) => m.v('aura_radius'), team: 'enemy', child: 'modifier_item_ceremonial_robe_aura' });
defAbility(I('ceremonial_robe'), { mods: ['modifier_item_ceremonial_robe'], fid: 'full', note: 'the aura also reaches debuff-immune enemies, like the other enemy auras of the sandbox' });

// Harmonizer: mana cost reduction per hero ability off cooldown, spell lifesteal per hero ability on cooldown.
// "Item spells are affected by both effects, however item cooldowns don't affect the Harmonizer buff" (7.41 patch note)
passive(I('harmonizer'), {
  fid: 'full', note: 'counts the learned, visible hero abilities that have a cooldown; a charge-based ability is on cooldown when it has no charge left',
  dynamic: true,
  stats(m) {
    let on = 0; let off = 0;
    for (const a of m.parent.abilities) {
      if (a.level < 1 || a.hidden || !(a.v('AbilityCooldown') > 0 || a.v('AbilityChargeRestoreTime') > 0)) continue;
      if (a.v('AbilityCharges') > 0 ? a.charges < 1 : a.cdRemaining() > 0) on++; else off++;
    }
    return { manaCostRed: off * cv(m, 'manacost_reduction'), spellLifesteal: on * cv(m, 'spell_lifesteal') };
  },
});

// Vile Phial: enough hits within the counter window poison the target.
// "Health restoration reduction is affected by item potency and can be applied by illusions' attacks", "stacks can be applied from
// different sources" (7.42 patch note)
debuff('modifier_item_vile_phial_poison', {
  stats: (m) => ({ restore: -cv(m, 'heal_reduce') * m.potency / 100 }),
  ...ticks(1, (m) => mhit(m, m.parent, cv(m, 'damage_per_second'), MAGICAL)),
});
function phialCount(m, o) {
  if (m.stacks < m.v('required_hits')) return;
  m.parent.addModifier('modifier_item_vile_phial_poison', { caster: m.caster, ability: m.ability, duration: m.v('poison_duration'), potency: o ? o.potency : undefined });
  m.remove();
}
debuff('modifier_item_vile_phial_counter', { multi: 'stack', onCreated: phialCount, onRefresh: phialCount });
passive(I('vile_phial'), {
  fid: 'full', illusion: true, note: 'illusions apply it too and the restoration reduction scales with Item Potency (7.42 patch note)',
  onAttackLanded(m, rec) {
    const t = rec.target;
    if (t.alive && !t.isBuilding && t.team !== m.parent.team) t.addModifier('modifier_item_vile_phial_counter', { caster: m.parent, ability: m.ability, duration: m.v('counter_duration'), potency: rec.potency });
  },
});

// Serrated Shiv: chance for True Strike and bonus physical damage from the target's current health.
// "Gut 'Em now works with illusions", "Gut 'Em chance is now affected by item potency" (7.42 patch note)
passive(I('serrated_shiv'), {
  fid: 'full', illusion: true, note: 'works on illusions, chance scaled by Item Potency (7.42 patch note); the target\'s health is read when the attack is launched; no effect on buildings',
  onAttack(m, rec) {
    const t = rec.target; const ab = m.ability;
    if (t.isBuilding || !ab.cdReady() || !m.roll(m.v('proc_chance') * rec.potency / 100)) return;
    ab.startCooldown();
    rec.trueStrike = true;
    rec.add += isRoshan(t) ? cv(m, 'hp_dmg_rosh') : t.hp * cv(m, 'hp_dmg') / 100;
  },
});

// Revenant's Brooch: chance for bonus magical damage from the attack's damage; counts as a critical strike, not against buildings
passive(I('revenants_brooch'), {
  fid: 'approx', note: 'when another critical strike procs on the same attack, that one is kept and Ghastly Strike is dropped, even where Ghastly Strike would be the stronger of the two',
  onAttack(m, rec) { if (!rec.target.isBuilding && m.roll(m.v('crit_chance'))) (rec.data ||= {}).ghastly = m; },
  onAttackLanded(m, rec) { if (rec.data && rec.data.ghastly === m && rec.crit <= 1 && rec.target.alive) mhit(m, rec.target, rec.damage * cv(m, 'crit_multiplier') / 100, MAGICAL); },
});

// ================================================================ tier 4
// Fallen Sky: fly to the target area, stun and burn what is there. "... set on fire for 6s, which deals 60 magical damage every 1s.
// Affects buildings" (7.38 patch note)
debuff('modifier_item_fallen_sky_burn', {
  ...ticks((m) => m.v('burn_interval'), (m) => { const t = m.parent; mhit(m, t, cv(m, t.isBuilding ? 'burn_dps_buildings' : 'burn_dps_units') * m.v('burn_interval'), MAGICAL); }),
});
// [L] measured in Hero Demo: while it flies the caster is stunned, invulnerable, ethereal and out of game, and already stands at the
// target point
modifier('modifier_item_fallen_sky_flight', {
  purge: 'none', state: ['STUN', 'INVULN', 'ETHEREAL', 'OUT'],
  onDestroy(m) {
    const u = m.parent; const ab = m.ability;
    if (!u.alive || !ab) return;
    const w = u.world;
    u.x = m.x; u.y = m.y;
    if (w.skillshotHit < 1 && !w.rng.chance(w.skillshotHit)) return;
    for (const e of w.enemiesInRadius(u, u.x, u.y, ab.v('impact_radius'))) {
      if (!e.isBuilding) addMod(ab, e, 'modifier_stunned', ab.v('stun_duration'));
      hit(ab, e, cv(ab, e.isBuilding ? 'impact_damage_buildings' : 'impact_damage_units'), MAGICAL);
      if (e.alive) addMod(ab, e, 'modifier_item_fallen_sky_burn', ab.v('burn_duration'));
    }
  },
});
modifier('modifier_item_fallen_sky', {
  hidden: true,
  onTakeDamage(m, d) { const s = d.src; if (s && s.team !== m.parent.team && (s.heroLike || isRoshan(s)) && !(d.flags & F_HP_LOSS)) lockout(m, m.v('blink_damage_cooldown')); },
});
defAbility(I('fallen_sky'), {
  mods: ['modifier_item_fallen_sky'], prio: 95, fid: 'approx',
  note: 'the caster is out of play while it flies; the impact damage type is not in the data (magical, like the burn in the 7.38 patch note); the lock after hero damage is a minimum cooldown; AI: dropped on the current target',
  ai: (ab, u, t) => (t && !u.isRooted() ? { x: t.x, y: t.y } : null),
  cast(ab, t, x, y) {
    if (rootedCast(ab)) return;
    const u = ab.owner;
    const m = u.addModifier('modifier_item_fallen_sky_flight', { ability: ab, duration: ab.v('land_time') });
    if (m) { m.x = x; m.y = y; u.x = x; u.y = y; }
  },
});

// Flicker: dispel, then a short random blink forward unless a player hurt the caster a moment ago
modifier('modifier_item_flicker', { hidden: true, onCreated(m) { m.x = -Infinity; }, onTakeDamage(m, d) { if (enemyPlayerDamage(m, d)) m.x = m.parent.world.time; } });
const flickerHeld = (u) => { const m = u.findModifier('modifier_item_flicker'); return !!m && u.world.time - m.x < PLAYER_DAMAGE_WINDOW; };
defAbility(I('flicker'), {
  mods: ['modifier_item_flicker'], prio: 60, fid: 'approx',
  note: 'no facing: blinks straight towards the aimed point (the current target) for a random distance; "within 3 seconds of player damage" is a tooltip literal; AI: to dispel a debuff, or to close a gap wider than the maximum distance',
  ai(ab, u, t) {
    if (!t || u.isRooted()) return null;
    if (hasDebuff(u)) return { x: t.x, y: t.y };
    return !flickerHeld(u) && u.rangeTo(t) - u.attackRange > cv(ab, 'max_range') ? { x: t.x, y: t.y } : null;
  },
  cast(ab, t, x, y) {
    const u = ab.owner; const w = u.world;
    if (rootedCast(ab)) return;
    u.purge({ debuffs: true });
    const dir = flickerHeld(u) ? null : forward(u, x, y);
    if (!dir) return;   // blinks in place
    const d = w.rng.range(cv(ab, 'min_range'), cv(ab, 'max_range'));
    u.x += dir[0] * d; u.y += dir[1] * d;
  },
});

// Minotaur Horn: basic dispel and a short debuff immunity (blocks pure and reflected damage, like the engine's debuff immunity)
modifier('modifier_item_minotaur_horn_active', { purge: 'none', state: ['IMMUNE'], stats: { mr: 'magic_resist' } });
defAbility(I('minotaur_horn'), {
  prio: 90, fid: 'full',
  ai: (ab, u, t) => (u.isImmune() ? null : hasDebuff(u) ? {} : t ? true : null),
  cast(ab) { const u = ab.owner; u.purge({ debuffs: true }); addMod(ab, u, 'modifier_item_minotaur_horn_active', cv(ab, 'duration')); },
});

// Mind Breaker: the next attack that lands silences (duration scales with Item Potency)
debuff('modifier_item_mind_breaker_debuff', { state: ['SILENCE'] });
passive(I('mind_breaker'), {
  fid: 'full', note: 'the first attack that lands while the item is ready silences; a miss does not spend it (the tooltip does not say)',
  onAttackLanded(m, rec) {
    const t = rec.target;
    if (!t.alive || t.isBuilding || t.team === m.parent.team || !m.ability.cdReady()) return;
    m.ability.startCooldown();
    t.addModifier('modifier_item_mind_breaker_debuff', { caster: m.parent, ability: m.ability, duration: cv(m, 'duration') * rec.potency / 100 });
  },
});

// Divine Regalia: more outgoing damage of every kind
passive(I('divine_regalia'), {
  fid: 'approx', note: 'all damage dealt to other units is amplified; "dying disables the item" has no effect here: a dead unit stays dead and reincarnation-type effects are not treated as a death',
  outgoing(m, d) { if (d.dst !== m.parent) d.amount *= 1 + cv(m, 'outgoing_damage') / 100; },
});

// Witchbane: attacks deal magical damage from the target's maximum mana; active dispels everyone in an area
modifier('modifier_item_heavy_blade', {
  hidden: true,
  onAttackLanded(m, rec) { const t = rec.target; if (t.alive && !t.isBuilding && t.team !== m.parent.team && t.maxMana > 0) mhit(m, t, t.maxMana * cv(m, 'damage') / 100, MAGICAL); },
});
defAbility(I('heavy_blade'), {
  mods: ['modifier_item_heavy_blade'], prio: 35, fid: 'full', note: 'AI: cast on the wearer when it carries a dispellable debuff, otherwise on a target that carries a dispellable buff',
  ai(ab, u, t) { if (hasDebuff(u)) return { x: u.x, y: u.y }; return t && !t.isImmune() && hasBuff(t) ? { x: t.x, y: t.y } : null; },
  cast(ab, t, x, y) {
    const u = ab.owner; const w = u.world; const r = ab.v('radius');
    for (const a of w.alliesInRadius(u, x, y, r)) a.purge({ debuffs: true });
    for (const e of w.enemiesInRadius(u, x, y, r)) if (!e.isImmune()) e.purge({ debuffs: false, buffs: true });
  },
});

// Helm of the Hivemind: cast range per assimilated hero, at the price of maximum health. "Each assimilated hero on both teams
// (including themself) increases this bonus ... Meepo Clones, Tempest Double and temporary heroes don't count" (7.42 patch note)
const HIVEMIND = I('helm_of_the_hivemind');
const wearsHelm = (o) => o.isHero && !o.isIllusion && !o.isSummon && o.items.some((it) => it.name === HIVEMIND && it.slot !== 'backpack');
const hiveChanged = (m) => { for (const o of m.parent.world.units) if (o !== m.parent && wearsHelm(o)) o.dirty = true; };
passive(HIVEMIND, {
  fid: 'full', note: 'every real hero in the world that carries the helm counts, the wearer included (7.42 patch note)',
  onCreated: hiveChanged, onDestroy: hiveChanged,
  stats(m) {
    let n = 0;
    for (const o of m.parent.world.units) if (wearsHelm(o)) n++;
    return { castRange: cv(m, 'cast_range') + cv(m, 'bonus_cast_range') * n, hpPct: -m.v('hp_loss_pct') * n };
  },
});

// Dezun Bloodrite: spells also cost health. "Abilities that are considered attacks are no longer impacted" (7.39b patch note)
passive(I('dezun_bloodrite'), {
  fid: 'partial', note: 'the health cost of casts is modelled (item casts included, attack modifiers excluded); the larger area of effect is NOT applied: the engine has a flat radius bonus only, no percentage',
  onCast(m, ev) {
    const u = m.parent; const w = u.world;
    if (w.freeSpells) return;
    const cost = ev.ability.manaCost() * m.v('health_pct') / 100;
    if (cost > 0) w.damage(u, u, cost, PURE, F_HP_LOSS | F_NON_LETHAL, m.ability);
  },
});

// Conjurer's Catalyst: spell damage piling up on an enemy makes it burn its own allies.
// "0.1s internal cooldown. Still can proc multiple times from a single instance of high damage" (7.41b),
// "threshold on illusions now only considers pre-amplification damage" (7.41e patch notes)
passive(I('conjurers_catalyst'), {
  fid: 'approx', note: 'the damage type is not in the data: magical assumed; a large instance overheats several times at once, the cooldown then holds back later instances (the tally keeps growing meanwhile)',
  onCreated(m) { m.data = new Map(); },
  onDealDamage(m, d) {
    const u = m.parent; const t = d.dst; const w = u.world;
    if ((d.flags & (F_ATTACK | F_HP_LOSS | F_REFLECT)) || d.ability === m.ability || t.team === u.team || d.dealt <= 0) return;
    let s = m.data.get(t);
    if (!s) m.data.set(t, s = { acc: 0, last: -Infinity });
    if (w.time - s.last > m.v('duration')) s.acc = 0;
    s.last = w.time; s.acc += d.dealt / (t.isIllusion && t.dmgTakenMul > 0 ? t.dmgTakenMul : 1);
    const thr = m.v('damage_threshold');
    if (thr <= 0 || s.acc < thr || w.time < m.x) return;
    m.x = w.time + m.v('cooldown');
    const dmg = cv(m, t.heroLike ? 'damage' : 'damage_creep'); const r = m.v('damage_aoe'); const tx = t.x; const ty = t.y; const team = t.team;
    while (s.acc >= thr) {
      s.acc -= thr;
      for (const e of w.inRadius(tx, ty, r, team, false)) if (e !== t && !e.isBuilding) mhit(m, e, dmg, MAGICAL);
    }
  },
});

// Giant's Ring: damage from strength to enemies the wearer stands on
passive(I('giants_ring'), {
  fid: 'approx',
  note: 'enemies within damage_radius take the damage every 0.5 s, magical assumed (the type is not in the data); units stop at attack reach and never walk onto each other here, so it rarely triggers; free pathing has no meaning without terrain',
  interval: AURA_TICK,
  onThink(m) {
    const u = m.parent; const dmg = u.str * cv(m, 'pct_str_damage_per_second') / 100 * AURA_TICK;
    if (dmg > 0) for (const e of u.world.enemiesInRadius(u, u.x, u.y, m.v('damage_radius'))) if (!e.isBuilding) mhit(m, e, dmg, MAGICAL);
  },
});

// Riftshadow Prism: pay current health for a full-health illusion with its own damage numbers and full Item Potency
defAbility(I('riftshadow_prism'), {
  prio: 30, fid: 'full', note: '"strong illusion" changes nothing here: no effect in the engine kills illusions outright',
  cast(ab) {
    const u = ab.owner; const w = u.world;
    w.damage(u, u, u.hp * ab.v('health_cost') / 100, PURE, F_HP_LOSS | F_NON_LETHAL, ab);
    const il = w.createIllusion(u, { duration: ab.v('duration'), outPct: cv(ab, 'outgoing_damage') - 100, inPct: ab.v('incoming_damage') - 100, potency: ab.v('illusion_effectiveness'), x: u.x + 70, y: u.y + 70 });
    il.hp = il.maxHp;
  },
});

// Book of the Dead. The numbers of the summons are not item values: the tooltip notes print them ("The Demonic Warrior has 1600 Health,
// 4 Armor, 40% Magic Resistance, 380 Movement Speed, 134 Attack Damage ..."), and the unit definitions carry older figures. They are
// read from the tooltip text once; without it nothing is invented (unit definitions / no summon, with a warning).
let demonText;
function demonNumbers() {
  if (demonText) return demonText;
  const d = loadDescriptions().item_demonicon || {};
  const count = /Summon (\d+) demonic warriors? and (\d+) demonic archers?/i.exec(d.desc || '');
  const unit = (name) => {
    const re = new RegExp(`Demonic ${name} has (\\d+) Health, (\\d+) Armor, (\\d+)% Magic Resistance, (\\d+) Movement Speed, (\\d+) Attack Damage`, 'i');
    for (const n of d.notes || []) { const x = re.exec(n); if (x) return { hp: +x[1], armor: +x[2], mr: +x[3], ms: +x[4], dmgMin: +x[5], dmgMax: +x[5] }; }
    return null;
  };
  return (demonText = { warrior: [count ? +count[1] : 0, unit('Warrior')], archer: [count ? +count[2] : 0, unit('Archer')] });
}
// The level-3 units take most keys from the level-1 units ("include_keys_from"), which the data pack does not resolve (no attack,
// no armor ...). Their own keys in the shipped file: attack speed, damage, movement speed, health and, for the archer, attack range.
const demonDefs = new WeakMap();
function demonDef(w, kind) {
  let byKind = demonDefs.get(w.data);
  if (!byKind) demonDefs.set(w.data, byKind = {});
  if (!byKind[kind]) {
    const d3 = w.data.units[`npc_dota_necronomicon_${kind}_3`]; const d1 = w.data.units[`npc_dota_necronomicon_${kind}_1`];
    byKind[kind] = d3.atk !== 'none' ? d3 : { ...d1, name: d3.name, dname: d3.dname, abilities: d3.abilities, baseAs: d3.baseAs, dmgMin: d3.dmgMin, dmgMax: d3.dmgMax, ms: d3.ms, hp: d3.hp, range: d1.atk === 'melee' ? d1.range : d3.range };
  }
  return byKind[kind];
}
const topLevel = (vals) => { let n = 1; for (const k in vals) { const e = vals[k]; const a = Array.isArray(e) ? e : e.v; if (a.length > n) n = a.length; } return n; };
const DEMON_SPOTS = [[90, 90], [90, -90], [-90, 90], [-90, -90]];   // where the summons appear around the caster (chosen)
defAbility(I('demonicon'), {
  prio: 60, engage: false, fid: 'approx',
  note: 'summons the level-3 Demonic Warrior / Archer units with the health, armor, magic resistance, speed and damage that the tooltip notes print (they are not item values); their Mana Break, Last Will, Purge and aura are unit abilities and work as far as those are scripted',
  ai: (ab, u, t) => (t ? true : null),
  cast(ab) {
    const u = ab.owner; const w = u.world; const dur = cv(ab, 'summon_duration'); const text = demonNumbers(); let k = 0;
    for (const kind of ['warrior', 'archer']) {
      const [count, stats] = text[kind];
      if (!count) { w.warn('item_demonicon: the number of summons was not found in the tooltip text, nothing is summoned'); continue; }
      if (!stats) w.warn('item_demonicon: the stats of the summons were not found in the tooltip text, the unit definitions are used');
      for (let i = 0; i < count; i++, k++) {
        const def = demonDef(w, kind); const spot = DEMON_SPOTS[k % DEMON_SPOTS.length];
        const s = w.summon(u, def.name, { x: u.x + spot[0], y: u.y + spot[1], duration: dur, ovr: stats ? { ...stats } : undefined, ai: 'fight' });
        s.def = def; s.melee = def.atk === 'melee'; s.canAttack = def.atk !== 'none';
        // abilities at the highest level the data has (level 3: the 50 mana burn, 800 Last Will damage and 9 aura of the tooltip notes)
        for (const a of s.abilities) { const top = topLevel(a.def.vals); if (top > a.maxLevel) a.maxLevel = top; a.setLevel(a.maxLevel); }
        s.recompute(); s.hp = s.maxHp;
      }
    }
  },
});
