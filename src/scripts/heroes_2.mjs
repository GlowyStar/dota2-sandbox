// Hero abilities, part 2: Sniper, Drow Ranger, Luna, Medusa, Slark, Troll Warlord, Lifestealer, Faceless Void.
// Every number is read from the shipped data by value name; behaviour follows the 7.42 tooltips (ability text, value labels,
// modifier texts and, where those are silent, the shipped patch notes). `fid` = fidelity: full | approx | partial | n/a.
import { defAbility, modifier, buff, debuff, passive, hit, addMod, stun, enemiesNear, alliesNear, mhit,
  aura, zone, knockback, lineFromCaster, lowHpAI, nearAI, ST, C, PHYSICAL, MAGICAL,
  F_NON_LETHAL, F_NO_AMP } from '../engine/dsl.mjs';

const ROSHAN = 'npc_dota_roshan';
const ORDER_ATTACK = 1; // the engine's ORDER.ATTACK (u.order): the unit is carrying out an attack order on u.orderTarget
const realHero = (e) => e.isHero && !e.isIllusion;
// may a unit-target spell without immunity piercing be thrown at t?
const canHit = (ab, t) => !!t && t.alive && (ab.pierces || !t.isImmune());
// is the unit's controller allowed to use this ability on its own? (for effects that fire outside the order pipeline)
const aiMayCast = (u, ab) => { const ai = u.ai; return !!ai && ai.mode === 'fight' && ab.ai !== false && (ai.abilities === 'all' || (Array.isArray(ai.abilities) && ai.abilities.includes(ab.name)) || (Array.isArray(ai.order) && ai.order.includes(ab.name))); };
// cast outside the order pipeline (abilities that may be used while disabled): pays, starts the cooldown, logs and runs the script
function castNow(ab) { const u = ab.owner; const w = u.world; ab.pay(); ab.startCooldown(); ab.casts++; u.mCasts++; if (w.log) w.logEvent('cast', u, null, ab.name, 0); ab.script.cast(ab, null, u.x, u.y); }
const disabled = (u) => { const st = u.st; return st[ST.OUT] === 0 && (st[ST.STUN] > 0 || st[ST.SLEEP] > 0 || st[ST.HEX] > 0 || st[ST.FEAR] > 0 || st[ST.TAUNT] > 0); };
// an order the ability cannot carry out (invalid target): gives back the mana and cooldown the cast pipeline has already charged
function refund(ab) { const u = ab.owner; if (u.world.freeSpells) return; ab.cdEnd = 0; u.mana += ab.manaCost(); }
const angleDiff = (a, b) => { let d = a - b; while (d > Math.PI) d -= 2 * Math.PI; while (d < -Math.PI) d += 2 * Math.PI; return d; };
// is `e` inside the cone that opens `half` radians to each side of `dir` from (ox, oy)? `rad` widens it by a projectile radius
const inCone = (e, ox, oy, dir, half, rad) => { const d = Math.sqrt((e.x - ox) ** 2 + (e.y - oy) ** 2); return d < 1e-6 || Math.abs(angleDiff(Math.atan2(e.y - oy, e.x - ox), dir)) <= half + Math.asin(Math.min(1, (rad + e.def.hull) / d)); };
// The engine drops a think that falls exactly on a modifier's expiry, so a periodic damage debuff delivers that last tick from onDestroy.
const tickDot = (name, def, tick) => debuff(name, {
  ...def,
  onCreated(m) { m.z = m.parent.world.time; },
  onThink(m) { m.z = m.parent.world.time; tick(m); },
  onDestroy(m, expired) { if (expired && m.parent.alive && m.parent.world.time - m.z >= m.interval - 1e-6) tick(m); },
});
// Stacks that expire independently inside one modifier: m.data.q = expiry times, m.stacks = live stacks (spread `timedStacks` into the definition).
const timedStacks = {
  interval: 0.1,
  onThink(m) { const q = m.data ? m.data.q : null; if (!q) return; const now = m.parent.world.time; let k = 0; for (let i = 0; i < q.length; i++) if (q[i] > now + 1e-9) q[k++] = q[i]; if (k !== q.length) { q.length = k; m.setStacks(k); } },
};
function addTimedStacks(t, name, opts, n = 1, max = Infinity) {
  const m = t.addModifier(name, opts);
  if (!m) return null;
  const q = (m.data ||= { q: [] }).q; const exp = m.dieTime;
  for (let i = 0; i < n; i++) q.push(exp);
  if (q.length > max) q.splice(0, q.length - max);
  let last = exp; for (let i = 0; i < q.length; i++) if (q[i] > last) last = q[i];
  m.dieTime = last; m.setStacks(q.length);
  return m;
}
// some abilities ship their mana cost under a misspelled key ("AbilityManacost") that the engine does not read
const manaCostAlias = (name) => modifier(name, { hidden: true, apply(m) { const v = m.ability.vals; if (v.AbilityManacost !== undefined) v.AbilityManaCost = v.AbilityManacost; } });

// ================================================================ Sniper
debuff('modifier_sniper_shrapnel_slow', { stats: { msPct: 'slow_movement_speed' } });
defAbility('sniper_shrapnel', {
  prio: 30, fid: 'full', note: '11 damage instances one second apart, the first after damage_delay (tooltip note); AI: never puts a second shrapnel of his own on a target that is already inside one',
  ai(ab, u, t, w) {
    if (!t || t.isBuilding) return null;
    const r = ab.v('radius');
    if (ab.data) for (const z of ab.data) if (z.end > w.time && (t.x - z.x) ** 2 + (t.y - z.y) ** 2 <= r * r) return null;
    return { x: t.x, y: t.y };
  },
  cast(ab, t, x, y) {
    const w = ab.owner.world; const dur = ab.v('duration');
    const end = w.time + ab.v('damage_delay') + dur;
    (ab.data ||= []).push({ x, y, end });
    if (ab.data.length > 8) ab.data.shift();
    // [L] the slow does not outlast the storm: it ends with it (10.13 s after the first tick in the game)
    zone(ab, x, y, { radius: 'radius', duration: dur + 1, interval: 1, delay: 'damage_delay', tick: (e) => { if (e.isBuilding) return; hit(ab, e, ab.v('shrapnel_damage'), MAGICAL); addMod(ab, e, 'modifier_sniper_shrapnel_slow', Math.min(ab.v('slow_duration'), end + 0.13 - w.time)); } });
  },
});
debuff('modifier_sniper_headshot_slow', { stats: { msPct: 'slow', asSlow: 'slow' } });
passive('sniper_headshot', {
  fid: 'approx', note: 'knockback grows linearly from 0 at Sniper\'s attack reach to the maximum at point-blank (the tooltip only says "based on how close")',
  onAttack(m, rec) {
    const u = m.parent;
    if (rec.target.isBuilding) return;
    const ta = u.hasModifier('modifier_sniper_take_aim_active') ? u.findAbility('sniper_take_aim') : null;
    if (!m.roll(Math.max(m.v('proc_chance'), ta ? ta.v('headshot_chance') : 0))) return;
    rec.add += m.v('damage'); (rec.data ||= {}).headshot = true;
  },
  onAttackLanded(m, rec) {
    const t = rec.target; const u = m.parent;
    if (!rec.data || !rec.data.headshot || !t.alive || t.isImmune()) return;
    t.addModifier('modifier_sniper_headshot_slow', { caster: u, ability: m.ability, duration: m.v('slow_duration') });
    const k = 1 - u.distTo(t) / (u.attackRange + u.def.hull + t.def.hull);
    if (k > 0) knockback(t, u.x, u.y, m.v('knockback_distance') * k);
  },
});
modifier('modifier_sniper_take_aim', { hidden: true, stats: { attackRange: 'passive_attack_range_bonus' } });
buff('modifier_sniper_take_aim_active', { stats: (m) => ({ attackRange: m.v('active_attack_range_bonus'), msPct: -m.v('slow'), as: m.v('attack_speed') }) });
defAbility('sniper_take_aim', {
  mods: ['modifier_sniper_take_aim'], prio: 45, fid: 'full', note: 'the vision bonus and view cone have no effect in the sandbox',
  ai: (ab, u, t) => (t && !t.isBuilding && !u.hasModifier('modifier_sniper_take_aim_active') && u.rangeTo(t) <= u.attackRange + ab.v('active_attack_range_bonus') ? {} : null),
  cast(ab) { addMod(ab, ab.owner, 'modifier_sniper_take_aim_active', ab.v('duration')); },
});
debuff('modifier_sniper_concussive_grenade_slow', { state: ['DISARM'], stats: (m) => ({ msPct: -m.v('slow') }) });
debuff('modifier_sniper_concussive_grenade_knockback', { state: ['STUN'], purge: 'none' }); // [L] the knockback counts as a stun while it lasts
const GRENADE_FLIGHT = 4 * C.TICK; // [L] measured in Hero Demo: the grenade lands 0.133 s after the throw (500 units away; no speed in the data)
defAbility('sniper_concussive_grenade', {
  prio: 55, fid: 'approx',
  note: 'the grenade lands 0.133 s after the throw (measured at 500 units; whether the flight time grows with distance is not measured); on impact enemies in the radius take the damage, are slowed and disarmed for debuff_duration at once and are knocked back (stunned for knockback_duration; a unit standing on the impact point is not moved); Sniper himself is pushed away from the point when he throws; AI: thrown between Sniper and a close target, otherwise just short of the target',
  ai(ab, u, t) {
    if (!t || t.isBuilding) return null;
    const d = u.distTo(t) || 1; const r = ab.v('radius');
    if (d > ab.castRange() + r / 2) return null;
    const k = d <= r ? 0.5 : Math.min(0.5, r / 5 / d);
    return { x: t.x + (u.x - t.x) * k, y: t.y + (u.y - t.y) * k };
  },
  cast(ab, t, x, y) {
    const u = ab.owner; const w = u.world; const r = ab.v('radius'); const push = ab.v('knockback_distance');
    if (ab.v('self_push') > 0) knockback(u, x, y, push); // Sniper is always thrown back from the impact point (not while rooted)
    if (w.skillshotHit < 1 && !w.rng.chance(w.skillshotHit)) return;
    w.after(GRENADE_FLIGHT, () => {
      for (const e of enemiesNear(ab, x, y, r)) {
        if (e.isBuilding) continue;
        hit(ab, e, ab.v('damage'), MAGICAL);
        if (!e.alive || e.isImmune()) continue;
        addMod(ab, e, 'modifier_sniper_concussive_grenade_slow', ab.v('debuff_duration'));
        addMod(ab, e, 'modifier_sniper_concussive_grenade_knockback', ab.v('knockback_duration'));
        if ((e.x - x) ** 2 + (e.y - y) ** 2 > 1) knockback(e, x, y, push);
      }
    });
  },
});
passive('sniper_keen_scope', {
  fid: 'full', note: 'percentage of the attack damage (Headshot\'s flat bonus excluded) per full bonus_damage_distance units, measured when the attack is launched',
  onAttack(m, rec) { const t = rec.target; if (!t.isBuilding && t.team !== m.parent.team) rec.mult *= 1 + m.v('bonus_damage_for_range') / 100 * Math.floor(m.parent.distTo(t) / m.v('bonus_damage_distance')); },
});
modifier('modifier_sniper_assassinate', {
  hidden: true,
  apply(m) { const cp = m.v('scepter_cast_point'); if (cp > 0) m.ability.vals.AbilityCastPoint = cp; }, // Scepter: shorter aim
  onKill(m, ev) { const v = ev.victim; if (realHero(v) && v.team !== m.parent.team) m.ability.cdEnd = 0; }, // any hero kill refreshes it
});
defAbility('sniper_assassinate', {
  mods: ['modifier_sniper_assassinate'], prio: 35, fid: 'full',
  note: 'the mini-stun has no duration value and is a one-tick stun (Scepter: scepter_stun_duration); the shot\'s attack cannot miss (assumed); cooldown_reduction_on_kill is ignored because the tooltip says a hero kill refreshes the ability; AI: used on targets out of attack range or below 35% health (with Scepter whenever ready)',
  ai: (ab, u, t) => (canHit(ab, t) && !t.isBuilding && (ab.v('scepter_cast_point') > 0 || u.rangeTo(t) > u.attackRange + 100 || t.hp < 0.35 * t.maxHp) ? { target: t } : null),
  cast(ab, t) {
    const u = ab.owner; const w = u.world;
    w.projectile(u, t, ab.v('projectile_speed'), (tt) => {
      hit(ab, tt, ab.v('damage'), MAGICAL);
      if (tt.alive) w.launchAttack(u, tt, { instant: true, fromAbility: ab, trueStrike: true, potency: u.itemPotency + ab.v('bonus_potency') });
      if (tt.alive) stun(ab, tt, ab.v('scepter_stun_duration') > 0 ? ab.v('scepter_stun_duration') : C.TICK);
    });
  },
});

// ================================================================ Drow Ranger
debuff('modifier_drow_ranger_frost_arrows_debuff', { stats: { msPct: 'frost_arrows_movement_speed' } });
debuff('modifier_drow_ranger_frost_arrows_burst_slow', { stats: (m) => ({ msPct: -m.v('shard_burst_move_slow_pct') }) });
debuff('modifier_drow_ranger_frost_arrows_hypothermia', { // Scepter
  ...timedStacks, stats: (m) => ({ restore: -Math.min(100, m.v('shard_regen_reduction_pct_per_stack') * m.stacks) }),
  onDestroy(m) { // a unit that dies with stacks bursts
    const t = m.parent; const u = m.caster; const n = m.stacks;
    if (t.alive || n <= 0) return;
    for (const e of u.world.enemiesInRadius(u, t.x, t.y, m.v('shard_burst_radius'))) {
      if (e === t || e.isBuilding) continue;
      mhit(m, e, m.v('shard_burst_damage_per_stack') * n, MAGICAL);
      if (e.alive) e.addModifier('modifier_drow_ranger_frost_arrows_burst_slow', { caster: u, ability: m.ability, duration: m.v('shard_burst_slow_duration') });
    }
  },
});
const drowFrostDamage = (fa, t) => { const h = t.findModifier('modifier_drow_ranger_frost_arrows_hypothermia'); return fa.v('damage') + (h ? h.stacks * fa.v('shard_bonus_damage_per_stack') : 0); };
function drowFrost(u, fa, t) {
  if (!t.alive || t.isImmune()) return;
  t.addModifier('modifier_drow_ranger_frost_arrows_debuff', { caster: u, ability: fa, duration: fa.v('AbilityDuration') });
  if (fa.v('shard_max_stacks') > 0) addTimedStacks(t, 'modifier_drow_ranger_frost_arrows_hypothermia', { caster: u, ability: fa, duration: fa.v('shard_stack_duration') }, 1, fa.v('shard_max_stacks'));
}
passive('drow_ranger_frost_arrows', {
  fid: 'full', note: 'autocast assumed on (every arrow spends mana); Scepter: an arrow uses the Hypothermia stacks that are on the target before it lands',
  onAttack(m, rec) {
    const u = m.parent; const t = rec.target; const w = u.world;
    if (t.isBuilding || t.team === u.team || t.isImmune() || u.isSilenced()) return;
    if (!w.freeSpells) { const cost = m.ability.manaCost(); if (u.mana < cost) return; u.mana -= cost; }
    rec.add += drowFrostDamage(m.ability, t); (rec.data ||= {}).frost = true;
  },
  onAttackLanded(m, rec) { if (rec.data && rec.data.frost) drowFrost(m.parent, m.ability, rec.target); },
});
buff('modifier_drow_ranger_wave_of_silence_buff', { stats: { msPct: 'bonus_movespeed' } });
defAbility('drow_ranger_wave_of_silence', {
  prio: 70, fid: 'approx',
  note: 'the knockback is an instant push, linear from the maximum next to Drow to 0 at the end of the wave; wave_width is used as the wave\'s radius; the talent speed bonus lasts as long as the silence (7.31 note); revealing invisible units has no effect here',
  ai: (ab, u, t) => (t && !t.isBuilding && !t.isImmune() && u.distTo(t) <= ab.v('wave_length') - 50 ? { x: t.x, y: t.y } : null),
  cast(ab, t, x, y) {
    const u = ab.owner; const w = u.world; const len = ab.v('wave_length'); const ox = u.x; const oy = u.y;
    if (ab.v('bonus_movespeed') > 0) addMod(ab, u, 'modifier_drow_ranger_wave_of_silence_buff', ab.v('silence_duration'));
    if (w.skillshotHit < 1 && !w.rng.chance(w.skillshotHit)) return;
    for (const e of lineFromCaster(ab, x, y, len, 2 * (ab.v('wave_width')))) {
      if (e.isBuilding) continue;
      const d = Math.sqrt((e.x - ox) ** 2 + (e.y - oy) ** 2);
      w.after(d / ab.v('wave_speed'), () => {
        if (!e.alive || e.isImmune()) return;
        addMod(ab, e, 'modifier_silenced', ab.v('silence_duration'));
        knockback(e, ox, oy, ab.v('knockback_distance_max') * Math.max(0, 1 - d / len));
      });
    }
  },
});
// [L] while Multishot runs Drow is disarmed and slowed by multishot_movespeed %; it ends right after the last wave
const drowMultishotTime = (ab) => (ab.v('wave_count') - 1) * ab.v('AbilityChannelTime') / ab.v('wave_count') + 0.1;
buff('modifier_drow_ranger_multishot', {
  purge: 'none', interval: (m) => m.v('AbilityChannelTime') / m.v('wave_count'), thinkNow: true,
  state: ['DISARM'], stats: (m) => ({ msPct: -m.v('multishot_movespeed') }),
  onThink(m) {
    const u = m.parent; const w = u.world; const fa = u.findAbility('drow_ranger_frost_arrows'); const frost = fa && fa.level > 0;
    if (u.dirty) u.recompute();
    const reach = u.attackRange * m.v('arrow_range_multiplier') + m.v('arrow_range_base'); const half = m.v('arrow_angle') / 2 * Math.PI / 180;
    const cands = [];
    for (const e of w.inRadius(u.x, u.y, reach, u.team, true)) if (!e.isBuilding && e.attackableBy(u) && inCone(e, u.x, u.y, m.data.dir, half, m.v('arrow_width'))) cands.push([u.distTo(e), e]);
    cands.sort((a, b) => a[0] - b[0]);
    const n = Math.min(cands.length, m.v('arrow_count_per_wave'));
    for (let i = 0; i < n; i++) {
      const e = cands[i][1];
      w.after(cands[i][0] / m.v('arrow_speed'), () => {
        if (!e.alive) return;
        const cold = frost && !e.isImmune();
        const r = w.launchAttack(u, e, { instant: true, secondary: true, flat: -u.dmgBonus, mult: m.v('arrow_damage_pct') / 100, add: cold ? drowFrostDamage(fa, e) : 0, fromAbility: m.ability });
        if (cold && !r.missed) drowFrost(u, fa, e);
      });
    }
  },
});
defAbility('drow_ranger_multishot', {
  prio: 50, channel: drowMultishotTime, fid: 'approx',
  note: 'waves AbilityChannelTime / wave_count apart, the first at once; every wave sends one arrow at each of the closest arrow_count_per_wave enemies inside the cone; an arrow deals arrow_damage_pct of Drow\'s base (white) attack damage plus Frost Arrows as an attack without other on-hit effects (the game uses the average base damage, the simulator a rolled one); she is disarmed and slowed by multishot_movespeed % while it runs and it ends right after the last wave (measured); she stands still in the simulator (the game allows slow movement); AI: used on two or more enemies, or on one when the arrows out-damage her attacks',
  ai(ab, u, t, w) {
    if (!t || t.isBuilding) return null;
    const reach = u.attackRange * ab.v('arrow_range_multiplier') + ab.v('arrow_range_base');
    if (u.distTo(t) > reach - 100) return null;
    const dir = Math.atan2(t.y - u.y, t.x - u.x); const half = ab.v('arrow_angle') / 2 * Math.PI / 180; let n = 0;
    for (const e of w.inRadius(u.x, u.y, reach, u.team, true)) if (!e.isBuilding && e.attackableBy(u) && inCone(e, u.x, u.y, dir, half, ab.v('arrow_width'))) n++;
    const white = (u.dmgMin + u.dmgMax) / 2; const time = ab.v('AbilityChannelTime');
    return n >= 2 || ab.v('wave_count') * white * ab.v('arrow_damage_pct') / 100 > (white + u.dmgBonus) * time / u.attackInterval ? { x: t.x, y: t.y } : null;
  },
  cast(ab, t, x, y) { const u = ab.owner; addMod(ab, u, 'modifier_drow_ranger_multishot', drowMultishotTime(ab) - 0.01, { data: { dir: Math.atan2(y - u.y, x - u.x) } }); },
  channelEnd(ab, interrupted) { if (interrupted) ab.owner.removeModifierByName('modifier_drow_ranger_multishot'); },
});
// Glacier: the hill is a disc of ramp_radius around the cast point (m.x, m.y)
buff('modifier_drow_ranger_glacier_range', { purge: 'none', stats: { attackRange: 'attack_range_bonus' } });
buff('modifier_drow_ranger_glacier_damage', { purge: 'none', stats: { dmgOutPct: 'damage_bonus' } });
modifier('modifier_drow_ranger_glacier', {
  purge: 'none', interval: 0.25, thinkNow: true,
  onThink(m) {
    const u = m.parent;
    for (const a of u.world.inRadius(m.x, m.y, m.v('ramp_radius'), u.team, false)) {
      if (a.melee || a.isBuilding) continue;
      a.addModifier('modifier_drow_ranger_glacier_range', { caster: u, ability: m.ability, duration: 2 * m.interval });
      if (a === u) a.addModifier('modifier_drow_ranger_glacier_damage', { caster: u, ability: m.ability, duration: 2 * m.interval });
    }
  },
});
defAbility('drow_ranger_glacier', {
  prio: 58, fid: 'approx',
  note: 'the hill is a disc of ramp_radius around the cast point (also used as the knockback radius, which the tooltip does not give); ranged allies on it get the attack range, Drow on it also the damage bonus against every target; blocked paths, vision and height are not modelled',
  ai: (ab, u, t) => (t && !u.hasModifier('modifier_drow_ranger_glacier') && u.rangeTo(t) <= u.attackRange + ab.v('attack_range_bonus') ? {} : null),
  cast(ab) {
    const u = ab.owner;
    for (const e of enemiesNear(ab, u.x, u.y, ab.v('ramp_radius'))) if (!e.isBuilding && !e.isImmune()) knockback(e, u.x, u.y, ab.v('knockback_distance'));
    const m = addMod(ab, u, 'modifier_drow_ranger_glacier', ab.v('shard_duration'));
    if (m) { m.x = u.x; m.y = u.y; }
  },
});
// Precision Aura: agility added after the attribute pass (the engine derives armor, attack speed and damage from the final agility)
function lateAgi(s, u, n) { u.agi += n; }
modifier('modifier_drow_ranger_trueshot_ally', {
  hidden: true, purge: 'none',
  late(m, s, u) { const src = m.caster.findModifier('modifier_drow_ranger_trueshot'); if (src && m.caster.alive) lateAgi(s, u, src.x * m.v('trueshot_agi_bonus_allies_pct') / 100); },
});
passive('drow_ranger_trueshot', {
  illusion: true, fid: 'full', note: 'percentage of her final agility from all other sources; allied ranged heroes are refreshed every 0.5 s',
  interval: 0.5, thinkNow: true,
  late(m, s, u) { m.x = u.agi * m.v('trueshot_agi_bonus') / 100; lateAgi(s, u, m.x); }, // m.x = current bonus agility
  onThink(m) {
    const u = m.parent;
    if (u.isIllusion) return;
    for (const a of u.world.alliesInRadius(u, u.x, u.y, m.v('radius'))) if (a !== u && a.isHero && !a.melee) { a.addModifier('modifier_drow_ranger_trueshot_ally', { caster: u, ability: m.ability, duration: 1 }); a.dirty = true; }
  },
});
passive('drow_ranger_marksmanship', {
  fid: 'full', note: 'the proc damage is part of the attack (it can crit, 7.22d note); base armor = the target\'s own armor plus its agility armor; only real enemy heroes inside disable_range switch it off',
  onAttack(m, rec) {
    const u = m.parent; const t = rec.target;
    if (t.isBuilding) return;
    for (const e of u.world.units) if (e.alive && e.team !== u.team && realHero(e) && u.distTo(e) <= m.v('disable_range')) return;
    if (!m.roll(m.v('chance'))) return;
    rec.flat += m.v('bonus_damage'); rec.trueStrike = true; // part of the attack: it can crit (7.22d note)
    rec.pierceArmor = (t.ovr && t.ovr.armor !== undefined ? t.ovr.armor : t.def.armor) + C.ARMOR_PER_AGI * t.agi; // base armor = unit armor + agility armor
  },
});

// ================================================================ Luna
function lunaBeam(ab, t) { if (!t.alive) return; stun(ab, t, ab.v('stun_duration')); hit(ab, t, ab.v('beam_damage'), MAGICAL); }
defAbility('luna_lucent_beam', {
  prio: 60, fid: 'full', note: 'talent: the extra beams are full beams (damage and stun) on the closest other enemies around the target',
  cast(ab, t) {
    const u = ab.owner; const n = ab.v('lucent_beam_additional_targets');
    lunaBeam(ab, t);
    if (n <= 0) return;
    const near = u.world.enemiesInRadius(u, t.x, t.y, ab.v('lucent_beam_bounce_range')).filter((e) => e !== t && !e.isBuilding && !e.isImmune() && e.st[ST.INVULN] === 0).sort((a, b) => a.distTo(t) - b.distTo(t));
    for (let i = 0; i < n && i < near.length; i++) lunaBeam(ab, near[i]);
  },
});
buff('modifier_luna_lunar_orbit', {
  purge: 'none',
  stats: (m) => ({ dmgTaken: -m.v('rotating_glaives_damage_reduction'), msPct: m.v('bonus_movement_speed') }),
  // a glaive hits a unit once per revolution (7.34 note): time between two glaives passing the same spot = 360 degrees / (rotation * glaives).
  // [L] measured in Hero Demo: the glaives turn at 0.75 x rotating_glaives_speed degrees per second (0.75 s between hits with 4 glaives at
  // speed 160, 0.4 s with 5 at 240); the first contact comes as the glaives spread out at the cast
  interval: (m) => 360 / (0.75 * m.v('rotating_glaives_speed') * m.v('rotating_glaives')), thinkNow: true,
  onThink(m) {
    const u = m.parent; const w = u.world;
    const dmg = ((u.dmgMin + u.dmgMax) / 2 + u.dmgBonus) * m.v('rotating_glaives_collision_damage') / 100;
    for (const e of w.inRadius(u.x, u.y, m.v('rotating_glaives_movement_radius') + m.v('rotating_glaives_hit_radius'), u.team, true)) if (!e.isBuilding) w.damage(u, e, dmg, PHYSICAL, F_NO_AMP, m.ability);
  },
});
defAbility('luna_lunar_orbit', {
  prio: 40, fid: 'approx',
  note: 'glaive collisions are one hit on every enemy within orbit radius + collision radius each time a glaive would pass (once per glaive per revolution, rotation measured as 0.75 x the speed value in degrees per second), the first one at the cast (in the game the opening contacts come 0.3-0.5 s later while the glaives spread out; the number of hits matches); a hit deals the collision percentage of Luna\'s average attack damage (the game uses the rolled damage of each hit) as physical damage without spell amplification',
  ai: (ab, u, t) => (t && !t.isBuilding && u.distTo(t) <= ab.v('rotating_glaives_movement_radius') + ab.v('rotating_glaives_hit_radius') ? {} : null),
  cast(ab) { addMod(ab, ab.owner, 'modifier_luna_lunar_orbit', ab.v('rotating_glaives_duration')); },
});
// Moon Glaives: every bounce is a full attack launched from Luna when the previous hit lands (reduced damage and item potency, no crit, no lifesteal)
function lunaBounce(m, rec, k, pot) {
  const u = m.parent; const w = u.world; const prev = rec.target;
  if (k > m.v('bounces') || !u.alive) return;
  let best = null; let bd = (m.v('range')) ** 2;
  for (const e of w.units) {
    if (!e.alive || e.team === u.team || e === prev || e.isBuilding || !e.attackableBy(u)) continue;
    const d = (e.x - prev.x) ** 2 + (e.y - prev.y) ** 2;
    if (d <= bd) { bd = d; best = e; }
  }
  if (!best) return;
  const r = w.launchAttack(u, best, { fromAbility: m.ability, mult: Math.pow(1 - m.v('damage_reduction_percent') / 100, k), potency: pot * Math.pow(1 - m.v('effectiveness_reduction_percent') / 100, k) });
  r.crit = 1; r.noLifesteal = true; (r.data ||= {}).glaive = { k, pot };
}
passive('luna_moon_glaive', {
  fid: 'approx', note: 'a bounce goes to the closest enemy within range of the unit just hit, excluding only that unit (so two enemies trade bounces); the bounce flies from Luna, not from the previous target',
  onAttackLanded(m, rec) { const g = rec.data ? rec.data.glaive : null; if (g) lunaBounce(m, rec, g.k + 1, g.pot); else if (!rec.fromAbility) lunaBounce(m, rec, 1, rec.potency); },
  onAttackMiss(m, rec) { const g = rec.data ? rec.data.glaive : null; if (g) lunaBounce(m, rec, g.k + 1, g.pot); },
});
modifier('modifier_luna_lunar_blessing_aura', { purge: 'none', stats: { dmg: 'bonus_damage' } });
aura('modifier_luna_lunar_blessing', { radius: (m) => (m.parent.world.isDay ? m.v('radius') : Infinity), team: 'ally', child: 'modifier_luna_lunar_blessing_aura', self: false, filter: (t) => t.isHero, extra: { stats: (m) => ({ dmg: m.v('self_bonus_damage') }) } });
defAbility('luna_lunar_blessing', { mods: ['modifier_luna_lunar_blessing'], fid: 'full', note: 'global at night (world.isDay false); night vision has no effect in the sandbox' });
buff('modifier_luna_eclipse', {
  purge: 'none', interval: (m) => m.v('beam_interval'), thinkNow: true,
  onCreated(m) { m.data.hits = new Map(); m.data.left = m.v('beams'); },
  onThink(m) {
    const u = m.parent; const w = u.world; const d = m.data; const lb = u.findAbility('luna_lucent_beam');
    if (d.left-- <= 0 || !lb || lb.level < 1) { m.remove(); return; }
    const f = d.follow; const cx = f ? f.x : d.x; const cy = f ? f.y : d.y; const cap = m.v('hit_count'); // f = the unit the eclipse follows (null: fixed area)
    const es = w.enemiesInRadius(u, cx, cy, m.v('radius')).filter((e) => !e.isBuilding && e.st[ST.INVULN] === 0 && (e.st[ST.INVIS] === 0 || w.detectAll) && (d.hits.get(e) || 0) < cap);
    if (!es.length) return;
    const t = es[w.rng.int(0, es.length - 1)];
    d.hits.set(t, (d.hits.get(t) || 0) + 1);
    w.damage(u, t, lb.v('beam_damage'), MAGICAL, 0, m.ability);
  },
});
defAbility('luna_eclipse', {
  prio: 80, fid: 'full',
  note: 'one beam every beam_interval until the total beam count is used (the shipped AbilityDuration is shorter than beams x interval without Scepter); turns the world to night for night_duration; Scepter: follows the allied unit it is cast on, or stays on the area it is cast on; AI: centred on Luna and following her, with Scepter dropped on the target\'s area when it is out of reach',
  ai(ab, u, t) {
    const lb = u.findAbility('luna_lucent_beam');
    if (!t || t.isBuilding || !lb || lb.level < 1) return null;
    if (u.distTo(t) <= ab.v('radius') - 100) return { x: u.x, y: u.y };
    return ab.castRange() > 0 && u.distTo(t) <= ab.castRange() ? { x: t.x, y: t.y } : null;
  },
  cast(ab, t, x, y) {
    const u = ab.owner; const w = u.world;
    // without Scepter (no cast range) the eclipse is always centred on Luna; with it: on the allied unit it was cast on, on Luna, or on a fixed area
    const follow = !(ab.castRange() > 0) || (!t && (x - u.x) ** 2 + (y - u.y) ** 2 < 1) ? u : t && t.team === u.team ? t : null;
    addMod(ab, u, 'modifier_luna_eclipse', ab.v('beams') * ab.v('beam_interval') + 0.1, { data: { x, y, follow } });
    const d = (ab.data ||= { wasDay: true, until: 0 });
    if (w.time >= d.until) d.wasDay = w.isDay;
    d.until = w.time + ab.v('night_duration'); w.isDay = false;
    w.after(ab.v('night_duration'), () => { if (w.time + 1e-6 >= d.until) w.isDay = d.wasDay; });
  },
});

// ================================================================ Medusa
// Split Shot is a toggle ([L] it takes effect the moment it is ordered): while on, all of Medusa's attack damage is reduced by
// damage_modifier (the primary arrow included, also against a lone target) and extra arrows go to the closest other enemies
const medusaSplitTargets = (m, u, target) => {
  const reach = u.attackRange + m.v('split_shot_bonus_range') + u.def.hull; const cands = [];
  for (const e of u.world.units) { if (!e.alive || e.team === u.team || e === target || e.isBuilding || !e.attackableBy(u)) continue; const d = u.distTo(e); if (d <= reach + e.def.hull) cands.push([d, e]); }
  return cands.sort((a, b) => a[0] - b[0]); // "secondary targets will be the closest enemy units"
};
modifier('modifier_medusa_split_shot', {
  hidden: true,
  apply(m, s) { m.ability.vals.AbilityCastPoint = 0; if (m.ability.toggled) s.dmgOutPct += m.v('damage_modifier'); },
  onAttack(m, rec) {
    if (!m.ability.toggled || rec.secondary || rec.fromAbility === m.ability || rec.target.isBuilding) return;
    const u = m.parent; const cands = medusaSplitTargets(m, u, rec.target);
    const procs = m.v('process_procs') > 0; const n = Math.min(cands.length, m.v('arrow_count'));
    for (let i = 0; i < n; i++) u.world.launchAttack(u, cands[i][1], { secondary: !procs, fromAbility: m.ability });
  },
});
defAbility('medusa_split_shot', {
  mods: ['modifier_medusa_split_shot'], illusion: true, prio: 97, engage: false, fid: 'full',
  note: 'toggle: while on every attack (the primary arrow included) deals damage_modifier less damage and extra arrows go to the closest other enemies in reach; AI: on while another enemy is in reach, off against a lone target. The simulator\'s average damage readout does not include the outgoing percentage (the game shows it)',
  ai(ab, u, t) { if (!t) return null; const m = u.findModifier('modifier_medusa_split_shot'); const want = !!m && medusaSplitTargets(m, u, t).length > 0; return want !== ab.toggled ? {} : null; },
  cast(ab) { ab.toggled = !ab.toggled; ab.owner.dirty = true; },
});
const medusaStone = (u, t, dur) => t.addModifier('modifier_medusa_stone_gaze_stone', { caster: u, ability: u.findAbility('medusa_stone_gaze'), duration: dur });
// the snake hits `first`, then jumps to the closest enemy not hit yet; `stone` > 0 petrifies every victim (Cold Blooded)
function medusaSnake(ab, first, jumps, stone) {
  const u = ab.owner; const w = u.world; const seen = new Set(); let mana = 0; let i = 0; let cur = first;
  const step = () => {
    seen.add(cur);
    if (cur.alive) {
      if (stone > 0 && !cur.isImmune()) medusaStone(u, cur, stone);
      hit(ab, cur, ab.v('snake_damage') * (1 + ab.v('snake_scale') / 100 * i), MAGICAL);
      mana += cur.maxMana * ab.v('snake_mana_steal') / 100;
    }
    i++;
    let best = null; let bd = (ab.v('radius')) ** 2;
    if (i < jumps) for (const e of w.units) {
      if (!e.alive || e.team === u.team || seen.has(e) || e.isBuilding || e.isImmune() || e.st[ST.OUT] > 0 || e.st[ST.INVULN] > 0) continue;
      const d = (e.x - cur.x) ** 2 + (e.y - cur.y) ** 2;
      if (d <= bd) { bd = d; best = e; }
    }
    if (best) { cur = best; w.after(ab.v('jump_delay'), step); } else w.after(Math.sqrt((cur.x - u.x) ** 2 + (cur.y - u.y) ** 2) / ab.v('return_speed'), () => { if (u.alive && mana > 0) u.giveMana(mana); });
  };
  step();
}
defAbility('medusa_mystic_snake', {
  prio: 50, fid: 'approx',
  note: 'jumps are jump_delay apart (the growing snake speed is not traced); the mana gain is snake_mana_steal % of every victim\'s maximum mana and the victims keep their mana (the tooltip only describes a gain)',
  cast(ab, t) { const u = ab.owner; u.world.projectile(u, t, ab.v('initial_speed'), (tt) => medusaSnake(ab, tt, ab.v('snake_jumps'), 0)); },
});
// [L] the first damage tick comes with the root (before the impact damage), then every damage_interval; none at the expiry
const medusaGraspTick = (m) => mhit(m, m.parent, m.v('damage_pers') * m.v('damage_interval'), MAGICAL);
debuff('modifier_medusa_gorgon_grasp', { state: ['ROOT'], interval: (m) => m.v('damage_interval'), onCreated: medusaGraspTick, onThink: medusaGraspTick });
defAbility('medusa_gorgon_grasp', {
  prio: 55, fid: 'approx',
  note: 'the volleys are circles on the line from Medusa through the cast point (the second one centred on it, radius growing by radius_grow, centres volley_spread_pct of the initial radius apart, volley_interval apart in time); "cannot turn" and "revealed" have no effect here',
  cast(ab, t, x, y) {
    const u = ab.owner; const w = u.world; const seen = new Set();
    if (w.skillshotHit < 1 && !w.rng.chance(w.skillshotHit)) return;
    const dx = x - u.x; const dy = y - u.y; const d = Math.sqrt(dx * dx + dy * dy) || 1; const gap = ab.v('radius') * ab.v('volley_spread_pct') / 100;
    for (let i = 0; i < ab.v('volley_count'); i++) w.after(ab.v('delay') + i * ab.v('volley_interval'), () => {
      const k = (i - 1) * gap;
      for (const e of enemiesNear(ab, x + dx / d * k, y + dy / d * k, ab.v('radius') + i * ab.v('radius_grow'))) {
        if (seen.has(e) || e.isBuilding) continue;
        seen.add(e);
        addMod(ab, e, 'modifier_medusa_gorgon_grasp', ab.v('duration')); // [L] the root's first damage tick lands just before the impact damage
        if (e.alive) hit(ab, e, ab.v('damage'), MAGICAL);
      }
    });
  },
});
passive('medusa_cold_blooded', {
  fid: 'approx', note: 'the answering snake is a one-target Mystic Snake of the current level (its damage and mana gain, nothing if Mystic Snake is unlearned) that petrifies with Stone Gaze\'s stone form; the triggering spell still lands',
  onSpellTargeted(m, ev) {
    const u = m.parent; const src = ev.caster; const ms = u.findAbility('medusa_mystic_snake');
    if (!m.ability.cdReady() || !src || !src.alive || src.isImmune() || !ms || ms.level < 1) return;
    m.ability.startCooldown();
    u.world.projectile(u, src, ms.v('initial_speed'), (tt) => medusaSnake(ms, tt, 1, m.v('stone_form_scepter_base_tooltip')));
  },
});
passive('medusa_mana_shield', {
  illusion: true, fid: 'approx', note: 'absorbs before armor and magic resistance; damage flagged as pure health loss bypasses every hook in the engine and is not absorbed',
  preMit(m, d) {
    const u = m.parent;
    if (d.amount <= 0 || u.mana <= 0) return;
    const dpm = m.v('damage_per_mana') * (u.isIllusion ? 1 - m.v('illusion_percentage') / 100 : 1);
    const absorb = Math.min(d.amount * m.v('absorption_pct') / 100, u.mana * dpm);
    u.mana -= absorb / dpm; d.amount -= absorb;
  },
});
debuff('modifier_medusa_stone_gaze_slow', { purge: 'none', pierce: true, stats: (m) => ({ msPct: -m.v('slow'), asSlow: -m.v('slow') }) });
debuff('modifier_medusa_stone_gaze_stone', { purge: 'none', pierce: true, state: ['STUN'], stats: (m) => ({ physTakenPct: m.v('bonus_physical_damage') }) });
const GAZE_TICK = 0.1; // facing check interval chosen for the script
buff('modifier_medusa_stone_gaze', {
  purge: 'none', interval: GAZE_TICK, stats: { msPct: 'speed_boost' },
  onCreated(m) { m.data = { t: new Map(), done: new Set() }; },
  onThink(m) {
    const u = m.parent;
    for (const e of u.world.enemiesInRadius(u, u.x, u.y, m.v('radius'))) {
      if (m.data.done.has(e) || !(e.orderTarget === u || e.attackTarget === u || e.castTarget === u)) continue; // "looking at Medusa" = currently targeting her
      e.addModifier('modifier_medusa_stone_gaze_slow', { caster: u, ability: m.ability, duration: 3 * GAZE_TICK });
      const acc = (m.data.t.get(e) || 0) + GAZE_TICK; m.data.t.set(e, acc);
      if (acc >= m.v('face_duration') - 1e-9) { m.data.done.add(e); medusaStone(u, e, m.v('stone_duration')); }
    }
  },
});
defAbility('medusa_stone_gaze', {
  prio: 80, fid: 'approx', note: 'an enemy counts as looking at Medusa while it attacks or casts at her (no facing in the sandbox)',
  ai: (ab, u, t) => (t && !t.isBuilding && u.distTo(t) <= Math.min(ab.v('radius'), u.attackRange + 150) ? {} : null),
  cast(ab) { addMod(ab, ab.owner, 'modifier_medusa_stone_gaze', ab.v('duration')); },
});

// ================================================================ Slark
defAbility('slark_dark_pact', {
  prio: 45, ai: nearAI('radius', 30), fid: 'full', note: 'the self damage is magical, non-lethal and not amplified',
  cast(ab) {
    const u = ab.owner; const n = ab.v('total_pulses'); const per = ab.v('total_damage') / n;
    for (let i = 0; i < n; i++) u.world.after(ab.v('delay') + i * ab.v('pulse_interval'), () => {
      if (!u.alive) return;
      u.purge({ debuffs: true, strong: true });
      for (const e of enemiesNear(ab, u.x, u.y, ab.v('radius'))) hit(ab, e, per, MAGICAL);
      u.world.damage(u, u, per * ab.v('self_damage_pct') / 100, MAGICAL, F_NON_LETHAL | F_NO_AMP, ab);
    });
  },
});
// Essence Shift: one stack per hit on an enemy hero, every stack with its own timer on both sides
debuff('modifier_slark_essence_shift_debuff', {
  purge: 'none', statusResist: false, pierce: true, ...timedStacks, stats: (m) => ({ all: -m.v('stat_loss') * m.stacks }),
  onDestroy(m) { // the victim died while shifted and Slark is within the steal radius: permanent agility
    const t = m.parent; const u = m.caster;
    if (!t.alive && u.alive && realHero(t) && u.distTo(t) <= m.v('steal_radius')) u.addModifier('modifier_slark_essence_shift_permanent', { ability: m.ability, stacks: 1 });
  },
});
buff('modifier_slark_essence_shift_buff', { purge: 'none', ...timedStacks, stats: (m) => ({ agi: m.v('agi_gain') * m.stacks }) });
modifier('modifier_slark_essence_shift_permanent', { multi: 'stack', purge: 'none', stats: (m) => ({ agi: m.v('stat_loss') * m.stacks }) });
function slarkShift(u, t, n) {
  const es = u.findAbility('slark_essence_shift');
  if (!es || es.level < 1 || n <= 0 || !t.alive || !realHero(t) || t.team === u.team || u.st[ST.BREAK] > 0) return; // Break: no new temporary stacks
  const dur = es.v('duration');
  addTimedStacks(t, 'modifier_slark_essence_shift_debuff', { caster: u, ability: es, duration: dur, pierce: true }, n);
  addTimedStacks(u, 'modifier_slark_essence_shift_buff', { ability: es, duration: dur }, n);
}
passive('slark_essence_shift', { fid: 'full', note: 'attributes are floored at 0 by the engine (the game floors them at 1)', onAttackLanded(m, rec) { slarkShift(m.parent, rec.target, 1); } });
// Pounce. Leash: m.x / m.y = Slark's landing spot, m.z = last distance from it
modifier('modifier_slark_pounce_flags', { // Scepter charges ship under custom value names: mirror them into the keys the engine uses
  hidden: true,
  apply(m) {
    const ab = m.ability; const n = m.v('max_charges');
    if (!(n > 0) || ab.vals.AbilityCharges > 0) return;
    ab.vals.AbilityCharges = n; ab.vals.AbilityChargeRestoreTime = m.v('charge_restore_time');
    if (ab.charges === 0 && ab.chargeEnd === 0) ab.charges = n;
  },
});
debuff('modifier_slark_pounce_leash', {
  purge: 'none', interval: C.TICK,
  onThink(m) {
    const e = m.parent; const dx = e.x - m.x; const dy = e.y - m.y; const d = Math.sqrt(dx * dx + dy * dy); const r = m.v('leash_radius');
    if (d <= r) { m.z = d; return; }
    if (d - m.z > 4 * e.ms * C.TICK + 1) { m.remove(); return; } // carried out by a blink or a push: the leash does not stop movement abilities (7.42)
    e.x = m.x + dx / d * r; e.y = m.y + dy / d * r; m.z = r;
  },
});
const slarkPounceRange = (ab) => (ab.v('pounce_distance_scepter') > 0 ? ab.v('pounce_distance_scepter') : ab.v('pounce_distance'));
// [L] measured in Hero Demo: the leap is a motion of pounce_speed units per second (31.1 per server tick), the Scepter's longer leap
// keeps the same 0.75 s (40 per tick); Slark is disarmed while leaping; every tick he moves first, then latches onto the closest enemy
// hero within pounce_radius of his new position (counted to the edge of its body) and stops there. Without one he stops after the full distance.
function slarkPrey(ab, u) {
  let prey = null; let bd = Infinity;
  for (const e of enemiesNear(ab, u.x, u.y, ab.v('pounce_radius'))) {
    if (!e.heroLike || !e.targetable() || e.st[ST.INVULN] > 0) continue;   // [L] measured: debuff-immune heroes are caught too (the data says ENEMIES_NO)
    const d = u.distTo(e); if (d < bd) { bd = d; prey = e; }
  }
  return prey;
}
modifier('modifier_slark_pounce', { // data: { dx, dy, left, speed }
  purge: 'none', state: ['DISARM'], interval: (m) => m.parent.world.dt,
  onThink(m) {
    const u = m.parent;
    if (u.st[ST.STUN] > 0 || u.st[ST.ROOT] > 0 || slarkLeapStep(m.ability, u, m.data)) m.remove();
  },
});
function slarkLeapStep(ab, u, d) { // one tick of the leap; true when it is over
  if (d.left <= 1e-6) return true;
  const go = Math.min(d.left, d.speed * u.world.dt); u.x += d.dx * go; u.y += d.dy * go; d.left -= go;
  const prey = slarkPrey(ab, u);
  if (prey) { slarkLatch(ab, u, prey); return true; }
  return d.left <= 1e-6;
}
function slarkLatch(ab, u, prey) {
  if (ab.v('pounce_damage') > 0) hit(ab, prey, ab.v('pounce_damage'), MAGICAL);
  if (!prey.alive) return;
  const lm = addMod(ab, prey, 'modifier_slark_pounce_leash', ab.v('leash_duration'), { pierce: true });
  if (lm) { lm.x = u.x; lm.y = u.y; lm.z = prey.distTo(u); }
  slarkShift(u, prey, ab.v('essence_stacks'));
}
defAbility('slark_pounce', {
  mods: ['modifier_slark_pounce_flags'], prio: 90, engage: false, fid: 'approx',
  note: 'no facing in the sandbox: the leap goes towards the cast point (an order without a point: towards the nearest enemy); leap speed, distance, disarm, the latch radius and latching onto debuff-immune heroes are as measured; stopping the leap on stun / root is assumed, not measured; AI: only used when a hero target is inside the leap distance',
  ai: (ab, u, t) => (t && t.heroLike && !u.isRooted() && u.distTo(t) <= slarkPounceRange(ab) - 20 ? { x: t.x, y: t.y } : null),
  cast(ab, t, x, y) {
    const u = ab.owner; const w = u.world; const dist = slarkPounceRange(ab);
    let dx = x - u.x; let dy = y - u.y; let d = Math.sqrt(dx * dx + dy * dy);
    if (d < 1e-6) { const e = w.nearestEnemy(u, 1e9); if (!e) return; dx = e.x - u.x; dy = e.y - u.y; d = Math.sqrt(dx * dx + dy * dy) || 1; }
    u.removeModifierByName('modifier_slark_pounce');
    const data = { dx: dx / d, dy: dy / d, left: dist, speed: ab.v('pounce_speed') * dist / ab.v('pounce_distance') };
    if (slarkLeapStep(ab, u, data)) return;   // [L] latched on the first tick (target already within reach): no disarm is seen
    addMod(ab, u, 'modifier_slark_pounce', undefined, { data });
  },
});
// Saltwater Shiv: attack modifier (autocast). Every use is a stack with its own timer: the target loses, Slark gains.
const shivStats = (sign) => (m) => ({ ms: sign * m.v('ms_steal') * m.stacks, hpRegen: sign * m.v('regen_steal') * m.stacks, restore: sign * Math.min(100, m.v('health_rest_steal') * m.stacks) });
debuff('modifier_slark_saltwater_shiv', { ...timedStacks, stats: shivStats(-1) });
buff('modifier_slark_saltwater_shiv_buff', { ...timedStacks, stats: shivStats(1) });
modifier('modifier_slark_saltwater_shiv_orb', {
  hidden: true,
  onAttack(m, rec) {
    const u = m.parent; const ab = m.ability; const t = rec.target; const w = u.world;
    if (!t.isHero || t.team === u.team || t.isImmune() || u.isSilenced() || !ab.cdReady()) return;
    if (!w.freeSpells) { const cost = ab.manaCost(); if (u.mana < cost) return; u.mana -= cost; }
    ab.startCooldown(); (rec.data ||= {}).shiv = true;
  },
  onAttackLanded(m, rec) {
    const u = m.parent; const ab = m.ability; const t = rec.target;
    if (!rec.data || !rec.data.shiv || !t.alive) return;
    addTimedStacks(t, 'modifier_slark_saltwater_shiv', { caster: u, ability: ab, duration: ab.v('duration') });
    addTimedStacks(u, 'modifier_slark_saltwater_shiv_buff', { ability: ab, duration: ab.v('duration') });
  },
});
defAbility('slark_saltwater_shiv', { mods: ['modifier_slark_saltwater_shiv_orb'], fid: 'full', note: 'autocast assumed on: the first attack against a hero after the cooldown carries the shiv (mana is spent when the attack is launched)' });
// Shadow Dance: hidden = cannot be targeted (area effects still hit); the "unseen" regeneration / speed bonus only exists while hidden
buff('modifier_slark_shadow_dance', { purge: 'none', state: ['UNTARGETABLE', 'INVIS'], stats: (m) => ({ as: m.v('attack_speed') }) });
buff('modifier_slark_shadow_dance_passive', { // m.x = time until which a neutral creep's hit suppresses the bonus
  purge: 'none', interval: 0.25,
  stats: (m) => (m.parent.world.time < m.x ? null : { hpRegen: m.v('bonus_regen'), msPct: m.v('bonus_movement_speed') }),
  onTakeDamage(m, d) { if (d.src && d.src.def.neutral && d.dealt > 0) { m.x = m.parent.world.time + m.v('neutral_disable'); m.parent.dirty = true; } },
  onThink(m) { if (m.x > 0 && m.parent.world.time >= m.x) { m.x = 0; m.parent.dirty = true; } },
});
defAbility('slark_shadow_dance', {
  prio: 30, engage: false, ai: lowHpAI(0.55), fid: 'approx',
  note: 'the sandbox has no vision: Slark only counts as unseen inside Shadow Dance or Depth Shroud, where he cannot be targeted (area effects still hit him) and gets the regeneration and speed bonus after activation_delay; AI: used below 55% health',
  cast(ab) {
    const u = ab.owner; const dur = ab.v('duration'); const delay = ab.v('activation_delay');
    addMod(ab, u, 'modifier_slark_shadow_dance', dur);
    u.world.after(delay, () => { if (u.alive && u.hasModifier('modifier_slark_shadow_dance')) addMod(ab, u, 'modifier_slark_shadow_dance_passive', dur - delay); });
  },
});
buff('modifier_slark_depth_shroud', { purge: 'none', state: ['UNTARGETABLE', 'INVIS'] });
const SHROUD_TICK = 0.1; // how often the cloud re-applies its effect
defAbility('slark_depth_shroud', {
  prio: 28, fid: 'approx', note: 'allies inside the cloud cannot be targeted and get Shadow Dance\'s regeneration and speed bonus (if it is learned) without the activation delay; AI: dropped on Slark below 40% health when Shadow Dance is not running',
  ai: (ab, u, t) => (t && u.hp < 0.4 * u.maxHp && !u.hasModifier('modifier_slark_shadow_dance') && !u.hasModifier('modifier_slark_depth_shroud') ? { x: u.x, y: u.y } : null),
  cast(ab, t, x, y) {
    const sd = ab.owner.findAbility('slark_shadow_dance');
    zone(ab, x, y, { radius: 'radius', duration: 'duration', interval: SHROUD_TICK, allies: true, tick: (a) => {
      if (a.isBuilding) return;
      addMod(ab, a, 'modifier_slark_depth_shroud', 2 * SHROUD_TICK);
      if (sd && sd.level > 0) addMod(sd, a, 'modifier_slark_shadow_dance_passive', 2 * SHROUD_TICK);
    } });
  },
});

// ================================================================ Troll Warlord
// Battle Stance: m.y = 1 in melee stance, 0 in ranged stance ([L] he appears in ranged stance, attack range 500)
modifier('modifier_troll_warlord_switch_stance', {
  hidden: true,
  onCreated(m) { m.y = 0; m.parent.melee = false; },
  apply(m, s) {
    m.ability.vals.AbilityCastPoint = 0; // [L] the toggle takes effect the moment it is ordered (the game still reports a 0.2 s cast point)
    if (m.y) { s.bat = m.v('base_attack_time'); s.attackRange -= m.v('bonus_range'); }
  },
  // [L] in both stances: armor_per_interval for every attack_speed_interval points of bonus attack speed, not rounded to whole intervals
  late(m, s, u) { const bonus = C.AS_PER_AGI * u.agi + s.as + s.asSlow; if (bonus > 0) s.armor += bonus / m.v('attack_speed_interval') * m.v('armor_per_interval'); },
});
const trollStance = (u) => u.findModifier('modifier_troll_warlord_switch_stance');
const trollMelee = (u) => { const st = trollStance(u); return !!st && st.y === 1; };
function trollSetStance(u, melee) { const st = trollStance(u); if (!st || (st.y === 1) === melee) return; st.y = melee ? 1 : 0; st.ability.toggled = melee; u.melee = melee; u.winding = false; u.dirty = true; }
// does the AI want to throw the ranged axes now? (target inside the axe range but clearly outside melee reach)
const trollWantsRangedAxes = (u, t) => { const ax = u.findAbility('troll_warlord_whirling_axes_ranged'); const st = trollStance(u); return !!t && !!ax && !!st && ax.level > 0 && ax.ready() && !t.isBuilding && u.distTo(t) <= ax.v('axe_range') && u.rangeTo(t) > u.def.range - st.v('bonus_range') + 150; };
defAbility('troll_warlord_switch_stance', {
  mods: ['modifier_troll_warlord_switch_stance'], illusion: true, prio: 96, engage: false, fid: 'approx',
  note: 'he starts in ranged stance (as in the game); the AI switches to melee to fight; casting either Whirling Axes puts him in the stance of that ability (7.34 note) and the AI toggles back to melee after the ranged axes; the armor bonus is armor_per_interval per attack_speed_interval of bonus attack speed (agility included) in both stances, continuous (measured); the switch is instant',
  ai: (ab, u, t) => (t && !trollMelee(u) && !trollWantsRangedAxes(u, t) ? {} : null),
  cast(ab) { const u = ab.owner; trollSetStance(u, !trollMelee(u)); },
});
manaCostAlias('modifier_troll_warlord_whirling_axes_ranged_flags');
debuff('modifier_troll_warlord_whirling_axes_ranged_slow', { stats: (m) => ({ msPct: -m.v('movement_speed') }) });
defAbility('troll_warlord_whirling_axes_ranged', {
  mods: ['modifier_troll_warlord_whirling_axes_ranged_flags'], prio: 93, fid: 'approx',
  note: 'casting it switches Troll to ranged stance; the five axes are one cone (axe_spread wide plus the axe radius) and every unit in it is hit once when the axes reach it; AI: thrown at a target inside the axe range but outside melee reach',
  ai: (ab, u, t) => (t && !t.isBuilding && u.distTo(t) <= ab.v('axe_range') && (!trollMelee(u) || trollWantsRangedAxes(u, t)) ? { x: t.x, y: t.y } : null),
  cast(ab, t, x, y) {
    const u = ab.owner; const w = u.world; const ox = u.x; const oy = u.y; const pierce = ab.v('pierces_magic_immunity') > 0;
    trollSetStance(u, false);
    const dir = Math.atan2(y - oy, x - ox); const half = ab.v('axe_spread') / 2 * Math.PI / 180;
    if (w.skillshotHit < 1 && !w.rng.chance(w.skillshotHit)) return;
    for (const e of w.inRadius(ox, oy, ab.v('axe_range'), u.team, true)) {
      if (e.isBuilding || e.name === ROSHAN || !inCone(e, ox, oy, dir, half, ab.v('axe_width'))) continue;
      w.after(Math.sqrt((e.x - ox) ** 2 + (e.y - oy) ** 2) / ab.v('axe_speed'), () => {
        if (!e.alive) return;
        if (u.hasScepter) e.purge({ debuffs: false, buffs: true }); // Scepter: basic dispel on enemies (always pierces debuff immunity, 7.36 note)
        if (pierce || !e.isImmune()) e.addModifier('modifier_troll_warlord_whirling_axes_ranged_slow', { caster: u, ability: ab, duration: ab.v('axe_slow_duration'), pierce });
        hit(ab, e, ab.v('axe_damage'), MAGICAL);
      });
    }
  },
});
manaCostAlias('modifier_troll_warlord_whirling_axes_melee_flags');
debuff('modifier_troll_warlord_whirling_axes_melee_blind', { stats: { miss: 'blind_pct' } });
const WHIRL_TICK = 0.25; // how often the whirl looks for enemies that walked into it
defAbility('troll_warlord_whirling_axes_melee', {
  mods: ['modifier_troll_warlord_whirling_axes_melee_flags'], prio: 50, fid: 'approx',
  note: 'casting it switches Troll to melee stance; every enemy that is within the radius of Troll at some point of the whirl is hit once (the spiral path of the two axes is not traced)',
  ai: (ab, u, t) => (t && !t.isBuilding && u.distTo(t) <= ab.v('max_range') ? {} : null),
  cast(ab) {
    const u = ab.owner; const w = u.world; const seen = new Set(); const pierce = ab.v('pierces_magic_immunity') > 0;
    trollSetStance(u, true);
    if (u.hasScepter) u.purge({ debuffs: true }); // Scepter: basic dispel on Troll
    const n = Math.max(1, Math.round(ab.v('whirl_duration') / WHIRL_TICK));
    for (let i = 0; i < n; i++) w.after(i * WHIRL_TICK, () => {
      if (!u.alive) return;
      for (const e of enemiesNear(ab, u.x, u.y, ab.v('max_range'))) {
        if (seen.has(e) || e.isBuilding || e.name === ROSHAN) continue;
        seen.add(e);
        if (pierce || !e.isImmune()) e.addModifier('modifier_troll_warlord_whirling_axes_melee_blind', { caster: u, ability: ab, duration: ab.v('blind_duration'), pierce });
        hit(ab, e, ab.v('damage'), MAGICAL);
      }
    });
  },
});
passive('troll_warlord_fervor', {
  fid: 'full', breakable: false, // Break stops new stacks and the Shard proc, the stacks he has keep working
  note: 'Shard: the extra attack goes to a random enemy within ranged attack range + range_buffer and does not build Fervor',
  stats: (m) => ({ as: m.v('attack_speed') * m.stacks }),
  onAttack(m, rec) {
    const u = m.parent; const w = u.world;
    if (rec.fromAbility === m.ability || rec.target.isBuilding || u.st[ST.BREAK] > 0 || !(m.v('base_chance') > 0)) return;
    if (!m.roll(m.v('base_chance') + m.v('extra_attack_chance_per_stack') * m.stacks)) return;
    const st = trollStance(u); const reach = u.attackRange + (trollMelee(u) && st ? st.v('bonus_range') : 0) + m.v('range_buffer');
    const pool = w.inRadius(u.x, u.y, reach, u.team, true).filter((e) => !e.isBuilding && e.attackableBy(u));
    if (pool.length) w.launchAttack(u, pool[w.rng.int(0, pool.length - 1)], { fromAbility: m.ability });
  },
  onAttackLanded(m, rec) {
    if (rec.fromAbility === m.ability || m.parent.st[ST.BREAK] > 0) return;
    if (m.data !== rec.target) { m.data = rec.target; m.setStacks(0); } else if (m.stacks < m.v('max_stacks')) m.setStacks(m.stacks + 1);
  },
});
debuff('modifier_troll_warlord_berserkers_rage_maim', { stats: (m) => ({ msPct: -m.v('maim_slow'), asSlow: -m.v('maim_attack_slow') }) });
passive('troll_warlord_berserkers_rage', {
  fid: 'full',
  stats: (m) => (trollMelee(m.parent) ? { ms: m.v('bonus_move_speed') } : null),
  onAttack(m, rec) { if (!trollMelee(m.parent) && !rec.target.isBuilding && m.roll(m.v('maim_chance'))) (rec.data ||= {}).maim = 1; },
  // [L] the maim damage is a separate physical damage instance that lands just before the attack's own damage
  outgoing(m, d) { const r = d.rec; if (r && r.data && r.data.maim === 1) { r.data.maim = 2; m.parent.world.damage(m.parent, d.dst, m.v('maim_damage'), PHYSICAL, 0, m.ability); } },
  onAttackLanded(m, rec) {
    const t = rec.target; const u = m.parent;
    if (!t.alive || t.isBuilding) return;
    if (!trollMelee(u)) {
      if (!rec.data || !rec.data.maim) return;
      t.addModifier('modifier_troll_warlord_berserkers_rage_maim', { caster: u, ability: m.ability, duration: m.v('maim_duration'), pierce: true });
    } else if (m.roll(m.v('ensnare_chance'))) t.addModifier('modifier_rooted', { caster: u, ability: m.ability, duration: m.v('ensnare_duration'), pierce: true });
  },
});
buff('modifier_troll_warlord_battle_trance', {
  purge: 'none', state: ['CANNOT_DIE'], interval: 0.25, thinkNow: true,
  stats: (m) => ({ lifesteal: m.v('lifesteal'), as: m.v('attack_speed'), msPct: m.v('movement_speed'), statusRes: m.v('status_resistance'), slowRes: 100 }),
  onThink(m) { // forced target: the closest enemy within range, heroes first
    const u = m.parent; let best = null; let bs = Infinity;
    if (!u.ai) return;
    for (const e of u.world.enemiesInRadius(u, u.x, u.y, m.v('range'))) { if (!e.attackableBy(u)) continue; const s = (e.isHero ? 0 : 1e7) + u.distTo(e); if (s < bs) { bs = s; best = e; } }
    if (best) u.ai.target = best;
  },
});
buff('modifier_troll_warlord_battle_trance_ally', { purge: 'none', stats: (m) => ({ as: m.v('attack_speed') * m.v('attack_speed_share_percent') / 100 }) });
modifier('modifier_troll_warlord_battle_trance_watch', { // talent: may be cast while disabled
  hidden: true, interval: 0.1,
  onThink(m) { const u = m.parent; const ab = m.ability; if (ab.v('strong_dispel') > 0 && disabled(u) && ab.ready() && aiMayCast(u, ab) && u.world.nearestEnemy(u, ab.v('range'))) castNow(ab); },
});
defAbility('troll_warlord_battle_trance', {
  mods: ['modifier_troll_warlord_battle_trance_watch'], prio: 75, fid: 'approx',
  note: 'slows do not affect him for the whole trance ("unslowable while attacking"); he cannot die during it; the allied attack speed talent reaches allied heroes within the ability\'s cast range (the tooltip gives no radius); AI: used in melee range below 75% health, with the talent also the moment he is disabled',
  ai: (ab, u, t) => (t && u.rangeTo(t) <= u.attackRange + 200 && u.hp < 0.75 * u.maxHp ? {} : null),
  cast(ab) {
    const u = ab.owner; const dur = ab.v('trance_duration');
    u.purge({ debuffs: true, strong: ab.v('strong_dispel') > 0 });
    addMod(ab, u, 'modifier_troll_warlord_battle_trance', dur);
    if (ab.v('attack_speed_share_percent') > 0) for (const a of alliesNear(ab, u.x, u.y, ab.castRange())) if (a !== u && realHero(a)) addMod(ab, a, 'modifier_troll_warlord_battle_trance_ally', dur);
  },
});

// ================================================================ Lifestealer
buff('modifier_life_stealer_rage', {
  purge: 'none', state: ['IMMUNE'],
  stats: (m) => ({ mr: m.v('magic_resist'), msPct: m.v('movespeed_bonus'), armor: m.v('bonus_armor'), statusRes: m.v('status_resist') }),
  onCreated(m) { m.parent.purge({ debuffs: true }); },
});
defAbility('life_stealer_rage', {
  prio: 80, engage: false, fid: 'full',
  ai: (ab, u, t) => (t && u.distTo(t) < 700 && !u.isImmune() ? true : null),
  cast(ab) { addMod(ab, ab.owner, 'modifier_life_stealer_rage', ab.v('duration')); },
});
// slow_steps is a per-second table, not a per-level value: read the raw list. m.x = current step
const lsWoundSteps = (ab) => { const e = ab.def.vals.slow_steps; return Array.isArray(e) ? e : e.v; };
debuff('modifier_life_stealer_open_wounds', {
  interval: 1, keepLonger: true,
  stats: (m) => { const st = lsWoundSteps(m.ability); return { msPct: st[Math.min(st.length - 1, m.x)] * m.v('slow_step_pct_of_max') / 100 }; },
  onThink(m) { m.x++; m.parent.dirty = true; },
  onRefresh(m) { m.x = 0; },
  onTakeDamage(m, d) { // allies of the caster heal for a share of the damage they deal to the victim
    const s = d.src; const c = m.caster;
    if (s && s.alive && s.team === c.team && d.dealt > 0) s.heal(d.dealt * m.v('heal_percent') / 100 * (s === c ? 1 : c.restoreMul), c, m.ability);
  },
});
modifier('modifier_life_stealer_open_wounds_frenzy', { // talent: attack speed while his attack target carries his Open Wounds
  hidden: true, purge: 'none', dynamic: true,
  stats: (m) => { const u = m.parent; const t = u.order === ORDER_ATTACK ? u.orderTarget : null; return t && t.alive && t.findModifier('modifier_life_stealer_open_wounds', u) ? { as: m.v('attack_speed_on_target') } : null; },
});
function lsWound(ow, t, dur) {
  const u = ow.owner; const m = addMod(ow, t, 'modifier_life_stealer_open_wounds', dur);
  if (m && ow.v('attack_speed_on_target') > 0) addMod(ow, u, 'modifier_life_stealer_open_wounds_frenzy', dur);
}
defAbility('life_stealer_open_wounds', {
  prio: 60, fid: 'full', note: 'heals from allies\' damage use the caster\'s restoration multiplier; the talent attack speed goes to Lifestealer while his attack target carries his Open Wounds',
  cast(ab, t) { lsWound(ab, t, ab.v('duration')); },
});
modifier('modifier_life_stealer_feast_hp', { hidden: true, purge: 'none', multi: 'stack', breakable: false, stats: (m) => ({ hp: m.stacks }) });
passive('life_stealer_feast', {
  fid: 'full', note: 'the damage is flat physical damage on the attack (after crits); the heal is paid on every hit regardless of the damage dealt',
  onAttack(m, rec) { const t = rec.target; if (!t.isBuilding && t.name !== ROSHAN) rec.add += t.maxHp * m.v('hp_damage_percent') / 100; },
  onAttackLanded(m, rec) { const t = rec.target; const u = m.parent; if (!t.isBuilding && t.name !== ROSHAN) u.heal(t.maxHp * m.v('hp_leech_percent') / 100, u, m.ability, true); },
  onKill(m, ev) { // permanent max health per kill (kept through Break)
    const v = ev.victim; const u = m.parent;
    if (v.team === u.team || v.isBuilding || v.isIllusion) return;
    const n = v.isHero ? m.v('bonus_hp_per_hero') : m.v('bonus_hp_per_creep');
    if (n > 0) u.addModifier('modifier_life_stealer_feast_hp', { ability: m.ability, stacks: n });
  },
});
passive('life_stealer_ghoul_frenzy', { fid: 'full', note: 'attack speed only: the movement_speed_bonus value of the data (0.3% per hero level) changes nothing in the game (measured at every level, also during Rage and while attacking)', stats: { as: 'attack_speed_bonus' } });
// Infest. Lifestealer sits inside the host: out of play, invulnerable, regenerating. m.data = { host, enemy, next (attack), end }
buff('modifier_life_stealer_infest_host', { purge: 'none', stats: (m) => ({ msPct: m.v('bonus_movement_speed'), hp: m.v('bonus_health') }) });
function lsConsume(u) {
  const m = u.findModifier('modifier_life_stealer_infest');
  if (!m) return;
  const ab = m.ability; const h = m.data.host; const w = u.world; const ow = u.findAbility('life_stealer_open_wounds');
  const d = m.data;
  m.remove(); ab.startCooldown(); // the cooldown begins when he leaves the host (7.23b note)
  if (h.alive) h.removeModifierByName('modifier_life_stealer_infest_host');
  // he appears next to the host (the game picks a free spot around it): on the side he came from
  let dx = d.fromX - h.x; let dy = d.fromY - h.y; const dd = Math.sqrt(dx * dx + dy * dy);
  if (dd > 1e-6) { dx /= dd; dy /= dd; } else { dx = 1; dy = 0; }
  u.x = h.x + dx * (u.def.hull + h.def.hull); u.y = h.y + dy * (u.def.hull + h.def.hull);
  for (const e of w.enemiesInRadius(u, h.x, h.y, ab.v('radius'))) {
    if (e.isBuilding) continue;
    hit(ab, e, ab.v('damage'), MAGICAL);
    if (e.alive && ab.v('dot_duration') > 0 && ow && ow.level > 0) lsWound(ow, e, ab.v('dot_duration')); // Shard
  }
}
modifier('modifier_life_stealer_infest', {
  purge: 'none', state: ['OUT', 'INVULN', 'ROOT', 'DISARM', 'INVIS', 'ETHEREAL'], interval: C.TICK, // [L] the states the game reports for him inside a host
  onThink(m) {
    const u = m.parent; const w = u.world; const d = m.data; const h = d.host;
    if (!h.alive) { lsConsume(u); return; }
    u.x = h.x; u.y = h.y;
    if (w.time + 1e-9 >= d.heal) { d.heal += 1; u.heal(u.maxHp * m.v('self_regen') / 100, u, m.ability, true); } // "healing for a portion of his max hitpoints every second"
    if (d.enemy) {
      if (w.time + 1e-9 >= d.next) { d.next += m.v('attack_rate_enemy'); w.launchAttack(u, h, { instant: true, fromAbility: m.ability }); }
      if (w.time + 1e-9 >= d.end) lsConsume(u);
    } else if (u.hp >= 0.9 * u.maxHp || h.hp < 0.3 * h.maxHp) lsConsume(u);
  },
});
defAbility('life_stealer_infest', {
  prio: 40, fid: 'partial', noReflect: true, // 7.42: spell reflection only blocks Infest (read by Anti-Mage's Counterspell script)
  note: 'hosts: allied heroes and units (host gets the speed and health bonus) and, with Scepter, enemy heroes (one attack per attack_rate_enemy from inside starting at once, forced exit after infest_duration_enemy); heals once per second; the cooldown restarts when he leaves; infesting or controlling enemy and neutral creeps, their health drain and the Shard blood damage from consuming a creep are not modelled; AI: with Scepter enters the enemy hero target below 75% health, otherwise an allied hero within 700 below 35% health, and leaves at 90% health or when the host drops below 30%',
  ai(ab, u, t, w) {
    if (!t) return null;
    if (ab.v('infest_duration_enemy') > 0 && realHero(t) && !t.isImmune() && u.hp < 0.75 * u.maxHp && u.distTo(t) <= ab.castRange() + 300) return { target: t };
    if (u.hp >= 0.35 * u.maxHp) return null;
    let best = null; let bd = 700;
    for (const a of w.units) if (a.alive && a.team === u.team && a !== u && realHero(a) && a.st[ST.OUT] === 0 && a.hp > 0.5 * a.maxHp) { const d = u.distTo(a); if (d < bd) { bd = d; best = a; } }
    return best ? { target: best } : null;
  },
  cast(ab, t) {
    const u = ab.owner; const w = u.world; const enemy = t.team !== u.team;
    if (t === u || t.isBuilding || (enemy && !(ab.v('infest_duration_enemy') > 0 && t.isHero))) { refund(ab); return; } // enemy heroes need the Scepter; enemy and neutral creep hosts are not modelled
    u.purge({ debuffs: true });
    u.addModifier('modifier_life_stealer_infest', { ability: ab, data: { host: t, enemy, fromX: u.x, fromY: u.y, heal: w.time + 1, next: w.time, end: enemy ? w.time + ab.v('infest_duration_enemy') : Infinity } });
    if (!enemy) addMod(ab, t, 'modifier_life_stealer_infest_host');
    u.x = t.x; u.y = t.y;
  },
});
defAbility('life_stealer_consume', {
  manual: true, fid: 'approx',
  note: 'leaves the host and deals Infest\'s damage around it; triggered by the Infest script itself (host dead, health restored, host in danger or Scepter time over) because a unit that is out of play takes no orders in the engine',
  cast(ab) { lsConsume(ab.owner); },
});

// ================================================================ Faceless Void
const REVERSE_WINDOW = 1.5; // tooltip text: "available for 1.5 seconds after landing Time Walk" (no value in the data)
const BACKTRACK_TALENT = 'special_bonus_unique_faceless_void_4';
modifier('modifier_faceless_void_time_walk', { // m.data = [time, damage, ...] taken recently (for the backtrack)
  hidden: true,
  onCreated(m) { m.data = []; },
  preMit(m, d) { // talent: chance to avoid a damage instance entirely (disabled by Break)
    const u = m.parent;
    if (d.amount <= 0 || !u.talents.has(BACKTRACK_TALENT) || u.st[ST.BREAK] > 0) return;
    const e = u.world.data.abilities[BACKTRACK_TALENT].vals.dodge_chance_pct; const pct = Array.isArray(e) ? e[0] : e.v[0];
    if (m.roll(pct)) d.amount = 0;
  },
  onTakeDamage(m, d) { if (d.dealt > 0) { m.data.push(m.parent.world.time, d.dealt); if (m.data.length > 400) m.data.splice(0, 2); } },
});
defAbility(BACKTRACK_TALENT, { fid: 'full', note: 'talent implemented in the Time Walk script: pseudo-random chance to negate a damage instance before mitigation' });
function fvRecentDamage(u, ab) {
  const m = u.findModifier('modifier_faceless_void_time_walk'); let s = 0;
  if (!m) return 0;
  const since = u.world.time - ab.v('backtrack_duration');
  for (let i = 0; i < m.data.length; i += 2) if (m.data[i] >= since) s += m.data[i + 1];
  return s * ab.v('dodge_chance_pct') / 100;
}
// Time Lock [L]: the proc only freezes the target; `delay` later Void strikes it again and the bonus magic damage lands with that
// second attack (attack first, then the magic damage). The second attack is a full attack that can lock again.
debuff('modifier_faceless_void_time_lock_freeze', { state: ['STUN'], pierce: true, purge: 'strong', keepLonger: true });
function fvTimeLock(u, tl, t) {
  const w = u.world;
  if (!t.alive) return;
  t.addModifier('modifier_faceless_void_time_lock_freeze', { caster: u, ability: tl, duration: t.heroLike ? tl.v('duration') : tl.v('duration_creep'), pierce: true });
  w.after(tl.v('delay'), () => {
    if (!u.alive || !t.alive) return;
    w.launchAttack(u, t, { instant: true, fromAbility: tl });
    if (t.alive) w.damage(u, t, tl.v('bonus_damage'), MAGICAL, 0, tl);
  });
}
buff('modifier_faceless_void_time_walk_reverse_ready', { purge: 'none' }); // m.x / m.y = where the walk started
buff('modifier_faceless_void_time_walk_moving', { purge: 'none', statusResist: false, state: ['STUN', 'INVULN'] }); // [L] during the walk Void is invulnerable and counts as stunned
defAbility('faceless_void_time_walk', {
  mods: ['modifier_faceless_void_time_walk'], prio: 100, fid: 'full',
  note: 'the move itself is instant; for distance / speed afterwards Void is invulnerable and cannot act (the game reports him as stunned for the walk); he lands on the point, or next to a unit that stands on it (the game picks a free spot around that unit); AI: used to close a gap, or in place to undo damage worth 20% of his maximum health',
  ai(ab, u, t) {
    if (!t || u.isRooted()) return null;
    return u.rangeTo(t) - u.attackRange > 200 || fvRecentDamage(u, ab) >= 0.2 * u.maxHp ? { x: t.x, y: t.y } : null;
  },
  cast(ab, t, x, y) {
    const u = ab.owner; const w = u.world; const ox = u.x; const oy = u.y; const back = fvRecentDamage(u, ab);
    let dx = x - ox; let dy = y - oy; const d = Math.sqrt(dx * dx + dy * dy);
    let go = Math.min(d, ab.v('range') + u.castRangeBonus);
    if (d > 1e-6) {
      dx /= d; dy /= d;
      // units do not overlap in the game: when the landing spot is occupied Void stops where his hull touches the unit standing there
      const lx = ox + dx * go; const ly = oy + dy * go;
      for (const e of w.units) {
        if (e === u || !e.alive || e.isBuilding || e.st[ST.OUT] > 0) continue;
        const gap = u.def.hull + e.def.hull;
        if ((e.x - lx) ** 2 + (e.y - ly) ** 2 >= gap * gap) continue;
        const along = (e.x - ox) * dx + (e.y - oy) * dy; const perp2 = (e.x - ox) ** 2 + (e.y - oy) ** 2 - along * along;
        go = Math.min(go, Math.max(0, along - Math.sqrt(Math.max(0, gap * gap - perp2))));
      }
      u.x = ox + dx * go; u.y = oy + dy * go;
    }
    const travel = go / ab.v('speed');
    if (travel > 0) u.addModifier('modifier_faceless_void_time_walk_moving', { ability: ab, duration: travel });
    if (back > 0) { u.heal(back, u, ab); ab.mods[0].data.length = 0; }
    const tl = u.findAbility('faceless_void_time_lock'); const rv = u.findAbility('faceless_void_time_walk_reverse');
    if (ab.v('radius') > 0 && tl && tl.level > 0) for (const e of enemiesNear(ab, u.x, u.y, ab.v('radius'))) if (!e.isBuilding) fvTimeLock(u, tl, e); // Scepter
    if (rv && rv.level > 0) { const m = addMod(rv, u, 'modifier_faceless_void_time_walk_reverse_ready', REVERSE_WINDOW); if (m) { m.x = ox; m.y = oy; } }
  },
});
defAbility('faceless_void_time_walk_reverse', {
  manual: true, fid: 'approx', note: 'returns Faceless Void to where his last Time Walk started; outside the 1.5 s window after a Time Walk the order does nothing (no cooldown); pure repositioning, so the AI never uses it unless the scenario lists it',
  ai: (ab, u) => (u.hasModifier('modifier_faceless_void_time_walk_reverse_ready') ? {} : null),
  cast(ab) {
    const u = ab.owner; const m = u.findModifier('modifier_faceless_void_time_walk_reverse_ready');
    if (!m) { refund(ab); return; } // [L] not available without a fresh Time Walk: nothing happens
    u.x = m.x; u.y = m.y; m.remove();
  },
});
// Time Dilation: stacks = 1 + abilities on cooldown. [L] the debuff starts without stacks and counts them every 0.1 s (the slow
// begins 0.1 s after the cast); damage once per second from the application. m.x = thinks so far.
const DILATION_TICK = 0.1;
const fvCooling = (e) => { let n = 0; const now = e.world.time; for (const a of e.abilities) if (a.level > 0 && (a.cdEnd > now + 1e-9 || (a.vals.AbilityCharges > 0 && a.charges < a.vals.AbilityCharges))) n++; return n; };
const fvDilationHit = (m) => mhit(m, m.parent, m.v('base_damage') + m.v('damage_per_stack') * m.stacks, MAGICAL);
debuff('modifier_faceless_void_time_dilation', {
  multi: 'independent', interval: DILATION_TICK,
  stats: (m) => ({ msPct: -m.v('slow') * m.stacks, asSlow: -m.v('attack_slow') * m.stacks }),
  onThink(m) {
    const e = m.parent; const now = e.world.time; const iv = m.interval;
    if (e.findModifier(m.name) === m) { const k = iv * m.v('cooldown_percentage') / 100; for (const a of e.abilities) { if (a.cdEnd > now) a.cdEnd += k; if (a.chargeEnd > now) a.chargeEnd += k; } } // cooldowns run slower (once, however many instances)
    if (e.hasModifier('modifier_faceless_void_chronosphere_freeze')) m.dieTime += iv; // the duration is paused inside Chronosphere
    m.setStacks(1 + fvCooling(e));
    m.x++;
    if (m.x % Math.round(1 / iv) === 0) fvDilationHit(m);
  },
});
buff('modifier_faceless_void_time_dilation_selfbuff', { // Shard: m.stacks = stacks applied at cast; [L] constant for the whole duration
  stats: (m) => ({ msPct: m.v('self_movespeed_tooltip') * m.stacks, as: m.v('self_attackspeed_tooltip') * m.stacks }),
  onRefresh(m, o) { if (o && o.stacks !== undefined) m.setStacks(o.stacks); },
});
defAbility('faceless_void_time_dilation', {
  prio: 40, radius: 'radius', fid: 'full',
  note: 'stacks are recounted and enemy ability cooldowns pushed back every 0.1 s; damage once per second; the tick that coincides with the end of the debuff is not dealt (in the game it lands in about one recording out of three, depending on frame timing); Shard: Void\'s own stacks are the stacks counted at the cast (one per enemy plus its abilities on cooldown) and stay for the whole duration',
  cast(ab) {
    const u = ab.owner; const dur = ab.v('duration'); let total = 0;
    for (const e of enemiesNear(ab, u.x, u.y, ab.v('radius'))) { if (e.isBuilding) continue; const m = addMod(ab, e, 'modifier_faceless_void_time_dilation', dur); if (m) total += 1 + fvCooling(e); }
    if (ab.v('self_buff') > 0 && total > 0) u.addModifier('modifier_faceless_void_time_dilation_selfbuff', { ability: ab, duration: dur, stacks: total });
  },
});
passive('faceless_void_time_lock', {
  fid: 'full', note: 'the proc freezes the target; the second attack follows after `delay` together with the bonus magic damage and can lock again',
  onAttackLanded(m, rec) { const t = rec.target; if (t.alive && !t.isBuilding && m.roll(m.v('chance_pct'))) fvTimeLock(m.parent, m.ability, t); },
});
passive('faceless_void_distortion_field', {
  fid: 'approx', note: 'works on the engine\'s attack projectile records: an enemy attack projectile aimed at Void or an allied hero near him loses the given share of its speed once it is inside the slow distance',
  interval: C.TICK,
  onThink(m) {
    const u = m.parent; const ps = u.world.projectiles;
    if (!Array.isArray(ps) || !ps.length) return;
    const k = 1 - m.v('attack_projectile_slow') / 100; const near2 = m.v('slow_distance_max') ** 2;
    for (const p of ps) {
      const t = p.target;
      if (p.kind !== 0 || p.distorted || !p.rec || p.rec.attacker.team === u.team || t.team !== u.team) continue;
      if (t !== u && !(t.isHero && u.distTo(t) <= m.v('friendly_hero_distance'))) continue;
      if ((t.x - p.x) ** 2 + (t.y - p.y) ** 2 <= near2) { p.speed *= k; p.distorted = true; }
    }
  },
});
debuff('modifier_faceless_void_chronosphere_freeze', { state: ['STUN'], purge: 'none', pierce: true, statusResist: false });
const CHRONO_SPEED = 1000; // [L] measured in Hero Demo: Void and the units he controls move at 1000 inside the sphere (no value in the data)
const CHRONO_TICK = 0.1;    // [L] the sphere re-applies its speed effect every 0.1 s
buff('modifier_faceless_void_chronosphere_speed', { purge: 'none', stats: (m) => ({ as: m.v('bonus_attack_speed'), msAbs: CHRONO_SPEED }) });
buff('modifier_faceless_void_chronosphere', { // on Faceless Void: m.x / m.y = centre of the sphere
  purge: 'none', hidden: true, interval: CHRONO_TICK, thinkNow: true,
  onThink(m) {
    const u = m.parent; const left = m.remaining(); const r2 = (m.v('radius')) ** 2;
    if (left <= 0) return;
    for (const e of u.world.units) {
      if (!e.alive || e.st[ST.OUT] > 0 || (e.x - m.x) ** 2 + (e.y - m.y) ** 2 > r2) continue;
      if (e === u || e.owner === u || e.name === u.name) e.addModifier('modifier_faceless_void_chronosphere_speed', { caster: u, ability: m.ability, duration: CHRONO_TICK + C.TICK }); // Void and his own units: speed (and the talent attack speed) while inside
      else if (!e.hasModifier('modifier_faceless_void_chronosphere_freeze')) e.addModifier('modifier_faceless_void_chronosphere_freeze', { caster: u, ability: m.ability, duration: left });
    }
  },
});
defAbility('faceless_void_chronosphere', {
  prio: 85, fid: 'approx',
  note: 'every unit except Faceless Void and his own units (allies included) that is or comes inside the sphere is frozen for the rest of its duration; Void and his own units inside it move at 1000 and get the talent attack speed (measured); if Void dies the frozen units stay frozen but nothing new is caught. The recorded scenes cannot show the freeze: every unit of a scene is controlled by the same player, so the game treats the dummy as one of Void\'s units',
  ai: (ab, u, t) => (t && !t.isBuilding ? { x: t.x, y: t.y } : null),
  cast(ab, t, x, y) { const m = addMod(ab, ab.owner, 'modifier_faceless_void_chronosphere', ab.v('duration')); if (m) { m.x = x; m.y = y; } },
});
