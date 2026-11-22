// Hero abilities, part 1: Anti-Mage, Phantom Assassin, Juggernaut, Sven, Ursa, Wraith King, Chaos Knight.
// Every number is read from the shipped data by value name; behaviour follows the 7.42 tooltips (ability text, value labels,
// modifier texts and, where those are silent, the shipped patch notes). `fid` = fidelity: full | approx | partial | n/a.
import { defAbility, modifier, buff, debuff, passive, neg, hit, addMod, stun, enemiesNear, alliesNear, mhit,
  aura, cleave, barrier, giveBarrier, knockback, gapAI, lowHpAI, ST, C, PHYSICAL, MAGICAL, PURE,
  F_NO_AMP, F_ATTACK, F_SECONDARY } from '../engine/dsl.mjs';

const na = (name, note) => defAbility(name, { fid: 'n/a', note });
const ROSHAN = 'npc_dota_roshan';
// global lifesteal rule ("40% less against creeps"), the same factor the engine uses for the lifesteal stat
const CREEP_LIFESTEAL = 0.6;
const realHero = (e) => e.isHero && !e.isIllusion;
// may a unit-target spell without immunity piercing be thrown at t?
const canHit = (ab, t) => !!t && t.alive && (ab.pierces || !t.isImmune());
// is the unit's controller allowed to use this ability on its own? (for effects that fire outside the order pipeline)
const aiMayCast = (u, ab) => { const ai = u.ai; return !!ai && ai.mode === 'fight' && ab.ai !== false && (ai.abilities === 'all' || (Array.isArray(ai.abilities) && ai.abilities.includes(ab.name)) || (Array.isArray(ai.order) && ai.order.includes(ab.name))); };
// cast outside the order pipeline (abilities that may be used while disabled): pays, starts the cooldown, logs and runs the script
function castNow(ab) { const u = ab.owner; const w = u.world; ab.pay(); ab.startCooldown(); ab.casts++; u.mCasts++; if (w.log) w.logEvent('cast', u, null, ab.name, 0); ab.script.cast(ab, null, u.x, u.y); }
const disabled = (u) => { const st = u.st; return st[ST.OUT] === 0 && (st[ST.STUN] > 0 || st[ST.SLEEP] > 0 || st[ST.HEX] > 0 || st[ST.FEAR] > 0 || st[ST.TAUNT] > 0); };
// an order the ability cannot carry out (not available right now): gives back the mana and cooldown the cast pipeline has already charged
function refund(ab) { const u = ab.owner; if (u.world.freeSpells) return; ab.cdEnd = 0; u.mana += ab.manaCost(); }
// projectile disjoint: drops the engine's tracking projectiles (attacks and unit-target spells) that are flying towards `u`
function disjoint(u) { const ps = u.world.projectiles; if (!Array.isArray(ps)) return; for (let i = ps.length - 1; i >= 0; i--) if (ps[i].target === u) ps.splice(i, 1); }
// The engine drops a think that falls exactly on a modifier's expiry, so a periodic damage debuff delivers that last tick from onDestroy.
const tickDot = (name, def, tick) => debuff(name, {
  ...def,
  onCreated(m) { m.z = m.parent.world.time; },
  onThink(m) { m.z = m.parent.world.time; tick(m); },
  onDestroy(m, expired) { if (expired && m.parent.alive && m.parent.world.time - m.z >= m.interval - 1e-6) tick(m); },
});

// ================================================================ Anti-Mage
// Mana Break: the burn is fixed when the attack is launched and its damage rides on the attack as flat physical damage
// (not multiplied by crits); the mana itself is removed when the attack lands.
buff('modifier_antimage_blink_empowered', { purge: 'none' });
debuff('modifier_antimage_mana_break_lock', {
  purge: 'none', interval: C.TICK,
  onCreated(m) { m.x = m.parent.mana; },
  onThink(m) { const t = m.parent; if (t.mana > m.x) t.mana = m.x; else m.x = t.mana; },
});
passive('antimage_mana_break', {
  illusion: true, fid: 'full',
  note: 'burn damage is part of the attack (flat, after crits); illusions burn illusion_percentage of the mana and deal the burn damage without their outgoing damage penalty (assumed: the tooltip only gives the burn share); the Scepter "no mana gain" debuff clamps mana every tick',
  onAttack(m, rec) {
    const u = m.parent; const t = rec.target;
    if (t.isBuilding || t.team === u.team || t.isImmune()) return;
    if (t.dirty) t.recompute();
    if (t.maxMana <= 0) return;
    const emp = u.findModifier('modifier_antimage_blink_empowered');
    const pct = m.v('mana_per_hit_pct') + (emp ? m.v('empowered_max_burn_pct') : 0);
    const burn = Math.min(t.mana, (m.v('mana_per_hit') + t.maxMana * pct / 100) * (u.isIllusion ? m.v('illusion_percentage') / 100 : 1));
    (rec.data ||= {}).amBurn = burn; rec.data.amEmp = emp;
    // [L] measured in Hero Demo: the burn damage joins the attack as whole points (265 burned at 65% = 172.25 -> hits of 321..324 from a 149..153 roll)
    if (burn > 0) rec.add += Math.floor(burn * m.v('percent_damage_per_burn') / 100 + 1e-6) / (u.isIllusion && u.dmgOutMul > 0 ? u.dmgOutMul : 1);
  },
  onAttackLanded(m, rec) {
    const d = rec.data; if (!d || d.amBurn === undefined) return;
    const t = rec.target;
    if (d.amBurn > 0) t.burnMana(d.amBurn);
    if (d.amEmp && !d.amEmp.removed) { d.amEmp.remove(); if (t.alive) t.addModifier('modifier_antimage_mana_break_lock', { caster: m.parent, ability: m.ability, duration: m.v('empowered_mana_break_debuff_duration') }); }
  },
});
defAbility('antimage_blink', {
  prio: 100, fid: 'approx',
  note: 'he lands on the ordered point (in the game a point occupied by another unit pushes him about 58 units aside in an unpredictable direction: no collision here); the AI only uses it to close the distance and aims next to its target; the disjoint deletes every tracking projectile flying at Anti-Mage (engine projectile records, including the few the game treats as undodgeable)',
  ai(ab, u, t) {
    if (!t || u.rangeTo(t) - u.attackRange <= 250) return null;
    const d = u.distTo(t); const r = ab.castRange();
    if (r > 0 && d > r + 400) return null;
    const k = Math.max(0, d - (u.def.hull + t.def.hull + 10)) / (d || 1); // a point next to the target, on his own side
    return { x: u.x + (t.x - u.x) * k, y: u.y + (t.y - u.y) * k };
  },
  cast(ab, t, x, y) {
    const u = ab.owner;
    // [L] measured in Hero Demo: a point closer than min_blink_range is pushed out to it (ordered 100 ahead -> landed 200 ahead)
    const dx = x - u.x; const dy = y - u.y; const d = Math.sqrt(dx * dx + dy * dy); const mn = ab.v('min_blink_range');
    if (d > 1e-6 && d < mn) { x = u.x + dx / d * mn; y = u.y + dy / d * mn; }
    disjoint(u); u.jumpTo({ x, y, def: { hull: 0 } }, ab.castRange(), 0);
    if (ab.v('empowered_mana_break_duration') > 0) addMod(ab, u, 'modifier_antimage_blink_empowered', ab.v('empowered_mana_break_duration'));
  },
});
// Counterspell: passive magic resistance + a shell that blocks a unit-target spell and casts a copy of it back.
const REFLECT_WATCH = 3; // seconds during which debuffs created by a reflected copy are looked for (talent: longer reflected debuffs)
// Runs fn with the world's timers / projectiles wrapped, so that an error thrown by another hero's script (now or in a callback it
// schedules) while it runs with Anti-Mage as its caster is turned into a warning instead of aborting the simulation.
function guarded(w, label, fn) {
  const after = w.after; const projectile = w.projectile;
  w.after = (d, f) => after.call(w, d, () => guarded(w, label, f));
  w.projectile = (s, t, sp, f) => projectile.call(w, s, t, sp, (x) => guarded(w, label, () => f(x)));
  try { return fn(); } catch (e) { w.warn(`${label} (${e.message})`); return undefined; } finally { w.after = after; w.projectile = projectile; }
}
modifier('modifier_antimage_counterspell', { hidden: true, stats: { mr: 'magic_resistance' } });
modifier('modifier_antimage_counterspell_reflect_watch', {
  hidden: true, purge: 'none', multi: 'independent', interval: C.TICK, thinkNow: true,
  onThink(m) {
    const d = m.data; const us = m.parent.world.units;
    for (let i = 0; i < us.length; i++) {
      const e = us[i];
      if (!e.alive || e.team === m.parent.team) continue;
      for (const x of e.mods) if (x.ability === d.copy && x.def.debuff && x.dieTime !== Infinity && !d.seen.has(x)) { d.seen.add(x); x.setDuration(x.remaining() * (1 + d.pct / 100)); }
    }
  },
});
buff('modifier_antimage_counterspell_active', {
  onSpellTargeted(m, ev) {
    ev.blocked = true;
    const u = m.parent; const w = u.world; const a = ev.ability; const src = ev.caster;
    if (!(m.v('does_reflect') > 0) || !src || !src.alive) return;
    if (a.script && a.script.cast && !a.script.noReflect && src.targetable() && !(src.isImmune() && !a.pierces)) {
      // the reflected spell = the same ability object re-owned by Anti-Mage (same level, his own spell amp and talents)
      const copy = Object.assign(Object.create(Object.getPrototypeOf(a)), a, { owner: u, vals: {}, mods: [], data: null, ai: false, casts: 0, cdEnd: 0, charges: 0, chargeEnd: 0 });
      copy.refresh();
      const pct = m.v('reflected_debuff_duration_pct');
      if (pct > 0) u.addModifier('modifier_antimage_counterspell_reflect_watch', { ability: m.ability, duration: REFLECT_WATCH, data: { copy, pct, seen: new Set() } });
      guarded(w, `antimage_counterspell: could not reflect ${a.name}`, () => a.script.cast(copy, src, src.x, src.y));
    }
    if (u.hasShard && src.alive) w.createIllusion(u, { duration: m.v('duration_illusion'), outPct: m.v('outgoing_damage'), inPct: m.v('incoming_damage'), x: src.x + 50, y: src.y + 50, target: src });
  },
});
defAbility('antimage_counterspell', {
  mods: ['modifier_antimage_counterspell'], prio: 95, fid: 'approx',
  note: 'the reflected spell is the blocked ability\'s script re-run with Anti-Mage as caster (same level, his spell amp, none of the enemy\'s talents; a script that fails is only blocked); the AI raises the shell when an enemy is finishing a unit-target cast on him, so spells without cast point are not countered; talent: only debuffs applied within 3 s of the reflect are lengthened',
  ai(ab, u, t, w) {
    if (u.hasModifier('modifier_antimage_counterspell_active')) return null;
    const dur = ab.v('duration'); const us = w.units;
    for (let i = 0; i < us.length; i++) { const e = us[i]; if (e.alive && e.team !== u.team && e.castAb && e.castTarget === u && e.castEnd - w.time <= dur - 0.1) return {}; }
    return null;
  },
  cast(ab) { addMod(ab, ab.owner, 'modifier_antimage_counterspell_active', ab.v('duration')); },
});
debuff('modifier_antimage_persectur_slow', { stats: (m) => ({ msPct: -m.x }) });
passive('antimage_persectur', {
  illusion: true, fid: 'full',
  onAttackLanded(m, rec) {
    const t = rec.target;
    if (!t.alive || t.maxMana <= 0) return;
    const thr = m.v('mana_threshold') / 100; const mp = t.mana / t.maxMana;
    if (mp > thr) return;
    // [L] measured in Hero Demo: the slow is a whole percentage, rounded down (27.6 -> 27, 29.5 -> 29, 31.2 -> 31), from the mana left after the burn
    const slow = Math.floor(m.v('move_slow_min') + (m.v('move_slow_max') - m.v('move_slow_min')) * (1 - mp / thr) + 1e-9);
    const d = t.addModifier('modifier_antimage_persectur_slow', { caster: m.parent, ability: m.ability, duration: m.v('slow_duration') });
    if (d) { d.x = slow; t.dirty = true; }
  },
});
defAbility('antimage_mana_void', {
  prio: 50, fid: 'full', note: 'the mini-stun is applied to every unit hit (7.32e patch note; the tooltip sentence still names only the main target); AI: cast when it kills the target or removes at least 40% of its maximum health',
  ai(ab, u, t) {
    if (!canHit(ab, t) || t.maxMana <= 0) return null;
    const dmg = (t.maxMana - t.mana) * ab.v('mana_void_damage_per_mana') * (1 + u.spellAmp / 100) * (1 - t.mr);
    return dmg >= t.hp || dmg >= 0.4 * t.maxHp ? { target: t } : null;
  },
  cast(ab, t) {
    const dmg = (t.maxMana - t.mana) * ab.v('mana_void_damage_per_mana');
    for (const e of enemiesNear(ab, t.x, t.y, ab.v('mana_void_aoe_radius'))) { stun(ab, e, ab.v('mana_void_ministun')); hit(ab, e, dmg, MAGICAL); }
  },
});

// ================================================================ Phantom Assassin
// The shipped data has no immunity flag for Stifling Dagger, but its tooltip note ("spell-immune enemies are not affected by the slow")
// implies it can be thrown at them: the flag modifier lets the engine target debuff-immune units, the slow is then skipped by hand.
modifier('modifier_phantom_assassin_stifling_dagger_flags', { hidden: true, apply(m) { m.ability.pierces = true; } });
debuff('modifier_phantom_assassin_stifling_dagger', { stats: { msPct: 'move_slow' } });
function paDagger(ab, t) {
  const u = ab.owner; const w = u.world;
  w.projectile(u, t, ab.v('dagger_speed'), (tt) => {
    if (!tt.isImmune()) addMod(ab, tt, 'modifier_phantom_assassin_stifling_dagger', ab.v('duration'));
    // dagger damage = base_damage + attack damage * k, the whole of it multiplied by a critical strike (base_damage is divided by k
    // here because the engine multiplies everything inside the attack by `mult`)
    const k = 1 + ab.v('attack_factor') / 100;
    w.launchAttack(u, tt, { instant: true, mult: k, flat: k > 0 ? ab.v('base_damage') / k : 0, add: k > 0 ? 0 : ab.v('base_damage'), fromAbility: ab, trueStrike: true });
  });
}
defAbility('phantom_assassin_stifling_dagger', {
  mods: ['modifier_phantom_assassin_stifling_dagger_flags'], prio: 40, fid: 'approx',
  note: 'the dagger is an instant attack that cannot miss (assumed); a critical strike multiplies the whole dagger damage, base_damage included (assumed: the tooltip does not say whether base_damage crits); data oddity: the talent gives +20 to attack_factor but +15 to the tooltip value',
  cast(ab, t) {
    const u = ab.owner; const w = u.world;
    paDagger(ab, t);
    let n = ab.v('extra_daggers'); // talent: "two extra daggers towards random visible enemies within the cast range"
    if (n > 0) { const pool = w.inRadius(u.x, u.y, ab.castRange(), u.team, true).filter((e) => e !== t && !e.isBuilding && e.attackableBy(u)); while (n-- > 0 && pool.length) paDagger(ab, pool.splice(w.rng.int(0, pool.length - 1), 1)[0]); }
  },
});
buff('modifier_phantom_assassin_phantom_strike', { stats: { as: 'bonus_attack_speed' } });
defAbility('phantom_assassin_phantom_strike', {
  prio: 60, fid: 'full', note: 'the attack speed bonus lasts for the duration against any target (7.20 note); the strike itself issues no attack order (the controller attacks); the AI only strikes enemies, whenever the buff is down',
  ai: (ab, u, t) => (t && !u.hasModifier('modifier_phantom_assassin_phantom_strike') ? { target: t } : null),
  // [L] measured in Hero Demo: she lands 56 short of the target's centre (target 500 ahead -> 444); no attack order is issued
  cast(ab, t) { const u = ab.owner; u.jumpTo(t, Infinity, u.def.hull + t.def.hull + 8); if (t.team !== u.team) addMod(ab, u, 'modifier_phantom_assassin_phantom_strike', ab.v('duration')); },
});
// Blur: untargetable for as long as it lasts (invisible with True Sight immunity outside the vanish radius, visible but untargetable
// inside it). m.x = seconds a revealing enemy has stayed inside the vanish radius, m.y = 1 while invisible, m.z = 1 while revealed
const paRevealed = (u, r) => { for (const e of u.world.units) if (e.alive && e.team !== u.team && (realHero(e) || e.isBuilding) && u.distTo(e) <= r) return true; return false; };
buff('modifier_phantom_assassin_blur_active', {
  // [L] measured in Hero Demo: she is invisible for the first two ticks, then a revealing hero inside the radius makes her visible;
  // Blur ends fade_duration + two ticks after that (0.93 s in all with the dummy 500 away)
  purge: 'none', state: ['UNTARGETABLE'], interval: C.TICK, stats: { msPct: 'active_movespeed_bonus' },
  onCreated(m) { m.parent.st[ST.INVIS]++; m.y = 1; m.nextThink = m.parent.world.time + 2 * C.TICK; },
  onThink(m) {
    const u = m.parent; const t = u.world.time;
    if (paRevealed(u, m.v('radius'))) {
      if (m.y) { u.st[ST.INVIS]--; m.y = 0; }
      if (!m.z) { m.z = 1; m.x = t; }
      if (t - m.x >= m.v('fade_duration') + 2 * C.TICK - 1e-9) m.remove(); // the revealing enemy stayed for the whole vanish buffer
    } else {
      m.z = 0;
      if (!m.y) { u.st[ST.INVIS]++; m.y = 1; }
    }
  },
  onAttackLanded(m, rec) { if (rec.target.name === ROSHAN) m.remove(); },
  onDestroy(m) { if (m.y) { m.parent.st[ST.INVIS]--; m.y = 0; } },
});
modifier('modifier_phantom_assassin_blur', {
  hidden: true,
  onKill(m, ev) { // Shard: a hero kill advances her ability cooldowns
    const u = m.parent; const v = ev.victim; const pct = m.v('cooldown_refund_pct');
    if (pct <= 0 || !realHero(v) || v.team === u.team) return;
    const now = u.world.time;
    for (const a of u.abilities) {
      if (a.level < 1) continue;
      if (a.vals.AbilityCharges > 0) { if (a.chargeEnd > now) a.chargeEnd -= (a.v('AbilityChargeRestoreTime') || a.v('AbilityCooldown')) * u.cdrMul * pct / 100; } else if (a.cdEnd > now) a.cdEnd -= a.cooldown() * pct / 100;
    }
  },
});
defAbility('phantom_assassin_blur', {
  mods: ['modifier_phantom_assassin_blur'], prio: 90, engage: false, fid: 'approx',
  note: 'she cannot be targeted while Blur lasts (area effects still hit her); it ends when an enemy hero or building has stayed inside the vanish radius for the vanish buffer, or when she hits Roshan; the disjoint deletes every tracking projectile flying at her; AI: cast whenever she has a target and nothing reveals her',
  ai: (ab, u, t) => (t && !u.hasModifier('modifier_phantom_assassin_blur_active') && !paRevealed(u, ab.v('radius')) ? {} : null),
  cast(ab) { const u = ab.owner; disjoint(u); addMod(ab, u, 'modifier_phantom_assassin_blur_active', ab.v('duration')); },
});
debuff('modifier_phantom_assassin_fan_of_knives_break', { state: ['BREAK'], purge: 'none', pierce: true, stats: () => null });
defAbility('phantom_assassin_fan_of_knives', {
  prio: 75, fid: 'full', note: 'the enemies inside the radius at cast time are hit when the blades reach them (distance / projectile speed)',
  ai: (ab, u, t) => (t && !t.isBuilding && u.distTo(t) <= ab.v('radius') - 50 ? {} : null),
  cast(ab) {
    const u = ab.owner; const w = u.world; const cap = ab.v('max_damage_initial');
    for (const e of enemiesNear(ab, u.x, u.y, ab.v('radius'))) {
      if (e.isBuilding) continue;
      w.after(u.distTo(e) / ab.v('projectile_speed'), () => {
        if (!e.alive) return;
        addMod(ab, e, 'modifier_phantom_assassin_fan_of_knives_break', ab.v('duration'));
        const dmg = e.maxHp * ab.v('pct_health_damage_initial') / 100;
        hit(ab, e, cap > 0 ? Math.min(cap, dmg) : dmg, PHYSICAL);
      });
    }
  },
});
passive('phantom_assassin_immaterial', { fid: 'full', stats: { evasion: 'evasion' } });
buff('modifier_phantom_assassin_coup_de_grace_focus', { purge: 'none' });
passive('phantom_assassin_coup_de_grace', {
  fid: 'full', note: 'Deadly Focus is rolled when an attack or dagger is launched and is spent by the next one',
  onAttack(m, rec) {
    const u = m.parent;
    if (rec.target.isBuilding) return;
    const f = u.findModifier('modifier_phantom_assassin_coup_de_grace_focus');
    if (f) { const c = m.v('crit_bonus') / 100; if (c > rec.crit) rec.crit = c; f.remove(); }
    const dagger = rec.fromAbility && rec.fromAbility.name === 'phantom_assassin_stifling_dagger';
    if (m.roll(dagger ? m.v('dagger_crit_chance') : m.v('crit_chance'))) u.addModifier('modifier_phantom_assassin_coup_de_grace_focus', { ability: m.ability, duration: m.v('duration') });
  },
});

// ================================================================ Juggernaut
buff('modifier_juggernaut_blade_fury', {
  purge: 'none', state: ['IMMUNE'], interval: (m) => m.v('blade_fury_damage_tick'), thinkNow: true,
  stats: (m) => ({ mr: m.v('immunity_resist'), ms: m.v('bonus_movespeed'), msPct: -m.v('movement_slow') }),
  onCreated(m) { const u = m.parent; u.purge({ debuffs: true }); if (!(m.v('scepter_attack_damage_pct') > 0)) { u.st[ST.DISARM]++; m.z = 1; } },
  onDestroy(m) { const u = m.parent; if (m.z === 1) { u.st[ST.DISARM]--; m.z = 0; } if (u.alive) u.purge({ debuffs: true }); },
  onAttack(m, rec) { const k = m.v('scepter_attack_damage_pct') / 100; if (k > 0) { rec.mult *= k; rec.potency *= k; } },
  onThink(m) {
    const u = m.parent; const bd = u.findAbility('juggernaut_blade_dance');
    const crit = m.v('can_crit') > 0 && bd && bd.level > 0 && !(u.st[ST.BREAK] > 0);
    const dmg = m.v('blade_fury_damage') * m.v('blade_fury_damage_tick');
    for (const e of u.world.enemiesInRadius(u, u.x, u.y, m.v('blade_fury_radius'))) if (!e.isBuilding) mhit(m, e, crit && m.roll(bd.v('blade_dance_crit_chance')) ? dmg * bd.v('blade_dance_crit_mult') / 100 : dmg, MAGICAL);
  },
});
defAbility('juggernaut_blade_fury', {
  prio: 50, fid: 'approx',
  note: 'he is disarmed while spinning (7.42 note) unless he has the Scepter; Scepter attacks use the normal attack cycle at 75% damage and potency (they do not continue while moving or stunned); Blade Fury only crits while its can_crit value is 1 (it is 0 in 7.42 although the Blade Dance tooltip mentions Blade Fury); AI: spins when the spin out-damages his attacks, when below 50% health or with Scepter',
  ai(ab, u, t) {
    if (!t || u.distTo(t) > ab.v('blade_fury_radius') + 40) return null;
    if (ab.v('scepter_attack_damage_pct') > 0 || u.hp < 0.5 * u.maxHp) return true;
    const spin = ab.v('blade_fury_damage') * (1 + u.spellAmp / 100) * (1 - t.mr);
    const attack = ((u.dmgMin + u.dmgMax) / 2 + u.dmgBonus) * C.armorMult(t.armor) / u.attackInterval;
    return spin >= attack ? true : null;
  },
  cast(ab) { addMod(ab, ab.owner, 'modifier_juggernaut_blade_fury', ab.v('duration')); },
});
// Healing Ward: a real ward unit with pip health (the unit's base health = one pip made of quarter pips; 7.42 pip rules: heroes,
// Roshan and buildings remove a full pip per attack, everything else a quarter; spells do nothing).
const HEALING_WARD = 'npc_dota_juggernaut_healing_ward';
const WARD_TICK = 0.5; // healing / follow interval chosen for the script
modifier('modifier_juggernaut_healing_ward', {
  purge: 'none', interval: WARD_TICK,
  postMit(m, d) {
    const s = d.src; const pip = m.parent.def.hp;
    d.amount = (d.flags & F_ATTACK) && !(d.flags & F_SECONDARY) && s ? (realHero(s) || s.isBuilding || s.name === ROSHAN ? pip : pip / 4) : 0;
  },
  onThink(m) {
    const wd = m.parent; const w = wd.world; const o = m.caster;
    for (const a of w.inRadius(wd.x, wd.y, m.v('healing_ward_aura_radius'), wd.team, false)) if (a !== wd && !a.isBuilding) a.heal(a.maxHp * m.v('healing_ward_heal_amount') / 100 * WARD_TICK, o, m.ability, true);
    if (!o.alive) return;
    // the ward trails half an aura radius behind Juggernaut, on the side away from the nearest enemy
    const e = w.nearestEnemy(o); let dx = -1; let dy = 0;
    if (e) { const d = o.distTo(e) || 1; dx = (o.x - e.x) / d; dy = (o.y - e.y) / d; }
    const k = m.v('healing_ward_aura_radius') / 2; const tx = o.x + dx * k; const ty = o.y + dy * k;
    if ((wd.x - tx) ** 2 + (wd.y - ty) ** 2 > 50 * 50) wd.moveTo(tx, ty);
  },
});
defAbility('juggernaut_healing_ward', {
  prio: 20, fid: 'approx',
  note: 'the ward is a summoned unit with pip health that follows Juggernaut (player control assumed) and heals in 0.5 s steps; a new ward replaces the old one (wards do not stack)',
  ai(ab, u, t) {
    if (!t) return null;
    if (u.hp < 0.7 * u.maxHp) return { x: u.x, y: u.y };
    for (const a of u.world.alliesInRadius(u, u.x, u.y, ab.v('healing_ward_aura_radius'))) if (realHero(a) && a.hp < 0.5 * a.maxHp) return { x: u.x, y: u.y };
    return null;
  },
  cast(ab, t, x, y) {
    const u = ab.owner; const w = u.world;
    if (ab.data && ab.data.alive) w.kill(ab.data, null, null, true);
    const wd = w.summon(u, HEALING_WARD, { x, y, duration: ab.v('AbilityDuration'), ai: 'idle', ovr: { hp: w.unitDef(HEALING_WARD).hp * ab.v('healing_ward_hits_to_kill_tooltip') } });
    wd.addModifier('modifier_juggernaut_healing_ward', { caster: u, ability: ab });
    ab.data = wd;
  },
});
passive('juggernaut_blade_dance', {
  fid: 'full', note: 'crits on attacks; Blade Fury only crits while Blade Fury\'s can_crit value is set (0 in the 7.42 data, although this tooltip mentions Blade Fury)',
  onAttack(m, rec) {
    if (rec.target.isBuilding || !m.roll(m.v('blade_dance_crit_chance'))) return;
    const c = m.v('blade_dance_crit_mult') / 100; if (c > rec.crit) rec.crit = c;
    (rec.data ||= {}).bdLifesteal = m.v('blade_dance_lifesteal');
  },
  onAttackLanded(m, rec) { // talent: Blade Dance crits lifesteal
    const ls = rec.data ? rec.data.bdLifesteal : 0; const u = m.parent;
    if (ls > 0 && rec.dealt > 0) u.heal(rec.dealt * ls / 100 * (1 + u.lifestealAmp / 100) * (rec.target.heroLike ? 1 : CREEP_LIFESTEAL), u, m.ability, true);
  },
});
passive('juggernaut_bladeform', {
  fid: 'approx', note: 'starts the fight at max stacks (at zero with rules.fresh); stack timers are checked every 0.1 s; damage during the linger does not restart it',
  breakable: false, interval: 0.1,
  // x = start of the fade timer (-1 none), y = last damage time, z = last stack change
  onCreated(m) { m.stacks = m.parent.world.fresh ? 0 : m.v('max_stacks'); m.x = -1; m.y = -100; m.z = m.parent.world.time; }, // z = now: a scenario that starts him at fewer stacks gets the next one a full interval later
  onTakeDamage(m, d) { if (d.dealt <= 0) return; const t = m.parent.world.time; m.y = t; if (m.stacks > 0 && m.x < 0) m.x = t; },
  onThink(m) {
    const u = m.parent; const t = u.world.time; const gain = m.v('stack_gain_time');
    if (m.x >= 0 && t - m.x >= m.v('linger_duration') - 1e-9) { m.setStacks(0); m.x = -1; }
    // [L] measured in Hero Demo: hit at 6.8 with 3 stacks -> the bonus lingers until 8.8, when the first new stack arrives on the same tick
    if (m.x < 0 && m.stacks < m.v('max_stacks') && !(u.st[ST.BREAK] > 0) && t - m.y >= gain - 1e-9 && t - m.z >= gain - 1e-9) { m.setStacks(m.stacks + 1); m.z = t; }
  },
  stats: (m) => ({ agi: m.parent.baseAttr('agi') * m.v('agi_bonus_pct_per_stack') / 100 * m.stacks, msPct: m.v('movement_speed_pct_per_stack') * m.stacks }),
});
// [L] measured in Hero Demo: while slashing he is invulnerable, disarmed and rooted (not silenced or muted); every slash puts him
// OMNI_GAP beyond the target's hull on the far side of it (he passes through: x = 464, 336, 464 ... around a target at 400), and
// the next slash comes one slash interval after the server tick of the previous one (11 ticks at 277-290 attack speed).
const OMNI_GAP = 16;
buff('modifier_juggernaut_omni_slash', {
  purge: 'none', state: ['INVULN', 'DISARM', 'UNTARGETABLE', 'ROOT'],
  stats: (m) => ({ dmg: m.v('bonus_damage'), as: m.v('bonus_attack_speed') }),
  interval: C.TICK, thinkNow: true, // re-timed after every slash: attack interval / slash rate multiplier
  onThink(m) {
    const u = m.parent; const w = u.world;
    if (u.dirty) u.recompute();
    let t = m.data ? m.data.first : null; m.data = null;
    if (!t || !t.attackableBy(u)) {
      const es = w.inRadius(u.x, u.y, m.v('omni_slash_radius'), u.team, true).filter((e) => !e.isBuilding && e.attackableBy(u));
      if (!es.length) { m.remove(); return; }
      t = es[w.rng.int(0, es.length - 1)];
    }
    const dx = t.x - u.x; const dy = t.y - u.y; const d = Math.sqrt(dx * dx + dy * dy); const k = u.def.hull + t.def.hull + OMNI_GAP;
    if (d > 1e-6) { u.x = t.x + dx / d * k; u.y = t.y + dy / d * k; } else u.x = t.x + k;
    w.launchAttack(u, t, { instant: true, fromAbility: m.ability });
    m.interval = Math.max(C.TICK, u.attackInterval / m.v('attack_rate_multiplier'));
    m.nextThink = w.time + m.interval;
  },
});
defAbility('juggernaut_omni_slash', {
  prio: 70, fid: 'full', note: 'one slash (instant attack) per attack interval / slash rate multiplier, the first one on the cast target; slash damage rolls like any attack',
  cast(ab, t) { const u = ab.owner; u.purge({ debuffs: true }); u.jumpTo(t); addMod(ab, u, 'modifier_juggernaut_omni_slash', ab.v('duration'), { data: { first: t } }); },
});

// ================================================================ Sven
defAbility('sven_storm_bolt', {
  prio: 60, fid: 'partial',
  note: 'Scepter: cast range, basic dispel of the target and invulnerable enemies in the area are modelled; the alt-cast (Sven flies with the hammer, +scepter_bonus_damage) is not: the engine has no alt-cast order, and a normal cast neither moves him nor adds the bonus (live); units out of play are not hit; the bonus_damage_pct value belongs to a talent Sven no longer has and is ignored',
  cast(ab, t) {
    const u = ab.owner; const sc = u.hasScepter;
    u.world.projectile(u, t, ab.v('bolt_speed'), (tt) => {
      if (sc && !tt.isImmune()) tt.purge({ debuffs: false, buffs: true });
      const dmg = ab.v('AbilityDamage'); // [L] Hero Demo: a normal cast with Scepter deals 320 (240 after resistance), no bonus
      for (const e of enemiesNear(ab, tt.x, tt.y, ab.v('bolt_aoe'))) {
        // Scepter "affects invulnerable units": the engine refuses damage and debuffs on them, so the state is lifted for the moment of impact
        const inv = sc ? e.st[ST.INVULN] : 0;
        if (inv > 0) e.st[ST.INVULN] = 0;
        stun(ab, e, ab.v('bolt_stun_duration')); hit(ab, e, dmg, MAGICAL);
        if (inv > 0) e.st[ST.INVULN] += inv;
      }
    });
  },
});
// [L] measured in Hero Demo: Great Cleave on a granite golem dealt 165.3 at 8 armor and 112.3-113.2 at 19.5 armor for 243.8-245.6 on
// a 0-armor dummy, exactly the armor factor: the cleave is reduced by the armor of the unit it hits (the shared cleave helper ignores armor)
function armoredCleave(attacker, target, damage, startW, endW, dist, ability) {
  const w = attacker.world;
  const dx = target.x - attacker.x; const dy = target.y - attacker.y;
  const d = Math.sqrt(dx * dx + dy * dy) || 1; const ux = dx / d; const uy = dy / d;
  for (const e of w.units.slice()) {
    if (!e.alive || e.team === attacker.team || e === target || e.isBuilding || e.st[ST.OUT] > 0) continue;
    const rx = e.x - attacker.x; const ry = e.y - attacker.y; const along = rx * ux + ry * uy;
    if (along < 0 || along > dist) continue;
    const half = (startW + (endW - startW) * (along / dist)) / 2;
    if (Math.abs(rx * uy - ry * ux) <= half + e.def.hull) w.damage(attacker, e, damage, PHYSICAL, F_SECONDARY, ability);
  }
}
passive('sven_great_cleave', { fid: 'full', note: 'cone cleave of the attack damage, reduced by the armor of each unit hit (live measurement)', onAttackLanded(m, rec) { if (rec.damage > 0) armoredCleave(m.parent, rec.target, rec.damage * m.v('great_cleave_damage') / 100, m.v('cleave_starting_width'), m.v('cleave_ending_width'), m.v('cleave_distance'), m.ability); } });
const svenWarcry = { stats: { armor: 'bonus_armor', msPct: 'movespeed' } };
buff('modifier_sven_warcry', svenWarcry);
buff('modifier_sven_warcry_shard', { ...svenWarcry, purge: 'none' }); // Shard: undispellable
barrier('modifier_sven_warcry_barrier', 'physical', { purge: 'none', onRefresh(m, o) { if (o && o.data) m.data = o.data; } });
defAbility('sven_warcry', {
  prio: 55, engage: false, fid: 'full',
  ai: (ab, u, t) => (t && u.distTo(t) < 900 && !u.hasModifier('modifier_sven_warcry') && !u.hasModifier('modifier_sven_warcry_shard') ? true : null),
  cast(ab) {
    const u = ab.owner; const shield = ab.v('base_barrier_amount') + ab.v('barrier_per_strength') * u.str;
    for (const a of alliesNear(ab, u.x, u.y, ab.v('radius'))) {
      if (!a.heroLike) continue;
      addMod(ab, a, ab.v('undispellable') > 0 ? 'modifier_sven_warcry_shard' : 'modifier_sven_warcry', ab.v('duration'));
      if (shield > 0) giveBarrier(ab, a, 'modifier_sven_warcry_barrier', shield, ab.v('duration'));
    }
  },
});
buff('modifier_sven_gods_strength', { purge: 'none', stats: { dmgBasePct: 'gods_strength_damage', slowRes: 'bonus_slow_resistance' } });
defAbility('sven_gods_strength', {
  prio: 80, engage: false, fid: 'full',
  ai: (ab, u, t) => (t && u.distTo(t) < 1000 && !u.hasModifier('modifier_sven_gods_strength') ? true : null),
  cast(ab) { addMod(ab, ab.owner, 'modifier_sven_gods_strength', ab.v('AbilityDuration')); },
});
passive('sven_wrath_of_god', {
  fid: 'full', note: 'bonus (green) attack damage per point of Strength: the live hero\'s base damage range does not contain it at any level, its average attack damage does',
  // [L] measured in Hero Demo: a whole number (L30, 139.5 Strength: average damage 271 = 177 + 94; with God's Strength 607 and 695)
  late(m, s, u) { s.dmg += Math.floor(u.str * m.v('bonus_damage_per_str') + 1e-9); },
});

// ================================================================ Ursa
debuff('modifier_ursa_earthshock', { stats: { msPct: 'movement_slow' } });
debuff('modifier_ursa_fury_swipes_debuff', { multi: 'stack', purge: 'none', statusResist: false });
const ursaSwipeTime = (fs, t) => (t.name === ROSHAN ? fs.v('bonus_reset_time_roshan') : fs.v('bonus_reset_time'));
defAbility('ursa_earthshock', {
  prio: 50, fid: 'approx', note: 'the hop is an instant move towards the target that stops in attack reach; the shock lands hop_duration later',
  ai: (ab, u, t) => (t && u.distTo(t) <= ab.v('shock_radius') + ab.v('hop_distance') - 50 ? { x: t.x, y: t.y } : null),
  cast(ab, t, x, y) {
    const u = ab.owner;
    if (!u.isRooted() && (x !== u.x || y !== u.y)) u.jumpTo({ x, y, def: { hull: u.def.hull } }, ab.v('hop_distance'));
    u.world.after(ab.v('hop_duration'), () => {
      if (!u.alive) return;
      const fs = u.findAbility('ursa_fury_swipes'); const n = ab.v('fury_swipe_stacks_on_hit');
      for (const e of enemiesNear(ab, u.x, u.y, ab.v('shock_radius'))) {
        hit(ab, e, ab.v('AbilityDamage'), MAGICAL);
        if (!e.alive || e.isImmune()) continue;
        addMod(ab, e, 'modifier_ursa_earthshock', ab.v('AbilityDuration'));
        if (n > 0 && fs && fs.level > 0 && !e.isBuilding) e.addModifier('modifier_ursa_fury_swipes_debuff', { caster: u, ability: fs, duration: ursaSwipeTime(fs, e), stacks: n, pierce: true });
      }
    });
  },
});
buff('modifier_ursa_overpower', {
  multi: 'stack', stats: (m) => ({ as: m.v('attack_speed_bonus_pct'), slowRes: m.v('slow_resist') }),
  onAttack(m) {
    if (m.stacks > 1) { m.setStacks(m.stacks - 1); return; }
    // last charge: the rest of this attack cycle runs at normal speed again (the engine fixed the whole cycle when the swing started)
    const u = m.parent; const w = u.world; const fast = u.attackSpeed;
    m.remove(); u.recompute();
    const rest = u.nextAttackTime - w.time;
    if (rest > 0 && u.attackSpeed > 0) u.nextAttackTime = w.time + rest * fast / u.attackSpeed;
  },
});
defAbility('ursa_overpower', {
  prio: 65, fid: 'full', note: 'a charge is spent when an attack is launched (hit or miss)',
  ai: (ab, u, t) => (t && u.rangeTo(t) <= u.attackRange + 250 && !u.hasModifier('modifier_ursa_overpower') ? true : null),
  cast(ab) { const u = ab.owner; u.removeModifierByName('modifier_ursa_overpower'); u.addModifier('modifier_ursa_overpower', { ability: ab, duration: ab.v('AbilityDuration'), stacks: ab.v('max_attacks') }); },
});
passive('ursa_fury_swipes', {
  fid: 'full', breakable: false, // Break only stops new stacks; existing stacks keep adding damage
  onAttack(m, rec) {
    const t = rec.target; if (t.isBuilding) return;
    const d = t.findModifier('modifier_ursa_fury_swipes_debuff');
    rec.add += m.v('damage_per_stack') * ((d ? d.stacks : 0) + (m.parent.st[ST.BREAK] > 0 ? 0 : 1));
  },
  onAttackLanded(m, rec) {
    const t = rec.target; const u = m.parent;
    if (!t.alive || t.isBuilding || u.st[ST.BREAK] > 0) return;
    const d = t.addModifier('modifier_ursa_fury_swipes_debuff', { caster: u, ability: m.ability, duration: ursaSwipeTime(m.ability, t), pierce: true });
    const need = m.v('stun_stack_count');
    if (d && need > 0 && d.stacks > 0 && d.stacks % need === 0) stun(m.ability, t, m.v('stun_duration'));
  },
});
passive('ursa_maul', { fid: 'full', dynamic: true, late(m, s, u) { s.dmg += u.hp * m.v('health_as_damage_pct') / 100; } });
buff('modifier_ursa_enrage', { purge: 'none', stats: { dmgTaken: neg('damage_reduction'), statusRes: 'status_resistance' } });
modifier('modifier_ursa_enrage_watch', { // Scepter: Enrage may be used while disabled
  hidden: true, interval: 0.1,
  onThink(m) { const u = m.parent; const ab = m.ability; if (u.hasScepter && disabled(u) && ab.ready() && aiMayCast(u, ab)) castNow(ab); },
});
defAbility('ursa_enrage', {
  mods: ['modifier_ursa_enrage_watch'], prio: 30, engage: false, ai: lowHpAI(0.6), fid: 'full',
  note: 'AI: used below 60% health; with Scepter also the moment Ursa is stunned, hexed, feared, taunted or asleep',
  cast(ab) { const u = ab.owner; u.purge({ debuffs: true, strong: true }); addMod(ab, u, 'modifier_ursa_enrage', ab.v('duration')); },
});

// ================================================================ Wraith King
const SKELETON = 'npc_dota_wraith_king_skeleton_warrior';
const CREEPS_PER_CHARGE = 2; // tooltip text: "a Charge for every 2 creeps killed" (no value in the data)
// [L] measured in Hero Demo: the burn debuff (slow included) starts on impact and lasts stun + blast_dot_duration; it ticks when the
// stun ends, then every second, the last tick on expiry (1.8 s stun + 2 s: ticks at +1.8, +2.8, +3.8 = three ticks)
tickDot('modifier_skeleton_king_hellfire_blast', { interval: 1, stats: { msPct: 'blast_slow' } }, (m) => mhit(m, m.parent, m.v('blast_dot_damage'), MAGICAL));
function wkBlast(ab, t) {
  const u = ab.owner; const w = u.world;
  w.projectile(u, t, ab.v('blast_speed'), (tt) => {
    hit(ab, tt, ab.v('damage'), MAGICAL);
    if (!tt.alive) return;
    const sm = stun(ab, tt, ab.v('blast_stun_duration'));
    const dm = addMod(ab, tt, 'modifier_skeleton_king_hellfire_blast', ab.v('blast_stun_duration') + ab.v('blast_dot_duration'));
    if (dm) { const first = sm ? Math.max(0, Math.min(sm.remaining(), dm.remaining())) : 0; dm.nextThink = tt.world.time + first; if (dm.nextThink < tt.nextModEvent) tt.nextModEvent = dm.nextThink; dm.z = tt.world.time + first - 1; }
  });
}
defAbility('skeleton_king_hellfire_blast', {
  prio: 60, fid: 'full', note: 'Bone Guard skeletons are ordered onto the target (Bone Guard tooltip note); a shipped modifier text also mentions a movement and attack speed buff for them, but neither the tooltip nor the data has a value for it, so none is applied',
  cast(ab, t) {
    const u = ab.owner;
    wkBlast(ab, t);
    for (const s of u.world.units) if (s.alive && s.owner === u && s.name === SKELETON && s.ai) s.ai.fixedTarget = t;
  },
});
// skeleton = the shipped unit; its tracker ability carries the Bone Guard rules (hero / building damage, Vampiric Spirit lifesteal, one respawn)
modifier('modifier_skeleton_king_bone_guard_reincarnating', { purge: 'none', state: ['OUT', 'INVULN'], onDestroy(m) { const u = m.parent; if (u.alive) { u.recompute(); u.hp = u.maxHp; } } });
passive('skeleton_king_bone_guard_damage_tracker', {
  fid: 'full', note: 'skeleton passive: Bone Guard hero / building damage factors, Vampiric Spirit lifesteal and one respawn for Bone Guard skeletons',
  stats(m) { const o = m.parent.owner; const vs = o && o.findAbility('skeleton_king_vampiric_spirit'); return vs && vs.level > 0 && !(o.st[ST.BREAK] > 0) ? { lifesteal: vs.v('vampiric_aura') } : null; },
  outgoing(m, d) {
    if (!(d.flags & F_ATTACK)) return;
    const o = m.parent.owner; const bg = o && o.findAbility('skeleton_king_bone_guard');
    if (!bg) return;
    if (d.dst.isHero) d.amount *= 1 + bg.v('skeleton_bonus_hero_damage') / 100; else if (d.dst.isBuilding) d.amount *= 1 - bg.v('skeleton_building_damage_reduction') / 100;
  },
  onDeath(m, ev) { // m.x = 1: one respawn left
    const u = m.parent; const bg = u.owner && u.owner.findAbility('skeleton_king_bone_guard');
    if (m.x !== 1 || ev.prevent || !bg) return;
    m.x = 0; ev.prevent = true; u.hp = 1;
    u.addModifier('modifier_skeleton_king_bone_guard_reincarnating', { ability: bg, duration: bg.v('reincarnate_time') });
  },
  onKill(m, ev) { // kills by his units near Wraith King also count towards charges (7.31 note)
    const o = m.parent.owner; const cm = o && o.alive ? o.findModifier('modifier_skeleton_king_bone_guard') : null;
    if (cm && !(o.st[ST.BREAK] > 0) && m.parent.distTo(o) <= SKELETON_CREDIT_RANGE) wkCharge(cm, ev.victim);
  },
});
const SKELETON_CREDIT_RANGE = 1200; // 7.31 patch note: kills by units under his control within 1200 range give charge progress
function wkCharge(m, v) { // m.stacks = charges, m.x = fraction of the next charge
  if (v.team === m.parent.team || v.isBuilding || v.isIllusion) return;
  m.x += (v.isHero ? m.v('skeleton_charges_per_hero_multiplier') : 1) / CREEPS_PER_CHARGE;
  const whole = Math.floor(m.x + 1e-9);
  if (whole > 0) { m.x -= whole; m.setStacks(Math.min(m.v('max_skeleton_charges'), m.stacks + whole)); }
}
function wkSkeleton(u, x, y, focus, respawn) {
  const w = u.world; const bg = u.findAbility('skeleton_king_bone_guard'); const def = w.unitDef(SKELETON); const bonus = bg ? bg.v('talent_skeleton_damage') : 0;
  const sk = w.summon(u, SKELETON, { x, y, duration: bg ? bg.v('skeleton_duration') : undefined, ovr: { dmgMin: def.dmgMin + bonus, dmgMax: def.dmgMax + bonus } });
  const tr = sk.findModifier('modifier_skeleton_king_bone_guard_damage_tracker');
  if (tr && respawn) tr.x = 1;
  if (focus && sk.ai) sk.ai.fixedTarget = focus;
  sk.dirty = true;
  return sk;
}
modifier('modifier_skeleton_king_bone_guard', { hidden: true, onCreated(m) { m.stacks = m.parent.world.fresh ? 0 : m.v('max_skeleton_charges'); }, onKill(m, ev) { wkCharge(m, ev.victim); } });
defAbility('skeleton_king_bone_guard', {
  mods: ['modifier_skeleton_king_bone_guard'], prio: 65, engage: false, fid: 'approx',
  note: 'Wraith King enters the fight with full charges (override with the scenario option stacks: { skeleton_king_bone_guard: n }); skeleton damage = unit damage + the per-level talent_skeleton_damage value (matches the tooltip figure); the talent adds its skeletons to the charges; kills by him and by his skeletons within 1200 give charges',
  ai(ab, u, t) { const m = ab.mods[0]; return t && u.distTo(t) <= 900 && (m ? m.stacks : 0) + ab.v('min_skeleton_spawn') > 0 ? {} : null; },
  cast(ab) {
    const u = ab.owner; const w = u.world; const m = ab.mods[0];
    const n = (m ? m.stacks : 0) + ab.v('min_skeleton_spawn');
    if (m) m.setStacks(0);
    for (let i = 0; i < n; i++) w.after(i * ab.v('spawn_interval'), () => { if (u.alive) wkSkeleton(u, u.x + 70 * Math.cos(i * 2.4), u.y + 70 * Math.sin(i * 2.4), null, true); });
  },
});
debuff('modifier_skeleton_king_mortal_strike_curse', { // Shard: the strike's damage is dealt again as pure damage when the curse ends
  multi: 'independent', purge: 'none', statusResist: false, pierce: true,
  onDestroy(m, expired) {
    const t = m.parent; const u = m.caster;
    if (!(expired || m.data.fire) || !t.alive) return;
    const dealt = mhit(m, t, m.data.dmg, PURE, F_NO_AMP);
    const vs = u.findAbility('skeleton_king_vampiric_spirit');
    if (dealt > 0 && u.alive && vs && vs.level > 0 && !(u.st[ST.BREAK] > 0)) u.heal(dealt * vs.v('vampiric_aura') / 100 * (1 + u.lifestealAmp / 100) * (t.heroLike ? 1 : CREEP_LIFESTEAL), u, vs, true);
  },
});
passive('skeleton_king_mortal_strike', {
  fid: 'full', note: 'armed by an attack that lands with the cooldown over (or a swing after an idle attack interval, assumed), the cooldown starts when the critical attack lands; Shard curse = 75% of the damage that strike dealt, pure, not amplified, delivered before attacks of the same tick',
  // [L] measured in Hero Demo: the strike is armed by an attack that lands while the cooldown is over and is spent by the next
  // attack (cd 5: crits 6.03 s apart, cd 3: 4.10 s apart, the attack landing 3.30 s after the crit did not crit). m.y = armed.
  // Assumed: after an idle gap (ready for a whole attack interval when a swing starts) the swing is armed as well.
  onCreated(m) { m.y = 1; },
  onAttackStart(m) { const ab = m.ability; if (m.y !== 1 && ab.cdReady() && m.parent.world.time - ab.cdEnd >= m.parent.attackInterval) m.y = 1; },
  onAttack(m, rec) { if (rec.target.isBuilding || m.y !== 1 || !m.ability.cdReady()) return; m.y = 0; const c = m.v('crit_mult') / 100; if (c > rec.crit) rec.crit = c; (rec.data ||= {}).wkStrike = true; },
  onAttackLanded(m, rec) {
    if (!rec.data || !rec.data.wkStrike) { if (m.ability.cdReady()) m.y = 1; return; }
    m.ability.startCooldown();
    const t = rec.target; const pct = m.v('curse_damage_pct');
    const cm = pct > 0 && t.alive && rec.dealt > 0 ? t.addModifier('modifier_skeleton_king_mortal_strike_curse', { caster: m.parent, ability: m.ability, duration: m.v('curse_delay'), data: { dmg: rec.dealt * pct / 100 } }) : null;
    if (cm) t.world.after(m.v('curse_delay'), () => { if (!cm.removed && t.alive) { cm.data.fire = true; cm.remove(); } });
  },
});
// Vampiric Spirit: breakable lifesteal + an unbreakable death hook (wraith form). With Scepter the wraith form is an aura for allied heroes.
modifier('modifier_skeleton_king_vampiric_spirit', { hidden: true, stats: { lifesteal: 'vampiric_aura' } });
modifier('modifier_skeleton_king_vampiric_spirit_spent', { hidden: true, purge: 'none' });
buff('modifier_skeleton_king_vampiric_spirit_wraith', { // "untargetable wraith" (7.36 note)
  purge: 'none', state: ['CANNOT_DIE', 'UNTARGETABLE'], stats: { as: 'scepter_attack_speed', msPct: 'scepter_move_speed_pct' },
  onDestroy(m, expired) {
    const u = m.parent;
    if (!expired || !u.alive) return;
    u.addModifier('modifier_skeleton_king_vampiric_spirit_spent', {});
    u.world.kill(u, m.data ? m.data.killer : null, m.data ? m.data.ability : null); // credit goes to the original killer
  },
});
function wkWraith(u, vs, ev) {
  ev.prevent = true; u.hp = 1;
  u.addModifier('modifier_skeleton_king_vampiric_spirit_wraith', { caster: vs.owner, ability: vs, duration: vs.v('duration'), data: { killer: ev.killer, ability: ev.ability } });
}
const wkCanReincarnate = (u) => { const re = u.findAbility('skeleton_king_reincarnation'); return !!re && re.level > 0 && re.cdReady() && (u.world.freeSpells || u.mana + 1e-9 >= re.manaCost()); };
modifier('modifier_skeleton_king_vampiric_spirit_death', {
  hidden: true, breakable: false,
  onDeath(m, ev) { const u = m.parent; if (!ev.prevent && !u.hasModifier('modifier_skeleton_king_vampiric_spirit_spent') && !wkCanReincarnate(u)) wkWraith(u, m.ability, ev); },
});
modifier('modifier_skeleton_king_vampiric_spirit_aura', {
  hidden: true, purge: 'none',
  onDeath(m, ev) { const u = m.parent; if (!ev.prevent && m.caster.alive && !u.hasModifier('modifier_skeleton_king_vampiric_spirit_spent')) wkWraith(u, m.ability, ev); },
});
aura('modifier_skeleton_king_vampiric_spirit_emitter', { radius: (m) => m.v('scepter_aura_radius'), team: 'ally', child: 'modifier_skeleton_king_vampiric_spirit_aura', self: false, filter: (t, m) => m.v('scepter_aura_radius') > 0 && realHero(t), extra: { breakable: false } });
defAbility('skeleton_king_vampiric_spirit', {
  mods: ['modifier_skeleton_king_vampiric_spirit', 'modifier_skeleton_king_vampiric_spirit_death', 'modifier_skeleton_king_vampiric_spirit_emitter'], fid: 'full',
  note: 'the wraith keeps fighting, cannot be targeted and dies when the delay ends (kill credit to the original killer); Scepter aura gives allied heroes the same wraith form but not the lifesteal',
});
debuff('modifier_skeleton_king_reincarnation_slow', { stats: { msPct: 'movespeed', asSlow: 'attackslow' } });
modifier('modifier_skeleton_king_reincarnation_active', { purge: 'none', state: ['OUT', 'INVULN'], onDestroy(m) { const u = m.parent; if (u.alive) { u.recompute(); u.hp = u.maxHp; u.mana = u.maxMana; } } });
// the death and return itself; the caller has already paid the mana and started the cooldown
function wkReincarnate(u, ab) {
  const w = u.world;
  u.hp = 1;
  for (const x of u.mods.slice()) if (x.dieTime !== Infinity && !x.removed) x.remove(); // dying clears temporary effects
  const hb = u.findAbility('skeleton_king_hellfire_blast'); const n = ab.v('shard_skeleton_count');
  for (const e of w.enemiesInRadius(u, u.x, u.y, ab.v('slow_radius'))) {
    e.addModifier('modifier_skeleton_king_reincarnation_slow', { caster: u, ability: ab, duration: ab.v('slow_duration') });
    if (!realHero(e)) continue;
    for (let i = 0; i < n; i++) wkSkeleton(u, e.x + 70 * Math.cos(i * 2.1), e.y + 70 * Math.sin(i * 2.1), e, false);
    if (ab.v('trigger_wraithfire_blast') > 0 && hb && hb.level > 0 && !e.isImmune()) wkBlast(hb, e); // talent
  }
  u.addModifier('modifier_skeleton_king_reincarnation_active', { ability: ab, duration: ab.v('reincarnate_time') });
}
const wkWraithBound = (u) => u.hasModifier('modifier_skeleton_king_vampiric_spirit_wraith') || u.hasModifier('modifier_skeleton_king_vampiric_spirit_spent');
modifier('modifier_skeleton_king_reincarnation', {
  hidden: true,
  onDeath(m, ev) {
    const u = m.parent; const ab = m.ability;
    if (ev.prevent || wkWraithBound(u) || !wkCanReincarnate(u)) return;
    ev.prevent = true; ab.pay(); ab.startCooldown(); wkReincarnate(u, ab);
  },
});
defAbility('skeleton_king_reincarnation', {
  mods: ['modifier_skeleton_king_reincarnation'], manual: true, fid: 'full',
  note: 'Wraith King is out of play for the reincarnation time and loses all timed buffs and debuffs; reincarnation skeletons do not respawn; the self-cast (die and return at once for the same mana and cooldown, refused in wraith form) is only used when the scenario lists the ability, then below 25% health',
  ai: (ab, u, t) => (t && u.hp < 0.25 * u.maxHp && !wkWraithBound(u) ? { target: u } : null),
  cast(ab, t) { const u = ab.owner; if ((t && t !== u) || wkWraithBound(u)) refund(ab); else wkReincarnate(u, ab); }, // [L] Hero Demo: an order on another unit is refused
});

// ================================================================ Chaos Knight
// illusion of `src` under Chaos Knight's control; Scepter: each illusion of Chaos Knight has a chance to come with an extra one
function ckIllusions(u, src, o) {
  const w = u.world; const ph = u.findAbility('chaos_knight_phantasm'); const out = [];
  const make = (dx) => { const il = w.createIllusion(src, { ...o, owner: u, x: o.x + dx, y: o.y }); if (il.ai && o.target) il.ai.target = o.target; out.push(il); };
  make(0);
  if (src === u && !o.noBonus && ph && ph.level > 0 && ph.v('bonus_illusion_chance') > 0 && w.rng.chance(ph.v('bonus_illusion_chance') / 100)) for (let i = 0; i < ph.v('bonus_illusion_count'); i++) make(60 * (i + 1));
  return out;
}
const ckPhantasmSpec = (u) => { const ph = u.findAbility('chaos_knight_phantasm'); return ph ? { outPct: ph.v('outgoing_damage'), inPct: ph.v('incoming_damage'), potency: ph.v('illusion_effectiveness') } : {}; };
defAbility('chaos_knight_chaos_bolt', {
  prio: 60, fid: 'full', note: 'stun and damage come from one roll (inversely related); Shard illusion appears next to the target on impact with Phantasm\'s incoming damage',
  cast(ab, t) {
    const u = ab.owner; const w = u.world;
    w.projectile(u, t, ab.v('chaos_bolt_speed'), (tt) => {
      const k = w.rng.next();
      hit(ab, tt, ab.v('damage_min') + (ab.v('damage_max') - ab.v('damage_min')) * (1 - k), MAGICAL);
      if (tt.alive) stun(ab, tt, ab.v('stun_min') + (ab.v('stun_max') - ab.v('stun_min')) * k);
      const ph = u.findAbility('chaos_knight_phantasm'); // [L] Hero Demo: no illusion while Phantasm is not learned
      if (ab.v('illusion_duration') > 0 && ph && ph.level > 0 && u.alive && tt.alive) ckIllusions(u, u, { duration: ab.v('illusion_duration'), outPct: -ab.v('illusion_damage_reduction_pct'), inPct: ckPhantasmSpec(u).inPct, potency: ab.v('illusion_effectiveness'), x: tt.x + 60, y: tt.y + 60, target: tt });
    });
  },
});
modifier('modifier_chaos_knight_reality_rift_flags', { hidden: true, apply(m) { m.ability.pierces = m.v('pierces_immunity') > 0; } }); // talent: pierces immunity
debuff('modifier_chaos_knight_reality_rift', { stats: { armor: neg('armor_reduction') } });
// [L] measured in Hero Demo (target 500 ahead): pull 450 -> Chaos Knight at 50, target at 112; pull 675 -> 29 and 91
const RIFT_MIN = 29; const RIFT_GAP = 62;
const ckIllusionsOf = (u) => u.world.units.filter((e) => e.alive && e.isIllusion && e.owner === u);
defAbility('chaos_knight_reality_rift', {
  mods: ['modifier_chaos_knight_reality_rift_flags'], prio: 70, fid: 'approx',
  note: 'meeting point = pull_distance from the target towards Chaos Knight, at least RIFT_MIN in front of him; he lands on it, the target RIFT_GAP beyond; his illusions are gathered next to the target and pick it as their target (no attack order is issued: the controller decides)',
  cast(ab, t) {
    const u = ab.owner;
    const dx = t.x - u.x; const dy = t.y - u.y; const d = Math.sqrt(dx * dx + dy * dy) || 1; const ux = dx / d; const uy = dy / d;
    const p = Math.max(d - ab.v('pull_distance'), RIFT_MIN);
    u.x += ux * p; u.y += uy * p; t.x = u.x + ux * RIFT_GAP; t.y = u.y + uy * RIFT_GAP;
    for (const il of ckIllusionsOf(u)) { il.jumpTo(t); if (il.ai) il.ai.target = t; }
    addMod(ab, t, 'modifier_chaos_knight_reality_rift', ab.v('duration'));
  },
});
passive('chaos_knight_chaos_strike', {
  illusion: true, fid: 'full',
  onAttack(m, rec) {
    if (rec.target.isBuilding || !m.roll(m.v('chance'))) return;
    // [L] measured in Hero Demo: the multiplier is a whole percentage (201%, 193%, 177%, 218% on whole damage rolls)
    const c = m.parent.world.rng.int(Math.ceil(m.v('crit_min')), Math.floor(m.v('crit_max'))) / 100;
    if (c > rec.crit) rec.crit = c;
    (rec.data ||= {}).ckLifesteal = m.v('lifesteal');
  },
  onAttackLanded(m, rec) {
    const ls = rec.data ? rec.data.ckLifesteal : 0; const u = m.parent;
    if (ls > 0 && rec.dealt > 0) u.heal(rec.dealt * ls / 100 * (1 + u.lifestealAmp / 100) * (rec.target.heroLike ? 1 : CREEP_LIFESTEAL), u, m.ability, true);
  },
});
defAbility('chaos_knight_phantasm', {
  prio: 85, engage: false, fid: 'full',
  note: 'Scepter: the bonus-illusion roll applies to other illusions made by his abilities (Chaos Bolt Shard), not to the Phantasm images (live: always three) nor Manta / rune illusions; allied heroes get one Phantasm illusion each under his control; his own place among the images is random',
  ai: (ab, u, t) => (t && u.distTo(t) < 1000 ? true : null),
  cast(ab) { const u = ab.owner; u.purge({ debuffs: true }); addMod(ab, u, 'modifier_chaos_knight_phantasm_cast', ab.v('invuln_duration')); },
});
// [L] measured in Hero Demo: for invuln_duration Chaos Knight is stunned, invulnerable and out of play; the images appear when that
// ends and he stands in one of the places (seen at (29, 0) twice and (29, 135) once from the cast position while facing +x; the
// other two places are assumed).
const CK_PLACES = [[29, 0], [29, 135], [29, -135], [-106, 0]];
modifier('modifier_chaos_knight_phantasm_cast', {
  purge: 'none', state: ['STUN', 'INVULN', 'OUT'],
  onDestroy(m, expired) {
    const u = m.parent; const ab = m.ability; const w = u.world;
    if (!expired || !u.alive) return;
    const spec = { duration: ab.v('illusion_duration'), ...ckPhantasmSpec(u) };
    const n = ab.v('images_count'); const ox = u.x; const oy = u.y;
    const own = w.rng.int(0, n); // his own place among the images
    const place = (i) => { const p = CK_PLACES[i % CK_PLACES.length]; const ring = Math.floor(i / CK_PLACES.length) * 70; return [ox + p[0] + ring, oy + p[1] + ring]; };
    const made = [];
    for (let i = 0, k = 0; i < n; i++, k++) { if (k === own) k++; const p = place(k); made.push(...ckIllusions(u, u, { ...spec, noBonus: true, x: p[0], y: p[1] })); } // [L] Hero Demo: no Scepter bonus image (two recordings, always three)
    for (const il of made) il.addModifier('modifier_chaos_knight_phantasm_illusion', { ability: ab });
    const p = place(own); u.x = p[0]; u.y = p[1];
    if (ab.v('bonus_illusion_count') > 0) for (const a of w.units.slice()) if (a.alive && a.team === u.team && a !== u && realHero(a)) ckIllusions(u, a, { ...spec, x: a.x + 60, y: a.y + 60 });
  },
});
modifier('modifier_chaos_knight_phantasm_illusion', { hidden: true, purge: 'none' }); // marks illusions made by the Phantasm cast
// Ahead, Armageddon. Passive: m.x = current bonus speed, m.y / m.z = position at the last think.
modifier('modifier_chaos_knight_armageddon', {
  hidden: true, interval: (m) => m.v('think_interval'), stats: (m) => ({ ms: m.x }),
  onCreated(m) { m.y = m.parent.x; m.z = m.parent.y; },
  onAttack(m) { if (m.x !== 0) { m.x = 0; m.parent.dirty = true; } },
  onThink(m) {
    const u = m.parent; const moved = Math.abs(u.x - m.y) + Math.abs(u.y - m.z) > 1e-6; const old = m.x;
    m.y = u.x; m.z = u.y;
    if (u.hasModifier('modifier_chaos_knight_armageddon_charge')) return;
    m.x = moved ? Math.min(m.v('max_bonus_speed'), m.x + m.v('speed_per_second') * m.interval) : Math.max(0, m.x - m.v('speed_per_second') * m.v('drain_rate_multiplier') * m.interval);
    if (m.x !== old) u.dirty = true;
  },
});
modifier('modifier_chaos_knight_armageddon_charge', { // on Chaos Knight and every charging illusion
  purge: 'none', state: ['DISARM', 'SILENCE', 'MUTE'], interval: C.TICK,
  onThink(m) {
    const u = m.parent; const w = u.world; const d = m.data; const ab = m.ability;
    const dx = d.x - u.x; const dy = d.y - u.y; const dist = Math.sqrt(dx * dx + dy * dy); const step = d.speed * C.TICK;
    if (u.cantAct() || u.isRooted()) { m.remove(); return; } // stunned, hexed, feared or rooted: the charge ends
    if (dist > step) { u.x += dx / dist * step; u.y += dy / dist * step; } else { u.x = d.x; u.y = d.y; }
    for (const e of w.enemiesInRadius(u, u.x, u.y, ab.v('hit_radius') + u.def.hull)) if (!e.isBuilding && !d.hit.has(e) && e.attackableBy(u)) { d.hit.add(e); w.launchAttack(u, e, { instant: true, fromAbility: ab }); }
    if (dist <= step) m.remove();
  },
});
const ckHasPhantasm = (u) => ckIllusionsOf(u).some((il) => il.hasModifier('modifier_chaos_knight_phantasm_illusion'));
defAbility('chaos_knight_armageddon', {
  mods: ['modifier_chaos_knight_armageddon'], prio: 72, channel: (ab) => (ab.data ? ab.v('max_charge_time') : 0), fid: 'approx',
  note: 'passive speed build-up is exact to its think interval; active (refused unless an illusion made by the Phantasm cast is alive): always a full wind-up (max charge speed, no acceleration phases), then Chaos Knight and his illusions within illusion_radius run in a straight line to the cast point and attack every enemy they pass once; AI: cast at the target when it is out of reach',
  ai(ab, u, t) {
    if (!t || u.isRooted() || u.rangeTo(t) <= u.attackRange + 250) return null;
    return ckHasPhantasm(u) ? { x: t.x, y: t.y } : null;
  },
  cast(ab, t, x, y) { if (ckHasPhantasm(ab.owner)) ab.data = { x, y }; else { ab.data = null; refund(ab); } },
  channelEnd(ab, interrupted) {
    const u = ab.owner; const d = ab.data; const p = u.findModifier('modifier_chaos_knight_armageddon');
    if (interrupted || !d || !u.alive || u.isRooted()) return;
    if (u.dirty) u.recompute();
    const speed = ab.v('charge_speed_multiplier') * (u.ms - (p ? p.x : 0) + ab.v('max_bonus_speed'));
    const pack = [u, ...ckIllusionsOf(u).filter((il) => u.distTo(il) <= ab.v('illusion_radius'))];
    pack.forEach((c, i) => {
      if (c !== u) { const k = Math.ceil(i / 2) * (i % 2 ? 1 : -1); c.x = u.x; c.y = u.y + k * ab.v('formation_spacing'); } // illusions are gathered into a line abreast
      c.addModifier('modifier_chaos_knight_armageddon_charge', { caster: u, ability: ab, data: { x: d.x + (c.x - u.x), y: d.y + (c.y - u.y), speed, hit: new Set() } });
    });
  },
});
na('chaos_knight_armageddons_flank_end', 'sub-ability that stops the Ahead, Armageddon charge early; the AI always finishes the charge');
