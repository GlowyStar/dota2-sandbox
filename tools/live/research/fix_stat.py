import io
p='simlab_probe.lua'
s=io.open(p,encoding='utf-8',newline='').read()
a=s.index("function SL.statDump(u)")
b=s.index("-- learn every talent of a hero")
new='''function SL.statDump(u)
  -- every getter is tried on its own: a missing or differently shaped API call yields nil instead of an error
  local function g(fn) local ok, v = pcall(fn) if ok then return v end return nil end
  return {
    level = u:GetLevel(), str = g(function() return u:GetStrength() end), agi = g(function() return u:GetAgility() end), int = g(function() return u:GetIntellect(false) end),
    hp = u:GetMaxHealth(), mana = u:GetMaxMana(), hpRegen = g(function() return u:GetHealthRegen() end), manaRegen = g(function() return u:GetManaRegen() end),
    armor = g(function() return u:GetPhysicalArmorValue(false) end),
    mr = g(function() return u:Script_GetMagicalArmorValue(false) end), mrBase = g(function() return u:GetBaseMagicalResistanceValue() end),
    dmgMin = g(function() return u:GetBaseDamageMin() end), dmgMax = g(function() return u:GetBaseDamageMax() end), dmgAvg = g(function() return u:GetAverageTrueAttackDamage(nil) end),
    as = g(function() return u:GetDisplayAttackSpeed() end), bat = g(function() return u:GetBaseAttackTime() end), spa = g(function() return u:GetSecondsPerAttack(false) end),
    range = g(function() return u:Script_GetAttackRange() end), ms = g(function() return u:GetIdealSpeed() end), baseMs = g(function() return u:GetBaseMoveSpeed() end),
    evasion = g(function() return u:GetEvasion() end), statusRes = g(function() return u:GetStatusResistance() end), spellAmp = g(function() return u:GetSpellAmplification(false) end),
    castRange = g(function() return u:GetCastRangeBonus() end), cdr = g(function() return u:GetCooldownReduction() end),
  }
end

'''
s=s[:a]+new+s[b:]
io.open(p,'w',encoding='utf-8',newline='').write(s)
print('ok')
