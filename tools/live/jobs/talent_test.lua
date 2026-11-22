-- does learning a talent with UpgradeAbility behave differently from SetLevel(1)?
SL.sceneNew('talent_test')
local c = SL.sceneUnit('c', 'npc_dota_hero_lina', 0, 0, 0, { level = 30, abilities = { lina_laguna_blade = 3 }, face = { 400, 0 } })
SL.sceneUnit('t', 'npc_dota_hero_target_dummy', 1, 400, 0, {})
local n = 0
for _, ab in ipairs(SL.abilities(c)) do
  local name = ab:GetAbilityName()
  if name:sub(1, 14) == 'special_bonus_' and name ~= 'special_bonus_attributes' then
    c:SetAbilityPoints(1)
    local ok, err = pcall(function() c:UpgradeAbility(ab) end)
    n = n + 1
    SL.out('talent ' .. name .. ' level ' .. ab:GetLevel() .. ' ok ' .. tostring(ok))
  end
end
local sb = c:FindAbilityByName('lina_slow_burn')
SL.out('slow burn duration value ' .. sb:GetSpecialValueFor('burn_duration') .. ' pct ' .. sb:GetSpecialValueFor('burn_damage_pct'))
SL.sceneGo({ { 0.5, function() SL.sceneOrder('c', { type = 'cast', ability = 'lina_laguna_blade', target = 't' }) end } }, 8.0)
