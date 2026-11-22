// Generic status modifiers shared by all content scripts.
import { modifier, debuff, buff } from '../engine/dsl.mjs';

debuff('modifier_stunned', { state: ['STUN'], purge: 'strong', keepLonger: true });
debuff('modifier_silenced', { state: ['SILENCE'], keepLonger: true });
debuff('modifier_rooted', { state: ['ROOT'], keepLonger: true });
debuff('modifier_disarmed', { state: ['DISARM'], keepLonger: true });
debuff('modifier_muted', { state: ['MUTE'], keepLonger: true });
debuff('modifier_break', { state: ['BREAK'], keepLonger: true });
debuff('modifier_feared', { state: ['FEAR'], purge: 'strong', keepLonger: true });
debuff('modifier_taunted', { state: ['TAUNT'], purge: 'none' });
debuff('modifier_sleep', { state: ['SLEEP'], onTakeDamage(m) { m.remove(); } });
// hex: no attacks, spells or items; movement speed set to a fixed value (m.data.ms)
debuff('modifier_hexed', { state: ['HEX'], stats: (m) => ({ msCap: (m.data && m.data.ms) || 140 }) });
// data-driven slow for one-off uses: data = { ms: -30 (%), as: -40 }
debuff('modifier_generic_slow', { multi: 'perCaster', stats: (m) => ({ msPct: (m.data && m.data.ms) || 0, asSlow: (m.data && m.data.as) || 0 }) });

modifier('modifier_invulnerable', { state: ['INVULN'], purge: 'none' });
modifier('modifier_out_of_world', { state: ['OUT', 'INVULN'], purge: 'none' });
buff('modifier_debuff_immune', { state: ['IMMUNE'], purge: 'none', stats: (m) => ({ mr: (m.data && m.data.mr) || 0 }) });

modifier('modifier_illusion', { hidden: true, purge: 'none', stats: (m) => ({ dmgOutPct: m.data.out, dmgTaken: m.data.inc }) });

// demo-mode style runes (values are taken from the rune abilities when present in the data, else classic values)
buff('modifier_rune_doubledamage', { purge: 'none', stats: { dmgBasePct: 100 } });
buff('modifier_rune_haste', { purge: 'none', stats: { msAbs: 550 } });
buff('modifier_rune_regen', { purge: 'none', stats: { hpRegenPct: 6, manaRegenPct: 6 }, onTakeDamage(m, d) { if (d.src && d.src.heroLike) m.remove(); } });
buff('modifier_rune_arcane', { purge: 'none', stats: { cdr: 30, manaCostRed: 30 } });
