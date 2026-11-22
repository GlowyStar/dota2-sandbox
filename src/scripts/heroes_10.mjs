// Hero abilities, part 10: Lone Druid (+ Spirit Bear), Earth Spirit, Nature's Prophet, Clinkz, Enigma, Marci, Phantom Lancer,
// Snapfire, Weaver, Centaur Warrunner, Pugna, Vengeful Spirit.
// Every number is read from the shipped data by value name; literals are structural (tick steps, geometry) and named in `note`.
import { defAbility, modifier, buff, debuff, passive, selfBuff, hit, addMod, stun, silence, enemiesNear, alliesNear, enemiesInLine, mhit,
  zone, knockback, orbHooks, nearAI, ST, C, PHYSICAL, MAGICAL, PURE, F_ATTACK, F_NO_AMP, F_REFLECT, F_HP_LOSS, F_NO_LIFESTEAL, F_NON_LETHAL,
  F_PIERCE } from '../engine/dsl.mjs';

const na = (name, note) => defAbility(name, { fid: 'n/a', note });
const TAU = Math.PI * 2;
// unit vector from a towards (x, y) plus the distance
const dirTo = (a, x, y) => { const dx = x - a.x; const dy = y - a.y; const d = Math.hypot(dx, dy); return d > 1e-6 ? [dx / d, dy / d, d] : [1, 0, 0]; };
const heroish = (t) => t.heroLike || t.name === 'npc_dota_roshan';            // "heroes, creep heroes and Roshan"
const playerUnit = (t) => t.heroLike || t.owner !== null;                      // heroes and anything a player summoned
const hasLvl = (u, name) => { const a = u.findAbility(name); return a && a.level > 0 ? a : null; };
const aiTarget = (u) => (u.ai && u.ai.target && u.ai.target.alive ? u.ai.target : null);
// scripted movement: walk u towards (x, y) for dt seconds; true on arrival
function stepTo(u, x, y, dt, speed) { const [dx, dy, d] = dirTo(u, x, y); const s = (speed ?? u.ms) * dt; if (d <= s) { u.x = x; u.y = y; return true; } u.x += dx * s; u.y += dy * s; return false; }
// "damage per second" debuffs: deal dps x elapsed time on every think and once more when the modifier ends, so the total is exact
function dpsTick(m, dps, type = MAGICAL) { const now = m.parent.world.time; const dt = now - m.z; m.z = now; if (dt > 1e-6 && dps > 0 && m.parent.alive) mhit(m, m.parent, dps * dt, type); }
// Pip health (7.42): only attacks count; heroes, Roshan and buildings remove one pip per attack, creeps and illusions a quarter
function pipHit(m, d) { const s = d.src; d.amount = (d.flags & F_ATTACK) && s ? ((s.heroLike && !s.isIllusion) || s.isBuilding || s.name === 'npc_dota_roshan' ? 1 : 0.25) : 0; }
// absorb from a pool object shared by several units: data = { left, max }
const poolAbsorb = (m, d) => { const p = m.data; if (d.amount <= 0 || (d.flags & F_HP_LOSS) || p.left <= 0) return; const a = Math.min(d.amount, p.left); d.amount -= a; p.left -= a; };

// ================================================================ Lone Druid and the Spirit Bear
const LD_BEAR = 'npc_dota_lone_druid_bear1';
const LD_STORED = 'modifier_lone_druid_spirit_bear_summon_druid_stored';
const ldBearOf = (u) => { const sb = u.findAbility('lone_druid_spirit_bear'); return sb && sb.data && sb.data.bear.alive ? sb.data.bear : null; };
const ldDruidOf = (b) => (b.owner && b.owner.findAbility('lone_druid_spirit_bear') ? b.owner : null);

// Entangle: Lone Druid's ability and the bear's Entangling Claws feed one stack counter on the enemy
debuff('modifier_lone_druid_entangle_counter', { multi: 'stack', purge: 'none', pierce: true });
// [L] measured in Hero Demo: the root damage ticks every 0.2 s (damage per second x 0.2)
debuff('modifier_lone_druid_entangle_root', { state: ['ROOT'], pierce: true, interval: 0.2, onCreated(m) { m.z = m.parent.world.time; }, onThink(m) { dpsTick(m, m.v('damage')); }, onDestroy(m) { dpsTick(m, m.v('damage')); } });
function ldEntangle(ab, t, stacks) {
  if (!t.alive || stacks <= 0 || (ab.v('nostack_protection', 1) > 0 && t.hasModifier('modifier_lone_druid_entangle_root'))) return;
  const c = t.addModifier('modifier_lone_druid_entangle_counter', { caster: ab.owner, ability: ab, duration: ab.v('counter_duration'), stacks });
  if (c && c.stacks >= ab.v('hits_required')) { c.remove(); t.addModifier('modifier_lone_druid_entangle_root', { caster: ab.owner, ability: ab, duration: ab.v('entangle_duration') }); }
}
buff('modifier_lone_druid_entangle_buff', { purge: 'none', onAttackLanded(m, rec) { const t = rec.target; if (t.team !== m.parent.team && heroish(t)) ldEntangle(m.ability, t, m.v('lone_druid_counters_applied_tooltip')); } });
defAbility('lone_druid_entangle', {
  prio: 75, ai: (ab, u, t) => (t && !t.hasModifier('modifier_lone_druid_entangle_root') ? { x: t.x, y: t.y } : null),
  cast(ab, t, x, y) {
    const u = ab.owner; const heroStacks = ab.v('root_heroes_on_cast') > 0 ? ab.v('hits_required') : ab.v('hits_incremented_on_active');
    for (const e of enemiesNear(ab, x, y, ab.v('active_radius'))) if (!e.isBuilding) ldEntangle(ab, e, heroish(e) ? heroStacks : ab.v('hits_required'));
    addMod(ab, u, 'modifier_lone_druid_entangle_buff', ab.v('lone_druid_buff_duration'));
  },
  fid: 'approx', note: 'root damage = damage per second x actual root time, settled in 0.2 s steps (tick rate measured live, not in the data); with Scepter only Lone Druid\'s own stacks ignore the Entangled protection',
});
passive('lone_druid_spirit_bear_entangle', {
  onAttackLanded(m, rec) { const t = rec.target; if (t.team !== m.parent.team && heroish(t)) ldEntangle(m.ability, t, m.v('spirit_bear_counters_applied_tooltip')); },
  fid: 'approx', note: 'shares the stack counter with Lone Druid\'s Entangle; root damage settled in 0.2 s steps; level follows Lone Druid\'s Entangle',
});

// Spirit Link: flat movement speed, and attack damage dealt by one partner heals the other (shipped modifier text: "granting a
// percentage of damage dealt as health to your companion")
const ldLink = (m, rec, partner) => { const t = rec.target; if (!partner || !partner.alive || rec.dealt <= 0 || t.isBuilding) return; const u = m.parent; partner.heal(rec.dealt * m.v('lifesteal_percent') / 100 * (t.heroLike ? 1 : 1 - m.v('creep_lifesteal_penalty') / 100) * (1 + u.lifestealAmp / 100), u, m.ability, true); };
// (Break only disables the shared lifesteal, so the movement speed sits in a separate unbreakable modifier)
modifier('modifier_lone_druid_spirit_link', { hidden: true, purge: 'none', onAttackLanded(m, rec) { if (m.v('lifesteal_both_ways') > 0) ldLink(m, rec, ldBearOf(m.parent)); } });
modifier('modifier_lone_druid_spirit_link_speed', { hidden: true, purge: 'none', breakable: false, stats: { ms: 'bonus_movement_speed_druid' } });
defAbility('lone_druid_spirit_link', {
  mods: ['modifier_lone_druid_spirit_link', 'modifier_lone_druid_spirit_link_speed'],
  fid: 'full', note: '"shared lifesteal" = the partner is healed for lifesteal_percent of the attack damage dealt (creep penalty applies); the Scepter text still shipped for this ability is stale (no Scepter values, ability is passive) and is not modelled',
});
modifier('modifier_lone_druid_spirit_bear_spirit_link', { hidden: true, purge: 'none', onAttackLanded(m, rec) { ldLink(m, rec, ldDruidOf(m.parent)); } });
modifier('modifier_lone_druid_spirit_bear_spirit_link_speed', { hidden: true, purge: 'none', breakable: false, stats: { ms: 'bonus_movement_speed_bear' } });
defAbility('lone_druid_spirit_bear_spirit_link', { mods: ['modifier_lone_druid_spirit_bear_spirit_link', 'modifier_lone_druid_spirit_bear_spirit_link_speed'], fid: 'full', note: 'level follows Lone Druid\'s Spirit Link (assumed, as stated for Entangle)' });

// Savage Roar: both roar; the cooldown is shared
// [L] measured in Hero Demo: feared units are also silenced, disarmed and muted, and run straight away from the roarer
debuff('modifier_lone_druid_savage_roar_fear', {
  state: ['FEAR', 'SILENCE', 'DISARM', 'MUTE'], stats: { msPct: 'bonus_speed' }, interval: (m) => m.parent.world.dt,
  onThink(m) { const e = m.parent; const c = m.caster; if (e.st[ST.ROOT] > 0 || e.st[ST.STUN] > 0 || !c) return; const [dx, dy] = dirTo(c, e.x, e.y); const k = e.ms * e.world.dt; e.x += dx * k; e.y += dy * k; },
});
buff('modifier_lone_druid_savage_roar_buff', { stats: (m) => ({ msPct: m.v('shard_movement_speed_pct'), as: m.v('shard_attack_speed') }) });
const ldRoarVictim = (a, e) => !e.isBuilding;
// who roars when `caster` casts: the caster, and the partner if it could cast itself (always with Lone Druid's Shard)
function ldRoarers(caster) {
  const isBear = caster.name === LD_BEAR; const druid = isBear ? ldDruidOf(caster) : caster; const bear = isBear ? caster : ldBearOf(caster);
  const da = druid && hasLvl(druid, 'lone_druid_savage_roar'); const ba = bear && hasLvl(bear, 'lone_druid_savage_roar_bear');
  const shard = da && da.v('shard_radius') > 0 ? da : null;
  return { shard, druid, list: [[druid, da], [bear, ba]].filter(([x, a]) => x && a && x.alive && x.st[ST.OUT] === 0 && (x === caster || shard || !(x.cantAct() || x.isSilenced()))) };
}
function ldRoar(caster) {
  const { shard, druid, list } = ldRoarers(caster);
  for (const [x, a] of list) {
    for (const e of x.world.enemiesInRadius(x, x.x, x.y, a.v('radius'))) if (ldRoarVictim(a, e)) e.addModifier('modifier_lone_druid_savage_roar_fear', { caster: x, ability: a, duration: a.v('duration') });
    if (shard) { x.purge({ debuffs: true }); for (const al of x.world.alliesInRadius(x, x.x, x.y, shard.v('shard_radius'))) al.addModifier('modifier_lone_druid_savage_roar_buff', { caster: druid, ability: shard, duration: shard.v('shard_duration') }); }
    if (x !== caster) a.startCooldown();
  }
}
const ldRoarAI = (ab, u) => (ldRoarers(u).list.some(([x, a]) => x.world.enemiesInRadius(x, x.x, x.y, a.v('radius') - 25).some((e) => ldRoarVictim(a, e) && !e.isImmune() && e.st[ST.FEAR] === 0 && !e.isDisabled())) ? {} : null);
const LD_ROAR_NOTE = 'feared units are silenced, disarmed and muted and run straight away from the roaring unit at their (boosted) speed (live); the partner roars too when able (always with Lone Druid\'s Shard) and the cooldown is shared; the data value only_affects_player_units=1 has no tooltip and is not applied';
defAbility('lone_druid_savage_roar', { prio: 80, ai: ldRoarAI, cast(ab) { ldRoar(ab.owner); }, fid: 'approx', note: LD_ROAR_NOTE });
// the bear leaves the button to Lone Druid while he is able to press it himself
const ldBearRoarAI = (ab, u) => { const d = ldDruidOf(u); const da = d && hasLvl(d, 'lone_druid_savage_roar'); return d && d.alive && da && da.ready() && !d.cantAct() && !d.isSilenced() ? null : ldRoarAI(ab, u); };
defAbility('lone_druid_savage_roar_bear', { prio: 80, ai: ldBearRoarAI, cast(ab) { ldRoar(ab.owner); }, fid: 'approx', note: LD_ROAR_NOTE + '; level follows Lone Druid\'s Savage Roar (assumed); the bear\'s controller only presses it when Lone Druid cannot cast his own' });

// True Form
const LD_TRUE_RANGE = 225;      // [L] measured in Hero Demo: attack range in True Form (not in the data)
buff('modifier_lone_druid_true_form_transform', { purge: 'none', state: ['STUN'], statusResist: false, onDestroy(m, expired) { if (expired && m.parent.alive) addMod(m.ability, m.parent, 'modifier_lone_druid_true_form', m.ability.v('duration')); } });
buff('modifier_lone_druid_true_form', {
  purge: 'none', stats: (m) => ({ armor: m.v('bonus_armor'), hp: m.v('bonus_hp'), dmg: m.v('bonus_attack_damage'), slowRes: m.v('bonus_slow_resistance'), attackRange: m.x }),
  onCreated(m) { const u = m.parent; m.z = u.melee ? 1 : 0; m.x = u.melee ? 0 : LD_TRUE_RANGE - u.def.range; u.melee = true; u.dirty = true; },
  onDestroy(m) { const u = m.parent; if (m.z === 0) u.melee = false; u.dirty = true; },
});
defAbility('lone_druid_true_form', {
  prio: 85, engage: false, ai: (ab, u, t) => (t && !u.hasModifier('modifier_lone_druid_true_form') && u.distTo(t) <= 900 ? {} : null),
  cast(ab) { const u = ab.owner; if (u.hasModifier('modifier_lone_druid_true_form')) { addMod(ab, u, 'modifier_lone_druid_true_form', ab.v('duration')); return; } addMod(ab, u, 'modifier_lone_druid_true_form_transform', ab.v('transformation_time')); },
  fid: 'full', note: 'live: Lone Druid is stunned for transformation_time, then gets the bonuses for `duration` and becomes melee with attack range 225 (measured, not in the data)',
});

// Summon Spirit Bear
function ldSyncBear(u, bear) {
  const sb = u.findAbility('lone_druid_spirit_bear'); const lv = (n) => { const a = u.findAbility(n); return a ? a.level : 0; };
  // talents: Lone Druid's unique talents (the bear's ability values refer to them) + the bear's own tree, mirrored tier by tier
  const own = bear.def.abilities.filter((n) => n.startsWith('special_bonus_'));
  const tal = [...u.talents].filter((n) => n.startsWith('special_bonus_unique_'));
  (u.def.talents || []).forEach((n, i) => { if (n && own[i] && u.talents.has(n)) tal.push(own[i]); });
  const sig = [u.level, lv('lone_druid_entangle'), lv('lone_druid_savage_roar'), lv('lone_druid_spirit_link'), bear.hasScepter, bear.hasShard, tal.join()].join('|');
  if (sb.data.sig === sig) return;
  sb.data.sig = sig;
  const user = bear.ovr && bear.ovr.user !== undefined ? bear.ovr.user : bear.ovr || null;     // override a scenario gave to its own bear unit
  bear.ovr = { attrs: { str: 0, strGain: sb.v('strength_gain_tooltip'), agi: 0, agiGain: sb.v('agility_gain_tooltip'), int: 0, intGain: sb.v('intelligence_gain_tooltip') },
    hp: sb.v('bear_hp') + sb.v('bonus_bear_hp'), armor: sb.v('bear_armor') + sb.v('bonus_bear_armor'), mr: sb.v('bear_magic_resistance'), ms: sb.v('bear_movespeed'), bat: sb.v('bear_bat'), ...(user || {}), user };
  bear.level = u.level;
  bear.setTalents(tal);
  const set = (n, level, like) => { const a = bear.findAbility(n); if (!a) return; const s = like && u.findAbility(like); if (s) a.maxLevel = s.maxLevel; a.setLevel(level); };
  set('lone_druid_spirit_bear_entangle', lv('lone_druid_entangle'), 'lone_druid_entangle');
  set('lone_druid_savage_roar_bear', lv('lone_druid_savage_roar'), 'lone_druid_savage_roar');
  set('lone_druid_spirit_bear_spirit_link', lv('lone_druid_spirit_link'), 'lone_druid_spirit_link');
  set('lone_druid_spirit_bear_summon_druid', bear.hasScepter ? 1 : 0);
  set('lone_druid_spirit_bear_fetch', bear.hasShard ? 1 : 0);
  for (const a of bear.abilities) a.refresh();
  bear.refreshAI(); bear.dirty = true;
}
function ldCallBear(sb) {
  const u = sb.owner; const w = u.world;
  let bear = w.units.find((b) => b.alive && b.name === LD_BEAR && b.team === u.team && !b.isIllusion && (b.owner === null || b.owner === u));   // a bear unit placed by the scenario is adopted
  const adopted = !!bear;
  if (!bear) bear = w.summon(u, LD_BEAR, { x: u.x + 100, y: u.y + 60, level: u.level, ai: u.ai ? { mode: u.ai.mode === 'idle' ? 'attack' : u.ai.mode, focus: u.ai.focus, abilities: u.ai.abilities === 'none' || u.ai.mode === 'idle' ? 'none' : 'all' } : 'attack' });      // like a summoned unit in the game the bear attacks on its own even when Lone Druid idles (live)      // the bear follows Lone Druid's controller mode
  bear.owner = u; sb.data = { bear, sig: '' };
  ldSyncBear(u, bear); bear.recompute();
  if (!adopted) { bear.hp = bear.maxHp; bear.mana = bear.maxMana; }
  if (!bear.hasModifier('modifier_lone_druid_spirit_bear_leash')) bear.addModifier('modifier_lone_druid_spirit_bear_leash', { caster: u, ability: sb });
  return bear;
}
// the bear cannot attack beyond the leash range (it walks back towards Lone Druid instead)
modifier('modifier_lone_druid_spirit_bear_leash', {
  hidden: true, purge: 'none', interval: 0.25, thinkNow: true,
  onThink(m) {
    const b = m.parent; const d = m.caster; const sd = hasLvl(b, 'lone_druid_spirit_bear_summon_druid');
    const far = d.alive && d.st[ST.OUT] === 0 && b.distTo(d) > m.v('bear_attack_leash_range') + (sd ? sd.v('bonus_attack_leash_range') : 0);
    if (far !== (m.x === 1)) { m.x = far ? 1 : 0; b.st[ST.DISARM] += far ? 1 : -1; }
    if (far && !b.cantAct() && b.st[ST.ROOT] === 0) stepTo(b, d.x, d.y, 0.25);
  },
  onDestroy(m) { if (m.x === 1) m.parent.st[ST.DISARM]--; },
});
modifier(LD_STORED, { purge: 'none', state: ['OUT', 'INVULN'] });
modifier('modifier_lone_druid_spirit_bear', {
  hidden: true, purge: 'none', interval: 0.5, thinkNow: true,
  onThink(m) { const u = m.parent; if (m.x === 0) { m.x = 1; if (!ldBearOf(u) && !u.world.fresh) ldCallBear(m.ability); }      /* [L] a Lone Druid that has just appeared has no bear (rules.fresh) */ const b = ldBearOf(u); if (b) ldSyncBear(u, b); },
  onAnyDeath(m, ev) {
    const u = m.parent; const d = m.ability.data;
    if (!d || ev.victim !== d.bear) return;
    if (u.hasModifier(LD_STORED)) { u.removeModifierByName(LD_STORED); u.world.kill(u, ev.killer, ev.ability); return; }       // the bear carried his spirit
    u.world.damage(u, u, u.maxHp * m.v('backlash_damage') / 100, PURE, F_HP_LOSS, m.ability);
  },
  onDeath(m, ev) {      // bear's Scepter: Lone Druid is not killed while the bear is alive and close enough
    const u = m.parent; const b = ldBearOf(u); const sd = b && hasLvl(b, 'lone_druid_spirit_bear_summon_druid');
    if (ev.prevent || !sd || u.hasModifier(LD_STORED) || u.distTo(b) > sd.v('attack_leash_range_tooltip')) return;
    ev.prevent = true; u.hp = 1; u.purge({ debuffs: true, strong: true });
    u.addModifier(LD_STORED, { caster: b, ability: sd });
  },
});
defAbility('lone_druid_spirit_bear', {
  mods: ['modifier_lone_druid_spirit_bear'], prio: 96, engage: false, ai: (ab, u) => (ldBearOf(u) ? null : {}), cast(ab) { ldCallBear(ab); },
  fid: 'approx', note: 'outside rules.fresh the bear is already out when the fight starts (free, no cooldown; live: a fresh Lone Druid has none); the ability re-summons it after it dies. Bear = hero-like unit with 0 base attributes and the tooltip gains, level = Lone Druid\'s level, universal damage; its own talent tree mirrors the side Lone Druid picked on each tier (assumption); it has no Scepter/Shard and no items unless the scenario spawns a Spirit Bear unit on the team, which is then adopted (the neutral item copy is not modelled); backlash = exactly backlash_damage% of max health as health loss (type not stated); leash applies only while Lone Druid is alive; the bear uses the same controller mode as Lone Druid',
});
// Spirit Bear abilities
na('lone_druid_spirit_bear_return', 'map movement (teleport back to Lone Druid); a bear beyond the leash range simply walks back');
defAbility('lone_druid_spirit_bear_summon_druid', {
  prio: 95, engage: false,
  ai: (ab, u) => { const d = ldDruidOf(u); const s = d && d.findModifier(LD_STORED); return s && u.world.time - s.created >= ab.v('summon_lockout') ? {} : null; },
  cast(ab) { const b = ab.owner; const d = ldDruidOf(b); if (!d || !d.removeModifierByName(LD_STORED)) return; d.x = b.x + 60; d.y = b.y; d.recompute(); d.hp = d.maxHp * ab.v('summon_health_pct') / 100; d.mana = d.maxMana * ab.v('summon_mana_pct') / 100; },
  fid: 'approx', note: 'needs the bear\'s own Scepter (scenario-spawned bear with scepter: true). A stored Lone Druid is out of play and still counts as alive, so the fight goes on until the bear re-summons him or dies',
});
debuff('modifier_lone_druid_spirit_bear_fetch', { state: ['ROOT'], interval: (m) => m.v('tick_rate'), onThink(m) { if (m.parent.team !== m.caster.team) mhit(m, m.parent, m.v('damage') * m.v('tick_rate') / m.v('duration'), MAGICAL); } });
modifier('modifier_lone_druid_spirit_bear_fetch_drag', {
  purge: 'none', state: ['DISARM'], interval: 0.1,
  onThink(m) {
    const b = m.parent; const v = m.data.victim; const d = ldDruidOf(b);
    if (!v.alive || !v.hasModifier('modifier_lone_druid_spirit_bear_fetch')) { m.remove(); return; }
    if (d && d.alive && !b.cantAct() && b.st[ST.ROOT] === 0 && b.distTo(d) > b.attackRange) stepTo(b, d.x, d.y, 0.1);
    v.x = b.x + m.data.dx; v.y = b.y + m.data.dy;
  },
  onDestroy(m) { const b = m.parent; const v = m.data.victim; if (b.alive && v.alive && v.team !== b.team) b.attack(v); },
});
defAbility('lone_druid_spirit_bear_fetch', {
  prio: 60, ai: (ab, u, t) => (t && !t.isImmune() && !t.isBuilding && !u.hasModifier('modifier_lone_druid_spirit_bear_fetch_drag') ? { target: t } : null),
  cast(ab, t) { const b = ab.owner; if (!t || t === b) return; const dur = ab.v('duration'); if (!addMod(ab, t, 'modifier_lone_druid_spirit_bear_fetch', dur + 0.05)) return; b.addModifier('modifier_lone_druid_spirit_bear_fetch_drag', { ability: ab, duration: dur + 0.1, data: { victim: t, dx: t.x - b.x, dy: t.y - b.y } }); },
  fid: 'approx', note: 'needs the bear\'s own Shard. The bear walks towards Lone Druid at its move speed (not attacking) with the rooted target kept at its side until Lone Druid is within its attack range; drag_distance / break_distance are not used; runes are not modelled',
});
passive('lone_druid_spirit_bear_demolish', {
  outgoing(m, d) { const t = d.dst; if (t.team === m.parent.team) return; if ((d.flags & F_ATTACK) && t.isBuilding) d.amount *= 1 + m.v('bonus_building_damage') / 100; const k = m.v('bonus_damage_against_entangled'); if (k > 0 && t.hasModifier('modifier_lone_druid_entangle_root')) d.amount *= 1 + k / 100; },
  fid: 'approx', note: 'building bonus on attack damage; the talent "+% Damage to Entangled Units" is applied to all damage the bear deals to an Entangled unit',
});

// ================================================================ Earth Spirit
// Stone Remnants are real (out-of-play, invulnerable) units kept in a list on the Stone Remnant ability.
const ES_STONE = 'npc_dota_earth_spirit_stone';
const ES_MAG = 'modifier_earth_spirit_magnetize';
const ES_ROLL = 'modifier_earth_spirit_rolling_boulder';
const ES_PET = 'modifier_earth_spirit_petrify';
modifier('modifier_earth_spirit_stone_caller_remnant', { hidden: true, purge: 'none', state: ['OUT', 'INVULN'] });
function esData(u) { const sc = u.findAbility('earth_spirit_stone_caller'); if (!sc) return { stones: [], used: new Set(), ench: new Set(), last: -1 }; const d = (sc.data ||= { stones: [], used: new Set(), ench: new Set(), last: -1 }); d.stones = d.stones.filter((s) => s.alive); return d; }
const esStones = (u) => esData(u).stones;
const esPetrified = (u) => u.world.units.filter((e) => e.alive && e.findModifier(ES_PET, u));
const esRemnantLike = (u, s) => (s.name === ES_STONE ? esStones(u).includes(s) : !!s.findModifier(ES_PET, u));
const esStoneNear = (u, x, y, r, pred) => { let best = null; let bd = r; for (const s of esStones(u)) { const d = Math.hypot(s.x - x, s.y - y); if (d <= bd && (!pred || pred(s))) { bd = d; best = s; } } return best; };
const segDist = (px, py, x1, y1, x2, y2) => { const vx = x2 - x1; const vy = y2 - y1; const l2 = vx * vx + vy * vy || 1; let k = ((px - x1) * vx + (py - y1) * vy) / l2; k = k < 0 ? 0 : k > 1 ? 1 : k; return Math.hypot(x1 + vx * k - px, y1 + vy * k - py); };
function esUsedStone(u) { const sc = hasLvl(u, 'earth_spirit_stone_caller'); if (sc && u.st[ST.BREAK] === 0) u.addModifier('modifier_earth_spirit_stone_caller_buff', { ability: sc, duration: sc.v('buff_duration') }); }
const esMagnetized = (u) => u.world.units.filter((e) => e.alive && e.team !== u.team && e.isHero && e.findModifier(ES_MAG, u));
// "If an enemy hero is affected by Geomagnetic Grip or Boulder Smash, all magnetized heroes share the effects"
function esShare(u, struck, fn) { const mags = esMagnetized(u); if (mags.some((e) => struck.includes(e))) for (const e of mags) if (!struck.includes(e)) fn(e); }
// first remnant (or enchanted hero) lying on the first `len` units of the path from u towards (x, y)
function esPathStone(u, x, y, len, r) { const [dx, dy] = dirTo(u, x, y); let best = null; let ba = len; for (const s of [...esStones(u), ...esPetrified(u)]) { if (s === u) continue; const al = (s.x - u.x) * dx + (s.y - u.y) * dy; const off = Math.abs((s.x - u.x) * dy - (s.y - u.y) * dx); if (al >= -r && al <= ba && off <= r + s.def.hull) { ba = al; best = s; } } return best; }

// what the default controller wants to cast next (the Stone Remnant AI serves the first of these that lacks a remnant)
const esCharges = (u) => { const sc = hasLvl(u, 'earth_spirit_stone_caller'); return sc ? sc.charges : 0; };
const esRollWant = (ab, u, t) => ab.level > 0 && ab.ready() && !!t && !u.hasModifier(ES_ROLL) && u.distTo(t) <= ab.v('radius') + ab.v('distance') * (esCharges(u) >= 3 || esPathStone(u, t.x, t.y, ab.v('distance'), ab.v('radius')) ? ab.v('rock_distance_multiplier') : 1);
const esGripWant = (ab, u, t) => ab.level > 0 && ab.ready() && !!t && !u.hasModifier(ES_ROLL) && u.distTo(t) > 160 && u.distTo(t) <= ab.castRange() - 50;
const esGripStone = (ab, u, t) => esStones(u).find((s) => u.distTo(s) > 150 && u.distTo(s) <= ab.castRange() && segDist(t.x, t.y, s.x, s.y, u.x, u.y) <= ab.v('radius') + t.def.hull);
const esSmashWant = (ab, u, t) => ab.level > 0 && ab.ready() && !!t && !u.hasModifier(ES_ROLL) && u.distTo(t) <= 1200;
const esPetWant = (ab, u, t) => ab.level > 0 && ab.ready() && !!t && !u.hasModifier(ES_ROLL) && u.distTo(t) <= 350;
const esPetStone = (ab, u, t) => esStoneNear(u, t.x, t.y, ab.v('aoe') - 150, (s) => !esData(u).ench.has(s));

modifier('modifier_earth_spirit_stone_caller', {
  hidden: true, purge: 'none', interval: 0.1, thinkNow: true, stats: (m) => ({ dmgBasePct: m.v('attack_damage_per_stone') * m.ability.charges }),
  onThink(m) {
    const ab = m.ability; const u = m.parent; const w = u.world;
    // live (recordings since the recorder learns like a player): a fresh hero holds all its charges, so nothing is capped here
    if (m.x !== ab.charges) { m.x = ab.charges; u.dirty = true; }
  },
});
buff('modifier_earth_spirit_stone_caller_buff', { purge: 'none', stats: { dmgBasePct: 'attack_damage_per_stone_used' } });
defAbility('earth_spirit_stone_caller', {
  mods: ['modifier_earth_spirit_stone_caller'], prio: 90,
  ai(ab, u, t) {
    const d = esData(u);
    if (!t || u.world.time - d.last < 0.3 || u.hasModifier(ES_ROLL)) return null;
    const at = (x, y) => { d.last = u.world.time; return { x, y }; };
    const toward = (dist) => { const [dx, dy, far] = dirTo(u, t.x, t.y); const k = Math.min(dist, far); return at(u.x + dx * k, u.y + dy * k); };
    const mg = hasLvl(u, 'earth_spirit_magnetize');       // 1. keep Magnetize going
    if (mg) for (const e of esMagnetized(u)) { if (e.findModifier(ES_MAG, u).remaining() <= 1.2 && !d.stones.some((s) => !d.used.has(s) && Math.hypot(s.x - e.x, s.y - e.y) <= mg.v('rock_search_radius'))) return at(e.x, e.y); }
    const pet = u.findAbility('earth_spirit_petrify');     // 2. the next ability that needs a remnant
    if (pet && esPetWant(pet, u, t)) return esPetStone(pet, u, t) ? null : at(t.x, t.y);
    const roll = u.findAbility('earth_spirit_rolling_boulder');
    if (roll && esRollWant(roll, u, t)) return ab.charges < 3 || esPathStone(u, t.x, t.y, roll.v('distance'), roll.v('radius')) ? null : toward(ab.v('rolling_offset_distance'));
    const grip = u.findAbility('earth_spirit_geomagnetic_grip');
    if (grip && esGripWant(grip, u, t)) return esGripStone(grip, u, t) ? null : at(t.x, t.y);
    const smash = u.findAbility('earth_spirit_boulder_smash');
    if (smash && esSmashWant(smash, u, t)) return esStoneNear(u, u.x, u.y, smash.v('rock_search_aoe')) ? null : toward(80);
    return null;
  },
  cast(ab, t, x, y) { const u = ab.owner; const s = u.world.summon(u, ES_STONE, { x, y, duration: ab.v('duration'), ai: 'idle' }); s.addModifier('modifier_earth_spirit_stone_caller_remnant', { caster: u, ability: ab }); esData(u).stones.push(s); },
  fid: 'approx', note: 'remnants are out-of-play units; the "+% damage after using a remnant" buff triggers on Boulder Smash, Geomagnetic Grip, Enchant Remnant and rolling over one. AI: a remnant is placed only for the next ability that needs it (Magnetize refresh, Enchant Remnant, Rolling Boulder while 3+ charges remain, Grip, Smash)',
});

debuff('modifier_earth_spirit_boulder_smash_debuff', { stats: (m) => ({ msPct: -m.v('move_slow') }) });
// a kicked / pulled object travels in a straight line for T seconds
modifier('modifier_earth_spirit_boulder_smash_motion', {
  hidden: true, purge: 'none', pierce: true, statusResist: false, interval: (m) => m.parent.world.dt,
  onThink(m) { const d = m.data; const k = Math.min(1, (m.parent.world.time - d.t0) / d.T); m.parent.x = d.x1 + (d.x2 - d.x1) * k; m.parent.y = d.y1 + (d.y2 - d.y1) * k; if (k >= 1) m.remove(); },
  onDestroy(m, expired) { if (expired) { m.parent.x = m.data.x2; m.parent.y = m.data.y2; } },
});
function esGlide(obj, x2, y2, T) {
  obj.removeModifierByName('modifier_earth_spirit_boulder_smash_motion');
  if (!(T > 1e-6)) { obj.x = x2; obj.y = y2; return; }
  obj.addModifier('modifier_earth_spirit_boulder_smash_motion', { duration: T + 0.001, pierce: true, noResist: true, data: { x1: obj.x, y1: obj.y, x2, y2, T, t0: obj.world.time } });
}
// a cast the game refuses (nothing to act on): give back what the engine already took
function refuseCast(ab) {
  const u = ab.owner;
  if (u.world.freeSpells) return;
  u.mana = Math.min(u.maxMana, u.mana + ab.manaCost());
  const mc = ab.vals.AbilityCharges || 0;
  if (mc > 0 && ab.charges < mc) { ab.charges++; if (ab.charges >= mc) ab.chargeEnd = 0; }
  ab.cdEnd = 0; ab.casts--; u.mCasts--;
}
defAbility('earth_spirit_boulder_smash', {
  prio: 60,
  ai(ab, u, t) { if (!esSmashWant(ab, u, t) || !esStoneNear(u, u.x, u.y, ab.v('rock_search_aoe'))) return null; ab.data = { x: t.x, y: t.y, at: u.world.time }; const [dx, dy] = dirTo(u, t.x, t.y); return { x: u.x + dx * 100, y: u.y + dy * 100 }; },
  cast(ab, t, x, y) {
    const u = ab.owner; const w = u.world; let obj = t; let dx; let dy;
    if (!obj) {      // ground cast: the nearest unit in the search radius, remnants first
      const r = ab.v('rock_search_aoe');
      obj = esStoneNear(u, u.x, u.y, r) || esPetrified(u).find((e) => e !== u && u.distTo(e) <= r)
        || w.units.filter((e) => e !== u && e.alive && e.st[ST.OUT] === 0 && e.st[ST.INVULN] === 0 && !e.isBuilding && !(e.team !== u.team && e.isImmune()) && u.distTo(e) <= r).sort((a, b) => u.distTo(a) - u.distTo(b))[0];
      if (!obj) return;
      const aim = ab.data && w.time - ab.data.at < 0.2 ? ab.data : null;      // the controller aims the remnant itself at its target
      [dx, dy] = aim ? dirTo(obj, aim.x, aim.y) : dirTo(u, x, y);
    } else [dx, dy] = dirTo(u, obj.x, obj.y);
    const rem = esRemnantLike(u, obj); const D = rem ? ab.v('rock_distance') : ab.v('unit_distance'); const sp = ab.v('speed');
    const x1 = obj.x; const y1 = obj.y; const x2 = x1 + dx * D; const y2 = y1 + dy * D;
    const smash = (e) => { if (!e.alive) return; hit(ab, e, ab.v('rock_damage') * (e.heroLike ? 1 : ab.v('creep_multiplier')), MAGICAL); if (rem && e.alive) addMod(ab, e, 'modifier_earth_spirit_boulder_smash_debuff', ab.v('duration')); };
    const struck = enemiesInLine(ab, x1, y1, x2, y2, ab.v('radius') * 2).filter((e) => e !== obj && !e.isBuilding);
    // [L] measured in Hero Demo: a kicked enemy takes the damage itself, at once (no slow, no stun)
    if (!rem && obj.team !== u.team) hit(ab, obj, ab.v('rock_damage') * (obj.heroLike ? 1 : ab.v('creep_multiplier')), MAGICAL);
    for (const e of struck) w.after(Math.max(0, Math.hypot(e.x - x1, e.y - y1) - ab.v('radius') - e.def.hull) / sp, () => smash(e));
    esShare(u, struck, smash);
    esGlide(obj, x2, y2, D / sp);
    if (rem) esUsedStone(u);
  },
  fid: 'approx', note: 'the kicked unit or remnant travels at `speed` to the end point; enemies on the travel line at cast time are hit when it reaches them; a kicked enemy takes rock_damage itself at once (live) and is otherwise only displaced; no facing: a targeted unit flies away from Earth Spirit, a ground cast goes towards the point. AI only smashes remnants',
});

// Rolling Boulder: rooted and disarmed from the cast, invulnerable while rolling; the roll is stepped every tick
buff(ES_ROLL, { purge: 'none', state: ['DISARM', 'ROOT'] });
const ES_ROLLING = 'modifier_earth_spirit_rolling_boulder_roll';
function esRollEnd(m) {
  const u = m.parent; const ab = m.ability; const w = u.world;
  m.remove(); u.removeModifierByName(ES_ROLL);
  if (!w.freeSpells) ab.cdEnd = w.time + ab.cooldown();                               // the cooldown restarts when the roll ends (live: ready 4 s after the roll)
}
modifier(ES_ROLLING, {
  hidden: true, purge: 'none', state: ['INVULN', 'UNTARGETABLE'], interval: (m) => m.parent.world.dt,
  onThink(m) {
    const u = m.parent; const ab = m.ability; const w = u.world; const d = m.data; const r = ab.v('radius');
    const step = Math.min(d.left, d.speed * w.dt);
    u.x += d.dx * step; u.y += d.dy * step; d.left -= step; d.gone += step;
    if (!d.stone) {      // rolling over a remnant (or an enchanted hero): further, faster, longer stun
      const s = [...esStones(u), ...esPetrified(u)].find((x) => x !== u && Math.hypot(x.x - u.x, x.y - u.y) <= r + x.def.hull);
      if (s) {
        d.stone = true; d.left = Math.max(0, ab.v('distance') * ab.v('rock_distance_multiplier') - d.gone); d.speed = ab.v('rock_speed');
        if (s.name === ES_STONE && ab.v('destroy_stone') > 0) w.kill(s, null, null, true);
        esUsedStone(u);
      }
    }
    const dmg = ab.v('damage') + u.str * ab.v('damage_str') / 100; const dur = ab.v('stun_duration') + (d.stone ? ab.v('rock_bonus_duration') : 0);
    let bump = null;
    for (const e of w.units) {
      if (!e.alive || e.team === u.team || e.isBuilding || e.st[ST.OUT] > 0 || d.seen.has(e)) continue;
      if (Math.hypot(e.x - u.x, e.y - u.y) > r + e.def.hull + u.def.hull) continue;
      d.seen.add(e);
      hit(ab, e, dmg, MAGICAL); if (e.alive) stun(ab, e, dur);
      if (e.isHero && !bump) bump = e;
    }
    if (bump) {      // [L] measured in Hero Demo: he stops at the first enemy hero and ends up 80 units past it
      u.x = bump.x + d.dx * 80; u.y = bump.y + d.dy * 80;
      esRollEnd(m);
    } else if (d.left <= 1e-6) esRollEnd(m);
  },
});
function esRoll(ab, x, y) {
  const u = ab.owner; const [dx, dy] = dirTo(u, x, y);
  if (!u.hasModifier(ES_ROLL)) u.addModifier(ES_ROLL, { ability: ab });
  u.addModifier(ES_ROLLING, { ability: ab, data: { dx, dy, left: ab.v('distance'), gone: 0, speed: ab.v('speed'), stone: false, seen: new Set() } });
}
defAbility('earth_spirit_rolling_boulder', {
  prio: 72, ai: (ab, u, t) => (esRollWant(ab, u, t) ? { x: t.x, y: t.y } : null), channel: (ab) => ab.v('delay'),
  cast(ab, t, x, y) { ab.data = { x, y }; ab.owner.addModifier(ES_ROLL, { ability: ab }); },
  channelEnd(ab, interrupted) { const u = ab.owner; if (u.alive && !(interrupted && u.isDisabled()) && ab.data) esRoll(ab, ab.data.x, ab.data.y); else u.removeModifierByName(ES_ROLL); },
  fid: 'approx', note: 'wind-up modelled as a channel that only a stun cancels (rooted and disarmed from the cast, live); then he rolls `distance` in the cast direction at `speed`, invulnerable and untargetable, damaging and stunning every enemy within radius + both collision sizes once; he stops at the first enemy hero and is placed 80 units past it (live); a remnant on the way doubles the total distance, switches to rock_speed and lengthens the stuns that follow; the cooldown restarts when the roll ends (live)',
});

defAbility('earth_spirit_geomagnetic_grip', {
  prio: 68, ai: (ab, u, t) => { const s = esGripWant(ab, u, t) && esGripStone(ab, u, t); return s ? { target: s } : null; },
  cast(ab, t, x, y) {
    const u = ab.owner; const w = u.world; const obj = t || esStoneNear(u, x, y, ab.v('radius'));
    // [L] measured in Hero Demo: with nothing to pull at the point the order is refused (no mana, no cooldown)
    if (!obj || obj === u) { refuseCast(ab); return; }
    const rem = esRemnantLike(u, obj);
    if (!rem && (obj.team !== u.team || u.distTo(obj) > ab.v('cast_range_heroes') + u.castRangeBonus || obj.st[ST.ROOT] > 0 || obj.st[ST.LEASH] > 0)) { refuseCast(ab); return; }
    const [dx, dy, d] = dirTo(obj, u.x, u.y); const D = Math.max(0, Math.min(d - 80, ab.v('total_pull_distance'))); const sp = rem ? ab.v('pull_units_per_second') : ab.v('pull_units_per_second_heroes');
    const x1 = obj.x; const y1 = obj.y; const x2 = x1 + dx * D; const y2 = y1 + dy * D;
    const grip = (e) => { if (!e.alive) return; silence(ab, e, ab.v('duration')); if (rem) hit(ab, e, ab.v('rock_damage'), MAGICAL); };
    const struck = enemiesInLine(ab, x1, y1, x2, y2, ab.v('radius') * 2).filter((e) => e !== obj && !e.isBuilding);
    for (const e of struck) w.after(Math.max(0, Math.hypot(e.x - x1, e.y - y1) - ab.v('radius') - e.def.hull) / sp, () => grip(e));
    esShare(u, struck, grip);
    esGlide(obj, x2, y2, D / sp);
    if (rem) esUsedStone(u);
  },
  fid: 'approx', note: 'enemies on the pull line at cast time are silenced (and damaged by a remnant) when the pulled object reaches them; it travels at the pull speed and stops next to Earth Spirit; a cast with nothing to pull is refused (live). AI only pulls remnants it placed on the target; pulling allies works on an explicit order (shorter range checked in the script)',
});

// [L] measured in Hero Demo: the enchanted hero is stunned, invulnerable, attack immune and out of play, and takes no shatter damage itself
debuff(ES_PET, { state: ['STUN', 'INVULN', 'ETHEREAL', 'OUT'], purge: 'none', statusResist: false, onDestroy(m) { esShatter(m.ability, m.parent.x, m.parent.y, m.parent); } });
function esShatter(ab, x, y, skip) { for (const e of enemiesNear(ab, x, y, ab.v('aoe'))) if (!e.isBuilding && e !== skip) hit(ab, e, ab.v('damage'), MAGICAL); }
defAbility('earth_spirit_petrify', {
  prio: 74, ai: (ab, u, t) => { const s = esPetWant(ab, u, t) && esPetStone(ab, u, t); return s ? { target: s } : null; },
  cast(ab, t) {
    const u = ab.owner; const w = u.world;
    if (!t) return;
    if (t.name === ES_STONE) {
      esData(u).ench.add(t); esUsedStone(u);
      if (!w.freeSpells) ab.cdEnd = w.time + 5 * u.cdrMul;                             // "Has a 5 second cooldown when used that way" (tooltip text, not a value)
      w.after(ab.v('duration'), () => { if (t.alive) { esShatter(ab, t.x, t.y); w.kill(t, null, null, true); } });
    } else if (t.heroLike) addMod(ab, t, ES_PET, ab.v('duration'));
  },
  fid: 'approx', note: 'an enchanted hero is stunned, invulnerable and out of play, counts as a remnant for Boulder Smash / Grip / Rolling Boulder, and the shatter damages the enemies around it but not the hero itself (live); on a remnant the 5 s cooldown comes from the tooltip text. AI uses it on remnants only',
});

// [L] measured in Hero Demo: Magnetize ticks every 0.5 s for half of damage_per_second (the data value damage_interval = 1 is not what the game uses)
const ES_MAG_TICK = 0.5;
debuff(ES_MAG, { pierce: true, keepLonger: true, interval: ES_MAG_TICK, onThink(m) { mhit(m, m.parent, m.v('damage_per_second') * ES_MAG_TICK, MAGICAL); } });
const esMagnetize = (ab, e, dur) => { if (!e.isBuilding) e.addModifier(ES_MAG, { caster: ab.owner, ability: ab, duration: dur + 0.05 }); };
buff('modifier_earth_spirit_magnetize_self', {
  purge: 'none', interval: 0.2,
  onThink(m) { const u = m.parent; for (const e of enemiesNear(m.ability, u.x, u.y, m.v('cast_radius'))) if (e.isHero && !e.hasModifier(ES_MAG)) e.addModifier(ES_MAG, { caster: u, ability: m.ability, duration: Math.max(0.1, m.remaining()) }); },
});
// magnetized heroes set off remnants near them: the remnant refreshes Magnetize around itself once and is destroyed after the delay
modifier('modifier_earth_spirit_magnetize_watch', {
  hidden: true, purge: 'none', interval: 0.2,
  onThink(m) {
    const u = m.parent; const ab = m.ability; const w = u.world; const d = esData(u);
    if (!d.stones.length) return;
    const self = u.findModifier('modifier_earth_spirit_magnetize_self'); const heroes = esMagnetized(u); if (self) heroes.push(u);
    if (!heroes.length) return;
    for (const s of d.stones) {
      if (d.used.has(s) || !heroes.some((h) => Math.hypot(h.x - s.x, h.y - s.y) <= ab.v('rock_search_radius'))) continue;
      d.used.add(s); s.lifeEnd = Math.min(s.lifeEnd, w.time + ab.v('rock_explosion_delay'));
      for (const e of w.enemiesInRadius(u, s.x, s.y, ab.v('rock_explosion_radius'))) esMagnetize(ab, e, ab.v('damage_duration'));
      if (self && Math.hypot(u.x - s.x, u.y - s.y) <= ab.v('rock_explosion_radius')) self.setDuration(ab.v('damage_duration'));
    }
  },
});
defAbility('earth_spirit_magnetize', {
  mods: ['modifier_earth_spirit_magnetize_watch'], prio: 85, ai: (ab, u, t) => (t && enemiesNear(ab, u.x, u.y, ab.v('cast_radius') - 25).some((e) => e.isHero && !e.isIllusion) ? {} : null),
  cast(ab) { const u = ab.owner; for (const e of enemiesNear(ab, u.x, u.y, ab.v('cast_radius'))) esMagnetize(ab, e, ab.v('damage_duration')); if (ab.v('magnetize_self') > 0) addMod(ab, u, 'modifier_earth_spirit_magnetize_self', ab.v('damage_duration')); },
  fid: 'approx', note: 'a remnant within rock_search_radius of a magnetized hero refreshes/applies Magnetize to all enemies within rock_explosion_radius once and disappears rock_explosion_delay seconds later (timing taken from the value name; the tooltip only says it is destroyed); silence_duration / slow_duration values have no tooltip and are not used',
});

// ================================================================ Nature's Prophet
const FUR_TREANT = 'npc_dota_furion_treant';
const furIsTreant = (e) => e.name === FUR_TREANT || e.name === 'npc_dota_furion_treant_large';
// Spirit of the Forest: bonus base damage per treant near the attack target (trees do not exist in the sandbox)
function furSpirit(sp, attacker, rec) {
  const t = rec.target; const r = sp.v('radius_base'); let n = 0;
  for (const e of attacker.world.units) if (e.alive && e !== attacker && e.team === attacker.team && furIsTreant(e) && e.distTo(t) <= r) n++;
  if (n > 0) rec.flat += rec.white * sp.v('damage_per_tree_pct') * sp.v('multiplier') * n / 100;
}
// Curse of the Oldgrowth: one curse per attacker on each enemy, refreshed by that attacker
debuff('modifier_furion_curse_of_the_forest_debuff', { multi: 'perCaster', interval: 1, stats: (m) => ({ msPct: -m.data.slow }), onThink(m) { mhit(m, m.parent, m.data.dps, MAGICAL); } });
function furCurse(owner, attacker, t, treant) {
  const c = hasLvl(owner, 'furion_curse_of_the_forest');
  if (!c || !t.alive || t.isBuilding || t.team === attacker.team) return;
  t.addModifier('modifier_furion_curse_of_the_forest_debuff', { caster: attacker, ability: c, duration: c.v('duration') + 0.05, data: { dps: c.v(treant ? 'treant_damage_per_second' : 'damage_per_second'), slow: c.v(treant ? 'treant_slow' : 'slow') } });
}
debuff('modifier_furion_sprout_trap', {
  hidden: true, purge: 'none', statusResist: false, pierce: true, interval: (m) => m.parent.world.dt, thinkNow: true,
  onThink(m) { const e = m.parent; if (m.z === 0) { m.z = 1; m.x = e.x; m.y = e.y; return; } if (Math.hypot(e.x - m.x, e.y - m.y) > 1) { e.x = m.x; e.y = m.y; } },
});
defAbility('furion_sprout', {
  prio: 60, ai: (ab, u, t) => (t && !t.hasModifier('modifier_furion_sprout_trap') ? { x: t.x, y: t.y } : null),
  cast(ab, t, x, y) {
    const u = ab.owner; const cx = t ? t.x : x; const cy = t ? t.y : y;
    for (const e of u.world.units) if (e.alive && e !== u && !e.isBuilding && e.st[ST.OUT] === 0 && (e === t || Math.hypot(e.x - cx, e.y - cy) <= 50)) e.addModifier('modifier_furion_sprout_trap', { caster: u, ability: ab, duration: ab.v('duration'), pierce: true });
    for (const e of enemiesNear(ab, cx, cy, ab.v('sprout_damage_radius'))) if (!e.isBuilding) hit(ab, e, ab.v('sprout_damage'), MAGICAL);
  },
  fid: 'approx', note: 'the ring traps the targeted unit (ground cast: units within 50 of the centre; the ring radius is not in the data) = it is held in place for the duration without a root state (live: trees, not a root); trees cannot be cut and nothing escapes; vision not modelled',
});
na('furion_teleportation', 'map movement (3 s cast, global teleport); it has no combat values since the barrier was removed');
modifier('modifier_furion_force_of_nature_treant', {
  hidden: true, purge: 'none',
  onAttack(m, rec) { const o = m.caster; if (rec.target.heroLike) rec.flat += m.v('treant_bonus_hero_damage'); const sp = hasLvl(o, 'furion_spirit_of_the_forest'); if (sp) furSpirit(sp, m.parent, rec); },
  onAttackLanded(m, rec) { furCurse(m.caster, m.parent, rec.target, true); },
});
defAbility('furion_force_of_nature', {
  prio: 65, ai: (ab, u, t) => (t ? { x: t.x, y: t.y } : null),
  cast(ab, t, x, y) {
    if (ab.owner.world.fresh) { refuseCast(ab); return; }      // [L] measured in Hero Demo: no trees at the point = the order is refused
    const u = ab.owner; const n = ab.v('max_treants'); const dmg = ab.v('treant_damage'); const r = ab.v('area_of_effect') / 2; const a0 = u.world.rng.next() * TAU;
    for (let i = 0; i < n; i++) {
      const tr = u.world.summon(u, FUR_TREANT, { x: x + Math.cos(a0 + TAU * i / n) * r, y: y + Math.sin(a0 + TAU * i / n) * r, duration: ab.v('treant_duration'), ovr: { hp: ab.v('treant_health'), dmgMin: dmg, dmgMax: dmg, armor: ab.v('treant_armor'), ms: ab.v('treant_movespeed') } });
      tr.addModifier('modifier_furion_force_of_nature_treant', { caster: u, ability: ab });
    }
  },
  fid: 'approx', note: 'no trees in the sandbox: outside rules.fresh the target area is assumed to hold enough trees for max_treants (under rules.fresh the cast is refused, as in the treeless test arena); treant damage has no spread (not in the data); treants carry Spirit of the Forest and, with the Shard, Curse of the Oldgrowth',
});
passive('furion_curse_of_the_forest', { onAttackLanded(m, rec) { furCurse(m.parent, m.parent, rec.target, false); }, fid: 'full' });
passive('furion_spirit_of_the_forest', {
  onAttack(m, rec) { furSpirit(m.ability, m.parent, rec); },
  fid: 'partial', note: 'only treants near the target are counted (x multiplier); map trees and Sprout trees are not (no terrain, and the number of trees in a Sprout ring is not in the data)',
});
debuff('modifier_furion_wrath_of_nature_entangle', { state: ['ROOT'] });
defAbility('furion_wrath_of_nature', {
  prio: 72, ai: (ab, u, t) => (t && u.world.units.some((e) => e.alive && e.team !== u.team && e.isHero && !e.isIllusion && !e.isImmune() && e.st[ST.OUT] === 0) ? { x: t.x, y: t.y } : null),
  cast(ab, t, x, y) {
    const u = ab.owner; const w = u.world; const cx = t ? t.x : x; const cy = t ? t.y : y;
    const list = w.units.filter((e) => e.alive && e.team !== u.team && !e.isBuilding && e.st[ST.OUT] === 0 && e.st[ST.INVULN] === 0 && !e.isImmune()).sort((a, b) => Math.hypot(a.x - cx, a.y - cy) - Math.hypot(b.x - cx, b.y - cy));
    const N = ab.v('max_targets'); const lo = ab.v('scepter_min_entangle_duration'); const hi = ab.v('scepter_max_entangle_duration');
    list.forEach((e, i) => w.after(i * ab.v('jump_delay'), () => {
      if (!e.alive) return;
      const k = Math.min(i, N - 1);
      hit(ab, e, ab.v('damage') * Math.pow(1 + ab.v('damage_percent_add') / 100, k), MAGICAL);
      if (hi > 0 && e.alive) addMod(ab, e, 'modifier_furion_wrath_of_nature_entangle', lo + (hi - lo) * (N > 1 ? k / (N - 1) : 1));
    }));
  },
  fid: 'approx', note: 'every enemy unit is "in vision"; hit order = distance from the cast point; the per-bounce bonus compounds (x(1 + damage_percent_add%) per earlier hit, capped after max_targets); Scepter root time grows linearly from min to max over max_targets hits; debuff-immune units are skipped',
});

// ================================================================ Clinkz
const CLINKZ_ARCHER = 'npc_dota_clinkz_skeleton_archer';
const CLINKZ_SHRED = 'modifier_clinkz_infernal_shred_debuff';
// Infernal Shred: stacks = % of the target's armor that attacks of Clinkz and his skeletons ignore
debuff(CLINKZ_SHRED, { multi: 'stack', purge: 'none', maxStacks: (m) => m.v('max_armor_piercing_pct') });
const clinkzPierce = (rec) => { const t = rec.target; const d = t.findModifier(CLINKZ_SHRED); if (d && t.armor > 0) rec.pierceArmor += t.armor * d.stacks / 100; };
function clinkzShred(owner, t, key) { const a = hasLvl(owner, 'clinkz_infernal_shred'); if (a && t.alive && owner.st[ST.BREAK] === 0) t.addModifier(CLINKZ_SHRED, { caster: owner, ability: a, duration: a.v('duration'), stacks: a.v(key) }); }
modifier('modifier_clinkz_infernal_shred', { hidden: true, purge: 'none', breakable: false, onAttack(m, rec) { clinkzPierce(rec); }, onAttackLanded(m, rec) { clinkzShred(m.parent, rec.target, 'hero_stacks'); } });
defAbility('clinkz_infernal_shred', { mods: ['modifier_clinkz_infernal_shred'], fid: 'full', note: 'Break only stops new stacks; the armor piercing is read when the attack is launched' });

passive('clinkz_searing_arrows', {
  ...orbHooks({
    buildings: true,
    launch(m, rec) {
      const u = m.parent; rec.flat += m.v('damage_bonus');
      if (m.v('has_multishot') <= 0 || rec.fromAbility) return;                     // talent: one more arrow at a random enemy in attack range
      const others = u.world.units.filter((e) => e.alive && e.team !== u.team && e !== rec.target && e.attackableBy(u) && u.rangeTo(e) <= u.attackRange);
      if (others.length) u.world.launchAttack(u, others[u.world.rng.int(0, others.length - 1)], { fromAbility: m.ability });
    },
  }),
  fid: 'full', note: 'autocast assumed on (each arrow spends mana); the Multishot talent arrow is a full Searing attack that cannot multishot again',
});

// Skeleton Archers (Skeleton Walk / Burning Army)
modifier('modifier_clinkz_wind_walk_archer', {
  hidden: true, purge: 'none', interval: 0.25, thinkNow: true, postMit: pipHit,
  stats: (m) => { const s = m.y === 1 && m.caster.findModifier('modifier_clinkz_strafe'); return s ? { as: s.v('attack_speed_bonus') * s.v('archer_attack_speed_pct') / 100, attackRange: s.v('attack_range_bonus') } : {}; },
  onThink(m) {      // range follows Clinkz; shoot what Clinkz attacks, else the nearest enemy in reach
    const a = m.parent; const o = m.caster; const s = o.findModifier('modifier_clinkz_strafe');
    const base = o.attackRange - (s ? s.v('attack_range_bonus') : 0); const on = s && a.distTo(o) <= s.v('strafe_skeleton_radius') ? 1 : 0;
    if (a.ovr.range !== base || m.y !== on) { a.ovr.range = base; m.y = on; a.recompute(); }
    // [L] measured in Hero Demo: archers do not pick targets themselves, they only shoot what Clinkz attacks
    const ok = (e) => e && e.alive && e.team !== a.team && e.attackableBy(a) && a.rangeTo(e) <= a.attackRange;
    const t = o.alive && o.order === 1 && ok(o.orderTarget) ? o.orderTarget : null;      // 1 = attack order
    if (t) { if (a.orderTarget !== t) a.attack(t); } else if (a.orderTarget) a.stop();
  },
  onAttack(m, rec) {
    const o = m.caster; const k = m.v('damage_percent') / 100; const sa = hasLvl(o, 'clinkz_searing_arrows');
    rec.white = (o.dmgMin + o.dmgMax) / 2 * k; rec.green = o.dmgBonus * k;
    if (sa) rec.flat += sa.v('damage_bonus') * sa.v('skeleton_damage_pct') / 100;
    if (rec.target.isBuilding) rec.mult *= 1 - m.v('skeleton_building_damage_reduction') / 100;
    clinkzPierce(rec);
  },
  onAttackLanded(m, rec) { clinkzShred(m.caster, rec.target, 'skeleton_stacks'); },
});
function clinkzArcher(u, x, y) {
  const ww = u.findAbility('clinkz_wind_walk');
  if (!ww) return null;                                                          // archers take their values from Skeleton Walk
  const a = u.world.summon(u, CLINKZ_ARCHER, { x, y, duration: ww.v('skeleton_duration'), ai: 'idle', ovr: { hp: ww.v('skeleton_health'), bat: ww.v('attack_rate'), range: u.attackRange, dmgMin: 0, dmgMax: 0 } });
  for (const ab of a.abilities) if (ab.level > 0) ab.setLevel(0);                 // the unit's own Searing Arrows / Burning Barrage copies are not used
  a.addModifier('modifier_clinkz_wind_walk_archer', { caster: u, ability: ww });
  return a;
}
const CLINKZ_ARCHER_NOTE = 'archers: immobile summons with pip health (only attacks hurt them: hero 1 pip, creep/illusion 1/4), damage = damage_percent of Clinkz\'s current average attack damage + skeleton_damage_pct of the Searing Arrows bonus, they shoot Clinkz\'s attack target when it is in reach';
buff('modifier_clinkz_strafe', { stats: { as: 'attack_speed_bonus', attackRange: 'attack_range_bonus' } });
selfBuff('clinkz_strafe', {
  prio: 60, mod: 'modifier_clinkz_strafe', duration: 'duration', engage: false,
  ai: (ab, u, t) => (t && !u.hasModifier('modifier_clinkz_strafe') && u.rangeTo(t) <= u.attackRange + ab.v('attack_range_bonus') ? {} : null),
  fid: 'full', note: 'archers within strafe_skeleton_radius get the range and their share of the attack speed for as long as Clinkz has the buff (also archers created later)',
});
buff('modifier_clinkz_death_pact', { purge: 'none', stats: { hp: 'health_gain' }, onDestroy(m) { const u = m.parent; if (!u.alive) return; const hp = u.hp; u.recompute(); u.hp = Math.min(hp, u.maxHp); } });
const clinkzPactTarget = (ab, u, e) => e.alive && e.st[ST.OUT] === 0 && e.st[ST.INVULN] === 0 && (e.team === u.team ? e.name === CLINKZ_ARCHER && e.owner === u : !e.heroLike && !e.isBuilding && !e.def.ancient && e.def.atk !== 'none' && e.level <= ab.v('creep_level') && !e.isImmune());
defAbility('clinkz_death_pact', {
  prio: 50,
  ai(ab, u, t) {
    const has = u.hasModifier('modifier_clinkz_death_pact'); const low = u.hp / u.maxHp < 0.5;
    if (!t || (has && !low)) return null;
    const pick = (enemy) => u.world.units.filter((e) => (e.team !== u.team) === enemy && clinkzPactTarget(ab, u, e) && u.distTo(e) <= ab.castRange() + 150).sort((a, b) => u.distTo(a) - u.distTo(b))[0];
    const c = pick(true) || (low ? pick(false) : null);
    return c ? { target: c } : null;
  },
  cast(ab, t) {
    const u = ab.owner;
    if (!t || !clinkzPactTarget(ab, u, t)) return;
    if (t.team === u.team) u.world.kill(t, null, ab, true); else u.world.kill(t, u, ab);
    u.removeModifierByName('modifier_clinkz_death_pact');
    const hp = u.hp; addMod(ab, u, 'modifier_clinkz_death_pact', ab.v('duration')); u.recompute(); u.hp = Math.min(u.maxHp, hp + ab.v('health_gain'));
  },
  fid: 'approx', note: 'targets: enemy non-ancient creeps up to creep_level, or own Skeleton Archers; AI eats an enemy creep when one is near, an own archer only below 50% health; gold/experience not modelled',
});
buff('modifier_clinkz_burning_barrage', {
  purge: 'none', state: ['DISARM'], interval: (m) => m.v('AbilityChannelTime') / m.v('wave_count'), thinkNow: true,
  onThink(m) {
    const u = m.parent; const len = m.v('range') + (u.attackRange - u.def.range);
    for (const e of enemiesInLine(m.ability, u.x, u.y, u.x + m.data.dx * len, u.y + m.data.dy * len, m.v('projectile_width'))) if (e.attackableBy(u) && !e.isBuilding) u.world.launchAttack(u, e, { instant: true, mult: m.v('damage_pct') / 100, fromAbility: m.ability });
  },
});
defAbility('clinkz_burning_barrage', {
  prio: 55, channel: true, ai: (ab, u, t) => (u.isHero && t && !u.hasModifier('modifier_clinkz_strafe') && u.distTo(t) <= ab.v('range') * 0.9 ? { x: t.x, y: t.y } : null),
  cast(ab, t, x, y) { const u = ab.owner; const [dx, dy] = dirTo(u, x, y); u.addModifier('modifier_clinkz_burning_barrage', { ability: ab, duration: ab.v('AbilityChannelTime') - 0.01, data: { dx, dy } }); },
  channelEnd(ab, interrupted) { if (interrupted) ab.owner.removeModifierByName('modifier_clinkz_burning_barrage'); },
  fid: 'approx', note: 'each arrow hits every enemy on the fixed line instantly (no travel time) as an attack with damage_pct damage and full attack modifiers; line length = range + bonus attack range',
});
defAbility('clinkz_burning_army', {
  prio: 80,
  ai(ab, u, t) { if (!t) return null; const half = ab.v('range') / 2; const k = Math.sqrt(Math.max(0, u.attackRange * u.attackRange - half * half)) / 2; const [dx, dy, d] = dirTo(u, t.x, t.y); return d <= ab.castRange() + u.attackRange ? { x: t.x - dx * Math.min(k, d), y: t.y - dy * Math.min(k, d) } : null; },
  cast(ab, t, x, y) {
    const u = ab.owner; const w = u.world; const [dx, dy] = dirTo(u, x, y); const n = ab.v('count'); const len = ab.v('range');
    for (let i = 0; i < n; i++) w.after(i * ab.v('spawn_interval'), () => { if (!u.alive) return; const k = (n > 1 ? i / (n - 1) - 0.5 : 0) * len; clinkzArcher(u, x - dy * k, y + dx * k); });
  },
  fid: 'approx', note: 'vector targeting: the row is laid across the line from Clinkz to the cast point; the AI centres it short of the target so every archer is in range; archer stats come from Skeleton Walk\'s current level (level 1 values if it is not learned). ' + CLINKZ_ARCHER_NOTE,
});
modifier('modifier_clinkz_wind_walk_invis', { hidden: true, purge: 'none', state: ['INVIS'] });
buff('modifier_clinkz_wind_walk', {
  purge: 'none', stats: { msPct: 'move_speed_bonus_pct' },
  // the speed comes at once, the invisibility after fade_time (live: invisible 0.6 s after the cast)
  onCreated(m) { const u = m.parent; u.world.after(m.v('fade_time'), () => { if (!m.removed && u.alive) u.addModifier('modifier_clinkz_wind_walk_invis', { ability: m.ability, duration: m.remaining() }); }); },
  onAttack(m) { m.remove(); },
  onCast(m, ev) { if (ev.ability.isItem) m.remove(); },
  onDestroy(m) {      // leaving Skeleton Walk creates the archers
    const u = m.parent; const w = u.world;
    u.removeModifierByName('modifier_clinkz_wind_walk_invis');
    if (!u.alive) return;
    const n = m.v('skeleton_count'); const lo = m.v('skeleton_offset_min'); const hi = m.v('skeleton_offset'); const a0 = w.rng.next() * TAU;
    for (let i = 0; i < n; i++) { const r = lo + (hi - lo) * w.rng.next(); clinkzArcher(u, u.x + Math.cos(a0 + TAU * i / n) * r, u.y + Math.sin(a0 + TAU * i / n) * r); }
  },
});
defAbility('clinkz_wind_walk', {
  prio: 85, engage: false, ai: (ab, u, t) => (t && !u.hasModifier('modifier_clinkz_wind_walk') && u.rangeTo(t) <= u.attackRange + 100 ? {} : null),
  cast(ab) { addMod(ab, ab.owner, 'modifier_clinkz_wind_walk', ab.v('duration')); },
  fid: 'approx', note: 'invisible from the cast (no fade time; invisibility only hides units when the scenario turns detectAll off); ends on an attack or item use. AI casts it in attack range and attacks at once, i.e. uses it to raise archers. ' + CLINKZ_ARCHER_NOTE,
});

// ================================================================ Enigma
// Only the lesser eidolon unit has attack data in the pack; armor and health regen per level come from the four unit variants.
const ENI_UNITS = ['npc_dota_lesser_eidolon', 'npc_dota_eidolon', 'npc_dota_greater_eidolon', 'npc_dota_dire_eidolon'];
function eniEidolon(dc, x, y, o = {}) {
  const u = dc.owner; const w = u.world; const tier = w.unitDef(ENI_UNITS[Math.min(ENI_UNITS.length, Math.max(1, dc.level)) - 1]);
  const dmg = dc.v('eidelon_base_damage') + dc.v('eidolon_bonus_damage'); const sp = dc.v('eidolon_damage_spread');
  const e = w.summon(u, ENI_UNITS[0], { x, y, duration: o.duration ?? dc.v('AbilityDuration'), ovr: { hp: o.hp ?? dc.v('eidelon_max_health') + u.hp * dc.v('current_health_pct') / 100, dmgMin: dmg - sp, dmgMax: dmg + sp, ms: dc.v('eidelon_base_movespeed'), mr: dc.v('eidolon_magic_resist'), range: dc.v('eidolon_attack_range'), armor: tier.armor, hpRegen: tier.hpRegen } });
  e.addModifier('modifier_enigma_demonic_conversion_eidolon', { caster: u, ability: dc, data: { split: o.split !== false } });
  if (o.target && e.ai) e.ai.target = o.target;
  return e;
}
modifier('modifier_enigma_demonic_conversion_eidolon', {
  hidden: true, purge: 'none', stats: (m) => ({ as: m.v('eidolon_bonus_attack_speed') }),
  onAttackLanded(m) {      // multiplies once after split_attack_count successful attacks; both are restored to full health
    if (!m.data.split || ++m.x < m.v('split_attack_count')) return;
    m.data.split = false;
    const a = m.parent; const w = a.world; const left = a.lifeEnd - w.time + m.v('life_extension'); a.lifeEnd = w.time + left;
    const c = eniEidolon(m.ability, a.x + 40, a.y + 40, { duration: left, hp: a.ovr.hp, split: false, target: a.ai ? a.ai.target : null });
    a.hp = a.maxHp; c.hp = c.maxHp;
  },
});
debuff('modifier_enigma_malefice', {
  statusResist: false, interval: (m) => m.v('tick_rate'), thinkNow: true,
  onThink(m) {
    const t = m.parent; const u = m.caster; const hero = t.isHero && !t.isIllusion; const x = t.x; const y = t.y;
    mhit(m, t, m.v('damage'), MAGICAL);
    if (t.alive) t.addModifier('modifier_stunned', { caster: u, ability: m.ability, duration: m.v('stun_duration') });
    const dc = u.findAbility('enigma_demonic_conversion');
    if (hero && dc && u.alive) for (let i = 0; i < m.v('eidolon_spawns_per_tick'); i++) eniEidolon(dc, x + 60, y + 60 * i, { split: false, target: t.alive ? t : null });
    if (++m.x >= m.v('stun_instances')) m.remove();
  },
});
defAbility('enigma_malefice', {
  prio: 70,
  cast(ab, t) { if (!t) return; t.removeModifierByName('modifier_enigma_malefice'); addMod(ab, t, 'modifier_enigma_malefice', (ab.v('stun_instances') - 1) * ab.v('tick_rate') + 0.1); },
  fid: 'full', note: 'the first instance strikes on cast; Shard eidolons use Demonic Summoning\'s current values (level 1 values if it is not learned), last its full duration and cannot multiply',
});
defAbility('enigma_demonic_conversion', {
  // [L] measured in Hero Demo: the health cost is a damage instance on Enigma (HP removal), so it is dealt by the script, not paid by the engine
  mods: [sync('enigma_demonic_conversion', (ab) => { if (ab.vals.AbilityHealthCost > 0) { ab.data = { hc: ab.vals.AbilityHealthCost }; ab.vals.AbilityHealthCost = 0; } })],
  prio: 65, ai: (ab, u, t) => { if (!t || u.hp / u.maxHp < 0.2) return null; const [dx, dy] = dirTo(u, t.x, t.y); return { x: u.x + dx * 100, y: u.y + dy * 100 }; },
  cast(ab, t, x, y) { const hc = ab.data && ab.data.hc; if (hc > 0 && !ab.owner.world.freeSpells) ab.owner.world.damage(ab.owner, ab.owner, Math.min(hc, ab.owner.hp - 1), PURE, F_HP_LOSS | F_NO_AMP | F_NON_LETHAL, ab); const n = ab.v('spawn_count'); const r = ab.v('spawn_offset'); for (let i = 0; i < n; i++) eniEidolon(ab, x + Math.cos(TAU * i / n) * r, y + Math.sin(TAU * i / n) * r, { target: aiTarget(ab.owner) }); },
  fid: 'approx', note: 'each summoned eidolon multiplies once (after split_attack_count landed attacks); the copy cannot multiply (the tooltip gives no limit) and both get life_extension seconds added; all levels use the lesser eidolon unit\'s attack timing (the other variants have no attack data in the pack)',
});
defAbility('enigma_midnight_pulse', {
  prio: 55, ai: (ab, u, t) => (t && !(ab.data > u.world.time) ? { x: t.x, y: t.y } : null),
  cast(ab, t, x, y) {
    const tk = ab.v('tick_rate'); ab.data = ab.owner.world.time + ab.v('duration');
    // [L] measured in Hero Demo: damage_percent is of MAX health; the first hit lands tick_rate after the cast and there are duration / tick_rate + 1 hits
    zone(ab, x, y, { radius: 'radius', duration: ab.v('duration') + tk, delay: tk, interval: tk, tick: (e) => { if (!e.isBuilding) hit(ab, e, (ab.v('base_damage') + e.maxHp * ab.v('damage_percent') / 100) * tk, MAGICAL); } });
  },
  fid: 'full', note: 'per second: base_damage + damage_percent% of max health, dealt every tick_rate from tick_rate after the cast (duration / tick_rate + 1 hits, live); the AI does not overlap two pulses',
});
debuff('modifier_enigma_event_horizon_slow', { purge: 'none', statusResist: false, stats: (m) => ({ msPct: -m.v('speed_bonus') }) });
passive('enigma_event_horizon', {
  interval: 0.1, onCreated(m) { m.data = new Map(); },
  onThink(m) {      // "moving away" = the unit's own displacement since the last check points away from Enigma
    const u = m.parent; const now = new Map();
    for (const e of u.world.inRadius(u.x, u.y, m.v('radius'), u.team, true)) {
      const p = m.data.get(e); now.set(e, [e.x, e.y]);
      if (p && !e.cantAct() && (e.x - p[0]) * (e.x - u.x) + (e.y - p[1]) * (e.y - u.y) > 1e-6) e.addModifier('modifier_enigma_event_horizon_slow', { caster: u, ability: m.ability, duration: 0.25 });
    }
    m.data = now;
  },
  fid: 'approx', note: 'enemies only; movement direction is taken from the position change every 0.1 s; units that cannot act (stunned, pulled by Black Hole) are not slowed (live)',
});
debuff('modifier_enigma_black_hole_pull', { state: ['STUN', 'SILENCE'], purge: 'none', statusResist: false, pierce: true });
const ENI_BH_DMG_STEP = 29 / 30;      // [L] measured in Hero Demo: one hit of a full second's damage every 29 server frames, the first 1 s after the cast
buff('modifier_enigma_black_hole', {
  purge: 'none', interval: (m) => m.v('tick_rate'), thinkNow: true,
  onThink(m) {
    const u = m.parent; const w = u.world; const tk = m.v('tick_rate'); const { x, y } = m.data; const inside = new Set();
    for (const e of w.enemiesInRadius(u, x, y, m.v('radius'))) {
      if (e.isBuilding || e.st[ST.INVULN] > 0) continue;
      inside.add(e);
      e.addModifier('modifier_enigma_black_hole_pull', { caster: u, ability: m.ability, duration: tk + 0.05 });
      knockback(e, x, y, -m.v('pull_speed') * tk);
    }
    if (m.z === 0) m.z = m.created + ENI_BH_DMG_STEP;
    if (w.time + 0.02 >= m.z) { m.z += ENI_BH_DMG_STEP; for (const e of inside) if (e.alive) mhit(m, e, m.v('damage') + e.maxHp * m.v('scepter_pct_damage') / 100, PURE); }
    const sr = m.v('scepter_radius');
    if (sr > 0) for (const e of w.enemiesInRadius(u, x, y, sr)) if (!inside.has(e) && !e.isBuilding && e.st[ST.INVULN] === 0) knockback(e, x, y, -m.v('scepter_drag_speed') * tk);
  },
});
defAbility('enigma_black_hole', {
  prio: 90, channel: true,
  ai(ab, u, t) {      // steps in for it only after the other spells are out (or when the target is already close)
    if (!t || !t.isHero || t.isIllusion) return null;
    const busy = ['enigma_malefice', 'enigma_demonic_conversion', 'enigma_midnight_pulse'].some((n) => { const a = hasLvl(u, n); return a && a.ready(); });
    return u.distTo(t) <= ab.castRange() + (busy ? 100 : ab.v('radius')) ? { x: t.x, y: t.y } : null;
  },
  cast(ab, t, x, y) { ab.owner.addModifier('modifier_enigma_black_hole', { ability: ab, duration: ab.v('duration') - 0.01, data: { x, y } }); },
  channelEnd(ab, interrupted) { if (interrupted) ab.owner.removeModifierByName('modifier_enigma_black_hole'); },
  fid: 'approx', note: 'enemies inside are stunned and silenced and pulled at pull_speed every tick_rate; damage (per second values, Scepter % of max health) comes as one hit per second (every 29 frames, live: 4 hits in the 4 s channel); the Scepter pull outside the hole is a straight drag at scepter_drag_speed (no rotation)',
});

// ================================================================ Marci
debuff('modifier_marci_grapple_debuff', { stats: (m) => ({ msPct: -m.v('movement_slow_pct') }) });
debuff('modifier_marci_grapple_air', { state: ['STUN'], purge: 'none', statusResist: false });
defAbility('marci_grapple', {
  prio: 62, ai: (ab, u, t) => (t && !t.isImmune() && !t.isBuilding && u.rangeTo(t) <= u.attackRange + 100 ? { target: t } : null),
  cast(ab, t) {
    const u = ab.owner; const w = u.world;
    if (!t || t === u) return;
    const [dx, dy] = dirTo(u, t.x, t.y); const lx = u.x - dx * ab.v('throw_distance_behind'); const ly = u.y - dy * ab.v('throw_distance_behind');
    if (t.team !== u.team) addMod(ab, t, 'modifier_marci_grapple_air', ab.v('air_duration'));
    w.after(ab.v('air_duration'), () => {
      if (!t.alive) return;
      t.x = lx; t.y = ly;
      for (const e of enemiesNear(ab, lx, ly, ab.v('landing_radius'))) { if (e.isBuilding) continue; hit(ab, e, ab.v('impact_damage'), MAGICAL); if (e.alive) addMod(ab, e, 'modifier_marci_grapple_debuff', ab.v('debuff_duration')); }
    });
  },
  fid: 'approx', note: '"behind her" = the point throw_distance_behind on the far side of Marci from the target; a thrown enemy cannot act while in the air (air_duration)',
});
buff('modifier_marci_companion_run_buff', { stats: { msPct: 'ally_movespeed_pct' } });
// unit to bounce off so that the lunge can land on t: any allied unit in cast range (enemies too with the Shard)
function marciSpring(ab, u, t) {
  let best = null; let bd = Infinity;
  for (const e of u.world.units) {
    if (e === u || !e.alive || e.isBuilding || e.st[ST.OUT] > 0 || (e.team !== u.team && (!u.hasShard || e.st[ST.INVULN] > 0 || e.isImmune()))) continue;
    const d = u.distTo(e);
    if (d <= ab.castRange() && d < bd && e.distTo(t) <= ab.v('max_jump_distance') + (e === t ? 0 : ab.v('landing_radius') / 2)) { bd = d; best = e; }
  }
  return best;
}
defAbility('marci_companion_run', {
  prio: 82, ai: (ab, u, t) => { const b = t && marciSpring(ab, u, t); return b ? { target: b } : null; },
  channel: (ab) => (ab.data ? ab.data.t : 0),
  cast(ab, b) {
    const u = ab.owner; ab.data = null;
    if (!b || b === u || (b.team !== u.team && !u.hasShard)) return;
    const t = aiTarget(u) || u.world.enemiesInRadius(u, b.x, b.y, ab.v('max_jump_distance')).sort((p, q) => b.distTo(p) - b.distTo(q))[0] || null;      // lands on her target if the lunge reaches it
    const [ux, uy] = dirTo(u, b.x, b.y); let lx = b.x - ux * (u.def.hull + b.def.hull); let ly = b.y - uy * (u.def.hull + b.def.hull); let jump = 0;
    if (t && t !== b) { const [dx, dy, d] = dirTo(b, t.x, t.y); jump = Math.max(0, Math.min(d - u.def.hull - t.def.hull, ab.v('max_jump_distance'))); lx = b.x + dx * jump; ly = b.y + dy * jump; }
    const lob = ab.v('min_lob_travel_time') + (ab.v('max_lob_travel_time') - ab.v('min_lob_travel_time')) * Math.min(1, jump / ab.v('max_jump_distance'));
    ab.data = { t: u.distTo(b) / ab.v('move_speed') + lob, lx, ly };
    if (b.team === u.team) addMod(ab, b, 'modifier_marci_companion_run_buff', ab.v('ally_buff_duration'));
    if (u.hasShard) addMod(ab, u, 'modifier_marci_companion_run_buff', ab.v('ally_buff_duration'));
  },
  channelEnd(ab) {
    const u = ab.owner; const d = ab.data; ab.data = null;
    if (!d || !u.alive) return;
    u.x = d.lx; u.y = d.ly;
    for (const e of enemiesNear(ab, d.lx, d.ly, ab.v('landing_radius'))) { if (e.isBuilding) continue; hit(ab, e, ab.v('impact_damage'), MAGICAL); if (e.alive) stun(ab, e, ab.v('debuff_duration')); }
  },
  fid: 'partial', note: 'not modelled: the alt-cast that carries the ally along. Modelled: needs another unit to bounce off (an ally; with the Shard also an enemy, including the target itself); the run + lunge is a lock of run distance / move_speed + lob time, then Marci appears at the landing point (her target if within max_jump_distance of the bounce unit) and damages + stuns the landing area; the ally (with the Shard also Marci) gets the speed buff; scepter_heal / scepter_armor values have no tooltip and are not used',
});
// Bodyguard: passive lifesteal + base damage; active shares a share of both plus one barrier pool with an allied hero
modifier('modifier_marci_bodyguard', {
  hidden: true, purge: 'none', stats: (m) => ({ lifesteal: m.v('lifesteal_pct'), dmgBasePct: m.v('bonus_damage') }),
  onAttackLanded(m, rec) { const p = m.ability.data; if (p && p.end > m.parent.world.time && rec.target.isHero && rec.dealt > 0) p.left = Math.min(p.max, p.left + rec.dealt * m.v('shared_barrier_replenish_amount') / 100); },
});
buff('modifier_marci_bodyguard_partner', { stats: (m) => { const k = m.v('max_partner_penalty') / 100; return { lifesteal: m.v('lifesteal_pct') * k, dmgBasePct: m.v('bonus_damage') * k }; } });
buff('modifier_marci_bodyguard_barrier', { postMit: poolAbsorb });
defAbility('marci_bodyguard', {
  mods: ['modifier_marci_bodyguard'], prio: 58,
  ai(ab, u, t) {
    if (!t) return null;
    let best = null;
    for (const a of u.world.units) if (a !== u && a.alive && a.team === u.team && a.isHero && !a.isIllusion && a.st[ST.OUT] === 0 && u.distTo(a) <= ab.castRange() + 150 && (!best || a.hp / a.maxHp < best.hp / best.maxHp)) best = a;
    return best && !best.hasModifier('modifier_marci_bodyguard_partner') ? { target: best } : null;
  },
  cast(ab, t) {
    const u = ab.owner;
    if (!t || t === u || t.team !== u.team) return;
    const dur = ab.v('bodyguard_duration'); const pool = { left: ab.v('shared_barrier'), max: ab.v('shared_barrier'), end: u.world.time + dur }; ab.data = pool;
    if (ab.v('strong_dispel') > 0) for (const x of [u, t]) x.purge({ debuffs: true, strong: true });
    addMod(ab, t, 'modifier_marci_bodyguard_partner', dur);
    for (const x of [u, t]) { x.removeModifierByName('modifier_marci_bodyguard_barrier'); x.addModifier('modifier_marci_bodyguard_barrier', { caster: u, ability: ab, duration: dur, data: pool }); }
  },
  fid: 'approx', note: 'the shared barrier is one pool for both; hero attacks refill it by shared_barrier_replenish_amount% of the damage dealt, never above its starting size (cap assumed); it stays for the full duration even when emptied',
});
na('marci_special_delivery', 'courier ability (economy)');
// Unleash: Fury combos (charges_per_flurry strikes at +flurry_bonus_attack_speed without the attack speed cap), a pulse on the last strike, then a pause
debuff('modifier_marci_unleash_pulse_debuff', { stats: (m) => ({ msPct: -m.v('pulse_move_slow_pct'), asSlow: -m.v('pulse_attack_slow_pct') }) });
function marciPulse(ab, x, y) {
  for (const e of enemiesNear(ab, x, y, ab.v('pulse_radius'))) {
    if (e.isBuilding) continue;
    hit(ab, e, ab.v('pulse_damage'), MAGICAL);
    if (!e.alive) continue;
    addMod(ab, e, 'modifier_marci_unleash_pulse_debuff', ab.v('pulse_debuff_duration'));
    if (ab.v('pulse_silence_duration') > 0) silence(ab, e, ab.v('pulse_silence_duration'));
  }
}
function marciFuryEnd(m) { const u = m.parent; const ab = m.ability; m.remove(); if (u.alive && u.hasModifier('modifier_marci_unleash')) u.addModifier('modifier_marci_unleash_flurry_cooldown', { ability: ab, duration: ab.v('time_between_flurries') }); }
buff('modifier_marci_unleash_flurry', {
  purge: 'none', interval: 0.1, stats: (m) => ({ as: m.v('flurry_bonus_attack_speed') }),
  // "removes attack speed limit": the engine caps attack speed, so the base attack time is shortened by the capped share instead
  late(m, s, u) { const as = u.def.baseAs + C.AS_PER_AGI * u.agi + s.as + s.asSlow; if (as > C.AS_MAX) s.bat = (s.bat > 0 ? s.bat : u.ovr && u.ovr.bat !== undefined ? u.ovr.bat : u.def.bat) * C.AS_MAX / as; },
  onCreated(m) { m.stacks = m.v('charges_per_flurry'); m.x = -1; },
  onThink(m) { if (m.x >= 0 && m.parent.world.time - m.x > m.v('max_time_window_per_hit')) marciFuryEnd(m); },      // the combo expires if a strike takes too long
  onAttack(m, rec) { if (rec.secondary || rec.fromAbility || m.stacks <= 0) return; m.x = m.parent.world.time; m.stacks--; (rec.data ||= {}).fury = m.stacks <= 0 ? 2 : 1; },
  onAttackLanded(m, rec) {
    if (!rec.data || !rec.data.fury) return;
    const t = rec.target; const last = rec.data.fury === 2;
    if (t.alive && !t.isBuilding) addMod(m.ability, t, 'modifier_marci_unleash_pulse_debuff', m.v('pulse_debuff_duration'));
    if (last) { marciPulse(m.ability, t.x, t.y); marciFuryEnd(m); }
  },
  onAttackMiss(m, rec) { if (rec.data && rec.data.fury === 2) marciFuryEnd(m); },
});
buff('modifier_marci_unleash_flurry_cooldown', { purge: 'none', state: ['DISARM'], onDestroy(m, expired) { const u = m.parent; if (expired && u.alive && u.hasModifier('modifier_marci_unleash')) u.addModifier('modifier_marci_unleash_flurry', { ability: m.ability }); } });
buff('modifier_marci_unleash', {
  purge: 'none', stats: { msPct: 'bonus_movespeed' },
  onCreated(m) { m.parent.addModifier('modifier_marci_unleash_flurry', { ability: m.ability }); },
  onDestroy(m) { m.parent.removeModifierByName('modifier_marci_unleash_flurry'); m.parent.removeModifierByName('modifier_marci_unleash_flurry_cooldown'); },
  onKill(m, ev) { if (m.v('extend_duration') > 0 && ev.victim.isHero && !ev.victim.isIllusion) m.setDuration(m.remaining() + m.v('extend_duration')); },
  onCast(m, ev) { const u = m.parent; if (u.hasScepter && !ev.ability.isItem && ev.ability !== m.ability && ev.ability.name.startsWith('marci_')) marciPulse(m.ability, u.x, u.y); },
});
defAbility('marci_unleash', {
  mods: [sync('marci_unleash', (ab) => { const r = ab.vals.scepter_cooldown_reduction || 0; if (r > 0) ab.vals.AbilityCooldown = levelVal(ab, 'AbilityCooldown') - r; })],
  prio: 88, engage: false, ai: (ab, u, t) => (t && t.isHero && !u.hasModifier('modifier_marci_unleash') && u.rangeTo(t) <= u.attackRange + 250 ? {} : null),
  cast(ab) {
    const u = ab.owner;
    if (ab.v('dispel') > 0) u.purge({ debuffs: true });
    u.removeModifierByName('modifier_marci_unleash'); addMod(ab, u, 'modifier_marci_unleash', ab.v('duration'));
  },
  fid: 'approx', note: 'every Fury strike slows its target (pulse debuff) and the last one pulses around the target; a missed last strike ends the combo without a pulse; Scepter pulses from her other abilities are centred on Marci when the cast completes; the kill talent extends on hero kills; recovery_fixed_attack_rate is not used (no tooltip)',
});

// ================================================================ Phantom Lancer
const PL_JUX = 'modifier_phantom_lancer_juxtapose_illusion';
const PL_RUSH = 'modifier_phantom_lancer_phantom_edge_boost';
const PL_FLOOR = 'modifier_phantom_lancer_illusory_armaments_floor';
const plReal = (u) => (u.isIllusion && u.owner ? u.owner : u);
const plIllusions = (u) => u.world.units.filter((e) => e.alive && e.isIllusion && e.owner === u && e.name === u.name);
const plJuxCount = (u) => u.world.units.filter((e) => e.alive && e.owner === u && e.hasModifier(PL_JUX)).length;
modifier(PL_JUX, { hidden: true, purge: 'none' });
function plJuxtapose(real, x, y, target, fromIllusion) {      // one Juxtapose illusion, if the cap allows
  const j = hasLvl(real, 'phantom_lancer_juxtapose');
  if (!j || !real.alive || plJuxCount(real) >= j.v('max_illusions')) return null;
  const il = real.world.createIllusion(real, { duration: j.v(fromIllusion ? 'illusion_from_illusion_duration' : 'illusion_duration'), outPct: j.v('illusion_damage_out_pct'), inPct: j.v('illusion_damage_in_pct'), x, y, target: target && target.alive ? target : undefined });
  il.addModifier(PL_JUX, {});
  return il;
}
debuff('modifier_phantom_lancer_spirit_lance', { stats: { msPct: 'movement_speed_pct' } });
defAbility('phantom_lancer_spirit_lance', {
  prio: 55,
  cast(ab, t) {
    const u = ab.owner; const w = u.world;
    if (!t) return;
    w.projectile(u, t, ab.v('lance_speed'), (tt) => {
      hit(ab, tt, ab.v('lance_damage'), MAGICAL);
      if (tt.alive) addMod(ab, tt, 'modifier_phantom_lancer_spirit_lance', ab.v('duration'));
      if (u.alive) w.createIllusion(u, { duration: ab.v('illusion_duration'), outPct: ab.v('illusion_damage_out_pct'), inPct: ab.v('illusion_damage_in_pct'), x: tt.x + 60, y: tt.y, target: tt.alive ? tt : undefined });
    });
    const k = ab.v('illusion_lance_damage_pct');      // talent: illusions near Phantom Lancer throw lances for a share of the damage
    if (k > 0) for (const il of plIllusions(u)) if (u.distTo(il) <= ab.v('fake_lance_distance')) w.projectile(il, t, ab.v('lance_speed'), (tt) => hit(ab, tt, ab.v('lance_damage') * k / 100 * il.stats().dmgOutMul, MAGICAL));
  },
  fid: 'full', note: 'the phantom appears next to the target when the lance lands; talent lances from illusions deal lance damage x talent % x the illusion\'s outgoing damage share, with no slow and no phantom; the Scepter text still shipped for this ability is stale (all its Scepter values are 0)',
});
// [L] measured in Hero Demo: during the delay Phantom Lancer is stunned, ethereal, invulnerable and out of play
modifier('modifier_phantom_lancer_doppelwalk', { purge: 'none', state: ['OUT', 'INVULN', 'STUN', 'ETHEREAL'] });
defAbility('phantom_lancer_doppelwalk', {
  prio: 100,
  ai(ab, u, t) {      // gap closer when Phantom Rush cannot do it, or a dodge when hurt
    if (!t) return null;
    const rush = hasLvl(u, 'phantom_lancer_phantom_edge'); const gap = u.rangeTo(t) - u.attackRange;
    const far = gap > 300 && !u.hasModifier(PL_RUSH) && !(rush && rush.cdReady() && u.distTo(t) <= rush.v('max_distance'));
    const hurt = u.hp / u.maxHp < 0.5 && u.world.time - u.lastHurt < 1;
    return (far || hurt) && u.distTo(t) <= ab.castRange() + 500 ? { x: t.x, y: t.y } : null;
  },
  cast(ab, t, x, y) {
    const u = ab.owner; const w = u.world; const d = ab.v('delay');
    u.purge({ debuffs: true });
    const group = [u, ...plIllusions(u).filter((il) => u.distTo(il) <= ab.v('search_radius'))];
    for (const g of group) g.addModifier('modifier_phantom_lancer_doppelwalk', { caster: u, ability: ab, duration: d + 0.05 });
    // [L] measured in Hero Demo: the two new illusions exist from the cast (Illusory Armaments counts from then) and appear with him;
    // their illusion_duration counts from the moment they appear
    const fresh = [];
    const mk = (out, inc) => { const il = w.createIllusion(u, { duration: ab.v('illusion_duration') + d, outPct: out, inPct: inc, x: u.x, y: u.y, target: aiTarget(u) || undefined }); il.addModifier('modifier_phantom_lancer_doppelwalk', { caster: u, ability: ab, duration: d + 0.05 }); fresh.push(il); };
    const ext = ab.v('illusion_extended_duration'); const old = plIllusions(u);
    mk(ab.v('illusion_1_damage_out_pct'), ab.v('illusion_1_damage_in_pct'));
    for (let i = 0; i < ab.v('illusion_2_amount'); i++) mk(ab.v('illusion_2_damage_out_pct'), ab.v('illusion_2_damage_in_pct'));
    w.after(d, () => {
      const r = ab.v('target_aoe'); const spot = () => { const a = w.rng.next() * TAU; const k = Math.sqrt(w.rng.next()) * r; return [x + Math.cos(a) * k, y + Math.sin(a) * k]; };
      for (const g of [...group, ...fresh]) { g.removeModifierByName('modifier_phantom_lancer_doppelwalk'); if (g.alive) [g.x, g.y] = spot(); }
      for (const il of old) { if (!il.alive) continue; if (il.lifeEnd !== Infinity) il.lifeEnd += ext; const im = il.findModifier('modifier_illusion'); if (im && im.dieTime !== Infinity) im.dieTime += ext; }
    });
  },
  fid: 'approx', note: 'Phantom Lancer and his illusions in search_radius are stunned, ethereal and out of play for the delay (live) and reappear at random spots in the target area; the two new illusions are created at the cast and appear with him; the duration extension applies to illusions that existed before the cast; projectile disjoint is not modelled',
});
// Phantom Rush (toggle assumed on, illusions rush too)
buff(PL_RUSH, {
  purge: 'none', interval: 1 / 30, stats: (m) => ({ msAbs: m.v('bonus_speed'), evasion: m.v('evasion') }),
  onCreated(m) { m.data = { t: m.data.t, px: m.parent.x, py: m.parent.y, run: 0, seen: new Set() }; },
  onThink(m) {
    const u = m.parent; const d = m.data; const t = d.t;
    if (!t.alive || u.orderTarget !== t || u.rangeTo(t) <= u.attackRange || u.st[ST.ROOT] > 0 || u.cantAct()) { m.remove(); return; }
    const span = m.v('illusion_spawn_travel_distance');
    if (span <= 0 || u.isIllusion) return;
    d.run += Math.hypot(u.x - d.px, u.y - d.py); d.px = u.x; d.py = u.y;      // Scepter: illusions for distance covered and for enemies rushed through
    if (d.run >= span) { d.run -= span; plJuxtapose(u, u.x - 40, u.y + 40, t, false); }
    for (const e of u.world.enemiesInRadius(u, u.x, u.y, m.v('illusion_spawn_radius'))) if (e !== t && !d.seen.has(e) && !e.isBuilding && e.attackableBy(u)) { d.seen.add(e); plJuxtapose(u, u.x, u.y, e, false); }
  },
});
modifier('modifier_phantom_lancer_phantom_edge', {
  hidden: true, purge: 'none', interval: 0.1,
  onThink(m) {
    const u = m.parent; const ab = m.ability; const t = u.orderTarget;
    if (!t || u.orderAb !== null || !t.alive || t.team === u.team || !ab.cdReady() || u.hasModifier(PL_RUSH) || u.cantAct() || u.st[ST.ROOT] > 0) return;
    const d = u.distTo(t);
    if (d < m.v('min_distance') || d > m.v('max_distance') || u.rangeTo(t) <= u.attackRange) return;
    ab.startCooldown(); u.addModifier(PL_RUSH, { ability: ab, data: { t } });
  },
});
defAbility('phantom_lancer_phantom_edge', {
  mods: ['modifier_phantom_lancer_phantom_edge'], illusion: true, manual: true,
  // the button only flips the toggle (live: no mana, no cooldown when toggled); the rush itself is modelled as always armed
  cast(ab) { ab.toggled = !ab.toggled; ab.cdEnd = 0; },
  fid: 'approx', note: 'toggle assumed on; a rush starts when an attack target is between min_distance and max_distance (checked every 0.1 s) and ends in attack range or when the order changes; illusions rush as well (assumed, as in the game). Scepter: a Juxtapose illusion per enemy passed within illusion_spawn_radius and per illusion_spawn_travel_distance covered, limited by Juxtapose\'s illusion cap',
});
modifier(PL_FLOOR, { hidden: true, purge: 'none', stats: (m) => ({ dmgOutPct: m.x }) });
passive('phantom_lancer_illusory_armaments', {
  interval: 0.1, thinkNow: true,
  onThink(m) {
    const u = m.parent; const w = u.world; const dur = m.v('duration'); const floor = m.v('outgoing_floor');
    for (const e of plIllusions(u)) {
      const im = e.findModifier('modifier_illusion');
      if (!im || w.time - im.created >= dur || e.hasModifier(PL_FLOOR) || 100 + im.data.out >= floor) continue;
      const f = e.addModifier(PL_FLOOR, { caster: u, ability: m.ability, duration: dur - (w.time - im.created) }); f.x = floor - (100 + im.data.out); e.dirty = true;
    }
  },
  fid: 'approx', note: 'applies to every illusion of Phantom Lancer he owns (whatever created it), picked up within 0.1 s of its creation',
});
buff('modifier_phantom_lancer_juxtapose_invis', { purge: 'none', state: ['INVIS'], stats: { msPct: 'invis_movespeed' }, onAttack(m) { m.remove(); } });
modifier('modifier_phantom_lancer_juxtapose', {
  hidden: true, purge: 'none',
  // the Shard adds an active part, but the ability is flagged passive in the data: clear the flag while the active exists
  stats(m) { const ab = m.ability; const u = m.parent; const act = !u.isIllusion && m.v('invis_duration') > 0; if (ab.passive === act) { ab.passive = !act; u.refreshAI(); } return null; },
  onAttackLanded(m, rec) {
    const u = m.parent; const t = rec.target; const ill = u.isIllusion;
    if (rec.secondary || t.isBuilding || !m.roll(m.v(ill ? 'illusion_proc_chance_pct' : 'proc_chance_pct'))) return;
    const w = u.world; plJuxtapose(plReal(u), u.x + (w.rng.next() - 0.5) * 120, u.y + (w.rng.next() - 0.5) * 120, t, ill);
  },
});
defAbility('phantom_lancer_juxtapose', {
  mods: ['modifier_phantom_lancer_juxtapose'], illusion: true, prio: 45, engage: false,
  ai: (ab, u, t) => (t && ab.v('invis_duration') > 0 && !u.isIllusion && u.rangeTo(t) <= u.attackRange + 300 && plJuxCount(u) < ab.v('max_illusions') ? {} : null),
  cast(ab) { const u = ab.owner; if (ab.v('invis_duration') <= 0) return; plJuxtapose(u, u.x + 40, u.y + 40, aiTarget(u), false); addMod(ab, u, 'modifier_phantom_lancer_juxtapose_invis', ab.v('invis_duration')); },
  fid: 'approx', note: 'chance rolls on landed attacks (pseudo-random); illusions copy the real hero. Shard active: the "duplicate image" is one Juxtapose illusion (counts towards the cap, assumed) and the invisibility ends on Phantom Lancer\'s next attack; the data flags the ability as passive, the script enables casting while the Shard is owned',
});

// ================================================================ Snapfire
const SNAP_BELLY = 'modifier_snapfire_gobble_up_belly';
passive('snapfire_boomstick', {
  outgoing(m, d) {
    const u = m.parent; const t = d.dst;
    if (t.team === u.team || t.isBuilding) return;
    const lo = m.v('distance_threshold_min'); const hi = m.v('distance_threshold_max'); const k = Math.min(1, Math.max(0, (hi - u.distTo(t)) / (hi - lo)));
    d.amount *= 1 + (m.v('damage_amp_min') + (m.v('damage_amp_max') - m.v('damage_amp_min')) * k) / 100;
  },
  fid: 'approx', note: 'every damage instance Snapfire deals to an enemy unit is amplified, growing linearly from damage_amp_min at distance_threshold_max to damage_amp_max at distance_threshold_min (distance when the damage lands)',
});
debuff('modifier_snapfire_scatterblast_slow', { stats: (m) => ({ msPct: -m.v('movement_slow_pct') * m.data.k, asSlow: -m.v('attack_slow_pct') * m.data.k }) });
defAbility('snapfire_scatterblast', {
  prio: 55,
  cast(ab, t, x, y) {
    const u = ab.owner; const w = u.world; const [dx, dy] = dirTo(u, x, y); const L = ab.castRange(); const w0 = ab.v('blast_width_initial'); const w1 = ab.v('blast_width_end'); const pb = ab.v('point_blank_range');
    if (w.skillshotHit < 1 && !w.rng.chance(w.skillshotHit)) return;
    for (const e of w.units) {
      if (!e.alive || e.team === u.team || e.isBuilding || e.st[ST.OUT] > 0) continue;
      const al = (e.x - u.x) * dx + (e.y - u.y) * dy; const off = Math.abs((e.x - u.x) * dy - (e.y - u.y) * dx);
      if (al < -e.def.hull || al > L + e.def.hull || off > (w0 + (w1 - w0) * Math.min(1, Math.max(0, al / L))) / 2 + e.def.hull) continue;
      const near = u.distTo(e) <= pb; const k = near ? 1 + ab.v('point_blank_debuff_duration_pct') / 100 : 1;
      w.after(u.distTo(e) / ab.v('blast_speed'), () => {
        if (!e.alive) return;
        hit(ab, e, ab.v('damage') * (near ? 1 + ab.v('point_blank_dmg_bonus_pct') / 100 : 1), MAGICAL);
        if (!e.alive) return;
        addMod(ab, e, 'modifier_snapfire_scatterblast_slow', ab.v('debuff_duration') * k, { data: { k } });
        if (near && ab.v('knockback_duration') > 0) knockback(e, u.x, u.y, Math.max(0, pb - u.distTo(e)));      // talent: point-blank targets are pushed out to the point-blank distance
      });
    }
  },
  fid: 'approx', note: 'cone = trapezoid from blast_width_initial to blast_width_end over the cast range; point-blank is decided at cast time; the talent knockback is an instant push away from Snapfire; the Shard-keyed values still on this ability (knockback, stun, bonus damage) have no tooltip and are not used',
});
// [L] measured in Hero Demo: a pool first acts burn_interval after the impact; the burn debuff deals its first tick when it is applied
// and then every burn_interval while pools keep refreshing it (overlapping pools do not add ticks)
debuff('modifier_snapfire_magma_burn_slow', { interval: (m) => m.v('burn_interval'), thinkNow: true, stats: (m) => ({ msPct: -m.v('move_slow_pct') }), onThink(m) { mhit(m, m.parent, m.v('burn_damage') * m.v('burn_interval'), MAGICAL); } });
// one firespit glob of Mortimer Kisses `mk`: impact after the lob, then a pool that keeps the burn / slow debuff on enemies inside
function snapGlob(mk, x, y, o = {}) {
  const u = mk.owner; const w = u.world; const src = o.ab || mk;
  const travel = o.travel ?? Math.min(mk.v('max_lob_travel_time'), Math.max(mk.v('min_lob_travel_time'), Math.hypot(x - u.x, y - u.y) / mk.v('projectile_speed')));
  w.after(travel, () => {
    const r = o.radius ?? mk.v('impact_radius'); const tk = mk.v('burn_interval'); const life = o.pool ?? mk.v('burn_ground_duration');
    for (const e of w.enemiesInRadius(u, x, y, r)) { if (e.isBuilding) continue; hit(src, e, mk.v('damage_per_impact') * (o.scale ?? 1), MAGICAL); if (o.stun && e.alive) stun(src, e, o.stun); }
    for (let i = 1; i * tk <= life + 1e-9; i++) w.after(i * tk, () => { for (const e of w.enemiesInRadius(u, x, y, r)) if (!e.isBuilding) e.addModifier('modifier_snapfire_magma_burn_slow', { caster: u, ability: mk, duration: mk.v('burn_linger_duration') }); });
  });
}
modifier('modifier_snapfire_firesnap_cookie_short_hop', { purge: 'none', statusResist: false, state: ['STUN'] });
defAbility('snapfire_firesnap_cookie', {
  prio: 75,
  ai(ab, u, t) {      // feed whoever would land on the target
    if (!t) return null;
    const hop = ab.v('jump_horizontal_distance'); const slack = ab.v('impact_radius') - 60; const lands = (x) => Math.abs(x.distTo(t) - hop) <= slack && x.st[ST.ROOT] === 0;
    if (lands(u)) return { target: u };
    const a = u.world.units.filter((x) => x !== u && x.alive && x.team === u.team && !x.isBuilding && x.st[ST.OUT] === 0 && x.def.ms > 0 && u.distTo(x) <= ab.castRange() && lands(x)).sort((p, q) => u.distTo(p) - u.distTo(q))[0];
    return a ? { target: a } : null;
  },
  cast(ab, t) {
    const u = ab.owner; const w = u.world; const tg = t || u;
    const eat = () => {
      if (!tg.alive) return;
      if (ab.v('target_heal') > 0) tg.heal(ab.v('target_heal'), u, ab);
      const foe = (tg.ai && tg.ai.target && tg.ai.target.alive ? tg.ai.target : null) || w.nearestEnemy(tg);      // no facing: the unit hops towards its target
      const [dx, dy] = foe ? dirTo(tg, foe.x, foe.y) : [1, 0]; const hop = tg.st[ST.ROOT] > 0 ? 0 : ab.v('jump_horizontal_distance'); const lx = tg.x + dx * hop; const ly = tg.y + dy * hop;
      if (ab.v('target_heal') > 0) { const mk = u.findAbility('snapfire_mortimer_kisses'); if (mk) snapGlob(mk, lx, ly, { scale: ab.v('shard_damage_multiplier_tooltip') / 100 }); }      // Shard: a Mortimer Kiss on the landing spot
      // [L] measured in Hero Demo: the hop starts one tick after the cookie arrives (pre_hop_duration 0) and the hopping unit is stunned for jump_duration
      const jd = Math.ceil(ab.v('jump_duration') * 30 - 1e-6) / 30;
      w.after(ab.v('pre_hop_duration') + w.dt, () => { if (tg.alive && hop > 0) tg.addModifier('modifier_snapfire_firesnap_cookie_short_hop', { caster: u, ability: ab, duration: jd }); });
      w.after(ab.v('pre_hop_duration') + w.dt + jd, () => {
        if (!tg.alive) return;
        tg.x = lx; tg.y = ly;
        for (const e of enemiesNear(ab, lx, ly, ab.v('impact_radius'))) { if (e.isBuilding) continue; hit(ab, e, ab.v('impact_damage'), MAGICAL); if (e.alive) stun(ab, e, ab.v('impact_stun_duration')); }
      });
    };
    if (tg === u) w.after(ab.v('self_cast_delay'), eat); else w.projectile(u, tg, ab.v('projectile_speed'), eat);
  },
  fid: 'approx', note: 'no facing: the game hops the fed unit the way it faces, the simulation hops it jump_horizontal_distance towards its current target (else the nearest enemy), stunned during the hop, and moves it at landing time; Shard glob = a Mortimer Kisses glob with 40% impact damage and its normal pool, using the ultimate\'s current values (level 1 values if it is not learned)',
});
// Lil' Shredder
debuff('modifier_snapfire_lil_shredder_debuff', { multi: 'stack', stats: (m) => ({ armor: -m.v('armor_reduction_per_attack') * m.stacks }) });
modifier('modifier_snapfire_lil_shredder', { hidden: true, purge: 'none', onAttackLanded(m, rec) { const t = rec.target; if (rec.data && rec.data.shred && t.alive && !t.isBuilding) t.addModifier('modifier_snapfire_lil_shredder_debuff', { caster: m.parent, ability: m.ability, duration: m.v('armor_duration') }); } });
buff('modifier_snapfire_lil_shredder_buff', {
  stats: (m) => ({ as: m.v('attack_speed_bonus'), bat: m.v('base_attack_time'), attackRange: m.v('attack_range_bonus') }),
  onCreated(m) { m.stacks = m.v('buffed_attacks'); },
  onAttack(m, rec) {
    const u = m.parent; const extra = rec.fromAbility === m.ability;
    if (rec.secondary || (rec.fromAbility && !extra)) return;
    rec.mult *= m.v('damage_pct') / 100; rec.add += m.v('damage'); (rec.data ||= {}).shred = true;
    if (extra) return;
    const n = m.v('extra_targets');      // talent: the same shot at more targets in range
    if (n > 0) { const others = u.world.units.filter((e) => e.alive && e.team !== u.team && e !== rec.target && e.attackableBy(u) && u.rangeTo(e) <= u.attackRange).sort((a, b) => u.distTo(a) - u.distTo(b)).slice(0, n); for (const e of others) u.world.launchAttack(u, e, { fromAbility: m.ability }); }
    if (--m.stacks <= 0) m.remove();
  },
});
defAbility('snapfire_lil_shredder', {
  mods: ['modifier_snapfire_lil_shredder'], prio: 60, engage: false,
  ai: (ab, u, t) => (t && !u.hasModifier('modifier_snapfire_lil_shredder_buff') && u.rangeTo(t) <= u.attackRange + ab.v('attack_range_bonus') ? {} : null),
  cast(ab) { const u = ab.owner; u.removeModifierByName('modifier_snapfire_lil_shredder_buff'); addMod(ab, u, 'modifier_snapfire_lil_shredder_buff', ab.v('AbilityDuration')); },
  fid: 'approx', note: 'each buffed attack deals damage + damage_pct% of the normal attack damage as attack damage and adds an armor stack; the whole buff (attack speed, base attack time and the range bonus) ends with the last buffed attack or after the duration (the tooltip does not say whether the range outlasts the attacks); the talent\'s extra targets get the same shot without using up attacks',
});
// Scepter: Gobble Up + Spit Out
const snapEdible = (u, e) => e !== u && e.alive && !e.isBuilding && e.st[ST.OUT] === 0 && e.st[ST.INVULN] === 0 && e.def.atk !== 'none' && (e.heroLike ? e.team === u.team && e.isHero && !e.isIllusion : !e.def.ancient && !(e.team !== u.team && e.isImmune()));
modifier(SNAP_BELLY, {
  purge: 'none', state: ['OUT', 'INVULN'],
  onDestroy(m) { const s = m.caster; const v = m.parent; if (m.ability.data === v) m.ability.data = null; if (!m.data.spat && v.alive) { v.x = s.x + 60; v.y = s.y; } },      // not spat in time: ejected next to Snapfire
});
defAbility('snapfire_gobble_up', {
  prio: 89,
  ai(ab, u, t) {      // a creep near her, else a melee allied hero that is still far from the target
    if (!t || ab.data || u.distTo(t) < 300) return null;
    const near = u.world.units.filter((e) => snapEdible(u, e) && u.distTo(e) <= 300);
    const c = near.filter((e) => !e.heroLike).sort((a, b) => (a.team === u.team) - (b.team === u.team) || u.distTo(a) - u.distTo(b))[0] || near.find((e) => e.heroLike && e.melee && e.distTo(t) > 400);
    return c ? { target: c } : null;
  },
  cast(ab, t) { const u = ab.owner; if (!t || !snapEdible(u, t) || ab.data) { refuseCast(ab); return; } /* [L] Hero Demo: the order on an enemy hero is refused */ ab.data = t; t.addModifier(SNAP_BELLY, { caster: u, ability: ab, duration: ab.v('max_time_in_belly'), data: { spat: false } }); },
  fid: 'approx', note: 'swallows any non-ancient creep or an allied hero (out of play while inside); a unit that is not spat out in time reappears next to Snapfire',
});
defAbility('snapfire_spit_creep', {
  prio: 87, ai: (ab, u, t) => { const g = u.findAbility('snapfire_gobble_up'); const bm = g && g.data && g.data.alive ? g.data.findModifier(SNAP_BELLY) : null; return t && bm && !bm.data.spat ? { x: t.x, y: t.y } : null; },
  cast(ab, t, x, y) {
    const u = ab.owner; const w = u.world; const g = u.findAbility('snapfire_gobble_up'); const v = g && g.data; const bm = v && v.alive ? v.findModifier(SNAP_BELLY) : null; const mk = u.findAbility('snapfire_mortimer_kisses');
    if (!bm || bm.data.spat) return;
    const travel = Math.min(ab.v('max_lob_travel_time'), Math.max(ab.v('min_lob_travel_time'), Math.hypot(x - u.x, y - u.y) / ab.v('projectile_speed')));
    bm.data.spat = true; bm.setDuration(travel + 1);
    w.after(travel, () => { v.removeModifierByName(SNAP_BELLY); if (!v.alive) return; v.x = x; v.y = y; if (!v.heroLike) w.kill(v, u, ab); });
    if (mk) snapGlob(mk, x, y, { travel, radius: ab.v('impact_radius'), stun: ab.v('stun_duration'), pool: ab.v('burn_ground_duration'), ab });
  },
  fid: 'approx', note: 'the tooltip gives no impact damage value: Mortimer Kisses\' damage_per_impact, burn damage and slow at its current level are used (level 1 values if it is not learned), with Spit Out\'s own radius, stun and pool duration; a spat creep dies on impact, a spat allied hero lands at the point',
});
// [L] measured in Hero Demo: globs leave every AbilityDuration / projectile_count rounded up to whole ticks (0.7 s for 8, 0.4 s for 14),
// the first at once; the barrage (disarmed, speed 0, not rooted) ends delay_after_last_projectile after the last glob, at most AbilityDuration
const snapMkGap = (ab) => Math.ceil(ab.v('AbilityDuration') / ab.v('projectile_count') * 30 - 1e-6) / 30;
const snapMkTime = (ab) => Math.min(ab.v('AbilityDuration'), (ab.v('projectile_count') - 1) * snapMkGap(ab) + ab.v('delay_after_last_projectile'));
buff('modifier_snapfire_mortimer_kisses', {
  purge: 'none', interval: (m) => snapMkGap(m.ability), thinkNow: true, state: ['DISARM'], stats: { msCap: 0.01 },
  onThink(m) {      // every glob is re-aimed at the current target, never closer than min_range
    const u = m.parent; const ab = m.ability; const t = aiTarget(u);
    if ((m.x += 1) > ab.v('projectile_count')) return;
    if (t) { m.data.x = t.x; m.data.y = t.y; }
    const [dx, dy, d] = dirTo(u, m.data.x, m.data.y); const k = Math.min(ab.castRange(), Math.max(ab.v('min_range'), d));
    snapGlob(ab, u.x + dx * k, u.y + dy * k);
  },
});
defAbility('snapfire_mortimer_kisses', {
  prio: 86, channel: (ab) => snapMkTime(ab),
  ai(ab, u, t) { if (!t || !t.isHero || t.isIllusion) return null; return u.distTo(t) >= ab.v('min_range') - ab.v('impact_radius') / 2 && !(t.melee && t.orderTarget === u) ? { x: t.x, y: t.y } : null; },
  cast(ab, t, x, y) { ab.owner.addModifier('modifier_snapfire_mortimer_kisses', { ability: ab, duration: snapMkTime(ab), data: { x, y } }); },
  channelEnd(ab, interrupted) { if (interrupted) ab.owner.removeModifierByName('modifier_snapfire_mortimer_kisses'); },
  fid: 'approx', note: 'the barrage locks Snapfire like a channel (disarmed, speed 0; the engine also lets a silence end it) until delay_after_last_projectile after the last glob (at most the duration); globs leave every duration / count rounded up to whole ticks, the impact can land 1-2 ticks later than in the game; at the same tick an impact lands before the burn tick (the game: after); each glob is aimed at the current target\'s position at launch (min_range respected), lob time = distance / projectile_speed within the min/max travel times; pools re-apply the burn every burn_interval; AI does not start it on a melee hero that is attacking her',
});

// ================================================================ Weaver
const WV_BEETLE = 'npc_dota_weaver_swarm';
const WV_SWARM = 'modifier_weaver_the_swarm_debuff';
const WV_SHUKUCHI = 'modifier_weaver_shukuchi';
const WV_LAPSE = 5;      // "five seconds earlier": stated in the tooltip text only, there is no data value for it
// The Swarm: a beetle = an attackable pip-health unit riding on its host + a debuff on the host that bites and shreds armor
modifier('modifier_weaver_the_swarm_beetle', {
  hidden: true, purge: 'none', state: ['IMMUNE'], interval: 0.1, postMit: pipHit,
  onThink(m) { const b = m.parent; const h = m.data.host; if (!h.alive || h.st[ST.INVULN] > 0 || h.st[ST.OUT] > 0) { b.world.kill(b, null, null, true); return; } b.x = h.x; b.y = h.y; },
  onDestroy(m) { const d = m.data.host.findModifier(WV_SWARM); if (d && d.data.beetle === m.parent) d.remove(); },
});
debuff(WV_SWARM, {
  // [L] measured in Hero Demo: the beetle bites as it latches and then every attack_rate (22 bites in 16 s at 0.75 s); each bite
  // removes its armor before its damage lands (first bite on 0 armor: 34.87 = 33 against -1 armor)
  purge: 'none', statusResist: false, interval: (m) => m.v('attack_rate'), thinkNow: true, stats: (m) => ({ armor: -m.v('armor_reduction') * m.x }),
  onThink(m) { const h = m.parent; m.x++; h.recompute(); mhit(m, h, m.v('damage'), PHYSICAL); },
  onDestroy(m) { const b = m.data.beetle; if (b && b.alive) b.world.kill(b, null, null, true); },
});
function wvLatch(ab, e) {
  const u = ab.owner;
  if (!e.alive || e.hasModifier(WV_SWARM) || e.st[ST.INVULN] > 0 || e.st[ST.OUT] > 0) return;
  const d = e.addModifier(WV_SWARM, { caster: u, ability: ab, duration: ab.v('duration'), data: { beetle: null } });
  if (!d) return;
  const b = u.world.summon(u, WV_BEETLE, { x: e.x, y: e.y, ovr: { hp: ab.v('destroy_attacks') }, ai: 'idle' });
  d.data.beetle = b; b.addModifier('modifier_weaver_the_swarm_beetle', { caster: u, ability: ab, data: { host: e } });
}
defAbility('weaver_the_swarm', {
  prio: 50, ai: (ab, u, t) => (t && !t.hasModifier(WV_SWARM) && !t.isImmune() ? { x: t.x, y: t.y } : null),
  cast(ab, t, x, y) {
    const u = ab.owner; const w = u.world; const [dx, dy] = dirTo(u, x, y); const L = ab.castRange(); const half = ab.v('spawn_radius') + ab.v('radius');
    const along = (e) => (e.x - u.x) * dx + (e.y - u.y) * dy;
    const hosts = w.units.filter((e) => e.alive && e.team !== u.team && !e.isBuilding && e.st[ST.OUT] === 0 && along(e) >= 0 && along(e) <= L && Math.abs((e.x - u.x) * dy - (e.y - u.y) * dx) <= half + e.def.hull).sort((a, b) => along(a) - along(b)).slice(0, ab.v('count'));
    for (const e of hosts) w.after(along(e) / ab.v('speed'), () => wvLatch(ab, e));
  },
  fid: 'approx', note: 'the swarm is a band of half-width spawn_radius + radius along the cast direction: the first `count` enemies in it each get one beetle after the travel time from Weaver (the game spawns beetles at random points within spawn_radius, so it latches 0.2-0.6 s after the cast for a target 500 away). A beetle bites as it latches and then every attack_rate for `damage` (physical) and removes armor_reduction armor per bite until it dies or the duration ends; it is a spell-immune unit with pip health sitting on its host (the default enemy controller only attacks it when it has to pick a new target)',
});
debuff('modifier_weaver_shukuchi_mark', { purge: 'none' });
buff(WV_SHUKUCHI, {
  purge: 'none', interval: 0.05, stats: (m) => ({ msAbs: m.v('min_movespeed_override') }),
  onCreated(m) {
    m.data = { seen: new Set(), goal: m.data && m.data.goal ? m.data.goal : null }; if (m.data.goal) { m.z = 1; m.parent.st[ST.DISARM]++; }
    // [L] measured in Hero Demo: invisible only after fade_time (cast 0.53 s, invisible from 0.80 s); the speed applies at once
    const u = m.parent; u.world.after(m.v('fade_time'), () => { if (u.findModifier(WV_SHUKUCHI) === m) { m.y = 1; u.st[ST.INVIS]++; } });
  },
  onAttack(m) { m.remove(); },
  onThink(m) {
    const u = m.parent; const d = m.data;
    for (const e of u.world.enemiesInRadius(u, u.x, u.y, m.v('radius'))) {
      if (d.seen.has(e) || e.isBuilding || e.isImmune() || e.st[ST.INVULN] > 0) continue;
      d.seen.add(e); hit(m.ability, e, m.v('damage'), MAGICAL);
      if (m.v('geminate_attack_mark_duration') > 0 && e.alive) e.addModifier('modifier_weaver_shukuchi_mark', { caster: u, ability: m.ability, duration: m.v('geminate_attack_mark_duration') });
    }
    const g = d.goal;      // scripted pass: run at the target until it has been touched
    if (!g) return;
    if (!g.alive || d.seen.has(g) || g.isImmune()) { m.remove(); return; }
    if (!u.cantAct() && u.st[ST.ROOT] === 0) stepTo(u, g.x, g.y, 0.05);
  },
  onDestroy(m) {
    const u = m.parent; const w = u.world; const marked = [...m.data.seen];
    if (m.z === 1) u.st[ST.DISARM]--;
    if (m.y === 1) { m.y = 0; u.st[ST.INVIS]--; }
    if (!u.alive || m.v('shukuchi_attack_delay') <= 0) return;
    w.after(m.v('shukuchi_attack_delay'), () => { for (const e of marked) if (e.alive && e.removeModifierByName('modifier_weaver_shukuchi_mark') && u.distTo(e) <= m.v('shukuchi_attack_mark_radius')) wvGeminate(u, e, false); });
  },
});
defAbility('weaver_shukuchi', {
  prio: 65, engage: false, ai: (ab, u, t) => (t && !t.isImmune() && !t.isBuilding && !u.hasModifier(WV_SHUKUCHI) && u.distTo(t) <= 900 ? {} : null),
  cast(ab) { const u = ab.owner; u.removeModifierByName(WV_SHUKUCHI); u.addModifier(WV_SHUKUCHI, { ability: ab, duration: ab.v('duration'), data: { goal: u.ai ? aiTarget(u) : null } }); },
  fid: 'approx', note: 'speed at once, invisible after fade_time; each enemy within `radius` of Weaver is damaged once per cast. AI assumption: Weaver runs at its target without attacking until it has touched it, then leaves Shukuchi (an attack also ends it). Shard: marked enemies in range receive one Geminate-style attack shukuchi_attack_delay after the exit',
});
// one additional (geminate) attack on t; with the Shard also on every other enemy carrying a beetle near t
function wvGeminate(u, t, spread) {
  const ab = hasLvl(u, 'weaver_geminate_attack'); const w = u.world;
  if (!u.alive) return;
  const opts = ab ? { flat: ab.v('bonus_damage'), potency: u.itemPotency + ab.v('bonus_potency'), fromAbility: ab } : { fromAbility: u.findAbility('weaver_shukuchi') };
  if (t.alive && t.attackableBy(u)) w.launchAttack(u, t, { ...opts });
  const r = ab && spread ? ab.v('shard_beetle_search_range') : 0;
  if (r > 0) for (const e of w.units) if (e !== t && e.alive && e.team !== u.team && e.hasModifier(WV_SWARM) && e.attackableBy(u) && e.distTo(t) <= r) w.launchAttack(u, e, { ...opts });
}
passive('weaver_geminate_attack', {
  onAttack(m, rec) {
    const u = m.parent; const ab = m.ability; const t = rec.target;
    if (rec.secondary || rec.fromAbility || !ab.cdReady()) return;
    ab.startCooldown();
    for (let i = 1; i <= m.v('extra_attack'); i++) u.world.after(m.v('delay') * i, () => wvGeminate(u, t, true));
  },
  fid: 'full', note: 'the additional attacks are full attacks (attack modifiers apply) with bonus damage and +bonus_potency item potency, launched `delay` apart regardless of range',
});
// Time Lapse: the modifier keeps a 5 s history of Weaver (and of allied heroes for the Scepter ability)
modifier('modifier_weaver_time_lapse', {
  hidden: true, purge: 'none', interval: 0.25, thinkNow: true, onCreated(m) { m.data = new Map(); },
  onThink(m) {
    const u = m.parent; const now = u.world.time;
    const rec = (x) => { let a = m.data.get(x); if (!a) m.data.set(x, a = []); a.push({ t: now, x: x.x, y: x.y, hp: x.hp, mana: x.mana }); while (a.length > 1 && a[1].t <= now - WV_LAPSE) a.shift(); };
    rec(u);
    if (hasLvl(u, 'weaver_time_lapse_ally')) for (const a of u.world.units) if (a !== u && a.alive && a.team === u.team && a.isHero && !a.isIllusion) rec(a);
  },
});
const wvPast = (u, x) => { const m = u.findModifier('modifier_weaver_time_lapse'); const a = m && m.data.get(x); return a && a.length ? a[0] : null; };
function wvRewind(x, p) { x.purge({ debuffs: true, strong: true }); x.x = p.x; x.y = p.y; x.recompute(); x.hp = Math.max(1, Math.min(x.maxHp, p.hp)); x.mana = Math.min(x.maxMana, p.mana); }
const wvLost = (x, p, frac) => !!p && (p.hp - x.hp >= frac * x.maxHp || (x.hp / x.maxHp < 0.25 && p.hp >= x.hp * 1.5));
function wvShareCd(u, ab, other) { const o = u.findAbility(other); const tl = u.findAbility('weaver_time_lapse'); if (u.world.freeSpells || !tl) return; const end = u.world.time + tl.cooldown(); ab.cdEnd = end; if (o) o.cdEnd = end; }
defAbility('weaver_time_lapse', {
  mods: ['modifier_weaver_time_lapse'], prio: 95, engage: false, ai: (ab, u) => (wvLost(u, wvPast(u, u), 0.3) ? {} : null),
  cast(ab) { const u = ab.owner; const p = wvPast(u, u); if (p) wvRewind(u, p); wvShareCd(u, ab, 'weaver_time_lapse_ally'); },
  fid: 'approx', note: 'position, health and mana are restored from a history sampled every 0.25 s (the state 5 s ago, or the oldest known one early in a fight; the 5 s come from the tooltip text, there is no data value); strong dispel; projectile disjoint is not modelled. AI uses it after losing 30% of max health within the window',
});
defAbility('weaver_time_lapse_ally', {
  prio: 94,
  ai(ab, u) {
    if (!hasLvl(u, 'weaver_time_lapse')) return null;
    const a = u.world.units.filter((x) => x !== u && x.alive && x.team === u.team && x.isHero && !x.isIllusion && x.st[ST.OUT] === 0 && u.distTo(x) <= ab.castRange() + 200 && wvLost(x, wvPast(u, x), 0.35)).sort((p, q) => p.hp / p.maxHp - q.hp / q.maxHp)[0];
    return a ? { target: a } : null;
  },
  cast(ab, t) { const u = ab.owner; const p = t && t !== u && hasLvl(u, 'weaver_time_lapse') ? wvPast(u, t) : null; if (p) wvRewind(t, p); wvShareCd(u, ab, 'weaver_time_lapse'); },
  fid: 'approx', note: 'same history as Time Lapse, kept for allied heroes while the Scepter is owned; shares Time Lapse\'s cooldown (set by the script); the data gives this ability no mana cost; needs Time Lapse learned',
});
debuff('modifier_weaver_threads_of_fate_slow', { stats: (m) => ({ msPct: -m.v('slow_percent') }) });
passive('weaver_threads_of_fate', {
  interval: 0.1, onCreated(m) { m.data = { pend: new Map(), on: new Map() }; },
  stats: (m) => ({ dmgBasePct: m.data ? m.v('damage_per_thread_hero') * m.data.on.size : 0 }),
  onDealDamage(m, d) {
    const u = m.parent; const t = d.dst; const s = m.data;
    if (d.dealt <= 0 || !((d.flags & F_ATTACK) !== 0 || (d.ability && !d.ability.isItem))) return; // "with an attack or ability": item damage does not count
    if (t.team !== u.team && t.isHero && !t.isIllusion && !s.on.has(t) && !s.pend.has(t) && u.distTo(t) <= m.v('thread_setup_distance')) s.pend.set(t, u.world.time);
  },
  onThink(m) {
    const u = m.parent; const now = u.world.time; const s = m.data; const n = s.on.size;
    const slow = (t) => t.addModifier('modifier_weaver_threads_of_fate_slow', { caster: u, ability: m.ability, duration: m.v('slow_duration') });
    for (const [t, t0] of s.pend) { if (!t.alive || u.distTo(t) > m.v('thread_setup_distance')) s.pend.delete(t); else if (now - t0 >= m.v('thread_setup_time')) { s.pend.delete(t); s.on.set(t, now + m.v('established_thread_duration')); slow(t); } }
    for (const [t, next] of s.on) { if (!t.alive || u.distTo(t) > m.v('established_thread_break_distance')) s.on.delete(t); else if (now >= next) { s.on.set(t, next + m.v('established_thread_duration')); slow(t); } }
    if (s.on.size !== n) u.dirty = true;
  },
  fid: 'approx', note: 'threads are tracked every 0.1 s for real enemy heroes; any damage from Weaver\'s attacks or abilities starts one (Swarm bites are credited to Weaver and count, item damage does not); bonus = damage_per_thread_hero% base attack damage per thread; a thread ends when its hero dies (death_linger_duration has no tooltip and is not used)',
});

// ================================================================ Centaur Warrunner
// value of a standard key at the ability's current level, straight from the data (before a script override of the slot)
const levelVal = (ab, key) => { const e = ab.def.vals[key]; if (e === undefined) return 0; if (typeof e === 'number') return e; const arr = Array.isArray(e) ? e : e.v; return arr[Math.max(1, Math.min(arr.length, ab.level)) - 1]; };
// hidden intrinsic modifier that rewrites a standard slot (mana cost, cooldown, channel time...) every time the values are refreshed
function sync(ability, fn) { modifier('modifier_' + ability + '_sync', { hidden: true, purge: 'none', breakable: false, apply(m) { fn(m.ability, m); } }); return 'modifier_' + ability + '_sync'; }
buff('modifier_centaur_hoof_stomp_windup', {
  purge: 'none',
  onDestroy(m, expired) {
    const u = m.parent; const ab = m.ability;
    if (!expired || !u.alive) return;
    // [L] measured in Hero Demo: the order costs no mana (GetManaCost is 0 at every level); AbilityManaCost is taken when the stomp lands
    if (!u.world.freeSpells) u.mana = Math.max(0, u.mana - Math.floor(levelVal(ab, 'AbilityManaCost') * (1 - u.manaCostRed / 100) + 1e-6));
    for (const e of enemiesNear(ab, u.x, u.y, ab.v('radius'))) { if (e.isBuilding) continue; stun(ab, e, ab.v('stun_duration')); hit(ab, e, ab.v('stomp_damage'), MAGICAL); }
  },
});
defAbility('centaur_hoof_stomp', {
  mods: [sync('centaur_hoof_stomp', (ab) => { ab.vals.AbilityManaCost = 0; })],
  prio: 80, ai: (ab, u, t, w) => (u.mana >= levelVal(ab, 'AbilityManaCost') || w.freeSpells ? nearAI('radius', -40)(ab, u, t, w) : null),
  cast(ab) { addMod(ab, ab.owner, 'modifier_centaur_hoof_stomp_windup', ab.v('windup_time')); },
  fid: 'full', note: 'live: the mana is spent when the stomp lands, not on the order, and Centaur is not disarmed during the wind-up (no disarm state in the game, whatever the tooltip says); the stomp happens where Centaur stands when the wind-up ends',
});
debuff('modifier_centaur_double_edge_slow', { stats: (m) => ({ msPct: -m.v('shard_movement_slow') }) });
buff('modifier_centaur_double_edge_buff', { purge: 'none', multi: 'stack', maxStacks: (m) => m.v('shard_max_stacks'), apply(m, s, u) { s.str += (u.baseAttr('str') + u.attrLevels * 2 + s.str) * m.v('shard_str_pct') / 100 * m.stacks; } });
defAbility('centaur_double_edge', {
  prio: 60, ai: (ab, u, t) => (t && !t.isImmune() && !t.isBuilding && u.rangeTo(t) <= u.attackRange + 100 && u.hp / u.maxHp > 0.25 ? { target: t } : null),
  cast(ab, t) {
    const u = ab.owner;
    if (!t) return;
    const list = enemiesNear(ab, t.x, t.y, ab.v('radius')).filter((e) => !e.isBuilding); const heroes = list.filter((e) => e.isHero);
    // [L] measured in Hero Demo: the Shard strength stacks are added first, so this very strike already uses the raised strength
    if (ab.v('shard_str_pct') > 0 && heroes.length) { for (let i = 0; i < heroes.length; i++) addMod(ab, u, 'modifier_centaur_double_edge_buff', ab.v('shard_str_duration')); u.recompute(); }
    const dmg = ab.v('edge_damage') + u.str * ab.v('strength_damage') / 100;
    for (const e of list) {
      hit(ab, e, dmg, MAGICAL);
      if (e.isHero && e.alive && ab.v('shard_movement_slow') > 0) addMod(ab, e, 'modifier_centaur_double_edge_slow', ab.v('shard_movement_slow_duration'));
    }
    u.world.damage(u, u, dmg, MAGICAL, F_NON_LETHAL, ab);
  },
  fid: 'full', note: 'live: Centaur takes the same damage as the enemies (edge_damage + strength_damage% of strength, magical, reduced by his own magic resistance, non-lethal); Shard strength bonus = shard_str_pct% of his strength before this bonus per stack, added before the damage is dealt',
});
function centReturn(ab, attacker) {      // ab = the Retaliate ability of the Centaur whose strength counts
  const c = ab.owner;
  if (!attacker.alive || attacker.team === c.team) return;
  const dmg = (ab.v('return_damage') + c.str * ab.v('return_damage_str') / 100) * (attacker.isBuilding ? 0.5 : 1);      // "half damage to towers" (tooltip text)
  c.world.damage(c, attacker, dmg, PHYSICAL, attacker.isImmune() ? F_NO_AMP | F_NO_LIFESTEAL | F_PIERCE : F_REFLECT | F_NO_AMP, ab);
}
modifier('modifier_centaur_return', { hidden: true, purge: 'none', onAttacked(m, rec) { centReturn(m.ability, rec.attacker); } });
modifier('modifier_centaur_return_aura_buff', { purge: 'none', onAttacked(m, rec) { centReturn(m.ability, rec.attacker); } });
modifier('modifier_centaur_return_aura', {
  hidden: true, purge: 'none', interval: 0.5, thinkNow: true,
  onThink(m) { const u = m.parent; if (m.v('aura_enabled') > 0) for (const a of u.world.inRadius(u.x, u.y, m.v('aura_radius'), u.team, false)) if (a !== u && a.isHero) a.addModifier('modifier_centaur_return_aura_buff', { caster: u, ability: m.ability, duration: 1 }); },
});
defAbility('centaur_return', {
  mods: ['modifier_centaur_return', 'modifier_centaur_return_aura'],
  fid: 'approx', note: 'reflection damage (no spell amp, no lifesteal, not reflected again), halved against buildings (tooltip text); the engine blocks reflected damage on debuff-immune units, so against those it is sent as plain piercing damage; the aura talent returns damage from allied heroes using Centaur\'s own strength (assumed)',
});
passive('centaur_horsepower', { late(m, s, u) { const v = u.str * m.v('strength_to_movement_pct') / 100; if (v > s.msBoots) s.msBoots = v; }, fid: 'full', note: 'counts as a boots-type bonus: only the larger of it and the boots\' movement speed applies' });
// Stampede: max speed and a one-time trample per enemy for everyone buffed by the same cast
debuff('modifier_centaur_stampede_slow', { stats: (m) => ({ msPct: -m.v('slow_movement_speed') }) });
buff('modifier_centaur_stampede', {
  purge: 'none', interval: 0.05, stats: () => ({ msAbs: C.MS_MAX }),
  onThink(m) {
    const u = m.parent; const ab = m.ability; const c = ab.owner;
    for (const e of u.world.enemiesInRadius(u, u.x, u.y, m.v('radius'))) {
      if (m.data.seen.has(e) || e.isBuilding || e.st[ST.INVULN] > 0) continue;
      m.data.seen.add(e);
      u.world.damage(c, e, m.v('base_damage') + c.str * m.v('strength_damage'), MAGICAL, 0, ab);
      if (e.alive) e.addModifier('modifier_centaur_stampede_slow', { caster: c, ability: ab, duration: m.v('slow_duration') });
    }
  },
});
modifier('modifier_centaur_stampede_charge', {
  hidden: true, purge: 'none', state: ['DISARM'], interval: 0.05,
  onThink(m) { const u = m.parent; if (!u.cantAct() && u.st[ST.ROOT] === 0 && stepTo(u, m.data.x, m.data.y, 0.05)) m.remove(); },
  onDestroy(m) { const t = m.data.t; if (m.parent.alive && t.alive) m.parent.attack(t); },
});
function centStampede(st, units, dur) { const seen = new Set(); for (const a of units) { a.removeModifierByName('modifier_centaur_stampede'); a.addModifier('modifier_centaur_stampede', { caster: st.owner, ability: st, duration: dur, data: { seen } }); } }
// AI assumption: Centaur himself tramples through his current target (other allies only trample what they happen to touch)
function centCharge(u, dur) { const t = aiTarget(u); if (!t) return; const [dx, dy] = dirTo(u, t.x, t.y); u.addModifier('modifier_centaur_stampede_charge', { duration: Math.min(dur, 2), data: { x: t.x + dx * 150, y: t.y + dy * 150, t } }); }
defAbility('centaur_stampede', {
  prio: 85, engage: false, ai: (ab, u, t) => (t && t.isHero && u.distTo(t) <= 700 && !u.hasModifier('modifier_centaur_stampede') ? {} : null),
  cast(ab) { const u = ab.owner; const dur = ab.v('duration') + ab.v('scepter_bonus_duration'); centStampede(ab, u.world.units.filter((a) => a.alive && a.team === u.team && !a.isBuilding && a.st[ST.OUT] === 0 && playerUnit(a)), dur); centCharge(u, dur); },
  fid: 'approx', note: 'all allied heroes and player-owned units get max speed and trample (damage = strength x strength_damage, slow) enemies within `radius`, each enemy once per cast; AI assumption: Centaur runs through his target and 150 past it (not attacking meanwhile), other allies keep fighting and only trample what comes within `radius`; scepter_bonus_duration has no tooltip and is not used',
});
buff('modifier_centaur_work_horse', { purge: 'none' });
defAbility('centaur_work_horse', {
  prio: 78, engage: false, ai: (ab, u, t) => (t && u.distTo(t) <= 700 && !u.hasModifier('modifier_centaur_work_horse') && !u.hasModifier('modifier_centaur_stampede') ? {} : null),
  cast(ab) {
    const u = ab.owner; const dur = ab.v('duration'); const st = u.findAbility('centaur_stampede'); const mt = u.findAbility('centaur_mount');
    if (mt && mt.level < 1) { mt.setLevel(1); u.refreshAI(); }      // Hitch A Ride comes with Work Horse, whatever the skill build says
    addMod(ab, u, 'modifier_centaur_work_horse', dur);
    if (st && st.level > 0) { centStampede(st, [u], dur); centCharge(u, dur); }
  },
  fid: 'approx', note: 'gives Centaur alone the Stampede effect with Stampede\'s current values (level 1 values if it is not learned) and enables Hitch A Ride; the same run-through assumption as Stampede',
});
modifier('modifier_centaur_mount_rider', {
  purge: 'none', state: ['INVULN', 'UNTARGETABLE', 'ROOT'], interval: 0.05, thinkNow: true, stats: (m) => (m.parent.melee ? { attackRange: m.v('melee_attack_range') } : {}),
  onThink(m) { const c = m.caster; const r = m.parent; if (!c.alive || !c.hasModifier('modifier_centaur_work_horse')) { m.remove(); return; } r.x = c.x - 40; r.y = c.y; },
});
defAbility('centaur_mount', {
  prio: 77,
  ai(ab, u, t) {
    if (!t || !u.hasModifier('modifier_centaur_work_horse')) return null;
    const a = u.world.units.filter((x) => x !== u && x.alive && x.team === u.team && x.isHero && !x.isIllusion && x.st[ST.OUT] === 0 && !x.hasModifier('modifier_centaur_mount_rider') && u.distTo(x) <= 350 && x.hp / x.maxHp < 0.7).sort((p, q) => p.hp / p.maxHp - q.hp / q.maxHp)[0];
    return a ? { target: a } : null;
  },
  cast(ab, t) { const u = ab.owner; const wh = u.findModifier('modifier_centaur_work_horse'); if (t && t !== u && t.team === u.team && wh) t.addModifier('modifier_centaur_mount_rider', { caster: u, ability: ab, duration: Math.min(ab.v('duration'), wh.remaining()) }); },
  fid: 'approx', note: 'only usable while Work Horse is active; the rider is invulnerable, untargetable, carried along next to Centaur, keeps attacking and casting, melee riders get melee_attack_range; the ride ends with Work Horse; AI hitches an allied hero below 70% health; break_distance is not used. The data lists this hidden ability as an ordinary learnable basic ability, so the engine spends a skill point on it',
});

// ================================================================ Pugna
const PUG_WARD = 'npc_dota_pugna_nether_ward';
const PUG_DRAIN = 'modifier_pugna_life_drain';
// a decrepified enemy cannot be attacked, so the controller drops it as a target: Pugna's spells still aim at it
const pugTarget = (u, t) => t || u.world.units.filter((e) => e.alive && e.team !== u.team && e.st[ST.OUT] === 0 && e.findModifier('modifier_pugna_decrepify_enemy', u)).sort((a, b) => u.distTo(a) - u.distTo(b))[0] || null;
defAbility('pugna_nether_blast', {
  prio: 55, ai: (ab, u, t) => { const tt = pugTarget(u, t); return tt ? { x: tt.x, y: tt.y } : null; },
  cast(ab, t, x, y) { const w = ab.owner.world; w.after(ab.v('delay'), () => { if (w.skillshotHit < 1 && !w.rng.chance(w.skillshotHit)) return; for (const e of enemiesNear(ab, x, y, ab.v('radius'))) hit(ab, e, ab.v('blast_damage') * (e.isBuilding ? ab.v('structure_damage_mod') / 100 : 1), MAGICAL); }); },
  fid: 'full',
});
// [L] measured in Hero Demo: the decrepified unit also carries the disarmed state
debuff('modifier_pugna_decrepify_enemy', { state: ['ETHEREAL', 'DISARM'], stats: (m) => ({ msPct: m.v('bonus_movement_speed'), magicTakenPct: -m.v('bonus_spell_damage_pct') }) });
buff('modifier_pugna_decrepify_ally', { state: ['ETHEREAL', 'DISARM'], stats: (m) => ({ msPct: m.v('bonus_movement_speed_allies'), restore: m.v('bonus_heal_amp_pct_allies'), healAmp: m.v('bonus_heal_amp_pct_allies') }) });
defAbility('pugna_decrepify', {
  prio: 76,
  ai(ab, u, t) {      // before his own Life Drain, or on an enemy hero that is hitting him
    if (!t || !t.isHero || t.isImmune() || t.hasModifier('modifier_pugna_decrepify_enemy')) return null;
    const drain = hasLvl(u, 'pugna_life_drain');
    const threat = (t.orderTarget === u || t.attackTarget === u) && !t.isDisarmed() && t.rangeTo(u) <= t.attackRange + 100;
    return (drain && (drain.ready() || t.findModifier(PUG_DRAIN, u))) || threat ? { target: t } : null;
  },
  cast(ab, t) { const u = ab.owner; const tt = t || u; addMod(ab, tt, tt.team === u.team ? 'modifier_pugna_decrepify_ally' : 'modifier_pugna_decrepify_enemy', ab.v('AbilityDuration')); },
  fid: 'full', note: 'ethereal: cannot attack or be attacked, immune to physical damage; AI casts it on the enemy hero it is about to drain / is draining, or on one that attacks Pugna (allies and the ward only on an explicit order)',
});
modifier('modifier_pugna_nether_ward_unit', {
  hidden: true, purge: 'none', postMit: pipHit,
  onAnyCast(m, ev) {
    const wd = m.parent; const c = ev.caster;
    if (!c.alive || c.team === wd.team || !c.isHero || c.isIllusion || ev.ability.isItem || wd.distTo(c) > m.v('radius')) return;
    wd.world.damage(m.caster, c, m.v('base_damage') + (wd.world.freeSpells ? 0 : ev.ability.manaCost()) * m.v('mana_multiplier'), MAGICAL, 0, m.ability);
  },
});
defAbility('pugna_nether_ward', {
  prio: 66,
  ai(ab, u, t0) { const t = pugTarget(u, t0); const wd = ab.data; if (!t || (wd && wd.alive && wd.lifeEnd - u.world.time > 2) || !u.world.units.some((e) => e.alive && e.team !== u.team && e.isHero && !e.isIllusion)) return null; const [dx, dy] = dirTo(u, t.x, t.y); return { x: u.x + dx * 100, y: u.y + dy * 100 }; },
  cast(ab, t, x, y) {
    const u = ab.owner; const w = u.world;
    if (ab.data && ab.data.alive) w.kill(ab.data, null, null, true);
    const wd = w.summon(u, PUG_WARD, { x, y, duration: ab.v('AbilityDuration'), ovr: { hp: ab.v('attacks_to_destroy') }, ai: 'idle' });
    wd.addModifier('modifier_pugna_nether_ward_unit', { caster: u, ability: ab }); ab.data = wd;
  },
  fid: 'approx', note: 'the ward is a pip-health unit (only attacks hurt it); it punishes spells (not items) cast by enemy heroes within `radius` with base_damage + mana spent x mana_multiplier, credited to Pugna. The engine reports a cast after the spell has taken effect, so the damage lands right after the spell instead of before it (killing the caster does not cancel the spell)',
});
passive('pugna_oblivion_savant', {
  interval: 0.25, stats: (m) => ({ spellAmp: m.v('tower_scale') * m.stacks }),
  onAnyDeath(m, ev) { const v = ev.victim; if (v.isBuilding && v.team !== m.parent.team && /tower/.test(v.def.baseClass || '')) m.setStacks(m.stacks + 1); },
  onThink(m) {      // Scepter: spend a charge to cast an ability again while it is on cooldown
    const u = m.parent; const sv = m.ability; const max = sv.v('AbilityCharges');
    if (!(max > 0) || sv.charges < 1 || !u.ai || !pugTarget(u, aiTarget(u)) || u.cantAct() || u.isSilenced()) return;
    let best = null;
    const draining = u.hasModifier('modifier_pugna_life_drain_caster');
    for (const n of ['pugna_life_drain', 'pugna_decrepify', 'pugna_nether_blast']) {
      const a = hasLvl(u, n); if (!a || (draining && n === 'pugna_life_drain')) continue;
      const rem = a.cdRemaining();
      if (rem <= 0) return;                                                              // something is still ready: keep the charge
      if (rem >= 1.5 && a.cooldown() - rem >= sv.v('recast_min_cooldown') && u.mana >= a.manaCost() && (!best || rem > best.cdRemaining())) best = a;
    }
    if (!best) return;
    best.cdEnd = 0;
    if (sv.charges === max) sv.chargeEnd = u.world.time + sv.v('AbilityChargeRestoreTime') * u.cdrMul;
    sv.charges--;
  },
  fid: 'approx', note: 'casting while channeling: Life Drain is not an engine channel, so Pugna keeps casting during it; spell amp per destroyed enemy tower is counted when a tower dies in the simulation (or set with the unit option stacks: { pugna_oblivion_savant: N }); Scepter charges are spent by the controller on whichever of Life Drain / Decrepify / Nether Blast has the longest cooldown left (1.5 s or more), which is then cast again normally',
});
// [L] measured in Hero Demo: channeling Life Drain does not disarm Pugna; he just does not attack while channeling (an attack
// order would end the channel): the drain keeps him from attacking without the disarmed state
modifier('modifier_pugna_life_drain_caster', { purge: 'none', multi: 'stack',
  onCreated(m) { m.parent.canAttack = false; },
  onDestroy(m) { m.parent.canAttack = m.parent.def.atk !== 'none'; } });
function pugDrain(u, ab, t, amount) { const dealt = u.world.damage(u, t, amount, MAGICAL, 0, ab); if (dealt > 0 && u.alive) u.heal(dealt, u, ab); }
modifier(PUG_DRAIN, {
  multi: 'perCaster', purge: 'none', interval: (m) => m.v('tick_rate'),
  onCreated(m) { m.caster.addModifier('modifier_pugna_life_drain_caster', { ability: m.ability }); },
  onDestroy(m) { const c = m.caster.findModifier('modifier_pugna_life_drain_caster'); if (c) { if (c.stacks <= 1) c.remove(); else c.setStacks(c.stacks - 1); } },
  onThink(m) {
    const t = m.parent; const u = m.caster; const ab = m.ability; const amount = m.v('life_drain') * m.v('tick_rate');
    if (!u.alive || u.cantAct() || u.distTo(t) > ab.castRange() + m.v('drain_buffer')) { m.remove(); return; }
    if (t.name === PUG_WARD && t.team === u.team) {      // Shard: refracted to enemy heroes around the ward
      for (const e of u.world.inRadius(t.x, t.y, ab.castRange(), u.team, true)) if (e.isHero && !e.isImmune() && e.st[ST.INVULN] === 0) pugDrain(u, ab, e, amount * m.v('shard_damage_pct_from_ward') / 100);
    } else if (t.team !== u.team) {
      if (t.isImmune() || t.st[ST.INVULN] > 0 || t.st[ST.OUT] > 0) { m.remove(); return; }
      pugDrain(u, ab, t, amount);
    } else { const healed = t.heal(amount * (1 + u.spellAmp / 100), u, ab); if (healed > 0) u.world.damage(u, u, healed, MAGICAL, F_NON_LETHAL | F_NO_AMP, ab); }
  },
});
defAbility('pugna_life_drain', {
  prio: 70,
  ai(ab, u, t0) {
    const t = pugTarget(u, t0);
    if (!t) return null;
    const free = (e) => e.alive && e.team !== u.team && !e.isBuilding && !e.isImmune() && e.st[ST.INVULN] === 0 && e.st[ST.OUT] === 0 && !e.findModifier(PUG_DRAIN, u);
    const wa = u.findAbility('pugna_nether_ward'); const wd = wa && wa.data && wa.data.alive ? wa.data : null;
    if (wd && ab.v('shard_damage_pct_from_ward') > 0 && !wd.findModifier(PUG_DRAIN, u) && u.distTo(wd) <= ab.castRange() && u.world.inRadius(wd.x, wd.y, ab.castRange(), u.team, true).filter((e) => e.isHero && free(e)).length >= 2) return { target: wd };
    if (free(t)) return { target: t };
    const o = u.world.units.filter((e) => e.isHero && free(e) && u.distTo(e) <= ab.castRange() + 100).sort((p, q) => u.distTo(p) - u.distTo(q))[0];
    return o ? { target: o } : null;
  },
  cast(ab, t) { const u = ab.owner; if (t && t !== u && !t.findModifier(PUG_DRAIN, u)) t.addModifier(PUG_DRAIN, { caster: u, ability: ab, duration: ab.v('AbilityDuration') }); },      // [L] the tick on the channel's last instant does not land (39 ticks over 10 s)
  fid: 'approx', note: 'a link that ticks every tick_rate instead of an engine channel (no tick on its last instant): Pugna stands still without attacking (not disarmed; an explicit attack order is dropped instead of ending the drain) but can cast (Oblivion Savant); it breaks when he is disabled, the target dies, becomes debuff immune or moves beyond cast range + drain_buffer; enemy: magical damage, Pugna heals for the damage dealt; ally: heal (increased by his spell amp), Pugna takes the healed amount as non-lethal magical damage; Shard: on his ward the drain hits every enemy hero within cast range of it for shard_damage_pct_from_ward%. AI drains enemies (never allies), the ward when it reaches 2+ heroes',
});

// ================================================================ Vengeful Spirit
const VS_RETRI = 'modifier_vengefulspirit_retribution_debuff';
function vsMissile(ab, from, t, bounce) {
  const u = ab.owner; const w = u.world;
  w.projectile(from, t, ab.v('magic_missile_speed'), (tt) => {
    stun(ab, tt, ab.v('magic_missile_stun')); hit(ab, tt, ab.v('magic_missile_damage'), MAGICAL);
    if (!bounce || !u.hasShard) return;      // Shard: one bounce, heroes first
    const lim = ab.castRange() * ab.v('bounce_range_pct') / 100;
    const n = w.units.filter((e) => e !== tt && e.alive && e.team !== u.team && !e.isBuilding && !e.isImmune() && e.st[ST.OUT] === 0 && e.st[ST.INVULN] === 0 && e.distTo(tt) <= lim).sort((a, b) => (b.isHero - a.isHero) || (a.distTo(tt) - b.distTo(tt)))[0];
    if (n) vsMissile(ab, tt, n, false);
  });
}
defAbility('vengefulspirit_magic_missile', { prio: 70, cast(ab, t) { if (t) vsMissile(ab, ab.owner, t, true); }, fid: 'full', note: 'the Shard bounce picks the nearest hero (else the nearest unit) within bounce_range_pct of the cast range of the first target' });
// [L] measured in Hero Demo: the reduction lowers the shown attack damage (Axe 82 -> 70 at 15%): it is a cut of base damage
debuff('modifier_vengefulspirit_wave_of_terror', { stats: (m) => ({ armor: m.v('armor_reduction'), dmgBasePct: -m.v('attack_reduction') }) });
buff('modifier_vengefulspirit_wave_of_terror_buff', { multi: 'independent', purge: 'none', stats: (m) => ({ armor: m.data.armor, dmg: m.data.dmg }) });
defAbility('vengefulspirit_wave_of_terror', {
  prio: 50, ai: (ab, u, t) => (t && !t.hasModifier('modifier_vengefulspirit_wave_of_terror') ? { x: t.x, y: t.y } : null),
  cast(ab, t, x, y) {
    const u = ab.owner; const w = u.world; const [dx, dy] = dirTo(u, x, y); const L = ab.castRange(); const steal = ab.v('steal_pct') / 100; const R = ab.v('wave_width');
    // wave_width is the radius of the wave: a unit is hit once the wave centre comes within radius + hull of it
    // ([L] Hero Demo: targets 300 / 500 / 600 / 1000 / 1200 away were hit 0.03-0.07 s after this, never at centre distance / speed)
    for (const e of enemiesInLine(ab, u.x, u.y, u.x + dx * L, u.y + dy * L, 2 * R)) {
      if (e.isBuilding) continue;
      const along = (e.x - u.x) * dx + (e.y - u.y) * dy; const side = (e.x - u.x) * dy - (e.y - u.y) * dx; const rr = R + e.def.hull;
      w.after(Math.max(0, along - Math.sqrt(Math.max(0, rr * rr - side * side))) / ab.v('wave_speed'), () => {
        if (!e.alive) return;
        // [L] measured in Hero Demo (Axe 5.25 armor / 82 damage, Dragon Knight 41.33 / 164, target dummy 0 / 0, wave levels 2 and 4):
        // the talent steals steal_pct% of the hero's whole armor points and of its attack damage, whatever the reduction is
        const stA = Math.max(0, Math.floor(e.armor)) * steal; const stD = Math.max(0, (e.dmgMin + e.dmgMax) / 2 + e.dmgBonus) * steal;
        const d = addMod(ab, e, 'modifier_vengefulspirit_wave_of_terror', ab.v('AbilityDuration'));
        hit(ab, e, ab.v('damage'), MAGICAL);
        if (d && steal > 0 && e.isHero && u.alive) u.addModifier('modifier_vengefulspirit_wave_of_terror_buff', { ability: ab, duration: Math.max(0.1, d.remaining()), data: { armor: stA, dmg: stD } });
      });
    }
  },
  fid: 'approx', note: 'enemies on the wave line at cast time are hit when the wave (radius wave_width) reaches their hull; the hit time can be 1-2 ticks later than in the game; vision is not modelled; the steal talent gives Vengeful Spirit steal_pct of each enemy hero\'s whole armor points and attack damage (heroes only: assumed, creeps not measured), for the debuff\'s duration',
});
modifier('modifier_vengefulspirit_command_aura_buff', { purge: 'none', stats: (m) => ({ dmgBasePct: m.v('bonus_base_damage') * (m.parent === m.caster ? 1 + m.v('self_multiplier') / 100 : 1) }) });
modifier('modifier_vengefulspirit_command_aura', {
  hidden: true, purge: 'none', interval: 0.5, thinkNow: true,
  onThink(m) { const u = m.parent; for (const a of u.world.inRadius(u.x, u.y, m.v('aura_radius'), u.team, false)) if (a.heroLike) a.addModifier('modifier_vengefulspirit_command_aura_buff', { caster: u, ability: m.ability, duration: 1 }); },
});
// Scepter: on death a full-strength illusion that keeps casting her spells takes over
modifier('modifier_vengefulspirit_command_aura_death', {
  hidden: true, purge: 'none', breakable: false,
  onDeath(m) {
    const u = m.parent; const w = u.world; const ab = m.ability;
    if (u.isIllusion || !(ab.v('scepter_illusion_damage_out_pct') > 0)) return;
    w.after(0, () => {
      if (u.alive) return;
      const il = w.createIllusion(u, { outPct: ab.v('scepter_illusion_damage_out_pct') - 100, inPct: ab.v('scepter_illusion_damage_in_pct') - 100, potency: ab.v('scepter_illusion_effectiveness'), x: u.x, y: u.y });
      for (const a of u.abilities) { const c = il.findAbility(a.name); if (c) { c.refresh(); c.cdEnd = a.cdEnd; c.charges = a.charges; c.chargeEnd = a.chargeEnd; } }
      il.recompute(); il.hp = il.maxHp;
      if (w.makeAI && u.ai) il.ai = w.makeAI(u.ai.mode);
    });
  },
});
defAbility('vengefulspirit_command_aura', {
  mods: ['modifier_vengefulspirit_command_aura', 'modifier_vengefulspirit_command_aura_death'], illusion: true,
  fid: 'approx', note: 'aura: base damage % for allied heroes (illusions of Vengeful Spirit carry it too), x(1 + self_multiplier%) on herself. Scepter: when she dies a strong illusion appears at full health with her mana and cooldowns, deals and takes normal damage, has 100% item potency and uses her abilities (not items); it lasts until the end of the simulation since there is no respawn, and it does not count for the win condition',
});
debuff(VS_RETRI, { purge: 'none', pierce: true, statusResist: false });
passive('vengefulspirit_retribution', {
  onDeath(m, ev) {
    const u = m.parent; const k = ev.killer && ev.killer.isSummon && ev.killer.owner ? ev.killer.owner : ev.killer;
    if (!k || k === u || !k.isHero || k.team === u.team) return;
    u.world.after(0, () => { if (u.alive || !k.alive) return; for (const e of u.world.units) { const d = e.findModifier(VS_RETRI, u); if (d) d.remove(); } k.addModifier(VS_RETRI, { caster: u, ability: m.ability }); });
  },
  outgoing(m, d) { if (d.dst.findModifier(VS_RETRI, m.parent)) d.amount *= 1 + m.v('bonus_damage') / 100; },
  fid: 'partial', note: 'not modelled: counting as both a melee and a ranged attacker (the engine gives a unit one attack type; she is ranged). The killer is marked and would take bonus_damage% more from her, but that only matters if she returns to life during the simulation (no respawn)',
});
buff('modifier_vengefulspirit_nether_swap_barrier', { postMit(m, d) { if (d.amount <= 0 || (d.flags & F_HP_LOSS)) return; const a = Math.min(d.amount, m.data.left); d.amount -= a; m.data.left -= a; if (m.data.left <= 1e-6) m.remove(); } });
defAbility('vengefulspirit_nether_swap', {
  prio: 72,
  ai(ab, u, t) {      // on a channeling hero, or on a hero that stands apart from the other enemies (she takes its place)
    if (!t || !t.isHero || t.isIllusion) return null;
    const crowded = u.world.units.some((e) => e !== t && e.alive && e.team !== u.team && e.st[ST.OUT] === 0 && e.def.atk !== 'none' && e.distTo(t) <= 500);
    return t.channelAb || (u.distTo(t) >= 250 && !crowded) ? { target: t } : null;
  },
  cast(ab, t) {
    const u = ab.owner; const dmg = ab.v('damage'); const dur = ab.v('damage_reduction_duration');
    if (!t || t === u) return;
    const x = u.x; const y = u.y; u.x = t.x; u.y = t.y; t.x = x; t.y = y;
    const shield = (a) => { a.removeModifierByName('modifier_vengefulspirit_nether_swap_barrier'); a.addModifier('modifier_vengefulspirit_nether_swap_barrier', { caster: u, ability: ab, duration: dur, data: { left: dmg } }); };
    shield(u);
    if (t.team === u.team) shield(t); else { if (t.channelAb) t.endChannel(true); hit(ab, t, dmg, MAGICAL); }
  },
  fid: 'approx', note: 'the barrier (all damage) equals the ability\'s damage value, also when an ally is swapped; AI swaps with an enemy hero that is channeling, or that is at least 250 away with no other enemy within 500 of it; never with allies',
});
