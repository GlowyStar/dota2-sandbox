# Assignment, wave 2: the heroes / items / units wave 1 did not reach

Same task, tools and rules as `docs/assignments/LIVE_WAVE1.md` (read it, then `docs/LIVE_VERIFICATION.md` and `docs/AUTHORING.md`).
Wave 1 already worked on parts of your file: leave the heroes that are not on your list alone unless a shared helper you change
affects them (then re-run their comparison too).

## Changed since wave 1 (engine and recorder)

- **Areas reach the edge of a unit's body [L]:** `enemiesNear`, `alliesNear` and `world.inRadius` now count a unit as inside when
  its centre is within radius + its collision radius (`e.def.hull`). Do not add the hull again for plain area checks.
- **Cleave is reduced by armor [L]** (the `cleave()` helper does it). Battle Fury picks its percentage by the attacked unit.
- **Movement speed:** a cap (`msCap`) may go below the 100 floor; for speed 0 without the root state use `msCap: 0.01`.
- **The simulator's target dummy cannot die** and is back at full health one tick after any damage, like the live one.
- **Recorder version 3:** abilities and talents are learned through `UpgradeAbility` (as a player does), talent charges are
  refreshed after 0.1 s, autocast of attack modifiers is switched on. All recordings were re-recorded with it.

## Patterns wave 1 measured in the game (check your abilities against them first)

These held for many abilities; they are not universal, so confirm in your scenes before relying on one.

- **Damage over time:** the first tick usually lands on application (Battle Hunger, Enfeeble, Fiend's Grip, Doom, Cold Feet,
  Poison Touch, Ignite, Noxious Plague, Rain of Destiny), which gives `duration / interval + 1` ticks; some also tick on expiry
  (Flux). Others start one interval later (Searing Chains, Poison Sting, Scorched Earth). Some tick at a different interval than
  the data says (Magnetize 0.5 s, Bloodrage cost 0.75 s, Permanent Immolation 0.5 s for half the value, Heartstopper 0.2 s).
- **Intervals are whole server ticks:** a period that is not a multiple of 1/30 s is rounded up (0.55 s becomes 0.567 s).
- **Lingering auras:** a debuff from an aura usually stays 0.5 s after the unit leaves (Ice Vortex, Insatiable Hunger, Crippling
  Fear, Heartstopper, Immolation, Dying Light, Supernova).
- **Separate instances:** bonus damage of orbs and procs is its own damage instance landing just before the attack's damage
  (Wyrm's Wrath, Desolate, Predator, Backstab, Pack Hunter, Ransack, Rip Tide, Berserker's Rage maim); health costs of some
  abilities are a damage instance on the caster (Death Coil, Demonic Summoning).
- **Transformations** stun the hero for `transformation_time` before the new form (Chemical Rage, Pierce the Veil, Metamorphosis,
  True Form, Shapeshift, Wolf Bite).
- **Disables carry more states than the tooltip says:** fear also silences, disarms and mutes; sleeps also root and disarm;
  several "knockbacks" are not stuns while others are (check the state list in the recording).
- **Refused orders:** when the ability has nothing valid to act on (no target to convert, no trees, nothing to devour, a point
  too close), the game refuses the order: no mana, no cooldown. Model the refusal (give mana and cooldown back if needed).
- **Fresh scenes:** a hero appears with nothing accumulated: no persuaded creep, no Invoker orbs, no bear, no stacks.
- **Rounding:** many derived amounts are whole numbers (mana burn damage, crit multipliers, slows in whole percent, health
  costs): check the recorded values for decimals.
- **Not modelled by the engine (say so, don't fake it):** facing, vision, trees, terrain, an attack-immune state that does not
  disarm (the engine's `ETHEREAL` also disarms), vector targeting, alt-cast, cast speed.

## Budget

The token budget is tight. Fix the differences that change numbers first (damage values, number of instances, durations,
cooldowns, mana, stats), and leave position / projectile-travel differences for last. Don't re-read large files, and print only
the events you need. After about 35 tool calls, or when the high-score differences are handled, stop. Make sure `node --check`
and `node tools/hero_check.mjs <your heroes>` (items / units: `node tools/unit_check.mjs`) pass, then write the report.
