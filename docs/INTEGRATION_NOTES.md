# Integration notes and engine backlog

Collected from the reports of the thirteen content passes (heroes 1-12, items, neutral items, creeps). The reports below are kept as
written; this first section says what was done about them at integration (2026-11-19). Everything not listed as fixed is still open
and is the backlog for raising `partial` / `approx` labels.

## Fixed at integration

- Skill points: hidden helpers, linked twins, dependent sub-abilities and one-level passives no longer take points; points are spent
  level by level before attribute levels (Invoker 7/7/7 at 25); value-driven level rules (Meepo's ultimate has 4 levels)
- Charges: `ready()` respects the lockout between uses; short explicit cooldowns are used as given
- A chasing unit starts its attack in the tick it steps into range (it could never attack a target walking away)
- Break and day / night changes recompute stats (`world.setDay`)
- A cast without target and point is aimed at the caster (no walk towards the map origin); the controller does not order spells on
  targets they cannot affect; with `freeSpells` it uses each ability at most once per second and passives keep their cooldowns
- Spell block is not asked for `noBlock` abilities and neutral item actives
- Direct health loss does not count as "damaged by a hero"; Roshan does
- Data pack: `include_keys_from` units (43 summons had no attack), `apply_curio_bonus "true"`, `DependentOnAbility` (`def.dep`),
  list of area-scaled values (`def.aoe`)
- Non-hero ability levels up to the longest value array; jungle creep abilities level with game time in the engine
- Illusions inherit unit overrides and Scepter / Shard values without talents
- Generic disables keep the longer duration on re-application
- Sandbox orders reach summoned units by id; batch errors carry the stack location
- units.mjs: Roshan Slam creep bonus is a percentage, Roshan armor growth, Necronomicon archer aura is a percentage, Thunderhide
  Slam has three waves, Mud Golem boulder creep damage; every ability labelled
- Cross-file loops: Aphotic Shield (Shard) against Blade Mail and against another Aphotic Shield, two Io with the tether attack
  talent, Burning Army without Skeleton Walk, Force Staff after a Duel victory, Chen's Shard creep ability level
- Labels: a missing True Sight clause alone is `approx` in every file

## Still open after the live verification waves (2026-11-19, most requested first)

- Facing / turn rate (Riki backstab, Earthshock hop, Firesnap Cookie, Io spirits, Event Horizon), unit collision and free-spot
  placement after blinks, fear that walks the unit away, forced movement over time (knockbacks are instant)
- An attack-immune state that does not disarm (Blur, Shadow Realm, Escape Act, Pierce the Veil); an "out" state that keeps the
  owner's channel and lets the owner's own spells target the unit (Tricks of the Trade, Disruption, Phase Shift)
- A magical part inside one attack damage instance (Monkey King Bar, Gunpowder Gauntlet, Book of the Dead Mana Break); attack
  damage fixed at launch for ranged attacks (Threads of Fate); an attack at average damage (Multishot)
- A script API to refuse an order before mana and cooldown are paid (many scripts refund by hand), an ability cooldown
  override, a mana-cost formula hook, cast speed, alt-cast, vector targeting, autocast state, uncapped attack speed (Marci)
- Instant no-target casts should not cancel the current attack order (Quill Spray, Amphibian Rhapsody)
- Live side: Maledict cast in a scene curses nobody (unexplained), Io / Timbersaw scenes crash the client at cleanup,
  Hero Demo trees near the arena, creep scenes not yet analysed

## Still open (before the live waves)

- No True Sight / reveal state, no facing, no terrain, trees or vision
- Fear and leash do not move or restrain units; no forced-movement pipeline (knockbacks are instant, no knockback resistance)
- A think on the expiry tick is skipped (authors compensate; see AUTHORING.md)
- Castability is the static PASSIVE flag; no cast-while-disabled / ignore-silence / ignore-channel; a channelling unit takes no orders
- No per-ability modifiers for area, cast range, cast point, mana cost, spell amplification; `pierces` is static
- No projectile disjoint API, no linear projectile helper; launchAttack has no switches for cleave / lifesteal / crit / damage type
- No pip-health units, no team-change API, no removeAbility, no "modifier applied" / pre-heal / mana-spent hooks
- Reflected damage is always stopped by debuff immunity; health restoration stacks multiplicatively
- Item charges with AbilityCharges are not ticked by the engine; shared cooldown groups are compiled but not enforced
- Summons cannot be equipped or levelled from a scenario; out-of-play units count as alive for the win condition

## Engine gaps reported

- [neutral_1] no percentage area-of-effect stat (`aoe` is flat): Dezun Bloodrite +20% not applied
- [neutral_1] no forced-movement distance stat (Stonefeather Satchel); `knockback()` ignores it
- [neutral_1] barriers do not expose their kind (Brick needs magical -> physical -> all order); no barrier registry
- [neutral_1] `noBlock` is a script convention only; engine fires onSpellTargeted for every enemy unit-target cast (Roshan / hero spell blocks ignore the flag). Neutral item actives must not trigger spell block (Linken's tooltip)
- [neutral_1] `ROOT_DISABLES` behaviour flag is not enforced by the engine
- [neutral_1] no "unusable for N s after taking hero damage" mechanism (Blink gates only the AI)
- [neutral_1] `F_HP_LOSS` damage still stamps `lastHurt`
- [neutral_1] secondary attacks skip the defender's onAttacked hooks too
- [neutral_1] onDeath + ev.prevent cannot tell "died and came back" from "did not die"
- [neutral_1] world.summon: creep ability level capped at 1; unit definition used as is
- [neutral_1] `aura()` ignores the owner's area bonus
- [neutral_1] `item_enhancement_curious` must be registered (owner: items_2); curio rule = flagged values x (1 + item_potency/100)
- [neutral_1] no facing, terrain, water

## Data pack issues reported

- `apply_curio_bonus "true"` (item_defiant_shell.counter_damage) is dropped: compile accepts only "1"
- `include_keys_from` in npc_units is not resolved (necronomicon_warrior_3 / archer_3 have no attack, armor 0)
- `affected_by_aoe_increase` flag is dropped by the data pack (engine currently adds the area bonus to every radius)
- Roshan has no `heroLike` flag, so his damage never stamps `lastHurt` ("hero or Roshan" checks)
- units.mjs: `necronomicon_archer_aoe` applies flat movement speed; tooltip says percent

## Script errors seen in other files (to re-check at integration)

- heroes_10.mjs:485 (`clinkzArcher`, null `.v`)
- heroes_9.mjs:131 (infinite recursion in a `stats` function; fight with Arc Warden, Mars, Phantom Lancer, Lina, Batrider, Abaddon)

## Decisions to confirm

- neutral_1: `illusion: true` on serrated_shiv and vile_phial rests on 7.42 patch notes, not tooltips (keep: patch notes are shipped evidence)
- neutral_1: Book of the Dead (demonicon) reads summon stats from data/descriptions.json at runtime (numbers exist only as tooltip text)
- neutral_1: literal 3 s for Flicker / Tumbler's Toy (tooltip text, no data value)

## Author reports

### neutral_1 (48 artifacts): 23 full, 19 approx, 3 partial, 3 n/a
Partial: dezun_bloodrite (no % area), stonefeather_satchel (forced-movement distance), enchanters_bauble (only stat tokens amplified).
N/a: dormant_curio, foragers_kit, red_ledger. 517 numeric checks against tooltips, 0 failed.

### units_2 (132 unit abilities): 47 full, 40 approx, 14 partial, 31 n/a
About 300 log-versus-data checks pass; unit_check OK for 90 of 92 carrier units (the other two wait for hero-owned abilities).
Partial = abilities without any tooltip in the game files (Diretide Roshan, Greevil minibosses, scout / filler helpers).
File-wide rules: neutral ability level 1 / 2 / 3 at 0:00 / 15:00 / 30:00 game time (7.33 patch notes); neutral cast chance and attempt cooldown from data;
roshan_revengeroar and roshan_grab_and_throw are manual (need map history).

Engine gaps (units_2):
- no spawn hook for abilities; neutral level-by-game-time rule should live in the engine (units.mjs abilities stay level 1)
- IGNORE_SILENCE / cast-while-stunned cannot be expressed; silence interrupts every channel
- barrier-absorbed damage never reaches onTakeDamage (Tormentor reflect driven from the shield's postMit)
- pip health is not an engine concept (implemented locally for Radigull eggs)
- summons never count for the win condition; sandbox `order` cannot address summoned units by id
- no talent picker for non-hero units (Spirit Bear tree); no scenario field for map history (Roshan kills, Tormentor deaths)
- dmgBasePct adds the bonus from the mean roll only (min-max spread not scaled)
- F_REFLECT damage is blocked by debuff immunity (unknown whether Tormentor reflection should be)
- `player_cast_point` values cannot be applied

Fixes to make in units.mjs (my file):
- roshan_slam: `damage_bonus_creeps` is +100% damage to creeps, not flat +100
- Roshan armor growth 0.4 per minute (7.39 patch notes)
- necronomicon_archer_aoe movement bonus is a percentage
- roshan_inherent_buffs.move_pits_slow_resistance and the illusion clause of roshan_devotion are unused
Data oddities (units_2): Seal Flop radius 275 in data vs 250 in 7.42 notes; Steal Weapon break 5 vs 4.5 at level 4; forged_spirit_melting_strike has 9 values with MaxLevel 8;
Spirit Bear talent abilities are not flagged as talents; 7.31 notes say neutral-controlled auras have radius 800 (data radius used).
Cross-file: Chen's Shard in heroes_5.mjs sets creep abilities to level 2 instead of +1.

### heroes_9 (arc_warden phoenix enchantress broodmother ember_spirit magnataur pangolier silencer warlock bloodseeker omniknight treant)
hero_check OK for all 12 (also with all files loaded), 692 mixed fights without script errors, numbers checked in the log for nearly every ability.
Partial: magnataur_solid_core (no knockback reduction), pangolier_fortune_favors_the_bold (only crits), treant_natures_guise (no trees).
N/a: stop / toggle helpers, treant_eyes_in_the_forest, treant_lifebomb_explode.

Engine gaps (heroes_9):
- Unit.setLevel treats HIDDEN-but-learnable linked sub-abilities as a fourth basic and wastes skill points (phoenix_launch_fire_spirit; ember_spirit_activate_fire_remnant stuck at level 1)
- Ability.ready() ignores cdEnd for charge abilities (0.5 s lockout between charges never enforced)
- charge limit / cast range overrides had to be patched into ab.vals (Ember Scepter)
- summoned-unit ability maxLevel defaults to 1 (Poison Sting has 3 levels)
- no "attack against me starts" hook (Untouchable polls); no source-dependent evasion; no projectile disjoint API
- no forced-movement pipeline (knockback resistance); no hook into other modifiers' chance rolls
- no team-change API (Enchant rewrites team / owner / counts by hand)
- summon lifetime expiry is a silent kill; onAnyDeath fires after the victim's modifiers were removed
- no per-target attack range; controller cannot stop a channel early; world.after fires on ticks only
- debuff immunity does not suspend existing debuffs (7.33 rule)
- tools/digest.mjs drops the literal % after a value placeholder (Treant Scepter "+100% Strength" reads as flat 100)

### heroes_5 (invoker chen monkey_king alchemist death_prophet hoodwink muerta rattletrap tiny abaddon jakiro shadow_shaman)
hero_check OK for all 12; manual: invoker_ghost_walk, monkey_king_mischief, abaddon_borrowed_time (auto-trigger is modelled).
Partial: rattletrap_power_cogs (ring emulation, no individual cogs), hoodwink_mistwoods_wayfarer (no natural trees).
Assumed constant: Exorcism spirit turning circle 100 units (not in data; total damage depends on it).
Invoker: fixed orb setup per spell, invoke is automatic; Scepter / Shard option chosen with marker modifiers `modifier_invoker_invoke_scepter_option` / `_shard_option` (stacks 1-3).

Engine gaps (heroes_5):
- ab.v() resolves neither `levelkey` (orb-indexed values) nor `var` (Invoker's selectable Scepter / Shard options): resolved in the script
- Invoker default skill build is too weak (orbs 5/5/5 at 25): attribute levels are taken even when ability points could be spent; bonus orb points not granted
- hidden / linked sub-abilities take skill points: alchemist_unstable_concoction_throw, tiny_toss_tree, jakiro_liquid_ice (heroes end with 3/3/3 basics at 18-29); monkey_king_primal_spring fixed at level 1
- ETHEREAL always disarms and is never attackable (Muerta rebuilt from hooks)
- no per-attack damage type, no attack origin other than the attacker, no way to exclude one item proc / cleave / block
- no percentage attack speed stat; slow resistance does not affect attack-speed slows; incoming heal amp only as `restore`; spell vulnerability only for magical
- controller targets are sticky (no retarget away from units it cannot hurt); no retreat
- charge lockout capped at 0.5 s (Crypt Swarm Shard needs 1 s)
- ending a channel from a script is undocumented (Unit.endChannel exists)
- summons cannot inherit the summoner's talents; no team-change API (Holy Persuasion edits fields)
- shared hex modifier is removed by a basic dispel (data says strong only for Shadow Shaman's Hex)

### items_2 (17 shop items + 15 enchantments in items_2.mjs; full review of items.mjs)
unit_check OK for 123 items (32 new, 91 reviewed); 343 numeric checks against tooltips; 1016 fuzz fights without errors.
New items: partial = essence_distiller (no True Sight / shared vision), enhancement_mystical (mana loss reduction), enhancement_tough (knockback resistance only for Force Staff / Pike), enhancement_manic (cast speed).
Manual by design: cyclone, wind_waker, force_staff, hurricane_pike, shadow_amulet, ethereal_blade, Caduceus Force.
Review found and fixed about 40 bugs in items.mjs, among them: Shadow Blade / Silver Edge buff removed itself on its own cast; DoTs ticked N-1 times; BKB duration never shrank;
Aeon Disk cooldown growth and threshold; Blade Mail percentages; Bloodthorn stale debuff; Refresher reset items; Swift Blink flat instead of %; Bloodstone 90% instead of 70%;
Crimson Guard active; Magic Stick / Wand never usable; Linken's blocked Urn-type items; several non-stacking families (Yasha, Vanguard, Diffusal, Quelling, Buckler-type auras).
Not changed: Battle Fury cleave ignoring armor (engine convention; no shipped source either way) -> labelled approx.
Scenario `stacks: { item_x: N }` presets charges (urn family, Magic Stick / Wand), Desolator Soul Stealer damage, Rapier spell mode.
Lotus Orb temporarily swaps holder.findAbility / world.after / world.projectile during a re-cast. items.mjs imports abilityScripts (Caduceus runs the Force Staff script).
TODO (mine): register `item_enhancement_curious` (`defAbility('item_enhancement_curious', { fid: 'full' })`); Blood Grenade is n/a although it deals damage (same mechanics as Bloodslinger).

Engine gaps (items_2):
- a think that falls on a modifier's expiry tick is skipped (dot() loses its last tick): authors compensated in scripts; DO NOT change the engine semantics now, document it
- item options never reach scripts (`charges` only for items with initial charges, `data` dropped)
- two copies of one item share one intrinsic modifier; removeItem on one copy removes it for both
- shared cooldown groups (`sharedCd`) are compiled but not enforced
- no cast-speed stat, no hook on burnMana, no resistance input on knockback()
- Health Restoration: official rule 1 + P - N with diminishing stacks on all life gain; engine multiplies `restore` factors and the restoration_amp token skips heals received
- all `%move_speed` tokens share one non-stacking bucket (Nimble should stack with Yasha items); stat tokens always add up (family rules undone in scripts)
- one cast range per ability (Force Staff 850 vs 550, Pike 425 vs 650)
- `pierces` comes only from SpellImmunityType (target flag MAGIC_IMMUNE_ENEMIES and tooltip text ignored: Abyssal, Nullifier)
- onSpellTargeted can block but not reflect; no events for "modifier ended", "mana spent", "state changed"
- item AbilityCharges: tickCharges runs only for abilities, ready() ignores the cooldown, refresh() refills empty charges
- no per-unit True Sight (global detectAll only); u.cast() defaults the point to (0,0); lastHurt ignores Roshan
- with freeSpells an AI without a self-gate recasts every tick and never attacks
- `describe` shows no stat line that lacks a `$` token (Heart "+1% Max Health Regen"; enchantment descriptions are empty)

### heroes_6 (meepo techies ringmaster batrider disruptor keeper_of_the_light naga_siren razor tusk abyssal_underlord leshrac skywrath_mage)
hero_check OK for all 12; 79 abilities: 26 full, 43 approx, 3 partial, 7 n/a; 116 log checks; 1776 stress / mixed fights without errors.
Partial: meepo_divided_we_stand (no shared item procs / cooldowns for clones), meepo_fling_release (no hold phase), tusk_ice_shards (barrier does not block movement).
Manual: techies_reactive_tazer_stop, naga_siren_reel_in, naga_siren_song_of_the_siren_cancel.
Mines, barrels, wards (Techies, KotL wisp, Underlord gates) are world timers, not attackable units.

Engine gaps (heroes_6):
- cast point / cast range / immunity piercing only from AbilityCastPoint / AbilityCastRange / static immunity type (four value-driven cases mirrored by hidden modifiers)
- passive abilities that Shard makes castable cannot be cast (Divided We Stand pick-up, M.A.D.)
- ultimate levels capped at 3 unless KV MaxLevel; Meepo ult has 4 levels and values required_level 3 / levels_between_upgrades 7 / max_level 4 (KV RequiredLevel says 4): allocator should prefer these values
- allocator spends points on hidden helper abilities (keeper Solar Bind, Naga Song End)
- charges: ready() ignores the per-use cooldown; charges defined by values other than AbilityCharges (max_charges) are not recognised
- no ward / pip-health units; no target priority in the default controller (a mine unit would draw every attack)
- default controller never walks into range for no-target area spells (workaround: ai returns a point and a temporary cast range)
- debuffs cannot be applied to invulnerable units (Ensnare on units asleep under Song)
- applying or removing Break does not trigger a stat recompute
- toggles: mana charged on every cast, including switching off
- a blocked unit-target cast is dropped entirely (Walrus Punch cannot fall back to an attack)
- modifier expires before its think on the same instant (periodic debuffs last 0.05 s longer to keep the last tick)
- internals used beyond the documented API (keep stable): ab.vals, ab.pierces, ab.maxLevel, ab.cdEnd / chargeEnd / charges, u.castAb / channelAb / orderTarget / attackTarget / castTarget / castRangeBonus / cdrMul,
  u.setLevel / setTalents / setUpgrades / addItem / removeItem, w.makeAI, w.byTag (clones registered there), it.def.tokens, m.dieTime / created / removed, modifier flag `breakable`

### heroes_11 (brewmaster shadow_demon puck dark_willow grimstroke mars primal_beast storm_spirit windrunner dazzle queenofpain venomancer)
hero_check OK for all 12 (81 abilities incl. brewlings); about 39,600 random fights without script errors; numbers checked for every hero.
Manual: mars_bulwark toggle (passive block is automatic), dazzle_through_the_realm, dazzle_nothl_projection_end. N/a: cancel / release helpers.
Not in notes but modelled: Culling Blade still kills through Shallow Grave; Disruption illusions take the target's health at return time.

Engine gaps (heroes_11):
- no projectile disjoint API (world.projectiles filtered directly); castability is the PASSIVE flag (ab.passive toggled for Shard actives: Liquid Courage, Overload)
- charges / costs defined by other values (max_charges, shard_manacost, shard_cooldown, formula mana cost of Ball Lightning) handled in scripts
- summoned-unit ability levels capped at 1 (ab.maxLevel raised); no percentage area bonus (Colossal applies it to KV-flagged values)
- LEASH does not restrict movement, FEAR does not move units; no wall / tether / forced-movement primitives
- BREAK change does not dirty stats; cannot cast on units in OUT state; INVULN blocks the caster's own debuffs too (Disruption uses STUN + INVULN)
- no "hero replaced by units" / "body with shared health" concepts (Primal Split, Nothl Projection built from summons + sync)
- no charge-up abilities / early channel cancel; default controller cannot hold its attack or move without attacking; `u.ai.target` is null when fixedTarget is set
- allocator spends points on hidden helpers (dazzle_nothl_projection_end, windrunner_focusfire_cancel; Dark Willow's two linked ultimates get separate points)
- attack redirection needs rec.cancel + undocumented world.landAttack; launchAttack has no crit option; creep spell-lifesteal factor 0.2 duplicated in a script
- createIllusion does not inherit scenario `override` values; sandbox orders cannot address summoned units
- Soulbind repeats another ability's cast script (caster-side effects repeat)
Internals used: world.projectiles, ab.passive, ab.maxLevel, u.endChannel, world.landAttack, st[] counters.
Data pack: `include_keys_from` units compiled without inherited keys (brewmaster_earth/storm/fire_2..4); `DamageTypeTooltip` and `affected_by_aoe_increase` flags dropped.

### heroes_10 (lone_druid earth_spirit furion clinkz enigma marci phantom_lancer snapfire weaver centaur pugna vengefulspirit)
hero_check OK for all 12; 76 abilities: 14 full, 56 approx, 3 partial, 3 n/a; 254 tooltip checks, 2160 fights without errors.
Partial: furion_spirit_of_the_forest (only treants counted), marci_companion_run (no alt-cast carry), vengefulspirit_retribution (one attack type per unit; no respawn).
N/a: lone_druid_spirit_bear_return, furion_teleportation, marci_special_delivery.
Spirit Bear is out at fight start; a scenario-spawned `npc_dota_lone_druid_bear1` on the team is adopted (way to give it items / Scepter / Shard).

Engine gaps (heroes_10):
- fear only removes actions (no running); channels block every other cast and are ended by silence
- onAnyCast fires after the spell took effect (Nether Ward cannot hit before the spell)
- attack-speed cap (700) cannot be lifted per unit; one attack type per unit; no respawn
- reflected damage is always blocked by debuff immunity, even for piercing abilities
- controller drops unattackable targets (ethereal / out of play) and can pick attached units (Swarm beetles)
- summoned units cannot be addressed, equipped, levelled or given talents / upgrades by scenarios or sandbox ops
- non-hero units get every ability at level 1 with max level 1, including Scepter / Shard-granted ones
- createIllusion does not refresh ability values after copying Scepter / Shard unless the hero has talents
- allocator treats hidden `centaur_mount` as learnable
- `onOrder` is declared but never fired; no "move through units"; pip health scripted per unit; `sharedCd` unused; PASSIVE-flagged abilities cannot be cast (Juxtapose Shard)
- projectiles are homing only; no vector targeting; no disjoint; invisibility has no fade time
- out-of-play units count as alive for the win condition (stored Lone Druid, swallowed units)

### heroes_8 (rubick visage dark_seer bounty_hunter elder_titan lycan obsidian_destroyer shredder void_spirit bane night_stalker tidehunter)
hero_check OK for all 12; 84 abilities: 29 full, 42 approx, 3 partial, 10 n/a; 389 log checks; about 6,300 stress fights (Rubick stole about 350 distinct spells) without errors from this file.
Partial: rubick_curiosity (no buff-duration amp), void_spirit_aether_remnant (Shard rotating path), void_spirit_dissimilate (outer ring talent).
Manual: elder_titan_move_spirit, bane_nightmare_end, Visage's own copy of familiar Stone Form.
Rubick: steals the last scripted non-item spell the target cast; companion abilities come along at level 0.

Engine gaps (heroes_8):
- BUG: a no-target ability with AbilityCastRange > 0 walks the unit towards (0,0) when the AI answers `true` (authors answer with the caster's own position)
- castability is the static PASSIVE flag (ab.passive flipped from `requires`: Gravekeeper's Cloak, Reactive Armor, Midnight Feast)
- upgrade values under non-standard names not applied (cast_range_scepter, cooldown_scepter, shard_cooldown / shard_manacost, max_charges / charge_restore_time): patched into ab.vals from `requires`
- no percentage cast-range stat (Enfeeble rescales numbers); no buff-duration amplification
- damage block resolution is a script convention (`rec.blocked` = largest block per attack, used by items.mjs and Kraken Shell)
- no per-unit True Sight; no "any unit took damage" hook; no alt-cast modes; no removeAbility (Spell Steal splices u.abilities)
- Hex speed cap (msCap) beats forced speed (msAbs) although Shapeshift should keep its speed
- allocator spends points on hidden helpers (rubick_telekinesis_land / _land_self, bane_nightmare_end)
- launchAttack has no switch for cleave / lifesteal / crit
- `rules.regen: false` also disables regeneration-based ability effects
- Break and day / night changes do not dirty stats
Internals used: ab.vals, ab.passive, ab.maxLevel, ab.cdEnd / charges / chargeEnd, ab.script (replaced for stolen spells), u.abilities, u.melee, u.st[], world.isDay, rec.blocked, script flag `noReflect` (read by Counterspell).
Data pack: `include_keys_from` unresolved for lycan_wolf2-6 and visage_familiar2-3 (no attack).

### review of heroes_1.mjs + heroes_2.mjs (15 heroes)
hero_check OK for all 15; labels: 46 full, 37 approx, 1 partial (life_stealer_infest: creep hosts), 1 n/a; 5715 stress fights without errors.
Dozens of bugs fixed in the first scripts (examples: Keen Scope percent applied as flat damage; Wrath of God counted as bonus instead of base damage; Multishot hit a full circle;
Mana Shield absorbed after armor; Omnislash first slash random; Troll's Whirling Axes cast for free because the data key is `AbilityManacost`; Battle Trance never cast; Chronosphere froze only units inside at cast).
Gaps filled: fan_of_knives, concussive_grenade, glacier, cold_blooded, depth_shroud, time_walk_reverse, infest / consume, bone_guard + skeleton ability, armageddon, blur, whirling_axes_ranged, distortion_field.
"full" labels resting on judgement calls: antimage_mana_break, antimage_mana_void, juggernaut_blade_dance, luna_eclipse, life_stealer_ghoul_frenzy, sniper_assassinate, skeleton_king_hellfire_blast.

Engine gaps (review 1-2):
- think on the expiry instant skipped (worked around with a `tickDot` helper delivering the last tick from onDestroy)
- no projectile disjoint / speed API; BREAK change does not dirty stats; `breakable` is all-or-nothing per modifier
- F_HP_LOSS bypasses all hooks (Mana Shield cannot absorb it); LEASH has no effect; units in OUT take no orders; no way to affect invulnerable units
- attack cycle fixed when the wind-up starts; no cast-while-disabled path; no hook to refuse an order before mana / cooldown are charged
- ability.pierces is static; a custom `ai` returning { target } skips the immunity check and finishCast silently drops the cast
- cost / cast point / charges only under standard keys (`AbilityManacost`, scepter_cast_point, max_charges)
- refreshing a modifier does not update its `data` and does not dirty `late`-only modifiers
- no "illusion created" hook; illusions do not inherit `override`; no way to run another unit's ability script as a different caster (Counterspell clones the ability object)
- attributes floor at 0 (game: 1); no speed above the normal cap; a talent implemented inside another script must be registered itself

### review of heroes_3.mjs + heroes_4.mjs (16 heroes)
hero_check OK for all 16; 97 abilities: 65 full, 26 approx, 6 partial, 0 n/a; 616 log-versus-tooltip checks; tests 25 / 25.
Partial: slardar_amplify_damage, zuus_lightning_bolt, zuus_thundergods_wrath, lion_mana_drain (all four: only the True Sight / anti-invisibility clause is missing, exact in the default world),
crystal_maiden_freezing_field_stop (channel cannot be stopped), ogre_magi_multicast (items are not multicast).
Label harmonisation: other files label the missing True Sight clause `approx` (e.g. Track in heroes_8).
Bugs fixed (examples): every DoT lost its last tick; hand-written `ai` returned debuff-immune targets (cast refused, re-issued forever); Quill Spray stacks never expired;
Duel silenced and taunted Legion herself; Dragon Slave / Breathe Fire / Earth Spike were circles; Freezing Field rolled chances instead of placing 100 explosions;
Burning Spear cost; Berserker's Blood regeneration; Life Break was a teleport; Dispersion reflected post-mitigation HP loss; Requiem was an estimate; Ignite stacked burns.
Renamed `modifier_nevermore_shadowraze_debuff` -> `modifier_nevermore_shadowraze1_debuff`.

Engine gaps (review 3-4):
- BUG: chasing never attacks. The attack order steps to the edge of range and returns; if the target moved more than 1 unit that tick the attack never starts
  (400-speed melee unit lands 0 attacks in 10 s on a target walking away at 200). Fear is left as "stand still" because of this
- last DoT tick dropped (local `ticker` helper); `dot()` affected too
- finishCast silently drops a non-piercing unit-target spell on a debuff-immune enemy and the AI re-issues it forever: the check belongs in decide()
- no True Sight / reveal state; no facing; no motion controllers; no pip health; heroes do not respawn
- NO_TARGET ability with a cast range walks to (0,0) (Inner Fire)
- PASSIVE-flagged abilities cannot be cast (Scepter / Shard actives of Bristleback, Dispersion, Berserker's Blood auto-trigger for AI units only)
- no per-ability cast range / cast point / mana cost modifiers, no onAdded for hero abilities (ab.vals / ab.pierces patched on the instance)
- allocator levels linked abilities separately (Shadowraze 1 / 2 / 3)
- taunt does not interrupt channels or pending casts; a channelling unit accepts no orders
- F_REFLECT damage always dropped on debuff-immune units; F_HP_LOSS ignores invulnerable / out-of-play units
- debuffAmp is per caster only; Break switches off all stats of an intrinsic passive
- illusions do not know which ability created them; default autoTarget ignores AbilityUnitTargetType (Duel on creeps)

Cross-file (review 3-4):
- items_2.mjs:303-304 `forceBlocked()` matches `modifier_legion_commander_duel` by prefix and also catches the permanent `modifier_legion_commander_duel_damage`: match the two in-duel names exactly
- heroes_11.mjs (Dark Willow Terrorize) makes feared units run and is exposed to the chase bug

### heroes_12 (wisp kez oracle dawnbreaker gyrocopter mirana pudge templar_assassin winter_wyvern earthshaker sand_king witch_doctor)
hero_check OK for all 12; 78 abilities (76 hero + 2 unit): 20 full, 47 approx, 4 partial, 7 n/a; thousands of random fights without errors (alone and with all files).
Partial: templar_assassin_refraction (Shard cast while disabled), templar_assassin_psionic_trap (traps untouchable), winter_wyvern_arctic_burn (attack point, flying), dawnbreaker_break_of_dawn (no decay over the day).
N/a: wisp_spirits_in / out, oracle_prognosticate, dawnbreaker_land, gyrocopter_side_gunner, winter_wyvern_eldwurms_edda, witch_doctor_gris_gris.
Manual: wisp_tether_break, templar_assassin_self_trap.
Constants from tooltip text (no data value): Tether latch stop 300, Homing Missile creep / illusion damage 25%, Luminosity Scepter 2 attacks.
From raw localization (not in the data pack): Celestial Hammer ally-speed talent amount, Sacred Arrow multishot rule.
Skill build repair: hidden `modifier_<ability>_skill_sync` on Io, Kez, Oracle, Dawnbreaker fixes the default build from the first tick (re-check after the allocator fix).

Engine gaps (heroes_12):
- allocator gives points to hidden helpers (Io Break Tether, Spirits In / Out, Dawnbreaker Land), Kez's second weapon set, Oracle's Scepter passive (diviners_deck is a Scepter upgrade with an `enabled` value)
- re-applying modifier_stunned takes the new duration even when it is shorter (local helper keeps the longer one)
- onHealed fires only for the part that raises health; no pre-heal hook, no mana-gain hook
- no cast-start hook; behaviour flags for cast-while-disabled / ignore-silence / ignore-channel not enforced; ROOT_DISABLES not enforced
- no attack-point stat; attack damage type fixed to physical; launchAttack has no projectile speed / no-crit / no-lifesteal options; only `secondary` keeps cleave off (and drops on-hit effects)
- charge cap read raw from AbilityCharges (Leap Shard charge written into ab.vals)
- world.isDay is one boolean with no owner (overlapping day / night abilities can leave the wrong time of day)
- no linear projectile helper, no disjoint API (Sand Storm edits world.projectiles; private `noDodge` flag on Splinter Blast)
- taunt onto an ally: the attack order stays on the ally when the taunt ends
- kill credit cannot be redirected from onDeath
- freeSpells + Roshan: spell block always ready, unit-target spells never land and are recast endlessly

### heroes_7 (morphling tinker largo beastmaster doom_bringer kunkka nyx_assassin riki undying ancient_apparition lich spirit_breaker)
hero_check OK for all 12 (alone and with all files); 85 entries (78 hero abilities, 4 unit abilities, 3 talents): 35 full, 41 approx, 4 partial, 5 n/a.
28,000 random fights with all scripts: no error from this file; Morphling morphing into each of the 127 heroes: 507 fights without errors.
Partial: doom_bringer_devour (no Shard +AoE), doom_bringer_lvl_pain (stale max-level note), kunkka_ghostship (Scepter cannonballs), riki_smoke_screen (Shard untargetable by allies).
Manual: nyx_assassin_burrow / unburrow, lich_death_charge. N/a: tinker_keen_teleport, doom empty slots, undying_ceaseless_dirge, ancient_apparition_ice_blast_release.
Registers three talents with defAbility: special_bonus_unique_beastmaster_5 / _6, special_bonus_unique_undying_3 (notModelled listed them because it only looks at value references).

Engine gaps (heroes_7):
- no "modifier applied" hook; no per-ability area / spell amp / cast range / mana discount modifiers
- onSpellTargeted fires only for enemy casters and can only block
- strength changes always keep the health percentage; modifiers read ability values live; no removeAbility call
- allocator spends points on kunkka_return, morphling_morph_replicate, morphling_morph_str, ancient_apparition_ice_blast_release, nyx_assassin_unburrow
- a disarmed unit does not walk after its target; OUT interrupts channels; leash not enforced
- controller commits to the highest-priority ready spell even when out of range and does not think during wind-up
- zero-delay timers scheduled inside a timer run in the same tick

Cross-file (heroes_7):
- infinite recursion Abaddon Shard x Blade Mail: heroes_5.mjs:1620 / 1627 (`abShieldTook`) and items.mjs:412 call each other (3 of 28,000 fights). Repro: seed 6062, tinker 9 + abaddon 25 (shard, talents all) vs spirit_breaker 30 (desolator, bkb, abyssal) + antimage 4 (shard, blade_mail), maxTime 62, distance 1395
- heroes_10.mjs:492 `clinkzArcher` uses u.findAbility('clinkz_wind_walk') without a null check
- Clinkz Burning Army with freeSpells: cast every tick, thousands of archers, one fight takes 15-180 s of wall time
