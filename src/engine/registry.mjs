// Script registry: ability scripts and modifier definitions are plain objects registered by name.

// unit state counters (a state is active while its counter > 0)
export const ST = {
  STUN: 0, SILENCE: 1, ROOT: 2, DISARM: 3, HEX: 4, MUTE: 5, BREAK: 6, INVULN: 7, IMMUNE: 8, UNTARGETABLE: 9,
  ETHEREAL: 10, INVIS: 11, FEAR: 12, TAUNT: 13, SLEEP: 14, OUT: 15, NO_HEAL: 16, TRUESTRIKE: 17, PHASED: 18,
  FLYING: 19, LEASH: 20, CANNOT_DIE: 21, PASSIVES_OFF: 22, NIGHT: 23,
};
export const NUM_STATES = 24;

export const HOOKS = [
  'outgoing',        // (m, dmg)  owner deals damage, before any mitigation; may change dmg.amount
  'preMit',          // (m, dmg)  owner is about to take damage, before armor / magic resistance (damage block)
  'postMit',         // (m, dmg)  owner takes damage, after armor / magic resistance (% reductions, barriers)
  'onTakeDamage',    // (m, dmg)  after health was removed from owner
  'onDealDamage',    // (m, dmg)  after owner removed health from someone
  'onAttackStart',   // (m, rec)  owner begins an attack wind-up
  'onAttack',        // (m, rec)  owner's attack leaves (attack point): roll crits / procs here
  'onAttackLanded',  // (m, rec)  owner's attack hit the target (after damage)
  'onAttacked',      // (m, rec)  owner was hit by an attack (after damage)
  'onAttackMiss',    // (m, rec)  owner's attack missed
  'onPreAttacked',   // (m, rec)  owner is about to be hit (before damage; may set rec.cancel / rec.dodge)
  'onDeath',         // (m, ev)   owner is about to die; set ev.prevent = true to survive
  'onKill',          // (m, ev)   owner killed ev.victim
  'onCast',          // (m, ev)   owner finished casting ev.ability
  'onSpellTargeted', // (m, ev)   owner is targeted by an enemy unit-target ability; set ev.blocked / ev.reflect
  'onHealed',        // (m, ev)   owner received healing
  'onOrder',         // (m, ev)
  'onAnyDeath',      // (m, ev)   any unit died: ev = { victim, killer, ability }
  'onAnyCast',       // (m, ev)   any unit finished casting: ev = { ability, caster, target }
];

export const abilityScripts = new Map();
export const modifierDefs = new Map();

export function defAbility(name, script) {
  if (abilityScripts.has(name)) throw new Error(`ability script registered twice: ${name}`);
  script.name = name;
  if (typeof script.mods === 'string') script.mods = [script.mods];
  abilityScripts.set(name, script);
  return script;
}

// stat keys that need non-additive handling when given as a static `stats` object
export function addStat(s, key, v) {
  switch (key) {
    case 'mr': s.mrMul *= 1 - v / 100; break;
    case 'evasion': s.evasionMul *= 1 - v / 100; break;
    case 'miss': s.missMul *= 1 - v / 100; break;
    case 'statusRes': s.statusResMul *= 1 - v / 100; break;
    case 'slowRes': s.slowResMul *= 1 - v / 100; break;
    case 'cdr': s.cdrMul *= 1 - v / 100; break;
    case 'dmgTaken': s.dmgTakenMul *= 1 + v / 100; break;
    case 'restore': s.restoreMul *= 1 + v / 100; break;
    case 'all': s.str += v; s.agi += v; s.int += v; break;
    case 'bat': if (v > 0 && (s.bat === 0 || v < s.bat)) s.bat = v; break;
    case 'msAbs': if (v > s.msAbs) s.msAbs = v; break;
    case 'msMax': if (v > s.msMax) s.msMax = v; break;
    case 'msCap': if (v > 0 && (s.msCap === 0 || v < s.msCap)) s.msCap = v; break;
    case 'ms': if (v < 0) s.ms += v; else s.ms += v; break;
    case 'msPct': if (v < 0) s.msSlow += v; else s.msPct += v; break;
    default: s[key] += v;
  }
}

export function defModifier(name, def) {
  if (modifierDefs.has(name)) throw new Error(`modifier registered twice: ${name}`);
  def.name = name;
  def._hooks = HOOKS.filter((h) => typeof def[h] === 'function');
  def._state = (def.state || []).map((n) => {
    if (ST[n] === undefined) throw new Error(`modifier ${name}: unknown state ${n}`);
    return ST[n];
  });
  if (def.stats && !def.apply) {
    if (typeof def.stats === 'function') {
      // stats: (m) => ({ armor: 5, ... })  evaluated on every stat recompute
      const fn = def.stats;
      def.apply = (m, s) => { const o = fn(m); if (o) for (const k in o) addStat(s, k, o[k]); };
    } else {
      const st = def.stats;
      def.apply = (m, s) => { for (const k in st) addStat(s, k, st[k]); };
    }
  }
  modifierDefs.set(name, def);
  return def;
}
