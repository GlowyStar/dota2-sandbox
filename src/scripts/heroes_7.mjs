// Hero abilities, part 7: Morphling, Tinker, Largo, Beastmaster, Doom, Kunkka, Nyx Assassin, Riki, Undying, Ancient Apparition,
// Lich, Spirit Breaker (+ the abilities of the units they summon).
// Every number is read from the shipped data by value name. Literals are tick intervals, AI thresholds and geometry
// approximations only; each one is explained in the `note` of the ability that uses it.
import { defAbility, modifier, buff, debuff, passive, val, neg, hit, addMod, stun, healUnit, enemiesNear, alliesNear, enemiesInLine, lineFromCaster,
  knockback, mhit, aura, zone, barrier, giveBarrier, summon, gapAI, ST, C, PHYSICAL, MAGICAL, PURE,
  F_ATTACK, F_NO_AMP, F_REFLECT, F_HP_LOSS, F_NON_LETHAL, F_SECONDARY, F_NO_ARMOR } from '../engine/dsl.mjs';

const na = (name, note) => defAbility(name, { fid: 'n/a', note });
const SELF = { target: null };                                   // "cast now, no target" answer for ai functions
const hyp = (dx, dy) => Math.sqrt(dx * dx + dy * dy);
// An order the game refuses (a target the ability cannot take): the engine has already charged the cast, so give it back.
function refuse(ab) {
  const u = ab.owner; if (u.world.freeSpells) return;
  u.mana = Math.min(u.maxMana, u.mana + ab.manaCost()); ab.cdEnd = 0; ab.casts--;
  const max = ab.vals.AbilityCharges || 0; if (max > 0) { ab.charges = Math.min(max, ab.charges + 1); if (ab.charges >= max) ab.chargeEnd = 0; }
}
const levelVal = (ab, name, lvl) => { const e = ab.def.vals[name]; const a = Array.isArray(e) ? e : e.v; return a[Math.min(a.length, Math.max(1, lvl)) - 1]; };
// value stored on a talent ability itself (talents that are not attached to an ability value in the data)
const talentVal = (u, talent, key) => { if (!u.talents.has(talent)) return 0; const d = u.world.data.abilities[talent]; const e = d && d.vals[key]; return e ? (Array.isArray(e) ? e[0] : e.v[0]) : 0; };
const baseRange = (u) => (u.ovr && u.ovr.range !== undefined ? u.ovr.range : u.def.range);
// where `t` will be after `delay` seconds if it keeps walking towards its current attack target (used to aim delayed area spells)
function lead(t, delay) {
  const o = t.orderTarget;
  if (!o || !o.alive || t.cantAct() || t.st[ST.ROOT] > 0 || t.ms <= 0) return { x: t.x, y: t.y };
  const dx = o.x - t.x; const dy = o.y - t.y; const d = hyp(dx, dy) || 1;
  const go = Math.max(0, Math.min(t.ms * delay, d - (t.attackRange + t.def.hull + o.def.hull)));
  return { x: t.x + dx / d * go, y: t.y + dy / d * go };
}
// "Pip" health (Tombstone, zombies, Ice Spire): an attack of a hero removes one pip, any other attack `share` of a pip,
// everything that is not an attack removes nothing.
const pipHit = (share) => function postMit(m, d) { d.amount = (d.flags & F_ATTACK) && d.src ? (d.src.isHero ? 1 : val(share, m)) : 0; };

// ================================================================ Morphling
// "50% higher" in the Adaptive Strike tooltip text (the threshold is not a data value)
const MORPH_RATIO = 1.5;
// [L] measured in Hero Demo: Morphling travels with the wave (speed per tick), invulnerable but not out of play; a unit is hit when
// Morphling is 258..300 from it (targets 300 / 500 / 800 away were hit 1 / 6 / 13 ticks after the start): modelled as width + 80
const WAVE_REACH = 80;
modifier('modifier_morphling_waveform', {
  hidden: true, purge: 'none', state: ['INVULN'], interval: (m) => m.parent.world.dt,
  onThink(m) { const u = m.parent; const dx = m.x - u.x; const dy = m.y - u.y; const d = hyp(dx, dy); const step = Math.min(d, m.z * u.world.dt); if (d > 0) { u.x += dx / d * step; u.y += dy / d * step; } },
  onDestroy(m) { const u = m.parent; if (u.alive) { u.x = m.x; u.y = m.y; } },
});
defAbility('morphling_waveform', {
  prio: 62, fid: 'full', note: 'Morphling moves with the wave at its speed, invulnerable and unable to act (modelled as a channel of the travel time); units are hit when the wave is width + 80 from them (measured). Default controller: surges through its target when it is within cast range + 150',
  ai: (ab, u, t) => (t && u.distTo(t) <= ab.castRange() + 150 ? { x: t.x, y: t.y } : null),
  channel: (ab) => (ab.data && ab.data.travel) || 0,
  cast(ab, t, x, y) {
    const u = ab.owner; const w = u.world; const sx = u.x; const sy = u.y;
    const dx = x - sx; const dy = y - sy; const d = hyp(dx, dy) || 1; const len = Math.min(d, ab.castRange()); const ux = dx / d; const uy = dy / d;
    const ex = sx + ux * len; const ey = sy + uy * len; const speed = ab.v('speed'); const reach = ab.v('width') + WAVE_REACH;
    for (const e of enemiesInLine(ab, sx, sy, ex, ey, ab.v('width'))) {
      const along = Math.max(0, Math.min(len, (e.x - sx) * ux + (e.y - sy) * uy));
      w.after(Math.max(w.dt, (along - reach) / speed), () => hit(ab, e, ab.v('AbilityDamage'), MAGICAL));
    }
    ab.data = { travel: len / speed };
    const m = addMod(ab, u, 'modifier_morphling_waveform', len / speed);
    if (m) { m.x = ex; m.y = ey; m.z = speed; } else { u.x = ex; u.y = ey; }
  },
});
defAbility('morphling_adaptive_strike_agi', {
  prio: 60, fid: 'approx', note: 'agility multiplier interpolated by agility / strength - 0.5 and stun / knockback by strength / agility - 0.5 (each clamped to 0..1, so the maximum is reached at 1.5 x, as the tooltip says; measured); knockback applied instantly',
  cast(ab, t) {
    const u = ab.owner; const w = u.world;
    // [L] measured in Hero Demo: agi 168.8 / str 111.2 -> multiplier 2.5 (max), stun 0.83 s, knockback 98; agi 183.8 / str 146.2 -> multiplier
    // 2.01, stun 1.12 s: each scale runs linearly from a ratio of 0.5 (minimum) to 1.5 (maximum)
    const ka = Math.min(1, Math.max(0, u.agi / Math.max(1, u.str) - (MORPH_RATIO - 1)));
    const ks = Math.min(1, Math.max(0, u.str / Math.max(1, u.agi) - (MORPH_RATIO - 1)));
    const dmg = ab.v('damage_base') + u.agi * (ab.v('damage_min') + (ab.v('damage_max') - ab.v('damage_min')) * ka);
    const st = ab.v('stun_min') + (ab.v('stun_max') - ab.v('stun_min')) * ks;
    const kb = ab.v('knockback_min') + (ab.v('knockback_max') - ab.v('knockback_min')) * ks;
    w.projectile(u, t, ab.v('projectile_speed'), (tt) => { if (tt.isImmune()) return; hit(ab, tt, dmg, MAGICAL); if (!tt.alive) return; stun(ab, tt, st); knockback(tt, u.x, u.y, kb); });
  },
});

// Attribute Shift. The two halves are one linked ability in the game ("leveling one also levels the other"); the engine gives each
// half its own skill points, so the level used here is the sum of both (capped). Net shifted points live on the agility half.
const MORPH_AGI = 'morphling_morph_agi'; const MORPH_STR = 'morphling_morph_str';
const MORPH_TICK = 0.1;      // structural: points are moved every 0.1 s at morph_rate per second
function morphState(u) { const a = u.findAbility(MORPH_AGI); if (!a) return null; return a.data || (a.data = { net: 0, copied: false, linked: false }); }
function morphLevel(u) { const a = u.findAbility(MORPH_AGI); const s = u.findAbility(MORPH_STR); if (!a || !s) return 0; return morphState(u).linked ? Math.max(a.level, s.level) : Math.min(a.maxLevel, a.level + s.level); }
// base points (level growth + attribute bonus levels; no items, no talents) still left in the attribute that is being drained
function morphPool(u, toAgi) { const st = morphState(u); return u.baseAttr(toAgi ? 'str' : 'agi') + u.attrLevels * 2 + (toAgi ? -st.net : st.net); }
// controller assumption: agility while no hero has hurt Morphling for 3 s (never more than half of the base strength is converted),
// strength while he is being hurt and below 75% health, otherwise hold
const morphFloor = (u) => (u.baseAttr('str') + u.attrLevels * 2) / 2;
function morphWant(u) {
  const quiet = u.world.time - u.lastHurt;
  if (quiet <= 2) return u.hp / u.maxHp < 0.75 && morphPool(u, false) >= 1 ? MORPH_STR : null;
  return quiet > 3 && morphPool(u, true) > morphFloor(u) ? MORPH_AGI : null;
}
function morphSet(u, name) { for (const n of [MORPH_AGI, MORPH_STR]) { const a = u.findAbility(n); if (a) a.toggled = n === name; } }
const morphOwner = (m) => m.name === 'modifier_' + MORPH_AGI || !m.parent.hasModifier('modifier_' + MORPH_AGI);
const morphShiftDef = () => ({
  hidden: true, purge: 'none', interval: MORPH_TICK, thinkNow: true,
  stats: (m) => { if (!morphOwner(m)) return null; const st = morphState(m.parent); return st && st.net ? { agi: st.net, str: -st.net } : null; },
  onThink(m) {
    if (!morphOwner(m)) return;
    const u = m.parent; const w = u.world; const st = morphState(u); const agi = u.findAbility(MORPH_AGI); const str = u.findAbility(MORPH_STR);
    if (u.isIllusion) { if (!st.copied) { st.copied = true; const os = u.owner && u.owner !== u ? morphState(u.owner) : null; if (os) { st.net = os.net; u.dirty = true; } } return; }
    // only one half was given points: the other half comes with it at the same level
    if (!st.linked && (agi.level > 0) !== (str.level > 0)) { st.linked = true; const lv = Math.max(agi.level, str.level); agi.setLevel(lv); str.setLevel(lv); }
    // Shard: the shift can be switched while stunned (the controller cannot act then, so its rule is applied here)
    if (u.st[ST.STUN] > 0 && agi.v('castable_while_stunned') > 0 && u.ai && u.ai.mode === 'fight') morphSet(u, morphWant(u));
    const on = agi.toggled ? agi : str.toggled ? str : null;
    if (!on) return;
    // [L] measured in Hero Demo: points_per_tick points move every 1 / morph_rate s rounded up to whole server ticks (16 / s -> one
    // point every 2 ticks = 15 / s), the first one tick after switching on; each point costs mana_cost / morph_rate mana
    const rate = levelVal(on, 'morph_rate', morphLevel(u)); const ppt = on.v('points_per_tick') || 1;
    const toAgi = on === agi; const pool = morphPool(u, toAgi); const cost = on.v('mana_cost') / rate * ppt;
    // a unit run by the default controller stops at the controller's strength floor even while it cannot act (taunt, channel, ...)
    const min = toAgi && u.ai && u.ai.mode === 'fight' ? morphFloor(u) : 1e-6;
    if (pool <= min || (!w.freeSpells && u.mana < cost)) { on.toggled = false; return; }
    if (!w.freeSpells) u.mana -= cost;
    const pts = Math.min(pool, ppt);
    st.net += toAgi ? pts : -pts; u.dirty = true;
    m.nextThink = w.time + Math.ceil(1 / rate / w.dt - 1e-6) * w.dt;
  },
});
// switching on: the first point moves one server tick later
function morphKick(u) { const m = u.findModifier('modifier_' + MORPH_AGI) || u.findModifier('modifier_' + MORPH_STR); if (m) m.nextThink = u.world.time + u.world.dt; }
modifier('modifier_' + MORPH_AGI, morphShiftDef());
modifier('modifier_' + MORPH_STR, morphShiftDef());
const morphNote = (dir) => `toggle; moves base ${dir} one point at a time every 1 / morph_rate s rounded up to whole server ticks (measured), mana_cost / morph_rate mana per point, while mana lasts (base = level growth + attribute bonus levels). The level is the sum of the points in both halves (one linked ability in the game; if only one half has points the other half is given the same level). Health follows the engine rule for strength changes (health percentage is kept; the tooltip does not say how the game treats current health). Default controller: shifts to Agility while no hero has hurt Morphling for 3 s (converting at most half of the base Strength), to Strength while he is being hurt and below 75% health, holds otherwise; with the Shard the same rule also runs while he is stunned`;
for (const [name, dir] of [[MORPH_AGI, 'Strength into Agility'], [MORPH_STR, 'Agility into Strength']]) {
  defAbility(name, {
    mods: ['modifier_' + name], illusion: true, prio: 97, fid: 'approx', note: morphNote(dir),
    ai: (ab, u, t) => { if (!t) return null; const want = morphWant(u); if (ab.toggled) return want !== name ? SELF : null; return want === name && (u.world.freeSpells || u.mana >= ab.v('mana_cost')) ? SELF : null; },
    cast(ab) { const on = !ab.toggled; morphSet(ab.owner, on ? name : null); if (on) morphKick(ab.owner); },
  });
}
// strength with the level growth accumulated in single precision, as the game does (the engine does the same for attack damage)
function f32Str(u) {
  const o = u.ovr; const bs = o && o.attrs ? o.attrs : u.def; const f = Math.fround;
  if (bs.strGain === undefined) return u.str;
  let a = f(bs.str); const g = f(bs.strGain); for (let i = 1; i < u.level; i++) a = f(a + g);
  return u.str - (bs.str + bs.strGain * (u.level - 1)) + a;
}
passive('morphling_ebb_and_flow', {
  illusion: true, fid: 'full', note: 'value meaning taken from the in-game labels ("% AGILITY TO ATTACK RANGE" etc.); attack range only while ranged',
  late(m, s, u) {
    // [L] measured in Hero Demo: whole units (111.2 str -> 27, not 27.8), from the strength the game holds in single precision
    // (the level gain is added once per level, so 44 is 43.99999 at level 11 -> 10, not 11)
    s.castRange += Math.floor(f32Str(u) * m.v('cast_range_per_str') / 100);
    s.slowResMul *= 1 - Math.min(100, u.str * m.v('slow_resist_per_str') / 100) / 100;
    s.ms += u.agi * m.v('move_speed_per_agi') / 100;
    if (!u.melee) s.attackRange += u.agi * m.v('attack_range_per_agi') / 100;
  },
});

// Morph: two forms for the duration. Replicated form = the target's basic abilities, primary attribute, attack type and base attack
// range; own form = Waveform / Adaptive Strike. Morph Replicate switches between them.
const MORPH_OWN = ['morphling_waveform', 'morphling_adaptive_strike_agi'];
const ECHO_LIFE = 20;        // structural: how long a hidden Scepter replicant stays around as the source of its lingering effects
function replicateForm(ab, rep) {
  const u = ab.owner; const s = ab.data; if (!s) return;
  s.rep = rep;
  for (const c of s.stolen) {
    if (rep) { c.setLevel(s.lv.get(c)); continue; }
    // unlearned while he is in his own form; the values stay, so that effects of the ability that are still running keep them
    const keep = { ...c.vals }; c.setLevel(0); Object.assign(c.vals, keep);
  }
  // his own two spells are unlearned in the same way while he is in the replicated form
  for (const n of MORPH_OWN) {
    const o = u.findAbility(n); if (!o) continue;
    if (rep) { if (o.level > 0) { s.own.lv.set(o, o.level); const keep = { ...o.vals }; o.setLevel(0); Object.assign(o.vals, keep); } }
    else if (s.own.lv.has(o)) { o.setLevel(s.own.lv.get(o)); s.own.lv.delete(o); }
  }
  u.attr = rep ? s.attr : s.own.attr; u.melee = rep ? s.melee : s.own.melee;
  // [L] measured in Hero Demo: the replicated form also takes the target's base movement speed (270 of the dummy instead of 285)
  u.ovr = rep ? { ...(s.own.ovr || {}), range: s.range, ms: s.ms } : s.own.ovr;
  u.dirty = true; u.refreshAI();
}
function replicateEnd(ab) {
  const u = ab.owner; const s = ab.data; if (!s) return;
  replicateForm(ab, false);
  // the entries of the old form stay on Morphling (unlearned, unused) until the next Morph: effects that are still running
  // (delayed spawns, damage over time) may look their abilities up by name
  ab.old = s.stolen.concat(s.blank); for (const c of ab.old) c.ai = false;
  ab.data = null; u.refreshAI();
}
function replicateDrop(ab) {
  const u = ab.owner; if (!ab.old) return;
  for (const c of ab.old) { const i = u.abilities.indexOf(c); if (i >= 0) u.abilities.splice(i, 1); }
  ab.old = null;
}
// would the default controller use this replicated ability right now?
function replicateWants(c, u, t, w) {
  const sc = c.script;
  if (!sc || !(sc.cast || sc.ai) || c.passive || sc.manual) return false;
  if (!w.freeSpells && (c.cdRemaining() > 0 || (c.vals.AbilityCharges > 0 && c.charges < 1) || u.mana < c.manaCost())) return false;
  return sc.ai ? !!sc.ai(c, u, t, w) : sc.cond ? !!sc.cond(c, u, t, w) : !!t;
}
modifier('modifier_morphling_replicate_echo', {
  hidden: true, purge: 'none', state: ['OUT', 'INVULN', 'UNTARGETABLE'],
  stats: (m) => ({ debuffAmp: m.data.pct - 100, healAmp: m.data.pct - 100 }),
  outgoing(m, d) { if (!(d.flags & F_ATTACK)) d.amount *= m.data.pct / 100; },
});
function replicateEcho(m, a, lvl, t0, pct) {
  const u = m.parent; const ab = m.ability; const w = u.world;
  if (!u.alive || m.removed) return;
  const others = w.inRadius(t0.x, t0.y, ab.v('scepter_echo_retarget_radius'), t0.team, false).filter((e) => e !== t0 && e !== u && e.targetable() && (e.team === u.team || !(e.st[ST.IMMUNE] > 0 && !a.pierces)));
  const t = others.length ? others[w.rng.int(0, others.length - 1)] : t0;
  if (!t.alive) return;
  const ang = w.rng.next() * 2 * Math.PI; const dist = ab.v('scepter_echo_appear_distance');
  const rep = w.createIllusion(u, { duration: ECHO_LIFE, outPct: pct - 100, inPct: 0, x: t.x + Math.cos(ang) * dist, y: t.y + Math.sin(ang) * dist });
  rep.ai = null;
  rep.addModifier('modifier_morphling_replicate_echo', { ability: ab, data: { pct } });
  const rs = morphState(rep); const us = morphState(u); if (rs && us) { rs.net = us.net; rs.copied = true; }
  let c = rep.findAbility(a.name);
  if (!c) { c = rep.addAbility(a.name, 0); c.maxLevel = a.maxLevel; }
  c.setLevel(lvl); c.cdEnd = 0;
  rep.recompute(); rep.mana = rep.maxMana;
  rep.castAb = c; rep.castTarget = t; rep.castX = t.x; rep.castY = t.y; rep.finishCast();
  // "shorter buffs": enemy debuffs are shortened through the replicant's debuff amplification; buffs it applied right now are cut here
  for (const o of w.units) if (o.alive && o.team === u.team) for (const b of o.mods) if (b.caster === rep && b.created === w.time && !b.def.debuff && !b.def.hidden && b.dieTime !== Infinity) b.dieTime = w.time + (b.dieTime - w.time) * pct / 100;
}
buff('modifier_morphling_replicate', {
  purge: 'none',
  onDestroy(m) { replicateEnd(m.ability); },
  // Scepter: every unit-targeted spell cast while Morph is active is repeated by weaker replicants
  onCast(m, ev) {
    const ab = m.ability; const a = ev.ability; const t = ev.target; const n = ab.v('scepter_echo_count');
    if (n <= 0 || !t || t === m.parent || a === ab || a.isItem || !a.script || !a.script.cast || !a.def.behavior.includes('UNIT_TARGET')) return;
    const lvl = a.level;
    for (let i = 0; i < n; i++) {
      const pct = ab.v('scepter_echo_damage_outgoing_pct') - ab.v('scepter_echo_damage_falloff_pct') * i;
      if (pct > 0) m.parent.world.after(ab.v('scepter_echo_cast_delay') * (i + 1), () => replicateEcho(m, a, lvl, t, pct));
    }
  },
});
defAbility('morphling_replicate', {
  prio: 86, fid: 'approx',
  note: 'copies the target\'s learned non-ultimate, non-innate abilities at the target\'s levels (level not stated in the tooltip; Scepter / Shard abilities only if Morphling owns the item) and takes its primary attribute, melee/ranged type and base attack range; other base stats stay Morphling\'s. The abilities of the form that is not active are unlearned (Waveform and Adaptive Strike in the replicated form, the copied abilities in his own form); effects that are already running keep their values. The target\'s other abilities (ultimate, innate) are present as unlearned entries, so a copied ability whose script reads one of them gets its level 1 values; the copied entries stay listed at level 0 after Morph until the next Morph. Scepter echoes are cast by hidden replicants (they stay around for 20 s as the source of their lingering effects) with 50% / 25% damage, healing, enemy debuff duration and duration of the buffs they apply at the cast instant. Default controller: cast on its hero target as soon as possible',
  ai: (ab, u, t) => (t && t.isHero && !t.isIllusion && t !== u && !ab.data ? { target: t } : null),
  cast(ab, t) {
    const u = ab.owner; if (!t || t === u) return;
    u.removeModifierByName('modifier_morphling_replicate'); replicateDrop(ab);
    const stolen = []; const blank = []; const lv = new Map();
    for (const a of t.abilities) {
      const d = a.def;
      if (u.findAbility(a.name)) continue;
      const basic = !(d.innate || d.type === 'ultimate' || d.behavior.includes('NOT_LEARNABLE'));
      const lvl = !basic ? 0 : d.bySc ? (u.hasScepter ? 1 : 0) : d.bySh ? (u.hasShard ? 1 : 0) : a.level;
      const c = u.addAbility(a.name, 0); c.maxLevel = a.maxLevel;
      // abilities that are not copied stay as unlearned (level 0, inert) entries, so that a copied ability whose script looks up
      // another ability of its hero (e.g. a Scepter ability that reads the ultimate's values) finds it instead of nothing
      if (lvl < 1) { c.ai = false; blank.push(c); } else { lv.set(c, lvl); stolen.push(c); }
    }
    ab.data = { stolen, blank, lv, rep: false, attr: t.attr, melee: t.melee, range: baseRange(t), ms: t.ovr && t.ovr.ms !== undefined ? t.ovr.ms : t.def.ms, own: { attr: u.attr, melee: u.melee, ovr: u.ovr, lv: new Map() } };
    const tg = u.findAbility('morphling_morph_replicate'); if (tg && tg.level < 1) tg.setLevel(1);
    addMod(ab, u, 'modifier_morphling_replicate', ab.v('duration'));
    replicateForm(ab, true);
  },
});
defAbility('morphling_morph_replicate', {
  prio: 96, fid: 'approx', note: 'switches between the two forms; default controller: replicated form while one of the copied abilities is ready and wanted, own form otherwise',
  ai: (ab, u, t, w) => { const m = u.findAbility('morphling_replicate'); const s = m && m.data; if (!s || !t) return null; return s.stolen.some((c) => replicateWants(c, u, t, w)) !== s.rep ? SELF : null; },
  cast(ab) { const m = ab.owner.findAbility('morphling_replicate'); if (m && m.data) replicateForm(m, !m.data.rep); },
});

// ================================================================ Tinker
debuff('modifier_tinker_laser_blind', { stats: { miss: 'miss_rate' } });
debuff('modifier_tinker_laser_shrink', { multi: 'stack', stats: (m) => ({ hpPct: -m.v('scepter_reduction_pct') * m.stacks }) });
defAbility('tinker_laser', {
  prio: 62, fid: 'approx', note: 'Scepter Shrink Ray: lasts as long as the blind and stacks additively (neither is stated in the data); current health shrinks with maximum health',
  cast(ab, t) {
    const r = ab.v('radius_explosion'); const list = r > 0 ? enemiesNear(ab, t.x, t.y, r) : [t];
    if (!list.includes(t)) list.push(t);
    for (const e of list) {
      if (e.isImmune()) continue;
      hit(ab, e, ab.v('laser_damage') * (e === t ? 1 : ab.v('splash_pct') / 100), PURE);
      if (e.alive) addMod(ab, e, 'modifier_tinker_laser_blind', ab.v('duration'));
    }
    if (ab.v('scepter_reduction_pct') > 0 && t.alive) addMod(ab, t, 'modifier_tinker_laser_shrink', ab.v('duration'));
  },
});
buff('modifier_tinker_march_of_the_machines_heal', { stats: { hpRegen: 'heal_per_second' } });
defAbility('tinker_march_of_the_machines', {
  prio: 50, fid: 'approx', note: 'robots are statistical: each of the machines_per_sec robots hits an enemy inside the area with probability (robot + unit collision width) / (area width) and splashes around it; the area is a circle of `radius` around the cast point; robots do not shield units behind them. Scepter: allied heroes inside the area carry the non-stacking heal (heal_duration, re-applied twice per second while robots march) instead of receiving it when a robot passes through them. Default controller: cast towards the target when it is within cast range + radius - 150',
  ai: (ab, u, t) => { if (!t) return null; const d = u.distTo(t); const r = ab.castRange(); if (d > r + ab.v('radius') - 150) return null; const k = Math.min(1, r / (d || 1)); return { x: u.x + (t.x - u.x) * k, y: u.y + (t.y - u.y) * k }; },
  cast(ab, t, x, y) {
    const u = ab.owner; const w = u.world; const rate = ab.v('machines_per_sec'); const n = Math.round(ab.v('duration') * rate);
    const r = ab.v('radius'); const col = ab.v('collision_radius'); const t0 = w.time; const speed = ab.v('speed');
    // robots start on the far side of the area (radius behind the cast point, seen from Tinker) and walk `distance` at `speed`
    // ([L] measured in Hero Demo: the first hits on a unit at the cast point come 2.4..3.3 s after the cast, none earlier)
    const ddx = x - u.x; const ddy = y - u.y; const dd = hyp(ddx, ddy); const ux = dd > 1 ? ddx / dd : 1; const uy = dd > 1 ? ddy / dd : 0;
    const sx = x - ux * r; const sy = y - uy * r;
    const robot = (i) => {
      for (const e of enemiesNear(ab, x, y, r)) {
        if (!w.rng.chance(Math.min(1, (col + e.def.hull) / r))) continue;
        const along = (e.x - sx) * ux + (e.y - sy) * uy; if (along < 0 || along > ab.v('distance')) continue;
        w.after(Math.max(0, along - col - e.def.hull) / speed, () => { if (!e.alive) return; for (const s of enemiesNear(ab, e.x, e.y, ab.v('splash_radius'))) hit(ab, s, ab.v('damage'), MAGICAL); });
      }
      if (ab.v('heal_per_second') > 0 && i % Math.max(1, Math.round(rate / 2)) === 0) for (const a of alliesNear(ab, x, y, r)) if (a.isHero) addMod(ab, a, 'modifier_tinker_march_of_the_machines_heal', ab.v('heal_duration'));
      if (i + 1 < n) w.after(Math.max(0, t0 + (i + 1) / rate - w.time), () => robot(i + 1));
    };
    robot(0);
  },
});
modifier('modifier_tinker_deploy_turrets_turret', {
  hidden: true, purge: 'none', interval: (m) => m.v('missile_spawn_interval'), thinkNow: true,
  onThink(m) {
    const tu = m.parent; const u = m.caster; const ab = m.ability; const w = tu.world;
    // [L] measured in Hero Demo: the turrets of a drop take turns, turret i first fires (2 + i) / n of missile_spawn_interval after
    // the drop (1.5 s: 1.0 / 1.43 / 1.93 s; 1.2 s: 0.8 / 1.17 / 1.53 s), then every missile_spawn_interval
    if (!m.y) { m.y = 1; const o = m.data || { i: 0, n: 1 }; m.nextThink = w.time + m.interval * (2 + o.i) / Math.max(1, o.n); return; }
    let best = null; let bd = ab.v('missile_target_range');
    for (const e of w.units) { if (!e.alive || e.team === tu.team || !e.isHero || !e.attackableBy(tu)) continue; const d = tu.distTo(e); if (d <= bd) { bd = d; best = e; } }
    if (!best) return;
    w.projectile(tu, best, ab.v('missile_speed'), (tt) => {
      const dmg = ab.v('missile_damage');
      for (const e of w.inRadius(tt.x, tt.y, ab.v('radius_explosion'), u.team, true)) if (e !== tt) w.damage(u, e, dmg * ab.v('splash_pct') / 100, MAGICAL, 0, ab);
      w.damage(u, tt, dmg, MAGICAL, 0, ab);
    });
  },
});
defAbility('tinker_deploy_turrets', {
  prio: 55, fid: 'approx', note: 'turrets are real units with turret_hp health; each missile homes on the nearest enemy hero in turret range (in the game it flies straight and stops at the first unit in its way); the first missile is fired on deployment (activation_time = 0); the impact pushes are applied instantly. Default controller: on hero targets, not while two full sets of turrets are still standing',
  // no new drop while two full sets of turrets are still standing (only reachable through Rearm or free spells)
  ai: (ab, u, t) => (t && t.isHero && u.world.units.filter((o) => o.alive && o.owner === u && o.name === 'npc_dota_tinker_turret1').length < 2 * ab.v('turrets_per_drop') ? { x: t.x, y: t.y } : null),
  cast(ab, t, x, y) {
    const u = ab.owner; const w = u.world;
    w.after(ab.v('drop_delay'), () => {
      const r = ab.v('drop_aoe_radius');
      // [L] measured in Hero Demo: a unit standing on the drop point is not moved (no direction to push it)
      for (const e of enemiesNear(ab, x, y, r)) { hit(ab, e, ab.v('drop_damage'), MAGICAL); if (e.alive && hyp(e.x - x, e.y - y) > 1) knockback(e, x, y, ab.v('drop_knockback_distance')); }
      if (u.alive && hyp(u.x - x, u.y - y) <= r) knockback(u, x, y, ab.v('drop_knockback_distance_tinker'));
      const n = ab.v('turrets_per_drop') + ab.v('extra_turrets_per_drop'); const pr = ab.v('turret_placement_radius');
      for (let i = 0; i < n; i++) {
        const a = 2 * Math.PI * i / n;
        // [L] measured in Hero Demo: every turret fires for turret_duration counted from its first missile (3 missiles each at 4.5 s / 1.5 s,
        // 4 each at 4.5 s / 1.2 s, the last one 4.93 s after the drop)
        const life = ab.v('turret_duration') + ab.v('missile_spawn_interval') * (2 + i) / n;
        const tu = summon(ab, 'npc_dota_tinker_turret1', { x: x + Math.cos(a) * pr, y: y + Math.sin(a) * pr, duration: life, ovr: { hp: ab.v('turret_hp') }, ai: 'idle' });
        tu.addModifier('modifier_tinker_deploy_turrets_turret', { caster: u, ability: ab, data: { i, n } });
      }
    });
  },
});
debuff('modifier_tinker_warp_grenade', {
  stats: (m) => ({ msPct: -m.v('movement_slow_pct') }),
  late(m, s, u) { s.attackRange -= (baseRange(u) + s.attackRange) * m.v('range_reduction') / 100; },
  // cast range: the engine only has flat cast range bonuses, so the listed ranges of the target's abilities and items are scaled directly
  onCreated(m) { const k = 1 - m.v('range_reduction') / 100; for (const a of m.parent.abilities.concat(m.parent.items)) if (a.vals.AbilityCastRange > 0) a.vals.AbilityCastRange *= k; },
  onDestroy(m) { for (const a of m.parent.abilities.concat(m.parent.items)) a.refresh(); },
});
defAbility('tinker_warp_grenade', {
  prio: 66, fid: 'approx', note: 'projectile of 2500 speed (not in the data; measured at one distance: 500 in 0.2 s); cast range reduction scales the listed cast ranges, flat cast range bonuses are not reduced; default controller: used on a hero within 400 of Tinker',
  ai: (ab, u, t) => (t && t.isHero && !t.isImmune() && u.distTo(t) <= 400 ? { target: t } : null),
  cast(ab, t) {
    const u = ab.owner;
    // [L] measured in Hero Demo: the grenade reaches a target 500 away 0.2 s after the cast
    u.world.projectile(u, t, 2500, (tt) => {
      const dx = tt.x - u.x; const dy = tt.y - u.y; const d = hyp(dx, dy) || 1;
      const warp = Math.min(ab.v('max_distance'), Math.max(0, ab.v('warp_distance_factor') * (ab.castRange() - d)));
      hit(ab, tt, ab.v('damage'), MAGICAL);
      if (!tt.alive) return;
      tt.x += dx / d * warp; tt.y += dy / d * warp;
      addMod(ab, tt, 'modifier_tinker_warp_grenade', ab.v('debuff_duration'));
    });
  },
});
na('tinker_keen_teleport', 'teleport to a friendly structure / unit: map movement');
const TINKER_NUKES = ['tinker_laser', 'tinker_march_of_the_machines', 'tinker_deploy_turrets'];
defAbility('tinker_rearm', {
  prio: 15, engage: false, channel: true, fid: 'full', note: 'resets ability cooldowns (one charge is restored on abilities with charges); items are not refreshed (affects_items = 0). Default controller: rearms when Laser, March and Turrets are all on cooldown for longer than the channel and mana covers Rearm plus the cheapest of them',
  ai: (ab, u, t) => {
    if (!t) return null;
    let n = 0; let cheapest = Infinity;
    for (const name of TINKER_NUKES) { const a = u.findAbility(name); if (!a || a.level < 1) continue; if (a.cdRemaining() <= ab.v('AbilityChannelTime')) return null; n++; cheapest = Math.min(cheapest, a.manaCost()); }
    return n > 0 && (u.world.freeSpells || u.mana >= ab.manaCost() + cheapest) ? SELF : null;
  },
  channelEnd(ab, interrupted) {
    if (interrupted) return;
    for (const a of ab.owner.abilities) { if (a === ab) continue; a.cdEnd = 0; const max = a.vals.AbilityCharges || 0; if (max > 0 && a.charges < max) a.charges++; }
  },
  cast() {},
});
passive('tinker_eureka', {
  fid: 'approx', note: 'whole percents (1% per int_per_one_cdr Intelligence); shortens the cooldown of items Tinker activates (on items with charges: the restore timer that the cast starts); cooldowns that item passives start on their own (e.g. Linken\'s Sphere) are not reduced',
  onCast(m, ev) {
    const a = ev.ability; const u = m.parent; const now = u.world.time;
    if (!a.isItem) return;
    const k = Math.min(m.v('max_cdr'), Math.floor(u.int / m.v('int_per_one_cdr')) * m.v('one_percent_tooltip')) / 100;
    if (k <= 0) return;
    if (a.cdEnd > now) a.cdEnd = now + (a.cdEnd - now) * (1 - k);
    // the restore timer only when this cast started it (a cast from full charges), so that it is never shortened twice
    if (a.chargeEnd > now && a.charges === (a.vals.AbilityCharges || 0) - 1) a.chargeEnd = now + (a.chargeEnd - now) * (1 - k);
  },
});

// ================================================================ Largo
// Encore (innate): buffs Largo applies to himself or his team last longer. Largo's own abilities multiply their durations by
// encoreMul(); timed buffs coming from his items are stretched by the passive below as soon as they appear.
const encoreMul = (u) => { const e = u.findAbility('largo_encore'); return e && e.level > 0 && !(u.st[ST.BREAK] > 0) ? 1 + e.v('buff_amplification') / 100 : 1; };
const encoreRepeats = (u) => { const e = u.findAbility('largo_encore'); return !!e && e.level > 0 && e.v('repeat_buff') > 0 && !(u.st[ST.BREAK] > 0); };
// Shard: the second hero that also receives a unit-target buff (Largo himself, or the nearest allied hero in cast range when he targets himself)
function encoreOther(u, t, a) {
  if (t !== u) return u;
  let best = null; let bd = a.castRange() > 0 ? a.castRange() : Infinity;
  for (const o of u.world.units) { if (!o.alive || o === u || o.team !== u.team || !o.isHero || o.isIllusion) continue; const d = u.distTo(o); if (d <= bd) { bd = d; best = o; } }
  return best;
}
passive('largo_encore', {
  fid: 'approx', note: 'duration bonus is built into Largo\'s own abilities; timed buffs that his items put on him or his team are stretched within 0.1 s of appearing (the engine has no "buff applied" hook; a buff that is only refreshed is not stretched again). Shard: Croak of Genius and friendly unit-target items are repeated on the second hero by running their effect again',
  interval: 0.1, onCreated(m) { m.data = new WeakSet(); },
  onThink(m) {
    const u = m.parent; const now = u.world.time; const k = 1 + m.v('buff_amplification') / 100;
    for (const o of u.world.units) {
      if (!o.alive || o.team !== u.team) continue;
      for (const b of o.mods) { if (b.caster !== u || !b.ability || !b.ability.isItem || b.def.debuff || b.dieTime === Infinity || m.data.has(b)) continue; m.data.add(b); if (b.created >= now - 0.15) b.dieTime = now + (b.dieTime - now) * k; }
    }
  },
  onCast(m, ev) {
    const u = m.parent; const a = ev.ability; const t = ev.target;
    if (a.isItem && m.v('repeat_buff') > 0 && t && t.team === u.team && t.isHero && a.script && a.script.cast && a.def.behavior.includes('UNIT_TARGET') && !(a.def.team || '').includes('ENEMY')) { const o = encoreOther(u, t, a); if (o) a.script.cast(a, o, o.x, o.y); }
  },
});
const largoPlaying = (u) => u.hasModifier('modifier_largo_amphibian_rhapsody');
buff('modifier_largo_catchy_lick_buff', { stats: { hpRegen: 'dispel_hp_regen' } });
defAbility('largo_catchy_lick', {
  prio: 56, fid: 'approx', note: 'the pull is applied instantly (pull_duration is not simulated); default controller: nukes its target, or licks an allied hero that carries a dispellable debuff with 2 s or more left',
  ai: (ab, u, t) => {
    if (largoPlaying(u)) return null;
    for (const a of u.world.units) if (a.alive && a !== u && a.team === u.team && a.isHero && u.distTo(a) <= ab.castRange() && a.mods.some((m) => m.def.debuff && (m.def.purge || 'basic') === 'basic' && m.caster.team !== a.team && m.remaining() >= 2)) return { target: a };
    return t && !t.isImmune() ? { target: t } : null;
  },
  cast(ab, t) {
    const u = ab.owner; if (!t) return;
    const enemy = t.team !== u.team; const before = t.mods.length; const strong = ab.v('strong_dispel') > 0;
    if (enemy) t.purge({ debuffs: false, buffs: true, strong }); else t.purge({ debuffs: true, strong });
    const dispelled = t.mods.length < before;
    if (enemy) hit(ab, t, ab.v('damage'), MAGICAL);
    if (t.alive && t !== u) knockback(t, u.x, u.y, -(enemy ? ab.v('pull_distance') : ab.v('pull_distance_ally')));
    if (dispelled || !t.alive) addMod(ab, u, 'modifier_largo_catchy_lick_buff', ab.v('buff_duration') * encoreMul(u));
  },
});
debuff('modifier_largo_frogstomp_debuff', { statusResist: false, purge: 'none', stats: { msPct: neg('slow') } });
defAbility('largo_frogstomp', {
  prio: 54, fid: 'full', note: 'the slow is re-applied every 0.25 s to enemies inside the area from the landing until 0.1 s before the froglings\' total_ticks * stomp_interval run out',
  ai: (ab, u, t) => (t && !largoPlaying(u) ? { x: t.x, y: t.y } : null),
  cast(ab, t, x, y) {
    const n = ab.v('total_ticks'); const iv = ab.v('stomp_interval'); const w = ab.owner.world;
    zone(ab, x, y, { radius: 'radius', duration: n * iv, interval: iv, delay: 'delay', tick: (e) => { hit(ab, e, ab.v('damage_per_stomp'), MAGICAL); if (e.alive) stun(ab, e, ab.v('stun_duration')); } });
    // [L] measured in Hero Demo: the slow ends 6.9 s after the landing with 7 stomps 1 s apart (last stomp + 0.9 s)
    const end = w.time + ab.v('delay') + n * iv - 0.1;
    zone(ab, x, y, { radius: 'radius', duration: n * iv - 0.1, interval: 0.25, delay: 'delay', tick: (e) => addMod(ab, e, 'modifier_largo_frogstomp_debuff', Math.min(0.3, end - w.time)) });
  },
});
// reverberating damage: one debuff per (victim, damage dealer) holding the pending instances as [ticks left, damage per tick]
debuff('modifier_largo_croak_of_genius_debuff', {
  multi: 'perCaster', statusResist: false, interval: 1, onCreated(m) { m.data = []; },
  onThink(m) {
    const t = m.parent; let dmg = 0;
    for (const e of m.data) { dmg += e[1]; e[0]--; }
    m.data = m.data.filter((e) => e[0] > 0);
    dmg += m.v('damage_per_second') + t.maxHp * m.v('damage_hp_pct') / 100;
    if (dmg > 0) mhit(m, t, dmg, MAGICAL, F_NO_AMP);
    if (!m.data.length) m.remove();
  },
});
buff('modifier_largo_croak_of_genius_buff', {
  stats: { manaCostRed: 'mana_cost_reduction' },
  onCast(m, ev) { if (m.parent !== m.caster && !m.parent.world.freeSpells && ev.ability.manaCost() > 0) m.setDuration(Math.max(0, m.remaining() - m.v('duration_reduction'))); },
  onDealDamage(m, d) {
    const t = d.dst; const u = m.parent;
    if (d.dealt <= 0 || !t.alive || t.team === u.team || (d.flags & (F_ATTACK | F_NO_AMP | F_HP_LOSS | F_REFLECT)) || u.distTo(t) > m.v('max_distance')) return;
    const n = Math.max(1, Math.round(m.v('damage_duration')));
    const b = t.addModifier('modifier_largo_croak_of_genius_debuff', { caster: u, ability: m.ability, duration: n + 1.05 });
    if (b) b.data.push([n, d.dealt * m.v('damage_portion_pct') / 100 / n]);
  },
});
defAbility('largo_croak_of_genius', {
  prio: 72, fid: 'approx', note: 'reverb = damage_portion_pct of the damage actually dealt (after reductions) by damage that spell amplification affects, paid out as magical damage in 1 s ticks over damage_duration, not amplified again (base and tick size are not stated); the base damage per second (0 in the data) and the talent "Max Health DPS" (damage_hp_pct of the victim\'s maximum health) are added to every reverb tick, i.e. only while damage is reverberating on that enemy (how the talent applies is not described); "spends mana" = casts an ability or item with a mana cost; default controller casts it on Largo himself',
  ai: (ab, u, t) => (t && !largoPlaying(u) && !u.hasModifier('modifier_largo_croak_of_genius_buff') ? { target: u } : null),
  cast(ab, t) {
    const u = ab.owner; const tt = t || u; const list = [tt];
    if (encoreRepeats(u)) { const o = encoreOther(u, tt, ab); if (o) list.push(o); }
    for (const a of list) addMod(ab, a, 'modifier_largo_croak_of_genius_buff', ab.v('duration') * encoreMul(u));
  },
});

// Amphibian Rhapsody: song mode. A beat falls every rhythm_interval; the controller strums exactly on the beat.
const RHAPSODY = 'modifier_largo_amphibian_rhapsody'; const GROOVIN = 'modifier_largo_amphibian_rhapsody_groovin';
const SONG_FIGHT = 'largo_song_fight_song'; const SONG_SPEED = 'largo_song_double_time'; const SONG_HEAL = 'largo_song_good_vibrations';
function largoGroove(u, ult, delta) {
  let g = u.findModifier(GROOVIN);
  if (delta > 0) { if (!g) g = u.addModifier(GROOVIN, { ability: ult }); if (g) g.setStacks(Math.min(ult.v('max_stacks'), g.stacks + 1)); } else if (g) { if (g.stacks <= 1) g.remove(); else g.setStacks(g.stacks - 1); }
}
modifier('modifier_largo_amphibian_rhapsody_groovin_ally', { purge: 'none', stats: (m) => ({ armor: m.data.armor }), onRefresh(m, o) { m.data = o.data; } });
buff(GROOVIN, {
  purge: 'none', interval: 0.5, stats: (m) => ({ armor: m.v('armor_per_stack') * m.stacks }),
  // talent: allies in the radius get a share of the Groovin' armor
  onThink(m) { const u = m.parent; const pct = m.v('armor_ally_pct'); if (pct <= 0) return; for (const a of u.world.inRadius(u.x, u.y, m.v('radius'), u.team, false)) if (a !== u) a.addModifier('modifier_largo_amphibian_rhapsody_groovin_ally', { caster: u, ability: m.ability, duration: 1, data: { armor: m.v('armor_per_stack') * m.stacks * pct / 100 } }); },
});
buff(RHAPSODY, {
  // [L] measured in Hero Demo: Largo keeps attacking in song mode (no disarm state)
  purge: 'none', interval: 0.1,
  onCreated(m) { m.data = { beat: -1, plan: [], played: [] }; },
  onDestroy(m) { m.ability.toggled = false; },
  // a beat that passed without a strum costs a stack
  onThink(m) { const ab = m.ability; if (m.parent.world.time > m.x + ab.v('rhythm_grace_period') + 1e-9) { if (m.data.beat !== m.x || !m.data.played.length) largoGroove(m.parent, ab, -1); m.x += ab.v('rhythm_interval'); } },
});
// controller assumption: heal when an allied hero is below half health, otherwise damage while enemies are in the radius, otherwise speed
function largoPickSongs(u, t, ult) {
  const w = u.world; const r = ult.v('radius');
  const foes = w.inRadius(u.x, u.y, r, u.team, true).length > 0;
  let low = 1; for (const a of w.inRadius(u.x, u.y, r, u.team, false)) if (a.isHero) low = Math.min(low, a.hp / a.maxHp);
  const order = [];
  if (low < 0.5) order.push(SONG_HEAL);
  if (foes) order.push(SONG_FIGHT);
  if (low < 0.9 && !order.includes(SONG_HEAL)) order.push(SONG_HEAL);
  order.push(SONG_SPEED);
  return order.slice(0, ult.v('double_song') > 0 ? 2 : 1);
}
const songAI = (ab, u, t, w) => {
  const m = u.findModifier(RHAPSODY); if (!m || !t || w.time + 1e-9 < m.x) return null;
  const d = m.data; if (d.beat !== m.x) { d.beat = m.x; d.plan = largoPickSongs(u, t, m.ability); d.played = []; }
  return d.plan.includes(ab.name) && !d.played.includes(ab.name) ? SELF : null;
};
// common part of every song: beat check, Groovin' stack, mana discount; effect(u, stacks, double, encore)
function largoStrum(ab, effect) {
  const u = ab.owner; const w = u.world; const m = u.findModifier(RHAPSODY); const ult = u.findAbility('largo_amphibian_rhapsody');
  if (!m || !ult) return;
  const g0 = u.findModifier(GROOVIN);
  if (!w.freeSpells) u.mana = Math.min(u.maxMana, u.mana + Math.min(ab.manaCost(), ab.v('song_cost_reduction_per_stack') * (g0 ? g0.stacks : 0)));
  const grace = ult.v('rhythm_grace_period');
  if (w.time < m.x - grace - 1e-9 || w.time > m.x + grace + 1e-9) { largoGroove(u, ult, -1); return; }      // off the beat: no effect
  const d = m.data; if (d.beat !== m.x) { d.beat = m.x; d.plan = [ab.name]; d.played = []; }
  if (!d.played.length) largoGroove(u, ult, 1);
  d.played.push(ab.name);
  const g = u.findModifier(GROOVIN);
  effect(u, g ? g.stacks : 0, ult.v('double_song') > 0 && (d.plan.length > 1 || d.played.length > 1), encoreMul(u));
  if (d.played.length >= d.plan.length) m.x += ult.v('rhythm_interval');
}
const songNote = 'only effective in song mode on the beat (the default controller always strums on the beat, one song per beat, two different songs with the Scepter); the flat mana discount per Groovin\' stack is refunded after the cast, so the full cost must be available; the 0.2 s shared cooldown is not enforced';
buff('modifier_largo_song_fight_song_buff', {
  stats: { spellAmp: 'spell_amp_bonus' },
  onAttackLanded(m, rec) { const t = rec.target; if (t.alive && !t.isBuilding && rec.damage > 0) m.parent.world.damage(m.parent, t, rec.damage * m.v('magic_damage_bonus') / 100, MAGICAL, 0, m.ability); },
});
defAbility(SONG_FIGHT, {
  prio: 36, engage: false, ai: songAI, fid: 'approx', note: songNote + '; the extra magic damage is magic_damage_bonus% of the attack\'s damage before armor',
  cast(ab) {
    largoStrum(ab, (u, stacks, double, enc) => {
      const dmg = ab.v('burst_damage') + (double ? ab.v('damage_per_stack') * stacks : 0);
      for (const e of enemiesNear(ab, u.x, u.y, ab.v('radius'))) hit(ab, e, dmg, MAGICAL);
      for (const a of alliesNear(ab, u.x, u.y, ab.v('radius'))) if (a.isHero) addMod(ab, a, 'modifier_largo_song_fight_song_buff', ab.v('battle_burst_duration') * enc);
    });
  },
});
buff('modifier_largo_song_double_time_buff', { stats: { msPct: 'movespeed_bonus_burst' } });
buff('modifier_largo_song_double_time_slowres', { stats: { slowRes: 'slow_resistance' } });
defAbility(SONG_SPEED, {
  prio: 34, engage: false, ai: songAI, fid: 'approx', note: songNote,
  cast(ab) {
    largoStrum(ab, (u, stacks, double, enc) => {
      for (const a of alliesNear(ab, u.x, u.y, ab.v('radius'))) { addMod(ab, a, 'modifier_largo_song_double_time_buff', ab.v('movement_burst_duration') * enc); addMod(ab, a, 'modifier_largo_song_double_time_slowres', ab.v('slow_resistance_burst_duration') * enc); }
    });
  },
});
defAbility(SONG_HEAL, {
  prio: 35, engage: false, ai: songAI, fid: 'approx', note: songNote,
  cast(ab) { largoStrum(ab, (u) => { for (const a of alliesNear(ab, u.x, u.y, ab.v('radius'))) if (a.isHero) healUnit(ab, a, ab.v('heal_burst')); }); },
});
defAbility('largo_amphibian_rhapsody', {
  prio: 40, engage: false, fid: 'approx',
  note: 'toggle: Largo keeps attacking, his three spells are unavailable and the songs become castable (their level follows this ability). The first beat falls rhythm_interval after starting (not stated). One Groovin\' stack per beat with a strum, one lost per beat without; stacks linger stack_duration after stopping. Default controller: plays while Catchy Lick and Frogstomp are on cooldown and an enemy is inside the radius; stops to cast them, when it cannot pay for a song, or when its target has left the radius (a disarmed unit does not walk after its target in this engine)',
  ai: (ab, u, t, w) => {
    if (!t) return null;
    const lick = u.findAbility('largo_catchy_lick'); const stomp = u.findAbility('largo_frogstomp'); const song = u.findAbility(SONG_FIGHT);
    const spell = (lick && lick.ready()) || (stomp && stomp.ready());
    const afford = w.freeSpells || !song || u.mana >= song.manaCost(); const r = ab.v('radius');
    if (ab.toggled) return spell || !afford || u.distTo(t) > r ? SELF : null;
    return !spell && afford && u.distTo(t) <= r - 100 ? SELF : null;
  },
  cast(ab) {
    const u = ab.owner; const on = u.findModifier(RHAPSODY); const g = u.findModifier(GROOVIN);
    ab.cdEnd = 0;                // [L] measured in Hero Demo: neither switching on nor off starts the 1.5 s AbilityCooldown
    if (on) { on.remove(); if (g) g.setDuration(ab.v('stack_duration') * encoreMul(u)); return; }
    ab.toggled = true;
    for (const n of [SONG_FIGHT, SONG_SPEED, SONG_HEAL]) { const s = u.findAbility(n); if (s && s.level !== ab.level) s.setLevel(ab.level); }
    const m = addMod(ab, u, RHAPSODY);
    if (m) m.x = u.world.time + ab.v('rhythm_interval');
    if (g) g.dieTime = Infinity;
  },
});

// ================================================================ Beastmaster
// talents "+N Health / Movespeed to Beastmaster and his summons" keep their number on the talent ability itself
const bmBonus = (u) => ({ hp: talentVal(u, 'special_bonus_unique_beastmaster_6', 'bonus_hp'), ms: talentVal(u, 'special_bonus_unique_beastmaster_5', 'bonus_ms') });
defAbility('special_bonus_unique_beastmaster_5', { fid: 'full', note: 'applied to Beastmaster (Inner Beast script) and to Boar / Thunderhide when they are summoned' });
defAbility('special_bonus_unique_beastmaster_6', { fid: 'full', note: 'applied to Beastmaster (Inner Beast script) and to Boar / Hawks / Thunderhide when they are summoned' });
const bmUnits = (u) => u.world.units.filter((o) => o.alive && (o === u || o.owner === u));
debuff('modifier_beastmaster_wild_axes_debuff', { multi: 'stack', preMit(m, d) { const s = d.src; if (s && (s === m.caster || s.owner === m.caster)) d.amount *= 1 + m.v('damage_amp') * m.stacks / 100; } });
modifier('modifier_beastmaster_wild_axes', {
  hidden: true,
  // Shard: attacks on enemy heroes add a stack
  onAttackLanded(m, rec) { const t = rec.target; if (m.v('apply_debuff_on_attack') > 0 && t.alive && t.isHero && t.team !== m.parent.team) t.addModifier('modifier_beastmaster_wild_axes_debuff', { caster: m.parent, ability: m.ability, duration: m.v('duration') }); },
});
defAbility('beastmaster_wild_axes', {
  mods: ['modifier_beastmaster_wild_axes'], prio: 55, fid: 'approx', note: 'the two curved axe paths (spread) are replaced by one straight corridor of the axe radius: both axes hit every enemy in it once, when they reach the far end; every hit adds its stack first and is amplified by it',
  ai: (ab, u, t) => (t && u.distTo(t) <= ab.v('range') ? { x: t.x, y: t.y } : null),
  cast(ab, t, x, y) {
    const u = ab.owner; const w = u.world; const sx = u.x; const sy = u.y;
    const dx = x - sx; const dy = y - sy; const d = hyp(dx, dy) || 1; const len = Math.min(d, ab.v('range'));
    const ex = sx + dx / d * len; const ey = sy + dy / d * len;
    const T = Math.min(ab.v('max_throw_duration'), Math.max(ab.v('min_throw_duration'), ab.v('max_throw_duration') * len / ab.v('range')));
    // [L] measured in Hero Demo: an axe adds its stack before it deals its damage (first hit x (1 + amp), second x (1 + 2 amp))
    const axe = () => { for (const e of enemiesInLine(ab, sx, sy, ex, ey, 2 * ab.v('radius'))) { addMod(ab, e, 'modifier_beastmaster_wild_axes_debuff', ab.v('duration')); hit(ab, e, ab.v('axe_damage'), MAGICAL); } };
    w.after(T, () => { axe(); axe(); });
  },
});
debuff('modifier_beastmaster_boar_poison_debuff', { stats: { msPct: 'movement_speed', asSlow: 'attack_speed' } });
passive('beastmaster_boar_poison', { fid: 'full', note: 'every Boar attack that lands applies the attack and movement speed slow for `duration`', onAttackLanded(m, rec) { const t = rec.target; if (t.alive && !t.isBuilding) t.addModifier('modifier_beastmaster_boar_poison_debuff', { caster: m.parent, ability: m.ability, duration: m.v('duration') }); } });
defAbility('beastmaster_summon_razorback', {
  prio: 92, engage: false, fid: 'approx', note: 'Boar gets health, damage and speed from this ability and its Poison at this ability\'s level; a new cast replaces the previous Boar (the tooltip does not say whether two can exist). Default controller: when a target is within 1200 and no Boar is alive',
  ai: (ab, u, t) => (t && u.distTo(t) < 1200 && !(ab.data && ab.data.alive) ? SELF : null),
  cast(ab) {
    const u = ab.owner; const b = bmBonus(u); const dmg = ab.v('boar_base_damage') + ab.v('boar_bonus_damage');
    if (ab.data && ab.data.alive) u.world.kill(ab.data, null, null, true);
    const boar = summon(ab, 'npc_dota_beastmaster_boar', { duration: ab.v('duration'), ovr: { hp: ab.v('boar_base_max_health') + b.hp, dmgMin: dmg, dmgMax: dmg, ms: ab.v('boar_base_movespeed') + b.ms } });
    const p = boar.findAbility('beastmaster_boar_poison'); if (p) { p.maxLevel = Math.max(p.maxLevel, ab.level); p.setLevel(ab.level); }
    bmInner(u, boar); boar.nextAttackTime = u.world.time + 0.1;      // [L] measured in Hero Demo: the Boar starts its first attack 0.1 s after it appears
    ab.data = boar;
  },
});
// Hawk: circles around its owner and dive-bombs. All numbers come from the owner's Summon Raptors.
modifier('modifier_beastmaster_hawk_dive', {
  hidden: true, purge: 'none', interval: 0.1, thinkNow: true,
  onThink(m) {
    const h = m.parent; const o = h.owner; const w = h.world; const ab = o && o.findAbility('beastmaster_summon_raptor');
    if (!ab || ab.level < 1) return;
    const ang = 2 * Math.PI * (w.time / ab.v('roaming_seconds_per_rotation') + m.z); const rr = ab.v('roaming_radius');
    h.x = o.x + Math.cos(ang) * rr; h.y = o.y + Math.sin(ang) * rr;
    if (m.y > 0 && w.time - m.x < ab.v('hawk_base_attack_interval') / (h.attackSpeed / 100) - 1e-9) return;      // m.x = time of the last dive
    if (h.cantAct()) return;
    let best = null; let bs = Infinity;
    for (const e of w.inRadius(o.x, o.y, ab.v('attack_radius'), o.team, true)) { if (!e.attackableBy(h) || e.isBuilding || e.isImmune()) continue; const s = (e.isHero ? 0 : 1e6) + o.distTo(e); if (s < bs) { bs = s; best = e; } }
    if (!best) return;
    m.x = w.time; m.y = 1;
    w.projectile(h, best, ab.v('max_move_speed'), (tt) => {
      if (!h.alive || tt.isImmune()) return;
      w.damage(h, tt, ab.v('dive_damage'), MAGICAL, 0, ab);
      if (tt.alive) tt.addModifier('modifier_rooted', { caster: h, ability: ab, duration: ab.v('dive_root_duration') });
    });
  },
});
defAbility('beastmaster_hawk_dive', { mods: ['modifier_beastmaster_hawk_dive'], fid: 'approx', note: 'used automatically: every hawk_base_attack_interval / attack speed the Hawk dives at an enemy within attack_radius of its owner (heroes first), flying at max_move_speed; the first dive is available at once; needs an owner with Summon Raptors' });
defAbility('beastmaster_summon_raptor', {
  prio: 91, engage: false, fid: 'approx', note: 'Hawks are real units (health and magic resistance from this ability) that circle the owner and can be attacked; dive timing see Dive Bomb. The Shard line still in the tooltip (longer duration, extra Hawk) is a leftover (its values are not in the data; the 7.41 patch notes say Summon Raptors is no longer upgraded by the Shard) and is not modelled. Default controller: when a target is within 1200 and no Hawk is alive',
  ai: (ab, u, t) => (t && u.distTo(t) < 1200 && !(ab.data && ab.data.some((h) => h.alive)) ? SELF : null),
  cast(ab) {
    const u = ab.owner; const w = u.world; const n = ab.v('hawk_count'); const b = bmBonus(u); const made = ab.data = [];
    for (let i = 0; i < n; i++) w.after(i * ab.v('hawk_spawn_interval'), () => {
      if (!u.alive) return;
      const h = summon(ab, 'npc_dota_beastmaster_hawk', { x: u.x, y: u.y, duration: ab.v('duration'), ovr: { hp: ab.v('hawk_base_max_health') + b.hp, mr: ab.v('hawk_base_magic_resist') }, ai: 'idle' });
      const hm = h.findModifier('modifier_beastmaster_hawk_dive'); if (hm) hm.z = i / n;
      bmInner(u, h); made.push(h);
    });
  },
});
modifier('modifier_beastmaster_inner_beast_buff', { purge: 'none', stats: { as: 'bonus_attack_speed' } });
aura('modifier_beastmaster_inner_beast', { radius: 'radius', team: 'ally', child: 'modifier_beastmaster_inner_beast_buff', filter: (t, m) => t === m.parent || t.owner === m.parent });
modifier('modifier_beastmaster_inner_beast_talents', { hidden: true, purge: 'none', breakable: false, stats: (m) => { const b = bmBonus(m.parent); return { dmg: m.v('bonus_damage'), hp: b.hp, ms: b.ms }; } });
defAbility('beastmaster_inner_beast', { mods: ['modifier_beastmaster_inner_beast', 'modifier_beastmaster_inner_beast_talents'], fid: 'full', note: 'aura for Beastmaster and the units he owns (a summoned unit has it from its first moment); the talent bonuses for Beastmaster himself (damage, health, speed) are carried by a second, unbreakable modifier' });
// a unit summoned inside the aura has the bonus at once (the aura helper would only reach it at its next 0.5 s pulse)
const bmInner = (u, s) => { const a = u.findAbility('beastmaster_inner_beast'); if (a && a.level > 0 && !(u.st[ST.BREAK] > 0) && s.distTo(u) <= a.v('radius')) s.addModifier('modifier_beastmaster_inner_beast_buff', { caster: u, ability: a, duration: 1 }); if (s.dirty) s.recompute(); };
// Thunderhide Drum: stacks live on the Thunderhide; every affected unit carries a copy that follows them while in range and fades otherwise
const DRUM = 'modifier_beastmaster_thunderhide_drum'; const DRUM_AURA = 'modifier_beastmaster_thunderhide_drum_aura';
modifier(DRUM_AURA, {
  purge: 'none', interval: 0.25,
  stats: (m) => ({ hpPct: m.v('bonus_pct_per_stack') * m.stacks, dmgBasePct: m.v('bonus_pct_per_stack') * m.stacks }),
  onCreated(m) { m.y = m.parent.world.time; },
  onAttack(m, rec) { if (rec.secondary) return; const th = m.caster; const src = th.alive ? th.findModifier(DRUM) : null; if (src && src.active() && m.parent.distTo(th) <= m.v('aura_radius')) { src.setStacks(Math.min(m.v('max_stacks'), src.stacks + 1)); src.x = th.world.time; } },
  onThink(m) {
    const th = m.caster; const now = m.parent.world.time; const src = th.alive ? th.findModifier(DRUM) : null;
    if (src && m.parent.distTo(th) <= m.v('aura_radius')) { m.setStacks(src.stacks); m.y = now; return; }
    if (now - m.y >= m.v('stack_decay_time') - 1e-9) { m.y = now; if (m.stacks <= 1) m.remove(); else m.setStacks(m.stacks - 1); }
  },
});
passive('beastmaster_thunderhide_drum', {
  fid: 'approx', note: 'a stack per attack launched by the Thunderhide, its owner or their units inside the radius; one stack is lost every stack_decay_time once no attack was made for that long; bonuses are refreshed every 0.25 s',
  interval: 0.25, thinkNow: true, onCreated(m) { m.x = -100; m.y = -100; },
  onThink(m) {
    const th = m.parent; const o = th.owner; const w = th.world; const now = w.time; const decay = m.v('stack_decay_time');
    if (m.stacks > 0 && now - m.x >= decay - 1e-9 && now - m.y >= decay - 1e-9) { m.setStacks(m.stacks - 1); m.y = now; }
    for (const a of w.inRadius(th.x, th.y, m.v('aura_radius'), th.team, false)) if ((a === th || a === o || (o && a.owner === o)) && !a.hasModifier(DRUM_AURA)) a.addModifier(DRUM_AURA, { caster: th, ability: m.ability });
  },
});
defAbility('beastmaster_summon_thunderhide', {
  prio: 93, engage: false, fid: 'approx', note: 'permanent creep-hero with health, damage and speed from this ability; it carries Thunderhide Drum and, while its owner is run by the default controller, uses its Slam (starting on the spawn cooldown; left alone it only attacks, as in the game); a new cast replaces a living Thunderhide. Default controller: when a target is within 1200 and none is alive',
  ai: (ab, u, t) => (t && u.distTo(t) < 1200 && !(ab.data && ab.data.alive) ? SELF : null),
  cast(ab) {
    const u = ab.owner; const b = bmBonus(u); const dmg = ab.v('thunderhide_base_damage') + ab.v('thunderhide_bonus_damage');
    if (ab.data && ab.data.alive) u.world.kill(ab.data, null, null, true);
    const th = summon(ab, 'npc_dota_beastmaster_thunderhide', { ovr: { hp: ab.v('thunderhide_base_max_health') + b.hp, dmgMin: dmg, dmgMax: dmg, ms: ab.v('thunderhide_base_movespeed') + b.ms }, ai: u.ai && u.ai.mode === 'fight' ? 'fight' : 'attack' });
    const slam = th.findAbility('big_thunder_lizard_slam'); if (slam) slam.startCooldown(ab.v('thunderhide_slam_spawn_cooldown'));
    bmInner(u, th); th.nextAttackTime = u.world.time + 0.2;          // [L] measured in Hero Demo: the Thunderhide starts its first attack 0.2 s after it appears
    ab.data = th;
  },
});
debuff('modifier_beastmaster_primal_roar_slow', { stats: { msPct: 'slow_movement_speed_pct', asSlow: 'slow_attack_speed_pct' } });
buff('modifier_beastmaster_primal_roar_speed', { stats: { msPct: 'movement_speed' } });
defAbility('beastmaster_primal_roar', {
  prio: 90, fid: 'approx', note: 'units in the path are pushed sideways instantly (push_duration is not simulated)',
  ai: (ab, u, t) => (t && t.isHero ? { target: t } : null),
  cast(ab, t) {
    const u = ab.owner; const dx = t.x - u.x; const dy = t.y - u.y; const d = hyp(dx, dy) || 1; const nx = -dy / d; const ny = dx / d;
    for (const e of enemiesInLine(ab, u.x, u.y, t.x, t.y, ab.v('damage_radius'))) {
      if (e === t) continue;
      hit(ab, e, ab.v('side_damage'), MAGICAL);
      if (!e.alive) continue;
      const side = (e.x - u.x) * nx + (e.y - u.y) * ny >= 0 ? 1 : -1;
      e.x += nx * side * ab.v('push_distance'); e.y += ny * side * ab.v('push_distance');
      addMod(ab, e, 'modifier_beastmaster_primal_roar_slow', ab.v('slow_duration'));
    }
    stun(ab, t, ab.v('duration')); hit(ab, t, ab.v('damage'), MAGICAL);
    for (const a of bmUnits(u)) addMod(ab, a, 'modifier_beastmaster_primal_roar_speed', ab.v('movement_speed_duration'));
  },
});

// ================================================================ Doom
const DEVOUR_SKIP = /^(neutral_upgrade|neutral_spell_immunity|creep_)/;   // generic creep class abilities are not "special abilities"
const doomEdible = (ab, u, e) => e.alive && e.team !== u.team && !e.heroLike && !e.isBuilding && !e.isIllusion && e.def.rel !== 'ward' && e.level <= ab.v('creep_level') && (!e.def.ancient || ab.v('can_target_ancient') > 0) && e.targetable() && !e.isImmune();
function doomDrop(ab) { const u = ab.owner; for (const c of ab.data || []) { c.setLevel(0); const i = u.abilities.indexOf(c); if (i >= 0) u.abilities.splice(i, 1); } ab.data = null; }
modifier('modifier_doom_bringer_devour', {
  hidden: true,
  // Shard: spell amplification bonus for the devoured abilities
  outgoing(m, d) { const got = m.ability.data; const b = m.v('bonus_spell_amp_pct'); const u = m.parent; if (b > 0 && got && d.ability && got.includes(d.ability) && !(d.flags & (F_ATTACK | F_NO_AMP))) d.amount *= (100 + u.spellAmp + b) / (100 + u.spellAmp); },
});
defAbility('doom_bringer_devour', {
  mods: ['modifier_doom_bringer_devour'], prio: 45, fid: 'partial',
  note: 'the creep is removed at once and Doom gains its first two non-generic abilities at level 1 until the next Devour that brings abilities; gold is not modelled; alt-cast (no ability gain) is not used. Shard: charges, Ancients and the +spell amplification of devoured abilities are modelled; NOT modelled: the Shard +AoE of devoured abilities (the engine has no per-ability area bonus). Default controller: eats the nearest valid creep within cast range + 350',
  ai: (ab, u, t) => { if (!t) return null; let best = null; let bd = ab.castRange() + 350; for (const e of u.world.units) { if (!doomEdible(ab, u, e)) continue; const d = u.distTo(e); if (d < bd) { bd = d; best = e; } } return best ? { target: best } : null; },
  cast(ab, t) {
    const u = ab.owner; if (!t || !doomEdible(ab, u, t)) { refuse(ab); return; }
    const names = t.abilities.filter((a) => !DEVOUR_SKIP.test(a.name) && !a.hidden).map((a) => a.name).slice(0, 2);
    u.world.kill(t, u, ab);
    if (t.alive || !names.length) return;
    doomDrop(ab);
    const got = []; for (const n of names) if (!u.findAbility(n)) got.push(u.addAbility(n, 1));
    ab.data = got; u.refreshAI();
  },
});
na('doom_bringer_empty1', 'placeholder slot; devoured abilities are added to Doom directly');
na('doom_bringer_empty2', 'placeholder slot; devoured abilities are added to Doom directly');
// [L] measured in Hero Demo: one damage instance per second, the first 1 s after the cast, the last when the effect ends
const scorched = { purge: 'none', interval: 1, stats: (m) => ({ msPct: m.v('bonus_movement_speed_pct'), hpRegen: m.v('bonus_health_regen') }), onThink(m) { const u = m.parent; for (const e of u.world.enemiesInRadius(u, u.x, u.y, m.v('radius'))) mhit(m, e, m.v('damage_per_second'), MAGICAL); } };
buff('modifier_doom_bringer_scorched_earth', { ...scorched });
modifier('modifier_doom_bringer_scorched_earth_permanent', { hidden: true, ...scorched });
defAbility('doom_bringer_scorched_earth', {
  mods: ['modifier_doom_bringer_scorched_earth_permanent'], requires: (ab) => ab.v('is_permanent') > 0 && !ab.toggled, prio: 89, fid: 'approx',
  note: 'damage in 1 s ticks starting 1 s after the cast. Level 25 talent: the effect is on from the start and the ability becomes a toggle without cooldown; [L] in Hero Demo toggling it replaced the permanent effect by a normal one of `duration` (damage 1 s after the toggle, the effect gone after `duration`); toggling back restores the permanent effect here (not measured). Default controller: when the target is inside the radius (50 margin)',
  ai: (ab, u, t) => (t && ab.v('is_permanent') <= 0 && !u.hasModifier('modifier_doom_bringer_scorched_earth') && u.distTo(t) <= ab.v('radius') - 50 ? SELF : null),
  cast(ab) {
    if (ab.v('is_permanent') > 0) { ab.toggled = !ab.toggled; ab.cdEnd = 0; ab.syncMods(); if (!ab.toggled) return; }
    addMod(ab, ab.owner, 'modifier_doom_bringer_scorched_earth', ab.v('duration') + 0.01);
  },
});
debuff('modifier_doom_bringer_infernal_blade_burn', { interval: 1, onThink(m) { mhit(m, m.parent, m.v('burn_damage') + m.parent.maxHp * m.v('burn_damage_pct') / 100, MAGICAL); } });
modifier('modifier_doom_bringer_infernal_blade', {
  hidden: true,
  onAttack(m, rec) { const ab = m.ability; const t = rec.target; if (rec.secondary || t.isBuilding || t.isImmune() || !ab.ready()) return; ab.pay(); ab.startCooldown(); (rec.data ||= {}).infernal = m; },
  onAttackLanded(m, rec) {
    const t = rec.target;
    if (!(rec.data && rec.data.infernal === m) || !t.alive || t.isImmune()) return;
    t.addModifier('modifier_stunned', { caster: m.parent, ability: m.ability, duration: m.v('ministun_duration') });
    t.addModifier('modifier_doom_bringer_infernal_blade_burn', { caster: m.parent, ability: m.ability, duration: m.v('burn_duration') + 0.05 });
  },
});
defAbility('doom_bringer_infernal_blade', { mods: ['modifier_doom_bringer_infernal_blade'], fid: 'full', note: 'autocast assumed on: used on every attack when off cooldown and affordable; burn in 1 s ticks' });
// Doom: the curse itself, the Scepter copy on units around the doomed target, and the Scepter self-cast version
const doomCurse = {
  purge: 'none', pierce: true, state: ['SILENCE', 'NO_HEAL'], interval: 1,
  onCreated(m) { const p = m.parent; if (m.v('does_break') > 0) { p.st[ST.BREAK]++; m.x = 1; } if (m.v('does_mute') > 0) { p.st[ST.MUTE]++; m.y = 1; } p.dirty = true; },
  onDestroy(m) { const p = m.parent; if (m.x === 1) p.st[ST.BREAK]--; if (m.y === 1) p.st[ST.MUTE]--; p.dirty = true; },
};
const doomSpread = (m, c) => { const r = m.v('scepter_aura_radius'); const u = m.caster; if (r <= 0) return; for (const e of c.world.inRadius(c.x, c.y, r, u.team, true)) if (e !== c && !e.hasModifier('modifier_doom_bringer_doom_debuff')) e.addModifier('modifier_doom_bringer_doom_aura', { caster: u, ability: m.ability, duration: 0.55, pierce: true }); };
// [L] measured in Hero Demo: the first damage instance lands with the curse, then one per second including the last moment
// (duration + 1 instances); the silence stays 0.1 s longer than the duration (the curse is carried by a short aura)
const doomTick = (m) => mhit(m, m.parent, m.v('damage'), PURE);
// [L] measured in Hero Demo: the Scepter copies appear together with the curse and vanish with their source (they linger 0.5 s only on
// units that walk out of the radius)
const doomEnd = (m) => { if (m.v('scepter_aura_radius') <= 0) return; for (const e of m.parent.world.units) { const a = e.alive ? e.findModifier('modifier_doom_bringer_doom_aura') : null; if (a && a.caster === m.caster) a.remove(); } };
debuff('modifier_doom_bringer_doom_debuff', { ...doomCurse, interval: 0.25, onCreated(m) { doomCurse.onCreated(m); doomTick(m); if (m.parent.alive) doomSpread(m, m.parent); }, onDestroy(m) { doomCurse.onDestroy(m); doomEnd(m); }, onThink(m) { if (++m.z % 4 === 0) doomTick(m); if (m.parent.alive) doomSpread(m, m.parent); } });
debuff('modifier_doom_bringer_doom_aura', { ...doomCurse, statusResist: false, onCreated(m) { doomCurse.onCreated(m); doomTick(m); }, onThink: doomTick });
buff('modifier_doom_bringer_doom_self', { purge: 'none', interval: 0.25, thinkNow: true, onThink(m) { doomSpread(m, m.parent); }, onDestroy: doomEnd });
defAbility('doom_bringer_doom', {
  prio: 88, fid: 'full', note: 'damage in 1 s ticks, the first with the curse; Scepter: enemies within the aura radius of the doomed target (or of Doom when self-cast) carry the same curse while they stay inside (re-checked every 0.25 s)',
  ai: (ab, u, t) => (t && t.isHero && !t.isIllusion && !t.hasModifier('modifier_doom_bringer_doom_debuff') ? { target: t } : null),
  cast(ab, t) {
    const u = ab.owner;
    if (!t || t.team === u.team) { if (ab.v('scepter_aura_radius') > 0) addMod(ab, u, 'modifier_doom_bringer_doom_self', ab.v('duration') + 0.1); return; }
    t.purge({ debuffs: false, buffs: true });
    addMod(ab, t, 'modifier_doom_bringer_doom_debuff', ab.v('duration') + 0.1, { pierce: true });
  },
});
debuff('modifier_doom_bringer_lvl_pain_debuff', {
  purge: 'none',
  onTakeDamage(m, d) { if (d.src === m.caster && d.dealt > 0) m.x += d.dealt; },
  onDestroy(m, expired) {
    if (!expired || m.x <= 0) return;
    const p = m.parent; const u = m.caster; const k = p.level % m.v('level_multiplier') === 0 ? 1 + m.v('bonus_at_level_pct') / 100 : 1;
    for (const e of p.world.inRadius(p.x, p.y, m.v('spread_radius') * k, u.team, true)) p.world.damage(u, e, m.x * m.v('bonus_damage_pct_base') / 100 * k, PURE, F_NO_AMP, m.ability);
  },
});
passive('doom_bringer_lvl_pain', {
  fid: 'partial', note: 'the burst has no damage type in the data (DAMAGE_TYPE_NONE): dealt as pure, not amplified; the share is taken from the health Doom actually removed during the curse (including the attack that applied it). NOT modelled: the tooltip note "Also applies to all attacks when Doom is at max level" - it was written for the pre-7.41 version of the innate (bonus damage against lower-level enemies) and the tooltip does not say what it means for the curse',
  onAttackLanded(m, rec) {
    const t = rec.target; const D = 'modifier_doom_bringer_lvl_pain_debuff';
    if (!t.alive || !t.isHero || t.team === m.parent.team || t.hasModifier(D)) return;
    const d = t.addModifier(D, { caster: m.parent, ability: m.ability, duration: m.v('damage_debuff_duration') });
    if (d) d.x = rec.dealt;
  },
});

// ================================================================ Kunkka
const X_MARK = 'modifier_kunkka_x_marks_the_spot';
const kunkkaMarked = (u) => u.world.units.find((o) => o.alive && o.findModifier(X_MARK, u) !== null) || null;
// X Marks the Spot -> Torrent on the X -> Return: possible when both are ready and the torrent lands before the X runs out
function kunkkaCombo(u, t, w) {
  const x = u.findAbility('kunkka_x_marks_the_spot'); const tor = u.findAbility('kunkka_torrent');
  return !!x && !!tor && x.level > 0 && tor.level > 0 && x.ready() && tor.ready() && t.isHero && !t.isImmune()
    && tor.v('delay') + tor.v('AbilityCastPoint') < x.v('duration') * (1 - t.statusRes) && (w.freeSpells || u.mana >= x.manaCost() + tor.manaCost());
}
debuff('modifier_kunkka_torrent_slow', { stats: { msPct: 'movespeed_bonus' } });
defAbility('kunkka_torrent', {
  prio: 60, fid: 'full', note: 'damage instances at the impact and every damage_tick_interval during the stun (percent_instant = 0); the slow runs from the impact to slow_duration after the stun. Default controller aims where the target will be after the delay, or at the X when X Marks the Spot is active',
  ai: (ab, u, t, w) => {
    if (!t) return null;
    const delay = ab.v('delay') + ab.v('AbilityCastPoint'); const xm = kunkkaMarked(u);
    if (xm) {
      const m = xm.findModifier(X_MARK, u); const gs = u.findAbility('kunkka_ghostship');
      if (gs && gs.data && gs.data.t > w.time + delay + 0.05 && hyp(m.x - gs.data.x, m.y - gs.data.y) <= gs.v('ghostship_width')) return null;      // wait: torrent and ship should land together
      return { x: m.x, y: m.y };
    }
    if (kunkkaCombo(u, t, w)) return null;         // X first
    const p = lead(t, delay); return { x: p.x, y: p.y };
  },
  cast(ab, t, x, y) {
    const u = ab.owner; const w = u.world;
    ab.data = { t: w.time + ab.v('delay'), x, y };
    w.after(ab.v('delay'), () => {
      if (w.skillshotHit < 1 && !w.rng.chance(w.skillshotHit)) return;
      // [L] measured in Hero Demo: an instance at the impact, then one every damage_tick_interval while the unit is up (ceil(stun / interval) + 1
      // instances), each torrent_damage / (stun / interval + 1); the slow starts at the impact and lasts stun + slow_duration
      const st = ab.v('stun_duration'); const iv = ab.v('damage_tick_interval'); const k = st / iv; const n = Math.ceil(k - 1e-6) + 1; const per = ab.v('torrent_damage') / (k + 1);
      for (const e of enemiesNear(ab, x, y, ab.v('radius'))) {
        const sm = e.isImmune() ? null : stun(ab, e, st);
        hit(ab, e, per, MAGICAL);
        for (let i = 1; i < n; i++) w.after(i * iv, () => hit(ab, e, per, MAGICAL));
        if (e.alive) addMod(ab, e, 'modifier_kunkka_torrent_slow', (sm ? sm.remaining() : 0) + ab.v('slow_duration'));
      }
    });
  },
});
debuff('modifier_kunkka_tidebringer_slow', { stats: { msPct: 'movespeed_slow' } });
// [L] measured in Hero Demo: the bonus damage is part of Kunkka's attack damage while Tidebringer is ready
modifier('modifier_kunkka_tidebringer', {
  hidden: true, interval: 0.1, thinkNow: true,
  stats: (m) => (m.x > 0 ? { dmg: m.v('damage_bonus') } : null),
  onThink(m) { const on = m.ability.ready() ? 1 : 0; if (on !== m.x) { m.x = on; m.parent.dirty = true; } },
  onAttack(m, rec) {
    const ab = m.ability; const t = rec.target;
    if (rec.secondary || t.isBuilding || !ab.ready()) return;
    ab.startCooldown();
    if (m.x === 0) rec.flat += m.v('damage_bonus');      // ready again since the last check: the bonus is not in the stats yet
    (rec.data ||= {}).tide = m;
    if (m.v('pierces_armor') > 0 && t.armor > 0) rec.pierceArmor += t.armor * m.v('pierces_armor') / 100;
    if (!ab.ready()) { m.x = 0; m.parent.dirty = true; }
  },
  onAttackLanded(m, rec) {
    if (!(rec.data && rec.data.tide === m)) return;
    const u = m.parent; const t = rec.target; const w = u.world; const dist = m.v('cleave_distance'); const sw = m.v('cleave_starting_width'); const ew = m.v('cleave_ending_width');
    const dx = t.x - u.x; const dy = t.y - u.y; const d = hyp(dx, dy) || 1; const ux = dx / d; const uy = dy / d;
    const slow = (e) => { if (m.v('movespeed_slow_duration') > 0 && e.alive) e.addModifier('modifier_kunkka_tidebringer_slow', { caster: u, ability: m.ability, duration: m.v('movespeed_slow_duration') }); };
    slow(t);
    for (const e of w.units) {
      if (!e.alive || e.team === u.team || e === t || e.isBuilding || e.st[ST.OUT] > 0) continue;
      const rx = e.x - u.x; const ry = e.y - u.y; const along = rx * ux + ry * uy;
      if (along < 0 || along > dist || Math.abs(rx * uy - ry * ux) > (sw + (ew - sw) * along / dist) / 2 + e.def.hull) continue;
      w.damage(u, e, rec.damage * m.v('cleave_damage') / 100, PHYSICAL, F_SECONDARY, m.ability);   // [L] cleave is reduced by armor
      slow(e);
    }
  },
});
defAbility('kunkka_tidebringer', { mods: ['modifier_kunkka_tidebringer'], fid: 'full', note: 'autocast assumed on: the first attack after the cooldown carries the bonus damage and cleaves (cleave ignores armor, cone in the direction of the target)' });
debuff(X_MARK, { purge: 'none', multi: 'perCaster', onCreated(m) { m.x = m.parent.x; m.y = m.parent.y; }, onDestroy(m) { const p = m.parent; if (p.alive) { p.x = m.x; p.y = m.y; if (p.channelAb) p.endChannel(true); } } });
defAbility('kunkka_x_marks_the_spot', {
  prio: 65, fid: 'full', note: 'the return (on expiry or through Return) also interrupts a channel of the returned hero; default controller: only as a setup on enemy heroes, when Torrent is ready or a Ghostship is already on its way to the spot',
  ai: (ab, u, t, w) => {
    if (!t || !t.isHero || t.isImmune() || kunkkaMarked(u)) return null;
    const cp = ab.v('AbilityCastPoint'); const dur = ab.v('duration') * (1 - t.statusRes);
    const gs = u.findAbility('kunkka_ghostship');
    if (gs && gs.data && gs.data.t > w.time + cp + 0.3 && hyp(t.x - gs.data.x, t.y - gs.data.y) <= gs.v('ghostship_width') - 50) return gs.data.t - w.time <= cp + dur - 0.2 ? { target: t } : null;
    return kunkkaCombo(u, t, w) ? { target: t } : null;
  },
  cast(ab, t) {
    const u = ab.owner; if (!t) return;
    const r = u.findAbility('kunkka_return'); if (r && r.level < 1) r.setLevel(1);
    addMod(ab, t, X_MARK, t.team === u.team ? ab.v('allied_duration') : ab.v('duration'));
  },
});
defAbility('kunkka_return', {
  prio: 99, fid: 'full', note: 'default controller: returns the marked hero just before Torrent or Ghostship lands on the X',
  ai: (ab, u, t, w) => {
    const xm = kunkkaMarked(u); if (!xm) return null;
    const m = xm.findModifier(X_MARK, u); const cp = ab.v('AbilityCastPoint');
    // 0.5 s of slack: the controller cannot act during an attack wind-up
    for (const n of ['kunkka_torrent', 'kunkka_ghostship']) { const d = (u.findAbility(n) || {}).data; if (d && d.t > w.time && d.t - w.time <= cp + 0.5 && hyp(m.x - d.x, m.y - d.y) <= 500) return SELF; }
    return null;
  },
  cast(ab) { const u = ab.owner; for (const o of u.world.units) { const m = o.alive ? o.findModifier(X_MARK, u) : null; if (m) m.remove(); } },
});
// The Admiral's Rum: part of the damage taken is postponed and paid back after the buff (never lethal)
const RUM = 'modifier_kunkka_admirals_rum_active';
function kunkkaRum(t, kunkka, k) { const rum = kunkka.findAbility('kunkka_admirals_rum'); return rum && rum.level > 0 ? t.addModifier(RUM, { caster: kunkka, ability: rum, duration: rum.v('buff_duration') * k, data: { k, stored: 0 } }) : null; }   // [L] measured in Hero Demo: the Ghostship rum (k = rum_factor) lasts 10 s
modifier('modifier_kunkka_admirals_rum_hangover', { debuff: true, purge: 'none', multi: 'independent', statusResist: false, interval: 1, onThink(m) { const p = m.parent; p.world.damage(m.caster, p, m.data.per, PURE, F_HP_LOSS | F_NON_LETHAL | F_NO_AMP, m.ability); } });
buff(RUM, {
  purge: 'none', stats: (m) => ({ msPct: m.v('movespeed_bonus') * m.data.k }),
  onRefresh(m, o) { if (o && o.data && o.data.k > m.data.k) m.data.k = o.data.k; },
  postMit(m, d) { if (d.amount <= 0) return; const a = d.amount * Math.min(100, m.v('ghostship_absorb') * m.data.k) / 100; d.amount -= a; m.data.stored += a; },
  onDestroy(m, expired) {
    const p = m.parent; const n = Math.max(1, Math.round(m.v('buff_duration')));
    if (expired && p.alive && m.data.stored > 0) p.addModifier('modifier_kunkka_admirals_rum_hangover', { caster: p, ability: m.ability, duration: n + 0.05, data: { per: m.data.stored / n } });
  },
});
passive('kunkka_admirals_rum', {
  fid: 'approx', note: 'triggers when damage from an enemy hero, building or Roshan would take Kunkka below damage_threshold% health (the triggering hit is already softened). The postponed damage is paid back as non-lethal health loss in 1 s ticks over buff_duration after the buff ends: the length of the hangover is not in the data',
  postMit(m, d) {
    const u = m.parent; const s = d.src;
    if (d.amount <= 0 || !s || s.team === u.team || !(s.isHero || s.isBuilding || s.name === 'npc_dota_roshan')) return;
    if (!m.ability.cdReady() || u.hasModifier(RUM) || u.hp - d.amount >= u.maxHp * m.v('damage_threshold') / 100) return;
    m.ability.startCooldown();
    const r = kunkkaRum(u, u, 1);
    if (r) { const a = d.amount * m.v('ghostship_absorb') / 100; d.amount -= a; r.data.stored += a; }
  },
});
debuff('modifier_kunkka_tidal_wave', { state: ['DISARM'] });
defAbility('kunkka_tidal_wave', {
  prio: 98, fid: 'approx', note: 'the wave starts (wave distance - cast range) behind Kunkka and runs to the cast range in the chosen direction, `radius` to each side; units are moved knockback_distance along it at once when the front reaches them and cannot attack for the drag duration. Default controller: aimed away from an enemy hero that is out of reach, so the wave drags it towards Kunkka',
  ai: (ab, u, t) => { if (!t || !t.isHero || t.isImmune()) return null; const d = u.distTo(t); const back = ab.v('wave_distance_tooltip') - ab.v('AbilityCastRange'); if (u.rangeTo(t) - u.attackRange <= 150 || d > back - 50) return null; return { x: u.x - (t.x - u.x) / d * 300, y: u.y - (t.y - u.y) / d * 300 }; },
  cast(ab, t, x, y) {
    const u = ab.owner; const w = u.world; let dx = x - u.x; let dy = y - u.y; const d = hyp(dx, dy);
    if (d < 1) { dx = 1; dy = 0; } else { dx /= d; dy /= d; }
    const back = ab.v('wave_distance_tooltip') - ab.v('AbilityCastRange'); const sx = u.x - dx * back; const sy = u.y - dy * back;
    const ex = u.x + dx * ab.v('AbilityCastRange'); const ey = u.y + dy * ab.v('AbilityCastRange');
    for (const e of enemiesInLine(ab, sx, sy, ex, ey, 2 * (ab.v('radius')))) {
      const along = Math.max(0, (e.x - sx) * dx + (e.y - sy) * dy);
      w.after(along / ab.v('speed'), () => {
        if (!e.alive || e.isImmune()) return;
        hit(ab, e, ab.v('damage'), MAGICAL);
        if (!e.alive) return;
        e.x += dx * ab.v('knockback_distance'); e.y += dy * ab.v('knockback_distance');
        addMod(ab, e, 'modifier_kunkka_tidal_wave', ab.v('duration'));
      });
    }
  },
});
defAbility('kunkka_ghostship', {
  prio: 88, fid: 'partial',
  note: 'the ship sails ghostship_distance and crashes at the targeted point (at most cast range away); crash radius = ghostship_width; allied heroes the ship comes within ghostship_width of get a rum_factor-strength Admiral\'s Rum (absorb, speed and duration multiplied). Scepter: the fleet of fleet_count ships fleet_interval apart is modelled; the cannonball volleys are NOT (in Hero Demo a dummy 500 in front of Kunkka took two balls of cannon_ball_damage_pct each per ship, 1.0 and 0.6 s before the crash; the layout of the volleys is not in the data). Default controller: when the crash can cover the predicted target position or, with X Marks the Spot ready, the spot it will be returned to',
  ai: (ab, u, t, w) => {
    if (!t || !t.isHero) return null;
    const T = ab.v('ghostship_distance') / ab.v('ghostship_speed'); const R = ab.castRange();
    const x = u.findAbility('kunkka_x_marks_the_spot');
    if (x && x.level > 0 && x.ready() && !t.isImmune() && u.distTo(t) <= Math.min(x.castRange(), R) && (w.freeSpells || u.mana >= ab.manaCost() + x.manaCost())) return { x: t.x, y: t.y };
    const p = lead(t, T + ab.v('AbilityCastPoint')); return hyp(p.x - u.x, p.y - u.y) <= R + ab.v('ghostship_width') - 100 ? { x: p.x, y: p.y } : null;
  },
  cast(ab, t, x, y) {
    const u = ab.owner; const w = u.world; let dx = x - u.x; let dy = y - u.y; const d = hyp(dx, dy);
    if (d < 1) { dx = 1; dy = 0; } else { dx /= d; dy /= d; }
    const R = d < 1 ? ab.castRange() : Math.min(d, ab.castRange()); const len = ab.v('ghostship_distance'); const speed = ab.v('ghostship_speed'); const T = len / speed;
    const cx = u.x + dx * R; const cy = u.y + dy * R; const sx = cx - dx * len; const sy = cy - dy * len;
    const rumK = ab.v('rum_factor'); const rad = ab.v('ghostship_width');
    ab.data = { t: w.time + T, x: cx, y: cy };
    for (let i = 0; i < Math.max(1, ab.v('fleet_count')); i++) {
      const t0 = i * ab.v('fleet_interval');
      for (const a of w.units) {
        if (!a.alive || a.team !== u.team || !a.isHero) continue;
        const along = (a.x - sx) * dx + (a.y - sy) * dy; const off = Math.abs((a.x - sx) * dy - (a.y - sy) * dx);
        if (off > rad) continue;
        // [L] measured in Hero Demo: Kunkka 500 behind the crash point got the rum 1.6 s after the cast, when the ship came within ghostship_width
        const reach = Math.max(0, along - Math.sqrt(rad * rad - off * off));
        if (reach <= len) w.after(t0 + reach / speed, () => { if (a.alive) kunkkaRum(a, u, rumK); });
      }
      w.after(t0 + T, () => {
        if (w.skillshotHit < 1 && !w.rng.chance(w.skillshotHit)) return;
        for (const e of enemiesNear(ab, cx, cy, rad)) { if (!e.isImmune()) stun(ab, e, ab.v('stun_duration')); hit(ab, e, ab.v('AbilityDamage'), MAGICAL); }
      });
    }
  },
});

// ================================================================ Nyx Assassin
const BURROW = 'modifier_nyx_assassin_burrow'; const VENDETTA = 'modifier_nyx_assassin_vendetta'; const CARAPACE = 'modifier_nyx_assassin_spiked_carapace';
defAbility('nyx_assassin_impale', {
  prio: 70, fid: 'full', note: 'line of `length` x `width` from the caster, spikes travel at `speed`; Burrow adds its range and shortens the cooldown. Default controller: when the target is within the line length - 50, not during Vendetta',
  ai: (ab, u, t) => { if (!t || u.hasModifier(VENDETTA)) return null; const b = u.findModifier(BURROW); return u.distTo(t) <= ab.v('length') + (b ? b.v('cast_range') : 0) - 50 ? { x: t.x, y: t.y } : null; },
  cast(ab, t, x, y) {
    const u = ab.owner; const w = u.world; const b = u.findModifier(BURROW); const sx = u.x; const sy = u.y;
    if (b && ab.cdEnd > w.time) ab.cdEnd = w.time + (ab.cdEnd - w.time) * (1 - b.v('cooldown_reduction') / 100);
    if (w.skillshotHit < 1 && !w.rng.chance(w.skillshotHit)) return;
    for (const e of lineFromCaster(ab, x, y, ab.v('length') + (b ? b.v('cast_range') : 0), ab.v('width'))) w.after(hyp(e.x - sx, e.y - sy) / ab.v('speed'), () => { hit(ab, e, ab.v('impale_damage'), MAGICAL); if (e.alive) stun(ab, e, ab.v('duration')); });
  },
});
defAbility('nyx_assassin_jolt', {
  prio: 60, fid: 'full', note: 'damage and mana burn are both shares of the target\'s maximum mana',
  ai: (ab, u, t) => (t && t.maxMana > 0 && !t.isImmune() && !u.hasModifier(VENDETTA) ? { target: t } : null),
  cast(ab, t) {
    const r = ab.v('aoe'); const list = r > 0 ? enemiesNear(ab, t.x, t.y, r) : [t];
    if (!list.includes(t)) list.push(t);
    for (const e of list) { if (e.isImmune() || e.maxMana <= 0) continue; hit(ab, e, e.maxMana * ab.v('max_mana_as_damage_pct') / 100, MAGICAL); e.burnMana(e.maxMana * ab.v('mana_burn_pct') / 100); }
  },
});
buff(CARAPACE, {
  purge: 'none', onCreated(m) { m.data = new Set(); },
  postMit(m, d) {
    const u = m.parent; const s = d.src;
    if (d.amount <= 0 || !s || s === u || s.team === u.team || (d.flags & F_REFLECT) || !(s.isHero || s.owner) || m.data.has(s)) return;
    m.data.add(s);
    const amt = d.amount; d.amount = 0;
    u.world.damage(u, s, amt * m.v('damage_reflect_pct') / 100, d.type, F_REFLECT | F_NO_AMP, m.ability);
    if (s.alive) s.addModifier('modifier_stunned', { caster: u, ability: m.ability, duration: m.v('stun_duration') });
  },
});
defAbility('nyx_assassin_spiked_carapace', {
  prio: 75, engage: false, fid: 'full', note: 'player-controlled source = a hero, illusion or owned summon; the reflected amount is the damage after Nyx\'s reductions and is reduced again by the source\'s own armor / resistance. Default controller: cast right after taking damage from a hero (when burrowed: when an enemy is inside the stun radius)',
  ai: (ab, u, t, w) => { if (!t || u.hasModifier(CARAPACE)) return null; const b = u.findModifier(BURROW); return (b ? u.distTo(t) <= b.v('carapace_radius') : w.time - u.lastHurt < 1) ? SELF : null; },
  cast(ab) {
    const u = ab.owner; const b = u.findModifier(BURROW);
    if (b) { for (const e of enemiesNear(ab, u.x, u.y, b.v('carapace_radius'))) stun(ab, e, ab.v('stun_duration')); return; }
    addMod(ab, u, CARAPACE, ab.v('reflect_duration'));
  },
});
buff(BURROW, { purge: 'none', state: ['ROOT', 'DISARM', 'INVIS'], stats: (m) => ({ dmgTaken: -m.v('damage_reduction'), castRange: m.v('cast_range') }) });
defAbility('nyx_assassin_burrow', {
  manual: true, fid: 'approx', note: 'not used by the default controller (a stationary ambush stance; list it in ai.order to use it). Burrowed: rooted, disarmed, invisible, damage reduction, Scarab Metabolism at burrow strength, instant-stun Spiked Carapace, longer and faster Impale; the cast range bonus is a flat bonus that also reaches items',
  ai: (ab, u, t) => (t && !u.hasModifier(BURROW) && !u.hasModifier(VENDETTA) && u.distTo(t) <= 700 ? SELF : null),
  cast(ab) { const u = ab.owner; addMod(ab, u, BURROW); const ub = u.findAbility('nyx_assassin_unburrow'); if (ub && ub.level < 1) ub.setLevel(1); },
});
defAbility('nyx_assassin_unburrow', {
  manual: true, fid: 'full', note: 'not used by the default controller (see Burrow)',
  ai: (ab, u, t) => (u.hasModifier(BURROW) && (!t || u.distTo(t) > 1300) ? SELF : null),
  cast(ab) { ab.owner.removeModifierByName(BURROW); },
});
function scarabSync(m) {
  const u = m.parent; const b = u.findModifier(BURROW);
  const k = b ? b.v('scarab_metabolism_multiplier') : u.world.time - m.x >= m.v('out_of_combat_time') - 1e-9 || m.v('breaks_on_damage') <= 0 ? m.v('multiplier') : 0;
  if (k !== m.y) { m.y = k; u.dirty = true; }
}
passive('nyx_assassin_scarab_metabolism', {
  fid: 'full', note: 'state checked every 0.1 s; burrowed = burrow multiplier regardless of damage',
  interval: 0.1, thinkNow: true, onCreated(m) { m.x = -100; },
  stats: (m) => (m.y > 0 ? { hpRegenPct: m.v('health_regen_pct') * m.y, manaRegenPct: m.v('mana_regen_pct') * m.y, ms: m.v('bonus_movement_speed') * m.y } : null),
  onTakeDamage(m, d) { if (d.dealt > 0) { m.x = m.parent.world.time; scarabSync(m); } },
  onThink(m) { scarabSync(m); },
});
buff('modifier_nyx_assassin_vendetta_fast', { purge: 'none', stats: { ms: 'free_pathing_movement_speed_bonus' } });
debuff('modifier_nyx_assassin_vendetta_break', { pierce: true, purge: 'none', state: ['BREAK'], onCreated(m) { m.parent.dirty = true; }, onDestroy(m) { m.parent.dirty = true; } });
buff(VENDETTA, {
  purge: 'none', state: ['INVIS'], stats: (m) => ({ msPct: m.v('movement_speed'), attackRange: m.v('attack_range_bonus') }),
  // the opening attack has a faster attack animation: its wind-up is shortened
  onAttackStart(m) { const u = m.parent; u.hitTime = u.attackStart + (u.hitTime - u.attackStart) / (1 + m.v('attack_animation_bonus') / 100); },
  onAttack(m, rec) { if (rec.secondary) return; (rec.data ||= {}).vendetta = m.ability; m.remove(); },
  onCast(m, ev) { const n = ev.ability.name; if (n !== 'nyx_assassin_spiked_carapace' && n !== 'nyx_assassin_vendetta') m.remove(); },
  onDestroy(m) { m.parent.removeModifierByName('modifier_nyx_assassin_vendetta_fast'); },
});
modifier('modifier_nyx_assassin_vendetta_strike', {
  hidden: true,
  onAttackLanded(m, rec) {
    if (!(rec.data && rec.data.vendetta === m.ability)) return;
    const t = rec.target; const u = m.parent;
    const brk = () => { if (t.alive) t.addModifier('modifier_nyx_assassin_vendetta_break', { caster: u, ability: m.ability, duration: m.v('break_duration'), pierce: true }); };
    const dmg = () => u.world.damage(u, t, m.v('bonus_damage'), PURE, 0, m.ability);
    if (u.hasShard) { brk(); dmg(); } else { dmg(); brk(); }
  },
});
defAbility('nyx_assassin_vendetta', {
  mods: ['modifier_nyx_assassin_vendetta_strike'], prio: 87, engage: false, fid: 'approx',
  note: 'the faster attack animation divides the wind-up of the opening attack by (1 + attack_animation_bonus%); the Shard haste is the flat free_pathing_movement_speed_bonus (free pathing itself has no meaning without terrain); invisibility only matters when the scenario turns detection off (rules.detectAll = false). Any other spell or item cast (except Spiked Carapace) breaks it and loses the bonus; the default controller casts it when a target is within 1500 and holds Impale and Mind Flare until the attack is made',
  ai: (ab, u, t) => (t && !u.hasModifier(VENDETTA) && !u.hasModifier(BURROW) && u.distTo(t) <= 1500 ? SELF : null),
  cast(ab) {
    const u = ab.owner; u.removeModifierByName(BURROW);
    addMod(ab, u, VENDETTA, ab.v('duration'));
    if (ab.v('free_pathing_duration') > 0) addMod(ab, u, 'modifier_nyx_assassin_vendetta_fast', ab.v('free_pathing_duration'));
  },
});

// ================================================================ Riki
// "from behind": the sandbox has no facing. An attack counts as a backstab when the target is not currently targeting Riki,
// or when it comes from Blink Strike / Tricks of the Trade (both strike from behind by definition).
// [L] measured in Hero Demo: an idle unit that faces Riki takes no backstab, so a unit is taken to face where it is going (its attack /
// order target or move point) and an idle one to face its attacker; behind = Riki's direction of attack within backstab_angle / 2 of its facing.
function rikiBehind(m, u, rec) {
  const fa = rec.fromAbility; const t = rec.target;
  if (fa && (fa.name === 'riki_blink_strike' || fa.name === 'riki_tricks_of_the_trade')) return true;
  const o = t.winding && t.attackTarget ? t.attackTarget : t.orderTarget; let fx; let fy;
  if (o && o !== u) { fx = o.x - t.x; fy = o.y - t.y; } else if (t.order === 2 /* ORDER.MOVE */) { fx = t.orderX - t.x; fy = t.orderY - t.y; } else return false;
  const ax = t.x - u.x; const ay = t.y - u.y; const n = (hyp(fx, fy) || 1) * (hyp(ax, ay) || 1);
  return (fx * ax + fy * ay) / n >= Math.cos(m.v('backstab_angle') / 2 * Math.PI / 180);
}
passive('riki_innate_backstab', {
  fid: 'approx', note: '"from behind" = Riki attacks within backstab_angle / 2 of the direction the target is heading (its attack / order target or move point; an idle unit faces its attacker), or the attack comes from Blink Strike / Tricks of the Trade (no facing in the sandbox); [L] the bonus = Agility x multiplier is a separate physical damage instance when the attack lands (as in Hero Demo), plus the Item Potency bonus on the attack; when the attacked unit is an ally (deny) both are scaled to ally_multiplier%',
  onAttack(m, rec) {
    const u = m.parent; const t = rec.target;
    if (rec.secondary || t.isBuilding || !rikiBehind(m, u, rec)) return;
    const k = t.team === u.team ? m.v('ally_multiplier') / 100 : 1;      // "works when denying friendly units at ally_multiplier% effectiveness"
    (rec.data ||= {}).backstab = u.agi * m.v('damage_multiplier') * k; rec.potency += m.v('bonus_potency') * k;
  },
  // the backstab instance lands just before the attack's own damage (after evasion), as in the live recording
  outgoing(m, d) { const r = d.rec; const b = r && r.data && r.data.backstab; if (!(b > 0) || r.data.bsDone || !(d.flags & F_ATTACK)) return; r.data.bsDone = true; m.parent.world.damage(m.parent, d.dst, b, PHYSICAL, F_NO_AMP, m.ability); },
});
debuff('modifier_riki_smoke_screen_debuff', { purge: 'none', statusResist: false, state: ['SILENCE'], stats: (m) => ({ miss: m.v('miss_rate'), armor: -m.v('armor_reduction') }) });
defAbility('riki_smoke_screen', {
  prio: 65, fid: 'partial', note: 'silence, miss chance and the Shard armor reduction are applied to enemies while they are inside the cloud (checked every 0.25 s). NOT modelled: Shard "cannot be targeted by their allies"',
  ai: (ab, u, t) => (t && !t.hasModifier('modifier_riki_smoke_screen_debuff') ? { x: t.x, y: t.y } : null),
  cast(ab, t, x, y) { zone(ab, x, y, { radius: 'radius', duration: 'AbilityDuration', interval: 0.25, tick: (e) => addMod(ab, e, 'modifier_riki_smoke_screen_debuff', 0.3) }); },
});
debuff('modifier_riki_blink_strike_slow', { stats: (m) => ({ msPct: -m.v('slow_pct_tooltip') }) });
defAbility('riki_blink_strike', {
  prio: 80, fid: 'full', note: 'the bonus damage is added to the instant attack as physical damage; counts as a backstab',
  ai: (ab, u, t) => (t ? { target: t } : null),
  cast(ab, t) {
    const u = ab.owner; if (!t) return;
    u.jumpTo(t);
    if (t.team === u.team) return;
    addMod(ab, t, 'modifier_riki_blink_strike_slow', ab.v('slow'), { pierce: true });
    u.world.launchAttack(u, t, { instant: true, add: ab.v('bonus_damage'), fromAbility: ab });
  },
});
const TRICKS = 'modifier_riki_tricks_of_the_trade';
buff('modifier_riki_tricks_of_the_trade_speed', { purge: 'none', stats: { msPct: 'scepter_movespeed' } });
buff(TRICKS, {
  purge: 'none', state: ['INVULN', 'UNTARGETABLE', 'ETHEREAL'], interval: (m) => m.data.iv, thinkNow: true,
  // fixed attack damage while phased out
  onAttack(m, rec) { if (rec.fromAbility !== m.ability) return; const u = m.parent; rec.white = m.v('attack_damage') + (u.dmgMin + u.dmgMax) / 2 * m.v('base_attack_damage_pct') / 100; rec.green = 0; },
  onThink(m) {
    const u = m.parent; const host = m.data.host;
    if (host) { if (!host.alive) { m.data.cut = true; m.remove(); return; } u.x = host.x; u.y = host.y; }
    rikiStrike(m);
  },
  // [L] measured in Hero Demo: attack_count strikes from the start to the end of the channel (the last one at its end)
  onDestroy(m) { if (!m.data.cut && m.z < m.data.n) rikiStrike(m); },
});
function rikiStrike(m) {
  const u = m.parent; const w = u.world; m.z++;
  const es = w.inRadius(u.x, u.y, m.v('radius'), u.team, true).filter((e) => e.attackableBy(u) && !e.isBuilding);
  for (let i = 0; i < m.v('interval_targets') && es.length; i++) w.launchAttack(u, es.splice(w.rng.int(0, es.length - 1), 1)[0], { instant: true, fromAbility: m.ability });
}
defAbility('riki_tricks_of_the_trade', {
  prio: 60, fid: 'full', channel: (ab) => ab.v('AbilityChannelTime') + (ab.data && ab.data.host ? ab.v('scepter_bonus_duration') : 0),
  note: 'Riki moves to the target point (or, with the Scepter, into an allied hero) and is invulnerable and untargetable for the channel; attack_count strikes spread evenly, the first at once, each on interval_targets random enemies with the fixed attack damage plus Backstab. Default controller: with 2+ enemies in the area or below half health; with the Scepter inside an allied hero standing next to the target',
  ai: (ab, u, t, w) => {
    if (!t) return null;
    const r = ab.v('radius');
    if (w.inRadius(t.x, t.y, r, u.team, true).length < 2 && u.hp / u.maxHp > 0.5) return null;
    if (ab.v('pocket_riki_enabled') > 0) for (const a of w.units) if (a.alive && a !== u && a.team === u.team && a.isHero && !a.isIllusion && a.distTo(t) <= r - 100 && u.distTo(a) <= ab.castRange() + 300) return { target: a };
    return { x: t.x, y: t.y };
  },
  cast(ab, t, x, y) {
    const u = ab.owner; const host = t && t !== u && t.team === u.team && ab.v('pocket_riki_enabled') > 0 ? t : null;
    ab.data = { host };
    const dur = ab.v('AbilityChannelTime') + (host ? ab.v('scepter_bonus_duration') : 0); const n = ab.v('attack_count') + (host ? ab.v('scepter_bonus_attacks') : 0);
    u.x = host ? host.x : x; u.y = host ? host.y : y;
    addMod(ab, u, TRICKS, dur - 0.01, { data: { iv: dur / Math.max(1, n - 1), host, n } });
    if (host) addMod(ab, host, 'modifier_riki_tricks_of_the_trade_speed', dur);
  },
  channelEnd(ab, interrupted) { const tm = ab.owner.findModifier(TRICKS); if (tm && interrupted) tm.data.cut = true; ab.owner.removeModifierByName(TRICKS); if (ab.data && ab.data.host) ab.data.host.removeModifierByName('modifier_riki_tricks_of_the_trade_speed'); },
});
const RIKI_INVIS = 'modifier_riki_backstab_invis';
buff(RIKI_INVIS, { purge: 'none', state: ['INVIS'], interval: 0.25, stats: (m) => ({ msPct: m.v('invis_movespeed_bonus_percent') }), onThink(m) { if (m.parent.st[ST.BREAK] > 0) m.remove(); } });
passive('riki_backstab', {
  fid: 'full', note: 'Cloak and Dagger: invisible again fade_delay after the last attack; only matters when the scenario turns detection off (rules.detectAll = false); the experience bonus has no effect in the sandbox',
  interval: 0.1, thinkNow: true, onCreated(m) { m.x = -100; },
  onAttack(m) { m.x = m.parent.world.time; m.parent.removeModifierByName(RIKI_INVIS); },
  onThink(m) { const u = m.parent; if (!u.hasModifier(RIKI_INVIS) && u.world.time - m.x >= m.v('fade_delay') - 1e-9) u.addModifier(RIKI_INVIS, { ability: m.ability }); },
});

// ================================================================ Undying
const ZOMBIE = 'npc_dota_unit_undying_zombie';
// share of a pip removed by a non-hero attack = pips of a level 1 Tombstone / health of its unit (the unit data lists 4 health per pip)
const undyingPipShare = (m) => { const d = m.parent.world.unitDef('npc_dota_unit_tombstone1'); return m.ability && d ? levelVal(m.ability, 'tombstone_health', 1) / d.hp : 1; };
modifier('modifier_undying_tombstone_zombie', {
  hidden: true, purge: 'none', interval: 0.25, postMit: pipHit(undyingPipShare),
  onThink(m) { const z = m.parent; const d = m.data; if ((d.target && !d.target.alive) || (d.src && !d.src.alive)) z.world.kill(z, null, null, true); },
});
// o: { duration, pips, free (no fixed target), src (Tombstone the zombie belongs to) }
function undyingZombie(u, target, o = {}) {
  const w = u.world; const tomb = u.findAbility('undying_tombstone'); const def = w.unitDef(ZOMBIE);
  const bonus = tomb ? tomb.v('zombie_bonus_damage') : 0; const ang = w.rng.next() * 2 * Math.PI; const r = target.def.hull + def.hull;
  const z = w.summon(u, ZOMBIE, { x: target.x + Math.cos(ang) * r, y: target.y + Math.sin(ang) * r, duration: o.duration, ovr: { hp: o.pips || (tomb ? tomb.v('zombie_health') : 1), dmgMin: def.dmgMin + bonus, dmgMax: def.dmgMax + bonus } });
  z.addModifier('modifier_undying_tombstone_zombie', { caster: u, ability: tomb, data: { target: o.free ? null : target, src: o.src || null } });
  const dl = z.findAbility('undying_tombstone_zombie_deathstrike'); const lv = Math.max(1, tomb ? tomb.level : 1);
  if (dl) { dl.maxLevel = Math.max(dl.maxLevel, lv); dl.setLevel(lv); }
  if (!o.free && z.ai) z.ai.fixedTarget = target;
  return z;
}
debuff('modifier_undying_tombstone_zombie_deathstrike_slow', { multi: 'independent', pierce: true, stats: { msPct: 'slow' } });
passive('undying_tombstone_zombie_deathstrike', {
  fid: 'full', note: 'every zombie hit adds its own slow instance; the frenzy is on while the last attacked unit is below the health threshold (checked every 0.25 s)',
  interval: 0.25,
  stats: (m) => (m.x > 0 ? { msPct: m.v('bonus_move_speed'), as: m.v('bonus_attack_speed') } : null),
  onAttackLanded(m, rec) { const t = rec.target; if (!t.alive || t.isBuilding) return; m.data = t; t.addModifier('modifier_undying_tombstone_zombie_deathstrike_slow', { caster: m.parent, ability: m.ability, duration: m.v('duration'), pierce: true }); },
  onThink(m) { const t = m.data; const on = t && t.alive && t.hp / t.maxHp < m.v('health_threshold_pct') / 100 ? 1 : 0; if (on !== m.x) { m.x = on; m.parent.dirty = true; } },
});
debuff('modifier_undying_decay_debuff', { multi: 'independent', purge: 'none', statusResist: false, stats: (m) => ({ str: -m.data.n }) });
buff('modifier_undying_decay_buff', { multi: 'independent', purge: 'none', stats: (m) => ({ str: m.data.n }) });
defAbility('undying_decay', {
  prio: 55, fid: 'full', note: 'each cast is its own strength instance on the enemy hero and on Undying for decay_duration; illusions are damaged but give no strength',
  ai: (ab, u, t) => (t ? { x: t.x, y: t.y } : null),
  cast(ab, t, x, y) {
    const u = ab.owner; const dur = ab.v('decay_duration');
    for (const e of enemiesNear(ab, x, y, ab.v('radius'))) {
      if (e.isHero && !e.isIllusion) { const n = Math.min(ab.v('str_steal'), Math.max(0, e.str - 1)); if (n > 0 && e.addModifier('modifier_undying_decay_debuff', { caster: u, ability: ab, duration: dur, data: { n } })) u.addModifier('modifier_undying_decay_buff', { ability: ab, duration: dur, data: { n } }); }
      hit(ab, e, ab.v('decay_damage') * (e.isHero ? 1 : ab.v('creep_damage_multiplier')), MAGICAL);
    }
  },
});
defAbility('undying_soul_rip', {
  prio: 52, fid: 'approx', note: 'counts the units around Undying (allies and enemies except himself, invulnerable units, debuff-immune enemies and undetected invisible enemies; at most max_units) and heals an ally / damages an enemy by that count; the counted units themselves do not lose health (no per-unit loss is given). On a Tombstone it restores tombstone_heal pips. Default controller: heals himself below 60%, an allied hero below 50%, otherwise damages its target',
  ai: (ab, u, t) => {
    if (u.hp / u.maxHp < 0.6) return { target: u };
    for (const a of u.world.units) if (a.alive && a !== u && a.team === u.team && a.isHero && !a.isIllusion && a.hp / a.maxHp < 0.5 && u.distTo(a) <= ab.castRange()) return { target: a };
    return t && !t.isImmune() ? { target: t } : null;
  },
  cast(ab, t) {
    const u = ab.owner; const tt = t || u; const r = ab.v('radius');
    if (tt.team === u.team && tt.name.startsWith('npc_dota_unit_tombstone')) { tt.heal(ab.v('tombstone_heal'), u, ab); return; }
    let n = 0;
    for (const o of u.world.units) if (o.alive && o !== u && !o.isBuilding && o.st[ST.OUT] === 0 && o.st[ST.INVULN] === 0 && !(o.team !== u.team && (o.isImmune() || (o.st[ST.INVIS] > 0 && !u.world.detectAll))) && u.distTo(o) <= r) n++;
    const amount = ab.v('damage_per_unit') * Math.min(n, ab.v('max_units'));
    if (amount <= 0) return;
    if (tt.team === u.team) healUnit(ab, tt, amount); else hit(ab, tt, amount, MAGICAL);
  },
});
modifier('modifier_undying_tombstone_unit', {
  hidden: true, purge: 'none', interval: (m) => m.v('zombie_interval'), thinkNow: true, postMit: pipHit(undyingPipShare),
  // no zombies for ward-type units (other Tombstones, Ice Spires, turrets) and for enemy Undying zombies (two Tombstones would otherwise feed each other without end)
  onThink(m) { const tomb = m.parent; const u = m.caster; for (const e of tomb.world.inRadius(tomb.x, tomb.y, m.v('radius'), tomb.team, true)) if (!e.isBuilding && e.def.rel !== 'ward' && !e.name.startsWith(ZOMBIE) && e.attackableBy(tomb)) undyingZombie(u, e, { src: tomb }); },
});
function undyingTombstone(u, ab, x, y) {
  const w = u.world; const name = 'npc_dota_unit_tombstone' + Math.max(1, ab.level);
  const tomb = w.summon(u, w.unitDef(name) ? name : 'npc_dota_unit_tombstone1', { x, y, duration: ab.v('duration'), ovr: { hp: ab.v('tombstone_health') }, ai: 'idle' });
  tomb.addModifier('modifier_undying_tombstone_unit', { caster: u, ability: ab });
  ab.data = tomb;
  return tomb;
}
modifier('modifier_undying_tombstone', {
  hidden: true, purge: 'none',
  // talent: Tombstone On Death
  onDeath(m) { const u = m.parent; const ab = m.ability; const x = u.x; const y = u.y; if (u.talents.has('special_bonus_unique_undying_3')) u.world.after(0, () => { if (!u.alive) undyingTombstone(u, ab, x, y); }); },
});
defAbility('special_bonus_unique_undying_3', { fid: 'full', note: 'Tombstone On Death: handled by the Tombstone script (a Tombstone of the current level appears where Undying died)' });
defAbility('undying_tombstone', {
  mods: ['modifier_undying_tombstone'], prio: 80, fid: 'approx',
  note: 'Tombstone and zombies are real units with pip health (a hero attack removes one pip, any other attack a quarter pip, spells nothing). One zombie per enemy unit in the radius every zombie_interval (not for wards, other Tombstones or enemy zombies), the first wave on placement (not stated); a zombie attacks only its unit and dies with it or with the Tombstone (the latter is not stated). The Shard line (bunker) and its values are still in the data, but the 7.42 patch notes say Tombstone is no longer upgraded by the Shard: not modelled. Default controller: one Tombstone at a time, halfway towards the target',
  ai: (ab, u, t) => { if (!t || (ab.data && ab.data.alive)) return null; const d = u.distTo(t) || 1; const k = Math.min(d, ab.castRange()) / 2 / d; return d <= ab.v('radius') ? { x: u.x + (t.x - u.x) * k, y: u.y + (t.y - u.y) * k } : null; },
  cast(ab, t, x, y) { undyingTombstone(ab.owner, ab, x, y); },
});
debuff('modifier_undying_bite_zombie', {
  state: ['SILENCE'], stats: (m) => ({ msPct: -m.v('zombie_slow') }),
  outgoing(m, d) { d.amount *= 1 - m.v('zombie_damage_reduction') / 100; },
  // [L] measured in Hero Demo: a bitten ranged unit (700 range) attacks from 150
  onCreated(m) { const p = m.parent; if (!p.melee) { m.data = { ovr: p.ovr }; p.melee = true; p.ovr = { ...(p.ovr || {}), range: 150 }; p.dirty = true; } },
  onDestroy(m) { const p = m.parent; if (m.data) { p.melee = false; p.ovr = m.data.ovr; p.dirty = true; } },
});
defAbility('undying_bite', {
  prio: 68, fid: 'approx', note: 'Undying lunges up to lunge_distance towards the target (not past its body) and bites one server tick before the lunge_duration ends; he is not locked during the lunge and does not attack afterwards unless ordered; a bitten ranged hero becomes melee with 150 attack range (measured); bitten non-ancient creeps die and return as a free-roaming zombie with zombie_health pips; the cast is blocked by debuff immunity; miss_distance is not modelled. Default controller: on its target within cast range + 150',
  ai: (ab, u, t) => (t && !t.isImmune() && u.distTo(t) <= ab.castRange() + 150 ? { target: t } : null),
  cast(ab, t) {
    const u = ab.owner; const w = u.world; if (!t) return;
    // [L] measured in Hero Demo: the bite lands 0.167 s after the cast (lunge_duration 0.2 minus one tick); Undying moved 250 towards a target 350 away
    w.after(Math.max(0, ab.v('lunge_duration') - w.dt), () => {
      if (!u.alive || !t.alive) return;
      const dx = t.x - u.x; const dy = t.y - u.y; const d = hyp(dx, dy) || 1; const step = Math.min(ab.v('lunge_distance'), Math.max(0, d - u.def.hull - t.def.hull));
      u.x += dx / d * step; u.y += dy / d * step;
      const creep = !t.isHero && !t.heroLike && !t.def.ancient && !t.isBuilding;
      const rec = w.launchAttack(u, t, { instant: true, trueStrike: true, add: ab.v('damage'), fromAbility: ab });
      if (rec.dealt > 0) u.heal(rec.dealt, u, ab);
      if (creep) { if (t.alive) w.kill(t, u, ab); if (!t.alive) undyingZombie(u, t, { free: true, duration: ab.v('creep_zombie_duration'), pips: ab.v('zombie_health') }); return; }
      if (t.alive && t.isHero) addMod(ab, t, 'modifier_undying_bite_zombie', ab.v('zombie_duration'));
    });
  },
});
na('undying_ceaseless_dirge', 'respawn in the fountain: the hero still leaves the fight, so nothing changes inside the sandbox');
debuff('modifier_undying_flesh_golem_slow', { stats: (m) => ({ msPct: -m.v('slow'), dmgTaken: m.v('damage_amp') }) });
buff('modifier_undying_flesh_golem', {
  purge: 'none', stats: (m) => ({ ms: m.v('movement_bonus') }),
  // percentage of the final strength, whatever its sources; health, regeneration and damage are derived from it by the engine
  // ([L] measured in Hero Demo: 105.6 strength -> +63.36 at 60%, +116.16 at 110%, health and damage from the whole points)
  late(m, s, u) { u.str += u.str * m.v('str_percentage') / 100; },
  onAttackLanded(m, rec) {
    const t = rec.target; const u = m.parent;
    if (rec.secondary || !t.alive || t.isBuilding) return;
    t.addModifier('modifier_undying_flesh_golem_slow', { caster: u, ability: m.ability, duration: m.v('slow_duration') });
    if (m.v('spawn_zombie_on_attack') > 0) undyingZombie(u, t, { duration: m.v('zombie_duration') });
  },
});
defAbility('undying_flesh_golem', {
  prio: 85, engage: false, fid: 'full', note: 'every attack refreshes the slow / damage amplification debuff and spawns one zombie (zombie_duration) on the attacked unit. Default controller: when the target is within 600',
  ai: (ab, u, t) => (t && !u.hasModifier('modifier_undying_flesh_golem') && u.distTo(t) <= 600 ? SELF : null),
  cast(ab) { addMod(ab, ab.owner, 'modifier_undying_flesh_golem', ab.v('duration')); },
});

// ================================================================ Ancient Apparition
const COLD_FEET = 'modifier_ancient_apparition_cold_feet';
// [L] measured in Hero Demo: the first damage instance lands with the debuff, the rest follow every 0.5 s (AbilityDuration / 0.5
// instances in all, none at the moment of the freeze); the damage of an instance is cut to a whole number (85 / 2 -> 42)
const coldFeetTick = (m) => mhit(m, m.parent, Math.floor(m.v('damage_per_second') * 0.5), MAGICAL);
debuff(COLD_FEET, {
  interval: 0.1, stats: (m) => ({ msPct: -m.v('movement_slow') }),
  onCreated(m) { m.x = m.parent.x; m.y = m.parent.y; coldFeetTick(m); },
  onThink(m) {
    const t = m.parent; const dx = t.x - m.x; const dy = t.y - m.y; const d = hyp(dx, dy); const br = m.v('break_distance');
    if (d > br) { if (m.v('leash') <= 0) { m.remove(); return; } t.x = m.x + dx / d * br; t.y = m.y + dy / d * br; }
    if (++m.z % 5 === 0 && m.z < Math.round(m.v('AbilityDuration') * 10)) coldFeetTick(m);
  },
  onDestroy(m, expired) { if (expired && m.parent.alive) m.parent.addModifier('modifier_stunned', { caster: m.caster, ability: m.ability, duration: m.v('stun_duration') }); },
});
defAbility('ancient_apparition_cold_feet', {
  prio: 85, fid: 'full', note: 'distance to the initial spot is checked every 0.1 s; with the leash talent the unit is held at the break distance',
  ai: (ab, u, t) => (t && !t.isImmune() && !t.hasModifier(COLD_FEET) ? { target: t } : null),
  cast(ab, t, x, y) { const r = ab.v('area_of_effect'); const list = r > 0 ? enemiesNear(ab, t ? t.x : x, t ? t.y : y, r) : t ? [t] : []; if (t && !list.includes(t)) list.push(t); for (const e of list) addMod(ab, e, COLD_FEET, ab.v('AbilityDuration') + 0.05); },
});
const VORTEX = 'modifier_ancient_apparition_ice_vortex_debuff';
debuff(VORTEX, { purge: 'none', statusResist: false, stats: (m) => ({ msPct: m.v('movement_speed_pct'), mr: m.v('spell_resist_pct') }) });
defAbility('ancient_apparition_ice_vortex', {
  prio: 86, fid: 'full', note: 'slow and magic vulnerability are an aura (kept on enemies inside, lingers 0.5 s); damage once per second, first 1 s after the cast, last at the end; drag_speed has no tooltip text and is not used',
  ai: (ab, u, t) => (t && !t.hasModifier(VORTEX) ? { x: t.x, y: t.y } : null),
  cast(ab, t, x, y) {
    const u = ab.owner; const w = u.world; const dur = ab.v('vortex_duration'); const r = ab.v('radius'); const end = w.time + dur;
    // [L] measured in Hero Demo: the debuff appears with the cast and leaves 0.5 s after the vortex; one damage instance of damage_per_second per second
    const pulse = () => { for (const e of w.enemiesInRadius(u, x, y, r)) addMod(ab, e, VORTEX, 0.5); if (w.time + 0.1 < end - 1e-6) w.after(0.1, pulse); else if (w.time < end - 1e-6) w.after(end - w.time, pulse); };
    pulse();
    for (let i = 1; i <= Math.round(dur); i++) w.after(i, () => { for (const e of w.enemiesInRadius(u, x, y, r)) hit(ab, e, ab.v('damage_per_second'), MAGICAL); });
  },
});
debuff('modifier_ancient_apparition_chilling_touch_slow', { stats: (m) => ({ msPct: -m.v('slow') }) });
modifier('modifier_ancient_apparition_chilling_touch', {
  hidden: true, interval: 0.1, thinkNow: true,
  stats: (m) => (m.x > 0 ? { attackRange: m.v('attack_range_bonus') } : null),
  onThink(m) { const on = m.ability.ready() ? 1 : 0; if (on !== m.x) { m.x = on; m.parent.dirty = true; } },
  onAttack(m, rec) { const ab = m.ability; const t = rec.target; if (rec.secondary || t.isBuilding || t.isImmune() || !ab.ready()) return; ab.pay(); ab.startCooldown(); (rec.data ||= {}).chill = m; },
  onAttackLanded(m, rec) {
    const t = rec.target;
    if (!(rec.data && rec.data.chill === m) || !t.alive || t.isImmune()) return;
    mhit(m, t, m.v('damage'), MAGICAL);
    if (t.alive) t.addModifier('modifier_ancient_apparition_chilling_touch_slow', { caster: m.parent, ability: m.ability, duration: m.v('slow_duration') });
  },
});
defAbility('ancient_apparition_chilling_touch', { mods: ['modifier_ancient_apparition_chilling_touch'], fid: 'full', note: 'autocast assumed on: used on every attack when off cooldown and affordable; the attack range bonus is active while the enhanced attack is available (re-checked every 0.1 s)' });
// Bone Chill: one debuff per victim; every instance leaves after its own str_reduction_duration
const BONE_CHILL = 'modifier_ancient_apparition_bone_chill_debuff';
debuff(BONE_CHILL, { purge: 'none', statusResist: false, stats: (m) => ({ str: -m.x, msPct: -m.y }) });
passive('ancient_apparition_bone_chill', {
  fid: 'full', note: 'triggered by every magical damage instance of his own abilities (each damage tick is an instance)',
  onDealDamage(m, d) {
    const t = d.dst; const u = m.parent; const a = d.ability; const w = u.world;
    if (d.dealt <= 0 || d.type !== MAGICAL || !t.alive || t.team === u.team || !a || a.isItem || a.owner !== u) return;
    const str = t.isHero ? m.v('str_reduction') : 0; const slow = m.v('movement_slow_pct'); const dur = m.v('str_reduction_duration');
    if (str <= 0 && slow <= 0) return;
    const b = t.addModifier(BONE_CHILL, { caster: u, ability: m.ability, duration: dur + 0.1 });
    if (!b) return;
    b.x += str; b.y += slow; b.z++; t.dirty = true;
    w.after(dur, () => { if (b.removed) return; b.x -= str; b.y -= slow; if (--b.z <= 0) b.remove(); else t.dirty = true; });
  },
});
const FROSTBITE = 'modifier_ancient_apparition_ice_blast_frostbite';
debuff(FROSTBITE, {
  pierce: true, purge: 'none', state: ['NO_HEAL'], interval: 1,
  onThink(m) { mhit(m, m.parent, m.v('damage_per_second'), MAGICAL); },
  onTakeDamage(m, d) { const t = m.parent; if (t.alive && !t.isIllusion && t.hp > 0 && t.hp / t.maxHp < m.v('kill_pct') / 100) t.world.kill(t, d.src || m.caster, m.ability); },
});
defAbility('ancient_apparition_ice_blast', {
  prio: 84, fid: 'approx', note: 'the tracer flies at `speed` until Release is cast (the default controller releases it when it reaches the aimed point); the hail then flies from Ancient Apparition to the tracer at the same `speed` (its own speed is not in the data: in Hero Demo it arrived 0.4 s later over 700 and 0.25 s later over 2200), frostbiting what it passes within path_radius and exploding with radius_min + radius_grow x tracer seconds; frostbite damage in 1 s ticks; shatter is checked whenever a frostbitten non-illusion unit takes damage. Without Release nothing happens (as in the game)',
  ai: (ab, u, t) => { if (!t || !t.isHero) return null; const p = lead(t, 2 * u.distTo(t) / ab.v('speed') + ab.v('AbilityCastPoint')); return { x: p.x, y: p.y }; },
  cast(ab, t, x, y) { const u = ab.owner; const d = hyp(x - u.x, y - u.y) || 1; ab.data = { t0: u.world.time, sx: u.x, sy: u.y, ux: (x - u.x) / d, uy: (y - u.y) / d, aim: d }; },
});
function iceBlastRelease(ab) {
  const u = ab.owner; const w = u.world; const D = ab.data; ab.data = null; if (!D) return;
  const speed = ab.v('speed'); const T = w.time - D.t0; const x = D.sx + D.ux * T * speed; const y = D.sy + D.uy * T * speed;
  const sx = u.x; const sy = u.y; const d = hyp(x - sx, y - sy) || 1; const ux = (x - sx) / d; const uy = (y - sy) / d;
  const radius = Math.min(ab.v('radius_max'), ab.v('radius_min') + ab.v('radius_grow') * T);
  const frost = (e) => e.addModifier(FROSTBITE, { caster: u, ability: ab, duration: ab.v('frostbite_duration') + 0.05, pierce: true });
  for (const e of enemiesInLine(ab, sx, sy, x, y, 2 * ab.v('path_radius'))) w.after(Math.max(0, Math.min(d, (e.x - sx) * ux + (e.y - sy) * uy)) / speed, () => { if (e.alive) frost(e); });
  w.after(d / speed, () => {
    if (w.skillshotHit < 1 && !w.rng.chance(w.skillshotHit)) return;
    const cf = u.findAbility('ancient_apparition_cold_feet'); const pct = ab.v('cold_feet_stun_duration_pct');
    for (const e of enemiesNear(ab, x, y, radius)) {
      frost(e); hit(ab, e, ab.v('AbilityDamage'), MAGICAL);
      if (pct > 0 && cf && cf.level > 0 && e.alive) e.addModifier('modifier_stunned', { caster: u, ability: cf, duration: cf.v('stun_duration') * pct / 100 });
    }
  });
}
defAbility('ancient_apparition_ice_blast_release', {
  prio: 99, engage: false, fid: 'approx', note: 'explodes the hail at the current tracer position (see Ice Blast); default controller: when the tracer has reached the point Ice Blast was aimed at',
  ai: (ab, u) => { const ib = u.findAbility('ancient_apparition_ice_blast'); const D = ib && ib.data; return D && (u.world.time - D.t0) * ib.v('speed') >= D.aim ? SELF : null; },
  cast(ab) { const ib = ab.owner.findAbility('ancient_apparition_ice_blast'); if (ib) iceBlastRelease(ib); },
});

// ================================================================ Lich
const lichSpire = (u) => { const a = u.findAbility('lich_ice_spire'); return a && a.data && a.data.alive ? a.data : null; };
debuff('modifier_lich_frost_nova_slow', { stats: (m) => ({ msPct: m.v('slow_movement_speed'), asSlow: m.data && m.data.primary ? m.v('slow_attack_speed_primary') : 0 }), onRefresh(m, o) { if (o && o.data && o.data.primary) m.data = o.data; } });
function frostBlast(ab, x, y, primary) { for (const e of enemiesNear(ab, x, y, ab.v('radius'))) { hit(ab, e, ab.v('aoe_damage'), MAGICAL); if (e.alive) addMod(ab, e, 'modifier_lich_frost_nova_slow', ab.v('AbilityDuration'), { data: { primary: e === primary } }); } }
defAbility('lich_frost_nova', {
  prio: 60, fid: 'full', note: 'the primary target takes base and area damage; everyone in the area is slowed, the attack slow (slow_attack_speed_primary) is applied to the primary target only',
  // [L] measured in Hero Demo: the area damage lands first, then the primary target's base damage
  cast(ab, t) { const x = t.x; const y = t.y; frostBlast(ab, x, y, t); if (t.alive) hit(ab, t, ab.v('damage'), MAGICAL); },
});
const FROST_SHIELD = 'modifier_lich_frost_shield';
debuff('modifier_lich_frost_shield_slow', { stats: (m) => ({ msPct: -m.v('movement_slow') }) });
buff(FROST_SHIELD, {
  // [L] measured in Hero Demo: the first pulse comes 4 server ticks (0.133 s) after the shield appears, then one every `interval`
  interval: 4 / 30, stats: (m) => ({ hpRegen: m.v('health_regen') }),
  postMit(m, d) { if ((d.flags & F_ATTACK) && m.parent.name !== 'npc_dota_lich_ice_spire') d.amount *= 1 - m.v('damage_reduction') / 100; },
  onThink(m) {
    const p = m.parent; const u = m.caster;
    if (!m.y) { m.y = 1; m.interval = m.v('interval'); m.nextThink = p.world.time + m.interval; }
    for (const e of p.world.inRadius(p.x, p.y, m.v('radius'), u.team, true)) { if (e.isImmune()) continue; mhit(m, e, m.v('damage'), MAGICAL); if (e.alive) e.addModifier('modifier_lich_frost_shield_slow', { caster: u, ability: m.ability, duration: m.v('slow_duration') }); }
    if (p.name === 'npc_dota_lich_ice_spire') p.heal(1, u, m.ability);       // heals the Spire by one pip per tick
  },
});
defAbility('lich_frost_shield', {
  prio: 58, fid: 'full', note: 'first pulse one interval after the cast; default controller: on the allied hero in range (or Lich) with the lowest health that was hurt by a hero within the last 1.5 s',
  ai: (ab, u, t, w) => {
    if (!t) return null;
    let best = null; let bs = Infinity;
    for (const a of w.units) { if (!a.alive || a.team !== u.team || !a.isHero || a.isIllusion || a.hasModifier(FROST_SHIELD) || w.time - a.lastHurt > 1.5 || u.distTo(a) > ab.castRange()) continue; const s = a.hp / a.maxHp; if (s < bs) { bs = s; best = a; } }
    return best ? { target: best } : null;
  },
  cast(ab, t) { addMod(ab, t || ab.owner, FROST_SHIELD, ab.v('duration') + 0.05); },
});
const GAZE = 'modifier_lich_sinister_gaze';
debuff(GAZE, {
  // [L] measured in Hero Demo: the hypnotised unit is feared, silenced, disarmed and muted, and its movement speed reads the walking
  // speed as a whole number (500 * 50% / 2 s -> 125, 500 * 50% / 2.3 s -> 108)
  state: ['FEAR', 'SILENCE', 'DISARM', 'MUTE'], interval: 0.1, thinkNow: true, stats: (m) => (m.x > 0 ? { msAbs: m.x, msCap: m.x } : {}),
  onCreated(m) { m.x = Math.floor(m.parent.distTo(m.caster) * m.v('destination') / 100 / Math.max(0.1, m.v('channel_duration'))); m.parent.dirty = true; },      // walking speed of the hypnotised unit
  onThink(m) {
    const p = m.parent; const c = m.caster;
    if (!c.alive || (m.data.channel && c.channelAb !== m.ability)) { m.remove(); return; }
    const dx = c.x - p.x; const dy = c.y - p.y; const d = hyp(dx, dy); const step = Math.min(m.x * 0.1, Math.max(0, d - p.def.hull - c.def.hull));
    if (step > 0) { p.x += dx / d * step; p.y += dy / d * step; }
    const got = p.burnMana(p.mana * m.v('mana_drain') / 100 * 0.1); if (got > 0) c.giveMana(got);
  },
});
defAbility('lich_sinister_gaze', {
  prio: 70, channel: (ab) => (ab.v('aoe_scepter') > 0 ? 0 : ab.v('AbilityChannelTime')), fid: 'approx',
  note: 'the hypnotised unit is feared, silenced, disarmed and muted and walks `destination`% of the starting distance towards Lich over the channel (its movement speed reads that walking speed, whole units); the drained mana (mana_drain% of current mana per second, in 0.1 s steps) is given to Lich (the tooltip only says "drains"). Scepter: area version aimed at a point (an order on a unit is refused, measured), and Lich is not locked in the channel',
  ai: (ab, u, t) => (t && t.isHero && !t.isImmune() && !t.cantAct() ? (ab.v('aoe_scepter') > 0 ? { x: t.x, y: t.y } : { target: t }) : null),
  cast(ab, t, x, y) {
    const r = ab.v('aoe_scepter');
    // [L] measured in Hero Demo: with the Scepter the spell is aimed at a point; an order on a unit is refused
    if (r > 0 && t) { refuse(ab); return; }
    const list = r > 0 ? enemiesNear(ab, x, y, r) : [t];
    ab.data = list;
    for (const e of list) addMod(ab, e, GAZE, ab.v('channel_duration'), { data: { channel: r <= 0 } });
  },
  channelEnd(ab, interrupted) { if (interrupted && ab.data) for (const e of ab.data) e.removeModifierByName(GAZE); },
});
debuff('modifier_lich_ice_spire_debuff', { purge: 'none', statusResist: false, stats: { msPct: 'bonus_movespeed' } });
modifier('modifier_lich_ice_spire_unit', {
  hidden: true, purge: 'none', interval: 0.25, thinkNow: true, postMit: pipHit((m) => m.v('max_hero_attacks') / m.v('max_creep_attacks')),
  onThink(m) { const sp = m.parent; const u = m.caster; for (const e of sp.world.inRadius(sp.x, sp.y, m.v('aura_radius'), u.team, true)) e.addModifier('modifier_lich_ice_spire_debuff', { caster: u, ability: m.ability, duration: m.v('slow_duration') }); },
  // destroyed (not expired): Frost Blast around it
  onDeath(m) { const sp = m.parent; const fn = m.caster.findAbility('lich_frost_nova'); const x = sp.x; const y = sp.y; if (fn && fn.level > 0) sp.world.after(0, () => { if (!sp.alive) frostBlast(fn, x, y, null); }); },
});
defAbility('lich_ice_spire', {
  prio: 87, fid: 'approx', note: 'the Spire is a real unit with max_hero_attacks pips (hero attack = one pip, other attacks max_hero_attacks / max_creep_attacks of a pip); its slow is re-applied every 0.25 s; the Frost Blast (area damage and slow of the current Frost Blast level) happens when it is killed, not when it times out (the tooltip says "destroyed"). Default controller: placed 200 from the target towards Lich, one Spire at a time',
  ai: (ab, u, t) => { if (!t || lichSpire(u)) return null; const d = u.distTo(t) || 1; const k = Math.min(200, d) / d; return { x: t.x + (u.x - t.x) * k, y: t.y + (u.y - t.y) * k }; },
  cast(ab, t, x, y) {
    const u = ab.owner; const old = lichSpire(u); if (old) u.world.kill(old, null, null, true);
    const sp = summon(ab, 'npc_dota_lich_ice_spire', { x, y, duration: ab.v('duration'), ovr: { hp: ab.v('max_hero_attacks') }, ai: 'idle' });
    sp.addModifier('modifier_lich_ice_spire_unit', { caster: u, ability: ab });
    ab.data = sp;
  },
});
const lichFood = (u, e) => e.alive && e !== u && e.team === u.team && !e.isHero && !e.heroLike && !e.def.ancient && !e.isBuilding && e.def.rel !== 'ward';
defAbility('lich_death_charge', {
  manual: true, fid: 'full', note: 'not used by the default controller (it needs an allied creep and would destroy friendly units; list it in ai.order to use it): the creep dies and Lich gains mana from its current health. Charges start full in the sandbox; experience is not modelled',
  ai: (ab, u) => { if (u.mana / u.maxMana > 0.5) return null; let best = null; let bh = 0; for (const e of u.world.units) if (lichFood(u, e) && u.distTo(e) <= ab.castRange() + 300 && e.hp > bh) { bh = e.hp; best = e; } return best ? { target: best } : null; },
  cast(ab, t) { const u = ab.owner; if (!t || !lichFood(u, t)) return; const mana = t.hp * ab.v('active_mana_restore_pct_of_health') / 100; u.world.kill(t, null, ab); if (!t.alive) u.giveMana(mana); },
});
debuff('modifier_lich_chain_frost_slow', { stats: { msPct: 'slow_movement_speed', asSlow: 'slow_attack_speed' } });
function chainFrost(ab, first) {
  const u = ab.owner; const w = u.world; const range = ab.v('jump_range'); let hits = 0;
  const max = ab.v('has_unlimited_jumps') > 0 ? Infinity : ab.v('jumps') + 1;
  const pick = (cur) => {
    const c = w.inRadius(cur.x, cur.y, range, u.team, true).filter((e) => e !== cur && e.targetable() && !e.isBuilding && !e.isImmune() && e.st[ST.INVULN] === 0 && !e.name.startsWith(ZOMBIE));
    if (c.length) return c[w.rng.int(0, c.length - 1)];
    const sp = lichSpire(u); return sp && sp !== cur && hyp(sp.x - cur.x, sp.y - cur.y) <= range ? sp : null;
  };
  // the orb cannot be disjointed: it always arrives after distance / speed, even if its target died on the way (then it only looks for the next one).
  // Units have no collision in the sandbox, so the distance is never taken shorter than the two hulls (and the flight never shorter than a tick).
  const fly = (from, t, speed) => w.after(Math.max(w.dt, Math.max(hyp(t.x - from.x, t.y - from.y), from.def.hull + t.def.hull) / speed), () => land(t));
  const bounce = (cur, until) => { const n = pick(cur); if (n) fly(cur, n, ab.v('projectile_speed')); else if (w.time < until) w.after(0.1, () => bounce(cur, until)); };
  function land(t) {
    if (!t.alive) { bounce(t, w.time + ab.v('frostbound_duration')); return; }
    if (t.team === u.team) w.damage(u, t, 1, PURE, F_HP_LOSS, ab);            // bounced to Lich's own Spire: it loses a pip
    else if (!t.isImmune()) { hit(ab, t, ab.v('damage') + ab.v('bonus_jump_damage') * hits, MAGICAL); if (t.alive) addMod(ab, t, 'modifier_lich_chain_frost_slow', ab.v('slow_duration')); }
    if (++hits < max) bounce(t, w.time + ab.v('frostbound_duration'));
  }
  fly(u, first, ab.v('initial_projectile_speed'));
}
modifier('modifier_lich_chain_frost', {
  hidden: true, purge: 'none',
  // talent: Chain Frost on death
  onDeath(m) { const u = m.parent; const ab = m.ability; const w = u.world; w.after(0, () => { if (u.alive) return; const t = w.nearestEnemy(u, ab.castRange()); if (t) chainFrost(ab, t); }); },
});
defAbility('lich_chain_frost', {
  mods: ['modifier_lich_chain_frost'], requires: (ab) => ab.v('should_fire_chain_frost_on_death') > 0, prio: 86, fid: 'full',
  note: 'first hit plus up to `jumps` bounces to a random other enemy in jump_range (never to Undying zombies, not to debuff-immune units), damage growing by bonus_jump_damage per hit; flight time = distance / speed at launch; lingers frostbound_duration on its last target looking for a new one; uses Lich\'s Ice Spire when no enemy is in range. Talent: an orb of the current level is released at the nearest enemy within cast range when Lich dies. Default controller: only when the orb can bounce (second enemy or Spire near the target) or the target is the last enemy',
  ai: (ab, u, t, w) => {
    if (!t || !t.isHero || t.isImmune()) return null;
    const r = ab.v('jump_range'); const sp = lichSpire(u);
    if (w.inRadius(t.x, t.y, r, u.team, true).some((e) => e !== t && !e.isBuilding && !e.name.startsWith(ZOMBIE))) return { target: t };
    if (sp && hyp(sp.x - t.x, sp.y - t.y) <= r) return { target: t };
    return w.units.filter((e) => e.alive && e.team !== u.team && e.counts).length === 1 ? { target: t } : null;
  },
  cast(ab, t) { chainFrost(ab, t); },
});

// ================================================================ Spirit Breaker
const CHARGE = 'modifier_spirit_breaker_charge_of_darkness'; const HASTE = 'modifier_spirit_breaker_bull_rush_buff';
// Empowering Haste: one buff holding the independent instances as [expiry, percent]
buff(HASTE, {
  purge: 'none', keepLonger: true, interval: 0.1, onCreated(m) { m.data = []; },
  stats: (m) => ({ msPct: m.x, msMax: C.MS_MAX * (1 + m.x / 100) }),
  onThink(m) {
    const u = m.parent; const now = u.world.time;
    if (u.hasModifier(CHARGE)) { for (const e of m.data) e[0] += 0.1; m.dieTime += 0.1; return; }          // the duration pauses during Charge of Darkness
    const keep = m.data.filter((e) => e[0] > now + 1e-9);
    if (keep.length !== m.data.length) { m.data = keep; m.x = keep.reduce((s, e) => s + e[1], 0); u.dirty = true; }
    if (!keep.length) m.remove();
  },
});
// sm = the stun modifier that earned the bonus (remembered so that the item-stun scan below does not count it twice)
function empoweringHaste(u, t, sm) {
  const br = u.findAbility('spirit_breaker_bull_rush'); const seen = br && br.mods[0] ? br.mods[0].data : null;
  if (sm && seen) seen.add(sm);
  if (!br || br.level < 1 || u.st[ST.BREAK] > 0) return;
  const dur = t.heroLike ? br.v('hero_duration') : br.v('creep_duration'); const pct = t.heroLike ? br.v('hero_movespeed_percent') : br.v('creep_movespeed_percent');
  const m = u.addModifier(HASTE, { ability: br, duration: dur + 0.15 });
  if (m) { m.data.push([u.world.time + dur, pct]); m.x += pct; u.dirty = true; }
}
// o: { stun (override duration), kb (knockback multiplier), dmg (damage multiplier), cascade (true for the Scepter follow-up bash) }
function greaterBash(u, t, o = {}) {
  const gb = u.findAbility('spirit_breaker_greater_bash'); const w = u.world;
  if (!t.alive) return;
  // [L] measured in Hero Demo: the Charge of Darkness stun lands (and earns Empowering Haste) without Greater Bash learned
  if (!gb || gb.level < 1) { if (o.stun !== undefined) empoweringHaste(u, t, t.addModifier('modifier_stunned', { caster: u, ability: o.ab, duration: o.stun, pierce: true })); return; }
  // [L] measured in Hero Demo: the damage is taken from the movement speed that already includes the Empowering Haste of this bash
  // (318.6 x 36% with 295 base speed and +8%)
  empoweringHaste(u, t, t.addModifier('modifier_stunned', { caster: u, ability: gb, duration: o.stun ?? gb.v('duration'), pierce: true }));
  u.recompute();
  const dmg = u.ms * gb.v('damage') / 100 * (t.heroLike ? 1 : gb.v('creep_multiplier'));
  w.damage(u, t, dmg * (o.dmg ?? 1), MAGICAL, 0, gb);
  if (!t.alive) return;
  const x0 = t.x; const y0 = t.y;
  knockback(t, u.x, u.y, gb.v('knockback_distance') * (o.kb ?? 1));
  // Scepter: a knocked-back unit that runs into another enemy bashes it and takes part of the damage again
  const again = gb.v('cascading_bashes_damage_multiplier');
  if (again <= 0 || o.cascade || w.time < (gb.data || 0)) return;
  for (const e of w.units) {
    if (!e.alive || e.team === u.team || e === t || e.isBuilding || e.st[ST.OUT] > 0) continue;
    const vx = t.x - x0; const vy = t.y - y0; const l2 = vx * vx + vy * vy || 1; const k = Math.max(0, Math.min(1, ((e.x - x0) * vx + (e.y - y0) * vy) / l2));
    if (hyp(x0 + vx * k - e.x, y0 + vy * k - e.y) > (e.heroLike ? gb.v('cascading_bashes_hero_hitbox') : gb.v('cascading_bashes_creep_hitbox'))) continue;
    gb.data = w.time + gb.v('cascading_bash_cooldown');
    greaterBash(u, e, { cascade: true, dmg: e.heroLike ? 1 : gb.v('cascading_bashes_creep_penalty') / 100 });
    w.damage(u, t, dmg * again / 100, MAGICAL, 0, gb);
    return;
  }
}
buff(CHARGE, {
  purge: 'none', dynamic: true, interval: (m) => m.parent.world.dt,
  stats: (m) => { const lo = m.v('min_movespeed_bonus_pct') / 100; const k = Math.min(1, (m.parent.world.time - m.created) / Math.max(0.01, m.v('windup_time'))); return { ms: m.v('movement_speed') * (lo + (1 - lo) * k), msMax: C.MS_MAX + m.v('movement_speed') }; },
  onCast(m, ev) { const n = ev.ability.name; if (!ev.ability.isItem && n !== 'spirit_breaker_charge_of_darkness' && n !== 'spirit_breaker_bulldoze') m.remove(); },
  onThink(m) {
    const u = m.parent; const w = u.world; const ab = m.ability; const s = m.data;
    if (u.cantAct() || u.st[ST.ROOT] > 0) { m.remove(); return; }
    let t = s.target;
    if (!t.alive) {            // target died: the nearest enemy to that spot becomes the target
      let best = null; let bd = Infinity;
      for (const e of w.units) { if (!e.alive || e.team === u.team || e.isBuilding || !e.attackableBy(u)) continue; const d = hyp(e.x - t.x, e.y - t.y); if (d < bd) { bd = d; best = e; } }
      if (!best) { m.remove(); return; }
      s.target = t = best;
    }
    if (!t.attackableBy(u)) { m.remove(); return; }
    if (u.ai && u.ai.target !== t) u.ai.target = t;
    if (u.orderTarget !== t) u.attack(t);
    for (const e of w.inRadius(u.x, u.y, ab.v('bash_radius'), u.team, true)) { if (e === t || s.hit.has(e) || e.isBuilding) continue; s.hit.add(e); greaterBash(u, e); }
    if (u.distTo(t) <= u.attackRange + u.def.hull + t.def.hull + 5) {
      m.remove(); greaterBash(u, t, { stun: ab.v('stun_duration'), ab });
      // back to the order he had before the charge (a unit that was not attacking this target does not start to)
      if (s.prev !== t) { if (s.prev && s.prev.alive) u.attack(s.prev); else u.stop(); }
    }
  },
});
defAbility('spirit_breaker_charge_of_darkness', {
  prio: 100, fid: 'approx', note: 'Spirit Breaker runs at his target with the charge bonus speed (ramping from min_movespeed_bonus_pct to full over windup_time, speed cap raised by the bonus); enemies within bash_radius on the way get a Greater Bash, the target gets one with the charge stun duration on arrival. The charge ends if he is disabled or rooted or casts another ability (Bulldoze excepted). The Shard line still in the tooltip is a leftover (its value is not in the data; the 7.41 patch notes say Charge of Darkness is no longer upgraded by the Shard). Default controller: when the target is more than 300 out of reach',
  ai: gapAI(300),
  cast(ab, t) { const u = ab.owner; const prev = u.ai && u.ai.mode === 'fight' ? t : null; const m = addMod(ab, u, CHARGE); if (!m) return; m.data = { target: t, hit: new Set(), prev }; if (u.ai) u.ai.target = t; u.attack(t); },
});
barrier('modifier_spirit_breaker_bulldoze_barrier', 'all');
buff('modifier_spirit_breaker_bulldoze', { stats: { msPct: 'movement_speed', statusRes: 'status_resistance' } });
defAbility('spirit_breaker_bulldoze', {
  prio: 72, engage: false, fid: 'full', note: 'default controller: while charging or within 700 of the target',
  ai: (ab, u, t) => (t && !u.hasModifier('modifier_spirit_breaker_bulldoze') && (u.hasModifier(CHARGE) || u.distTo(t) <= 700) ? SELF : null),
  cast(ab) { const u = ab.owner; addMod(ab, u, 'modifier_spirit_breaker_bulldoze', ab.v('duration')); if (ab.v('damage_barrier') > 0) giveBarrier(ab, u, 'modifier_spirit_breaker_bulldoze_barrier', ab.v('damage_barrier'), ab.v('duration')); },
});
passive('spirit_breaker_greater_bash', {
  fid: 'approx', note: 'damage = `damage`% of his movement speed at the moment of the bash; knockback applied instantly. Scepter: one collision per bash along the knockback path (hitbox radii from the data), limited by cascading_bash_cooldown; the collided unit is bashed without a further chain',
  onAttackLanded(m, rec) { const t = rec.target; if (rec.secondary || !t.alive || t.isBuilding || !m.ability.cdReady() || !m.roll(m.v('chance_pct'))) return; m.ability.startCooldown(); greaterBash(m.parent, t); },
});
// stuns that do not come from Greater Bash (items): looked for one tick after an attack lands or a cast finishes
function hasteScan(m, t, since) {
  const u = m.parent;
  if (!t || !t.alive || t.team === u.team) return;
  for (const b of t.mods) if (b.caster === u && b.created >= since && b.def._state.includes(ST.STUN) && !m.data.has(b)) empoweringHaste(u, t, b);
}
passive('spirit_breaker_bull_rush', {
  fid: 'approx', note: 'one independent movement speed instance per stun (hero / creep values), paused during Charge of Darkness; the speed cap is raised by the same percentage. Stuns from his items are noticed one tick after the attack or cast that applied them, and only on the attacked / targeted unit',
  onCreated(m) { m.data = new WeakSet(); },
  onAttackLanded(m, rec) { const w = m.parent.world; const now = w.time; const t = rec.target; w.after(0, () => hasteScan(m, t, now)); },
  onCast(m, ev) { const w = m.parent.world; const now = w.time; const t = ev.target; if (t) w.after(0, () => hasteScan(m, t, now)); },
});
const POCKET = 'modifier_spirit_breaker_planar_pocket';
modifier('modifier_spirit_breaker_planar_pocket_redirect', {
  purge: 'none',
  onSpellTargeted(m, ev) {
    const sb = m.caster; const sc = ev.ability.script;
    if (ev.blocked || !sb.alive || sb === m.parent || !ev.caster.isHero || !sb.hasModifier(POCKET)) return;
    ev.blocked = true;
    if (sc && sc.cast && sb.targetable() && !(sb.isImmune() && !ev.ability.pierces)) sc.cast(ev.ability, sb, sb.x, sb.y);
  },
});
buff(POCKET, {
  purge: 'strong', interval: 0.25, thinkNow: true, stats: { mr: 'magic_resistance' },
  onThink(m) {
    const sb = m.parent; const c = m.data.center;
    if (!c.alive || sb.distTo(c) > m.v('break_distance')) { m.remove(); return; }
    for (const a of sb.world.inRadius(c.x, c.y, m.v('radius'), sb.team, false)) if (a !== sb) a.addModifier('modifier_spirit_breaker_planar_pocket_redirect', { caster: sb, ability: m.ability, duration: 0.5 });
  },
});
defAbility('spirit_breaker_planar_pocket', {
  prio: 64, fid: 'approx', note: 'unit-targeted spells that enemy heroes cast on Spirit Breaker\'s allies inside the pocket (radius around the selected hero) are cancelled and their effect is run on Spirit Breaker instead; the whole effect ends when he is further than break_distance from the selected hero. Default controller: on the nearest allied hero in range, else on the enemy target',
  ai: (ab, u, t) => { if (!t || u.hasModifier(POCKET)) return null; let best = null; let bd = ab.castRange(); for (const a of u.world.units) { if (!a.alive || a === u || a.team !== u.team || !a.isHero || a.isIllusion) continue; const d = u.distTo(a); if (d <= bd) { bd = d; best = a; } } return best ? { target: best } : t.isHero && !t.isImmune() && u.distTo(t) <= ab.castRange() ? { target: t } : null; },
  cast(ab, t) { const u = ab.owner; addMod(ab, u, POCKET, ab.v('duration'), { data: { center: t || u } }); },
});
defAbility('spirit_breaker_nether_strike', {
  prio: 85, fid: 'approx', note: 'the cast point is the fade time; knockback multiplied by bonus_knockback_multiplier of Greater Bash (Scepter value included) and applied instantly',
  ai: (ab, u, t) => (t && t.isHero && !u.hasModifier(CHARGE) ? { target: t } : null),
  cast(ab, t) {
    const u = ab.owner; const gb = u.findAbility('spirit_breaker_greater_bash');
    // [L] measured in Hero Demo: he reappears on the far side of the target, 83 from its centre (two hero hulls of 24 + 35)
    const dx = t.x - u.x; const dy = t.y - u.y; const d = hyp(dx, dy) || 1; const off = u.def.hull + t.def.hull + 35;
    u.x = t.x + dx / d * off; u.y = t.y + dy / d * off;
    greaterBash(u, t, { kb: gb ? gb.v('bonus_knockback_multiplier') : 1 });
    if (t.alive) hit(ab, t, ab.v('damage'), MAGICAL);
    // [L] measured in Hero Demo: no attack follows unless he was ordered to attack (the default controller attacks anyway)
    if (t.alive && u.ai && u.ai.mode === 'fight') u.attack(t);
  },
});
