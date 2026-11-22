# Authoring ability and item scripts

Everything you need to script abilities without reading the engine source. Working examples: `src/scripts/heroes_1.mjs` .. `heroes_4.mjs`, `items.mjs`, `units.mjs`.

## Ground rules

1. **Numbers come from the data, never from memory.** Read every number with `ab.v('value_name')` / `m.v('value_name')`.
   The only literals allowed are structural (tick intervals you choose, geometry approximations) and must be explained in `note`.
2. **Behaviour comes from the current tooltip text** (patch 7.42), not from what you remember about older patches. Facets were removed from the game: ignore them.
3. **Do not guess.** If the tooltip does not say how something works, model the part that is clear and state the gap in `note`.
   An honest `partial` is worth more than a confident invention.
4. **Edit only the file(s) you were assigned.** Never edit `src/engine/*`, other script files, `index.mjs`, tests or data.
   If the engine lacks something, approximate inside your script and report the gap.
5. **Unique names.** Every modifier name must start with `modifier_<ability_name>`. `passive('X', ...)` already creates a modifier
   named `modifier_X`, so a debuff of that ability must use a suffix: `modifier_X_debuff`, `_buff`, `_active`, `_slow`, `_stack`...
   Registering the same ability or modifier name twice throws at load time.
6. Every ability of your heroes (the list printed by the digest, including Scepter/Shard-granted ones) must be registered:
   either scripted or explicitly marked `fid: 'n/a'` with a reason.

## Looking at the data

```
node tools/digest.mjs <hero> [<hero>...]          compact: values per level, talents {T..}, Scepter {SC..}, Shard {SH..}, tooltip
DESC=900 node tools/digest.mjs <hero>             same with long tooltips
node src/cli.mjs describe <ability or item>       full JSON: values, tooltip, notes, scepter/shard text
node src/cli.mjs describe <hero>                  hero stats, ability list, talents with index
```

Value notation in the digest: `damage=100/150/200{T+50}{SC+100}{SH=1}(+2/lvl)` = per-level base, talent modifier, Scepter and Shard
modifiers, per-hero-level growth. `ab.v('damage')` already applies all of them for the current owner. Standard names:
`AbilityCooldown AbilityManaCost AbilityCastRange AbilityCastPoint AbilityChannelTime AbilityDuration AbilityDamage AbilityCharges AbilityChargeRestoreTime AbilityHealthCost`
(shown as `ACooldown` etc. in the digest). Cooldown, mana cost, cast range, cast point and charges are handled by the engine.

Talents that only change a value need no code. A talent that changes behaviour ("X pierces immunity") usually appears as a 0/1
value on the ability (`pierces_immunity=0{T=1}`); otherwise test `u.talents.has('special_bonus_unique_...')`.
Scepter/Shard: `u.hasScepter`, `u.hasShard`; abilities granted by them (`bySC` / `bySH` in the digest) are level 0 until the owner has the upgrade.

## Registration (import from `../engine/dsl.mjs`)

```js
import { defAbility, modifier, buff, debuff, passive, nuke, selfBuff, val, neg, hit, addMod, stun, silence, root, disarm, fear, taunt, hex,
  healUnit, enemiesNear, alliesNear, enemiesInLine, lineFromCaster, knockback, mhit, critHook, bashHook, orbHooks, dot, aura, zone, chain,
  cleave, barrier, giveBarrier, extraAttack, summon, gapAI, lowHpAI, nearAI, ST, C, PHYSICAL, MAGICAL, PURE,
  F_ATTACK, F_NO_AMP, F_REFLECT, F_HP_LOSS, F_NO_LIFESTEAL, F_NON_LETHAL, F_SECONDARY, F_PIERCE, F_NO_ARMOR } from '../engine/dsl.mjs';
```

### `defAbility(name, script)`

| field | meaning |
|---|---|
| `cast(ab, target, x, y)` | runs when the cast point completes (mana and cooldown already paid). `target` is a Unit or null; `x,y` the point (target position for unit casts) |
| `mods: ['modifier_a', ...]` | intrinsic modifiers kept on the owner while the ability level > 0 (passive part) |
| `ai(ab, u, t, w)` | controller decision. `t` = current enemy target (may be null). Return `null` (do not cast), `true` (cast with automatic targeting), or `{ target }` / `{ x, y }` |
| `cond(ab, u, t, w)` | simpler alternative to `ai`: boolean gate in front of automatic targeting |
| `prio` | cast order, higher first (disables ~80-95, nukes ~50-70, fillers ~30, gap closers 100) |
| `manual: true` | never auto-cast unless the scenario lists it explicitly |
| `radius` | for no-target abilities: value name or number; auto-cast only when the target is inside |
| `engage: false` | no-target ability may be cast at any distance |
| `channel` | `true` (uses AbilityChannelTime) or `(ab) => seconds`: owner is locked for that long; `channelEnd(ab, interrupted)` is called at the end |
| `requires(ab)` | extra condition for intrinsic modifiers |
| `illusion: true` | intrinsic modifiers also apply on illusions of the owner |
| `fid`, `note` | fidelity (`'full'`, `'approx'`, `'partial'`, `'n/a'`) and a one-line explanation of what is simplified or missing. **Always set `fid`.** |

Automatic targeting (no `ai`): unit-target enemy spells go to the current target (skipped if it is debuff immune and the spell does not pierce),
friendly unit-target spells go to the caster, point spells to the target position, no-target spells cast when the target is within `radius`
(or near attack range when no radius is given).

### `modifier(name, def)` / `buff` (purge 'basic') / `debuff` (debuff: true)

| field | meaning |
|---|---|
| `stats` | `{ armor: 'bonus_armor', as: (m) => ..., msPct: neg('slow') }` (value name, number or function) or `(m) => ({...})` |
| `apply(m, s, u)` | low-level stats hook (s = accumulator, see stat keys) |
| `late(m, s, u)` | like apply but runs after strength/agility/intelligence are final (use `u.str`, `u.agi`, `u.int` here) |
| `dynamic: true` | stats change continuously (depend on hp, time, distance): recomputed every tick. Use sparingly |
| `state: ['STUN', ...]` | STUN SILENCE ROOT DISARM HEX MUTE BREAK INVULN IMMUNE (debuff immunity) UNTARGETABLE ETHEREAL INVIS FEAR TAUNT SLEEP OUT (removed from play) NO_HEAL TRUESTRIKE CANNOT_DIE LEASH |
| `multi` | `'refresh'` (default: one instance, duration refreshed), `'stack'` (one instance, `m.stacks` grows, see `maxStacks`), `'independent'` (separate instances), `'perCaster'` |
| `maxStacks` | number or `(m) => n` |
| `interval`, `onThink(m)` | periodic callback; `interval` number or `(m) => seconds`; `thinkNow: true` to also fire immediately |
| `onCreated(m, opts)`, `onRefresh(m, opts)`, `onDestroy(m, expired)` | lifecycle |
| `purge` | `'basic'`, `'strong'`, `'none'` (default: debuffs basic, others none) |
| `pierce: true` | applies through debuff immunity |
| `statusResist: false` | duration is not shortened by status resistance |
| `hidden: true` | not shown in logs / state |
| hooks | see below |

Hooks (all optional, `m` = this modifier, `m.parent` = unit carrying it):

| hook | fires when | notes |
|---|---|---|
| `onAttackStart(m, rec)` | parent begins an attack wind-up | |
| `onAttack(m, rec)` | parent's attack leaves (attack point) | roll crits/procs here: `rec.crit`, `rec.add`, `rec.flat`, `rec.mult`, `rec.trueStrike`, `rec.pierceArmor`, `(rec.data ||= {}).flag = m` |
| `onAttackLanded(m, rec)` | parent's attack hit (after damage) | `rec.target`, `rec.damage` (before armor), `rec.dealt` (health removed), `rec.potency` |
| `onAttackMiss(m, rec)` | parent's attack missed | |
| `onPreAttacked(m, rec)` | parent is about to be hit | set `rec.cancel = true` to negate the attack |
| `onAttacked(m, rec)` | parent was hit by an attack | `rec.attacker` |
| `outgoing(m, d)` | parent deals damage, before mitigation | change `d.amount` |
| `preMit(m, d)` | parent takes damage, before armor / magic resistance | damage block |
| `postMit(m, d)` | parent takes damage, after armor / magic resistance | % reductions, absorption, redirection |
| `onTakeDamage(m, d)` | after health was removed from parent | `d.dealt`, `d.src`, `d.type`, `d.flags`, `d.ability`, `d.original` |
| `onDealDamage(m, d)` | after parent removed health from someone | |
| `onDeath(m, ev)` | parent is about to die | set `ev.prevent = true` and restore `hp` to survive |
| `onKill(m, ev)` | parent killed `ev.victim` | |
| `onCast(m, ev)` | parent finished casting `ev.ability` (on `ev.target`) | |
| `onSpellTargeted(m, ev)` | parent is targeted by an enemy unit-target ability | set `ev.blocked = true` to negate |
| `onHealed(m, ev)` | parent was healed (`ev.amount`) | |
| `onAnyDeath(m, ev)` | any unit died (`ev.victim`, `ev.killer`) | |
| `onAnyCast(m, ev)` | any unit cast (`ev.caster`, `ev.ability`, `ev.target`) | |

`rec` damage formula at landing: `((white + green + flat) * crit * mult + add) * attacker outgoing multiplier`, then armor.
Secondary attacks (`rec.secondary`) do not run on-hit hooks.

### Stat keys

Additive: `str agi int all primary dmg` (bonus attack damage) `dmgBase` (base/white damage) `dmgBasePct` (% of base damage as bonus)
`dmgOutPct` (% total attack damage dealt) `as` (attack speed) `asSlow` (negative attack speed) `armor hp hpPct mana manaPct hpRegen hpRegenPct`
(% of max health per second) `hpRegenAmp manaRegen manaRegenPct manaRegenAmp ms` (flat) `msPct` (%, negative values are slows)
`spellAmp lifesteal spellLifesteal lifestealAmp healAmp castRange attackRange manaCostRed debuffAmp aoe projSpeed potency`
`magicTakenPct physTakenPct`.
Multiplicative (give percentages): `mr` (magic resistance, negative reduces) `evasion miss` (blind) `statusRes slowRes cdr dmgTaken` (+ = more damage taken, - = less)
`restore` (health restoration, negative reduces healing/regen/lifesteal).
Overrides: `bat` (base attack time) `msAbs` (minimum speed, haste) `msMax` (raise the cap) `msCap` (lower the cap, e.g. hex).

## Objects

**Unit `u`**: `name tag team level isHero heroLike isIllusion isSummon isBuilding owner melee alive x y hp maxHp mana maxMana str agi int armor mr` (0..1)
`evasion attackSpeed attackInterval attackRange dmgMin dmgMax dmgBonus ms spellAmp hasScepter hasShard talents` (Set) `abilities items st` (state counters, `u.st[ST.STUN] > 0`)
`world lastHurt`. Methods: `findAbility(name)`, `findModifier(name)`, `hasModifier(name)`, `addModifier(name, { caster, ability, duration, stacks, data, pierce, noResist, potency })`,
`removeModifierByName(name)`, `purge({ debuffs, buffs, strong })`, `heal(amount, src, ability)`, `giveMana(n)`, `burnMana(n)` (returns burned),
`distTo(o)`, `rangeTo(o)` (edge to edge), `jumpTo(t, maxDist)` (teleport next to t), `attack(t)`, `isImmune()`, `isSilenced()`, `isDisarmed()`,
`baseAttr('str'|'agi'|'int')`, `hpPct()`, `addAbility(name, level)`, `refreshAI()`, `recompute()`; set `u.dirty = true` after changing something stats depend on.

**Ability `ab`**: `owner name level maxLevel isItem passive pierces dmgType toggled charges cdEnd data` (free slot for script state).
Methods: `v(name, default)`, `cooldown()`, `manaCost()`, `castRange()`, `ready()`, `cdReady()` (cooldown only; use for passives with an internal cooldown),
`startCooldown(seconds?)`, `cdRemaining()`, `setLevel(n)`.

**Modifier `m`**: `parent caster ability stacks created dieTime data x y z` (three free numeric slots, start at 0) `potency`.
Methods: `v(name)`, `remove()`, `setStacks(n)`, `setDuration(seconds)`, `remaining()`, `roll(chancePct)` (pseudo-random distribution, per modifier).

**World `w = u.world`**: `time dt rng` (`rng.next()` 0..1, `rng.int(a, b)`, `rng.chance(p)`) `units isDay gameTime freeSpells skillshotHit`.
Methods: `damage(src, dst, amount, type, flags, ability)` (returns health removed), `after(seconds, fn)`, `projectile(src, target, speed, fn(target))`,
`enemiesInRadius(u, x, y, r)`, `alliesInRadius(u, x, y, r)`, `inRadius(x, y, r, team, notThisTeam)`, `nearestEnemy(u, maxDist)`,
`launchAttack(attacker, target, { instant, secondary, mult, add, flat, trueStrike, fromAbility, potency })` (returns rec),
`createIllusion(src, { duration, outPct, inPct, potency, x, y, team, owner, target, invulnerable })`,
`summon(owner, unitName, { x, y, duration, level, abilityLevel, ovr: { hp, armor, mr, dmgMin, dmgMax, ms, bat, range, hpRegen }, ai })`, `kill(u, killer, ability)`.

Damage flags: `F_ATTACK` (set by the engine) `F_NO_AMP` (no spell amp) `F_REFLECT F_HP_LOSS` (ignores everything) `F_NON_LETHAL F_NO_LIFESTEAL F_SECONDARY F_PIERCE F_NO_ARMOR`.
Debuff immunity: enemy debuffs and unit-target spells that do not pierce are blocked automatically; area damage still lands; pure damage is blocked unless the ability pierces.

## Helpers

`hit(ab, t, amount, type?, flags?)` spell damage from `ab.owner` (spell amp applied by the engine) · `mhit(m, t, amount, type?, flags?)` same from a modifier (source = `m.caster`) ·
`addMod(ab, t, name, duration, extra?)` · `stun silence root disarm fear taunt (ab, t, duration)` · `hex(ab, t, duration, moveSpeed)` · `healUnit(ab, t, amount)` ·
`enemiesNear(ab, x, y, r)` / `alliesNear` (area bonus applied) · `enemiesInLine(ab, x1, y1, x2, y2, width)` · `lineFromCaster(ab, x, y, length, width)` ·
`knockback(e, fromX, fromY, dist)` (negative pulls) · `chain(u, first, count, range, fn(e, i), delay)` · `zone(ab, x, y, { radius, duration, interval, delay, tick(e, i), allies })` ·
`cleave(attacker, target, damage, startWidth, endWidth, distance, ability)` · `barrier(name, 'all'|'physical'|'magical')` + `giveBarrier(ab, t, name, amount, duration)` ·
`dot(name, { damage, type, interval, stats, perStack })` · `aura(name, { radius, team: 'ally'|'enemy', child, self, filter, extra })` · `critHook(chance, multPct)` ·
`bashHook({ chance, stun, damage, type, cd, pierce })` · `orbHooks({ launch(m, rec), land(m, rec), free })` · `extraAttack(attacker, target, opts)` · `summon(ab, unitName, opts)` ·
AI: `gapAI(minGap)`, `lowHpAI(fraction)`, `nearAI(valueNameOrNumber, pad)` · values: `val(spec, src)`, `neg('name')`.
Generic modifiers: `modifier_stunned _silenced _rooted _disarmed _muted _break _feared _taunted _sleep _hexed _invulnerable _out_of_world _debuff_immune` (data: `{ mr }`) `_generic_slow` (data: `{ ms, as }`).

## Patterns

```js
// passive stats / crit / on-hit
passive('hero_tough_skin', { fid: 'full', stats: { armor: 'bonus_armor', mr: 'magic_resistance' } });
passive('hero_crit', { fid: 'full', onAttack: critHook('crit_chance', 'crit_mult') });
passive('hero_orb', { fid: 'full', ...orbHooks({ launch(m, rec) { rec.add += m.v('damage'); }, land(m, rec) { rec.target.addModifier('modifier_hero_orb_debuff', { caster: m.parent, ability: m.ability, duration: m.v('duration') }); } }) });

// unit-target projectile nuke with stun; area nuke around a point after a delay; self-centred pulse
nuke('hero_bolt', { fid: 'full', prio: 60, speed: 'projectile_speed', damage: 'damage', type: MAGICAL, stun: 'stun_duration' });
nuke('hero_blast', { fid: 'full', prio: 55, radius: 'radius', delay: 'delay', skillshot: true, damage: 'damage', mod: 'modifier_hero_blast_slow', modDur: 'duration' });
nuke('hero_pulse', { fid: 'full', prio: 50, center: 'self', radius: 'radius', damage: 'damage' });

// channel with periodic effect
buff('modifier_hero_storm_active', { purge: 'none', interval: 0.5, onThink(m) { for (const e of m.parent.world.enemiesInRadius(m.parent, m.parent.x, m.parent.y, m.v('radius'))) mhit(m, e, m.v('dps') * 0.5); } });
defAbility('hero_storm', { fid: 'full', prio: 70, ai: nearAI('radius', -50), channel: true,
  cast(ab) { addMod(ab, ab.owner, 'modifier_hero_storm_active', ab.v('AbilityChannelTime') - 0.01); },
  channelEnd(ab, interrupted) { if (interrupted) ab.owner.removeModifierByName('modifier_hero_storm_active'); } });

// summon (unit names are in the data: node src/cli.mjs list units <query>)
defAbility('hero_summon', { fid: 'approx', prio: 60, engage: false, ai: (ab, u, t) => (t ? true : null),
  cast(ab) { for (let i = 0; i < ab.v('count'); i++) summon(ab, 'npc_dota_some_unit', { duration: ab.v('duration'), ovr: { hp: ab.v('unit_hp'), dmgMin: ab.v('unit_damage'), dmgMax: ab.v('unit_damage') } }); } });

// survive death once
passive('hero_second_life', { fid: 'full', onDeath(m, ev) { if (!m.ability.cdReady()) return; ev.prevent = true; m.parent.hp = m.parent.maxHp * m.v('hp_pct') / 100; m.ability.startCooldown(); } });
```

## Engine rules worth knowing

These are easy to trip over; all of them are covered by `tests/run.mjs`.

Rules marked **[L]** were measured in the running game (Hero Demo, build 6983; see `docs/LIVE_VERIFICATION.md`) and are stored in
`data/live_facts.json`.

- **Skill points [L].** `Unit.setLevel` spends one point per hero level (since 7.40 talents have their own points): the ultimate
  whenever it can be raised, then the basic abilities evenly. The +2 to all attributes comes by itself at hero levels
  15, 16, 17, 19, 20, 21 and 22 (`facts.attributeBonusLevels`; Invoker has none). Abilities joined by `LinkedAbility` are one skill
  with one level (Shadowraze, Morph, Kez's weapon sets). Hidden helpers, innate / Scepter / Shard / `NOT_LEARNABLE` abilities and
  one-level non-ultimates never take points: their level follows the ability the game ties them to (`def.follow`, measured), the
  ability named by `DependentOnAbility` (`ab.def.dep`), or the ability whose name they extend (`x_release` follows `x`). Maximum
  levels come from the game (`def.liveMax`). A script does not need to repair levels; `unit.skillPlan()` shows the grouping.
- **Attributes [L].** Health is `base + 20 x whole points of Strength`, mana `75 + 12 x whole points of Intelligence`; regeneration,
  armor, attack speed and base magic resistance use the fractional attribute. Attack damage uses whole points of the primary
  attribute (universal heroes: `floor(0.45 x floor(STR + AGI + INT))`), with the per-level gain added in single precision as the
  game does. A script therefore grants attributes through the stat keys `str` / `agi` / `int` / `all` / `primary`, never through
  `hp`, `mana` or `dmg` directly. A bonus that depends on the hero's final stats goes into a `late(m, s, u)` hook: it runs after the
  attributes are known and before anything is derived from them, and may still change them (`u.str += n`).
- **Mana costs [L]** are rounded down to whole numbers after all reductions.
- **Movement speed [L].** The 100 floor applies first; a cap (`msCap`) may then go below it, as the game's own limits do (a unit
  pressed against a barrier is held at about 0.1, Will-o-Wisp at 60). For a speed of 0 without the root state use `msCap: 0.01`.
- **Area bonus [L].** `ab.v('name')` already contains the owner's area bonus (`aoe`, flat) and percentage area bonus (`aoePct`) for
  the values the game flags as area-scaled (`ab.def.aoe`), exactly like the game's own value lookup. `enemiesNear` / `alliesNear` /
  `world.enemiesInRadius` use the radius as given: never add `u.aoeBonus` by hand.
- **Fresh start (`rules.fresh`, `world.fresh`).** Live comparison scenes start a hero as the game spawns it: stacks that build up
  over time (souls, Bladeform, kills) are zero. A script that starts a hero "fully stacked" for ordinary fights must start at zero
  when `world.fresh` is set.
- **A think that falls on the expiry tick is skipped.** A modifier that expires is removed before its `onThink` of the same instant.
  A damage-over-time effect whose duration is a multiple of its interval therefore loses the last tick unless its duration is padded
  by a fraction of a tick (`duration + 0.01`) or the last tick is delivered from `onDestroy(m, expired)`.
- **Charges [L].** Read from `AbilityCharges` / `AbilityChargeRestoreTime`. Between two uses there is no pause unless the game
  reports one (`def.lockout` from `facts.chargeLockout`: 0.25 s for Frost Shield, Rocket Flare, Rupture; 1 s for Impalement and
  Carrion Swarm) or the ability's own `AbilityCooldown` is at most 1 s. `ab.useCooldown()` is the pause one use starts. Charges
  never exceed the current maximum.
- **Spell block.** `onSpellTargeted` is not fired for abilities whose script sets `noBlock: true` or for the actives of neutral items.
  A script that reflects spells should skip sources flagged `noReflect`.
- **Damage block.** Several blocks on one attack do not add up: a block writes the amount it took into `rec.blocked` and only blocks
  the part above what is already there.
- **Disables keep the longer duration.** Re-applying `modifier_stunned` (and the other generic disables) with a shorter duration does
  not shorten the running one.
- **Cast orders.** An order without a target and without a point is aimed at the caster's own position. The controller does not order
  a unit-target spell on an enemy the spell cannot affect (debuff immune and not piercing, untargetable).
- **Free spells** (`rules.freeSpells`): no mana costs and no cooldowns for casts; passives keep their internal cooldowns and the
  controller uses each ability at most once per second.
- **Jungle creeps.** Abilities of units that carry `neutral_upgrade` are level 1 / 2 / 3 from 0:00 / 15:00 / 30:00 of `rules.gameTime`.
  Abilities of non-hero units can be levelled up to the length of their longest value array.
- **Stat bonuses of a passive switch off under Break** as soon as the Break is applied (and return when it ends). Use a second,
  unbreakable modifier for bonuses that must survive Break.
- **Day and night.** Switch with `world.setDay(true | false)` so that stats depending on the time of day are recomputed.
- **Scenario option `stacks`.** `{ "stacks": { "nevermore_necromastery": 12 } }` sets the stack count of an ability's first intrinsic
  modifier (souls, charges of the Urn family, Magic Stick).

Random stress test over all content (reproducible, prints the scenario of any failing fight):

```
node tools/fuzz.mjs --n 20000 --seed 1 --workers 6
```

## Fidelity labels

- `full`: every combat-relevant clause of the tooltip is modelled.
- `approx`: all clauses are modelled but with a stated simplification (geometry, timing, AI assumption).
- `partial`: a combat-relevant clause is missing. `note` must say which.
- `n/a`: no effect inside this sandbox (vision, map movement, economy, courier, trees). `note` must say why.

The sandbox has no terrain, trees, vision or facing. Treat "in front of", "behind", "facing" clauses as not modelled unless you can
express them through who is targeting whom, and say so.

## Testing

```
SIMLAB_SCRIPTS=<your_file_without_.mjs> node tools/hero_check.mjs -v <hero> [<hero>...]     # must print OK for every hero
SIMLAB_SCRIPTS=<your_file> node tools/hero_smoke.mjs <hero>                                 # one fight, cast counts, damage split
```

`hero_check` runs 36 fights per hero (levels 1-30, with and without Scepter/Shard) and fails on script errors or unregistered abilities.
"never cast" lines mean your `ai` condition is never true: fix it or mark the ability `manual` with a reason.
To inspect one ability closely, write a throwaway script under your scratch directory that calls `sandboxExec` from `src/sandbox.mjs`
(see `tests/run.mjs` for an example) and read the combat log; verify that the numbers in the log match the tooltip values.

## Report

Finish with a table: hero · ability · fid · note (for anything not `full`), plus a list of engine features you missed.
