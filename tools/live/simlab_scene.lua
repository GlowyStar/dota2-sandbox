-- simlab scene recorder (temporary file, loaded with `script_reload_code simlab_scene` after simlab_probe).
-- A scene is a small arena next to the demo spawn: units at given offsets, a list of timed orders, and a recorder that writes
-- down every change of health, mana, stats, states, modifiers and position plus every damage instance.
local SL = SimLab
SL.S = SL.S or nil

local function snow() return GameRules:GetGameTime() - SL.S.t0 end
local function r2(x) return math.floor(x * 100 + 0.5) / 100 end
local function sev(e) local S = SL.S e.t = math.floor(snow() * 1000 + 0.5) / 1000 S.ev[#S.ev + 1] = e end
local function tagOf(u)
  if not u or u:IsNull() then return nil end
  local S = SL.S
  local idx = u:entindex()
  if S.byIndex[idx] then return S.byIndex[idx] end
  if not u.GetUnitName then return nil end
  -- units that appeared during the scene (summons, illusions): tagged by owner and unit name
  local owner = u.GetOwnerEntity and u:GetOwnerEntity() or nil
  local otag = owner and not owner:IsNull() and S.byIndex[owner:entindex()] or nil
  return (otag or "?") .. "~" .. u:GetUnitName()
end

-- every unit entity that exists right now (used to tell what a scene created)
local function allUnits()
  local out = {}
  local ok, list = pcall(function()
    return FindUnitsInRadius(DOTA_TEAM_GOODGUYS, Vector(0, 0, 0), nil, FIND_UNITS_EVERYWHERE, DOTA_UNIT_TARGET_TEAM_BOTH, DOTA_UNIT_TARGET_ALL,
      DOTA_UNIT_TARGET_FLAG_INVULNERABLE + DOTA_UNIT_TARGET_FLAG_OUT_OF_WORLD + DOTA_UNIT_TARGET_FLAG_MAGIC_IMMUNE_ENEMIES + DOTA_UNIT_TARGET_FLAG_DEAD, FIND_ANY_ORDER, false)
  end)
  if ok and list then for _, u in ipairs(list) do out[#out + 1] = u end end
  return out
end

-- Removing a hero while things it created are still around has crashed the game once (Spin Web). So: first everything the
-- scene created that is not one of its own units (summons, wards, webs, thinkers), then the scene's non-hero units, and the
-- heroes a moment later.
-- Units are removed the way the Hero Demo mode removes them (Destroy); UTIL_Remove is only the fallback. The client crashed
-- several times while UTIL_Remove took away a hero at the end of a scene (Io, Timbersaw, Meepo, ...).
local function removeUnit(u)
  if not u or u:IsNull() then return end
  local ok = pcall(function() u:Destroy() end)
  if not ok and not u:IsNull() then pcall(function() UTIL_Remove(u) end) end
end

function SL.sceneEnd()
  local S = SL.S
  if not S then return end
  SL.S = nil
  local own = {}
  for _, u in pairs(S.units) do if u and not u:IsNull() then own[u:entindex()] = true end end
  for _, u in ipairs(allUnits()) do
    if u and not u:IsNull() then
      local idx = u:entindex()
      if not S.before[idx] and not own[idx] then removeUnit(u) end
    end
  end
  local heroes = {}
  for _, u in pairs(S.units) do
    if u and not u:IsNull() then
      pcall(function() u:Interrupt() u:Stop() end)
      if u:IsHero() then heroes[#heroes + 1] = u else removeUnit(u) end
    end
  end
  SL.cleaning = (SL.cleaning or 0) + 1
  SL.after(0.25, function()
    for _, u in ipairs(heroes) do removeUnit(u) end
    SL.cleaning = SL.cleaning - 1
  end)
end

-- The arena stays where the demo hero first stood; the player's own hero is parked far away so that it is nobody's nearby ally.
function SL.park()
  local h = PlayerResource:GetSelectedHeroEntity(0)
  if not h then return end
  if not SL.home then SL.home = h:GetAbsOrigin() end
  local far = SL.home + Vector(5200, 4200, 0)
  if (h:GetAbsOrigin() - far):Length2D() > 300 then
    h:SetAbsOrigin(far)
    h:Stop()
    SL.out("PARKED player hero at " .. tostring(far) .. " arena at " .. tostring(SL.home + Vector(0, -1100, 0)))
  end
end

-- Units that were not part of the map when the first scene started and are no scene's own (an archer or ward that a scene's
-- timer created after that scene ended, a crash between scenes) are removed before a new scene starts. Roshan, who stands
-- near the arena, is moved away so that large areas and fears do not reach him.
-- Dead units are left alone: the game removes them itself, and removing one that is still in its death sequence is the
-- likely cause of the client crashes seen after the sweep was added.
local SWEEP_FLAGS = DOTA_UNIT_TARGET_FLAG_INVULNERABLE + DOTA_UNIT_TARGET_FLAG_MAGIC_IMMUNE_ENEMIES + DOTA_UNIT_TARGET_FLAG_OUT_OF_WORLD
function SL.sweep()
  if not SL.home then return end
  local near = FindUnitsInRadius(DOTA_TEAM_GOODGUYS, SL.home, nil, 4500, DOTA_UNIT_TARGET_TEAM_BOTH, DOTA_UNIT_TARGET_ALL, SWEEP_FLAGS, FIND_ANY_ORDER, false)
  if not SL.mapUnits then
    SL.mapUnits = {}
    for _, u in ipairs(near) do SL.mapUnits[u:entindex()] = true end
    SL.out("MAP UNITS " .. #near)
    return
  end
  local player = PlayerResource:GetSelectedHeroEntity(0)
  for _, u in ipairs(near) do
    if u and not u:IsNull() and u:IsAlive() and u ~= player and not SL.mapUnits[u:entindex()] and not u:IsHero() and u:GetUnitName() ~= "npc_dota_courier" then
      SL.out("SWEEP " .. u:GetUnitName())
      removeUnit(u)
    end
    if u and not u:IsNull() and u:GetUnitName() == "npc_dota_roshan" then
      local far = SL.home + Vector(-5200, 4200, 0)
      if (u:GetAbsOrigin() - far):Length2D() > 300 then pcall(function() u:SetAbsOrigin(far) u:Stop() end) end
    end
  end
end

function SL.sceneNew(id)
  SL.sceneEnd()
  SL.park()
  SL.sweep()
  -- scenes run on accelerated game time (the recordings are identical, see docs/LIVE_VERIFICATION.md)
  local ts = SL.timescale or 10
  if math.abs(Convars:GetFloat("host_timescale") - ts) > 0.01 then SendToServerConsole("host_timescale " .. ts) end
  local before = {}
  for _, u in ipairs(allUnits()) do if u and not u:IsNull() then before[u:entindex()] = true end end
  SL.S = { id = id, units = {}, order = {}, byIndex = {}, ev = {}, last = {}, mods = {}, hp = {}, watch = {}, attackers = {}, before = before, t0 = GameRules:GetGameTime(),
    origin = SL.home + Vector(SL.sceneDX or 0, SL.sceneDY or -1100, 0) }
end

-- o: level, abilities = { name = level }, talents = "all" | { names }, scepter, shard, items = { names }, face = { x, y }
function SL.sceneUnit(tag, name, team, x, y, o)
  local S = SL.S; o = o or {}
  local pos = S.origin + Vector(x, y, 0)
  local u = CreateUnitByName(name, pos, false, nil, nil, team == 0 and DOTA_TEAM_GOODGUYS or DOTA_TEAM_BADGUYS)
  if not u then SL.out("ERROR scene unit " .. name) return nil end
  u:SetAbsOrigin(GetGroundPosition(pos, u))
  if u:IsHero() and o.level then SL.setHeroLevel(u, o.level) end
  -- levels are bought point by point with UpgradeAbility, as a player does, so that whatever the game does when an
  -- ability is learned happens (helper abilities levelled with it, orb attributes, ...); SetLevel only if that fails
  for an, lv in pairs(o.abilities or {}) do
    local ab = u:FindAbilityByName(an)
    if ab then
      local guard = 0
      while ab:GetLevel() < lv and guard < 12 do
        local before = ab:GetLevel()
        pcall(function() u:SetAbilityPoints(1) u:UpgradeAbility(ab) end)
        if ab:GetLevel() == before then break end
        guard = guard + 1
      end
      if ab:GetLevel() < lv then ab:SetLevel(lv) end
    else SL.out("WARN no ability " .. an .. " on " .. name) end
  end
  pcall(function() u:SetAbilityPoints(0) end)
  if o.talents == "all" then SL.allTalents(u)
  elseif type(o.talents) == "table" then
    for _, tn in ipairs(o.talents) do local ab = u:FindAbilityByName(tn) if ab then SL.learnTalent(u, ab) else SL.out("WARN no talent " .. tn) end end
  end
  if o.scepter then u:AddItemByName("item_ultimate_scepter") end
  if o.shard then u:AddItemByName("item_aghanims_shard") end
  for _, it in ipairs(o.items or {}) do u:AddItemByName(it) end
  -- charges granted by a talent / upgrade that was just applied start full, as they would be by the time a fight starts
  for _, ab in ipairs(SL.abilities(u)) do pcall(function() ab:RefreshCharges() end) pcall(function() ab:EndCooldown() end) end
  -- attack modifiers with autocast (Searing Arrows, Frost Arrows, Tidebringer, ...) start switched off on a new unit; the
  -- simulator models them switched on, so they are switched on here
  for _, ab in ipairs(SL.abilities(u)) do
    pcall(function()
      local b = ab:GetBehaviorInt()
      if ab:GetLevel() > 0 and bit.band(b, DOTA_ABILITY_BEHAVIOR_AUTOCAST) ~= 0 and bit.band(b, DOTA_ABILITY_BEHAVIOR_ATTACK) ~= 0 and not ab:GetAutoCastState() then
        ab:ToggleAutoCast()
      end
    end)
  end
  -- charges that a just-learned talent grants are set up by the game a moment later: refresh them once more
  SL.after(0.1, function()
    if u:IsNull() then return end
    for _, ab in ipairs(SL.abilities(u)) do pcall(function() ab:RefreshCharges() end) pcall(function() ab:EndCooldown() end) end
  end)
  pcall(function() u:SetIdleAcquire(false) end)
  pcall(function() u:SetAcquisitionRange(0) end)
  pcall(function() u:SetControllableByPlayer(0, true) end)
  if o.face then
    local d = Vector(o.face[1] - x, o.face[2] - y, 0)
    if d:Length2D() > 1 then u:SetForwardVector(d:Normalized()) end
  end
  u:SetHealth(u:GetMaxHealth()); u:SetMana(u:GetMaxMana())
  S.units[tag] = u; S.order[#S.order + 1] = tag; S.byIndex[u:entindex()] = tag
  return u
end

local STATE_FNS = {
  { "stun", function(u) return u:IsStunned() end }, { "silence", function(u) return u:IsSilenced() end }, { "root", function(u) return u:IsRooted() end },
  { "disarm", function(u) return u:IsDisarmed() end }, { "hex", function(u) return u:IsHexed() end }, { "mute", function(u) return u:IsMuted() end },
  { "invuln", function(u) return u:IsInvulnerable() end }, { "immune", function(u) return u:IsDebuffImmune() end }, { "invis", function(u) return u:IsInvisible() end },
  { "break", function(u) return u:PassivesDisabled() end }, { "ethereal", function(u) return u:IsAttackImmune() end }, { "fear", function(u) return u:IsFeared() end },
  { "taunt", function(u) return u:IsTaunted() end }, { "out", function(u) return u:IsOutOfGame() end },
}
local function stateString(u)
  local t = {}
  for _, p in ipairs(STATE_FNS) do local ok, v = pcall(p[2], u) if ok and v then t[#t + 1] = p[1] end end
  return table.concat(t, ",")
end
local function snapshot(u)
  local function g(fn, d) local ok, v = pcall(fn) if ok and v ~= nil then return v end return d end
  local p = u:GetAbsOrigin()
  return {
    alive = u:IsAlive() and 1 or 0, maxHp = u:GetMaxHealth(), maxMana = r2(u:GetMaxMana()),
    ms = r2(g(function() return u:GetIdealSpeed() end, 0)), armor = r2(g(function() return u:GetPhysicalArmorValue(false) end, 0)),
    as = r2(g(function() return u:GetAttackSpeed(false) * 100 end, 0)), dmg = r2(g(function() return u:GetAverageTrueAttackDamage(nil) end, 0)),
    range = r2(g(function() return u:Script_GetAttackRange() end, 0)), mrBase = r2(g(function() return u:GetBaseMagicalResistanceValue() end, 0)),
    evasion = r2(g(function() return u:GetEvasion() end, 0)), statusRes = r2(g(function() return u:GetStatusResistance() end, 0)),
    spellAmp = r2(g(function() return u:GetSpellAmplification(false) end, 0)), hpRegen = r2(g(function() return u:GetHealthRegen() end, 0)),
    manaRegen = r2(g(function() return u:GetManaRegen() end, 0)),
    st = stateString(u), x = math.floor(p.x - SL.S.origin.x + 0.5), y = math.floor(p.y - SL.S.origin.y + 0.5),
  }
end
local function findAbility(u, an)
  local ab = u:FindAbilityByName(an)
  if ab then return ab end
  for i = 0, 16 do local it = u:GetItemInSlot(i) if it and it:GetAbilityName() == an then return it end end
  return nil
end

function SL.sceneSample()
  local S = SL.S
  if not S then return end
  for tag, u in pairs(S.units) do
    if u and not u:IsNull() then
      if not S.attackers[tag] and u:IsAttacking() and not u:IsChanneling() and not u:IsTaunted() then
        ExecuteOrderFromTable({ UnitIndex = u:entindex(), OrderType = DOTA_UNIT_ORDER_STOP, Queue = false })
      end
      local snap = snapshot(u)
      local last = S.last[tag]
      local d = nil
      if not last then d = snap
      else for k, v in pairs(snap) do if last[k] ~= v then d = d or {} d[k] = v end end end
      if d then sev({ k = "s", u = tag, d = d }) end
      S.last[tag] = snap
      -- health and mana: every change that regeneration does not explain, plus a checkpoint twice per second
      local hp = u:GetHealth(); local mana = u:GetMana()
      local hs = S.hp[tag]
      if not hs then
        S.hp[tag] = { hp = hp, mana = mana, n = 0 }
        sev({ k = "h", u = tag, hp = r2(hp), mana = r2(mana) })
      else
        hs.n = hs.n + 1
        local dh = hp - hs.hp; local dm = mana - hs.mana
        local quiet = math.abs(dh) <= math.abs(snap.hpRegen) * 0.05 + 0.6 and math.abs(dm) <= math.abs(snap.manaRegen) * 0.05 + 0.6
        if not quiet or hs.n >= 15 then sev({ k = "h", u = tag, hp = r2(hp), mana = r2(mana) }) hs.n = 0 end
        hs.hp = hp; hs.mana = mana
      end
      -- modifiers
      local seen = {}
      S.mods[tag] = S.mods[tag] or {}
      local mm = S.mods[tag]
      for _, m in ipairs(u:FindAllModifiers()) do
        local key = m:GetName() .. "#" .. tostring(m:GetSerialNumber())
        seen[key] = true
        local stacks = m:GetStackCount()
        if not mm[key] then
          local c = m:GetCaster(); local ab = m:GetAbility()
          mm[key] = { stacks = stacks, born = snow() }
          sev({ k = "m+", u = tag, name = m:GetName(), dur = r2(m:GetDuration()), stacks = stacks, by = tagOf(c), ab = ab and ab:GetAbilityName() or nil, debuff = m:IsDebuff() and 1 or 0 })
        elseif mm[key].stacks ~= stacks then
          mm[key].stacks = stacks
          sev({ k = "ms", u = tag, name = m:GetName(), stacks = stacks })
        end
      end
      for key, info in pairs(mm) do
        if not seen[key] then
          sev({ k = "m-", u = tag, name = (key:gsub("#.*$", "")), life = r2(snow() - info.born) })
          mm[key] = nil
        end
      end
    end
  end
  -- abilities that were ordered: cooldown, charges, toggle, channel, cast phase
  for tag, list in pairs(S.watch) do
    local u = S.units[tag]
    if u and not u:IsNull() then
      for an, w in pairs(list) do
        local ab = findAbility(u, an)
        if ab then
          local cd = r2(ab:GetCooldownTimeRemaining()); local ch = ab:GetCurrentAbilityCharges(); local tg = ab:GetToggleState() and 1 or 0
          local chn = ab:IsChanneling() and 1 or 0; local inph = ab:IsInAbilityPhase() and 1 or 0
          if (cd > 0) ~= (w.cd > 0) or cd > w.cd + 0.001 or ch ~= w.ch or tg ~= w.tg or chn ~= w.chn or inph ~= w.inph then
            sev({ k = "a", u = tag, ab = an, cd = cd, charges = ch, toggle = tg, channel = chn, phase = inph })
          end
          w.cd = cd; w.ch = ch; w.tg = tg; w.chn = chn; w.inph = inph
        end
      end
    end
  end
end

function SL.sceneOrder(tag, o)
  local S = SL.S
  local u = S.units[tag]
  if not u or u:IsNull() then SL.out("WARN order for missing unit " .. tostring(tag)) return end
  local t = { UnitIndex = u:entindex(), Queue = false }
  if o.type == "cast" then
    local ab = findAbility(u, o.ability)
    if not ab then sev({ k = "order_failed", u = tag, why = "no ability " .. tostring(o.ability) }) return end
    S.watch[tag] = S.watch[tag] or {}
    if not S.watch[tag][o.ability] then S.watch[tag][o.ability] = { cd = 0, ch = ab:GetCurrentAbilityCharges(), tg = 0, chn = 0, inph = 0 } end
    t.AbilityIndex = ab:entindex()
    if o.target then
      local tu = S.units[o.target]
      t.OrderType = DOTA_UNIT_ORDER_CAST_TARGET; t.TargetIndex = tu and tu:entindex() or -1
    elseif o.pos then
      t.OrderType = DOTA_UNIT_ORDER_CAST_POSITION; t.Position = S.origin + Vector(o.pos[1], o.pos[2], 0)
    elseif o.toggle then t.OrderType = DOTA_UNIT_ORDER_CAST_TOGGLE
    else t.OrderType = DOTA_UNIT_ORDER_CAST_NO_TARGET end
    sev({ k = "order", u = tag, type = "cast", ab = o.ability, mana = r2(u:GetMana()), ready = ab:IsFullyCastable() and 1 or 0, level = ab:GetLevel(),
      manaCost = ab:GetManaCost(-1), cdFull = r2(ab:GetEffectiveCooldown(-1)), castPoint = r2(ab:GetCastPoint()) })
  elseif o.type == "attack" then
    local tu = S.units[o.target]
    t.OrderType = DOTA_UNIT_ORDER_ATTACK_TARGET; t.TargetIndex = tu and tu:entindex() or -1
    S.attackers[tag] = true
    sev({ k = "order", u = tag, type = "attack", target = o.target })
  elseif o.type == "move" then
    t.OrderType = DOTA_UNIT_ORDER_MOVE_TO_POSITION; t.Position = S.origin + Vector(o.pos[1], o.pos[2], 0)
    sev({ k = "order", u = tag, type = "move" })
  elseif o.type == "stop" then t.OrderType = DOTA_UNIT_ORDER_STOP S.attackers[tag] = nil sev({ k = "order", u = tag, type = "stop" })
  elseif o.type == "hold" then t.OrderType = DOTA_UNIT_ORDER_HOLD_POSITION sev({ k = "order", u = tag, type = "hold" })
  end
  ExecuteOrderFromTable(t)
end

-- actions: { { time, fn }, ... } on scene time; the record is printed `duration` seconds after the start
function SL.sceneGo(actions, duration)
  local S = SL.S
  S.t0 = GameRules:GetGameTime()
  -- the match clock of the demo (neutral creeps and Roshan grow with it; the demo runs for hours)
  pcall(function() S.clock = GameRules:GetDOTATime(false, false) end)
  local id = S.id
  local gm = GameRules:GetGameModeEntity()
  if not SL.hurtListener then
    SL.hurtListener = ListenToGameEvent("entity_hurt", function(e)
      local S2 = SL.S
      if not S2 then return end
      local v = e.entindex_killed and EntIndexToHScript(e.entindex_killed) or nil
      local a = e.entindex_attacker and EntIndexToHScript(e.entindex_attacker) or nil
      local inf = e.entindex_inflictor and EntIndexToHScript(e.entindex_inflictor) or nil
      local vt = tagOf(v)
      if not vt then return end
      sev({ k = "dmg", to = vt, by = tagOf(a), ab = inf and inf.GetAbilityName and inf:GetAbilityName() or nil, v = r2(e.damage or 0), hp = v and r2(v:GetHealth()) or nil })
    end, nil)
  end
  gm:SetDamageFilter(function(_, e)
    local S2 = SL.S
    if S2 then
      local v = e.entindex_victim_const and EntIndexToHScript(e.entindex_victim_const) or nil
      local a = e.entindex_attacker_const and EntIndexToHScript(e.entindex_attacker_const) or nil
      local inf = e.entindex_inflictor_const and EntIndexToHScript(e.entindex_inflictor_const) or nil
      local vt = tagOf(v)
      if vt then sev({ k = "df", to = vt, by = tagOf(a), ab = inf and inf.GetAbilityName and inf:GetAbilityName() or nil, v = r2(e.damage or 0), type = e.damagetype_const }) end
    end
    return true
  end, SL)
  for _, a in ipairs(actions) do
    SL.after(a[1], function() if SL.S and SL.S.id == id then a[2]() end end)
  end
  gm:SetContextThink("SimLabScene", function()
    local S2 = SL.S
    if not S2 or S2.id ~= id then return nil end
    local ok, err = pcall(SL.sceneSample)
    if not ok then SL.out("ERROR sample " .. tostring(err)) end
    if snow() >= duration then
      local units = {}
      for tag, u in pairs(S2.units) do
        if u and not u:IsNull() then units[tag] = { name = u:GetUnitName(), team = u:GetTeamNumber() == DOTA_TEAM_GOODGUYS and 0 or 1, level = u:GetLevel() } end
      end
      SL.record("T." .. id, { id = id, units = units, duration = duration, ev = S2.ev, clock = S2.clock })
      SL.sceneEnd()
      SL.after(0.4, function() SL.out("SCENE_DONE " .. id) end)
      return nil
    end
    return 0.0001
  end, 0)
end

SL.out("SCENE_LOADED")
