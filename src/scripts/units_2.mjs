// Unit abilities, part 2: neutral creeps, lane creeps, Roshan, Tormentor, summons, event units and map objects.
// Numbers are always read from the data (ab.v / m.v); behaviour follows the 7.42 tooltips. Where a tooltip is silent, a rule quoted
// from the patch notes shipped with the game is used; it is marked [P x.yz] next to the constant and named in the ability's `note`.
import { defAbility, modifier, buff, debuff, passive, neg, hit, addMod, stun, silence, root, healUnit, enemiesNear, enemiesInLine, lineFromCaster,
  knockback, mhit, aura, zone, barrier, giveBarrier, summon, ST, C, PHYSICAL, MAGICAL, PURE,
  F_ATTACK, F_NO_AMP, F_REFLECT, F_HP_LOSS, F_NO_LIFESTEAL, F_SECONDARY } from '../engine/dsl.mjs';

const na = (name, note) => defAbility(name, { fid: 'n/a', note });
const todo = (name, note) => defAbility(name, { fid: 'partial', note });
const minutes = (w) => Math.floor((w.gameTime || 0) / 60);
// [L] Roshan's abilities count the minute that has begun on the running match clock (Throw at 23:23: 200 + 0.5% x 5620 x 24 = 874.4)
const roshMinutes = (w) => Math.ceil(((w.gameTime || 0) + w.time) / 60);
const SELF = Object.freeze({});

// ---------------------------------------------------------------- neutral ability levels
// [P 7.33] "All neutral creeps now have 4 levels of certain abilities. Abilities are upgraded to level 2 at minute 15 and level 3 at
// minute 30" (level 4 only through Chen's Shard / Helm of the Overlord). The data keeps MaxLevel 1, so the level is raised here for
// every jungle creep (they all carry neutral_upgrade) and for a hero that holds a creep ability ([P 7.35] Devour: "Neutral abilities
// now level up automatically at the time when neutral abilities would scale"). Applies to the abilities of this file only.
const LEVEL_UP_AT = [15 * 60, 30 * 60];
function creepLevel(ab) {
  const u = ab.owner;
  if (ab.level < 1 || !(u.isHero || u.findAbility('neutral_upgrade'))) return;
  const t = u.world.gameTime || 0;
  const L = 1 + (t >= LEVEL_UP_AT[0] ? 1 : 0) + (t >= LEVEL_UP_AT[1] ? 1 : 0);
  if (ab.maxLevel < 4) ab.maxLevel = 4;
  if (ab.level < L) { ab.level = L; ab.refresh(); }
}
// wraps a modifier definition so that creating it also syncs the ability level
const lv = (def = {}) => ({ ...def, onCreated(m, o) { if (m.ability) creepLevel(m.ability); if (def.onCreated) def.onCreated(m, o); } });
// active creep ability: the script plus a hidden intrinsic modifier `modifier_<name>` that keeps the level in sync
function act(name, script, keeper = {}) {
  modifier('modifier_' + name, lv({ hidden: true, ...keeper }));
  return defAbility(name, { ...script, mods: ['modifier_' + name] });
}
// aura ability: the owner keeps `modifier_<name>_buff` / `_debuff` on the units in `radius`
function auraAb(name, o) {
  const enemy = o.team === 'enemy';
  const child = 'modifier_' + name + (enemy ? '_debuff' : '_buff');
  modifier(child, { purge: 'none', debuff: enemy, statusResist: false, multi: o.stack ? 'perCaster' : 'refresh', ...o.child });
  aura('modifier_' + name, { radius: o.radius || 'radius', team: enemy ? 'enemy' : 'ally', child, filter: o.filter, extra: lv() });
  return defAbility(name, { mods: ['modifier_' + name], fid: o.fid || 'full', note: o.note });
}

// ---------------------------------------------------------------- neutral cast behaviour
// 7.42 data: a neutral makes one cast attempt per `neutral_cast_attempt_cooldown`; an attempt succeeds with `neutral_chance_to_cast` %.
// (abilities without these values are cast whenever they are ready)
// A creep acts "as a neutral" unless a hero controls it: persuaded / dominated creeps have a hero owner, devoured abilities sit on the
// hero itself. The neutral-only rules below (cast chance, health thresholds, enemy counts) are skipped for those.
// A unit without a controller or with the 'idle' one only follows orders, like a player-controlled unit, and does not run the neutral AI:
// [L] measured in Hero Demo: a spawned Ancient Prowler Shaman with autocast on petrified at full health (threshold 90 %).
const wild = (u) => !u.isHero && !(u.owner && u.owner.isHero) && !!u.ai && u.ai.mode !== 'idle';
function attempt(ab) {
  if (!wild(ab.owner)) return true;
  const w = ab.owner.world; const d = (ab.data ||= {});
  if (w.time + 1e-9 < (d.nextTry || 0)) return false;
  d.nextTry = w.time + ab.v('neutral_cast_attempt_cooldown');
  const ch = ab.v('neutral_chance_to_cast', 100);
  return ch >= 100 || w.rng.chance(ch / 100);
}
const neutralAI = (pick) => (ab, u, t, w) => { const r = pick(ab, u, t, w); return r && attempt(ab) ? r : null; };
const immune = (ab, t) => t.st[ST.IMMUNE] > 0 && !ab.pierces;
const foe = (ab, t) => (t && t.alive && !immune(ab, t) ? { target: t } : null);
const onFoe = (ab, u, t) => (t && !t.isBuilding ? foe(ab, t) : null);
const atFoe = (ab, u, t) => (t && !t.isBuilding ? { x: t.x, y: t.y } : null);
const near = (ab, u, t, key) => !!t && !t.isBuilding && u.distTo(t) <= ab.v(key);
const nearSelf = (key) => (ab, u, t) => (near(ab, u, t, key) ? SELF : null);
const foes = (ab, x, y, r) => enemiesNear(ab, x, y, r).filter((e) => !e.isBuilding);
// `health_threshold_pct`: neutrals use the ability only while their own health is below it (100 disables the rule)
const below = (ab, u) => { const p = ab.v('health_threshold_pct', 100); return !wild(u) || p >= 100 || (u.hp / u.maxHp) * 100 < p; };
// scenario option skillshotHit (< 1): chance that a delayed / travelling area effect connects at all
const dodged = (ab) => { const w = ab.owner.world; return w.skillshotHit < 1 && !w.rng.chance(w.skillshotHit); };
// AoE disables of ancient / flooded camps need several enemies nearby. [P 7.38] "Desecrate: Number of enemy units in range required to
// trigger a cast increased from 1 to 3"; frog tentacles: "if there are three or more enemies within ... (2x the ability's cast range)"
const MIN_ENEMIES = 3;
const crowd = (u, n) => n >= (wild(u) ? MIN_ENEMIES : 1);
// last periodic tick of a damage-over-time effect must fire before the modifier expires
const TICK_PAD = 0.05;

function clampPoint(u, x, y, max) {
  const dx = x - u.x; const dy = y - u.y; const d = Math.hypot(dx, dy);
  return d <= max || d < 1e-6 ? { x, y } : { x: u.x + (dx / d) * max, y: u.y + (dy / d) * max };
}
// enemies caught by a wave travelling from (x1,y1) to (x2,y2) whose radius changes from r0 to r1: [[enemy, 0..1 position along the path]]
function waveHits(ab, x1, y1, x2, y2, r0, r1) {
  const u = ab.owner; const out = []; const vx = x2 - x1; const vy = y2 - y1; const len2 = vx * vx + vy * vy || 1;
  for (const e of u.world.units) {
    if (!e.alive || e.team === u.team || e.isBuilding || e.st[ST.OUT] > 0) continue;
    let k = ((e.x - x1) * vx + (e.y - y1) * vy) / len2; k = k < 0 ? 0 : k > 1 ? 1 : k;
    if (Math.hypot(x1 + vx * k - e.x, y1 + vy * k - e.y) <= r0 + (r1 - r0) * k + e.def.hull) out.push([e, k]);
  }
  return out;
}
// wave from the caster towards (x, y) with fixed `length`; fn(e) runs when the front reaches the enemy
function wave(ab, x, y, length, r0, r1, speed, fn) {
  const u = ab.owner; const w = u.world; let dx = x - u.x; let dy = y - u.y; const d = Math.hypot(dx, dy);
  if (d < 1e-6) { dx = 1; dy = 0; } else { dx /= d; dy /= d; }
  for (const [e, k] of waveHits(ab, u.x, u.y, u.x + dx * length, u.y + dy * length, r0, r1)) w.after((k * length) / speed, () => { if (e.alive) fn(e); });
}
// summoned unit gets the health and (average) attack damage stated by the ability; the unit's own damage spread is kept
function fit(s, hp, dmg) {
  const half = (s.def.dmgMax - s.def.dmgMin) / 2;
  s.ovr = { ...(s.ovr || {}), hp, dmgMin: dmg - half, dmgMax: dmg + half };
  s.recompute(); s.hp = s.maxHp;
  return s;
}
// bounce from unit to unit: fn(unit, index) for up to `count` different units, each time the nearest valid one within `range` of the previous
function bounce(ab, first, count, range, delay, ok, fn) {
  const w = ab.owner.world; const seen = new Set(); let cur = first; let i = 0;
  const step = () => {
    if (!cur || i >= count) return;
    seen.add(cur);
    if (cur.alive) fn(cur, i);
    i++;
    let best = null; let bd = range;
    for (const e of w.units) {
      if (!e.alive || seen.has(e) || e.isBuilding || e.st[ST.OUT] > 0 || e.st[ST.INVULN] > 0 || !ok(e)) continue;
      const d = cur.distTo(e);
      if (d <= bd) { bd = d; best = e; }
    }
    cur = best;
    if (cur && i < count) { if (delay > 0) w.after(delay, step); else step(); }
  };
  step();
}
const ring = (u, i, n, r) => { const a = (i / n) * 2 * Math.PI; return { x: u.x + r * Math.cos(a), y: u.y + r * Math.sin(a) }; };
const SPAWN_RING = 80; // summoned units appear this far around the caster (placement only)

// ================================================================ neutral auras
auraAb('ancient_rock_golem_weakening_aura', { team: 'enemy', child: { stats: { armor: neg('armor_reduction') } } });
auraAb('big_thunder_lizard_wardrums_aura', { child: { stats: { as: 'speed_bonus' }, onAttack(m, rec) { if (m.roll(m.v('accuracy'))) rec.trueStrike = true; } } });
auraAb('black_dragon_dragonhide_aura', { stack: true, child: { stats: { armor: 'bonus_armor' } } });
auraAb('black_drake_magic_amplification_aura', { team: 'enemy', child: { postMit(m, d) { if (!(d.flags & (F_ATTACK | F_REFLECT))) d.amount *= 1 + m.v('spell_amp') / 100; } } });
auraAb('eimermole_miners_aura', { team: 'enemy', child: { stats: { restore: neg('restoration_reduction') } } });
auraAb('forest_troll_high_priest_heal_amp_aura', { child: { stats: { healAmp: 'heal_amp' } } });
auraAb('forest_troll_high_priest_mana_aura', { child: { stats: { manaRegen: 'mana_regen' } } });
auraAb('frostbitten_golem_time_warp_aura', { child: { stats: { cdr: 'bonus_cdr' } } });
auraAb('granite_golem_hp_aura', { child: { stats: { hpPct: 'bonus_hp' } } });
auraAb('hill_troll_rally', { stack: true, child: { stats: { dmg: 'damage_bonus' } } });
auraAb('kobold_taskmaster_speed_aura', { child: { stats: { msPct: 'bonus_movement_speed' } } });
auraAb('mudgolem_cloak_aura', { child: { stats: (m) => ({ mr: m.parent.isHero ? m.v('bonus_magical_armor') : m.v('bonus_magical_armor_creeps') }) } });
auraAb('ogre_seal_pup_disapproval_aura', { team: 'enemy', child: { stats: { msPct: neg('movespeed_slow') } } });
auraAb('satyr_hellcaller_unholy_aura', { child: { stats: { hpRegen: 'health_regen' } } });
auraAb('spawnlord_aura', { child: { stats: { lifesteal: 'lifesteal', hpRegen: 'hp_regen' } } });
auraAb('frogmen_riverborn_aura', { fid: 'approx', note: 'works only while the frog stands in water; there are no rivers here, so the frog is assumed to be in water (always on)',
  child: { stats: { msPct: 'bonus_movement_speed' }, outgoing(m, d) { if (!(d.flags & F_REFLECT)) d.amount *= 1 + m.v('bonus_outgoing_damage') / 100; } } });
// tooltip note: "Magic resistance bonus upgrades by x% every 7.5 minutes, up to a maximum of n upgrades"
const FLAG_UPGRADE_TIME = 7.5 * 60;
auraAb('flagbearer_creep_aura_effect', { filter: (t) => !t.isHero && !t.isBuilding, note: 'bonus gold / experience are economy and not modelled',
  child: { stats: (m) => ({ hpRegen: m.v('bonus_health_regen'), mr: m.v('bonus_magic_resistance_per_interval') * Math.min(m.v('maximum_intervals'), Math.floor((m.parent.world.gameTime || 0) / FLAG_UPGRADE_TIME)) }) } });
na('kobold_tunneler_prospecting', 'gold per minute aura (economy)');

// ================================================================ neutral passives
passive('black_dragon_splash_attack', lv({ fid: 'full',
  onAttackLanded(m, rec) {
    const u = m.parent; const t = rec.target;
    if (rec.damage <= 0) return;
    for (const e of u.world.enemiesInRadius(u, t.x, t.y, m.v('range'))) if (e !== t && !e.isBuilding) u.world.damage(u, e, (rec.damage * m.v('damage_percent')) / 100, PHYSICAL, F_ATTACK | F_SECONDARY, m.ability);
  } }));
debuff('modifier_odobenus_blight_debuff', { stats: { armor: neg('armor_reduction') } });
passive('odobenus_blight', lv({ fid: 'full', onAttackLanded(m, rec) { const t = rec.target; if (t.alive) t.addModifier('modifier_odobenus_blight_debuff', { caster: m.parent, ability: m.ability, duration: m.v('armor_reduction_duration') }); } }));
// Death Throes: buff for the allies around the dying Hellbear
function deathThroe(name, child, stats) {
  buff(child, { stats });
  passive(name, lv({ fid: 'full',
    onDeath(m) {
      const u = m.parent; const ab = m.ability; const w = u.world;
      w.after(0, () => { if (u.alive) return; for (const a of w.inRadius(u.x, u.y, ab.v('radius'), u.team, false)) if (a !== u && !a.isBuilding) a.addModifier(child, { caster: u, ability: ab, duration: ab.v('duration') }); });
    } }));
}
deathThroe('furbolg_enrage_attack_speed', 'modifier_furbolg_enrage_attack_speed_buff', { as: 'bonus_aspd' });
deathThroe('furbolg_enrage_damage', 'modifier_furbolg_enrage_damage_buff', { dmgBasePct: 'bonus_dmg_pct' });
passive('mud_golem_rock_destroy', lv({ fid: 'full', note: 'the values radius / duration / movespeed of this ability are not explained by the tooltip and are unused',
  onDeath(m) {
    const u = m.parent; const ab = m.ability; const w = u.world;
    w.after(0, () => {
      if (u.alive) return;
      const n = ab.v('shard_amount');
      for (let i = 0; i < n; i++) fit(w.summon(u, 'npc_dota_neutral_mud_golem_split', { ...ring(u, i, n, SPAWN_RING), duration: ab.v('shard_duration') }), ab.v('shard_health'), ab.v('shard_damage'));
    });
  } }));
// [L] measured in Hero Demo (gold kobold tunneler): health 325 -> 975 and attack damage 22.5 -> 66 at once, i.e. +hp_pct / +damage_pct
// percent (200 = triple); the damage of neutral_upgrade stacks is multiplied too (14 stacks: (22.5 + 42) x 3 = 193.5 per attack).
passive('neutral_gold_upgrade_ability', { fid: 'approx', note: 'no tooltip: +hp_pct % health and +damage_pct % attack damage (base damage and the neutral_upgrade damage), measured; the bounty values are economy',
  stats: (m) => ({ hpPct: m.v('hp_pct'), dmgBasePct: m.v('damage_pct') }),
  late(m, s, u) { const up = u.findModifier('modifier_neutral_upgrade'); if (up) s.dmg = (s.dmg || 0) + up.v('increase_damage') * up.stacks * m.v('damage_pct') / 100; } });
// Petrify: autocast attack modifier of the Ancient Prowler Shaman
// [L] measured in Hero Demo: the petrified target is rooted and disarmed (1.23 s at level 1), 10 physical damage per 0.1 s
debuff('modifier_spawnlord_master_freeze_root', { state: ['ROOT', 'DISARM'], interval: (m) => m.v('tick_interval'), thinkNow: true, onThink(m) { mhit(m, m.parent, m.v('damage') * m.v('tick_interval'), PHYSICAL); } });
act('spawnlord_master_freeze', { fid: 'full', note: 'autocast is assumed on; a neutral Shaman only arms it while below health_threshold_pct at the start of the attack' }, {
  onAttackStart(m) { m.x = m.ability.cdReady() && below(m.ability, m.parent) ? 1 : 0; },
  onAttack(m, rec) { if (!m.x || rec.target.isBuilding || !m.ability.cdReady()) return; m.x = 0; m.ability.startCooldown(); (rec.data ||= {}).petrify = m; },
  onAttackLanded(m, rec) { if (rec.data && rec.data.petrify === m && rec.target.alive) rec.target.addModifier('modifier_spawnlord_master_freeze_root', { caster: m.parent, ability: m.ability, duration: m.v('duration') }); },
});

// ================================================================ neutral actives
buff('modifier_big_thunder_lizard_frenzy_buff', { stats: { as: 'attackspeed_bonus' } });
act('big_thunder_lizard_frenzy', { fid: 'full', prio: 50, note: 'AI: cast on the ally (itself included) with the highest attack damage in cast range',
  ai: neutralAI((ab, u, t, w) => {
    if (!t) return null;
    let best = null; let bd = 0;
    for (const a of w.alliesInRadius(u, u.x, u.y, ab.castRange())) {
      if (a.isBuilding || !a.canAttack || a.hasModifier('modifier_big_thunder_lizard_frenzy_buff')) continue;
      const d = (a.dmgMin + a.dmgMax) / 2 + a.dmgBonus;
      if (d > bd) { bd = d; best = a; }
    }
    return best ? { target: best } : null;
  }),
  cast(ab, t) { addMod(ab, t || ab.owner, 'modifier_big_thunder_lizard_frenzy_buff', ab.v('duration')); } });

// Searing Swoop: the dragon flies a loop and drops fire patches along it
debuff('modifier_black_dragon_fireball_burn', { purge: 'none', statusResist: false, interval: (m) => m.v('burn_interval'), thinkNow: true, onThink(m) { mhit(m, m.parent, m.v('damage') * m.v('burn_interval'), MAGICAL); } });
// The loop is a teardrop curve: it leaves the dragon at an angle towards the target, is dive_width wide, turns dive_length away and
// comes back to the start. Along = (L/2)(1 - cos t), across = (W/2) sin t sin(t/2) / max, with max = 4 / (3 sqrt 3) so the width is exact.
const TEARDROP_NORM = (3 * Math.sqrt(3)) / 4;
function swoopPatches(ab, x, y) {
  const u = ab.owner; let dx = x - u.x; let dy = y - u.y; const d = Math.hypot(dx, dy);
  if (d < 1e-6) { dx = 1; dy = 0; } else { dx /= d; dy /= d; }
  const a = ab.v('dive_length') / 2; const b = (ab.v('dive_width') / 2) * TEARDROP_NORM;
  const pts = []; const N = 360; const gap = ab.v('fireball_spacing');
  let s = 0; let px = u.x; let py = u.y; let next = ab.v('fireball_forward_offset');
  for (let i = 1; i <= N; i++) {
    const th = (i / N) * 2 * Math.PI; const along = a * (1 - Math.cos(th)); const across = b * Math.sin(th) * Math.sin(th / 2);
    const qx = u.x + dx * along - dy * across; const qy = u.y + dy * along + dx * across;
    s += Math.hypot(qx - px, qy - py); px = qx; py = qy;
    while (gap > 0 && s >= next) { pts.push({ x: qx, y: qy, s: next, t: 0 }); next += gap; }
  }
  for (const p of pts) p.t = (ab.v('dive_duration') * p.s) / (s || 1);
  return pts;
}
act('black_dragon_fireball', { fid: 'approx', prio: 45, channel: (ab) => ab.v('dive_duration'),
  note: 'the flight loop is approximated by a teardrop curve (dive_length long, dive_width wide) that starts and ends at the dragon, with a fire patch every fireball_spacing; the dragon itself stays in place and cannot act for dive_duration',
  ai: neutralAI((ab, u, t) => (t && !t.isBuilding && u.distTo(t) <= ab.castRange() ? { x: t.x, y: t.y } : null)),
  cast(ab, t, x, y) {
    const u = ab.owner; const w = u.world; const run = { t0: w.time, stop: Infinity }; (ab.data ||= {}).run = run;
    const pts = swoopPatches(ab, x, y); const iv = ab.v('burn_interval'); const dur = ab.v('duration'); const r = ab.v('radius');
    const n = Math.ceil((ab.v('dive_duration') + dur) / iv);
    for (let i = 0; i <= n; i++) {
      w.after(i * iv, () => {
        const now = w.time - run.t0; const inside = new Set();
        for (const p of pts) {
          if (p.t > now + 1e-6 || now >= p.t + dur || p.t > run.stop) continue;
          for (const e of w.enemiesInRadius(u, p.x, p.y, r)) if (!e.isBuilding) inside.add(e);
        }
        for (const e of inside) e.addModifier('modifier_black_dragon_fireball_burn', { caster: u, ability: ab, duration: iv - 0.01 });
      });
    }
  },
  channelEnd(ab, interrupted) { if (interrupted && ab.data && ab.data.run) ab.data.run.stop = ab.owner.world.time - ab.data.run.t0; } });

act('centaur_khan_war_stomp', { fid: 'full', prio: 80, ai: neutralAI(nearSelf('radius')),
  cast(ab) { const u = ab.owner; for (const e of foes(ab, u.x, u.y, ab.v('radius'))) { stun(ab, e, e.heroLike ? ab.v('hero_stun_duration') : ab.v('non_hero_stun_duration')); hit(ab, e, ab.v('AbilityDamage'), MAGICAL); } } });

act('dark_troll_warlord_ensnare', { fid: 'full', prio: 75, ai: neutralAI((ab, u, t) => (t && t.st[ST.ROOT] === 0 ? onFoe(ab, u, t) : null)),
  cast(ab, t) { const u = ab.owner; u.world.projectile(u, t, ab.v('net_speed'), (tt) => root(ab, tt, ab.v('duration'))); } });

const RAISE_DEAD_HP = 0.5; // [P 7.33] "Now only casts Raise Dead when below 50% health"
act('dark_troll_warlord_raise_dead', { fid: 'full', prio: 60, note: 'AI: only cast below 50% health (neutral rule from the 7.33 patch notes)',
  ai: neutralAI((ab, u, t) => (t && (!wild(u) || u.hp / u.maxHp < RAISE_DEAD_HP) ? SELF : null)),
  cast(ab) {
    const u = ab.owner; const n = ab.v('skeletons_created');
    for (let i = 0; i < n; i++) fit(summon(ab, 'npc_dota_dark_troll_warlord_skeleton_warrior', { ...ring(u, i, n, SPAWN_RING), duration: ab.v('duration') }), ab.v('skeletons_health'), ab.v('skeletons_damage'));
  } });

debuff('modifier_eimermole_miners_slam_slow', { purge: 'strong', stats: { msPct: neg('slow_pct') } });
act('eimermole_miners_slam', { fid: 'approx', prio: 60, note: 'the hammered area is centred on the targeted point, at most one radius away from the caster ("in front of him": facing is not modelled)',
  ai: neutralAI((ab, u, t) => (near(ab, u, t, 'radius') ? { x: t.x, y: t.y } : null)),
  cast(ab, t, x, y) {
    const u = ab.owner; const w = u.world; const p = clampPoint(u, x, y, ab.v('radius'));
    if (dodged(ab)) return;
    const pulse = () => { if (u.alive) for (const e of foes(ab, p.x, p.y, ab.v('radius'))) { addMod(ab, e, 'modifier_eimermole_miners_slam_slow', ab.v('slow_duration')); hit(ab, e, ab.v('damage'), MAGICAL); } };
    pulse();
    for (let i = 1; i < ab.v('pulse_count'); i++) w.after(i * ab.v('pulse_interval'), pulse);
  } });

act('enraged_wildkin_hurricane', { fid: 'approx', prio: 40,
  note: 'instant push (no travel time in the data), away from the caster or from the ally the target is chasing; AI: neutral rule from the 7.31 patch notes (pushes an enemy hero that is chasing an allied hero)',
  ai: neutralAI((ab, u, t, w) => {
    if (!t) return null;
    for (const e of w.enemiesInRadius(u, u.x, u.y, ab.castRange())) {
      const v = e.orderTarget;
      if (e.isHero && !immune(ab, e) && v && v.alive && v.isHero && v.team === u.team && e.rangeTo(v) > e.attackRange) return { target: e };
    }
    return null;
  }),
  cast(ab, t) {
    const u = ab.owner; const v = t.orderTarget;
    const from = t.team !== u.team && v && v.alive && v.team === u.team ? v : u;
    if (from !== t) knockback(t, from.x, from.y, ab.v('distance'));
  } });

// Tornado: an invulnerable summon that lives while the Wildwing channels and lingers afterwards
const TORNADO_STEER = 0.1; // steering step of the tornado (structural)
modifier('modifier_enraged_wildkin_tornado_link', { hidden: true, purge: 'none', interval: TORNADO_STEER,
  onThink(m) {
    const s = m.parent; const c = m.caster; const w = s.world;
    if (!m.z && (!c.alive || c.channelAb !== m.ability)) { m.z = 1; m.setDuration(m.v('linger_duration')); }
    const e = w.nearestEnemy(s);
    if (!e) return;
    const d = s.distTo(e); const step = Math.min(d, s.ms * TORNADO_STEER);
    if (d > 1) { s.x += ((e.x - s.x) / d) * step; s.y += ((e.y - s.y) / d) * step; }
  },
  onDestroy(m) { const s = m.parent; if (s.alive) s.world.kill(s, null, null); } });
act('enraged_wildkin_tornado', { fid: 'approx', prio: 45, channel: true,
  note: 'the tornado is steered automatically towards the nearest enemy (player-controlled in game)',
  ai: neutralAI(atFoe),
  cast(ab, t, x, y) {
    const u = ab.owner;
    const s = summon(ab, 'npc_dota_enraged_wildkin_tornado', { x, y, duration: ab.v('duration'), ovr: { ms: ab.v('tornado_base_movespeed') }, ai: 'idle' });
    s.addModifier('modifier_invulnerable', {});
    s.addModifier('modifier_enraged_wildkin_tornado_link', { caster: u, ability: ab });
  } });
debuff('modifier_tornado_tempest_debuff', { purge: 'none', statusResist: false, stats: { msPct: 'movespeed_slow', asSlow: 'attackspeed_slow' } });
passive('tornado_tempest', { fid: 'approx', note: 'damage is dealt every tick_rate seconds as (damage per second x tick_rate)', interval: (m) => m.v('tick_rate'),
  onThink(m) {
    const u = m.parent; const iv = m.v('tick_rate');
    for (const e of u.world.enemiesInRadius(u, u.x, u.y, m.v('far_radius'))) {
      if (e.isBuilding) continue;
      e.addModifier('modifier_tornado_tempest_debuff', { caster: u, ability: m.ability, duration: iv + 0.1 });
      mhit(m, e, (u.distTo(e) <= m.v('near_radius') ? m.v('near_damage') : m.v('far_damage')) * iv, MAGICAL);
    }
  } });

act('fel_beast_haunt', { fid: 'full', prio: 75, ai: neutralAI((ab, u, t) => (t && !t.isSilenced() ? onFoe(ab, u, t) : null)),
  cast(ab, t) { const u = ab.owner; u.world.projectile(u, t, ab.v('projectile_speed'), (tt) => silence(ab, tt, ab.v('duration'))); } });

act('forest_troll_high_priest_heal', { fid: 'full', prio: 55, note: 'AI: heals the most wounded ally (itself included) in cast range that misses at least the heal amount',
  ai: neutralAI((ab, u, t, w) => {
    if (!t) return null;
    let best = null;
    for (const a of w.alliesInRadius(u, u.x, u.y, ab.castRange())) {
      if (a.isBuilding || a.maxHp - a.hp < ab.v('health')) continue;
      if (!best || a.hp / a.maxHp < best.hp / best.maxHp) best = a;
    }
    return best ? { target: best } : null;
  }),
  cast(ab, t) { healUnit(ab, t || ab.owner, ab.v('health')); } });

// Frog tentacles. [P 7.38] "Neutrals will cast this ability on the closest enemy if there are three or more enemies within ... (2x the
// ability's cast range) radius"; [P 7.41] afterwards the tentacle spells of other frogs "within 1200 range are put on 5s cooldown".
const FROG_SHARED_RANGE = 1200;
const FROG_SPELLS = ['frogmen_arm_of_the_deep', 'frogmen_tendrils_of_the_deep', 'frogmen_congregation_of_the_deep'];
function frogShare(ab) {
  const u = ab.owner; const cd = ab.v('neutral_shared_cooldown');
  if (cd <= 0 || !wild(u)) return;
  for (const a of u.world.alliesInRadius(u, u.x, u.y, FROG_SHARED_RANGE)) {
    if (a === u || !wild(a)) continue;
    for (const n of FROG_SPELLS) { const o = a.findAbility(n); if (o && o.level > 0 && o.cdRemaining() < cd) o.startCooldown(cd); }
  }
}
function tentacles(ab, angles) {
  const u = ab.owner; const w = u.world; const len = ab.v('range'); const seen = new Set();
  frogShare(ab);
  if (dodged(ab)) return;
  for (const a of angles) {
    for (const e of enemiesInLine(ab, u.x, u.y, u.x + Math.cos(a) * len, u.y + Math.sin(a) * len, ab.v('projectile_width'))) {
      if (seen.has(e) || e.isBuilding) continue;
      seen.add(e);
      w.after(Math.max(0, u.distTo(e) - e.def.hull) / ab.v('speed'), () => { if (!e.alive) return; stun(ab, e, ab.v('duration')); hit(ab, e, ab.v('damage'), MAGICAL); });
    }
  }
}
const frogAI = neutralAI((ab, u, t, w) => {
  if (!t) return null;
  const es = w.enemiesInRadius(u, u.x, u.y, 2 * ab.v('range')).filter((e) => !e.isBuilding);
  if (!crowd(u, es.length)) return null;
  let best = es[0];
  for (const e of es) if (u.distTo(e) < u.distTo(best)) best = e;
  return ab.def.behavior.includes('NO_TARGET') ? (u.distTo(best) <= ab.v('range') ? SELF : null) : { x: best.x, y: best.y };
});
const FROG_NOTE = 'enemies in the tentacle line(s) at launch are hit when the wave reaches them; AI: neutral rule from the 7.38 / 7.41 patch notes (needs 3 enemies within twice the range, then other frogs within 1200 get neutral_shared_cooldown)';
act('frogmen_arm_of_the_deep', { fid: 'approx', prio: 80, note: FROG_NOTE, ai: frogAI,
  cast(ab, t, x, y) { const u = ab.owner; tentacles(ab, [Math.atan2(y - u.y, x - u.x)]); } });
act('frogmen_tendrils_of_the_deep', { fid: 'approx', prio: 80, note: 'the cone is three tentacle lines at 0 and +-yaw_offset degrees (the number of lines is not in the data); ' + FROG_NOTE, ai: frogAI,
  cast(ab, t, x, y) { const u = ab.owner; const a = Math.atan2(y - u.y, x - u.x); const yaw = (ab.v('yaw_offset') * Math.PI) / 180; tentacles(ab, [a - yaw, a, a + yaw]); } });
act('frogmen_congregation_of_the_deep', { fid: 'approx', prio: 80, note: 'projectile_count lines evenly around the frog, the first one pointing at the nearest enemy (facing is not modelled); ' + FROG_NOTE, ai: frogAI,
  cast(ab) {
    const u = ab.owner; const e = u.world.nearestEnemy(u); const a0 = e ? Math.atan2(e.y - u.y, e.x - u.x) : 0; const n = ab.v('projectile_count'); const dirs = [];
    for (let i = 0; i < n; i++) dirs.push(a0 + (i / n) * 2 * Math.PI);
    tentacles(ab, dirs);
  } });

// Water Bubbles. [P 7.38] "Neutrals will cast this ability on a random ally that is below 50% health"
const BUBBLE_HP = 0.5;
function bubble(name) {
  const mod = 'modifier_' + name + '_barrier';
  barrier(mod, 'magical', {
    onRefresh(m, o) { if (o && o.data) m.data.left = o.data.left; },
    onDestroy(m) {
      const t = m.parent; const ab = m.ability; const c = m.caster; const pct = ab.v('heal_pct');
      if (pct <= 0 || !t.alive) return;
      const amount = (ab.v('damage_absorb') * pct) / 100; const r = ab.v('radius');
      const list = r > 0 ? t.world.inRadius(t.x, t.y, r, t.team, false) : [t];
      for (const a of list) if (!a.isBuilding) a.heal(amount, c, ab);
    },
  });
  act(name, { fid: 'full', prio: 65, note: 'AI: random ally below 50% health in cast range (neutral rule from the 7.38 patch notes)',
    ai: neutralAI((ab, u, t, w) => {
      if (!t) return null;
      const c = w.alliesInRadius(u, u.x, u.y, ab.castRange()).filter((a) => !a.isBuilding && a.hp / a.maxHp < BUBBLE_HP && a.st[ST.IMMUNE] === 0 && !a.hasModifier(mod));
      return c.length ? { target: c[w.rng.int(0, c.length - 1)] } : null;
    }),
    cast(ab, t) { giveBarrier(ab, t || ab.owner, mod, ab.v('damage_absorb'), ab.v('duration')); } });
}
bubble('frogmen_water_bubble_small');
bubble('frogmen_water_bubble_medium');
bubble('frogmen_water_bubble_large');

debuff('modifier_giant_wolf_intimidate_debuff', { purge: 'strong', stats: { dmgOutPct: neg('damage_reduction') } });
act('giant_wolf_intimidate', { fid: 'full', prio: 50, ai: neutralAI(nearSelf('radius')),
  cast(ab) { const u = ab.owner; for (const e of foes(ab, u.x, u.y, ab.v('radius'))) addMod(ab, e, 'modifier_giant_wolf_intimidate_debuff', ab.v('duration')); } });

// [L] measured in Hero Demo: switching on is instant; the harpy is disarmed and slowed by move_speed_penalty % (280 -> 140) and pays
// 8 mana per second (2 x cost_per_second), the first payment together with the activation cost (200 -> 172 = 20 + 8).
const TAKE_OFF_DRAIN = 2;
const takeOffDrain = (m) => { const u = m.parent; const c = TAKE_OFF_DRAIN * m.v('cost_per_second'); if (u.world.freeSpells) return; if (u.mana < c) { m.ability.toggled = false; u.removeModifierByName('modifier_harpy_scout_take_off'); return; } u.mana -= c; };
modifier('modifier_harpy_scout_take_off', { purge: 'none', state: ['DISARM'], stats: (m) => ({ msPct: -m.v('move_speed_penalty') }), interval: 1,
  onCreated: takeOffDrain, onThink: takeOffDrain });
// [L] the toggle takes effect on the order (AbilityCastPoint 1.5 in the data is not used)
modifier('modifier_harpy_scout_take_off_keeper', { hidden: true, purge: 'none', onCreated(m) { if (m.ability) m.ability.vals.AbilityCastPoint = 0; } });
defAbility('harpy_scout_take_off', { fid: 'approx', manual: true, prio: 10, mods: ['modifier_harpy_scout_take_off_keeper'],
  note: 'toggle: flying (disarmed, slowed, mana per second, measured); flying over terrain has no meaning here, so the controller never switches it on (only scenario orders do)',
  cast(ab) {
    const u = ab.owner;
    // [L] switching on starts no cooldown (the recorded cooldown stays 0 while flying)
    if (!u.hasModifier('modifier_harpy_scout_take_off')) { ab.toggled = true; ab.cdEnd = 0; addMod(ab, u, 'modifier_harpy_scout_take_off'); return; }
    u.removeModifierByName('modifier_harpy_scout_take_off'); ab.toggled = false;
  } });

act('harpy_storm_chain_lightning', { fid: 'full', prio: 55, ai: neutralAI(onFoe),
  cast(ab, t) {
    const u = ab.owner; const keep = 1 - ab.v('damage_percent_loss') / 100;
    bounce(ab, t, ab.v('max_targets'), ab.v('jump_range'), ab.v('jump_delay'), (e) => e.team !== u.team && !immune(ab, e), (e, i) => hit(ab, e, ab.v('initial_damage') * Math.pow(keep, i), MAGICAL));
  } });

// [L] measured in Hero Demo: burn_damage is per second, dealt in 0.5 s ticks of half the value (18.75 on the dummy), first tick on application
const BOMB_TICK = 0.5;
debuff('modifier_ice_shaman_incendiary_bomb_debuff', { interval: BOMB_TICK, thinkNow: true, onThink(m) { const t = m.parent; mhit(m, t, m.v('burn_damage') * BOMB_TICK * (t.isBuilding ? m.v('building_damage_pct') / 100 : 1), MAGICAL); } });
act('ice_shaman_incendiary_bomb', { fid: 'approx', prio: 50, note: 'the thrown flame has no speed in the data: the burn starts when the cast finishes (burn_damage per second in 0.5 s ticks, measured)',
  ai: neutralAI((ab, u, t) => (t && below(ab, u) && !t.hasModifier('modifier_ice_shaman_incendiary_bomb_debuff') ? foe(ab, t) : null)),
  cast(ab, t) { addMod(ab, t, 'modifier_ice_shaman_incendiary_bomb_debuff', ab.v('duration')); } });

act('kobold_disarm', { fid: 'approx', prio: 70, note: 'line of 2 x radius width up to the cast range; enemies in the line at launch are hit when the projection reaches them',
  ai: neutralAI(atFoe),
  cast(ab, t, x, y) {
    const u = ab.owner; const w = u.world;
    if (dodged(ab)) return;
    for (const e of lineFromCaster(ab, x, y, ab.v('AbilityCastRange'), 2 * ab.v('radius'))) {
      if (e.isBuilding) continue;
      w.after(u.distTo(e) / ab.v('speed'), () => { if (!e.alive) return; addMod(ab, e, 'modifier_break', ab.v('break_duration')); hit(ab, e, ab.v('base_damage'), MAGICAL); });
    }
  } });

act('mud_golem_hurl_big_boulder', { fid: 'approx', prio: 75, note: 'flight time grows linearly with distance from min_travel_time to max_travel_time (at full cast range); the value "duration" is not explained by the tooltip and is unused',
  ai: neutralAI(atFoe),
  cast(ab, t, x, y) {
    const u = ab.owner; const w = u.world;
    const k = Math.min(1, Math.hypot(x - u.x, y - u.y) / ab.v('AbilityCastRange'));
    w.after(ab.v('min_travel_time') + (ab.v('max_travel_time') - ab.v('min_travel_time')) * k, () => {
      if (dodged(ab)) return;
      for (const e of foes(ab, x, y, ab.v('impact_radius'))) { stun(ab, e, ab.v('stun_duration')); hit(ab, e, ab.v('base_damage'), PHYSICAL); }
    });
  } });

const OGRE_SMASH_HP = 0.7; // [P 7.35c] "Now won't cast Ogre Smash! while above 70% health"
act('ogre_bruiser_ogre_smash', { fid: 'approx', prio: 70, note: 'the area "in front of him" is centred on the targeted point, at most one radius away from the ogre; AI: not cast above 70% health (neutral rule from the 7.35c patch notes)',
  ai: neutralAI((ab, u, t) => (near(ab, u, t, 'radius') && (!wild(u) || u.hp / u.maxHp <= OGRE_SMASH_HP) ? { x: t.x, y: t.y } : null)),
  cast(ab, t, x, y) {
    const p = clampPoint(ab.owner, x, y, ab.v('radius'));
    if (dodged(ab)) return;
    for (const e of foes(ab, p.x, p.y, ab.v('radius'))) { const dmg = ab.v('damage') + (e.hp * ab.v('damage_pct')) / 100; stun(ab, e, ab.v('hero_stun_duration')); hit(ab, e, dmg, MAGICAL); }
  } });

debuff('modifier_ogre_seal_flop_slow', { stats: { msPct: 'slow' } });
const flopTime = (ab) => { const v = ab.v('leap_speed'); const a = ab.v('leap_acceleration'); const d = ab.v('leap_distance'); return a > 0 ? (-v + Math.sqrt(v * v + 2 * a * d)) / a : d / v; };
act('ogre_seal_flop', { fid: 'approx', prio: 65, channel: (ab) => ab.v('max_bounces') * flopTime(ab),
  note: 'flops in a straight line towards the nearest enemy (facing is not modelled); the time of one flop is derived from leap_distance, leap_speed and leap_acceleration',
  ai: neutralAI((ab, u, t) => (t && !t.isBuilding && u.st[ST.ROOT] === 0 && u.distTo(t) <= ab.v('leap_distance') + ab.v('radius') ? SELF : null)),
  cast(ab) {
    const u = ab.owner; const w = u.world; const e = w.nearestEnemy(u); const a = e ? Math.atan2(e.y - u.y, e.x - u.x) : 0;
    const run = { stop: false }; (ab.data ||= {}).run = run;
    for (let i = 1; i <= ab.v('max_bounces'); i++) {
      w.after(i * flopTime(ab), () => {
        if (!u.alive || run.stop) return;
        u.x += Math.cos(a) * ab.v('leap_distance'); u.y += Math.sin(a) * ab.v('leap_distance');
        for (const f of foes(ab, u.x, u.y, ab.v('radius'))) { addMod(ab, f, 'modifier_ogre_seal_flop_slow', ab.v('slow_duration')); hit(ab, f, ab.v('flop_damage'), MAGICAL); }
      });
    }
  },
  channelEnd(ab, interrupted) { if (interrupted && ab.data && ab.data.run) ab.data.run.stop = true; } });

debuff('modifier_polar_furbolg_ursa_warrior_thunder_clap_debuff', { stats: { msPct: 'movespeed_slow', asSlow: 'attackspeed_slow' } });
act('polar_furbolg_ursa_warrior_thunder_clap', { fid: 'full', prio: 60, ai: neutralAI(nearSelf('radius')),
  cast(ab) { const u = ab.owner; for (const e of foes(ab, u.x, u.y, ab.v('radius'))) { addMod(ab, e, 'modifier_polar_furbolg_ursa_warrior_thunder_clap_debuff', ab.v('duration')); hit(ab, e, ab.v('AbilityDamage'), MAGICAL); } } });

debuff('modifier_radigull_eggstremism_silence', { state: ['SILENCE'] });
// The egg has pip health (tooltip_egg_health pips). [P 7.42] "Attacks from heroes, Roshan, towers, and the fountain deal 1 full pip per
// attack", "Attacks from illusions and creeps deal 1/4 pip per attack"; nothing else damages a pip unit.
const PIP_SMALL = 1 / 4;
modifier('modifier_radigull_eggstremism_egg', { hidden: true, purge: 'none',
  postMit(m, d) {
    const a = d.src; const pip = m.parent.maxHp / m.v('tooltip_egg_health', 1);
    if (!a || !(d.flags & F_ATTACK) || (d.flags & F_SECONDARY)) { d.amount = 0; return; }
    d.amount = pip * ((a.isHero && !a.isIllusion) || a.isBuilding || a.name === 'npc_dota_roshan' ? 1 : PIP_SMALL);
  } });
act('radigull_eggstremism', { fid: 'approx', prio: 55, note: 'eggs are spread evenly over egg_spread_angle at egg_distance towards the target; an egg is a real unit with pip health (7.42 patch notes: one attack of a hero, tower or Roshan or four attacks of creeps / illusions destroy it, nothing else damages it)',
  ai: neutralAI((ab, u, t) => (below(ab, u) ? atFoe(ab, u, t) : null)),
  cast(ab, t, x, y) {
    const u = ab.owner; const w = u.world; const a = Math.atan2(y - u.y, x - u.x); const n = ab.v('egg_count'); const spread = (ab.v('egg_spread_angle') * Math.PI) / 180;
    const miss = dodged(ab);
    for (let i = 0; i < n; i++) {
      const b = a + (n > 1 ? (i / (n - 1) - 0.5) * spread : 0);
      const egg = summon(ab, 'npc_dota_radigull_egg', { x: u.x + Math.cos(b) * ab.v('egg_distance'), y: u.y + Math.sin(b) * ab.v('egg_distance'), ai: 'idle' });
      egg.addModifier('modifier_radigull_eggstremism_egg', { caster: u, ability: ab });
      w.after(ab.v('fuse_duration'), () => {
        if (!egg.alive) return;
        if (!miss) for (const e of foes(ab, egg.x, egg.y, ab.v('radius'))) { addMod(ab, e, 'modifier_radigull_eggstremism_silence', ab.v('slow_duration')); hit(ab, e, ab.v('damage'), MAGICAL); }
        w.kill(egg, null, null);
      });
    }
  } });

act('satyr_hellcaller_shockwave', { fid: 'approx', prio: 60, note: 'enemies inside the wave path at launch are hit when the front reaches them',
  ai: neutralAI(atFoe),
  cast(ab, t, x, y) { if (dodged(ab)) return; wave(ab, t ? t.x : x, t ? t.y : y, ab.v('distance'), ab.v('radius_start'), ab.v('radius_end'), ab.v('speed'), (e) => hit(ab, e, ab.v('AbilityDamage'), MAGICAL)); } });

act('satyr_soulstealer_mana_burn', { fid: 'full', prio: 50, ai: neutralAI((ab, u, t) => (t && t.maxMana > 0 && t.mana >= 1 ? onFoe(ab, u, t) : null)),
  cast(ab, t) { const b = t.burnMana(ab.v('burn_amount') + ab.v('int_multiplier') * t.int); if (b > 0) hit(ab, t, b, MAGICAL); } });

// Purge: the slow decays in `purge_rate` equal steps (necronomicon tooltip: "starts at 100% and decreases over time to 20%" with rate 5)
function purgeSlow(name, base) {
  return debuff(name, { interval: (m) => m.v('duration') / m.v('purge_rate'),
    onRefresh(m) { m.setStacks(0); }, onThink(m) { m.setStacks(m.stacks + 1); },
    stats: (m) => { const n = m.v('purge_rate'); return { msPct: (-base(m) * Math.max(0, n - m.stacks)) / n }; } });
}
purgeSlow('modifier_satyr_trickster_purge_slow', (m) => m.v('base_slow'));
act('satyr_trickster_purge', { fid: 'approx', prio: 60,
  note: 'the slow starts at base_slow and decays in purge_rate steps (stated only for the Necronomicon version); summon_damage is dealt to summoned units although the tooltip does not mention it; AI only uses the offensive half',
  ai: neutralAI((ab, u, t) => (t && !t.hasModifier('modifier_satyr_trickster_purge_slow') ? onFoe(ab, u, t) : null)),
  cast(ab, t) {
    const u = ab.owner;
    if (!t || t.team === u.team) { (t || u).purge({ debuffs: true }); return; }
    t.purge({ debuffs: false, buffs: true });
    addMod(ab, t, 'modifier_satyr_trickster_purge_slow', ab.v('duration'));
    if ((t.isSummon && !t.isIllusion) || t.def.summoned) hit(ab, t, ab.v('summon_damage'), MAGICAL);
  } });
const NECRO_PURGE_SLOW = 100; // tooltip note: "The slow starts at 100%"
purgeSlow('modifier_necronomicon_archer_purge_slow', () => NECRO_PURGE_SLOW);
act('necronomicon_archer_purge', { fid: 'approx', prio: 60, note: 'the slow goes from 100% to 20% in purge_rate equal steps',
  ai: neutralAI((ab, u, t) => (t && !t.hasModifier('modifier_necronomicon_archer_purge_slow') ? onFoe(ab, u, t) : null)),
  cast(ab, t) { t.purge({ debuffs: false, buffs: true }); addMod(ab, t, 'modifier_necronomicon_archer_purge_slow', ab.v('duration')); } });
passive('necronomicon_warrior_last_will', { fid: 'full', note: 'ability level = tier of the Necronomicon Warrior unit (warrior_1 / _2 / _3)',
  onCreated(m) {
    const ab = m.ability; const k = Number((/_(\d)$/.exec(m.parent.name) || [])[1]) || 1;
    if (ab.level > 0 && k > ab.level) { if (ab.maxLevel < k) ab.maxLevel = k; ab.level = k; ab.refresh(); }
  },
  onDeath(m, ev) {
    const u = m.parent; const k = ev.killer; const ab = m.ability;
    if (!k || k === u || k.team === u.team) return;
    u.world.after(0, () => { if (!u.alive && k.alive) u.world.damage(u, k, ab.v('explosion'), MAGICAL, 0, ab); });
  } });

debuff('modifier_spawnlord_master_stomp_debuff', {
  late(m, s, u) { const base = (u.ovr && u.ovr.armor !== undefined ? u.ovr.armor : u.def.armor) + C.ARMOR_PER_AGI * u.agi; if (base > 0) s.armor -= (base * m.v('armor_reduction_pct')) / 100; } });
act('spawnlord_master_stomp', { fid: 'full', prio: 60, note: 'AI: needs 3 enemy units in the radius (neutral rule from the 7.38 patch notes)',
  ai: neutralAI((ab, u, t) => (t && crowd(u, foes(ab, u.x, u.y, ab.v('radius')).length) ? SELF : null)),
  cast(ab) { const u = ab.owner; for (const e of foes(ab, u.x, u.y, ab.v('radius'))) { hit(ab, e, ab.v('damage'), PHYSICAL); addMod(ab, e, 'modifier_spawnlord_master_stomp_debuff', ab.v('duration')); } } });

debuff('modifier_warpine_raider_seed_shot_slow', { stats: { msPct: neg('slow') } });
act('warpine_raider_seed_shot', { fid: 'approx', prio: 55,
  note: 'bounces to the nearest unit (ally or enemy, not the caster) in bounce_range; "bounces" is the total number of hits; every unit is hit at most once (the tooltip does not say whether the snowball can return to a unit)',
  ai: neutralAI(onFoe),
  cast(ab, t) {
    const u = ab.owner;
    bounce(ab, t, ab.v('bounces'), ab.v('bounce_range'), ab.v('bounce_delay'), (e) => e !== u && (e.team === u.team || !immune(ab, e)), (e) => {
      if (e.team === u.team) healUnit(ab, e, ab.v('damage'));
      else { addMod(ab, e, 'modifier_warpine_raider_seed_shot_slow', ab.v('duration')); hit(ab, e, ab.v('damage'), MAGICAL); }
    });
  } });

// ================================================================ hero summons
debuff('modifier_forged_spirit_melting_strike_debuff', { multi: 'stack', purge: 'none', maxStacks: (m) => m.v('max_armor_removed'), stats: (m) => ({ armor: -m.v('armor_removed') * m.stacks }) });
passive('forged_spirit_melting_strike', { fid: 'full',
  onAttackLanded(m, rec) { const t = rec.target; if (t.alive && t.heroLike) t.addModifier('modifier_forged_spirit_melting_strike_debuff', { caster: m.parent, ability: m.ability, duration: m.v('duration') }); } });
// talent slot on the Forged Spirit: the engine resolves talent values on the ability owner, so the summoner's talent is copied to the spirit
passive('special_bonus_unique_invoker_forged_spirit_armor_reduction', { fid: 'full', note: 'copies the summoning hero\'s talent to the spirit, so Melting Strike reads the increased armor_removed', interval: 1, thinkNow: true,
  onThink(m) { const u = m.parent; const o = u.owner; const T = m.ability.name; if (o && o.talents.has(T) && !u.talents.has(T)) u.setTalents([...u.talents, T]); } });
na('special_bonus_unique_clinkz_1', 'talent slot copied onto the Skeleton Archer: it changes the duration of Strafe (clinkz_strafe), which the archer does not have');

// Spirit Bear talent slots. Non-hero units have no talent picker here, so every slot starts unlearned; a scenario learns one with
// `stacks: { <talent name>: 1 }` on the bear (a script may also call bear.setTalents([...])).
const learned = (m) => m.stacks > 0 && !m.parent.talents.has(m.ability.name);
const BEAR_NOTE = 'Spirit Bear talent slot: off by default (non-hero units have no talent picker); learn it with scenario stacks { <talent name>: 1 }';
const bearTalent = (name, key) => passive(name, { fid: 'full', note: BEAR_NOTE, stats: (m) => (learned(m) ? { [key]: m.v('value') } : null) });
bearTalent('special_bonus_armor_4', 'armor');
bearTalent('special_bonus_attack_damage_30', 'dmg');
bearTalent('special_bonus_hp_500', 'hp');
bearTalent('special_bonus_magic_resistance_10', 'mr');
bearTalent('special_bonus_movement_speed_15', 'ms');
// unique talents only change values of the bear's Demolish; learning one adds it to the bear's talent set, the engine does the rest
const bearSwitch = (name) => passive(name, { fid: 'full', note: BEAR_NOTE + '; the value change is then applied by the engine to lone_druid_spirit_bear_demolish',
  stats(m) {
    const u = m.parent;
    if (learned(m) && !m.x) { m.x = 1; u.world.after(0, () => { m.x = 0; if (u.alive && m.stacks > 0 && !u.talents.has(name)) u.setTalents([...u.talents, name]); }); }
    return null;
  } });
bearSwitch('special_bonus_unique_lone_druid_spirit_bear_demolish');
bearSwitch('special_bonus_unique_lone_druid_spirit_bear_damage_against_entangled');
na('special_bonus_unique_lone_druid_spirit_bear_return_cd', 'talent slot that only changes Return (teleport to Lone Druid): map movement');

// ================================================================ Roshan
// Roar of Retribution. The health trigger is not in the data: [P 7.35] "Triggers when Roshan's health drops below 80%",
// [P 7.39] "Health Trigger threshold increased from 80% to 85%", "Now gives Roshan a strong dispel on cast", [P 7.40] "Disarm debuff is no longer dispellable".
const ROAR_HP_TRIGGER = 85;
// [L] measured in Hero Demo: Roshan is stunned, rooted and disarmed during the windup; the roar then leaves an aura on him for
// `duration` whose debuff (+damage_pct % damage taken, lingers 0.5 s) is on the enemies before the roar's own damage lands:
// 300 magical on the dummy at 26:10 = (50 + 10 x 27) x 1.25 x 0.75; his attacks then deal 257 x 1.25 = 321.25.
debuff('modifier_roshan_revengeroar', { stats: { dmgTaken: 'damage_pct' } });
aura('modifier_roshan_revengeroar_aura', { radius: 'radius', team: 'enemy', child: 'modifier_roshan_revengeroar' });
modifier('modifier_roshan_revengeroar_windup', { purge: 'none', statusResist: false, state: ['STUN', 'ROOT', 'DISARM'] });
debuff('modifier_roshan_revengeroar_disarm', { state: ['DISARM'], purge: 'none' });
defAbility('roshan_revengeroar', { fid: 'approx', manual: true, prio: 90,
  note: 'only used against the team that killed the previous Roshan: there is no kill history here, so it is cast only when the scenario lists it (ai.order); then it fires below 85% health (trigger, strong dispel on cast and undispellable disarm come from the 7.35-7.40 patch notes); cannot be cast while stunned or silenced as it can in game',
  ai: (ab, u, t) => (near(ab, u, t, 'radius') && (u.hp / u.maxHp) * 100 < ROAR_HP_TRIGGER ? SELF : null),
  cast(ab) {
    const u = ab.owner; const w = u.world;
    u.purge({ debuffs: true, strong: true });
    addMod(ab, u, 'modifier_roshan_revengeroar_windup', ab.v('windup_time'));
    w.after(ab.v('windup_time'), () => {
      u.removeModifierByName('modifier_roshan_revengeroar_windup');
      if (!u.alive) return;
      addMod(ab, u, 'modifier_roshan_revengeroar_aura', ab.v('duration'));
      const dmg = ab.v('damage') + ab.v('damage_growth') * roshMinutes(w);
      for (const e of foes(ab, u.x, u.y, ab.v('radius'))) {
        addMod(ab, e, 'modifier_roshan_revengeroar', 0.5);   // the aura's debuff is on before the damage
        hit(ab, e, dmg, MAGICAL);
        addMod(ab, e, 'modifier_roshan_revengeroar_disarm', ab.v('disarm_duration'));
      }
    });
  } });
// Throw: grab (channel), flight, landing damage + stun. Bonus speed per throw comes from the values of roshan_inherent_buffs.
debuff('modifier_roshan_grab_and_throw_grabbed', { state: ['STUN'], purge: 'none', statusResist: false });
buff('modifier_roshan_grab_and_throw_speed', { purge: 'none', multi: 'stack', stats: (m) => ({ ms: Math.min(m.v('move_pits_max_bonus_speed'), m.v('move_pits_bonus_speed_per_interrupt') * m.stacks) }) });
defAbility('roshan_grab_and_throw', { fid: 'approx', manual: true, prio: 95, channel: (ab) => ab.v('channel_time'),
  note: 'only happens while Roshan walks between his pits: cast only when the scenario lists it (ai.order); the whole run then counts as one trip (throws add damage_per_combo and speed, at most max_interrupt_count throws); the hero is held during the grab and the flight and lands max_knockback_distance away; the values interval / ministun / cast_range are not explained by the tooltip and are unused',
  ai: (ab, u, t) => (t && t.isHero && ((ab.data && ab.data.combo) || 0) < ab.v('max_interrupt_count') ? { target: t } : null),
  cast(ab, t) { (ab.data ||= { combo: 0 }).held = t; addMod(ab, t, 'modifier_roshan_grab_and_throw_grabbed', ab.v('channel_time') + ab.v('knockback_duration')); },
  channelEnd(ab, interrupted) {
    const u = ab.owner; const w = u.world; const d = ab.data; const t = d && d.held;
    if (!t) return;
    d.held = null;
    if (interrupted || !t.alive) { t.removeModifierByName('modifier_roshan_grab_and_throw_grabbed'); return; }
    const combo = d.combo || 0; d.combo = combo + 1;
    const ib = u.findAbility('roshan_inherent_buffs');
    // [L] measured in Hero Demo: a Throw outside a pit move gives Roshan no bonus speed (270 before and after); the move_pits_* speed
    // belongs to the walk between pits, which is not modelled
    void ib;
    let dx = t.x - u.x; let dy = t.y - u.y; const len = Math.hypot(dx, dy);
    if (len < 1e-6) { dx = 1; dy = 0; } else { dx /= len; dy /= len; }
    w.after(ab.v('knockback_duration'), () => {
      if (!t.alive) return;
      t.x += dx * ab.v('max_knockback_distance'); t.y += dy * ab.v('max_knockback_distance');
      t.removeModifierByName('modifier_roshan_grab_and_throw_grabbed');
      stun(ab, t, ab.v('stun_duration'));
      hit(ab, t, ab.v('damage') + ab.v('damage_per_combo') * combo + ((t.hp * ab.v('damage_growth_curr_hp_pct')) / 100) * roshMinutes(w), PURE);
    });
  } });

// ================================================================ Tormentor (npc_dota_miniboss)
// "per interval" growth = per minute of game time: [P 7.38] "Tormentor's abilities now scale with game time", e.g. "Unyielding Shield:
// Damage absorb rescaled ... to 1900 + (20 per minute of game time)", [P 7.41] "The Shining damage now increases by 2 per minute".
const SHIELD_TICK = 0.1; // barrier regeneration step (structural)
const shieldMax = (m) => m.v('damage_absorb') + m.v('absorb_bonus_per_interval') * minutes(m.parent.world);
// reflection: [P 7.42] "15% + 5% per Tormentor death, up to 30%" plus the growth per minute; previous deaths = stacks of the modifier
function reflect(m, d, got) {
  const u = m.parent; const w = u.world; const src = d.src;
  if (got <= 0 || !src || src === u || (d.flags & F_REFLECT)) return;
  const base = m.v('passive_reflection_pct');
  const pct = Math.min(base + m.v('passive_reflection_bonus_per_kill') * m.stacks, Math.max(base, m.v('passive_reflection_max_from_kills'))) + m.v('passive_reflection_bonus_per_interval') * minutes(w);
  const targets = w.inRadius(u.x, u.y, m.v('radius'), u.team, true).filter((e) => e.isHero);
  if (src.alive && src.team !== u.team && !targets.includes(src)) targets.push(src);
  let n = 0;
  for (const e of targets) if (!e.isIllusion) n++;
  const each = (got * pct) / 100 / Math.max(1, n);
  for (const e of targets) w.damage(u, e, each, d.type, F_REFLECT | F_NO_AMP | F_NO_LIFESTEAL, m.ability);
}
function shining(m) { m.x = m.parent.world.time + m.v('attack_timer_duration'); }
function tormentorHit(m, d, got) {
  const u = m.parent;
  const rad = u.findModifier('modifier_miniboss_radiance'); if (rad) shining(rad);
  const ref = u.findModifier('modifier_miniboss_reflect'); if (ref) reflect(ref, d, got);
}
function unyielding(name, o) {
  // [L] measured in Hero Demo: the Tormentor's status resistance reads 0 with the shield on (the value status_resistance is not applied)
  passive(name, { fid: 'approx', note: o.note + '; status_resistance is not applied (measured: 0)', interval: SHIELD_TICK,
    onCreated(m) { m.x = shieldMax(m); },
    onThink(m) { const max = shieldMax(m); if (m.x < max) m.x = Math.min(max, m.x + (m.v('regen_per_second') + m.v('regen_bonus_per_interval') * minutes(m.parent.world)) * SHIELD_TICK); },
    late(m, s, u) { if (!o.armorFloor) return; const base = u.ovr && u.ovr.armor !== undefined ? u.ovr.armor : u.def.armor; if (base + s.armor < 0) s.armor = -base; },
    postMit(m, d) {
      const got = d.amount;
      if (got <= 0 || (d.flags & F_HP_LOSS)) return;
      const a = Math.min(got, m.x); m.x -= a; d.amount -= a;
      if (o.onHit) o.onHit(m, d, got);
    } });
}
unyielding('miniboss_unyielding_shield', { armorFloor: true, onHit: tormentorHit,
  note: 'barrier size and regeneration grow per minute of game time (the interval comes from the 7.38 patch notes); regeneration is applied in 0.1 s steps' });
passive('miniboss_reflect', { fid: 'approx',
  note: 'damage received = damage after the Tormentor\'s armor / magic resistance, reflected instantly with its own damage type and split between the attacker and the enemy heroes in radius (illusions take a share without reducing the others); grows per minute of game time; earlier Tormentor deaths are set with scenario stacks { miniboss_reflect: n } (+passive_reflection_bonus_per_kill each, base + deaths capped at passive_reflection_max_from_kills as in the 7.42 patch notes); the wave values (speed, wave_interval, preview_duration) are not explained by the tooltip and are unused',
  postMit(m, d) { if (!m.parent.hasModifier('modifier_miniboss_unyielding_shield')) reflect(m, d, d.amount); } });
passive('miniboss_radiance', { fid: 'approx', interval: (m) => m.v('aura_interval'),
  note: 'aura_damage per second (+aura_damage_per_upgrade per minute of game time, 7.41 patch notes) to every enemy in aura_radius, in aura_interval steps, for attack_timer_duration after the Tormentor was last damaged; the damage type is not in the data (engine default: magical)',
  postMit(m) { if (!m.parent.hasModifier('modifier_miniboss_unyielding_shield')) shining(m); },
  onThink(m) {
    const u = m.parent; const w = u.world;
    if (w.time > m.x + 1e-6) return;
    const dmg = (m.v('aura_damage') + m.v('aura_damage_per_upgrade') * minutes(w)) * m.v('aura_interval');
    for (const e of w.inRadius(u.x, u.y, m.v('aura_radius'), u.team, true)) if (!e.isBuilding) mhit(m, e, dmg);
  } });
const ALLEVIATION_TICK = 0.5; // how often the dale re-applies its regeneration buff (structural)
buff('modifier_miniboss_alleviation_active', { purge: 'none', stats: { hpRegenPct: 'hp_restoration_pct' } });
passive('miniboss_alleviation', { fid: 'full',
  onDeath(m) {
    const u = m.parent; const ab = m.ability; const w = u.world; const x = u.x; const y = u.y;
    w.after(0, () => {
      if (u.alive) return;
      const n = Math.round(ab.v('aura_duration') / ALLEVIATION_TICK);
      for (let i = 0; i < n; i++) {
        w.after(i * ALLEVIATION_TICK, () => { for (const e of w.units) if (e.alive && !e.isBuilding && Math.hypot(e.x - x, e.y - y) <= ab.v('radius')) e.addModifier('modifier_miniboss_alleviation_active', { ability: ab, duration: ALLEVIATION_TICK + 0.1 }); });
      }
    });
  } });
na('miniboss_inherent_buffs', 'hidden passive without values or tooltip (the game-time scaling is modelled inside the Tormentor\'s other abilities)');
unyielding('miniboss_minion_unyielding_shield', { note: 'no tooltip: modelled like the Tormentor\'s Unyielding Shield, which has the same value names (regenerating all-damage barrier growing per minute of game time)' });
todo('miniboss_minion_deflecting_shield', 'not modelled: no tooltip; the values describe an aura barrier (max_barrier_pct_max_health % of max health, damage_reflection_pct % reflection) but not who receives it or which damage it blocks');
na('miniboss_minion_following_movement', 'movement helper without values');

// ================================================================ lane creeps, buildings, map objects, couriers
todo('filler_ability', 'not modelled: no tooltip; the values describe an area heal of the "healer" buildings (hp_heal / mp_heal plus a % of the maximum per second for duration, in radius, on a long cooldown) but nothing in the data says what triggers it');
na('ability_launchpad', 'map object that launches units across the map (map movement)');
na('ability_lotus_pool', 'map object: Healing Lotus pickup (economy)');
na('ability_stone_of_recall', 'map object: teleport target (map movement)');
na('ability_xp_fountain', 'Shrine of Wisdom: experience pickup (economy)');
todo('ability_scout_bonuses', 'not modelled: no tooltip; the health / armor growth (increase_health, increase_armor up to max_health, max_armor) has no interval in the data, reveal_radius is vision');
na('plus_high_five', 'cosmetic');
na('cny_beast_force_attack', 'event unit order helper (picks the Year Beast\'s attack target); no tooltip');
na('cny_beast_teleport', 'event unit teleport (map movement); no tooltip');
for (const n of ['courier_autodeliver', 'courier_go_to_enemy_secretshop', 'courier_go_to_secretshop', 'courier_go_to_sideshop', 'courier_go_to_sideshop2', 'courier_morph', 'courier_return_stash_items',
  'courier_return_to_base', 'courier_take_stash_and_transfer_items', 'courier_take_stash_items', 'courier_transfer_items', 'courier_transfer_items_to_other_player']) na(n, 'courier order (item delivery / shop / stash)');
na('courier_burst', 'courier ability (speed burst); couriers take no part in combat here');
na('courier_shield', 'courier ability (protective shield); couriers take no part in combat here');

// ================================================================ Greevil minibosses (old Frostivus event units)
// None of these has a tooltip in the game files, so only what the value names state is modelled.
const G = 'no tooltip in the game files: modelled from the value names only';
todo('greevil_miniboss_black_nightmare', 'not modelled: no tooltip, and the values (AbilityDuration vs duration, AbilityDamage, nightmare_invuln_time) do not define the sleep, damage and wake-up rules');
defAbility('greevil_miniboss_black_brain_sap', { fid: 'partial', prio: 55, note: G + ' (AbilityDamage as pure damage); the heal that the name suggests is not in the data and not modelled', ai: onFoe,
  cast(ab, t) { hit(ab, t, ab.v('AbilityDamage'), PURE); } });
debuff('modifier_greevil_miniboss_blue_cold_feet_debuff', { interval: 1, thinkNow: true,
  onCreated(m) { m.x = m.parent.x; m.y = m.parent.y; },
  onThink(m) { mhit(m, m.parent, m.v('damage'), MAGICAL); },
  onDestroy(m, expired) {
    const t = m.parent; const c = m.caster; const ab = m.ability; const x = m.x; const y = m.y;
    if (expired) t.world.after(0, () => { if (t.alive && Math.hypot(t.x - x, t.y - y) <= ab.v('break_distance')) t.addModifier('modifier_stunned', { caster: c, ability: ab, duration: ab.v('stun_duration') }); });
  } });
defAbility('greevil_miniboss_blue_cold_feet', { fid: 'approx', prio: 70, note: G + ': "damage" every second for AbilityDuration, then stun_duration unless the target is more than break_distance from where it was hit',
  ai: (ab, u, t) => (t && !t.hasModifier('modifier_greevil_miniboss_blue_cold_feet_debuff') ? onFoe(ab, u, t) : null),
  cast(ab, t) { addMod(ab, t, 'modifier_greevil_miniboss_blue_cold_feet_debuff', ab.v('AbilityDuration')); } });
const VORTEX_TICK = 0.5; // how often the vortex re-applies its debuff (structural)
debuff('modifier_greevil_miniboss_blue_ice_vortex_debuff', { purge: 'none', statusResist: false, stats: { msPct: 'movement_speed_pct', mr: 'spell_resist_pct' } });
defAbility('greevil_miniboss_blue_ice_vortex', { fid: 'approx', prio: 50, note: G + ' (area for AbilityDuration: movement speed and magic resistance reduction)', ai: atFoe,
  cast(ab, t, x, y) { zone(ab, x, y, { radius: 'radius', duration: 'AbilityDuration', interval: VORTEX_TICK, tick(e) { if (!e.isBuilding) addMod(ab, e, 'modifier_greevil_miniboss_blue_ice_vortex_debuff', 2 * VORTEX_TICK); } }); } });
buff('modifier_greevil_miniboss_green_living_armor_buff', { stats: { hpRegen: 'health_regen' },
  onCreated(m) { m.x = m.v('damage_count'); }, onRefresh(m) { m.x = m.v('damage_count'); },
  preMit(m, d) { if (d.amount <= 0) return; d.amount = Math.max(0, d.amount - m.v('damage_block')); if (--m.x <= 0) m.remove(); } });
defAbility('greevil_miniboss_green_living_armor', { fid: 'approx', prio: 60, note: G + ': health_regen plus damage_block against the next damage_count damage instances of any type',
  ai: (ab, u, t, w) => {
    if (!t) return null;
    let best = null;
    for (const a of w.alliesInRadius(u, u.x, u.y, ab.castRange())) { if (a.isBuilding || a.hasModifier('modifier_greevil_miniboss_green_living_armor_buff')) continue; if (!best || a.hp / a.maxHp < best.hp / best.maxHp) best = a; }
    return best ? { target: best } : null;
  },
  cast(ab, t) { addMod(ab, t || ab.owner, 'modifier_greevil_miniboss_green_living_armor_buff', ab.v('duration')); } });
defAbility('greevil_miniboss_green_overgrowth', { fid: 'approx', prio: 85, note: G + ' (root for duration in radius)', ai: nearSelf('radius'),
  cast(ab) { const u = ab.owner; for (const e of foes(ab, u.x, u.y, ab.v('radius'))) root(ab, e, ab.v('duration')); } });
defAbility('greevil_miniboss_orange_dragon_slave', { fid: 'approx', prio: 55, note: G + ' (line nuke; enemies in the wave path at launch are hit when the front reaches them)', ai: atFoe,
  cast(ab, t, x, y) { if (dodged(ab)) return; wave(ab, t ? t.x : x, t ? t.y : y, ab.v('dragon_slave_distance'), ab.v('dragon_slave_width_initial') / 2, ab.v('dragon_slave_width_end') / 2, ab.v('dragon_slave_speed'), (e) => hit(ab, e, ab.v('AbilityDamage'), MAGICAL)); } });
defAbility('greevil_miniboss_orange_light_strike_array', { fid: 'approx', prio: 75, note: G + ' (delayed area stun and damage)', ai: atFoe,
  cast(ab, t, x, y) {
    ab.owner.world.after(ab.v('light_strike_array_delay_time'), () => {
      if (dodged(ab)) return;
      for (const e of foes(ab, x, y, ab.v('light_strike_array_aoe'))) { stun(ab, e, ab.v('light_strike_array_stun_duration')); hit(ab, e, ab.v('AbilityDamage'), MAGICAL); }
    });
  } });
defAbility('greevil_miniboss_purple_plague_ward', { fid: 'approx', prio: 40, note: G + '; the ward is assumed to be Venomancer\'s Plague Ward unit with ward_hp_tooltip health and ward_damage_tooltip damage', ai: atFoe,
  cast(ab, t, x, y) { fit(summon(ab, 'npc_dota_venomancer_plague_ward', { x, y, duration: ab.v('duration') }), ab.v('ward_hp_tooltip'), ab.v('ward_damage_tooltip')); } });
debuff('modifier_greevil_miniboss_purple_venomous_gale_debuff', { interval: (m) => m.v('tick_interval'), stats: { msPct: 'movement_slow' }, onThink(m) { mhit(m, m.parent, m.v('tick_damage'), MAGICAL); } });
defAbility('greevil_miniboss_purple_venomous_gale', { fid: 'approx', prio: 55, note: G + ': line of 2 x radius width up to the cast range; strike_damage on hit, tick_damage every tick_interval, constant movement_slow for duration', ai: atFoe,
  cast(ab, t, x, y) {
    if (dodged(ab)) return;
    wave(ab, x, y, ab.v('AbilityCastRange'), ab.v('radius'), ab.v('radius'), ab.v('speed'), (e) => { addMod(ab, e, 'modifier_greevil_miniboss_purple_venomous_gale_debuff', ab.v('duration') + TICK_PAD); hit(ab, e, ab.v('strike_damage'), MAGICAL); });
  } });
debuff('modifier_greevil_miniboss_red_earthshock_slow', { stats: { msPct: 'movement_slow' } });
defAbility('greevil_miniboss_red_earthshock', { fid: 'approx', prio: 60, note: G + ' (area damage and movement slow for AbilityDuration)', ai: nearSelf('shock_radius'),
  cast(ab) { const u = ab.owner; for (const e of foes(ab, u.x, u.y, ab.v('shock_radius'))) { addMod(ab, e, 'modifier_greevil_miniboss_red_earthshock_slow', ab.v('AbilityDuration')); hit(ab, e, ab.v('AbilityDamage'), MAGICAL); } } });
buff('modifier_greevil_miniboss_red_overpower_buff', { stats: { as: 'attack_speed_bonus_pct' },
  onCreated(m) { m.x = m.v('max_attacks'); }, onRefresh(m) { m.x = m.v('max_attacks'); },
  onAttack(m, rec) { if (!rec.secondary && --m.x <= 0) m.remove(); } });
defAbility('greevil_miniboss_red_overpower', { fid: 'approx', prio: 65, note: G + ' (attack speed bonus for max_attacks attacks or AbilityDuration)',
  ai: (ab, u, t) => (t && u.rangeTo(t) <= u.attackRange + ab.v('AbilityCastRange') && !u.hasModifier('modifier_greevil_miniboss_red_overpower_buff') ? SELF : null),
  cast(ab) { addMod(ab, ab.owner, 'modifier_greevil_miniboss_red_overpower_buff', ab.v('AbilityDuration')); } });
na('greevil_miniboss_sight', 'vision radius only');
auraAb('greevil_miniboss_white_degen_aura', { team: 'enemy', fid: 'partial', note: G + ': speed_bonus is applied to movement speed; whether attack speed is reduced as well is not stated', child: { stats: { msPct: 'speed_bonus' } } });
defAbility('greevil_miniboss_white_purification', { fid: 'partial', prio: 55, note: G + ' (heal); the pure damage around the target that damage type and radius suggest has no amount in the data and is not modelled',
  ai: (ab, u, t, w) => {
    if (!t) return null;
    let best = null;
    for (const a of w.alliesInRadius(u, u.x, u.y, ab.castRange())) { if (a.isBuilding || a.isHero || a.maxHp - a.hp < ab.v('heal')) continue; if (!best || a.hp / a.maxHp < best.hp / best.maxHp) best = a; }
    return best ? { target: best } : null;
  },
  cast(ab, t) { healUnit(ab, t || ab.owner, ab.v('heal')); } });
const ION_TICK = 0.5; // damage step of the Ion Shell (structural)
buff('modifier_greevil_miniboss_yellow_ion_shell_buff', { interval: ION_TICK,
  onThink(m) { const p = m.parent; const c = m.caster; for (const e of p.world.inRadius(p.x, p.y, m.v('radius'), c.team, true)) if (e !== p && !e.isBuilding) mhit(m, e, m.v('damage_per_second') * ION_TICK, MAGICAL); } });
defAbility('greevil_miniboss_yellow_ion_shell', { fid: 'approx', prio: 60, note: G + ': the carrier burns the caster\'s enemies within radius for damage_per_second; AI casts it on itself',
  ai: (ab, u, t) => (t && !u.hasModifier('modifier_greevil_miniboss_yellow_ion_shell_buff') ? { target: u } : null),
  cast(ab, t) { addMod(ab, t || ab.owner, 'modifier_greevil_miniboss_yellow_ion_shell_buff', ab.v('duration')); } });
todo('greevil_miniboss_yellow_surge', 'not modelled: no tooltip, and the only value is a duration (the speed it grants is not in the data)');

// ================================================================ Diretide Roshan (old event unit, no tooltips)
const H = 'no tooltip in the game files: ';
na('roshan_halloween_angry', 'stat bonuses driven by Diretide event state (the boss getting angry), which does not exist here; no tooltip');
na('roshan_halloween_candy', 'stat bonuses driven by Diretide event state (candy fed to the boss), which does not exist here; no tooltip');
na('roshan_halloween_levels', 'stat bonuses driven by Diretide event state (boss level), which does not exist here; no tooltip');
passive('roshan_halloween_spell_block', { fid: 'approx', note: H + 'modelled like Roshan\'s Spell Block (blocks one targeted spell per cooldown)',
  onSpellTargeted(m, ev) { if (m.ability.cdReady()) { ev.blocked = true; m.ability.startCooldown(); } } });
passive('roshan_halloween_greater_bash', { fid: 'approx', note: H + 'chance_pct on attack (with the ability cooldown) to stun for duration and push the target knockback_distance away; no bonus damage value exists',
  onAttackLanded(m, rec) {
    const t = rec.target; const u = m.parent;
    if (!t.alive || t.isBuilding || !m.ability.cdReady() || !m.roll(m.v('chance_pct'))) return;
    m.ability.startCooldown();
    t.addModifier('modifier_stunned', { caster: u, ability: m.ability, duration: m.v('duration') });
    knockback(t, u.x, u.y, m.v('knockback_distance'));
  } });
buff('modifier_roshan_halloween_shell_buff', { purge: 'none', postMit(m, d) { if (!(d.flags & F_ATTACK)) d.amount *= Math.max(0, 1 + m.v('bonus_spell_damage_pct') / 100); } });
defAbility('roshan_halloween_shell', { fid: 'approx', prio: 85, note: H + 'bonus_spell_damage_pct is read as "spell damage taken" for duration',
  ai: (ab, u, t) => (t && u.hp < u.maxHp && !u.hasModifier('modifier_roshan_halloween_shell_buff') ? SELF : null),
  cast(ab) { addMod(ab, ab.owner, 'modifier_roshan_halloween_shell_buff', ab.v('duration')); } });
defAbility('roshan_halloween_wave_of_force', { fid: 'partial', prio: 60, note: H + 'AbilityDamage to enemies in radius when the wave (speed) reaches them; what duration and mana_burn do is not defined and not modelled (game_end_* are event rules)',
  ai: nearSelf('radius'),
  cast(ab) { const u = ab.owner; const w = u.world; for (const e of foes(ab, u.x, u.y, ab.v('radius'))) w.after(u.distTo(e) / ab.v('speed'), () => { if (e.alive) hit(ab, e, ab.v('AbilityDamage'), MAGICAL); }); } });
todo('roshan_halloween_apocalypse', 'not modelled: ' + H + 'the values (area_of_effect, delay, damage) do not say where the blasts land');
todo('roshan_halloween_burn', 'not modelled: ' + H + 'the values (projectile_count, rotation_angle, damage) do not define the sweep or how often a unit is hit');
todo('roshan_halloween_fireball', 'not modelled: ' + H + 'damage_percent has no stated base and the targets are not defined');
todo('roshan_halloween_summon', 'not modelled: ' + H + 'neither the summoned unit nor its count is in the ability data');
todo('roshan_halloween_toss', 'not modelled: ' + H + 'the values do not say which unit is grabbed and thrown');
