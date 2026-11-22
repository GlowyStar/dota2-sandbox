// Hero abilities, part 8: Rubick, Visage, Dark Seer, Bounty Hunter, Elder Titan, Lycan, Outworld Destroyer, Timbersaw,
// Void Spirit, Bane, Night Stalker, Tidehunter, plus the abilities carried by the units they summon.
// Every number is read from the shipped data by value name. Literals are structural only (sampling steps, AI thresholds,
// geometry tolerances) and are named in the ability's `note`.
import { defAbility, modifier, buff, debuff, passive, hit, addMod, stun, silence, healUnit, enemiesNear, alliesNear, enemiesInLine,
  lineFromCaster, knockback, mhit, critHook, dot, barrier, giveBarrier, chain, summon, ST, C, PHYSICAL, MAGICAL, PURE,
  F_ATTACK, F_NO_AMP, F_REFLECT, F_HP_LOSS, F_NO_LIFESTEAL, F_SECONDARY } from '../engine/dsl.mjs';

const na = (name, note) => defAbility(name, { fid: 'n/a', note });
// "cast now" answer for no-target abilities; the caster's own position keeps the engine's cast-range walk a no-op even when
// the data gives a no-target ability a cast range (Echo Stomp 500, Stone Form 50)
const here = (u) => ({ x: u.x, y: u.y });
const gap = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const isNight = (w) => !w.isDay;
const realHero = (e) => e.isHero && !e.isIllusion;
const immune = (ab, e) => e.st[ST.IMMUNE] > 0 && !ab.pierces && e.team !== ab.owner.team;
const aiTarget = (u) => (u.ai && u.ai.target && u.ai.target.alive ? u.ai.target : null);
// The engine calls `requires` right after it re-resolved an ability's values (level, talent, Scepter or Shard change).
// It is used here for upgrades the data stores under non-standard value names (cast_range_scepter, max_charges,
// shard_cooldown ...) and for abilities flagged PASSIVE in the data whose tooltip gives them an active part.
const tune = (fn) => (ab) => { fn(ab); return true; };
const setActive = (ab, on) => { if (ab.passive === on) { ab.passive = !on; ab.owner.refreshAI(); } };

// ================================================================ Rubick
const TELE = 'modifier_rubick_telekinesis';
function telekinesisLand(m) {
  const t = m.parent; const c = m.caster; const ab = m.ability;
  if (!t.alive || !ab) return;
  const w = t.world; const r = ab.v('radius'); const reach = ab.v('max_land_distance');
  // landing spot: where the lifted unit is, or on another enemy within throw distance, whichever stuns more enemies
  const foes = w.units.filter((e) => e.alive && e.team !== c.team && e !== t && e.st[ST.OUT] === 0);
  let bx = t.x; let by = t.y; let best = -1;
  for (const p of [t, ...foes]) {
    if (p !== t && gap(p, t) > reach) continue;
    let n = 0; for (const e of foes) if (gap(e, p) <= r) n++;
    if (n > best) { best = n; bx = p.x; by = p.y; }
  }
  t.x = bx; t.y = by;
  const dmg = ab.v('landing_damage');
  for (const e of w.inRadius(bx, by, r, c.team, true)) {
    if (e !== t && !immune(ab, e)) e.addModifier('modifier_stunned', { caster: c, ability: ab, duration: ab.v('stun_duration') });
    if (dmg > 0) w.damage(c, e, dmg, ab.dmgType, 0, ab);
  }
}
modifier(TELE, { debuff: true, state: ['STUN'], purge: 'strong', onDestroy(m) { telekinesisLand(m); } });
defAbility('rubick_telekinesis', {
  prio: 80, cond: (ab, u, t) => !!t && t.st[ST.STUN] === 0,
  cast(ab, t) {
    if (!t) return;
    const ally = t.team === ab.owner.team;
    if (ally && ab.v('shard_teammate_throw_delay') <= 0) return; // allies and self only with the Shard
    addMod(ab, t, TELE, ally ? ab.v('shard_teammate_throw_delay') : ab.v('lift_duration'));
  },
  fid: 'approx', note: 'the landing spot is picked automatically (the lifted unit\'s place or another enemy within max_land_distance, whichever stuns more); fall_duration is part of the lift; the landing-damage talent also hits the lifted enemy and is magical (no type in the data); Shard: ally/self casts work but the AI only lifts enemies',
});
na('rubick_telekinesis_land', 'landing-point picker; the Telekinesis script chooses the spot itself');
na('rubick_telekinesis_land_self', 'landing-point picker; the Telekinesis script chooses the spot itself');

debuff('modifier_rubick_fade_bolt_debuff', { stats: (m) => ({ dmgBasePct: -m.v('damage_reduction'), spellAmp: -m.v('damage_reduction') }) });
defAbility('rubick_fade_bolt', {
  prio: 55,
  cast(ab, t) {
    const u = ab.owner; const keep = 1 - ab.v('jump_damage_reduction_pct') / 100;
    chain(u, t, Infinity, ab.v('radius'), (e, i) => {
      if (immune(ab, e)) return;
      hit(ab, e, ab.v('damage') * Math.pow(keep, i), MAGICAL);
      if (e.alive) addMod(ab, e, 'modifier_rubick_fade_bolt_debuff', ab.v('duration'));
    }, ab.v('jump_delay'));
  },
  fid: 'approx', note: 'jumps to every enemy in range once; the per-jump reduction compounds (the tooltip does not say whether it does)',
});
passive('rubick_arcane_supremacy', { fid: 'full', stats: { castRange: 'cast_range', spellAmp: 'spell_amp' } });
na('rubick_empty1', 'placeholder slot for a stolen spell');
na('rubick_empty2', 'placeholder slot for a stolen spell');
na('rubick_hidden1', 'placeholder slot');
na('rubick_hidden2', 'placeholder slot');

// Curiosity: stacks = level + temporary stacks from enemy casts + permanent stacks from kills
function curiosityStacks(m) {
  const u = m.parent; const now = u.world.time; const d = m.data;
  let n = m.v('curiosity_per_level') * u.level + d.perm * m.v('curiosity_per_kill');
  for (const s of d.temp) if (s.t > now) n += s.n;
  return n;
}
passive('rubick_curiosity', {
  onCreated(m) { m.data = { temp: [], perm: 0, hurt: new Map() }; },
  stats: (m) => {
    const n = curiosityStacks(m); const f = m.v('curiosity_factor') > 0 ? m.v('curiosity_factor') : 1;
    return { dmgBase: n * m.v('curiosity_attack_damage') * f, debuffAmp: n * m.v('curiosity_modifier_amp') * f, aoe: n * m.v('curiosity_aoe_bonus') * f };
  },
  onAnyCast(m, ev) {
    const u = m.parent; const c = ev.caster; const w = u.world;
    if (c.team === u.team || !realHero(c) || ev.ability.isItem || gap(c, u) > m.v('charge_radius')) return;
    const dur = m.v('curiosity_duration');
    m.data.temp.push({ t: w.time + dur, n: m.v('curiosity_per_spell_cast'), src: c });
    u.dirty = true;
    w.after(dur + w.dt, () => { m.data.temp = m.data.temp.filter((s) => s.t > w.time); u.dirty = true; });
  },
  onDealDamage(m, d) { if (d.dst.isHero && d.dst.team !== m.parent.team) m.data.hurt.set(d.dst, m.parent.world.time); },
  onAnyDeath(m, ev) {
    const u = m.parent; const v = ev.victim; const now = u.world.time;
    if (v.team === u.team || !realHero(v) || !m.data.temp.some((s) => s.src === v && s.t > now)) return;
    if (now - (m.data.hurt.has(v) ? m.data.hurt.get(v) : -1e9) > m.v('grace_period')) return;
    m.data.perm++; u.dirty = true;
  },
  fid: 'partial', note: 'damage, area and debuff-duration bonuses are modelled; the buff-duration half is NOT (the engine only amplifies debuff durations; it would lengthen the buffs of stolen spells); every enemy cast in range counts as seen',
});

// Spell Steal: the last scripted, non-item spell an enemy hero cast is added to Rubick as a real ability.
const STEAL = 'modifier_rubick_spell_steal';
const STEAL_PATIENCE = 12; // AI only: seconds a stolen spell may sit unused before Rubick is willing to replace it
const guardedScripts = new WeakMap(); const guards = new WeakSet(); const brokenSteals = new WeakSet();
// A stolen spell runs in other hands than its script was written for. Rubick therefore also receives the other abilities of
// the spell's hero as unlearned (level 0) companions, so that scripts looking them up find them (active sub-abilities such
// as "return" spells come at level 1). If a script still fails, the spell is skipped and the scenario gets a warning.
function guardScript(sc) {
  if (!sc || guards.has(sc)) return sc;
  let g = guardedScripts.get(sc);
  if (g) return g;
  const fail = (ab, e) => { brokenSteals.add(ab); ab.owner.world.warn(`rubick_spell_steal: stolen ${ab.name} does not work without its original owner (${e.message})`); };
  g = { ...sc };
  if (sc.cast) g.cast = (ab, t, x, y) => { try { sc.cast(ab, t, x, y); } catch (e) { fail(ab, e); } };
  if (sc.ai) g.ai = (ab, u, t, w) => { if (brokenSteals.has(ab)) return null; try { return sc.ai(ab, u, t, w); } catch (e) { fail(ab, e); return null; } };
  else if (sc.cast) { const cond = sc.cond; g.cond = (ab, u, t, w) => { if (brokenSteals.has(ab)) return false; try { return cond ? cond(ab, u, t, w) : true; } catch (e) { fail(ab, e); return false; } }; }
  if (typeof sc.channel === 'function') g.channel = (ab) => { try { return sc.channel(ab); } catch (e) { fail(ab, e); return 0; } };
  if (sc.channelEnd) g.channelEnd = (ab, i) => { try { sc.channelEnd(ab, i); } catch (e) { fail(ab, e); } };
  guardedScripts.set(sc, g); guards.add(g);
  return g;
}
const stealSpent = (h, now) => !h.ab.ready() || brokenSteals.has(h.ab) || now - h.t0 > STEAL_PATIENCE;
// held entry: { ab: stolen ability, hero: its hero, extra: [companion abilities], t0: time stolen, exp: expiry time }
function dropStolen(u, held, h) {
  const i = held.indexOf(h); if (i >= 0) held.splice(i, 1);
  const heir = held.find((o) => o.hero === h.hero);
  h.ab.setLevel(0); // removes its intrinsic modifiers and makes pending orders for it fall through
  if (heir) heir.extra.push(h.ab, ...h.extra); // another stolen spell of the same hero keeps them as companions
  else for (const a of [h.ab, ...h.extra]) { a.setLevel(0); const k = u.abilities.indexOf(a); if (k >= 0) u.abilities.splice(k, 1); }
  u.refreshAI();
}
function stealGain(ab, m, rec) {
  const u = ab.owner; const w = u.world; const held = m.data.held; const dur = ab.v('duration');
  const def = w.data.abilities[rec.name];
  if (!u.alive || m.removed || !def || u.def.abilities.includes(rec.name)) return;
  const expire = (h) => w.after(dur, () => { if (held.includes(h) && w.time >= h.exp - 1e-6) dropStolen(u, held, h); });
  const same = held.find((h) => h.ab.name === rec.name);
  if (same) { same.ab.setLevel(rec.level); same.t0 = w.time; same.exp = w.time + dur; expire(same); return; }
  const slots = u.hasScepter ? 2 : 1; // "Increases the number of spells that can be stolen to 2" (tooltip text, no data value)
  while (held.length >= slots) dropStolen(u, held, held.find((h) => stealSpent(h, w.time)) || held[0]);
  // the spell may already be here as an unlearned companion of another stolen spell
  let s = null;
  for (const o of held) { const i = o.extra.findIndex((a) => a.name === rec.name); if (i >= 0) { s = o.extra.splice(i, 1)[0]; break; } }
  if (!s) s = u.addAbility(rec.name, 0);
  s.script = guardScript(s.script);
  s.setLevel(rec.level);
  const h = { ab: s, hero: def.hero || null, extra: [], t0: w.time, exp: w.time + dur };
  const owner = h.hero ? w.data.heroes[h.hero] : null;
  for (const n of owner ? owner.abilities : []) {
    const d = w.data.abilities[n];
    if (!d || u.findAbility(n)) continue;
    const b = d.behavior;
    const c = u.addAbility(n, 0);
    c.script = guardScript(c.script);
    // free, not learnable actives are helper spells (return / move / stop): usable at once
    if (b.includes('NOT_LEARNABLE') && !b.includes('PASSIVE') && !d.innate && !d.bySc && !d.bySh && c.v('AbilityCooldown') <= 0 && c.v('AbilityManaCost') <= 0 && !(c.v('AbilityCharges') > 0)) c.setLevel(1);
    h.extra.push(c);
  }
  held.push(h); expire(h);
  u.refreshAI();
}
modifier(STEAL, {
  hidden: true,
  onCreated(m) { m.data = { last: new Map(), held: [] }; },
  onAnyCast(m, ev) {
    const c = ev.caster; const a = ev.ability; const sc = a.script;
    if (c.team === m.parent.team || !realHero(c) || a.isItem || a.passive || !sc || !sc.cast || sc.manual) return;
    m.data.last.set(c, { name: a.name, level: a.level });
  },
  // stolen spells: mana cost talent, cooldown reduction, spell amplification talent
  onCast(m, ev) {
    const u = m.parent; const s = ev.ability; const w = u.world; const ss = m.ability;
    if (w.freeSpells || !m.data.held.some((h) => h.ab === s)) return;
    const mr = ss.v('stolen_mana_reduction'); if (mr > 0) u.giveMana(s.manaCost() * mr / 100);
    const k = 1 - ss.v('stolen_spell_cooldown_percent') / 100;
    if (k >= 1) return;
    const charges = s.vals.AbilityCharges || 0;
    if (charges > 0) { if (s.charges === charges - 1 && s.chargeEnd > w.time) s.chargeEnd = w.time + (s.chargeEnd - w.time) * k; } else if (s.cdEnd > w.time) s.cdEnd = w.time + (s.cdEnd - w.time) * k;
  },
  outgoing(m, d) {
    const b = m.ability.v('spell_amp_percent'); const amp = m.parent.spellAmp;
    if (b <= 0 || !d.ability || (d.flags & (F_ATTACK | F_NO_AMP | F_HP_LOSS)) || 100 + amp <= 0 || !m.data.held.some((h) => h.ab === d.ability)) return;
    d.amount *= (100 + amp + b) / (100 + amp);
  },
});
defAbility('rubick_spell_steal', {
  mods: [STEAL], prio: 86, noReflect: true, // "Does not trigger spell reflect" (flag read by reflecting scripts; a reflected copy would do nothing anyway)
  requires: tune((ab) => { const r = ab.v('cast_range_scepter'); if (r > 0) ab.vals.AbilityCastRange = r; }),
  ai(ab, u, t, w) {
    const m = u.findModifier(STEAL); if (!m) return null;
    const held = m.data.held; const slots = u.hasScepter ? 2 : 1;
    if (held.length >= slots && !held.some((h) => stealSpent(h, w.time))) return null;
    const ok = (e) => {
      if (!e || !e.alive || e.team === u.team || !realHero(e) || !e.targetable() || u.distTo(e) > ab.castRange() + 150) return false;
      const rec = m.data.last.get(e);
      return !!rec && !u.def.abilities.includes(rec.name) && !held.some((h) => h.ab.name === rec.name);
    };
    if (ok(t)) return { target: t };
    for (const e of w.units) if (ok(e)) return { target: e };
    return null;
  },
  cast(ab, t) {
    const u = ab.owner; const m = u.findModifier(STEAL); const rec = m && t ? m.data.last.get(t) : null;
    // [L] measured in Hero Demo: on a hero that has cast nothing the order is accepted but nothing is cast (no cooldown, no mana)
    if (!rec) { if (!u.world.freeSpells) { u.giveMana(ab.manaCost()); ab.cdEnd = 0; } return; }
    u.world.projectile(t, u, ab.v('projectile_speed'), () => stealGain(ab, m, { ...rec }));
  },
  fid: 'approx', note: 'steals the last scripted non-item spell the target cast, at the level it was cast (casts are tracked once Spell Steal is learned); Rubick\'s own Scepter/Shard decide the stolen version; stolen-spell mana and spell-amp talents and the cooldown reduction apply; Scepter: 2 slots and cast_range_scepter; the other abilities of the spell\'s hero come along unlearned (level 0; active sub-abilities such as "return" spells at level 1) so that scripts find them, which means a spell reading values of a companion gets its level-1 values and a spell that needs a learned companion stays unused (Invoker\'s invoked spells need his orb levels); the original owner\'s talents do not come along; a spell whose script still fails is skipped with a warning; AI steals from its attack target first and swaps a spell once it is on cooldown or unused for 12 s',
});

// ================================================================ Visage
const FAMILIAR = 'npc_dota_visage_familiar1';
const familiarsOf = (u) => u.world.units.filter((x) => x.alive && x.owner === u && x.name === FAMILIAR);
// AI only: with the Shard, Visage keeps enough mana for his emergency Stone Form while it is off cooldown
const visageCanAfford = (ab, u) => { const c = u.findAbility('visage_gravekeepers_cloak'); return u.world.freeSpells || !c || c.passive || !c.cdReady() || u.mana - ab.manaCost() >= c.manaCost(); };

debuff('modifier_visage_grave_chill_debuff', { stats: (m) => ({ msPct: -m.v('movespeed_bonus'), asSlow: -m.v('attackspeed_bonus') }) });
buff('modifier_visage_grave_chill_buff', { stats: (m) => ({ msPct: m.v('movespeed_bonus'), as: m.v('attackspeed_bonus') }) });
defAbility('visage_grave_chill', {
  prio: 60, cond: (ab, u, t) => !!t && !t.hasModifier('modifier_visage_grave_chill_debuff') && visageCanAfford(ab, u),
  cast(ab, t) {
    const u = ab.owner; const d = ab.v('chill_duration');
    addMod(ab, t, 'modifier_visage_grave_chill_debuff', d);
    addMod(ab, u, 'modifier_visage_grave_chill_buff', d);
    for (const f of familiarsOf(u)) if (gap(f, u) <= ab.v('radius')) addMod(ab, f, 'modifier_visage_grave_chill_buff', d);
  },
  fid: 'full',
});

// Soul Assumption: m.stacks = charges, m.x = damage gathered towards the next charge, m.y = time the charges expire
const SOUL = 'modifier_visage_soul_assumption';
modifier('modifier_visage_soul_assumption_tracker', {
  hidden: true, purge: 'none', multi: 'perCaster',
  onTakeDamage(m, d) {
    const v = m.caster; const ab = m.ability; const s = d.src;
    if (!v.alive || !ab || ab.level < 1 || !s || s === m.parent || d.ability === ab) return;
    if (!(s.isHero || s.isSummon || s.heroLike || s.name === 'npc_dota_roshan')) return; // "dealt by a player or Roshan"
    if (d.dealt <= ab.v('damage_min') || d.dealt >= ab.v('damage_max')) return;
    const sm = v.findModifier(SOUL); if (!sm) return;
    const lim = ab.v('damage_limit'); const max = ab.v('stack_limit');
    sm.x += d.dealt;
    while (sm.x >= lim) { sm.x -= lim; if (sm.stacks < max) sm.setStacks(sm.stacks + 1); sm.y = v.world.time + ab.v('stack_duration'); }
  },
});
modifier(SOUL, {
  hidden: true, interval: 0.5, thinkNow: true,
  onThink(m) {
    const u = m.parent; const w = u.world; const r = m.v('radius');
    for (const e of w.units) if (e.alive && realHero(e) && e.st[ST.OUT] === 0 && gap(e, u) <= r) e.addModifier('modifier_visage_soul_assumption_tracker', { caster: u, ability: m.ability, duration: 1 });
    if (m.stacks > 0 && w.time >= m.y) m.setStacks(0);
  },
});
defAbility('visage_soul_assumption', {
  mods: [SOUL], prio: 65,
  ai(ab, u, t) {
    const m = u.findModifier(SOUL);
    if (!t || !m || m.stacks < 1 || immune(ab, t) || !visageCanAfford(ab, u)) return null;
    const dmg = (ab.v('soul_base_damage') + ab.v('soul_charge_damage') * m.stacks) * (1 + u.spellAmp / 100) * (1 - t.mr);
    return m.stacks >= ab.v('stack_limit') || m.y - u.world.time <= 1.5 || dmg >= t.hp ? { target: t } : null;
  },
  cast(ab, t) {
    const u = ab.owner; const w = u.world; const m = u.findModifier(SOUL);
    const dmg = ab.v('soul_base_damage') + ab.v('soul_charge_damage') * (m ? m.stacks : 0);
    if (m) m.setStacks(0);
    const targets = [t];
    const extra = ab.v('target_count') - 1;
    if (extra > 0) {
      // talent: further bolts go to random enemies within cast range, heroes first
      const pool = enemiesNear(ab, u.x, u.y, ab.castRange()).filter((e) => e !== t && e.targetable() && !immune(ab, e));
      const pick = (list) => { while (list.length && targets.length <= extra) targets.push(list.splice(w.rng.int(0, list.length - 1), 1)[0]); };
      pick(pool.filter((e) => e.isHero)); pick(pool.filter((e) => !e.isHero && !e.isBuilding));
    }
    for (const e of targets) w.projectile(u, e, ab.v('bolt_speed'), (tt) => { if (!immune(ab, tt)) hit(ab, tt, dmg, MAGICAL); });
  },
  fid: 'approx', note: 'damage taken by heroes in range (after reductions) is gathered into charges; all charges share one timer that restarts with every new charge; the gathering aura is refreshed every 0.5 s; AI releases at full charges, before they expire or for a kill',
});

// Stone Form (familiars, and Visage himself with the Shard): the unit cannot act while it is stone
modifier('modifier_visage_summon_familiars_stone_form_buff', { purge: 'none', state: ['INVULN', 'STUN'], stats: (m) => ({ hpRegen: m.data.regen }) });
function stoneForm(u, sf, src, regen) {
  const w = u.world; const lord = u.owner || u;
  w.after(sf.v('stun_delay'), () => {
    if (!u.alive) return;
    for (const e of w.inRadius(u.x, u.y, sf.v('stun_radius'), u.team, true)) {
      if (e.isBuilding || immune(sf, e)) continue;
      w.damage(u, e, sf.v('stun_damage'), MAGICAL, 0, src);
      if (e.alive) e.addModifier('modifier_stunned', { caster: u, ability: src, duration: sf.v('stun_duration') });
    }
    u.addModifier('modifier_visage_summon_familiars_stone_form_buff', { caster: u, ability: src, duration: sf.v('stone_duration'), data: { regen } });
  });
}

// Gravekeeper's Cloak: m.stacks = layers (hero copy). The familiars carry the same ability and read their master's layers.
const CLOAK = 'modifier_visage_gravekeepers_cloak';
modifier(CLOAK, {
  hidden: true, breakable: false, // "Break does not disable the bonuses from existing stacks"
  onCreated(m) { m.stacks = m.parent.isHero ? m.v('max_layers') : 0; },
  postMit(m, d) {
    m.y = d.amount; // the hit before the cloak's own reduction (compared with minimum_damage below)
    if (d.amount <= 0 || (d.flags & F_HP_LOSS)) return;
    const u = m.parent; let pct = 0;
    if (u.isHero) pct = m.v('damage_reduction') * m.stacks;
    else { const o = u.owner; const om = o && o.alive ? o.findModifier(CLOAK) : null; if (om && om.ability && gap(o, u) <= om.v('radius')) pct = om.v('damage_reduction') * om.stacks; }
    if (pct > 0) d.amount *= Math.max(0, 1 - pct / 100);
  },
  onTakeDamage(m, d) {
    const u = m.parent; const s = d.src; const w = u.world;
    const pre = (d.flags & F_HP_LOSS) ? d.dealt : m.y; m.y = 0;
    if (!u.isHero || m.stacks <= 0 || !s || s === u || pre <= m.v('minimum_damage')) return;
    if (!(s.isHero || s.isSummon || s.heroLike)) return; // "from a player owned source"
    m.setStacks(m.stacks - 1);
    const back = () => {
      if (m.removed || !u.alive) return;
      if (u.st[ST.BREAK] > 0) { w.after(0.5, back); return; } // "Break disables the gaining of new stacks"
      m.setStacks(Math.min(m.v('max_layers'), m.stacks + 1));
    };
    w.after(m.v('recovery_time'), back);
  },
});
defAbility('visage_gravekeepers_cloak', {
  mods: [CLOAK], prio: 35,
  requires: tune((ab) => {
    const on = ab.owner.isHero && ab.v('shard_cooldown') > 0;
    if (on) { ab.vals.AbilityCooldown = ab.v('shard_cooldown'); ab.vals.AbilityManaCost = ab.v('shard_manacost'); }
    setActive(ab, on);
  }),
  ai: (ab, u, t) => (t && u.hp / u.maxHp < 0.45 ? here(u) : null),
  cast(ab) {
    const u = ab.owner; const sf = u.findAbility('visage_summon_familiars_stone_form'); const ult = u.findAbility('visage_summon_familiars');
    if (!sf) return;
    const lv = Math.max(1, ult ? ult.level : 1); if (sf.level !== lv) sf.setLevel(lv); // Stone Form follows the level of Summon Familiars
    stoneForm(u, sf, ab, u.maxHp * ab.v('shard_hp_restoration_pct') / 100 / sf.v('stone_duration'));
  },
  fid: 'approx', note: 'layers recover one by one after recovery_time each; a layer is lost when a hit from a hero or player unit exceeds minimum_damage after armor / magic resistance but before the cloak\'s own reduction; Shard Stone Form uses the Stone Form values at the Summon Familiars level, Visage cannot act while stone and the health is restored evenly over the stone time; AI uses it below 45% health and holds back mana for it while it is ready',
});
na('visage_stone_form_self_cast', 'order relay to the nearest familiar; familiars use Stone Form through their own AI');

// Summon Familiars
debuff('modifier_visage_summon_familiars_corruption', { multi: 'stack', stats: (m) => ({ armor: -m.stacks }) });
function familiarCorruption(m, rec) {
  const n = m.v('armor_reduction_per_hit'); const t = rec.target;
  if (n > 0 && t.alive && !t.isBuilding) t.addModifier('modifier_visage_summon_familiars_corruption', { caster: m.caster, ability: m.ability, duration: m.v('armor_reduction_duration'), stacks: n });
}
modifier('modifier_visage_summon_familiars', { hidden: true, stats: (m) => ({ dmgBase: m.v('visage_base_damage') }), onAttackLanded(m, rec) { familiarCorruption(m, rec); } });
modifier('modifier_visage_summon_familiars_familiar', { hidden: true, purge: 'none', onAttackLanded(m, rec) { familiarCorruption(m, rec); } });
// [L] the familiar unit has AutoAttacksByDefault 0: in Hero Demo the summoned familiars stood next to the dummy and never
// attacked it. They attack only what Visage attacks (the target he is ordered to attack or his controller's target, as a player
// would order them); Stone Form stays with their own controller.
const ATTACK_ORDER = 1; // ORDER.ATTACK of the engine
const visageTarget = (o) => {
  if (!o || !o.alive) return null;
  const t = o.order === ATTACK_ORDER ? o.orderTarget : (o.ai && o.ai.mode !== 'idle' ? o.ai.target : null);
  return t && t.alive ? t : null;
};
function familiarAI(f) {
  const base = f.ai; if (!base || typeof base.think !== 'function') return;
  const ai = Object.create(base);
  ai.think = function (u, w) {
    const t = visageTarget(u.owner);
    this.fixedTarget = t; if (!t) this.target = null;
    base.think.call(this, u, w);
    if (!t && u.order === ATTACK_ORDER) u.stop();
  };
  f.ai = ai;
}
defAbility('visage_summon_familiars', {
  mods: ['modifier_visage_summon_familiars'], prio: 88, engage: false,
  ai: (ab, u, t) => (t && familiarsOf(u).length === 0 ? here(u) : null),
  cast(ab) {
    const u = ab.owner; const w = u.world;
    for (const f of familiarsOf(u)) w.kill(f, null, null, true); // "will replace any existing Familiars"
    const n = ab.v('familiar_count'); const dmg = ab.v('familiar_attack_damage');
    for (let i = 0; i < n; i++) {
      const f = summon(ab, FAMILIAR, { x: u.x + ab.v('side_distance') * (i - (n - 1) / 2), y: u.y - ab.v('back_distance'), abilityLevel: ab.level, ai: { mode: 'fight', abilities: ['visage_summon_familiars_stone_form'] },
        ovr: { hp: ab.v('familiar_hp'), armor: ab.v('familiar_armor'), dmgMin: dmg, dmgMax: dmg, ms: ab.v('familiar_base_movespeed'), range: ab.v('familiar_attack_range') } });
      f.addModifier('modifier_visage_summon_familiars_familiar', { caster: u, ability: ab });
      familiarAI(f);
    }
  },
  fid: 'approx', note: 'familiars do not attack by themselves (AutoAttacksByDefault 0, live): they attack the target Visage attacks, as a player would order them, and use Stone Form through their own AI; the recall alt-cast is map movement and not modelled; armor-corruption talent: stacks share one refreshed timer; AI resummons only when no familiar is left',
});
defAbility('visage_summon_familiars_stone_form', {
  prio: 50, manual: true, // Visage carries a copy of this ability too; the familiars' own AI lists it explicitly
  ai(ab, u) {
    if (u.isHero) return null;
    const lord = u.owner || u;
    const es = u.world.inRadius(u.x, u.y, ab.v('stun_radius') - 25, u.team, true).filter((e) => !e.isBuilding && e.st[ST.INVULN] === 0);
    if (!es.length) return null;
    return u.hp / u.maxHp < 0.5 || es.some((e) => e.isHero && e.channelAb) ? here(u) : null;
  },
  cast(ab) { const u = ab.owner; if (u.isHero) { ab.cdEnd = 0; return; } stoneForm(u, ab, ab, ab.v('hp_regen')); },
  fid: 'approx', note: 'familiar ability: the familiar cannot act while stone and stays stone for the full stone_duration; own AI: used below 50% health or to interrupt a channeling enemy hero in range; the alt-cast (move, then cast) is not modelled. Manual on Visage: his own copy does nothing by itself, his Stone Form comes from the Shard through Gravekeeper\'s Cloak',
});
na('visage_summon_familiars_recall', 'returns the familiar to Visage (map movement)');

// Silent as the Grave
const GRAVE = 'modifier_visage_silent_as_the_grave';
modifier(GRAVE + '_invis', { hidden: true, purge: 'none', state: ['INVIS'] });
// [L] measured in Hero Demo: the bonus is a percentage of the base attack damage (161 -> 177, Scepter 174 -> 208); it is
// given at the cast without a duration and runs out bonus_duration after the flight ends
buff(GRAVE + '_bonus', { purge: 'none', stats: (m) => ({ dmgBasePct: m.v('bonus_damage') }) });
function graveBreak(m) { m.remove(); }
buff(GRAVE, {
  purge: 'none', stats: (m) => ({ msPct: m.v('movespeed_bonus') }),
  onAttackStart(m) { graveBreak(m); },
  onCast(m, ev) { if (ev.ability !== m.ability) graveBreak(m); },
  onDestroy(m) {
    const u = m.parent; const ab = m.ability;
    for (const x of [u, ...familiarsOf(u)]) {
      x.removeModifierByName(GRAVE + '_invis');
      const b = x.findModifier(GRAVE + '_bonus');
      if (b && ab) b.setDuration(ab.v('bonus_duration'));
    }
  },
});
defAbility('visage_silent_as_the_grave', {
  prio: 20, engage: false,
  ai: (ab, u, t) => (t && !u.hasModifier(GRAVE) && !u.hasModifier(GRAVE + '_bonus') && visageCanAfford(ab, u) ? here(u) : null),
  cast(ab) {
    const u = ab.owner; const d = ab.v('flight_duration');
    addMod(ab, u, GRAVE, d);
    for (const x of [u, ...familiarsOf(u)]) x.addModifier(GRAVE + '_bonus', { caster: u, ability: ab });
    if (ab.v('invis') > 0) for (const x of [u, ...familiarsOf(u)]) x.addModifier(GRAVE + '_invis', { caster: u, ability: ab, duration: d });
  },
  fid: 'approx', note: 'the damage bonus is a percentage of base attack damage, given at the cast and kept bonus_duration after the flight ends (live); the familiars get it too (not verified live); flying movement has no effect in the sandbox; Scepter invisibility only matters with rules.detectAll off',
});

// ================================================================ Dark Seer
modifier('modifier_dark_seer_vacuum', { debuff: true, state: ['STUN'], purge: 'strong', statusResist: false });
defAbility('dark_seer_vacuum', {
  prio: 75,
  ai(ab, u, t) {
    if (!t) return null;
    const d = u.distTo(t); const k = d > 1 ? Math.min(ab.v('radius') / 2, d) / d : 0; // centre shifted half a radius towards the caster
    return { x: t.x + (u.x - t.x) * k, y: t.y + (u.y - t.y) * k };
  },
  cast(ab, t, x, y) {
    const u = ab.owner; const w = u.world; const dur = ab.v('duration');
    const es = enemiesNear(ab, x, y, ab.v('radius')).filter((e) => !e.isBuilding);
    for (const e of es) {
      if (immune(ab, e) || !addMod(ab, e, 'modifier_dark_seer_vacuum', dur)) continue;
      const d = Math.hypot(e.x - x, e.y - y); const k = d > 30 ? 30 / d : 1; // gathered next to the centre, direction kept
      e.x = x + (e.x - x) * k; e.y = y + (e.y - y) * k;
    }
    w.after(dur, () => { for (const e of es) if (e.alive) hit(ab, e, ab.v('damage'), MAGICAL); });
  },
  fid: 'approx', note: 'units are moved to the centre at once and held (disabled) for the pull duration, then damaged; AI centres the vacuum half a radius from the target towards itself',
});
const ION = 'modifier_dark_seer_ion_shell';
buff(ION, {
  interval: (m) => m.v('tick_interval'),
  onThink(m) {
    const u = m.parent; const dmg = m.v('damage_per_second') * m.v('tick_interval');
    for (const e of u.world.enemiesInRadius(m.caster, u.x, u.y, m.v('radius'))) if (e !== u && !e.isBuilding) mhit(m, e, dmg, MAGICAL);
  },
});
defAbility('dark_seer_ion_shell', {
  prio: 62,
  ai(ab, u, t) {
    if (!t) return null;
    let best = null; let bd = Infinity;
    for (const a of u.world.inRadius(u.x, u.y, ab.castRange(), u.team, false)) {
      if (a.isBuilding || a.hasModifier(ION)) continue;
      const d = a.distTo(t); if (d < bd) { bd = d; best = a; }
    }
    return best && bd <= ab.v('radius') + 400 ? { target: best } : null;
  },
  cast(ab, t) { addMod(ab, t || ab.owner, ION, ab.v('duration')); },
  fid: 'full', note: 'AI puts the shell on the ally (or itself) closest to its target',
});
const SURGE = 'modifier_dark_seer_surge';
debuff(SURGE + '_trail', { statusResist: false, stats: (m) => ({ msPct: -Math.abs(m.v('trail_move_slow')) }) });
function surgeTrail(m) {
  const ab = m.ability; const c = m.caster; const w = c.world; const nodes = m.data.trail;
  const iv = ab.v('trail_damage_interval');
  const tick = () => {
    const now = w.time; const r = ab.v('trail_radius');
    while (nodes.length && nodes[0].t <= now) nodes.shift();
    if (!nodes.length && m.removed) return;
    for (const e of w.units) {
      if (!e.alive || e.team === c.team || e.isBuilding || e.st[ST.OUT] > 0 || !nodes.some((n) => Math.hypot(e.x - n.x, e.y - n.y) <= r)) continue;
      if (e.addModifier(SURGE + '_trail', { caster: c, ability: ab, duration: iv + 0.1 })) w.damage(c, e, ab.v('trail_damage') * iv, MAGICAL, 0, ab);
    }
    w.after(iv, tick);
  };
  w.after(iv, tick);
}
buff(SURGE, {
  stats: (m) => ({ msAbs: m.v('speed_boost') }), interval: 0.25, thinkNow: true,
  onCreated(m) { m.data = { trail: [] }; if (m.v('trail_radius') > 0) surgeTrail(m); },
  onThink(m) { if (m.v('trail_radius') > 0) m.data.trail.push({ x: m.parent.x, y: m.parent.y, t: m.parent.world.time + m.v('trail_duration') }); },
});
defAbility('dark_seer_surge', {
  prio: 100,
  ai: (ab, u, t) => (t && !u.hasModifier(SURGE) && u.rangeTo(t) > u.attackRange + 200 ? { target: u } : null),
  cast(ab, t) {
    const u = ab.owner; const tt = t || u; const r = ab.v('aoe_radius');
    // [L] measured in Hero Demo: an ally counts when its collision circle touches the area (362 from the target: yes, 385: no)
    const list = r > 0 ? u.world.units.filter((a) => a.alive && a.team === u.team && !a.isBuilding && a.st[ST.OUT] === 0 && Math.hypot(a.x - tt.x, a.y - tt.y) <= r + a.def.hull) : [];
    if (!list.includes(tt)) list.push(tt);
    for (const a of list) addMod(ab, a, SURGE, ab.v('duration'));
  },
  fid: 'approx', note: 'speed is forced to speed_boost and cannot be slowed; phased movement has no effect in the sandbox; Shard trail is sampled every 0.25 s and its damage is magical (no type in the data); AI uses it on itself to close distance',
});
// fraction of max_distance walked during the last recent_duration seconds
const punchK = (m) => { let moved = 0; for (let i = 1; i < m.data.pts.length; i += 2) moved += m.data.pts[i]; return Math.min(1, moved / m.v('max_distance')); };
// [L] measured in Hero Demo: a punch without any distance walked still deals 10 damage, stuns 0.2 s and knocks back 50;
// after 660 walked it dealt 244 / 0.83 s / 230: each value runs linearly from that minimum to its maximum
const punchLerp = (k, lo, hi) => lo + (hi - lo) * k;
passive('dark_seer_normal_punch', {
  interval: 0.1, // sampling step of the distance walked
  onCreated(m) { m.data = { pts: [], px: m.parent.x, py: m.parent.y }; },
  onThink(m) {
    const u = m.parent; const now = u.world.time; const d = m.data;
    const step = Math.hypot(u.x - d.px, u.y - d.py); d.px = u.x; d.py = u.y;
    if (step > 0) d.pts.push(now, step);
    const lim = now - m.v('recent_duration');
    while (d.pts.length && d.pts[0] < lim) d.pts.splice(0, 2);
  },
  onAttack(m, rec) {
    const t = rec.target;
    if (rec.secondary || !realHero(t) || !m.ability.cdReady() || immune(m.ability, t)) return;
    m.ability.startCooldown();
    rec.trueStrike = true; (rec.data ||= {}).punch = m;
  },
  // [L] measured in Hero Demo: the punch damage is its own magical instance, dealt just before the attack's damage
  outgoing(m, d) {
    const r = d.rec; if (!(r && r.data && r.data.punch === m && r.data.punchK === undefined)) return;
    const k = r.data.punchK = punchK(m);
    m.parent.world.damage(m.parent, d.dst, punchLerp(k, 10, m.v('max_damage')), MAGICAL, 0, m.ability);
  },
  onAttackLanded(m, rec) {
    if (!(rec.data && rec.data.punch === m)) return;
    const u = m.parent; const t = rec.target; const w = u.world; const ab = m.ability;
    const k = rec.data.punchK ?? punchK(m);
    if (t.alive) { t.addModifier('modifier_stunned', { caster: u, ability: ab, duration: punchLerp(k, 0.2, ab.v('max_stun')) }); knockback(t, u.x, u.y, punchLerp(k, 50, ab.v('knockback_distance'))); }
    const wall = u.findAbility('dark_seer_wall_of_replica');
    w.after(ab.v('normal_punch_illusion_delay'), () => {
      if (!wall || !t.alive) return;
      w.createIllusion(t, { team: u.team, owner: u, duration: ab.v('illusion_duration'), outPct: wall.v('replica_damage_outgoing'), inPct: wall.v('replica_damage_incoming'), potency: ab.v('replica_effectiveness'), x: t.x + 60, y: t.y, target: t });
    });
  },
  fid: 'approx', note: 'distance walked is sampled every 0.1 s; damage, stun and knockback run linearly from 10 / 0.2 s / 50 (live minimum at zero distance) to their maximum; the damage is its own instance just before the attack (live); the knockback is instant (live: about 350 per second); damage is magical (no type in the data); the replica uses Wall of Replica\'s damage values at its current level (level 1 if unlearned)',
});
// [L] measured in Hero Demo at every level: the attack speed comes from whole points of intelligence
passive('dark_seer_aggrandize', { late(m, s, u) { s.as += Math.floor(u.int + 1e-6) * m.v('int_to_atkspd'); }, fid: 'full', note: 'attack speed from whole points of intelligence (live game); the level-up restore has no effect at a fixed level' });
modifier('modifier_dark_seer_wall_of_replica', { hidden: true });
debuff('modifier_dark_seer_wall_of_replica_slow', { pierce: true, stats: (m) => ({ msPct: -m.v('movement_slow') }) });
defAbility('dark_seer_wall_of_replica', {
  mods: ['modifier_dark_seer_wall_of_replica'], prio: 85,
  requires: tune((ab) => { const r = ab.v('cooldown_reduction'); if (r > 0) ab.vals.AbilityCooldown = Math.max(0, ab.v('AbilityCooldown') - r); }),
  ai: (ab, u, t) => (t && realHero(t) ? { x: t.x, y: t.y } : null),
  cast(ab, t, x, y) {
    const u = ab.owner; const w = u.world;
    const dx = x - u.x; const dy = y - u.y; const d = Math.hypot(dx, dy) || 1;
    const len = (ab.v('width')) * (ab.v('scepter_length_multiplier') > 0 ? ab.v('scepter_length_multiplier') : 1);
    const nx = dx / d; const ny = dy / d; // the wall stands across the caster-target line; (nx, ny) is its normal
    const end = w.time + ab.v('duration'); const seen = new Map(); let first = true;
    const tick = () => {
      if (w.time >= end - 1e-9) return;
      for (const e of w.units) {
        if (!e.alive || e.team === u.team || !realHero(e) || e.st[ST.OUT] > 0) continue; // "Doesn't create illusions from other illusions"
        const side = (e.x - x) * nx + (e.y - y) * ny; const along = Math.abs((e.x - x) * -ny + (e.y - y) * nx);
        let s = seen.get(e); if (!s) seen.set(e, s = { side, next: 0, replica: null });
        // crossing = the hero changed sides since the last check; a hero standing in the wall as it is raised is hit at once
        const inWall = Math.abs(side) <= 50 + e.def.hull && along <= len / 2 + e.def.hull;
        const crossed = first ? inWall : s.side * side < 0;
        if (side !== 0) s.side = side;
        // [L] measured in Hero Demo: a hero standing in the wall stays slowed (the slow is renewed while it is inside and
        // runs out slow_duration after it left); damage and replica only come once per crossing
        if (inWall) e.addModifier('modifier_dark_seer_wall_of_replica_slow', { caster: u, ability: ab, duration: ab.v('slow_duration'), pierce: true });
        if (!crossed || along > len / 2 + e.def.hull || w.time < s.next) continue;
        s.next = w.time + ab.v('slow_duration');
        e.addModifier('modifier_dark_seer_wall_of_replica_slow', { caster: u, ability: ab, duration: ab.v('slow_duration'), pierce: true });
        w.damage(u, e, ab.v('wall_damage'), MAGICAL, 0, ab);
        if (e.alive && (!s.replica || !s.replica.alive)) s.replica = w.createIllusion(e, { team: u.team, owner: u, duration: end - w.time, outPct: ab.v('replica_damage_outgoing'), inPct: ab.v('replica_damage_incoming'), potency: ab.v('replica_effectiveness'), x: e.x + 60, y: e.y, target: e });
      }
      first = false;
      w.after(0.1, tick);
    };
    tick();
  },
  fid: 'approx', note: 'AI raises the wall on its target, across the line between them; a hero standing in the wall when it is raised (within 50 units plus its collision size) or walking across it later (checked every 0.1 s) is slowed, damaged and copied, with one living replica per hero; wall damage is magical (no type in the data); scepter_length_multiplier is applied although no tooltip mentions it',
});

// ================================================================ Bounty Hunter
const TRACK = 'modifier_bounty_hunter_track';
debuff('modifier_bounty_hunter_shuriken_toss_slow', { stats: (m) => ({ msPct: -m.v('slow') }) });
defAbility('bounty_hunter_shuriken_toss', {
  prio: 55,
  cast(ab, t) {
    const u = ab.owner; const w = u.world; const seen = new Set(); const jin = u.findAbility('bounty_hunter_jinada');
    const land = (e) => {
      seen.add(e);
      if (!immune(ab, e)) {
        hit(ab, e, ab.v('bonus_damage'), MAGICAL);
        if (e.alive) addMod(ab, e, 'modifier_bounty_hunter_shuriken_toss_slow', ab.v('slow_duration'));
        if (e.alive && u.hasScepter && jin && jin.level > 0) w.damage(u, e, jin.v('bonus_damage'), PHYSICAL, F_NO_AMP, jin);
      }
      let nx = null; let bd = ab.v('bounce_aoe');
      for (const o of w.units) { if (!o.alive || o.team === u.team || seen.has(o) || o.st[ST.OUT] > 0 || !o.hasModifier(TRACK)) continue; const d = gap(o, e); if (d <= bd) { bd = d; nx = o; } }
      if (nx) w.projectile(e, nx, ab.v('speed'), land);
    };
    w.projectile(u, t, ab.v('speed'), land);
  },
  fid: 'approx', note: 'Scepter "applies Jinada on hit" is modelled as Jinada\'s bonus damage (physical) on every unit hit, without using Jinada\'s cooldown; gold steal has no effect in the sandbox',
});
// [L] measured in Hero Demo: while Jinada is ready its bonus is part of the hero's attack damage (shown in the average attack
// damage); it is spent by the next attack that lands
passive('bounty_hunter_jinada', {
  dynamic: true, stats: (m) => (m.ability.cdReady() ? { dmg: m.v('bonus_damage') } : {}),
  onAttack(m, rec) { if (!rec.secondary && m.ability.cdReady()) (rec.data ||= {}).jinada = m; },
  onAttackLanded(m, rec) { if (rec.data && rec.data.jinada === m) { m.ability.startCooldown(); m.parent.dirty = true; } },
  fid: 'full', note: 'autocast assumed on; the bonus is bonus attack damage while Jinada is ready (live); gold steal has no effect in the sandbox',
});
const WALK = 'modifier_bounty_hunter_wind_walk';
modifier(WALK + '_invis', { hidden: true, purge: 'none', state: ['INVIS'] });
buff(WALK, {
  purge: 'none', stats: (m) => ({ msPct: m.v('bonus_move_speed_pct'), dmgTaken: -m.v('damage_reduction_pct') }),
  // m.x = time the fade ends (attacks before it neither break the walk nor stun), m.z = 1 once the breaking attack is on its way
  onCreated(m) {
    const u = m.parent; const w = u.world; const fade = m.data && m.data.fade !== undefined ? m.data.fade : m.v('fade_time');
    m.x = w.time + fade;
    w.after(fade, () => { if (!m.removed && m.z !== 1) u.addModifier(WALK + '_invis', { caster: m.caster, ability: m.ability, duration: m.remaining() }); });
  },
  onDestroy(m) { m.parent.removeModifierByName(WALK + '_invis'); },
  onAttack(m, rec) {
    const u = m.parent;
    if (rec.secondary || m.z === 1 || u.world.time < m.x - 1e-9) return;
    m.z = 1; (rec.data ||= {}).shadowWalk = m; u.removeModifierByName(WALK + '_invis');
    u.world.after(2, () => m.remove()); // safety net if that attack never arrives (target died while a projectile was flying)
  },
  onAttackLanded(m, rec) {
    if (!(rec.data && rec.data.shadowWalk === m)) return;
    const t = rec.target;
    if (t.alive && !t.isBuilding) t.addModifier('modifier_stunned', { caster: m.parent, ability: m.ability, duration: m.v('stun_duration') });
    m.remove();
  },
  onAttackMiss(m, rec) { if (rec.data && rec.data.shadowWalk === m) m.remove(); },
  onCast(m, ev) {
    const n = ev.ability.name;
    if (ev.ability === m.ability || n === 'bounty_hunter_track' || n === 'bounty_hunter_wind_walk_ally' || m.parent.world.time < m.x - 1e-9) return;
    m.remove();
  },
});
defAbility('bounty_hunter_wind_walk', {
  prio: 60, engage: false,
  ai: (ab, u, t) => (t && !u.hasModifier(WALK) ? here(u) : null),
  cast(ab) { addMod(ab, ab.owner, WALK, ab.v('duration')); },
  fid: 'full', note: 'invisibility only hides the unit when rules.detectAll is off; moving through units has no effect in the sandbox',
});
modifier('modifier_bounty_hunter_wind_walk_ally', { hidden: true });
// [L] measured in Hero Demo: Friendly Shadow has the cooldown of Shadow Walk's current level (its own data has none); the two
// cooldowns run separately
const allyShadowCd = (ab) => { const ww = ab.owner.findAbility('bounty_hunter_wind_walk'); ab.vals.AbilityCooldown = ww && ww.level > 0 ? ww.v('AbilityCooldown') : 0; };
defAbility('bounty_hunter_wind_walk_ally', {
  mods: ['modifier_bounty_hunter_wind_walk_ally'], prio: 58,
  requires: tune(allyShadowCd),
  ai(ab, u, t) {
    const ww = u.findAbility('bounty_hunter_wind_walk');
    if (!t || !ww || ww.level < 1) return null;
    for (const a of u.world.inRadius(u.x, u.y, ab.castRange(), u.team, false)) if (a !== u && realHero(a) && !a.hasModifier(WALK)) return { target: a };
    return null;
  },
  cast(ab, t) {
    const u = ab.owner; const ww = u.findAbility('bounty_hunter_wind_walk');
    if (t && ww && ww.level > 0) t.addModifier(WALK, { caster: u, ability: ww, duration: ww.v('duration'), data: { fade: ab.v('fade_time') } });
    // [L] Hero Demo: without Shadow Walk learned the order is accepted but nothing is cast (no cooldown, no mana)
    if (!ww || ww.level < 1) { if (!u.world.freeSpells) { u.giveMana(ab.manaCost()); ab.cdEnd = 0; } return; }
    if (!u.world.freeSpells) ab.cdEnd = u.world.time + ww.cooldown();
  },
  fid: 'full', note: 'needs Shadow Walk learned; cooldown = Shadow Walk\'s cooldown (live); AI gives it to an allied hero in range that does not have it',
});
na('bounty_hunter_big_game_hunter', 'gold bonus only');
debuff(TRACK, { pierce: true, stats: (m) => ({ dmgTaken: m.v('target_damage_amp') }) });
defAbility('bounty_hunter_track', {
  prio: 82,
  ai(ab, u, t, w) {
    const ok = (e) => { if (!e || !e.alive || e.team === u.team || !realHero(e) || !e.targetable() || u.distTo(e) > ab.castRange() + 200) return false; const m = e.findModifier(TRACK); return !m || m.remaining() < 2; };
    if (ok(t)) return { target: t };
    for (const e of w.units) if (ok(e)) return { target: e };
    return null;
  },
  cast(ab, t) { if (t) addMod(ab, t, TRACK, ab.v('duration'), { pierce: true }); },
  fid: 'approx', note: 'the damage amplification is modelled; True Sight is not modelled (invisibility only hides units when a scenario turns rules.detectAll off; a Tracked invisible hero stays hidden there); the gold bounty has no effect in the sandbox; AI keeps it up on every enemy hero in range',
});

// ================================================================ Elder Titan
const SPIRIT = 'npc_dota_elder_titan_ancestral_spirit';
const SPIRIT_MOD = 'modifier_elder_titan_ancestral_spirit_unit';
const spiritOf = (u) => { const a = u.findAbility('elder_titan_ancestral_spirit'); const s = a ? a.data : null; return s && s.alive ? s : null; };

modifier('modifier_elder_titan_echo_stomp', {
  debuff: true, state: ['SLEEP', 'DISARM'], purge: 'strong', keepLonger: true, // [L] Hero Demo reports the sleeper as stunned and disarmed
  // m.x = damage taken while asleep, m.y = wake-up threshold
  onTakeDamage(m, d) { if (d.dealt <= 0) return; m.x += d.dealt; if (m.x > m.y) m.remove(); },
});
defAbility('elder_titan_echo_stomp', {
  prio: 70, channel: true,
  ai(ab, u, t) {
    if (!t) return null;
    const r = ab.v('radius') - 100; const sp = spiritOf(u);
    return u.distTo(t) <= r || (sp && gap(sp, t) <= r) ? here(u) : null;
  },
  cast() {},
  channelEnd(ab, interrupted) {
    if (interrupted) return;
    const u = ab.owner; const w = u.world; const sp = spiritOf(u); const hits = [];
    for (const e of enemiesNear(ab, u.x, u.y, ab.v('radius'))) { if (e.isBuilding) continue; hit(ab, e, ab.v('stomp_damage'), PHYSICAL); hits.push([e, ab]); }
    const sa = sp ? sp.findAbility('elder_titan_echo_stomp_spirit') : null;
    if (sa) {
      sa.maxLevel = ab.maxLevel; if (sa.level !== ab.level) sa.setLevel(ab.level); // the spirit's copy follows the hero ability
      for (const e of enemiesNear(ab, sp.x, sp.y, sa.v('radius'))) { if (e.isBuilding) continue; w.damage(u, e, sa.v('stomp_damage'), MAGICAL, 0, sa); hits.push([e, sa]); }
    } else if (!sp) {
      // [L] measured in Hero Demo: while the spirit is inside Elder Titan its magical stomp lands around him as well, with the
      // hero ability's own damage (two instances on the same target: physical, then magical)
      for (const e of enemiesNear(ab, u.x, u.y, ab.v('radius'))) { if (e.isBuilding) continue; w.damage(u, e, ab.v('stomp_damage'), MAGICAL, 0, ab); }
    }
    for (const [e, a] of hits) {
      if (!e.alive || immune(ab, e)) continue;
      e.addModifier('modifier_stunned', { caster: u, ability: ab, duration: ab.v('initial_stun_duration') });
      // [L] measured in Hero Demo: the spirit's stomp puts to sleep for the hero ability's sleep_duration (4.4, not the spirit's 5)
      const sm = e.addModifier('modifier_elder_titan_echo_stomp', { caster: u, ability: a, duration: ab.v('sleep_duration') });
      if (sm) sm.y = Math.max(sm.y, a.v('wake_damage_limit'));
    }
  },
  fid: 'approx', note: 'both stomps land when the channel ends (the stomp damage itself never wakes); sleepers wake once the damage taken while asleep exceeds wake_damage_limit; the Shard alt-cast mode (Elder Titan takes the spirit\'s place as the stomp completes) is not modelled, alt-cast is treated as always off',
});
defAbility('elder_titan_echo_stomp_spirit', { fid: 'approx', note: 'spirit ability: performed together with Elder Titan\'s Echo Stomp, with this ability\'s own damage and sleep values at the hero ability\'s level; the Shard alt-cast swap (can_swap_places) is not modelled' });

buff('modifier_elder_titan_ancestral_spirit_buff', { stats: (m) => ({ dmg: m.data.dmg, msPct: m.data.ms }), onRefresh(m, o) { if (o && o.data) { m.data = o.data; m.parent.dirty = true; } } });
function spiritRejoin(m) {
  const sp = m.parent; const u = m.caster; const ab = m.ability; const d = m.data;
  if (d.heroes + d.creeps > 0) {
    u.addModifier('modifier_elder_titan_ancestral_spirit_buff', { caster: u, ability: ab, duration: ab.v('buff_duration'),
      data: { dmg: d.heroes * ab.v('damage_heroes') + d.creeps * ab.v('damage_creeps'), ms: Math.min(ab.v('move_pct_cap'), d.heroes * ab.v('move_pct_heroes') + d.creeps * ab.v('move_pct_creeps')) } });
  }
  const imm = ab.v('scepter_magic_immune_per_hero') * d.heroes;
  if (imm > 0) u.addModifier('modifier_debuff_immune', { ability: ab, duration: imm, data: { mr: ab.v('immunity_resist') } });
  ab.data = null;
  sp.world.kill(sp, null, null, true);
}
modifier(SPIRIT_MOD, {
  hidden: true, purge: 'none', state: ['OUT', 'INVULN'], interval: 0.1, thinkNow: true, // 0.1 s movement step
  onThink(m) {
    const sp = m.parent; const u = m.caster; const ab = m.ability; const w = sp.world; const d = m.data;
    if (!u.alive) { ab.data = null; w.kill(sp, null, null, true); return; }
    if (d.phase !== 'back' && w.time >= d.end) d.phase = 'back';
    const back = d.phase === 'back'; const tx = back ? u.x : d.tx; const ty = back ? u.y : d.ty;
    const step = (d.phase === 'move' ? sp.ms : ab.v('speed')) * 0.1;
    const dx = tx - sp.x; const dy = ty - sp.y; const dist = Math.hypot(dx, dy);
    if (dist <= step) { sp.x = tx; sp.y = ty; if (back) { spiritRejoin(m); return; } d.phase = 'stay'; } else { sp.x += dx / dist * step; sp.y += dy / dist * step; }
    for (const e of w.enemiesInRadius(u, sp.x, sp.y, ab.v('radius'))) {
      if (e.isBuilding || d.hit.has(e)) continue;
      d.hit.add(e);
      if (e.heroLike && !e.isIllusion) d.heroes++; else d.creeps++;
      w.damage(u, e, ab.v('pass_damage'), MAGICAL, 0, ab);
    }
  },
});
defAbility('elder_titan_ancestral_spirit', {
  prio: 85,
  ai: (ab, u, t) => (t && !spiritOf(u) ? { x: t.x, y: t.y } : null),
  cast(ab, t, x, y) {
    const u = ab.owner; const w = u.world; const old = spiritOf(u);
    if (old) w.kill(old, null, null, true);
    const sp = summon(ab, SPIRIT, { x: u.x, y: u.y, ai: 'idle' });
    if (u.talents.size) sp.setTalents([...u.talents]); // talent values of the spirit's own abilities
    sp.addModifier(SPIRIT_MOD, { caster: u, ability: ab, data: { phase: 'out', tx: x, ty: y, end: w.time + ab.v('spirit_duration'), hit: new Set(), heroes: 0, creeps: 0 } });
    ab.data = sp;
  },
  fid: 'approx', note: 'the spirit is a real, untargetable unit moved in 0.1 s steps; it damages each enemy it touches once, counts heroes (hero-like units; illusions count as creeps) and creeps, and grants the buff when it is back; it returns when spirit_duration (counted from the cast) ends or on Return Spirit; AI sends it onto its target',
});
defAbility('elder_titan_return_spirit', {
  prio: 30,
  ai(ab, u) {
    if (!u.isHero) return null;
    const sp = spiritOf(u); const m = sp ? sp.findModifier(SPIRIT_MOD) : null;
    if (!m || m.data.phase !== 'stay') return null;
    const es = u.findAbility('elder_titan_echo_stomp');
    return !es || es.level < 1 || es.cdRemaining() > 3 ? here(u) : null;
  },
  cast(ab) {
    const u = ab.owner; const sp = u.isHero ? spiritOf(u) : u; const m = sp ? sp.findModifier(SPIRIT_MOD) : null;
    if (m) m.data.phase = 'back';
  },
  fid: 'full', note: 'AI calls the spirit back once Echo Stomp is on cooldown for more than 3 s (to collect the buff)',
});
defAbility('elder_titan_move_spirit', {
  manual: true,
  cast(ab, t, x, y) { const sp = spiritOf(ab.owner); const m = sp ? sp.findModifier(SPIRIT_MOD) : null; if (m && m.data.phase !== 'back') { m.data.tx = x; m.data.ty = y; m.data.phase = 'move'; } },
  fid: 'full', note: 'manual only: the default AI places the spirit once at cast and never repositions it; the spirit then walks at its own movement speed',
});

// Natural Order: "base" = starting armor + armor from agility; innate magic resistance + the part from intelligence
const NO_ARMOR = 'modifier_elder_titan_natural_order_armor'; const NO_MAGIC = 'modifier_elder_titan_natural_order_magic_resistance';
modifier(NO_ARMOR, {
  debuff: true, purge: 'none', statusResist: false,
  late(m, s, u) { const base = (u.ovr && u.ovr.armor !== undefined ? u.ovr.armor : u.def.armor) + C.ARMOR_PER_AGI * u.agi; if (base > 0) s.armor -= base * m.v('armor_reduction_pct') / 100; },
});
modifier(NO_MAGIC, {
  debuff: true, purge: 'none', statusResist: false,
  late(m, s, u) {
    const base = (u.ovr && u.ovr.mr !== undefined ? u.ovr.mr : u.def.mr) / 100 + (u.isHero ? C.MR_PER_INT * u.int : 0);
    if (base > 0 && base < 1) s.mrMul *= (1 - base * (1 - m.v('magic_resistance_pct') / 100)) / (1 - base);
  },
});
modifier('modifier_elder_titan_natural_order', {
  hidden: true, breakable: false, interval: 0.5, thinkNow: true, // "Break disables the armor reduction aura": only that half
  onThink(m) {
    const u = m.parent; const sp = spiritOf(u); const broken = u.st[ST.BREAK] > 0;
    for (const e of u.world.enemiesInRadius(u, u.x, u.y, m.v('radius'))) {
      if (e.isBuilding) continue;
      if (!broken) e.addModifier(NO_ARMOR, { caster: u, ability: m.ability, duration: 1 });
      if (!sp) e.addModifier(NO_MAGIC, { caster: u, ability: m.ability, duration: 1 });
    }
  },
});
defAbility('elder_titan_natural_order', { mods: ['modifier_elder_titan_natural_order'], fid: 'full', note: 'base armor = starting armor + armor from agility; base magic resistance = innate value + the part from intelligence; aura refreshed every 0.5 s; Break stops the armor half only (tooltip note)' });
modifier('modifier_elder_titan_natural_order_spirit', {
  hidden: true, interval: 0.5, thinkNow: true,
  onThink(m) {
    const sp = m.parent; const u = sp.owner; const ab = u && u.alive ? u.findAbility('elder_titan_natural_order') : null;
    if (!ab || ab.level < 1) return;
    for (const e of sp.world.enemiesInRadius(u, sp.x, sp.y, ab.v('radius'))) if (!e.isBuilding) e.addModifier(NO_MAGIC, { caster: u, ability: ab, duration: 1 });
  },
});
defAbility('elder_titan_natural_order_spirit', { mods: ['modifier_elder_titan_natural_order_spirit'], fid: 'full', note: 'magic resistance half of Natural Order, centred on the spirit; uses the hero ability\'s level and values' });
passive('elder_titan_momentum', {
  dynamic: true,
  apply(m, s, u) {
    const bonus = u.ms - (u.ovr && u.ovr.ms !== undefined ? u.ovr.ms : u.def.ms);
    if (bonus <= 0) return;
    s.armor += bonus * m.v('armor_from_movespeed') / 100; s.as += bonus * m.v('attack_speed_from_movespeed') / 100;
  },
  fid: 'approx', note: 'uses the movement speed of the previous tick',
});
debuff('modifier_elder_titan_earth_splitter', { pierce: true, stats: (m) => ({ msPct: -m.v('slow_pct') }) });
defAbility('elder_titan_earth_splitter', {
  prio: 78,
  ai: (ab, u, t) => (t && t.heroLike && t.hp / t.maxHp > 0.25 ? { x: t.x, y: t.y } : null),
  cast(ab, t, x, y) {
    const u = ab.owner; const w = u.world; const ox = u.x; const oy = u.y;
    const dx = x - ox; const dy = y - oy; const d = Math.hypot(dx, dy) || 1; const len = ab.v('crack_distance');
    w.after(ab.v('crack_time'), () => {
      if (w.skillshotHit < 1 && !w.rng.chance(w.skillshotHit)) return;
      for (const e of enemiesInLine(ab, ox, oy, ox + dx / d * len, oy + dy / d * len, ab.v('crack_width'))) {
        if (e.isBuilding) continue;
        const half = e.maxHp * ab.v('damage_pct') / 100 / 2;
        hit(ab, e, half, MAGICAL); if (e.alive) hit(ab, e, half, PHYSICAL);
        if (e.alive) addMod(ab, e, 'modifier_elder_titan_earth_splitter', ab.v('slow_duration'), { pierce: true });
      }
    });
  },
  fid: 'full', note: 'the crack runs from the caster through the aimed point; enemies standing in it when it implodes (crack_time) are hit',
});

// ================================================================ Lycan
const WOLF = 'npc_dota_lycan_wolf1';
const WOLF_MOD = 'modifier_lycan_summon_wolves_wolf';
const SHIFT = 'modifier_lycan_shapeshift';
const isWolf = (x) => /^npc_dota_lycan_wolf\d$/.test(x.name);
const wolvesOf = (u) => u.world.units.filter((x) => x.alive && x.owner === u && isWolf(x));

// Pack Hunter (Lycan, his wolves and a Wolf Bite target): one mark per attacker on each enemy
const MARK = 'modifier_lycan_pack_hunter_mark';
debuff(MARK, { multi: 'perCaster' });
const packAbility = (lycan, rec) => { const ph = lycan.findAbility('lycan_pack_hunter'); return ph && ph.level > 0 && lycan.st[ST.BREAK] === 0 && !rec.secondary && !rec.target.isBuilding ? ph : null; };
// [L] measured in Hero Demo: the bonus is a damage instance of its own (physical), bonus_damage% of the attacker's average
// attack damage (whole number) per mark on the target, counting the mark this very attack leaves (first hit: 1 mark); one mark
// per attacker. With Feral Impulse the instance is raised once more by Feral Impulse's percentage (16.24 = 5% x 232 x 1.4 at
// Feral Impulse 4; one recorded point). The game deals it just before the attack's own damage: it is sent from the attacker's
// outgoing hook of that attack (after the miss check, before mitigation).
function packHit(lycan, d) {
  const rec = d.rec;
  if (!(d.flags & F_ATTACK) || (d.flags & F_SECONDARY) || !rec || rec.target !== d.dst || (rec.data && rec.data.pack)) return;
  const ph = packAbility(lycan, rec); if (!ph) return;
  const a = rec.attacker; const t = rec.target; const w = a.world;
  if (!t.alive) return;
  t.addModifier(MARK, { caster: a, ability: ph, duration: ph.v('mark_duration') });
  let n = 0; const ms = t.mods;
  for (let i = 0; i < ms.length; i++) if (ms[i].name === MARK && ms[i].ability === ph) n++;
  if (a.dirty) a.recompute();
  const fi = lycan.findAbility('lycan_feral_impulse');
  const fk = a === lycan && fi && fi.level > 0 && lycan.st[ST.BREAK] === 0 ? 1 + fi.v('bonus_damage') / 100 : 1; // [L] Lycan's own attacks only (wolves: no factor)
  const avg = Math.floor((a.dmgMin + a.dmgMax) / 2 + a.dmgBonus + 1e-6);
  (rec.data ||= {}).pack = { n, dealt: 0 };
  rec.data.pack.dealt = w.damage(a, t, avg * ph.v('bonus_damage') / 100 * n * fk, PHYSICAL, F_NO_AMP | F_NO_LIFESTEAL, ph);
}
function packLanded(lycan, rec) {
  const p = rec.data && rec.data.pack; if (!p) return;
  const ph = packAbility(lycan, rec); if (!ph) return;
  const heal = (rec.dealt + p.dealt) * ph.v('lifesteal') * p.n / 100 * (rec.target.heroLike ? 1 : 0.6);
  if (heal > 0) rec.attacker.heal(heal, rec.attacker, ph, true);
}
passive('lycan_pack_hunter', {
  outgoing(m, d) { packHit(m.parent, d); }, onAttackLanded(m, rec) { packLanded(m.parent, rec); },
  fid: 'approx', note: 'bonus damage instance per mark as measured live (the Feral Impulse factor rests on one recorded point; whether armor reduces the instance is not measured); the heal is lifesteal% per mark of the damage dealt (x0.6 against non-heroes, the engine\'s lifesteal rule; not compared live); the reveal of marked units is not modelled',
});
passive('lycan_feral_impulse', { fid: 'approx', stats: { dmgBasePct: 'bonus_damage', hpRegen: 'bonus_hp_regen' }, note: 'bonus damage is a percentage of base attack damage; it also raises Pack Hunter\'s instance (see there); wolves get the regeneration only: in the live game they hit without the damage bonus' });

modifier(WOLF_MOD, {
  hidden: true, purge: 'none',
  // [L] measured in Hero Demo: wolves hit for their own damage with Feral Impulse 4 learned (no damage bonus); the regeneration
  // half is kept as the tooltip says (not measured)
  stats: (m) => { const l = m.caster; const fi = l.findAbility('lycan_feral_impulse'); return fi && fi.level > 0 && l.alive && l.st[ST.BREAK] === 0 ? { hpRegen: fi.v('bonus_hp_regen') } : {}; },
  outgoing(m, d) { packHit(m.caster, d); }, onAttackLanded(m, rec) { packLanded(m.caster, rec); },
});
defAbility('lycan_summon_wolves', {
  prio: 80, engage: false,
  ai: (ab, u, t) => (t && wolvesOf(u).length === 0 ? here(u) : null),
  cast(ab) {
    const u = ab.owner; const w = u.world;
    for (const x of wolvesOf(u)) w.kill(x, null, null, true); // "will replace currently active summoned Wolves"
    const idx = ab.v('wolf_index'); const name = w.unitDef('npc_dota_lycan_wolf' + idx) ? 'npc_dota_lycan_wolf' + idx : WOLF; const lv = w.unitDef(name);
    // [L] measured in Hero Demo: a wolf hits for its own unit damage (wolf 4: 39-41) plus bonus_damage; wolf_damage is not used
    const n = ab.v('wolf_count'); const bd = ab.v('bonus_damage'); const sh = u.findModifier(SHIFT);
    for (let i = 0; i < n; i++) {
      const wf = summon(ab, name, { x: u.x + 70 * (i - (n - 1) / 2), y: u.y + 90, level: idx, duration: ab.v('wolf_duration'), ai: 'fight',
        ovr: { hp: ab.v('wolf_hp'), dmgMin: lv.dmgMin + bd, dmgMax: lv.dmgMax + bd, bat: ab.v('wolf_bat'), armor: lv.armor + ab.v('bonus_armor') } });
      if (u.talents.size) wf.setTalents([...u.talents]);
      const ht = wf.findAbility('lycan_summon_wolves_hightail'); if (ht) ht.setLevel(ab.v('give_wolves_hightail') > 0 ? 1 : 0);
      wf.addModifier(WOLF_MOD, { caster: u, ability: ab });
      if (sh) wf.addModifier(SHIFT + '_pack', { caster: u, ability: sh.ability, duration: sh.remaining() });
      wf.refreshAI();
    }
  },
  fid: 'approx', note: 'the wolf unit of the ability level (wolf_index) with its own damage + bonus_damage (live game; wolf_damage is unused there), health wolf_hp and BAT wolf_bat; wolves fight on their own; bash_chance / bonus_levels have no tooltip and are unused; AI resummons when no wolf is left',
});
buff('modifier_lycan_summon_wolves_hightail', { purge: 'none', stats: (m) => ({ evasion: m.v('evasion'), msAbs: m.v('min_movespeed'), as: m.v('bonus_attack_speed') }) });
defAbility('lycan_summon_wolves_hightail', {
  prio: 50,
  ai: (ab, u, t) => (t && !u.hasModifier('modifier_lycan_summon_wolves_hightail') && (u.world.time - u.lastHurt < 1 || u.rangeTo(t) > u.attackRange + 250) ? here(u) : null),
  cast(ab) { addMod(ab, ab.owner, 'modifier_lycan_summon_wolves_hightail', ab.v('duration')); },
  fid: 'full', note: 'own AI: used when hurt by a hero or when the target is out of reach; phased movement has no effect in the sandbox',
});
const WOLF_FADE = 'modifier_lycan_summon_wolves_invisibility_fade';
modifier(WOLF_FADE, { hidden: true, purge: 'none', state: ['INVIS'] });
passive('lycan_summon_wolves_invisibility', {
  interval: 0.25,
  onCreated(m) { m.x = m.parent.world.time; },
  onAttack(m) { m.x = m.parent.world.time; m.parent.removeModifierByName(WOLF_FADE); },
  onThink(m) { const u = m.parent; if (u.world.time - m.x >= m.v('fade_delay') && !u.hasModifier(WOLF_FADE)) u.addModifier(WOLF_FADE, { ability: m.ability }); },
  fid: 'full', note: 'only matters when rules.detectAll is off',
});
// [L] measured in Hero Demo: every proc is an independent instance (slows add up, each ticks maim_damage once per second)
dot('modifier_lycan_summon_wolves_critical_strike_debuff', { damage: 'maim_damage', type: MAGICAL, interval: 1, multi: 'independent', stats: (m) => ({ asSlow: -m.v('maim_attack_speed'), msPct: -m.v('maim_movement_speed') }) });
passive('lycan_summon_wolves_critical_strike', {
  onAttackLanded(m, rec) {
    const t = rec.target;
    if (t.alive && !t.isBuilding && m.roll(m.v('maim_chance'))) t.addModifier('modifier_lycan_summon_wolves_critical_strike_debuff', { caster: m.parent, ability: m.ability, duration: m.v('maim_duration') + 0.01 });
  },
  fid: 'approx', note: 'Cripple: the damage over time is magical (no type in the data); the movement slow comes from the tooltip value line, the description sentence does not mention it',
});
const HAMSTRING = 'modifier_lycan_summon_wolves_hamstring_debuff';
modifier(HAMSTRING, {
  debuff: true, pierce: true,
  onAttacked(m, rec) {
    const a = rec.attacker; const l = m.caster.owner || m.caster;
    if (rec.secondary || (a !== l && a.owner !== l)) return;
    if (m.data && m.data.skip === rec) { m.data.skip = null; return; } // the bite itself is not one of the boosted attacks
    a.world.damage(a, m.parent, m.v('damage_boost'), PHYSICAL, F_NO_AMP, m.ability);
    if (m.removed) return;
    if (m.stacks <= 1) m.remove(); else m.setStacks(m.stacks - 1);
  },
});
passive('lycan_summon_wolves_hamstring', {
  onAttack(m, rec) { if (!rec.secondary && !rec.target.isBuilding && m.ability.cdReady()) (rec.data ||= {}).hamstring = m; },
  onAttackLanded(m, rec) {
    if (!(rec.data && rec.data.hamstring === m)) return;
    const t = rec.target; const u = m.parent;
    m.ability.startCooldown();
    if (!t.alive) return;
    t.addModifier('modifier_rooted', { caster: u, ability: m.ability, duration: m.v('root_duration'), pierce: true });
    t.removeModifierByName(HAMSTRING);
    t.addModifier(HAMSTRING, { caster: u, ability: m.ability, duration: m.v('damage_boost_duration'), stacks: m.v('damage_boost_stacks'), data: { skip: rec } });
  },
  fid: 'approx', note: 'autocast assumed on; the bonus is a separate physical damage instance on each of the next attacks of Lycan or his units; carried only by wolves of level 5-6, which Summon Wolves (max level 4) does not create',
});
const HOWL = 'modifier_lycan_howl';
debuff(HOWL, { stats: (m) => (m.v('total_attack_damage_reduction') > 0 ? { armor: -m.v('armor'), dmgOutPct: -m.v('attack_damage_reduction') } : { armor: -m.v('armor'), dmgBasePct: -m.v('attack_damage_reduction') }) });
function howlTargets(ab) {
  const u = ab.owner; const w = u.world;
  const es = w.units.filter((e) => e.alive && e.team !== u.team && !e.isBuilding && e.st[ST.OUT] === 0);
  if (isNight(w)) return es; // "At night, Howl's armor and attack damage reductions are global"
  const r = ab.v('radius'); const srcs = [u, ...wolvesOf(u)];
  return es.filter((e) => srcs.some((s) => gap(s, e) <= r));
}
defAbility('lycan_howl', {
  prio: 65, engage: false,
  ai: (ab, u, t) => (t && !t.hasModifier(HOWL) && howlTargets(ab).includes(t) ? here(u) : null),
  cast(ab) { for (const e of howlTargets(ab)) if (!immune(ab, e)) addMod(ab, e, HOWL, ab.v('howl_duration')); },
  fid: 'full', note: 'reduces base attack damage (total attack damage with the talent)',
});
const shiftCrit = critHook('crit_chance', 'crit_multiplier');
buff(SHIFT, { purge: 'none', stats: (m) => ({ msAbs: m.v('speed'), hp: m.v('health_bonus') }), onAttack: shiftCrit });
// [L] measured in Hero Demo: Lycan is stunned for transformation_time; Shapeshift (full duration) and the pack's speed start after it
modifier(SHIFT + '_transform', {
  purge: 'none', state: ['STUN'],
  late(m, s, u) { if (!m.data || m.data.bite === undefined) return; const over = (u.ovr && u.ovr.range !== undefined ? u.ovr.range : u.def.range) + s.attackRange - m.data.bite; if (over > 0) s.attackRange -= over; },
  onDestroy(m) {
    const u = m.parent; const ab = m.ability; if (!u.alive || !ab) return; const d = ab.v('duration');
    if (m.data && m.data.bite !== undefined) { u.addModifier(BITE, { caster: m.caster, ability: ab, duration: d, data: { cap: m.data.bite } }); return; } // Wolf Bite
    addMod(ab, u, SHIFT, d); for (const x of wolvesOf(u)) addMod(ab, x, SHIFT + '_pack', d);
  },
});
buff(SHIFT + '_pack', { purge: 'none', stats: (m) => ({ msAbs: m.v('speed') }), onAttack: shiftCrit });
defAbility('lycan_shapeshift', {
  prio: 90, engage: false,
  ai: (ab, u, t) => (t && u.distTo(t) < 1000 && !u.hasModifier(SHIFT) && !u.hasModifier(SHIFT + '_transform') ? here(u) : null),
  cast(ab) { addMod(ab, ab.owner, SHIFT + '_transform', ab.v('transformation_time')); },
  fid: 'approx', note: 'Lycan is stunned for transformation_time, then Shapeshift runs its full duration (live game); speed is forced to the Shapeshift value (cannot be slowed; a Hex still caps it in this engine); night vision has no effect in the sandbox',
});
const BITE = 'modifier_lycan_wolf_bite';
buff(BITE, {
  purge: 'none', stats: (m) => ({ msAbs: m.v('speed'), hp: m.v('health_bonus') }),
  // "Max attack range is capped at %attack_range%"
  late(m, s, u) { const over = (u.ovr && u.ovr.range !== undefined ? u.ovr.range : u.def.range) + s.attackRange - m.data.cap; if (over > 0) s.attackRange -= over; },
  onCreated(m) { const u = m.parent; m.z = u.melee ? 0 : 1; u.melee = true; u.dirty = true; },
  onDestroy(m) { const u = m.parent; if (m.z === 1) u.melee = false; u.dirty = true; },
  onAttack(m, rec) { shiftCrit(m, rec); },
  outgoing(m, d) { packHit(m.caster, d); }, onAttackLanded(m, rec) { packLanded(m.caster, rec); },
});
defAbility('lycan_wolf_bite', {
  prio: 72,
  ai(ab, u, t) {
    const ss = u.findAbility('lycan_shapeshift');
    if (!t || !ss || ss.level < 1) return null;
    for (const a of u.world.inRadius(u.x, u.y, ab.castRange() + 300, u.team, false)) if (a !== u && realHero(a) && a.melee && !a.hasModifier(BITE)) return { target: a };
    return null;
  },
  cast(ab, t) {
    const u = ab.owner; const w = u.world; const ss = u.findAbility('lycan_shapeshift');
    if (!t || t === u || !ss || ss.level < 1) return;
    // [L] measured in Hero Demo: the bitten ally is stunned for transformation_time like Lycan, then shapeshifted
    t.addModifier(SHIFT + '_transform', { caster: u, ability: ss, duration: ss.v('transformation_time'), data: { bite: ab.v('attack_range') } });
  },
  fid: 'approx', note: 'the bitten ally gets Shapeshift\'s speed, critical strike and health bonus at Shapeshift\'s current level, attacks as melee with range capped at attack_range and counts for Pack Hunter; AI bites melee allied heroes only',
});

// ================================================================ Outworld Destroyer
const FLUX = 'modifier_obsidian_destroyer_equilibrium';
function essenceFlux(u, fromAttack) {
  const m = u.findModifier(FLUX);
  if (m && m.active() && m.roll(m.v('proc_chance'))) u.giveMana(u.maxMana * m.v(fromAttack ? 'mana_restore_attack' : 'mana_restore') / 100);
}
passive('obsidian_destroyer_equilibrium', {
  interval: 0.25, stats: (m) => ({ ms: m.x }),
  onThink(m) { const k = m.v('mana_as_ms'); const v = k > 0 ? Math.round(m.parent.mana * k / 100) : 0; if (v !== m.x) { m.x = v; m.parent.dirty = true; } },
  onCast(m, ev) { if (!ev.ability.isItem) essenceFlux(m.parent, false); },
  fid: 'approx', note: 'the chance uses the pseudo-random distribution; the movement-speed talent follows current mana in 0.25 s steps',
});
passive('obsidian_destroyer_arcane_orb', {
  onAttack(m, rec) {
    const u = m.parent; const ab = m.ability;
    if (rec.secondary || rec.target.isBuilding || !ab.cdReady() || u.isSilenced() || u.mana <= 0 || immune(ab, rec.target)) return;
    if (!u.world.freeSpells) u.mana -= u.mana * m.v('mana_cost_percentage') / 100;
    ab.startCooldown();
    (rec.data ||= {}).arcaneOrb = u.mana * m.v('mana_pool_damage_pct') / 100; // "calculated after the mana cost is spent"
    essenceFlux(u, true);
  },
  onAttackLanded(m, rec) { const d = rec.data ? rec.data.arcaneOrb : 0; if (d > 0 && rec.target.alive) m.parent.world.damage(m.parent, rec.target, d, PURE, 0, m.ability); },
  fid: 'full', note: 'autocast assumed on; the Scepter bounce text in the tooltip is stale (no values in the data) and not modelled',
});
const PRISON = 'modifier_obsidian_destroyer_astral_imprisonment_prison';
function astralPop(m) {
  const t = m.parent; const c = m.caster; const ab = m.ability; const w = t.world;
  if (!ab) return;
  const r = ab.v('damage_radius');
  if (r > 0) { for (const e of w.enemiesInRadius(c, t.x, t.y, r)) if (!e.isBuilding) w.damage(c, e, ab.v('damage'), MAGICAL, 0, ab); } else if (t.team !== c.team) w.damage(c, t, ab.v('damage'), MAGICAL, 0, ab);
}
modifier(PRISON, { debuff: true, purge: 'none', state: ['OUT', 'INVULN', 'STUN'], onDestroy(m) { astralPop(m); } }); // [L] Hero Demo reports the prisoner as stunned too
modifier(PRISON + '_ally', { purge: 'none', state: ['INVULN', 'UNTARGETABLE', 'DISARM', 'SILENCE', 'MUTE'], stats: (m) => ({ msPct: m.v('allied_movement_speed_pct') - 100 }), onDestroy(m) { astralPop(m); } });
// max mana changes of the steal must not move current mana ("does not increase ... current mana values")
const holdMana = (u, fn) => { const cur = u.mana; fn(); u.recompute(); u.mana = Math.min(cur, u.maxMana); };
const stolenMana = (sign) => ({ purge: 'none', multi: 'independent', statusResist: false, stats: (m) => ({ mana: sign * m.data.n }), onDestroy(m) { if (m.parent.alive) holdMana(m.parent, () => {}); } });
modifier('modifier_obsidian_destroyer_astral_imprisonment_mana_loss', { debuff: true, pierce: true, ...stolenMana(-1) });
modifier('modifier_obsidian_destroyer_astral_imprisonment_mana_gain', stolenMana(1));
defAbility('obsidian_destroyer_astral_imprisonment', {
  prio: 68,
  ai(ab, u, t, w) {
    if (!t) return null;
    // an enemy hero other than the one being focused is locked away first
    for (const e of w.units) if (e !== t && e.alive && e.team !== u.team && realHero(e) && e.targetable() && !immune(ab, e) && u.distTo(e) <= ab.castRange() + 100) return { target: e };
    return immune(ab, t) ? null : { target: t };
  },
  cast(ab, t) {
    if (!t) return;
    const u = ab.owner; const enemy = t.team !== u.team;
    if (t.dirty) t.recompute();
    if (u.dirty) u.recompute();
    if (enemy && ab.v('has_mana_steal') > 0 && t.maxMana > 0) {
      const n = t.maxMana * ab.v('mana_capacity_steal') / 100; const dur = ab.v('mana_capacity_duration');
      holdMana(t, () => t.addModifier('modifier_obsidian_destroyer_astral_imprisonment_mana_loss', { caster: u, ability: ab, duration: dur, data: { n } }));
      holdMana(u, () => u.addModifier('modifier_obsidian_destroyer_astral_imprisonment_mana_gain', { caster: u, ability: ab, duration: dur, data: { n } }));
    }
    t.addModifier(!enemy && ab.v('allied_movement_speed_pct') > 0 ? PRISON + '_ally' : PRISON, { caster: u, ability: ab, duration: ab.v('prison_duration') });
  },
  fid: 'approx', note: 'the mana capacity steal applies to any enemy with mana; Shard: area damage around the prisoner and allies that can still move (untargetable, no other actions); AI casts it on enemies only and prefers an enemy hero other than its attack target',
});
const OBJ = 'modifier_obsidian_destroyer_objurgation';
barrier(OBJ + '_barrier', 'all');
barrier(OBJ + '_auto', 'all', { purge: 'none' });
const objurgationAmount = (ab) => ab.v('barrier_flat') + ab.owner.maxMana * ab.v('mana_to_barrier') / 100;
modifier(OBJ, {
  hidden: true, stats: { mana: 'bonus_mana' },
  // Scepter: m.x = time the automatic trigger is available again
  postMit(m, d) {
    const u = m.parent; const w = u.world; const thr = m.v('automatic_trigger_threshold');
    if (thr <= 0 || d.amount <= 0 || (d.flags & F_HP_LOSS) || w.time < m.x) return;
    let left = d.amount;
    for (const n of [OBJ + '_barrier', OBJ + '_auto']) { const b = u.findModifier(n); if (b) left -= b.data.left; }
    if (left <= 0 || u.hp - left >= u.maxHp * thr / 100) return;
    d.amount = 0; m.x = w.time + m.v('automatic_trigger_cd');
    u.purge({ debuffs: true, strong: true });
    u.removeModifierByName(OBJ + '_auto');
    u.addModifier(OBJ + '_auto', { caster: u, ability: m.ability, duration: m.v('barrier_duration'), data: { left: objurgationAmount(m.ability) } });
  },
});
defAbility('obsidian_destroyer_objurgation', {
  mods: [OBJ], prio: 45,
  ai: (ab, u, t) => (t && u.world.time - u.lastHurt < 1.5 && !u.hasModifier(OBJ + '_barrier') ? here(u) : null),
  cast(ab) { const u = ab.owner; u.removeModifierByName(OBJ + '_barrier'); giveBarrier(ab, u, OBJ + '_barrier', objurgationAmount(ab), ab.v('barrier_duration')); },
  fid: 'full', note: 'AI casts it when a hero has just damaged Outworld Destroyer',
});
defAbility('obsidian_destroyer_sanity_eclipse', {
  prio: 88,
  ai(ab, u, t) {
    if (!t || !realHero(t)) return null;
    const dmg = (ab.v('base_damage') + ab.v('damage_multiplier') * Math.max(0, u.maxMana - t.maxMana)) * (1 + u.spellAmp / 100) * (1 - t.mr);
    return dmg >= t.hp || t.hp / t.maxHp < 0.6 ? { x: t.x, y: t.y } : null;
  },
  cast(ab, t, x, y) {
    const u = ab.owner; const r = ab.v('radius');
    for (const e of u.world.units) {
      if (!e.alive || e.team === u.team || e.isBuilding || Math.hypot(e.x - x, e.y - y) > r) continue;
      const pm = e.findModifier(PRISON);
      if (!pm && e.st[ST.OUT] > 0) continue;
      const dmg = ab.v('base_damage') + ab.v('damage_multiplier') * Math.max(0, u.maxMana - e.maxMana);
      if (pm) { e.st[ST.OUT]--; e.st[ST.INVULN]--; } // "can hit units trapped by Astral Imprisonment"
      hit(ab, e, dmg, MAGICAL);
      if (pm && !pm.removed) { e.st[ST.OUT]++; e.st[ST.INVULN]++; }
    }
  },
  fid: 'full', note: 'AI casts it on a hero when it would kill or the target is below 60% health',
});

// ================================================================ Timbersaw (the sandbox has no trees)
const WHIRL = 'modifier_shredder_whirling_death_debuff';
debuff(WHIRL, { stats: (m) => m.data || {} });
defAbility('shredder_whirling_death', {
  prio: 60,
  ai: (ab, u, t) => (t && u.distTo(t) <= ab.v('whirling_radius') - 25 ? here(u) : null),
  cast(ab) {
    const u = ab.owner;
    for (const e of enemiesNear(ab, u.x, u.y, ab.v('whirling_radius'))) {
      if (e.isBuilding) continue;
      hit(ab, e, ab.v('whirling_damage'), PURE);
      if (!e.alive || !e.isHero || immune(ab, e)) continue;
      // the loss is taken from the attribute value without an earlier Whirling Death
      e.removeModifierByName(WHIRL); e.recompute();
      const uni = e.attr !== 'str' && e.attr !== 'agi' && e.attr !== 'int';
      const pct = (uni ? ab.v('stat_loss_univ') : ab.v('stat_loss_pct')) / 100; const loss = {};
      for (const k of uni ? ['str', 'agi', 'int'] : [e.attr]) loss[k] = -e[k] * pct;
      addMod(ab, e, WHIRL, ab.v('duration'), { data: loss });
    }
  },
  fid: 'approx', note: 'no trees in the sandbox, so the per-tree bonus damage never applies; a new cast replaces the earlier attribute loss instead of stacking',
});
defAbility('shredder_timber_chain', {
  prio: 66,
  ai(ab, u, t) {
    if (!t || u.isRooted()) return null;
    const d = u.distTo(t);
    if (d < 1 || d > ab.castRange() + 250) return null;
    const k = (d + 150) / d; // aims 150 units behind the target, so the flight passes through it
    return { x: u.x + (t.x - u.x) * k, y: u.y + (t.y - u.y) * k };
  },
  cast(ab, t, x, y) {
    const u = ab.owner; const w = u.world; const ox = u.x; const oy = u.y;
    let dx = x - ox; let dy = y - oy; let d = Math.hypot(dx, dy);
    if (d < 1 || u.isRooted()) return;
    const reach = ab.castRange(); if (d > reach) { dx *= reach / d; dy *= reach / d; d = reach; }
    w.after(d / ab.v('speed'), () => {
      if (!u.alive) return;
      u.x = ox + dx; u.y = oy + dy;
      for (const e of enemiesInLine(ab, ox, oy, u.x, u.y, 2 * ab.v('radius'))) if (!e.isBuilding) hit(ab, e, ab.v('damage'), PURE);
    });
  },
  fid: 'approx', note: 'no trees in the sandbox: a tree is assumed at the aimed point; Timbersaw arrives there after distance / speed and damages every enemy within radius of his path; AI aims 150 units behind its target',
});
// Reactive Armor: m.data = [{ t: expiry, n: stacks }], m.stacks = total
const REACT = 'modifier_shredder_reactive_armor';
function reactiveTrim(m) {
  const now = m.parent.world.time; const max = m.v('stack_limit');
  const d = m.data.filter((s) => s.t > now);
  let total = 0; for (const s of d) total += s.n;
  while (total > max && d.length) { const over = total - max; if (d[0].n <= over) { total -= d[0].n; d.shift(); } else { d[0].n -= over; total = max; } }
  m.data = d; m.setStacks(total);
}
modifier(REACT, {
  hidden: true, breakable: false, interval: 0.25, // "Break does not disable the bonuses from existing stacks"
  onCreated(m) { m.data = []; },
  stats: (m) => ({ armor: m.v('bonus_armor') * m.stacks, hpRegen: m.v('bonus_hp_regen') * m.stacks }),
  onPreAttacked(m, rec) {
    const u = m.parent; const a = rec.attacker;
    if (rec.secondary || a.team === u.team || u.st[ST.BREAK] > 0) return; // "Break disables the gaining of new stacks"
    m.data.push({ t: u.world.time + m.v('stack_duration'), n: a.isHero ? m.v('stacks_per_hero_attack') : 1 });
    reactiveTrim(m);
  },
  onThink(m) { reactiveTrim(m); },
});
modifier(REACT + '_bomb', {
  purge: 'none', interval: 1,
  onThink(m) {
    const u = m.parent; let n = 0;
    for (const e of u.world.enemiesInRadius(u, u.x, u.y, m.v('radius'))) if (e.isHero) n++;
    m.data.left = Math.min(m.v('max_shield'), m.data.left + m.v('shield_per_sec') + m.v('shield_per_sec_per_enemy') * n);
  },
  postMit(m, d) { if (d.amount <= 0 || (d.flags & F_HP_LOSS)) return; const a = Math.min(d.amount, m.data.left); d.amount -= a; m.data.left -= a; },
  onDestroy(m, expired) {
    const u = m.parent;
    if (!expired || !u.alive) return;
    const dmg = m.v('base_explosion') + m.data.left;
    for (const e of u.world.enemiesInRadius(u, u.x, u.y, m.v('explosion_radius'))) if (e.isHero) mhit(m, e, dmg, MAGICAL);
  },
});
defAbility('shredder_reactive_armor', {
  mods: [REACT], prio: 76,
  requires: tune((ab) => setActive(ab, ab.owner.hasScepter && ab.v('AbilityCooldown') > 0)),
  ai: (ab, u, t) => (t && t.isHero && !u.hasModifier(REACT + '_bomb') && u.distTo(t) <= ab.v('radius') ? here(u) : null),
  cast(ab) {
    const u = ab.owner; const m = u.findModifier(REACT);
    if (m) { m.data = [{ t: u.world.time + ab.v('stack_duration'), n: ab.v('stack_limit') }]; reactiveTrim(m); }
    u.removeModifierByName(REACT + '_bomb');
    u.addModifier(REACT + '_bomb', { caster: u, ability: ab, duration: ab.v('duration'), data: { left: ab.v('initial_shield') } });
  },
  fid: 'full', note: 'every attack that reaches Timbersaw adds stacks, each with its own timer; Scepter: the barrier grows once per second and the explosion hits enemy heroes',
});
const FLAME = 'modifier_shredder_flamethrower';
debuff(FLAME + '_debuff', {
  interval: 0.5, stats: (m) => ({ msPct: -m.v('move_slow_pct') }),
  onThink(m) { const t = m.parent; mhit(m, t, m.v('damage_per_second') * 0.5 * (t.isBuilding ? m.v('building_dmg_pct') / 100 : 1), MAGICAL); },
});
buff(FLAME, {
  purge: 'none', interval: 0.2, thinkNow: true,
  onThink(m) {
    const u = m.parent; const t = aiTarget(u) || u.world.nearestEnemy(u, m.v('length') + 300);
    if (!t) return;
    for (const e of lineFromCaster(m.ability, t.x, t.y, m.v('length'), m.v('width'))) e.addModifier(FLAME + '_debuff', { caster: u, ability: m.ability, duration: m.v('debuff_linger_duration') });
  },
});
defAbility('shredder_flamethrower', {
  prio: 56,
  ai: (ab, u, t) => (t && !u.hasModifier(FLAME) && u.distTo(t) <= ab.v('length') - 50 ? here(u) : null),
  cast(ab) { addMod(ab, ab.owner, FLAME, ab.v('duration')); },
  fid: 'approx', note: 'no facing in the sandbox: the flame points at Timbersaw\'s current target; the area is checked every 0.2 s and the burn ticks every 0.5 s',
});
// Chakram: m.data = { x, y, phase: 'fly' | 'spin' | 'back' }, m.z = last time an enemy stood in the blade (AI)
const CHAKRAM = 'modifier_shredder_chakram';
debuff(CHAKRAM + '_debuff', {
  statusResist: false, onRefresh(m) { m.parent.dirty = true; },
  stats: (m) => { const u = m.parent; return { msPct: -m.v('slow') * Math.floor(Math.max(0, 1 - u.hp / u.maxHp) * 100 / m.v('slow_health_percentage')) }; },
});
function chakramPass(ab, x1, y1, x2, y2) {
  const u = ab.owner; const w = u.world; const len = Math.hypot(x2 - x1, y2 - y1);
  if (len < 1) return;
  for (const e of enemiesInLine(ab, x1, y1, x2, y2, 2 * (ab.v('radius')))) {
    if (e.isBuilding) continue;
    const k = Math.max(0, Math.min(1, ((e.x - x1) * (x2 - x1) + (e.y - y1) * (y2 - y1)) / (len * len)));
    w.after(k * len / ab.v('speed'), () => {
      if (!e.alive) return;
      hit(ab, e, ab.v('pass_damage'), PURE);
      if (e.alive && !immune(ab, e)) e.addModifier(CHAKRAM + '_debuff', { caster: u, ability: ab, duration: ab.v('pass_slow_duration') });
    });
  }
}
function chakramReturn(m) {
  const u = m.parent; const ab = m.ability; const d = m.data;
  if (d.phase === 'back') return;
  d.phase = 'back';
  chakramPass(ab, d.x, d.y, u.x, u.y);
  u.world.after(Math.hypot(u.x - d.x, u.y - d.y) / ab.v('speed'), () => m.remove());
}
modifier(CHAKRAM, {
  purge: 'none', state: ['DISARM'], interval: (m) => m.v('damage_interval'),
  onThink(m) {
    const u = m.parent; const ab = m.ability; const w = u.world; const d = m.data; const iv = m.v('damage_interval');
    if (d.phase === 'back') return;
    if (!w.freeSpells) { const cost = m.v('mana_per_second') * iv; if (u.mana < cost) { chakramReturn(m); return; } u.mana -= cost; }
    if (Math.hypot(u.x - d.x, u.y - d.y) > m.v('break_distance')) { chakramReturn(m); return; }
    if (d.phase !== 'spin') return;
    for (const e of w.enemiesInRadius(u, d.x, d.y, m.v('radius'))) {
      if (e.isBuilding) continue;
      mhit(m, e, m.v('damage_per_second') * iv, PURE);
      if (e.alive && !immune(ab, e)) e.addModifier(CHAKRAM + '_debuff', { caster: u, ability: ab, duration: iv + 0.1 });
    }
  },
});
defAbility('shredder_chakram', {
  prio: 70,
  ai: (ab, u, t) => (t && !u.hasModifier(CHAKRAM) && u.distTo(t) <= ab.castRange() + 100 ? { x: t.x, y: t.y } : null),
  cast(ab, t, x, y) {
    const u = ab.owner; const w = u.world;
    if (u.hasModifier(CHAKRAM)) return;
    const m = u.addModifier(CHAKRAM, { caster: u, ability: ab, data: { x, y, phase: 'fly' } });
    chakramPass(ab, u.x, u.y, x, y);
    w.after(Math.hypot(x - u.x, y - u.y) / ab.v('speed'), () => { if (!m.removed && m.data.phase === 'fly') { m.data.phase = 'spin'; m.z = w.time; } });
  },
  fid: 'approx', note: 'the flight is a timed straight line: enemies on it when the blade is fired or recalled take the pass damage as it reaches them; the slow per missing health is re-evaluated every damage tick; mana is drained per damage tick; AI throws it onto its target',
});
defAbility('shredder_return_chakram', {
  prio: 69,
  ai(ab, u, t, w) {
    const m = u.findModifier(CHAKRAM); const c = u.findAbility('shredder_chakram');
    if (!m || !c || m.data.phase !== 'spin') return null;
    if (w.inRadius(m.data.x, m.data.y, c.v('radius') + 75, u.team, true).length) m.z = w.time;
    return u.mana / u.maxMana < 0.15 || w.time - m.z > 1 ? here(u) : null;
  },
  cast(ab) { const m = ab.owner.findModifier(CHAKRAM); if (m) chakramReturn(m); },
  fid: 'full', note: 'AI recalls the blade when no enemy has stood in it for 1 s or mana drops below 15%',
});
na('shredder_exposure_therapy', 'triggers on destroyed trees; the sandbox has no trees');

// ================================================================ Void Spirit
const PULL = 'modifier_void_spirit_aether_remnant_pull';
// [L] measured in Hero Demo: the pulled hero is silenced, disarmed and muted (not stunned) and walks pull_destination% of its
// distance to the remnant at a fixed speed over pull_duration (300 away, 62%: 186 units at 116.25 speed)
const PULL_STEP = 1 / 30;
debuff(PULL, {
  state: ['SILENCE', 'DISARM', 'MUTE'], interval: PULL_STEP,
  stats: (m) => (m.data && m.data.spd > 0 ? { msAbs: m.data.spd, msCap: m.data.spd } : null),
  onThink(m) {
    const u = m.parent; const d = m.data; if (!d || !(d.spd > 0)) return;
    if (u.order === 2) u.stop(); // ORDER.MOVE: the pull overrides own movement
    const dx = d.x - u.x; const dy = d.y - u.y; const r = Math.hypot(dx, dy);
    const step = Math.min(r, d.spd * PULL_STEP); if (r > 1e-6) { u.x += dx / r * step; u.y += dy / r * step; }
  },
});
defAbility('void_spirit_aether_remnant', {
  prio: 62,
  ai(ab, u, t) {
    if (!t || t.hasModifier(PULL) || immune(ab, t) || (ab.v('pierces_creeps') > 0 && !t.heroLike)) return null;
    const d = u.distTo(t);
    const back = Math.min(200, d - 50); // the remnant looks away from the caster: land it 200 units in front of the target
    if (back <= 0) return null;
    const k = (d - back) / d;
    return { x: u.x + (t.x - u.x) * k, y: u.y + (t.y - u.y) * k };
  },
  cast(ab, t, x, y) {
    const u = ab.owner; const w = u.world; const far = Math.hypot(x - u.x, y - u.y) || 1;
    // [L] measured in Hero Demo: cast at a point (no vector), the remnant watches away from the caster; a hero standing on the
    // landing point is not caught, one 300 further on is
    const len = ab.v('remnant_watch_distance'); const fx = (x - u.x) / far; const fy = (y - u.y) / far;
    const wide = ab.v('remnant_watch_radius');
    const watched = () => w.units.filter((e) => {
      if (!e.alive || e.team === u.team || e.st[ST.OUT] > 0 || e.isBuilding || immune(ab, e)) return false;
      const along = (e.x - x) * fx + (e.y - y) * fy; const side = Math.abs(-(e.x - x) * fy + (e.y - y) * fx);
      return along > 0 && along <= len && side <= wide + e.def.hull;
    });
    const arrive = far / ab.v('projectile_speed'); const end = w.time + arrive + ab.v('duration');
    const shard = ab.v('pierces_creeps') > 0; let nextBurn = w.time + arrive + ab.v('activation_delay');
    const tick = () => {
      if (w.time >= end) return;
      const es = watched();
      if (shard && w.time >= nextBurn - 1e-9) {
        const rate = ab.v('damage_tick_rate'); nextBurn += rate;
        for (const e of es) if (!e.heroLike) hit(ab, e, ab.v('impact_damage') * ab.v('creep_damage_pct') / 100 * rate, MAGICAL);
      }
      let caught = null;
      for (const e of es) if ((!shard || e.heroLike) && (!caught || Math.hypot(e.x - x, e.y - y) < Math.hypot(caught.x - x, caught.y - y))) caught = e;
      if (caught && caught.alive) {
        const k = ab.v('pull_destination') / 100; const dur = ab.v('pull_duration');
        const dx = (x - caught.x) * k; const dy = (y - caught.y) * k;
        hit(ab, caught, ab.v('impact_damage'), MAGICAL);
        if (caught.alive) addMod(ab, caught, PULL, dur, { data: { x: caught.x + dx, y: caught.y + dy, spd: Math.hypot(dx, dy) / dur } });
        return; // the remnant is spent
      }
      w.after(ab.v('think_interval'), tick);
    };
    w.after(arrive + ab.v('activation_delay'), tick);
  },
  fid: 'partial', note: 'no vector targeting: the remnant watches the strip from its landing point away from the caster (watch distance x watch radius, live); the first unit in it is damaged, silenced, disarmed and muted for pull_duration and walks pull_destination% of the way to the remnant at a fixed speed (live), which spends the remnant; the remnant is not a unit; AI lands it 200 units in front of its target; Shard: creeps in the path take creep_damage_pct of the damage per second instead of triggering it, but the second, rotating path is NOT modelled (the unit of rotation_speed is unknown); its True Sight is not modelled either (it only matters when a scenario turns rules.detectAll off)',
});
const DISS = 'modifier_void_spirit_dissimilate_phase';
modifier(DISS, {
  purge: 'none', state: ['OUT', 'INVULN', 'SILENCE', 'ROOT', 'DISARM', 'MUTE', 'ETHEREAL'], // [L] state list measured in Hero Demo
  onDestroy(m) {
    const u = m.parent; const ab = m.ability; const w = u.world; const d = m.data;
    if (!u.alive || !ab) return;
    const ring = ab.v('first_ring_distance_offset'); const n = ab.v('portals_per_ring'); const step = ab.v('angle_per_ring_portal') * Math.PI / 180;
    const r = ab.v('damage_radius');
    const portals = [[d.x, d.y]];
    for (let i = 0; i < n; i++) portals.push([d.x + Math.cos(d.ang + i * step) * ring, d.y + Math.sin(d.ang + i * step) * ring]);
    // leaves through the portal that catches most enemies (heroes weigh more); ties go to the central one
    let best = portals[0]; let score = -1;
    for (const p of portals) { let c = 0; for (const e of w.inRadius(p[0], p[1], r, u.team, true)) c += e.heroLike ? 3 : 1; if (c > score) { score = c; best = p; } }
    u.x = best[0]; u.y = best[1];
    for (const e of w.inRadius(u.x, u.y, r, u.team, true)) {
      if (e.isBuilding) continue;
      hit(ab, e, ab.v('AbilityDamage'), MAGICAL);
      if (e.alive && ab.v('root_duration') > 0 && !immune(ab, e)) e.addModifier('modifier_rooted', { caster: u, ability: ab, duration: ab.v('root_duration') });
    }
  },
});
defAbility('void_spirit_dissimilate', {
  prio: 64,
  ai(ab, u, t) {
    if (!t || u.isRooted()) return null;
    const d = u.distTo(t); const r = ab.v('damage_radius') - 50;
    return d <= r || Math.abs(d - ab.v('first_ring_distance_offset') - u.aoeBonus) <= r ? here(u) : null;
  },
  cast(ab) {
    const u = ab.owner; const t = aiTarget(u) || u.world.nearestEnemy(u);
    u.addModifier(DISS, { caster: u, ability: ab, duration: ab.v('phase_duration'), data: { x: u.x, y: u.y, ang: t ? Math.atan2(t.y - u.y, t.x - u.x) : 0 } });
  },
  fid: 'partial', note: 'Void Spirit is out of play for phase_duration, then leaves through the central portal or one of the ring portals (the ring is turned so that one portal points at his target) and damages around it; the exit is the portal that catches most enemies; the "Outer Dissimilate Ring" talent is NOT modelled (the outer ring\'s geometry is not in the data)',
});
const PULSE = 'modifier_void_spirit_resonant_pulse';
modifier(PULSE, { hidden: true });
barrier(PULSE + '_barrier', 'physical');
defAbility('void_spirit_resonant_pulse', {
  mods: [PULSE], prio: 60,
  // Scepter charges are stored as max_charges / charge_restore_time; hand them to the engine's charge system
  requires: tune((ab) => { const n = ab.v('max_charges'); if (n > 0) { ab.vals.AbilityCharges = n; ab.vals.AbilityChargeRestoreTime = ab.v('charge_restore_time'); ab.vals.AbilityCooldown = 0.25; /* [L] measured in Hero Demo: 0.25 s between two Scepter charges */ if (ab.level > 0 && ab.charges === 0 && ab.chargeEnd === 0) ab.charges = n; } }),
  ai: (ab, u, t) => (t && !u.hasModifier(PULSE + '_barrier') && u.distTo(t) <= ab.v('radius') - 100 ? here(u) : null),
  cast(ab) {
    const u = ab.owner; const w = u.world; const ox = u.x; const oy = u.y;
    u.removeModifierByName(PULSE + '_barrier');
    const b = giveBarrier(ab, u, PULSE + '_barrier', ab.v('base_absorb_amount'), ab.v('buff_duration'));
    for (const e of enemiesNear(ab, ox, oy, ab.v('radius'))) {
      if (e.isBuilding) continue;
      const d = Math.hypot(e.x - ox, e.y - oy);
      w.after(d / ab.v('speed'), () => {
        if (!e.alive) return;
        hit(ab, e, ab.v('damage'), MAGICAL);
        if (e.alive && ab.v('silence_duration_scepter') > 0 && !immune(ab, e)) silence(ab, e, ab.v('silence_duration_scepter'));
        if (e.isHero) w.after(d / ab.v('return_projectile_speed'), () => { if (b && !b.removed) b.data.left += ab.v('absorb_per_hero_hit'); });
      });
    }
  },
  fid: 'full', note: 'the pulse reaches each enemy after distance / speed; the extra barrier per hero arrives after the return travel time; AI does not recast while a barrier is still up',
});
// Attributes as the engine's attack-damage rule counts them: the level growth is added once per level in single precision.
const F32_GROWTH = new WeakMap();
function attrsF32(u) {
  const bs = u.ovr && u.ovr.attrs ? u.ovr.attrs : u.def; const f = Math.fround; const lv = u.level - 1;
  let t = F32_GROWTH.get(bs); if (!t) F32_GROWTH.set(bs, t = []);
  let g = t[u.level];
  if (!g) { let a = f(bs.str); let b = f(bs.agi); let c = f(bs.int); const ga = f(bs.strGain); const gb = f(bs.agiGain); const gc = f(bs.intGain); for (let i = 1; i < u.level; i++) { a = f(a + ga); b = f(b + gb); c = f(c + gc); } g = t[u.level] = [a, b, c]; }
  return [u.str - (bs.str + bs.strGain * lv) + g[0], u.agi - (bs.agi + bs.agiGain * lv) + g[1], u.int - (bs.int + bs.intGain * lv) + g[2]];
}
passive('void_spirit_intrinsic_edge', {
  late(m, s, u) {
    const k = m.v('secondary_stat_bonus_pct') / 100; const a = u.attr; const up = 1 + m.v('damage_stat_bonus_pct') / 100;
    // [L] measured in Hero Demo at every level: the damage per attribute point is raised before the result is cut to a whole
    // number (universal: floor(0.45 x 1.15 x whole attribute sum)); the engine adds the unraised whole part itself
    const [sF, aF, iF] = attrsF32(u);
    if (a === 'str' || a === 'agi' || a === 'int') { const p = Math.floor(a === 'str' ? sF : a === 'agi' ? aF : iF); s.dmgBase += Math.floor(p * C.DMG_PER_PRIMARY * up + 1e-9) - p * C.DMG_PER_PRIMARY; }
    else { const sum = Math.floor(Math.fround(Math.fround(sF + aF) + iF)); s.dmgBase += Math.floor(C.DMG_PER_ATTR_UNIVERSAL * up * sum + 1e-9) - Math.floor(C.DMG_PER_ATTR_UNIVERSAL * sum + 1e-9); }
    s.hpRegen += C.HP_REGEN_PER_STR * u.str * k; s.as += C.AS_PER_AGI * u.agi * k; s.manaRegen += C.MANA_REGEN_PER_INT * u.int * k;
  },
  fid: 'full', note: 'attack damage: whole part of (damage per attribute point x 1.15 x whole attribute points), as the live game shows at every level',
});
const STEP = 'modifier_void_spirit_astral_step';
modifier(STEP, { hidden: true, onAttack(m, rec) { const c = m.v('crit_damage') / 100; if (rec.fromAbility === m.ability && c > rec.crit) rec.crit = c; } });
debuff(STEP + '_debuff', { pierce: true, purge: 'none', statusResist: false, stats: (m) => ({ msPct: -m.v('movement_slow_pct') }) });
defAbility('void_spirit_astral_step', {
  mods: [STEP], prio: 72,
  ai(ab, u, t) {
    if (!t || u.isRooted()) return null;
    const d = u.distTo(t);
    if (d < 1 || d > ab.v('max_travel_distance') - 100) return null;
    const k = Math.max(ab.v('min_travel_distance'), d + 100) / d; // lands 100 units behind the target
    return { x: u.x + (t.x - u.x) * k, y: u.y + (t.y - u.y) * k };
  },
  cast(ab, t, x, y) {
    const u = ab.owner; const w = u.world; const ox = u.x; const oy = u.y;
    if (u.isRooted()) return;
    let dx = x - ox; let dy = y - oy; let d = Math.hypot(dx, dy);
    if (d < 1) { dx = 1; dy = 0; d = 1; }
    const go = Math.min(ab.v('max_travel_distance'), Math.max(ab.v('min_travel_distance'), d));
    const ex = ox + dx / d * go; const ey = oy + dy / d * go;
    const es = enemiesInLine(ab, ox, oy, ex, ey, 2 * (ab.v('radius')));
    u.x = ex; u.y = ey;
    for (const e of es) {
      if (e.isBuilding || !e.attackableBy(u)) continue;
      const rec = w.launchAttack(u, e, { instant: true, fromAbility: ab, potency: u.itemPotency + ab.v('bonus_potency') });
      if (rec.missed || rec.cancel || !e.alive) continue;
      e.addModifier(STEP + '_debuff', { caster: u, ability: ab, duration: ab.v('pop_damage_delay'), pierce: true });
      w.after(ab.v('pop_damage_delay'), () => { if (e.alive) hit(ab, e, ab.v('pop_damage'), MAGICAL); });
    }
  },
  fid: 'approx', note: 'AI steps through its target and lands 100 units behind it; each mark detonates on its own timer; the tooltip note "Astral Step attacks do not cleave" is not enforced (the engine\'s instant attack has no cleave switch), so a cleave item or buff on Void Spirit also cleaves from these attacks',
});

// ================================================================ Bane
const ICHOR = 'modifier_bane_ichor_of_nyctasha';
// Terrors lower the status resistance of enemy heroes against Bane's debuffs. Stacks on Bane's innate = Terrors every
// enemy hero already carries (unit option  stacks: { bane_ichor_of_nyctasha: N }).
function baneDuration(ab, t, dur) {
  const u = ab.owner; const m = u.findModifier(ICHOR);
  if (!m || m.stacks <= 0 || !t.isHero || t.team === u.team) return dur;
  if (t.dirty) t.recompute();
  const sr = t.statusRes;
  return sr < 1 ? dur * (1 - sr + Math.min(m.stacks, m.v('max_terrors')) * m.v('status_resistance') / 100) / (1 - sr) : dur;
}
passive('bane_ichor_of_nyctasha', { fid: 'approx', note: 'Terrors are gained when enemy heroes die, which ends their part in a sandbox fight; preset them with the unit option stacks: { bane_ichor_of_nyctasha: N } = Terrors already on every enemy hero (lengthens Enfeeble, Nightmare and Fiend\'s Grip through the lowered status resistance)' });
// Cast range reduction: the engine has no percentage cast-range stat, so the cast ranges of the victim's abilities and items are
// scaled down while the debuff lasts. m.data = Map(ability -> [original, reduced]); re-checked at every damage tick because a
// value refresh (level, talent, Scepter change) puts the original number back.
function enfeebleRange(m, on) {
  const t = m.parent; const k = 1 - m.v('cast_reduction') / 100; const d = m.data;
  for (const a of [...t.abilities, ...t.items]) {
    const cur = a.vals.AbilityCastRange; const rec = d.get(a);
    if (rec && cur === rec[1]) { if (!on) { a.vals.AbilityCastRange = rec[0]; d.delete(a); } continue; }
    if (rec) d.delete(a); // refreshed in the meantime: the number is the original one again
    if (on && cur > 0 && k < 1) { const cut = cur * Math.max(0, k); a.vals.AbilityCastRange = cut; d.set(a, [cur, cut]); }
  }
}
debuff('modifier_bane_enfeeble', {
  interval: (m) => m.v('damage_tick_rate'), stats: (m) => ({ dmgOutPct: -m.v('damage_reduction') }),
  late(m, s) { if (s.castRange > 0) s.castRange *= Math.max(0, 1 - m.v('cast_reduction') / 100); }, // flat cast range bonuses shrink too
  // [L] measured in Hero Demo: the first damage tick lands together with the debuff, then one every damage_tick_rate, the
  // last one on the expiry (10 ticks over 9 s)
  onCreated(m) { m.data = new Map(); enfeebleRange(m, true); mhit(m, m.parent, m.v('enfeeble_tick_damage'), PURE); },
  onThink(m) { enfeebleRange(m, true); mhit(m, m.parent, m.v('enfeeble_tick_damage'), PURE); },
  onDestroy(m) { enfeebleRange(m, false); },
});
defAbility('bane_enfeeble', {
  prio: 58, cond: (ab, u, t) => !!t && !t.hasModifier('modifier_bane_enfeeble'),
  cast(ab, t) { addMod(ab, t, 'modifier_bane_enfeeble', baneDuration(ab, t, ab.v('duration')) + 0.01); },
  fid: 'approx', note: 'damage ticks (the first with the debuff, the last on its expiry) and the total attack damage reduction match the live game; the cast range reduction scales the cast range of every ability and item of the victim (and its flat cast range bonuses) while the debuff lasts, re-checked at every damage tick; spells whose scripts take their reach from another value are not shortened',
});
defAbility('bane_brain_sap', {
  prio: 55,
  cast(ab, t) {
    const u = ab.owner; const v = ab.v('brain_sap_damage'); const r = ab.v('shard_radius');
    hit(ab, t, v, PURE); healUnit(ab, u, v);
    if (r > 0) for (const e of enemiesNear(ab, t.x, t.y, r)) { if (e === t || e.isBuilding) continue; hit(ab, e, v, PURE); healUnit(ab, u, v * ab.v('shard_secondary_target_heal_pct') / 100); }
  },
  fid: 'full',
});
const NIGHTMARE = 'modifier_bane_nightmare';
modifier(NIGHTMARE + '_invulnerable', { hidden: true, purge: 'none', state: ['INVULN'] });
debuff(NIGHTMARE, {
  // [L] measured in Hero Demo: the sleeper counts as stunned, rooted and disarmed and walks walk_speed units per second in
  // the direction the cast gave it (m.data = { dx, dy }, unit vector), in steps of one engine tick
  state: ['SLEEP', 'ROOT', 'DISARM'], interval: (m) => m.parent.world.dt,
  onThink(m) {
    const d = m.data; const u = m.parent; const w = u.world;
    // [L] measured in Hero Demo: an attack started on the sleeper (by anyone but Bane) is not delivered; the Nightmare passes
    // to the attacker at that moment, with the full duration again and its own invulnerable time
    for (const a of w.units) if (a !== m.caster && a !== u && a.alive && a.winding && a.attackTarget === u) { nightmarePass(m, a); return; }
    if (!d || !(d.dx || d.dy)) return;
    const s = m.v('walk_speed') * w.dt; u.x += d.dx * s; u.y += d.dy * s;
  },
  onCreated(m) { const t = Math.min(m.v('nightmare_invuln_time'), m.remaining()); if (t > 0) m.parent.addModifier(NIGHTMARE + '_invulnerable', { caster: m.caster, ability: m.ability, duration: t }); },
  onDestroy(m) { m.parent.removeModifierByName(NIGHTMARE + '_invulnerable'); },
  onTakeDamage(m, d) {
    const s = d.src; const u = m.parent;
    if (d.dealt <= 0 || !s || s === m.caster) return; // "Bane can attack and damage Nightmared targets freely"
    // "If the target was directly attacked, the Nightmare passes to the attacking unit" (an attack that landed without a wind-up)
    if ((d.flags & F_ATTACK) && !(d.flags & F_SECONDARY) && s !== u && s.alive) nightmarePass(m, s); else m.remove();
  },
});
function nightmarePass(m, a) {
  const c = m.caster; const ab = m.ability; const data = m.data;
  m.remove();
  a.winding = false;
  if (!ab || !a.alive) return;
  const dur = ab.v('AbilityDuration');
  a.addModifier(NIGHTMARE, { caster: c, ability: ab, duration: a.team === c.team ? dur : baneDuration(ab, a, dur), data });
}
defAbility('bane_nightmare', {
  prio: 84,
  ai(ab, u, t, w) {
    if (!t) return null;
    let best = null;
    for (const e of w.units) {
      if (!e.alive || e.team === u.team || e.isBuilding || !e.targetable() || immune(ab, e) || e.st[ST.SLEEP] > 0 || e.st[ST.STUN] > 0 || u.distTo(e) > ab.castRange() + 150) continue;
      // never on a unit an ally is attacking: the ally would wake it and fall asleep itself
      if (w.units.some((a) => a !== u && a.alive && a.team === u.team && (a.orderTarget === e || aiTarget(a) === e))) continue;
      if (!best || (e.isHero && !best.isHero)) best = e;
    }
    return best ? { target: best } : null;
  },
  cast(ab, t) {
    if (!t) return;
    const u = ab.owner; const dx = t.x - u.x; const dy = t.y - u.y; const d = Math.hypot(dx, dy);
    addMod(ab, t, NIGHTMARE, t.team === u.team ? ab.v('AbilityDuration') : baneDuration(ab, t, ab.v('AbilityDuration')), { data: d > 1 ? { dx: dx / d, dy: dy / d } : { dx: 0, dy: 0 } });
  },
  fid: 'approx', note: 'the sleeper is stunned, rooted and disarmed and walks at walk_speed straight away from Bane (the direction of a plain unit-target cast in the live game; a vector-chosen direction and the alt-cast "stand still" variant are not available in the sandbox); an attack started on the sleeper is cancelled and passes the Nightmare to the attacker with the full duration (live), keeping the walking direction; AI only uses it on an enemy that none of its allies is attacking',
});
defAbility('bane_nightmare_end', {
  manual: true,
  cast(ab) { for (const e of ab.owner.world.units) { const m = e.alive ? e.findModifier(NIGHTMARE) : null; if (m && m.caster === ab.owner) m.remove(); } },
  fid: 'full', note: 'manual only: the default AI never ends a Nightmare early',
});
const GRIP = 'modifier_bane_fiends_grip';
modifier(GRIP + '_cast_illusion', { hidden: true, purge: 'none', interval: 0.1, onThink(m) { const i = m.parent; if (i.cantAct() || i.isSilenced()) i.world.kill(i, null, null, true); } }); // "immediately die if they are interrupted"
function gripTick(m) {
  const t = m.parent; const c = m.caster; const iv = m.v('fiend_grip_tick_interval');
  mhit(m, t, m.v('fiend_grip_damage') * iv, PURE);
  if (t.alive && t.maxMana > 0) { const got = t.burnMana(t.maxMana * m.v('fiend_grip_mana_drain') / 100 * iv); if (c.alive) c.giveMana(got); }
}
debuff(GRIP, {
  pierce: true, state: ['STUN'], purge: 'strong', interval: (m) => m.v('fiend_grip_tick_interval'),
  // [L] measured in Hero Demo: the first tick (damage and mana drain) lands with the grip itself, then one per interval
  onCreated(m) { gripTick(m); },
  onThink(m) {
    const c = m.caster; const ab = m.ability;
    if (!((c.alive && c.channelAb === ab) || m.data.ills.some((i) => i.alive))) { m.remove(); return; }
    gripTick(m);
  },
  onDestroy(m) { for (const i of m.data.ills) if (i.alive) i.world.kill(i, null, null, true); },
});
defAbility('bane_fiends_grip', {
  prio: 90, channel: true,
  ai: (ab, u, t) => (t && realHero(t) && t.st[ST.STUN] === 0 && t.st[ST.SLEEP] === 0 && t.hp / t.maxHp > 0.15 ? { target: t } : null),
  cast(ab, t) {
    if (!t) return;
    const u = ab.owner; const w = u.world; const ills = []; const time = ab.v('AbilityChannelTime');
    for (let i = 0; i < ab.v('illusion_count'); i++) {
      const ill = w.createIllusion(u, { duration: time, outPct: -100, inPct: ab.v('scepter_incoming_illusion_damage') - 100, x: t.x + (i % 2 ? -150 : 150), y: t.y + 120 });
      ill.ai = null; ill.addModifier(GRIP + '_cast_illusion', { caster: u, ability: ab });
      ills.push(ill);
    }
    ab.data = t.addModifier(GRIP, { caster: u, ability: ab, duration: baneDuration(ab, t, time), pierce: true, data: { ills } });
    if (!ab.data) for (const i of ills) w.kill(i, null, null, true);
  },
  channelEnd(ab, interrupted) { const m = ab.data; if (interrupted && m && !m.removed && !m.data.ills.some((i) => i.alive)) m.remove(); },
  fid: 'approx', note: 'damage and mana drain are applied per tick interval while the grip is held; Scepter: two idle illusions keep the grip alive if Bane is interrupted and die when disabled or silenced',
});

// ================================================================ Night Stalker
defAbility('night_stalker_void', {
  prio: 62,
  cast(ab, t) {
    if (!t) return;
    const u = ab.owner; const w = u.world; const night = isNight(w); const r = ab.v('cast_radius');
    const list = r > 0 ? enemiesNear(ab, t.x, t.y, r).filter((e) => !e.isBuilding) : [];
    if (!list.includes(t)) list.push(t);
    for (const e of list) {
      if (immune(ab, e)) continue;
      if (night) e.addModifier('modifier_stunned', { caster: u, ability: ab, duration: 2 * w.dt, noResist: true });
      addMod(ab, e, 'modifier_night_stalker_void', night ? ab.v('duration_night') : ab.v('duration_day'));
      hit(ab, e, ab.v('damage'), MAGICAL);
    }
  },
  fid: 'approx', note: 'the night-time mini-stun lasts two engine ticks, just enough to interrupt (its duration is not in the data)',
});
debuff('modifier_night_stalker_void', { stats: (m) => ({ msPct: -m.v('movespeed_slow'), asSlow: -m.v('attackspeed_slow') }) });
const FEAR = 'modifier_night_stalker_crippling_fear';
// [L] measured in Hero Demo: the debuff on an enemy lingers 0.5 s after it left the aura (or the aura ended) and deals
// dps x tick_rate every tick_rate from its own timer, the first tick one interval after it was applied
const FEAR_LINGER = 0.5;
debuff(FEAR + '_silence', {
  state: ['SILENCE'], purge: 'none', statusResist: false, interval: (m) => m.v('tick_rate'),
  onThink(m) { mhit(m, m.parent, m.v('dps') * m.v('tick_rate'), MAGICAL); },
});
function fearPulse(m) {
  const u = m.parent;
  for (const e of u.world.enemiesInRadius(u, u.x, u.y, m.v('radius'))) if (!e.isBuilding) e.addModifier(FEAR + '_silence', { caster: u, ability: m.ability, duration: FEAR_LINGER });
}
buff(FEAR, {
  purge: 'none', interval: (m) => m.v('tick_rate'), thinkNow: true,
  onThink(m) { fearPulse(m); },
  onDestroy(m, expired) { if (expired && m.parent.alive) fearPulse(m); },
});
defAbility('night_stalker_crippling_fear', {
  prio: 72,
  ai: (ab, u, t) => (t && !u.hasModifier(FEAR) && u.distTo(t) <= ab.v('radius') - 50 ? here(u) : null),
  cast(ab) { const u = ab.owner; addMod(ab, u, FEAR, isNight(u.world) ? ab.v('duration_night') : ab.v('duration_day')); },
  fid: 'full', note: 'day or night is decided when it is cast',
});
const FEAST = 'modifier_night_stalker_midnight_feast';
const feastable = (u, e) => e.alive && e.team !== u.team && !e.heroLike && !e.isBuilding && !e.def.ancient && e.targetable() && e.st[ST.INVULN] === 0;
modifier(FEAST, {
  hidden: true,
  onAttackLanded(m, rec) {
    const u = m.parent; const t = rec.target;
    if (rec.secondary || t.isBuilding || t.team === u.team) return;
    u.heal(m.v('attack_heal') * (t.heroLike ? 1 : 0.6), u, m.ability, true);
  },
});
defAbility('night_stalker_midnight_feast', {
  mods: [FEAST], prio: 40,
  requires: tune((ab) => setActive(ab, true)), // flagged PASSIVE in the data, yet "at night, the ability can be activated"
  ai(ab, u, t, w) {
    if (!isNight(w)) return null;
    let best = null; let bd = ab.castRange() + 200;
    for (const e of w.units) { if (!feastable(u, e)) continue; const d = u.distTo(e); if (d < bd) { bd = d; best = e; } }
    return best ? { target: best } : null;
  },
  cast(ab, t) {
    const u = ab.owner; const w = u.world;
    if (!t || !isNight(w) || !feastable(u, t)) { ab.cdEnd = 0; return; }
    w.kill(t, u, ab);
    u.heal(u.maxHp * ab.v('hp_restore') / 100, u, ab); u.giveMana(u.maxMana * ab.v('mp_restore') / 100);
  },
  fid: 'approx', note: 'attack_heal ("LIFESTEAL" without a percent sign in the tooltip) is a flat heal per attack that lands, x0.6 against non-heroes (the tooltip only says "decreased"; the engine\'s lifesteal factor is used); at night the AI devours the nearest enemy non-ancient creep',
});
passive('night_stalker_hunter_in_the_night', {
  stats: (m) => (isNight(m.parent.world) ? { msPct: m.v('bonus_movement_speed_pct_night'), as: m.v('bonus_attack_speed_night'), statusRes: m.v('bonus_status_resist_night') } : {}),
  onKill(m, ev) {
    const u = m.parent; const v = ev.victim;
    if (m.v('reset_cooldowns') <= 0 || !realHero(v) || v.team === u.team) return;
    for (const a of u.abilities) if (a.def.type !== 'ultimate') a.cdEnd = 0; // Scepter: "resets all basic ability cooldowns"
  },
  fid: 'full', note: 'the stale Shard text (cast on a creep) is ignored: that effect is Midnight Feast now',
});
const DARK = 'modifier_night_stalker_darkness';
const allDirty = (w) => { for (const x of w.units) x.dirty = true; };
buff(DARK, {
  purge: 'none', stats: (m) => ({ dmg: m.v('bonus_damage') }),
  // m.z = 1 on the instance that turned day into night and has to give the day back
  onCreated(m) { const w = m.parent.world; m.z = w.isDay ? 1 : 0; w.isDay = false; allDirty(w); },
  onDestroy(m) {
    const w = m.parent.world;
    if (m.z !== 1) return;
    for (const x of w.units) { const o = x !== m.parent && x.alive ? x.findModifier(DARK) : null; if (o) { o.z = 1; return; } }
    w.isDay = true; allDirty(w);
  },
});
defAbility('night_stalker_darkness', {
  prio: 90, engage: false,
  ai: (ab, u, t) => (t && u.distTo(t) < 900 && !u.hasModifier(DARK) ? here(u) : null),
  cast(ab) { addMod(ab, ab.owner, DARK, ab.v('duration')); },
  fid: 'full', note: 'turns the whole world to night (world.isDay) for the duration; flight and unobstructed vision have no effect in the sandbox',
});

// ================================================================ Tidehunter
const CATCH = 'modifier_tidehunter_leviathans_catch';
const fishEaten = (m) => Math.floor(m.parent.level / 2) + m.stacks; // one free fish per even hero level + preset stacks
passive('tidehunter_leviathans_catch', {
  stats: (m) => { const n = fishEaten(m); return { hp: n * m.v('fish_health_bonus'), attackRange: n * m.v('fish_attack_range') }; },
  fid: 'approx', note: 'counts the free fish of every even hero level; fish dropped by dying heroes are not eaten during a fight (add them with the unit option stacks: { tidehunter_leviathans_catch: N }); the bonus damage block is added when Kraken Shell handles the attack (on top of the shell\'s block or of a larger item block already applied), not for a Tidehunter without Kraken Shell',
});
const GUSH = 'modifier_tidehunter_gush';
modifier(GUSH, { hidden: true });
debuff(GUSH + '_debuff', { stats: (m) => ({ msPct: -Math.abs(m.v('movement_speed')), armor: -m.v('negative_armor') }) });
function gushHit(ab, e) {
  hit(ab, e, ab.v('gush_damage'), MAGICAL);
  if (e.alive && !immune(ab, e)) addMod(ab, e, GUSH + '_debuff', ab.v('AbilityDuration'));
}
defAbility('tidehunter_gush', {
  mods: [GUSH], prio: 60,
  requires: tune((ab) => { if (ab.v('cooldown_scepter') > 0) ab.vals.AbilityCooldown = ab.v('cooldown_scepter'); if (ab.v('cast_range_scepter') > 0) ab.vals.AbilityCastRange = ab.v('cast_range_scepter'); }),
  ai(ab, u, t) {
    if (!t) return null;
    if (ab.v('aoe_scepter') > 0) return u.distTo(t) <= ab.castRange() - 100 ? { x: t.x, y: t.y } : null;
    return immune(ab, t) ? null : { target: t };
  },
  cast(ab, t, x, y) {
    const u = ab.owner; const w = u.world;
    if (ab.v('aoe_scepter') > 0) {
      // Scepter: a wave from the caster through the aimed point, cast_range_scepter long
      for (const e of lineFromCaster(ab, t ? t.x : x, t ? t.y : y, ab.castRange(), 2 * (ab.v('aoe_scepter')))) if (!e.isBuilding) w.after(u.distTo(e) / ab.v('speed_scepter'), () => { if (e.alive) gushHit(ab, e); });
    } else if (t) w.projectile(u, t, ab.v('projectile_speed'), (tt) => { if (!immune(ab, tt)) gushHit(ab, tt); });
  },
  fid: 'approx', note: 'Scepter: the wave is a line from the caster with aoe_scepter as its radius (half-width) and cast_range_scepter as its length; cooldown_scepter replaces the cooldown',
});
const SHELL = 'modifier_tidehunter_kraken_shell';
const SMASH = 'modifier_tidehunter_anchor_smash_debuff';
debuff(SMASH, { stats: (m) => ({ dmgBasePct: -Math.abs(m.v('damage_reduction')) }) });
function anchorSmash(u, cleansePct) {
  const ab = u.findAbility('tidehunter_anchor_smash');
  if (!ab || ab.level < 1) return;
  const w = u.world;
  for (const e of enemiesNear(ab, u.x, u.y, u.attackRange + ab.v('additional_range'))) {
    const bld = e.isBuilding;
    if (e.name === 'npc_dota_roshan' || immune(ab, e) || !e.attackableBy(u) || (bld && ab.v('targets_buildings') <= 0)) continue;
    const k = bld ? ab.v('building_pct_damage') / 100 : 1;
    // triggered by Kraken Shell: "has %smash_on_purge%% damage and is reflected damage"
    if (cleansePct > 0) w.damage(u, e, ((u.dmgMin + u.dmgMax) / 2 + u.dmgBonus + ab.v('attack_damage')) * u.dmgOutMul * k * cleansePct / 100, PHYSICAL, F_REFLECT | F_NO_AMP | F_NO_LIFESTEAL, ab);
    else w.launchAttack(u, e, { instant: true, flat: ab.v('attack_damage'), mult: k, fromAbility: ab });
    if (e.alive && !bld) addMod(ab, e, SMASH, ab.v('reduction_duration'));
  }
}
modifier(SHELL, {
  hidden: true,
  // m.x = damage counted towards the cleanse, m.z = time of the last counted damage, m.y = time of the last attack taken (AI)
  onCreated(m) { m.y = -100; m.z = -100; },
  preMit(m, d) {
    const u = m.parent; const s = d.src;
    if (!(d.flags & F_ATTACK) || d.type !== PHYSICAL || d.amount <= 0 || !s || s.team === u.team) return;
    m.y = u.world.time;
    let block = m.v('damage_reduction');
    if (!s.heroLike) block *= 1 - m.v('creep_reduction_penalty_pct') / 100;
    if (u.hasModifier(SHELL + '_boost')) block *= m.v('active_pct_effectiveness') / 100;
    // "Does not stack with items that provide Damage Block": only the largest block of an attack counts. The item scripts keep
    // the block already taken off an attack on its record (rec.blocked); the shell follows the same convention.
    const r = d.rec; const prev = r ? r.blocked || 0 : 0;
    const fish = u.findModifier(CATCH);
    const total = Math.max(block, prev) + (fish ? fishEaten(fish) * fish.v('fish_damage_block') : 0);
    if (total > prev) { d.amount = Math.max(0, d.amount - (total - prev)); if (r) r.blocked = total; }
  },
  onTakeDamage(m, d) {
    const u = m.parent; const w = u.world; const s = d.src;
    if (d.dealt <= 0 || !s || s === u) return;
    if (w.time - m.z > m.v('damage_reset_interval')) m.x = 0;
    m.z = w.time; m.x += d.dealt;
    if (m.x < m.v('damage_cleanse')) return;
    m.x = 0;
    u.purge({ debuffs: true, strong: true });
    if (m.v('smash_on_purge') > 0) anchorSmash(u, m.v('smash_on_purge'));
  },
});
buff(SHELL + '_boost', { purge: 'none', stats: (m) => ({ msPct: -m.v('active_move_speed_penalty_pct') }) });
defAbility('tidehunter_kraken_shell', {
  mods: [SHELL], prio: 50,
  ai(ab, u, t) { const m = u.findModifier(SHELL); return t && m && !u.hasModifier(SHELL + '_boost') && u.world.time - m.y < 1 && u.rangeTo(t) <= u.attackRange + 100 ? here(u) : null; },
  cast(ab) { addMod(ab, ab.owner, SHELL + '_boost', ab.v('active_duration')); },
  fid: 'approx', note: 'blocks a flat amount of every physical attack (reduced for non-hero attackers, scaled by active_pct_effectiveness while active); all damage taken from others counts towards the cleanse; "does not stack with items that provide Damage Block" is honoured through the largest-block-per-attack record the item scripts use (rec.blocked), so an item block that is resolved after the shell and is larger replaces it together with the fish bonus; AI activates it while it is being attacked in melee range of its target',
});
defAbility('tidehunter_anchor_smash', {
  prio: 62,
  ai: (ab, u, t) => (t && u.distTo(t) <= u.attackRange + ab.v('additional_range') - 30 ? here(u) : null),
  cast(ab) { anchorSmash(ab.owner, 0); },
  fid: 'approx', note: 'an instant attack with the bonus damage against every enemy within attack range + additional_range of Tidehunter\'s centre; the reduction applies to base attack damage (modifier tooltip); the Kraken Shell talent trigger deals its share as reflected physical damage',
});
defAbility('tidehunter_ravage', {
  prio: 86,
  ai: (ab, u, t) => (t && t.isHero && u.distTo(t) <= Math.min(600, ab.v('radius')) ? here(u) : null),
  cast(ab) {
    const u = ab.owner; const w = u.world; const ox = u.x; const oy = u.y;
    for (const e of enemiesNear(ab, ox, oy, ab.v('radius'))) {
      if (e.isBuilding) continue;
      w.after(Math.hypot(e.x - ox, e.y - oy) / ab.v('speed'), () => { if (!e.alive) return; if (!immune(ab, e)) stun(ab, e, ab.v('duration')); hit(ab, e, ab.v('AbilityDamage'), MAGICAL); });
    }
  },
  fid: 'full', note: 'every enemy in the radius at cast is hit when the wave reaches it (distance / speed); AI waits until an enemy hero is within 600',
});
// Dead in the Water. The anchor is a real unit with pip health; the shipped 7.42 "Pip Health" notes list it: attacks of heroes,
// Roshan, towers and the fountain remove one pip, attacks of illusions and creeps a quarter, nothing else hurts it.
const ANCHOR = 'modifier_tidehunter_dead_in_the_water';
const ANCHOR_UNIT = 'npc_dota_unit_tidehunter_anchor';
const PIP_FULL = 1; const PIP_MINOR = 0.25;
debuff(ANCHOR + '_drag', { purge: 'none', statusResist: false, stats: (m) => ({ msCap: m.v('max_movement_speed') }) });
modifier(ANCHOR + '_pips', {
  hidden: true, purge: 'none', // m.data = the leash on the anchored hero
  postMit(m, d) {
    const s = d.src;
    if (!s || !(d.flags & F_ATTACK) || !d.rec || d.rec.secondary) { d.amount = 0; return; }
    d.amount = m.parent.maxHp / m.v('attacks_to_destroy') * (realHero(s) || s.isBuilding || s.name === 'npc_dota_roshan' ? PIP_FULL : PIP_MINOR);
  },
  onDestroy(m) { const leash = m.data; if (leash && !leash.removed) leash.remove(); }, // anchor destroyed: the hero is free
});
debuff(ANCHOR, {
  purge: 'none', state: ['LEASH'], interval: 0.1,
  onCreated(m) {
    const t = m.parent; const unit = t.world.unitDef(ANCHOR_UNIT) ? summon(m.ability, ANCHOR_UNIT, { x: t.x, y: t.y, ai: 'idle' }) : null;
    m.data = { x: t.x, y: t.y, unit };
    if (unit) unit.addModifier(ANCHOR + '_pips', { caster: m.caster, ability: m.ability, data: m });
  },
  onThink(m) {
    const t = m.parent; const a = m.data; const len = m.v('chain_length');
    if (a.unit && !a.unit.alive) { m.remove(); return; }
    const dx = t.x - a.x; const dy = t.y - a.y; const d = Math.hypot(dx, dy);
    if (d <= len) return;
    a.x = t.x - dx / d * len; a.y = t.y - dy / d * len; // the anchor is dragged behind
    if (a.unit) { a.unit.x = a.x; a.unit.y = a.y; }
    t.addModifier(ANCHOR + '_drag', { caster: m.caster, ability: m.ability, duration: 0.25 });
  },
  onDestroy(m) { const unit = m.data ? m.data.unit : null; if (unit && unit.alive) unit.world.kill(unit, null, null, true); },
});
defAbility('tidehunter_dead_in_the_water', {
  prio: 42,
  ai: (ab, u, t) => (t && realHero(t) && !immune(ab, t) && !t.hasModifier(ANCHOR) && t.hp / t.maxHp < 0.5 ? { target: t } : null),
  cast(ab, t) { if (t) ab.owner.world.projectile(ab.owner, t, ab.v('projectile_speed'), (tt) => { if (!immune(ab, tt)) addMod(ab, tt, ANCHOR, ab.v('duration')); }); },
  fid: 'approx', note: 'the hero is leashed and capped at max_movement_speed while it drags the anchor beyond chain_length (checked every 0.1 s); the anchor is a real unit with pip health (shipped 7.42 Pip Health rules: an attack of a hero, Roshan or a building removes one of the attacks_to_destroy pips, an attack of a creep or illusion a quarter, nothing else hurts it) and destroying it frees the hero; the default controller only attacks the anchor when it is the nearest enemy at the moment it picks a new target; AI uses it on a hero below 50% health',
});
