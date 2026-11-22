// Item effects. Plain stat bonuses ("+$damage" tooltips etc.) are applied automatically from the data pack;
// this file only adds what the numbers alone cannot express. All values are read from the shipped data by name.
// Every script carries a fidelity label (`fid`) checked against the 7.42 tooltip, and a `note` when it is not 'full'.
import { defAbility, modifier, buff, debuff, passive, active, val, neg, pot, hit, addMod, stun, enemiesNear, alliesNear, mhit,
  critHook, bashHook, aura, chain, cleave, barrier, giveBarrier, extraAttack, gapAI, ST, PHYSICAL, MAGICAL, PURE,
  F_REFLECT, F_HP_LOSS, F_NON_LETHAL, F_NO_AMP, F_ATTACK, F_SECONDARY, F_PIERCE, F_NO_ARMOR } from '../engine/dsl.mjs';
import { abilityScripts } from '../engine/registry.mjs';
import { armorMult } from '../engine/constants.mjs';

const I = (n) => 'item_' + n;
// items whose remaining values are irrelevant for fights (or already covered by stat tokens)
const covered = (names) => names.split(' ').forEach((n) => defAbility(I(n), { fid: 'full' }));
const ignored = (names) => names.split(' ').forEach((n) => defAbility(I(n), { fid: 'n/a', note: 'utility item, no combat effect modelled' }));
covered('power_treads shawl cloak bracer wraith_band null_talisman travel_boots travel_boots_2 boots');
ignored('ward_sentry ward_observer ward_dispenser smoke_of_deceit branches dust tpscroll gem hand_of_midas helm_of_the_dominator helm_of_the_overlord blood_grenade tango clarity flask bottle');

// ---------------------------------------------------------------- shared helpers
const rootOwner = (u) => { let o = u; while (o.owner && o.owner !== o) o = o.owner; return o; };
// "player unit" / "player based damage": a hero, an illusion, or anything one of them summoned
const playerOwned = (u) => rootOwner(u).heroLike;
// Two copies of one item share a single intrinsic modifier in the engine: effects that "do not stack" between copies hold by
// construction, effects that should add up multiply by the number of equipped copies.
const copies = (m) => { const n = m.ability.name; let k = 0; for (const it of m.parent.items) if (it.name === n && it.slot !== 'backpack') k++; return k || 1; };
const hasAny = (u, ...names) => names.some((n) => u.hasModifier(n));
// Periodic damage. The engine expires a modifier before it runs a think that falls on the same instant, so the last tick of
// "X per second for N seconds" would be lost; it is delivered from onDestroy instead.
const ticking = (tick, def = {}) => ({ ...def, onThink: tick, onDestroy(m, expired) { if (expired && m.parent.alive && m.nextThink <= m.dieTime + 1e-6) tick(m); } });
// "does not affect units that were affected within the item's cooldown": a hidden marker on the unit
const marker = (name) => modifier(name, { hidden: true, purge: 'none' });
const once = (ab, t, mark) => { if (t.hasModifier(mark)) return false; t.addModifier(mark, { ability: ab, duration: ab.cooldown() }); return true; };
// first value of an item in the data pack (for effects that have no item to read from)
const dataVal = (u, item, key) => { const e = u.world.data.abilities[item].vals[key]; return (Array.isArray(e) ? e : e.v)[0]; };
// Stat tokens are simply added up by the engine, although some item families say that their bonuses do not stack. The first
// scripted member of such a family in the inventory takes back whatever exceeds the best single bonus.
const tokenSum = (it, ok) => { let r = 0; const tok = it.def.tokens || {}; for (const k in tok) if (ok(tok[k])) r += it.vals[k] || 0; return r; };
const builtFrom = (it, base) => it.name === base || (it.def.comps || []).includes(base);
function familyFix(member, handler, bonus, stat) {
  return function apply(m, s, u) {
    const fam = u.items.filter((it) => it.slot !== 'backpack' && member(it)); const first = fam.find(handler);
    if (fam.length < 2 || !first || first.name !== m.ability.name) return;
    let sum = 0; let best = 0;
    for (const it of fam) { const r = bonus(it, u); sum += r; if (r > best) best = r; }
    s[stat] -= sum - best;
  };
}
// "Attack Range bonuses from Dragon Lance and its upgrades do not stack" (Hurricane Pike applies the same rule in items_2.mjs)
const LANCE = 'item_dragon_lance';
const lanceRangeFix = familyFix((it) => builtFrom(it, LANCE), (it) => it.name !== LANCE, (it, u) => tokenSum(it, (t) => t === 'attack_range_all' || t === (u.melee ? 'attack_range_melee' : 'attack_range')), 'attackRange');
// "AoE bonuses from multiple Chasm Stones or its upgrades do not stack" (Shiva's Guard, Gleipnir)
const CHASM = 'item_chasm_stone';
const chasmAoeFix = familyFix((it) => builtFrom(it, CHASM), (it) => it.name !== CHASM, (it) => tokenSum(it, (t) => t === 'aoe_bonus'), 'aoe');
// "Cast Range bonuses from Aether Lens and Dagon do not stack"
const isDagon = (it) => it.name.startsWith('item_dagon');
const dagonRangeFix = familyFix((it) => isDagon(it) || it.name === 'item_aether_lens', isDagon, (it) => tokenSum(it, (t) => t === 'cast_range'), 'castRange');

// ---------------------------------------------------------------- simple stat passives (non-token values)
// Mana Regen Amplification does not stack between Kaya-based items (7.37b notes): only the best equipped one counts
function kayaRegenAmp(m) {
  let best = null;
  for (const it of m.parent.items) { const v = it.vals.mana_regen_multiplier; if (it.slot === 'backpack' || !(v > 0)) continue; if (!best || v > best.vals.mana_regen_multiplier) best = it; }
  return best && best.name === m.ability.name ? best.vals.mana_regen_multiplier : 0;
}
passive(I('kaya'), { fid: 'full', stats: (m) => ({ spellAmp: m.v('spell_amp'), manaRegenAmp: kayaRegenAmp(m) }) });
// Health Restoration ("%+$restoration_amp" stat token): the engine applies the token to regeneration and lifesteal; since 7.41 the
// stat covers every form of life gain, so heals received (anything that is not lifesteal) are amplified here
function restoreHeals(m, ev) {
  if (!ev.ability) return;   // lifesteal carries no ability and is covered by the token
  const u = m.parent; const add = Math.min(u.maxHp - u.hp, ev.amount * m.v('hp_regen_amp') / 100);
  if (add <= 0) return;
  u.hp += add;
  if (ev.src) ev.src.mHealed += add;
  if (u.world.log && add >= 1) u.world.logEvent('heal', ev.src, u, m.ability.name, add);
}
passive(I('sange'), { fid: 'full', stats: { slowRes: 'slow_resistance' }, onHealed: restoreHeals });
// Yasha-based movement speed does not stack between items: same bucket as the "%+$move_speed" tokens of Yasha and Manta (highest wins)
const yashaSpeed = (m, s) => { const v = m.parent.melee ? m.v('movement_speed_percent_bonus_melee') : m.v('movement_speed_percent_bonus'); if (v > s.msPctItem) s.msPctItem = v; };
passive(I('sange_and_yasha'), { fid: 'full', onHealed: restoreHeals, apply(m, s) { s.statusResMul *= 1 - m.v('status_resistance') / 100; s.slowResMul *= 1 - m.v('slow_resistance') / 100; yashaSpeed(m, s); } });
passive(I('kaya_and_sange'), { fid: 'partial', note: '"Mana Cost/Mana Loss Reduction": mana costs are reduced, mana lost to enemy mana burn is not (no engine hook)', onHealed: restoreHeals, stats: (m) => ({ slowRes: m.v('slow_resistance'), manaRegenAmp: kayaRegenAmp(m), spellAmp: m.v('spell_amp'), manaCostRed: m.v('manacost_reduction') }) });
passive(I('yasha_and_kaya'), { fid: 'partial', note: '"+% Cast Speed Bonus" is not modelled (the engine has no cast-speed stat)', apply(m, s) { s.manaRegenAmp += kayaRegenAmp(m); s.spellAmp += m.v('spell_amp'); yashaSpeed(m, s); } });
// [L] measured in Hero Demo: the active switches the mode (damage -> spell amplification)
modifier('modifier_item_rapier', { hidden: true, stats: (m) => ((m.stacks > 0) !== (m.ability.data === 'spell') ? { spellAmp: m.v('bonus_spell_amp') } : { dmg: m.v('bonus_damage') * copies(m) }) });
defAbility(I('rapier'), {
  mods: ['modifier_item_rapier'], fid: 'approx', note: 'damage mode by default, spell amplification after the item is used (or from the start with scenario stacks: { item_rapier: 1 }); the AI does not switch it; dropping on death has no effect in the sandbox',
  cast(ab) { ab.data = ab.data === 'spell' ? null : 'spell'; ab.owner.dirty = true; }, ai: () => null,
});
modifier('modifier_moon_shard_consumed', { purge: 'none', stats: (m) => ({ as: dataVal(m.parent, 'item_moon_shard', 'consumed_bonus') }) });
covered('moon_shard');

// Heart: +% max health regeneration (stat line without a token) and regeneration from missing health
passive(I('heart'), {
  fid: 'approx', note: 'the missing-health regeneration is added in 0.1 s steps and is not amplified by regeneration amplification',
  stats: (m) => ({ hpRegenPct: m.v('hp_regen') * copies(m) }),
  interval: 0.1, onThink(m) { const u = m.parent; const miss = u.maxHp - u.hp; if (miss > 0) u.heal(miss * m.v('missing_health_regen') / 100 * 0.1, u, m.ability, true); },
});

// ---------------------------------------------------------------- crits / bash / pierce
const critChance = (m) => (1 - Math.pow(1 - m.v('crit_chance') / 100, copies(m))) * 100;   // every copy rolls on its own
passive(I('lesser_crit'), { fid: 'full', onAttack: critHook(critChance, 'crit_multiplier') });
passive(I('greater_crit'), { fid: 'full', onAttack: critHook(critChance, 'crit_multiplier') });

const NO_ITEM_BASH = new Set(['npc_dota_hero_spirit_breaker', 'npc_dota_hero_faceless_void', 'npc_dota_hero_slardar']);
const BASH_NOTE = 'Bash pierces debuff immunity (item data). Not modelled: the exclusion of Kez in Sai mode, and "does not stack with other sources of Bash" (each source rolls on its own)';
// [L] measured in Hero Demo: the bash damage is part of the attack's own damage instance (264.64 + 120 = 384.64, one instance);
// the stun lands with the attack. Rolled when the attack starts, applied when it lands.
function basherHook(dmgKey) {
  return {
    onAttack(m, rec) {
      const t = rec.target; const w = m.parent.world;
      if (NO_ITEM_BASH.has(m.parent.name) || t.isBuilding || w.time < m.x) return;
      if (!m.roll((m.parent.melee ? m.v('bash_chance_melee') : m.v('bash_chance_ranged')) * rec.potency / 100)) return;
      m.x = w.time + m.v('bash_cooldown');
      rec.add += m.v(dmgKey); (rec.data ||= {}).bash = m;
    },
    onAttackLanded(m, rec) {
      const t = rec.target;
      if (rec.data && rec.data.bash === m && t.alive) t.addModifier('modifier_stunned', { caster: m.parent, ability: m.ability, duration: m.v('bash_duration'), pierce: true });
    },
  };
}
passive(I('basher'), { fid: 'approx', note: BASH_NOTE, ...basherHook('bonus_chance_damage') });
defAbility(I('abyssal_blade'), {
  mods: ['modifier_item_abyssal_blade'], prio: 60, fid: 'approx', note: BASH_NOTE,
  onAdded(ab) { ab.pierces = true; },   // "Pierces Debuff Immunity" (the item data carries no immunity flag for the active)
  cast(ab, t) { t.addModifier('modifier_stunned', { caster: ab.owner, ability: ab, duration: ab.v('stun_duration'), pierce: true }); },
});
modifier('modifier_item_abyssal_blade', { hidden: true, apply: lanceRangeFix, ...basherHook('bonus_chance_damage') });

// Monkey King Bar: chance to pierce evasion and add magical damage
// [L] measured in Hero Demo: proc damage of items (MKB's magical damage, Diffusal's mana burn damage) is not a damage instance of
// its own: it is part of the attack's instance (240.24 + 70 x 0.75 magic resistance = 292.74, one physical instance).
// The engine's attack is physical only, so a magical part is added already reduced by the target's magic resistance and
// divided by what armor / outgoing damage will do to it (exact for melee attacks; ranged ones read the target at launch).
const asPhysical = (u, t, amount) => { if (t.dirty) t.recompute(); const k = armorMult(t.armor) * t.physTakenMul * u.dmgOutMul; return k > 0 ? amount / k : 0; };
const magicIntoAttack = (u, t, amount) => asPhysical(u, t, amount * (1 - t.mr) * t.magicTakenMul);
passive(I('monkey_king_bar'), {
  fid: 'full', illusion: true,
  onAttack(m, rec) {
    if (!m.roll(m.v('bonus_chance') * rec.potency / 100)) return;
    rec.trueStrike = true;
    if (!rec.target.isBuilding) rec.add += magicIntoAttack(m.parent, rec.target, m.parent.isIllusion ? m.v('bonus_chance_damage_illu') : m.v('bonus_chance_damage'));
  },
});

// Maelstrom / Mjollnir chain lightning: leaps to the nearest new enemy within the radius, chain_delay apart
function chainLightning(m, first) {
  const u = m.parent; const dmg = m.v('chain_damage');
  chain(u, first, m.v('chain_strikes'), m.v('chain_radius'), (e) => u.world.damage(u, e, dmg, MAGICAL, 0, m.ability), m.v('chain_delay'));
}
const chainMod = {
  hidden: true,
  onAttack(m, rec) { const w = m.parent.world; if (w.time >= m.x && m.roll(m.v('chain_chance') * rec.potency / 100)) { m.x = w.time + m.v('chain_cooldown'); rec.trueStrike = true; (rec.data ||= {}).chain = m; } },
  onAttackLanded(m, rec) { if (rec.data && rec.data.chain === m) chainLightning(m, rec.target); },
};
passive(I('maelstrom'), { fid: 'full', ...chainMod });
modifier('modifier_item_mjollnir', chainMod);
buff('modifier_item_mjollnir_static', {
  onAttacked(m, rec) {
    const u = m.parent; const w = u.world; const a = rec.attacker; const r = m.v('static_seconary_radius');
    if (w.time < m.x || a.team === u.team || u.distTo(a) > r || !m.roll(m.v('static_chance'))) return;
    m.x = w.time + m.v('static_cooldown');
    const others = w.inRadius(u.x, u.y, r, u.team, true).filter((e) => e !== a).sort((p, q) => u.distTo(p) - u.distTo(q)).slice(0, m.v('static_strikes'));
    for (const e of [a, ...others]) if (e.alive) mhit(m, e, m.v('static_damage'), MAGICAL);
  },
});
defAbility(I('mjollnir'), {
  mods: ['modifier_item_mjollnir'], fid: 'approx',
  note: 'Static Charge: the attacker and the additional enemies (nearest first) must be within static_seconary_radius of the shielded unit; the purpose of static_primary_radius is not stated and it is not used. AI: cast on itself when the target is within shock range',
  cast(ab, t) { addMod(ab, t || ab.owner, 'modifier_item_mjollnir_static', ab.v('static_duration')); },
  ai: (ab, u, t) => (t && u.distTo(t) <= ab.v('static_radius') && !u.hasModifier('modifier_item_mjollnir_static') ? { target: u } : null),
});

// ---------------------------------------------------------------- on-hit debuffs (scaled by Item Potency where the data says so)
// Corruption family (armor): Desolator > Orb of Blight / Orb of Corrosion do not stack.
// Frost family (slow, health restoration): Eye of Skadi > Orb of Corrosion > Orb of Frost do not stack. All three pierce debuff immunity.
const BLIGHT = 'modifier_item_blight_stone_debuff'; const DESO = 'modifier_item_desolator_debuff';
const FROST = 'modifier_item_orb_of_frost_debuff'; const CORROSION = 'modifier_item_orb_of_corrosion_debuff'; const SKADI = 'modifier_item_skadi_debuff';
const slowByTarget = (melee, ranged) => (m) => (m.parent.melee ? m.v(melee) : m.v(ranged)) * m.potency / 100;
const frostStats = (m) => ({ msPct: slowByTarget('slow_melee', 'slow_ranged')(m), restore: -m.v('heal_reduction') * m.potency / 100 });
debuff(BLIGHT, { stats: { armor: pot('corruption_armor') } });
debuff(DESO, {
  stats: { armor: pot('corruption_armor') },
  onCreated(m) { m.parent.removeModifierByName(BLIGHT); },
  // Soul Stealer: the wearer's Desolator gains damage when an enemy hero dies while corrupted (kept as stacks of the item's modifier)
  onDeath(m) {
    const v = m.parent;
    if (!v.isHero || v.isIllusion) return;
    const it = rootOwner(m.caster).findAbility('item_desolator'); const pm = it && it.mods[0];
    if (pm) pm.setStacks(Math.min(it.v('max_damage'), pm.stacks + it.v('bonus_damage_per_kill')));
  },
});
debuff(FROST, { pierce: true, stats: (m) => (hasAny(m.parent, CORROSION, SKADI) ? null : frostStats(m)) });
debuff(CORROSION, { pierce: true, stats: (m) => ({ armor: hasAny(m.parent, BLIGHT, DESO) ? 0 : pot('corruption_armor')(m), ...(m.parent.hasModifier(SKADI) ? null : frostStats(m)) }) });
debuff(SKADI, { pierce: true, stats: (m) => ({ msPct: slowByTarget('cold_slow_melee', 'cold_slow_ranged')(m), asSlow: slowByTarget('cold_attack_slow_melee', 'cold_attack_slow_ranged')(m), restore: -m.v('restoration_reduction') * m.potency / 100 }) });
const onHitDebuff = (item, mod, dur, o = {}) => passive(I(item), {
  fid: o.fid || 'full', note: o.note, illusion: true, ...o.extra,
  onAttackLanded(m, rec) {
    const t = rec.target;
    if (!t.alive || (t.isBuilding && !o.buildings)) return;
    if (o.cond && !o.cond(m, t)) return;
    t.addModifier(mod, { caster: m.parent, ability: m.ability, duration: m.v(dur), potency: rec.potency });
  },
});
// [L] measured in Hero Demo (Blight Stone, Desolator): the attack that applies the corruption already deals the reduced-armor damage
const firstCorruption = (m, rec) => { const t = rec.target; if (!t.hasModifier(DESO) && !t.hasModifier(BLIGHT) && !t.hasModifier(CORROSION)) rec.pierceArmor -= m.v('corruption_armor') * rec.potency / 100; };
onHitDebuff('blight_stone', BLIGHT, 'corruption_duration', { cond: (m, t) => !t.hasModifier(DESO), extra: { onAttack: firstCorruption } });
onHitDebuff('desolator', DESO, 'corruption_duration', {
  // [L] measured in Hero Demo: the first attack already deals the corrupted damage (306.36 like the later ones), so the armor
  // reduction counts for the attack that applies it
  buildings: true, extra: { stats: (m) => ({ dmg: m.stacks }), onAttack: firstCorruption },
  note: 'Soul Stealer damage is kept as stacks of the item (scenario: stacks: { item_desolator: N }); it grows on enemy hero deaths (the per-assist value is not in the tooltip and is ignored)',
});
onHitDebuff('orb_of_frost', FROST, 'duration');
onHitDebuff('orb_of_corrosion', CORROSION, 'duration', { extra: { onAttack: firstCorruption } });
onHitDebuff('skadi', SKADI, 'cold_duration');

// Orb of Venom: poisons a hero (magical damage per second), once per item cooldown (Poison Attack has had a cooldown since 7.38)
debuff('modifier_item_orb_of_venom_debuff', ticking((m) => mhit(m, m.parent, m.v('damage') * m.v('tick_interval'), MAGICAL), { interval: (m) => m.v('tick_interval') }));
passive(I('orb_of_venom'), {
  fid: 'full',
  onAttackLanded(m, rec) {
    const t = rec.target;
    if (!t.alive || !t.heroLike || !m.ability.cdReady()) return;
    m.ability.startCooldown();
    t.addModifier('modifier_item_orb_of_venom_debuff', { caster: m.parent, ability: m.ability, duration: m.v('poison_duration') });
  },
});

// Diffusal Blade / Disperser: mana burn on hit (once per attack: diffusal blades do not stack) + active slow
// the burn damage is part of the attack's own instance (measured, see Monkey King Bar); the mana goes when the attack lands
const manaBurnHook = {
  onAttack(m, rec) {
    const t = rec.target; const d = (rec.data ||= {});
    if (t.maxMana <= 0 || d.manaBreak || t.isBuilding) return;
    if (t.dirty) t.recompute();
    const burn = Math.min(t.mana, m.v('feedback_mana_burn') * rec.potency / 100);
    if (burn <= 0) return;
    d.manaBreak = burn;
    rec.add += burn * m.v('damage_per_burn') / m.parent.dmgOutMul;
  },
  onAttackLanded(m, rec) { const d = rec.data; if (d && d.manaBreak > 0 && !d.burned && rec.target.alive) { d.burned = true; rec.target.burnMana(d.manaBreak); } },
};
// Inhibit / Suppress: starts at phase_movement_speed % (stated for Disperser; Diffusal has no such value: 100) and fades linearly to 0
const fade = (m) => Math.max(0, m.remaining() / Math.max(0.01, m.dieTime - m.created));
debuff('modifier_item_diffusal_slow', { dynamic: true, stats: (m) => ({ msPct: -m.v('phase_movement_speed', 100) * fade(m) }) });
buff('modifier_item_disperser_haste', { dynamic: true, stats: (m) => ({ msPct: m.v('phase_movement_speed') * fade(m), slowRes: m.v('slow_resist') }) });
modifier('modifier_item_diffusal_blade', { hidden: true, ...manaBurnHook });
defAbility(I('diffusal_blade'), {
  mods: ['modifier_item_diffusal_blade'], illusion: true, prio: 20, fid: 'approx',
  note: 'Inhibit: the tooltip gives no slow amount; modelled like Disperser\'s (100% fading linearly to 0 over the duration)',
  cast(ab, t) { addMod(ab, t, 'modifier_item_diffusal_slow', ab.v('purge_slow_duration')); },
});
modifier('modifier_item_disperser', { hidden: true, ...manaBurnHook });
defAbility(I('disperser'), {
  mods: ['modifier_item_disperser'], illusion: true, prio: 20, fid: 'approx',
  note: 'the slow and the haste fade linearly; the haste is not raised above the movement speed cap. AI: used on the enemy target',
  cast(ab, t) {
    const u = ab.owner; const tt = t || u;
    u.purge({ debuffs: true });
    addMod(ab, u, 'modifier_item_disperser_haste', ab.v('ally_effect_duration'));   // the caster always gets the ally benefit
    if (tt.team !== u.team) { tt.purge({ debuffs: false, buffs: true }); addMod(ab, tt, 'modifier_item_diffusal_slow', ab.v('enemy_effect_duration')); }
    else if (tt !== u) { tt.purge({ debuffs: true }); addMod(ab, tt, 'modifier_item_disperser_haste', ab.v('ally_effect_duration')); }
  },
});

// Witch Blade / Parasma: every few seconds the next attack poisons (magical damage per second = int * multiplier)
const witchMod = (extra) => ({
  hidden: true,
  onAttack(m, rec) { if (!m.parent.isIllusion && m.ability.cdReady() && (!rec.target.isBuilding || m.v('building_effectiveness_pct') > 0)) { rec.trueStrike = true; (rec.data ||= {}).witch = m; } },
  onAttackLanded(m, rec) {
    if (extra) extra(m, rec);
    const t = rec.target;
    if (!(rec.data && rec.data.witch === m) || !t.alive) return;
    m.ability.startCooldown();
    const k = t.isBuilding ? m.v('building_effectiveness_pct') / 100 : 1;
    t.addModifier('modifier_item_witch_blade_poison', { caster: m.parent, ability: m.ability, duration: m.v('slow_duration'), potency: rec.potency, data: { dps: m.parent.int * m.v('int_damage_multiplier') * k } });
  },
});
debuff('modifier_item_witch_blade_poison', ticking((m) => mhit(m, m.parent, m.data.dps, MAGICAL), { interval: 1, stats: (m) => ({ msPct: -m.v('slow') * m.potency / 100 }) }));
defAbility(I('witch_blade'), { mods: ['modifier_item_witch_blade'], fid: 'full' });
modifier('modifier_item_witch_blade', witchMod(null));
debuff('modifier_item_devastator_corruption', { stats: (m) => ({ mr: -m.v('active_mres_reduction') * m.potency / 100 }) });
defAbility(I('devastator'), {
  mods: ['modifier_item_devastator'], illusion: true, fid: 'full',
  note: 'the Witch Blade attack uses the item cooldown (AbilityCooldown 7, as in the 7.35 notes); the data also carries passive_cooldown = 4, which no tooltip explains and which is not used',
});
modifier('modifier_item_devastator', witchMod((m, rec) => { if (rec.target.alive) rec.target.addModifier('modifier_item_devastator_corruption', { caster: m.parent, ability: m.ability, duration: m.v('reduction_duration'), potency: rec.potency }); }));

// Mage Slayer: attacks reduce the target's spell damage and burn
// [L] measured in Hero Demo: the burn ticks every 0.5 s for half of dps (17.5 per tick), the first tick 0.5 s after the hit
debuff('modifier_item_mage_slayer_debuff', ticking((m) => mhit(m, m.parent, m.v('dps') * 0.5, PHYSICAL), { interval: 0.5, stats: (m) => ({ spellAmp: -m.v('spell_amp_debuff') * m.potency / 100 }) }));
onHitDebuff('mage_slayer', 'modifier_item_mage_slayer_debuff', 'duration', { fid: 'approx', note: '"x% less spell damage" is modelled as negative spell amplification (additive with the target\'s own spell amplification)' });

// Quelling Blade / Battle Fury ("effects of multiple quelling blades do not stack": the largest bonus applies)
const quell = (melee, ranged) => function onAttack(m, rec) {
  if (rec.target.heroLike || rec.target.isBuilding) return;
  const b = m.parent.melee ? m.v(melee) : m.v(ranged); const d = (rec.data ||= {}); const prev = d.quell || 0;
  if (b > prev) { rec.flat += b - prev; d.quell = b; }
};
passive(I('quelling_blade'), { fid: 'full', note: 'Chop Tree has no effect in the sandbox', onAttack: quell('damage_bonus', 'damage_bonus_ranged') });
passive(I('bfury'), {
  fid: 'approx',
  note: 'the cone starts at the attacker and points at the attack target; cleave damage is a share of the attack damage before reductions and ignores the armor value of the units it hits (engine convention for cleave, not stated in the tooltip); AoE bonuses are not applied to the cone; Chop Tree has no effect in the sandbox',
  onAttack: quell('quelling_bonus', 'quelling_bonus_ranged'),
  onAttackLanded(m, rec) {
    const u = m.parent;
    if (!u.melee || rec.damage <= 0) return;
    const w = u.world; const t = rec.target;
    const dx = t.x - u.x; const dy = t.y - u.y; const d = Math.sqrt(dx * dx + dy * dy) || 1; const ux = dx / d; const uy = dy / d;
    const dist = m.v('cleave_distance'); const sw = m.v('cleave_starting_width'); const ew = m.v('cleave_ending_width');
    for (const e of w.units) {
      if (!e.alive || e.team === u.team || e === t || e.isBuilding) continue;
      const rx = e.x - u.x; const ry = e.y - u.y; const along = rx * ux + ry * uy;
      if (along < 0 || along > dist) continue;
      if (Math.abs(rx * uy - ry * ux) > (sw + (ew - sw) * (along / dist)) / 2 + e.def.hull) continue;
      // [L] measured in Hero Demo: the percentage follows the attacked unit (a hero target cleaves 60% onto a creep), and the
      // cleave is reduced by the armor of each unit it hits
      w.damage(u, e, rec.damage * (t.heroLike ? m.v('cleave_damage_percent') : m.v('cleave_damage_percent_creep')) / 100, PHYSICAL, F_SECONDARY, m.ability);
    }
  },
});

// Echo Sabre / Harpoon: melee attacks strike twice (own cooldown), the first strike slows
const ECHO_GAP = 0.1;   // seconds between the two strikes ("in quick succession"; the tooltip gives no number)
debuff('modifier_item_echo_slow', { stats: (m) => ({ msPct: -m.v('movement_slow') }) });
const echoMod = {
  hidden: true,
  onAttackLanded(m, rec) {
    const u = m.parent; const w = u.world; const t = rec.target;
    // m.x = time Echo Strike is ready again; m.y = 1 while the second strike itself lands (it never starts another one)
    if (!u.melee || rec.fromAbility || m.y || w.time + 1e-9 < m.x) return;
    const own = m.v('passive_cooldown');   // Harpoon: Echo Strike has its own cooldown next to the active's
    if (!w.freeSpells) { m.x = w.time + (own || m.v('AbilityCooldown')) * u.cdrMul; if (!own) m.ability.cdEnd = m.x; }
    if (t.alive) t.addModifier('modifier_item_echo_slow', { caster: u, ability: m.ability, duration: m.v('slow_duration') });
    w.after(ECHO_GAP, () => { if (u.alive && t.alive && !u.cantAct() && !u.isDisarmed() && t.attackableBy(u)) { m.y = 1; w.launchAttack(u, t); m.y = 0; } });
  },
};
const ECHO_NOTE = 'the second strike is an extra full attack 0.1 s after the first one lands (the tooltip only says "in quick succession"); the regular attack timer is not delayed by it';
defAbility(I('echo_sabre'), { mods: ['modifier_item_echo_sabre'], fid: 'approx', note: ECHO_NOTE });
modifier('modifier_item_echo_sabre', echoMod);
// Harpoon, Draw Forth: the harpoon flies to the target, then both units slide towards each other
function slide(m, step) {
  const d = m.data; const u = m.parent;
  if (step > d.left) step = d.left;
  if (step <= 0) return;
  u.x += d.ux * step; u.y += d.uy * step; d.left -= step;
}
modifier('modifier_item_harpoon_pull', {
  purge: 'none', multi: 'independent', interval: (m) => m.parent.world.dt,
  onThink(m) { slide(m, m.data.speed * m.interval); },
  onDestroy(m) { if (m.parent.alive) slide(m, m.data.left); },
});
defAbility(I('harpoon'), {
  mods: ['modifier_item_harpoon'], prio: 100, fid: 'approx',
  note: ECHO_NOTE + '. Draw Forth: a melee caster and its target end within the caster\'s attack reach; a ranged caster closes pull_distance_pct of the distance. The tooltip does not say how the pull is shared: both units move the same distance (a rooted caster does not move, 7.41c notes). Trees are not modelled. AI: melee wearers use it to close the distance',
  ai: (ab, u, t, w) => (u.melee ? gapAI()(ab, u, t, w) : null),
  cast(ab, t) {
    const u = ab.owner; const w = u.world;
    w.projectile(u, t, ab.v('projectile_speed'), (tt) => {
      if (!u.alive || !tt.alive) return;
      const dx = tt.x - u.x; const dy = tt.y - u.y; const d = Math.hypot(dx, dy);
      if (d < ab.v('min_distance')) return;
      const close = u.melee ? d - (u.attackRange + u.def.hull + tt.def.hull) + 1 : d * ab.v('pull_distance_pct') / 100;
      if (close <= 0) return;
      const time = ab.v('pull_duration'); const mine = u.st[ST.ROOT] > 0 || u.st[ST.LEASH] > 0 ? 0 : close / 2;
      const pull = (x, ux, uy, dist) => { if (dist > 0) x.addModifier('modifier_item_harpoon_pull', { caster: u, ability: ab, duration: time, data: { ux, uy, left: dist, speed: dist / time } }); };
      pull(u, dx / d, dy / d, mine);
      pull(tt, -dx / d, -dy / d, close - mine);
    });
  },
});
modifier('modifier_item_harpoon', { ...echoMod, apply: lanceRangeFix });

// Specialist's Array / Hydra's Breath: ranged splitshot within an angle in front of the attacker (= towards its attack target)
// 7.41 notes: does not work together with hero abilities that fire secondary projectiles (Medusa's Split Shot, Muerta's Gunslinger,
// Gyrocopter's Flak Cannon)
const otherSplit = (u) => ['medusa_split_shot', 'muerta_gunslinger'].some((n) => { const a = u.findAbility(n); return a && a.level > 0; }) || u.mods.some((x) => x.name.startsWith('modifier_gyrocopter_flak_cannon'));
function splitshot(m, rec) {
  const u = m.parent;
  if (u.melee || otherSplit(u) || !m.roll(m.v('proc_chance'))) return null;
  rec.add += m.v('base_proc_dmg');   // on a proc the primary attack also gains the flat part
  const w = u.world; const t = rec.target; const reach = u.attackRange + m.v('secondary_target_range_bonus') + u.def.hull;
  const cos = Math.cos(m.v('secondary_target_angle') / 2 * Math.PI / 180);
  const fx = t.x - u.x; const fy = t.y - u.y; const fd = Math.hypot(fx, fy) || 1;
  const out = []; const max = m.v('count');
  for (const e of w.units) {
    if (out.length >= max) break;
    if (!e.alive || e.team === u.team || e === t || !e.attackableBy(u)) continue;
    const ex = e.x - u.x; const ey = e.y - u.y; const ed = Math.hypot(ex, ey);
    if (ed > reach + e.def.hull || (ed > 1e-6 && (ex * fx + ey * fy) / (ed * fd) < cos)) continue;
    out.push(w.launchAttack(u, e, { secondary: true, mult: m.v('proc_dmg_pct') / 100, add: m.v('base_proc_dmg') }));
  }
  return out;
}
const SPLIT_NOTE = '"in front of the attacker" is taken as the direction of the attack target (no facing in the sandbox). Switched off for heroes with Split Shot, Gunslinger or an active Flak Cannon (7.41 notes)';
passive(I('specialists_array'), { fid: 'approx', note: SPLIT_NOTE, onAttack(m, rec) { splitshot(m, rec); } });
debuff('modifier_item_hydras_breath_poison', ticking((m) => mhit(m, m.parent, m.parent.maxHp * m.v('poison_damage_per_second') / 100, MAGICAL), { interval: 1 }));
const miasma = (m, t) => { if (t.alive && !t.isBuilding && t.name !== 'npc_dota_roshan') t.addModifier('modifier_item_hydras_breath_poison', { caster: m.parent, ability: m.ability, duration: m.v('poison_duration') }); };   // not on Roshan (7.41 notes)
// secondary projectiles run no on-hit hooks: watch the attack record until it has landed (or missed)
function whenLanded(w, rec, fn) {
  const end = w.time + 5;
  const poll = () => { if (rec.missed || rec.cancel || !rec.target.alive) return; if (rec.damage > 0) { fn(); return; } if (w.time < end) w.after(w.dt, poll); };
  poll();
}
passive(I('hydras_breath'), {
  fid: 'approx', note: SPLIT_NOTE, apply: lanceRangeFix,
  onAttack(m, rec) { const shots = splitshot(m, rec); if (shots) for (const r of shots) whenLanded(m.parent.world, r, () => miasma(m, r.target)); },
  onAttackLanded(m, rec) { miasma(m, rec.target); },
});

// ---------------------------------------------------------------- defensive passives
// "Multiple sources of damage block do not stack": per attack only the largest block counts (remembered on the attack record)
function blockAttack(d, amount) {
  const r = d.rec;
  if (!r) { d.amount = Math.max(0, d.amount - amount); return; }
  const prev = r.blocked || 0;
  if (amount > prev) { d.amount = Math.max(0, d.amount - (amount - prev)); r.blocked = amount; }
}
const block = (melee, ranged) => function preMit(m, d) {
  if (!(d.flags & F_ATTACK) || d.amount <= 0) return;
  if (m.roll(m.v('block_chance'))) blockAttack(d, m.parent.melee ? m.v(melee) : m.v(ranged));
};
passive(I('vanguard'), { fid: 'full', preMit: block('block_damage_melee', 'block_damage_ranged') });
// Guard: blocks a flat amount plus a share of the caster's max health; ranged heroes block less
buff('modifier_item_crimson_guard_active', {
  preMit(m, d) {
    if (!(d.flags & F_ATTACK) || d.amount <= 0 || !m.roll(m.v('block_chance_active'))) return;
    const u = m.parent;
    blockAttack(d, m.v('block_damage_active') + m.caster.maxHp * m.v('max_hp_pct') / 100 - (u.heroLike && !u.melee ? m.v('block_penalty_ranged') : 0));
  },
});
marker('modifier_item_crimson_guard_nostack');
defAbility(I('crimson_guard'), {
  mods: ['modifier_item_crimson_guard', 'modifier_item_crimson_guard_buckler'], fid: 'full',
  note: 'AI: cast when the target is within 900',
  cast(ab) { for (const a of alliesNear(ab, ab.owner.x, ab.owner.y, ab.v('bonus_aoe_radius'))) if ((a.heroLike || a.isBuilding) && once(ab, a, 'modifier_item_crimson_guard_nostack')) addMod(ab, a, 'modifier_item_crimson_guard_active', ab.v('duration')); },
  ai: (ab, u, t) => (t && u.distTo(t) < 900 ? true : null),
});
modifier('modifier_item_crimson_guard', { hidden: true, preMit: block('block_damage_melee', 'block_damage_ranged') });

// Blade Mail. Damage Return is calculated before any reduction: attacks use the attack's damage before armor and block,
// other damage the amount that arrives after the attacker's amplification. The passive returns a flat amount plus a share of
// every attack; the active adds its percentage of every damage instance on top (attacks: flat + 15% + 85%, spells: 85%).
buff('modifier_item_blade_mail_active', {
  purge: 'none',
  preMit(m, d) { m.x = d.amount; m.y = 1; },
  onTakeDamage(m, d) {
    const pre = d.rec ? d.rec.damage : m.y ? m.x : d.original;
    m.y = 0;
    if ((d.flags & (F_REFLECT | F_HP_LOSS)) || !d.src || d.src === m.parent || d.src.team === m.parent.team) return;
    m.parent.world.damage(m.parent, d.src, pre * m.v('active_reflection_pct') / 100, d.type, F_REFLECT | F_NO_AMP, m.ability);
  },
});
modifier('modifier_item_blade_mail', {
  hidden: true,
  onAttacked(m, rec) {
    const u = m.parent; const a = rec.attacker;
    if (!a.alive || a.team === u.team) return;
    u.world.damage(u, a, m.v('passive_reflection_constant') + rec.damage * m.v('passive_reflection_pct') / 100, PHYSICAL, F_REFLECT | F_NO_AMP, m.ability);
  },
});
defAbility(I('blade_mail'), { mods: ['modifier_item_blade_mail'], fid: 'full', note: 'AI: activated when the target is within 700', cast(ab) { addMod(ab, ab.owner, 'modifier_item_blade_mail_active', ab.v('duration')); }, ai: (ab, u, t) => (t && u.distTo(t) < 700 ? true : null) });

// Linken's Sphere: blocks one targeted spell per cooldown (not neutral item spells, not spells flagged as unblockable by their script)
passive(I('sphere'), {
  fid: 'partial', note: 'passive Spellblock only; the active Transfer Spellblock is not modelled',
  onSpellTargeted(m, ev) {
    const a = ev.ability;
    if ((a.isItem && a.def.artifact) || (a.script && a.script.noBlock)) return;
    if (m.ability.cdReady()) { ev.blocked = true; m.ability.startCooldown(m.v('block_cooldown') * m.parent.cdrMul); }
  },
});

// Aeon Disk: the cooldown grows with every trigger (item level)
buff('modifier_item_aeon_disk_buff', { purge: 'none', stats: { statusRes: 'status_resistance' }, postMit(m, d) { d.amount = 0; }, outgoing(m, d) { d.amount = 0; } });
passive(I('aeon_disk'), {
  fid: 'full', note: 'the damage instance that triggers Combo Breaker only lowers health to the threshold (7.07c notes)',
  postMit(m, d) {
    const u = m.parent; const ab = m.ability;
    if (!ab.cdReady() || !d.src || d.src.team === u.team || !playerOwned(d.src) || d.amount <= 0) return;
    const floor = u.maxHp * m.v('health_threshold_pct') / 100;
    if (u.hp - d.amount < floor) {
      d.amount = Math.max(0, u.hp - floor);
      ab.startCooldown(m.v('cooldown_duration') * u.cdrMul);
      if (ab.level < ab.maxLevel) ab.setLevel(ab.level + 1);
      u.purge({ debuffs: true, strong: true });
      u.addModifier('modifier_item_aeon_disk_buff', { ability: ab, duration: m.v('buff_duration') });
    }
  },
});

// Infused Raindrops (charges: item option "charges"; the item disappears with its last charge)
passive(I('infused_raindrop'), {
  fid: 'approx', note: 'the block and the damage threshold are applied before magic resistance (the tooltip does not say at which stage)',
  preMit(m, d) {
    const ab = m.ability;
    if (d.type !== MAGICAL || ab.charges < 1 || d.amount <= m.v('min_damage') || !ab.cdReady()) return;
    d.amount = Math.max(0, d.amount - m.v('magic_damage_block'));
    ab.startCooldown();
    if (--ab.charges < 1) m.parent.removeItem(ab.name);
  },
});

// ---------------------------------------------------------------- auras
const auraItem = (item, radius, childStats, team = 'ally', extraChild = {}, filter = null) => {
  const child = `modifier_item_${item}_aura`;
  modifier(child, { stats: childStats, debuff: team === 'enemy', pierce: team === 'enemy', purge: 'none', statusResist: false, ...extraChild });
  aura(`modifier_item_${item}`, { radius, team, child, filter });
  return child;
};
const playerUnit = (t) => playerOwned(t);
// Buckler Aura does not stack with the armor of Vladmir's, Ristul's and Assault auras, and Crimson Guard's version replaces Buckler's (7.42 notes)
auraItem('buckler', 'bonus_aoe_radius', (m) => ({ armor: hasAny(m.parent, 'modifier_item_crimson_guard_buckler_aura', 'modifier_item_vladmir_aura', 'modifier_item_ristuls_devotion_aura', 'modifier_item_assault_aura') ? 0 : m.v('bonus_aoe_armor') }), 'ally', {}, playerUnit);
defAbility(I('buckler'), { mods: ['modifier_item_buckler'], fid: 'full' });
auraItem('crimson_guard_buckler', 'aura_radius', { armor: 'bonus_aoe_armor' }, 'ally', {}, playerUnit);
auraItem('ring_of_basilius', 'aura_radius', { manaRegen: 'aura_mana_regen' }); defAbility(I('ring_of_basilius'), { mods: ['modifier_item_ring_of_basilius'], fid: 'full' });
auraItem('headdress', 'aura_radius', { hpRegen: 'aura_health_regen' }, 'ally', {}, playerUnit); defAbility(I('headdress'), { mods: ['modifier_item_headdress'], fid: 'full' });
auraItem('vladmir', 'aura_radius', { lifesteal: 'lifesteal_aura', dmgBasePct: 'damage_aura', manaRegen: 'mana_regen_aura', armor: 'armor_aura' }); defAbility(I('vladmir'), { mods: ['modifier_item_vladmir'], fid: 'full' });
auraItem('ristuls_devotion', 'aura_radius', { lifesteal: 'lifesteal_aura', spellLifesteal: 'spell_lifesteal_aura', dmgBasePct: 'damage_aura', manaRegen: 'mana_regen_aura', armor: 'armor_aura' }); defAbility(I('ristuls_devotion'), { mods: ['modifier_item_ristuls_devotion'], fid: 'full' });
auraItem('assault', 'aura_radius', { as: 'aura_attack_speed', armor: 'aura_positive_armor' });
auraItem('assault_neg', 'aura_radius', { armor: 'aura_negative_armor' }, 'enemy');
defAbility(I('assault'), { mods: ['modifier_item_assault', 'modifier_item_assault_neg'], fid: 'full' });
// Shiva's Guard: the blast is a ring that grows at blast_speed around the (moving) caster and hits each enemy once
auraItem('shivas_guard', 'aura_radius', { asSlow: 'aura_attack_speed' }, 'enemy');
debuff('modifier_item_shivas_blast', { stats: { msPct: 'blast_movement_speed' } });
function shivaWave(m, last) {
  const u = m.parent; const ab = m.ability; const max = ab.v('blast_radius');
  const r = last === true ? max : Math.min(max, ab.v('blast_speed') * (u.world.time - m.created));
  for (const e of u.world.inRadius(u.x, u.y, r, u.team, true)) {
    if (m.data.hit.has(e)) continue;
    m.data.hit.add(e);
    hit(ab, e, ab.v('blast_damage'), MAGICAL);
    addMod(ab, e, 'modifier_item_shivas_blast', ab.v('blast_debuff_duration'));
  }
}
modifier('modifier_item_shivas_guard_wave', { hidden: true, purge: 'none', interval: (m) => m.parent.world.dt, onCreated(m) { m.data = { hit: new Set() }; }, onThink: shivaWave, onDestroy(m, expired) { if (expired && m.parent.alive) shivaWave(m, true); } });
modifier('modifier_item_shivas_guard_stats', { hidden: true, apply: chasmAoeFix });
defAbility(I('shivas_guard'), {
  mods: ['modifier_item_shivas_guard', 'modifier_item_shivas_guard_stats'], radius: 'blast_radius', fid: 'full',
  cast(ab) { const u = ab.owner; u.removeModifierByName('modifier_item_shivas_guard_wave'); u.addModifier('modifier_item_shivas_guard_wave', { ability: ab, duration: (ab.v('blast_radius')) / ab.v('blast_speed') }); },
});
auraItem('pipe', 'aura_radius', { mr: 'magic_resistance_aura' });
barrier('modifier_item_pipe_barrier', 'magical');
marker('modifier_item_pipe_nostack');
defAbility(I('pipe'), {
  mods: ['modifier_item_pipe'], fid: 'full', note: 'AI: cast when the target is within 900',
  cast(ab) { for (const a of alliesNear(ab, ab.owner.x, ab.owner.y, ab.v('barrier_radius'))) if (once(ab, a, 'modifier_item_pipe_nostack')) giveBarrier(ab, a, 'modifier_item_pipe_barrier', ab.v('barrier_block'), ab.v('barrier_duration')); },
  ai: (ab, u, t) => (t && u.distTo(t) < 900 ? true : null),
});
auraItem('ancient_janggo', 'radius', { ms: 'aura_movement_speed', hpRegen: 'aura_health_regen' });
buff('modifier_item_drums_active', { stats: { as: 'bonus_attack_speed_pct', msPct: 'bonus_movement_speed_pct' } });
buff('modifier_item_boots_of_bearing_unslowable', { stats: { slowRes: 100 } });   // "immune to slows" = full slow resistance
const drums = (item) => defAbility(I(item), {
  mods: [`modifier_item_${item}`], fid: 'full', note: 'AI: cast when the target is within 900',
  cast(ab) {
    for (const a of alliesNear(ab, ab.owner.x, ab.owner.y, ab.v('radius'))) {
      addMod(ab, a, 'modifier_item_drums_active', ab.v('duration'));
      if (ab.v('bonus_ms_duration') > 0) addMod(ab, a, 'modifier_item_boots_of_bearing_unslowable', ab.v('bonus_ms_duration'));   // Boots of Bearing only
    }
  },
  ai: (ab, u, t) => (t && u.distTo(t) < 900 ? true : null),
});
drums('ancient_janggo');
auraItem('boots_of_bearing', 'radius', { ms: 'aura_movement_speed', hpRegen: 'aura_health_regen' });
drums('boots_of_bearing');
// Radiance burn
// [L] measured in Hero Demo: Burn starts switched on (toggling the item switches it off / on). Enemies in the radius carry a
// debuff that lingers 0.5 s; the burn ticks every second counted from when Burn was switched on and hits every unit carrying the
// debuff (also while it lingers after Burn was switched off)
const RAD_DEBUFF = 'modifier_item_radiance_debuff';
debuff(RAD_DEBUFF, { hidden: true, purge: 'none' });
aura('modifier_item_radiance', { radius: 'aura_radius', team: 'enemy', child: RAD_DEBUFF, filter: (t, m) => !m.ability.toggled });
modifier('modifier_item_radiance_burn', {
  hidden: true, interval: 1,
  onThink(m) {
    const u = m.parent; const dmg = u.isIllusion ? m.v('aura_damage_illusions') : m.v('aura_damage');
    for (const e of u.world.units) if (e.alive && e.team !== u.team && e.mods.some((x) => x.name === RAD_DEBUFF && x.caster === u)) mhit(m, e, dmg, MAGICAL);
  },
});
const rethink = (m, at) => { if (!m) return; m.nextThink = at; if (at < m.parent.nextModEvent) m.parent.nextModEvent = at; };
defAbility(I('radiance'), {
  mods: ['modifier_item_radiance', 'modifier_item_radiance_burn'], illusion: true, fid: 'full', note: 'Burn stays on unless the item is toggled (AI never toggles it)', ai: () => null,
  cast(ab) {
    const u = ab.owner; const w = u.world; ab.toggled = !ab.toggled;
    if (ab.toggled) {
      // [L] measured: switched off, the debuffs go 0.47-0.5 s later (14 server ticks taken)
      const end = w.time + 14 / 30;
      for (const e of w.units) for (const x of e.mods) if (x.name === RAD_DEBUFF && x.caster === u && x.dieTime > end) { x.dieTime = end; if (end < e.nextModEvent) e.nextModEvent = end; }
      return;
    }
    rethink(ab.mods.find((x) => x.name === 'modifier_item_radiance'), w.time);
    rethink(ab.mods.find((x) => x.name === 'modifier_item_radiance_burn'), w.time + 1);
  },
});
// healing auras + actives (Restore and Mend skip units that received either of them within the item's cooldown)
auraItem('mekansm', 'aura_radius', { hpRegen: 'aura_health_regen' });
marker('modifier_item_mekansm_nostack');
const healNearby = (ab, r, hp, mana) => { for (const a of alliesNear(ab, ab.owner.x, ab.owner.y, r)) { if (!once(ab, a, 'modifier_item_mekansm_nostack')) continue; if (hp) a.heal(hp, ab.owner, ab); if (mana) a.giveMana(mana); } };
const allyHurt = (ab, u, r, frac) => u.world.inRadius(u.x, u.y, r, u.team, false).some((a) => a.hp / a.maxHp < frac);
defAbility(I('mekansm'), { mods: ['modifier_item_mekansm'], fid: 'full', note: 'AI: used when an ally in range is below 60% health', cast(ab) { healNearby(ab, ab.v('heal_radius'), ab.v('heal_amount'), 0); }, ai: (ab, u) => (allyHurt(ab, u, ab.v('heal_radius'), 0.6) ? true : null) });
auraItem('guardian_greaves', 'aura_radius', { hpRegen: 'aura_health_regen', manaRegen: 'aura_mana_regen' });
defAbility(I('guardian_greaves'), { mods: ['modifier_item_guardian_greaves'], fid: 'full', note: 'AI: used when an ally in range is below 60% health', cast(ab) { ab.owner.purge({ debuffs: true }); healNearby(ab, ab.v('replenish_radius'), ab.v('replenish_health'), ab.v('replenish_mana')); }, ai: (ab, u) => (allyHurt(ab, u, ab.v('replenish_radius'), 0.6) ? true : null) });
auraItem('arcane_boots', 'aura_radius', { manaRegen: 'aura_mana_regen' });
defAbility(I('arcane_boots'), { mods: ['modifier_item_arcane_boots'], fid: 'full', note: 'AI: used when the wearer misses at least the restored amount', cast(ab) { for (const a of alliesNear(ab, ab.owner.x, ab.owner.y, ab.v('replenish_radius'))) a.giveMana(ab.v('replenish_amount')); }, ai: (ab, u) => (u.maxMana - u.mana >= ab.v('replenish_amount') ? true : null) });

// ---------------------------------------------------------------- actives: buffs on self
buff('modifier_item_satanic_active', { purge: 'none', stats: { lifesteal: 'unholy_lifesteal_percent' } });
defAbility(I('satanic'), {
  fid: 'full', note: 'Unholy Rage adds unholy_lifesteal_percent (145) to the passive 25 = 170%; the tooltip total reads 175 (unholy_lifesteal_total_tooltip): the shipped numbers disagree. AI: used below 50% health',
  cast(ab) { ab.owner.purge({ debuffs: true }); addMod(ab, ab.owner, 'modifier_item_satanic_active', ab.v('unholy_duration')); }, ai: (ab, u) => (u.hp / u.maxHp < 0.5 ? true : null),
});
buff('modifier_item_mask_of_madness_active', { state: ['SILENCE'], stats: (m) => ({ as: m.v('berserk_bonus_attack_speed'), msPct: m.parent.melee ? m.v('berserk_bonus_movement_speed_melee') : m.v('berserk_bonus_movement_speed'), armor: -m.v('berserk_armor_reduction'), slowRes: m.parent.melee ? m.v('berserk_slow_resist_melee') : m.v('berserk_slow_resist') }) });
defAbility(I('mask_of_madness'), { prio: -50, fid: 'full', cast(ab) { addMod(ab, ab.owner, 'modifier_item_mask_of_madness_active', ab.v('berserk_duration')); }, ai: (ab, u, t) => (t && u.rangeTo(t) <= u.attackRange + 50 ? true : null), note: 'AI: used in attack range and last in the cast order because it silences the wearer' });
// Black King Bar: debuff immunity; every use lowers the duration of the next one (item level)
defAbility(I('black_king_bar'), {
  prio: 90, fid: 'full', note: 'the item level (1-3) sets the duration and rises with every use; a used Black King Bar is given with the item option "level". AI: used when the target is within 900',
  cast(ab) {
    const u = ab.owner;
    u.purge({ debuffs: true });
    u.addModifier('modifier_debuff_immune', { ability: ab, duration: ab.v('duration'), data: { mr: ab.v('spell_reduce') } });
    if (ab.level < ab.maxLevel) ab.setLevel(ab.level + 1);
  },
  ai: (ab, u, t) => (t && u.distTo(t) < 900 && !u.isImmune() ? true : null),
});
// Armlet (toggle; kept on once activated). Sabatons share the mechanic and add movement speed and health-scaled slow resistance.
const unholy = (item, note) => {
  modifier(`modifier_item_${item}_active`, {
    purge: 'none', interval: 0.1, dynamic: item !== 'armlet',
    stats: (m) => { const u = m.parent; return { dmg: m.v('unholy_bonus_damage'), str: m.v('unholy_bonus_strength'), armor: m.v('unholy_bonus_armor'), msPct: u.melee ? m.v('phase_movement_speed') : m.v('phase_movement_speed_range'), slowRes: m.v('unholy_bonus_slow_resistance') * u.hp / u.maxHp }; },
    // [L] measured in Hero Demo: the drain lowers health without a damage instance (none recorded)
    onThink(m) { const u = m.parent; if (u.hp > 1) u.hp = Math.max(1, u.hp - m.v('unholy_health_drain_per_second') * 0.1); },
  });
  defAbility(I(item), { cast(ab) { ab.toggled = true; addMod(ab, ab.owner, `modifier_item_${item}_active`); }, ai: (ab, u, t) => (!ab.toggled && t && u.distTo(t) < 800 ? true : null), fid: 'approx', note });
};
unholy('armlet', 'toggled on when a fight starts and kept on; the strength change is instant; the drain is taken in 0.1 s steps');
unholy('berserkers_sabatons', 'toggled on when a fight starts and kept on; the strength change is instant; the drain is taken in 0.1 s steps; moving through units and the turn rate have no effect in the sandbox');
// Phase Boots
buff('modifier_item_phase_boots_active', { stats: (m) => ({ msPct: m.parent.melee ? m.v('phase_movement_speed') : m.v('phase_movement_speed_range') }) });
defAbility(I('phase_boots'), { fid: 'full', note: 'moving through units and the turn rate have no effect in the sandbox. AI: used while chasing', cast(ab) { addMod(ab, ab.owner, 'modifier_item_phase_boots_active', ab.v('phase_duration')); }, ai: (ab, u, t) => (t && u.rangeTo(t) > u.attackRange + 100 ? true : null) });
// Shadow Blade / Silver Edge: invisibility, bonus damage on the attack that breaks it (Silver Edge also breaks passives and caps movement speed)
debuff('modifier_item_silver_edge_break', { state: ['BREAK'], purge: 'none', stats: { msCap: 'max_movement_speed' } });
const windwalk = (item, silver) => {
  buff(`modifier_item_${item}_windwalk`, {
    purge: 'none', state: ['INVIS'], stats: { msPct: 'windwalk_movement_speed' },
    onAttack(m, rec) { rec.flat += m.v('windwalk_bonus_damage'); (rec.data ||= {}).ww = m; m.remove(); },
    onCast(m, ev) { if (ev.ability !== m.ability) m.remove(); },   // any other cast ends it (the cast that starts it also fires this hook)
  });
  modifier(`modifier_item_${item}`, { hidden: true, onAttackLanded(m, rec) { if (silver && rec.data && rec.data.ww && rec.target.alive) rec.target.addModifier('modifier_item_silver_edge_break', { caster: m.parent, ability: m.ability, duration: m.v('backstab_duration') * rec.potency / 100 }); } });
  defAbility(I(item), {
    mods: [`modifier_item_${item}`], prio: 80, fid: 'approx',
    note: 'the fade time is ignored; invisibility itself only matters when the scenario turns detection off (rules.detectAll = false). AI: used when no enemy hero has hit the wearer for 1 s',
    cast(ab) { addMod(ab, ab.owner, `modifier_item_${item}_windwalk`, ab.v('windwalk_duration')); }, ai: (ab, u, t) => (t && !u.hasModifier(`modifier_item_${item}_windwalk`) && u.world.time - u.lastHurt > 1 ? true : null),
  });
};
windwalk('invis_sword', false); windwalk('silver_edge', true);
// Manta Style
// [L] measured in Hero Demo: for invuln_duration the hero is stunned, invulnerable and out of play; the images appear when that ends
modifier('modifier_item_manta_split', {
  purge: 'none', hidden: true, state: ['STUN', 'INVULN', 'OUT'],
  onDestroy(m, expired) {
    const u = m.parent; const ab = m.ability; const w = u.world;
    if (!expired || !u.alive) return;
    const n = ab.v('images_count');
    for (let i = 0; i < n; i++) w.createIllusion(u, { duration: ab.v('illusion_duration'), outPct: u.melee ? ab.v('images_do_damage_percent_melee') : ab.v('images_do_damage_percent_ranged'), inPct: ab.v('images_take_damage_percent'), potency: ab.v('illusion_effectiveness'), x: u.x + (i ? -70 : 70), y: u.y + 70 });
  },
});
defAbility(I('manta'), {
  prio: 30, fid: 'approx', note: 'the images appear next to the hero (positions not measured). AI: used near attack range',
  cast(ab) {
    const u = ab.owner;
    u.purge({ debuffs: true });
    u.addModifier('modifier_item_manta_split', { ability: ab, duration: ab.v('invuln_duration') });
  },
  ai: (ab, u, t) => (t && u.rangeTo(t) <= u.attackRange + 200 ? true : null),
});
// Blink Dagger family (teleports next to the target; not usable right after taking hero damage)
const blinkAI = (ab, u, t) => { if (!t || u.world.time - u.lastHurt < ab.v('blink_damage_cooldown')) return null; const gap = u.rangeTo(t) - u.attackRange; return gap > 250 ? { x: t.x, y: t.y } : null; };
const blinkCast = (ab, t, x, y) => { const u = ab.owner; const dx = x - u.x; const dy = y - u.y; const d = Math.sqrt(dx * dx + dy * dy) || 1; const maxR = ab.v('blink_range') + u.castRangeBonus; const stop = Math.max(0, u.attackRange * 0.8); const go = Math.min(maxR, Math.max(0, d - stop)); u.x += dx / d * go; u.y += dy / d * go; };
const BLINK_NOTE = 'AI: used only to close the distance to the target (lands at 80% of the attack range, at most blink_range away); self-cast towards the fountain has no meaning in the sandbox';
defAbility(I('blink'), { prio: 100, fid: 'approx', cast: blinkCast, ai: blinkAI, note: BLINK_NOTE });
buff('modifier_item_swift_blink', { stats: { msPct: 'bonus_movement', agi: 'bonus_agi_active' } });
defAbility(I('swift_blink'), { prio: 100, ai: blinkAI, fid: 'approx', note: BLINK_NOTE, cast(ab, t, x, y) { blinkCast(ab, t, x, y); addMod(ab, ab.owner, 'modifier_item_swift_blink', ab.v('duration')); } });
// [L] measured in Hero Demo: the damage over time ticks every second (damage_pct_over_time / duration of strength per tick); the
// tick that falls on the expiry is not dealt (4 ticks over 5 s)
debuff('modifier_item_overwhelming_blink', { interval: 1, onThink: (m) => mhit(m, m.parent, m.data.tick, MAGICAL), stats: { msPct: neg('movement_slow'), asSlow: neg('attack_slow') } });
defAbility(I('overwhelming_blink'), {
  prio: 100, ai: blinkAI, fid: 'approx', note: BLINK_NOTE + '. The damage over time ticks every second (measured)',
  cast(ab, t, x, y) {
    blinkCast(ab, t, x, y);
    const u = ab.owner; const dur = ab.v('duration'); const tick = u.str * ab.v('damage_pct_over_time') / 100 / dur;
    for (const e of enemiesNear(ab, u.x, u.y, ab.v('radius'))) { hit(ab, e, ab.v('damage_base') + u.str * ab.v('damage_pct_instant') / 100, MAGICAL); addMod(ab, e, 'modifier_item_overwhelming_blink', dur, { data: { tick } }); }
  },
});
defAbility(I('arcane_blink'), { prio: 100, ai: blinkAI, fid: 'approx', note: BLINK_NOTE, cast(ab, t, x, y) { blinkCast(ab, t, x, y); ab.owner.heal(ab.v('heal_amount'), ab.owner, ab); ab.owner.giveMana(ab.v('mana_amount')); } });
// Refresher Orb: abilities only (refresh_items = 0 in 7.42)
defAbility(I('refresher'), {
  prio: -80, fid: 'full', note: 'AI: used when an ultimate has more than 20 s of cooldown left',
  cast(ab) { const u = ab.owner; for (const a of u.abilities) { a.cdEnd = 0; if (a.vals.AbilityCharges > 0) a.charges = a.vals.AbilityCharges; } if (ab.v('refresh_items') > 0) for (const it of u.items) if (it !== ab) it.cdEnd = 0; },
  ai: (ab, u) => (u.abilities.some((a) => a.level > 0 && !a.passive && a.def.type === 'ultimate' && a.cdRemaining() > 20) ? true : null),
});
// consumables
defAbility(I('faerie_fire'), { fid: 'full', note: 'AI: eaten below 250 health', cast(ab) { ab.owner.heal(ab.v('hp_restore'), ab.owner, ab); ab.owner.removeItem(ab.name); }, ai: (ab, u) => (u.hp < 250 ? true : null) });
defAbility(I('enchanted_mango'), { fid: 'full', note: 'AI: eaten below 80 mana', cast(ab) { ab.owner.giveMana(ab.v('replenish_amount')); ab.owner.removeItem(ab.name); }, ai: (ab, u) => (u.mana < 80 ? { target: u } : null) });
// Magic Stick / Magic Wand: charges from enemy ability casts in range. The items ship without charges, so the engine ignores the
// item option "charges": a scenario presets them with stacks: { item_magic_wand: N } (absorbed here from the intrinsic modifier).
const wandCharges = (ab) => { const m = ab.mods[0]; if (m && m.stacks > 0) { ab.charges = Math.min(ab.v('max_charges'), ab.charges + m.stacks); m.stacks = 0; } return ab.charges; };
const wand = (item) => {
  modifier(`modifier_item_${item}`, { hidden: true, onAnyCast(m, ev) { const c = ev.caster; const u = m.parent; const ab = m.ability; if (c.team !== u.team && !ev.ability.def.behavior.includes('DONT_PROC_OTHER_ABILITIES') && u.distTo(c) <= m.v('charge_radius') && wandCharges(ab) < m.v('max_charges')) ab.charges++; } });
  defAbility(I(item), {
    mods: [`modifier_item_${item}`], fid: 'approx',
    note: 'starts empty; a charge is gained for every ability or item an enemy casts within range, except those flagged DONT_PROC_OTHER_ABILITIES (no vision in the sandbox); preset charges with scenario stacks: { ' + I(item) + ': N }. AI: used below 50% health',
    cast(ab) { const n = wandCharges(ab); ab.owner.heal(n * ab.v('restore_per_charge'), ab.owner, ab); ab.owner.giveMana(n * ab.v('restore_per_charge')); ab.charges = 0; },
    ai: (ab, u) => (wandCharges(ab) > 0 && u.hp / u.maxHp < 0.5 ? { target: null } : null),
  });
};
wand('magic_stick'); wand('magic_wand');

// ---------------------------------------------------------------- actives: targeted
// [L] measured in Hero Demo: the hex also silences, disarms and mutes
debuff('modifier_item_sheepstick', { state: ['HEX', 'SILENCE', 'DISARM', 'MUTE'], purge: 'strong', stats: (m) => ({ msCap: m.v('sheep_movement_speed') }) });
defAbility(I('sheepstick'), { prio: 85, fid: 'full', cast(ab, t) { if (t.isIllusion) { ab.owner.world.kill(t, ab.owner, ab); return; } addMod(ab, t, 'modifier_item_sheepstick', ab.v('sheep_duration')); } });
debuff('modifier_item_halberd_disarm', { state: ['DISARM'], purge: 'strong' });
defAbility(I('heavens_halberd'), { prio: 70, fid: 'full', cast(ab, t) { addMod(ab, t, 'modifier_item_halberd_disarm', t.melee ? ab.v('disarm_melee') : ab.v('disarm_range')); } });
defAbility(I('skypiercer'), { mods: ['modifier_item_skypiercer'], prio: 70, fid: 'full', note: 'Riposte is evaluated every 0.1 s', cast(ab, t) { addMod(ab, t, 'modifier_item_halberd_disarm', ab.v('disarm_duration')); } });
// Riposte: while an enemy hero is within close_radius, Disarm cools down faster
modifier('modifier_item_skypiercer', {
  hidden: true, stats: { slowRes: 'slow_resistance' }, onHealed: restoreHeals, interval: 0.1,
  onThink(m) { const u = m.parent; const ab = m.ability; if (ab.cdRemaining() > 0 && u.world.inRadius(u.x, u.y, m.v('close_radius'), u.team, true).some((e) => e.heroLike)) ab.cdEnd -= 0.1 * m.v('buff_cooldown_acceleration_pct') / 100; },
});
// [L] measured in Hero Demo: the root lands 0.233 s after the cast at 500 range (Rod of Atos and Gleipnir alike): a projectile of
// speed 1900 (the item data carries no speed)
const ATOS_SPEED = 1900;
defAbility(I('rod_of_atos'), { prio: 65, fid: 'full', cast(ab, t) { ab.owner.world.projectile(ab.owner, t, ATOS_SPEED, (tt) => { if (tt.alive) addMod(ab, tt, 'modifier_rooted', ab.v('duration')); }); } });
modifier('modifier_item_gungir', { hidden: true, apply: chasmAoeFix });
defAbility(I('gungir'), { mods: ['modifier_item_gungir'], prio: 65, fid: 'full', cast(ab, t, x, y) {
  const u = ab.owner; const w = u.world; const cx = t ? t.x : x; const cy = t ? t.y : y; const step = ATOS_SPEED * w.dt;
  w.after(Math.max(0, Math.hypot(cx - u.x, cy - u.y) - step) / ATOS_SPEED, () => { for (const e of enemiesNear(ab, cx, cy, ab.v('radius'))) addMod(ab, e, 'modifier_rooted', ab.v('duration')); });
} });
// Orchid / Bloodthorn: silence; part of the damage taken while silenced is dealt again at the end
const soulBurn = (name, extra = {}) => debuff(name, {
  state: ['SILENCE'], onCreated(m) { m.x = 0; },
  onTakeDamage(m, d) { if (d.ability !== m.ability || d.type !== MAGICAL || !(d.flags & F_NO_AMP)) m.x += d.dealt; },
  onDestroy(m) { const u = m.parent; if (u.alive && m.x > 0) u.world.damage(m.caster, u, m.x * m.v('silence_damage_percent') / 100, MAGICAL, F_NO_AMP, m.ability); },
  ...extra,
});
soulBurn('modifier_item_orchid');
defAbility(I('orchid'), { prio: 75, fid: 'full', cast(ab, t) { addMod(ab, t, 'modifier_item_orchid', ab.v('silence_duration')); } });
// Soul Rend: attackers deal extra damage to the silenced unit; the caster's side attacks it with True Strike
soulBurn('modifier_item_bloodthorn', {
  onPreAttacked(m, rec) { if (rootOwner(rec.attacker) === rootOwner(m.caster)) rec.trueStrike = true; },
  onAttacked(m, rec) { const a = rec.attacker; if (a.alive && m.parent.alive) m.parent.world.damage(a, m.parent, a.heroLike ? m.v('proc_damage_heroes') : m.v('proc_damage_creeps'), MAGICAL, 0, m.ability); },
});
defAbility(I('bloodthorn'), { prio: 75, fid: 'full', cast(ab, t) { addMod(ab, t, 'modifier_item_bloodthorn', ab.v('silence_duration')); } });
// Nullifier: dispels the target and keeps dispelling for the duration. The debuff cannot be dispelled (7.26a notes) and goes
// through debuff immunity (7.31), but a debuff immune target is not dispelled (7.34).
const nullify = (t) => { if (t.st[ST.IMMUNE] === 0) t.purge({ debuffs: false, buffs: true }); };
debuff('modifier_item_nullifier', { pierce: true, purge: 'none', interval: 0.1, stats: { msPct: neg('slow_pct') }, onThink(m) { nullify(m.parent); } });
defAbility(I('nullifier'), {
  prio: 72, fid: 'approx', note: 'the continuous dispel runs every 0.1 s. The forced-movement reduction (knockback_reduction) is honoured only by Force Staff and Hurricane Pike; the engine\'s generic knockback does not read it',
  onAdded(ab) { ab.pierces = true; },   // may target debuff immune enemies (target flag in the item data; the engine reads only SpellImmunityType)
  cast(ab, t) { ab.owner.world.projectile(ab.owner, t, ab.v('projectile_speed'), (tt) => { nullify(tt); addMod(ab, tt, 'modifier_item_nullifier', ab.v('mute_duration')); }); },
});
// Dagon (5 item levels share the table); instantly kills illusions
for (const [i, n] of ['dagon', 'dagon_2', 'dagon_3', 'dagon_4', 'dagon_5'].entries()) modifier('modifier_' + I(n), { hidden: true, apply: dagonRangeFix });
for (const [i, n] of ['dagon', 'dagon_2', 'dagon_3', 'dagon_4', 'dagon_5'].entries()) defAbility(I(n), { mods: ['modifier_' + I(n)], prio: 40, fid: 'full', onAdded(ab) { ab.level = i + 1; ab.maxLevel = 5; ab.refresh(); }, cast(ab, t) { if (t.isIllusion) { ab.owner.world.kill(t, ab.owner, ab); return; } hit(ab, t, ab.v('damage'), MAGICAL); } });
// Ethereal Blade / Ghost Scepter (manual: turning a target ethereal also stops your own team's attacks). Ghost form ends on debuff immunity.
modifier('modifier_item_ethereal', {
  debuff: true, state: ['ETHEREAL', 'DISARM'], interval: 0.1, onThink(m) { if (m.parent.st[ST.IMMUNE] > 0) m.remove(); },
  stats: (m) => ({ magicTakenPct: -m.v('ethereal_damage_bonus', m.v('extra_spell_damage_percent')), msPct: m.caster.team !== m.parent.team ? m.v('blast_movement_slow') : 0 }),
});
defAbility(I('ethereal_blade'), {
  manual: true, fid: 'approx', note: 'manual: an ethereal enemy cannot be attacked by your own team either. The cooldown shared with Ghost Scepter is not linked',
  cast(ab, t) { const u = ab.owner; ab.owner.world.projectile(u, t, ab.v('projectile_speed'), (tt) => { if (tt.st[ST.IMMUNE] > 0) return; addMod(ab, tt, 'modifier_item_ethereal', ab.v('duration')); if (tt.team !== u.team) hit(ab, tt, (u.str + u.agi + u.int) * ab.v('blast_stat_multiplier') + ab.v('blast_damage_base'), MAGICAL); }); },
});
defAbility(I('ghost'), {
  manual: true, fid: 'full', note: 'manual: ghost form also stops the wearer\'s own attacks. When the scenario lists it, the AI uses it below 30% health',
  cast(ab) { const u = ab.owner; if (u.st[ST.IMMUNE] > 0) return; u.addModifier('modifier_item_ethereal', { ability: ab, duration: ab.v('duration') }); }, ai: (ab, u) => (u.hp / u.maxHp < 0.3 ? true : null),
});
// Veil of Discord / Bloodstone aura: spell weakness (not on attack-based damage such as cleave or damage return, 7.30e notes); the two do not stack
const spellWeak = (key, unless) => function preMit(m, d) { if (!(d.flags & (F_ATTACK | F_SECONDARY | F_REFLECT)) && !(unless && m.parent.hasModifier(unless))) d.amount *= 1 + m.v(key) / 100; };
debuff('modifier_item_veil', { preMit: spellWeak('spell_amp') });
defAbility(I('veil_of_discord'), { prio: 55, fid: 'full', cast(ab) { for (const e of enemiesNear(ab, ab.owner.x, ab.owner.y, ab.v('debuff_radius'))) if (e.heroLike) addMod(ab, e, 'modifier_item_veil', ab.v('resist_debuff_duration')); }, radius: 'debuff_radius' });
// Solar Crest / Pavise / Glimmer Cape
barrier('modifier_item_solar_crest_barrier', 'physical');
buff('modifier_item_solar_crest', { stats: (m) => { const k = m.parent === m.caster ? m.v('self_efficacy') / 100 : 1; return { armor: m.v('target_armor') * k, as: m.v('target_attack_speed') * k, msPct: m.v('target_movement_speed') * k }; } });
defAbility(I('solar_crest'), { fid: 'full', note: 'AI: cast on itself when the target is within 900', cast(ab, t) { const tt = t || ab.owner; addMod(ab, tt, 'modifier_item_solar_crest', ab.v('duration')); giveBarrier(ab, tt, 'modifier_item_solar_crest_barrier', ab.v('absorb_amount'), ab.v('duration')); }, ai: (ab, u, t) => (t && u.distTo(t) < 900 ? { target: u } : null) });
barrier('modifier_item_pavise_barrier', 'physical');
defAbility(I('pavise'), { fid: 'full', note: 'AI: cast on itself when the target is within 900', cast(ab, t) { giveBarrier(ab, t || ab.owner, 'modifier_item_pavise_barrier', ab.v('absorb_amount'), ab.v('duration')); }, ai: (ab, u, t) => (t && u.distTo(t) < 900 ? { target: u } : null) });
barrier('modifier_item_glimmer_barrier', 'magical');
buff('modifier_item_glimmer_cape_active', { stats: { ms: 'active_movement_speed' } });
defAbility(I('glimmer_cape'), {
  fid: 'partial', note: 'magic barrier and movement speed after the fade delay; the invisibility is not modelled. AI: cast on itself when the target is within 900',
  cast(ab, t) { const tt = t || ab.owner; ab.owner.world.after(ab.v('initial_fade_delay'), () => { if (!tt.alive) return; addMod(ab, tt, 'modifier_item_glimmer_cape_active', ab.v('duration')); giveBarrier(ab, tt, 'modifier_item_glimmer_barrier', ab.v('barrier_block'), ab.v('duration')); }); },
  ai: (ab, u, t) => (t && u.distTo(t) < 900 ? { target: u } : null),
});
// Phylactery / Caduceus: Empower Spell on the next unit-target spell (m.x / m.y = time the enemy / ally half is ready again)
debuff('modifier_item_phylactery_slow', { stats: { msPct: neg('slow') } });
buff('modifier_item_caduceus_haste', { stats: { msPct: 'haste' } });
function empowerEnemy(m, t) { mhit(m, t, m.v('bonus_spell_damage'), MAGICAL); if (t.alive) t.addModifier('modifier_item_phylactery_slow', { caster: m.parent, ability: m.ability, duration: m.v('slow_duration') }); }
function empowerAlly(m, t) { t.heal(m.v('bonus_heal'), m.parent, m.ability); t.addModifier('modifier_item_caduceus_haste', { caster: m.parent, ability: m.ability, duration: m.v('haste_duration') }); }
const empower = {
  hidden: true,
  onCast(m, ev) {
    const t = ev.target; const u = m.parent; const now = u.world.time;
    if (!t || !t.alive || ev.ability === m.ability || ev.ability.def.behavior.includes('DONT_PROC_OTHER_ABILITIES')) return;
    if (t.team !== u.team) { if (now < m.x) return; m.x = now + (m.v('enemy_proc_cooldown') || m.ability.cooldown()); empowerEnemy(m, t); }
    else if (t !== u && m.v('bonus_heal') > 0) { if (now < m.y) return; m.y = now + m.v('ally_proc_cooldown'); empowerAlly(m, t); }
  },
};
const EMPOWER_NOTE = 'triggers on every unit-target ability or item active that is not flagged DONT_PROC_OTHER_ABILITIES, at the end of the cast (not when a projectile connects); the bonus damage is magical (no damage type in the data)';
passive(I('phylactery'), { fid: 'approx', note: EMPOWER_NOTE, ...empower });
modifier('modifier_item_caduceus', empower);
defAbility(I('caduceus'), {
  mods: ['modifier_item_caduceus'], manual: true, prio: 100, fid: 'approx',
  note: EMPOWER_NOTE + '; the ally half triggers on spells cast on other allies. Force is manual and runs the Force Staff script (items_2.mjs) with this item\'s values, then applies Empower Spell to the pushed unit',
  ai(ab, u, t, w) { const f = abilityScripts.get('item_force_staff'); return f && f.ai ? f.ai(ab, u, t, w) : null; },
  cast(ab, t, x, y) {
    const f = abilityScripts.get('item_force_staff'); const m = ab.mods[0]; const tt = t || ab.owner;
    if (f && f.cast) f.cast(ab, t, x, y);
    if (!m || !ab.owner.world.freeSpells && ab.cdEnd === 0) return;   // the Force Staff script refused the cast (cooldown refunded)
    if (tt.team !== ab.owner.team) empowerEnemy(m, tt); else empowerAlly(m, tt);
  },
});
// Bloodstone: Bloodpact raises the spell lifesteal to the active value; Spell Weakness Aura on enemy units
buff('modifier_item_bloodstone_active', { stats: (m) => ({ spellLifesteal: m.v('spell_lifesteal_while_active') - m.v('spell_lifesteal') }) });
auraItem('bloodstone', 'aura_radius', null, 'enemy', { preMit: spellWeak('aura_spell_vulnerability', 'modifier_item_veil') });
defAbility(I('bloodstone'), { mods: ['modifier_item_bloodstone'], fid: 'full', note: 'AI: Bloodpact is used below 60% health', cast(ab) { addMod(ab, ab.owner, 'modifier_item_bloodstone_active', ab.v('buff_duration')); }, ai: (ab, u) => (u.hp / u.maxHp < 0.6 ? true : null) });
