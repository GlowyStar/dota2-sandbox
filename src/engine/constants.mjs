// Engine constants. Each carries the evidence it rests on (see EVIDENCE.md):
//   [K] shipped KeyValues data, [F] fitted against Valve datafeed (all 127 heroes, zero residual),
//   [P] shipped patch notes text, [W] long-standing public knowledge not verifiable from shipped data here,
//   [A] simulator assumption / simplification.

export const TICK = 1 / 30;                 // [W] server simulation rate (30 Hz)

// --- attributes -> derived stats
export const HP_PER_STR = 20;               // [F][P 7.42 "decreased from 22 to 20"]
export const HP_REGEN_PER_STR = 0.1;        // [F]
export const MANA_PER_INT = 12;             // [F]
export const MANA_REGEN_PER_INT = 0.05;     // [F]
export const ARMOR_PER_AGI = 1 / 6;         // [F]
export const AS_PER_AGI = 1;                // [W]
export const MR_PER_INT = 0.00125;          // [P 7.42 "increased from 0.1% to 0.125%"] added to base magic resistance
export const DMG_PER_PRIMARY = 1;           // [F] 104 non-universal heroes
export const DMG_PER_ATTR_UNIVERSAL = 0.45; // [P 7.38 "decreased from 0.7 to 0.45"]; datafeed omits it, so not fit-checked

// --- combat
export const ARMOR_FACTOR = 0.06;           // [P 7.27 "Armor * 0.06 / (1 + Armor * 0.06)"]
export const AS_MIN = 20;                   // [W]
export const AS_MAX = 700;                  // [W]
export const MS_MIN = 100;                  // [W]
export const MS_MAX = 550;                  // [W]
export const MELEE_RANGE_BUFFER = 0;        // [A]
export const ATTRIBUTE_BONUS_LEVELS = [15, 16, 17, 19, 20, 21, 22]; // [A] standard build order; +2 all per level [K special_bonus_attributes]
export const MAX_LEVEL = 30;                // [P]
export const DEFAULT_ITEM_POTENCY = 100;    // [P 7.42]
export const ILLUSION_ITEM_POTENCY = 20;    // [P 7.42]

// damage types
export const PHYSICAL = 1;
export const MAGICAL = 2;
export const PURE = 4;
export const DMG_TYPE = { physical: PHYSICAL, magical: MAGICAL, pure: PURE };
export const DMG_NAME = { 1: 'physical', 2: 'magical', 4: 'pure' };

// damage flags
export const F_ATTACK = 1;        // damage of a regular attack
export const F_NO_AMP = 2;        // not affected by spell amplification
export const F_REFLECT = 4;       // reflected damage (does not trigger reflection again)
export const F_HP_LOSS = 8;       // direct health removal: ignores every reduction, cannot be blocked
export const F_NO_LIFESTEAL = 16;
export const F_NON_LETHAL = 32;
export const F_SECONDARY = 64;    // cleave/splash/bounce: no on-hit procs
export const F_PIERCE = 128;      // pierces debuff immunity
export const F_NO_ARMOR = 256;    // physical damage that ignores the armor value (cleave)

export function armorMult(armor) {          // fraction of physical damage that gets through
  return 1 - (ARMOR_FACTOR * armor) / (1 + ARMOR_FACTOR * Math.abs(armor));
}

export const TALENT_LEVELS = [10, 15, 20, 25, 27, 28, 29, 30]; // [K] hero levels whose point goes to a talent (27-30 grant the remaining ones)
export const CHARGE_LOCKOUT_MAX = 1;        // [L] a cooldown up to this many seconds on a charge ability is the pause between uses (live: 0.25, 0.5, 1)
export const CHARGE_LOCKOUT_DEFAULT = 0;    // [L] with charges the game reports no cooldown when the shipped one belongs to the ability without charges
export const NEUTRAL_ABILITY_LEVEL_TIMES = [15 * 60, 30 * 60]; // [P 7.33] neutral creep abilities reach level 2 / 3 at these game times
