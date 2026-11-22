# Verifying the simulator against the live game

The running game (Hero Demo) is the reference. A *scene* is a small arena: units at given positions, timed orders, a fixed
duration. The same scene is recorded in the game and in the simulator and the two recordings are compared by what happened:
cast orders (castable or not, mana cost, cooldown, cast point), every damage instance (time and amount after reductions),
state intervals (stun, silence, root, ...), stat timelines (speed, armor, attack speed, damage, range, ...), mana spent, positions.

**What must match exactly:** damage numbers and the number of damage instances, effect values, durations, cooldowns, mana costs,
states, stat changes, tick intervals of periodic effects. **What may differ:** pure animation (cast backswing, projectile art).
Travel times of projectiles and waves should match when it is cheap to do (speed is usually a data value) but are second priority.

## Tools

```
node tools/live/compare_all.mjs --hero <hero>            every recorded scene of the hero: live recording vs simulator (no game needed)
node tools/live/compare_all.mjs --only <scene id>        one scene
python tools/live/verify.py <spec.json> --events         record a scene of your own in the live game (through the broker, cached)
                                                          and compare; --events prints both timelines; --unit t limits them to one unit
node tools/live/sim_scene.mjs <spec.json>                the simulator side alone (JSON)
python tools/live/rawkv.py <ability> [regex]             the raw game definition of an ability
node tools/digest.mjs <hero>                             values per level, tooltips
```

Recorded data (read-only):

- `tools/live/specs/auto/<ability>[.tal|.sc|.sh].json`: one scene per ability and variant (base, all talents, Scepter, Shard).
- `tools/live/out/scenes/<id>.live.json`: its live recording.
- `tools/live/out/values_live.json`: every ability value as the game resolves it (`GetSpecialValueFor`), per level, for five setups:
  `A` level 1, `B` level 30, `C` level 30 + all talents, `D` level 30 + Scepter, `E` level 30 + Shard; also cooldown, mana cost, cast point.
- `tools/live/out/static_live.json`: hero stats at every level, the levels abilities have on an untouched hero, level links.

## Scene spec

```json
{ "id": "lina_ds",
  "units": [
    { "tag": "c", "name": "npc_dota_hero_lina", "team": 0, "x": 0, "y": 0, "level": 30,
      "abilities": { "lina_dragon_slave": 4 }, "talents": ["special_bonus_unique_lina_1"], "scepter": false, "shard": false,
      "items": ["item_black_king_bar"], "face": [400, 0] },
    { "tag": "t", "name": "npc_dota_hero_target_dummy", "team": 1, "x": 400, "y": 0 },
    { "tag": "k", "name": "npc_dota_creep_badguys_melee", "team": 1, "x": 400, "y": 150 } ],
  "actions": [
    { "t": 0.5, "unit": "c", "type": "cast", "ability": "lina_dragon_slave", "target": "t" },
    { "t": 2.0, "unit": "c", "type": "cast", "ability": "lina_light_strike_array", "pos": [400, 0] },
    { "t": 4.0, "unit": "c", "type": "attack", "target": "t" } ],
  "duration": 8.0 }
```

- `team` 0 / 1; `x`, `y` are offsets inside the arena (keep everything within about 1500 of the centre); `face` is the point a unit looks at.
- `abilities` lists the learned abilities with their levels (everything else stays unlearned; innate abilities are there anyway).
  `talents` is `"all"` or a list of talent names. `scepter` / `shard` give the items. Heroes only get the level asked for.
- Action types: `cast` (with `target` = unit tag, or `pos`, or `toggle: true`, or nothing for no-target abilities), `attack`, `move`, `stop`, `hold`.
- A unit that was not ordered to attack does not attack (in the game it is stopped when it starts to; the simulator's units idle).
- `npc_dota_hero_target_dummy` is a hero with 5620 health, 0 armor, 25% magic resistance, no attack damage; it cannot die, and its
  health is back at the maximum one server tick after any damage (both measured; the simulator does the same in scenes).
- Units start fresh: stacks that build over time start at zero (the simulator runs scenes with `rules.fresh`).
- How the recorder sets up a unit (recorder version 3): abilities are bought point by point with `UpgradeAbility` and talents are
  learned the same way, as a player does (`SetLevel` alone skips what the game does when an ability is learned: Lina's Slow Burn
  talent kept the old duration, Alchemist's Concoction throw stayed at level 1); charges are refreshed right away and again 0.1 s
  later (a talent that grants charges sets them up a moment after it is learned); autocast of attack modifiers (Searing Arrows,
  Frost Arrows, Tidebringer, Arcane Orb, ...) is switched on, because the simulator models them switched on.
- Limits: 14 units, 90 s. Keep your own specs in `tools/live/specs/<your file name>/` so that they stay as regression scenes.

## Reading a comparison

```
axe_battle_hunger (cast): score 86
  [damage count] t: 25 damage instances in the game (total 300.0), 12 in the simulator (total 288.0)
  [damage] t: hit #1 at 0.80 s (axe_battle_hunger): live 12, sim 24
```

`t`, `c` are unit tags. Damage values are after armor / magic resistance, before rounding. Plain attacks roll their damage, so single
attacks are compared loosely and their average tightly. Chance-based effects (crits, bashes) cannot match hit by hit: check their
numbers on the hits where they occur, and their frequency over a long scene (60 s or more).

The live side is not perfect either. Known artifacts: the demo map has trees near the arena (Treant, Hoodwink, Monkey King,
Nature's Prophet); Roshan stands near the arena and can be hit by large areas; the demo runs its own day / night cycle (scenes
start just after sunrise); `mrBase` is the base magic resistance only. If a difference looks like an artifact, say so in the
report instead of bending the script to it.

## Running the live side (coordinator only)

```
python tools/live/session.py ensure | status | quit   start Hero Demo and load the recorder / check it / close the game
python tools/live/broker.py                           serves scene requests from workers one at a time (queue: tools/live/queue)
python tools/live/record_all.py [dir ...]             records every spec directory, restarts the demo when the client goes down
python tools/live/run_specs.py --dir <dir> [--match x] [--only id,id] [--redo] [--later]
python tools/live/channel.py reload | resync | cleanup reload the recorder after an edit / fix the job counter / remove our files
```

- A recording is current when it was made from the same spec by the current recorder version (`RECORDER` in `run_specs.py`,
  mirrored in the broker's cache key). Raising the version re-records everything.
- Scenes during which the client went down are listed in `out/crashers.txt` and skipped; `out/later.txt` holds scenes kept for the
  end of a session; `blocked.json` names units and ability prefixes the broker refuses (Timbersaw scenes crashed the client twice).
- The batch hands the game to the broker after every scene while requests are waiting. Requests nobody waits for (older than
  10 minutes) are dropped.
- Files written into the game folder: `game/dota/scripts/vscripts/simlab_*.lua` and `game/dota/cfg/simlab_q*.cfg`;
  `channel.py cleanup` removes them.

## Rules for script changes

1. The live game wins over the tooltip. Numbers still come from the data through `ab.v('name')`; a literal is allowed only for a
   fact measured in the live game that the data does not contain, with a comment `// [L] measured in Hero Demo: ...`.
2. Edit only the script file you were given. If the engine cannot express something, work around it in the script and list the gap.
3. Do not make a scene match by special-casing the dummy or the scene: model the mechanic.
4. `node tests/run.mjs` and `node tools/hero_check.mjs <your heroes>` must stay green.
5. Update `fid` / `note` of an ability when its model changes: `full` now means "matches the live game in the recorded scenes".
