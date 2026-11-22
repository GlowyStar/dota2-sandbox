// Hero abilities, part 3: Axe, Bristleback, Legion Commander, Slardar, Lina, Lion, Zeus, Crystal Maiden.
// Reviewed clause by clause against the 7.42 tooltips (build 6983). Every number is read from the shipped data by value name;
// the few structural literals (think intervals, geometry) are named in the `note` of the ability that uses them.
import { defAbility, modifier, buff, debuff, passive, selfBuff, hit, addMod, stun, enemiesNear, alliesNear, mhit, cleave, barrier, giveBarrier, chain, summon,
  nearAI, ST, C, PHYSICAL, MAGICAL, PURE, F_ATTACK, F_NO_AMP, F_REFLECT, F_NO_LIFESTEAL } from '../engine/dsl.mjs';

// ---------------------------------------------------------------- shared helpers
const immune = (t) => t.st[ST.IMMUNE] > 0;
const visible = (e) => e.st[ST.INVIS] === 0 || e.world.detectAll;      // invisibility only hides units when a scenario turns detectAll off
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
const countMods = (u, name) => { let n = 0; const ms = u.mods; for (let i = 0; i < ms.length; i++) if (ms[i].name === name) n++; return n; };
const dispellable = (m) => m.def.debuff && (m.def.purge || 'basic') === 'basic';

// Periodic effects. The engine removes an expiring modifier before running a think that is due at the same instant, which
// silently drops the last tick of a damage-over-time effect (12 s at 1 tick/s gave 11 ticks). `ticker` restores that tick.
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
const angleBetween = (ax, ay, bx, by) => { const la = Math.hypot(ax, ay); const lb = Math.hypot(bx, by); return la < 1e-6 || lb < 1e-6 ? 0 : Math.acos(Math.max(-1, Math.min(1, (ax * bx + ay * by) / (la * lb)))) * 180 / Math.PI; };
// angle in degrees between the facing of `u` and the direction to `o` (0 = straight ahead, 180 = directly behind); -1 = facing unknown
function faceAngle(u, o) { const t = facingTarget(u); return !t ? -1 : t === o ? 0 : angleBetween(t.x - u.x, t.y - u.y, o.x - u.x, o.y - u.y); }

// Enemies swept by a wave that travels `len` from the caster towards (x, y) while its radius changes linearly from r0 to r1
// (round ends, like the game's linear projectiles; the shipped "width" values of such spells are used as radii).
// Returns [[enemy, distance the wave centre has travelled when its edge reaches the enemy], ...]; evaluated at cast time.
// [L] measured in Hero Demo (Dragon Slave, Earth Spike): a unit is hit when the front of the wave touches it, i.e. the
// centre is still radius + hull short of it, not when the centre passes it.
function inWave(u, x, y, len, r0, r1) {
  let dx = x - u.x; let dy = y - u.y; const d = Math.hypot(dx, dy);
  if (d < 1e-6) { dx = 1; dy = 0; } else { dx /= d; dy /= d; }
  const out = []; const us = u.world.units;
  for (let i = 0; i < us.length; i++) {
    const e = us[i];
    if (!e.alive || e.team === u.team || e.isBuilding || e.st[ST.OUT] > 0) continue;
    const rx = e.x - u.x; const ry = e.y - u.y;
    const along = rx * dx + ry * dy;
    if (along < 0) continue;            // [L] measured in Hero Demo: a unit 150 behind Lina is not hit although it is inside the start width
    let k = along; if (k < 0) k = 0; else if (k > len) k = len;
    const px = rx - dx * k; const py = ry - dy * k;
    const r = r0 + (r1 - r0) * (k / len) + e.def.hull;
    const lat2 = px * px + py * py;
    if (lat2 > r * r) continue;
    const side2 = rx * rx + ry * ry - along * along;       // squared distance from the axis
    const s = along - Math.sqrt(Math.max(0, r * r - side2));
    out.push([e, s < 0 ? 0 : s > len ? len : s]);
  }
  return out;
}

// ================================================================ Axe
buff('modifier_axe_berserkers_call', { purge: 'none', stats: { armor: 'bonus_armor' } });
debuff('modifier_axe_berserkers_call_taunt', { pierce: true, purge: 'none', state: ['TAUNT'], stats: { as: 'bonus_attack_speed' } });
defAbility('axe_berserkers_call', {
  fid: 'full', prio: 80, ai: nearAI('radius', -10),
  cast(ab) {
    const u = ab.owner; const dur = ab.v('duration'); const bh = u.findAbility('axe_battle_hunger');
    addMod(ab, u, 'modifier_axe_berserkers_call', dur);
    for (const e of enemiesNear(ab, u.x, u.y, ab.v('radius'))) {
      if (e.isBuilding) continue;
      if (e.channelAb) e.endChannel(true);      // forced to attack: channels and pending casts stop (the engine's taunt alone does not interrupt them)
      e.castAb = null;
      addMod(ab, e, 'modifier_axe_berserkers_call_taunt', dur);
      if (ab.v('applies_battle_hunger') > 0 && bh && bh.level > 0) applyHunger(bh, e);
    }
  },
});

// Battle Hunger. m.x = 1 while the victim faces away from Axe (slow applies), re-checked every 0.5 s; damage every 0.5 s.
modifier('modifier_axe_battle_hunger', { hidden: true, stats: (m) => ({ msPct: m.v('speed_bonus') * m.stacks }) });      // talent: move speed per active Battle Hunger
const hungerSpeed = (m, d) => { const s = m.caster.findModifier('modifier_axe_battle_hunger'); if (s) s.setStacks(Math.max(0, s.stacks + d)); };
const hungerFace = (m) => { const away = faceAngle(m.parent, m.caster) > 90 ? 1 : 0; if (away !== m.x) { m.x = away; m.parent.dirty = true; } };
// [L] measured in Hero Demo: the damage comes every 0.5 s (half of damage_per_second each), the first tick on application
const hungerHit = (m) => mhit(m, m.parent, m.v('damage_per_second') * 0.5, PURE);
const hungerTick = ticker(0.5, hungerHit, 1, hungerFace);
debuff('modifier_axe_battle_hunger_debuff', {
  multi: 'independent', ...hungerTick,
  stats: (m) => (m.x === 1 ? { msPct: -m.v('slow') } : null),
  // [L] measured in Hero Demo (Shard, talent): the speed counts affected units, not instances: a second instance on the same unit
  // adds nothing, and the unit stops counting when the instance that counted it ends (m.y = 1 on that instance)
  onCreated(m) { const t = m.parent; m.y = t.mods.some((x) => x !== m && x.name === m.name && x.caster === m.caster && x.y === 1 && !x.removed) ? 0 : 1; if (m.y) hungerSpeed(m, 1); hungerFace(m); hungerHit(m); },
  onDestroy(m, expired) { if (m.y) hungerSpeed(m, -1); hungerTick.onDestroy(m, expired); },
  onKill(m) { m.remove(); },                    // "until it kills another unit" (buildings included)
});
function applyHunger(bh, e) {
  if (bh.v('should_stack') <= 0) e.removeModifierByName('modifier_axe_battle_hunger_debuff');       // Shard: instances stack
  return addMod(bh, e, 'modifier_axe_battle_hunger_debuff', bh.v('duration'));
}
defAbility('axe_battle_hunger', {
  mods: ['modifier_axe_battle_hunger'], prio: 40,
  fid: 'approx', note: 'no facing in the sandbox: the victim counts as facing away from Axe (and is slowed) while the unit it is attacking or casting on lies more than 90 degrees away from the direction to Axe, checked every 0.5 s',
  ai: (ab, u, t) => (canTarget(ab, t) && (ab.v('should_stack') > 0 || !t.hasModifier('modifier_axe_battle_hunger_debuff')) ? { target: t } : null),
  cast(ab, t) { applyHunger(ab, t); },
});

// Counter Helix. m.x = attack counter. 7.42: attacks that miss Axe also count, so the counter runs on onPreAttacked.
debuff('modifier_axe_counter_helix_debuff', {
  pierce: true, multi: 'stack', maxStacks: (m) => m.v('max_stacks'),
  outgoing(m, d) { if ((d.flags & F_ATTACK) && d.dst === m.caster) d.amount *= Math.max(0, 1 - m.v('damage_reduction') * m.stacks / 100); },
});
function helixCount(m) {
  const u = m.parent; const ab = m.ability; const w = u.world;
  if (++m.x < m.v('trigger_attacks') || !ab.cdReady()) return;
  m.x = 0; ab.startCooldown();
  let total = 0;
  for (const e of w.enemiesInRadius(u, u.x, u.y, m.v('radius'))) {
    if (e.isBuilding) continue;
    total += w.damage(u, e, m.v('damage'), PURE, 0, ab);
    if (e.alive && m.v('debuff_duration') > 0) e.addModifier('modifier_axe_counter_helix_debuff', { caster: u, ability: ab, duration: m.v('debuff_duration') });
  }
  if (m.v('helix_lifesteal') > 0 && total > 0) u.heal(total * m.v('helix_lifesteal') / 100, u, ab);
}
passive('axe_counter_helix', {
  fid: 'full',
  onPreAttacked(m, rec) { if (rec.attacker.team !== m.parent.team) helixCount(m); },
  onAttack(m) { if (m.v('attacks_increase_counter') > 0) helixCount(m); },       // Scepter: the counter also advances when Axe attacks
});

buff('modifier_axe_culling_blade_boost', { stats: (m) => ({ msPct: m.v('speed_bonus'), armor: m.v('armor_bonus') }) });
modifier('modifier_axe_culling_blade_stacks', { multi: 'stack', purge: 'none', stats: (m) => ({ armor: m.v('armor_per_stack') * m.stacks }) });
defAbility('axe_culling_blade', {
  fid: 'full', note: 'the AI keeps it as a finisher: it is cast only when its damage would kill the target', prio: 95,
  ai: (ab, u, t) => (t && !t.isBuilding && u.rangeTo(t) <= 400 && t.hp <= ab.v('damage') * (1 + u.spellAmp / 100) * t.dmgTakenMul ? { target: t } : null),
  cast(ab, t) {
    const u = ab.owner; const hero = realHero(t);
    const cd = t.st[ST.CANNOT_DIE]; t.st[ST.CANNOT_DIE] = 0;       // "death cannot be prevented with abilities like Shallow Grave"
    hit(ab, t, ab.v('damage'), PURE);
    t.st[ST.CANNOT_DIE] += cd;
    if (t.alive || !hero) return;
    ab.cdEnd = 0;                                                   // hero killed: cooldown reset, permanent armor stack, buff for nearby allies
    u.addModifier('modifier_axe_culling_blade_stacks', { ability: ab });
    for (const a of alliesNear(ab, u.x, u.y, ab.v('speed_aoe'))) if (!a.isBuilding) addMod(ab, a, 'modifier_axe_culling_blade_boost', ab.v('speed_duration'));
  },
});

const omaAllyNear = (m) => { const u = m.parent; const r = m.v('radius'); for (const a of u.world.units) if (a !== u && a.alive && a.team === u.team && realHero(a) && u.distTo(a) <= r) return true; return false; };
// One Man Army. m.x = share of the bonus (1 while alone, fading to 0 over bonus_linger_duration once an allied hero is near), m.y = fade start.
passive('axe_one_man_army', {
  fid: 'full', note: 'allies are checked every 0.1 s',
  // [L] measured in Hero Demo: with an allied hero near from the start there is no bonus at all (nothing to fade)
  // (decided on the first think: the other units of a fight may not be placed yet when the modifier is created; m.z = 1 once decided)
  interval: 0.1, onCreated(m) { m.x = 1; m.y = -1; },
  onThink(m) {
    const u = m.parent; const w = u.world; const near = omaAllyNear(m);
    if (m.z === 0) { m.z = 1; if (near) { m.y = w.time - m.v('bonus_linger_duration'); if (m.x !== 0) { m.x = 0; u.dirty = true; } return; } }
    let k = 1;
    if (near) { if (m.y === -1) m.y = w.time; k = Math.max(0, 1 - (w.time - m.y) / m.v('bonus_linger_duration')); } else m.y = -1;
    if (k !== m.x) { m.x = k; u.dirty = true; }
  },
  late(m, s, u) {
    const o = u.ovr; const armor = (o && o.armor !== undefined ? o.armor : u.def.armor) + C.ARMOR_PER_AGI * u.agi + s.armor;
    const str = Math.max(0, armor) * m.v('armor_pct_as_strength') / 100 * m.x;
    if (str > 0) u.str += str;          // the engine derives health, regeneration and damage from the final Strength
  },
});

// ================================================================ Bristleback
// Angle between Bristleback's back and the direction to `o` (0 = directly behind him); -1 = facing unknown.
// During the Scepter active his back is locked towards the aim point (kept in x / y of the active modifier).
function fromBack(u, o) {
  const act = u.findModifier('modifier_bristleback_bristleback_lock');
  if (act) return angleBetween(act.x - u.x, act.y - u.y, o.x - u.x, o.y - u.y);
  const a = faceAngle(u, o); return a < 0 ? -1 : 180 - a;
}
const isBehind = (u, o, angle) => { const a = fromBack(u, o); return a >= 0 && a <= angle; };
// Prickly: debuff duration amp against enemy heroes behind him (applied to his own Goo and Quill debuffs)
const pricklyAmp = (u, e) => { const p = u.findModifier('modifier_bristleback_prickly'); return p && p.active() && realHero(e) && isBehind(u, e, p.v('angle')) ? 1 + p.v('amp_pct') / 100 : 1; };

debuff('modifier_bristleback_viscous_nasal_goo_debuff', {
  multi: 'stack', maxStacks: (m) => m.v('stack_limit'),
  stats: (m) => ({ armor: -(m.v('base_armor') + m.v('armor_per_stack') * m.stacks), msPct: -(m.v('base_move_slow') + m.v('move_slow_per_stack') * m.stacks) }),
});
const gooHit = (goo, e, stacks = 1) => e.addModifier('modifier_bristleback_viscous_nasal_goo_debuff', { caster: goo.owner, ability: goo, duration: goo.v('goo_duration') * pricklyAmp(goo.owner, e), stacks });
defAbility('bristleback_viscous_nasal_goo', {
  fid: 'full', prio: 45, ai: (ab, u, t) => (canTarget(ab, t) ? { target: t } : null),
  cast(ab, t) { ab.owner.world.projectile(ab.owner, t, ab.v('goo_speed'), (tt) => gooHit(ab, tt)); },
});

// Quill Spray: every hit leaves its own stack for quill_stack_duration ("for every time a unit was hit in the last N seconds")
debuff('modifier_bristleback_quill_spray_stack', { multi: 'independent', purge: 'none', pierce: true, statusResist: false });
function quillHit(q, e, passiveSpray = false) {
  if (!e.alive || e.isBuilding) return;
  const u = q.owner; const n = countMods(e, 'modifier_bristleback_quill_spray_stack');
  // sprays released by the Bristleback passive count as reflected damage (no lifesteal, cannot be reflected); the engine drops
  // reflected damage on debuff-immune units, which Quill Spray pierces, so those get the no-lifesteal flag only
  hit(q, e, Math.min(q.v('max_damage'), q.v('quill_base_damage') + q.v('quill_stack_damage') * n), PHYSICAL, passiveSpray ? (immune(e) ? F_NO_LIFESTEAL : F_REFLECT) : 0);
  if (e.alive) e.addModifier('modifier_bristleback_quill_spray_stack', { caster: u, ability: q, duration: q.v('quill_stack_duration') * pricklyAmp(u, e) });
}
// spray from (x, y); `cone` = [aimX, aimY, fullAngle] restricts it to a cone from Bristleback
function quillSpray(q, x, y, passiveSpray = false, cone = null) {
  const u = q.owner; const w = u.world;
  for (const e of enemiesNear(q, x, y, q.v('radius'))) {
    if (e.isBuilding) continue;
    if (cone && angleBetween(cone[0] - u.x, cone[1] - u.y, e.x - u.x, e.y - u.y) > cone[2] / 2) continue;
    w.projectile({ x, y }, e, q.v('projectile_speed'), (t) => quillHit(q, t, passiveSpray));
  }
}
defAbility('bristleback_quill_spray', { fid: 'full', prio: 50, ai: nearAI('radius', -50), cast(ab) { quillSpray(ab, ab.owner.x, ab.owner.y); } });

// Bristleback. m.x = Scepter cooldown end, m.y = rear damage counted towards the next passive Quill Spray, m.z = earliest next release.
modifier('modifier_bristleback_bristleback_active', { purge: 'none', state: ['DISARM'], stats: (m) => ({ msPct: m.v('activation_movement_speed_pct') }) });
modifier('modifier_bristleback_bristleback_lock', { purge: 'none', hidden: true });
// With Scepter the ability is castable: the data flags it passive and keeps the cost of the active under other names
// (activation_cooldown / activation_manacost; the live game reports them as the cooldown and mana cost of the ability).
function bristleScepter(m) {
  const ab = m.ability; const u = m.parent; const on = u.hasScepter && ab.level > 0;
  if (ab.passive === on) { ab.passive = !on; if (u.refreshAI) u.refreshAI(); }       // the controller lists its castable abilities once
  if (on) { ab.vals.AbilityCooldown = ab.vals.activation_cooldown; ab.vals.AbilityManaCost = ab.vals.activation_manacost; }
}
modifier('modifier_bristleback_bristleback', {
  hidden: true, interval: 0.25,
  onCreated: bristleScepter, onThink: bristleScepter,
  postMit(m, d) {
    const u = m.parent; const s = d.src;
    if (d.amount <= 0 || !s || s === u || s.team === u.team) return;
    const a = fromBack(u, s); if (a < 0) return;
    const back = a <= m.v('back_angle');
    if (!back && a > m.v('side_angle')) return;
    d.amount *= 1 - (back ? m.v('back_damage_reduction') : m.v('side_damage_reduction')) / 100;
    if (back) m.y += d.amount;
  },
  onTakeDamage(m) {
    const u = m.parent; const w = u.world; const thr = m.v('quill_release_threshold');
    if (m.y < thr || w.time + 1e-9 < m.z) return;
    const q = u.findAbility('bristleback_quill_spray');
    if (!q || q.level < 1) { m.y = 0; return; }
    m.y -= thr; m.z = w.time + m.v('quill_release_interval');
    quillSpray(q, u.x, u.y, true);
  },
});
defAbility('bristleback_bristleback', {
  mods: ['modifier_bristleback_bristleback'], prio: 52,
  fid: 'approx',
  note: 'no facing in the sandbox: Bristleback faces the unit he is attacking or casting on, and the angle of a damage source is measured from that (back_angle / side_angle from the data); rear damage is counted after reductions. Scepter: castable (cooldown activation_cooldown, mana activation_manacost); its sprays hit a cone of activation_angle (taken as the full angle) towards the aim point, his back locked on it',
  ai: (ab, u, t) => {
    const q = u.findAbility('bristleback_quill_spray');
    return u.hasScepter && q && q.level > 0 && t && !t.isBuilding && u.distTo(t) <= q.v('radius') - 100 && !u.hasModifier('modifier_bristleback_bristleback_active') ? { x: t.x, y: t.y } : null;
  },
  cast(ab, t, x, y) {
    const u = ab.owner; const w = u.world; const q = u.findAbility('bristleback_quill_spray');
    if (t) { x = t.x; y = t.y; }
    const n = ab.v('activation_num_quill_sprays'); const delay = ab.v('activation_delay'); const iv = ab.v('activation_spray_interval');
    const act = u.addModifier('modifier_bristleback_bristleback_active', { ability: ab, duration: delay + (n - 1) * iv + 0.05 });
    if (!act) return;
    // the back stays locked towards the aim point until the last quills have landed (their Prickly amp was measured on the 5th spray)
    const lock = u.addModifier('modifier_bristleback_bristleback_lock', { ability: ab, duration: delay + (n - 1) * iv + 0.5 });
    if (lock) { lock.x = x; lock.y = y; }
    if (!q || q.level < 1) return;
    // [L] measured in Hero Demo: every spray of the active adds a Warpath stack (the activation itself does not)
    for (let i = 0; i < n; i++) w.after(delay + i * iv, () => { if (u.alive && !act.removed) { warpathStack(u); quillSpray(q, u.x, u.y, false, [x, y, ab.v('activation_angle')]); } });
  },
});

defAbility('bristleback_hairball', {
  fid: 'full', prio: 55,
  cast(ab, t, x, y) {
    const u = ab.owner; const goo = u.findAbility('bristleback_viscous_nasal_goo'); const q = u.findAbility('bristleback_quill_spray');
    const w = u.world;
    // [L] measured in Hero Demo: the eruption sends quills (Quill Spray projectile speed) and goo (goo_speed) from the landing
    // point to every enemy in the radius; each lands on its own, so the quill of a unit near the point arrives before its goo
    w.after(Math.hypot(x - u.x, y - u.y) / ab.v('projectile_speed'), () => {
      for (const e of enemiesNear(ab, x, y, ab.v('radius'))) {
        if (e.isBuilding) continue;
        if (q && q.level > 0) w.projectile({ x, y }, e, q.v('projectile_speed'), (tt) => { for (let i = 0; i < ab.v('quill_stacks'); i++) quillHit(q, tt); });
        if (goo && goo.level > 0) w.projectile({ x, y }, e, goo.v('goo_speed'), (tt) => { if (tt.alive) gooHit(goo, tt, ab.v('goo_stacks')); });
      }
    });
  },
});

// Warpath: one modifier per stack, so each stack runs its own stack_duration and Break only stops new stacks
const WARPATH = 'modifier_bristleback_warpath_stack';
buff(WARPATH, { multi: 'independent', purge: 'none', stats: (m) => ({ dmg: m.v('damage_per_stack'), msPct: m.v('move_speed_per_stack'), as: m.v('aspd_per_stack') }) });
function warpathStack(u) {
  const p = u.findModifier('modifier_bristleback_warpath');
  if (!p || !p.active()) return;
  const ab = p.ability;
  if (countMods(u, WARPATH) >= ab.v('max_stacks')) { const old = u.findModifier(WARPATH); if (old) old.remove(); }      // at the cap the oldest stack is replaced
  u.addModifier(WARPATH, { ability: ab, duration: ab.v('stack_duration') });
}
passive('bristleback_warpath', {
  fid: 'full', note: 'each stack lasts stack_duration from its own cast (the tooltip does not say whether a new cast refreshes older stacks); illusions copy the stacks Bristleback has when they are created', illusion: true,
  onCast(m, ev) { if (!ev.ability.isItem && ev.ability.name !== 'bristleback_bristleback') warpathStack(m.parent); },      // the Scepter active stacks per spray
  onCreated(m) {
    const u = m.parent; if (!u.isIllusion) return;
    const src = u.world.units.find((x) => x.name === u.name && !x.isIllusion && x.alive);
    if (src) for (const s of src.mods) if (s.name === WARPATH) u.addModifier(WARPATH, { ability: m.ability, duration: s.remaining() });
  },
});

passive('bristleback_prickly', {
  fid: 'approx', note: 'no facing in the sandbox: "behind him" is measured from the unit Bristleback is attacking or casting on (see Bristleback); the debuff duration amp is applied to his own Nasal Goo and Quill Spray stacks only, not to item debuffs',
  outgoing(m, d) { const t = d.dst; if (t.team !== m.parent.team && realHero(t) && isBehind(m.parent, t, m.v('angle'))) d.amount *= 1 + m.v('amp_pct') / 100; },
});

// ================================================================ Legion Commander
buff('modifier_legion_commander_overwhelming_odds', { stats: { as: 'bonus_attack_speed' } });
debuff('modifier_legion_commander_overwhelming_odds_slow', { stats: (m) => ({ msPct: -m.v('movement_slow') }) });
barrier('modifier_legion_commander_overwhelming_odds_barrier', 'all');
defAbility('legion_commander_overwhelming_odds', {
  fid: 'full', note: 'illusions count as non-hero units for the damage per unit', prio: 55, ai: nearAI('radius', -100),
  cast(ab) {
    const u = ab.owner; const es = enemiesNear(ab, u.x, u.y, ab.v('radius')).filter((e) => !e.isBuilding);
    let dmg = ab.v('damage'); for (const e of es) dmg += realHero(e) ? ab.v('damage_per_hero') : ab.v('damage_per_unit');
    let shield = 0;
    for (const e of es) {
      const dealt = hit(ab, e, dmg, MAGICAL);
      if (realHero(e) || ab.v('shield_counts_non_hero_damage') > 0) shield += dealt;
      if (e.alive) addMod(ab, e, 'modifier_legion_commander_overwhelming_odds_slow', ab.v('slow_duration'));
    }
    addMod(ab, u, 'modifier_legion_commander_overwhelming_odds', ab.v('duration'));
    if (ab.v('shield_per_damage_pct') > 0 && shield > 0) {         // Shard: all-damage barrier from the damage dealt to heroes
      u.removeModifierByName('modifier_legion_commander_overwhelming_odds_barrier');
      giveBarrier(ab, u, 'modifier_legion_commander_overwhelming_odds_barrier', shield * ab.v('shield_per_damage_pct') / 100, ab.v('shield_duration'));
    }
  },
});

buff('modifier_legion_commander_press_the_attack', { stats: { msPct: 'move_speed', hpRegen: 'hp_regen' } });
function pressTheAttack(ab, t) {
  const u = ab.owner; const r = ab.v('radius');
  const list = r > 0 ? alliesNear(ab, t.x, t.y, r).filter((a) => !a.isBuilding) : [t];
  if (r > 0 && !list.includes(u)) list.push(u);                    // Scepter: area effect that always includes Legion Commander
  for (const a of list) { a.purge({ debuffs: true, strong: true }); addMod(ab, a, 'modifier_legion_commander_press_the_attack', ab.v('duration')); }
}
defAbility('legion_commander_press_the_attack', {
  fid: 'full', prio: 35,
  ai: (ab, u, t) => {
    if (!t) return null;
    if (u.hp / u.maxHp < 0.7 || u.mods.some(dispellable)) return { target: u };
    for (const a of u.world.units) if (a !== u && a.alive && a.team === u.team && a.heroLike && !immune(a) && a.hp / a.maxHp < 0.5 && u.distTo(a) <= ab.castRange()) return { target: a };
    return null;
  },
  cast(ab, t) { pressTheAttack(ab, t || ab.owner); },
});

// Moment of Courage. m.x = attacks received. The proc is a short buff (lifesteal) that is spent on an instant attack.
function courageStrike(b) {
  const u = b.parent;
  if (u.isDisarmed() || u.cantAct()) return;
  const ok = (x) => x && x.alive && x.team !== u.team && x.attackableBy(u) && u.rangeTo(x) <= u.attackRange + 1;
  const t = ok(facingTarget(u)) ? facingTarget(u) : ok(b.data) ? b.data : null;
  if (!t) return;
  u.world.launchAttack(u, t, { instant: true, fromAbility: b.ability, mult: b.v('secondary_attack_damage') / 100 });
  b.remove();
}
buff('modifier_legion_commander_moment_of_courage_buff', { purge: 'none', interval: 0.1, stats: { lifesteal: 'hp_leech_percent' }, onThink: courageStrike });
// [L] measured in Hero Demo: an attack counts when the enemy starts it (its wind-up), and the counter-attack comes at that moment.
// The engine has no "being attacked: wind-up started" hook, so enemy wind-ups aimed at her are polled every tick (m.data: attacker -> start time).
passive('legion_commander_moment_of_courage', {
  fid: 'full', note: 'attacks count when the enemy starts them (polled every tick); the counter-attack hits her current attack target (or the attacker) as soon as it is within attack range during buff_duration',
  interval: (m) => m.parent.world.dt, onCreated(m) { m.data = new Map(); },
  onThink(m) {
    const u = m.parent; const seen = m.data;
    for (const e of u.world.units) {
      if (!e.alive || e.team === u.team || !e.winding || e.attackTarget !== u || seen.get(e) === e.attackStart) continue;
      seen.set(e, e.attackStart);
      if (++m.x < m.v('trigger_attacks') || !m.ability.cdReady()) continue;
      m.x = 0; m.ability.startCooldown();
      const b = u.addModifier('modifier_legion_commander_moment_of_courage_buff', { ability: m.ability, duration: m.v('buff_duration'), data: e });
      if (b) courageStrike(b);
    }
  },
  onAttack(m, rec) { const c = m.v('crit_mult') / 100; if (rec.fromAbility === m.ability && c > rec.crit) rec.crit = c; },     // talent: the counter-attack crits
});

// Outfight Them!: every cast adds its own armor instance (m.x = share: 1 for Legion Commander, ally_factor for allied heroes)
modifier('modifier_legion_commander_outfight_them_buff', { multi: 'independent', purge: 'none', stats: (m) => ({ armor: m.v('armor') * m.x }) });
passive('legion_commander_outfight_them', {
  fid: 'full',
  onAnyCast(m, ev) {
    const u = m.parent; const c = ev.caster;
    if (ev.ability.isItem || c.team !== u.team || !c.alive) return;
    if (c !== u && (!realHero(c) || u.distTo(c) > m.v('radius'))) return;
    const b = c.addModifier('modifier_legion_commander_outfight_them_buff', { caster: u, ability: m.ability, duration: m.v('duration') });
    if (b) { b.x = c === u ? 1 : m.v('ally_factor') / 100; c.dirty = true; }
  },
});

// Duel. Per the tooltip neither hero can use items, only the target loses its abilities: Legion Commander keeps casting, so she is
// not put into the engine's taunt state (taunted units cannot cast); her controller is locked onto the opponent instead.
const DUEL = 'modifier_legion_commander_duel'; const DUEL_FOE = 'modifier_legion_commander_duel_debuff';
const DUEL_BREAK = 2000;      // "Duels will end if the units are pushed 2000 units apart": the number exists only in the tooltip note
modifier('modifier_legion_commander_duel_damage', { multi: 'stack', purge: 'none', stats: (m) => ({ dmg: m.stacks }) });
function duelOver(m, otherName) {
  const u = m.parent; const o = m.data.other; const ab = m.ability;
  const om = o.findModifier(otherName);
  if (!om || om.data.other !== u) return;
  if (!u.alive && o.alive) {                                       // the survivor wins: permanent bonus damage
    o.addModifier('modifier_legion_commander_duel_damage', { ability: ab, stacks: ab.v('reward_damage') });
    if (o === ab.owner) {
      if (ab.v('duel_refresh_on_victory') > 0 && ab.cdEnd > o.world.time) ab.cdEnd -= ab.v('duel_refresh_on_victory');
      const pta = o.findAbility('legion_commander_press_the_attack');
      if (ab.v('trigger_pta_on_victory') > 0 && pta && pta.level > 0) pressTheAttack(pta, o);      // Scepter
    }
  }
  om.remove();
}
modifier(DUEL, {
  purge: 'none', state: ['MUTE'], interval: 0.1,
  onCreated(m) { const u = m.parent; if (u.ai) { m.data.prev = u.ai.fixedTarget; u.ai.fixedTarget = m.data.other; } u.attack(m.data.other); },
  onThink(m) { if (m.parent.distTo(m.data.other) > DUEL_BREAK) m.remove(); },      // pushed apart: the duel ends without a winner
  onDestroy(m) { const u = m.parent; if (u.ai && u.ai.fixedTarget === m.data.other) u.ai.fixedTarget = m.data.prev || null; duelOver(m, DUEL_FOE); },
});
debuff(DUEL_FOE, { pierce: true, purge: 'none', statusResist: false, state: ['TAUNT', 'SILENCE', 'MUTE'], onDestroy(m) { duelOver(m, DUEL); } });
defAbility('legion_commander_duel', {
  fid: 'full', note: 'the duel ends without a winner when the heroes are more than 2000 apart (checked every 0.1 s; that distance exists only in the tooltip note, not as a data value)', prio: 90,
  ai: (ab, u, t) => (t && t.isHero && !u.hasModifier(DUEL) ? { target: t } : null),          // heroes only
  cast(ab, t) {
    const u = ab.owner; const d = ab.v('duration');
    u.addModifier(DUEL, { ability: ab, duration: d, data: { other: t } });
    t.addModifier(DUEL_FOE, { caster: u, ability: ab, duration: d, data: { other: u } });
  },
});

// ================================================================ Slardar
// Guardian Sprint. m.x = current slow resistance: full for speed_burst_max_duration, then fading linearly to the end of the sprint.
buff('modifier_slardar_sprint', {
  interval: 0.25, onCreated(m) { m.x = m.v('slow_resistance_tooltip'); },
  stats: (m) => ({ msPct: m.v('bonus_speed'), slowRes: m.x }),
  onThink(m) {
    const t = m.parent.world.time - m.created; const full = m.v('speed_burst_max_duration'); const total = m.dieTime - m.created;
    const v = m.v('slow_resistance_tooltip') * (t <= full ? 1 : Math.max(0, 1 - (t - full) / Math.max(0.01, total - full)));
    if (v !== m.x) { m.x = v; m.parent.dirty = true; }
  },
});
selfBuff('slardar_sprint', {
  fid: 'full', note: 'the slow resistance fades linearly after speed_burst_max_duration (updated every 0.25 s); the AI uses it to close distance', prio: 100, engage: false, mod: 'modifier_slardar_sprint', duration: 'duration',
  ai: (ab, u, t) => (t && u.rangeTo(t) > u.attackRange + 150 && !u.hasModifier('modifier_slardar_sprint') ? true : null),
});

// water: Slithereen Crush puddles and Corrosive Haze trails are kept as circles { x, y, r, until } on the Seaborn Sentinel ability
const water = (ss) => (ss.data ||= []);
const HAZE = 'modifier_slardar_amplify_damage_debuff'; const HAZE_FIXED = 'modifier_slardar_amplify_damage_undispellable';
const hasHaze = (t) => t.hasModifier(HAZE) || t.hasModifier(HAZE_FIXED);
const applyHaze = (haze, e, duration) => e.addModifier(haze.v('undispellable') > 0 ? HAZE_FIXED : HAZE, { caster: haze.owner, ability: haze, duration });

debuff('modifier_slardar_slithereen_crush_slow', { stats: { msPct: 'crush_extra_slow', asSlow: 'crush_attack_slow_tooltip' } });
defAbility('slardar_slithereen_crush', {
  fid: 'full', prio: 60, ai: nearAI('crush_radius', -10),
  cast(ab) {
    const u = ab.owner; const w = u.world; const haze = u.findAbility('slardar_amplify_damage'); const ss = u.findAbility('slardar_seaborn_sentinel');
    for (const e of enemiesNear(ab, u.x, u.y, ab.v('crush_radius'))) {
      if (e.isBuilding) continue;
      hit(ab, e, ab.v('crush_damage'), PHYSICAL);
      if (!e.alive || immune(e)) continue;
      const sm = stun(ab, e, ab.v('stun_duration'));
      // [L] measured in Hero Demo: the slow is on from the crush itself and ends crush_extra_slow_duration after the stun
      addMod(ab, e, 'modifier_slardar_slithereen_crush_slow', (sm ? Math.max(0, sm.remaining()) : 0) + ab.v('crush_extra_slow_duration'));
      if (ab.v('shard_amp_duration') > 0 && haze && haze.level > 0) applyHaze(haze, e, ab.v('shard_amp_duration'));
    }
    if (ss && ss.level > 0) water(ss).push({ x: u.x, y: u.y, r: ab.v('puddle_radius'), until: w.time + ab.v('puddle_duration') });
  },
});

// Bash of the Deep. m.x = successful attacks since the last bash; the attack after attack_count of them bashes.
passive('slardar_bash', {
  fid: 'full',
  onAttack(m, rec) { if (!rec.target.isBuilding && !rec.fromAbility && m.x >= m.v('attack_count')) { rec.add += m.v('bonus_damage'); (rec.data ||= {}).sbash = m; } },
  onAttackLanded(m, rec) {
    if (rec.target.isBuilding || rec.fromAbility) return;
    if (!(rec.data && rec.data.sbash === m)) { m.x++; return; }
    m.x = 0;
    if (rec.target.alive) rec.target.addModifier('modifier_stunned', { caster: m.parent, ability: m.ability, duration: m.v('duration'), pierce: true });
  },
});

buff('modifier_slardar_seaborn_sentinel_buff', { purge: 'none', stats: (m) => ({ msPct: m.v('river_speed'), hpRegen: m.v('puddle_regen'), armor: m.v('puddle_armor'), dmgBasePct: m.v('river_damage_pct'), statusRes: m.v('puddle_status_resistance') }) });
passive('slardar_seaborn_sentinel', {
  fid: 'approx', note: 'bonuses apply while Slardar stands in a Slithereen Crush puddle or on the water trail of a Corrosive Haze target (position checked every 0.25 s, trail laid as circles); rivers do not exist in the sandbox',
  interval: 0.25,
  onThink(m) {
    const u = m.parent; const now = u.world.time; const ws = m.ability.data;
    if (!ws || !ws.length) return;
    let inside = false;
    for (let i = ws.length - 1; i >= 0; i--) { const p = ws[i]; if (p.until < now) { ws.splice(i, 1); continue; } const dx = u.x - p.x; const dy = u.y - p.y; if (dx * dx + dy * dy <= p.r * p.r) inside = true; }
    if (inside) u.addModifier('modifier_slardar_seaborn_sentinel_buff', { ability: m.ability, duration: 0.5 });
  },
});

// Corrosive Haze (two modifier variants because the "undispellable" talent changes how it can be removed)
const hazeDef = (purge) => ({
  pierce: true, purge, keepLonger: true, interval: 0.25, stats: { armor: 'armor_reduction' },
  onThink(m) {                                                     // "The enemy unit leaves a trail of water behind it"
    const t = m.parent; const c = m.caster; const ss = c.findAbility('slardar_seaborn_sentinel');
    if (!ss || ss.level < 1) return;
    const r = m.v('puddle_radius'); const until = t.world.time + m.v('puddle_duration'); const last = m.data;
    if (last && Math.hypot(t.x - last.x, t.y - last.y) < r / 2) { last.until = until; return; }
    m.data = { x: t.x, y: t.y, r, until }; water(ss).push(m.data);
  },
});
debuff(HAZE, hazeDef('basic')); debuff(HAZE_FIXED, hazeDef('none'));
defAbility('slardar_amplify_damage', {
  fid: 'approx', note: 'the True Sight on the target is not modelled: the engine cannot reveal a unit (this only matters when a scenario turns detectAll off; by default invisibility hides nothing). Armor reduction and the water trail are modelled', prio: 85,
  ai: (ab, u, t) => (t && !t.isBuilding && !hasHaze(t) ? { target: t } : null),
  cast(ab, t) { applyHaze(ab, t, ab.v('duration')); },
});

// ================================================================ Lina
// Every enemy hit by one of Lina's spells takes the impact damage, the Slow Burn and gives her a Fiery Soul stack.
const BURN = 'modifier_lina_slow_burn_debuff';
// [L] measured in Hero Demo: the burn is applied to and ticks on a debuff-immune (Black King Bar) target, like the impact damage
debuff(BURN, { multi: 'independent', purge: 'none', statusResist: false, pierce: true, ...ticker(1, (m) => mhit(m, m.parent, m.x, MAGICAL, F_NO_AMP)) });      // m.x = damage per second
buff('modifier_lina_fiery_soul_buff', { multi: 'stack', purge: 'none', maxStacks: (m) => m.v('fiery_soul_max_stacks'), stats: (m) => ({ as: m.v('fiery_soul_attack_speed_bonus') * m.stacks, msPct: m.v('fiery_soul_move_speed_bonus') * m.stacks }) });
buff('modifier_lina_laguna_blade_supercharge', { purge: 'none', stats: (m) => ({ as: m.v('fiery_soul_attack_speed_bonus') * m.x, msPct: m.v('fiery_soul_move_speed_bonus') * m.x }) });
function linaHit(ab, e, dmg) {
  const u = ab.owner;
  hit(ab, e, dmg, MAGICAL);
  const sb = u.findAbility('lina_slow_burn');
  if (sb && sb.level > 0 && e.alive) {
    const dur = sb.v('burn_duration');
    const b = e.addModifier(BURN, { caster: u, ability: sb, duration: dur });
    if (b) b.x = dmg * (1 + u.spellAmp / 100) * sb.v('burn_damage_pct') / 100 / dur;
  }
  const fs = u.findAbility('lina_fiery_soul');
  if (fs && fs.level > 0 && !(u.st[ST.BREAK] > 0)) u.addModifier('modifier_lina_fiery_soul_buff', { ability: fs, duration: fs.v('fiery_soul_stack_duration') });
}
defAbility('lina_dragon_slave', {
  fid: 'approx', note: 'the wave is a trapezoid from Lina (radius dragon_slave_width_initial -> dragon_slave_width_end over dragon_slave_distance, width values taken as radii); enemies inside it at cast time are hit when the wave reaches them', prio: 50,
  ai: (ab, u, t) => (t ? { x: t.x, y: t.y } : null),               // ground cast: does not trigger spell block
  cast(ab, t, x, y) {
    const u = ab.owner; const w = u.world;
    if (t) { x = t.x; y = t.y; }
    if (dodged(w)) return;
    for (const [e, k] of inWave(u, x, y, ab.v('dragon_slave_distance'), ab.v('dragon_slave_width_initial'), ab.v('dragon_slave_width_end'))) w.after(k / ab.v('dragon_slave_speed'), () => { if (e.alive) linaHit(ab, e, ab.v('dragon_slave_damage')); });
  },
});
defAbility('lina_light_strike_array', {
  fid: 'full', prio: 60,
  cast(ab, t, x, y) {
    const w = ab.owner.world;
    w.after(ab.v('light_strike_array_delay_time'), () => {
      if (dodged(w)) return;
      for (const e of enemiesNear(ab, x, y, ab.v('light_strike_array_aoe'))) { if (e.isBuilding) continue; stun(ab, e, ab.v('light_strike_array_stun_duration')); linaHit(ab, e, ab.v('light_strike_array_damage')); }
    });
  },
});
defAbility('lina_fiery_soul', { fid: 'full', note: 'one stack per enemy hit by Dragon Slave, Light Strike Array or Laguna Blade' });
buff('modifier_lina_flame_cloak', { purge: 'none', stats: { spellAmp: 'spell_amp', mr: 'magic_resistance' } });
selfBuff('lina_flame_cloak', { fid: 'full', note: 'unobstructed movement has no meaning on the open plane', prio: 90, mod: 'modifier_lina_flame_cloak', duration: 'flame_cloak_duration' });
passive('lina_slow_burn', {
  fid: 'full', note: 'the burn of every spell hit is its own debuff ticking once per second',
  onAttack(m, rec) { const c = m.v('target_crit_multiplier') / 100; if (c > rec.crit && rec.target.hasModifier(BURN)) rec.crit = c; },      // talent: attacks crit burning targets
});
defAbility('lina_laguna_blade', {
  fid: 'full', prio: 70,
  ai: (ab, u, t) => (canTarget(ab, t) && worth(u, t) ? { target: t } : null),
  cast(ab, t) {
    const u = ab.owner;
    // [L] measured in Hero Demo: Laguna Blade is castable on a debuff-immune enemy and its damage lands (reduced by its magic resistance)
    u.world.after(ab.v('damage_delay'), () => { if (t.alive) linaHit(ab, t, ab.v('damage')); });
    const fs = u.findAbility('lina_fiery_soul');
    if (ab.v('supercharge_stacks') > 0 && fs && fs.level > 0) {     // Shard: extra Fiery Soul stacks for supercharge_duration
      const s = u.addModifier('modifier_lina_laguna_blade_supercharge', { ability: fs, duration: ab.v('supercharge_duration') });
      if (s) { s.x = ab.v('supercharge_stacks'); u.dirty = true; }
    }
  },
});

// ================================================================ Lion
const SPIKE_CONE_DEG = 30;      // "Earth Spike affects a 30 degree cone": the angle exists only in the talent text (data has the flag cone_shaped)
const SPIKE_AIR_TIME = 0.5;     // [L] measured in Hero Demo: the stun starts when the spikes reach the unit, the damage comes 0.5 s later (landing)
defAbility('lion_impale', {
  fid: 'approx', note: 'spikes run cast range + length_buffer from Lion with radius = width; enemies in that strip at cast time are stunned for duration when the spikes reach them and take the damage 0.5 s later, when they land (measured in the live game; the knock-up itself is not a state here). Talent cone: the strip widens to a 30 degree cone (angle taken from the talent text)', prio: 60,
  ai: (ab, u, t) => (t ? { x: t.x, y: t.y } : null),               // ground cast: does not trigger spell block
  cast(ab, t, x, y) {
    const u = ab.owner; const w = u.world;
    if (t) { x = t.x; y = t.y; }
    if (dodged(w)) return;
    const len = ab.castRange() + ab.v('length_buffer'); const r = ab.v('width');
    const r1 = ab.v('cone_shaped') > 0 ? Math.max(r, len * Math.tan(SPIKE_CONE_DEG / 2 * Math.PI / 180)) : r;
    for (const [e, k] of inWave(u, x, y, len, r, r1)) {
      w.after(k / ab.v('speed'), () => {
        if (!e.alive) return;
        // [L] measured in Hero Demo: a debuff-immune unit is not hurled (no stun) and takes the damage at once
        if (immune(e) && !ab.pierces) { hit(ab, e, ab.v('damage'), MAGICAL); return; }
        stun(ab, e, ab.v('duration'));
        w.after(SPIKE_AIR_TIME, () => { if (e.alive) hit(ab, e, ab.v('damage'), MAGICAL); });
      });
    }
  },
});
// [L] measured in Hero Demo: a hexed unit also reports silenced, disarmed and muted
debuff('modifier_lion_voodoo', { state: ['HEX', 'SILENCE', 'DISARM', 'MUTE'], purge: 'strong', stats: (m) => ({ msCap: m.v('movespeed') }) });
defAbility('lion_voodoo', {
  fid: 'full', prio: 80,
  ai: (ab, u, t) => (canTarget(ab, t) && !(t.st[ST.HEX] > 0) ? { target: t } : null),
  cast(ab, t, x, y) {
    const u = ab.owner; const r = ab.v('radius');
    if (t) { x = t.x; y = t.y; }
    for (const e of r > 0 ? enemiesNear(ab, x, y, r) : t ? [t] : []) {
      if (e.isBuilding || !e.alive || blocked(ab, e)) continue;
      if (e.isIllusion && !(e.st[ST.INVULN] > 0)) { u.world.kill(e, u, ab); continue; }       // "Instantly destroys illusions"
      addMod(ab, e, 'modifier_lion_voodoo', ab.v('duration'));
    }
  },
});

// Mana Drain: one link modifier per target, ticking every tick_interval while Lion channels and the target stays within break_distance
const DRAIN = 'modifier_lion_mana_drain_debuff'; const DRAIN_ALLY = 'modifier_lion_mana_drain_ally';
const drainLinked = (m) => { const c = m.caster; const ab = m.ability; return c.alive && c.channelAb === ab && c.distTo(m.parent) <= ab.v('break_distance'); };
// the channel stops as soon as no link is left ([L] measured in Hero Demo: the links last `duration`, 0.1 s less than the channel time)
function drainLast(m) {
  const c = m.caster;
  if (c.alive && c.channelAb === m.ability && !c.world.units.some((e) => e.alive && e.mods.some((x) => x !== m && !x.removed && x.caster === c && (x.name === DRAIN || x.name === DRAIN_ALLY)))) c.endChannel(true);
}
function drainBreak(m) { m.remove(); }
const drainTick = ticker((m) => m.v('tick_interval'), (m) => {
  const t = m.parent;
  if (!drainLinked(m)) { drainBreak(m); return; }
  const got = t.burnMana(m.v('mana_per_second') * m.v('tick_interval'));
  if (got > 0) m.caster.giveMana(got);
  const empty = t.mana <= 0 ? 1 : 0; if (empty !== m.x) { m.x = empty; t.dirty = true; }
});
debuff(DRAIN, {
  purge: 'none', statusResist: false,
  stats: (m) => ({ msPct: -(m.v('movespeed') + m.x * m.v('movespeed_bonus_when_empty_pct')) }),       // m.x = 1 while the target has no mana left
  ...drainTick,
  onCreated(m) { m.x = m.parent.mana <= 0 ? 1 : 0; },
  onDestroy(m, expired) { drainTick.onDestroy(m, expired); drainLast(m); },
});
const drainAllyTick = ticker((m) => m.v('tick_interval'), (m) => {
  const t = m.parent; const c = m.caster;
  if (!drainLinked(m)) { drainBreak(m); return; }
  const amount = Math.min(c.mana, t.maxMana - t.mana, m.v('mana_per_second') * m.v('tick_interval') * m.v('ally_pct') / 100);
  if (amount > 0) { c.mana -= amount; t.giveMana(amount); }
});
buff(DRAIN_ALLY, {
  purge: 'none', stats: (m) => ({ msPct: m.v('movespeed') * m.v('ally_pct') / 100 }),
  ...drainAllyTick,
  onDestroy(m, expired) { drainAllyTick.onDestroy(m, expired); drainLast(m); },
});
buff('modifier_lion_mana_drain_immunity', { purge: 'none', state: ['IMMUNE'], stats: (m) => ({ mr: m.v('magic_resist') }) });
defAbility('lion_mana_drain', {
  fid: 'approx', note: '"Prevents heroes from going invisible" is not modelled: the engine cannot keep a unit visible (this only matters when a scenario turns detectAll off). The slow bonus on an empty target is taken as +movespeed_bonus_when_empty_pct percentage points; Shard: the extra targets are the enemies nearest to the main target within cast range of Lion. The AI drains only when Lion is below 35% mana', prio: 10, channel: true,
  ai: (ab, u, t) => (canTarget(ab, t) && t.mana > 0 && u.maxMana > 0 && u.mana / u.maxMana < 0.35 ? { target: t } : null),
  cast(ab, t) {
    const u = ab.owner; const dur = ab.v('duration');
    if (t.team === u.team) { addMod(ab, t, DRAIN_ALLY, dur); return; }
    const targets = [t]; const extra = ab.v('shard_bonus_targets');
    if (extra > 0) targets.push(...enemiesNear(ab, u.x, u.y, ab.castRange()).filter((e) => e !== t && !e.isBuilding && !immune(e)).sort((a, b) => t.distTo(a) - t.distTo(b)).slice(0, extra));
    for (const e of targets) addMod(ab, e, DRAIN, dur);
    if (ab.v('magic_resist') > 0) addMod(ab, u, 'modifier_lion_mana_drain_immunity', dur);       // Shard: debuff immune while the links last
  },
  channelEnd(ab) {
    const u = ab.owner; u.removeModifierByName('modifier_lion_mana_drain_immunity');
    for (const e of u.world.units) { if (!e.alive) continue; for (const n of [DRAIN, DRAIN_ALLY]) { const m = e.findModifier(n, u); if (m) m.remove(); } }
  },
});

// To Hell and Back: m.data = last time Lion damaged each enemy hero (an assist = damage within damage_window before the death);
// m.x = time of a death that may have been prevented (a resurrection), checked on the next think
buff('modifier_lion_to_hell_and_back_buff', { purge: 'none', stats: { debuffAmp: 'debuff_amp' } });
buff('modifier_lion_to_hell_and_back_respawn', { purge: 'none', stats: { spellAmp: 'spell_amp' } });
passive('lion_to_hell_and_back', {
  fid: 'full', note: 'heroes do not respawn in the sandbox: the debuff duration bonus lasts from the first hero kill / assist to the end of the fight; the spell amplification is granted only when Lion survives his own death (resurrection effects)',
  interval: 0.5,
  onCreated(m) { m.data = new Map(); },
  onDealDamage(m, d) { const t = d.dst; if (t.isHero && !t.isIllusion && t.team !== m.parent.team) m.data.set(t, m.parent.world.time); },
  onDeath(m) { m.x = m.parent.world.time + 1e-6; },
  onThink(m) {
    const u = m.parent;
    if (m.x > 0 && u.world.time > m.x) { m.x = 0; u.addModifier('modifier_lion_to_hell_and_back_respawn', { ability: m.ability, duration: m.v('duration') }); }
  },
  onAnyDeath(m, ev) {
    const u = m.parent; const v = ev.victim;
    if (!realHero(v) || v.team === u.team) return;
    const last = m.data.get(v);
    if (ev.killer !== u && !(last !== undefined && u.world.time - last <= m.v('damage_window'))) return;
    u.addModifier('modifier_lion_to_hell_and_back_buff', { ability: m.ability });
    u.removeModifierByName('modifier_lion_to_hell_and_back_respawn');       // "... or until he gets a kill or assist"
  },
});

// Finger of Death: kill counter, grace-period mark on the victims and the Fist of Death (melee form after the cast)
modifier('modifier_lion_finger_of_death_kill_counter', { multi: 'stack', purge: 'none' });
const fingerKills = (ab) => { const c = ab.owner.findModifier('modifier_lion_finger_of_death_kill_counter'); return c ? c.stacks : 0; };
function fingerKill(ab, victim) {
  const u = ab.owner;
  if (!u.alive || ab.data === victim) return;                      // ab.data = last victim counted (mark and fist may both report it)
  ab.data = victim; u.addModifier('modifier_lion_finger_of_death_kill_counter', { ability: ab }); u.dirty = true;
}
debuff('modifier_lion_finger_of_death_mark', { hidden: true, pierce: true, purge: 'none', statusResist: false, onDestroy(m) { const t = m.parent; if (!t.alive && realHero(t)) fingerKill(m.ability, t); } });
buff('modifier_lion_finger_of_death_punch', {
  purge: 'none',
  stats: (m) => { const u = m.parent; const base = u.ovr && u.ovr.range !== undefined ? u.ovr.range : u.def.range; return { attackRange: m.v('punch_attack_range') - base, ms: m.v('punch_bonus_movespeed'), dmg: m.v('punch_bonus_damage_base') + m.v('damage_per_kill') * fingerKills(m.ability) }; },
  onCreated(m) { const u = m.parent; m.x = u.melee ? 0 : 1; u.melee = true; u.dirty = true; },
  onDestroy(m) { const u = m.parent; if (m.x === 1) u.melee = false; u.dirty = true; },
  onAttackLanded(m, rec) { if (rec.damage > 0 && !rec.secondary) cleave(m.parent, rec.target, rec.damage * m.v('cleave_damage') / 100, m.v('cleave_starting_width'), m.v('cleave_ending_width'), m.v('cleave_distance'), m.ability); },
  onKill(m, ev) { const v = ev.victim; if (realHero(v) && v.team !== m.parent.team && (!ev.ability || ev.ability === m.ability)) fingerKill(m.ability, v); },
});
const fingerDamage = (ab) => ab.v('damage') + ab.v('damage_per_kill') * fingerKills(ab);
defAbility('lion_finger_of_death', {
  fid: 'approx', note: 'the Fist of Death is always left enabled (Alt Cast off), so Lion fights in melee with punch_attack_range for punch_duration after each cast; set ability.toggled to keep him ranged. The AI casts it on a hero that it kills or that is below 60% health, or when Lion himself is below half health', prio: 75,
  ai: (ab, u, t) => (canTarget(ab, t) && worth(u, t) && (t.hp <= fingerDamage(ab) * (1 + u.spellAmp / 100) * (1 - t.mr) || t.hp / t.maxHp < 0.6 || u.hp / u.maxHp < 0.5) ? { target: t } : null),
  cast(ab, t) {
    const u = ab.owner; const dmg = fingerDamage(ab);
    u.world.after(ab.v('damage_delay'), () => {
      const r = ab.v('splash_radius');                             // Scepter: area damage on the initial cast
      const list = r > 0 ? enemiesNear(ab, t.x, t.y, r).filter((e) => !e.isBuilding && e !== t) : [];
      if (t.alive) list.unshift(t);                                  // the damage also lands on a debuff-immune target (as measured for the other nukes)
      for (const e of list) { if (!e.alive) continue; e.addModifier('modifier_lion_finger_of_death_mark', { caster: u, ability: ab, duration: ab.v('grace_period') }); hit(ab, e, dmg, MAGICAL); }
    });
    if (!ab.toggled) addMod(ab, u, 'modifier_lion_finger_of_death_punch', ab.v('punch_duration'));
  },
});

// ================================================================ Zeus
// Static Field rides on every attack and on every ability hit (before the ability's own damage)
// [L] measured in Hero Demo: Zeus's damage (Static Field included) also lands on debuff-immune enemies, reduced by their magic resistance
function staticField(u, e, share = 1) {
  const sf = u.findAbility('zuus_static_field');
  if (sf && sf.level > 0 && e.alive && !e.isBuilding && !(u.st[ST.BREAK] > 0)) u.world.damage(u, e, e.hp * sf.v('damage_health_pct') / 100 * share, MAGICAL, 0, sf);
}
function zeusHit(ab, e, dmg, share = 1) { staticField(ab.owner, e, share); if (e.alive) hit(ab, e, dmg, MAGICAL); }
// [L] measured in Hero Demo: the shock of an attack is taken from the health before the attack damage
// the Lightning Hands arc follows the shock, still before the attack damage (order measured in the live game: shock, arc, attack damage)
passive('zuus_static_field', { fid: 'full', outgoing(m, d) { if ((d.flags & F_ATTACK) && !(d.rec && d.rec.secondary) && d.dst.team !== m.parent.team) { staticField(m.parent, d.dst); handsArc(m.parent, d.dst); } } });
function handsArc(u, t) {
  const lh = u.findModifier('modifier_zuus_lightning_hands'); const arc = u.findAbility('zuus_arc_lightning');
  if (!lh || !lh.active() || !arc || arc.level < 1 || !t.alive || t.isBuilding) return;
  arcLightning(arc, t, lh.v('arc_lightning_damage_pct') / 100, true);      // [L] measured: bounces get Static Field at arc_lightning_damage_pct, the attacked unit only the arc
}

// `share` scales the arc and its Static Field (Lightning Hands); `hands`: the attacked unit already had its shock from the attack
function arcLightning(arc, first, share = 1, hands = false) {
  const u = arc.owner;
  chain(u, first, arc.v('jump_count') + 1, arc.v('radius'), (e, i) => {
    if (e.isBuilding) return;
    if (hands && i === 0) hit(arc, e, arc.v('arc_damage') * share, MAGICAL); else zeusHit(arc, e, arc.v('arc_damage') * share, share);
  }, arc.v('jump_delay'));
}
defAbility('zuus_arc_lightning', {
  fid: 'full', note: 'jump_count is counted after the first target; every unit is hit once', prio: 40,
  ai: (ab, u, t) => (canTarget(ab, t) ? { target: t } : null),
  cast(ab, t) { arcLightning(ab, t); },
});

function boltStrike(lb, e, aoe) {
  const list = aoe > 0 ? enemiesNear(lb, e.x, e.y, aoe).filter((x) => x !== e) : [];
  list.unshift(e);
  for (const x of list) { if (!x.alive || x.isBuilding) continue; if (!immune(x)) stun(lb, x, lb.v('ministun_duration')); zeusHit(lb, x, lb.v('damage')); }
}
defAbility('zuus_lightning_bolt', {
  fid: 'approx', note: 'the True Sight around the strike is not modelled: the engine cannot reveal a unit (this only matters when a scenario turns detectAll off; by default invisibility hides nothing). Damage, mini-stun and the ground cast, which also strikes an invisible hero, are modelled', prio: 60,
  ai: (ab, u, t) => (canTarget(ab, t) ? { target: t } : null),
  cast(ab, t, x, y) {
    if (!t) {                                                      // ground cast: the closest enemy hero within spread_aoe
      let bd = Infinity;
      for (const e of enemiesNear(ab, x, y, ab.v('spread_aoe'))) { if (!e.isHero) continue; const d = (e.x - x) ** 2 + (e.y - y) ** 2; if (d < bd) { bd = d; t = e; } }
    }
    if (t) boltStrike(ab, t, ab.v('aoe_radius'));
  },
});

debuff('modifier_zuus_heavenly_jump_slow', { stats: (m) => ({ msPct: -m.v('move_slow'), asSlow: -m.v('aspd_slow') }) });
// [L] measured in Hero Demo: the hop is a motion of hop_distance over hop_duration (40 per server tick at level 4), starting the tick
// after the cast and covering the full distance (Zeus passes over the enemy he faces); the strike lands 0.1 s after the cast (0.1-0.133 s live)
modifier('modifier_zuus_heavenly_jump', { // data: { dx, dy, left, speed }
  purge: 'none', interval: (m) => m.parent.world.dt,
  onThink(m) {
    const u = m.parent; const d = m.data;
    if (u.st[ST.STUN] > 0 || u.st[ST.ROOT] > 0 || d.left <= 1e-6) { m.remove(); return; }
    const go = Math.min(d.left, d.speed * u.world.dt); u.x += d.dx * go; u.y += d.dy * go; d.left -= go;
    if (d.left <= 1e-6) m.remove();
  },
});
const ZEUS_JUMP_STRIKE = 0.1;
defAbility('zuus_heavenly_jump', {
  fid: 'approx', note: 'no facing in the sandbox: the hop goes towards the unit Zeus is attacking or casting on, else towards the nearest enemy; stopping the hop on stun / root is assumed, not measured', prio: 45,
  ai: (ab, u, t) => (t && !(u.st[ST.ROOT] > 0) && u.distTo(t) <= ab.v('range') - 100 ? true : null),      // cannot be used while rooted
  cast(ab) {
    const u = ab.owner; const w = u.world;
    u.world.after(ZEUS_JUMP_STRIKE, () => {      // "the closest visible nearby enemy (prioritizing heroes)"
      if (!u.alive) return;
      const es = enemiesNear(ab, u.x, u.y, ab.v('range')).filter((e) => !e.isBuilding && visible(e)).sort((a, b) => (b.isHero - a.isHero) || (u.distTo(a) - u.distTo(b))).slice(0, ab.v('targets'));
      for (const e of es) { zeusHit(ab, e, ab.v('damage')); if (e.alive) addMod(ab, e, 'modifier_zuus_heavenly_jump_slow', ab.v('duration')); }
    });
    if (u.st[ST.ROOT] > 0) return;
    let t = facingTarget(u); if (!t) t = w.nearestEnemy(u, 1e9);
    if (!t) return;
    const dx = t.x - u.x; const dy = t.y - u.y; const d = Math.hypot(dx, dy); if (d < 1e-6) return;
    u.removeModifierByName('modifier_zuus_heavenly_jump');
    addMod(ab, u, 'modifier_zuus_heavenly_jump', undefined, { data: { dx: dx / d, dy: dy / d, left: ab.v('hop_distance'), speed: ab.v('hop_distance') / ab.v('hop_duration') } });
  },
});

// Nimbus. Pip health (7.42 general rule, stated in the ability notes, not in its values): an attack of a hero, Roshan or a building
// removes one pip, the Nimbus is fragile so melee heroes and Roshan remove two, creeps and illusions a quarter. Nothing else hurts it.
const PIP_FULL = 1; const PIP_FRAGILE = 2; const PIP_MINOR = 0.25;
modifier('modifier_zuus_cloud', {
  purge: 'none', interval: 0.1,
  postMit(m, d) {
    const s = d.src;
    if (!s || !(d.flags & F_ATTACK) || d.rec === null || d.rec.secondary) { d.amount = 0; return; }
    const hero = realHero(s); const roshan = s.name === 'npc_dota_roshan';
    d.amount = m.parent.maxHp / m.v('tooltip_fragile_pips') * ((hero && s.melee) || roshan ? PIP_FRAGILE : hero || s.isBuilding ? PIP_FULL : PIP_MINOR);
  },
  onThink(m) {                                                     // m.x = time the next bolt is ready
    const c = m.parent; const z = m.caster; const w = c.world;
    if (w.time + 1e-9 < m.x) return;
    const lb = z.findAbility('zuus_lightning_bolt');
    if (!lb || lb.level < 1) return;
    let best = null; let bd = Infinity; const cr = m.v('cloud_radius');
    for (const e of w.units) {
      if (!e.alive || e.team === c.team || e.isBuilding || e.st[ST.OUT] > 0 || e.st[ST.INVULN] > 0) continue;
      const d = (e.x - c.x) ** 2 + (e.y - c.y) ** 2; const rr = cr + e.def.hull; if (d <= rr * rr && d < bd) { bd = d; best = e; }
    }
    if (!best) return;
    m.x = w.time + m.v('cloud_bolt_interval') * z.cdrMul;
    boltStrike(lb, best, 0);                                       // current level of Lightning Bolt, without the AoE talent
  },
});
defAbility('zuus_cloud', {
  fid: 'approx', note: 'the Nimbus is a real unit with pip health (hero attack = 1 pip, melee hero / Roshan = 2, creep / illusion = 1/4; these factors come from the tooltip notes); cloud_bolt_interval is treated as a cooldown scaled by Zeus\'s cooldown reduction and the first bolt is immediate; the AI drops it on its target', prio: 65,
  ai: (ab, u, t) => (t ? { x: t.x, y: t.y } : null),
  cast(ab, t, x, y) {
    const c = summon(ab, 'npc_dota_zeus_cloud', { x, y, duration: ab.v('cloud_duration'), ai: 'idle' });
    c.addModifier('modifier_zuus_cloud', { caster: ab.owner, ability: ab });
  },
});

// [L] measured in Hero Demo: the toggle starts on (the modifier is there when Zeus appears); toggling removes the modifier and its attack speed
modifier('modifier_zuus_lightning_hands', { stats: { as: 'attack_speed_bonus' } });
defAbility('zuus_lightning_hands', {
  mods: ['modifier_zuus_lightning_hands'], requires: (ab) => !(ab.data && ab.data.off), manual: true,
  cast(ab) { ab.data = { off: !(ab.data && ab.data.off) }; ab.syncMods(); ab.owner.dirty = true; },
  fid: 'full', note: 'toggle, on from the start (the AI never switches it off); the arc starts on the attacked unit as the attack lands (run from Static Field, after its shock, before the attack damage) with Arc Lightning\'s current jump count, radius and delay; bounced units also get Static Field at arc_lightning_damage_pct, the attacked unit only the arc damage',
});
defAbility('zuus_thundergods_wrath', {
  fid: 'approx', note: 'invisible heroes are struck too (True Sight "before they are struck"), but the True Sight that stays around each hero afterwards is not modelled: the engine cannot reveal a unit (this only matters when a scenario turns detectAll off)', prio: 70, engage: false,
  ai: (ab, u, t) => (t && u.world.units.some((e) => e.alive && e.team !== u.team && e.isHero) ? true : null),
  cast(ab) { const u = ab.owner; for (const e of u.world.units.slice()) if (e.alive && e.team !== u.team && e.isHero && !(e.st[ST.OUT] > 0)) zeusHit(ab, e, ab.v('damage')); },
});

// ================================================================ Crystal Maiden
const FROST = 'modifier_crystal_maiden_frostbite_debuff'; const CLONE = 'modifier_crystal_maiden_crystal_clone';
// "The Clone can also be destroyed by Crystal Maiden's own spells"
function shatterClones(u, x, y, r) { for (const c of u.world.units) if (c.alive && c.owner === u && c.hasModifier(CLONE) && (c.x - x) ** 2 + (c.y - y) ** 2 <= r * r) u.world.kill(c, u, null, true); }

debuff('modifier_crystal_maiden_crystal_nova_slow', { stats: { msPct: 'movespeed_slow', asSlow: 'attackspeed_slow' } });
defAbility('crystal_maiden_crystal_nova', {
  fid: 'full', prio: 55,
  cast(ab, t, x, y) {
    const u = ab.owner; const r = ab.v('radius');
    for (const e of enemiesNear(ab, x, y, r)) { if (e.isBuilding) continue; hit(ab, e, ab.v('nova_damage'), MAGICAL); if (e.alive) addMod(ab, e, 'modifier_crystal_maiden_crystal_nova_slow', ab.v('duration')); }
    shatterClones(u, x, y, r);
  },
});
debuff(FROST, {
  state: ['ROOT', 'DISARM'],
  ...ticker((m) => m.v('tick_interval'), (m) => { const t = m.parent; mhit(m, t, m.v('damage_per_second') * m.v('tick_interval') * (!t.heroLike && !t.def.ancient ? m.v('creep_multiplier') : 1), MAGICAL); }),
});
defAbility('crystal_maiden_frostbite', {
  fid: 'full', prio: 65,
  ai: (ab, u, t) => (canTarget(ab, t) && !t.hasModifier(FROST) ? { target: t } : null),
  cast(ab, t) { addMod(ab, t, FROST, ab.v('duration')); },
});

// Arcane Aura: base regen for every ally on the map, proximity_bonus_factor times as much within proximity_bonus_radius (m.x of the buff)
modifier('modifier_crystal_maiden_brilliance_aura_buff', { purge: 'none', stats: (m) => ({ manaRegen: m.v('base_mana_regen') * (m.x || 1) }) });
passive('crystal_maiden_brilliance_aura', {
  fid: 'full', interval: 0.5, thinkNow: true, stats: { manaRegenAmp: 'mana_regen_amp' },
  onThink(m) {
    const u = m.parent; const r = m.v('proximity_bonus_radius'); const near = m.v('proximity_bonus_factor');
    for (const a of u.world.units) {
      if (!a.alive || a.team !== u.team || a.isBuilding) continue;
      const k = u.distTo(a) <= r ? near : 1;
      const b = a.addModifier('modifier_crystal_maiden_brilliance_aura_buff', { caster: u, ability: m.ability, duration: 1 });
      if (b && b.x !== k) { b.x = k; a.dirty = true; }
    }
  },
});

barrier('modifier_crystal_maiden_glacial_guard_barrier', 'physical', { multi: 'independent' });
passive('crystal_maiden_glacial_guard', {
  fid: 'full', note: 'every ability cast adds its own barrier that lasts barrier_duration (the tooltip does not say whether barriers merge)',
  onCast(m, ev) {
    const u = m.parent; const a = ev.ability;
    if (a.isItem || u.world.freeSpells) return;                    // only mana actually spent on her abilities
    const amount = a.manaCost() * m.v('mana_multiplier') / 100;
    if (amount > 0) giveBarrier(m.ability, u, 'modifier_crystal_maiden_glacial_guard_barrier', amount, m.v('barrier_duration'));
  },
});

// Freezing Field: one explosion per think at a random spot of the ring; m.data = seconds each enemy has spent in the field (Scepter)
const FIELD = 'modifier_crystal_maiden_freezing_field';
debuff('modifier_crystal_maiden_freezing_field_slow', { stats: { msPct: 'movespeed_slow', asSlow: 'attack_slow' } });
// [L] measured in Hero Demo (three recordings, 320 explosions, a target 200 away): the explosions are not uniformly random.
// Explosion j (the first one comes one interval after the cast, none at the cast itself) lands in quadrant j mod 4, going
// round Crystal Maiden, and its distance cycles with j mod 3 through the near, middle and far third of
// explosion_min_dist..explosion_max_dist; only the angle inside the quadrant and the distance inside the third are random.
// (Which way the quadrants go round was not measured: counter-clockwise is assumed.)
buff(FIELD, {
  purge: 'none',
  interval: (m) => m.v('AbilityChannelTime') / (m.v('num_explosions') + m.v('shard_bonus_explosion')),
  stats: (m) => (m.v('can_move') > 0 ? { msPct: m.v('shard_self_movement_speed_slow_pct') } : null),
  onCreated(m) { m.data = new Map(); },
  onThink(m) {
    const u = m.parent; const w = u.world; const ab = m.ability;
    if (m.v('can_move') > 0 && (u.cantAct() || u.isSilenced())) { m.remove(); return; }       // Scepter: no channel, but disables still end it
    const j = ++m.x; const lo = m.v('explosion_min_dist'); const third = (m.v('explosion_max_dist') - lo) / 3;
    const a = ((j % 4) - 1 + w.rng.next()) * Math.PI / 2; const dist = lo + third * ((j % 3) + w.rng.next());
    const ex = u.x + Math.cos(a) * dist; const ey = u.y + Math.sin(a) * dist; const er = m.v('explosion_radius');
    const fb = u.findAbility('crystal_maiden_frostbite'); const delay = m.v('frostbite_delay'); const iv = m.interval;
    for (const e of w.inRadius(u.x, u.y, m.v('radius'), u.team, true)) {
      if (e.isBuilding) continue;
      e.addModifier('modifier_crystal_maiden_freezing_field_slow', { caster: u, ability: ab, duration: m.v('slow_duration') });
      const rr = er + e.def.hull; if ((e.x - ex) ** 2 + (e.y - ey) ** 2 <= rr * rr) mhit(m, e, m.v('damage'), MAGICAL);       // the target's collision radius counts, like the engine's area searches (measured)
      if (delay > 0 && fb && fb.level > 0 && e.alive) { const t = (m.data.get(e) || 0) + iv; m.data.set(e, t); if (t >= delay && t - iv < delay) addMod(fb, e, FROST, fb.v('duration')); }
    }
    shatterClones(u, ex, ey, er);
  },
});
defAbility('crystal_maiden_freezing_field', {
  fid: 'approx', note: 'explosions go round the four quadrants and through the near / middle / far third of explosion_min_dist..explosion_max_dist in turn (pattern measured in the live game); the angle inside the quadrant and the distance inside the third are random, so the hits on a given unit cannot match the game one by one. Scepter: Frostbite is applied once per enemy per cast, when its time in the field reaches frostbite_delay', prio: 75, ai: nearAI('radius', -300),
  channel: (ab) => (ab.v('can_move') > 0 ? 0 : ab.v('AbilityChannelTime')),
  cast(ab) { addMod(ab, ab.owner, FIELD, ab.v('AbilityChannelTime')); },
  channelEnd(ab, interrupted) { if (interrupted) ab.owner.removeModifierByName(FIELD); },
});
defAbility('crystal_maiden_freezing_field_stop', {
  fid: 'partial', note: 'manual only (never auto-cast). It ends the field with Scepter (no channel); a channelling unit accepts no orders in this engine, so a channelled Freezing Field cannot be stopped early', manual: true,
  cast(ab) { ab.owner.removeModifierByName(FIELD); },
});

// Crystal Clone: the clone is a stationary unit with clone_health that Frostbites around itself when it dies or times out
modifier(CLONE, {
  purge: 'none', hidden: true,
  onDestroy(m) {
    const c = m.parent; const u = m.caster; const fb = u.findAbility('crystal_maiden_frostbite');
    if (c.alive || !fb || fb.level < 1) return;
    for (const e of u.world.enemiesInRadius(u, c.x, c.y, m.v('frostbite_radius'))) if (!e.isBuilding) addMod(fb, e, FROST, fb.v('duration'));
  },
});
defAbility('crystal_maiden_crystal_clone', {
  fid: 'approx', note: 'the slide is instant; the clone is a stationary unit with clone_health, no armor or magic resistance, that enemies can attack; the AI slides straight away from its target once that target is within the shatter radius', prio: 58,
  ai: (ab, u, t) => {
    if (!t) return null;
    const d = u.distTo(t); if (d > ab.v('frostbite_radius') - 50) return null;
    const k = ab.v('hop_distance') / (d || 1);
    return { x: u.x + (d ? (u.x - t.x) * k : ab.v('hop_distance')), y: u.y + (u.y - t.y) * k };
  },
  cast(ab, t, x, y) {
    const u = ab.owner; const w = u.world; const ox = u.x; const oy = u.y;
    const dx = x - ox; const dy = y - oy; const d = Math.hypot(dx, dy);
    if (d > 1e-6 && !(u.st[ST.ROOT] > 0)) { u.x += dx / d * ab.v('hop_distance'); u.y += dy / d * ab.v('hop_distance'); }
    for (let i = w.projectiles.length - 1; i >= 0; i--) if (w.projectiles[i].target === u) w.projectiles.splice(i, 1);       // disjoints incoming projectiles
    const c = summon(ab, 'npc_dota_thinker', { x: ox, y: oy, duration: ab.v('clone_duration'), ai: 'idle', ovr: { hp: ab.v('clone_health') } });
    c.addModifier(CLONE, { caster: u, ability: ab });
  },
});
