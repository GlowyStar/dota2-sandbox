// Hero abilities, part 6: Meepo, Techies, Ringmaster, Batrider, Disruptor, Keeper of the Light, Naga Siren, Razor, Tusk, Underlord,
// Leshrac, Skywrath Mage (+ the one ability carried by a unit they summon).
// Every number is read from the shipped data by value name. Literals are tick intervals, AI thresholds and geometry approximations only;
// each one that changes an outcome is explained in the `note` of the ability that uses it.
import { defAbility, modifier, buff, debuff, passive, selfBuff, hit, addMod, stun, fear, enemiesNear, enemiesInLine, knockback, mhit, aura, chain, summon,
  ST, PHYSICAL, MAGICAL, PURE, F_ATTACK, F_NO_AMP, F_REFLECT, F_HP_LOSS, F_NON_LETHAL } from '../engine/dsl.mjs';

const na = (name, note) => defAbility(name, { fid: 'n/a', note });
const NOW = { target: null };                                   // ai answer: cast a no-target ability now (range already checked)
const hyp = (dx, dy) => Math.sqrt(dx * dx + dy * dy);
const PAD = 0.05;                                               // the engine expires a modifier before it thinks, so periodic debuffs last this much longer to keep their last tick
const missed = (w) => w.skillshotHit < 1 && !w.rng.chance(w.skillshotHit);   // scenario rule `skillshotHit` for aimed / delayed point spells
const blocked = (ab, t) => t.team !== ab.owner.team && t.st[ST.IMMUNE] > 0 && !ab.pierces;
const foe = (ab, t) => (t && !blocked(ab, t) ? { target: t } : null);          // unit-target decision that does not retry against debuff immunity
const curTarget = (u, r) => (u.ai && u.ai.target && u.ai.target.alive ? u.ai.target : u.world.nearestEnemy(u, r));
// Aim point for delayed point spells: where `t` will be after `secs` if it keeps walking towards the unit it is attacking.
function lead(t, secs) {
  const o = t.orderTarget; const st = t.st;
  if (!o || !o.alive || !(secs > 0) || !(t.ms > 0) || st[ST.STUN] > 0 || st[ST.SLEEP] > 0 || st[ST.OUT] > 0 || st[ST.ROOT] > 0 || st[ST.FEAR] > 0) return t;
  const dx = o.x - t.x; const dy = o.y - t.y; const d = hyp(dx, dy);
  const go = Math.min(t.ms * secs, d - (t.attackRange + t.def.hull + o.def.hull));
  return go > 1 ? { x: t.x + dx / d * go, y: t.y + dy / d * go } : t;
}

// Calls fn(k) at first, first + iv, first + 2 iv ... (first = 0: right now) until it returns false. Runs on world timers, so it keeps going
// when the caster dies (mines, fire trails, storms).
function every(w, iv, fn, first = iv) {
  if (!(iv > 0)) iv = w.dt;
  const t0 = w.time + first; let k = 0;
  const step = () => {
    while (t0 + k * iv <= w.time + 1e-9) if (fn(k++) === false) return;
    w.after(Math.max(t0 + k * iv - w.time, w.dt / 2), step);
  };
  if (first > 0) w.after(first, step); else step();
}
// Like `every`, but each step is armed when the previous one fired (a thinker that returns its interval): an interval that is not a
// whole number of ticks is rounded up to the next tick every time, as in the game. fn(k) runs now (k = 0) and returns false to stop.
function pulse(w, iv, fn) {
  let k = 0;
  const step = () => { if (fn(k++) !== false) w.after(iv, step); };
  step();
}
// A cast the game would have refused (invalid target point): gives back what the engine charged before it called the script.
function refuse(ab) {
  const u = ab.owner; const w = u.world;
  if (w.freeSpells) return;
  u.mana = Math.min(u.maxMana, u.mana + ab.manaCost());
  if (ab.vals.AbilityCharges > 0) { ab.charges = Math.min(ab.vals.AbilityCharges, ab.charges + 1); if (ab.charges >= ab.vals.AbilityCharges) ab.chargeEnd = 0; }
  ab.cdEnd = 0;
}
// Forced movement: the unit is displaced at once and cannot act for `dur` (the stated knockback / air time). Returns false when it is immune.
function shove(ab, e, fromX, fromY, dist, dur, mod) {
  if (e.isBuilding || !e.alive) return false;
  if (dur > 0 && !addMod(ab, e, mod, dur)) return false;
  knockback(e, fromX, fromY, dist);
  return true;
}
const airborne = (name, extra) => debuff(name, { state: ['STUN'], statusResist: false, purge: 'none', ...extra });
// The engine reads cast point, cast range and "pierces debuff immunity" from the standard slots only. Where 7.42 moves one of them through
// another value (talent or Scepter), a hidden intrinsic modifier copies it into the standard slot every time the values are refreshed.
function sync(ability, fn) {
  modifier('modifier_' + ability + '_sync', { hidden: true, purge: 'none', apply(m) { fn(m.ability, m); } });
  return 'modifier_' + ability + '_sync';
}
// A no-target area ability has no cast range, so the default controller would never walk a ranged hero into its area. Answering with a
// point and giving the ability a cast range for this order (the area minus a margin) makes the engine walk there before it casts.
function closeIn(ab, u, t, reach) { ab.vals.AbilityCastRange = Math.max(1, reach - u.castRangeBonus); return { x: t.x, y: t.y }; }
// Charge abilities: the engine does not hold back the next charge for the ability's own (short) cooldown, so the script does.
const chargeGap = (ab) => { const w = ab.owner.world; if (!w.freeSpells) ab.cdEnd = w.time + ab.cooldown(); };
// units of `team` whose hull touches the segment (x1,y1)-(x2,y2) of full width `width`; calls fn(unit, distance along the segment)
function alongLine(w, team, x1, y1, x2, y2, width, fn) {
  const vx = x2 - x1; const vy = y2 - y1; const len = hyp(vx, vy) || 1; const ux = vx / len; const uy = vy / len;
  for (const e of w.units) {
    if (!e.alive || e.team !== team || e.st[ST.OUT] > 0) continue;
    const a = Math.max(0, Math.min(len, (e.x - x1) * ux + (e.y - y1) * uy));
    if (hyp(x1 + ux * a - e.x, y1 + uy * a - e.y) <= width / 2 + e.def.hull) fn(e, a);
  }
}

// ================================================================ Meepo
// Divided We Stand: every clone is a real hero unit made with world.summon (not an illusion): same level, skill build, talents, Scepter / Shard
// and item list as the prime Meepo, with its own health, mana, cooldowns and controller. Its damage is credited to the prime Meepo (engine rule
// for summons).
const meepoPrime = (u) => (u.isSummon && !u.isIllusion && u.owner && u.owner.name === u.name ? u.owner : u);
function meepos(u) {
  const p = meepoPrime(u); const out = [];
  for (const o of u.world.units) if (o.alive && !o.isIllusion && o.name === p.name && (o === p || (o.isSummon && o.owner === p))) out.push(o);
  return out;
}
// item bonuses that are split between the Meepos (tooltip: damage, attack speed, health, mana, regeneration), by the stat token of the item value
const MEEPO_SPLIT = { damage: 'dmg', attack: 'as', health: 'hp', mana: 'mana', hp_regen: 'hpRegen', mana_regen: 'manaRegen' };
function meepoItemShare(m, s, u) {
  const pen = m.v('dps_penalty_pct') / 100;
  if (!(pen > 0)) return;
  for (const it of u.items) {
    const tok = it.def.tokens;
    if (!tok || it.slot === 'backpack') continue;
    for (const vn in tok) { const k = MEEPO_SPLIT[tok[vn]]; if (k !== undefined) s[k] -= it.v(vn) * pen; }
  }
}
function meepoCopy(u, c) {
  const w = u.world;
  const hpK = c.hp / c.maxHp; const mpK = c.maxMana > 0 ? c.mana / c.maxMana : 1;
  const skills = {}; for (const a of u.abilities) skills[a.name] = a.level;
  c.setLevel(u.level, { skills }); c.attrLevels = u.attrLevels;
  if (c.talents.size !== u.talents.size) c.setTalents([...u.talents]);
  if (c.hasScepter !== u.hasScepter || c.hasShard !== u.hasShard) c.setUpgrades(u.hasScepter, u.hasShard);
  for (const a of c.abilities) { const pa = u.findAbility(a.name); if (pa && a.level !== pa.level) { if (pa.maxLevel > a.maxLevel) a.maxLevel = pa.maxLevel; a.setLevel(pa.level); } }
  while (c.items.length) c.removeItem(c.items[0].name);
  for (const it of u.items) { const n = c.addItem(it.name, { level: it.level, slot: it.slot, attr: it.attr }); if (n) n.ai = false; }   // only the prime Meepo uses active items
  if (w.makeAI) {
    if (u.ai) { c.ai = w.makeAI({ mode: u.ai.mode, focus: u.ai.focus, abilities: u.ai.abilities, items: 'none', order: u.ai.order, retarget: u.ai.retarget }); c.ai.fixedTarget = u.ai.fixedTarget; }
    else c.ai = null;
  }
  c.recompute(); c.hp = Math.max(1, c.maxHp * hpK); c.mana = c.maxMana * mpK;
}
function meepoSync(m) {
  const u = m.parent; const w = u.world; const ab = m.ability;
  // The shipped ability has max_level levels, learned every levels_between_upgrades hero levels from required_level; the engine stops
  // ultimates at 3, so the last level is added here once the hero level allows it.
  const max = ab.v('max_level');
  if (max > ab.maxLevel) ab.maxLevel = max;
  const due = Math.min(max, 1 + Math.floor((u.level - ab.v('required_level')) / Math.max(1, ab.v('levels_between_upgrades'))));
  if (ab.level >= 3 && due > ab.level) ab.setLevel(due);
  const fl = u.findAbility('meepo_fling_release');                 // Fling is linked to Divided We Stand and shares its level
  if (fl) { const lv = u.hasShard ? ab.level : 0; if (fl.level !== lv) fl.setLevel(lv); }
  const clones = meepos(u).filter((c) => c !== u);
  let grown = false;
  for (let i = clones.length; i < ab.v('tooltip_clones'); i++) {
    const a = (i + 1) * 2.4;                                       // spread the clones around the prime Meepo
    const c = summon(ab, u.name, { x: u.x + 80 * Math.cos(a), y: u.y + 80 * Math.sin(a), level: u.level });
    clones.push(c); grown = true;
  }
  let sig = ((u.level * 31 + u.items.length) * 31 + u.talents.size) * 4 + (u.hasScepter ? 2 : 0) + (u.hasShard ? 1 : 0);
  for (const a of u.abilities) sig = sig * 7 + a.level;
  if (grown || sig !== m.x || u.ai !== m.data) {
    m.x = sig; m.data = u.ai;
    for (const c of clones) { meepoCopy(u, c); c.dirty = true; }
    u.dirty = true;
  }
}
modifier('modifier_meepo_divided_we_stand', {
  hidden: true, purge: 'none', interval: 0.5, thinkNow: true, apply: meepoItemShare,
  onThink(m) { if (!m.parent.isSummon) meepoSync(m); },
  onAnyDeath(m, ev) { const u = m.parent; const v = ev.victim; if (v !== u && u.alive && !v.isIllusion && v.name === u.name && meepoPrime(v) === meepoPrime(u)) u.world.kill(u, ev.killer, ev.ability, true); },
  onDestroy(m) { const u = m.parent; if (u.alive && !u.isSummon) for (const c of meepos(u)) if (c !== u) u.world.kill(c, null, null, true); },
});
defAbility('meepo_divided_we_stand', {
  mods: ['modifier_meepo_divided_we_stand', sync('meepo_divided_we_stand', (ab) => { const sh = ab.owner.hasShard; if (ab.passive === sh) { ab.passive = !sh; ab.owner.refreshAI(); } })], fid: 'partial', prio: 36,
  ai(ab, u, t) {
    const fl = u.findAbility('meepo_fling_release');
    if (!t || !fl || fl.level < 1 || meepoHeld(u)) return null;
    const d = u.distTo(t); const c = d > u.attackRange + 300 && d <= fl.v('range') ? meepoCarry(u, ab) : null;
    return c ? { target: c } : null;
  },
  cast(ab, t) {
    const u = ab.owner; const fl = u.findAbility('meepo_fling_release');
    if (!t || !fl || !meepoPickable(u, t) || meepoHeld(u)) { refuse(ab); return; }
    const hold = fl.v('hold_duration');
    t.addModifier('modifier_meepo_fling_release_carried', { caster: u, ability: fl, duration: hold });
    u.addModifier('modifier_meepo_divided_we_stand_carry', { ability: ab, duration: hold, data: t });
  },
  note: 'clones are real hero units (world.summon) with the same level, skills, talents, Scepter/Shard and items, their own health, mana, cooldowns and fight controller; when any Meepo dies all die; item damage, attack speed, health, mana and regeneration bonuses are cut by dps_penalty_pct on every Meepo. Missing: sharing of item proc chances and mana burn, shared item cooldowns (clones never use active items), experience rules. The Shard pick-up is a cast of this ability (see Fling). Level 4 is applied by the script (engine caps ultimates at 3) at hero level required_level + 3 x levels_between_upgrades',
});
modifier('modifier_meepo_earthbind_incoming', { hidden: true, purge: 'none' });
debuff('modifier_meepo_earthbind_root', { state: ['ROOT'], onPreAttacked(m, rec) { if (m.v('true_strike') > 0 && rec.attacker.team === m.caster.team) rec.trueStrike = true; } });
defAbility('meepo_earthbind', {
  fid: 'full', prio: 70, note: 'the net flies at `speed` to the point; a thrown net is announced on the target so that several Meepos chain their nets instead of throwing them together',
  ai(ab, u, t) {
    if (!t || t.isBuilding || t.st[ST.ROOT] > 0 || t.st[ST.IMMUNE] > 0 || t.name === 'npc_dota_roshan' || t.hasModifier('modifier_meepo_earthbind_incoming') || u.distTo(t) > ab.castRange() + 300) return null;
    const fly = ab.v('AbilityCastPoint') + u.distTo(t) / ab.v('speed'); const p = lead(t, fly);
    t.addModifier('modifier_meepo_earthbind_incoming', { duration: fly + 0.4 });
    return { x: p.x, y: p.y };
  },
  cast(ab, t, x, y) {
    const u = ab.owner; const w = u.world;
    w.after(hyp(x - u.x, y - u.y) / ab.v('speed'), () => {
      if (missed(w)) return;
      for (const e of enemiesNear(ab, x, y, ab.v('radius'))) if (!e.isBuilding && e.name !== 'npc_dota_roshan') addMod(ab, e, 'modifier_meepo_earthbind_root', ab.v('duration'));
    });
  },
});
defAbility('meepo_poof', {
  mods: [sync('meepo_poof', (ab) => { if (ab.vals.cast_duration !== undefined) ab.vals.AbilityCastPoint = ab.vals.cast_duration; })],
  fid: 'approx', prio: 60,
  note: 'damage around the departure point, then around the arrival point (a Meepo that poofs to itself hits twice); every Meepo decides for itself: to itself when the target is inside the radius, else to the Meepo standing next to the target. Group orders (alt-cast, ground cast for all Meepos) and poofing to illusions are not modelled. The cast time follows cast_duration (talent)',
  ai(ab, u, t) {
    if (!t || u.st[ST.ROOT] > 0) return null;
    const r = ab.v('radius') - 60;
    if (u.distTo(t) <= r) return { target: u };
    let best = null; let bd = r;
    for (const o of meepos(u)) { const d = o.distTo(t); if (o !== u && d <= bd) { bd = d; best = o; } }
    return best ? { target: best } : null;
  },
  cast(ab, t, x, y) {
    const u = ab.owner; let dest = t && t.team === u.team ? t : null;
    if (!dest) { let bd = Infinity; for (const o of meepos(u)) { const d = hyp(o.x - x, o.y - y); if (d < bd) { bd = d; dest = o; } } }   // ground cast: the Meepo closest to the point
    for (const e of enemiesNear(ab, u.x, u.y, ab.v('radius'))) if (!e.isBuilding) hit(ab, e, ab.v('poof_damage'), MAGICAL);
    if (dest && dest !== u && dest.alive) { u.x = dest.x + 30; u.y = dest.y + 30; }
    for (const e of enemiesNear(ab, u.x, u.y, ab.v('radius'))) if (!e.isBuilding) hit(ab, e, ab.v('poof_damage'), MAGICAL);
  },
});
passive('meepo_ransack', {
  fid: 'full', note: 'pure damage on every attack that hits, dealt just before the attack damage ([L] measured in Hero Demo: the Ransack instance precedes the attack instance); the same amount heals every Meepo; the 60% against creeps is written in the tooltip text only (no data value)',
  outgoing(m, d) {
    const u = m.parent; const t = d.dst; const rec = d.rec;
    if (!(d.flags & F_ATTACK) || !rec || rec.secondary || rec.attacker !== u || !t.alive || t.isBuilding || t.team === u.team) return;
    const got = u.world.damage(u, t, m.v('health_steal_heroes') * (t.heroLike ? 1 : 0.6), PURE, 0, m.ability);
    if (got > 0) for (const o of meepos(u)) o.heal(got, u, m.ability, true);
    if (!t.alive) d.amount = 0;
  },
});
buff('modifier_meepo_petrify', {
  purge: 'none', state: ['OUT', 'INVULN', 'UNTARGETABLE', 'STUN', 'ROOT', 'ETHEREAL'], interval: 0.25, thinkNow: true,
  onThink(m) { const u = m.parent; u.heal(u.maxHp * m.v('hp_restore') / 100 * 0.25 / m.v('duration'), u, m.ability); },
});
defAbility('meepo_petrify', {
  fid: 'approx', prio: 95, note: 'Meepo cannot act while dug in (the tooltip only states invulnerable and untargetable); used below 35% health',
  ai: (ab, u) => (u.hp / u.maxHp < 0.35 && u.st[ST.ROOT] === 0 ? NOW : null),
  cast(ab) { const u = ab.owner; u.purge({ debuffs: true }); addMod(ab, u, 'modifier_meepo_petrify', ab.v('duration')); },
});
na('meepo_geomancy', 'terrain bonuses (dirt, trees, water): the sandbox has no terrain, so none of them applies. [L] measured in Hero Demo: on the arena ground Meepo keeps his base 310 speed with and without a clone');
debuff('modifier_meepo_fling_release_slow', { stats: (m) => ({ msPct: -Math.abs(m.v('movement_slow')) }) });
modifier('modifier_meepo_fling_release_carried', { purge: 'none', state: ['STUN', 'DISARM'] });   // [L] measured in Hero Demo: a held unit is stunned and disarmed
modifier('modifier_meepo_fling_release_flight', { purge: 'none', state: ['STUN', 'OUT', 'INVULN', 'ETHEREAL'] });   // [L] measured in Hero Demo: in the air the unit is stunned and out of play
function meepoCarry(u, dws) {
  let best = null; let bd = dws.castRange();
  for (const o of u.world.units) {
    if (!o.alive || o === u || o.team !== u.team || o.isBuilding || o.st[ST.OUT] > 0 || o.castAb || o.channelAb || o.hasModifier('modifier_meepo_fling_release_carried') || o.hasModifier('modifier_meepo_fling_release_flight')) continue;
    if (!meepoPickable(u, o)) continue;
    const d = u.distTo(o);
    if (d <= bd) { bd = d; best = o; }
  }
  return best;
}
// only a Meepo or an allied creep can be picked up
const meepoPickable = (u, o) => o !== u && o.team === u.team && !o.isBuilding && ((!o.isIllusion && o.name === u.name && meepoPrime(o) === meepoPrime(u)) || !o.heroLike);
// the carrier: disarmed while holding (m.data = carried unit); the carried unit is dropped after hold_duration
modifier('modifier_meepo_divided_we_stand_carry', {
  purge: 'none', state: ['DISARM'],
  onDestroy(m) { const c = m.data; if (c && c.alive) c.removeModifierByName('modifier_meepo_fling_release_carried'); },
});
const meepoHeld = (u) => { const m = u.findModifier('modifier_meepo_divided_we_stand_carry'); return m && m.data && m.data.alive ? m : null; };
defAbility('meepo_fling_release', {
  fid: 'approx', prio: 35,
  note: 'Shard: Divided We Stand becomes castable (the data marks it passive; the script lifts the flag while Meepo has the Shard) and picks up an allied Meepo or creep, which cannot act while carried; Meepo is disarmed until he throws it or hold_duration ends. Fling throws the carried unit to the point (at most `range`), it lands after distance / fling_movespeed and the impact damages and slows; [L] measured in Hero Demo: Fling with nothing carried is not cast. Missing: a carried Meepo sharing damage with the carrier',
  ai(ab, u, t) {
    const h = meepoHeld(u);
    if (!t || !h) return null;
    return u.distTo(t) <= ab.v('range') + 100 ? { x: t.x, y: t.y } : null;
  },
  cast(ab, t, x, y) {
    const u = ab.owner; const w = u.world; const h = meepoHeld(u);
    if (!h) { refuse(ab); return; }
    const c = h.data; h.data = null; h.remove();
    const dx = x - u.x; const dy = y - u.y; const d = hyp(dx, dy) || 1; const k = Math.min(1, ab.v('range') / d);
    const lx = u.x + dx * k; const ly = u.y + dy * k; const air = d * k / ab.v('fling_movespeed');
    c.removeModifierByName('modifier_meepo_fling_release_carried');
    c.addModifier('modifier_meepo_fling_release_flight', { caster: u, ability: ab, duration: air });
    w.after(air, () => {
      if (c.alive) { c.x = lx; c.y = ly; }
      for (const e of enemiesNear(ab, lx, ly, ab.v('impact_radius'))) { if (e.isBuilding) continue; hit(ab, e, ab.v('fling_damage'), MAGICAL); if (e.alive) addMod(ab, e, 'modifier_meepo_fling_release_slow', ab.v('fling_slow_duration')); }
    });
  },
});

// ================================================================ Techies
// Mines, the Sticky Bomb, the M.A.D. barrel and the Minefield Sign are world timers at a position, not units: they cannot be attacked.
debuff('modifier_techies_sticky_bomb_slow', { stats: (m) => ({ msPct: -m.v('slow') }) });
debuff('modifier_techies_sticky_bomb_secondary', { stats: (m) => ({ msPct: -m.v('secondary_slow') }) });
defAbility('techies_sticky_bomb', {
  fid: 'approx', prio: 55,
  note: 'the unlabelled value `duration` is read as the flight time of the lob; on landing the bomb sticks at once to the nearest enemy hero within the stick radius (the chase is not simulated) and explodes after `countdown` where that hero then stands, or at the landing point when nobody was in reach; the bomb cannot be attacked',
  ai(ab, u, t) { if (!t || t.isBuilding) return null; const p = lead(t, ab.v('AbilityCastPoint') + ab.v('duration')); return { x: p.x, y: p.y }; },
  cast(ab, t, x, y) {
    const u = ab.owner; const w = u.world;
    w.after(ab.v('duration'), () => {
      let host = null; let bd = Infinity;
      if (!missed(w)) for (const e of enemiesNear(ab, x, y, ab.v('radius'))) { const d = hyp(e.x - x, e.y - y); if (e.isHero && d < bd) { bd = d; host = e; } }
      if (host) addMod(ab, host, 'modifier_techies_sticky_bomb_slow', ab.v('countdown'));
      w.after(ab.v('countdown'), () => {
        const bx = host ? host.x : x; const by = host ? host.y : y;
        for (const e of enemiesNear(ab, bx, by, ab.v('explosion_radius'))) {
          if (e.isBuilding) continue;
          hit(ab, e, ab.v('damage'), MAGICAL);
          if (!e.alive) continue;
          addMod(ab, e, 'modifier_techies_sticky_bomb_secondary', ab.v('secondary_slow_duration'));
          if (ab.v('stun_on_explosion') > 0) stun(ab, e, ab.v('explosion_stun_duration'));
        }
      });
    });
  },
});
function tazerZap(m, e) {
  mhit(m, e, m.v('damage'), MAGICAL);
  if (e.alive) e.addModifier('modifier_disarmed', { caster: m.caster, ability: m.ability, duration: m.v('disarm_duration') });
}
buff('modifier_techies_reactive_tazer', {
  stats: (m) => ({ msPct: m.v('bonus_ms') }),
  onAttacked(m, rec) {
    const a = rec.attacker;
    if (!a.alive || a.team === m.parent.team || a.isBuilding || a.st[ST.IMMUNE] > 0) return;
    tazerZap(m, a);
    if (a.alive) a.purge({ debuffs: false, buffs: true });
  },
  // m.z = 1: detonated with the sub-ability
  onDestroy(m, expired) { const u = m.parent; if (!u.alive || !(expired || m.z === 1)) return; for (const e of u.world.enemiesInRadius(m.caster, u.x, u.y, m.v('explosion_radius'))) if (!e.isBuilding) tazerZap(m, e); },
});
defAbility('techies_reactive_tazer', {
  fid: 'full', prio: 50, note: 'the default controller puts the charge on the allied hero (or Techies) that most enemies are attacking',
  ai(ab, u, t, w) {
    if (!t) return null;
    let best = null; let bs = 0;
    for (const a of w.units) {
      if (!a.alive || a.team !== u.team || !a.isHero || a.isIllusion || a.hasModifier('modifier_techies_reactive_tazer') || (a !== u && u.distTo(a) > ab.castRange())) continue;
      let s = 0;
      for (const e of w.units) if (e.alive && e.team !== u.team && e.canAttack && e.orderTarget === a && e.rangeTo(a) <= e.attackRange + 150) s++;
      if (s > bs) { bs = s; best = a; }
    }
    return best ? { target: best } : null;
  },
  cast(ab, t) { addMod(ab, t || ab.owner, 'modifier_techies_reactive_tazer', ab.v('duration')); },
});
defAbility('techies_reactive_tazer_stop', {
  fid: 'full', manual: true, note: 'manual: the default controller lets the charge run its full duration (it explodes at the end anyway); list the ability in ai.order to detonate early',
  cast(ab) {
    const u = ab.owner;
    for (const a of u.world.units) { const m = a.alive && a.team === u.team ? a.findModifier('modifier_techies_reactive_tazer') : null; if (m && m.caster === u) { m.z = 1; m.remove(); } }
  },
});
modifier('modifier_techies_suicide_leap', { purge: 'none', state: ['ROOT', 'DISARM'] });
defAbility('techies_suicide', {
  fid: 'full', prio: 75, note: 'Techies are rooted and disarmed for the leap (shipped patch note 7.41; 0.9 s measured) and land on the point, the blast comes 0.7 s into the leap (measured); the self damage is dealt first; not used below 25% health. The landing spot is the target point (the game lands a little beyond it)',
  ai(ab, u, t) {
    if (!t || t.isBuilding || u.st[ST.ROOT] > 0 || u.hp / u.maxHp <= 0.25 || u.distTo(t) > ab.castRange() + 200) return null;
    const p = lead(t, ab.v('AbilityCastPoint') + ab.v('duration'));
    return { x: p.x, y: p.y };
  },
  cast(ab, t, x, y) {
    // [L] measured in Hero Demo: the blast comes 0.7 s into the leap of `duration` 0.75 s; rooted and disarmed for 0.9 s in all
    const u = ab.owner; const w = u.world; const fly = ab.v('duration');
    u.addModifier('modifier_techies_suicide_leap', { ability: ab, duration: fly + 0.15 });
    w.after(fly - 0.05, () => {
      if (!u.alive) return;
      u.x = x; u.y = y;
      w.damage(u, u, u.hp * ab.v('hp_cost') / 100, PURE, F_NON_LETHAL | F_NO_AMP, ab);
      if (!missed(w)) for (const e of enemiesNear(ab, x, y, ab.v('radius'))) { if (e.isBuilding) continue; hit(ab, e, ab.v('damage'), MAGICAL); stun(ab, e, ab.v('stun_duration')); }
    });
  },
});
function madExplode(ab, x, y, maxMana) {
  const dmg = ab.v('base_damage') + maxMana * ab.v('max_mana_pct_as_damage') / 100;
  for (const e of enemiesNear(ab, x, y, ab.v('radius'))) if (!e.isBuilding) hit(ab, e, dmg, MAGICAL);
}
modifier('modifier_techies_mutually_assured_destruction', { hidden: true, purge: 'none', stats: (m) => ({ manaRegenPct: m.v('bonus_mana_as_mana_regen') }) });
// Break only stops the mana regeneration, not the barrel (shipped patch note 7.42), so the barrel sits on a second, unbreakable modifier.
modifier('modifier_techies_mutually_assured_destruction_barrel', {
  hidden: true, purge: 'none', breakable: false,
  onDeath(m) {
    const u = m.parent; const w = u.world; const ab = m.ability; const x = u.x; const y = u.y; const mana = u.maxMana;
    w.after(ab.v('explosion_delay'), () => { if (!u.alive) madExplode(ab, x, y, mana); });   // nothing happens when the death was prevented
  },
});
defAbility('techies_mutually_assured_destruction', {
  mods: ['modifier_techies_mutually_assured_destruction', 'modifier_techies_mutually_assured_destruction_barrel'], fid: 'approx',
  note: 'mana regeneration and the barrel left on death are as stated. Shard: the data marks the ability passive, so planting is driven through Detonate M.A.D. (plant + detonate as one action); the barrel cannot be attacked',
});
const techiesMad = (u) => { const mad = u.findAbility('techies_mutually_assured_destruction'); return u.hasShard && mad && mad.level > 0 ? mad : null; };
defAbility('techies_focused_detonate', {
  fid: 'approx', prio: 52,
  note: 'only with Shard. Planting M.A.D. and detonating it are one action: Techies spend M.A.D.\'s cast point planting (a stun cancels it), the barrel is placed towards the target within M.A.D.\'s cast range, is detonated at once and explodes after explosion_delay (shipped patch note 7.41), M.A.D. goes on its cooldown. A barrel kept waiting and its pip health are not modelled',
  channel: (ab) => { const mad = techiesMad(ab.owner); return mad && ab.data ? mad.v('AbilityCastPoint') : 0; },
  ai(ab, u, t) { const mad = techiesMad(u); return t && !t.isBuilding && mad && mad.cdReady() && u.distTo(t) <= mad.castRange() + mad.v('radius') * 0.5 ? NOW : null; },
  cast(ab) {
    const u = ab.owner; const mad = techiesMad(u); ab.data = null;
    if (!mad || !mad.cdReady()) return;
    const e = curTarget(u, mad.castRange() + mad.v('radius')); const t = e ? lead(e, mad.v('AbilityCastPoint') + mad.v('explosion_delay')) : null;
    const dx = t ? t.x - u.x : 0; const dy = t ? t.y - u.y : 0; const d = hyp(dx, dy) || 1; const k = Math.min(1, mad.castRange() / d);
    ab.data = { x: u.x + dx * k, y: u.y + dy * k };
  },
  channelEnd(ab, interrupted) {
    const u = ab.owner; const mad = techiesMad(u); const p = ab.data; ab.data = null;
    if (interrupted || !p || !mad) return;
    mad.startCooldown();
    u.world.after(mad.v('explosion_delay'), () => madExplode(mad, p.x, p.y, u.maxMana));
  },
});
const techiesSignBonus = (u, x, y) => { const s = u.findAbility('techies_minefield_sign'); const d = s && s.data; return d && hyp(x - d.x, y - d.y) <= s.v('aura_radius') ? 1 + s.v('bonus_mine_damage_pct') / 100 : 1; };
defAbility('techies_minefield_sign', {
  // [L] measured in Hero Demo: an order 150 away (AbilityCastRange 10) is carried out where Techies stand, without walking
  mods: [sync('techies_minefield_sign', (ab) => { ab.vals.AbilityCastRange = 1e6; })],
  fid: 'approx', prio: 25,
  note: 'the sign is planted where Techies stand; mines inside its radius deal the bonus damage; once an enemy hero comes within trigger_radius (checked every 0.1 s) the minefield runs for minefield_duration and every scepter_move_amt units an enemy hero walks inside it cost scepter_move_damage (the data gives no damage type: magical assumed), then the sign is gone. The sign cannot be attacked; mines are never attackable in this model, so the invulnerability clause changes nothing',
  ai: (ab, u, t) => (t && t.isHero && !ab.data && u.distTo(t) <= ab.v('aura_radius') * 0.6 ? { x: u.x, y: u.y } : null),
  cast(ab) {
    const u = ab.owner; const w = u.world; const iv = 0.1; const step = ab.v('scepter_move_amt');
    const sign = { x: u.x, y: u.y, until: w.time + ab.v('lifetime'), live: false }; const walked = new Map();
    ab.data = sign;
    every(w, iv, () => {
      if (ab.data !== sign) return false;                           // replaced by a newer sign
      if (w.time >= sign.until) { ab.data = null; return false; }
      for (const e of w.inRadius(sign.x, sign.y, ab.v('aura_radius'), u.team, true)) {
        if (!e.isHero) continue;
        if (!sign.live) { if (hyp(e.x - sign.x, e.y - sign.y) <= ab.v('trigger_radius')) { sign.live = true; sign.until = w.time + ab.v('minefield_duration'); } continue; }
        let p = walked.get(e);
        if (!p) { walked.set(e, p = [e.x, e.y, 0]); continue; }
        const d = hyp(e.x - p[0], e.y - p[1]); p[0] = e.x; p[1] = e.y;
        if (d > e.ms * iv * 2 + 40) continue;                       // teleports do not count as walking
        p[2] += d;
        while (step > 0 && p[2] >= step && e.alive) { p[2] -= step; hit(ab, e, ab.v('scepter_move_damage'), MAGICAL); }
      }
    }, iv);
  },
});
debuff('modifier_techies_land_mines_debuff', { multi: 'independent', stats: (m) => ({ mr: -m.v('mres_reduction') }) });   // one per mine (shipped patch note 7.33)
const techiesMines = (ab) => (ab.data ||= []);
function techiesMineSpot(ab, u, t) {
  const mines = techiesMines(ab); const pr = ab.v('placement_radius');
  const free = (x, y) => !mines.some((m) => hyp(m.x - x, m.y - y) < pr);
  if (free(t.x, t.y)) return [t.x, t.y];
  let best = null; let bd = Infinity;
  for (let k = 0; k < 6; k++) {                                     // six spots just outside the placement radius of a mine lying on the target
    const x = t.x + (pr + 10) * Math.cos(k * Math.PI / 3); const y = t.y + (pr + 10) * Math.sin(k * Math.PI / 3);
    const d = hyp(x - u.x, y - u.y);
    if (free(x, y) && d < bd) { bd = d; best = [x, y]; }
  }
  return best;
}
defAbility('techies_land_mines', {
  mods: [sync('techies_land_mines', (ab, m) => { if (ab.vals.AbilityCastRange !== m.z) m.y = ab.vals.AbilityCastRange; m.z = m.y + ab.v('cast_range_scepter_bonus'); ab.vals.AbilityCastRange = m.z; })],
  fid: 'approx', prio: 65,
  note: 'a mine arms after activation_delay, explodes once a damageable enemy has stayed inside its radius for proximity_threshold (checked every 0.1 s), full damage within min_distance falling linearly to outer_damage % at the edge, then the magic resistance debuff. Mines are not units: they cannot be attacked or destroyed (pip health) and invisibility plays no role. The default controller plants on the target, then on six spots placement_radius + 10 around it',
  ai(ab, u, t) {
    if (!t || t.isBuilding || t.st[ST.IMMUNE] > 0 || ab.cdRemaining() > 0) return null;
    const p = techiesMineSpot(ab, u, lead(t, ab.v('activation_delay')));
    return p ? { x: p[0], y: p[1] } : null;
  },
  cast(ab, t, x, y) {
    const u = ab.owner; const w = u.world; const mines = techiesMines(ab); const pr = ab.v('placement_radius');
    chargeGap(ab);
    if (mines.some((m) => hyp(m.x - x, m.y - y) < pr)) {            // not allowed next to another mine: give the charge and the mana back
      if (!w.freeSpells) { u.mana = Math.min(u.maxMana, u.mana + ab.manaCost()); ab.charges = Math.min(ab.v('AbilityCharges'), ab.charges + 1); }
      return;
    }
    const mine = { x, y, armed: w.time + ab.v('activation_delay'), since: -1 };
    mines.push(mine);
    every(w, 0.1, () => {
      if (w.time + 1e-9 < mine.armed) return true;
      const r = ab.v('radius');
      const inside = w.inRadius(mine.x, mine.y, r, u.team, true);
      if (inside.some((e) => !e.isBuilding && e.st[ST.IMMUNE] === 0 && e.st[ST.INVULN] === 0)) { if (mine.since < 0) mine.since = w.time; } else mine.since = -1;
      if (mine.since < 0 || w.time - mine.since + 1e-9 < ab.v('proximity_threshold')) return true;
      mines.splice(mines.indexOf(mine), 1);
      const lo = ab.v('min_distance'); const edge = ab.v('outer_damage') / 100; const bonus = techiesSignBonus(u, mine.x, mine.y);
      for (const e of inside) {
        const d = hyp(e.x - mine.x, e.y - mine.y);
        const k = d <= lo ? 1 : 1 - (1 - edge) * (d - lo) / Math.max(1, r - lo);
        // [L] measured in Hero Demo: the magic resistance debuff is applied before the blast (700 magical on 25% resistance dealt 630)
        if (!e.isBuilding) addMod(ab, e, 'modifier_techies_land_mines_debuff', ab.v('burn_duration'));
        hit(ab, e, ab.v('damage') * k * bonus * (e.isBuilding ? ab.v('building_damage_pct') / 100 : 1), MAGICAL);
      }
      return false;
    }, 0.1);
  },
});
na('techies_remote_mines_self_detonate', 'legacy Remote Mines helper still listed on the Sticky Bomb unit; the Sticky Bomb is modelled without a unit and explodes on its own timer');

// ================================================================ Ringmaster
buff('modifier_ringmaster_tame_the_beasts_immune', { purge: 'none', state: ['IMMUNE'], stats: (m) => ({ mr: m.v('magic_resist') }) });
debuff('modifier_ringmaster_tame_the_beasts_fear', { state: ['FEAR', 'SILENCE', 'DISARM', 'MUTE'], purge: 'strong' });   // [L] measured in Hero Demo: the fear also silences, disarms and mutes
defAbility('ringmaster_tame_the_beasts', {
  fid: 'approx', prio: 62, channel: true,
  note: 'always channelled for the full AbilityChannelTime; the crack lands crack_duration after the channel ends with damage_min x max_multiplier ([L] measured; damage_max only feeds the tooltip, as the shipped data says), fear_duration_max (fear + silence + disarm + mute) and the end radius around the target point; an interrupted channel does not crack (the tooltip does not say what it does) and the early release (Crack) is not used, so the growth curve between the minimum and maximum values is never needed. The fleeing walk of the feared unit is not modelled',
  ai(ab, u, t) { if (!t || t.isBuilding || u.distTo(t) > ab.castRange() + 150) return null; const p = lead(t, ab.v('AbilityChannelTime')); return { x: p.x, y: p.y }; },
  cast(ab, t, x, y) { ab.data = { x, y }; if (ab.v('has_debuff_immunity') > 0) addMod(ab, ab.owner, 'modifier_ringmaster_tame_the_beasts_immune', ab.v('AbilityChannelTime') + 0.1); },
  channelEnd(ab, interrupted) {
    const u = ab.owner; const p = ab.data; ab.data = null;
    u.removeModifierByName('modifier_ringmaster_tame_the_beasts_immune');
    if (interrupted || !p || missed(u.world)) return;
    u.world.after(ab.v('crack_duration'), () => {
      for (const e of enemiesNear(ab, p.x, p.y, ab.v('end_width'))) {
        if (e.isBuilding) continue;
        hit(ab, e, ab.v('damage_min') * ab.v('max_multiplier'), MAGICAL);
        if (e.alive) addMod(ab, e, 'modifier_ringmaster_tame_the_beasts_fear', ab.v('fear_duration_max'));
      }
    });
  },
});
na('ringmaster_tame_the_beasts_crack', 'early-release helper of Tame the Beasts; the whip is always channelled to the end');
debuff('modifier_ringmaster_impalement_slow', { stats: (m) => ({ msPct: -m.v('slow_percent') }) });
debuff('modifier_ringmaster_impalement_bleed', {
  statusResist: false, interval: (m) => m.v('tick_interval'),
  onThink(m) { const t = m.parent; mhit(m, t, (t.isHero ? t.maxHp * m.v('bleed_health_pct') / 100 : m.v('bleed_creep_dps')) * m.v('tick_interval'), MAGICAL); },
});
// one dagger from (x1,y1) to (x2,y2): hits the first enemy on its way (two with the talent)
function ringmasterDagger(ab, x1, y1, x2, y2) {
  const u = ab.owner; const w = u.world;
  const list = enemiesInLine(ab, x1, y1, x2, y2, ab.v('dagger_width')).filter((e) => !e.isBuilding).map((e) => [hyp(e.x - x1, e.y - y1), e]).sort((a, b) => a[0] - b[0]);
  // [L] measured in Hero Demo (targets at 300, 500, 1200): a unit is struck once the dagger has flown to 240 short of the unit's centre,
  // on the next whole tick
  for (const [d, e] of list.slice(0, ab.v('dagger_pass_through') > 0 ? 2 : 1)) {
    w.after(Math.ceil(Math.max(0, d - 240) / ab.v('dagger_speed') / w.dt - 1e-6) * w.dt, () => {
      if (!e.alive) return;
      hit(ab, e, ab.v('damage_impact'), MAGICAL);
      if (!e.alive) return;
      addMod(ab, e, 'modifier_ringmaster_impalement_slow', ab.v('slow_duration'));
      addMod(ab, e, 'modifier_ringmaster_impalement_bleed', ab.v('bleed_duration') + PAD);
    });
  }
}
defAbility('ringmaster_impalement', {
  fid: 'approx', prio: 50, note: 'the dagger is stopped by the first enemy between Ringmaster and the point (the second one with the talent); who is hit is decided when it is thrown, the effect arrives after the flight time',
  ai: (ab, u, t) => (t && !t.isBuilding && ab.cdRemaining() <= 0 && u.distTo(t) <= ab.castRange() ? { x: t.x, y: t.y } : null),
  cast(ab, t, x, y) { const u = ab.owner; chargeGap(ab); if (!missed(u.world)) ringmasterDagger(ab, u.x, u.y, x, y); },
});
function ringmasterBoxPop(m) {
  const u = m.parent; const ab = m.ability; const c = m.caster; const w = u.world;
  if (!u.alive || !ab || !(ab.v('explosion_radius') > 0)) return;             // the pop only does something with Scepter
  for (const e of w.enemiesInRadius(c, u.x, u.y, ab.v('explosion_radius'))) if (!e.isBuilding) hit(ab, e, ab.v('explosion_damage'), MAGICAL);
  const dag = c.findAbility('ringmaster_impalement'); const n = ab.v('launch_daggers_count');
  if (!dag || dag.level < 1 || !(n > 0)) return;
  const a0 = w.rng.next() * 2 * Math.PI;
  for (let k = 0; k < n; k++) { const a = a0 + k * 2 * Math.PI / n; ringmasterDagger(dag, u.x, u.y, u.x + ab.v('launch_daggers_range') * Math.cos(a), u.y + ab.v('launch_daggers_range') * Math.sin(a)); }
}
buff('modifier_ringmaster_the_box', {
  state: ['UNTARGETABLE', 'MUTE', 'SILENCE', 'DISARM'], interval: 0.1,
  stats: (m) => ({ msPct: m.v('move_speed'), mr: m.v('magic_resist'), slowRes: m.v('slow_resist') }),
  onCreated(m) { m.x = m.parent.x; m.y = m.parent.y; },
  onThink(m) { const u = m.parent; if (hyp(u.x - m.x, u.y - m.y) > m.v('leash_radius')) m.remove(); },
  onDestroy(m) { ringmasterBoxPop(m); },
});
// Scepter: the data gives max_charges instead of AbilityCharges (and removes the cooldown), so the charges are kept here
function ringmasterBoxCharges(ab) {
  const max = ab.v('max_charges');
  if (!(max > 0)) return null;
  const u = ab.owner; const now = u.world.time; const c = (ab.data ||= { n: max, at: 0 });
  while (c.n < max && c.at > 0 && now + 1e-9 >= c.at) { c.n++; c.at = c.n < max ? c.at + ab.v('AbilityChargeRestoreTime') * u.cdrMul : 0; }
  return c;
}
defAbility('ringmaster_the_box', {
  fid: 'approx', prio: 92,
  note: 'used as an escape: on the allied hero (or Ringmaster) below 35% health that was hurt in the last 2 s. Phased and flying movement have no effect here. Scepter: charges are kept by the script (the data uses max_charges); the explosion is magical (shipped patch note 7.37e); the daggers fly in launch_daggers_count evenly spaced directions with a random rotation and use Impalement Arts at its current level',
  ai(ab, u, t, w) {
    const c = ringmasterBoxCharges(ab);
    if (!t || (c && c.n < 1)) return null;
    let best = null; let bh = 0.35;
    for (const a of w.units) {
      if (!a.alive || a.team !== u.team || !a.isHero || a.isIllusion || a.hasModifier('modifier_ringmaster_the_box') || w.time - a.lastHurt > 2 || (a !== u && u.distTo(a) > ab.castRange())) continue;
      const h = a.hp / a.maxHp;
      if (h < bh) { bh = h; best = a; }
    }
    return best ? { target: best } : null;
  },
  cast(ab, t) {
    const u = ab.owner; const w = u.world; const tt = t || u; const c = ringmasterBoxCharges(ab);
    if (c && !w.freeSpells) {
      if (c.n < 1) { u.mana = Math.min(u.maxMana, u.mana + ab.manaCost()); return; }
      if (c.n === ab.v('max_charges')) c.at = w.time + ab.v('AbilityChargeRestoreTime') * u.cdrMul;
      c.n--;
    }
    if (ab.v('strong_dispel') > 0) tt.purge({ debuffs: true, strong: true });
    addMod(ab, tt, 'modifier_ringmaster_the_box', ab.v('invis_duration'));
  },
});
na('ringmaster_empty_souvenir', 'souvenir slot: souvenirs come from enemy hero deaths and their abilities are not in this hero\'s ability list of the data pack');
debuff('modifier_ringmaster_spotlight_debuff', {
  statusResist: false, purge: 'none', interval: (m) => m.v('pulse_interval'), stats: (m) => ({ miss: m.v('miss_chance') }),
  onThink(m) { const e = m.parent; if (e.isIllusion) e.world.damage(m.caster, e, e.maxHp * m.v('illusion_percent_damage') / 100 * m.v('pulse_interval'), MAGICAL, F_HP_LOSS, m.ability); },
});
defAbility('ringmaster_spotlight', {
  fid: 'approx', prio: 40,
  note: 'assumed geometry (the tooltip only says the lights sweep over an area): spotlight_count lights of `radius` circle the cast point at sweep_radius with sweep_speed rad/s, evenly spaced, starting at start_offset; the default controller places the centre so that its target lies on that circle. Revealing invisible units has no effect here',
  ai(ab, u, t) {
    if (!t || !t.isHero || !t.canAttack) return null;
    const d = u.distTo(t) || 1; const R = ab.v('sweep_radius');
    return d <= ab.castRange() ? { x: t.x + (u.x - t.x) / d * R, y: t.y + (u.y - t.y) / d * R } : null;
  },
  cast(ab, t, x, y) {
    const u = ab.owner; const w = u.world; const n = Math.max(1, ab.v('spotlight_count')); const R = ab.v('sweep_radius'); const iv = ab.v('pulse_interval'); const t0 = w.time;
    every(w, iv, () => {
      const el = w.time - t0;
      if (el > ab.v('duration') + 1e-9) return false;
      const r = ab.v('radius'); const ph = ab.v('start_offset') + ab.v('sweep_speed') * el;
      for (const e of w.inRadius(x, y, R + r, u.team, true)) {
        if (e.isBuilding) continue;
        for (let k = 0; k < n; k++) {
          const a = ph + k * 2 * Math.PI / n;
          if (hyp(e.x - x - R * Math.cos(a), e.y - y - R * Math.sin(a)) <= r) { addMod(ab, e, 'modifier_ringmaster_spotlight_debuff', iv + ab.v('linger_duration')); break; }
        }
      }
    }, 0);
  },
});
// No facing in the sandbox: a unit looks towards the unit it is attacking or casting on. `cone` is the shipped dot-product threshold.
function looksAt(e, x, y, cone) {
  const t = e.orderTarget || e.attackTarget || e.castTarget;
  if (!t || t === e || !t.alive) return false;
  const ax = t.x - e.x; const ay = t.y - e.y; const bx = x - e.x; const by = y - e.y; const la = hyp(ax, ay); const lb = hyp(bx, by);
  return la < 1 || lb < 1 ? true : (ax * bx + ay * by) / (la * lb) >= cone;
}
debuff('modifier_ringmaster_wheel_debuff', { statusResist: false, purge: 'none', stats: (m) => ({ msPct: -Math.abs(m.v('aura_slow')) }) });
debuff('modifier_ringmaster_wheel_mesmerize', { state: ['STUN'], statusResist: false, purge: 'none' });
debuff('modifier_ringmaster_wheel_knockback', { statusResist: false, purge: 'none' });   // [L] measured in Hero Demo: no stun state, the unit is pushed aside
function ringmasterWheel(ab, wx, wy) {
  const u = ab.owner; const w = u.world; const iv = 0.1; const tick = ab.v('aura_tick_interval');
  let boom = w.time + ab.v('trap_duration'); let armed = false; let nextAura = w.time + tick; const stare = new Map(); const held = new Set();
  // [L] measured in Hero Demo: the aura ticks every aura_tick_interval from the landing, the one due at the explosion included;
  // the slow is applied for 0.5 s at every think, so it lingers 0.5 s after the explosion
  every(w, iv, () => {
    const now = w.time;
    const es = enemiesNear(ab, wx, wy, ab.v('mesmerize_radius')).filter((e) => !e.isBuilding);
    const aura = now + 1e-9 >= nextAura;
    if (aura) nextAura += tick;
    if (now + 1e-9 >= boom) {
      for (const e of held) e.removeModifierByName('modifier_ringmaster_wheel_mesmerize');
      for (const e of es) { hit(ab, e, ab.v('explosion_damage'), MAGICAL); if (aura && e.alive) hit(ab, e, ab.v('aura_damage') * tick, MAGICAL); if (e.alive) addMod(ab, e, 'modifier_ringmaster_wheel_debuff', 0.5); }
      return false;
    }
    for (const e of es) {
      addMod(ab, e, 'modifier_ringmaster_wheel_debuff', 0.5);
      if (aura) hit(ab, e, ab.v('aura_damage') * tick, MAGICAL);
      if (!e.alive || !e.isHero || held.has(e)) continue;
      const s = looksAt(e, wx, wy, ab.v('vision_cone')) ? (stare.get(e) || 0) + iv : 0;
      stare.set(e, s);
      if (s + 1e-9 < ab.v('face_duration')) continue;
      const end = armed ? boom : now + ab.v('wheel_stun');
      if (!addMod(ab, e, 'modifier_ringmaster_wheel_mesmerize', end - now + 0.2)) continue;
      held.add(e);
      if (!armed) { armed = true; boom = end; }                     // the first mesmerized hero starts the explosion timer
    }
  }, 0);
}
defAbility('ringmaster_wheel', {
  fid: 'approx', prio: 85,
  note: 'no facing in the sandbox: an enemy hero faces the wheel while the unit it is attacking or casting on lies within the shipped vision_cone of the wheel\'s direction (a hero without a target never does). A mesmerized hero cannot act until the explosion; the pull towards the wheel is not modelled (no speed in the data). The wheel is evaluated every 0.1 s and its slow lingers 0.5 s (measured); the aura tick due at the explosion lands too (measured). The wheel lands at least min_range away; units on its path are pushed aside by knockback_distance, which is not a stun (measured)',
  ai(ab, u, t) { if (!t || !t.isHero) return null; const d = u.distTo(t); return d >= 250 && d <= ab.castRange() + 200 ? { x: t.x, y: t.y } : null; },
  cast(ab, t, x, y) {
    const u = ab.owner; const w = u.world; const sx = u.x; const sy = u.y; const d0 = hyp(x - sx, y - sy) || 1; const ux = (x - sx) / d0; const uy = (y - sy) / d0;
    const d = Math.max(d0, ab.v('min_range')); const wx = sx + ux * d; const wy = sy + uy * d; const sp = ab.v('projectile_speed');
    const ticks = (s) => Math.floor(s / w.dt + 1e-6) * w.dt;
    for (const e of enemiesInLine(ab, sx, sy, wx, wy, 2 * ab.v('knockback_radius'))) {
      const a = Math.max(0, Math.min(d, (e.x - sx) * ux + (e.y - sy) * uy));
      // pushed sideways, away from the wheel's path (a unit right on the path goes to the left of it)
      const side = ux * (e.y - sy) - uy * (e.x - sx) >= 0 ? 1 : -1;
      w.after(ticks(a / sp), () => { const px = e.x - side * uy * 50; const py = e.y + side * ux * 50; shove(ab, e, 2 * e.x - px, 2 * e.y - py, ab.v('knockback_distance'), ab.v('knockback_duration'), 'modifier_ringmaster_wheel_knockback'); });
    }
    w.after(ticks(d / sp), () => ringmasterWheel(ab, wx, wy));
  },
});

// ================================================================ Batrider
// Sticky Napalm: every damage instance Batrider deals to a drenched unit adds `damage` x stacks as a separate magical instance.
const NAPALM_EXEMPT = new Set(['item_radiance', 'item_orb_of_venom', 'item_urn_of_shadows', 'item_spirit_vessel']);   // named in the ability notes
const napalmScale = (ab, t) => (t.isBuilding ? ab.v('building_damage_pct') / 100 : t.heroLike ? 1 : ab.v('creep_damage_pct') / 100);
let napalmBusy = false;
debuff('modifier_batrider_sticky_napalm_debuff', {
  multi: 'stack', maxStacks: (m) => (m.v('unlimited_stacks') > 0 ? Infinity : m.v('max_stacks')),
  stats: (m) => ({ msPct: -m.v('movement_speed_pct') * m.stacks }),
  onTakeDamage(m, d) {
    const t = m.parent;
    if (napalmBusy || d.src !== m.caster || d.dealt <= 0 || !t.alive || (d.flags & (F_REFLECT | F_HP_LOSS)) || (d.ability && NAPALM_EXEMPT.has(d.ability.name))) return;
    napalmBusy = true;                                             // the bonus instance does not amplify itself
    try { mhit(m, t, m.v('damage') * m.stacks * napalmScale(m.ability, t), MAGICAL); } finally { napalmBusy = false; }
  },
});
function napalmStacks(ab, e, n) {
  if (!e.alive || (e.isBuilding && !(ab.v('building_damage_pct') > 0))) return;
  e.addModifier('modifier_batrider_sticky_napalm_debuff', { caster: ab.owner, ability: ab, duration: ab.v('duration'), stacks: n });
}
modifier('modifier_batrider_sticky_napalm', { hidden: true, purge: 'none', onAttackLanded(m, rec) { const n = m.v('napalm_stacks_on_attack'); if (n > 0 && rec.target.team !== m.parent.team) napalmStacks(m.ability, rec.target, n); } });
defAbility('batrider_sticky_napalm', {
  mods: ['modifier_batrider_sticky_napalm'], fid: 'approx', prio: 58,
  note: 'the bonus is a separate magical instance on every attack and ability hit of Batrider (damage over time ticks included), 25% against creeps; the application damage is dealt before the new stack lands, so a first cast deals it alone ([L] measured in Hero Demo); the turn-rate slow has no effect (no facing)',
  ai: (ab, u, t) => (t && (!t.isBuilding || ab.v('building_damage_pct') > 0) ? { x: t.x, y: t.y } : null),
  cast(ab, t, x, y) {
    for (const e of enemiesNear(ab, x, y, ab.v('radius'))) {
      if (e.isBuilding && !(ab.v('building_damage_pct') > 0)) continue;
      hit(ab, e, ab.v('application_damage') * napalmScale(ab, e), MAGICAL);   // [L] measured in Hero Demo: dealt before the new stack is added
      napalmStacks(ab, e, ab.v('stacks_per_cast'));
    }
  },
});
na('batrider_sticky_napalm_application_damage', 'internal damage source of Sticky Napalm\'s application damage, which is dealt by the Sticky Napalm script');
debuff('modifier_batrider_flamebreak_burn', { interval: 1, stats: (m) => ({ msPct: -m.v('slow') }), onThink(m) { mhit(m, m.parent, m.v('damage_per_second'), MAGICAL); } });
defAbility('batrider_flamebreak', {
  fid: 'approx', prio: 60, note: '[L] measured in Hero Demo: the knockback is not a stun (no state on the victim) and a unit standing exactly on the explosion point is not moved; other units are moved knockback_distance away from the point at once (the flight of knockback_duration is not simulated); the burn ticks once per second, the last tick on its end, and carries the slow; the unlabelled value stun_duration is not used',
  ai(ab, u, t) { if (!t || t.isBuilding) return null; const p = lead(t, ab.v('AbilityCastPoint') + u.distTo(t) / ab.v('speed')); return { x: p.x, y: p.y }; },
  cast(ab, t, x, y) {
    const u = ab.owner; const w = u.world;
    w.after(hyp(x - u.x, y - u.y) / ab.v('speed'), () => {
      if (missed(w)) return;
      const nap = u.findAbility('batrider_sticky_napalm');
      for (const e of enemiesNear(ab, x, y, ab.v('explosion_radius'))) {
        if (e.isBuilding) continue;
        hit(ab, e, ab.v('damage_impact'), MAGICAL);
        if (!e.alive) continue;
        if (!blocked(ab, e) && hyp(e.x - x, e.y - y) > 1) knockback(e, x, y, ab.v('knockback_distance'));
        addMod(ab, e, 'modifier_batrider_flamebreak_burn', ab.v('damage_duration') + PAD);
        if (ab.v('napalm_stacks') > 0 && nap && nap.level > 0) napalmStacks(nap, e, ab.v('napalm_stacks'));
      }
    });
  },
});
buff('modifier_batrider_firefly', { purge: 'none', dynamic: true, stats: (m) => ({ msPct: m.v('movement_speed_pct_total') * Math.max(0, Math.min(1, (m.parent.world.time - m.created) / m.v('duration'))) }) });
defAbility('batrider_firefly', {
  fid: 'approx', prio: 55,
  note: '[L] measured in Hero Demo: the fire burns two server ticks after the cast and then every tick_interval counted from the cast, duration / tick_interval times in all (the tick on the end does not happen); the movement speed bonus grows linearly every tick up to the maximum. The trail is the list of places Batrider stood at each tick (a new point every 50 units); it burns everything within `radius` of a point until Firefly ends, also after Batrider dies. Flying has no effect here. The default controller walks Batrider to within the radius of a target that is at most radius + 400 away, then casts',
  ai: (ab, u, t) => (t && !t.isBuilding && !u.hasModifier('modifier_batrider_firefly') && u.distTo(t) <= ab.v('radius') + 400 ? closeIn(ab, u, t, ab.v('radius') - 40) : null),
  cast(ab) {
    const u = ab.owner; const w = u.world; const dur = ab.v('duration'); const iv = ab.v('tick_interval'); const pts = [];
    const m = addMod(ab, u, 'modifier_batrider_firefly', dur); const n = Math.max(1, Math.round(dur / iv));
    const burn = () => {
      if (u.alive && m && !m.removed) { const k = pts.length; if (!k || hyp(u.x - pts[k - 2], u.y - pts[k - 1]) >= 50) pts.push(u.x, u.y); }
      const r = ab.v('radius');
      for (const e of w.units) {
        if (!e.alive || e.team === u.team || e.isBuilding || e.st[ST.OUT] > 0) continue;
        for (let i = 0; i < pts.length; i += 2) if (hyp(e.x - pts[i], e.y - pts[i + 1]) <= r) { hit(ab, e, ab.v('damage_per_second') * iv, MAGICAL); break; }
      }
    };
    w.after(2 * w.dt, burn);
    every(w, iv, (k) => { if (k + 2 > n) return false; burn(); });
  },
});
// Smoldering Resin: one debuff per target with one clock; every attack adds an entry [damage per tick, ticks left]
debuff('modifier_batrider_smoldering_resin_debuff', {
  statusResist: false, multi: 'perCaster', interval: (m) => m.v('tick_rate'),
  onCreated(m) { m.data = []; },
  onThink(m) {
    let sum = 0;
    for (const it of m.data) { sum += it[0]; it[1]--; }
    m.data = m.data.filter((it) => it[1] > 0);
    if (sum > 0) m.parent.world.damage(m.caster, m.parent, sum, PHYSICAL, 0, m.ability);
    if (!m.data.length && !m.removed) m.remove();
  },
});
passive('batrider_smoldering_resin', {
  fid: 'approx', note: '[L] measured in Hero Demo: the debuff ticks every tick_rate counted from the attack that created it; every attack adds tick_attack_damage_pct of its damage for the next total_ticks ticks, and one tick deals the sum of all running entries as a single instance; the debuff ends with its last entry. The tooltip gives no damage type: physical is used (shipped patch note 7.36: the damage over time pierces damage block)',
  onAttackLanded(m, rec) {
    const t = rec.target;
    if (!t.alive || t.isBuilding || t.team === m.parent.team || !(rec.damage > 0)) return;
    const d = t.addModifier('modifier_batrider_smoldering_resin_debuff', { caster: m.parent, ability: m.ability });
    if (d) d.data.push([rec.damage * m.v('tick_attack_damage_pct') / 100, m.v('total_ticks')]);
  },
});
debuff('modifier_batrider_flaming_lasso', {
  pierce: true, purge: 'strong', state: ['STUN'], interval: (m) => m.v('tick_rate'), thinkNow: true,
  // m.x = ticks done
  onThink(m) { if (m.x++ < Math.floor(m.v('duration') / m.v('tick_rate') + 1e-6)) mhit(m, m.parent, m.v('damage') * m.v('tick_rate') / m.v('duration'), MAGICAL); },
});
modifier('modifier_batrider_flaming_lasso_self', {
  purge: 'none', state: ['DISARM'], interval: 0.1,
  onThink(m) {
    const u = m.parent; let any = false;
    for (const e of m.data) {
      if (!e.alive || !e.hasModifier('modifier_batrider_flaming_lasso')) continue;
      any = true;
      const d = u.distTo(e);
      if (d > m.v('drag_distance')) knockback(e, u.x, u.y, m.v('drag_distance') - d);
    }
    if (!any) m.remove();
  },
  onDestroy(m) { for (const e of m.data) { const l = e.alive ? e.findModifier('modifier_batrider_flaming_lasso') : null; if (l && l.caster === m.parent) l.remove(); } },
});
defAbility('batrider_flaming_lasso', {
  fid: 'approx', prio: 90,
  note: '[L] measured in Hero Demo: the first damage tick lands with the lasso, the others every tick_rate, floor(duration / tick_rate) ticks of damage x tick_rate / duration each (3.25 s: 6 ticks, the rest of the damage is never dealt); Batrider is disarmed for exactly the duration. The victim cannot act and is kept within drag_distance of Batrider; the lasso ends when he dies. The default controller does not drag the victim anywhere. Scepter: the nearest allied hero of the target within grab_radius_scepter gets the same lasso',
  ai: (ab, u, t) => (t && t.isHero && !t.hasModifier('modifier_batrider_flaming_lasso') ? { target: t } : null),
  cast(ab, t) {
    const u = ab.owner; const w = u.world; const dur = ab.v('duration'); const vs = [t]; const r = ab.v('grab_radius_scepter');
    if (r > 0) {
      let best = null; let bd = r;
      for (const e of w.units) { if (!e.alive || e === t || e.team !== t.team || !e.isHero || e.st[ST.OUT] > 0) continue; const d = t.distTo(e); if (d <= bd) { bd = d; best = e; } }
      if (best) vs.push(best);
    }
    const held = vs.filter((e) => addMod(ab, e, 'modifier_batrider_flaming_lasso', dur, { pierce: true }));
    if (held.length) u.addModifier('modifier_batrider_flaming_lasso_self', { ability: ab, duration: dur, data: held });
  },
});

// ================================================================ Disruptor
debuff('modifier_disruptor_thunder_strike_slow', { stats: (m) => ({ msPct: -m.v('slow_amount'), asSlow: -m.v('slow_amount') }) });
debuff('modifier_disruptor_thunder_strike', {
  statusResist: false, interval: (m) => m.v('strike_interval'), thinkNow: true,
  onRefresh(m) { m.x = 0; },
  onThink(m) {                                                     // m.x = strikes done
    const t = m.parent; const c = m.caster; const n = m.x++;
    if (n < m.v('strikes')) {
      const dmg = m.v('strike_damage') + m.v('strike_damage_bonus') * n;
      for (const e of t.world.enemiesInRadius(c, t.x, t.y, m.v('radius'))) {
        if (e.isBuilding) continue;
        mhit(m, e, dmg, MAGICAL);
        if (e.alive) e.addModifier('modifier_disruptor_thunder_strike_slow', { caster: c, ability: m.ability, duration: m.v('slow_duration') });
      }
    }
    if (m.x >= m.v('strikes') && !m.removed) m.remove();
  },
});
defAbility('disruptor_thunder_strike', {
  fid: 'approx', prio: 55,
  note: 'the first strike lands at once, the others every strike_interval (the tooltip gives no timing for the first one); the talent adds strike_damage_bonus per earlier strike. The Shard text on this ability (ground targeting, more range and strikes) has no values in the data and the ability is not flagged as Shard-upgraded, so it is not modelled',
  ai: (ab, u, t) => (t && !t.isBuilding && !t.hasModifier('modifier_disruptor_thunder_strike') ? foe(ab, t) : null),
  cast(ab, t) { addMod(ab, t, 'modifier_disruptor_thunder_strike', ab.v('strikes') * ab.v('strike_interval')); },
});
// Glimpse needs to know where enemy heroes were backtrack_time ago: a hidden modifier samples their positions four times a second.
modifier('modifier_disruptor_glimpse', {
  hidden: true, purge: 'none', interval: 0.25, thinkNow: true,
  onCreated(m) { m.data = new Map(); },
  onThink(m) {
    const u = m.parent; const w = u.world; const old = w.time - m.v('backtrack_time');
    for (const e of w.units) {
      if (!e.alive || e.team === u.team || !e.isHero) continue;
      let h = m.data.get(e);
      if (!h) m.data.set(e, h = []);
      h.push(w.time, e.x, e.y);
      while (h.length > 3 && h[3] <= old + 1e-9) h.splice(0, 3);   // h[0..2] stays the newest sample that is at least backtrack_time old
    }
  },
});
function glimpsePoint(ab, t) { const m = ab.owner.findModifier('modifier_disruptor_glimpse'); const h = m && m.data.get(t); return h && h.length ? [h[1], h[2]] : null; }
defAbility('disruptor_glimpse', {
  mods: ['modifier_disruptor_glimpse'], fid: 'approx', prio: 68,
  note: 'positions of enemy heroes are sampled every 0.25 s (the start position is used while the fight is younger than backtrack_time); the target is moved back at once (the travel time is not in the data). The default controller uses it when the target has moved at least 250 units in that time',
  ai(ab, u, t) {
    if (!t || !t.isHero || blocked(ab, t)) return null;
    const p = glimpsePoint(ab, t);
    return p && (t.isIllusion || hyp(t.x - p[0], t.y - p[1]) >= 250) ? { target: t } : null;
  },
  cast(ab, t) {
    const u = ab.owner;
    if (t.isIllusion) { u.world.kill(t, u, ab); return; }
    const p = glimpsePoint(ab, t) || [t.x, t.y]; const d = hyp(t.x - p[0], t.y - p[1]);
    t.x = p[0]; t.y = p[1];
    hit(ab, t, Math.min(ab.v('max_damage'), Math.max(ab.v('min_damage'), d * ab.v('damage_to_distance_pct') / 100)), MAGICAL);
  },
});
// Kinetic barriers. The engine has no collision, so every tick_rate the enemies that walked into the wall are put back on their side.
// A unit that moved much further than it can walk in one tick has teleported and simply changes side; debuff immune units pass.
function kineticTouch(ab, e) {
  const u = ab.owner; const er = u.findAbility('disruptor_electromagnetic_repulsion');
  if (!(ab.v('strike_on_touch') > 0) || !er || er.level < 1) return;
  const now = u.world.time; const touched = (er.data ||= new Map());   // one timer per enemy, shared by Field and Fence (shipped patch note 7.42)
  if (touched.get(e) > now - er.v('shard_touch_interval')) return;
  touched.set(e, now);
  hit(er, e, u.int * er.v('damage_per_int'), MAGICAL);
}
function kineticField(ab, cx, cy) {
  const u = ab.owner; const w = u.world; const iv = ab.v('tick_rate'); const R = ab.v('radius'); const half = ab.v('wall_thickness');   // [L] measured in Hero Demo: a unit inside touches the ring wall_thickness before the radius
  const end = w.time + ab.v('duration'); const side = new Map(); const last = new Map(); const dps = ab.v('damage_per_second');
  every(w, iv, () => {
    if (w.time > end + 1e-9) return false;
    for (const e of w.units) {
      if (!e.alive || e.team === u.team || e.isBuilding || e.st[ST.OUT] > 0) continue;
      const dx = e.x - cx; const dy = e.y - cy; const d = hyp(dx, dy);
      const p = last.get(e); const jumped = p !== undefined && hyp(e.x - p[0], e.y - p[1]) > e.ms * iv * 2 + 40;
      let s = side.get(e);
      if (s === undefined || jumped || e.st[ST.IMMUNE] > 0) { s = d <= R ? 1 : -1; side.set(e, s); }
      else if (s === 1 && d > R - half) { const k = (R - half) / d; e.x = cx + dx * k; e.y = cy + dy * k; kineticTouch(ab, e); }
      else if (s === -1 && d < R + half) { const k = d > 1 ? (R + half) / d : 0; e.x = k ? cx + dx * k : cx + R + half; e.y = k ? cy + dy * k : cy; kineticTouch(ab, e); }
      if (p) { p[0] = e.x; p[1] = e.y; } else last.set(e, [e.x, e.y]);
      if (dps > 0 && s === 1 && e.alive) hit(ab, e, dps * iv, MAGICAL);
    }
  }, 0);
}
defAbility('disruptor_kinetic_field', {
  fid: 'approx', prio: 72,
  note: 'after formation_time the ring keeps enemies on the side they were on (position corrected every tick_rate; teleports change side, debuff immune units pass). Shard: a unit touching the ring takes the Electromagnetic Repulsion damage once per shard_touch_interval; the reduced knockback of that strike is not modelled. The default controller casts it on a hero while Disruptor stands outside the ring',
  ai(ab, u, t) {
    if (!t || !t.isHero || t.st[ST.IMMUNE] > 0) return null;
    const p = lead(t, ab.v('AbilityCastPoint') + ab.v('formation_time'));
    return hyp(u.x - p.x, u.y - p.y) > ab.v('radius') + 80 ? { x: p.x, y: p.y } : null;
  },
  cast(ab, t, x, y) { ab.owner.world.after(ab.v('formation_time'), () => kineticField(ab, x, y)); },
});
// wall through (cx, cy) with unit normal (nx, ny); half length L along the wall
function kineticFence(ab, cx, cy, nx, ny) {
  const u = ab.owner; const w = u.world; const iv = ab.v('tick_rate'); const L = ab.v('wall_width') / 2; const half = ab.v('wall_thickness');
  const end = w.time + ab.v('duration'); const side = new Map(); const last = new Map(); const pass = new Map(); const dps = ab.v('damage_per_second');
  every(w, iv, () => {
    if (w.time > end + 1e-9) return false;
    for (const e of w.units) {
      if (!e.alive || e.team === u.team || e.isBuilding || e.st[ST.OUT] > 0) continue;
      const s = (e.x - cx) * nx + (e.y - cy) * ny; const a = (e.y - cy) * nx - (e.x - cx) * ny;   // distance from the wall line, position along it
      const p = last.get(e); const jumped = p !== undefined && hyp(e.x - p[0], e.y - p[1]) > e.ms * iv * 2 + 40;
      const sd = side.get(e);
      if (sd === undefined || jumped || Math.abs(a) > L || e.st[ST.IMMUNE] > 0 || pass.get(e) === 0) side.set(e, s >= 0 ? 1 : -1);
      else if (s * sd < half) {
        let free = pass.get(e);
        if (free === undefined) pass.set(e, free = w.time + 2 * (L - Math.abs(a)) / Math.max(100, e.ms));   // time to walk around the nearer end of the wall
        if (w.time >= free) pass.set(e, 0);
        else {
          const push = half - s * sd; e.x += nx * sd * push; e.y += ny * sd * push;
          kineticTouch(ab, e);
          if (dps > 0 && e.alive) hit(ab, e, dps * iv, MAGICAL);
        }
      }
      if (p) { p[0] = e.x; p[1] = e.y; } else last.set(e, [e.x, e.y]);
    }
  }, 0);
}
defAbility('disruptor_kinetic_fence', {
  fid: 'approx', prio: 66,
  note: 'an ordered cast lays the wall along the line from Disruptor to the point ([L] measured in Hero Demo); the default controller chooses the vector itself and lays it across the path of the enemy. Units have no pathfinding, so a blocked unit is held at the wall for the time a walk around its nearer end would take and is let through afterwards. Touching the wall deals the Electromagnetic Repulsion damage once per shard_touch_interval; the reduced knockback is not modelled. The default controller lays it in front of an approaching melee enemy',
  ai(ab, u, t) {
    if (!t || !t.melee || !t.canAttack || t.isBuilding || t.st[ST.IMMUNE] > 0) return null;
    const d = u.distTo(t); const ahead = t.ms * (ab.v('formation_time') + 0.1) + 80;
    if (!(d > ahead + 200 && d <= ab.castRange() + 200)) return null;
    ab.data = [(u.x - t.x) / d, (u.y - t.y) / d];                   // vector targeting: the wall is laid across the enemy's path
    return { x: t.x + ab.data[0] * ahead, y: t.y + ab.data[1] * ahead };
  },
  cast(ab, t, x, y) {
    // [L] measured in Hero Demo: without a chosen vector the wall runs along the line from Disruptor to the point, centred on the point
    const u = ab.owner; const d = hyp(x - u.x, y - u.y); let nx = d > 1 ? -(y - u.y) / d : 0; let ny = d > 1 ? (x - u.x) / d : 1;
    if (ab.data) { nx = ab.data[0]; ny = ab.data[1]; ab.data = null; }
    u.world.after(ab.v('formation_time'), () => kineticFence(ab, x, y, nx, ny));
  },
});
airborne('modifier_disruptor_electromagnetic_repulsion_knockback');
passive('disruptor_electromagnetic_repulsion', {
  fid: 'approx',
  note: 'damage from enemies within effect_radius is added up; the counter is cleared when no such damage arrived for damage_reset_interval; above damage_threshold (and off cooldown) every enemy in the radius is damaged and pushed out at once to effect_radius + 50 ([L] measured in Hero Demo; the knockback is not a stun and its flight of knockback_duration is not simulated). The data gives no damage type: magical assumed',
  onTakeDamage(m, d) {                                             // m.x = damage counted, m.y = time of the last counted damage
    const u = m.parent; const w = u.world; const s = d.src;
    if (!s || s.team === u.team || d.dealt <= 0 || u.distTo(s) > m.v('effect_radius')) return;
    if (w.time - m.y > m.v('damage_reset_interval')) m.x = 0;
    m.x += d.dealt; m.y = w.time;
    if (m.x <= m.v('damage_threshold') || !m.ability.cdReady() || u.hp <= 0) return;
    m.x = 0; m.ability.startCooldown();
    const R = m.v('effect_radius');
    for (const e of w.enemiesInRadius(u, u.x, u.y, R)) {
      if (e.isBuilding) continue;
      mhit(m, e, u.int * m.v('damage_per_int'), MAGICAL);
      if (e.alive && !blocked(m.ability, e)) knockback(e, u.x, u.y, Math.max(0, R + 50 - u.distTo(e)));   // [L] measured in Hero Demo: pushed to effect_radius + 50 from Disruptor, no stun state
    }
  },
});
debuff('modifier_disruptor_static_storm_silence', { state: ['SILENCE'], statusResist: false, purge: 'none' });
debuff('modifier_disruptor_static_storm_mute', { state: ['MUTE'], statusResist: false, purge: 'none' });
defAbility('disruptor_static_storm', {
  fid: 'full', prio: 85,
  note: '[L] measured in Hero Demo: a pulse every duration / pulses seconds, pulse k deals damage_max x 0.25 x k / pulses (the 0.25 is not a data value) and the pulse that falls on the end of the storm does not happen (19 of 20); the silence (and the Scepter mute) holds while a unit is inside and ends about 0.1 s after the storm (checked every 0.1 s)',
  ai: (ab, u, t) => (t && t.isHero ? { x: t.x, y: t.y } : null),
  cast(ab, t, x, y) {
    const u = ab.owner; const w = u.world; const n = Math.max(1, ab.v('pulses')); const dur = ab.v('duration'); const end = w.time + dur;
    every(w, dur / n, (k) => {
      if (k + 1 >= n) return false;
      for (const e of enemiesNear(ab, x, y, ab.v('radius'))) if (!e.isBuilding) hit(ab, e, ab.v('damage_max') * 0.25 * (k + 1) / n, MAGICAL);
    });
    every(w, 0.1, () => {
      const left = end - w.time;
      if (left < -1e-9) return false;
      const hold = Math.min(0.15, left + 0.08);
      for (const e of enemiesNear(ab, x, y, ab.v('radius'))) {
        if (e.isBuilding) continue;
        addMod(ab, e, 'modifier_disruptor_static_storm_silence', hold);
        if (u.hasScepter) addMod(ab, e, 'modifier_disruptor_static_storm_mute', hold);
      }
    }, 0);
  },
});

// ================================================================ Keeper of the Light
const KOTL_FORM = 'modifier_keeper_of_the_light_spirit_form';
function illuminateWave(ab, sx, sy, x, y, frac, heal) {
  const u = ab.owner; const w = u.world; const d = hyp(x - sx, y - sy) || 1; const ux = (x - sx) / d; const uy = (y - sy) / d;
  const ex = sx + ux * ab.v('range'); const ey = sy + uy * ab.v('range'); const dmg = ab.v('total_damage') * frac; const sp = ab.v('speed'); const width = 2 * (ab.v('radius'));
  if (!(dmg > 0)) return;
  if (!missed(w)) for (const e of enemiesInLine(ab, sx, sy, ex, ey, width)) { if (!e.isBuilding) w.after(Math.max(0, (e.x - sx) * ux + (e.y - sy) * uy) / sp, () => { if (e.alive) hit(ab, e, dmg, MAGICAL); }); }
  if (heal > 0) alongLine(w, u.team, sx, sy, ex, ey, width, (a, along) => { if (a !== u && !a.isBuilding) w.after(along / sp, () => a.heal(dmg * heal / 100, u, ab)); });
}
defAbility('keeper_of_the_light_illuminate', {
  fid: 'approx', prio: 50,
  channel: (ab) => (ab.owner.hasModifier(KOTL_FORM) ? 0 : ab.v('AbilityChannelTime')),
  note: 'the wave is a line of half-width `radius` (the tooltip labels this value WIDTH) and length `range` from the caster towards the point, hitting each enemy when it arrives; damage grows linearly with the time channelled; the default controller always channels to the end, an interrupted channel still releases the wave with the damage built so far. In Spirit Form Keeper is free to act, the full wave leaves the cast position after max_channel_time and also heals allies on its path (Keeper himself is not healed)',
  ai: (ab, u, t) => (t && !t.isBuilding && u.distTo(t) <= ab.v('range') - 100 ? { x: t.x, y: t.y } : null),
  cast(ab, t, x, y) {
    const u = ab.owner; const w = u.world; const sf = u.findModifier(KOTL_FORM);
    ab.data = sf ? null : { x, y, t0: w.time };
    if (sf) { const sx = u.x; const sy = u.y; const heal = sf.v('illuminate_heal'); w.after(ab.v('max_channel_time'), () => illuminateWave(ab, sx, sy, x, y, 1, heal)); }
  },
  channelEnd(ab) {
    const u = ab.owner; const d = ab.data; ab.data = null;
    if (d) illuminateWave(ab, u.x, u.y, d.x, d.y, Math.min(1, (u.world.time - d.t0) / ab.v('max_channel_time')), 0);
  },
});
na('keeper_of_the_light_illuminate_end', 'early-release helper of Illuminate; the default controller always channels to the end');
debuff('modifier_keeper_of_the_light_blinding_light', { stats: (m) => ({ miss: m.v('miss_rate') }) });
airborne('modifier_keeper_of_the_light_blinding_light_knockback');
defAbility('keeper_of_the_light_blinding_light', {
  fid: 'approx', prio: 56, note: 'units are moved to the edge of the area at once (at least knockback_distance); [L] measured in Hero Demo: the knockback is not a stun and a unit standing on the centre is not moved; the default controller centres the flash 100 units on its own side of the target so that the target is pushed away',
  ai(ab, u, t) {
    if (!t || t.isBuilding) return null;
    const p = lead(t, ab.v('AbilityCastPoint')); const d = hyp(u.x - p.x, u.y - p.y) || 1; const k = Math.min(100, d) / d;
    return { x: p.x + (u.x - p.x) * k, y: p.y + (u.y - p.y) * k };
  },
  cast(ab, t, x, y) {
    const R = ab.v('radius');
    for (const e of enemiesNear(ab, x, y, ab.v('radius'))) {
      if (e.isBuilding) continue;
      hit(ab, e, ab.v('damage'), MAGICAL);
      if (!e.alive) continue;
      addMod(ab, e, 'modifier_keeper_of_the_light_blinding_light', ab.v('duration'));
      const de = hyp(e.x - x, e.y - y);
      if (de > 1 && !blocked(ab, e)) knockback(e, x, y, Math.max(R - de, ab.v('knockback_distance')));   // [L] measured in Hero Demo: no stun state; a unit on the centre is not moved
    }
  },
});
defAbility('keeper_of_the_light_chakra_magic', {
  fid: 'full', prio: 45, note: 'the self bonus applies to both the mana and the cooldown reduction; the default controller gives it to the allied hero in range that gains most (missing mana, basic abilities on cooldown)',
  ai(ab, u, t, w) {
    if (!t) return null;
    let best = null; let bs = 0.75;
    for (const a of w.units) {
      if (!a.alive || a.team !== u.team || !a.isHero || a.isIllusion || (a !== u && u.distTo(a) > ab.castRange())) continue;
      let s = a.maxMana > 0 ? Math.min(1, (a.maxMana - a.mana) / ab.v('mana_restore')) : 0;
      for (const x of a.abilities) if (x !== ab && x.level > 0 && x.def.type !== 'ultimate' && x.cdEnd - w.time > 1) s += 0.5;
      if (a === u) s *= 1 + ab.v('self_bonus') / 100;
      if (s > bs) { bs = s; best = a; }
    }
    return best ? { target: best } : null;
  },
  cast(ab, t) {
    const u = ab.owner; const tt = t || u; const now = u.world.time; const k = tt === u ? 1 + ab.v('self_bonus') / 100 : 1; const cut = ab.v('cooldown_reduction') * k;
    tt.giveMana(ab.v('mana_restore') * k);
    for (const a of tt.abilities) {
      if (a === ab || a.def.type === 'ultimate') continue;
      if (a.cdEnd > now) a.cdEnd = Math.max(now, a.cdEnd - cut);
      if (a.chargeEnd > now) a.chargeEnd = Math.max(now, a.chargeEnd - cut);
    }
    if (ab.v('strong_dispel') > 0) tt.purge({ debuffs: true, strong: true });
  },
});
// Solar Bind: m.z = magic resistance reduction, m.y = current slow, m.data = last position and distance moved
debuff('modifier_keeper_of_the_light_radiant_bind', {
  interval: 0.1, stats: (m) => ({ mr: -m.z, msPct: -m.y }),
  onCreated(m) { m.data = [m.parent.x, m.parent.y, 0]; },
  onThink(m) {
    const e = m.parent; const p = m.data; const d = hyp(e.x - p[0], e.y - p[1]); p[0] = e.x; p[1] = e.y;
    if (d <= 0 || d > e.ms * 0.2 + 40) return;                     // standing still, or teleported
    p[2] += d;
    const s = Math.min(100, m.v('slow') * p[2] / 100);
    if (s !== m.y) { m.y = s; e.dirty = true; }
  },
});
function solarBindResist(ab) {                                    // the value lists three levels for a one-level ability: they are taken by Spirit Form's level
  const sf = ab.owner.findAbility('keeper_of_the_light_spirit_form'); const e = ab.def.vals.magic_resistance; const arr = Array.isArray(e) ? e : e.v;
  const at = (lv) => arr[Math.min(arr.length, Math.max(1, lv)) - 1];
  return ab.v('magic_resistance') + at(sf ? sf.level : 1) - at(ab.level);
}
defAbility('keeper_of_the_light_radiant_bind', {
  fid: 'approx', prio: 70,
  note: 'the 7.42 tooltip does not say how this hidden one-level ability is unlocked or which of its three magic resistance values applies. Following the shipped patch notes (7.33 "now requires Spirit Form", 7.36 "granted by Spirit Form", three values since then) the default controller only casts it during Spirit Form and the reduction follows Spirit Form\'s level. The slow grows by `slow` % per 100 units walked (checked every 0.1 s, up to 100%)',
  ai: (ab, u, t) => (t && !t.isBuilding && u.hasModifier(KOTL_FORM) && !t.hasModifier('modifier_keeper_of_the_light_radiant_bind') ? foe(ab, t) : null),
  cast(ab, t) { const m = addMod(ab, t, 'modifier_keeper_of_the_light_radiant_bind', ab.v('duration')); if (m) { m.z = solarBindResist(ab); t.dirty = true; } },
});
debuff('modifier_keeper_of_the_light_will_o_wisp_debuff', { state: ['STUN'], statusResist: false, purge: 'none' });
function ignisFlicker(ab, x, y) {
  const u = ab.owner; const w = u.world; const on = ab.v('on_duration'); const iv = 0.1; const t0 = w.time;
  for (const e of enemiesNear(ab, x, y, ab.v('radius'))) if (!e.isBuilding) hit(ab, e, ab.v('wisp_damage'), MAGICAL);
  every(w, iv, () => {
    const left = on - (w.time - t0);
    if (left < iv / 2) return false;
    for (const e of enemiesNear(ab, x, y, ab.v('radius'))) {
      if (e.isBuilding) continue;
      if (!e.hasModifier('modifier_keeper_of_the_light_will_o_wisp_debuff') && !addMod(ab, e, 'modifier_keeper_of_the_light_will_o_wisp_debuff', left)) continue;
      knockback(e, x, y, -ab.v('fixed_movement_speed') * iv);
    }
  }, 0);
}
defAbility('keeper_of_the_light_will_o_wisp', {
  fid: 'approx', prio: 82,
  note: 'on_count flickers: off_duration_initial, then on_duration on / off_duration off. While it is on, enemies in the radius cannot act (modifier text "Hypnotized: unable to act") and drift towards it at fixed_movement_speed; every flicker deals wisp_damage once (patch note 7.35 "damage per flicker"). Ignis Fatuus is not a unit here: it cannot be attacked (pip health)',
  ai: (ab, u, t) => (t && t.isHero ? { x: t.x, y: t.y } : null),
  cast(ab, t, x, y) {
    const w = ab.owner.world; let at = ab.v('off_duration_initial');
    for (let i = 0; i < ab.v('on_count'); i++) { w.after(at, () => ignisFlicker(ab, x, y)); at += ab.v('on_duration') + ab.v('off_duration'); }
  },
});
buff(KOTL_FORM, { purge: 'none', stats: (m) => ({ castRange: m.v('cast_range') }) });
selfBuff('keeper_of_the_light_spirit_form', {
  fid: 'full', prio: 90, mod: KOTL_FORM, duration: 'duration', note: 'cast range, the Bright Speed bonus and the Illuminate changes are applied by the respective scripts',
  ai: (ab, u, t) => (t && u.distTo(t) <= 1600 && !u.hasModifier(KOTL_FORM) ? NOW : null),
});
passive('keeper_of_the_light_bright_speed', {
  fid: 'full', note: '[L] measured in Hero Demo (hero stats at every level): one speed per intelligence_per_speed intelligence, a started step counts (rounded up); the light trail only gives vision (no vision in the sandbox)',
  late(m, s, u) { const sf = u.findModifier(KOTL_FORM); s.ms += Math.ceil(u.int / m.v('intelligence_per_speed') - 1e-9) * (sf ? 1 + sf.v('movement_speed') / 100 : 1); },
});

// ================================================================ Naga Siren
modifier('modifier_naga_siren_mirror_image_split', { purge: 'none', state: ['OUT', 'INVULN', 'STUN'],   // [L] measured in Hero Demo: Naga is also stunned while she splits
  onDestroy(m, expired) { if (expired && m.parent.alive) nagaImages(m.ability); } });
function nagaImages(ab) {
  const u = ab.owner; const n = ab.v('images_count');
  for (let i = 0; i < n; i++) {
    const a = 2 * Math.PI * i / n;
    ab.data.push(u.world.createIllusion(u, { duration: ab.v('illusion_duration'), outPct: ab.v('outgoing_damage'), inPct: ab.v('incoming_damage'), x: u.x + 80 * Math.cos(a), y: u.y + 80 * Math.sin(a) }));
  }
}
defAbility('naga_siren_mirror_image', {
  fid: 'full', prio: 70, note: 'Naga is out of play for invuln_duration, then the images appear around her; cast again only when no image is left',
  ai: (ab, u, t) => (t && u.distTo(t) <= 900 && !(ab.data && ab.data.some((i) => i.alive)) ? NOW : null),
  cast(ab) {
    const u = ab.owner;
    u.purge({ debuffs: true });
    for (const i of ab.data || []) if (i.alive) u.world.kill(i, null, null, true);
    ab.data = [];
    u.addModifier('modifier_naga_siren_mirror_image_split', { ability: ab, duration: ab.v('invuln_duration') });
  },
});
debuff('modifier_naga_siren_ensnare', { state: ['ROOT'] });
// the engine does not recompute stats when Break starts or ends, so this modifier asks for it
debuff('modifier_naga_siren_ensnare_break', { state: ['BREAK'], hidden: true, onCreated(m) { m.parent.dirty = true; }, onDestroy(m) { m.parent.dirty = true; } });
defAbility('naga_siren_ensnare', {
  mods: [sync('naga_siren_ensnare', (ab) => { ab.pierces = ab.v('can_target_magic_immune') > 0; })],
  fid: 'approx', prio: 76,
  note: 'net projectile, root ([L] measured in Hero Demo: no stun state), Break and piercing of debuff immunity with Scepter. Units sleeping under Song of the Siren cannot be netted (the engine refuses debuffs on invulnerable units)',
  ai: (ab, u, t) => (t && !t.isBuilding && t.heroLike && t.st[ST.ROOT] === 0 ? foe(ab, t) : null),
  cast(ab, t) {
    const u = ab.owner; const pierce = ab.pierces;
    u.world.projectile(u, t, ab.v('net_speed'), (tt) => {
      const m = blocked(ab, tt) ? null : addMod(ab, tt, 'modifier_naga_siren_ensnare', ab.v('duration'), { pierce });
      if (!m) return;
      if (ab.v('does_break') > 0) tt.addModifier('modifier_naga_siren_ensnare_break', { caster: u, ability: ab, duration: m.remaining(), noResist: true, pierce });
    });
  },
});
debuff('modifier_naga_siren_rip_tide_debuff', { stats: (m) => ({ armor: -Math.abs(m.v('armor_reduction')) }) });
passive('naga_siren_rip_tide', {
  illusion: true, fid: 'approx',
  note: 'attacks of Naga and her illusions fill one shared counter (kept on the real Naga); on the `hits`-th attack Naga and every illusion release a wave around themselves, dealt just before the damage of that attack ([L] measured in Hero Demo); an enemy inside several waves is hit once',
  outgoing(m, d) {
    const u = m.parent; const rec = d.rec;
    if (!(d.flags & F_ATTACK) || !rec || rec.secondary || rec.attacker !== u || d.dst !== rec.target || rec.target.isBuilding || rec.target.team === u.team) return;
    const main = u.isIllusion && u.owner && u.owner.name === u.name ? u.owner : u;
    const mm = (main !== u && main.findModifier('modifier_naga_siren_rip_tide')) || m;
    if (++mm.x < mm.v('hits')) return;
    mm.x = 0;
    const ab = mm.ability; const w = u.world; const seen = new Set();
    for (const n of w.units) {
      if (!n.alive || n.name !== main.name || !(n === main || (n.isIllusion && n.owner === main))) continue;
      for (const e of w.enemiesInRadius(main, n.x, n.y, ab.v('radius'))) {
        if (seen.has(e) || e.isBuilding) continue;
        seen.add(e);
        w.damage(main, e, ab.v('damage'), MAGICAL, 0, ab);
        if (e.alive) e.addModifier('modifier_naga_siren_rip_tide_debuff', { caster: main, ability: ab, duration: ab.v('duration') });
      }
    }
  },
});
function reelTargets(ab) {
  const u = ab.owner; const out = [];
  for (const e of u.world.inRadius(u.x, u.y, ab.v('radius'), u.team, true)) {
    const m = e.findModifier('modifier_naga_siren_ensnare');
    if (m && m.caster === u && (e.st[ST.IMMUNE] === 0 || ab.v('can_target_magic_immune') > 0)) out.push(e);
  }
  return out;
}
function reelTime(ab) {
  const u = ab.owner; let t = 0;
  for (const e of reelTargets(ab)) t = Math.max(t, Math.min(e.findModifier('modifier_naga_siren_ensnare').remaining(), (u.distTo(e) - ab.v('min_pull_distance')) / ab.v('pull_strength')));
  return Math.max(0, Math.min(ab.v('AbilityChannelTime'), t));
}
defAbility('naga_siren_reel_in', {
  fid: 'approx', manual: true, prio: 20, channel: reelTime,
  note: 'manual: pulling is slower than Naga walks and the channel stops her attacks, so the default controller never uses it (list it in ai.order to use it). The channel lasts until the furthest netted unit is min_pull_distance away, its net ends, or AbilityChannelTime is over; netted units move towards Naga at pull_strength',
  cast(ab) {
    const u = ab.owner; const w = u.world; const iv = 0.1;
    if (!reelTargets(ab).length) { refuse(ab); return; }           // [L] measured in Hero Demo: not cast without a netted enemy in range
    every(w, iv, () => {
      if (!u.alive || u.channelAb !== ab) return false;
      for (const e of reelTargets(ab)) { const d = u.distTo(e) - ab.v('min_pull_distance'); if (d > 0) knockback(e, u.x, u.y, -Math.min(d, ab.v('pull_strength') * iv)); }
    }, iv);
  },
});
passive('naga_siren_eelskin', {
  illusion: true, fid: 'approx', interval: 0.5, thinkNow: true,
  note: 'evasion_per_naga for Naga herself plus the same for every other allied Naga Siren (illusions included) within the radius, counted every 0.5 s; illusions carry the passive too',
  stats: (m) => ({ evasion: m.v('evasion_per_naga') * (1 + m.x) }),
  onThink(m) {
    const u = m.parent; let n = 0;
    for (const o of u.world.units) if (o !== u && o.alive && o.team === u.team && o.name === u.name && u.distTo(o) <= m.v('radius')) n++;
    if (n !== m.x) { m.x = n; u.dirty = true; }
  },
});
const NAGA_SLEEP = 'modifier_naga_siren_song_of_the_siren_sleep';
debuff(NAGA_SLEEP, { state: ['SLEEP', 'INVULN', 'ROOT', 'DISARM'],   // [L] measured in Hero Demo: asleep units are also rooted and disarmed
  purge: 'none', statusResist: false });
buff('modifier_naga_siren_song_of_the_siren', {
  purge: 'none', interval: 0.1, thinkNow: true,
  onCreated(m) { m.data = new Set(); },
  onThink(m) {
    const u = m.parent; const w = u.world; const R = m.v('radius');
    for (const e of w.units) {
      if (!e.alive || e.team === u.team || e.isBuilding) continue;
      const inside = u.distTo(e) <= R;
      if (inside && !m.data.has(e)) { if (e.addModifier(NAGA_SLEEP, { caster: u, ability: m.ability, duration: m.remaining() + 0.2 })) m.data.add(e); }
      else if (!inside && m.data.has(e)) { e.removeModifierByName(NAGA_SLEEP); m.data.delete(e); }
    }
    if (++m.x % 5) return;                                         // regeneration is paid out in 0.5 s steps
    const hp = m.v('heal_pct'); const mp = m.v('mana_pct');
    for (const a of w.alliesInRadius(u, u.x, u.y, m.v('radius'))) {
      if (a.isBuilding) continue;
      if (hp > 0) a.heal(a.maxHp * hp / 100 * 0.5, u, m.ability);
      if (mp > 0) a.giveMana(a.maxMana * mp / 100 * 0.5);
    }
  },
  onDestroy(m) { for (const e of m.data) e.removeModifierByName(NAGA_SLEEP); },
});
defAbility('naga_siren_song_of_the_siren', {
  fid: 'full', prio: 96, note: 'enemies inside the radius around Naga (checked every 0.1 s) sleep and are invulnerable; allies in the radius regain heal_pct of max health per second, which the data grants without Shard as well, plus mana_pct of max mana with Shard. The default controller sings below 30% health',
  ai: (ab, u, t) => (t && u.hp / u.maxHp < 0.3 && u.distTo(t) <= ab.v('radius') && !u.hasModifier('modifier_naga_siren_song_of_the_siren') ? NOW : null),
  cast(ab) { addMod(ab, ab.owner, 'modifier_naga_siren_song_of_the_siren', ab.v('duration')); },
});
defAbility('naga_siren_song_of_the_siren_cancel', {
  fid: 'full', manual: true, note: 'manual: ends the song early; the default controller lets the song run its full duration',
  cast(ab) { ab.owner.removeModifierByName('modifier_naga_siren_song_of_the_siren'); },
});

// ================================================================ Razor
// m.x = slow of this zap; [L] every zap is its own slow (two zaps in a row add up)
debuff('modifier_razor_plasma_field_slow', { multi: 'independent', stats: (m) => ({ msPct: -m.x }) });
// [L] measured in Hero Demo (three dummies at 100 / 400 / 650 and one at 200): the ring moves at radius / (total_ability_time / 2) and is
// checked every tick, centred on Razor. Going out its front runs RING_FRONT ahead of the ring and zaps a unit when it touches the unit's hull;
// coming back it zaps a unit when the ring passes the unit's centre, and it is back at Razor RING_BACK s after total_ability_time.
// Damage and slow follow the ring's radius at that moment (radius / `radius`), not the unit's distance; damage is a whole number, the
// slow whole percent (rounded down).
const RING_FRONT = 100; const RING_BACK = 0.365;
function plasmaRing(ab, scale) {
  const u = ab.owner; const w = u.world; const half = ab.v('total_ability_time') / 2; const t0 = w.time; const out = new Set(); const back = new Set();
  const zap = (e, p, R) => {
    const k = Math.max(0, Math.min(1, p / R));
    hit(ab, e, Math.round((ab.v('damage_min') + (ab.v('damage_max') - ab.v('damage_min')) * k) * scale), MAGICAL);
    const m = e.alive ? addMod(ab, e, 'modifier_razor_plasma_field_slow', ab.v('slow_duration')) : null;
    if (m) { m.x = Math.floor(ab.v('slow_min') + (ab.v('slow_max') - ab.v('slow_min')) * k + 1e-6); e.dirty = true; }
  };
  every(w, w.dt, () => {
    const el = w.time - t0 + 1e-6; const R = ab.v('radius'); const v = R / half; const end = 2 * half + RING_BACK;
    if (el > end + w.dt) return false;
    const pOut = v * el; const pBack = v * (end - el);
    for (const e of w.inRadius(u.x, u.y, R + RING_FRONT, u.team, true)) {
      if (e.isBuilding) continue;
      const d = u.distTo(e);
      if (el <= half + 1e-6) { if (!out.has(e) && pOut + RING_FRONT + e.def.hull >= d) { out.add(e); zap(e, pOut, R); } } else if (!back.has(e) && pBack <= d) { back.add(e); zap(e, pBack, R); }
    }
  }, 0);
}
defAbility('razor_plasma_field', {
  fid: 'approx', prio: 56,
  note: 'ring geometry and timing fitted to Hero Demo recordings (see the comment above plasmaRing); each pass zaps a unit once. Talent: the second field is taken to deal second_ring_reduction % less damage (its slow is not reduced)',
  ai: (ab, u, t) => (t && !t.isBuilding && u.distTo(t) <= ab.v('radius') - 50 ? NOW : null),
  cast(ab) {
    plasmaRing(ab, 1);
    if (ab.v('second_ring_delay') > 0) ab.owner.world.after(ab.v('second_ring_delay'), () => plasmaRing(ab, 1 - ab.v('second_ring_reduction') / 100));
  },
});
// Static Link: m.x on the two stat modifiers = damage stolen so far
modifier('modifier_razor_static_link_buff', { multi: 'independent', purge: 'none', stats: (m) => ({ dmg: m.x, as: m.x * m.v('attack_speed_factor') }) });
debuff('modifier_razor_static_link_debuff', { multi: 'independent', pierce: true, purge: 'none', statusResist: false, stats: (m) => ({ dmg: -m.x, asSlow: -m.x * m.v('attack_speed_factor') }) });
debuff('modifier_razor_static_link', {
  pierce: true, purge: 'none', statusResist: false, interval: 0.1,
  onThink(m) {
    const t = m.parent; const c = m.caster; const d = m.data;
    if (!c.alive || c.distTo(t) > m.ability.castRange() + m.v('drain_range_buffer')) { m.remove(); return; }
    const n = m.v('drain_rate') * 0.1;
    if (!d.buff.removed) { d.buff.x += n; c.dirty = true; }
    if (!d.debuff.removed) { d.debuff.x += n; t.dirty = true; }
  },
  onDestroy(m) { for (const x of [m.data.buff, m.data.debuff]) if (!x.removed) x.setDuration(m.v('drain_duration')); },   // the stolen damage stays for the buff duration
});
defAbility('razor_static_link', {
  fid: 'approx', prio: 82,
  note: 'drain_rate damage per second moves from the target to Razor (in 0.1 s steps) for drain_length or until the link breaks (death, or distance above cast range + drain_range_buffer); the stolen damage stays on both for drain_duration after the link ends; the talent also moves attack speed. Attacking while moving is not modelled. The Shard text on this ability has no values in the data and is not modelled',
  ai: (ab, u, t) => (t && t.isHero && !t.hasModifier('modifier_razor_static_link') ? foe(ab, t) : null),
  cast(ab, t) {
    const u = ab.owner;
    const buf = u.addModifier('modifier_razor_static_link_buff', { ability: ab });
    const deb = t.addModifier('modifier_razor_static_link_debuff', { caster: u, ability: ab, pierce: true });
    if (!buf || !deb || !t.addModifier('modifier_razor_static_link', { caster: u, ability: ab, duration: ab.v('drain_length') + PAD, pierce: true, data: { buff: buf, debuff: deb } })) { if (buf) buf.remove(); if (deb) deb.remove(); }
  },
});
debuff('modifier_razor_storm_surge_slow', { stats: (m) => ({ msPct: -m.v('strike_move_slow_pct') }) });
function stormSurge(m, src, always) {                              // m.y = end of the internal cooldown
  const u = m.parent; const w = u.world;
  if (!src || !src.alive || src.team === u.team || u.hp <= 0 || w.time + 1e-9 < m.y) return;
  const eye = u.findModifier('modifier_razor_eye_of_the_storm'); const mult = eye ? m.v('eye_of_the_storm_chance_multiplier') : 0;
  if (!always && !m.roll(m.v('strike_pct_chance') * (mult > 0 ? mult : 1))) return;
  m.y = w.time + Math.max(0, m.v('strike_internal_cd') - (eye ? m.v('strike_cd_reduction_during_storm') : 0));
  const pool = w.enemiesInRadius(u, u.x, u.y, m.v('strike_search_radius')).filter((e) => !e.isBuilding && e.st[ST.INVULN] === 0);
  const kind = src.heroLike;
  pool.sort((a, b) => ((b.heroLike === kind) - (a.heroLike === kind)) || (u.distTo(a) - u.distTo(b)));
  const targets = pool.includes(src) ? [src] : [];
  for (const e of pool) { if (targets.length >= m.v('strike_target_count')) break; if (e !== src) targets.push(e); }
  if (eye && m.v('hit_targets_inside_eye_of_the_storm') > 0) for (const e of w.enemiesInRadius(u, u.x, u.y, eye.v('radius'))) if (!e.isBuilding && !targets.includes(e)) targets.push(e);
  for (const e of targets) {
    w.damage(u, e, m.v('strike_damage'), MAGICAL, F_REFLECT, m.ability);
    if (e.alive) e.addModifier('modifier_razor_storm_surge_slow', { caster: u, ability: m.ability, duration: m.v('strike_slow_duration') });
  }
}
passive('razor_storm_surge', {
  fid: 'approx',
  note: 'a strike hits the attacker / caster (when inside strike_search_radius) and the nearest other enemies up to strike_target_count, units of the attacker\'s kind (hero or not) first; flagged as reflected damage. Shard values (chance multiplier, shorter cooldown, all enemies inside Eye of the Storm) apply while Eye of the Storm is active',
  onAttacked(m, rec) { stormSurge(m, rec.attacker, false); },
  onSpellTargeted(m, ev) { stormSurge(m, ev.caster, true); },
});
passive('razor_unstable_current', { fid: 'full', stats: (m) => ({ msPct: m.v('movespeed_pct') }) });
debuff('modifier_razor_eye_of_the_storm_armor', { multi: 'stack', pierce: true, purge: 'none', statusResist: false, stats: (m) => ({ armor: -m.v('armor_reduction') * m.stacks }) });
buff('modifier_razor_eye_of_the_storm', {
  multi: 'independent', purge: 'none', interval: (m) => m.v('strike_interval'),
  onThink(m) {
    const u = m.parent; const w = u.world; const towers = u.hasScepter;
    const pool = w.enemiesInRadius(u, u.x, u.y, m.v('radius')).filter((e) => e.st[ST.INVULN] === 0 && (towers || !e.isBuilding));
    pool.sort((a, b) => (b.hasModifier('modifier_razor_static_link') - a.hasModifier('modifier_razor_static_link')) || (a.hp - b.hp));
    for (const e of pool.slice(0, towers ? 2 : 1)) {                 // armor first, then the damage (shipped patch note 7.30)
      if (!e.isBuilding) e.addModifier('modifier_razor_eye_of_the_storm_armor', { caster: u, ability: m.ability, duration: m.remaining() + 0.1, pierce: true });
      w.damage(u, e, m.v('damage'), PHYSICAL, 0, m.ability);
    }
  },
});
defAbility('razor_eye_of_the_storm', {
  fid: 'approx', prio: 85,
  note: 'every strike_interval the lowest-health enemy in the radius is struck (a static-linked hero first; two different units and buildings with Scepter); each strike removes armor_reduction armor and the tooltip gives no duration for it: the reduction lasts until the storm ends. The default controller walks Razor to within the radius of its target before casting',
  ai: (ab, u, t) => (t && u.distTo(t) <= ab.v('radius') + 400 && !u.hasModifier('modifier_razor_eye_of_the_storm') ? closeIn(ab, u, t, ab.v('radius') - 50) : null),
  cast(ab) { addMod(ab, ab.owner, 'modifier_razor_eye_of_the_storm', ab.v('duration')); },
});

// ================================================================ Tusk
debuff('modifier_tusk_ice_shards_slow', { statusResist: false, stats: (m) => ({ msPct: -m.v('aghs_shard_move_slow') }) });
defAbility('tusk_ice_shards', {
  fid: 'partial', prio: 55,
  note: 'the ball damages every enemy on its way to the point (half-width shard_width, speed shard_speed). Missing: the barrier does not block movement (no terrain or pathing; it would only matter for units walking away from Tusk). Talent: for shard_duration enemies within shard_distance of the point (inside the ring of shards; shipped patch notes 7.30 / 7.41) are slowed (from the moment the ring forms) and burned every 1 s with the full per-second value (both measured)',
  ai: (ab, u, t) => (t && !t.isBuilding && u.distTo(t) <= ab.castRange() ? { x: t.x, y: t.y } : null),
  cast(ab, t, x, y) {
    const u = ab.owner; const w = u.world; const sx = u.x; const sy = u.y; const d = hyp(x - sx, y - sy) || 1; const sp = ab.v('shard_speed');
    const ticks = (s) => Math.floor(s / w.dt + 1e-6) * w.dt;      // [L] the ball touches a unit when its edge reaches the unit's hull, on whole ticks
    if (!missed(w)) for (const e of enemiesInLine(ab, sx, sy, x, y, 2 * ab.v('shard_width'))) {
      if (e.isBuilding) continue;
      const a = Math.max(0, Math.min(d, ((e.x - sx) * (x - sx) + (e.y - sy) * (y - sy)) / d));
      w.after(ticks(Math.max(0, a - ab.v('shard_width') - e.def.hull) / sp), () => { if (e.alive) hit(ab, e, ab.v('shard_damage'), MAGICAL); });
    }
    if (!(ab.v('aghs_shard_damage') > 0) && !(ab.v('aghs_shard_move_slow') > 0)) return;
    // [L] measured in Hero Demo (talent): the slow is on from the moment the ring forms; the damage comes every 1 s from then on
    // (shard_duration ticks of the full per-second value), the slow ends with the ring
    w.after(ticks(d / sp), () => {
      const end = w.time + ab.v('shard_duration');
      every(w, 0.5, () => {
        if (w.time > end + 1e-9 || !(ab.v('aghs_shard_move_slow') > 0)) return false;
        for (const e of enemiesNear(ab, x, y, ab.v('shard_distance'))) if (!e.isBuilding) addMod(ab, e, 'modifier_tusk_ice_shards_slow', Math.min(0.5 + w.dt, end - w.time + w.dt));
      }, 0);
      every(w, 1, () => {
        if (w.time > end + 1e-9 || !(ab.v('aghs_shard_damage') > 0)) return false;
        for (const e of enemiesNear(ab, x, y, ab.v('shard_distance'))) if (!e.isBuilding) hit(ab, e, ab.v('aghs_shard_damage'), MAGICAL);
      }, 1);
    });
  },
});
modifier('modifier_tusk_snowball_passenger', { purge: 'none', state: ['OUT', 'INVULN'] });
// [L] measured in Hero Demo: Tusk is rooted, disarmed, muted, invulnerable and out of play from the cast to the end of the roll; without
// a launch order the ball starts rolling after snowball_windup; it rolls every tick at snowball_speed, its radius grows by
// snowball_grow_rate per second of rolling, and it stops where it touches the target (Tusk stays there).
modifier('modifier_tusk_snowball', {
  purge: 'none', state: ['OUT', 'INVULN', 'ROOT', 'DISARM', 'MUTE'], interval: 1 / 30,
  onThink(m) {
    const u = m.parent; const d = m.data; const t = d.target; const ab = m.ability; const w = u.world;
    if (w.time < d.launch - 1e-9) return;
    const dx = t.x - u.x; const dy = t.y - u.y; const dist = hyp(dx, dy); const go = Math.min(dist, ab.v('snowball_speed') * w.dt);
    if (dist > 1e-6) { u.x += dx / dist * go; u.y += dy / dist * go; }
    for (const p of d.riders) { p.x = u.x; p.y = u.y; }
    const r = ab.v('snowball_radius') + ab.v('snowball_grow_rate') * (w.time - d.launch);
    for (const e of w.enemiesInRadius(u, u.x, u.y, r)) {
      if (d.hit.has(e) || e.isBuilding) continue;
      d.hit.add(e);
      hit(ab, e, ab.v('snowball_damage') + ab.v('snowball_damage_bonus') * d.riders.length, MAGICAL);
      if (e.alive) stun(ab, e, ab.v('stun_duration') + ab.v('stun_duration_bonus') * d.riders.length);
    }
    if (!m.removed && (!t.alive || d.hit.has(t))) m.remove();
  },
  onDestroy(m) {
    const u = m.parent; const d = m.data; let k = 0;
    for (const p of d.riders) { p.removeModifierByName('modifier_tusk_snowball_passenger'); if (p.alive) { k++; p.x = u.x + 45 * k; p.y = u.y + 45; } }
    if (u.alive && d.target.alive && u.ai && u.ai.mode !== 'idle') u.attack(d.target);
  },
});
defAbility('tusk_snowball', {
  fid: 'approx', prio: 76,
  note: 'without a controller the ball waits snowball_windup before it rolls (as in the game when no launch order comes); the default controller launches it at once and takes the allied melee heroes inside snowball_grab_radius along; the ball homes in on the target at snowball_speed for at most snowball_duration of rolling, stunning and damaging every enemy it touches (snowball_radius growing by snowball_grow_rate per second), with the per-ally bonus to damage and stun. Riders are out of play while rolling. snowball_speed_bonus (unlabelled) is not used',
  ai: (ab, u, t) => (t && !t.isBuilding && u.st[ST.ROOT] === 0 ? foe(ab, t) : null),
  cast(ab, t) {
    const u = ab.owner; const riders = [];
    for (const a of u.world.alliesInRadius(u, u.x, u.y, ab.v('snowball_grab_radius'))) if (a !== u && a.isHero && !a.isIllusion && a.melee && !a.channelAb && !a.castAb) riders.push(a);
    for (const a of riders) a.addModifier('modifier_tusk_snowball_passenger', { caster: u, ability: ab, duration: ab.v('snowball_duration') + 0.3 });
    const wind = u.ai && u.ai.mode !== 'idle' ? 0 : ab.v('snowball_windup');
    u.addModifier('modifier_tusk_snowball', { ability: ab, duration: wind + ab.v('snowball_duration'), data: { target: t, riders, hit: new Set(), launch: u.world.time + wind } });
  },
});
na('tusk_launch_snowball', 'launch helper of Snowball; the default controller launches the snowball the moment it is cast');
debuff('modifier_tusk_tag_team_slow', { stats: (m) => ({ msPct: -m.v('movement_slow') }) });
debuff('modifier_tusk_tag_team_debuff', {
  statusResist: false, purge: 'none',
  onAttacked(m, rec) {
    const a = rec.attacker; const c = m.caster; const t = m.parent;
    if (a.team !== c.team || !(a.isHero || a === c || a.owner === c)) return;
    mhit(m, t, m.v('bonus_damage'), PHYSICAL);
    if (t.alive) t.addModifier('modifier_tusk_tag_team_slow', { caster: c, ability: m.ability, duration: m.v('slow_duration') });
  },
});
aura('modifier_tusk_tag_team', { radius: (m) => m.v('radius'), team: 'enemy', child: 'modifier_tusk_tag_team_debuff', filter: (t) => !t.isBuilding, extra: { hidden: false, purge: 'none' } });
defAbility('tusk_tag_team', {
  fid: 'full', prio: 60, note: 'the aura is refreshed every 0.5 s and lingers 0.5 s; the bonus is a separate physical instance on every attack of an allied hero, Tusk or his units',
  ai: (ab, u, t) => (t && !t.isBuilding && u.distTo(t) <= ab.v('radius') && !u.hasModifier('modifier_tusk_tag_team') ? NOW : null),
  cast(ab) { addMod(ab, ab.owner, 'modifier_tusk_tag_team', ab.v('debuff_duration')); },
});
buff('modifier_tusk_drinking_buddies', { stats: (m) => ({ msPct: m.v('movespeed_bonus'), armor: m.v('armor_bonus') }) });
defAbility('tusk_drinking_buddies', {
  fid: 'approx', prio: 50,
  note: 'both Tusk and the tagged ally get the movement speed and armor; when they are more than min_distance apart both are pulled towards each other at once, in equal parts, until they are min_distance apart (the tooltip does not say where they meet). The default controller tags the nearest allied hero, and only one that needs no pull while Tusk is already in reach of his target',
  ai(ab, u, t, w) {
    if (!t || u.st[ST.ROOT] > 0 || u.hasModifier('modifier_tusk_drinking_buddies') || u.hasModifier('modifier_tusk_snowball')) return null;
    const engaged = u.rangeTo(t) <= u.attackRange + 50;
    let best = null; let bd = Infinity;
    for (const a of w.units) {
      if (!a.alive || a === u || a.team !== u.team || !a.isHero || a.isIllusion || a.st[ST.OUT] > 0) continue;
      const d = u.distTo(a);
      if (d <= (engaged ? ab.v('min_distance') : ab.castRange()) && d < bd) { bd = d; best = a; }
    }
    return best ? { target: best } : null;
  },
  cast(ab, t) {
    const u = ab.owner;
    if (!t || t === u || t.team !== u.team) return;
    const d = u.distTo(t); const pull = (d - ab.v('min_distance')) / 2;
    if (pull > 0 && d <= ab.v('max_distance')) { const ux = u.x; const uy = u.y; knockback(u, t.x, t.y, -pull); knockback(t, ux, uy, -pull); }
    addMod(ab, u, 'modifier_tusk_drinking_buddies', ab.v('buff_duration')); addMod(ab, t, 'modifier_tusk_drinking_buddies', ab.v('buff_duration'));
  },
});
airborne('modifier_tusk_walrus_kick_air', { pierce: true });
debuff('modifier_tusk_walrus_kick_slow', { pierce: true, stats: (m) => ({ msPct: -m.v('move_slow') }) });
defAbility('tusk_walrus_kick', {
  fid: 'approx', prio: 78,
  note: 'the target is kicked push_length straight away from Tusk (the vector direction cannot be chosen), moved at once, cannot act for air_time, then is slowed; enemy heroes near the landing point take the damage as well. The default controller only kicks a target it already stands next to, and only when Snowball is ready to follow up or the kick kills',
  ai(ab, u, t) {
    if (!t || t.isBuilding || u.distTo(t) > ab.castRange() + 60) return null;
    const sb = u.findAbility('tusk_snowball');
    const follow = sb && sb.level > 0 && sb.cdRemaining() <= ab.v('air_time') && (u.world.freeSpells || u.mana >= ab.manaCost() + sb.manaCost());
    return follow || ab.v('damage') * (1 - t.mr) * (1 + u.spellAmp / 100) >= t.hp ? { target: t } : null;
  },
  cast(ab, t) {
    const u = ab.owner; const w = u.world; const dx = t.x - u.x; const dy = t.y - u.y; const d = hyp(dx, dy) || 1;
    if (!t.heroLike && !w.freeSpells) ab.cdEnd = w.time + ab.cooldown() * (1 - ab.v('creep_cooldown_reduction_pct') / 100);
    hit(ab, t, ab.v('damage'), MAGICAL);
    if (!t.alive) return;
    addMod(ab, t, 'modifier_tusk_walrus_kick_air', ab.v('air_time'), { pierce: true });
    // [L] measured in Hero Demo: the slow starts with the kick and lasts air_time + slow_duration
    addMod(ab, t, 'modifier_tusk_walrus_kick_slow', ab.v('air_time') + ab.v('slow_duration'), { pierce: true });
    const lx = t.x + dx / d * ab.v('push_length'); const ly = t.y + dy / d * ab.v('push_length');
    t.x = lx; t.y = ly;
    w.after(ab.v('air_time'), () => {
      for (const e of enemiesNear(ab, lx, ly, ab.v('search_radius'))) if (e !== t && e.isHero) hit(ab, e, ab.v('damage'), MAGICAL);
    });
  },
});
debuff('modifier_tusk_walrus_punch_air', { pierce: true, state: ['STUN'], purge: 'strong' });
// [L] measured in Hero Demo: Walrus Punch is an autocast attack modifier. While it is ready, every attack Tusk starts is a punch (the
// bonus damage shows in his damage from the start of the attack); mana and cooldown are spent when the punch lands. A cast order only
// arms the next attack (bonus damage shown at once) and makes Tusk attack the target. m.x = 1: the current / next attack is a punch.
const punchSkip = (rec) => rec.secondary || rec.fromAbility || !rec.target || rec.target.isBuilding;
function punchReady(m) {
  const u = m.parent; const ab = m.ability; const w = u.world;
  return ab.level > 0 && ab.cdReady() && !u.isSilenced() && (w.freeSpells ? !(m.y > w.time) : u.mana >= ab.manaCost());
}
modifier('modifier_tusk_walrus_punch', {
  hidden: true, purge: 'none',
  stats: (m) => (m.x === 1 ? { dmg: m.v('bonus_damage') } : {}),
  onAttackStart(m, rec) { if (m.x !== 1 && !punchSkip(rec) && punchReady(m)) { m.x = 1; m.parent.dirty = true; } },
  onAttack(m, rec) {
    if (punchSkip(rec)) return;
    const u = m.parent; const w = u.world; const ab = m.ability;
    if (m.x === 1 && punchReady(m)) {
      if (w.freeSpells) m.y = w.time + 1; else { u.mana -= ab.manaCost(); ab.startCooldown(); }
    } else if (m.v('proc_chance') > 0 && m.roll(m.v('proc_chance'))) rec.flat += m.v('bonus_damage');    // talent: a free punch
    else { if (m.x === 1) { m.x = 0; u.dirty = true; } return; }
    const c = m.v('crit_multiplier') / 100;
    if (c > rec.crit) rec.crit = c;
    rec.trueStrike = true; (rec.data ||= {}).punch = m;
  },
  onAttackLanded(m, rec) {
    if (!rec.data || rec.data.punch !== m) return;
    if (m.x === 1) { m.x = 0; m.parent.dirty = true; }
    if (rec.target.alive) rec.target.addModifier('modifier_tusk_walrus_punch_air', { caster: m.parent, ability: m.ability, duration: m.v('air_time'), pierce: true });
  },
});
defAbility('tusk_walrus_punch', {
  mods: ['modifier_tusk_walrus_punch'], fid: 'full', prio: 86,
  note: 'autocast attack modifier (measured): every attack started while it is ready is a punch, mana and cooldown are paid when it lands; true strike, critical multiplier applied to attack damage + bonus_damage (shipped patch note 7.35), victim unable to act for air_time; the talent gives every other attack proc_chance to be a free punch. A cast order arms the next attack; under a controller it also orders the attack (an idle unit waits for an attack order, as the recorder does)',
  // autocast would punch anyway; the order only arms the attack (costs are paid when it lands)
  ai: (ab, u, t) => (t && !t.isBuilding && !u.isDisarmed() && u.rangeTo(t) <= u.attackRange + 30 && t.attackableBy(u) && !(u.findModifier('modifier_tusk_walrus_punch') || {}).x ? { target: t } : null),
  cast(ab, t) {
    const u = ab.owner; const m = u.findModifier('modifier_tusk_walrus_punch');
    refuse(ab);                                                    // paid when the punch lands
    if (!m) return;
    m.x = 1; u.dirty = true;
    if (t && u.ai && u.ai.mode !== 'idle') u.attack(t);
  },
});
debuff('modifier_tusk_bitter_chill_debuff', { statusResist: false, purge: 'none', stats: (m) => ({ asSlow: -m.v('attack_speed_slow') }) });
aura('modifier_tusk_bitter_chill', { radius: (m) => m.v('radius'), team: 'enemy', child: 'modifier_tusk_bitter_chill_debuff', filter: (t) => t.isHero });
defAbility('tusk_bitter_chill', { mods: ['modifier_tusk_bitter_chill'], fid: 'full', note: 'aura refreshed every 0.5 s, lingers 0.5 s' });

// ================================================================ Underlord
// Shard: wave and burn intervals and the burn duration are all shortened by the same share (shipped patch note 7.31)
const firestormPace = (ab) => 1 - ab.v('shard_wave_interval_reduction') / 100;
debuff('modifier_abyssal_underlord_firestorm_burn', {
  statusResist: false, interval: (m) => m.v('burn_interval') * firestormPace(m.ability), thinkNow: true,
  onThink(m) { const t = m.parent; mhit(m, t, t.maxHp * m.v('burn_damage') / 100, MAGICAL); },
});
defAbility('abyssal_underlord_firestorm', {
  fid: 'full', prio: 55,
  note: '[L] measured in Hero Demo: the first wave lands with the cast, the others follow every wave_interval (re-armed after each wave, so the 0.75 s of the Shard becomes 23 ticks); the burn ticks when it is applied and then every burn_interval on its own clock, every wave refreshes its duration and a tick that falls on its end still happens. Shard: three more waves and 25% shorter wave / burn intervals and burn duration, and it may be cast on an allied unit, which the storm then follows; the default controller casts it on Underlord himself when the target is inside the radius',
  ai(ab, u, t) {
    if (!t) return null;
    if (ab.v('can_target_units') > 0 && u.distTo(t) <= ab.v('radius') - 100) return { target: u };
    const p = lead(t, ab.v('AbilityCastPoint'));
    return { x: p.x, y: p.y };
  },
  cast(ab, t, x, y) {
    const u = ab.owner; const carrier = t && t.team === u.team && ab.v('can_target_units') > 0 ? t : null;
    const n = ab.v('wave_count') + ab.v('shard_wave_count_bonus'); const pace = firestormPace(ab);
    pulse(u.world, ab.v('wave_interval') * pace, (k) => {
      if (k >= n || (carrier && !carrier.alive)) return false;
      for (const e of enemiesNear(ab, carrier ? carrier.x : x, carrier ? carrier.y : y, ab.v('radius'))) {
        if (e.isBuilding) continue;
        hit(ab, e, ab.v('wave_damage'), MAGICAL);
        if (e.alive) addMod(ab, e, 'modifier_abyssal_underlord_firestorm_burn', ab.v('burn_duration') * pace + PAD);
      }
    });
  },
});
debuff('modifier_abyssal_underlord_pit_of_malice_root', { state: ['ROOT'] });
debuff('modifier_abyssal_underlord_pit_of_malice_slow', { statusResist: false, purge: 'none', stats: (m) => ({ msPct: -m.v('speed_bonus') }) });
// one per unit, shared by every pit of the caster: no new damage / root while it lasts
debuff('modifier_abyssal_underlord_pit_of_malice_lockout', { hidden: true, statusResist: false, purge: 'none' });
function pitOfMalice(ab, x, y) {
  const u = ab.owner; const w = u.world; const pit = { x, y, end: w.time + ab.v('pit_duration') };
  (ab.data ||= []).push(pit);
  every(w, w.dt, () => {
    if (w.time > pit.end + 1e-9) { ab.data.splice(ab.data.indexOf(pit), 1); return false; }
    for (const e of enemiesNear(ab, x, y, ab.v('radius'))) {
      if (e.isBuilding || e.st[ST.IMMUNE] > 0) continue;
      if (ab.v('speed_bonus') > 0) addMod(ab, e, 'modifier_abyssal_underlord_pit_of_malice_slow', 0.5);
      if (e.hasModifier('modifier_abyssal_underlord_pit_of_malice_lockout') || !addMod(ab, e, 'modifier_abyssal_underlord_pit_of_malice_lockout', ab.v('pit_interval'))) continue;
      hit(ab, e, ab.v('pit_damage'), MAGICAL);
      if (e.alive) addMod(ab, e, 'modifier_abyssal_underlord_pit_of_malice_root', ab.v('ensnare_duration'));
    }
  }, 0);
}
defAbility('abyssal_underlord_pit_of_malice', {
  fid: 'full', prio: 62, note: '[L] measured in Hero Demo: the pit is checked every server tick; an enemy inside is damaged and rooted and then locked out for pit_interval (the next hit comes one tick after the lock-out has run out: 3.633 s apart); the talent slow lingers 0.5 s',
  ai(ab, u, t) {
    if (!t || t.isBuilding || (ab.data || []).some((q) => hyp(q.x - t.x, q.y - t.y) <= ab.v('radius'))) return null;
    const p = lead(t, ab.v('AbilityCastPoint'));
    return { x: p.x, y: p.y };
  },
  cast(ab, t, x, y) { pitOfMalice(ab, x, y); },
});
debuff('modifier_abyssal_underlord_atrophy_aura_debuff', { statusResist: false, purge: 'none', stats: (m) => ({ dmgBasePct: -m.v('damage_reduction_pct') }) });
modifier('modifier_abyssal_underlord_atrophy_aura_bonus', { multi: 'independent', purge: 'none', stats: (m) => ({ dmg: m.x }) });
aura('modifier_abyssal_underlord_atrophy_aura', {
  radius: 'radius', team: 'enemy', child: 'modifier_abyssal_underlord_atrophy_aura_debuff', filter: (t) => !t.isBuilding,
  extra: {
    onAnyDeath(m, ev) {
      const u = m.parent; const v = ev.victim;
      if (!u.alive || v.team === u.team || v.isBuilding || v.isIllusion || u.distTo(v) > m.v('radius')) return;
      const b = u.addModifier('modifier_abyssal_underlord_atrophy_aura_bonus', { ability: m.ability, duration: m.v('bonus_damage_duration') });
      if (b) { b.x = v.isHero ? m.v('bonus_damage_from_hero') : m.v('bonus_damage_from_creep'); u.dirty = true; }
    },
  },
});
defAbility('abyssal_underlord_atrophy_aura', { mods: ['modifier_abyssal_underlord_atrophy_aura'], fid: 'full', note: 'aura refreshed every 0.5 s; an enemy that dies inside the radius gives the bonus (each with its own timer); dying illusions give nothing' });
na('abyssal_underlord_raid_boss', 'triggers when an allied hero teleports; there is no teleporting in the sandbox');
defAbility('abyssal_underlord_dark_portal', {
  fid: 'approx', prio: 30,
  note: 'teleporting through the gates is map movement and is not simulated. Modelled: the talent\'s damage per second around both gates for the duration (the data gives no damage type: magical assumed) and the Scepter\'s Pit of Malice at the far gate. The gates cannot be attacked. The default controller only opens the gates for the talent damage, with the far gate minimum_distance behind Underlord',
  ai(ab, u, t) {
    if (!t || !(ab.v('dps') > 0) || ab.data > u.world.time || u.distTo(t) > ab.v('radius') - 100) return null;
    const d = u.distTo(t) || 1; const k = ab.v('minimum_distance') / d;
    return { x: u.x - (t.x - u.x) * k, y: u.y - (t.y - u.y) * k };
  },
  cast(ab, t, x, y) {
    const u = ab.owner; const w = u.world; const dur = ab.v('duration'); const near = [u.x, u.y]; const far = [x, y]; const iv = 0.5;
    if (hyp(x - u.x, y - u.y) < ab.v('minimum_distance') - 1e-6) { refuse(ab); return; }   // [L] measured in Hero Demo: the order is refused when the point is closer than minimum_distance
    ab.data = w.time + dur;
    if (ab.v('dps') > 0) every(w, iv, (k) => {
      if ((k + 1) * iv > dur + 1e-9) return false;
      for (const p of [near, far]) for (const e of enemiesNear(ab, p[0], p[1], ab.v('radius'))) if (!e.isBuilding) hit(ab, e, ab.v('dps') * iv, MAGICAL);
    }, iv);
    const pit = u.findAbility('abyssal_underlord_pit_of_malice');
    if (ab.v('spawn_pit_on_cast') > 0 && pit && pit.level > 0) pitOfMalice(pit, far[0], far[1]);
  },
});

// ================================================================ Leshrac
defAbility('leshrac_split_earth', {
  fid: 'full', prio: 84, note: 'Shard echoes repeat the damage and stun in the same place with the larger radius',
  ai(ab, u, t) { if (!t || t.isBuilding) return null; const p = lead(t, ab.v('AbilityCastPoint') + ab.v('delay')); return { x: p.x, y: p.y }; },
  cast(ab, t, x, y) {
    const u = ab.owner; const w = u.world;
    const quake = (i) => {
      if (i === 0 && missed(w)) return;
      for (const e of enemiesNear(ab, x, y, ab.v('radius') + i * ab.v('shard_radius_increase'))) { if (e.isBuilding) continue; hit(ab, e, ab.v('AbilityDamage'), MAGICAL); if (e.alive) stun(ab, e, ab.v('duration')); }
    };
    for (let i = 0; i <= ab.v('shard_max_count'); i++) w.after(ab.v('delay') + i * ab.v('shard_secondary_delay'), () => quake(i));
  },
});
defAbility('leshrac_diabolic_edict', {
  fid: 'full', prio: 60, note: 'num_explosions explosions spread evenly over AbilityDuration; each one hits `targets` random enemies (buildings included) within the radius of Leshrac, or of the place where he died. The default controller walks Leshrac to within the radius of a target that is at most radius + 400 away, then casts',
  ai: (ab, u, t) => (t && u.distTo(t) <= ab.v('radius') + 400 ? closeIn(ab, u, t, ab.v('radius') - 60) : null),
  cast(ab) {
    const u = ab.owner; const w = u.world; const n = Math.max(1, ab.v('num_explosions')); const iv = ab.v('AbilityDuration') / n;
    every(w, iv, (k) => {
      if (k >= n) return false;
      const pool = w.enemiesInRadius(u, u.x, u.y, ab.v('radius')).filter((e) => e.st[ST.INVULN] === 0 && (!e.isBuilding || ab.v('affects_buildings') > 0));
      for (let i = 0; i < ab.v('targets') && pool.length; i++) hit(ab, pool.splice(w.rng.int(0, pool.length - 1), 1)[0], ab.v('damage'), PURE);
    }, iv);
  },
});
debuff('modifier_leshrac_lightning_storm_slow', { stats: (m) => ({ msPct: -m.v('movespeed_slow') }) });
function lightningBolt(ab, e) { if (e.isBuilding) return; hit(ab, e, ab.v('damage'), MAGICAL); if (e.alive) addMod(ab, e, 'modifier_leshrac_lightning_storm_slow', ab.v('slow_duration')); }
function lightningStorm(ab, t) { chain(ab.owner, t, ab.v('jump_count'), ab.v('radius'), (e) => lightningBolt(ab, e), ab.v('jump_delay')); }
defAbility('leshrac_lightning_storm', {
  fid: 'full', prio: 55, note: 'the first strike is immediate, each further strike jumps to the nearest enemy not yet struck after jump_delay',
  ai: (ab, u, t) => (t && !t.isBuilding ? foe(ab, t) : null),
  cast(ab, t) { lightningStorm(ab, t); },
});
debuff('modifier_leshrac_greater_lightning_storm_disarm', { state: ['DISARM'], statusResist: false, purge: 'none' });
buff('modifier_leshrac_greater_lightning_storm', {
  purge: 'none', interval: 0.1, thinkNow: true,
  onThink(m) {
    const u = m.parent;
    u.purge({ debuffs: true });
    for (const e of u.world.enemiesInRadius(u, u.x, u.y, m.v('radius'))) {
      if (e.isBuilding || e.st[ST.IMMUNE] > 0 || e.st[ST.INVULN] > 0) continue;
      e.purge({ debuffs: false, buffs: true });
      e.addModifier('modifier_leshrac_greater_lightning_storm_disarm', { caster: u, ability: m.ability, duration: 0.13 });
    }
  },
});
defAbility('leshrac_greater_lightning_storm', {
  fid: 'full', prio: 70, note: 'the aura dispels and disarms enemies in the radius every 0.1 s (no linger) and dispels Leshrac himself',
  ai: (ab, u, t) => (t && !t.isBuilding && u.distTo(t) <= ab.v('radius') - 50 && !u.hasModifier('modifier_leshrac_greater_lightning_storm') ? NOW : null),
  cast(ab) { addMod(ab, ab.owner, 'modifier_leshrac_greater_lightning_storm', ab.v('duration')); },
});
passive('leshrac_defilement', { fid: 'full', late(m, s, u) { s.aoe += u.int * m.v('aoe_per_int'); } });
buff('modifier_leshrac_pulse_nova', {
  purge: 'none', interval: 1, thinkNow: true, stats: (m) => ({ dmgTaken: -m.v('damage_resistance') }),
  onCreated(m) { m.y = m.parent.world.time; },
  onThink(m) {                                                     // m.x = pulses so far, m.y = time of the last talent bolt
    const u = m.parent; const w = u.world; const ab = m.ability; const cost = m.v('mana_cost_per_second');
    if (m.x++ > 0 && !w.freeSpells) { if (u.mana < cost) { ab.toggled = false; m.remove(); return; } u.mana -= cost; }
    const es = w.enemiesInRadius(u, u.x, u.y, m.v('radius')).filter((e) => !e.isBuilding);
    for (const e of es) mhit(m, e, m.v('damage'), MAGICAL);
    const ls = u.findAbility('leshrac_lightning_storm'); const gap = ls && ls.level > 0 ? ls.v('pulse_nova_lightning_interval') : 0;
    if (!(gap > 0) || w.time - m.y + 1e-9 < gap) return;
    m.y = w.time;
    const pool = es.filter((e) => e.alive && !blocked(ls, e)); const heroes = pool.filter((e) => e.isHero); const p = heroes.length ? heroes : pool;
    if (p.length) lightningBolt(ls, p[w.rng.int(0, p.length - 1)]);
  },
});
defAbility('leshrac_pulse_nova', {
  fid: 'approx', prio: 80,
  note: 'toggle: a pulse at once and then one per second; mana_cost_per_second is charged from the second pulse on (shipped patch note 7.32) and the nova switches itself off when the mana runs out; switching off refunds the activation cost that the engine charges on every cast. The default controller walks Leshrac to within the radius of a target that is at most radius + 400 away and switches the nova on; it switches it off as soon as the target is outside the radius (and walks back in if it can). Talent: every pulse_nova_lightning_interval seconds one Lightning Storm bolt (no jumps) hits a random enemy inside the radius, heroes first (shipped patch note 7.34)',
  ai(ab, u, t) {
    const d = t ? u.distTo(t) : Infinity; const R = ab.v('radius');
    ab.vals.AbilityCastRange = 0;                                  // switching off needs no range
    if (u.hasModifier('modifier_leshrac_pulse_nova')) return d > R + 30 ? NOW : null;
    return d <= R + 400 && (u.world.freeSpells || u.mana >= ab.manaCost() + 3 * ab.v('mana_cost_per_second')) ? closeIn(ab, u, t, R - 60) : null;
  },
  cast(ab) {
    const u = ab.owner;
    if (!u.hasModifier('modifier_leshrac_pulse_nova')) { ab.toggled = true; addMod(ab, u, 'modifier_leshrac_pulse_nova'); return; }
    u.removeModifierByName('modifier_leshrac_pulse_nova'); ab.toggled = false;
    if (!u.world.freeSpells) u.mana = Math.min(u.maxMana, u.mana + ab.manaCost());
  },
});

// ================================================================ Skywrath Mage
// Shield of the Scion: every stack has its own timer; the stacks of one kind share a modifier that keeps their end times.
modifier('modifier_skywrath_mage_shield_of_the_scion_int', {
  purge: 'none', interval: 0.5, stats: (m) => ({ int: m.v('bonus_intelligence') * m.stacks }),
  onCreated(m) { m.data = []; },
  onThink(m) { const now = m.parent.world.time; while (m.data.length && m.data[0] <= now) m.data.shift(); m.setStacks(m.data.length); },
});
modifier('modifier_skywrath_mage_shield_of_the_scion_barrier', {
  purge: 'none', interval: 0.5,
  onCreated(m) { m.data = []; },
  onThink(m) { const now = m.parent.world.time; m.data = m.data.filter((b) => b[0] > now && b[1] > 1e-6); m.setStacks(m.data.length); },
  postMit(m, d) {
    if (d.amount <= 0 || d.type !== MAGICAL || (d.flags & F_HP_LOSS)) return;
    const now = m.parent.world.time;
    for (const b of m.data) { if (b[0] <= now || b[1] <= 0) continue; const a = Math.min(d.amount, b[1]); b[1] -= a; d.amount -= a; if (d.amount <= 0) break; }
  },
});
passive('skywrath_mage_shield_of_the_scion', {
  fid: 'full', note: 'every magical damage instance of an ability on an enemy hero (each Mystic Flare tick is one) adds an intelligence stack and a barrier, each with its own timer; older barriers are used up first',
  onDealDamage(m, d) {
    const u = m.parent; const t = d.dst;
    if (!u.alive || d.type !== MAGICAL || !(d.dealt > 0) || !d.ability || d.ability.isItem || !t.isHero || t.isIllusion || t.team === u.team || (d.flags & F_REFLECT)) return;
    const now = u.world.time;
    const i = u.addModifier('modifier_skywrath_mage_shield_of_the_scion_int', { ability: m.ability }); i.data.push(now + m.v('stack_duration')); i.setStacks(i.data.length);
    const b = u.addModifier('modifier_skywrath_mage_shield_of_the_scion_barrier', { ability: m.ability }); b.data.push([now + m.v('barrier_duration'), m.v('damage_barrier')]); b.setStacks(b.data.length);
  },
});
// random enemy near `t` for the Shard / Scepter copies: heroes first
function skywrathPick(ab, x, y, r, skip) {
  const u = ab.owner; const w = u.world;
  const pool = w.enemiesInRadius(u, x, y, r).filter((e) => e !== skip && !e.isBuilding && e.st[ST.INVULN] === 0 && !blocked(ab, e));
  const heroes = pool.filter((e) => e.isHero); const p = heroes.length ? heroes : pool;
  return p.length ? p[w.rng.int(0, p.length - 1)] : null;
}
function arcaneBolt(ab, t) {
  const u = ab.owner; const dmg = ab.v('bolt_damage') + u.int * ab.v('int_multiplier');
  u.world.projectile(u, t, ab.v('bolt_speed'), (tt) => { if (!blocked(ab, tt)) hit(ab, tt, dmg, MAGICAL); });
}
defAbility('skywrath_mage_arcane_bolt', {
  mods: [sync('skywrath_mage_arcane_bolt', (ab) => { ab.pierces = ab.v('pierce_spell_immunity') > 0; })],
  fid: 'approx', prio: 50,
  note: 'damage is fixed when the bolt is launched. Shard: the extra bolts leave one after another every secondary_bolt_interval (an unlabelled value) at random enemies within the search radius of the first target, heroes first, never the first target ([L] measured in Hero Demo: with no other enemy near, only the first bolt flies). The talent that adds cast range also sets pierce_spell_immunity in the data, so the bolt then pierces debuff immunity',
  ai: (ab, u, t) => (t && !t.isBuilding ? foe(ab, t) : null),
  cast(ab, t) {
    const u = ab.owner; const w = u.world;
    arcaneBolt(ab, t);
    for (let i = 1; i < ab.v('total_bolt_count'); i++) w.after(i * ab.v('secondary_bolt_interval'), () => { const e = u.alive ? skywrathPick(ab, t.x, t.y, ab.v('extra_bolt_search_radius'), t) : null; if (e) arcaneBolt(ab, e); });
  },
});
debuff('modifier_skywrath_mage_concussive_shot_slow', { stats: (m) => ({ msPct: -m.v('movement_speed_pct') }) });
function concussiveTarget(ab) {                                    // the closest enemy hero in range, else the closest creep
  const u = ab.owner; const r = ab.v('launch_global') > 0 ? Infinity : ab.v('launch_radius'); let best = null; let bd = Infinity; let hero = false;
  for (const e of u.world.units) {
    if (!e.alive || e.team === u.team || e.isBuilding || e.st[ST.OUT] > 0 || e.st[ST.INVULN] > 0) continue;
    const d = u.distTo(e);
    if (d <= r && ((e.isHero && !hero) || (e.isHero === hero && d < bd))) { best = e; bd = d; hero = e.isHero; }
  }
  return best;
}
function concussiveShot(ab, t) {
  const u = ab.owner;
  u.world.projectile(u, t, ab.v('speed'), (tt) => {
    for (const e of enemiesNear(ab, tt.x, tt.y, ab.v('slow_radius'))) { if (e.isBuilding) continue; hit(ab, e, ab.v('damage'), MAGICAL); if (e.alive) addMod(ab, e, 'modifier_skywrath_mage_concussive_shot_slow', ab.v('slow_duration')); }
  });
}
defAbility('skywrath_mage_concussive_shot', {
  fid: 'full', prio: 60, note: 'Scepter: a second shot at a different random enemy within scepter_radius of the first target, heroes first',
  ai: (ab, u, t) => (t && concussiveTarget(ab) ? NOW : null),
  cast(ab) {
    const t = concussiveTarget(ab);
    if (!t) return;
    concussiveShot(ab, t);
    const e = ab.v('scepter_radius') > 0 ? skywrathPick(ab, t.x, t.y, ab.v('scepter_radius'), t) : null;
    if (e) concussiveShot(ab, e);
  },
});
debuff('modifier_skywrath_mage_ancient_seal', { state: ['SILENCE'], stats: (m) => (m.parent.heroLike ? { mr: -Math.abs(m.v('resist_debuff')) } : {}) });
defAbility('skywrath_mage_ancient_seal', {
  fid: 'full', prio: 80, note: 'silence on every target, the magic resistance reduction on heroes only; Scepter: a second seal on a different random enemy within scepter_radius, heroes first',
  ai: (ab, u, t) => (t && t.heroLike && !t.hasModifier('modifier_skywrath_mage_ancient_seal') ? foe(ab, t) : null),
  cast(ab, t) {
    addMod(ab, t, 'modifier_skywrath_mage_ancient_seal', ab.v('seal_duration'));
    const e = ab.v('scepter_radius') > 0 ? skywrathPick(ab, t.x, t.y, ab.v('scepter_radius'), t) : null;
    if (e) addMod(ab, e, 'modifier_skywrath_mage_ancient_seal', ab.v('seal_duration'));
  },
});
function mysticFlare(ab, x, y) {
  const u = ab.owner; const w = u.world; const iv = ab.v('damage_interval'); const n = Math.max(1, Math.round(ab.v('duration') / iv));
  every(w, iv, (k) => {
    if (k >= n) return false;
    const all = enemiesNear(ab, x, y, ab.v('radius')).filter((e) => !e.isBuilding && e.st[ST.INVULN] === 0);
    for (const e of all) if (e.isIllusion) w.kill(e, u, ab);
    let pool = all.filter((e) => e.alive && e.isHero);
    if (!pool.length) pool = all.filter((e) => e.alive && !e.heroLike);
    for (const e of pool) hit(ab, e, ab.v('damage') / n / pool.length, MAGICAL);
  }, iv);
}
defAbility('skywrath_mage_mystic_flare', {
  fid: 'approx', prio: 78,
  note: 'the damage is split evenly over the ticks and, each tick, among the enemy heroes inside (creeps only when no hero is inside; creep-heroes never; illusions are destroyed). The default controller only casts it on a hero that is stunned, rooted, slowed by Concussive Shot or standing still to attack. Scepter: the spell is point-targeted, so "the original target" is taken to be the enemy nearest to the cast point; the second flare lands on a different random enemy within scepter_radius of the point, heroes first',
  ai(ab, u, t) {
    if (!t || !t.isHero || t.isIllusion) return null;
    const o = t.orderTarget;
    const still = t.st[ST.STUN] > 0 || t.st[ST.ROOT] > 0 || t.st[ST.SLEEP] > 0 || t.hasModifier('modifier_skywrath_mage_concussive_shot_slow') || (o && o.alive && t.rangeTo(o) <= t.attackRange + 25);
    return still ? { x: t.x, y: t.y } : null;
  },
  cast(ab, t, x, y) {
    mysticFlare(ab, x, y);
    if (!(ab.v('scepter_radius') > 0)) return;
    let first = null; let bd = Infinity;
    for (const e of enemiesNear(ab, x, y, ab.v('scepter_radius'))) { const d = hyp(e.x - x, e.y - y); if (!e.isBuilding && d < bd) { bd = d; first = e; } }
    const e = skywrathPick(ab, x, y, ab.v('scepter_radius'), first);
    if (e) mysticFlare(ab, e.x, e.y);
  },
});

