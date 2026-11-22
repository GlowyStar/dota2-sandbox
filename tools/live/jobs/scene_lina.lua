SL.sceneNew('lina_ds')
SL.sceneUnit('c', 'npc_dota_hero_lina', 0, 0, 0, { level = 10, abilities = { lina_dragon_slave = 4, lina_light_strike_array = 4 }, face = { 400, 0 } })
SL.sceneUnit('t', 'npc_dota_hero_target_dummy', 1, 400, 0, {})
SL.sceneGo({
  { 0.5, function() SL.sceneOrder('c', { type = 'cast', ability = 'lina_dragon_slave', target = 't' }) end },
  { 2.0, function() SL.sceneOrder('c', { type = 'cast', ability = 'lina_light_strike_array', pos = { 400, 0 } }) end },
}, 5.0)
