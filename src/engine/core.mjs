// Simulation core: World, Unit, Ability, Modifier and the combat pipeline.
// Headless numeric model: no graphics, no map, 2D positions on an open plane, fixed 30 Hz ticks.
import { Rng, prdC } from './rng.mjs';
import * as C from './constants.mjs';
import { abilityScripts, modifierDefs, ST, NUM_STATES, HOOKS } from './registry.mjs';

const EPS = 1e-9;
const { PHYSICAL, MAGICAL, PURE, F_ATTACK, F_NO_AMP, F_REFLECT, F_HP_LOSS, F_NO_LIFESTEAL, F_NON_LETHAL, F_SECONDARY, F_PIERCE, F_NO_ARMOR } = C;

export const ORDER = { NONE: 0, ATTACK: 1, MOVE: 2, CAST: 3, HOLD: 4 };

// ------------------------------------------------------------------ stats accumulator
export class Stats {
  constructor() { this.reset(); }
  reset() {
    this.str = 0; this.agi = 0; this.int = 0; this.primary = 0;
    this.dmg = 0; this.dmgBase = 0; this.dmgBasePct = 0; this.dmgOutPct = 0;
    this.as = 0; this.bat = 0; this.armor = 0;
    this.hp = 0; this.hpPct = 0; this.mana = 0; this.manaPct = 0;
    this.hpRegen = 0; this.hpRegenPct = 0; this.hpRegenAmp = 0;
    this.manaRegen = 0; this.manaRegenPct = 0; this.manaRegenAmp = 0;
    this.ms = 0; this.msBoots = 0; this.msPctItem = 0; this.msPct = 0; this.msSlow = 0; this.msAbs = 0; this.msMax = 0; this.msCap = 0;
    this.mrMul = 1; this.evasionMul = 1; this.missMul = 1; this.statusResMul = 1; this.slowResMul = 1;
    this.cdrMul = 1; this.dmgTakenMul = 1; this.restoreMul = 1;
    this.spellAmp = 0; this.lifesteal = 0; this.spellLifesteal = 0; this.lifestealAmp = 0; this.healAmp = 0;
    this.castRange = 0; this.attackRange = 0; this.manaCostRed = 0; this.debuffAmp = 0; this.aoe = 0; this.aoePct = 0;
    this.projSpeed = 0; this.potency = 0; this.asSlow = 0; this.magicTakenPct = 0; this.physTakenPct = 0;
  }
}

// ------------------------------------------------------------------ ability values
const pickLevel = (arr, lvl) => arr[lvl > arr.length ? arr.length - 1 : lvl - 1];

function applyOp(v, mod, lvl) {
  const x = pickLevel(mod[2], lvl);
  if (mod[1]) return mod[0] === '=' ? x : v * (1 + x / 100);
  switch (mod[0]) {
    case '+': return v + x;
    case '=': return x;
    case 'x': return v * x;
    default: return v + x;
  }
}

function resolveEntry(e, lvl, owner) {
  if (Array.isArray(e)) return pickLevel(e, lvl);
  let v = pickLevel(e.v, lvl);
  if (e.lv) v += e.lv[0] * Math.floor(owner.level / e.lv[1]);
  if (e.t) { const ts = owner.talents; if (ts.size) for (const tn in e.t) if (ts.has(tn)) v = applyOp(v, e.t[tn], lvl); }
  if (e.sc && owner.hasScepter) v = applyOp(v, e.sc, lvl);
  if (e.sh && owner.hasShard) v = applyOp(v, e.sh, lvl);
  return v;
}

const TOKEN_STAT = {
  damage: 'dmg', str: 'str', agi: 'agi', int: 'int', health: 'hp', mana: 'mana', armor: 'armor', attack: 'as',
  hp_regen: 'hpRegen', mana_regen: 'manaRegen', lifesteal: 'lifesteal', spell_lifesteal: 'spellLifesteal',
  cast_range: 'castRange', aoe_bonus: 'aoe', projectile_speed: 'projSpeed', debuff_amp: 'debuffAmp',
  manacost_reduction: 'manaCostRed', max_mana_percentage: 'manaPct', healing_amp: 'healAmp', primary_attribute: 'primary',
};

export class Ability {
  constructor(owner, def, isItem) {
    this.owner = owner;
    this.def = def;
    this.name = def.name;
    this.isItem = isItem;
    this.script = abilityScripts.get(def.name) || null;
    this.level = 0;
    this.maxLevel = (!isItem && def.liveMax) || (def.maxLevel ?? (isItem ? 1 : def.innate ? 1 : def.type === 'ultimate' ? 3 : owner.isHero ? 4 : maxLen(def.vals)));
    // abilities that carry their own level rule as values (required_level / levels_between_upgrades / max_level)
    if (!isItem && def.vals.max_level !== undefined && def.vals.levels_between_upgrades !== undefined) this.maxLevel = valBase(def.vals.max_level);
    this.vals = {};
    this.cdEnd = 0;
    this.charges = 0;
    this.chargeEnd = 0;
    this.toggled = false;
    this.mods = [];
    this.passive = def.behavior.includes('PASSIVE');
    this.hidden = def.behavior.includes('HIDDEN');
    this.pierces = def.immunity === 'ENEMIES_YES' || def.immunity === 'ALLIES_YES_ENEMIES_YES';
    this.dmgType = C.DMG_TYPE[def.dmg] || MAGICAL;
    this.isBoots = false;
    this.attr = null;      // Power Treads style selected attribute
    this.slot = 'main';    // main | neutral | backpack (items)
    this.data = null;      // free-form script state
    this.casts = 0;
    this.ai = true;        // may the default controller use it
    this.aiNext = 0;       // earliest time the default controller uses it again (only with rules.freeSpells)
    this.aoeKeys = def.aoeMap || null;
  }

  // Value `name` at the current level. Values the game flags as area-scaled (affected_by_aoe_increase) include the owner's
  // area bonuses, exactly like the game's own value lookup does; nothing else is scaled by area bonuses.
  v(name, d = 0) {
    const x = this.vals[name];
    if (x === undefined) return d;
    const ak = this.aoeKeys;
    if (ak !== null && x > 0 && ak[name] === 1) { const o = this.owner; if (o.aoeBonus !== 0 || o.aoePct !== 0) return (x + o.aoeBonus) * (1 + o.aoePct / 100); }
    return x;
  }

  refresh() {
    const lvl = this.level < 1 ? 1 : this.level;
    const dv = this.def.vals;
    const o = this.owner;
    const out = this.vals;
    for (const k in dv) out[k] = resolveEntry(dv[k], lvl, o);
    const maxCh = out.AbilityCharges || 0;
    if (maxCh > 0 && this.level > 0 && this.charges === 0 && this.chargeEnd === 0) this.charges = maxCh;
    if (this.charges > maxCh && !this.isItem) { this.charges = maxCh; if (maxCh === 0) this.chargeEnd = 0; }
    o.dirty = true;
  }

  setLevel(n) {
    n = Math.max(0, Math.min(this.maxLevel, n | 0));
    this.level = n;
    this.refresh();
    this.syncMods();
  }

  // intrinsic (passive) modifiers follow the ability: present while level > 0
  syncMods() {
    const sc = this.script;
    if (!sc || !sc.mods) return;
    const want = this.level > 0 && this.slot !== 'backpack' && (!sc.requires || sc.requires(this)) && (!this.owner.isIllusion || sc.illusion === true);
    if (want && this.mods.length === 0) {
      for (const mn of sc.mods) {
        const m = this.owner.addModifier(mn, { ability: this, intrinsic: true });
        if (m) this.mods.push(m);
      }
    } else if (!want && this.mods.length) {
      for (const m of this.mods) m.remove();
      this.mods.length = 0;
    }
  }

  cooldown() { return this.v('AbilityCooldown') * this.owner.cdrMul; }
  // mana costs are whole numbers in the game: a fractional cost (percentage talents, cost reduction) is rounded down
  manaCost() { return Math.floor(this.v('AbilityManaCost') * (1 - this.owner.manaCostRed / 100) + 1e-6); }
  castRange() { const r = this.v('AbilityCastRange'); return r > 0 ? r + this.owner.castRangeBonus : r; }
  castPoint() { return this.v('AbilityCastPoint'); }
  // the cooldown one use starts: with charges the pause between uses, otherwise the full cooldown
  useCooldown() {
    const c = this.cooldown();
    if (!(this.vals.AbilityCharges > 0)) return c;
    return this.def.lockout !== undefined ? this.def.lockout : c <= C.CHARGE_LOCKOUT_MAX ? c : C.CHARGE_LOCKOUT_DEFAULT;
  }
  cdRemaining() { const t = this.cdEnd - this.owner.world.time; return t > 0 ? t : 0; }
  // cooldown check for passive effects that have an internal cooldown (ignores mana / passive flag)
  cdReady() { return this.owner.world.time + EPS >= this.cdEnd; }

  ready() {
    if (this.level < 1 || this.passive) return false;
    const o = this.owner; const w = o.world;
    if (w.freeSpells) return true;
    if (this.vals.AbilityCharges > 0 && this.charges < 1) return false;
    if (w.time + EPS < this.cdEnd) return false;
    return o.mana + EPS >= this.manaCost();
  }

  startCooldown(cd) {
    const o = this.owner; const w = o.world;
    if (w.freeSpells && !this.passive) return;   // rules.freeSpells lifts the cooldowns of casts, not the internal cooldowns of passives
    const c = cd === undefined ? this.cooldown() : cd;
    const maxCh = this.vals.AbilityCharges || 0;
    if (maxCh > 0) {
      if (this.charges === maxCh) this.chargeEnd = w.time + (this.v('AbilityChargeRestoreTime') || this.v('AbilityCooldown')) * o.cdrMul;
      this.charges--;
      // pause between charge uses: the value read from the running game when there is one; otherwise a short cooldown (up to
      // CHARGE_LOCKOUT_MAX) is used as given and a longer one, which belongs to the ability without charges, is dropped
      const lock = cd !== undefined ? c : this.def.lockout !== undefined ? this.def.lockout : c <= C.CHARGE_LOCKOUT_MAX ? c : C.CHARGE_LOCKOUT_DEFAULT;
      if (lock > 0) this.cdEnd = w.time + lock;
    } else this.cdEnd = w.time + c;
  }

  pay() {
    const o = this.owner;
    if (o.world.freeSpells) return;
    const cost = this.manaCost();
    if (cost > 0) o.mana = Math.max(0, o.mana - cost);
    const hc = this.v('AbilityHealthCost');
    if (hc > 0) o.hp = Math.max(1, o.hp - hc);
  }

  tickCharges(time) {
    const maxCh = this.vals.AbilityCharges || 0;
    if (maxCh > 0 && this.charges < maxCh && time + EPS >= this.chargeEnd) {
      this.charges++;
      this.chargeEnd = this.charges < maxCh ? time + (this.v('AbilityChargeRestoreTime') || this.v('AbilityCooldown')) * this.owner.cdrMul : 0;
    }
  }

  applyItemStats(s, u) {
    const tok = this.def.tokens;
    if (!tok) return;
    const vals = this.vals;
    for (const vn in tok) {
      const v = vals[vn];
      if (!v) continue;
      const t = tok[vn];
      const key = TOKEN_STAT[t];
      if (key !== undefined) { s[key] += v; continue; }
      switch (t) {
        case 'all': s.str += v; s.agi += v; s.int += v; break;
        case 'move_speed':
          if (/_melee$/.test(vn)) { if (u.melee && this.isBoots) s.msBoots = Math.max(s.msBoots, v); else if (u.melee) s.ms += v; }
          else if (/_ranged$/.test(vn)) { if (!u.melee && this.isBoots) s.msBoots = Math.max(s.msBoots, v); else if (!u.melee) s.ms += v; }
          else if (this.isBoots) s.msBoots = Math.max(s.msBoots, v); else s.ms += v;
          break;
        case 'spell_resist': s.mrMul *= 1 - v / 100; break;
        case 'evasion': s.evasionMul *= 1 - v / 100; break;
        case 'status_resist': s.statusResMul *= 1 - v / 100; break;
        case 'slow_resistance': s.slowResMul *= 1 - v / 100; break;
        case 'cooldown_reduction': s.cdrMul *= 1 - v / 100; break;
        case 'attack_range': if (!u.melee) s.attackRange += v; break;
        case 'attack_range_melee': if (u.melee) s.attackRange += v; break;
        case 'attack_range_all': s.attackRange += v; break;
        case 'restoration_amp': s.hpRegenAmp += v; s.lifestealAmp += v; break;
        case 'selected_attrib': {
          const a = this.attr || (u.attr === 'all' ? 'str' : u.attr);
          if (a === 'str') s.str += v; else if (a === 'agi') s.agi += v; else s.int += v;
          break;
        }
        case '%move_speed': if (v > s.msPctItem) s.msPctItem = v; break;
        case '%health': s.hpPct += v; break;
        default: { const k2 = t.charAt(0) === '%' ? TOKEN_STAT[t.slice(1)] : undefined; if (k2 !== undefined) s[k2] += v; else applyPctToken(s, t, v, u); }
      }
    }
    if (this.isBoots) { const v = u.melee ? vals.bonus_movement_speed_melee : vals.bonus_movement_speed_ranged; if (v > s.msBoots) s.msBoots = v; }
  }
}

function applyPctToken(s, t, v, u) {
  switch (t.charAt(0) === '%' ? t.slice(1) : t) {
    case 'spell_resist': s.mrMul *= 1 - v / 100; break;
    case 'evasion': s.evasionMul *= 1 - v / 100; break;
    case 'status_resist': s.statusResMul *= 1 - v / 100; break;
    case 'slow_resistance': s.slowResMul *= 1 - v / 100; break;
    case 'cooldown_reduction': s.cdrMul *= 1 - v / 100; break;
    case 'restoration_amp': s.hpRegenAmp += v; s.lifestealAmp += v; break;
    case 'attack_range': if (!u.melee) s.attackRange += v; break;
    case 'attack_range_melee': if (u.melee) s.attackRange += v; break;
    case 'attack_range_all': s.attackRange += v; break;
    default: break;
  }
}

// ------------------------------------------------------------------ modifiers
export class Modifier {
  constructor(def, parent, caster, ability) {
    this.def = def;
    this.name = def.name;
    this.parent = parent;
    this.caster = caster;
    this.ability = ability;
    this.stacks = 0;
    this.created = 0;
    this.dieTime = Infinity;
    this.interval = 0;
    this.nextThink = Infinity;
    this.removed = false;
    this.brk = false;
    this.prdN = 0;
    this.potency = 100;
    this.x = 0; this.y = 0; this.z = 0; // free numeric slots for scripts
    this.data = null;
  }
  v(name, d = 0) { return this.ability ? this.ability.v(name, d) : d; }
  remove() { this.parent.removeModifier(this); }
  setStacks(n) { if (n !== this.stacks) { this.stacks = n; if (this.def.apply || this.def.late) this.parent.dirty = true; } }
  remaining() { return this.dieTime - this.parent.world.time; }
  setDuration(d) { this.dieTime = this.parent.world.time + d; const p = this.parent; if (this.dieTime < p.nextModEvent) p.nextModEvent = this.dieTime; }
  // pseudo-random roll (PRD) with a per-modifier counter
  roll(chancePct) {
    if (chancePct >= 100) return true;
    if (chancePct <= 0) return false;
    const c = prdC(chancePct);
    if (this.parent.world.rng.next() < c * (this.prdN + 1)) { this.prdN = 0; return true; }
    this.prdN++;
    return false;
  }
  active() { return !(this.brk && this.parent.st[ST.BREAK] > 0); }
}

function fire(arr, hook, arg) {
  const n = arr.length;
  if (n === 0) return;
  if (n === 1) {
    const m = arr[0];
    if (!(m.brk && m.parent.st[ST.BREAK] > 0)) m.def[hook](m, arg);
    return;
  }
  const copy = arr.slice();
  for (let i = 0; i < n; i++) {
    const m = copy[i];
    if (!m.removed && !(m.brk && m.parent.st[ST.BREAK] > 0)) m.def[hook](m, arg);
  }
}

class DamageEvent {
  constructor() { this.src = null; this.dst = null; this.amount = 0; this.type = 0; this.flags = 0; this.ability = null; this.original = 0; this.dealt = 0; this.rec = null; }
}

class AttackRec {
  constructor() {
    this.attacker = null; this.target = null; this.white = 0; this.green = 0; this.flat = 0; this.crit = 1; this.mult = 1;
    this.trueStrike = false; this.potency = 100; this.secondary = false; this.ranged = false; this.missed = false;
    this.damage = 0; this.dealt = 0; this.cancel = false; this.noLifesteal = false; this.data = null; this.fromAbility = null; this.add = 0; this.pierceArmor = 0;
  }
}

// ------------------------------------------------------------------ unit
let hookProto = null;
function makeHooks() {
  const h = {};
  for (const k of HOOKS) h[k] = [];
  return h;
}

export class Unit {
  constructor(world, def, team) {
    this.world = world;
    this.def = def;
    this.name = def.name;
    this.id = 0;
    this.tag = null;
    this.team = team;
    this.isHero = def.hero === 1;
    this.heroLike = this.isHero || def.heroLike === 1;
    this.isRoshan = def.name === 'npc_dota_roshan';
    this.isIllusion = false;
    this.isSummon = false;
    this.isBuilding = false;
    this.owner = null;
    this.melee = def.atk === 'melee';
    this.canAttack = def.atk !== 'none';
    this.attr = def.attr || null;
    this.level = def.level || 1;
    this.attrLevels = 0;
    this.talents = new Set();
    this.talentStats = [];
    this.hasScepter = false;
    this.hasShard = false;
    this.x = 0; this.y = 0;
    this.alive = true;
    this.deathTime = -1;
    // derived (see recompute)
    this.s = new Stats();
    this.dirty = true;
    this.dynamicMods = 0;
    this.str = 0; this.agi = 0; this.int = 0;
    this.maxHp = 1; this.maxMana = 0; this.hp = 1; this.mana = 0; this.hpRegen = 0; this.manaRegen = 0;
    this.armor = 0; this.mr = 0; this.evasion = 0; this.miss = 0; this.statusRes = 0;
    this.dmgMin = 0; this.dmgMax = 0; this.dmgBonus = 0; this.dmgOutMul = 1;
    this.attackSpeed = 100; this.attackInterval = 1.7; this.attackPoint = 0.5; this.attackRange = 150; this.projSpeed = 0;
    this.ms = 300; this.spellAmp = 0; this.lifesteal = 0; this.spellLifesteal = 0; this.lifestealAmp = 0; this.healAmp = 0; this.restoreMul = 1;
    this.cdrMul = 1; this.manaCostRed = 0; this.castRangeBonus = 0; this.debuffAmp = 0; this.aoeBonus = 0; this.aoePct = 0; this.dmgTakenMul = 1;
    this.itemPotency = C.DEFAULT_ITEM_POTENCY; this.basePotency = C.DEFAULT_ITEM_POTENCY;
    this.magicTakenMul = 1; this.physTakenMul = 1;
    // overrides for summons / illusions
    this.ovr = null;
    // containers
    this.abilities = [];
    this.items = [];
    this.mods = [];
    this.statMods = [];
    this.lateMods = [];
    this.hooks = makeHooks();
    this.st = new Int16Array(NUM_STATES);
    this.nextModEvent = Infinity;
    this.modsChanged = false;
    // action state
    this.order = ORDER.NONE; this.orderTarget = null; this.orderX = 0; this.orderY = 0; this.orderAb = null;
    this.winding = false; this.attackStart = 0; this.hitTime = 0; this.nextAttackTime = 0; this.attackTarget = null;
    this.castAb = null; this.castEnd = 0; this.castTarget = null; this.castX = 0; this.castY = 0;
    this.channelAb = null; this.channelEnd = 0;
    this.prdMissN = 0;
    this.lastHurt = -100;
    this.counts = false;
    this.ai = null;
    this.lifeEnd = Infinity;
    // metrics
    this.mDealt = 0; this.mPhys = 0; this.mMagic = 0; this.mPure = 0; this.mTaken = 0; this.mHealed = 0;
    this.mAttacks = 0; this.mHits = 0; this.mMisses = 0; this.mCrits = 0; this.mCasts = 0; this.mKills = 0; this.mHeroDealt = 0;
  }

  // ---------------------------------------------------------------- stats
  recompute() {
    this.dirty = false;
    const s = this.s; s.reset();
    const def = this.def;
    const o = this.ovr;
    const items = this.items;
    for (let i = 0; i < items.length; i++) { const it = items[i]; if (it.slot !== 'backpack') it.applyItemStats(s, this); }
    const ts = this.talentStats;
    for (let i = 0; i < ts.length; i++) { const t = ts[i]; applyTalentStat(s, t[0], t[1]); }
    const sm = this.statMods; const broken = this.st[ST.BREAK] > 0;
    for (let i = 0; i < sm.length; i++) { const m = sm[i]; if (m.brk && broken) continue; m.def.apply(m, s, this); }

    let str = 0; let agi = 0; let int = 0; let attrDmg = 0;
    const hasAttrs = this.isHero || !!(o && o.attrs);
    const bs = o && o.attrs ? o.attrs : def;
    const lv = this.level - 1;
    if (hasAttrs) {
      const ab = this.attrLevels * 2;
      str = bs.str + bs.strGain * lv + ab + s.str;
      agi = bs.agi + bs.agiGain * lv + ab + s.agi;
      int = bs.int + bs.intGain * lv + ab + s.int;
      if (s.primary) { if (this.attr === 'str') str += s.primary; else if (this.attr === 'agi') agi += s.primary; else if (this.attr === 'int') int += s.primary; else { str += s.primary; agi += s.primary; int += s.primary; } }
      if (str < 0) str = 0; if (agi < 0) agi = 0; if (int < 0) int = 0;
    }
    this.str = str; this.agi = agi; this.int = int;
    // late stat contributions: they see the attributes and may still change them (`u.str += n`) or add other stats;
    // everything derived from attributes (health, mana, regeneration, armor, damage) is computed after them
    const lm = this.lateMods;
    for (let i = 0; i < lm.length; i++) { const m = lm[i]; if (m.brk && broken) continue; m.def.late(m, s, this); }
    if (hasAttrs) {
      str = this.str; agi = this.agi; int = this.int;
      // Attack damage uses whole attribute points. The game adds the attribute gain once per level in single precision, so a
      // growth that should land exactly on a whole number can sit just below it (seen in the live game at levels 6, 11, 16, 21...).
      // Universal heroes: 0.45 x the whole part of the sum of the three attributes.
      const g = levelGrowthF32(bs, this.level);
      const sF = str - (bs.str + bs.strGain * lv) + g[0]; const aF = agi - (bs.agi + bs.agiGain * lv) + g[1]; const iF = int - (bs.int + bs.intGain * lv) + g[2];
      attrDmg = this.attr === 'str' ? Math.floor(sF) * C.DMG_PER_PRIMARY : this.attr === 'agi' ? Math.floor(aF) * C.DMG_PER_PRIMARY : this.attr === 'int' ? Math.floor(iF) * C.DMG_PER_PRIMARY
        : Math.floor(C.DMG_PER_ATTR_UNIVERSAL * Math.floor(Math.fround(Math.fround(sF + aF) + iF)) + 1e-9);
    }

    const baseHp = o && o.hp !== undefined ? o.hp : def.hp;
    const oldMaxHp = this.maxHp; const oldMaxMana = this.maxMana;
    // health and mana come from whole points of strength / intelligence
    let maxHp = (baseHp + C.HP_PER_STR * Math.floor(str + 1e-6) + s.hp) * (1 + s.hpPct / 100);
    if (maxHp < 1) maxHp = 1;
    let maxMana = ((o && o.mana !== undefined ? o.mana : def.mana) + C.MANA_PER_INT * Math.floor(int + 1e-6) + s.mana) * (1 + s.manaPct / 100);
    if (maxMana < 0) maxMana = 0;
    this.maxHp = maxHp; this.maxMana = maxMana;
    if (this.alive && oldMaxHp > 0 && maxHp !== oldMaxHp && this.hp > 0) this.hp = Math.max(1, this.hp * (maxHp / oldMaxHp));
    if (oldMaxMana > 0 && maxMana !== oldMaxMana) this.mana = this.mana * (maxMana / oldMaxMana);
    if (this.hp > maxHp) this.hp = maxHp;
    if (this.mana > maxMana) this.mana = maxMana;

    this.restoreMul = s.restoreMul;
    this.hpRegen = ((o && o.hpRegen !== undefined ? o.hpRegen : def.hpRegen) + C.HP_REGEN_PER_STR * str + s.hpRegen) * (1 + s.hpRegenAmp / 100) + maxHp * s.hpRegenPct / 100;
    if (this.hpRegen > 0) this.hpRegen *= s.restoreMul;
    this.manaRegen = (def.manaRegen + C.MANA_REGEN_PER_INT * int + s.manaRegen) * (1 + s.manaRegenAmp / 100) + maxMana * s.manaRegenPct / 100;

    this.armor = (o && o.armor !== undefined ? o.armor : def.armor) + C.ARMOR_PER_AGI * agi + s.armor;
    const mrBase = (o && o.mr !== undefined ? o.mr : def.mr) / 100 + (this.isHero ? C.MR_PER_INT * int : 0);
    this.mr = 1 - (1 - mrBase) * s.mrMul;
    this.evasion = 1 - s.evasionMul;
    this.miss = 1 - s.missMul;
    this.statusRes = 1 - s.statusResMul;

    const dMin = (o && o.dmgMin !== undefined ? o.dmgMin : def.dmgMin) + attrDmg + s.dmgBase;
    const dMax = (o && o.dmgMax !== undefined ? o.dmgMax : def.dmgMax) + attrDmg + s.dmgBase;
    this.dmgMin = dMin; this.dmgMax = dMax;
    this.dmgBonus = s.dmg + ((dMin + dMax) / 2) * s.dmgBasePct / 100;
    this.dmgOutMul = Math.max(0, 1 + s.dmgOutPct / 100);

    let as = def.baseAs + C.AS_PER_AGI * agi + s.as + s.asSlow;
    if (as < C.AS_MIN) as = C.AS_MIN; else if (as > C.AS_MAX) as = C.AS_MAX;
    this.attackSpeed = as;
    const bat = s.bat > 0 ? s.bat : (o && o.bat !== undefined ? o.bat : def.bat);
    this.attackInterval = bat / (as / 100);
    this.attackPoint = def.animPt / (as / 100);
    this.attackRange = (o && o.range !== undefined ? o.range : def.range) + s.attackRange;
    this.projSpeed = def.projSpeed > 0 ? def.projSpeed + s.projSpeed : 0;

    const slowRes = 1 - s.slowResMul;
    let ms = ((o && o.ms !== undefined ? o.ms : def.ms) + s.ms + s.msBoots) * (1 + (s.msPct + s.msPctItem + s.msSlow * (1 - slowRes)) / 100);
    const cap = s.msMax > 0 ? s.msMax : C.MS_MAX;
    if (ms > cap) ms = cap;
    if (s.msAbs > 0 && ms < s.msAbs) ms = s.msAbs;
    if (ms < C.MS_MIN) ms = C.MS_MIN;
    // [L] a cap may go below the 100 floor: the game holds units at a barrier at about 0.1, Will-o-Wisp at 60, Sun Ray at 0
    if (s.msCap > 0 && ms > s.msCap) ms = s.msCap;
    this.ms = def.ms > 0 || (o && o.ms) ? ms : 0;

    this.spellAmp = s.spellAmp; this.lifesteal = s.lifesteal; this.spellLifesteal = s.spellLifesteal;
    this.lifestealAmp = s.lifestealAmp; this.healAmp = s.healAmp;
    this.cdrMul = s.cdrMul; this.manaCostRed = s.manaCostRed; this.castRangeBonus = s.castRange;
    this.debuffAmp = s.debuffAmp; this.aoeBonus = s.aoe; this.aoePct = s.aoePct; this.dmgTakenMul = s.dmgTakenMul;
    this.magicTakenMul = 1 + s.magicTakenPct / 100; this.physTakenMul = 1 + s.physTakenPct / 100;
    this.itemPotency = this.basePotency + s.potency;
  }

  stats() { if (this.dirty) this.recompute(); return this; }

  // ---------------------------------------------------------------- modifiers
  findModifier(name, caster = null) {
    const ms = this.mods;
    for (let i = 0; i < ms.length; i++) { const m = ms[i]; if (m.name === name && (caster === null || m.caster === caster)) return m; }
    return null;
  }
  hasModifier(name) { return this.findModifier(name) !== null; }

  addModifier(name, o) {
    const def = modifierDefs.get(name);
    if (!def) throw new Error(`unknown modifier: ${name}`);
    const w = this.world;
    if (!this.alive && !def.allowDead) return null;
    const caster = (o && o.caster) || this;
    const ability = (o && o.ability) || null;
    let duration = o && o.duration !== undefined ? o.duration : def.duration !== undefined ? def.duration : Infinity;
    if (def.debuff && caster.team !== this.team) {
      const pierce = (o && o.pierce) || (ability && ability.pierces) || def.pierce;
      if (this.st[ST.IMMUNE] > 0 && !pierce) return null;
      if (this.st[ST.INVULN] > 0 || this.st[ST.OUT] > 0) return null;
      if (duration !== Infinity && def.statusResist !== false && !(o && o.noResist)) {
        if (this.dirty) this.recompute();
        duration *= 1 - this.statusRes;
        if (caster.debuffAmp) duration *= 1 + caster.debuffAmp / 100;
      }
    }
    const mode = def.multi || 'refresh';
    if (mode !== 'independent') {
      const ex = this.findModifier(name, mode === 'perCaster' ? caster : null);
      if (ex) {
        if (duration !== Infinity) { const nd = w.time + duration; if (!def.keepLonger || nd > ex.dieTime) ex.dieTime = nd; }
        ex.caster = caster;
        if (ability) ex.ability = ability;
        if (o && o.potency !== undefined && o.potency > ex.potency) ex.potency = o.potency;
        if (mode === 'stack') {
          const max = def.maxStacks ? (typeof def.maxStacks === 'function' ? def.maxStacks(ex) : def.maxStacks) : Infinity;
          const add = o && o.stacks !== undefined ? o.stacks : 1;
          ex.setStacks(Math.min(max, ex.stacks + add));
        }
        if (def.onRefresh) def.onRefresh(ex, o);
        if (def.apply) this.dirty = true;
        if (ex.dieTime < this.nextModEvent) this.nextModEvent = ex.dieTime;
        return ex;
      }
    }
    const m = new Modifier(def, this, caster, ability);
    m.created = w.time;
    m.dieTime = duration === Infinity ? Infinity : w.time + duration;
    m.stacks = o && o.stacks !== undefined ? o.stacks : mode === 'stack' ? 1 : 0;
    m.brk = def.breakable !== undefined ? !!def.breakable : !!(o && o.intrinsic && ability && ability.def.breakable);
    if (o && o.data) m.data = o.data;
    if (o && o.potency !== undefined) m.potency = o.potency;
    this.mods.push(m);
    const hk = def._hooks;
    for (let i = 0; i < hk.length; i++) this.hooks[hk[i]].push(m);
    if (def.apply) { this.statMods.push(m); this.dirty = true; }
    if (def.late) { this.lateMods.push(m); this.dirty = true; }
    const stt = def._state;
    for (let i = 0; i < stt.length; i++) { this.st[stt[i]]++; if (stt[i] === ST.BREAK) this.dirty = true; }
    if (def.dynamic) this.dynamicMods++;
    if (def.interval) {
      const iv = typeof def.interval === 'function' ? def.interval(m) : def.interval;
      if (iv > 0) { m.interval = iv; m.nextThink = w.time + (def.thinkNow ? 0 : iv); }
    }
    if (def.onCreated) def.onCreated(m, o);
    if (m.dieTime < this.nextModEvent) this.nextModEvent = m.dieTime;
    if (m.nextThink < this.nextModEvent) this.nextModEvent = m.nextThink;
    if (w.log && !def.hidden) w.logEvent('mod+', caster, this, name, duration === Infinity ? -1 : duration);
    return m;
  }

  removeModifier(m, expired = false) {
    if (m.removed) return;
    m.removed = true;
    this.modsChanged = true;
    const def = m.def;
    let i = this.mods.indexOf(m);
    if (i >= 0) this.mods.splice(i, 1);
    const hk = def._hooks;
    for (let k = 0; k < hk.length; k++) { const a = this.hooks[hk[k]]; i = a.indexOf(m); if (i >= 0) a.splice(i, 1); }
    if (def.apply) { i = this.statMods.indexOf(m); if (i >= 0) this.statMods.splice(i, 1); this.dirty = true; }
    if (def.late) { i = this.lateMods.indexOf(m); if (i >= 0) this.lateMods.splice(i, 1); this.dirty = true; }
    const stt = def._state;
    for (let k = 0; k < stt.length; k++) { this.st[stt[k]]--; if (stt[k] === ST.BREAK) this.dirty = true; }
    if (def.dynamic) this.dynamicMods--;
    if (def.onDestroy) def.onDestroy(m, expired);
    const w = this.world;
    if (w.log && !def.hidden) w.logEvent('mod-', m.caster, this, m.name, 0);
  }

  removeModifierByName(name) {
    let n = 0;
    for (let i = this.mods.length - 1; i >= 0; i--) if (this.mods[i] && this.mods[i].name === name) { this.removeModifier(this.mods[i]); n++; }
    return n;
  }

  // dispel: removes debuffs (enemy dispel removes buffs when buffs = true)
  purge({ debuffs = true, buffs = false, strong = false } = {}) {
    for (let i = this.mods.length - 1; i >= 0; i--) {
      const m = this.mods[i];
      if (!m) continue;
      const d = m.def;
      const p = d.purge || (d.debuff ? 'basic' : 'none');
      if (p === 'none') continue;
      if (p === 'strong' && !strong) continue;
      if ((d.debuff && debuffs) || (!d.debuff && buffs && d.purge)) this.removeModifier(m);
    }
  }

  // ---------------------------------------------------------------- state helpers
  isDisabled() { const st = this.st; return st[ST.STUN] > 0 || st[ST.SLEEP] > 0 || st[ST.OUT] > 0; }
  cantAct() { const st = this.st; return st[ST.STUN] > 0 || st[ST.SLEEP] > 0 || st[ST.OUT] > 0 || st[ST.HEX] > 0 || st[ST.FEAR] > 0; }
  isSilenced() { return this.st[ST.SILENCE] > 0 || this.st[ST.HEX] > 0; }
  isMuted() { return this.st[ST.MUTE] > 0 || this.st[ST.HEX] > 0; }
  isDisarmed() { return this.st[ST.DISARM] > 0 || this.st[ST.HEX] > 0 || this.st[ST.ETHEREAL] > 0; }
  isRooted() { return this.st[ST.ROOT] > 0; }
  isImmune() { return this.st[ST.IMMUNE] > 0; }
  targetable() { return this.alive && this.st[ST.UNTARGETABLE] === 0 && this.st[ST.OUT] === 0; }
  attackableBy(a) { return this.alive && this.st[ST.UNTARGETABLE] === 0 && this.st[ST.OUT] === 0 && this.st[ST.INVULN] === 0 && this.st[ST.ETHEREAL] === 0 && (this.st[ST.INVIS] === 0 || a.world.detectAll); }
  isEnemy(o) { return o.team !== this.team; }
  distTo(o) { const dx = o.x - this.x; const dy = o.y - this.y; return Math.sqrt(dx * dx + dy * dy); }
  rangeTo(o) { return this.distTo(o) - this.def.hull - o.def.hull; }
  hpPct() { if (this.dirty) this.recompute(); return this.hp / this.maxHp; }
  // base (white) attribute value from level growth only
  baseAttr(k) { const d = this.def; const lv = this.level - 1; return k === 'str' ? d.str + d.strGain * lv : k === 'agi' ? d.agi + d.agiGain * lv : d.int + d.intGain * lv; }
  // teleport next to `t` (stops at attack reach); used by blinks, leaps and charges
  jumpTo(t, maxDist = Infinity, stop = null) {
    const dx = t.x - this.x; const dy = t.y - this.y; const d = Math.sqrt(dx * dx + dy * dy) || 1;
    const keep = stop === null ? Math.min(this.attackRange, 150) + this.def.hull + t.def.hull - 10 : stop;
    const go = Math.min(maxDist, Math.max(0, d - keep));
    this.x += dx / d * go; this.y += dy / d * go;
  }
  manaPct() { if (this.dirty) this.recompute(); return this.maxMana > 0 ? this.mana / this.maxMana : 0; }

  // ---------------------------------------------------------------- resources
  heal(amount, src = null, ability = null, isRegen = false) {
    if (!this.alive || amount <= 0 || this.st[ST.NO_HEAL] > 0) return 0;
    if (this.dirty) this.recompute();
    let a = amount * this.restoreMul;
    if (src && src.healAmp && !isRegen) a *= 1 + src.healAmp / 100;
    const room = this.maxHp - this.hp;
    if (a > room) a = room;
    if (a <= 0) return 0;
    this.hp += a;
    if (src) src.mHealed += a;
    const hh = this.hooks.onHealed;
    if (hh.length) fire(hh, 'onHealed', { amount: a, src, ability, target: this });
    const w = this.world;
    if (w.log && a >= 1) w.logEvent('heal', src, this, ability ? ability.name : '', a);
    return a;
  }
  giveMana(amount) { if (!this.alive || amount <= 0) return 0; if (this.dirty) this.recompute(); const a = Math.min(amount, this.maxMana - this.mana); if (a > 0) this.mana += a; return a > 0 ? a : 0; }
  burnMana(amount) { if (this.dirty) this.recompute(); const a = Math.min(amount, this.mana); if (a > 0) this.mana -= a; return a > 0 ? a : 0; }

  // ---------------------------------------------------------------- orders
  attack(target) { this.order = ORDER.ATTACK; this.orderTarget = target; this.orderAb = null; }
  moveTo(x, y) { this.order = ORDER.MOVE; this.orderX = x; this.orderY = y; this.orderTarget = null; this.cancelWindup(); }
  stop() { this.order = ORDER.NONE; this.orderTarget = null; this.cancelWindup(); this.castAb = null; }
  hold() { this.order = ORDER.HOLD; this.orderTarget = null; }
  // a cast order without a target and without a point is aimed at the caster's own position
  cast(ab, target = null, x, y) { this.order = ORDER.CAST; this.orderAb = ab; this.orderTarget = target; this.orderX = x === undefined ? this.x : x; this.orderY = y === undefined ? this.y : y; }
  cancelWindup() { this.winding = false; }

  // call after abilities / items changed at runtime so the controller rebuilds its cast list
  refreshAI() { if (this.ai && this.ai.castables) this.ai.castables = null; }

  findAbility(name) {
    for (const a of this.abilities) if (a.name === name) return a;
    for (const a of this.items) if (a.name === name) return a;
    return null;
  }

  // ---------------------------------------------------------------- setup helpers
  addAbility(name, level = 0) {
    const def = this.world.data.abilities[name];
    if (!def) throw new Error(`unknown ability: ${name}`);
    const ab = new Ability(this, def, false);
    this.abilities.push(ab);
    ab.setLevel(level);
    return ab;
  }

  addItem(name, opts = {}) {
    const w = this.world;
    const key = name.startsWith('item_') ? name : 'item_' + name;
    const def = w.data.abilities[key];
    if (!def || !def.item) throw new Error(`unknown item: ${name}`);
    if (key === 'item_ultimate_scepter' || key === 'item_ultimate_scepter_2') this.setUpgrades(true, this.hasShard);
    if (key === 'item_aghanims_shard') { this.setUpgrades(this.hasScepter, true); return null; }
    if (key === 'item_ultimate_scepter_2') return null;
    const it = new Ability(this, def, true);
    it.isBoots = w.data.bootsFamily.has(key);
    it.slot = opts.slot || (def.artifact || def.enchant ? 'neutral' : 'main');
    if (opts.attr) it.attr = opts.attr;
    it.maxLevel = def.maxLevel ?? (def.vals.max_level ? def.vals.max_level[0] ?? 1 : maxLen(def.vals));
    this.items.push(it);
    it.setLevel(opts.level || 1);
    if (def.charges !== undefined) it.charges = opts.charges ?? def.charges;
    if (it.script && it.script.onAdded) it.script.onAdded(it);
    this.dirty = true;
    return it;
  }

  removeItem(name) {
    const key = name.startsWith('item_') ? name : 'item_' + name;
    const i = this.items.findIndex((x) => x.name === key);
    if (i < 0) return false;
    const it = this.items[i];
    for (const m of it.mods) m.remove();
    this.items.splice(i, 1);
    this.dirty = true;
    return true;
  }

  setUpgrades(scepter, shard) {
    this.hasScepter = !!scepter; this.hasShard = !!shard;
    for (const a of this.abilities) {
      if (a.def.bySc) a.setLevel(this.hasScepter ? this.grantedLevel(a) : 0);
      else if (a.def.bySh) a.setLevel(this.hasShard ? this.grantedLevel(a) : 0);
      else { a.refresh(); a.syncMods(); }
    }
  }

  // level of an ability granted by Scepter / Shard: 1, or the level of the ability it depends on (DependentOnAbility)
  grantedLevel(a) {
    const p = a.def.dep ? this.abilities.find((x) => x.name === a.def.dep) : null;
    return p ? followLevel(a, p, 1, true) : 1;
  }

  setTalents(list) {
    this.talents = new Set(list);
    this.talentStats = [];
    const data = this.world.data;
    for (const t of this.talents) {
      const fam = talentFamily(t);
      if (!fam) continue;
      const def = data.abilities[t];
      const v = def && def.vals.value ? def.vals.value[0] : Number((/_(\d+)$/.exec(t) || [])[1]);
      if (Number.isFinite(v)) this.talentStats.push([fam, v]);
    }
    for (const a of this.abilities) { a.refresh(); a.syncMods(); }
    for (const a of this.items) a.refresh();
    this.dirty = true;
  }

  // Which abilities take skill points and which follow another ability.
  //  - abilities joined by LinkedAbility form one group with one shared level (Shadowraze, Morph, Kez's two weapon sets)
  //  - a group is learned through its first learnable member; hidden helpers, innate / Scepter / Shard / NOT_LEARNABLE abilities and
  //    one-level non-ultimates never take points
  //  - an ability that takes no points follows its group, the ability named by DependentOnAbility, or (hidden helpers) the ability whose
  //    name it extends ("x_release" follows "x")
  skillPlan() {
    const abs = this.abilities;
    const byName = new Map();
    for (const a of abs) if (!byName.has(a.name)) byName.set(a.name, a);
    const hid = (a) => a.def.behavior.includes('HIDDEN');
    const fixed = (a) => { const d = a.def; return !!(d.innate || d.bySc || d.bySh || d.behavior.includes('NOT_LEARNABLE')); };
    const learnable = (a) => { const d = a.def; return !fixed(a) && !hid(a) && !d.talent && !d.pureFollower && d.type !== 'attributes' && !(d.type !== 'ultimate' && d.maxLevel === 1); };
    const up = new Map();
    const find = (a) => { let r = a; while (up.has(r)) r = up.get(r); return r; };
    for (const a of abs) {
      const o = a.def.linked ? byName.get(a.def.linked) : null;
      if (o && o !== a) { const ra = find(a); const rb = find(o); if (ra !== rb) up.set(rb, ra); }
    }
    const sets = new Map();
    for (const a of abs) { const r = find(a); const m = sets.get(r); if (m) m.push(a); else sets.set(r, [a]); }
    const groups = []; const subs = [];
    for (const members of sets.values()) {
      const lead = members.find(learnable);
      if (lead) {
        const d = lead.def; const ult = d.type === 'ultimate';
        groups.push({ lead, members, ult, n: 0,
          req: valBase(d.vals.required_level) ?? d.reqLevel ?? (ult ? 6 : 1), step: valBase(d.vals.levels_between_upgrades) ?? d.lvlStep ?? (ult ? 6 : 2) });
        for (const m of members) if (m !== lead) subs.push({ a: m, parent: lead, dep: false });
        continue;
      }
      const head = members.length > 1 ? (members.find((m) => !hid(m)) || members[0]) : null;
      for (const m of members) {
        let parent = head !== null && m !== head ? head : null; let dep = false;
        if (parent === null && m.def.dep) { const q = byName.get(m.def.dep); if (q && q !== m) { parent = q; dep = true; } }
        if (parent === null && hid(m) && !fixed(m)) {
          for (const x of abs) if (x !== m && !hid(x) && m.name.startsWith(x.name + '_') && (parent === null || x.name.length > parent.name.length)) parent = x;
        }
        subs.push({ a: m, parent, dep });
      }
    }
    return { groups, subs };
  }

  // Level a hero and distribute skill points the standard way. Since 7.40 every hero level gives one skill point (talents have
  // their own points), spent on the ultimate whenever it can be raised and otherwise on the basic abilities evenly (or in `prio`
  // order). The +2 all attributes bonuses are not bought with points: they arrive at fixed levels (15, 16, 17, 19, 20, 21, 22),
  // which are exactly the levels at which a standard hero has nothing to skill. Schedule and exceptions come from the live game.
  setLevel(level, { skills = null, prio = null } = {}) {
    this.level = Math.max(1, Math.min(C.MAX_LEVEL, level | 0));
    if (!this.isHero) { for (const a of this.abilities) a.refresh(); this.dirty = true; return; }
    const L = this.level;
    const facts = this.world.data.facts;
    const sched = (facts && facts.attributeBonusLevels) || C.ATTRIBUTE_BONUS_LEVELS;
    let attr = 0;
    if (!this.def.noAttr) for (const x of sched) if (L >= x) attr++;
    const { groups, subs } = this.skillPlan();
    if (skills) {
      for (const g of groups) { let n = 0; for (const a of g.members) { const v = skills[a.name]; if (v > n) n = v; } g.n = n; }
    } else {
      const rk = (g) => { let r = 99; for (const a of g.members) { const i = prio.indexOf(a.name); if (i >= 0 && i < r) r = i; } return r; };
      const order = prio ? groups.slice().sort((a, b) => rk(a) - rk(b)) : groups;
      const ults = order.filter((g) => g.ult); const basics = order.filter((g) => !g.ult);
      for (let l = 1; l <= L; l++) {
        let pick = null;
        for (const g of ults) if (g.n < g.lead.maxLevel && l >= g.req + g.step * g.n) { pick = g; break; }
        if (pick === null) {
          let low = Infinity;
          for (const g of basics) {
            if (g.n >= g.lead.maxLevel || l < g.req + g.step * g.n) continue;
            if (prio) { pick = g; break; }
            if (g.n < low) { low = g.n; pick = g; }
          }
        }
        if (pick !== null) pick.n++;
      }
    }
    this.attrLevels = attr;
    for (const g of groups) g.lead.setLevel(g.n);
    const subOf = new Map();
    for (const x of subs) subOf.set(x.a, x);
    const done = new Set();
    const resolve = (x) => {
      const a = x.a;
      if (done.has(a)) return;
      done.add(a);
      const d = a.def;
      if (skills && skills[a.name] !== undefined) { a.setLevel(skills[a.name]); return; }
      if ((d.bySc && !this.hasScepter) || (d.bySh && !this.hasShard)) { a.setLevel(0); return; }
      const p = x.parent;
      if (p !== null) {
        const px = subOf.get(p);
        if (px) resolve(px);
        a.setLevel(followLevel(a, p, d.innate || d.bySc || d.bySh || d.behavior.includes('NOT_LEARNABLE') ? 1 : 0, x.dep));
      } else if (d.innate) a.setLevel(a.maxLevel > 1 ? Math.min(a.maxLevel, innateLevel(d, L)) : 1);
      else a.setLevel(1);
    };
    for (const x of subs) resolve(x);
    if (facts) this.applyLevelLinks(groups, skills);
    for (const a of this.items) a.refresh();
    this.dirty = true;
  }

  // Level links read from the running game: when an ability is raised the game moves certain other abilities with it (twins,
  // helper buttons, innates that grow with the ultimate). Abilities that took skill points, and abilities nothing leads, are the
  // starting points; every follower gets the level the game gave it for its leader's level.
  applyLevelLinks(groups, skills) {
    const abs = this.abilities;
    const settled = new Set();
    for (const g of groups) settled.add(g.lead);
    for (const a of abs) if (!a.def.followerOf) settled.add(a);
    let queue = [...settled];
    for (let pass = 0; pass < 4 && queue.length; pass++) {
      const next = [];
      for (const x of queue) {
        const fl = x.def.follow;
        if (!fl) continue;
        for (const f of abs) {
          const map = fl[f.name];
          if (!map || settled.has(f)) continue;
          settled.add(f); next.push(f);
          const d = f.def;
          if (skills && skills[f.name] !== undefined) continue;
          if ((d.bySc && !this.hasScepter) || (d.bySh && !this.hasShard)) { if (f.level !== 0) f.setLevel(0); continue; }
          let n = x.level > 0 ? map[Math.min(x.level, map.length) - 1] : (d.fresh || 0);
          if (n === null || n === undefined) n = d.fresh || 0;
          if (n > f.maxLevel) f.maxLevel = n;
          if (f.level !== n) f.setLevel(n);
        }
      }
      queue = next;
    }
  }

  // ---------------------------------------------------------------- per-tick update
  update(time, dt) {
    if (time + EPS >= this.lifeEnd) { this.world.kill(this, null, null, true); return; }
    // modifiers: expiry + interval thinking
    if (time + EPS >= this.nextModEvent) this.updateMods(time);
    if (!this.alive) return;
    if (this.dirty || this.dynamicMods > 0) this.recompute();
    const w = this.world;
    // regeneration
    if (w.regen) {
      const hr = this.hpRegen;
      if (hr !== 0 && this.st[ST.NO_HEAL] === 0) { let h = this.hp + hr * dt; if (h > this.maxHp) h = this.maxHp; else if (h < 1) h = this.hp < 1 ? this.hp : 1; this.hp = h; }
      const mr = this.manaRegen;
      if (mr !== 0) { let m = this.mana + mr * dt; if (m > this.maxMana) m = this.maxMana; else if (m < 0) m = 0; this.mana = m; }
    }
    const abs = this.abilities;
    for (let i = 0; i < abs.length; i++) if (abs[i].vals.AbilityCharges > 0) abs[i].tickCharges(time);

    const st = this.st;
    if (st[ST.STUN] > 0 || st[ST.SLEEP] > 0 || st[ST.OUT] > 0) { this.winding = false; this.castAb = null; if (this.channelAb) this.endChannel(true); return; }
    if (this.channelAb) {
      if (st[ST.SILENCE] > 0 || st[ST.HEX] > 0) { this.endChannel(true); }
      else { if (time + EPS >= this.channelEnd) this.endChannel(false); return; }
    }
    if (this.castAb) {
      const ab = this.castAb;
      if ((ab.isItem ? this.isMuted() : this.isSilenced()) || (this.castTarget && !this.castTarget.alive)) { this.castAb = null; }
      else { if (time + EPS >= this.castEnd) this.finishCast(); return; }
    }
    if (st[ST.FEAR] > 0 || st[ST.TAUNT] > 0) { this.forcedBehavior(time, dt); return; }
    if (this.ai !== null && !this.winding) this.ai.think(this, w);
    switch (this.order) {
      case ORDER.ATTACK: this.doAttackOrder(time, dt); break;
      case ORDER.CAST: this.doCastOrder(time, dt); break;
      case ORDER.MOVE: if (this.stepToward(this.orderX, this.orderY, 0, dt)) this.order = ORDER.NONE; break;
      default: break;
    }
  }

  updateMods(time) {
    this.nextModEvent = Infinity;
    this.modsChanged = false;
    let next = Infinity;
    const ms = this.mods;
    for (let i = ms.length - 1; i >= 0; i--) {
      const m = ms[i];
      if (m === undefined) continue;
      if (m.dieTime <= time + EPS) { this.removeModifier(m, true); continue; }
      if (m.nextThink <= time + EPS) {
        m.nextThink += m.interval;
        if (!(m.brk && this.st[ST.BREAK] > 0)) m.def.onThink(m);
        if (m.removed) continue;
      }
      if (m.dieTime < next) next = m.dieTime;
      if (m.nextThink < next) next = m.nextThink;
    }
    if (next < this.nextModEvent) this.nextModEvent = next;
    if (this.modsChanged) this.nextModEvent = time;
  }

  forcedBehavior(time, dt) {
    // taunt: attack the taunter; fear: no actions (movement away is not modelled beyond losing the action)
    if (this.st[ST.TAUNT] > 0) {
      const m = this.mods.find((x) => x.def._state.includes(ST.TAUNT));
      if (m && m.caster && m.caster.alive) { this.order = ORDER.ATTACK; this.orderTarget = m.caster; this.doAttackOrder(time, dt); }
    } else { this.winding = false; }
  }

  stepToward(tx, ty, stopDist, dt) {
    const dx = tx - this.x; const dy = ty - this.y;
    const d = Math.sqrt(dx * dx + dy * dy);
    if (d <= stopDist + 1e-6) return true;
    if (this.st[ST.ROOT] > 0 || this.ms <= 0) return false;
    let step = this.ms * dt;
    const need = d - stopDist;
    let arrived = false;
    if (step >= need) { step = need; arrived = true; }
    this.x += (dx / d) * step; this.y += (dy / d) * step;
    return arrived;
  }

  doAttackOrder(time, dt) {
    const t = this.orderTarget;
    if (t === null || !t.alive || !this.canAttack) { this.winding = false; this.order = ORDER.NONE; this.orderTarget = null; return; }
    if (!t.attackableBy(this)) { this.winding = false; return; }
    if (this.isDisarmed()) { this.winding = false; return; }
    const reach = this.attackRange + this.def.hull + t.def.hull;
    if (this.winding) {
      if (this.attackTarget !== t) { this.winding = false; }
      else if (time + EPS >= this.hitTime) { this.winding = false; this.world.launchAttack(this, t); }
      return;
    }
    const dx = t.x - this.x; const dy = t.y - this.y;
    const d = Math.sqrt(dx * dx + dy * dy);
    // out of reach: close in; when this step brings the target into reach the attack starts in the same tick
    // (otherwise a target that keeps walking away could never be attacked)
    if (d > reach + 1e-6 && !this.stepToward(t.x, t.y, reach - 1, dt)) return;
    if (time + EPS >= this.nextAttackTime) {
      // keep the ideal timeline when we were merely waiting for the next tick
      const start = time - this.nextAttackTime < dt + EPS && this.nextAttackTime > 0 ? this.nextAttackTime : time;
      this.attackStart = start;
      this.hitTime = start + this.attackPoint;
      this.nextAttackTime = start + this.attackInterval;
      this.attackTarget = t;
      this.winding = true;
      const hs = this.hooks.onAttackStart;
      if (hs.length) { const rec = this.world.tmpRec; rec.attacker = this; rec.target = t; fire(hs, 'onAttackStart', rec); }
      if (time + EPS >= this.hitTime) { this.winding = false; this.world.launchAttack(this, t); }
    }
  }

  doCastOrder(time, dt) {
    const ab = this.orderAb;
    if (!ab || !ab.ready() || (ab.isItem ? this.isMuted() : this.isSilenced())) { this.order = ORDER.NONE; return; }
    const t = this.orderTarget;
    if (t && !t.alive) { this.order = ORDER.NONE; return; }
    const range = ab.castRange();
    if (range > 0) {
      const tx = t ? t.x : this.orderX; const ty = t ? t.y : this.orderY;
      const dx = tx - this.x; const dy = ty - this.y;
      if (dx * dx + dy * dy > range * range + 1e-6) { this.stepToward(tx, ty, range - 1, dt); return; }
    }
    this.winding = false;
    this.castAb = ab; this.castTarget = t; this.castX = t ? t.x : this.orderX; this.castY = t ? t.y : this.orderY;
    this.castEnd = time + ab.castPoint();
    this.order = ORDER.NONE;
    if (time + EPS >= this.castEnd) this.finishCast();
  }

  finishCast() {
    const ab = this.castAb; const t = this.castTarget; const w = this.world;
    this.castAb = null;
    if (!ab || !ab.ready()) return;
    // [L] since the debuff-immunity rework a unit-target spell can be cast on a debuff-immune enemy (measured with Frostbite,
    // Battle Hunger, Hex, Mana Drain, Laguna Blade, Arc Lightning on a Black King Bar target): mana and cooldown are spent, its
    // magical damage lands, its debuffs do not take hold (addModifier refuses them) and pure damage is 0. The controller still
    // does not choose such casts by itself.
    if (t && (!t.alive || (t.team !== this.team && !t.targetable()))) return;
    ab.pay();
    ab.startCooldown();
    ab.casts++; this.mCasts++;
    if (w.log) w.logEvent('cast', this, t, ab.name, 0);
    let blocked = false;
    const sc = ab.script;
    // abilities flagged noBlock and the actives of neutral items cannot be blocked or reflected
    if (t && t.team !== this.team && !(sc && sc.noBlock) && !(ab.isItem && ab.def.artifact)) {
      const hs = t.hooks.onSpellTargeted;
      if (hs.length) { const ev = { ability: ab, caster: this, target: t, blocked: false }; fire(hs, 'onSpellTargeted', ev); blocked = ev.blocked; }
    }
    if (!blocked && sc && sc.cast) sc.cast(ab, t, this.castX, this.castY);
    const hc = this.hooks.onCast;
    if (hc.length) fire(hc, 'onCast', { ability: ab, target: t, caster: this });
    w.fireAll('onAnyCast', { ability: ab, target: t, caster: this });
    if (sc && sc.channel && !blocked) {
      const dur = typeof sc.channel === 'function' ? sc.channel(ab) : ab.v('AbilityChannelTime');
      if (dur > 0) { this.channelAb = ab; this.channelEnd = w.time + dur; }
    }
  }

  endChannel(interrupted) {
    const ab = this.channelAb;
    this.channelAb = null;
    if (ab && ab.script && ab.script.channelEnd) ab.script.channelEnd(ab, interrupted);
  }
}

// attribute growth of a hero at `level`, accumulated the way the game does it: single precision, one addition per level
const F32_CACHE = new WeakMap();
function levelGrowthF32(bs, level) {
  let t = F32_CACHE.get(bs);
  if (!t) { t = []; F32_CACHE.set(bs, t); }
  let r = t[level];
  if (!r) {
    const f = Math.fround;
    let a = f(bs.str); let b = f(bs.agi); let c = f(bs.int);
    const ga = f(bs.strGain); const gb = f(bs.agiGain); const gc = f(bs.intGain);
    for (let i = 1; i < level; i++) { a = f(a + ga); b = f(b + gb); c = f(c + gc); }
    r = t[level] = [a, b, c];
  }
  return r;
}
const valBase = (e) => (e === undefined ? undefined : Array.isArray(e) ? e[0] : e.v[0]);
// level of an ability that follows another one. With `depBonus`, an ability whose shipped MaxLevel exceeds its parent's is one level
// ahead of it (four-level innates that grow with a three-level ultimate).
function followLevel(a, p, floor, depBonus) {
  let n = p.level;
  if (depBonus && a.def.maxLevel !== undefined && a.def.maxLevel > p.maxLevel) n++;
  if (n > a.maxLevel) n = a.maxLevel;
  return n < floor ? floor : n;
}
const maxLen = (vals) => { let n = 1; for (const k in vals) { const e = vals[k]; const a = Array.isArray(e) ? e : e.v; if (a.length > n && k !== 'value') n = a.length; } return n; };
const rank = (prio, name) => { const i = prio.indexOf(name); return i < 0 ? 99 : i; };
// innate abilities with several levels follow the ultimate's unlock levels (6/12/18) in the shipped data
const innateLevel = (d, L) => 1 + (L >= 6 ? 1 : 0) + (L >= 12 ? 1 : 0) + (L >= 18 ? 1 : 0);

const TALENT_FAMILIES = [
  ['special_bonus_hp_regen_', 'hpRegen'], ['special_bonus_mp_regen_', 'manaRegen'], ['special_bonus_hp_', 'hp'], ['special_bonus_mp_', 'mana'],
  ['special_bonus_all_stats_', 'all'], ['special_bonus_strength_', 'str'], ['special_bonus_agility_', 'agi'], ['special_bonus_intelligence_', 'int'],
  ['special_bonus_movement_speed_', 'ms'], ['special_bonus_armor_', 'armor'], ['special_bonus_attack_base_damage_', 'dmgBase'],
  ['special_bonus_attack_damage_', 'dmg'], ['special_bonus_attack_speed_', 'as'], ['special_bonus_attack_range_', 'attackRange'],
  ['special_bonus_magic_resistance_', 'mr'], ['special_bonus_spell_lifesteal_', 'spellLifesteal'], ['special_bonus_lifesteal_', 'lifesteal'],
  ['special_bonus_spell_aoe_', 'aoe'], ['special_bonus_evasion_', 'evasion'], ['special_bonus_cast_range_', 'castRange'],
  ['special_bonus_mana_reduction_', 'manaCostRed'], ['special_bonus_spell_amplify_', 'spellAmp'], ['special_bonus_cooldown_reduction_', 'cdr'],
  ['special_bonus_status_resistance_', 'statusRes'],
];
function talentFamily(name) {
  if (name.startsWith('special_bonus_unique')) return null;
  for (const [p, k] of TALENT_FAMILIES) if (name.startsWith(p)) return k;
  return null;
}
function applyTalentStat(s, key, v) {
  switch (key) {
    case 'all': s.str += v; s.agi += v; s.int += v; break;
    case 'mr': s.mrMul *= 1 - v / 100; break;
    case 'evasion': s.evasionMul *= 1 - v / 100; break;
    case 'cdr': s.cdrMul *= 1 - v / 100; break;
    case 'statusRes': s.statusResMul *= 1 - v / 100; break;
    default: s[key] += v;
  }
}

// ------------------------------------------------------------------ world
export class World {
  constructor(data, opts = {}) {
    this.data = data;
    this.dt = opts.tick || C.TICK;
    this.tickN = 0;
    this.time = 0;
    this.rng = new Rng(opts.seed ?? 1);
    this.units = [];
    this.nextId = 1;
    this.projectiles = [];
    this.timers = [];
    this.regen = opts.regen !== false;
    this.freeSpells = !!opts.freeSpells;
    this.isDay = opts.day !== false;
    this.detectAll = opts.detectAll !== false; // invisibility does not hide units unless turned off
    this.skillshotHit = opts.skillshotHit ?? 1;
    this.log = opts.log ? [] : null;
    this.logLimit = opts.logLimit || 5000;
    this.tmpRec = new AttackRec();
    this.dmgPool = [];
    this.dmgDepth = 0;
    this.onDeath = null;
    this.warnings = new Set();
    this.gameTime = opts.gameTime || 0;   // match clock in seconds at the start of the fight (creep and Roshan growth)
    // rules.fresh: units start as if they had just appeared (stacks that build up over time start at zero); the default is a hero
    // that has been around for a while (Bladeform, Necromastery ... already built up)
    this.fresh = !!opts.fresh;
  }

  // switch day / night; stats that depend on the time of day are recomputed
  setDay(isDay) { isDay = !!isDay; if (isDay === this.isDay) return; this.isDay = isDay; const us = this.units; for (let i = 0; i < us.length; i++) us[i].dirty = true; }

  logEvent(type, a, b, what, value) {
    const L = this.log;
    if (L.length >= this.logLimit) return;
    L.push({ t: Math.round(this.time * 1000) / 1000, e: type, a: a ? a.tag || a.name : null, b: b ? b.tag || b.name : null, w: what, v: typeof value === 'number' ? Math.round(value * 100) / 100 : value });
  }

  unitDef(name) {
    const d = this.data;
    return d.heroes[name] || d.units[name] || d.heroes['npc_dota_hero_' + name] || d.units['npc_dota_' + name] || null;
  }

  spawn(name, team, opts = {}) {
    const def = this.unitDef(name);
    if (!def) throw new Error(`unknown unit: ${name}`);
    const u = new Unit(this, def, team);
    if (opts.illusion) u.isIllusion = true;
    u.id = this.nextId++;
    u.tag = opts.tag || null;
    u.x = opts.x || 0; u.y = opts.y || 0;
    if (opts.ovr) u.ovr = opts.ovr;
    if (def.baseClass && /tower|building|fort|barracks|fountain|effigy/.test(def.baseClass)) u.isBuilding = true;
    this.units.push(u);
    const abNames = def.abilities || [];
    for (const an of abNames) { if (this.data.abilities[an]) u.addAbility(an, 0); }
    if (u.isHero) u.setLevel(opts.level || 1, { skills: opts.skills, prio: opts.prio });
    else {
      if (opts.level) u.level = opts.level;
      // jungle creeps: abilities are level 1 / 2 / 3 from 0:00 / 15:00 / 30:00 game time (7.33 patch notes)
      let al = opts.abilityLevel || 1;
      if (!opts.abilityLevel && this.gameTime > 0 && abNames.includes('neutral_upgrade')) al = 1 + (this.gameTime >= C.NEUTRAL_ABILITY_LEVEL_TIMES[0] ? 1 : 0) + (this.gameTime >= C.NEUTRAL_ABILITY_LEVEL_TIMES[1] ? 1 : 0);
      for (const a of u.abilities) a.setLevel(a.name === 'neutral_upgrade' ? 1 : al);
    }
    u.recompute();
    u.hp = u.maxHp; u.mana = u.maxMana;
    if (this.log) this.logEvent('spawn', u, null, def.name, team);
    return u;
  }

  after(delay, fn) { this.timers.push({ t: this.time + delay, fn }); }

  // Illusion of `src`: same level, stats and items; passives only where a script opts in (script.illusion).
  createIllusion(src, o = {}) {
    const skills = {};
    for (const a of src.abilities) skills[a.name] = a.level;
    const u = this.spawn(src.name, o.team ?? src.team, { x: o.x ?? src.x + 60, y: o.y ?? src.y + 60, level: src.level, skills, illusion: true, ovr: src.ovr || undefined, tag: `${src.tag || src.name}~i${this.nextId}` });
    u.isSummon = true; u.owner = o.owner || src.owner || src; u.counts = false;
    u.attrLevels = src.attrLevels; u.hasScepter = src.hasScepter; u.hasShard = src.hasShard;
    if (src.talents.size) u.setTalents([...src.talents]);
    else if (src.hasScepter || src.hasShard) for (const a of u.abilities) { a.refresh(); a.syncMods(); }
    for (const it of src.items) { const n = u.addItem(it.name, { level: it.level, slot: it.slot, attr: it.attr }); if (n) n.ai = false; }
    u.basePotency = o.potency ?? C.ILLUSION_ITEM_POTENCY;
    u.addModifier('modifier_illusion', { duration: o.duration, data: { out: o.outPct ?? -67, inc: o.inPct ?? 200 } });
    u.recompute();
    u.hp = Math.max(1, u.maxHp * (src.hp / src.maxHp)); u.mana = u.maxMana * (src.maxMana > 0 ? src.mana / src.maxMana : 0);
    if (o.duration) u.lifeEnd = this.time + o.duration;
    if (this.makeAI) { u.ai = this.makeAI('attack'); if (o.target) u.ai.fixedTarget = o.target; }
    if (o.invulnerable) u.addModifier('modifier_invulnerable', {});
    return u;
  }

  // Summoned unit owned by `owner` (does not count for win conditions).
  summon(owner, name, o = {}) {
    const u = this.spawn(name, owner.team, { x: o.x ?? owner.x + 80, y: o.y ?? owner.y, level: o.level, ovr: o.ovr, abilityLevel: o.abilityLevel, tag: `${owner.tag || owner.name}~${name.replace('npc_dota_', '')}${this.nextId}` });
    u.isSummon = true; u.owner = owner; u.counts = false;
    if (o.duration) u.lifeEnd = this.time + o.duration;
    if (this.makeAI) u.ai = this.makeAI(o.ai || 'attack');
    return u;
  }

  // ---------------------------------------------------------------- queries
  enemiesOf(u, out = []) { const us = this.units; for (let i = 0; i < us.length; i++) { const o = us[i]; if (o.alive && o.team !== u.team) out.push(o); } return out; }
  alliesOf(u, out = []) { const us = this.units; for (let i = 0; i < us.length; i++) { const o = us[i]; if (o.alive && o.team === u.team) out.push(o); } return out; }
  // units of `team` (or not of team when `not` is true) whose centre is within radius of (x, y)
  // [L] An area reaches the edge of a unit's body: a unit is inside when its centre is within radius + its collision radius
  // (measured in Hero Demo with Crystal Nova and Berserker's Call: the dummy, hull 24, is hit 12 beyond the radius, not 40).
  inRadius(x, y, r, team, not = false, out = []) {
    const us = this.units;
    for (let i = 0; i < us.length; i++) {
      const o = us[i];
      if (!o.alive || o.st[ST.OUT] > 0) continue;
      if (not ? o.team === team : o.team !== team) continue;
      const dx = o.x - x; const dy = o.y - y; const rr = r + o.def.hull;
      if (dx * dx + dy * dy <= rr * rr) out.push(o);
    }
    return out;
  }
  // the radius is used as given: area bonuses are already inside the ability values the game scales (see Ability.v)
  enemiesInRadius(u, x, y, r) { return this.inRadius(x, y, r, u.team, true); }
  alliesInRadius(u, x, y, r) { return this.inRadius(x, y, r, u.team, false); }
  nearestEnemy(u, maxDist = Infinity) {
    let best = null; let bd = maxDist * maxDist;
    const us = this.units;
    for (let i = 0; i < us.length; i++) {
      const o = us[i];
      if (!o.alive || o.team === u.team || !o.attackableBy(u)) continue;
      const dx = o.x - u.x; const dy = o.y - u.y; const d = dx * dx + dy * dy;
      if (d < bd) { bd = d; best = o; }
    }
    return best;
  }

  // ---------------------------------------------------------------- attacks
  launchAttack(a, t, opts = null) {
    if (a.dirty) a.recompute();
    const rec = new AttackRec();
    rec.attacker = a; rec.target = t;
    rec.ranged = !a.melee;
    rec.potency = a.itemPotency;
    const lo = Math.ceil(a.dmgMin - 1e-9); const hi = Math.floor(a.dmgMax + 1e-9);
    const frac = a.dmgMin - Math.floor(a.dmgMin + 1e-9);
    rec.white = (hi > lo ? this.rng.int(Math.floor(a.dmgMin + 1e-9), Math.floor(a.dmgMax + 1e-9)) + frac : a.dmgMin);
    rec.green = a.dmgBonus;
    if (opts) { if (opts.secondary) rec.secondary = true; if (opts.fromAbility) rec.fromAbility = opts.fromAbility; if (opts.potency !== undefined) rec.potency = opts.potency; if (opts.mult !== undefined) rec.mult = opts.mult; if (opts.flat !== undefined) rec.flat = opts.flat; if (opts.trueStrike) rec.trueStrike = true; if (opts.add !== undefined) rec.add = opts.add; }
    a.mAttacks++;
    if (!rec.secondary) fire(a.hooks.onAttack, 'onAttack', rec);
    if (rec.ranged && a.projSpeed > 0 && !(opts && opts.instant)) {
      this.projectiles.push({ kind: 0, rec, x: a.x, y: a.y, speed: a.projSpeed, target: t, fn: null });
    } else this.landAttack(rec);
    return rec;
  }

  landAttack(rec) {
    const a = rec.attacker; const t = rec.target;
    if (!t.alive || t.st[ST.OUT] > 0 || t.st[ST.INVULN] > 0 || t.st[ST.ETHEREAL] > 0) return;
    if (t.dirty) t.recompute();
    const hp = t.hooks.onPreAttacked;
    if (hp.length) { fire(hp, 'onPreAttacked', rec); if (rec.cancel) return; }
    // evasion / blind (pseudo-random), negated by true strike
    if (!rec.trueStrike && a.st[ST.TRUESTRIKE] === 0) {
      const missChance = 1 - (1 - t.evasion) * (1 - a.miss);
      if (missChance > 1e-9) {
        const c = prdC(missChance * 100);
        if (this.rng.next() < c * (a.prdMissN + 1)) {
          a.prdMissN = 0; rec.missed = true; a.mMisses++;
          if (this.log) this.logEvent('miss', a, t, '', 0);
          fire(a.hooks.onAttackMiss, 'onAttackMiss', rec);
          return;
        }
        a.prdMissN++;
      }
    }
    let dmg = ((rec.white + rec.green + rec.flat) * rec.crit * rec.mult + rec.add) * a.dmgOutMul;
    if (dmg < 0) dmg = 0;
    rec.damage = dmg;
    if (rec.crit > 1) a.mCrits++;
    a.mHits++;
    rec.dealt = this.damage(a, t, dmg, PHYSICAL, F_ATTACK | (rec.secondary ? F_SECONDARY : 0) | (rec.noLifesteal ? F_NO_LIFESTEAL : 0), rec.fromAbility, rec);
    if (!rec.secondary) {
      fire(a.hooks.onAttackLanded, 'onAttackLanded', rec);
      if (t.alive) fire(t.hooks.onAttacked, 'onAttacked', rec);
    }
  }

  // ---------------------------------------------------------------- damage
  damage(src, dst, amount, type, flags = 0, ability = null, rec = null) {
    if (!dst.alive || amount <= 0) return 0;
    const st = dst.st;
    const hpLoss = (flags & F_HP_LOSS) !== 0;
    if (!hpLoss) {
      if (st[ST.INVULN] > 0 || st[ST.OUT] > 0) return 0;
      if (type === PHYSICAL && st[ST.ETHEREAL] > 0) return 0;
      if (type === PURE && st[ST.IMMUNE] > 0 && !(flags & F_PIERCE) && !(ability && ability.pierces)) return 0;
      if ((flags & F_REFLECT) && st[ST.IMMUNE] > 0) return 0;
    }
    if (dst.dirty) dst.recompute();
    const d = this.dmgDepth < this.dmgPool.length ? this.dmgPool[this.dmgDepth] : (this.dmgPool[this.dmgDepth] = new DamageEvent());
    this.dmgDepth++;
    d.src = src; d.dst = dst; d.amount = amount; d.type = type; d.flags = flags; d.ability = ability; d.original = amount; d.dealt = 0; d.rec = rec;
    if (!hpLoss) {
      if (src) {
        if (src.dirty) src.recompute();
        if (!(flags & (F_ATTACK | F_NO_AMP)) && src.spellAmp !== 0) d.amount *= 1 + src.spellAmp / 100;
        const ho = src.hooks.outgoing;
        if (ho.length) fire(ho, 'outgoing', d);
      }
      const hpre = dst.hooks.preMit;
      if (hpre.length) fire(hpre, 'preMit', d);
      if (d.amount > 0) {
        if (d.type === PHYSICAL) d.amount *= ((flags & F_NO_ARMOR) ? 1 : C.armorMult(rec !== null && rec.pierceArmor !== 0 ? dst.armor - rec.pierceArmor : dst.armor)) * dst.physTakenMul;
        else if (d.type === MAGICAL) d.amount *= (1 - dst.mr) * dst.magicTakenMul;
        d.amount *= dst.dmgTakenMul;
        const hpost = dst.hooks.postMit;
        if (hpost.length) fire(hpost, 'postMit', d);
      }
    }
    let a = d.amount;
    if (a > 0) {
      if ((flags & F_NON_LETHAL) && a >= dst.hp) a = dst.hp - 1;
      if (a > 0) {
        d.dealt = a;
        dst.hp -= a;
        dst.mTaken += a;
        if (src && !hpLoss && (src.heroLike || src.isRoshan) && src.team !== dst.team) dst.lastHurt = this.time;
        if (src && src !== dst) {
          const cr = src.isSummon && src.owner !== null ? src.owner : src; // summons and illusions credit their owner
          cr.mDealt += a;
          if (d.type === PHYSICAL) cr.mPhys += a; else if (d.type === MAGICAL) cr.mMagic += a; else cr.mPure += a;
          if (dst.isHero) cr.mHeroDealt += a;
        }
        if (this.log) this.logEvent('dmg', src, dst, (ability ? ability.name : (flags & F_ATTACK) ? 'attack' : '') + (rec && rec.crit > 1 ? ' (crit)' : ''), a);
        if (src && src.alive && src !== dst && !(flags & (F_NO_LIFESTEAL | F_REFLECT | F_HP_LOSS))) {
          // lifesteal: attacks use lifesteal, everything else uses spell lifesteal (both weaker against creeps)
          if (flags & F_ATTACK) {
            if (src.lifesteal > 0 && !(flags & F_SECONDARY) && !dst.isBuilding) src.heal(a * (src.lifesteal / 100) * (1 + src.lifestealAmp / 100) * (dst.heroLike ? 1 : 0.6), src, null, true);
          } else if (src.spellLifesteal > 0 && !dst.isBuilding) src.heal(a * (src.spellLifesteal / 100) * (1 + src.lifestealAmp / 100) * (dst.heroLike ? 1 : 0.2), src, null, true);
        }
        if (src) { const hd = src.hooks.onDealDamage; if (hd.length) fire(hd, 'onDealDamage', d); }
        const ht = dst.hooks.onTakeDamage;
        if (ht.length) fire(ht, 'onTakeDamage', d);
        if (dst.hp <= 0 && dst.alive) this.kill(dst, src, ability);
      }
    }
    const dealt = d.dealt;
    this.dmgDepth--;
    return dealt;
  }

  kill(u, killer, ability, silent = false) {
    if (!u.alive) return;
    if (!silent) {
      if (u.st[ST.CANNOT_DIE] > 0) { u.hp = 1; return; }
      const hd = u.hooks.onDeath;
      if (hd.length) { const ev = { victim: u, killer, ability, prevent: false }; fire(hd, 'onDeath', ev); if (ev.prevent) { if (u.hp < 1) u.hp = 1; return; } }
    }
    u.alive = false; u.hp = 0; u.deathTime = this.time;
    u.winding = false; u.castAb = null; u.channelAb = null; u.order = ORDER.NONE;
    for (let i = u.mods.length - 1; i >= 0; i--) { const m = u.mods[i]; if (m && !m.def.allowDead) u.removeModifier(m); }
    if (this.log) this.logEvent('death', killer, u, ability ? ability.name : '', 0);
    if (killer && killer !== u && !silent) { killer.mKills++; const hk = killer.hooks.onKill; if (hk.length) fire(hk, 'onKill', { victim: u, killer, ability }); }
    if (this.onDeath) this.onDeath(u, killer);
    this.fireAll('onAnyDeath', { victim: u, killer, ability });
  }

  // fires a hook on every living unit that listens to it (used for rare global events)
  fireAll(hook, ev) {
    const us = this.units;
    for (let i = 0; i < us.length; i++) { const o = us[i]; if (o.alive && o.hooks[hook].length) fire(o.hooks[hook], hook, ev); }
  }

  // ---------------------------------------------------------------- projectiles / timers
  // tracking projectile that calls fn(target) on arrival
  projectile(src, target, speed, fn) { this.projectiles.push({ kind: 1, rec: null, x: src.x, y: src.y, speed, target, fn }); }

  updateProjectiles(dt) {
    const ps = this.projectiles;
    for (let i = 0; i < ps.length; i++) {
      const p = ps[i];
      const t = p.target;
      if (!t.alive) { ps[i] = ps[ps.length - 1]; ps.pop(); i--; continue; }
      const dx = t.x - p.x; const dy = t.y - p.y;
      const d = Math.sqrt(dx * dx + dy * dy);
      const step = p.speed * dt;
      if (d <= step + t.def.hull) {
        ps[i] = ps[ps.length - 1]; ps.pop(); i--;
        if (p.kind === 0) this.landAttack(p.rec); else p.fn(t);
      } else { p.x += (dx / d) * step; p.y += (dy / d) * step; }
    }
  }

  tick() {
    const time = this.time; const dt = this.dt;
    const ts = this.timers;
    if (ts.length) {
      for (let i = 0; i < ts.length; i++) {
        const t = ts[i];
        if (t.t <= time + EPS) { ts[i] = ts[ts.length - 1]; ts.pop(); i--; t.fn(); }
      }
    }
    const us = this.units;
    for (let i = 0; i < us.length; i++) { const u = us[i]; if (u.alive) u.update(time, dt); }
    if (this.projectiles.length) this.updateProjectiles(dt);
    this.tickN++;
    this.time = this.tickN * dt;
  }

  run(seconds, stopFn = null) {
    const n = Math.round(seconds / this.dt);
    for (let i = 0; i < n; i++) { this.tick(); if (stopFn !== null && stopFn(this)) return true; }
    return false;
  }

  warn(msg) { this.warnings.add(msg); }
}

export { fire, AttackRec };
