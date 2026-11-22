# Assignment: make your script file match the live game

The user needs the sandbox to give the game's exact numbers: damage, effect values, durations, cooldowns, mana costs, states,
stat changes, tick intervals. Animations may be simplified. The running game (Hero Demo on this PC) is the reference; a broker
records scenes in it on request. Read first:

- `docs/LIVE_VERIFICATION.md`: the tools, the scene format, how to read a comparison, rules for script changes.
- `docs/AUTHORING.md`: the script DSL and the engine rules.

## What to do

For every hero (or item / unit ability) of your file:

1. `node tools/live/compare_all.mjs --hero <hero>` lists the recorded scenes (one per ability, plus variants with all talents,
   Scepter, Shard) and every difference between the live recording and the simulator. Start with the highest scores.
2. For each difference find the cause (`python tools/live/verify.py tools/live/specs/auto/<id>.json --events` prints both
   timelines side by side) and fix your script so that the simulator does what the game does.
3. Where the recorded scene does not exercise a mechanic that matters for numbers, write your own scene and verify it the same
   way. Keep them in `tools/live/specs/<your file name without .mjs>/`. Worth a scene of its own: a creep target when the
   ability treats creeps differently, several targets for bounces / splits / per-target scaling, an allied target, the second
   cast of a stacking or charge ability, a single talent that changes behaviour, the interaction with debuff immunity when the
   data says the ability pierces or not. Do not write more than the mechanics need.
4. Hero stats: `node tools/live/compare_stats.mjs --hero <hero>` compares the hero at every level (nothing skilled, one second
   after it appeared) with the game. Innate abilities are the usual cause of a difference.
5. Finish when every scene of your heroes reports MATCH or you can say exactly why it does not (a missing engine feature,
   randomness, an artifact of the live side such as nearby trees).

## Things that changed in the engine today (they affect your file)

- `ab.v('name')` now includes the owner's area bonus for the values the game flags as area-scaled (`ab.def.aoe`), exactly like
  the game's own lookup. `world.enemiesInRadius` / `enemiesNear` use the radius as given. All manual `+ u.aoeBonus` additions
  were removed from the scripts mechanically; do not add them back. A percentage area bonus is the stat `aoePct`.
- Skill points, attribute bonuses, max levels and the levels of linked / helper abilities now follow the live game
  (`data/live_facts.json`). A script does not need to repair levels.
- Health and mana come from whole points of strength / intelligence; attack damage from whole attribute points. Put attribute
  bonuses into `str` / `agi` / `int` (not into `hp`, `dmg` directly) so that the same rounding applies.
- Mana costs are rounded down to whole numbers. With charges, the pause between uses comes from the live game.
- Scenes run with `rules.fresh`: stacks that build up over time start at zero (`world.fresh` is true); a script that starts a
  hero "fully stacked" must start at zero when `world.fresh` is set.

## Rules

- Edit only your own script file, and files you create under `tools/live/specs/<your file>/`. Never edit `src/engine/*`, the
  tools, tests, other script files or anything in the game folder. Other people are editing the other script files at the same
  time: keep your file loadable at every moment (`node --check <file>` after each edit); if a tool fails because another file
  is broken, wait a few seconds and run it again.
- The live game wins over the tooltip and over what you remember. Do not special-case the dummy or a scene.
- Use only the tools named here to reach the game. If `verify.py` says the broker is not answering, go on with the recorded
  scenes and say so in the report.
- `node tests/run.mjs` and `node tools/hero_check.mjs <your heroes>` (or `tools/unit_check.mjs` for items / units) must pass at the end.

## Report (your final message)

Per hero: scenes matching / total, what you changed (one line per ability), and every remaining difference with its reason.
Then: engine features you needed and did not have (each with the abilities it blocks), facts about the live game that contradict
the data files or tooltips, and anything in other files you noticed. State plainly what you did not verify.
