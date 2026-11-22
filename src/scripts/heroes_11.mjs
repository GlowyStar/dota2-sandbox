// Hero abilities, part 11: Brewmaster (+ Primal Split brewlings), Shadow Demon, Puck, Dark Willow, Grimstroke, Mars,
// Primal Beast, Storm Spirit, Windranger, Dazzle, Queen of Pain, Venomancer.
// Every number is read from the shipped data by value name; literals are tick intervals / geometry choices explained in `note`.
import { defAbility, modifier, buff, debuff, passive, nuke, hit, addMod, stun, knockback, mhit, dot, summon, nearAI,
  ST, C, PHYSICAL, MAGICAL, PURE, F_ATTACK, F_NO_AMP, F_REFLECT, F_HP_LOSS, F_NO_LIFESTEAL, F_NON_LETHAL, F_SECONDARY } from '../engine/dsl.mjs';
import { ORDER } from '../engine/core.mjs';

const na = (name, note) => defAbility(name, { fid: 'n/a', note });

// ---------------------------------------------------------------- shared helpers
// unit vector from (ax, ay) to (bx, by) and the distance; +x when the points coincide
const dirTo = (ax, ay, bx, by) => { const dx = bx - ax; const dy = by - ay; const d = Math.sqrt(dx * dx + dy * dy); return d > 1e-6 ? [dx / d, dy / d, d] : [1, 0, 0]; };
const hpFrac = (u) => u.hp / u.maxHp;
// scenario rule `skillshotHit`: one roll per dodgeable cast, no roll at all while the rule is 1
const lands = (w) => w.skillshotHit >= 1 || w.rng.chance(w.skillshotHit);
// average attack damage of a unit (white + green)
const attackDamage = (u) => (u.dmgMin + u.dmgMax) / 2 + u.dmgBonus;
// the unit the default controller of `u` is fighting (null without a controller or target)
const aiTarget = (u) => { const a = u.ai; if (!a) return null; const t = a.fixedTarget && a.fixedTarget.alive ? a.fixedTarget : a.target; return t && t.alive ? t : null; };
// enemies of `u` around a point (its area bonus applied); spells do not affect buildings
const foesOf = (u, x, y, r) => u.world.enemiesInRadius(u, x, y, r).filter((e) => !e.isBuilding);
const foes = (ab, x, y, r) => foesOf(ab.owner, x, y, r);

// Enemies of `u` whose hull touches the segment (x1,y1)-(x2,y2); the radius grows linearly from r1 to r2.
// Returns [distanceAlong, unit] pairs sorted by distance. The shipped "width" values of line spells are used as radii.
function lineEnemies(u, x1, y1, x2, y2, r1, r2 = r1) {
  const out = []; const us = u.world.units; const vx = x2 - x1; const vy = y2 - y1; const len2 = vx * vx + vy * vy || 1; const len = Math.sqrt(len2);
  for (let i = 0; i < us.length; i++) {
    const e = us[i];
    if (!e.alive || e.team === u.team || e.isBuilding || e.st[ST.OUT] > 0) continue;
    let k = ((e.x - x1) * vx + (e.y - y1) * vy) / len2; if (k < 0) k = 0; else if (k > 1) k = 1;
    const px = x1 + vx * k - e.x; const py = y1 + vy * k - e.y; const r = r1 + (r2 - r1) * k + e.def.hull;
    if (px * px + py * py <= r * r) out.push([k * len, e]);
  }
  out.sort((a, b) => a[0] - b[0]);
  return out;
}
// Enemies of `u` inside a cone that starts at (x, y), points along (dx, dy), is `length` long and `halfAngle` (radians) wide.
function coneEnemies(u, x, y, dx, dy, length, halfAngle) {
  const out = []; const cosA = Math.cos(halfAngle);
  for (const e of u.world.inRadius(x, y, length, u.team, true)) {
    const rx = e.x - x; const ry = e.y - y; const d = Math.sqrt(rx * rx + ry * ry);
    if (!e.isBuilding && (d <= e.def.hull || (rx * dx + ry * dy) / d >= cosA)) out.push(e);
  }
  return out;
}
// A linear projectile of `u`: launched at (sx, sy), flies `dist` towards (tx, ty) at `speed`, one step per server tick like the game's.
// o.hit(e, x, y) runs once for every enemy whose hull comes within o.radius of the projectile (the radius may be a function of the
// distance flown); o.end(x, y) when it arrives. [L] measured in Hero Demo (Cinder Brew, Spear of Mars): a unit is hit on the tick the
// projectile centre is within radius + hull of it, the first check being one tick after the launch.
function linearProjectile(u, sx, sy, tx, ty, o) {
  const w = u.world; const [dx, dy, d0] = dirTo(sx, sy, tx, ty); const dist = o.dist ?? d0; const seen = new Set(); let gone = 0; let stop = false;
  const p = { x: sx, y: sy, dx, dy, gone: 0, stop() { stop = true; } };
  const step = () => {
    if (stop) return;
    gone = Math.min(dist, gone + o.speed * w.dt); p.gone = gone; p.x = sx + dx * gone; p.y = sy + dy * gone;
    if (o.hit) {
      const r = typeof o.radius === 'function' ? o.radius(gone) : o.radius; const us = w.units;
      for (let i = 0; i < us.length && !stop; i++) {
        const e = us[i];
        if (!e.alive || e.team === u.team || e.isBuilding || e.st[ST.OUT] > 0 || seen.has(e)) continue;
        const ex = e.x - p.x; const ey = e.y - p.y; const rr = r + e.def.hull;
        if (ex * ex + ey * ey <= rr * rr) { seen.add(e); o.hit(e, p.x, p.y, p); }
      }
    }
    if (stop) return;
    if (gone >= dist - 1e-6) { if (o.end) o.end(p.x, p.y); } else w.after(w.dt, step);
  };
  w.after(w.dt, step);
  return p;
}
// Disjoint: drops every tracking projectile that is flying at `u`. The engine has no disjoint call, so world.projectiles is
// filtered directly. Returns the number of attack projectiles (tower shots are dropped but not counted) and spell projectiles.
function disjoint(u) {
  const ps = u.world.projectiles; let attacks = 0; let spells = 0;
  for (let i = ps.length - 1; i >= 0; i--) {
    const p = ps[i];
    if (p.target !== u) continue;
    if (p.kind !== 0) spells++; else if (!p.rec.attacker.isBuilding) attacks++;
    ps[i] = ps[ps.length - 1]; ps.pop();
  }
  return { attacks, spells };
}
const incoming = (u) => { const ps = u.world.projectiles; let n = 0; for (let i = 0; i < ps.length; i++) if (ps[i].target === u) n++; return n; };
// Evaluate fn with the ability temporarily at another level (Scepter "+1 level" upgrades).
function atLevel(ab, lvl, fn) { const keep = ab.level; if (lvl === keep) return fn(); ab.level = lvl; ab.refresh(); try { return fn(); } finally { ab.level = keep; ab.refresh(); } }
// Some abilities are flagged PASSIVE in the shipped data but gain an active part with Shard. The engine decides castability from
// that flag, so it is refreshed whenever the engine re-syncs the ability (level, upgrade or talent change) through `requires`.
const activeWhen = (test) => (ab) => { const p = !test(ab.owner); if (ab.passive !== p) { ab.passive = p; ab.owner.refreshAI(); } return true; };
// Does `u` carry something a basic dispel removes (debuffs when `debuffs`, otherwise positive buffs)?
function hasDispellable(u, debuffs) {
  const ms = u.mods;
  for (let i = 0; i < ms.length; i++) { const d = ms[i].def; if ((d.purge || (d.debuff ? 'basic' : 'none')) === 'basic' && !!d.debuff === debuffs) return true; }
  return false;
}
// allied hero (self included) with the lowest health fraction below `frac` within `range` of the caster
function woundedAlly(u, range, frac) {
  let best = null; let bf = frac;
  for (const a of u.world.units) { if (!a.alive || a.team !== u.team || !a.isHero || a.isSummon || a.st[ST.OUT] > 0 || u.distTo(a) > range) continue; const f = hpFrac(a); if (f < bf) { bf = f; best = a; } }
  return best;
}

// answer for `ai` functions of no-target abilities: cast right now, whatever the controller's target is
const NOW = Object.freeze({ target: null });
let grimEcho = false;   // true while Grimstroke's Soulbind repeats a spell on the second bound hero
// Charges stored under non-standard value names (the engine only knows AbilityCharges). Call from cast(), after the engine
// started the normal cooldown; mirrors the engine's charge rules (one charge restores at a time, 0.5 s between two uses).
function spendCharge(ab, max, restore) {
  const u = ab.owner; const w = u.world;
  if (w.freeSpells || max <= 0 || grimEcho) return;
  const d = (ab.data ||= { left: max, due: 0 });
  d.left = Math.min(d.left, max) - 1;
  const tick = () => { d.left++; d.due = 0; if (d.left < max) { d.due = w.time + restore * u.cdrMul; w.after(d.due - w.time, tick); } if (ab.cdEnd > w.time) ab.cdEnd = w.time; };
  if (!d.due) { d.due = w.time + restore * u.cdrMul; w.after(d.due - w.time, tick); }
  ab.cdEnd = d.left > 0 ? w.time + Math.min(0.5, restore) : d.due;
}

// ================================================================ Brewmaster
debuff('modifier_brewmaster_thunder_clap', { stats: (m) => ({ msPct: -m.v('movement_slow'), asSlow: -m.v('attack_speed_slow') }) });
defAbility('brewmaster_thunder_clap', {
  fid: 'full', prio: 60, ai: nearAI('radius', -60),
  cast(ab) { const u = ab.owner; for (const e of foes(ab, u.x, u.y, ab.v('radius'))) { hit(ab, e, ab.v('damage'), MAGICAL); addMod(ab, e, 'modifier_brewmaster_thunder_clap', ab.v('duration')); } },
});

dot('modifier_brewmaster_cinder_brew_ignite', { interval: 0.5, damage: (m) => m.data.tick, type: MAGICAL, statusResist: false, onRefresh(m, o) { if (o && o.data) m.data = o.data; } });
debuff('modifier_brewmaster_cinder_brew', {
  stats: (m) => ({ msPct: -m.v('movement_slow') }),
  onRefresh(m) { m.x = 0; },
  // x = 1 once ignited (magical or pure damage of any source)
  onTakeDamage(m, d) {
    const t = m.parent;
    if (m.x || d.dealt <= 0 || (d.type !== MAGICAL && d.type !== PURE) || !t.alive) return;
    const left = Math.max(0, m.remaining()) + m.v('extra_duration');
    m.x = 1; m.setDuration(left);
    t.addModifier('modifier_brewmaster_cinder_brew_ignite', { caster: m.caster, ability: m.ability, duration: left + 0.01, data: { tick: m.v('total_ignite_damage') / Math.max(1, Math.floor(left / 0.5 + 1e-6)) } });
    if (m.v('fear_duration') > 0) t.addModifier('modifier_feared', { caster: m.caster, ability: m.ability, duration: m.v('fear_duration') });
  },
});
defAbility('brewmaster_cinder_brew', {
  fid: 'approx', prio: 70,
  note: 'the barrel is a linear projectile: enemies within projectile_width of it are drenched as it passes, the barrel itself (barrel_width) deals the physical impact damage, the spill drenches the area when it arrives; the ignite deals total_ignite_damage in 0.5 s ticks spread over the remaining (extended) duration; min_movement / max_movement are not explained by the tooltip and unused',
  ai: (ab, u, t) => (t && !t.hasModifier('modifier_brewmaster_cinder_brew') ? { x: t.x, y: t.y } : null),
  cast(ab, t, x, y) {
    const u = ab.owner; const w = u.world; const ok = lands(w);
    const wet = new Set();   // [L] the spill does not refresh a unit the barrel already drenched on its way
    const drench = (e) => { if (ok && !wet.has(e)) { wet.add(e); addMod(ab, e, 'modifier_brewmaster_cinder_brew', ab.v('duration')); } };
    // two projectiles on the same path: the wide one drenches, the barrel itself deals the impact damage
    linearProjectile(u, u.x, u.y, x, y, { speed: ab.v('projectile_speed'), radius: ab.v('projectile_width'), hit: drench,
      end: (ex, ey) => { for (const e of foes(ab, ex, ey, ab.v('radius'))) drench(e); } });
    linearProjectile(u, u.x, u.y, x, y, { speed: ab.v('projectile_speed'), radius: ab.v('barrel_width'), hit: (e) => { if (ok) hit(ab, e, ab.v('barrel_impact_damage'), PHYSICAL); } });
  },
});

// Drunken Brawler. Stance = stacks of the stance modifier: 0 Earth, 1 Storm, 2 Fire. The same modifier is given to the Primal Split
// brewlings (with Brewmaster's ability as the value source).
const brewK = (m) => (m.parent.hasModifier('modifier_brewmaster_drunken_brawler_brewed_up') ? 1 + m.v('brewed_up_bonus') / 100 : 1);
modifier('modifier_brewmaster_drunken_brawler_hangover', { purge: 'none' });
modifier('modifier_brewmaster_drunken_brawler_brewed_up', {
  purge: 'none', onCreated(m) { m.parent.dirty = true; },
  onDestroy(m, expired) { const u = m.parent; u.dirty = true; if (expired && u.alive && m.data && m.data.hangover) u.addModifier('modifier_brewmaster_drunken_brawler_hangover', { ability: m.ability, duration: m.v('hangover_time') }); },
});
modifier('modifier_brewmaster_drunken_brawler', {
  hidden: true, purge: 'none',
  stats: (m) => {
    const k = brewK(m);
    if (m.stacks === 0) return { mr: Math.min(100, m.v('magic_resist') * k), armor: m.v('bonus_armor') * k };
    if (m.stacks === 1) return { evasion: Math.min(100, m.v('dodge_chance') * k), msPct: m.v('bonus_move_speed') * k };
    return { as: m.v('attack_speed') * k };
  },
  onAttack(m, rec) { if (m.stacks !== 2 || rec.target.isBuilding || !m.roll(Math.min(100, m.v('crit_chance') * brewK(m)))) return; const c = m.v('crit_multiplier') / 100; if (c > rec.crit) rec.crit = c; },
  onCast(m, ev) {
    const u = m.parent; const a = ev.ability;
    if (u !== m.ability.owner || a.isItem || a === m.ability || u.hasModifier('modifier_brewmaster_drunken_brawler_hangover')) return;
    const b = u.findModifier('modifier_brewmaster_drunken_brawler_brewed_up');
    if (b) b.setDuration(Math.max(0, b.remaining()) + m.v('brewed_up_duration_extend'));
    else u.addModifier('modifier_brewmaster_drunken_brawler_brewed_up', { ability: m.ability, duration: m.v('brewed_up_duration'), data: { hangover: true } });
  },
});
// controller: Fire stance for fighting, Earth below 30% health (kept until 60%)
const brewStance = (u, m) => (hpFrac(u) < (m.stacks === 0 ? 0.6 : 0.3) ? 0 : 2);
defAbility('brewmaster_drunken_brawler', {
  mods: ['modifier_brewmaster_drunken_brawler'], fid: 'approx', prio: 95, engage: false,
  note: 'stance = stacks of modifier_brewmaster_drunken_brawler (0 Earth, 1 Storm, 2 Fire; scenario option stacks: { brewmaster_drunken_brawler: N }). The controller switches to Fire for fighting and to Earth below 30% health. Brewed Up (+150% = x2.5, 7.40 patch note) multiplies armor, magic resistance, evasion, movement speed, attack speed and the crit chance (chance, not crit damage: 7.31 patch note); switching stance and using items do not Brew Up',
  ai(ab, u, t) { const m = ab.mods[0]; return t && m && m.stacks !== brewStance(u, m) ? true : null; },
  // [L] measured in Hero Demo: every use moves on to the next stance (Earth -> Storm -> Fire -> Earth); a hero starts in Earth
  cast(ab) { const m = ab.mods[0]; if (m) { m.setStacks((m.stacks + 1) % 3); ab.owner.dirty = true; } },
});

// Liquid Courage: passive trigger + Shard drink
buff('modifier_brewmaster_liquid_courage_buff', {
  interval: (m) => m.v('speed_toggle_time'),
  // x = 0 fast phase, 1 slow phase
  stats: (m) => ({ statusRes: m.v('status_resist'), msPct: m.x ? -m.v('min_speed') : m.v('max_speed') }),
  onThink(m) { m.x = m.x ? 0 : 1; m.parent.dirty = true; },
});
buff('modifier_brewmaster_liquid_courage_drink', { stats: (m) => ({ hpRegenPct: m.v('max_hp_regen') }) });
modifier('modifier_brewmaster_liquid_courage', {
  hidden: true,
  // x = damage counted so far, y = time of the last counted damage, z = time the passive may trigger again
  onTakeDamage(m, d) {
    const u = m.parent; const s = d.src; const now = u.world.time;
    if (d.dealt <= 0 || !s || s.team === u.team || !(s.heroLike || s.isSummon || s.name === 'npc_dota_roshan')) return;
    if (now - m.y > m.v('damage_reset_interval')) m.x = 0;
    m.x += d.dealt; m.y = now;
    if (m.x < m.v('damage_threshold') || now < m.z) return;
    m.x = 0; m.z = now + m.v('trigger_cooldown');
    u.addModifier('modifier_brewmaster_liquid_courage_buff', { ability: m.ability, duration: m.v('trigger_duration') });
  },
});
defAbility('brewmaster_liquid_courage', {
  mods: ['modifier_brewmaster_liquid_courage'], requires: activeWhen((u) => u.hasShard), fid: 'approx', prio: 35,
  note: 'damage of heroes, hero-owned units and Roshan counts; the speed phases start with the fast one. Shard drink: tossed to the most wounded allied hero in range (self included) below 75% health',
  ai(ab, u) { const a = woundedAlly(u, ab.castRange(), 0.75); return a ? { target: a } : null; },
  cast(ab, t) {
    const u = ab.owner; const tt = t || u;
    const drink = (x) => { addMod(ab, x, 'modifier_brewmaster_liquid_courage_buff', ab.v('drink_duration')); addMod(ab, x, 'modifier_brewmaster_liquid_courage_drink', ab.v('drink_duration')); };
    if (tt === u) drink(u); else u.world.projectile(u, tt, ab.v('projectile_speed'), drink);
  },
});

// Primal Split: Brewmaster leaves play, three brewlings fight in his place.
const BREWLINGS = ['earth', 'storm', 'fire'];
// [L] measured in Hero Demo: 0.6 s (split_duration) disarmed, invulnerable and out of play, then stunned, invulnerable and out of
// play for the duration; the hidden hero sits on the brewling he will be reborn at
modifier('modifier_brewmaster_primal_split_delay', { purge: 'none', statusResist: false, state: ['DISARM', 'OUT', 'INVULN'] });
modifier('modifier_brewmaster_primal_split', {
  purge: 'none', statusResist: false, state: ['STUN', 'OUT', 'INVULN'], interval: (m) => m.parent.world.dt, thinkNow: true,
  // the hidden hero follows the brewling he will be reborn at, so his auras keep working from there
  onThink(m) { const b = m.data.list.find((x) => x && x.alive); if (b) { m.parent.x = b.x; m.parent.y = b.y; } },
  onAnyDeath(m, ev) {
    const list = m.data.list;
    if (!list.length || !list.includes(ev.victim) || list.some((b) => b.alive)) return;
    const u = m.parent; u.x = ev.victim.x; u.y = ev.victim.y;
    m.remove(); u.world.kill(u, ev.killer, ev.ability);
  },
  onDestroy(m) {
    const u = m.parent; const b = m.data.list.find((x) => x && x.alive);   // order: Earth, Storm, Fire
    if (b) { u.x = b.x; u.y = b.y; }
    for (const x of m.data.list) if (x && x.alive) u.world.kill(x, null, null, true);
  },
});
// [L] measured in Hero Demo (first attacks of the brewlings, position of the hidden hero): the brewlings appear 100 from Brewmaster,
// Earth in front, Storm and Fire 120 degrees to either side, one tick after the split, and start to act one tick later
const BREW_SPOT = [[100, 0], [-50, 86.6], [-50, -86.6]];
function spawnBrewling(ab, kind, i, lvl, V, stance, at) {
  const u = ab.owner; const units = u.world.data.units;
  const d1 = units[`npc_dota_brewmaster_${kind}_1`]; const dn = units[`npc_dota_brewmaster_${kind}_${lvl}`] || d1;
  const half = (dn.dmgMax - dn.dmgMin) / 2; const dmg = V[kind + 'Dmg'];
  const [ox, oy] = BREW_SPOT[i];
  // a brewling of a hero without a controller only auto-attacks, like an unattended summon in the game
  const b = summon(ab, dn.name, { x: at.x + at.fx * ox - at.fy * oy, y: at.y + at.fy * ox + at.fx * oy, duration: V.duration + 1, ai: u.ai ? 'fight' : 'attack',
    ovr: { hp: V[kind + 'Hp'], dmgMin: dmg - half, dmgMax: dmg + half } });
  for (const a of b.abilities) if (a.name.startsWith(`brewmaster_${kind}_`)) { if (a.maxLevel < lvl) a.maxLevel = lvl; a.setLevel(lvl); }
  if (stance && stance.level > 0 && ab.v('give_brawler_passive') > 0) {
    b.addModifier('modifier_brewmaster_drunken_brawler', { ability: stance, stacks: i });
    if (u.hasScepter) b.addModifier('modifier_brewmaster_drunken_brawler_brewed_up', { ability: stance, duration: stance.v('brewed_up_duration') });
  }
  b.recompute(); b.hp = b.maxHp; b.mana = b.maxMana;
  const ai = b.ai; b.ai = null; u.world.after(u.world.dt, () => { b.ai = ai; });
  return b;
}
defAbility('brewmaster_primal_split', {
  fid: 'approx', prio: 50, engage: false,
  note: 'Brewmaster is out of play while three brewlings (shipped brewling units, own abilities, respective stance, fight controller) take his place; he returns at the first living one (Earth, Storm, Fire) and dies when all three die. Scepter: +1 level (mana cost, cooldown, brewling stats and abilities) and Brewed Up brewlings; the cancel is never used. Auras follow the brewling he will return at instead of the Earth brewling only; he keeps regenerating while split',
  // split once Thunder Clap and Cinder Brew have been used (or cannot be cast)
  ai(ab, u, t) {
    if (!t || u.distTo(t) > 500) return null;
    for (const n of ['brewmaster_thunder_clap', 'brewmaster_cinder_brew']) { const a = u.findAbility(n); if (a && a.ready() && !u.world.freeSpells) return null; }
    return true;
  },
  cast(ab) {
    const u = ab.owner; const w = u.world; const lvl = ab.level + (u.hasScepter ? ab.v('scepter_bonus_levels') : 0);
    const cost0 = ab.manaCost();
    const V = atLevel(ab, lvl, () => ({ duration: ab.v('duration'), cost: ab.manaCost(), cd: ab.cooldown(),
      earthHp: ab.v('tooltip_earth_brewling_hp'), earthDmg: ab.v('tooltip_earth_brewling_damage'), stormHp: ab.v('tooltip_storm_brewling_hp'), stormDmg: ab.v('tooltip_storm_brewling_damage'),
      fireHp: ab.v('tooltip_fire_brewling_hp'), fireDmg: ab.v('tooltip_fire_brewling_damage') }));
    if (!w.freeSpells && lvl !== ab.level) { u.mana = Math.max(0, u.mana - (V.cost - cost0)); ab.cdEnd = w.time + V.cd; }
    // facing: towards the unit he is fighting, else the nearest enemy
    const f = aiTarget(u) || w.nearestEnemy(u, 2000); const [fx, fy] = f ? dirTo(u.x, u.y, f.x, f.y) : [1, 0];
    const at = { x: u.x, y: u.y, fx, fy };
    u.addModifier('modifier_brewmaster_primal_split_delay', { ability: ab, duration: ab.v('split_duration') });
    const stance = u.findAbility('brewmaster_drunken_brawler');
    w.after(ab.v('split_duration'), () => {
      if (!u.alive) return;
      const m = u.addModifier('modifier_brewmaster_primal_split', { ability: ab, duration: V.duration, data: { list: [] } });
      // [L] when two brewlings hit in the same tick the game resolves Fire before Earth: Fire is created first
      w.after(w.dt, () => { if (!m.removed) for (const i of [2, 0, 1]) m.data.list[i] = spawnBrewling(ab, BREWLINGS[i], i, lvl, V, stance, at); });
    });
  },
});

// ---- Earth brewling
nuke('brewmaster_earth_hurl_boulder', { fid: 'full', prio: 70, speed: 'speed', damage: 'damage', type: MAGICAL, stun: 'duration' });
passive('brewmaster_earth_pulverize', { fid: 'full', onAttack(m, rec) { if (rec.target.isBuilding) rec.add += m.v('bonus_building_damage'); } });
passive('brewmaster_earth_spell_immunity', { fid: 'full', stats: { mr: 'magic_resist', statusRes: 'status_resist', slowRes: 'slow_resist' } });
na('brewmaster_primal_split_cancel', 'cancel helper; the controller never ends Primal Split early');
// ---- Storm brewling
defAbility('brewmaster_storm_dispel_magic', {
  fid: 'approx', prio: 60,
  note: 'basic dispel of allies (debuffs) and enemies (buffs) in the area, damage (type not stated: magical) to enemy summons; hero-like summons and illusions of heroes are not treated as summons; cannot target invulnerable units',
  ai(ab, u, t, w) {
    const reach = ab.castRange() + ab.v('radius') * 0.5;
    for (const o of w.units) {
      if (!o.alive || o.st[ST.OUT] > 0 || u.distTo(o) > reach) continue;
      if (o.team === u.team ? hasDispellable(o, true) : (!o.isImmune() && (hasDispellable(o, false) || (o.isSummon && !o.heroLike)))) return { x: o.x, y: o.y };
    }
    return null;
  },
  cast(ab, t, x, y) {
    const u = ab.owner; const r = ab.v('radius');
    for (const a of u.world.alliesInRadius(u, x, y, r)) a.purge({ debuffs: true });
    for (const e of foes(ab, x, y, r)) { if (e.isImmune()) continue; e.purge({ debuffs: false, buffs: true }); if (e.isSummon && !e.heroLike) hit(ab, e, ab.v('damage')); }
  },
});
debuff('modifier_brewmaster_storm_cyclone', { state: ['OUT', 'INVULN'], onDestroy(m) { if (m.parent.alive) mhit(m, m.parent, m.v('landing_damage')); } });
defAbility('brewmaster_storm_cyclone', {
  fid: 'approx', prio: 75,
  note: 'the controller only cyclones a second enemy hero (never its own attack target); landing damage type is not stated: magical',
  ai(ab, u, t, w) {
    let best = null; let bd = ab.castRange() + 250;
    for (const e of w.units) { if (e === t || !e.alive || e.team === u.team || !e.isHero || e.isIllusion || !e.targetable() || e.isImmune()) continue; const d = u.distTo(e); if (d < bd) { bd = d; best = e; } }
    return best ? { target: best } : null;
  },
  cast(ab, t) { if (t) addMod(ab, t, 'modifier_brewmaster_storm_cyclone', t.heroLike ? ab.v('duration_hero') : ab.v('duration_unit')); },
});
modifier('modifier_brewmaster_storm_wind_walk_fade', {
  hidden: true, purge: 'none',
  onDestroy(m, expired) { const u = m.parent; if (expired && u.alive) u.addModifier('modifier_brewmaster_storm_wind_walk', { ability: m.ability, duration: m.v('duration') }); },
});
buff('modifier_brewmaster_storm_wind_walk', {
  purge: 'none', state: ['INVIS'], stats: (m) => ({ msPct: m.v('bonus_movement_speeed') }),
  onAttack(m, rec) { rec.flat += m.v('bonus_damage'); m.remove(); }, onCast(m) { m.remove(); },
});
defAbility('brewmaster_storm_wind_walk', {
  fid: 'full', prio: 50, engage: false,
  ai: (ab, u, t) => (t && !u.hasModifier('modifier_brewmaster_storm_wind_walk') && !u.hasModifier('modifier_brewmaster_storm_wind_walk_fade') ? true : null),
  cast(ab) { addMod(ab, ab.owner, 'modifier_brewmaster_storm_wind_walk_fade', ab.v('fade_time')); },
});
// ---- Fire brewling
defAbility('brewmaster_fire_pull', {
  fid: 'approx', prio: 60,
  note: 'vector direction is chosen by the controller: straight back from the target towards the Fire brewling; both units are moved in one step when the pull ends',
  ai: (ab, u, t) => (t && !t.isBuilding ? { target: t } : null),
  cast(ab, t) {
    const u = ab.owner; if (!t) return;
    const [dx, dy] = dirTo(t.x, t.y, u.x, u.y); const d = ab.v('pull_distance');
    u.world.after(ab.v('pull_duration'), () => {
      if (u.alive) { u.x += dx * d; u.y += dy * d; }
      if (!t.alive || t.st[ST.OUT] > 0) return;
      t.x += dx * d; t.y += dy * d;
      if (t.team !== u.team) hit(ab, t, ab.v('damage'), MAGICAL);
    });
  },
});
// [L] measured in Hero Demo: an aura debuff (0.5 s linger) that burns every 0.5 s, counted from the moment a unit received it,
// for half the per-second value
debuff('modifier_brewmaster_fire_permanent_immolation_burn', { purge: 'none', pierce: true, statusResist: false, interval: 0.5, onThink(m) { mhit(m, m.parent, m.v('damage') * 0.5, MAGICAL); } });
passive('brewmaster_fire_permanent_immolation', {
  fid: 'full', interval: (m) => m.parent.world.dt, thinkNow: true,
  onThink(m) { const u = m.parent; for (const e of foesOf(u, u.x, u.y, m.v('radius') + 24)) if (u.distTo(e) <= m.v('radius') + e.def.hull) e.addModifier('modifier_brewmaster_fire_permanent_immolation_burn', { caster: u, ability: m.ability, duration: 0.5 }); },
});
passive('brewmaster_fire_phase', { fid: 'full', note: 'phased movement has no effect here (no unit collision)', stats: { statusRes: 'status_resistance' } });

// ================================================================ Shadow Demon
const SD_BANISH = 'modifier_shadow_demon_disruption';
const SD_POISON = 'modifier_shadow_demon_shadow_poison';
// Shadow Demon's own spells still affect a unit hidden by Disruption: its invulnerability is lifted while fn runs
function throughDisruption(t, fn) {
  if (!t.hasModifier(SD_BANISH)) return fn();
  t.st[ST.INVULN]--;
  try { return fn(); } finally { t.st[ST.INVULN]++; }
}
function sdBanished(u, range) { for (const e of u.world.units) { if (!e.alive || e.team === u.team || u.distTo(e) > range) continue; const m = e.findModifier(SD_BANISH); if (m && m.caster === u) return e; } return null; }
function sdMenace(sd, t) {
  const me = sd.findAbility('shadow_demon_menace');
  if (me && me.level > 0 && t.alive && !t.isBuilding && t.team !== sd.team) t.addModifier('modifier_shadow_demon_menace_debuff', { caster: sd, ability: me, duration: me.v('duration') });
}
// [L] measured in Hero Demo: an attack's own Menace stack already counts for its damage (hit n deals (1 + n x stack%) x damage,
// for Shadow Demon and for the Disruption illusions); the target's stats are refreshed so the new stack applies at once
function sdMenaceHit(sd, d) {
  if (!(d.flags & F_ATTACK) || (d.flags & F_SECONDARY)) return;
  sdMenace(sd, d.dst);
  if (d.dst.dirty) d.dst.recompute();
}
modifier('modifier_shadow_demon_disruption_illusion', { hidden: true, purge: 'none', stats: (m) => ({ dmgBase: m.v('illusion_flat_damage') }), outgoing(m, d) { sdMenaceHit(m.caster, d); } });
// banished = cannot act, cannot be attacked or harmed. Not flagged "out of play", so that Shadow Demon's own spells can still target it.
modifier(SD_BANISH, {
  debuff: true, purge: 'none', state: ['STUN', 'INVULN'],
  onDestroy(m) {
    const t = m.parent; const u = m.caster; const ab = m.ability;
    if (!t.alive || !ab) return;
    for (let i = 0; i < 2; i++) {   // "two illusions" (tooltip text, no value in the data)
      const il = t.world.createIllusion(t, { team: u.team, owner: u, duration: ab.v('illusion_duration'), outPct: ab.v('illusion_outgoing_damage'), inPct: ab.v('illusion_incoming_damage'), x: t.x + (i ? -80 : 80), y: t.y + 50, target: t.team !== u.team ? t : null });
      il.addModifier('modifier_shadow_demon_disruption_illusion', { caster: u, ability: ab });
    }
  },
});
defAbility('shadow_demon_disruption', {
  fid: 'approx', prio: 75,
  note: 'the banished unit cannot act and is invulnerable (other area effects still see it but do nothing to it); when it returns two illusions with bonus base damage fight for Shadow Demon (they attack the banished unit when it is an enemy) and apply Menace (7.42 patch note). The controller only banishes enemy heroes, never allies to save them',
  ai: (ab, u, t) => (t && t.isHero && !t.isIllusion ? { target: t } : null),
  cast(ab, t) { if (t) addMod(ab, t, SD_BANISH, ab.v('disruption_duration')); },
});

const sdShare = {
  statusResist: false,
  onTakeDamage(m, d) {
    const t = m.parent; const sd = m.caster;
    if (d.dealt <= 0 || (d.flags & F_REFLECT) || t.hasModifier(SD_BANISH)) return;
    const w = t.world; const dmg = d.dealt * m.v('damage_reflection_pct') / 100; const type = d.type;
    for (const e of foesOf(sd, t.x, t.y, m.v('radius'))) w.damage(sd, e, dmg, type, F_REFLECT | F_NO_AMP | F_NO_LIFESTEAL, m.ability);
  },
};
debuff('modifier_shadow_demon_disseminate', sdShare);
buff('modifier_shadow_demon_disseminate_ally', sdShare);
defAbility('shadow_demon_disseminate', {
  fid: 'approx', prio: 55,
  note: 'the shared portion is taken from the health the target actually lost and is dealt in the same damage type as reflected damage (no amplification, no lifesteal, cannot be shared again), so each receiver reduces it with its own resistances',
  ai: (ab, u, t) => (t && !t.isBuilding && !t.hasModifier('modifier_shadow_demon_disseminate') ? { target: t } : null),
  cast(ab, t) { if (t) addMod(ab, t, t.team === ab.owner.team ? 'modifier_shadow_demon_disseminate_ally' : 'modifier_shadow_demon_disseminate', ab.v('duration')); },
});

// deferred damage of n stacks: 1/2/4/8/16 x stack damage up to max_multiply_stacks, then a flat amount per extra stack (sp = Shadow Poison)
const sdStored = (sp, n) => { const max = sp.v('max_multiply_stacks'); return n < 1 ? 0 : sp.v('stack_damage') * Math.pow(2, Math.min(n, max) - 1) + sp.v('bonus_stack_damage') * Math.max(0, n - max); };
modifier(SD_POISON, {
  debuff: true, multi: 'stack', purge: 'none', statusResist: false,
  onDestroy(m, expired) {
    const t = m.parent;
    if (t.alive && m.stacks > 0 && (expired || (m.data && m.data.release))) throughDisruption(t, () => mhit(m, t, sdStored(m.ability, m.stacks), MAGICAL));
  },
});
const sdPoison = (ab, t, n, pierce) => throughDisruption(t, () => t.addModifier(SD_POISON, { caster: ab.owner, ability: ab, duration: ab.v('AbilityDuration'), stacks: n, pierce }));
defAbility('shadow_demon_shadow_poison', {
  fid: 'approx', prio: 45,
  note: 'straight line of cast-range length; targets are taken from their positions at cast time and hit after the travel delay. Also reaches units hidden by Disruption',
  ai(ab, u, t) { const e = sdBanished(u, ab.castRange()) || t; return e ? { x: e.x, y: e.y } : null; },
  cast(ab, t, x, y) {
    const u = ab.owner; const w = u.world; const [dx, dy] = dirTo(u.x, u.y, x, y); const len = ab.castRange(); const r = ab.v('radius');
    if (!lands(w)) return;
    for (const [d, e] of lineEnemies(u, u.x, u.y, u.x + dx * len, u.y + dy * len, r)) {
      // the projectile (radius r) hits as soon as it touches the unit's hull
      w.after(Math.max(0, d - r - e.def.hull) / ab.v('speed'), () => { if (!e.alive) return; throughDisruption(e, () => hit(ab, e, ab.v('hit_damage'), MAGICAL)); if (e.alive) sdPoison(ab, e, 1, false); });
    }
  },
});
defAbility('shadow_demon_shadow_poison_release', {
  fid: 'full', prio: 46,
  // release at the stack count where the damage stops doubling, or when the stored damage kills
  ai(ab, u, t, w) {
    const sp = u.findAbility('shadow_demon_shadow_poison');
    if (!sp || sp.level < 1) return null;
    const max = sp.v('max_multiply_stacks');
    for (const e of w.units) {
      if (!e.alive || e.team === u.team) continue;
      const m = e.findModifier(SD_POISON);
      if (!m || m.caster !== u) continue;
      if (m.stacks >= max || sdStored(sp, m.stacks) * (1 - e.mr) * (1 + u.spellAmp / 100) >= e.hp) return NOW;
    }
    return null;
  },
  cast(ab) { const u = ab.owner; for (const e of u.world.units) { if (!e.alive) continue; const m = e.findModifier(SD_POISON); if (m && m.caster === u) { m.data = { release: true }; m.remove(); } } },
});

buff('modifier_shadow_demon_demonic_cleanse', {
  purge: 'none', interval: 0.1, thinkNow: true,
  onThink(m) { m.parent.purge({ debuffs: true }); },
  onDestroy(m, expired) { const t = m.parent; if (expired && t.alive) t.heal(m.v('purge_damage'), m.caster, m.ability); },
});
defAbility('shadow_demon_demonic_cleanse', {
  fid: 'approx', prio: 50,
  note: 'debuffs are removed every 0.1 s; the controller uses it on the most wounded allied hero (self included) below 65% health',
  ai(ab, u) { const a = woundedAlly(u, ab.castRange(), 0.65); return a ? { target: a } : null; },
  cast(ab, t) { addMod(ab, t || ab.owner, 'modifier_shadow_demon_demonic_cleanse', ab.v('AbilityDuration')); },
});
modifier('modifier_shadow_demon_demonic_purge', {
  debuff: true, pierce: true, purge: 'none', dynamic: true, interval: 0.1, thinkNow: true,
  // slow falls linearly from max_slow to min_slow; y = time of the next Shadow Poison stack (talent); z = 1 while it breaks (Scepter)
  stats: (m) => { const dur = m.dieTime - m.created; const k = dur > 0 ? Math.min(1, (m.parent.world.time - m.created) / dur) : 1; return { msPct: -(m.v('max_slow') - (m.v('max_slow') - m.v('min_slow')) * k) }; },
  onCreated(m) { const t = m.parent; m.y = t.world.time; if (m.caster.hasScepter) { t.st[ST.BREAK]++; t.dirty = true; m.z = 1; } },
  onRefresh(m) { m.created = m.parent.world.time; },
  onThink(m) {
    const t = m.parent; const now = t.world.time; const n = m.v('apply_poison_stacks');
    t.purge({ debuffs: false, buffs: true });
    if (n <= 0 || now + 1e-9 < m.y) return;
    m.y += 1;
    const sp = m.caster.findAbility('shadow_demon_shadow_poison');
    if (sp && sp.level > 0) sdPoison(sp, t, n, true);
  },
  onDestroy(m, expired) { const t = m.parent; if (m.z === 1) { t.st[ST.BREAK]--; t.dirty = true; } if (expired && t.alive) throughDisruption(t, () => mhit(m, t, m.v('purge_damage'), MAGICAL)); },
});
defAbility('shadow_demon_demonic_purge', {
  fid: 'approx', prio: 70,
  note: 'buffs are stripped every 0.1 s, slow decays linearly, damage on expiry; Scepter break and 2 charges; the talent adds 1 Shadow Poison stack per second (7.41 patch note). Works on a unit hidden by Disruption',
  ai(ab, u, t) { const e = sdBanished(u, ab.castRange() + 200) || t; return e && e.heroLike && !e.hasModifier('modifier_shadow_demon_demonic_purge') ? { target: e } : null; },
  cast(ab, t) {
    if (!t) return;
    throughDisruption(t, () => addMod(ab, t, 'modifier_shadow_demon_demonic_purge', ab.v('AbilityDuration'), { pierce: true }));
    spendCharge(ab, ab.v('max_charges'), ab.v('charge_restore_time'));
  },
});
modifier('modifier_shadow_demon_menace_debuff', { debuff: true, multi: 'stack', purge: 'none', statusResist: false, stats: (m) => ({ dmgTaken: m.v('stack') * m.stacks }) });
passive('shadow_demon_menace', { fid: 'full', note: 'the stack is added before the attack deals its damage', outgoing(m, d) { sdMenaceHit(m.parent, d); } });

// ================================================================ Puck
// Puckish pays out when Puck disjoints: one share per attack projectile, dodged_spell_multiplier shares per spell projectile
function puckDodge(u) {
  const got = disjoint(u); const m = u.findModifier('modifier_puck_puckish');
  if (!m || !m.active()) return;
  const k = (got.attacks + got.spells * m.v('dodged_spell_multiplier')) * m.v('mana_and_health_restore_pct') / 100;
  if (k > 0) { u.heal(u.maxHp * k, u, m.ability); u.giveMana(u.maxMana * k); }
}
passive('puck_puckish', { fid: 'approx', note: 'counts the tracking projectiles (ranged attacks, targeted spells) flying at Puck at the moment she casts Phase Shift or Ethereal Jaunt; disjoints through items are not detected' });

const puckOrb = (u) => { const a = u.findAbility('puck_illusory_orb'); const o = a && a.data; return o && o.live && !o.used ? o : null; };
defAbility('puck_illusory_orb', {
  fid: 'approx', prio: 60,
  note: 'straight orb (the alt-cast path; the curved vector path is not modelled) advanced in 0.1 s steps: impact damage once per enemy, then the periodic share while the enemy stays inside the orb',
  ai: (ab, u, t) => (t && u.distTo(t) <= ab.v('max_distance') * 0.6 ? { x: t.x, y: t.y } : null),
  cast(ab, t, x, y) {
    const u = ab.owner; const w = u.world; const [dx, dy] = dirTo(u.x, u.y, x, y);
    const step = 0.1; const far = ab.v('max_distance'); const go = ab.v('orb_speed') * step; const n = Math.ceil(far / go);
    const every = Math.max(1, Math.round(ab.v('damage_interval') / step)); const seen = new Set();
    const orb = { x: u.x, y: u.y, live: true, used: false, on: lands(w) }; let gone = 0;
    ab.data = orb;
    for (let i = 1; i <= n; i++) {
      w.after(i * step, () => {
        const d = Math.min(go, far - gone); gone += d; orb.x += dx * d; orb.y += dy * d;
        if (orb.on) for (const e of foes(ab, orb.x, orb.y, ab.v('radius'))) {
          if (!seen.has(e)) { seen.add(e); hit(ab, e, ab.v('damage'), MAGICAL); } else if (i % every === 0) hit(ab, e, ab.v('damage') * ab.v('damage_over_time_pct') / 100, MAGICAL);
        }
        if (i === n) orb.live = false;
      });
    }
  },
});
defAbility('puck_ethereal_jaunt', {
  fid: 'approx', prio: 100,
  note: 'teleports to the flying orb and disjoints. The controller jaunts to close a gap, or to disjoint incoming projectiles when the orb is still within attack reach of its target',
  ai(ab, u, t) {
    const orb = puckOrb(u);
    if (!orb || !t || u.isRooted()) return null;
    const dOrb = Math.sqrt((t.x - orb.x) ** 2 + (t.y - orb.y) ** 2); const reach = u.attackRange + u.def.hull + t.def.hull; const d = u.distTo(t);
    if (d > reach + 100 && dOrb < d - 100) return NOW;
    return dOrb <= reach && incoming(u) > 0 ? NOW : null;
  },
  cast(ab) { const u = ab.owner; const orb = puckOrb(u); if (!orb || u.isRooted()) return; orb.used = true; u.x = orb.x; u.y = orb.y; puckDodge(u); },
});
defAbility('puck_waning_rift', {
  fid: 'full', prio: 80,
  // teleport only as far as needed to bring the target well inside the burst
  ai(ab, u, t) {
    if (!t) return null;
    const [dx, dy, d] = dirTo(u.x, u.y, t.x, t.y); const go = Math.max(0, d - (ab.v('radius')) * 0.75);
    return go > ab.v('max_distance') ? null : { x: u.x + dx * go, y: u.y + dy * go };
  },
  cast(ab, t, x, y) {
    const u = ab.owner; const [dx, dy, d] = dirTo(u.x, u.y, x, y); const go = u.isRooted() ? 0 : Math.min(d, ab.v('max_distance'));   // a rooted Puck casts in place
    u.x += dx * go; u.y += dy * go;
    for (const e of foes(ab, u.x, u.y, ab.v('radius'))) { hit(ab, e, ab.v('damage'), MAGICAL); addMod(ab, e, 'modifier_silenced', ab.v('silence_duration')); }
  },
});
// [L] measured in Hero Demo: Puck is invulnerable, ethereal and out of play while shifted (she cannot act; orders cancel it in the game)
buff('modifier_puck_phase_shift', { purge: 'none', state: ['INVULN', 'UNTARGETABLE', 'ETHEREAL', 'OUT'] });
// [L] measured in Hero Demo: the Shard bonus is part of the attack's own (physical) damage instance, not separate magic damage
modifier('modifier_puck_phase_shift_shard', { hidden: true, onAttack(m, rec) { if (rec.target && !rec.target.isBuilding) rec.add += m.v('shard_bonus_damage'); } });
const PUCK_TAP = 0.3;   // controller assumption: a short tap is enough to disjoint or to fire the Shard volley
defAbility('puck_phase_shift', {
  mods: ['modifier_puck_phase_shift_shard'], requires: (ab) => ab.owner.hasShard, fid: 'approx', prio: 20,
  note: 'invulnerable, ethereal and out of play for the channel time (modelled as a buff, not as an engine channel, since out-of-play ends channels); disjoints on cast. The controller taps it for 0.3 s (cancelling early is allowed) against incoming projectiles or, with Shard, whenever enemies are in attack range, and channels it fully when hurt below 40% health. Orders given during the shift do not cancel it here',
  ai(ab, u, t) {
    if (!t) return null;
    if (u.hasShard && u.rangeTo(t) <= u.attackRange + ab.v('shard_attack_range_bonus')) return NOW;
    return incoming(u) > 0 || (hpFrac(u) < 0.4 && u.world.time - u.lastHurt < 2) ? NOW : null;
  },
  cast(ab) {
    const u = ab.owner; const w = u.world; const full = ab.v('AbilityChannelTime');
    ab.data = u.ai && hpFrac(u) >= 0.4 ? Math.min(full, PUCK_TAP) : full;
    puckDodge(u);
    if (u.hasShard && !u.isDisarmed()) {
      for (const e of w.inRadius(u.x, u.y, u.attackRange + ab.v('shard_attack_range_bonus') + 2 * u.def.hull + 40, u.team, true)) {
        if (e.attackableBy(u) && u.rangeTo(e) <= u.attackRange + ab.v('shard_attack_range_bonus')) w.launchAttack(u, e, { fromAbility: ab });
      }
    }
    addMod(ab, u, 'modifier_puck_phase_shift', ab.data);
  },
});
modifier('modifier_puck_dream_coil_rapid_fire', {
  debuff: true, hidden: true, pierce: true, purge: 'none', statusResist: false,
  interval: (m) => Math.max(0.1, m.caster.attackInterval * 100 / m.v('attack_rate_pct')),
  onThink(m) { const c = m.caster; const t = m.parent; if (c.alive && t.alive) c.world.launchAttack(c, t, { instant: true, fromAbility: m.ability }); },
});
modifier('modifier_puck_dream_coil', {
  debuff: true, purge: 'none', state: ['LEASH'], interval: 0.1,
  // x, y = coil centre
  onThink(m) {
    const t = m.parent; const dx = t.x - m.x; const dy = t.y - m.y; const r = m.v('coil_break_radius');
    if (dx * dx + dy * dy <= r * r) return;
    const c = m.caster; const ab = m.ability; const fire = t.findModifier('modifier_puck_dream_coil_rapid_fire');
    m.remove();
    c.world.damage(c, t, ab.v('coil_break_damage'), MAGICAL, 0, ab);
    const s = t.alive ? t.addModifier('modifier_stunned', { caster: c, ability: ab, duration: ab.v('coil_stun_duration') }) : null;
    if (fire) { if (s) fire.setDuration(Math.max(0, s.remaining())); else fire.remove(); }
  },
  onDestroy(m, expired) { if (expired) m.parent.removeModifierByName('modifier_puck_dream_coil_rapid_fire'); },
});
defAbility('puck_dream_coil', {
  fid: 'approx', prio: 85,
  note: 'heroes inside take the initial damage and are tied to the centre (no initial stun: the shipped stun_duration value is a leftover, see the 7.30 patch note); walking (or being moved) past the break radius snaps the coil (checked every 0.1 s). The leash itself does not restrict movement or blinks. Scepter attacks land instantly (they come from the coil, not from Puck)',
  ai: (ab, u, t) => (t && t.isHero ? { x: t.x, y: t.y } : null),
  cast(ab, t, x, y) {
    const u = ab.owner;
    for (const e of foes(ab, x, y, ab.v('coil_radius'))) {
      if (!e.isHero) continue;
      hit(ab, e, ab.v('coil_initial_damage'), MAGICAL);
      if (!e.alive) continue;
      const m = addMod(ab, e, 'modifier_puck_dream_coil', ab.v('coil_duration'));
      if (!m) continue;
      m.x = x; m.y = y;
      if (u.hasScepter && ab.v('attack_rate_pct') > 0) addMod(ab, e, 'modifier_puck_dream_coil_rapid_fire', Math.max(0, m.remaining()));
    }
  },
});

// ================================================================ Dark Willow
const DW_ROOT = 'modifier_dark_willow_bramble_maze_root';
debuff(DW_ROOT, { state: ['ROOT'], interval: 0.5, thinkNow: true, onThink(m) { mhit(m, m.parent, m.v('damage_per_tick'), MAGICAL); } });
// a set of brambles (maze = Bramble Maze ability) that each root the first enemy coming within latch range; checked every 0.1 s
function dwBrambles(maze, pts, life) {
  const u = maze.owner; const w = u.world; const end = w.time + life; const live = pts.map((p) => ({ x: p[0], y: p[1], on: true }));
  const tick = () => {
    let any = false;
    for (const b of live) {
      if (!b.on) continue;
      any = true;
      for (const e of w.inRadius(b.x, b.y, maze.v('latch_range'), u.team, true)) {
        if (e.isBuilding || e.hasModifier(DW_ROOT) || !addMod(maze, e, DW_ROOT, maze.v('latch_duration'))) continue;
        b.on = false; break;
      }
    }
    if (any && w.time + 0.1 <= end + 1e-9) w.after(0.1, tick);
  };
  tick();
}
const ringPoints = (x, y, r, n, phase = 0) => Array.from({ length: n }, (_, i) => { const a = phase + 2 * Math.PI * i / n; return [x + Math.cos(a) * r, y + Math.sin(a) * r]; });
const DW_INNER = 0.4;   // inner bramble ring as a share of the placement range (layout is not in the data)
defAbility('dark_willow_bramble_maze', {
  fid: 'approx', prio: 65,
  note: 'bramble layout is not in the data: half of the brambles on a ring at 40% of the placement range, half on the full range (offset in angle); the controller aims so that an inner bramble grows under its target. Root damage ticks every 0.5 s (7.31 patch note), the first one on the latch; the per-bramble creation delays are ignored',
  ai: (ab, u, t) => (t && !t.isBuilding && !t.isImmune() && !t.hasModifier(DW_ROOT) ? { x: t.x - ab.v('placement_range') * DW_INNER, y: t.y } : null),
  cast(ab, t, x, y) {
    const R = ab.v('placement_range'); const half = Math.max(1, Math.round(ab.v('placement_count') / 2));
    const pts = ringPoints(x, y, R * DW_INNER, half).concat(ringPoints(x, y, R, ab.v('placement_count') - half, Math.PI / half));
    ab.owner.world.after(ab.v('initial_creation_delay'), () => dwBrambles(ab, pts, ab.v('placement_duration')));
  },
});
const DW_REALM = 'modifier_dark_willow_shadow_realm';
buff(DW_REALM, {
  purge: 'none', state: ['UNTARGETABLE'], stats: (m) => ({ attackRange: m.v('attack_range_bonus') }),
  onAttack(m, rec) {
    const u = m.parent;
    (rec.data ||= {}).realm = m.v('damage') * Math.min(1, (u.world.time - m.created) / m.v('max_damage_duration'));
    if (!u.hasScepter) m.remove();
  },
});
modifier('modifier_dark_willow_shadow_realm_hold', { hidden: true, purge: 'none', state: ['DISARM'] });
modifier('modifier_dark_willow_shadow_realm_fade', {
  purge: 'none',
  onDestroy(m, expired) {
    const u = m.parent; const ab = m.ability; if (!expired || !u.alive) return;
    disjoint(u);
    addMod(ab, u, DW_REALM, ab.v('duration'));
    if (!u.hasScepter && u.ai && u.ai.mode === 'fight') addMod(ab, u, 'modifier_dark_willow_shadow_realm_hold', Math.min(ab.v('max_damage_duration'), ab.v('duration') - 0.5));
  },
});
modifier('modifier_dark_willow_shadow_realm_hit', { hidden: true, onAttackLanded(m, rec) { if (rec.data && rec.data.realm > 0 && rec.target.alive) mhit(m, rec.target, rec.data.realm, MAGICAL); } });
defAbility('dark_willow_shadow_realm', {
  mods: ['modifier_dark_willow_shadow_realm_hit'], fid: 'approx', prio: 60,
  note: 'after the fade time: untargetable, +attack range, bonus magic damage growing linearly from 0 to the maximum; projectiles are disjointed when the realm begins. The game also makes her attack immune, which the engine cannot express without disarming her (its ETHEREAL state). Without Scepter the default controller holds its attack (self-disarm) until the bonus is fully charged',
  ai: (ab, u, t) => (t && !u.hasModifier(DW_REALM) && !u.hasModifier('modifier_dark_willow_shadow_realm_fade') && u.rangeTo(t) <= u.attackRange + ab.v('attack_range_bonus') ? NOW : null),
  cast(ab) {
    const u = ab.owner;
    // [L] measured in Hero Demo: the realm (full duration) begins after the fade time
    addMod(ab, u, 'modifier_dark_willow_shadow_realm_fade', ab.v('fade_time'));
  },
});
modifier('modifier_dark_willow_cursed_crown', {
  debuff: true, statusResist: false,
  onDestroy(m, expired) {
    const t = m.parent; const u = m.caster; const ab = m.ability; const w = t.world;
    if (expired && t.alive) for (const e of foesOf(u, t.x, t.y, ab.v('stun_radius'))) e.addModifier('modifier_stunned', { caster: u, ability: ab, duration: ab.v('stun_duration') });
    // Shard: brambles around the target when the counter ends or is dispelled
    const maze = u.findAbility('dark_willow_bramble_maze'); const n = ab.v('shard_bramble_amount');
    if (n > 0 && t.alive && maze && maze.level > 0) dwBrambles(maze, ringPoints(t.x, t.y, ab.v('shard_spawn_radius'), n), maze.v('extra_brambles_placement_duration'));
  },
});
defAbility('dark_willow_cursed_crown', {
  fid: 'full', prio: 75, note: 'Shard brambles use the Bramble Maze values and last extra_brambles_placement_duration',
  ai: (ab, u, t) => (t && !t.isBuilding && !t.hasModifier('modifier_dark_willow_cursed_crown') ? { target: t } : null),
  cast(ab, t) { if (t) addMod(ab, t, 'modifier_dark_willow_cursed_crown', ab.v('delay')); },
});
const DW_BEDLAM = 'modifier_dark_willow_bedlam'; const DW_AWAY = 'modifier_dark_willow_terrorize_away';
buff(DW_BEDLAM, {
  purge: 'none', interval: (m) => m.v('attack_interval'),
  // z = start angle of the wisp (towards the target at cast time)
  onThink(m) {
    const u = m.parent; const w = u.world; const a = m.z + 2 * Math.PI * (w.time - m.created) / m.v('roaming_seconds_per_rotation');
    const wx = u.x + Math.cos(a) * m.v('roaming_radius'); const wy = u.y + Math.sin(a) * m.v('roaming_radius');
    const es = foesOf(u, wx, wy, m.v('attack_radius')).filter((e) => e.st[ST.INVULN] === 0 && e.st[ST.UNTARGETABLE] === 0 && !e.isImmune());
    if (es.length > m.v('target_count')) es.sort((p, q) => ((p.x - wx) ** 2 + (p.y - wy) ** 2) - ((q.x - wx) ** 2 + (q.y - wy) ** 2));
    for (let i = 0; i < es.length && i < m.v('target_count'); i++) mhit(m, es[i], m.v('attack_damage'), MAGICAL);
  },
});
defAbility('dark_willow_bedlam', {
  fid: 'approx', prio: 80,
  note: 'the wisp circles Dark Willow (start angle towards her target) and hits the nearest enemies in its attack radius instantly every attack interval',
  ai: (ab, u, t) => (t && !u.hasModifier(DW_AWAY) && !u.hasModifier(DW_BEDLAM) && u.distTo(t) <= ab.v('roaming_radius') + ab.v('attack_radius') * 0.5 ? NOW : null),
  cast(ab) {
    const u = ab.owner; if (u.hasModifier(DW_AWAY)) return;
    const t = aiTarget(u) || u.world.nearestEnemy(u);
    const m = addMod(ab, u, DW_BEDLAM, ab.v('roaming_duration'));
    if (m) m.z = t ? Math.atan2(t.y - u.y, t.x - u.x) : 0;
  },
});
passive('dark_willow_pixie_dust', {
  fid: 'full', dynamic: true,
  stats: (m) => { const st = m.parent.st; const away = st[ST.UNTARGETABLE] > 0 || st[ST.INVULN] > 0 || st[ST.OUT] > 0; return { hpRegenAmp: m.v(away ? 'hp_regen_amp_out_of_world' : 'hp_regen_amp'), manaRegenAmp: m.v(away ? 'mana_regen_amp_out_of_world' : 'mana_regen_amp') }; },
});
// [L] measured in Hero Demo: the fear also silences, disarms and mutes; the unit runs towards its fountain at its movement speed.
// The sandbox has no map: the Dire fountain is taken to lie where it lies seen from the demo arena (up and to the right), the
// Radiant one in the opposite direction.
const FOUNTAIN_DIR = [0.84, 0.543];
debuff('modifier_dark_willow_terrorize_fear', {
  state: ['FEAR', 'SILENCE', 'DISARM', 'MUTE'], interval: (m) => m.parent.world.dt,
  onThink(m) { const t = m.parent; if (t.st[ST.ROOT] > 0 || t.isDisabled() || t.ms <= 0) return; const k = (t.team === 0 ? -1 : 1) * t.ms * t.world.dt; t.x += FOUNTAIN_DIR[0] * k; t.y += FOUNTAIN_DIR[1] * k; },
});
modifier(DW_AWAY, { hidden: true, purge: 'none' });
defAbility('dark_willow_terrorize', {
  fid: 'approx', prio: 85,
  note: 'fear (with silence, disarm and mute) lands after the wisp travel time; feared units run towards their fountain, whose direction is a fixed one per team here (no map). Bedlam is locked while the wisp is away (travel + return travel)',
  ai: (ab, u, t) => (t && t.isHero && !u.hasModifier(DW_BEDLAM) && !u.hasModifier(DW_AWAY) ? { x: t.x, y: t.y } : null),
  cast(ab, t, x, y) {
    const u = ab.owner; const w = u.world; const d = dirTo(u.x, u.y, x, y)[2]; const fly = d / ab.v('destination_travel_speed'); const dur = ab.v('destination_status_duration');
    addMod(ab, u, DW_AWAY, fly + d / ab.v('return_travel_speed'));   // [L] the wisp turns back as soon as it has arrived
    w.after(fly, () => {
      if (!lands(w)) return;
      for (const e of foes(ab, x, y, ab.v('destination_radius'))) { if (ab.v('impact_damage') > 0) hit(ab, e, ab.v('impact_damage'), MAGICAL); addMod(ab, e, 'modifier_dark_willow_terrorize_fear', dur); }
    });
  },
});

// ================================================================ Grimstroke
const GRIM_TRAIL = 'modifier_grimstroke_ink_trail_debuff';
// Ink Trail: enemy heroes touched by Grimstroke's attacks and spells deal less damage to him (Break stops new applications)
function grimTrail(grim, t) {
  const it = grim.findAbility('grimstroke_ink_trail'); const p = it && it.mods[0];
  if (p && p.active() && t.alive && t.isHero && t.team !== grim.team) t.addModifier(GRIM_TRAIL, { caster: grim, ability: it, duration: it.v('debuff_duration') });
}
modifier(GRIM_TRAIL, { debuff: true, statusResist: false, outgoing(m, d) { if (d.dst === m.caster) d.amount *= 1 - m.v('damage_reduction') / 100; } });
passive('grimstroke_ink_trail', {
  fid: 'full', illusion: true, note: 'the ink trail itself (vision) has no effect here',
  onDealDamage(m, d) { const u = m.parent; if (d.dst !== u) grimTrail(u.isIllusion && u.owner ? u.owner : u, d.dst); },
});

debuff('modifier_grimstroke_dark_artistry', { stats: (m) => ({ msPct: -m.v('movement_slow_pct') }) });
defAbility('grimstroke_dark_artistry', {
  fid: 'approx', prio: 55,
  note: 'straight stroke (alt-cast path) of cast-range length; targets are taken from their positions at cast time, ordered along the path, and hit after the travel delay',
  ai: (ab, u, t) => (t && u.distTo(t) <= ab.castRange() - 100 ? { x: t.x, y: t.y } : null),
  cast(ab, t, x, y) {
    const u = ab.owner; const w = u.world; const [dx, dy] = dirTo(u.x, u.y, x, y); const len = ab.castRange();
    if (!lands(w)) return;
    let bonus = 0;
    for (const [d, e] of lineEnemies(u, u.x, u.y, u.x + dx * len, u.y + dy * len, ab.v('start_radius'), ab.v('end_radius'))) {
      const dmg = ab.v('damage') + bonus;
      bonus += e.isHero && !e.isIllusion ? ab.v('bonus_damage_per_hero') : ab.v('bonus_damage_per_creep');
      w.after(d / ab.v('projectile_speed'), () => { if (!e.alive) return; hit(ab, e, dmg, MAGICAL); addMod(ab, e, 'modifier_grimstroke_dark_artistry', ab.v('slow_duration')); });
    }
  },
});

// Phantom's Embrace: the latched phantom is a real unit (shipped phantom unit) that only attacks can hurt, one pip per hero attack
const GRIM_LATCH = 'modifier_grimstroke_ink_creature';
modifier('modifier_grimstroke_ink_creature_unit', {
  hidden: true, purge: 'none',
  preMit(m, d) { if (!(d.flags & F_ATTACK) || (d.flags & F_SECONDARY)) d.amount = 0; },
  postMit(m, d) { if (d.amount > 0) d.amount = d.src && d.src.isHero && !d.src.isIllusion ? 1 : 0.25; },   // creeps and illusions: 25% (tooltip text)
  onDeath(m) { const l = m.data.latch; if (!l.removed) { l.data.killed = true; l.remove(); } },
});
modifier(GRIM_LATCH, {
  // [L] measured in Hero Demo: the first tick lands on the latch, the tick on expiry is replaced by the rend (10 ticks + rend)
  debuff: true, multi: 'independent', purge: 'none', statusResist: false, state: ['SILENCE'], interval: (m) => m.v('tick_interval'), thinkNow: true,
  onThink(m) {
    const t = m.parent; const ph = m.data.phantom;
    if (!ph.alive || t.isImmune() || (t.st[ST.INVIS] > 0 && !t.world.detectAll)) { m.remove(); return; }   // destroyed, or falls off
    ph.x = t.x + 30; ph.y = t.y;
    mhit(m, t, m.v('damage_per_second') * m.v('tick_interval'), MAGICAL);
  },
  onDestroy(m, expired) {
    const t = m.parent; const c = m.caster; const w = t.world; const d = m.data; const ph = d.phantom; const lived = ph.alive && !d.killed;
    if (lived) w.kill(ph, null, null, true);
    if (!lived || (t.alive && !expired)) return;                           // destroyed by attacks or fell off: nothing more happens
    if (t.alive) mhit(m, t, m.v('pop_damage'), MAGICAL);                    // survived the full latch: rend
    // she returns (also when the victim died) from her latched spot (latched_unit_offset from the victim) and refreshes the cooldown
    w.after(Math.max(0, c.distTo(t) - m.v('latched_unit_offset')) / m.v('return_projectile_speed'), d.refresh);
  },
});
defAbility('grimstroke_ink_creature', {
  fid: 'approx', prio: 65,
  note: 'the phantom has destroy_attacks pips (hero attack 1, creep or illusion attack 0.25) and ignores all other damage; enemies only attack her if their controller picks her as a target. The cooldown is refreshed when she returns after a full latch or after the victim died (7.40 patch note)',
  ai: (ab, u, t) => (t && t.heroLike && !t.hasModifier(GRIM_LATCH) ? { target: t } : null),
  cast(ab, t) {
    const u = ab.owner; const w = u.world; let arrived = false;
    if (!t) return;
    const refresh = () => { if (ab.cdEnd > w.time) ab.cdEnd = w.time; };
    // [L] measured in Hero Demo: from 500 away the phantom latches 0.27 s after the cast (it stops about latched_unit_offset + 60
    // short of the victim's centre); the flight is timed from the distance at cast time
    w.after(Math.max(0, u.distTo(t) - ab.v('latched_unit_offset') - 60) / ab.v('speed'), () => {
      const tt = t; if (!tt.alive) return;
      arrived = true;
      if (tt.isImmune()) return;
      const dur = ab.v('latch_duration');
      const ph = summon(ab, 'npc_dota_grimstroke_ink_creature', { x: tt.x + 30, y: tt.y, duration: dur + 2, ai: 'idle', ovr: { hp: ab.v('destroy_attacks') } });
      const m = tt.addModifier(GRIM_LATCH, { caster: u, ability: ab, duration: dur, data: { phantom: ph, refresh, killed: false } });
      if (m) ph.addModifier('modifier_grimstroke_ink_creature_unit', { caster: u, ability: ab, data: { latch: m } }); else w.kill(ph, null, null, true);
    });
    w.after(u.distTo(t) / ab.v('speed') + 1, () => { if (!arrived && !t.alive) refresh(); });
  },
});

const GRIM_SWELL = 'modifier_grimstroke_spirit_walk';
// Ink Swell damage (+Shard bonus) with the Shard heal for the carrier
function grimSwellHit(m, e, amount) {
  const t = m.parent; const dealt = mhit(m, e, amount * (1 + m.v('shard_bonus_damage_pct') / 100), MAGICAL);
  if (dealt > 0 && m.v('shard_heal_pct') > 0 && t.alive) t.heal(dealt * m.v('shard_heal_pct') / 100 * (e.heroLike ? 1 : m.v('shard_creep_penalty')), m.caster, m.ability);
}
buff(GRIM_SWELL, {
  stats: (m) => ({ msPct: m.v('movespeed_bonus_pct') }), interval: (m) => m.v('tick_rate'),
  // x = seconds an enemy hero was inside the tendril range (capped at max_threshold_duration)
  onThink(m) {
    const t = m.parent; let hero = false;
    for (const e of foesOf(m.caster, t.x, t.y, m.v('radius'))) { if (e.isHero) hero = true; grimSwellHit(m, e, m.v('damage_per_tick')); }
    if (hero) m.x = Math.min(m.v('max_threshold_duration'), m.x + m.v('tick_rate'));
  },
  onDestroy(m, expired) {
    const t = m.parent; const f = m.x / m.v('max_threshold_duration');
    if (!expired || f <= 0) return;
    for (const e of foesOf(m.caster, t.x, t.y, m.v('radius'))) { grimSwellHit(m, e, m.v('max_damage') * f); if (e.alive) e.addModifier('modifier_stunned', { caster: m.caster, ability: m.ability, duration: m.v('max_stun') * f }); }
  },
});
defAbility('grimstroke_spirit_walk', {
  fid: 'full', prio: 60,
  note: 'cast on the allied hero-like unit (Grimstroke included) standing closest to the target; Shard creep heal penalty read as a 0.2 multiplier',
  ai(ab, u, t, w) {
    if (!t) return null;
    let best = null; let bd = ab.v('radius') + 100;
    for (const a of w.units) { if (!a.alive || a.team !== u.team || !a.heroLike || a.st[ST.OUT] > 0 || a.hasModifier(GRIM_SWELL) || u.distTo(a) > ab.castRange() + 100) continue; const d = a.distTo(t); if (d < bd) { bd = d; best = a; } }
    return best ? { target: best } : null;
  },
  cast(ab, t) { const tt = t || ab.owner; if (ab.owner.hasShard) tt.purge({ debuffs: true }); addMod(ab, tt, GRIM_SWELL, ab.v('buff_duration')); },   // [L] the tick on expiry is replaced by the release (14 ticks at 3 s / 0.2 s)
});
modifier('modifier_grimstroke_dark_portrait', { hidden: true, purge: 'none', state: ['IMMUNE'], stats: (m) => ({ mr: m.v('immunity_resist'), msPct: m.v('images_movespeed_bonus') }), onAttackLanded(m, rec) { grimTrail(m.caster, rec.target); } });
defAbility('grimstroke_dark_portrait', {
  fid: 'full', prio: 60, note: 'the portrait attacks the hero it was drawn from',
  ai: (ab, u, t) => (t && t.isHero && !t.isIllusion ? { target: t } : null),
  cast(ab, t) {
    const u = ab.owner; if (!t) return;
    const il = u.world.createIllusion(t, { team: u.team, owner: u, duration: ab.v('illusion_duration'), outPct: ab.v('images_do_damage_percent'), inPct: ab.v('images_take_damage_percent'), potency: ab.v('illusion_effectiveness'), x: t.x + 80, y: t.y + 50, target: t });
    il.addModifier('modifier_grimstroke_dark_portrait', { caster: u, ability: ab });
    grimTrail(u, t);
  },
});

// Soulbind
const GRIM_BIND = 'modifier_grimstroke_soul_chain';
function grimPartner(t, r) {
  let best = null; let bd = r;
  for (const o of t.world.units) { if (o === t || !o.alive || o.team !== t.team || !o.isHero || o.isIllusion || o.st[ST.OUT] > 0 || o.hasModifier(GRIM_BIND)) continue; const d = t.distTo(o); if (d <= bd) { bd = d; best = o; } }
  return best;
}
function grimBind(m) {
  const t = m.parent; const o = grimPartner(t, m.v('chain_latch_radius'));
  const om = o ? o.addModifier(GRIM_BIND, { caster: m.caster, ability: m.ability, duration: Math.max(0.05, m.remaining()), pierce: true, noResist: true, data: { other: t, primary: false } }) : null;
  if (om) { m.data.other = o; grimTrail(m.caster, o); }
}
modifier('modifier_grimstroke_soul_chain_echo', { hidden: true, multi: 'independent', purge: 'none', outgoing(m, d) { if (d.ability === m.data.ability && d.dst === m.data.target) d.amount *= 1 + m.data.pct / 100; } });
modifier(GRIM_BIND, {
  debuff: true, pierce: true, purge: 'none', state: ['LEASH'], interval: 0.1,
  onThink(m) {
    const t = m.parent; let o = m.data.other;
    if (o && (!o.alive || !o.hasModifier(GRIM_BIND))) o = m.data.other = null;
    if (!o) { if (m.data.primary) grimBind(m); return; }           // bind broken: look for the next nearest allied hero
    // neither may move away from the other: whoever moved since the last check is put back at the limit (x, y = last position)
    const [dx, dy, d] = dirTo(o.x, o.y, t.x, t.y); const max = m.v('chain_break_distance');
    if (d > max && (t.x !== m.x || t.y !== m.y)) { t.x = o.x + dx * max; t.y = o.y + dy * max; }
    m.x = t.x; m.y = t.y;
  },
  // unit-targeted abilities cast on one bound hero are repeated on the other
  onSpellTargeted(m, ev) {
    const o = m.data.other; const a = ev.ability; const sc = a.script;
    if (grimEcho || !o || !o.alive || a.isItem || !sc || !sc.cast || !o.targetable() || (o.isImmune() && !a.pierces)) return;
    const pct = m.v('bonus_reflected_spell_damage');
    if (pct > 0) ev.caster.addModifier('modifier_grimstroke_soul_chain_echo', { duration: Math.max(0.1, m.remaining()), data: { ability: a, target: o, pct } });
    grimEcho = true;
    try { sc.cast(a, o, o.x, o.y); } finally { grimEcho = false; }
  },
  onDestroy(m) { const o = m.data.other; if (m.data.primary && o && o.alive) o.removeModifierByName(GRIM_BIND); },
});
defAbility('grimstroke_soul_chain', {
  fid: 'approx', prio: 85,
  note: 'bound heroes are tethered at the break distance (blinks are not prevented); a unit-targeted ability (not items) cast on one is run a second time on the other, so caster-side effects of that spell repeat too. The talent raises the damage that spell deals to the second hero for the rest of the bind. creep_duration_pct is unused. The controller only casts it when a second enemy hero is in bind radius',
  ai: (ab, u, t) => (t && t.isHero && !t.isIllusion && !t.hasModifier(GRIM_BIND) && grimPartner(t, ab.v('chain_latch_radius')) ? { target: t } : null),
  cast(ab, t) {
    if (!t) return;
    const m = addMod(ab, t, GRIM_BIND, ab.v('chain_duration'), { pierce: true, data: { other: null, primary: true } });
    grimTrail(ab.owner, t);
    if (m && m.data.primary && !m.data.other) grimBind(m);
  },
});

// ================================================================ Mars
const MARS_ARENA = 'mars_arena_of_blood';
const marsInside = (a, o) => (o.x - a.x) ** 2 + (o.y - a.y) ** 2 <= a.r * a.r;
const marsArena = (u) => { const ab = u.findAbility(MARS_ARENA); return ab && ab.data && ab.data.live ? ab.data : null; };
// Where does a hero skewered at (px, py) and carried towards (ex, ey) get impaled? Arena of Blood wall or a building; null = nothing in the way.
function marsImpalePoint(u, px, py, ex, ey, width) {
  const [dx, dy, len] = dirTo(px, py, ex, ey); let best = Infinity;
  const a = marsArena(u);
  if (a) {
    // |P + k*D - C| = r
    const fx = px - a.x; const fy = py - a.y; const b = fx * dx + fy * dy; const disc = b * b - (fx * fx + fy * fy - a.r * a.r);
    if (disc >= 0) for (const k of [-b - Math.sqrt(disc), -b + Math.sqrt(disc)]) if (k > 1e-6 && k <= len && k < best) best = k;
  }
  for (const o of u.world.units) {
    if (!o.alive || !o.isBuilding) continue;
    const k = (o.x - px) * dx + (o.y - py) * dy; const off = Math.abs((o.x - px) * dy - (o.y - py) * dx);
    if (k > 0 && k <= len && off <= width + o.def.hull && k - o.def.hull < best) best = Math.max(0, k - o.def.hull);
  }
  return best === Infinity ? null : [px + dx * Math.max(0, best - 30), py + dy * Math.max(0, best - 30)];
}
debuff('modifier_mars_spear_trail', { stats: (m) => ({ msPct: -m.v('shard_move_slow_pct') }) });
defAbility('mars_spear', {
  fid: 'approx', prio: 70,
  note: 'targets are taken from their positions at cast time and hit after the travel delay. The first hero(es) are carried to the end of the spear range in one step; they are stunned while carried; the impale stun only happens when the way crosses the Arena of Blood wall or a building, because trees and cliffs do not exist here. Other units are pushed away from Mars by the knockback distance. Shard fire trail ticks at the shipped interval along the full path',
  ai: (ab, u, t) => (t && !t.isBuilding && u.distTo(t) <= ab.v('spear_range') - 100 ? { x: t.x, y: t.y } : null),
  cast(ab, t, x, y) {
    const u = ab.owner; const w = u.world; const [dx, dy] = dirTo(u.x, u.y, x, y); const len = ab.v('spear_range'); const wd = ab.v('spear_width');
    const sx = u.x; const sy = u.y; const ex = sx + dx * len; const ey = sy + dy * len;
    if (lands(w)) {
      let skewers = ab.v('max_impale_targets');
      for (const [d, e] of lineEnemies(u, sx, sy, ex, ey, wd)) {
        const carry = e.isHero && skewers > 0; if (carry) skewers--;
        w.after(d / ab.v('spear_speed'), () => {
          if (!e.alive) return;
          hit(ab, e, ab.v('damage'), MAGICAL);
          if (!e.alive || e.isImmune()) return;
          if (!carry) { knockback(e, sx, sy, ab.v('knockback_distance')); return; }
          // [L] measured in Hero Demo: a carried hero is stunned while the spear carries it (remaining distance / spear speed),
          // also when nothing stops the spear
          const pin = marsImpalePoint(u, e.x, e.y, ex, ey, wd);
          const carryT = dirTo(e.x, e.y, pin ? pin[0] : ex, pin ? pin[1] : ey)[2] / ab.v('spear_speed');
          if (pin) { e.x = pin[0]; e.y = pin[1]; stun(ab, e, carryT + ab.v('stun_duration')); } else { stun(ab, e, carryT); e.x = ex; e.y = ey; }
        });
      }
    }
    const iv = ab.v('shard_interval');
    if (ab.v('shard_trail_duration') > 0 && iv > 0) for (let i = 1; i * iv <= ab.v('shard_trail_duration') + 1e-9; i++) {
      w.after(i * iv, () => { for (const [, e] of lineEnemies(u, sx, sy, ex, ey, ab.v('shard_trail_radius'))) { hit(ab, e, ab.v('shard_dps') * iv, MAGICAL); addMod(ab, e, 'modifier_mars_spear_trail', ab.v('shard_debuff_linger_duration')); } });
    }
  },
});
debuff('modifier_mars_gods_rebuke_slow', { stats: (m) => ({ msPct: -m.v('knockback_slow') }) });
modifier('modifier_mars_gods_rebuke', {
  hidden: true,
  onAttack(m, rec) { if (rec.fromAbility !== m.ability) return; const c = m.v('crit_mult') / 100; if (c > rec.crit) rec.crit = c; if (rec.target.isHero) rec.flat += m.v('bonus_damage_vs_heroes'); },
});
defAbility('mars_gods_rebuke', {
  mods: ['modifier_mars_gods_rebuke'], fid: 'approx', prio: 65,
  note: 'cone towards the cast point; every enemy in it takes an instant True Strike attack with the critical multiplier (bonus damage against heroes is added before the crit), then knockback and slow',
  ai: (ab, u, t) => (t && !t.isBuilding && u.distTo(t) <= ab.v('radius') - 60 ? { x: t.x, y: t.y } : null),
  cast(ab, t, x, y) {
    const u = ab.owner; const [dx, dy] = dirTo(u.x, u.y, x, y);
    for (const e of coneEnemies(u, u.x, u.y, dx, dy, ab.v('radius'), ab.v('angle') * Math.PI / 360)) {
      if (!e.attackableBy(u)) continue;
      u.world.launchAttack(u, e, { instant: true, trueStrike: true, fromAbility: ab });
      if (!e.alive) continue;
      knockback(e, u.x, u.y, ab.v('knockback_distance'));
      addMod(ab, e, 'modifier_mars_gods_rebuke_slow', ab.v('knockback_slow_duration'));
    }
  },
});
// Bulwark. Facing is taken from who Mars is fighting: he looks at his current target (or along the locked direction while toggled on).
function marsFront(u) {
  const act = u.findModifier('modifier_mars_bulwark_active');
  if (act) return [act.x, act.y];
  const t = [u.attackTarget, u.orderTarget, aiTarget(u)].find((o) => o && o.alive);
  return t ? dirTo(u.x, u.y, t.x, t.y) : null;
}
modifier('modifier_mars_bulwark', {
  hidden: true,
  postMit(m, d) {
    const u = m.parent; const a = d.src;
    if (d.amount <= 0 || d.type !== PHYSICAL || (d.flags & (F_ATTACK | F_SECONDARY)) !== F_ATTACK || !a || a === u) return;
    const f = marsFront(u); let deg = 0;
    if (f) { const [ax, ay] = dirTo(u.x, u.y, a.x, a.y); deg = Math.acos(Math.max(-1, Math.min(1, f[0] * ax + f[1] * ay))) * 180 / Math.PI; }
    const red = deg <= m.v('forward_angle') / 2 ? m.v('physical_damage_reduction') : deg <= m.v('side_angle') / 2 ? m.v('physical_damage_reduction_side') : 0;
    d.amount *= 1 - red / 100;
  },
});
modifier('modifier_mars_bulwark_cover', {
  hidden: true, purge: 'none',
  // an attack projectile aimed at a covered ally may be taken by Mars instead
  onPreAttacked(m, rec) {
    const mars = m.caster; const t = m.parent; const act = mars.findModifier('modifier_mars_bulwark_active');
    if (!rec.ranged || rec.viaBulwark || rec.attacker.team === t.team || !mars.alive || !act || mars.st[ST.OUT] > 0) return;
    const [ax, ay, d] = dirTo(mars.x, mars.y, t.x, t.y);
    if (d > m.v('redirect_close_range') && ax * act.x + ay * act.y > 0) return;   // only allies behind Mars or right next to him
    const p = m.v('redirect_chance');
    if (p < 100 && !mars.world.rng.chance(p / 100)) return;
    rec.cancel = true;
    const copy = Object.assign(Object.create(Object.getPrototypeOf(rec)), rec, { target: mars, cancel: false, viaBulwark: true });
    mars.world.landAttack(copy);
  },
});
buff('modifier_mars_bulwark_active', {
  purge: 'none', state: ['DISARM'], stats: (m) => ({ msPct: -m.v('redirect_speed_penatly') }), interval: 0.5, thinkNow: true,
  // x, y = locked facing direction
  onThink(m) { const u = m.parent; for (const a of u.world.alliesInRadius(u, u.x, u.y, m.v('redirect_range'))) if (a !== u) a.addModifier('modifier_mars_bulwark_cover', { caster: u, ability: m.ability, duration: 0.75 }); },
});
defAbility('mars_bulwark', {
  mods: ['modifier_mars_bulwark'], manual: true, fid: 'approx', prio: 10,
  note: 'passive block: an attacker counts as frontal when Mars is fighting it, other attackers by their angle to the direction of his current target (frontal when he has no target). The toggle (disarm, slow, 70% redirect of ranged attacks aimed at allies behind him or within redirect_close_range) is manual: the default controller never gives up its attacks; list it in ai.order to switch it on once',
  ai: (ab, u, t) => (t && !ab.toggled ? { x: t.x, y: t.y } : null),
  cast(ab, t, x, y) {
    const u = ab.owner; ab.toggled = !ab.toggled;
    if (!ab.toggled) { u.removeModifierByName('modifier_mars_bulwark_active'); return; }
    const m = addMod(ab, u, 'modifier_mars_bulwark_active'); const f = dirTo(u.x, u.y, x, y);
    if (m) { m.x = f[0]; m.y = f[1]; }
  },
});
passive('mars_dauntless', {
  fid: 'approx', note: 'outnumbered = enemy heroes in the radius beyond the first (allies are not counted, 7.41 patch note); the count is refreshed every 0.5 s',
  interval: 0.5, thinkNow: true, stats: (m) => ({ hpRegenAmp: m.v('health_regen_per_enemy') * m.stacks }),
  onThink(m) { const u = m.parent; let n = 0; for (const e of foesOf(u, u.x, u.y, m.v('radius'))) if (e.isHero && !e.isIllusion) n++; m.setStacks(Math.max(0, n - 1)); },
});
modifier('modifier_mars_arena_of_blood_guard', {
  hidden: true, purge: 'none', multi: 'perCaster',
  onPreAttacked(m, rec) { const a = m.data; if (a.live && rec.attacker.team !== m.parent.team && marsInside(a, rec.attacker) !== marsInside(a, m.parent)) rec.cancel = true; },
});
buff('modifier_mars_arena_of_blood_regen', { purge: 'none', stats: (m) => ({ hpRegen: m.v('health_regen') }) });
buff('modifier_mars_arena_of_blood_kill_buff', { multi: 'independent', purge: 'none', stats: (m) => ({ dmgBasePct: m.v('arena_kill_buff_damage_pct') }) });
modifier('modifier_mars_arena_of_blood_watch', {
  hidden: true, purge: 'none',
  onAnyDeath(m, ev) {
    const a = m.data; const u = m.parent; const ab = m.ability; const v = ev.victim; const pct = ab.v('arena_kill_buff_heal_pct');
    if (!a.live || v.team === u.team || ab.v('arena_kill_buff_duration') <= 0 || !marsInside(a, v)) return;
    for (const o of u.world.units) {
      if (!o.alive || o.team !== u.team || o.st[ST.OUT] > 0 || (o !== u && !marsInside(a, o))) continue;
      o.heal(o.maxHp * pct / 100, u, ab); o.giveMana(o.maxMana * pct / 100);
      o.addModifier('modifier_mars_arena_of_blood_kill_buff', { caster: u, ability: ab, duration: ab.v('arena_kill_buff_duration') });
    }
  },
});
function marsArenaTick(ab, a, n) {
  const u = ab.owner; const w = u.world; const us = w.units; const R = a.r; const edge = R - ab.v('spear_distance_from_wall');
  for (let i = 0; i < us.length; i++) {
    const e = us[i];
    if (!e.alive || e.st[ST.OUT] > 0) continue;
    const dx = e.x - a.x; const dy = e.y - a.y; let d = Math.sqrt(dx * dx + dy * dy);
    if (e.team === u.team) {
      if (n % 15 !== 0) continue;
      e.addModifier('modifier_mars_arena_of_blood_guard', { caster: u, ability: ab, duration: 0.6, data: a });
      if (d <= R && ab.v('health_regen') > 0) e.addModifier('modifier_mars_arena_of_blood_regen', { caster: u, ability: ab, duration: 0.6 });
      continue;
    }
    if (e.isBuilding) continue;
    // walls: an enemy keeps the side it was on; a jump of more than 400 units in one tick is taken as a blink and respected
    const last = a.last.get(e); let inside = a.side.get(e);
    if (inside === undefined || (last && (e.x - last[0]) ** 2 + (e.y - last[1]) ** 2 > 160000)) { inside = d <= R; a.side.set(e, inside); }
    const pad = e.def.hull + 10; const lim = inside ? R - pad : R + pad;
    if (d > 1e-6 && (inside ? d > lim : d < lim)) { e.x = a.x + dx / d * lim; e.y = a.y + dy / d * lim; d = lim; }
    // spears of the warriors lining the wall
    if (inside && e.isHero && d > edge && !e.isImmune() && w.time >= (a.spear.get(e) || 0)) {
      a.spear.set(e, w.time + ab.v('spear_attack_interval'));
      hit(ab, e, ab.v('spear_damage'), MAGICAL);
      if (e.alive && d > 1e-6) { const to = Math.max(0, edge - 20); e.x = a.x + dx / d * to; e.y = a.y + dy / d * to; }
    }
    if (last) { last[0] = e.x; last[1] = e.y; } else a.last.set(e, [e.x, e.y]);
  }
}
defAbility(MARS_ARENA, {
  fid: 'approx', prio: 85,
  note: 'circular wall checked every tick: enemies cannot walk or be pushed across it (a jump of more than 400 units counts as a blink), enemy attacks across the wall are cancelled, enemy heroes within spear distance of the inside edge are hit once per spear interval and thrown back out of that band (knockback distance is not in the data). Scepter: any enemy unit dying inside heals and buffs Mars and allied units inside (stacking, read as bonus % of base damage); talent regen for allies inside. Debuff-immune heroes are still walled in but not speared',
  ai: (ab, u, t) => (t && t.isHero && !t.isIllusion && !marsArena(u) ? { x: t.x, y: t.y } : null),
  cast(ab, t, x, y) {
    const u = ab.owner; const w = u.world; const dur = ab.v('duration');
    w.after(ab.v('formation_time'), () => {
      const a = { x, y, r: ab.v('radius'), live: true, side: new Map(), last: new Map(), spear: new Map() }; const end = w.time + dur; let n = 0;
      ab.data = a;
      if (u.alive) u.addModifier('modifier_mars_arena_of_blood_watch', { ability: ab, duration: dur, data: a });
      const tick = () => { if (w.time >= end - 1e-9) { a.live = false; return; } marsArenaTick(ab, a, n++); w.after(w.dt, tick); };
      tick();
    });
  },
});

// ================================================================ Primal Beast
const PB_TRAMPLE = 'modifier_primal_beast_trample'; const PB_UPROAR = 'modifier_primal_beast_uproar';
// Colossal gives a percentage area bonus (engine stat aoePct: ab.v() scales every value the game flags as area-scaled)
passive('primal_beast_colossal', {
  fid: 'full', note: 'slow resistance and percentage area bonus (aoePct) by health thresholds',
  // z = current bonus area of effect in %
  late(m, s, u) {
    const o = u.ovr; const hp = ((o && o.hp !== undefined ? o.hp : u.def.hp) + C.HP_PER_STR * u.str + s.hp) * (1 + s.hpPct / 100);
    const k = Math.floor(hp / m.v('hp_per_threshold')); const mult = m.v('trample_bonus') > 0 && u.hasModifier(PB_TRAMPLE) ? m.v('trample_bonus') : 1;
    m.z = (m.v('base_aoe') + m.v('aoe_per_threshold') * k) * mult;
    s.aoePct += m.z;
    s.slowResMul *= 1 - Math.min(100, (m.v('base_slow_resist') + m.v('slow_resistance_per_threshold') * k) * mult) / 100;
  },
});

// Onslaught [L] measured in Hero Demo: the charge-up (disarmed) lasts until the release or chargeup_time; the power is the charge
// time over max_charge_time (at least base_power, at most 1), the run covers power x max_distance at charge_speed (disarmed,
// movement speed 0); enemies within knockback_radius are hit on the first tick they are reached
const PB_ONS_RELEASE = 'primal_beast_onslaught_release';
function pbOnsRun(ab, plan) {
  const u = ab.owner; const w = u.world;
  if (plan.running || ab.data !== plan || u.channelAb !== ab || !u.alive) return;
  plan.running = true;
  const f = Math.min(1, Math.max(ab.v('base_power'), (w.time - plan.start) / ab.v('max_charge_time'))); const far = f * ab.v('max_distance');
  plan.run = far / ab.v('charge_speed'); u.channelEnd = w.time + plan.run;
  u.removeModifierByName('modifier_primal_beast_onslaught_windup');
  u.addModifier('modifier_primal_beast_onslaught_run', { ability: ab, duration: plan.run + 0.2, data: { dx: plan.dx, dy: plan.dy, left: far, seen: new Set() } });
}
modifier('modifier_primal_beast_onslaught_windup', {
  hidden: true, purge: 'none', statusResist: false, state: ['DISARM'], interval: (m) => m.parent.world.dt,
  // a release order given while charging (orders wait while a channel runs)
  onThink(m) { const u = m.parent; if (u.order === ORDER.CAST && u.orderAb && u.orderAb.name === PB_ONS_RELEASE) { u.order = ORDER.NONE; pbOnsRun(m.ability, m.data); } },
  onDestroy(m, expired) { if (expired) pbOnsRun(m.ability, m.data); },
});
modifier('modifier_primal_beast_onslaught_run', {
  hidden: true, purge: 'none', state: ['DISARM'], stats: { msCap: 0.01 }, interval: (m) => m.parent.world.dt,
  // data: { dx, dy, left, seen }
  onThink(m) {
    const u = m.parent; const w = u.world; const d = m.data; const ab = m.ability;
    if (u.st[ST.ROOT] > 0 || u.st[ST.STUN] > 0 || d.left <= 1e-6) { m.remove(); return; }
    const go = Math.min(d.left, ab.v('charge_speed') * w.dt); u.x += d.dx * go; u.y += d.dy * go; d.left -= go;
    for (const e of w.units) {
      if (e === u || !e.alive || e.isBuilding || e.st[ST.OUT] > 0 || d.seen.has(e) || u.distTo(e) > ab.v('knockback_radius') + e.def.hull) continue;
      d.seen.add(e);
      if (e.team !== u.team) { hit(ab, e, ab.v('knockback_damage'), PHYSICAL); if (!e.alive) continue; stun(ab, e, ab.v('stun_duration')); }
      if (!(e.team !== u.team && e.isImmune())) knockback(e, u.x, u.y, ab.v('knockback_distance'));
    }
  },
});
defAbility('primal_beast_onslaught', {
  fid: 'approx', prio: 78,
  note: 'charge-up until the release order or chargeup_time, then the run; a unit with a fight controller releases as soon as the run reaches its target. Charge-up and run are one channel (turning is not modelled: the run goes towards the cast point); units in the path are hit once and knocked away from Primal Beast',
  channel: (ab) => ab.data.charge + ab.data.run,
  ai: (ab, u, t) => (t && !t.isBuilding && !u.isRooted() && !u.hasModifier(PB_TRAMPLE) && u.distTo(t) <= ab.v('max_distance') ? { x: t.x, y: t.y } : null),
  cast(ab, t, x, y) {
    const u = ab.owner; const w = u.world; const [dx, dy, d] = dirTo(u.x, u.y, x, y); const up = ab.v('chargeup_time');
    const auto = u.ai && u.ai.mode !== 'idle';   // the controller lets go once the run is long enough; otherwise the charge runs out
    const charge = auto ? Math.min(up, Math.max(ab.v('base_power'), d / ab.v('max_distance')) * ab.v('max_charge_time')) : up;
    const plan = ab.data = { dx, dy, start: w.time, charge, run: ab.v('max_distance') / ab.v('charge_speed') + 0.1, running: false };
    u.addModifier('modifier_primal_beast_onslaught_windup', { ability: ab, duration: charge, data: plan });
  },
  channelEnd(ab, interrupted) {
    const u = ab.owner; u.removeModifierByName('modifier_primal_beast_onslaught_windup');
    if (interrupted) u.removeModifierByName('modifier_primal_beast_onslaught_run');
  },
});
defAbility(PB_ONS_RELEASE, {
  fid: 'full', manual: true, note: 'a release order given while Onslaught charges is picked up by the charge-up modifier (orders wait while a channel runs)',
  cast(ab) { const o = ab.owner.findAbility('primal_beast_onslaught'); if (o && o.data) pbOnsRun(o, o.data); },
});

buff(PB_TRAMPLE, {
  purge: 'none', state: ['DISARM'], interval: (m) => m.parent.world.dt, stats: (m) => ({ mr: m.v('bonus_magic_resistance') }),
  // x, y = position at the previous tick, z = distance walked since the last stomp
  onCreated(m) { m.x = m.parent.x; m.y = m.parent.y; pbStomp(m); },   // [L] measured in Hero Demo: one stomp on the cast
  onThink(m) {
    const u = m.parent; const w = u.world; let moved = Math.sqrt((u.x - m.x) ** 2 + (u.y - m.y) ** 2);
    // default controller: it cannot attack, so it keeps walking on top of its target (circling once it is there)
    const t = moved < 1e-6 && u.ai && u.ai.mode === 'fight' ? aiTarget(u) : null;
    if (t && !u.cantAct() && u.st[ST.ROOT] === 0 && !u.channelAb && !u.castAb && u.ms > 0) {
      const step = u.ms * w.dt; const [dx, dy, d] = dirTo(u.x, u.y, t.x, t.y); const go = Math.min(step, Math.max(0, d - 40));
      u.x += dx * go; u.y += dy * go; moved = step;
    }
    m.x = u.x; m.y = u.y; m.z += moved;
    const sd = m.v('step_distance');
    while (sd > 0 && m.z >= sd) { m.z -= sd; pbStomp(m); }
  },
});
function pbStomp(m) {
  const u = m.parent; const dmg = m.v('base_damage') + attackDamage(u) * m.v('attack_damage') / 100;
  for (const e of foesOf(u, u.x, u.y, m.v('effect_radius'))) mhit(m, e, dmg, MAGICAL);
}
defAbility('primal_beast_trample', {
  fid: 'approx', prio: 55,
  note: 'stomps every step_distance of travel (actual displacement). The default controller is assumed to keep walking on top of its target for the whole duration, so distance accrues at its movement speed',
  ai: (ab, u, t) => (t && !u.hasModifier(PB_TRAMPLE) && u.distTo(t) <= 300 ? NOW : null),
  cast(ab) { addMod(ab, ab.owner, PB_TRAMPLE, ab.v('duration')); },
});

// Uproar: stacks from hero damage; the roar converts them
modifier(PB_UPROAR, {
  purge: 'none', interval: 0.5,
  // y = time the stacks run out
  onTakeDamage(m, d) { const u = m.parent; const s = d.src; if (s && s !== u && s.team !== u.team && s.isHero && d.dealt >= m.v('damage_limit')) pbStack(m, 1); },
  onThink(m) { if (m.stacks > 0 && m.parent.world.time >= m.y) m.setStacks(0); },
});
function pbStack(m, n) { m.setStacks(Math.min(m.v('stack_limit'), m.stacks + n)); m.y = m.parent.world.time + m.v('stack_duration'); }
const takeStacks = { onRefresh(m, o) { if (o && o.stacks !== undefined) m.setStacks(o.stacks); } };
buff('modifier_primal_beast_uproar_roar', { purge: 'none', ...takeStacks, stats: (m) => ({ dmg: m.v('bonus_damage_per_stack') * m.stacks, armor: m.v('roared_bonus_armor') * m.stacks }) });
debuff('modifier_primal_beast_uproar_slow', { ...takeStacks, stats: (m) => ({ msPct: -m.v('move_slow_per_stack') * m.stacks }) });
debuff('modifier_primal_beast_uproar_break', { state: ['BREAK'], stats: () => ({}) });   // empty stats: forces a stat refresh when Break starts and ends
const PB_WAVE_GAP = 0.5;   // seconds between the Scepter projectile waves (not in the data)
function pbSplinters(ab, stacks) {
  const u = ab.owner; const w = u.world; const count = ab.v('projectiles_per_stack') * stacks; const ox = u.x; const oy = u.y;
  const range = ab.v('projectile_distance'); const width = ab.v('projectile_width'); const speed = ab.v('projectile_speed');
  const splitAt = Math.min(range, ab.v('split_delay') * speed); const pieces = ab.v('max_split_amount'); const fan = ab.v('splinter_angle') * Math.PI / 180;
  if (count < 1 || speed <= 0) return;
  const strike = (e, delay) => w.after(delay, () => { if (!e.alive) return; hit(ab, e, ab.v('projectile_damage'), MAGICAL); if (e.alive) addMod(ab, e, 'modifier_primal_beast_uproar_break', ab.v('projectile_break_duration')); });
  for (let k = 0; k < ab.v('projectile_waves'); k++) {
    w.after(k * PB_WAVE_GAP, () => {
      const turn = w.rng.next() * 2 * Math.PI;
      for (let i = 0; i < count; i++) {
        const a = turn + 2 * Math.PI * i / count; const seen = new Set();   // an enemy is hit once per projectile and its splinters
        const mx = ox + Math.cos(a) * splitAt; const my = oy + Math.sin(a) * splitAt;
        for (const [d, e] of lineEnemies(u, ox, oy, mx, my, width)) { seen.add(e); strike(e, d / speed); }
        if (splitAt >= range || pieces < 1) continue;
        for (let j = 0; j < pieces; j++) {
          const b = a + (pieces > 1 ? fan * (j / (pieces - 1) - 0.5) : 0); const rest = range - splitAt;
          for (const [d, e] of lineEnemies(u, mx, my, mx + Math.cos(b) * rest, my + Math.sin(b) * rest, width)) { if (seen.has(e)) continue; seen.add(e); strike(e, (splitAt + d) / speed); }
        }
      }
    });
  }
}
defAbility('primal_beast_uproar', {
  mods: [PB_UPROAR], fid: 'approx', prio: 90,
  note: 'stacks (hero damage instances of damage_limit or more after reductions) share one refreshed timer; the roar consumes them. The controller roars at the stack limit, or at half of it when no roar is running. Scepter: each wave is a ring of straight projectiles with a random rotation, 0.5 s between waves (not in the data), each splits once into max_split_amount pieces across the splinter angle; targets are taken from their positions at launch',
  ai(ab, u, t) {
    const m = ab.mods[0];
    if (!t || !m || m.stacks < 1 || u.distTo(t) > ab.v('radius')) return null;
    return m.stacks >= ab.v('stack_limit') || (m.stacks >= ab.v('stack_limit') / 2 && !u.hasModifier('modifier_primal_beast_uproar_roar')) ? NOW : null;
  },
  cast(ab) {
    const u = ab.owner; const m = ab.mods[0]; const n = m ? m.stacks : 0;
    if (n < 1) return;
    m.setStacks(0);
    if (ab.v('should_dispell') > 0) u.purge({ debuffs: true });
    u.addModifier('modifier_primal_beast_uproar_roar', { ability: ab, duration: ab.v('roar_duration'), stacks: n });
    for (const e of foes(ab, u.x, u.y, ab.v('radius'))) e.addModifier('modifier_primal_beast_uproar_slow', { caster: u, ability: ab, duration: ab.v('slow_duration'), stacks: n });
    pbSplinters(ab, n);
  },
});
const PB_FRAG_FAN = Math.PI / 6;   // angle between the three rock fragments (layout is not in the data)
defAbility('primal_beast_rock_throw', {
  fid: 'approx', prio: 80,
  note: 'travel time interpolated between the shipped minimum and maximum by distance; the three fragments land fragment_impact_distance beyond the impact point, 30 degrees apart (layout not in the data), with the same damage and stun',
  ai(ab, u, t) { if (!t || t.isBuilding) return null; const d = u.distTo(t); return d >= ab.v('min_range') && d <= ab.castRange() ? { x: t.x, y: t.y } : null; },
  cast(ab, t, x, y) {
    const u = ab.owner; const w = u.world; const near = ab.v('min_range'); const far = Math.max(near + 1, ab.castRange()); let [dx, dy, d] = dirTo(u.x, u.y, x, y);
    if (d < near) { d = near; x = u.x + dx * d; y = u.y + dy * d; }
    const fly = ab.v('min_travel_time') + (ab.v('max_travel_time') - ab.v('min_travel_time')) * Math.min(1, (d - near) / (far - near));
    const dmg = ab.v('base_damage') + u.str * ab.v('damage_str_pct') / 100; const up = u.findModifier(PB_UPROAR);
    const land = (px, py, r) => {
      for (const e of foes(ab, px, py, r)) { hit(ab, e, dmg, PHYSICAL); if (e.alive) stun(ab, e, ab.v('stun_duration')); if (e.isHero && up && up.active() && u.alive) pbStack(up, 1); }
    };
    w.after(fly, () => {
      if (!lands(w)) return;
      land(x, y, ab.v('impact_radius'));
      const base = Math.atan2(dy, dx); const fd = ab.v('fragment_impact_distance');
      w.after(ab.v('bounce_travel_time'), () => { for (const k of [-1, 0, 1]) land(x + Math.cos(base + k * PB_FRAG_FAN) * fd, y + Math.sin(base + k * PB_FRAG_FAN) * fd, ab.v('fragment_impact_radius')); });
    });
  },
});
modifier('modifier_primal_beast_pulverize_grab', {
  debuff: true, pierce: true, purge: 'none', statusResist: false, state: ['STUN'], interval: 0.1,
  // [L] measured in Hero Demo: the victim is held at Primal Beast's position and dropped cast_range in front of him
  // (front = towards where the victim stood; facing is not modelled)
  onCreated(m) { const c = m.caster; const t = m.parent; [m.x, m.y] = dirTo(c.x, c.y, t.x, t.y); t.x = c.x; t.y = c.y; },
  onThink(m) { const c = m.caster; if (!c.alive || c.channelAb !== m.ability) { m.remove(); return; } m.parent.x = c.x; m.parent.y = c.y; },   // let go when the channel stops for any reason
  onDestroy(m) { const c = m.caster; const t = m.parent; const r = m.ability.v('cast_range'); if (t.alive) { t.x = c.x + m.x * r; t.y = c.y + m.y * r; } },
});
defAbility('primal_beast_pulverize', {
  fid: 'full', prio: 75, note: 'the grabbed target is held (stunned) for the channel and released when the channel ends or is interrupted',
  channel: (ab) => ab.v('channel_time'),
  ai: (ab, u, t) => (t && t.heroLike && !u.hasModifier(PB_TRAMPLE) ? { target: t } : null),
  cast(ab, t) {
    const u = ab.owner; const w = u.world; const dur = ab.v('channel_time'); const iv = ab.v('interval');
    if (!t) return;
    const run = ab.data = { t };
    addMod(ab, t, 'modifier_primal_beast_pulverize_grab', dur, { pierce: true });
    for (let i = 1; iv > 0 && i * iv <= dur + 1e-9; i++) {
      w.after(i * iv, () => {
        if (ab.data !== run || u.channelAb !== ab) return;
        if (!t.alive) { u.endChannel(true); return; }
        for (const e of foes(ab, t.x, t.y, ab.v('splash_radius'))) { hit(ab, e, ab.v('damage') + ab.v('bonus_damage_per_hit') * (i - 1), MAGICAL); if (e.alive) stun(ab, e, ab.v('ministun')); }
      });
    }
  },
  channelEnd(ab) { const run = ab.data; ab.data = null; if (run && run.t.alive) run.t.removeModifierByName('modifier_primal_beast_pulverize_grab'); },
});

// ================================================================ Storm Spirit
// a Static Remnant born at (x, y) that walks to (tx, ty); ab = Static Remnant ability. Advanced in 0.1 s steps.
function stormRemnant(ab, x, y, tx, ty) {
  const w = ab.owner.world; const arm = w.time + ab.v('static_remnant_delay'); const end = w.time + ab.v('AbilityDuration'); const step = 0.1; const r = { x, y };
  const tick = () => {
    const [dx, dy, d] = dirTo(r.x, r.y, tx, ty); const go = Math.min(d, ab.v('static_remnant_travel_speed') * step);
    r.x += dx * go; r.y += dy * go;
    if (w.time + 1e-9 >= arm && foes(ab, r.x, r.y, ab.v('static_remnant_radius')).length) { for (const e of foes(ab, r.x, r.y, ab.v('static_remnant_damage_radius'))) hit(ab, e, ab.v('static_remnant_damage'), MAGICAL); return; }
    if (w.time + step <= end + 1e-9) w.after(step, tick);
  };
  w.after(step, tick);
}
defAbility('storm_spirit_static_remnant', {
  fid: 'approx', prio: 50,
  note: 'the remnant walks from Storm Spirit to the cast point, arms after the materialise delay and explodes (damage radius) as soon as an enemy is inside the trigger radius; checked every 0.1 s',
  ai: (ab, u, t) => (t && !t.isBuilding ? { x: t.x, y: t.y } : null),
  cast(ab, t, x, y) { const u = ab.owner; stormRemnant(ab, u.x, u.y, x, y); },
});
const STORM_VORTEX = 'modifier_storm_spirit_electric_vortex';
debuff(STORM_VORTEX, {
  state: ['STUN'], purge: 'strong', interval: (m) => m.parent.world.dt,
  // z = pull speed towards Storm Spirit
  onThink(m) { const t = m.parent; const c = m.caster; const [dx, dy, d] = dirTo(t.x, t.y, c.x, c.y); const go = Math.min(m.z * t.world.dt, Math.max(0, d - 60)); t.x += dx * go; t.y += dy * go; },
});
defAbility('storm_spirit_electric_vortex', {
  fid: 'full', prio: 75, note: 'the pulled unit cannot act; the pull covers the pull distance evenly over the duration',
  cast(ab, t) {
    const u = ab.owner; if (!t) return;
    const list = ab.v('radius_scepter') > 0 ? foes(ab, u.x, u.y, ab.v('radius_scepter')) : [];
    if (!list.includes(t)) list.push(t);
    for (const e of list) { const m = addMod(ab, e, STORM_VORTEX, ab.v('AbilityDuration')); if (m) m.z = ab.v('electric_vortex_pull_distance') / ab.v('AbilityDuration'); }
  },
});
// Overload
const STORM_CHARGE = 'modifier_storm_spirit_overload_charge'; const STORM_RAVE = 'modifier_storm_spirit_overload_rave';
debuff('modifier_storm_spirit_overload_slow', { stats: (m) => ({ msPct: -Math.abs(m.v('overload_move_slow')), asSlow: -Math.abs(m.v('overload_attack_slow')) }) });
// the burst a charged attack releases around its target (ab = Storm Spirit's Overload; the damage is his)
function stormBurst(ab, t, scale) {
  const sp = ab.owner;
  for (const e of foesOf(sp, t.x, t.y, ab.v('overload_aoe'))) {
    sp.world.damage(sp, e, ab.v('overload_damage') * scale, MAGICAL, 0, ab);
    if (e.alive) e.addModifier('modifier_storm_spirit_overload_slow', { caster: sp, ability: ab, duration: ab.v('AbilityDuration') });
  }
}
// a charged attack of `by` landed on `t`: burst; with the talent Storm Spirit's own charged attack bounces on as a weaker
// secondary attack that bursts again at the same reduced strength
function stormRelease(ab, by, t) {
  const sp = ab.owner; const seen = new Set([t]); let cur = t; const k = ab.v('overload_damage_pct') / 100;
  stormBurst(ab, t, 1);
  for (let i = 0; by === sp && sp.alive && i < ab.v('overload_bounces') && cur; i++) {
    let next = null; let bd = sp.attackRange;
    for (const e of foesOf(sp, cur.x, cur.y, sp.attackRange)) { if (seen.has(e) || !e.attackableBy(sp)) continue; const d = cur.distTo(e); if (d <= bd) { bd = d; next = e; } }
    if (next) { seen.add(next); sp.world.launchAttack(sp, next, { instant: true, secondary: true, mult: k, fromAbility: ab }); stormBurst(ab, next, k); }
    cur = next;
  }
}
buff(STORM_CHARGE, { purge: 'none', onAttack(m, rec) { if (rec.target.isBuilding || (rec.data && rec.data.rave)) return; (rec.data ||= {}).overload = true; m.remove(); } });
buff(STORM_RAVE, {
  multi: 'stack', maxStacks: (m) => m.v('shard_activation_charges'), stats: (m) => ({ as: m.v('shard_attack_speed_bonus') }),
  // x = charged attacks that are still in flight
  onAttack(m, rec) { if (rec.target.isBuilding || (rec.data && rec.data.overload) || m.stacks - m.x < 1) return; m.x++; (rec.data ||= {}).rave = m; },
  onAttackMiss(m, rec) { if (rec.data && rec.data.rave === m) m.x--; },
  onAttackLanded(m, rec) { if (!rec.data || rec.data.rave !== m) return; m.x--; stormRelease(m.ability, m.parent, rec.target); if (m.stacks <= 1) m.remove(); else m.setStacks(m.stacks - 1); },
});
modifier('modifier_storm_spirit_overload', {
  hidden: true,
  onCast(m, ev) { const a = ev.ability; if (!a.isItem && a !== m.ability) m.parent.addModifier(STORM_CHARGE, { ability: m.ability }); },
  onAttackLanded(m, rec) { if (rec.data && rec.data.overload) stormRelease(m.ability, m.parent, rec.target); },
});
defAbility('storm_spirit_overload', {
  mods: ['modifier_storm_spirit_overload'], requires: activeWhen((u) => u.hasShard), fid: 'approx', prio: 55,
  note: 'a spell cast (not items) gives one charge; the next attack consumes it at launch and bursts where it lands. Talent bounce (Storm Spirit only): the charged attack jumps to the nearest other enemies within his attack range of the previous one (bounce range is not in the data) as a secondary attack at overload_damage_pct that bursts again at the same share. Shard active (its own mana cost and cooldown values) gives nearby allied heroes charges and attack speed; their bursts are Storm Spirit\'s damage',
  ai(ab, u, t) {
    if (!t || u.hasModifier(STORM_RAVE) || u.rangeTo(t) > u.attackRange + 100) return null;
    return u.world.freeSpells || u.mana >= ab.v('shard_manacost') * (1 - u.manaCostRed / 100) ? NOW : null;
  },
  cast(ab) {
    const u = ab.owner; const w = u.world;
    if (!w.freeSpells) { u.mana = Math.max(0, u.mana - ab.v('shard_manacost') * (1 - u.manaCostRed / 100)); ab.startCooldown(ab.v('shard_cooldown') * u.cdrMul); }
    for (const a of w.alliesInRadius(u, u.x, u.y, ab.v('shard_activation_radius'))) if (a.isHero) a.addModifier(STORM_RAVE, { caster: u, ability: ab, duration: ab.v('shard_activation_duration'), stacks: ab.v('shard_activation_charges') });
  },
});
const STORM_BALL = 'modifier_storm_spirit_ball_lightning';
const stormBallCost = (ab, u) => ({ act: (ab.v('ball_lightning_initial_mana_base') + u.maxMana * ab.v('ball_lightning_initial_mana_percentage') / 100) * (1 - u.manaCostRed / 100), per: (ab.v('ball_lightning_travel_cost_base') + u.maxMana * ab.v('ball_lightning_travel_cost_percent') / 100) / 100 });
// [L] measured in Hero Demo: the order reports the whole activation cost as the mana cost (25 + 7.5% of max mana = 161 at 1815),
// so the ability's own mana cost is that formula
modifier('modifier_storm_spirit_ball_lightning_cost', { hidden: true, purge: 'none', onCreated(m) { const ab = m.ability; ab.manaCost = () => Math.floor(stormBallCost(ab, ab.owner).act + 1e-6); } });
// [L] measured in Hero Demo: no disarm state while flying (he simply cannot start an attack); units inside the area at the start
// are touched at distance 0 (a zero damage instance) and not again
buff(STORM_BALL, {
  purge: 'none', state: ['INVULN'], interval: (m) => m.parent.world.dt,
  onCreated(m) { const u = m.parent; const d = m.data; for (const e of foesOf(u, u.x, u.y, m.v('ball_lightning_aoe'))) { d.seen.add(e); mhit(m, e, 0, MAGICAL); } },
  // data: { tx, ty, gone, seen, per (mana per unit travelled), drop (distance of the next talent remnant) }
  onThink(m) {
    const u = m.parent; const w = u.world; const d = m.data; const ab = m.ability;
    const [dx, dy, left] = dirTo(u.x, u.y, d.tx, d.ty);
    u.winding = false; if (u.nextAttackTime < w.time + w.dt) u.nextAttackTime = w.time + w.dt;   // no attack starts mid-flight
    let go = Math.min(left, ab.v('ball_lightning_move_speed') * w.dt);
    if (!w.freeSpells && d.per > 0) { go = Math.min(go, u.mana / d.per); u.mana = Math.max(0, u.mana - go * d.per); }
    u.x += dx * go; u.y += dy * go; d.gone += go;
    for (const e of foesOf(u, u.x, u.y, ab.v('ball_lightning_aoe'))) { if (d.seen.has(e)) continue; d.seen.add(e); mhit(m, e, ab.v('AbilityDamage') * d.gone / 100, MAGICAL); }
    const gap = ab.v('auto_remnant_interval');
    if (gap > 0 && d.gone >= d.drop) { d.drop += gap; const sr = u.findAbility('storm_spirit_static_remnant'); if (sr && sr.level > 0) stormRemnant(sr, u.x, u.y, u.x, u.y); }
    if (left - go <= 1e-6 || go <= 1e-9) m.remove();
  },
});
defAbility('storm_spirit_ball_lightning', {
  mods: ['modifier_storm_spirit_ball_lightning_cost'], fid: 'approx', prio: 100,
  note: 'activation cost = tooltip formula (the shipped AbilityManaCost is replaced by it; mana cost reduction applied to it, not to the travel drain). Storm Spirit flies in a straight line, invulnerable and unable to attack, draining mana per unit; enemies he touches take damage for the distance covered so far. The controller zips next to an enemy hero that is out of attack range, or out of Electric Vortex range while Vortex is ready, if it can afford the trip',
  ai(ab, u, t) {
    if (!t || !t.isHero || u.isRooted() || u.hasModifier(STORM_BALL)) return null;
    const vx = u.findAbility('storm_spirit_electric_vortex'); const d = u.distTo(t);
    const combo = vx && vx.level > 0 && vx.ready() && d > vx.castRange() + 50;
    if (!combo && u.rangeTo(t) <= u.attackRange + 100) return null;
    const go = d - 150; const c = stormBallCost(ab, u);
    if (go < 100 || (!u.world.freeSpells && u.mana < c.act + c.per * go + (combo ? vx.manaCost() : 0))) return null;
    const [dx, dy] = dirTo(u.x, u.y, t.x, t.y);
    return { x: u.x + dx * go, y: u.y + dy * go };
  },
  cast(ab, t, x, y) {
    const u = ab.owner; const w = u.world; const c = stormBallCost(ab, u); const gap = ab.v('auto_remnant_interval');
    addMod(ab, u, STORM_BALL, dirTo(u.x, u.y, x, y)[2] / ab.v('ball_lightning_move_speed') + 1, { data: { tx: x, ty: y, gone: 0, seen: new Set(), per: c.per, drop: gap } });
  },
});
passive('storm_spirit_galvanized', {
  fid: 'approx', note: 'one charge per level_divisor levels (mp_per_kill each, live) plus enemy heroes dying within range or by his hand during the run (extra charges: scenario option stacks), which count with their permanent part; charge loss on death does not apply here',
  // [L] measured in Hero Demo (hero stats at levels 1-30): the charges from levels give mp_per_kill each, without the permanent part
  stats: (m) => ({ manaRegen: Math.floor(m.parent.level / m.v('level_divisor')) * m.v('mp_per_kill') + m.stacks * (m.v('mp_per_kill') + m.v('perma_mp_per_kill')) }),
  onAnyDeath(m, ev) { const u = m.parent; const v = ev.victim; if (v.team !== u.team && v.isHero && !v.isIllusion && (ev.killer === u || u.distTo(v) <= m.v('aoe'))) m.setStacks(m.stacks + 1); },
});

// ================================================================ Windranger
// second unit for Shackleshot: an ally of `t` behind it (seen from sx, sy) within the shackle distance and angle
function wrLatch(sx, sy, t, ab) {
  const [dx, dy] = dirTo(sx, sy, t.x, t.y); const cosA = Math.cos(ab.v('shackle_angle') * Math.PI / 180); let best = null; let bd = ab.v('shackle_distance');
  for (const o of t.world.units) {
    if (o === t || !o.alive || o.team !== t.team || o.isBuilding || o.st[ST.OUT] > 0) continue;
    const [ex, ey, d] = dirTo(t.x, t.y, o.x, o.y);
    if (d <= bd && ex * dx + ey * dy >= cosA) { bd = d; best = o; }
  }
  return best;
}
defAbility('windrunner_shackleshot', {
  fid: 'approx', prio: 75,
  note: 'latches to an enemy unit within shackle_angle degrees of the line behind the target; trees do not exist here, so a lone target only gets the short stun. The controller prefers a target with a unit behind it and spends a lone-target shot only on heroes while above half mana',
  ai(ab, u, t, w) {
    let best = null;
    for (const e of w.units) {
      if (!e.alive || e.team === u.team || e.isBuilding || !e.targetable() || e.isImmune() || u.distTo(e) > ab.castRange() + 150 || !wrLatch(u.x, u.y, e, ab)) continue;
      if (!best || (e.isHero && !best.isHero) || e === t) best = e;
      if (e === t) break;
    }
    if (best) return { target: best };
    return t && t.isHero && !t.isImmune() && u.mana > u.maxMana * 0.5 ? { target: t } : null;
  },
  cast(ab, t) {
    const u = ab.owner; const sx = u.x; const sy = u.y;
    if (!t) return;
    u.world.projectile(u, t, ab.v('arrow_speed'), (tt) => {
      const o = wrLatch(sx, sy, tt, ab);
      stun(ab, tt, o ? ab.v('stun_duration') : ab.v('fail_stun_duration'));
      if (o) stun(ab, o, ab.v('stun_duration'));
    });
  },
});
debuff('modifier_windrunner_powershot', { stats: (m) => ({ msPct: -m.x }) });   // x = slow in % (reduced per unit hit)
defAbility('windrunner_powershot', {
  fid: 'approx', prio: 55, channel: true,
  note: 'damage, slow and the talent execute threshold scale linearly with the charged share of the channel (the controller always charges fully; an interrupted channel still fires) and fall by damage_reduction % per unit hit; targets are taken from their positions at release and hit after the travel delay',
  ai: (ab, u, t) => (t && !t.isBuilding && u.distTo(t) <= ab.v('arrow_range') * 0.4 ? { x: t.x, y: t.y } : null),
  cast(ab, t, x, y) { ab.data = { x, y, t0: ab.owner.world.time }; },
  channelEnd(ab) {
    const u = ab.owner; const w = u.world; const d = ab.data; const full = ab.v('AbilityChannelTime');
    ab.data = null;
    if (!d || !u.alive) return;
    const k = full > 0 ? Math.min(1, (w.time - d.t0) / full) : 1; const [dx, dy] = dirTo(u.x, u.y, d.x, d.y); const len = ab.v('arrow_range');
    if (k <= 0 || !lands(w)) return;
    let f = k;
    for (const [dist, e] of lineEnemies(u, u.x, u.y, u.x + dx * len, u.y + dy * len, ab.v('arrow_width'))) {
      const share = f; f *= 1 - ab.v('damage_reduction') / 100;
      w.after(dist / ab.v('arrow_speed'), () => {
        if (!e.alive) return;
        hit(ab, e, ab.v('powershot_damage') * share, MAGICAL);
        if (!e.alive) return;
        const m = addMod(ab, e, 'modifier_windrunner_powershot', ab.v('slow_duration'));
        if (m) { m.x = ab.v('slow') * share; e.dirty = true; }
        const lo = ab.v('min_execute_threshold'); const hi = ab.v('max_execute_threshold');
        if (hi > 0 && e.isHero && !e.isIllusion && e.hp / e.maxHp * 100 < (lo + (hi - lo) * k) * share / k) w.kill(e, u, ab);
      });
    }
  },
});
const WR_RUN = 'modifier_windrunner_windrun';
buff(WR_RUN, { stats: (m) => ({ msPct: m.v('movespeed_bonus_pct'), evasion: Math.min(100, m.v('evasion_pct_tooltip')) }) });
defAbility('windrunner_windrun', {
  fid: 'full', prio: 60,
  // used when an enemy is attacking her from within its reach
  ai(ab, u, t, w) {
    if (!t || u.hasModifier(WR_RUN)) return null;
    for (const e of w.units) if (e.alive && e.team !== u.team && e.canAttack && e.orderTarget === u && e.rangeTo(u) <= e.attackRange + 150) return NOW;
    return null;
  },
  cast(ab) { addMod(ab, ab.owner, WR_RUN, ab.v('AbilityDuration')); },
});
defAbility('windrunner_gale_force', {
  fid: 'approx', prio: 45,
  note: 'enemies in the area are moved at wind speed in 0.1 s steps; the controller blows melee enemies that reached her straight away from her',
  ai: (ab, u, t) => (t && t.melee && !t.isBuilding && !t.isImmune() && u.distTo(t) <= 350 ? { x: t.x, y: t.y } : null),
  cast(ab, t, x, y) {
    const u = ab.owner; const w = u.world; const [dx, dy] = dirTo(u.x, u.y, x, y); const step = 0.1; const push = ab.v('wind_strength') * step;
    for (let i = 1; i * step <= ab.v('duration') + 1e-9; i++) w.after(i * step, () => { for (const e of foes(ab, x, y, ab.v('radius'))) { if (e.isImmune() || e.st[ST.ROOT] > 0) continue; e.x += dx * push; e.y += dy * push; } });
  },
});
na('windrunner_focusfire_cancel', 'cancel helper; the controller keeps Focus Fire for its full duration');
const WR_FF = 'modifier_windrunner_focusfire';
buff(WR_FF, {
  purge: 'none', dynamic: true, interval: 0.25,
  // data: { target }: the bonus only counts while she is ordered to attack that unit
  stats: (m) => (m.parent.orderTarget === m.data.target ? { as: m.v('bonus_attack_speed') } : {}),
  onAttack(m, rec) { if (rec.target !== m.data.target) return; rec.mult *= 1 + m.v('focusfire_damage_reduction') / 100; rec.potency *= m.v('focusfire_attack_effectiveness') / 100; },
  onKill(m, ev) { if (ev.victim === m.data.target && m.v('cooldown_reduction_per_kill') > 0) m.ability.cdEnd -= m.v('cooldown_reduction_per_kill'); },
  onThink(m) { if (!m.data.target.alive) m.remove(); },
});
defAbility('windrunner_focusfire', {
  fid: 'full', prio: 80, note: 'attack speed, damage reduction and Item Potency apply to attacks on the chosen unit; moving while attacking has no meaning here',
  ai: (ab, u, t) => (t && (t.heroLike || t.isBuilding) && !u.hasModifier(WR_FF) && u.rangeTo(t) <= u.attackRange + 150 ? { target: t } : null),
  cast(ab, t) { const u = ab.owner; if (!t) return; u.removeModifierByName(WR_FF); addMod(ab, u, WR_FF, ab.v('AbilityDuration'), { data: { target: t } }); },
});
const wrTail = (purge) => ({
  purge, dynamic: true, interval: 0.25,
  // data = expiry times of the stacks; each fades linearly over the second half of its life
  onCreated(m) { m.data = []; },
  stats: (m) => { const now = m.parent.world.time; const half = m.v('duration') / 2; let s = 0; for (const end of m.data) if (end > now) s += Math.min(1, (end - now) / half); return { msPct: m.v('movespeed_bonus') * s }; },
  onThink(m) { const now = m.parent.world.time; m.data = m.data.filter((end) => end > now); if (!m.data.length) m.remove(); },
});
buff('modifier_windrunner_tailwind_buff', wrTail('basic'));
buff('modifier_windrunner_tailwind_buff_scepter', wrTail('none'));
function wrTailwind(m) {
  const u = m.parent; const dur = m.v('duration');
  const b = u.addModifier(m.v('undispellable') > 0 ? 'modifier_windrunner_tailwind_buff_scepter' : 'modifier_windrunner_tailwind_buff', { ability: m.ability, duration: dur + 0.3 });
  if (b) b.data.push(u.world.time + dur);
}
passive('windrunner_tailwind', {
  fid: 'full', stats: (m) => ({ msMax: m.v('max_movespeed') }),
  onCast(m, ev) { if (!ev.ability.isItem) wrTailwind(m); },
  onAttack(m) { if (m.v('applies_on_attack') > 0) wrTailwind(m); },
});

// ================================================================ Dazzle
const DZ_NOTHL = 'modifier_dazzle_nothl_projection'; const DZ_GRAVE = 'modifier_dazzle_shallow_grave';
const dzProjecting = (u) => u.findModifier(DZ_NOTHL);
// Weave: every unit touched by Dazzle's abilities gets an independent armor stack (Break stops new stacks)
modifier('modifier_dazzle_innate_weave_buff', { multi: 'independent', purge: 'basic', stats: (m) => ({ armor: m.v('armor_change') }) });
modifier('modifier_dazzle_innate_weave_debuff', { debuff: true, multi: 'independent', statusResist: false, stats: (m) => ({ armor: -m.v('armor_change') }) });
function dzWeave(dz, t) {
  const wv = dz.findAbility('dazzle_innate_weave'); const p = wv && wv.mods[0];
  if (!p || !p.active() || !t.alive || t.isBuilding) return;
  const ally = t.team === dz.team;
  if (wv.v(ally ? 'affects_allies' : 'affects_enemies') > 0) t.addModifier(ally ? 'modifier_dazzle_innate_weave_buff' : 'modifier_dazzle_innate_weave_debuff', { caster: dz, ability: wv, duration: wv.v('duration') });
}
passive('dazzle_innate_weave', { fid: 'full', note: 'the Shard line of the tooltip has no effect in this data (ally_heal = 0)' });

const dzTouch = (purge) => ({
  debuff: true, purge, interval: 1,
  // stacks = hits by Dazzle (each adds bonus_slow); data.dur = duration to refresh to
  stats: (m) => ({ msPct: -Math.abs(m.v('slow')) - Math.abs(m.v('bonus_slow')) * m.stacks }),
  onThink(m) { mhit(m, m.parent, m.v('damage'), PHYSICAL); },
  onAttacked(m, rec) { if (rec.attacker !== m.caster) return; m.setDuration(m.data.dur); m.setStacks(m.stacks + 1); },
});
modifier('modifier_dazzle_poison_touch', dzTouch('basic'));
modifier('modifier_dazzle_poison_touch_undispellable', dzTouch('none'));
defAbility('dazzle_poison_touch', {
  fid: 'approx', prio: 60,
  note: 'cone towards the target (radius growing from start to end radius), nearest enemies first up to the target count; first damage instance on impact, then one per second (7.29 patch note); Nothl Projection hex uses the engine hex speed (not in the data)',
  ai: (ab, u, t) => (t && !t.isBuilding && !t.isImmune() ? { target: t } : null),
  cast(ab, t) {
    const u = ab.owner; const w = u.world;
    if (!t) return;
    const [dx, dy] = dirTo(u.x, u.y, t.x, t.y); const len = ab.v('end_distance'); const list = [t];
    for (const [, e] of lineEnemies(u, u.x, u.y, u.x + dx * len, u.y + dy * len, ab.v('start_radius'), ab.v('end_radius'))) { if (list.length >= ab.v('targets')) break; if (e !== t && !e.isImmune()) list.push(e); }
    const nothl = dzProjecting(u); const name = ab.v('undispellable') > 0 ? 'modifier_dazzle_poison_touch_undispellable' : 'modifier_dazzle_poison_touch';
    for (const e of list) {
      w.projectile(u, e, ab.v('projectile_speed'), (tt) => {
        // [L] measured in Hero Demo: the first damage instance lands on impact, before the Weave stack of the same impact, and the
        // last one on the moment the debuff expires (duration / 1 s + 1 instances)
        const fresh = !tt.hasModifier(name);
        const m = addMod(ab, tt, name, ab.v('duration') + 0.01);
        if (!m) return;
        m.data = { dur: Math.max(0, m.remaining()) };
        if (fresh) mhit(m, tt, m.v('damage'), PHYSICAL);
        if (nothl) tt.addModifier('modifier_hexed', { caster: u, ability: ab, duration: nothl.v('poison_touch_hex') });
        dzWeave(u, tt);
      });
    }
  },
});
buff(DZ_GRAVE, {
  purge: 'none', state: ['CANNOT_DIE'],
  // heals on the protected unit are amplified by heal_amplify % per 10% missing health (linear, measured before the heal)
  onHealed(m, ev) {
    const t = m.parent; const before = t.hp - ev.amount; const extra = ev.amount * m.v('heal_amplify') / 100 * Math.max(0, 1 - before / t.maxHp) * 10;
    const add = Math.min(extra, t.maxHp - t.hp);
    if (add > 0) { t.hp += add; if (ev.src) ev.src.mHealed += add; }
  },
  // tooltip note: Axe's Culling Blade still kills. The protection is dropped when that ability deals the lethal blow.
  onTakeDamage(m, d) { if (m.parent.hp <= 0 && d.ability && d.ability.name === 'axe_culling_blade') m.remove(); },
  onDestroy(m, expired) { const t = m.parent; const n = expired && t.alive && m.caster.alive ? dzProjecting(m.caster) : null; if (n) t.heal(n.v('shallow_grave_heal'), m.caster, m.ability); },
});
defAbility('dazzle_shallow_grave', {
  fid: 'full', prio: 95, note: 'cast on the allied hero (Dazzle included) with the lowest health below 25%; heal amplification grows linearly with missing health',
  ai(ab, u) { const a = woundedAlly(u, ab.castRange(), 0.25); return a && !a.hasModifier(DZ_GRAVE) ? { target: a } : null; },
  cast(ab, t) {
    const u = ab.owner; const tt = t || u; const n = dzProjecting(u);
    addMod(ab, tt, DZ_GRAVE, ab.v('duration')); dzWeave(u, tt);
    if (tt === u && n && n.data.body.alive) addMod(ab, n.data.body, DZ_GRAVE, ab.v('duration'));   // his body is what can die
  },
});
defAbility('dazzle_shadow_wave', {
  fid: 'approx', prio: 65,
  note: 'the bolt jumps from the target to the nearest unvisited ally within the arc radius (heroes first), max_targets units besides Dazzle; every healed unit damages enemies around it. Scepter: enemies are valid jumps too (damage, 100% heal for allies around them, one attack by Dazzle). Jumps are instant',
  ai(ab, u, t) {
    const a = woundedAlly(u, ab.castRange(), 0.85);
    if (a) return { target: a };
    if (!t || t.isBuilding) return null;
    if (u.hasScepter && u.distTo(t) <= ab.castRange()) return { target: t };
    return u.distTo(t) <= ab.v('damage_radius') ? { target: u } : null;
  },
  cast(ab, t) {
    const u = ab.owner; const w = u.world; const amount = ab.v('damage'); const dr = ab.v('damage_radius'); const sc = u.hasScepter; const seen = new Set([u]);
    const onAlly = (a) => { a.heal(amount, u, ab); dzWeave(u, a); for (const e of foesOf(u, a.x, a.y, dr)) { hit(ab, e, amount, PHYSICAL); dzWeave(u, e); } };
    const onEnemy = (e) => {
      hit(ab, e, amount, PHYSICAL); dzWeave(u, e);
      for (const a of w.alliesInRadius(u, e.x, e.y, dr)) a.heal(amount * ab.v('scepter_heal_pct') / 100, u, ab);
      if (e.alive && !u.isDisarmed() && e.attackableBy(u)) w.launchAttack(u, e, { fromAbility: ab });
    };
    onAlly(u);   // Dazzle is always healed and does not use up a target
    let cur = t && t !== u && (t.team === u.team || sc) ? t : null; let from = u;
    for (let n = 0; n < ab.v('max_targets'); n++) {
      if (!cur) {
        let bd = Infinity;
        for (const o of w.units) {
          if (seen.has(o) || !o.alive || o.isBuilding || o.st[ST.OUT] > 0 || (o.team !== u.team && (!sc || o.st[ST.INVULN] > 0))) continue;
          const d = from.distTo(o); if (d > ab.v('bounce_radius')) continue;
          const score = d + (o.team === u.team && o.isHero ? 0 : 1e6);
          if (score < bd) { bd = score; cur = o; }
        }
        if (!cur) break;
      }
      seen.add(cur);
      if (cur.team === u.team) onAlly(cur); else onEnemy(cur);
      from = cur; cur = null;
    }
    const nothl = dzProjecting(u);
    if (nothl && !w.freeSpells) ab.cdEnd = w.time + ab.cooldown() * (1 - nothl.v('shadow_wave_cdr') / 100);
  },
});
// Nothl Projection: the hero unit is the invulnerable spirit; his body is a second unit that takes the damage for him
modifier('modifier_dazzle_nothl_projection_body', { hidden: true, purge: 'none', state: ['NO_HEAL'] });
function dzEndProjection(m, atSpirit) { m.data.atSpirit = atSpirit; m.remove(); }
buff(DZ_NOTHL, {
  purge: 'none', state: ['INVULN', 'UNTARGETABLE'], interval: (m) => m.parent.world.dt,
  // data: { body, hp (body health at the last sync), pull (Through the Realm), atSpirit }
  onThink(m) {
    const u = m.parent; const d = m.data; const b = d.body; const w = u.world;
    if (!b.alive) return;
    // one health pool: damage arrives through the body, healing and regeneration through the spirit
    const k = u.maxHp / b.maxHp; const pool = Math.max(1, Math.min(u.maxHp, u.hp - (d.hp - b.hp) * k));
    u.hp = pool; b.hp = Math.max(1, pool / k); d.hp = b.hp;
    const [dx, dy, dist] = dirTo(u.x, u.y, b.x, b.y);
    if (d.pull) {   // the body is dragged to the spirit
      const go = m.v('soul_return_min_speed') * w.dt;
      if (dist <= go + 30) { dzEndProjection(m, true); return; }
      b.x -= dx * go; b.y -= dy * go;
    } else if (dist > m.v('leash_start')) {   // the tether pulls the spirit back, harder with distance
      const go = Math.min(dist, (m.v('base_leash_pull') + m.v('leash_increase') * (dist - m.v('leash_start'))) * w.dt);
      u.x += dx * go; u.y += dy * go;
    }
  },
  outgoing(m, d) { if ((d.flags & F_ATTACK) && d.dst.isBuilding) d.amount = 0; },   // the spirit cannot attack buildings
  onAnyDeath(m, ev) { const u = m.parent; if (ev.victim !== m.data.body) return; u.x = ev.victim.x; u.y = ev.victim.y; m.remove(); u.world.kill(u, ev.killer, ev.ability); },
  onDestroy(m) {
    const u = m.parent; const b = m.data.body;
    if (!b.alive) return;
    if (!m.data.atSpirit) { u.x = b.x; u.y = b.y; }
    u.world.kill(b, null, null, true);
  },
});
defAbility('dazzle_nothl_projection', {
  fid: 'approx', prio: 85,
  note: 'the hero unit becomes the invulnerable, untargetable spirit and jumps to the cast point; his body stays behind as a separate unit sharing his health pool (damage through the body, healing through the spirit), and its death kills Dazzle. Empowered Poison Touch / Shallow Grave / Shadow Wave, tether pull beyond the leash range and the Shard ranges are modelled; attacks of the spirit do nothing to buildings; debuffs on the body are not carried over, healing aimed at the body is ignored, travel and return times are skipped. The controller keeps it for the full duration',
  ai(ab, u, t) {
    if (!t || dzProjecting(u) || u.distTo(t) > ab.castRange() + 600) return null;
    const [dx, dy, d] = dirTo(u.x, u.y, t.x, t.y); const go = Math.max(0, Math.min(ab.castRange(), d - u.attackRange * 0.8));
    return { x: u.x + dx * go, y: u.y + dy * go };
  },
  cast(ab, t, x, y) {
    const u = ab.owner; const w = u.world;
    const b = w.createIllusion(u, { duration: ab.v('max_duration') + 5, outPct: 0, inPct: 0, x: u.x, y: u.y });
    b.isIllusion = false; b.ai = null;
    b.addModifier('modifier_dazzle_nothl_projection_body', { caster: u, ability: ab });
    addMod(ab, u, DZ_NOTHL, ab.v('max_duration'), { data: { body: b, hp: b.hp, pull: false, atSpirit: false } });
    const [dx, dy, d] = dirTo(u.x, u.y, x, y); const go = Math.min(d, ab.castRange());
    u.x += dx * go; u.y += dy * go;
  },
});
defAbility('dazzle_through_the_realm', {
  manual: true, fid: 'approx', note: 'manual (ends the ultimate early to move the body): the body travels to the spirit at soul_return_min_speed and the projection ends when they meet; refused while the body is rooted or leashed. A stun on the body is not passed on',
  cast(ab) { const m = dzProjecting(ab.owner); if (m && m.data.body.st[ST.ROOT] === 0 && m.data.body.st[ST.LEASH] === 0) m.data.pull = true; },
});
defAbility('dazzle_nothl_projection_end', {
  manual: true, fid: 'full', note: 'manual: the controller never ends the projection early. Ends it once min_duration has passed',
  cast(ab) { const u = ab.owner; const m = dzProjecting(u); if (m && u.world.time - m.created >= m.v('min_duration')) dzEndProjection(m, false); },
});

// ================================================================ Queen of Pain
const QOP_STRIKE = 'modifier_queenofpain_shadow_strike';
// Scream of Pain around (cx, cy): ab = her Scream of Pain. A quarter (shipped value) of the pre-reduction damage per hero hit comes back to her.
function qopScream(ab, cx, cy) {
  const u = ab.owner; const w = u.world; const dmg = ab.v('damage');
  for (const e of foes(ab, cx, cy, ab.v('area_of_effect'))) {
    w.after(Math.sqrt((e.x - cx) ** 2 + (e.y - cy) ** 2) / ab.v('projectile_speed'), () => {
      if (!e.alive || hit(ab, e, dmg, MAGICAL) <= 0 || !e.isHero || e.isIllusion || !u.alive) return;
      w.damage(u, u, dmg * (1 + u.spellAmp / 100) * ab.v('damage_reflected_to_self') / 100, MAGICAL, F_REFLECT | F_NO_AMP | F_NON_LETHAL | F_NO_LIFESTEAL, ab);
    });
  }
}
function qopStrikeScream(m) {   // Scepter: the struck hero emits a Scream of Pain
  const t = m.parent; const u = m.caster; const sc = u.findAbility('queenofpain_scream_of_pain');
  if (m.v('generate_scream') > 0 && t.alive && t.isHero && !t.isIllusion && sc && sc.level > 0) qopScream(sc, t.x, t.y);   // not from illusions, not on death (7.32 patch note)
}
debuff(QOP_STRIKE, {
  interval: 1,
  // x = whole seconds elapsed: the slow decays once per second, a damage instance every damage_interval seconds.
  // [L] measured in Hero Demo (level 4, 13 s): the slow follows exp(-1.28 f (f + 2)) of its full value, f = elapsed / duration
  // (55% -> 44.83, 35.98, 28.46, 22.16, 17.00 ... 1.74% at 12 s; fitted to all twelve steps within 0.05 percentage points)
  stats: (m) => { const f = m.x / Math.max(1, m.v('duration')); return { msPct: -Math.abs(m.v('movement_slow')) * Math.exp(-1.28 * f * (f + 2)) }; },
  onRefresh(m) { m.x = 0; m.parent.dirty = true; qopStrikeScream(m); },
  onThink(m) { const iv = m.v('damage_interval'); m.x++; m.parent.dirty = true; if (iv > 0 && m.x % iv === 0) mhit(m, m.parent, m.v('duration_damage'), MAGICAL); },
  onDestroy(m) { qopStrikeScream(m); },
});
// talent: attack speed only while attacking a struck target ([L] no bonus after merely casting Shadow Strike on it)
modifier('modifier_queenofpain_shadow_strike_talent', { hidden: true, dynamic: true, stats: (m) => { const u = m.parent; const t = u.order === ORDER.ATTACK ? u.orderTarget : null; return t && t.hasModifier(QOP_STRIKE) ? { as: m.v('attack_speed') } : {}; } });
defAbility('queenofpain_shadow_strike', {
  mods: ['modifier_queenofpain_shadow_strike_talent'], requires: (ab) => ab.v('attack_speed') > 0, fid: 'full', prio: 55,
  ai: (ab, u, t) => (t && !t.isBuilding && (u.hasScepter || !t.hasModifier(QOP_STRIKE)) ? { target: t } : null),
  cast(ab, t) {
    const u = ab.owner; if (!t) return;
    const list = ab.v('aoe_radius') > 0 ? foes(ab, t.x, t.y, ab.v('aoe_radius')) : [];
    if (!list.includes(t)) list.push(t);
    for (const e of list) u.world.projectile(u, e, ab.v('projectile_speed'), (tt) => { if (tt.isImmune()) return; hit(ab, tt, ab.v('strike_damage'), MAGICAL); if (tt.alive) addMod(ab, tt, QOP_STRIKE, ab.v('duration')); });
  },
});
defAbility('queenofpain_blink', {
  fid: 'approx', prio: 100,
  note: 'used to close the distance; with Shard also to drop the sonic boom (start and end point, an enemy in both is hit twice) next to an enemy hero',
  ai(ab, u, t) {
    if (!t || u.isRooted()) return null;
    const [dx, dy, d] = dirTo(u.x, u.y, t.x, t.y); const reach = u.attackRange + u.def.hull + t.def.hull; const boom = ab.v('shard_damage') > 0 && t.isHero && !t.isImmune();
    if (d <= reach + 200 && !boom) return null;
    const go = Math.min(ab.castRange(), d - (boom ? 150 : reach - 50));
    return go >= ab.v('min_blink_range') && d - go <= reach ? { x: u.x + dx * go, y: u.y + dy * go } : null;
  },
  cast(ab, t, x, y) {
    const u = ab.owner; const sx = u.x; const sy = u.y; const [dx, dy, d] = dirTo(sx, sy, x, y); const go = Math.min(d, ab.castRange());
    u.x = sx + dx * go; u.y = sy + dy * go;
    if (ab.v('shard_damage') <= 0) return;
    for (const [px, py] of [[sx, sy], [u.x, u.y]]) for (const e of foes(ab, px, py, ab.v('shard_aoe'))) { hit(ab, e, ab.v('shard_damage'), MAGICAL); addMod(ab, e, 'modifier_silenced', ab.v('shard_duration')); }
  },
});
defAbility('queenofpain_scream_of_pain', {
  fid: 'full', prio: 60, ai: nearAI('area_of_effect'), note: 'the reflected share is reduced by her own magic resistance, cannot kill her and is negated by debuff immunity',
  cast(ab) { const u = ab.owner; qopScream(ab, u.x, u.y); },
});
passive('queenofpain_succubus', {
  fid: 'full', note: 'her spell lifesteal per damage instance, linear between the two radii, with the engine\'s creep factor; pure damage already counts for all spell lifesteal in this engine',
  onDealDamage(m, d) {
    const u = m.parent; const t = d.dst;
    if (d.dealt <= 0 || t.team === u.team || t.isBuilding || (d.flags & (F_ATTACK | F_REFLECT | F_HP_LOSS | F_NO_LIFESTEAL))) return;
    const lo = m.v('close_radius'); const hi = m.v('max_radius'); const k = hi > lo ? Math.min(1, Math.max(0, (hi - u.distTo(t)) / (hi - lo))) : 1;
    u.heal(d.dealt * (m.v('spell_lifesteal') + (m.v('spell_lifesteal_close') - m.v('spell_lifesteal')) * k) / 100 * (1 + u.lifestealAmp / 100) * (t.heroLike ? 1 : 0.2), u, null, true);
  },
});
modifier('modifier_queenofpain_sonic_wave', {
  // [L] measured in Hero Demo: the first of the knockback_duration / tick_rate damage instances lands when the wave hits
  debuff: true, pierce: true, multi: 'independent', purge: 'none', statusResist: false, interval: (m) => m.v('tick_rate'), thinkNow: true,
  // data: { dx, dy, n, i }: damage and push are spread over the knockback
  onThink(m) {
    const t = m.parent; const d = m.data;
    if (d.i++ >= d.n) return;
    const step = m.v('knockback_distance') / d.n; t.x += d.dx * step; t.y += d.dy * step;
    mhit(m, t, m.v('damage') / d.n, PURE);
  },
});
defAbility('queenofpain_sonic_wave', {
  fid: 'approx', prio: 90,
  note: 'widening wave towards the cast point; the far end reaches half the final radius beyond the travel distance. Damage and knockback are spread over knockback_duration in tick_rate steps (values shipped with the ability); targets are taken from their positions at cast time',
  ai: (ab, u, t) => (t && t.isHero && u.distTo(t) <= ab.v('distance') - 150 ? { x: t.x, y: t.y } : null),
  cast(ab, t, x, y) {
    const u = ab.owner; const w = u.world; const [dx, dy] = dirTo(u.x, u.y, x, y); const len = ab.v('distance'); const sx = u.x; const sy = u.y;
    const kd = ab.v('knockback_duration'); const n = Math.max(1, Math.round(kd / ab.v('tick_rate')));
    if (!lands(w)) return;
    for (const [d, e] of lineEnemies(u, sx, sy, sx + dx * len, sy + dy * len, ab.v('starting_aoe'), ab.v('final_aoe'))) {
      if (Math.sqrt((e.x - sx) ** 2 + (e.y - sy) ** 2) > len + ab.v('final_aoe') / 2 + e.def.hull) continue;
      // the widening front (radius starting_aoe .. final_aoe over the distance) touches the unit's hull before the centre reaches it
      const reach = Math.max(0, (d - e.def.hull - ab.v('starting_aoe')) / (1 + (ab.v('final_aoe') - ab.v('starting_aoe')) / len));
      w.after(reach / ab.v('speed'), () => { if (e.alive) e.addModifier('modifier_queenofpain_sonic_wave', { caster: u, ability: ab, duration: kd + 0.01, pierce: true, data: { dx, dy, n, i: 0 } }); });
    }
  },
});

// ================================================================ Venomancer
const VENO_GALE = 'modifier_venomancer_venomous_gale'; const VENO_PLAGUE = 'modifier_venomancer_noxious_plague';
const VENO_STING = 'modifier_venomancer_poison_sting_debuff'; const VENO_STING_WARD = 'modifier_venomancer_poison_sting_ward';
const VENO_BITE = 'modifier_venomancer_snakebite'; const VENO_BITE_HARD = 'modifier_venomancer_snakebite_undispellable';
const venoSting = () => ({
  // [L] measured in Hero Demo: the poison deals its per-second damage once per second, counted from the first application
  // (refreshing does not restart the count)
  debuff: true, interval: 1,
  // data.k = potency: 1 for Venomancer's own attacks, poison_sting_potency % for ward attacks (the two debuffs stack)
  stats: (m) => ({ msPct: -m.v('movement_speed') * (m.data ? m.data.k : 1), hpRegenAmp: -m.v('hp_regen_reduction') }),
  onThink(m) { mhit(m, m.parent, m.v('damage') * (m.data ? m.data.k : 1), MAGICAL); },
});
modifier(VENO_STING, venoSting());
modifier(VENO_STING_WARD, venoSting());
function venoPoison(veno, t, name, k) {
  const ps = veno.findAbility('venomancer_poison_sting');
  if (ps && ps.level > 0 && t.alive && !t.isBuilding) t.addModifier(name, { caster: veno, ability: ps, duration: ps.v('duration') + 0.01, data: { k } });
}
passive('venomancer_poison_sting', { fid: 'full', note: 'damage per second in 1 s ticks (live); the Shard line of the tooltip has no effect in this data (debuff_dmg = 0)', onAttackLanded(m, rec) { venoPoison(m.parent, rec.target, VENO_STING, 1); } });

debuff(VENO_GALE, {
  interval: 1,
  // x = whole seconds elapsed: the slow fades step by step, a damage instance every tick_interval seconds
  stats: (m) => ({ msPct: -Math.abs(m.v('movement_slow')) * Math.max(0, 1 - m.x / Math.max(1, m.v('duration'))) }),
  onRefresh(m) { m.x = 0; m.parent.dirty = true; },
  onThink(m) { const iv = m.v('tick_interval'); m.x++; m.parent.dirty = true; if (iv > 0 && m.x % iv === 0) mhit(m, m.parent, m.v('tick_damage'), MAGICAL); },
});
// Plague Ward (pw = Plague Ward ability) with hp / damage scaled by `scale`
modifier('modifier_venomancer_plague_ward_unit', {
  hidden: true, purge: 'none', state: ['IMMUNE'], stats: (m) => ({ mr: m.v('magic_immune') > 0 ? 100 : 0 }),
  onAttackLanded(m, rec) { venoPoison(m.caster, rec.target, VENO_STING_WARD, m.v('poison_sting_potency') / 100); },
});
function venoWard(pw, x, y, scale) {
  const u = pw.owner; const dmg = pw.v('ward_base_damage') * scale; const sp = pw.v('ward_damage_spread');
  const ward = summon(pw, 'npc_dota_venomancer_plague_ward', { x, y, duration: pw.v('duration'), ovr: { hp: pw.v('ward_max_health') * scale, dmgMin: dmg - sp, dmgMax: dmg + sp } });
  ward.addModifier('modifier_venomancer_plague_ward_unit', { caster: u, ability: pw });
  // a fresh ward starts on the nearest enemy hero in its range (7.42 patch note)
  let best = null; let bd = Infinity;
  for (const e of u.world.units) { if (!e.alive || e.team === u.team || !e.isHero || !e.attackableBy(ward) || ward.rangeTo(e) > ward.attackRange) continue; const d = ward.distTo(e); if (d < bd) { bd = d; best = e; } }
  if (best && ward.ai) ward.ai.target = best;
  return ward;
}
defAbility('venomancer_venomous_gale', {
  fid: 'approx', prio: 60,
  note: 'straight line of cast-range length; targets are taken from their positions at cast time and hit after the travel delay; the slow fades linearly in 1 s steps. Shard wards appear next to each enemy hero hit at ward_hp_dmg_pct % strength',
  ai: (ab, u, t) => (t && !t.isBuilding && !t.hasModifier(VENO_GALE) ? { x: t.x, y: t.y } : null),
  cast(ab, t, x, y) {
    const u = ab.owner; const w = u.world; const [dx, dy] = dirTo(u.x, u.y, x, y); const len = ab.castRange(); const pw = u.findAbility('venomancer_plague_ward');
    if (!lands(w)) return;
    for (const [d, e] of lineEnemies(u, u.x, u.y, u.x + dx * len, u.y + dy * len, ab.v('radius'))) {
      w.after(d / ab.v('speed'), () => {
        if (!e.alive) return;
        hit(ab, e, ab.v('strike_damage'), MAGICAL);
        if (!e.alive) return;
        addMod(ab, e, VENO_GALE, ab.v('duration') + 0.01);
        if (ab.v('create_wards') > 0 && e.isHero && !e.isIllusion && pw && pw.level > 0) for (let i = 0; i < ab.v('num_created_wards_tooltip'); i++) venoWard(pw, e.x + (i % 2 ? -130 : 130), e.y + 60 * (i >> 1), ab.v('ward_hp_dmg_pct') / 100);
      });
    }
  },
});
const venoBite = (purge) => ({
  debuff: true, purge, interval: (m) => m.v('damage_interval'),
  onThink(m) { mhit(m, m.parent, m.v('tick_damage') * m.v('damage_interval'), MAGICAL); },
  onAttack(m) { mhit(m, m.parent, m.v('base_damage'), MAGICAL); },   // attacking while infected repeats the initial damage
});
modifier(VENO_BITE, venoBite('basic'));
modifier(VENO_BITE_HARD, venoBite('none'));
defAbility('venomancer_snakebite', {
  fid: 'full', prio: 65,
  ai: (ab, u, t) => (t && !t.isBuilding && !t.isImmune() && !t.hasModifier(VENO_BITE) && !t.hasModifier(VENO_BITE_HARD) ? { target: t } : null),
  cast(ab, t) { if (!t) return; hit(ab, t, ab.v('base_damage'), MAGICAL); if (t.alive) addMod(ab, t, ab.v('undispellable') > 0 ? VENO_BITE_HARD : VENO_BITE, ab.v('duration') + 0.01); },
});
defAbility('venomancer_plague_ward', {
  fid: 'approx', prio: 40,
  note: 'shipped ward unit with level-scaled health and damage, magic immune, cannot move; its attacks apply a separate half-strength Poison Sting. The controller plants wards 250 units in front of its target',
  ai(ab, u, t) { if (!t) return null; const [dx, dy, d] = dirTo(t.x, t.y, u.x, u.y); const k = Math.min(250, d); return { x: t.x + dx * k, y: t.y + dy * k }; },
  cast(ab, t, x, y) { venoWard(ab, x, y, 1); },
});
// Noxious Plague. data.gen: 0 on the first target, +1 per spread; data.carry: Venomancer's other debuffs seen on the host
const VENO_CARRY = {
  [VENO_GALE]: (v) => { const a = v.findAbility('venomancer_venomous_gale'); return a && { ability: a, duration: a.v('duration') + 0.01 }; },
  [VENO_BITE]: (v) => { const a = v.findAbility('venomancer_snakebite'); return a && { ability: a, duration: a.v('duration') + 0.01 }; },
  [VENO_BITE_HARD]: (v) => { const a = v.findAbility('venomancer_snakebite'); return a && { ability: a, duration: a.v('duration') + 0.01 }; },
  [VENO_STING]: (v) => { const a = v.findAbility('venomancer_poison_sting'); return a && { ability: a, duration: a.v('duration') + 0.01, data: { k: 1 } }; },
  [VENO_STING_WARD]: (v) => { const a = v.findAbility('venomancer_poison_sting'); const pw = v.findAbility('venomancer_plague_ward'); return a && pw && { ability: a, duration: a.v('duration') + 0.01, data: { k: pw.v('poison_sting_potency') / 100 } }; },
};
function venoInfect(ab, t, gen, carry, fromHero) {
  const veno = ab.owner;
  if (!t.alive || t.isImmune()) return;
  // impact damage: full on the first target and on the first spread; later spreads only with Scepter (shipped reduction value) and from hero hosts
  const share = gen < 2 ? 1 : fromHero ? 1 - ab.v('impact_damage_reduce') / 100 : 0;
  if (share > 0) veno.world.damage(veno, t, ab.v('impact_damage') * share, MAGICAL, F_NON_LETHAL, ab);
  if (!t.alive) return;
  for (const name of carry) { const c = VENO_CARRY[name](veno); if (c) t.addModifier(name, { caster: veno, ...c, noResist: true }); }
  if (!t.hasModifier(VENO_PLAGUE)) t.addModifier(VENO_PLAGUE, { caster: veno, ability: ab, duration: ab.v('debuff_duration') + 0.01, noResist: gen > 0, data: { gen, carry: [] } });
}
modifier(VENO_PLAGUE, {
  // [L] measured in Hero Demo: the first damage tick comes with the impact
  debuff: true, purge: 'none', interval: (m) => m.v('damage_tick_rate'), thinkNow: true,
  stats: (m) => ({ msPct: -m.v('movement_slow'), mr: -m.v('mres_reduce') }),
  onThink(m) {
    const t = m.parent;
    m.data.carry = Object.keys(VENO_CARRY).filter((n) => { const x = t.findModifier(n); return x && x.caster === m.caster; });
    mhit(m, t, t.maxHp * m.v('damage_per_second') / 100 * m.v('damage_tick_rate'), MAGICAL);
  },
  // when it ends for any reason it jumps to nearby enemies, taking Venomancer's other debuffs along
  onDestroy(m) {
    const t = m.parent; const veno = m.caster; const ab = m.ability; const d = m.data;
    if (d.gen >= ab.v('spread_count')) return;
    for (const e of foesOf(veno, t.x, t.y, ab.v('debuff_radius'))) if (e !== t) t.world.projectile(t, e, ab.v('projectile_speed'), (tt) => venoInfect(ab, tt, d.gen + 1, d.carry, t.isHero));
  },
});
defAbility('venomancer_noxious_plague', {
  fid: 'approx', prio: 85,
  note: 'one undispellable debuff (the dispellable spread part of 7.42 is not separate, so a dispel does not trigger an early spread); max-health damage in damage_tick_rate ticks; impact damage is non-lethal (7.41 patch note). On ending it spreads to every enemy in radius with a fixed duration, twice in total, carrying Venomous Gale, Snakebite and Poison Sting debuffs seen on the host at full duration',
  ai: (ab, u, t) => (t && t.heroLike && !t.hasModifier(VENO_PLAGUE) ? { target: t } : null),
  cast(ab, t) { const u = ab.owner; if (t) u.world.projectile(u, t, ab.v('projectile_speed'), (tt) => venoInfect(ab, tt, 0, [], false)); },
});
