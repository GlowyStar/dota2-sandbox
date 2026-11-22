// Item effects, part 2 (patch 7.42): the shop items that had no effect script, and the neutral enchantments.
// Plain stat bonuses ("+$..." tooltip lines) are applied by the engine from the data pack; only the rest is scripted here.
// Every number is read from the shipped data by name; the few literals are structural and explained in the `note` of the item.
import { defAbility, modifier, buff, debuff, passive, neg, hit, addMod, stun, enemiesNear, mhit, aura, barrier, giveBarrier,
  ST, C, MAGICAL, PURE, F_HP_LOSS, F_NON_LETHAL } from '../engine/dsl.mjs';

const I = (n) => 'item_' + n;
const E = (n) => 'item_enhancement_' + n;
const ORDER_MOVE = 2;   // engine/core.mjs ORDER.MOVE
const NO_RANGE = 1e5;   // "without range restrictions" (Hurricane Pike)

// ---------------------------------------------------------------- shared helpers
const rootOwner = (u) => { let o = u; while (o.owner && o.owner !== o) o = o.owner; return o; };
// "player-controlled source": a hero, an illusion, or anything one of them summoned
const playerOwned = (u) => rootOwner(u).heroLike;
const isRoshan = (u) => u.name === 'npc_dota_roshan';

// Periodic damage. The engine expires a modifier before it runs a think that falls on the same instant, so the last tick of
// "X per second for N seconds" would be lost; it is delivered from onDestroy instead.
const ticking = (tick, def = {}) => ({ ...def, onThink: tick, onDestroy(m, expired) { if (expired && m.parent.alive && m.nextThink <= m.dieTime + 1e-6) tick(m); } });

// [L] measured in Hero Demo: the health cost of Bloodslinger (75) and Soul Ring (170) is a damage instance on the caster, unreduced.
// The engine has already taken the cost from the health directly: it is given back and taken again as that instance.
function healthCostHit(ab) {
  const u = ab.owner; const hc = ab.v('AbilityHealthCost');
  if (u.world.freeSpells || !(hc > 0)) return;
  u.hp = Math.min(u.maxHp, u.hp + hc);
  u.world.damage(u, u, hc, PURE, F_HP_LOSS | F_NON_LETHAL, ab);
}

// Items of one shared-cooldown group go on cooldown together (the engine has no cooldown groups).
function shareCooldown(ab) {
  const g = ab.def.sharedCd;
  if (!g) return;
  for (const it of ab.owner.items) if (it !== ab && it.def.sharedCd === g && it.cdEnd < ab.cdEnd) it.cdEnd = ab.cdEnd;
}
function onGroupCast(m, ev) {
  const a = ev.ability; const mine = m.ability;
  if (a !== mine && a.isItem && a.def.sharedCd && a.def.sharedCd === mine.def.sharedCd && a.cdEnd > mine.cdEnd) mine.cdEnd = a.cdEnd;
}
// a cast that turned out to be impossible (wrong target, empty item): give cooldown and mana back
const carried = (ab) => ab.owner.items.includes(ab);   // false for the value copy of a spell re-cast by Lotus Orb
function refund(ab) {
  const u = ab.owner;
  if (u.world.freeSpells || !carried(ab)) return;
  ab.cdEnd = 0;
  u.mana = Math.min(u.maxMana, u.mana + ab.manaCost());
}

// Point given together with a self-cast order: sandbox { type: 'cast', target: <self>, pos: [x, y] } or an ai result { target: u, x, y }.
// (0, 0) is the engine's "no point" default and is ignored.
function orderPoint(u) {
  if (u.orderTarget !== u) return null;
  const x = u.orderX; const y = u.orderY;
  if ((x === 0 && y === 0) || Math.hypot(x - u.x, y - u.y) <= 1) return null;
  return { x, y };
}
const unitDir = (u, x, y) => { const dx = x - u.x; const dy = y - u.y; const d = Math.hypot(dx, dy); return d < 1e-6 ? null : [dx / d, dy / d]; };
// The sandbox has no facing. A unit is taken to face what it is acting on: its attack / cast target, else its move destination,
// else the nearest enemy.
function facingDir(u) {
  const t = [u.orderTarget, u.attackTarget, u.ai && u.ai.target].find((x) => x && x !== u && x.alive);
  if (t) return unitDir(u, t.x, t.y);
  if (u.order === ORDER_MOVE) return unitDir(u, u.orderX, u.orderY);
  const e = u.world.nearestEnemy(u);
  return e ? unitDir(u, e.x, e.y) : null;
}
// Where `t` will be `secs` seconds from now if it keeps walking towards the unit it is attacking (used to aim delayed area effects).
function leadPos(t, secs) {
  const o = t.orderTarget;
  if (!o || !o.alive || o === t || t.isDisabled() || t.st[ST.ROOT] > 0) return { x: t.x, y: t.y };
  const reach = t.attackRange + t.def.hull + o.def.hull;
  const dx = o.x - t.x; const dy = o.y - t.y; const d = Math.hypot(dx, dy);
  if (d <= reach) return { x: t.x, y: t.y };
  const go = Math.min(t.ms * secs, d - reach);
  return { x: t.x + dx / d * go, y: t.y + dy / d * go };
}

// ---------------------------------------------------------------- Bloodslinger: Sling Grenade
debuff('modifier_item_bloodslinger_debuff', ticking((m) => mhit(m, m.parent, m.v('damage_over_time'), MAGICAL), {
  interval: (m) => m.v('tick_rate'), dynamic: true,
  stats(m) {
    const life = m.dieTime - m.created;
    const k = life > 0 ? Math.min(1, Math.max(0, (m.parent.world.time - m.created) / life)) : 1;
    const hi = Math.abs(m.v('movespeed_slow_max')); const lo = Math.abs(m.v('movespeed_slow_min'));
    return { msPct: -(hi + (lo - hi) * k) };
  },
}));
defAbility(I('bloodslinger'), {
  fid: 'approx', prio: 45,
  note: 'damage type is not in the item data: magical (as the 7.42 notes say for the damage over time; assumed for the impact). The grenade flies speed units/s to the point; the slow fades linearly from max to min. AI: thrown at where the target is heading while above twice the health cost',
  ai(ab, u, t) {
    if (!t || t.isBuilding || u.hp <= 2 * ab.v('AbilityHealthCost') || t.hasModifier('modifier_item_bloodslinger_debuff')) return null;
    return leadPos(t, u.distTo(t) / ab.v('speed'));
  },
  cast(ab, t, x, y) {
    shareCooldown(ab);
    healthCostHit(ab);
    const u = ab.owner; const w = u.world;
    w.after(Math.hypot(x - u.x, y - u.y) / ab.v('speed'), () => {
      if (w.skillshotHit < 1 && !w.rng.chance(w.skillshotHit)) return;
      for (const e of enemiesNear(ab, x, y, ab.v('radius'))) {
        if (e.isBuilding) continue;
        hit(ab, e, ab.v('impact_damage'), MAGICAL);
        if (e.alive) addMod(ab, e, 'modifier_item_bloodslinger_debuff', ab.v('debuff_duration'));
      }
    });
  },
});

// ---------------------------------------------------------------- Holy Locket: stored charges, heal amplification
// incoming heal amplification: heals (anything that is not regeneration or lifesteal) restore that much more
buff('modifier_item_holy_locket_buff', {
  onHealed(m, ev) {
    if (!ev.ability) return;   // lifesteal carries no ability
    const u = m.parent;
    const add = Math.min(u.maxHp - u.hp, ev.amount * m.v('incoming_heal_increase_active') / 100);
    if (add <= 0) return;
    u.hp += add;
    if (ev.src) ev.src.mHealed += add;
    if (u.world.log && add >= 1) u.world.logEvent('heal', ev.src, u, m.ability.name, add);
  },
});
const locketCharge = (ab) => { if (ab.charges < ab.v('max_charges')) ab.charges++; };
modifier('modifier_item_holy_locket', {
  hidden: true, stats: { healAmp: 'heal_increase_passive' },
  interval: (m) => m.v('AbilityChargeRestoreTime'),
  onCreated(m) { m.ability.chargeEnd = Infinity; },   // charges are kept by this script, not by the engine's charge timer
  onThink(m) { locketCharge(m.ability); },
  onAnyCast(m, ev) {
    const c = ev.caster; const u = m.parent;
    if (c.team !== u.team && !ev.ability.def.behavior.includes('DONT_PROC_OTHER_ABILITIES') && u.distTo(c) <= m.v('charge_radius')) locketCharge(m.ability);
  },
  onCast: onGroupCast,
});
defAbility(I('holy_locket'), {
  mods: ['modifier_item_holy_locket'], fid: 'approx', prio: 35,
  note: 'uses all stored charges (item option "charges", default 1). Incoming heal amplification is applied before the instant restore (7.40 notes) and only to heals (not regeneration or lifesteal). A charge is gained every charge-restore interval and on every ability or item an enemy casts in range, except those flagged DONT_PROC_OTHER_ABILITIES (no vision in the sandbox). AI: cast on the most wounded allied hero in cast range below 50% health',
  ai(ab, u) {
    if (ab.charges < 1 || !ab.cdReady()) return null;
    const r = ab.castRange(); let best = null; let frac = 0.5;
    for (const a of u.world.units) {
      if (!a.alive || a.team !== u.team || !a.heroLike || a.st[ST.OUT] > 0 || (a !== u && u.distTo(a) > r)) continue;
      const f = a.hp / a.maxHp;
      if (f < frac) { frac = f; best = a; }
    }
    return best ? { target: best } : null;
  },
  cast(ab, t) {
    const u = ab.owner; const w = u.world; const tt = t || u;
    if (!w.freeSpells && !ab.cdReady()) { ab.charges++; return; }   // still on its 'use_cooldown': give back the charge the engine took
    const n = ab.charges + (w.freeSpells ? 0 : 1);                   // the engine has already taken one charge for this cast
    ab.charges = 0; ab.chargeEnd = Infinity;
    if (!w.freeSpells) ab.cdEnd = w.time + ab.v('use_cooldown') * u.cdrMul;
    shareCooldown(ab);
    addMod(ab, tt, 'modifier_item_holy_locket_buff', ab.v('active_buff_duration'));
    tt.heal(n * ab.v('health_restore_per_charge'), u, ab);
    tt.giveMana(n * ab.v('mana_restore_per_charge'));
  },
});

// ---------------------------------------------------------------- Urn of Shadows / Spirit Vessel / Essence Distiller: Soul Release
// Charges live in ab.charges and start at 0, as bought. The engine reads the item option "charges" only for items that ship
// with charges, so a scenario presets them with  stacks: { item_urn_of_shadows: N }  (absorbed here from the intrinsic modifier).
function soulCharges(ab) {
  const m = ab.mods[0];
  if (m && m.stacks > 0) { ab.charges += m.stacks; m.stacks = 0; }
  return ab.charges;
}
function gainSoul(ab) { const n = soulCharges(ab); ab.charges = n + (n > 0 ? ab.v('soul_additional_charges') : ab.v('soul_initial_charge')); }
const holds = (u, name) => u.items.some((it) => it.name === name && it.slot !== 'backpack');
const soulKeeper = (closestOnly, ownDeath) => ({
  hidden: true,
  onAnyDeath(m, ev) {
    const v = ev.victim; const u = m.parent;
    if (!v.isHero || v.isIllusion || v.team === u.team) return;
    const d = u.distTo(v);
    if (d > m.v('soul_radius')) return;
    if (closestOnly) { for (const o of u.world.units) if (o !== u && o.alive && !o.isIllusion && o.team !== v.team && o.distTo(v) < d && holds(o, m.ability.name)) return; }
    else if (holds(u, I('spirit_vessel'))) return;   // a hero with both: only the Spirit Vessel gains the charge (7.40b notes)
    gainSoul(m.ability);
  },
  onDeath(m) { if (ownDeath) gainSoul(m.ability); },
});
// health regeneration on an ally; lost when an enemy hero or Roshan attacks the unit
const soulHeal = (name) => buff(name, {
  stats: { hpRegen: 'soul_heal_amount' },
  onAttacked(m, rec) { const a = rec.attacker; if (a.team !== m.parent.team && (a.heroLike || isRoshan(a))) m.remove(); },
});
function soulRelease(ab, t, healMod, hurtMod) {
  const u = ab.owner;
  if (soulCharges(ab) < 1) { refund(ab); return false; }   // an empty urn does nothing
  ab.charges--;
  shareCooldown(ab);
  addMod(ab, t, t.team === u.team ? healMod : hurtMod, ab.v('duration'));
  return true;
}
// AI: damage the current target if it is a hero, otherwise heal yourself when wounded and no enemy hero has hit you for 3 s
const soulAI = (healMod, hurtMod) => (ab, u, t) => {
  if (soulCharges(ab) < 1) return null;
  if (t && t.heroLike && t.st[ST.IMMUNE] === 0 && !t.hasModifier(hurtMod)) return { target: t };
  if (u.hp / u.maxHp < 0.6 && u.world.time - u.lastHurt > 3 && !u.hasModifier(healMod)) return { target: u };
  return null;
};
const SOUL_NOTE = 'starts empty; charges come from enemy hero deaths in range or from the scenario (stacks: { <item name>: N }). The data gives no damage type: magical (engine default). 1 s damage ticks. AI: used on the current enemy hero, else on itself below 60% health when no enemy hero hit it for 3 s';

debuff('modifier_item_urn_of_shadows_debuff', ticking((m) => mhit(m, m.parent, m.v('soul_damage_amount'), MAGICAL), { interval: 1 }));
soulHeal('modifier_item_urn_of_shadows_heal');
modifier('modifier_item_urn_of_shadows', soulKeeper(false, false));
defAbility(I('urn_of_shadows'), {
  mods: ['modifier_item_urn_of_shadows'], fid: 'approx', prio: 40, noBlock: true, note: SOUL_NOTE,
  ai: soulAI('modifier_item_urn_of_shadows_heal', 'modifier_item_urn_of_shadows_debuff'),
  cast(ab, t) { soulRelease(ab, t || ab.owner, 'modifier_item_urn_of_shadows_heal', 'modifier_item_urn_of_shadows_debuff'); },
});

debuff('modifier_item_spirit_vessel_debuff', ticking((m) => { const u = m.parent; mhit(m, u, m.v('soul_damage_amount') + u.hp * m.v('enemy_hp_drain') / 100, MAGICAL); }, {
  interval: 1, stats: (m) => ({ restore: -m.v('restoration_reduction_enemy') }),
}));
soulHeal('modifier_item_spirit_vessel_heal');
modifier('modifier_item_spirit_vessel', soulKeeper(true, true));
defAbility(I('spirit_vessel'), {
  mods: ['modifier_item_spirit_vessel'], fid: 'approx', prio: 40, noBlock: true,
  note: SOUL_NOTE + '. The current-health drain is dealt as magical damage together with the flat damage of each tick',
  ai: soulAI('modifier_item_spirit_vessel_heal', 'modifier_item_spirit_vessel_debuff'),
  cast(ab, t) { soulRelease(ab, t || ab.owner, 'modifier_item_spirit_vessel_heal', 'modifier_item_spirit_vessel_debuff'); },
});

debuff('modifier_item_essence_distiller_debuff', ticking((m) => mhit(m, m.parent, m.v('soul_damage_amount'), MAGICAL), { interval: 1 }));
soulHeal('modifier_item_essence_distiller_heal');
modifier('modifier_item_essence_distiller', soulKeeper(true, false));
defAbility(I('essence_distiller'), {
  mods: ['modifier_item_essence_distiller'], fid: 'partial', prio: 40, noBlock: true,
  note: SOUL_NOTE + '. True Sight and shared vision on the enemy are not modelled (they only matter with rules.detectAll = false). A ground cast (order with a point and no target) lies dormant and latches onto the first enemy hero that comes into latch range',
  ai: soulAI('modifier_item_essence_distiller_heal', 'modifier_item_essence_distiller_debuff'),
  cast(ab, t, x, y) {
    const u = ab.owner; const w = u.world;
    if (t) { soulRelease(ab, t, 'modifier_item_essence_distiller_heal', 'modifier_item_essence_distiller_debuff'); return; }
    if (soulCharges(ab) < 1) { refund(ab); return; }
    ab.charges--;
    shareCooldown(ab);
    const end = w.time + ab.v('ground_duration'); const r = ab.v('latch_range');
    const watch = () => {
      let best = null; let bd = r * r;
      for (const e of w.units) {
        if (!e.alive || e.team === u.team || !e.heroLike || e.st[ST.OUT] > 0 || e.st[ST.IMMUNE] > 0) continue;
        const d = (e.x - x) * (e.x - x) + (e.y - y) * (e.y - y);
        if (d <= bd) { bd = d; best = e; }
      }
      if (best && addMod(ab, best, 'modifier_item_essence_distiller_debuff', ab.v('duration'))) return;
      if (w.time + w.dt <= end + 1e-9) w.after(w.dt, watch);
    };
    watch();
  },
});

// ---------------------------------------------------------------- Eul's Scepter / Wind Waker: Cyclone
// [L] measured in Hero Demo: the cyclone carries the states stunned and invulnerable (not out of game); enemies take the drop damage on landing.
const cycloneDef = {
  state: ['STUN', 'INVULN'], purge: 'none',
  onDestroy(m) { const u = m.parent; if (u.alive && m.caster.team !== u.team) mhit(m, u, m.v('tooltip_drop_damage'), MAGICAL); },
};
modifier('modifier_item_cyclone_active', { ...cycloneDef });
// a self-cast Wind Waker tornado travels towards the point that was given with the order
function drift(m) {
  const u = m.parent; const d = m.data.dest;
  const dx = d.x - u.x; const dy = d.y - u.y; const dist = Math.hypot(dx, dy);
  if (dist < 1e-6) return;
  const step = Math.min(dist, m.v('tornado_speed') * m.interval);
  u.x += dx / dist * step; u.y += dy / dist * step;
}
modifier('modifier_item_wind_waker_active', {
  ...cycloneDef,
  interval: (m) => (m.data && m.data.dest ? m.parent.world.dt : 0),
  onThink: drift,
  onDestroy(m, expired) { if (expired && m.interval > 0) drift(m); cycloneDef.onDestroy(m); },   // the step that falls on the expiry tick
});
const cycloneCast = (mod, allies) => function cast(ab, t) {
  const u = ab.owner; const tt = t || u;
  if (tt !== u && tt.team === u.team && !allies) { refund(ab); return; }   // Eul's cannot cyclone allies
  shareCooldown(ab);
  if (tt.team === u.team) tt.purge({ debuffs: true }); else tt.purge({ debuffs: false, buffs: true });   // basic dispel
  const dest = allies && tt === u ? orderPoint(u) : null;
  tt.addModifier(mod, { caster: u, ability: ab, duration: ab.v('cyclone_duration'), data: dest ? { dest } : null });
};
// used only when the scenario lists the item: lift the current enemy hero unless it is disabled already
const cycloneAI = (ab, u, t) => (t && t.heroLike && !t.cantAct() ? { target: t } : null);
defAbility(I('cyclone'), {
  fid: 'full', manual: true, prio: 70, ai: cycloneAI, cast: cycloneCast('modifier_item_cyclone_active', false),
  note: 'manual (never used automatically: lifting a unit also protects it from your own team). Cast on an enemy or on yourself. When the scenario lists it, the AI lifts its current enemy hero target',
});
defAbility(I('wind_waker'), {
  fid: 'approx', manual: true, prio: 70, ai: cycloneAI, cast: cycloneCast('modifier_item_wind_waker_active', true),
  note: 'manual, like Eul\'s; also castable on allies. A self-cast tornado moves at tornado_speed (300 in the data; the tooltip note says 360) towards the point given with the order (sandbox: target = yourself plus pos), otherwise it stays in place',
});

// ---------------------------------------------------------------- Force Staff / Hurricane Pike: forced movement
// The unit slides `left` units along (ux, uy) over the push time. It is not interrupted and the push cannot be dispelled.
function slide(m, step) {
  const d = m.data; const u = m.parent;
  if (step > d.left) step = d.left;
  if (step <= 0) return;
  u.x += d.ux * step; u.y += d.uy * step; d.left -= step;
}
const pushDef = {
  purge: 'none', multi: 'independent',
  interval: (m) => m.parent.world.dt,
  onThink(m) { slide(m, m.data.speed * m.interval); },
  onDestroy(m) { if (m.parent.alive) slide(m, m.data.left); },
};
modifier('modifier_item_force_staff_push', { ...pushDef });
modifier('modifier_item_hurricane_pike_push', { ...pushDef });
// "Will not work on a unit inside Chronosphere, Duel, or Black Hole": recognised by the modifiers of those abilities
const NO_FORCE = ['modifier_faceless_void_chronosphere', 'modifier_legion_commander_duel', 'modifier_enigma_black_hole'];
const forceBlocked = (t) => t.mods.some((m) => m.name !== 'modifier_legion_commander_duel_damage' && NO_FORCE.some((p) => m.name.startsWith(p)));
function push(ab, t, dir, dist, mod) {
  if (!dir || forceBlocked(t)) return;
  const nul = t.findModifier('modifier_item_nullifier');   // Nullifier: less susceptible to forced movement applied by allies
  if (nul && t.team === ab.owner.team) dist *= 1 - nul.v('knockback_reduction') / 100;
  // Tough enchantment, Knockback Resistance: forced movement from enemies moves the wearer less far (7.39 notes)
  const tough = t.team !== ab.owner.team && t.items.find((it) => it.name === E('tough') && it.slot !== 'backpack');
  if (tough) dist *= 1 - tough.v('knockback_resist') / 100;
  const time = ab.v('push_time');
  if (dist <= 0) return;
  if (!(time > 0)) { t.x += dir[0] * dist; t.y += dir[1] * dist; return; }
  t.addModifier(mod, { caster: ab.owner, ability: ab, duration: time, data: { ux: dir[0], uy: dir[1], left: dist, speed: dist / time } });
}
const selfDir = (u) => { const p = orderPoint(u); return p ? unitDir(u, p.x, p.y) : facingDir(u); };
// used only when the scenario lists the item: push yourself at a target that is out of attack range and at least one push away
const gapPush = (ab, u, t) => (t && u.rangeTo(t) > u.attackRange && u.rangeTo(t) >= ab.v('push_length') && !forceBlocked(u) ? { target: u, x: t.x, y: t.y } : null);

defAbility(I('force_staff'), {
  fid: 'approx', manual: true, prio: 100, ai: gapPush,
  note: 'manual (positioning tool). No facing in the sandbox: a unit is pushed towards what it is acting on (attack / cast target, move destination, else the nearest enemy); a self-cast order may carry a point to push towards (a point at exactly 0,0 is the engine\'s "no point" and is ignored). The longer enemy cast range (enemy_cast_range) is not used: the engine has one cast range per ability. When the scenario lists it, the AI pushes itself at a target that is at least one push away',
  cast(ab, t) {
    const u = ab.owner; const tt = t || u;
    if (forceBlocked(tt)) { refund(ab); return; }
    shareCooldown(ab);
    push(ab, tt, tt === u ? selfDir(u) : facingDir(tt), ab.v('push_length'), 'modifier_item_force_staff_push');
  },
});

// Dragon Lance family: "Attack Range bonuses from Dragon Lance and its upgrades do not stack". The engine adds every stat token,
// so the first upgrade in the inventory takes back whatever exceeds the best single bonus (same rule as in items.mjs).
const LANCE = 'item_dragon_lance';
const inLanceFamily = (it) => it.slot !== 'backpack' && (it.name === LANCE || (it.def.comps || []).includes(LANCE));
function lanceRange(it, u) {
  let r = 0; const tok = it.def.tokens || {};
  for (const k in tok) { const t = tok[k]; if (t === 'attack_range_all' || (t === 'attack_range' && !u.melee) || (t === 'attack_range_melee' && u.melee)) r += it.vals[k] || 0; }
  return r;
}
function lanceRangeFix(m, s, u) {
  const fam = u.items.filter(inLanceFamily); const first = fam.find((it) => it.name !== LANCE);
  if (fam.length < 2 || !first || first.name !== m.ability.name) return;
  let sum = 0; let best = 0;
  for (const it of fam) { const r = lanceRange(it, u); sum += r; if (r > best) best = r; }
  s.attackRange -= sum - best;
}
modifier('modifier_item_hurricane_pike', { hidden: true, apply: lanceRangeFix, onCast: onGroupCast });
// Hurricane Thrust on an enemy: attacks against that target ignore range and are faster, for a limited number of attacks
buff('modifier_item_hurricane_pike_active', {
  dynamic: true,
  stats: (m) => (m.parent.orderTarget === m.data.target ? { as: m.v('bonus_attack_speed'), attackRange: NO_RANGE } : null),
  onAttack(m, rec) { if (rec.target === m.data.target && !rec.secondary && ++m.data.n >= m.v('max_attacks')) m.remove(); },
});
defAbility(I('hurricane_pike'), {
  mods: ['modifier_item_hurricane_pike'], illusion: true, fid: 'approx', manual: true, prio: 100,
  note: 'manual (positioning tool). On an enemy within cast_range_enemy both units slide enemy_length apart and the caster gets max_attacks faster attacks without range limit against that target (the tooltip does not restrict this to ranged wielders; "no range limit" is a very large attack range). On yourself or an ally it works like Force Staff (no facing in the sandbox: see Force Staff). When the scenario lists it, a ranged AI uses it on an enemy in range and a melee AI pushes itself at a distant target',
  ai(ab, u, t) {
    if (!t) return null;
    if (!u.melee) return t.st[ST.IMMUNE] === 0 && u.distTo(t) <= ab.v('cast_range_enemy') + u.castRangeBonus && !u.hasModifier('modifier_item_hurricane_pike_active') ? { target: t } : null;
    return gapPush(ab, u, t);
  },
  cast(ab, t) {
    const u = ab.owner; const tt = t || u;
    if (tt.team === u.team) {
      if (forceBlocked(tt)) { refund(ab); return; }
      shareCooldown(ab);
      push(ab, tt, tt === u ? selfDir(u) : facingDir(tt), ab.v('push_length'), 'modifier_item_hurricane_pike_push');
      return;
    }
    // the engine walks into AbilityCastRange only; an order from beyond the shorter enemy range is refused
    if (carried(ab) && u.distTo(tt) > ab.v('cast_range_enemy') + u.castRangeBonus + 1e-6) { u.world.warn('item_hurricane_pike: enemy target beyond cast_range_enemy, cast refused'); refund(ab); return; }
    shareCooldown(ab);
    const dir = unitDir(u, tt.x, tt.y) || [1, 0];
    push(ab, tt, dir, ab.v('enemy_length'), 'modifier_item_hurricane_pike_push');
    push(ab, u, [-dir[0], -dir[1]], ab.v('enemy_length'), 'modifier_item_hurricane_pike_push');
    u.addModifier('modifier_item_hurricane_pike_active', { caster: u, ability: ab, duration: ab.v('range_duration'), data: { target: tt, n: 0 } });
  },
});

// ---------------------------------------------------------------- Lotus Orb: Echo Shell
// Re-casts a targeted spell at its caster by running that spell's script for the shielded unit (same level, the shield
// holder's stats and talents). The original spell still hits the shielded unit.
// A foreign script may look up other abilities of "its" hero or fail in some other way when it runs for the shield holder.
// While the re-cast runs (and whenever a timer or projectile it scheduled fires) the holder's lookups of abilities it does not
// have return value copies at the original caster's levels, and a script error becomes a warning instead of ending the simulation.
function swapProp(obj, key, value) {
  const own = Object.prototype.hasOwnProperty.call(obj, key); const old = obj[key];
  obj[key] = value;
  return () => { if (own) obj[key] = old; else delete obj[key]; };
}
// an ability of `real`'s kind and level that belongs to `holder` but is not in its ability list: a value container, never cast by the AI
function valueCopy(holder, real) {
  const c = holder.addAbility(real.name, 0);
  const i = holder.abilities.indexOf(c);
  if (i >= 0) holder.abilities.splice(i, 1);
  c.level = real.level; c.isItem = real.isItem; c.ai = false;
  c.refresh();
  return c;
}
function guarded(echo, fn) {
  return function run(...args) {
    const { holder, caster, siblings } = echo;
    const w = holder.world; const find = Object.getPrototypeOf(holder).findAbility; const after = w.after; const projectile = w.projectile;
    const lookup = (n) => {
      const own = find.call(holder, n);
      if (own || siblings.has(n)) return own || siblings.get(n);
      const real = find.call(caster, n); const c = real ? valueCopy(holder, real) : null;
      siblings.set(n, c);
      return c;
    };
    const undo = [
      swapProp(holder, 'findAbility', lookup),
      swapProp(w, 'after', (delay, f) => after.call(w, delay, guarded(echo, f))),
      swapProp(w, 'projectile', (s, t, speed, f) => projectile.call(w, s, t, speed, guarded(echo, f))),
    ];
    try { return fn(...args); } catch (e) { w.warn(`item_lotus_orb: re-cast of ${echo.name} failed (${e.message})`); return undefined; } finally { for (const u of undo.reverse()) u(); }
  };
}
function echoSpell(holder, src, caster) {
  const w = holder.world;
  const copy = valueCopy(holder, src);
  // the reflected spell can itself be blocked (Linken's Sphere) but is never reflected again
  const ev = { ability: copy, caster: holder, target: caster, blocked: false, reflected: true };
  for (const m of caster.hooks.onSpellTargeted.slice()) if (!m.removed && !(m.brk && caster.st[ST.BREAK] > 0)) m.def.onSpellTargeted(m, ev);
  if (ev.blocked) return;
  if (w.log) w.logEvent('reflect', holder, caster, src.name, 0);
  const echo = { holder, caster, name: src.name, siblings: new Map([[src.name, copy]]) };
  guarded(echo, () => src.script.cast(copy, caster, caster.x, caster.y))();
}
buff('modifier_item_lotus_orb_active', {
  onSpellTargeted(m, ev) {
    const src = ev.ability; const sc = src.script; const c = ev.caster;
    if (ev.reflected || !sc || !sc.cast || sc.noBlock || sc.channel || (src.isItem && src.def.artifact)) return;
    if (!c.alive || !c.targetable() || (c.st[ST.IMMUNE] > 0 && !src.pierces)) return;
    echoSpell(m.parent, src, c);
  },
});
defAbility(I('lotus_orb'), {
  fid: 'approx', prio: 60,
  note: 'the re-cast runs the spell\'s own script for the shielded unit at the same level (the holder\'s stats and talents; other abilities the script reads are taken at the original caster\'s levels). Not reflected: channelled spells, Soul Release (urn family), neutral item spells. A script that cannot run for another caster gives a warning; errors inside modifiers it created are not caught. Basic dispel on cast. AI: cast on itself when the target is within the item\'s cast range',
  ai: (ab, u, t) => (t && u.distTo(t) <= ab.castRange() && !u.hasModifier('modifier_item_lotus_orb_active') ? { target: u } : null),
  cast(ab, t) { const tt = t || ab.owner; tt.purge({ debuffs: true }); addMod(ab, tt, 'modifier_item_lotus_orb_active', ab.v('active_duration')); },
});

// ---------------------------------------------------------------- Meteor Hammer / Starforge
// Mana Regen Amplification does not stack between Kaya-based items (7.37b notes): only the best equipped one counts
function kayaRegenAmp(m) {
  let best = null;
  for (const it of m.parent.items) { const v = it.vals.mana_regen_multiplier; if (it.slot === 'backpack' || !(v > 0)) continue; if (!best || v > best.vals.mana_regen_multiplier) best = it; }
  return best && best.name === m.ability.name ? best.vals.mana_regen_multiplier : 0;
}
const meteorStats = (m) => ({ spellAmp: m.v('spell_amp'), manaRegenAmp: kayaRegenAmp(m) });
const toBuilding = (src, e) => (e.isBuilding ? src.v('building_damage_pct') / 100 : 1);
const meteorBurn = (name) => debuff(name, ticking((m) => mhit(m, m.parent, m.v('burn_dps_units') * m.v('burn_interval') * toBuilding(m, m.parent), MAGICAL), {
  interval: (m) => m.v('burn_interval'), stats: (m) => ({ msPct: -m.v('burn_slow') }),
}));
function meteorStrike(ab, x, y, burnMod) {
  const w = ab.owner.world;
  w.after(ab.v('land_time'), () => {
    for (const e of enemiesNear(ab, x, y, ab.v('impact_radius'))) {
      if (!e.isBuilding) stun(ab, e, ab.v('stun_duration'));
      addMod(ab, e, burnMod, ab.v('burn_duration'));
      // Starforge: non-building units also take a share of their max health (the value does not exist on Meteor Hammer)
      const pctHp = e.isBuilding ? 0 : e.maxHp * ab.v('impact_damage_units_pct_health') / 100;
      hit(ab, e, (ab.v('impact_damage_units') + pctHp) * toBuilding(ab, e), MAGICAL);
    }
  });
}
const meteorItem = (item, fid, note) => defAbility(I(item), {
  mods: [`modifier_item_${item}`], fid, note, prio: 45, channel: true,
  // aim at where the target will stand when the meteor lands (channel + landing time)
  ai: (ab, u, t) => (t && !t.hasModifier(`modifier_item_${item}_burn`) ? leadPos(t, ab.v('AbilityChannelTime') + ab.v('land_time')) : null),
  cast(ab, t, x, y) { shareCooldown(ab); ab.data = { x, y }; },
  channelEnd(ab, interrupted) { if (!interrupted && ab.data) meteorStrike(ab, ab.data.x, ab.data.y, `modifier_item_${item}_burn`); },
});
meteorBurn('modifier_item_meteor_hammer_burn');
modifier('modifier_item_meteor_hammer', { hidden: true, stats: meteorStats });
meteorItem('meteor_hammer', 'full', 'an interrupted channel summons nothing. AI: channelled at the point where its target is heading');

// Starforge passive, Celestial Flare: when a disable cast by the wearer ends on an enemy, that enemy burns and is slowed.
// The engine has no "modifier ended" event, so the wearer watches its own disabling modifiers on enemies every tick.
const DISABLE_STATES = [ST.STUN, ST.HEX, ST.TAUNT, ST.FEAR, ST.SLEEP, ST.OUT];
const isDisable = (def) => def._state.some((s) => DISABLE_STATES.includes(s));
debuff('modifier_item_starforge_flare', ticking((m) => mhit(m, m.parent, m.v('burn_per_second') * m.v('passive_burn_interval'), MAGICAL), {
  interval: (m) => m.v('passive_burn_interval'), stats: (m) => ({ msPct: -m.v('slow_pct') }),
}));
meteorBurn('modifier_item_starforge_burn');
modifier('modifier_item_starforge', {
  hidden: true, stats: meteorStats,
  interval: (m) => m.parent.world.dt,
  onCreated(m) { m.data = { seen: new Set() }; },
  onThink(m) {
    const u = m.parent; const seen = m.data.seen;
    for (const d of seen) {
      if (!d.removed) continue;
      seen.delete(d);
      const e = d.parent;
      if (e.alive && !e.isBuilding && e.team !== u.team) e.addModifier('modifier_item_starforge_flare', { caster: u, ability: m.ability, duration: m.v('passive_debuff_duration') });
    }
    const us = u.world.units;
    for (let i = 0; i < us.length; i++) {
      const e = us[i];
      if (!e.alive || e.team === u.team) continue;
      const ms = e.mods;
      for (let k = 0; k < ms.length; k++) { const d = ms[k]; if (d.caster === u && !seen.has(d) && isDisable(d.def)) seen.add(d); }
    }
  },
});
meteorItem('starforge', 'approx', 'Meteor Hammer as above. Celestial Flare is found by watching, every tick, the wearer\'s own modifiers on enemies that stun, hex, taunt, fear, sleep or remove from play (cyclone, banish); "Hypnosis" counts only if its script uses one of those states. The flare starts one tick after the disable ends');

// ---------------------------------------------------------------- Consecrated Wraps: Hallowed
barrier('modifier_item_consecrated_wraps_barrier', 'all', { onRefresh(m, o) { if (o && o.data && o.data.left > m.data.left) m.data.left = o.data.left; } });
buff('modifier_item_consecrated_wraps_haste', { stats: { msPct: 'movement_speed_pct_on_stack_gain' } });
modifier('modifier_item_consecrated_wraps', {
  hidden: true,
  interval: (m) => m.parent.world.dt,
  onCreated(m) { m.ability.chargeEnd = Infinity; },   // charges are kept by this script, not by the engine's charge timer
  onThink(m) {
    // m.x = time of the next charge (0 while the timer is idle at full charges)
    const ab = m.ability; const u = m.parent; const w = u.world; const max = m.v('AbilityCharges');
    if (ab.charges >= max) { m.x = 0; return; }
    if (m.x === 0) { m.x = w.time + m.v('AbilityChargeRestoreTime'); return; }
    if (w.time + 1e-9 < m.x) return;
    ab.charges++;
    m.x = ab.charges < max ? w.time + m.v('AbilityChargeRestoreTime') : 0;
    u.addModifier('modifier_item_consecrated_wraps_haste', { ability: ab, duration: m.v('duration') });
  },
  onTakeDamage(m, d) {
    const u = m.parent; const s = d.src;
    if (!s || s === u || s.team === u.team || (d.flags & F_HP_LOSS) || d.dealt <= m.v('stack_threshold_damage') || !(playerOwned(s) || isRoshan(s))) return;
    m.x = u.world.time + m.v('AbilityChargeRestoreTime');   // no charge for a full restore interval after such damage
    const ab = m.ability;
    if (ab.charges < 1) return;
    giveBarrier(ab, u, 'modifier_item_consecrated_wraps_barrier', ab.charges * m.v('barrier_per_stack'), m.v('duration'));
    ab.charges = 0;
  },
});
defAbility(I('consecrated_wraps'), {
  mods: ['modifier_item_consecrated_wraps'], fid: 'approx',
  note: 'the barrier is granted right after the damage instance that triggers it (that instance is not absorbed); a new barrier while one is active keeps the larger amount. Charges: item option "charges" (default: full)',
});

// ---------------------------------------------------------------- Crella's Crozier: Putrefaction Aura, Rite of Rumusque
const riteOn = (c) => c.alive && c.hasModifier('modifier_item_crellas_crozier_active');
const putrefaction = (m) => (riteOn(m.caster) ? m.v('active_health_steal') : m.v('health_steal'));
// health an enemy lost to the aura, per point of health it still restored
const lostPerGained = (m) => { const k = putrefaction(m) / 100; return k < 1 ? k / (1 - k) : 0; };
debuff('modifier_item_crellas_crozier_aura', {
  pierce: true, purge: 'none', statusResist: false,
  stats: (m) => ({ restore: -putrefaction(m) }),
  interval: (m) => m.v('interval'),
  // m.x = health restoration this enemy lost to the aura while the Rite is active; handed to the wearer every interval
  onHealed(m, ev) { if (riteOn(m.caster)) m.x += ev.amount * lostPerGained(m); },
  onThink(m) {
    const e = m.parent; const c = m.caster;
    if (riteOn(c) && e.hp < e.maxHp && e.hpRegen > 0) m.x += e.hpRegen * m.interval * lostPerGained(m);
    if (m.x > 0 && c.alive) c.heal(m.x, c, m.ability);
    m.x = 0;
  },
});
// Rite of Rumusque has two parts on the wearer (7.41 notes: the ghost form and the stolen speed can be dispelled, the stealing
// cannot): the Rite itself (steals movement speed every interval, raises the aura) and the ghost form (ends on debuff immunity).
// [L] measured in Hero Demo: one stacking debuff / buff (a stack per steal, every steal refreshes stack_duration for all stacks)
debuff('modifier_item_crellas_crozier_slow', { multi: 'stack', purge: 'none', stats: (m) => ({ msPct: -m.v('movespeed_steal_pct') * m.stacks }) });
buff('modifier_item_crellas_crozier_haste', { multi: 'stack', stats: (m) => ({ msPct: m.v('movespeed_steal_pct') * m.stacks }) });
function riteSteal(m) {
  const u = m.parent; const o = { caster: u, ability: m.ability, duration: m.v('stack_duration'), stacks: 1 };
  for (const e of u.world.enemiesInRadius(u, u.x, u.y, m.v('active_radius'))) {
    if (!e.heroLike) continue;
    if (e.addModifier('modifier_item_crellas_crozier_slow', o)) u.addModifier('modifier_item_crellas_crozier_haste', o);
  }
}
const touchAura = (m) => { for (const e of m.parent.world.units) if (e.alive && e.hasModifier('modifier_item_crellas_crozier_aura')) e.dirty = true; };
modifier('modifier_item_crellas_crozier_active', {
  purge: 'none',
  interval: (m) => m.v('interval'), thinkNow: true,
  onCreated(m) { touchAura(m); },
  onThink: riteSteal,
  // [L] measured in Hero Demo: a steal also on the tick the Rite ends (duration 4, interval 1: 5 steals)
  onDestroy(m, expired) { if (expired && m.parent.alive) riteSteal(m); touchAura(m); },
});
buff('modifier_item_crellas_crozier_ghost', {
  state: ['ETHEREAL', 'DISARM'],
  stats: (m) => ({ magicTakenPct: -m.v('extra_spell_damage_percent') }),
  interval: (m) => m.parent.world.dt,
  onThink(m) { if (m.parent.st[ST.IMMUNE] > 0) m.remove(); },   // ghost form ends when the wearer becomes debuff immune
});
aura('modifier_item_crellas_crozier', {
  radius: 'radius', team: 'enemy', child: 'modifier_item_crellas_crozier_aura', filter: (t) => t.heroLike,
  extra: {
    // m.x / m.y = physical / other damage taken from enemies so far (the AI enters ghost form against mostly physical damage)
    onTakeDamage(m, d) { if (!d.src || d.src.team === m.parent.team) return; if (d.type === C.PHYSICAL) m.x += d.dealt; else m.y += d.dealt; },
    onCast: onGroupCast,
  },
});
defAbility(I('crellas_crozier'), {
  mods: ['modifier_item_crellas_crozier'], fid: 'approx', prio: 65,
  note: 'movement speed is stolen at activation, every interval and on the tick the Rite ends (measured); each steal adds a stack to one debuff on the enemy and one buff on the wearer and refreshes their stack_duration. Lost Health Restoration is redirected only during the Rite and is computed from what each enemy hero actually restored (regeneration, heals, lifesteal). Debuff immunity ends (or prevents) the ghost form only; the steal and the raised aura run the full duration (7.41 notes). AI: used below 50% health when most damage taken so far was physical and an enemy hero is in range',
  ai(ab, u) {
    const m = ab.mods[0];
    if (!m || u.st[ST.IMMUNE] > 0 || u.hp / u.maxHp >= 0.5 || m.x <= m.y || u.hasModifier('modifier_item_crellas_crozier_active')) return null;
    return u.world.enemiesInRadius(u, u.x, u.y, ab.v('active_radius')).some((e) => e.heroLike) ? { target: null } : null;
  },
  cast(ab) {
    const u = ab.owner;
    shareCooldown(ab);
    addMod(ab, u, 'modifier_item_crellas_crozier_active', ab.v('duration'));
    if (u.st[ST.IMMUNE] === 0) addMod(ab, u, 'modifier_item_crellas_crozier_ghost', ab.v('duration'));   // no ghost form when already debuff immune
  },
});

// ---------------------------------------------------------------- Soul Ring: Sacrifice (the health cost is paid by the engine)
// data = { extra: mana that did not fit into the pool (temporary max mana), left: gained mana not spent yet, last: mana seen last tick }
buff('modifier_item_soul_ring_buff', {
  purge: 'none',
  stats: (m) => ({ mana: m.data.extra }),
  interval: (m) => m.parent.world.dt,
  onThink(m) { const u = m.parent; const d = m.data; if (u.mana < d.last) d.left = Math.max(0, d.left - (d.last - u.mana)); d.last = u.mana; },
  onDestroy(m) {
    const u = m.parent; const d = m.data;
    if (!u.alive) return;
    if (u.mana < d.last) d.left = Math.max(0, d.left - (d.last - u.mana));
    const mana = u.mana;
    u.recompute();                                                  // max mana drops back
    u.mana = Math.max(0, Math.min(u.maxMana, mana - d.left));       // what was not used is lost
  },
});
const offCooldown = (a) => (a.vals.AbilityCharges > 0 ? a.charges > 0 : a.cdReady());
defAbility(I('soul_ring'), {
  fid: 'approx', prio: 95,
  note: 'gained mana is spent first and the unspent part disappears when the buff ends; spending is followed by comparing the mana pool every tick. AI: used when a learned ability is off cooldown, unaffordable now and affordable with the extra mana, and health is above twice the cost',
  ai(ab, u, t) {
    if (!t || u.hp <= 2 * ab.v('AbilityHealthCost') || u.hasModifier('modifier_item_soul_ring_buff')) return null;
    const gain = ab.v('mana_gain');
    for (const a of u.abilities) {
      if (a.level < 1 || a.passive || !a.script || !a.script.cast || !offCooldown(a)) continue;
      const c = a.manaCost();
      if (c > u.mana && c <= u.mana + gain) return { target: null };
    }
    return null;
  },
  cast(ab) {
    const u = ab.owner;
    healthCostHit(ab);
    u.removeModifierByName('modifier_item_soul_ring_buff');
    if (u.dirty) u.recompute();
    const gain = ab.v('mana_gain'); const before = u.mana;
    const m = u.addModifier('modifier_item_soul_ring_buff', { ability: ab, duration: ab.v('duration'), data: { extra: Math.max(0, before + gain - u.maxMana), left: gain, last: 0 } });
    u.recompute();                                   // the mana pool grows by what did not fit
    u.mana = Math.min(u.maxMana, before + gain);
    m.data.last = u.mana;
  },
});

// ---------------------------------------------------------------- Tranquil Boots: Respite
// The stat tokens give the unbroken bonuses; while broken this modifier lowers them to the broken values.
function bootsBonus(it, u) {   // movement speed a pair of boots adds for this unit (same rule as the engine)
  let best = 0; const tok = it.def.tokens || {};
  for (const k in tok) {
    if (tok[k] !== 'move_speed' || (/_melee$/.test(k) && !u.melee) || (/_ranged$/.test(k) && u.melee)) continue;
    if (it.vals[k] > best) best = it.vals[k];
  }
  const v = u.melee ? it.vals.bonus_movement_speed_melee : it.vals.bonus_movement_speed_ranged;
  return v > best ? v : best;
}
modifier('modifier_item_tranquil_boots_broken', {
  purge: 'none',
  apply(m, s, u) {
    const ab = m.ability;
    s.hpRegen += ab.v('broken_health_regen') - ab.v('bonus_health_regen');
    let other = 0;   // boots do not stack: the best other pair still counts
    for (const it of u.items) if (it.isBoots && it.name !== ab.name && it.slot !== 'backpack') other = Math.max(other, bootsBonus(it, u));
    s.msBoots = Math.max(other, ab.v('broken_movement_speed'));
  },
});
const respite = (m) => m.parent.addModifier('modifier_item_tranquil_boots_broken', { ability: m.ability, duration: m.v('break_time') });
passive(I('tranquil_boots'), {
  fid: 'full', illusion: true,
  note: 'broken for break_time by every attack of the wearer that lands on a hero and by every attack that lands on the wearer',
  onAttackLanded(m, rec) { if (rec.target.heroLike) respite(m); },
  onAttacked(m) { respite(m); },
});

// ---------------------------------------------------------------- Shadow Amulet: Fade
modifier('modifier_item_shadow_amulet_invis', { hidden: true, state: ['INVIS'], purge: 'none' });
buff('modifier_item_shadow_amulet_fade', {
  stats: (m) => ({ msPct: -m.v('movement_speed_reduction') }),
  interval: (m) => m.v('fade_time'),
  onThink(m) { if (m.z) return; m.z = 1; m.parent.addModifier('modifier_item_shadow_amulet_invis', { caster: m.caster, ability: m.ability, duration: m.remaining() }); },
  onAttack(m) { m.remove(); },
  onCast(m, ev) { if (ev.ability !== m.ability) m.remove(); },
  onDestroy(m) { m.parent.removeModifierByName('modifier_item_shadow_amulet_invis'); },
});
defAbility(I('shadow_amulet'), {
  fid: 'approx', manual: true,
  note: 'manual: invisibility only matters when the scenario turns detection off (rules.detectAll = false). The unit is invisible after fade_time; the slow lasts the whole buff; attacking or casting ends it (general invisibility rule, not in the tooltip). When the scenario lists it, the AI uses it on itself below 30% health',
  ai: (ab, u) => (u.hp / u.maxHp < 0.3 && !u.hasModifier('modifier_item_shadow_amulet_fade') ? { target: u } : null),
  cast(ab, t) { addMod(ab, t || ab.owner, 'modifier_item_shadow_amulet_fade', ab.v('fade_duration')); },
});

// ---------------------------------------------------------------- neutral enchantments
// Values are per enchantment level (scenario: neutral: [{ name: 'enhancement_crude', level: 2 }]). The enchantment tooltips are
// stat lines only; "+$stat" lines are applied by the engine, the lines below are the ones without a stat token.
// "-x% Base Attack Time": applied on top of whatever sets the base attack time
const batReduce = (key) => function late(m, s, u) {
  const base = s.bat > 0 ? s.bat : (u.ovr && u.ovr.bat !== undefined ? u.ovr.bat : u.def.bat);
  s.bat = base * (1 - m.v(key) / 100);
};
// "-x% Attack Speed": a share of the unit's total attack speed
const attackSpeedPct = (key) => function late(m, s, u) {
  const total = u.def.baseAs + C.AS_PER_AGI * u.agi + s.as + s.asSlow;
  if (total > 0) s.asSlow -= total * Math.abs(m.v(key)) / 100;
};

passive(E('audacious'), {
  fid: 'approx', illusion: true,
  note: '"+Magic Attack Damage" is dealt as a separate magical hit on every attack of the wearer that lands (not by illusions, not on buildings: the stat line says no more); +% incoming damage applies to all damage',
  stats: { dmgTaken: 'incoming_damage' },
  onAttackLanded(m, rec) { const t = rec.target; if (!m.parent.isIllusion && t.alive && !t.isBuilding) mhit(m, t, m.v('magic_damage'), MAGICAL); },
});
passive(E('mystical'), {
  fid: 'partial', illusion: true,
  note: 'level 3 "Mana Cost/Mana Loss Reduction": the mana cost half is modelled, mana lost to enemy mana burn is not reduced (no engine hook)',
  stats: { manaCostRed: 'manacost_reduction' },
});
defAbility(E('alert'), { fid: 'full', note: 'attack speed and attack range are stat tokens; night vision has no effect in the sandbox' });
defAbility(E('tough'), { fid: 'partial', note: 'damage and armor are stat tokens; level 3 Knockback Resistance (forced movement from enemies moves the wearer 40% less far, 7.39 notes) is honoured only by Force Staff and Hurricane Pike: the engine\'s generic knockback has no resistance' });
passive(E('feverish'), { fid: 'full', illusion: true, stats: { manaPct: neg('max_mana') } });
passive(E('crude'), {
  fid: 'approx', illusion: true,
  note: 'Health Restoration multiplies all healing received (regeneration, lifesteal, heals); "-% Intelligence" removes that share of the intelligence the hero has from level, items and earlier modifiers (attribute buffs gained later in the fight are not reduced)',
  apply(m, s, u) {
    s.restoreMul *= 1 + m.v('health_restoration') / 100;
    if (!u.isHero) return;
    const int = u.baseAttr('int') + u.attrLevels * 2 + s.int + (u.attr === 'str' || u.attr === 'agi' ? 0 : s.primary);
    if (int > 0) s.int -= int * Math.abs(m.v('intelligence_pct')) / 100;
  },
  late: batReduce('bat_reduce'),
});
passive(E('timeless'), { fid: 'full', illusion: true, stats: { spellAmp: 'spell_amp' } });
passive(E('greedy'), { fid: 'full', illusion: true, note: 'gold per minute has no effect in the sandbox', stats: { dmg: neg('bonus_damage') } });
defAbility(E('vampiric'), { fid: 'full', note: 'lifesteal and spell lifesteal are stat tokens; night vision has no effect in the sandbox' });
passive(E('keen_eyed'), { fid: 'full', illusion: true, stats: { manaPct: neg('mana_reduction_pct') } });
passive(E('evolved'), {
  fid: 'approx', illusion: true,
  note: 'Item Potency is added for the wearer only: illusions keep their own Item Potency (not stated whether the bonus carries over). Universal heroes get primary_stat_universal to each attribute instead of the token value',
  stats(m) {
    const u = m.parent;
    return { potency: u.isIllusion ? 0 : m.v('bonus_potency'), primary: u.attr === 'all' ? m.v('primary_stat_universal') - m.v('primary_stat') : 0 };
  },
});
passive(E('titanic'), {
  fid: 'approx', illusion: true,
  note: '"-% Attack Speed" is taken as a share of the total attack speed (the stat line gives no formula); base attack damage counts as % of base damage',
  stats: { dmgBasePct: 'base_attack_damage' },
  late: attackSpeedPct('attack_speed'),
});
passive(E('hulking'), {
  fid: 'approx', illusion: true,
  note: '"-% Attack Speed" is taken as a share of the total attack speed (the stat line gives no formula)',
  stats: { hpRegenPct: 'max_health_regen' },
  late: attackSpeedPct('attack_speed'),
});
passive(E('manic'), {
  fid: 'partial', illusion: true,
  note: 'base attack time reduction is modelled; "+20% Cast Speed Bonus" is not (the engine has no cast-speed stat); vision has no effect in the sandbox',
  late: batReduce('bat_reduce'),
});
passive(E('nimble'), {
  fid: 'approx', illusion: true,
  note: 'the health regeneration penalty is taken from flat regeneration (base, strength, bonuses) and cannot push that part below zero',
  late(m, s, u) {
    const flat = (u.ovr && u.ovr.hpRegen !== undefined ? u.ovr.hpRegen : u.def.hpRegen) + C.HP_REGEN_PER_STR * u.str + s.hpRegen;
    s.hpRegen -= Math.min(Math.abs(m.v('hp_regen_reduce')), Math.max(0, flat));
  },
});
