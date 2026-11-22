// Creep / neutral / Roshan abilities. Attack and armor classes are abilities in the shipped data (since 7.31).
import { defAbility, modifier, buff, debuff, passive, nuke, val, neg, hit, addMod, stun, enemiesNear, mhit, critHook, bashHook, dot, aura, nearAI,
  ST, PHYSICAL, MAGICAL, F_ATTACK, F_SECONDARY } from '../engine/dsl.mjs';

const heavy = (u) => u.isBuilding || u.hasModifier('modifier_creep_siege');
// "Reinforced": bonus damage to other reinforced units / buildings, takes less attack damage from everything else
passive('creep_siege', {
  fid: 'full',
  outgoing(m, d) { if ((d.flags & F_ATTACK) && heavy(d.dst)) d.amount *= 1 + m.v('bonus_building_damage') / 100; },
  preMit(m, d) {
    if (!(d.flags & F_ATTACK) || !d.src || heavy(d.src)) return;
    const s = d.src;
    const pen = s.isHero ? m.v('incoming_hero_damage_penalty') : s.isSummon || s.isIllusion ? m.v('incoming_controlled_unit_penalty') : m.v('incoming_basic_damage_penalty');
    d.amount *= 1 + pen / 100;
  },
});
passive('creep_piercing', { fid: 'full', outgoing(m, d) { if (!(d.flags & F_ATTACK)) return; const t = d.dst; d.amount *= 1 + (t.isHero ? m.v('hero_damage_penalty') : heavy(t) ? m.v('heavy_damage_penalty') : m.v('creep_damage_bonus')) / 100; } });
passive('creep_irresolute', { fid: 'full', outgoing(m, d) { if ((d.flags & F_ATTACK) && d.dst.isHero) d.amount *= 1 + m.v('hero_damage_penalty') / 100; } });

// neutral creeps grow with game time: stacks = floor(match clock / increase_time); the clock is the scenario rule `gameTime` + fight time.
// [L] measured in Hero Demo (granite golem, clock about 2:59:55): the modifier appears with 0 stacks, takes its stacks 1 s later
// (23 -> +11.5 armor, +115 attack speed, +69 damage, +690 health) and gains the next one on the second the clock crosses 24 x 450 s.
passive('neutral_upgrade', {
  fid: 'approx', note: 'the ability has no tooltip: one stack per increase_time of the match clock (rule gameTime + fight time), each adding the increase_* values, updated once per second starting 1 s after the unit appears (measured); the gold and experience values have no effect here',
  interval: 1,
  onCreated(m) { m.stacks = 0; },
  onThink(m) { const w = m.parent.world; m.setStacks(Math.min(m.v('max_level'), Math.floor(((w.gameTime || 0) + w.time) / m.v('increase_time')))); },
  // [L] the damage is bonus damage: Alpha Wolf's Command Aura (% of base damage) does not scale it (12 stacks: 28 x 1.2 + 36 = 69)
  stats: (m) => ({ dmg: m.v('increase_damage') * m.stacks, as: m.v('increase_aspd') * m.stacks, hp: m.v('increase_health') * m.stacks, armor: m.v('increase_armor') * m.stacks }),
});
// [L] measured in Hero Demo (Undying's tombstone, level 1): the ability creates no modifier and the unit is not debuff immune
passive('neutral_spell_immunity', { fid: 'n/a', note: 'no effect in the live game: no modifier, no immunity state (measured on the tombstone); the tooltip says "most magical spells"' });

// ---------------------------------------------------------------- Roshan
// [L] measured in Hero Demo: the bonus damage is part of the attack (one instance: 257 + 50 = 307), not a separate hit
passive('roshan_bash', { fid: 'full',
  onAttack(m, rec) { const t = rec.target; if (t.isBuilding || !m.roll(m.v('bash_chance'))) return; rec.flat += m.v('bonus_damage'); (rec.data ||= {}).roshBash = m; },
  onAttackLanded(m, rec) { const t = rec.target; if (rec.data && rec.data.roshBash === m && t.alive) t.addModifier('modifier_stunned', { caster: m.parent, ability: m.ability, duration: m.v('stun_duration'), pierce: true }); } });
passive('roshan_spell_block', { fid: 'full', stats: { statusRes: 'status_resistance' }, onSpellTargeted(m, ev) { if (m.ability.cdReady()) { ev.blocked = true; m.ability.startCooldown(); } } });
passive('roshan_devotion', { stats: { slowRes: 'slow_resistance' }, fid: 'partial', note: 'slow resistance only. The damage reduction against attacking illusions has no value in the data and is not modelled; the magic resistance is part of the unit and the armor growth is in roshan_inherent_buffs' });
debuff('modifier_roshan_slam', { stats: (m) => ({ msPct: -m.v('slow_amount'), asSlow: -m.v('slow_amount') }) });
// [L] Roshan's abilities count the minute that has begun on the match clock: Slam at 26:22 dealt 255 magical to the dummy = (70 + 10 x 27) x 0.75
const roshMinutes = (w) => Math.ceil(((w.gameTime || 0) + w.time) / 60);
defAbility('roshan_slam', { fid: 'full', prio: 50, ai: nearAI('radius'), cast(ab) { const u = ab.owner; const dmg = ab.v('damage') + ab.v('damage_growth') * roshMinutes(u.world); for (const e of enemiesNear(ab, u.x, u.y, ab.v('radius'))) { hit(ab, e, e.heroLike ? dmg : dmg * (1 + ab.v('damage_bonus_creeps') / 100), MAGICAL); addMod(ab, e, 'modifier_roshan_slam', ab.v('slow_duration')); } } });
// Roshan grows with game time. The per-minute numbers are not in the data files; they come from the shipped patch notes:
// "Roshan's HP increase per minute increased from 115 to 130" (7.33), "Attack damage per minute increased from 4 to 6" (7.22),
// "Strength of the Immortal: Armor Bonus per minute increased from 0.375 to 0.4" (7.39).
// [L] measured in Hero Demo (clock about 115 minutes, from the neutral_upgrade stacks of the same session): health 6000 -> 20950
// (+130 x 115) and attack damage 75 -> 880 (+7 x 115), so the damage growth is 7 per minute, not 6.
const ROSHAN_HP_PER_MIN = 130; const ROSHAN_DMG_PER_MIN = 7; const ROSHAN_ARMOR_PER_MIN = 0.4;
// [L] the armor counts the minute that has begun: 30 -> 76.4 at 115 min, 30 -> 75.2 at 112 min (0.4 x 116 / 0.4 x 113)
// [L] the growth follows the running match clock (at 25:58 + 2.1 s health 9250 -> 9380, damage 250 -> 257, armor 40.4 -> 40.8), and
// Roshan has +100 attack speed at every time measured (200 at 26 and at 115 minutes; one attack per second).
const ROSHAN_AS = 100;
const roshClock = (m) => (m.parent.world.gameTime || 0) + m.parent.world.time;
passive('roshan_inherent_buffs', { interval: 0.1, thinkNow: true,
  onThink(m) { m.setStacks(Math.floor(roshClock(m) / 60) * 2 + (roshClock(m) % 60 > 1e-9 ? 1 : 0)); },  // changes whenever floor or ceil of the minute changes
  stats: (m) => { const c = roshClock(m); const min = Math.floor(c / 60); return { hp: ROSHAN_HP_PER_MIN * min, dmgBase: ROSHAN_DMG_PER_MIN * min, armor: ROSHAN_ARMOR_PER_MIN * Math.ceil(c / 60), as: ROSHAN_AS }; },
  fid: 'approx', note: 'health and armor growth per minute come from the shipped patch notes (the data has no values for them), the damage growth (7 per minute) and the +100 attack speed were measured; the values follow the running clock (rule gameTime + fight time); the pit-relocation values (move_pits_*) need the map and are not used' });

// ---------------------------------------------------------------- common neutral passives / auras
passive('alpha_wolf_critical_strike', { fid: 'full', onAttack: critHook('crit_chance', 'crit_mult') });
const neutralAura = (name, child, radius, stats, filter) => { modifier(child, { purge: 'none', stats }); aura('modifier_' + name, { radius, team: 'ally', child, filter }); defAbility(name, { mods: ['modifier_' + name], fid: 'full' }); };
neutralAura('alpha_wolf_command_aura', 'modifier_alpha_wolf_command_aura_buff', 'radius', { dmgBasePct: 'bonus_damage_pct' });
neutralAura('centaur_khan_endurance_aura', 'modifier_centaur_khan_endurance_aura_buff', 'radius', { as: 'bonus_attack_speed' });
neutralAura('enraged_wildkin_toughness_aura', 'modifier_enraged_wildkin_toughness_aura_buff', 'radius', { armor: 'bonus_armor' });
// [L] measured in Hero Demo: the archer itself keeps its own speeds (425 / 109 for archer 3), the aura only reaches other allies
neutralAura('necronomicon_archer_aoe', 'modifier_necronomicon_archer_aoe_buff', 'radius', { msPct: 'ms_bonus', as: 'as_bonus' }, (t, m) => t !== m.parent);
debuff('modifier_ghost_frost_attack_debuff', { stats: { msPct: 'movespeed_slow', asSlow: 'attackspeed_slow' } });
passive('ghost_frost_attack', { fid: 'full', onAttackLanded(m, rec) { if (rec.target.alive) rec.target.addModifier('modifier_ghost_frost_attack_debuff', { caster: m.parent, ability: m.ability, duration: m.v('duration') }); } });
dot('modifier_gnoll_assassin_envenomed_weapon_debuff', { damage: 'damage_per_second', type: MAGICAL, interval: 1, stats: (m) => ({ restore: -m.v('regen_reduction') }) });
passive('gnoll_assassin_envenomed_weapon', { fid: 'full', onAttackLanded(m, rec) { const t = rec.target; if (t.alive) t.addModifier('modifier_gnoll_assassin_envenomed_weapon_debuff', { caster: m.parent, ability: m.ability, duration: (t.heroLike ? m.v('hero_duration') : m.v('non_hero_duration')) + 0.01 /* keeps the tick that falls on the expiry instant */ }); } });
passive('necronomicon_warrior_mana_burn', { fid: 'full', onAttackLanded(m, rec) { const t = rec.target; if (!t.alive || t.maxMana <= 0) return; const b = t.burnMana(m.v('burn_amount')); if (b > 0) mhit(m, t, b * m.v('burn_damage_conversion') / 100, MAGICAL); } });
debuff('modifier_big_thunder_lizard_slam', { stats: { msPct: 'movespeed_slow', asSlow: 'movespeed_slow' } });
defAbility('big_thunder_lizard_slam', {
  prio: 40, ai: nearAI('radius'), fid: 'approx', note: 'each of the pulse_count waves deals AbilityDamage and refreshes the slow (the tooltip does not say whether the damage is per wave or in total); waves start from the caster position at cast time',
  cast(ab) {
    const u = ab.owner; const w = u.world; const n = ab.v('pulse_count') || 1; const x = u.x; const y = u.y;
    for (let i = 0; i < n; i++) {
      w.after(i * ab.v('pulse_interval'), () => {
        if (!u.alive) return;
        for (const e of enemiesNear(ab, x, y, ab.v('base_radius') + ab.v('radius_increment_per_pulse') * i)) {
          hit(ab, e, ab.v('AbilityDamage'), MAGICAL);
          addMod(ab, e, 'modifier_big_thunder_lizard_slam', e.heroLike ? ab.v('hero_duration') : ab.v('non_hero_duration'));
        }
      });
    }
  },
});
nuke('mud_golem_hurl_boulder', { prio: 40, speed: 'speed', stun: 'duration', fid: 'approx', note: 'damage_creeps is taken as the damage against non-hero units (the tooltip gives one damage line)',
  also: (ab, t) => { hit(ab, t, t.heroLike ? ab.v('damage') : ab.v('damage_creeps'), MAGICAL); } });
defAbility('generic_hidden', { fid: 'n/a' });
defAbility('backdoor_protection', { fid: 'n/a', note: 'map mechanic' });
defAbility('backdoor_protection_in_base', { fid: 'n/a', note: 'map mechanic' });
