-- simlab probe (temporary file used to compare the sandbox simulator with the live game in Hero Demo).
-- Loaded with the console command:  script_reload_code simlab_probe
-- It polls cfg/simlab_q<N>.cfg; a batch file runs `script_reload_code simlab_job` and then `sl_done <N>`.
-- Everything it reports is printed with the prefix "SL|" and ends up in console.log. Safe to delete at any time.
if SimLab == nil then SimLab = { next = 1, loaded = 0, units = {} } end
local SL = SimLab
SL.loaded = SL.loaded + 1
SL.units = SL.units or {}

function SL.out(s) print("SL|" .. s) end

-- ---------------------------------------------------------------- JSON (numbers, strings, booleans, arrays, maps)
local function jstr(s)
  return '"' .. tostring(s):gsub('[%c"\\]', function(c) return string.format("\\u%04x", string.byte(c)) end) .. '"'
end
function SL.json(v)
  local t = type(v)
  if t == "number" then
    if v ~= v or v == math.huge or v == -math.huge then return "null" end
    if v == math.floor(v) and math.abs(v) < 1e15 then return string.format("%d", v) end
    return string.format("%.6g", v)
  elseif t == "boolean" then return v and "true" or "false"
  elseif t == "string" then return jstr(v)
  elseif t == "table" then
    local n = #v
    local isArr = n > 0
    if isArr then for k in pairs(v) do if type(k) ~= "number" then isArr = false break end end end
    local parts = {}
    if isArr then
      for i = 1, n do parts[#parts + 1] = SL.json(v[i]) end
      return "[" .. table.concat(parts, ",") .. "]"
    end
    local keys = {}
    for k in pairs(v) do keys[#keys + 1] = tostring(k) end
    table.sort(keys)
    for _, k in ipairs(keys) do
      local val = v[k]; if val == nil then val = v[tonumber(k)] end
      parts[#parts + 1] = jstr(k) .. ":" .. SL.json(val)
    end
    return "{" .. table.concat(parts, ",") .. "}"
  end
  return "null"
end
-- long records are split over several log lines: SL|R <id> <part> <of> <text>
function SL.record(id, tbl)
  local s = SL.json(tbl)
  local size = 900
  local parts = math.max(1, math.ceil(#s / size))
  for i = 1, parts do SL.out(string.format("R %s %d %d %s", id, i, parts, s:sub((i - 1) * size + 1, i * size))) end
end

-- ---------------------------------------------------------------- command channel
if not SL.commands then
  SL.commands = true
  Convars:RegisterCommand("sl_done", function(_, n)
    n = tonumber(n) or 0
    if n >= SL.next then SL.next = n + 1 end
    SL.out("DONE " .. n)
  end, "simlab: batch finished", 0)
end
function SL.poll()
  SendToServerConsole("exec simlab_q" .. SL.next)
  return 0.1
end
GameRules:GetGameModeEntity():SetContextThink("SimLabPoll", function() return SL.poll() end, 0.1)

-- run a function, report errors instead of breaking the poll loop
function SL.try(name, fn)
  local ok, err = pcall(fn)
  if not ok then SL.out("ERROR " .. name .. " " .. tostring(err)) end
end

-- deferred call on game time
function SL.after(delay, fn)
  local key = "SimLabT" .. tostring(math.random(1, 1e9))
  GameRules:GetGameModeEntity():SetContextThink(key, function() SL.try("timer", fn) return nil end, delay)
end

SL.out("PROBE_LOADED " .. SL.loaded .. " next=" .. SL.next .. " map=" .. GetMapName() .. " t=" .. string.format("%.2f", GameRules:GetGameTime()))

-- ---------------------------------------------------------------- units
function SL.base()
  local h = PlayerResource:GetSelectedHeroEntity(0)
  return h:GetAbsOrigin()
end
function SL.spawn(name, team, dx, dy)
  local p = SL.base() + Vector(dx or 400, dy or 0, 0)
  local u = CreateUnitByName(name, p, true, nil, nil, team or DOTA_TEAM_BADGUYS)
  if u then SL.units[#SL.units + 1] = u end
  return u
end
function SL.clear()
  for _, u in ipairs(SL.units) do if u and not u:IsNull() then UTIL_Remove(u) end end
  SL.units = {}
end
function SL.setHeroLevel(u, level)
  local guard = 0
  while u:GetLevel() < level and guard < 40 do u:HeroLevelUp(false) guard = guard + 1 end
end
local function isTalent(name) return name:sub(1, 14) == "special_bonus_" end
function SL.abilities(u)
  local out = {}
  for i = 0, u:GetAbilityCount() - 1 do
    local ab = u:GetAbilityByIndex(i)
    if ab then out[#out + 1] = ab end
  end
  return out
end

-- ---------------------------------------------------------------- static values of every ability of a unit
-- For each ability and each of its levels: cooldown, mana cost and every AbilityValues entry as the game resolves it right now
-- (talents, Scepter, Shard and hero-level scaling included).
function SL.valueDump(u)
  local res = {}
  for _, ab in ipairs(SL.abilities(u)) do
    local name = ab:GetAbilityName()
    if not isTalent(name) and name ~= "generic_hidden" then
      local kv = ab:GetAbilityKeyValues()
      local names = {}
      if kv and type(kv.AbilityValues) == "table" then for k in pairs(kv.AbilityValues) do names[#names + 1] = k end end
      local maxL = ab:GetMaxLevel()
      local keep = ab:GetLevel()
      local levels = {}
      for L = 1, maxL do
        ab:SetLevel(L)
        local vals = {}
        for _, k in ipairs(names) do vals[k] = ab:GetSpecialValueFor(k) end
        levels[L] = { cd = ab:GetCooldown(L - 1), ecd = ab:GetEffectiveCooldown(L - 1), mc = ab:GetManaCost(L - 1), cr = ab:GetCastRange(u:GetAbsOrigin(), nil), cp = ab:GetCastPoint(), ch = ab:GetChannelTime(), v = vals }
      end
      ab:SetLevel(keep)
      res[name] = { max = maxL, cur = keep, hidden = ab:IsHidden(), passive = ab:IsPassive(), lv = levels }
    end
  end
  return res
end

function SL.statDump(u)
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

-- learn every talent of a hero
-- A talent is learned the way a player learns it (a skill point spent through UpgradeAbility). Measured: a talent that is
-- only set to level 1 resolves its values, but effects the game applies when a talent is learned are missing (Lina's
-- Slow Burn duration talent: the debuff kept its old length).
function SL.learnTalent(u, ab)
  if ab:GetLevel() >= 1 then return end
  local pts = 0
  pcall(function() pts = u:GetAbilityPoints() end)
  pcall(function() u:SetAbilityPoints(1) u:UpgradeAbility(ab) end)
  if ab:GetLevel() < 1 then ab:SetLevel(1) end
  pcall(function() u:SetAbilityPoints(pts) end)
end

function SL.allTalents(u)
  for _, ab in ipairs(SL.abilities(u)) do if isTalent(ab:GetAbilityName()) then SL.learnTalent(u, ab) end end
end

-- Variants: A level 1; B level 30; C level 30 + all talents; D level 30 + Scepter; E level 30 + Shard.
-- Each variant uses a fresh unit so that nothing carries over.
function SL.heroValues(name)
  local variants = {
    { "A", 1, false, false, false }, { "B", 30, false, false, false }, { "C", 30, true, false, false },
    { "D", 30, false, true, false }, { "E", 30, false, false, true },
  }
  for _, v in ipairs(variants) do
    local u = SL.spawn(name, DOTA_TEAM_BADGUYS, 600, 0)
    if not u then SL.out("ERROR spawn " .. name) return end
    SL.setHeroLevel(u, v[2])
    if v[3] then SL.allTalents(u) end
    if v[4] then u:AddItemByName("item_ultimate_scepter") end
    if v[5] then u:AddItemByName("item_aghanims_shard") end
    local rec = { hero = name, variant = v[1], level = u:GetLevel(), scepter = u:HasScepter(), shard = u:HasModifier("modifier_item_aghanims_shard"), stats = SL.statDump(u), abilities = SL.valueDump(u) }
    SL.record("V." .. name .. "." .. v[1], rec)
    UTIL_Remove(u)
  end
  SL.units = {}
  SL.out("VALUES_DONE " .. name)
end

-- ---------------------------------------------------------------- second static pass: stats by level, auto levels, level links
local function levelsOf(u)
  local t = {}
  for _, ab in ipairs(SL.abilities(u)) do local n = ab:GetAbilityName() if not isTalent(n) and n ~= "generic_hidden" then t[n] = ab:GetLevel() end end
  return t
end
-- per-ability facts that do not need a level change
local function metaOf(u)
  local t = {}
  local function g(fn) local ok, v = pcall(fn) if ok then return v end return nil end
  for _, ab in ipairs(SL.abilities(u)) do
    local n = ab:GetAbilityName()
    if not isTalent(n) and n ~= "generic_hidden" then
      t[n] = { max = ab:GetMaxLevel(), hidden = ab:IsHidden(), passive = ab:IsPassive(), toggle = g(function() return ab:IsToggle() end),
        behavior = g(function() return tostring(ab:GetBehaviorInt()) end), dmgType = g(function() return ab:GetAbilityDamageType() end),
        targetTeam = g(function() return ab:GetAbilityTargetTeam() end), targetType = g(function() return ab:GetAbilityTargetType() end),
        stealable = g(function() return ab:IsStealable() end), index = ab:GetAbilityIndex() }
    end
  end
  return t
end

-- Stats of a hero at several levels (units are left alone for `settle` seconds first, so that innate effects are in place),
-- the levels abilities have on an untouched hero, and what happens to the other abilities when one ability is levelled.
function SL.heroStatic(name, settle)
  local levels = {}
  for L = 1, 30 do levels[#levels + 1] = L end
  local units = {}
  for i, L in ipairs(levels) do
    local u = SL.spawn(name, DOTA_TEAM_BADGUYS, 300 + (i % 6) * 140, -600 + math.floor(i / 6) * 140)
    if not u then SL.out("ERROR spawn " .. name) return end
    SL.setHeroLevel(u, L)
    units[#units + 1] = { L, u }
  end
  SL.after(settle or 1.0, function()
    local stats = {}
    for _, p in ipairs(units) do stats[#stats + 1] = SL.statDump(p[2]) end
    local fresh1 = levelsOf(units[1][2]); local fresh30 = levelsOf(units[#units][2])
    local meta = metaOf(units[#units][2])
    -- level links: on a fresh level 30 unit set one ability to each of its levels and note every other ability whose level moved
    local links = {}
    local names = {}
    for n in pairs(fresh30) do names[#names + 1] = n end
    table.sort(names)
    for _, n in ipairs(names) do
      local u = SL.spawn(name, DOTA_TEAM_BADGUYS, 300, 900)
      SL.setHeroLevel(u, 30)
      local ab = u:FindAbilityByName(n)
      if ab and ab:GetMaxLevel() > 0 then
        local base = levelsOf(u)
        local per = {}
        for L = 1, ab:GetMaxLevel() do
          ab:SetLevel(L)
          local now = levelsOf(u); local moved = {}; local any = false
          for k, v in pairs(now) do if k ~= n and v ~= base[k] then moved[k] = v any = true end end
          if any then per[tostring(L)] = moved end
        end
        if next(per) ~= nil then links[n] = per end
      end
      UTIL_Remove(u)
    end
    SL.record("S." .. name, { hero = name, stats = stats, fresh1 = fresh1, fresh30 = fresh30, meta = meta, links = links })
    for _, p in ipairs(units) do UTIL_Remove(p[2]) end
    SL.units = {}
    SL.out("STATIC_DONE " .. name)
  end)
end
