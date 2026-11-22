// Compiles the game's shipped data (scripts/npc KeyValues + English localization) into data/gamedata.json.
// Source of truth = the installed game's pak01_dir.vpk (read-only), or a folder with extracted files.
import fs from 'node:fs';
import path from 'node:path';
import { Vpk, FolderSource } from './vpk.mjs';
import { parseKV, parseKVBuffer, decodeText } from './kv.mjs';

const STD_KEYS = ['AbilityCooldown', 'AbilityManaCost', 'AbilityCastRange', 'AbilityCastPoint', 'AbilityChannelTime',
  'AbilityDuration', 'AbilityDamage', 'AbilityCharges', 'AbilityChargeRestoreTime', 'AbilityHealthCost'];

const HULLS = { DOTA_HULL_SIZE_SMALL: 8, DOTA_HULL_SIZE_REGULAR: 16, DOTA_HULL_SIZE_SIEGE: 16, DOTA_HULL_SIZE_HERO: 24,
  DOTA_HULL_SIZE_HUGE: 80, DOTA_HULL_SIZE_BUILDING: 81, DOTA_HULL_SIZE_FILLER: 96, DOTA_HULL_SIZE_BARRACKS: 144,
  DOTA_HULL_SIZE_TOWER: 144 };

export function locateGameDir(explicit) {
  const cands = [];
  if (explicit) cands.push(explicit);
  if (process.env.DOTA2_DIR) cands.push(process.env.DOTA2_DIR);
  const steamRoots = ['C:/Program Files (x86)/Steam', 'C:/Program Files/Steam', 'D:/Steam', 'D:/SteamLibrary', 'E:/SteamLibrary'];
  for (const root of steamRoots) {
    const lib = path.join(root, 'steamapps', 'libraryfolders.vdf');
    if (!fs.existsSync(lib)) continue;
    try {
      const kv = parseKV(fs.readFileSync(lib, 'utf8'));
      for (const v of Object.values(kv.libraryfolders || {})) if (v && v.path) cands.push(path.join(v.path, 'steamapps/common/dota 2 beta/game/dota'));
    } catch { /* ignore unreadable library file */ }
    cands.push(path.join(root, 'steamapps/common/dota 2 beta/game/dota'));
  }
  for (const c of cands) {
    if (fs.existsSync(path.join(c, 'pak01_dir.vpk'))) return c;
    if (fs.existsSync(path.join(c, 'game/dota/pak01_dir.vpk'))) return path.join(c, 'game/dota');
  }
  return null;
}

const num = (s) => {
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
};

function parseNumList(s) {
  if (typeof s !== 'string') return null;
  const parts = s.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return null;
  const out = [];
  for (const p of parts) {
    const n = num(p.replace(/f$/, ''));
    if (n === null) return null;
    out.push(n);
  }
  return out;
}

// "+10" "-1" "=600" "x3" "+25%" "-100%" "+-10" "6 12 18 24" "=10 =25 =40" -> [op, pct, values[]]
function parseMod(s) {
  if (typeof s !== 'string') return null;
  const parts = s.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return null;
  let op = null;
  let pct = false;
  const vals = [];
  for (const p of parts) {
    const m = /^([+\-=x]?)(-?[\d.]+)(%?)$/.exec(p);
    if (!m) return null;
    let o = m[1] || '+';
    let v = Number(m[2]);
    if (!Number.isFinite(v)) return null;
    if (o === '-') { o = '+'; v = -v; }
    if (op === null) op = o;
    if (m[3]) pct = true;
    vals.push(v);
  }
  return [op, pct ? 1 : 0, vals];
}

function compileValues(def) {
  const vals = {};
  const put = (name, raw) => {
    if (raw === undefined || raw === null) return;
    if (typeof raw === 'string') {
      const v = parseNumList(raw);
      if (v) vals[name] = v;
      return;
    }
    if (typeof raw !== 'object') return;
    const base = parseNumList(raw.value ?? '0') || [0];
    const entry = { v: base };
    for (const [k, mv] of Object.entries(raw)) {
      if (k === 'value') continue;
      if (k.startsWith('special_bonus_facet_')) continue; // facets were removed from the game in 7.41
      if (k === 'special_bonus_scepter' || k === 'special_bonus_shard') {
        const m = parseMod(mv);
        if (m) entry[k === 'special_bonus_scepter' ? 'sc' : 'sh'] = m;
      } else if (/^special_bonus_(scepter|shard)_\d+$/.test(k)) {
        const m = parseMod(mv);
        if (m) (entry.var ||= {})[k.replace('special_bonus_', '')] = m;
      } else if (k.startsWith('special_bonus_')) {
        const m = parseMod(mv);
        if (m) (entry.t ||= {})[k] = m;
      } else if (k === 'hero_levelup') {
        const m = parseMod(mv);
        if (m) entry.lv = [m[2][0], Number(raw.levelup_interval) || 1];
      } else if (k === 'RequiresScepter') { if (mv === '1') entry.rsc = 1; }
      else if (k === 'RequiresShard') { if (mv === '1') entry.rsh = 1; }
      else if (k === 'apply_effectiveness') { if (mv === '1') entry.pot = 1; }
      else if (k === 'apply_curio_bonus' || k === 'apply_curious_bonus') { if (mv === '1' || mv === 'true') entry.curio = 1; }
      else if (k === 'levelkey') entry.levelkey = mv;
    }
    const keys = Object.keys(entry);
    vals[name] = keys.length === 1 ? base : entry;
  };
  for (const k of STD_KEYS) if (def[k] !== undefined) put(k, def[k]);
  const av = def.AbilityValues;
  if (av && typeof av === 'object') for (const [k, v] of Object.entries(av)) put(k, v);
  // legacy AbilitySpecial blocks: { "01": { var_type, name: "values", LinkedSpecialBonus... } }
  const as = def.AbilitySpecial;
  if (as && typeof as === 'object') {
    for (const blk of Object.values(as)) {
      if (!blk || typeof blk !== 'object') continue;
      for (const [k, v] of Object.entries(blk)) {
        if (k === 'var_type' || k.startsWith('Linked') || k.startsWith('Requires') || k === 'CalculateSpellDamageTooltip' || k === 'DamageTypeTooltip') continue;
        if (vals[k] === undefined) put(k, v);
      }
    }
  }
  return vals;
}

const flags = (s, prefix) => (typeof s === 'string' ? s.split('|').map((x) => x.trim()).filter(Boolean).map((x) => x.replace(prefix, '')) : []);

function compileAbility(name, def, base, loc, ids) {
  const g = (k) => (def[k] !== undefined ? def[k] : base[k]);
  const a = { name };
  const dn = loc.get('dota_tooltip_ability_' + name.toLowerCase());
  if (dn) a.dname = dn;
  if (ids[name] !== undefined) a.id = ids[name];
  a.behavior = flags(g('AbilityBehavior'), 'DOTA_ABILITY_BEHAVIOR_');
  const tt = flags(def.AbilityUnitTargetTeam, 'DOTA_UNIT_TARGET_TEAM_');
  if (tt.length) a.team = tt.join('|');
  const ty = flags(def.AbilityUnitTargetType, 'DOTA_UNIT_TARGET_');
  if (ty.length) a.ttype = ty;
  const tf = flags(def.AbilityUnitTargetFlags, 'DOTA_UNIT_TARGET_FLAG_');
  if (tf.length) a.tflags = tf;
  if (def.AbilityUnitDamageType) a.dmg = def.AbilityUnitDamageType.replace('DAMAGE_TYPE_', '').toLowerCase();
  if (def.SpellImmunityType) a.immunity = def.SpellImmunityType.replace('SPELL_IMMUNITY_', '');
  if (def.SpellDispellableType) a.dispel = def.SpellDispellableType.replace('SPELL_DISPELLABLE_', '');
  if (def.AbilityType) a.type = def.AbilityType.replace(/^(DOTA_)?ABILITY_TYPE_/, '').toLowerCase();
  if (def.MaxLevel !== undefined) a.maxLevel = Number(def.MaxLevel);
  if (def.RequiredLevel !== undefined) a.reqLevel = Number(def.RequiredLevel);
  if (def.LevelsBetweenUpgrades !== undefined) a.lvlStep = Number(def.LevelsBetweenUpgrades);
  if (def.Innate === '1') a.innate = 1;
  if (def.IsBreakable === '1') a.breakable = 1;
  if (def.HasScepterUpgrade === '1') a.hasSc = 1;
  if (def.HasShardUpgrade === '1') a.hasSh = 1;
  if (def.IsGrantedByScepter === '1') a.bySc = 1;
  if (def.IsGrantedByShard === '1') a.bySh = 1;
  if (def.IsObsolete === '1') a.obsolete = 1;
  if (def.LinkedAbility) a.linked = def.LinkedAbility;
  if (def.DependentOnAbility) a.dep = def.DependentOnAbility;
  if (def.AbilitySharedCooldown) a.sharedCd = def.AbilitySharedCooldown;
  if (def.BaseClass) a.baseClass = def.BaseClass;
  a.vals = compileValues({ ...pick(base, STD_KEYS), ...def });
  const av = def.AbilityValues;
  if (av && typeof av === 'object') {
    const aoe = [];
    for (const [k, v] of Object.entries(av)) if (v && typeof v === 'object' && v.affected_by_aoe_increase === '1' && a.vals[k] !== undefined) aoe.push(k);
    if (aoe.length) a.aoe = aoe;   // values the game scales with area-of-effect bonuses
  }
  return a;
}

const pick = (o, keys) => {
  const r = {};
  for (const k of keys) if (o[k] !== undefined && o[k] !== '0' && o[k] !== '0 0 0 0' && o[k] !== '') r[k] = o[k];
  return r;
};

function compileItemInfo(a, def, loc) {
  a.item = 1;
  a.cost = Number(def.ItemCost || 0);
  if (def.ItemRecipe === '1') a.recipe = 1;
  if (def.ItemPurchasable === '0') a.noBuy = 1;
  if (def.ItemQuality) a.quality = def.ItemQuality;
  if (def.ItemInitialCharges) a.charges = Number(def.ItemInitialCharges);
  if (def.ItemIsNeutralActiveDrop === '1') a.artifact = 1;
  if (def.ItemIsNeutralPassiveDrop === '1') a.enchant = 1;
  if (def.ItemBaseLevel) a.baseLevel = Number(def.ItemBaseLevel);
  if (def.MaxUpgradeLevel) a.maxUpgrade = Number(def.MaxUpgradeLevel);
  if (def.ItemStackable === '1') a.stackable = 1;
  // stat tokens: localization "DOTA_Tooltip_ability_<item>_<value>" = "+$damage" marks a standard stat bonus
  const tokens = {};
  for (const vn of Object.keys(a.vals)) {
    const s = loc.get(`dota_tooltip_ability_${a.name.toLowerCase()}_${vn.toLowerCase()}`);
    if (!s) continue;
    const m = /\$(\w+)/.exec(s);
    if (m) tokens[vn] = (s.trim().startsWith('%') ? '%' : '') + m[1];
  }
  if (Object.keys(tokens).length) a.tokens = tokens;
}

function compileUnitCommon(name, def, base, loc) {
  const g = (k, d) => (def[k] !== undefined ? def[k] : base[k] !== undefined ? base[k] : d);
  const n = (k, d = 0) => { const v = Number(g(k, d)); return Number.isFinite(v) ? v : d; };
  const cap = g('AttackCapabilities', 'DOTA_UNIT_CAP_NO_ATTACK');
  const u = {
    name,
    hp: n('StatusHealth', 1), hpRegen: n('StatusHealthRegen'), mana: n('StatusMana'), manaRegen: n('StatusManaRegen'),
    armor: n('ArmorPhysical'), mr: n('MagicalResistance'),
    atk: cap.includes('MELEE') ? 'melee' : cap.includes('RANGED') ? 'ranged' : 'none',
    dmgMin: n('AttackDamageMin'), dmgMax: n('AttackDamageMax'), bat: n('AttackRate', 1.7), baseAs: n('BaseAttackSpeed', 100),
    animPt: n('AttackAnimationPoint', 0.5), range: n('AttackRange', 150), projSpeed: n('ProjectileSpeed'),
    acq: n('AttackAcquisitionRange', 800),
    ms: n('MovementSpeed'), turn: n('MovementTurnRate', 0.5), hull: HULLS[g('BoundsHullName', 'DOTA_HULL_SIZE_HERO')] ?? 24,
    visDay: n('VisionDaytimeRange', 1800), visNight: n('VisionNighttimeRange', 800),
  };
  const dn = loc.get(name.toLowerCase());
  if (dn) u.dname = dn;
  const abil = [];
  for (let i = 1; i <= 35; i++) {
    const a = def['Ability' + i] ?? base['Ability' + i];
    abil.push(a && a !== '' ? a : null);
  }
  u.slots = abil;
  return u;
}

export function compileGameData({ game, folder, log = () => {} } = {}) {
  let src;
  const meta = { compiledAt: new Date().toISOString() };
  if (folder) {
    src = new FolderSource(folder);
    meta.source = 'folder:' + folder;
  } else {
    const dir = locateGameDir(game);
    if (!dir) throw new Error('Dota 2 install not found; pass --game <.../dota 2 beta/game/dota> or --folder <extracted files>');
    src = new Vpk(path.join(dir, 'pak01_dir.vpk'));
    meta.source = 'vpk:' + path.join(dir, 'pak01_dir.vpk');
    const inf = path.join(dir, 'steam.inf');
    if (fs.existsSync(inf)) {
      for (const line of fs.readFileSync(inf, 'utf8').split(/\r?\n/)) {
        const m = /^(ClientVersion|VersionDate|VersionTime|SourceRevision)=(.*)$/.exec(line.trim());
        if (m) meta[m[1]] = m[2];
      }
    }
  }
  const kvFile = (f) => parseKVBuffer(src.read(f));

  // ---- localization (lower-cased keys)
  const loc = new Map();
  for (const f of ['resource/localization/abilities_english.txt', 'resource/localization/dota_english.txt']) {
    if (!src.has(f)) continue;
    const kv = parseKV(decodeText(src.read(f)));
    const tok = (Object.values(kv)[0] || {}).Tokens || {};
    for (const [k, v] of Object.entries(tok)) {
      if (typeof v !== 'string') continue;
      const key = k.toLowerCase();
      loc.set(key, v);
      const m = /^(.+?):[a-z]+$/.exec(key); // grammar-tagged keys such as "npc_dota_hero_antimage:n"
      if (m && !loc.has(m[1])) loc.set(m[1], v);
    }
  }
  log(`localization tokens: ${loc.size}`);

  // ---- ability ids
  const ids = {};
  if (src.has('scripts/npc/npc_ability_ids.txt')) {
    const kv = kvFile('scripts/npc/npc_ability_ids.txt');
    const walk = (o) => { for (const [k, v] of Object.entries(o)) { if (v && typeof v === 'object') walk(v); else if (/^\d+$/.test(v)) ids[k] = Number(v); } };
    walk(kv);
  }

  const abilities = {};
  const descr = {};
  const addDescr = (name) => {
    const key = 'dota_tooltip_ability_' + name.toLowerCase();
    const d = {};
    const desc = loc.get(key + '_description');
    if (desc) d.desc = desc;
    for (const [suffix, field] of [['_scepter_description', 'scepter'], ['_shard_description', 'shard'], ['_aghanim_description', 'aghs']]) {
      const s = loc.get(key + suffix);
      if (s) d[field] = s;
    }
    const notes = [];
    for (let i = 0; i < 12; i++) { const s = loc.get(key + '_note' + i); if (s) notes.push(s); }
    if (notes.length) d.notes = notes;
    if (Object.keys(d).length) descr[name] = d;
  };

  // ---- generic abilities + unit abilities
  const abKv = kvFile('scripts/npc/npc_abilities.txt').DOTAAbilities;
  const abBase = abKv.ability_base || {};
  for (const [name, def] of Object.entries(abKv)) {
    if (!def || typeof def !== 'object' || name === 'ability_base') continue;
    abilities[name] = compileAbility(name, def, abBase, loc, ids);
    addDescr(name);
  }

  // ---- heroes (+ their ability definitions)
  const heroes = {};
  const heroFiles = src.list('scripts/npc/heroes/', '.txt');
  let heroBase = {};
  const heroDefs = {};
  for (const f of heroFiles) {
    const kv = kvFile(f).DOTAHeroes || {};
    for (const [name, def] of Object.entries(kv)) {
      if (!def || typeof def !== 'object') continue;
      if (name === 'npc_dota_hero_base') heroBase = def; else heroDefs[name] = def;
    }
  }
  const ATTR = { DOTA_ATTRIBUTE_STRENGTH: 'str', DOTA_ATTRIBUTE_AGILITY: 'agi', DOTA_ATTRIBUTE_INTELLECT: 'int', DOTA_ATTRIBUTE_ALL: 'all' };
  for (const [name, def] of Object.entries(heroDefs)) {
    const g = (k, d) => (def[k] !== undefined ? def[k] : heroBase[k] !== undefined ? heroBase[k] : d);
    const n = (k, d = 0) => Number(g(k, d));
    const u = compileUnitCommon(name, def, heroBase, loc);
    const h = {
      ...u,
      id: n('HeroID'), enabled: g('Enabled', '0') === '1' ? 1 : 0, hero: 1,
      attr: ATTR[g('AttributePrimary')] || 'str',
      str: n('AttributeBaseStrength'), strGain: n('AttributeStrengthGain'),
      agi: n('AttributeBaseAgility'), agiGain: n('AttributeAgilityGain'),
      int: n('AttributeBaseIntelligence'), intGain: n('AttributeIntelligenceGain'),
    };
    const tStart = n('AbilityTalentStart', 10);
    h.abilities = h.slots.slice(0, tStart - 1).filter((a) => a && a !== 'generic_hidden');
    h.talents = h.slots.slice(tStart - 1, tStart + 7).map((a) => a || null);
    delete h.slots;
    if (g('Role')) h.roles = g('Role');
    heroes[name] = h;
    const ad = def.AbilityDefinitions;
    if (ad && typeof ad === 'object') {
      for (const [an, adef] of Object.entries(ad)) {
        if (!adef || typeof adef !== 'object') continue;
        const a = compileAbility(an, adef, abBase, loc, ids);
        a.hero = name;
        abilities[an] = a;
        addDescr(an);
      }
    }
  }
  // talents: make sure every referenced talent has an entry (unique talents usually have no definition)
  for (const h of Object.values(heroes)) {
    for (const t of h.talents) {
      if (!t) continue;
      if (!abilities[t]) abilities[t] = { name: t, behavior: ['PASSIVE'], vals: {} };
      abilities[t].talent = 1;
      const dn = loc.get('dota_tooltip_ability_' + t.toLowerCase());
      if (dn) abilities[t].dname = dn;
    }
  }

  // ---- items
  const itKv = kvFile('scripts/npc/items.txt').DOTAAbilities;
  const recipes = [];
  for (const [name, def] of Object.entries(itKv)) {
    if (!def || typeof def !== 'object') continue;
    const a = compileAbility(name, def, abBase, loc, ids);
    compileItemInfo(a, def, loc);
    abilities[name] = a;
    addDescr(name);
    if (def.ItemRecipe === '1' && def.ItemResult) recipes.push([name, def]);
  }
  for (const [rname, def] of recipes) {
    const res = abilities[def.ItemResult];
    if (!res) continue;
    const req = def.ItemRequirements || {};
    const alts = Object.keys(req).sort().map((k) => String(req[k]).replace(/\*/g, '').split(';').map((s) => s.trim()).filter(Boolean));
    if (alts.length) {
      res.comps = alts[0];
      if (alts.length > 1) res.compAlts = alts.slice(1);
      res.recipeCost = abilities[rname].cost;
    }
  }

  // ---- units
  const units = {};
  const unKv = kvFile('scripts/npc/npc_units.txt').DOTAUnits;
  // "include_keys_from" "<unit>": the unit starts from another unit's keys (higher levels of summons)
  const withIncludes = (name, seen = new Set()) => {
    const d = unKv[name];
    const inc = d && d.include_keys_from;
    if (!inc || seen.has(name) || !unKv[inc] || typeof unKv[inc] !== 'object') return d;
    seen.add(name);
    return { ...withIncludes(inc, seen), ...d };
  };
  for (const [name, raw] of Object.entries(unKv)) {
    if (!raw || typeof raw !== 'object') continue;
    const def = withIncludes(name);
    const u = compileUnitCommon(name, def, {}, loc);
    u.slots = u.slots.filter(Boolean);
    u.abilities = u.slots;
    delete u.slots;
    u.level = Number(def.Level || 1);
    if (def.BaseClass) u.baseClass = def.BaseClass;
    if (def.BountyXP) u.xp = Number(def.BountyXP);
    if (def.BountyGoldMin) u.gold = [Number(def.BountyGoldMin), Number(def.BountyGoldMax || def.BountyGoldMin)];
    if (def.IsAncient === '1') u.ancient = 1;
    if (def.IsNeutralUnitType === '1') u.neutral = 1;
    if (def.ConsideredHero === '1') u.heroLike = 1;
    if (def.IsSummoned === '1') u.summoned = 1;
    if (def.CanBeDominated === '0') u.noDominate = 1;
    if (def.UnitRelationshipClass) u.rel = def.UnitRelationshipClass.replace('DOTA_NPC_UNIT_RELATIONSHIP_TYPE_', '').toLowerCase();
    if (def.CombatClassAttack) u.cAtk = def.CombatClassAttack.replace('DOTA_COMBAT_CLASS_ATTACK_', '').toLowerCase();
    if (def.CombatClassDefend) u.cDef = def.CombatClassDefend.replace('DOTA_COMBAT_CLASS_DEFEND_', '').toLowerCase();
    for (const k of ['HPGain', 'DamageGain', 'ArmorGain', 'MagicResistGain', 'MoveSpeedGain', 'BountyGain', 'XPGain']) {
      if (def[k] !== undefined && Number(def[k])) (u.gain ||= {})[k] = Number(def[k]);
    }
    units[name] = u;
  }

  // ---- neutral item tiers
  const neutral = { tiers: {} };
  if (src.has('scripts/npc/neutral_items.txt')) {
    const nk = kvFile('scripts/npc/neutral_items.txt').neutral_items || {};
    for (const [tier, t] of Object.entries(nk.neutral_tiers || {})) {
      const arts = [];
      for (const pool of Object.values(t.item_pools || {})) for (const it of Object.keys(pool.items || {})) arts.push(it);
      const ench = {};
      for (const [grp, list] of Object.entries(t.enhancements || {})) for (const [e, lvl] of Object.entries(list)) (ench[e] ||= { level: Number(lvl), groups: [] }).groups.push(grp);
      neutral.tiers[tier] = { start: t.start_time, artifacts: arts, enchants: ench };
    }
  }

  meta.counts = { heroes: Object.keys(heroes).length, units: Object.keys(units).length, abilities: Object.keys(abilities).length,
    items: Object.values(abilities).filter((a) => a.item).length };
  return { data: { meta, heroes, units, abilities, neutral }, descr };
}

export function writeGameData(outDir, opts = {}) {
  const { data, descr } = compileGameData(opts);
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, 'gamedata.json'), JSON.stringify(data));
  fs.writeFileSync(path.join(outDir, 'descriptions.json'), JSON.stringify(descr));
  return data.meta;
}
