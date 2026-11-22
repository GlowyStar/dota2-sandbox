// Hero abilities, part 12: Io, Kez, Oracle, Dawnbreaker, Gyrocopter, Mirana, Pudge, Templar Assassin, Winter Wyvern, Earthshaker,
// Sand King, Witch Doctor. Every number is read from the shipped data by value name. The few literals are either structural
// (integration steps, controller thresholds) or exist only inside tooltip prose; each is named and repeated in the `note` of its ability.
// "Width" values of line effects (hook_width, arrow_width, burrow_width, attack_spill_width ...) are used as collision radii.
import { defAbility, modifier, buff, debuff, passive, hit, addMod, silence, enemiesNear, enemiesInLine, knockback, mhit, chain, cleave, summon,
  ST, C, PHYSICAL, MAGICAL, PURE, F_ATTACK, F_NO_AMP, F_HP_LOSS, F_NON_LETHAL, F_SECONDARY } from '../engine/dsl.mjs';

const na = (name, note) => defAbility(name, { fid: 'n/a', note });
// Stun that never shortens a longer stun already running: the engine refreshes modifier_stunned to the newest duration, so a short
// stun landing after a long one (Aftershock right after Fissure) would otherwise cut it.
function stun(ab, t, d, pierce = false) {
  if (!(d > 0)) return null;
  const ex = t.findModifier('modifier_stunned');
  if (ex && ex.remaining() >= d * (t.team !== ab.owner.team ? (1 - t.statusRes) * (1 + ab.owner.debuffAmp / 100) : 1)) return ex;
  return t.addModifier('modifier_stunned', { caster: ab.owner, ability: ab, duration: d, pierce });
}
// The game runs a periodic think on the first server frame at or after its interval and counts the next interval from that frame,
// so an interval that is not a whole number of frames is stretched to the next frame (0.55 s -> 17 frames = 0.567 s).
const tickUp = (w, s) => Math.ceil(s / w.dt - 1e-6) * w.dt;
const here = (u) => ({ x: u.x, y: u.y });                 // decision "cast now" of a no-target ability (keeps the cast point on the caster)
const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
const hpFrac = (u) => u.hp / u.maxHp;
const seen = (w, e) => e.st[ST.INVIS] === 0 || w.detectAll;
const reveals = (ab) => !ab.def.behavior.includes('IGNORE_INVISIBLE');      // casting it breaks the caster's invisibility
const blocked = (ab, e) => e.st[ST.IMMUNE] > 0 && !ab.pierces && e.team !== ab.owner.team;   // debuff immunity against a non-piercing spell
// the unit this hero is fighting; stands in for "forward" / "in front of" (the sandbox has no facing)
const focus = (u) => (u.ai && u.ai.target && u.ai.target.alive ? u.ai.target : u.world.nearestEnemy(u));
function aim(fx, fy, tx, ty) { const dx = tx - fx; const dy = ty - fy; const d = Math.sqrt(dx * dx + dy * dy); return d > 1e-6 ? { dx: dx / d, dy: dy / d, d } : { dx: 1, dy: 0, d: 0 }; }
function nearestOf(list, x, y) { let best = null; let bd = Infinity; for (const e of list) { const d = (e.x - x) * (e.x - x) + (e.y - y) * (e.y - y); if (d < bd) { bd = d; best = e; } } return best; }
const realAllies = (u, self) => u.world.units.filter((a) => a.alive && a.team === u.team && a.isHero && !a.isIllusion && (self || a !== u));
// hero-only spells: the current target when it is a hero in reach, otherwise the nearest enemy hero in reach
function heroFocus(u, t, range, ok) {
  if (t && t.heroLike && u.distTo(t) <= range && (!ok || ok(t))) return t;
  let best = null; let bd = range;
  for (const e of u.world.units) { if (!e.alive || e.team === u.team || !e.heroLike || !e.attackableBy(u) || (ok && !ok(e))) continue; const d = u.distTo(e); if (d <= bd) { bd = d; best = e; } }
  return best;
}

// Straight-line projectile advanced once per simulation tick, so moving units are tested where they are when it reaches them.
//   o: { x, y, dx, dy (unit direction), speed, range, radius, filter(e), onHit(e, travelled) -> true stops it, onStep(x1, y1, x2, y2) }
function linearProjectile(w, o) {
  let done = 0; const met = new Set();
  const step = () => {
    const adv = Math.min(o.speed * w.dt, o.range - done); const x1 = o.x + o.dx * done; const y1 = o.y + o.dy * done;
    if (o.onStep) o.onStep(x1, y1, x1 + o.dx * adv, y1 + o.dy * adv);
    const hits = [];
    for (const e of w.units) {
      if (!e.alive || e.st[ST.OUT] > 0 || met.has(e) || !o.filter(e)) continue;
      const rx = e.x - x1; const ry = e.y - y1; const proj = rx * o.dx + ry * o.dy; const r = o.radius + e.def.hull; const perp2 = rx * rx + ry * ry - proj * proj;
      if (perp2 > r * r) continue;
      const half = Math.sqrt(r * r - perp2);       // first contact happens `proj - half` along this step; units behind the launch point are not hit
      if (proj - half <= adv && (done > 0 ? proj + half >= 0 : proj > 0)) hits.push([Math.max(0, proj - half), e]);
    }
    hits.sort((a, b) => a[0] - b[0]);
    for (const [along, e] of hits) { met.add(e); if (o.onHit(e, done + along) === true) return; }
    done += adv;
    if (done + 1e-6 < o.range) w.after(w.dt, step);
  };
  w.after(0, step);
}

// ---------------------------------------------------------------- linked abilities
// The engine's skill build (Unit.skillPlan) gives no points to hidden helper abilities, one-level passives and Kez's second weapon set:
// linked twins share one level and helpers follow their parent. The hidden modifier registered here only keeps twins level when
// something changes one of them at runtime; `cfg.twins` lists the pairs.
function skillSync(ability, cfg) {
  const name = `modifier_${ability}_skill_sync`;
  const twins = cfg.twins || [];
  modifier(name, { hidden: true, purge: 'none', breakable: false, interval: twins.length ? 0.5 : 0, thinkNow: true,
    onThink(m) {
      const u = m.parent;
      if (u.isIllusion) return;
      for (const [a, b] of twins) { const x = u.findAbility(a); const y = u.findAbility(b); if (x && y && x.level !== y.level) { const top = Math.max(x.level, y.level); if (x.level !== top) x.setLevel(top); if (y.level !== top) y.setLevel(top); } }
    } });
  return name;
}

// ================================================================ Io
const WISP_LATCH_STOP = 300;   // "pull itself closer ... (to a distance of 300)": written in the Tether tooltip note only, there is no data value
const WISP_STEP = 0.1;         // structural: integration step of the tether line and of the spirit orbit
const WISP_FAR = 2000;         // controller: Relocate is used to reach a target farther away than this
let wispRelay = false;         // guards the heal relay when two Ios are tethered to each other
const wispLink = (u) => u.findModifier('modifier_wisp_tether');
const wispAlly = (u, range) => nearestOf(realAllies(u, false).filter((a) => u.distTo(a) <= range), u.x, u.y);

modifier('modifier_wisp_equilibrium', { hidden: true, dynamic: true,
  stats: (m) => { const u = m.parent; const h = m.v('heal_amplification') * (1 - clamp(hpFrac(u), 0, 1)); return { restore: h, healAmp: h }; },
  outgoing(m, d) { const u = m.parent; if (d.dst.team !== u.team) d.amount *= 1 + m.v('damage_amplification') * clamp(hpFrac(u), 0, 1) / 100; } });
defAbility('wisp_equilibrium', {
  mods: ['modifier_wisp_equilibrium', skillSync('wisp_equilibrium', { basics: ['wisp_tether', 'wisp_spirits', 'wisp_overcharge'], helpers: { wisp_tether_break: 'wisp_tether', wisp_spirits_in: 'wisp_spirits', wisp_spirits_out: 'wisp_spirits' } })],
  fid: 'approx', note: 'both bonuses scale linearly with health: damage amplification is maximal at full health, health restoration and heal amplification at zero health' });

debuff('modifier_wisp_tether_slow', { stats: (m) => ({ msPct: -m.v('slow'), asSlow: -m.v('slow') }) });
modifier('modifier_wisp_tether_ally', { purge: 'none', dynamic: true,
  stats: (m) => { const io = m.caster; return { msPct: m.v('movespeed'), hpRegen: Math.max(0, io.hpRegen) * m.v('tether_heal_amp') / 100, manaRegen: Math.max(0, io.manaRegen) * m.v('tether_mana_amp') / 100 }; },
  onAttack(m, rec) {
    const io = m.caster; const p = m.v('tether_attack_damage_pct');
    if (rec.fromAbility && rec.fromAbility.name === 'wisp_tether') return;   // an attack that already is such a follow-up
    if (p > 0 && m.parent.heroLike && io.alive && io.st[ST.STUN] === 0 && io.st[ST.SLEEP] === 0 && io.st[ST.OUT] === 0 && !io.isDisarmed() && rec.target.attackableBy(io)) io.world.launchAttack(io, rec.target, { mult: p / 100, fromAbility: m.ability });
  } });
modifier('modifier_wisp_tether', { purge: 'none', dynamic: true, interval: WISP_STEP,
  // [L] measured in Hero Demo: Io herself does not get `movespeed` (self_bonus is 0): 320 stays 320 while the ally gets +12%
  stats: (m) => { const a = m.data.ally; const o = { msAbs: a.ms }; if (m.v('self_bonus') > 0) o.msPct = m.v('movespeed'); if (a.ms > C.MS_MAX) o.msMax = a.ms; return o; },
  onThink(m) {
    const u = m.parent; const a = m.data.ally; const ab = m.ability;
    if (!a.alive) { m.remove(); return; }
    if (m.data.latch) {       // "latch on and pull itself closer": Io is drawn in at latch_speed and the tether cannot break meanwhile
      const v = aim(u.x, u.y, a.x, a.y); const go = Math.min(v.d - WISP_LATCH_STOP, m.v('latch_speed') * WISP_STEP);
      if (go > 0) { u.x += v.dx * go; u.y += v.dy * go; }
      if (v.d - go <= WISP_LATCH_STOP + 1e-6) m.data.latch = false;
    } else if (u.distTo(a) > m.v('radius')) { m.remove(); return; }
    const oc = u.findModifier('modifier_wisp_overcharge');          // Overcharge is shared with the tethered unit
    if (oc && !a.hasModifier('modifier_wisp_overcharge')) a.addModifier('modifier_wisp_overcharge', { caster: u, ability: oc.ability, duration: Math.max(WISP_STEP, oc.remaining()) });
    const burn = m.v('damage') > 0 && (m.z += WISP_STEP) + 1e-9 >= m.v('tick_rate'); if (burn) m.z = 0;
    let dealt = 0;
    for (const e of enemiesInLine(ab, u.x, u.y, a.x, a.y, 0)) {
      if (e.isBuilding) continue;
      e.addModifier('modifier_wisp_tether_slow', { caster: u, ability: ab, duration: m.v('slow_duration') });
      if (burn) dealt += mhit(m, e, m.v('damage') * m.v('tick_rate'));
    }
    if (dealt > 0 && u.st[ST.NO_HEAL] === 0) {
      const heal = dealt * m.v('damage_to_heal') / 100; const got = u.heal(heal, u, ab);        // the part that restores Io's health is relayed by onHealed
      const lost = heal * u.restoreMul * (1 + (u.healAmp || 0) / 100) - got;                    // "will heal even if Io is at full health"
      if (lost > 1e-6 && a.alive) a.heal(lost * m.v('tether_heal_amp') / 100, u, ab);
    }
  },
  onHealed(m, ev) {
    const a = m.data.ally; if (wispRelay || !a.alive || ev.amount <= 0) return;
    wispRelay = true; a.heal(ev.amount * m.v('tether_heal_amp') / 100, m.parent, m.ability); wispRelay = false;
  },
  onDestroy(m) {
    const a = m.data.ally; const am = a.findModifier('modifier_wisp_tether_ally', m.parent); if (am) am.remove();
    const oc = a.findModifier('modifier_wisp_overcharge'); if (oc && oc.caster === m.parent) oc.remove();
  } });
defAbility('wisp_tether', {
  prio: 88, fid: 'approx',
  note: 'allied target: the controller picks the nearest allied hero (no ally = no cast). Io\'s health regeneration and the heals that actually restore Io\'s health are passed on, mana only through mana regeneration: burst mana gains are not relayed, and a heal that a full-health Io cannot take is lost too, except the Shard\'s own heal. Enemies whose collision hull touches the line are slowed (and burned with Shard, default magical type: the data has none). Latch: tethered from latch_distance or farther, Io is pulled towards the ally at latch_speed (0.1 s steps) until 300 units remain, and the tether cannot break during the pull. Io\'s speed is raised to the ally\'s, never lowered. Talent attack: each time a tethered hero attacks, Io fires at the same target, whatever the distance',
  ai: (ab, u, t) => { if (!t || wispLink(u)) return null; const a = wispAlly(u, ab.castRange()); return a ? { target: a } : null; },
  cast(ab, t) {
    const u = ab.owner; const a = t && t !== u && t.team === u.team ? t : wispAlly(u, ab.castRange());
    if (!a) return;
    u.removeModifierByName('modifier_wisp_tether');
    const far = u.distTo(a) >= ab.v('latch_distance'); const pull = far && ab.v('latch_speed') > 0;
    if (far && !pull) u.jumpTo(a, Infinity, WISP_LATCH_STOP);
    addMod(ab, u, 'modifier_wisp_tether', undefined, { data: { ally: a, latch: pull } });
    addMod(ab, a, 'modifier_wisp_tether_ally');
  } });
defAbility('wisp_tether_break', { fid: 'full', manual: true, note: 'manual: the controller never breaks a tether on purpose (it breaks by itself beyond the tether radius)', cast(ab) { ab.owner.removeModifierByName('modifier_wisp_tether'); } });

function wispSpiritPos(m, i) { const u = m.parent; const a = m.x + 2 * Math.PI * i / m.data.slots.length; return [u.x + Math.cos(a) * m.data.r, u.y + Math.sin(a) * m.data.r]; }
function wispBurst(m, x, y) { for (const e of enemiesNear(m.ability, x, y, m.v('explode_radius'))) if (!e.isBuilding) mhit(m, e, m.v('hero_damage'), MAGICAL); }
function wispBurstAll(m) { const s = m.data.slots; for (let i = 0; i < s.length; i++) if (s[i]) { const [x, y] = wispSpiritPos(m, i); s[i] = null; wispBurst(m, x, y); } }
function wispFill(m) { m.data = { slots: Array.from({ length: m.v('spirit_amount') }, () => new Set()), r: m.v('default_radius'), spawn: 0, passive: m.dieTime === Infinity }; }
debuff('modifier_wisp_spirits_slow', { stats: (m) => ({ msPct: -m.v('scepter_slow_pct') }) });
modifier('modifier_wisp_spirits', { purge: 'none', interval: WISP_STEP,
  onCreated(m) { wispFill(m); }, onRefresh(m) { if (!m.data.passive) wispFill(m); },
  onThink(m) {
    const u = m.parent; const w = u.world; const D = m.data; const s = D.slots;
    if (D.passive && (D.spawn += WISP_STEP) + 1e-9 >= m.v('spirit_spawn_time')) { D.spawn = 0; const i = s.indexOf(null); if (i >= 0) s[i] = new Set(); }
    // Spirits In / Out: a fighting controller steers the orbit onto its target; without those toggles (an idle unit, as in the game
    // when nobody presses them) the spirits stay on default_radius ([L] measured: a dummy 200 from Io is never touched, two spirits catch it on expiry)
    const t = u.ai && u.ai.mode !== 'idle' ? focus(u) : null; const lim = m.v('spirit_movement_rate') * WISP_STEP;
    if (t) D.r += clamp(clamp(u.distTo(t), m.v('min_range'), m.v('max_range')) - D.r, -lim, lim);
    m.x += 2 * Math.PI * WISP_STEP / m.v('revolution_time');
    let left = 0;
    for (let i = 0; i < s.length; i++) {
      if (!s[i]) continue;
      const [x, y] = wispSpiritPos(m, i); let hero = null;
      for (const e of w.inRadius(x, y, m.v('hero_hit_radius'), u.team, true)) if (e.heroLike && e.st[ST.INVULN] === 0) { hero = e; break; }
      if (hero) {
        s[i] = null;
        if (m.v('scepter_slow_pct') > 0) hero.addModifier('modifier_wisp_spirits_slow', { caster: u, ability: m.ability, duration: m.v('scepter_slow_duration') });
        wispBurst(m, x, y); continue;
      }
      const now = new Set();
      for (const e of w.enemiesInRadius(u, x, y, m.v('hit_radius'))) { if (e.heroLike || e.isBuilding) continue; now.add(e); if (!s[i].has(e)) mhit(m, e, m.v('creep_damage'), MAGICAL); }
      s[i] = now; left++;
    }
    if (!D.passive && left === 0) m.remove();
  },
  onDestroy(m, expired) { if (expired) wispBurstAll(m); } });
defAbility('wisp_spirits', {
  mods: ['modifier_wisp_spirits'], requires: (ab) => ab.owner.hasScepter, prio: 55, fid: 'approx',
  note: 'spirits are simulated as points on a circle (0.1 s steps, one turn per revolution_time): a spirit touching an enemy hero explodes, creeps take the touch damage once per contact. All five appear at once on cast on default_radius, and only a fighting controller moves the orbit (an idle unit keeps default_radius, as in the game without Spirits In / Out); their starting angle is arbitrary (no facing), so which spirits catch a unit on expiry can differ from the game; with Scepter they start full and respawn one per spirit_spawn_time, and the controller detonates them when at least two would catch a hero',
  ai: (ab, u, t) => {
    if (!t) return null;
    const m = u.findModifier('modifier_wisp_spirits');
    if (!m) return u.distTo(t) <= ab.v('max_range') + 200 ? here(u) : null;
    if (!m.data.passive) return null;
    let n = 0; const s = m.data.slots;
    for (let i = 0; i < s.length; i++) if (s[i]) { const [x, y] = wispSpiritPos(m, i); if (enemiesNear(ab, x, y, ab.v('explode_radius')).some((e) => e.heroLike)) n++; }
    return n >= 2 ? here(u) : null;
  },
  cast(ab) { const u = ab.owner; const m = u.findModifier('modifier_wisp_spirits'); if (m && m.data.passive) wispBurstAll(m); else addMod(ab, u, 'modifier_wisp_spirits', ab.v('spirit_duration')); } });
na('wisp_spirits_in', 'toggle helper: the Spirits script steers the orbit radius towards the current target by itself (min_range .. max_range at spirit_movement_rate)');
na('wisp_spirits_out', 'toggle helper: the Spirits script steers the orbit radius towards the current target by itself (min_range .. max_range at spirit_movement_rate)');

modifier('modifier_wisp_overcharge', { purge: 'none', stats: (m) => ({ as: m.v('bonus_attack_speed'), spellAmp: m.v('bonus_spell_amp'), hpRegenPct: m.v('hp_regen'), armor: m.v('bonus_armor'), mr: m.v('bonus_mres'), spellLifesteal: m.v('spell_lifesteal'), slowRes: m.v('unslowable') > 0 ? 100 : 0 }) });
defAbility('wisp_overcharge', {
  prio: 70, fid: 'full', ai: (ab, u, t) => (t && u.distTo(t) <= 900 && !u.hasModifier('modifier_wisp_overcharge') ? here(u) : null),
  cast(ab) { const u = ab.owner; const d = ab.v('duration'); addMod(ab, u, 'modifier_wisp_overcharge', d); const l = wispLink(u); if (l && l.data.ally.alive) addMod(ab, l.data.ally, 'modifier_wisp_overcharge', d); } });

modifier('modifier_wisp_relocate_cast', { purge: 'none', interval: 0.05,
  onThink(m) { const u = m.parent; if (u.st[ST.STUN] > 0 || u.st[ST.HEX] > 0 || u.st[ST.SLEEP] > 0 || u.st[ST.SILENCE] > 0) { m.data.cancel = true; m.remove(); } },
  onDestroy(m, expired) {
    const u = m.parent; if (!expired || m.data.cancel || !u.alive) return;
    const l = wispLink(u); const a = l && l.data.ally.alive && l.data.ally.heroLike ? l.data.ally : null;
    const back = { x: u.x, y: u.y, ally: a, ax: a ? a.x : 0, ay: a ? a.y : 0 };
    if (a) { a.x = m.data.x + (a.x - u.x); a.y = m.data.y + (a.y - u.y); }
    u.x = m.data.x; u.y = m.data.y;
    u.addModifier('modifier_wisp_relocate_return', { ability: m.ability, duration: m.v('return_time'), data: back });
  } });
modifier('modifier_wisp_relocate_return', { purge: 'none',
  onDestroy(m, expired) {
    const u = m.parent; const b = m.data; if (!expired || !u.alive) return;
    const l = wispLink(u); if (b.ally && b.ally.alive && l && l.data.ally === b.ally) { b.ally.x = b.ax; b.ally.y = b.ay; }
    u.x = b.x; u.y = b.y;
  } });
defAbility('wisp_relocate', {
  prio: 92, fid: 'approx',
  note: 'after cast_delay Io and the tethered hero are moved to the point and brought back after return_time (the ally only while still tethered); stun, hex, sleep or silence during the delay cancels it. Controller: only with a tethered ally, either to reach a target farther than 2000 units or to pull the pair 3000 units away from the nearest enemy when one of them is below 30% health. The fountain double-click has no meaning here',
  ai: (ab, u, t) => {
    const l = wispLink(u); if (!l || !t || u.hasModifier('modifier_wisp_relocate_cast') || u.hasModifier('modifier_wisp_relocate_return')) return null;
    if (u.distTo(t) > WISP_FAR) return { x: t.x, y: t.y };
    const e = u.world.nearestEnemy(u, 900); if (!e || Math.min(hpFrac(u), hpFrac(l.data.ally)) >= 0.3) return null;
    const a = aim(e.x, e.y, u.x, u.y); return { x: u.x + a.dx * 3000, y: u.y + a.dy * 3000 };
  },
  cast(ab, t, x, y) { addMod(ab, ab.owner, 'modifier_wisp_relocate_cast', ab.v('cast_delay'), { data: { x, y, cancel: false } }); } });

// ================================================================ Kez
// Two weapon sets. Stance lives on modifier_kez_switch_weapons (x = 0 Katana, 1 Sai). The controller starts with the Katana (game default)
// and casts Switch Discipline only when no ability of the weapon in hand is ready and wanted while one of the other weapon is.
const KEZ_TWIN = { kez_echo_slash: 'kez_falcon_rush', kez_falcon_rush: 'kez_echo_slash', kez_grappling_claw: 'kez_talon_toss', kez_talon_toss: 'kez_grappling_claw',
  kez_kazurai_katana: 'kez_shodo_sai', kez_shodo_sai: 'kez_kazurai_katana', kez_raptor_dance: 'kez_ravens_veil', kez_ravens_veil: 'kez_raptor_dance' };
const KEZ_KATANA = ['kez_echo_slash', 'kez_grappling_claw', 'kez_kazurai_katana', 'kez_raptor_dance'];
const KEZ_SAI = ['kez_falcon_rush', 'kez_talon_toss', 'kez_shodo_sai', 'kez_ravens_veil'];
const kezStance = (u) => u.findModifier('modifier_kez_switch_weapons');
const kezSai = (u) => { const m = kezStance(u); return !!m && m.x === 1; };
// "extra damage on the first Katana hit or ability after switching to Katana": returns the multiplier and uses the bonus up
// [L] measured in Hero Demo: the swap bonus is base damage (it shows in the damage stat from the switch on, a fresh Kez starts with it) and is used up
// by the first Katana hit, so attacks of abilities carry it by themselves; a fixed-damage attack (Raptor Dance) gets nothing from it
function kezEdge() { return 1; }
const KEZ_WANT = {
  kez_echo_slash: (ab, u, t) => (t && !t.isBuilding && u.distTo(t) <= ab.v('katana_distance') - 150 ? here(u) : null),
  kez_grappling_claw: (ab, u, t) => (t && !t.isBuilding && !t.isImmune() && u.st[ST.ROOT] === 0 && u.rangeTo(t) - u.attackRange > 150 && u.distTo(t) <= ab.castRange() + 300 ? { target: t } : null),
  kez_kazurai_katana: (ab, u, t) => (t && !t.isBuilding && u.rangeTo(t) <= u.attackRange + 100 && t.hasModifier('modifier_kez_kazurai_katana_bleed') ? { target: t } : null),
  kez_raptor_dance: (ab, u, t) => (t && !t.isBuilding && u.distTo(t) <= ab.v('radius') - 75 ? here(u) : null),
  kez_falcon_rush: (ab, u, t) => (t && !t.isBuilding && u.distTo(t) <= ab.v('rush_range') && !u.hasModifier('modifier_kez_falcon_rush') ? here(u) : null),
  kez_talon_toss: (ab, u, t) => (t && !t.isBuilding && !t.isImmune() && u.distTo(t) <= ab.castRange() + 200 ? { target: t } : null),
  kez_shodo_sai: (ab, u, t, w) => {      // parry towards an enemy hero that is hitting Kez
    if (u.hasModifier('modifier_kez_shodo_sai_parry')) return null;
    for (const e of w.units) if (e.alive && e.team !== u.team && e.isHero && (e.attackTarget === u || e.orderTarget === u) && e.rangeTo(u) <= e.attackRange + 100 && e.st[ST.STUN] === 0 && !e.isDisarmed()) return { x: e.x, y: e.y };
    return null;
  },
  kez_ravens_veil: (ab, u, t) => {       // approach tool: Mark + speed while the target is beyond Raptor Dance reach
    const sai = u.findAbility('kez_shodo_sai'); const rd = u.findAbility('kez_raptor_dance'); const d = t ? u.distTo(t) : 0;
    return t && t.isHero && sai && sai.level > 0 && !t.hasModifier('modifier_kez_shodo_sai_mark') && d <= 900 && d > (rd ? rd.v('radius') : 0) ? here(u) : null;
  },
};
function kezWants(u, t, w, sai) { for (const n of sai ? KEZ_SAI : KEZ_KATANA) { const a = u.findAbility(n); if (a && a.level > 0 && a.ready() && KEZ_WANT[n](a, u, t, w)) return true; } return false; }
const kezAI = (name, sai) => (ab, u, t, w) => (kezSai(u) === sai ? KEZ_WANT[name](ab, u, t, w) : null);

modifier('modifier_kez_switch_weapons_katana_edge', { purge: 'none',      // the bonus itself is added by modifier_kez_switch_weapons (late); every hit of the same instant still gets it
  onAttackLanded(m, rec) { if (rec.target.isBuilding || m.data === 'used') return; m.data = 'used'; m.parent.world.after(0, () => { if (!m.removed) { m.remove(); m.parent.dirty = true; } }); } });
buff('modifier_kez_switch_weapons_sai_speed', { purge: 'none', stats: (m) => ({ msPct: m.v('sai_swap_bonus_movement_speed') }) });
modifier('modifier_kez_raptor_dance_invuln', { purge: 'none', state: ['INVULN'] });
modifier('modifier_kez_switch_weapons', { hidden: true, purge: 'none', interval: (m) => m.parent.world.dt,
  onCreated(m) { m.data = { swapAt: -100, free: false, rd: -1 }; if (!m.parent.isIllusion) m.parent.addModifier('modifier_kez_switch_weapons_katana_edge', { ability: m.ability }); },      // a fresh Kez holds the Katana with the swap bonus up
  stats: (m) => { const r = m.parent.def.range; return m.x === 1 ? { bat: m.v('sai_base_attack_time'), attackRange: m.v('sai_attack_range') - r, ms: m.v('sai_base_ms') } : { bat: m.v('katana_base_attack_time'), attackRange: m.v('katana_attack_range') - r, ms: m.v('katana_base_ms') }; },
  late(m, s, u) {      // [L] measured in Hero Demo (all 30 levels): Katana base damage = ceil(base + katana_agility_bonus_base_damage % of agility), swap bonus = ceil(katana_swap_bonus_damage % of the average base damage)
    if (m.x !== 0) return;
    const lo = u.def.dmgMin + Math.floor(u.agi + 1e-9) + s.dmgBase; const add = Math.ceil(lo + u.agi * m.v('katana_agility_bonus_base_damage') / 100 - 1e-9) - lo; s.dmgBase += add;
    if (u.hasModifier('modifier_kez_switch_weapons_katana_edge')) s.dmgBase += Math.ceil((lo + add + (u.def.dmgMax - u.def.dmgMin) / 2) * m.v('katana_swap_bonus_damage') / 100 - 1e-9);
  },
  onCast(m, ev) {       // a weapon ability puts its twin on cooldown too
    const tw = KEZ_TWIN[ev.ability.name]; if (!tw) return;
    const u = m.parent; const other = u.findAbility(tw); const sw = m.ability;
    if (u.hasScepter) {
      const first = m.data.free && u.world.time - m.data.swapAt <= sw.v('scepter_cooldown_timer');
      m.data.free = false;
      if (!first && other && other.cdReady()) other.startCooldown();
      sw.cdEnd = 0;
    } else if (other) other.startCooldown();
  },
  onThink(m) {          // Raptor Dance wind-up: basic dispel and brief invulnerability when the cast starts
    const u = m.parent; const c = u.castAb;
    if (!c || c.name !== 'kez_raptor_dance' || m.data.rd === u.castEnd) return;
    m.data.rd = u.castEnd;
    if (c.v('basic_dispel') > 0 || c.v('hard_dispel') > 0) u.purge({ debuffs: true, strong: c.v('hard_dispel') > 0 });
    u.addModifier('modifier_kez_raptor_dance_invuln', { ability: c, duration: c.v('invuln_period') });
  } });
defAbility('kez_switch_weapons', {
  mods: ['modifier_kez_switch_weapons', skillSync('kez_switch_weapons', { basics: ['kez_echo_slash', 'kez_grappling_claw', 'kez_kazurai_katana'],
    twins: [['kez_echo_slash', 'kez_falcon_rush'], ['kez_grappling_claw', 'kez_talon_toss'], ['kez_kazurai_katana', 'kez_shodo_sai'], ['kez_raptor_dance', 'kez_ravens_veil']] })],
  prio: 110, fid: 'approx',
  note: 'Katana: attack range, base attack time and bonus base damage = katana_agility_bonus_base_damage % of agility; Sai: its range and attack time. First Katana attack or ability after a switch deals the swap bonus, switching to Sai gives the speed buff. Using a weapon ability starts the cooldown of its twin; Scepter rule (first ability within scepter_cooldown_timer of a switch spares the twin, a twin already cooling down is left alone, any weapon ability refreshes the switch) is applied. Controller: starts with the Katana and switches only when no ability of the weapon in hand is ready and wanted but one of the other weapon is; with Scepter it also switches after every weapon ability while the other weapon has one ready and wanted, so each cast is the first after a switch. Between casts it attacks with the weapon in hand. Its behaviour flag "ignores silence" is not honoured (a silenced Kez cannot switch here); illusions keep the Katana base values without the passives',
  ai: (ab, u, t, w) => {
    const m = kezStance(u); const sai = kezSai(u);
    if (!t || !m || u.hasModifier('modifier_kez_shodo_sai_parry') || !kezWants(u, t, w, !sai)) return null;
    return !kezWants(u, t, w, sai) || (u.hasScepter && !m.data.free) ? here(u) : null;
  },
  cast(ab) {
    const u = ab.owner; const m = kezStance(u); if (!m) return;
    m.x = m.x === 1 ? 0 : 1; m.data.swapAt = u.world.time; m.data.free = true; u.dirty = true;
    if (m.x === 1) { u.removeModifierByName('modifier_kez_switch_weapons_katana_edge'); addMod(ab, u, 'modifier_kez_switch_weapons_sai_speed', ab.v('sai_swap_duration')); } else { u.removeModifierByName('modifier_kez_switch_weapons_katana_edge'); addMod(ab, u, 'modifier_kez_switch_weapons_katana_edge'); }
  } });

// --- Katana set
debuff('modifier_kez_echo_slash_slow', { stats: (m) => ({ msPct: -m.v('tag_slow') }) });
defAbility('kez_echo_slash', {
  prio: 60, fid: 'approx', ai: kezAI('kez_echo_slash', false),
  note: '"forward" = towards the current target; every enemy within katana_radius of the katana_distance line takes an attack (katana_echo_damage % of attack damage + echo_base_damage, on-hit effects apply), repeated after strike_interval on the same line. travel_distance has no tooltip text and is ignored (Kez stays where he is); "Doesn\'t apply Cleave" cannot be enforced (a cleave item still triggers on these attacks)',
  cast(ab) {
    const u = ab.owner; const w = u.world; const t = focus(u); if (!t) return;
    const a = aim(u.x, u.y, t.x, t.y); const edge = kezEdge(u); const x1 = u.x; const y1 = u.y; const x2 = x1 + a.dx * ab.v('katana_distance'); const y2 = y1 + a.dy * ab.v('katana_distance');
    const strike = () => {
      if (!u.alive) return;
      for (const e of enemiesInLine(ab, x1, y1, x2, y2, 2 * (ab.v('katana_radius')))) {
        if (e.isBuilding || !e.attackableBy(u)) continue;
        w.launchAttack(u, e, { instant: true, mult: ab.v('katana_echo_damage') / 100 * edge, add: ab.v('echo_base_damage') * edge, fromAbility: ab });
        if (e.alive) addMod(ab, e, 'modifier_kez_echo_slash_slow', ab.v('tag_slow_duration'));
      }
    };
    strike(); for (let i = 1; i < ab.v('katana_strikes'); i++) w.after(i * ab.v('strike_interval'), strike);
  } });
debuff('modifier_kez_grappling_claw_slow', { stats: (m) => ({ msPct: -m.v('katana_ms_slow_pct') }) });
modifier('modifier_kez_grappling_claw_swing', { purge: 'none', state: ['STUN'] });      // Kez cannot act while he swings in
defAbility('kez_grappling_claw', {
  prio: 100, fid: 'approx', ai: kezAI('kez_grappling_claw', false), note: 'used as a gap closer on enemy units only (trees do not exist); the hook slows on contact, Kez arrives after distance / grapple_speed (unable to act meanwhile) and attacks',
  cast(ab, t) {
    const u = ab.owner; const w = u.world; const edge = kezEdge(u); const d0 = u.distTo(t);
    addMod(ab, u, 'modifier_kez_grappling_claw_swing', d0 / ab.v('projectile_speed') + Math.max(0, d0 - ab.v('land_distance')) / ab.v('grapple_speed') + 0.2);
    w.projectile(u, t, ab.v('projectile_speed'), (tt) => {
      addMod(ab, tt, 'modifier_kez_grappling_claw_slow', ab.v('debuff_duration'));
      w.after(Math.max(0, u.distTo(tt) - ab.v('land_distance')) / ab.v('grapple_speed'), () => {
        u.removeModifierByName('modifier_kez_grappling_claw_swing');
        if (!u.alive || !tt.alive) return;
        u.jumpTo(tt, Infinity, ab.v('land_distance'));
        const r = w.launchAttack(u, tt, { instant: true, mult: edge, fromAbility: ab });
        if (ab.v('lifesteal_pct') > 0 && r.dealt > 0) u.heal(r.dealt * ab.v('lifesteal_pct') / 100, u, ab, true);
      });
    });
  } });
debuff('modifier_kez_kazurai_katana_bleed', { pierce: true, interval: 1, onCreated(m) { m.data = []; },      // data: [{ dps, left (seconds) }]
  onThink(m) { const L = m.data; let dps = 0; for (let i = L.length - 1; i >= 0; i--) { dps += L[i].dps; if (--L[i].left <= 0) L.splice(i, 1); } if (dps > 0) mhit(m, m.parent, dps, PHYSICAL); if (!L.length && !m.removed) m.remove(); } });
debuff('modifier_kez_kazurai_katana_impale', { pierce: true, state: ['ROOT'] });
modifier('modifier_kez_kazurai_katana', { hidden: true,
  onAttackLanded(m, rec) {
    const u = m.parent; const t = rec.target; const fa = rec.fromAbility;
    if (!t.alive || t.isBuilding || rec.damage <= 0) return;
    if (fa && !fa.isItem ? !KEZ_KATANA.includes(fa.name) : kezSai(u)) return;       // Katana attacks and Katana abilities only
    const d = t.addModifier('modifier_kez_kazurai_katana_bleed', { caster: u, ability: m.ability, pierce: true });
    if (d) d.data.push({ dps: rec.damage * m.v('katana_bleed_attack_damage_pct') / 100, left: Math.round(m.v('katana_bleed_duration')) });
  } });
defAbility('kez_kazurai_katana', {
  mods: ['modifier_kez_kazurai_katana'], prio: 55, fid: 'approx', ai: kezAI('kez_kazurai_katana', false),
  note: 'bleed: every Katana attack / Katana ability hit adds a stack dealing katana_bleed_attack_damage_pct % of that attack\'s pre-armor damage per second (physical, 1 s ticks) for katana_bleed_duration. Impale = instant attack + root for impale_duration; burst = bleed_as_rupture_pct % of the remaining bleed damage (at most max_stacks of it counts, the tooltip does not define a stack) dealt at once and removed from the bleed. Shard: lifesteal on attack + burst; "from behind" = the target is not attacking Kez, then it is stunned instead of rooted',
  cast(ab, t) {
    const u = ab.owner; const w = u.world; const edge = kezEdge(u);
    const behind = ab.v('backstab_angle') > 0 && t.orderTarget !== u && t.attackTarget !== u;
    const r = w.launchAttack(u, t, { instant: true, mult: edge, fromAbility: ab }); let got = r.dealt;
    if (t.alive) {
      if (behind) stun(ab, t, ab.v('impale_duration')); else addMod(ab, t, 'modifier_kez_kazurai_katana_impale', ab.v('impale_duration'));
      const b = t.findModifier('modifier_kez_kazurai_katana_bleed');
      if (b) {
        let rem = 0; for (const s of b.data) rem += s.dps * s.left;
        const use = Math.min(rem, ab.v('max_stacks')) * ab.v('bleed_as_rupture_pct') / 100;
        if (use > 0) { const k = 1 - use / rem; for (const s of b.data) s.dps *= k; got += hit(ab, t, use, PHYSICAL); }
      }
    }
    const ls = ab.v('lifesteal_pct'); if (ls > 0 && got > 0) u.heal(got * ls / 100 * (t.heroLike ? 1 : 1 - ab.v('creep_lifesteal_reduction_pct') / 100), u, ab, true);
  } });
modifier('modifier_kez_raptor_dance', { purge: 'none', interval: (m) => m.v('strike_interval'), thinkNow: true,
  onCreated(m) { m.data = { edge: 1 }; },
  onThink(m) {
    const u = m.parent; const w = u.world; if (m.x++ >= m.v('strikes')) { m.remove(); return; }
    for (const e of w.enemiesInRadius(u, u.x, u.y, m.v('radius'))) {
      if (e.isBuilding || !e.attackableBy(u)) continue;
      const r = w.launchAttack(u, e, { instant: true, mult: 0, add: (m.v('base_damage') + e.maxHp * m.v('max_health_damage_pct') / 100) * m.data.edge, fromAbility: m.ability });
      const ls = e.isIllusion ? m.v('illusion_lifesteal_pct') : e.heroLike ? m.v('lifesteal_pct') : m.v('lifesteal_from_creeps');
      if (r.dealt > 0 && ls > 0) u.heal(r.dealt * ls / 100, u, m.ability, true);
    }
  } });
defAbility('kez_raptor_dance', {
  prio: 75, fid: 'approx', ai: kezAI('kez_raptor_dance', false), channel: (ab) => ab.v('strikes') * ab.v('strike_interval'),
  note: 'the 1 s wind-up is the cast point (dispel + invuln_period of invulnerability are applied one tick after it starts); then one fixed-damage attack per strike_interval on every enemy in radius (base_damage + max_health_damage_pct % of its max health, physical, on-hit effects apply) with the slash lifesteal. Kez is locked for the slashes like a channel, so a stun or silence ends them early',
  cast(ab) { const u = ab.owner; const m = addMod(ab, u, 'modifier_kez_raptor_dance', ab.v('strikes') * ab.v('strike_interval') + 0.05); if (m) m.data.edge = kezEdge(u); },
  channelEnd(ab, interrupted) { if (interrupted) ab.owner.removeModifierByName('modifier_kez_raptor_dance'); } });

// --- Sai set
buff('modifier_kez_falcon_rush', { dynamic: true,
  stats: (m) => {
    const u = m.parent; const t = u.orderTarget; const o = { slowRes: m.v('slow_resist'), as: m.v('bonus_attack_speed') };
    if (t && t.alive && t.team !== u.team && !t.isBuilding && u.distTo(t) <= m.v('rush_range') && u.rangeTo(t) > u.attackRange) { o.msAbs = m.v('rush_speed'); o.msMax = m.v('rush_speed'); }
    return o;
  },
  onAttackLanded(m, rec) {
    const u = m.parent; const t = rec.target; const p = m.v('base_echo_damage') / 100;
    if (rec.fromAbility || !t.alive || t.isBuilding) return;
    u.world.launchAttack(u, t, { instant: true, mult: p, potency: u.itemPotency * p, fromAbility: m.ability });
  } });
defAbility('kez_falcon_rush', {
  prio: 60, fid: 'approx', ai: kezAI('kez_falcon_rush', true),
  note: 'for the duration every regular attack is followed at once by an echo attack at base_echo_damage % damage; the echo uses the same percentage as its Item Potency (the tooltip gives one number for both). The rush itself = movement at rush_speed towards an attack target inside rush_range; phased collision has no meaning here',
  cast(ab) { addMod(ab, ab.owner, 'modifier_kez_falcon_rush', ab.v('duration')); } });
defAbility('kez_talon_toss', {
  prio: 65, fid: 'full', ai: kezAI('kez_talon_toss', true), note: 'fixed-damage attack = an attack with True Strike that deals `damage` instead of weapon damage (attack_factor % of it is added)',
  cast(ab, t) {
    const u = ab.owner; const w = u.world;
    w.projectile(u, t, ab.v('speed'), (tt) => {
      for (const e of ab.v('radius') > 0 ? enemiesNear(ab, tt.x, tt.y, ab.v('radius')) : [tt]) {
        if (!e.alive || e.isBuilding || blocked(ab, e)) continue;
        w.launchAttack(u, e, { instant: true, mult: ab.v('attack_factor') / 100, add: ab.v('damage'), trueStrike: true, fromAbility: ab });
        if (e.alive) silence(ab, e, ab.v('silence_duration'));
      }
    });
  } });
debuff('modifier_kez_shodo_sai_mark', { pierce: true, purge: 'strong' });       // data: { strong } = Mark made by a Shard parry
function kezMark(u, sai, e, strong) { if (sai && sai.level > 0 && e.alive) e.addModifier('modifier_kez_shodo_sai_mark', { caster: u, ability: sai, duration: sai.v('vuln_duration'), pierce: true, data: { strong } }); }
modifier('modifier_kez_shodo_sai', { hidden: true,
  onAttack(m, rec) {
    const t = rec.target; if (t.isBuilding) return;
    const mk = t.findModifier('modifier_kez_shodo_sai_mark');
    if (mk) {
      const strong = !!(mk.data && mk.data.strong); const c = (m.v('base_crit_pct') + (strong ? m.v('parry_bonus_crit') : 0)) / 100;
      if (c > rec.crit) rec.crit = c; (rec.data ||= {}).kezMark = strong ? 2 : 1; mk.remove();
    } else if (kezSai(m.parent) && m.roll(m.v('sai_proc_vuln_chance'))) { const c = m.v('base_crit_pct') / 100; if (c > rec.crit) rec.crit = c; }
  },
  onAttackLanded(m, rec) {
    const k = rec.data && rec.data.kezMark;
    if (k && rec.target.alive) stun(m.ability, rec.target, m.v('stun_duration') + (k === 2 ? m.v('parry_bonus_stun_duration') : 0), true);
  } });
modifier('modifier_kez_shodo_sai_parry', { purge: 'none', state: ['DISARM'], stats: (m) => ({ msPct: -m.v('speed_penalty') }),
  onPreAttacked(m, rec) {
    const u = m.parent; const a = rec.attacker; const D = m.data; if (a.team === u.team) return;
    const v = aim(u.x, u.y, a.x, a.y); if (v.dx * D.dx + v.dy * D.dy < Math.cos(m.v('forward_angle') * Math.PI / 360) - 1e-9) return;      // outside the parried arc
    rec.cancel = true;
    if (m.v('parry_only_heroes') > 0 && !a.isHero) return;
    D.parried++;
    stun(m.ability, a, m.v('parry_stun_duration'), true);
    kezMark(u, m.ability, a, m.v('parry_bonus_crit') > 0 || m.v('parry_bonus_stun_duration') > 0);
  } });
defAbility('kez_shodo_sai', {
  mods: ['modifier_kez_shodo_sai'], prio: 90, fid: 'approx', ai: kezAI('kez_shodo_sai', true),
  note: 'passive: sai_proc_vuln_chance % critical strikes while the Sai are in hand; any Kez attack on a Marked unit is a guaranteed crit, stuns and uses up the Mark. Active: disarm for parry_duration and negate every enemy attack arriving from within forward_angle of the chosen direction (the direction of the attacker the controller parries); a parried hero is stunned and Marked (stronger Mark with Shard). The speed_penalty value is applied as a movement slow while parrying (it has no tooltip line)',
  cast(ab, t, x, y) { const u = ab.owner; const a = aim(u.x, u.y, x, y); addMod(ab, u, 'modifier_kez_shodo_sai_parry', ab.v('parry_duration'), { data: { dx: a.dx, dy: a.dy, parried: 0 } }); } });
defAbility('kez_shodo_sai_parry_cancel', {
  prio: 96, fid: 'full', note: 'controller: ends the parry as soon as one hero attack has been parried, so the Mark can be used',
  ai: (ab, u) => { const m = u.findModifier('modifier_kez_shodo_sai_parry'); return m && m.data.parried > 0 ? here(u) : null; },
  cast(ab) { ab.owner.removeModifierByName('modifier_kez_shodo_sai_parry'); } });
modifier('modifier_kez_ravens_veil', { purge: 'none', state: ['INVIS'], stats: (m) => ({ msPct: m.v('bonus_ms') }), onAttack(m) { m.remove(); }, onCast(m, ev) { if (ev.ability !== m.ability && reveals(ev.ability)) m.remove(); } });
defAbility('kez_ravens_veil', {
  prio: 70, fid: 'approx', ai: kezAI('kez_ravens_veil', true), note: 'the vision debuff is not modelled (no vision); the Mark reaches each enemy hero after distance / blast_speed',
  cast(ab) {
    const u = ab.owner; const w = u.world; const sai = u.findAbility('kez_shodo_sai');
    if (ab.v('basic_dispel') > 0) u.purge({ debuffs: true });
    addMod(ab, u, 'modifier_kez_ravens_veil', ab.v('buff_duration'));
    for (const e of w.inRadius(u.x, u.y, ab.v('blast_radius'), u.team, true)) {
      if (ab.v('mark_only_heroes') > 0 && !e.isHero) continue;
      w.after(u.distTo(e) / ab.v('blast_speed'), () => kezMark(u, sai, e, ab.v('apply_parry_bonus') > 0));
    }
  } });

// ================================================================ Oracle
debuff('modifier_oracle_fortunes_end', { state: ['ROOT'], interval: 0.1, onThink(m) { if (m.v('purge_constantly') > 0) m.parent.purge({ debuffs: false, buffs: true }); } });
function oracleBolt(ab, t, f) {
  const u = ab.owner; const dur = ab.v('minimum_purge_duration') + (ab.v('maximum_purge_duration') - ab.v('minimum_purge_duration')) * f;
  u.world.projectile(u, t, ab.v('bolt_speed'), (tt) => {
    if (tt.team === u.team) tt.purge({ debuffs: true });
    for (const e of enemiesNear(ab, tt.x, tt.y, ab.v('radius'))) {
      if (e.isBuilding) continue;
      if (!blocked(ab, e)) { e.purge({ debuffs: false, buffs: true }); addMod(ab, e, 'modifier_oracle_fortunes_end', dur); }
      hit(ab, e, ab.v('damage'), MAGICAL);
    }
  });
}
defAbility('oracle_fortunes_end', {
  prio: 55, fid: 'approx', channel: (ab) => ab.v('channel_time'),
  note: 'controller always channels the full channel_time on an enemy (root = maximum_purge_duration); an interrupted channel releases the bolt with the root scaled by the time channelled. Cast on an ally (explicit order) it dispels that ally and still hits enemies around it. On invulnerable units only the dispel takes effect (the engine blocks debuffs and damage on them)',
  ai: (ab, u, t) => (t && !t.isBuilding && !t.isImmune() && u.distTo(t) <= ab.castRange() + 150 ? { target: t } : null),
  cast(ab, t) { ab.data = { t, at: ab.owner.world.time }; },
  channelEnd(ab) { const D = ab.data; ab.data = null; if (D && D.t && D.t.alive && ab.owner.alive) oracleBolt(ab, D.t, clamp((ab.owner.world.time - D.at) / ab.v('channel_time'), 0, 1)); } });
debuff('modifier_oracle_fates_edict', { state: ['DISARM'], stats: (m) => ({ mr: m.v('magic_damage_resistance_pct_tooltip') }) });
defAbility('oracle_fates_edict', {
  prio: 62, fid: 'full', note: 'controller: only used to disarm an enemy hero that is attacking Oracle\'s team (ally casts work through explicit orders)',
  ai: (ab, u, t) => { const h = heroFocus(u, t, ab.castRange() + 150, (e) => !e.isImmune() && !e.isDisarmed() && !!e.attackTarget && e.attackTarget.alive && e.attackTarget.team === u.team); return h ? { target: h } : null; },
  cast(ab, t) { addMod(ab, t || ab.owner, 'modifier_oracle_fates_edict', ab.v('duration')); } });
buff('modifier_oracle_purifying_flames', { multi: 'independent', interval: (m) => m.v('tick_rate'), onThink(m) { m.parent.heal(m.v('heal_per_second') * m.v('tick_rate'), m.caster, m.ability); } });
defAbility('oracle_purifying_flames', {
  prio: 58, fid: 'full',
  note: 'controller: heals allies that are under False Promise or Fate\'s Edict; on enemies it is cast only as a finisher or right before Fortune\'s End (which dispels the regeneration)',
  ai: (ab, u, t) => {
    const reach = ab.castRange() + 100;
    for (const a of realAllies(u, true)) if (u.distTo(a) <= reach && (a.hasModifier('modifier_oracle_false_promise') || (a.hasModifier('modifier_oracle_fates_edict') && a.hp < a.maxHp))) return { target: a };
    if (!t || t.isBuilding || t.isImmune() || t.hasModifier('modifier_oracle_fates_edict') || u.distTo(t) > reach) return null;
    if (t.hp <= ab.v('damage') * ab.v('damage_modifier') * (1 + u.spellAmp / 100) * (1 - t.mr)) return { target: t };
    const fe = u.findAbility('oracle_fortunes_end');
    return fe && fe.level > 0 && fe.ready() && !t.hasModifier('modifier_oracle_purifying_flames') ? { target: t } : null;
  },
  cast(ab, t) {
    const u = ab.owner; const tt = t || u; const enemy = tt.team !== u.team;
    hit(ab, tt, ab.v('damage') * (enemy ? ab.v('damage_modifier') : 1), MAGICAL, enemy ? 0 : F_NON_LETHAL);
    if (tt.alive) addMod(ab, tt, 'modifier_oracle_purifying_flames', ab.v('duration') + ab.v('tick_rate') / 2);
  } });
modifier('modifier_oracle_rain_of_destiny_ally', { purge: 'none', stats: (m) => ({ restore: m.v('heal_amp') }) });
debuff('modifier_oracle_rain_of_destiny_enemy', { purge: 'none', stats: (m) => ({ restore: -m.v('heal_amp') }) });
defAbility('oracle_rain_of_destiny', {
  prio: 45, fid: 'approx', note: 'heal amplification is applied through the health-restoration multiplier of units standing in the rain (it also scales their regeneration and lifesteal)',
  ai: (ab, u, t) => (t && u.distTo(t) <= ab.castRange() + 200 ? { x: t.x, y: t.y } : null),
  cast(ab, t, x, y) {
    // [L] measured in Hero Demo: a damage / heal tick on cast and every tick_rate after it (duration / tick_rate + 1 ticks)
    const u = ab.owner; const w = u.world; const iv = ab.v('tick_rate'); const n = Math.round(ab.v('duration') / iv); const r = ab.v('radius');
    for (let i = 0; i <= n; i++) w.after(i * iv, () => {
      for (const e of w.inRadius(x, y, r, u.team, true)) { if (e.isBuilding) continue; hit(ab, e, ab.v('damage') * iv, MAGICAL); if (i < n && e.alive) addMod(ab, e, 'modifier_oracle_rain_of_destiny_enemy', iv + 0.1); }
      for (const a of w.inRadius(x, y, r, u.team, false)) { if (a.isBuilding) continue; a.heal(ab.v('damage') * iv, u, ab); if (i < n) addMod(ab, a, 'modifier_oracle_rain_of_destiny_ally', iv + 0.1); }
    });
  } });
const ORACLE_CARDS = ['death', 'fool', 'world', 'lovers', 'tower'];
modifier('modifier_oracle_diviners_deck_card', { purge: 'none', interval: 0.5,      // data.card; x = Tower barrier left, y = time of the last damage
  onCreated(m) { m.x = m.data.card === 'tower' ? m.v('barrier_amount') : 0; m.y = -100; },
  apply(m, s, u) {
    const c = m.data.card;
    if (c === 'death') s.spellAmp += m.v('spell_amplification'); else if (c === 'lovers') s.healAmp += m.v('heal_amplification');
    else if (c === 'world') s.int += (u.baseAttr('int') + u.attrLevels * 2 + s.int) * m.v('int_bonus_pct') / 100;
  },
  postMit(m, d) { if (m.data.card !== 'tower' || d.amount <= 0) return; m.y = m.parent.world.time; const a = Math.min(d.amount, m.x); d.amount -= a; m.x -= a; },
  onThink(m) { if (m.data.card === 'tower' && m.x < m.v('barrier_amount') && m.parent.world.time - m.y >= m.v('barrier_restore_time')) m.x = m.v('barrier_amount'); } });
modifier('modifier_oracle_diviners_deck', { hidden: true, purge: 'none', interval: (m) => m.v('duration'), thinkNow: true,
  onThink(m) { const u = m.parent; u.removeModifierByName('modifier_oracle_diviners_deck_card'); u.addModifier('modifier_oracle_diviners_deck_card', { ability: m.ability, duration: m.v('duration'), data: { card: ORACLE_CARDS[u.world.rng.int(0, ORACLE_CARDS.length - 1)] } }); },
  onDestroy(m) { m.parent.removeModifierByName('modifier_oracle_diviners_deck_card'); } });
defAbility('oracle_diviners_deck', {
  mods: ['modifier_oracle_diviners_deck'], requires: (ab) => ab.v('enabled') > 0, fid: 'approx',
  note: 'Scepter only: a random card at the start of the fight and every `duration` seconds. Death, The Lovers and The Tower (barrier refills after barrier_restore_time without damage) are exact; The World adds int_bonus_pct % of the intelligence from sources applied before it; The Fool (gold) has no effect here' });
// settles the delayed balance of False Promise; "takes effect as soon as the target becomes vulnerable"
function oracleSettle(u, ab, net, src) {
  if (!u.alive || net === 0) return;
  if (u.st[ST.INVULN] > 0 || u.st[ST.OUT] > 0) { u.world.after(0.1, () => oracleSettle(u, ab, net, src)); return; }
  if (net > 0) { if (u.restoreMul > 0) u.heal(net / u.restoreMul, null, ab, true); } else u.world.damage(src, u, -net, PURE, F_HP_LOSS | F_NO_AMP, ab);
}
modifier('modifier_oracle_false_promise', { purge: 'none', state: ['CANNOT_DIE'], stats: (m) => ({ armor: m.v('bonus_armor') }),      // x = delayed damage, y = delayed (amplified) healing
  postMit(m, d) { if (d.amount <= 0) return; m.x += d.amount; m.data = d.src; d.amount = 0; },
  onHealed(m, ev) { m.parent.hp -= ev.amount; m.y += ev.amount * (1 + m.v('heal_amp_pct') / 100); },
  onDestroy(m) { const u = m.parent; oracleSettle(u, m.ability, m.y - m.x, m.data && m.data.team !== u.team ? m.data : null); } });
defAbility('oracle_false_promise', {
  prio: 95, fid: 'approx',
  note: 'strong dispel on cast; damage is recorded after armor / magic resistance and healing after amplification, both are withheld (the target cannot die) and the difference is applied when it ends, or as soon as the target is no longer invulnerable: surplus healing as a heal, surplus damage as direct health loss credited to the last enemy that hit. Health regeneration and direct health-loss effects are not delayed; a withheld heal only counts up to the health the target is missing when it arrives (the engine reports no more than that), and the combat log still lists it at that moment. Controller: lowest-health allied hero (or Oracle) below 40% health that was hit in the last 2 s',
  ai: (ab, u) => {
    let best = null; const now = u.world.time;
    for (const a of realAllies(u, true)) if (hpFrac(a) < 0.4 && now - a.lastHurt < 2 && u.distTo(a) <= ab.castRange() + 200 && !a.hasModifier('modifier_oracle_false_promise') && (!best || hpFrac(a) < hpFrac(best))) best = a;
    return best ? { target: best } : null;
  },
  cast(ab, t) { const tt = t || ab.owner; tt.purge({ debuffs: true, strong: true }); addMod(ab, tt, 'modifier_oracle_false_promise', ab.v('duration')); } });
defAbility('oracle_prognosticate', { mods: [skillSync('oracle_prognosticate', { basics: ['oracle_fortunes_end', 'oracle_fates_edict', 'oracle_purifying_flames'], helpers: { oracle_diviners_deck: null } })],
  fid: 'n/a', note: 'rune and Roshan timer announcements; no combat effect' });

// ================================================================ Dawnbreaker
const DAWN_SCEPTER_CHARGES = 2;   // "gets 2 Luminosity attacks every time she powers up": the count is written in the Scepter tooltip only, there is no data value
const DAWN_DAY_LEFT = 0.998;      // [L] measured in Hero Demo: on an ordinary day Break of Dawn gives 99.8% of max_dmg_pct there (attack rolls of 167..171 land as 230.33..235.85 at level 30); the demo clock stands still just after sunrise and the sandbox has no time of day, so this is "the day" here
const DAWN_TRAIL_LINGER = 1;      // [L] measured in Hero Demo: the fire-trail debuff (and the talent's speed buff) lasts 1 s and is renewed while the unit stands on the trail
const dawnHammer = (u) => u.findModifier('modifier_dawnbreaker_celestial_hammer');
const dawnHammerOut = (u) => { const m = dawnHammer(u); return !!m && m.data.phase < 3; };
// one counted attack: true when it is a charged (critical, healing) one
function dawnCharge(m) {
  if (m.stacks > 0) { m.setStacks(m.stacks - 1); return true; }
  if (m.parent.st[ST.BREAK] > 0) return false;      // "Break disables the gaining of new stacks": a charge that is already up still fires
  if (++m.x >= m.v('attack_count')) { m.x = 0; m.setStacks(m.parent.hasScepter ? DAWN_SCEPTER_CHARGES : 1); }
  return false;
}
// one hammer swing of Starbreaker = one attack for Luminosity, however many enemies it hits
function dawnSwing(ab, list, bonus) {
  const u = ab.owner; const lum = u.findModifier('modifier_dawnbreaker_luminosity'); const targets = list.filter((e) => e.alive && !e.isBuilding && e.attackableBy(u));
  if (lum) lum.z = targets.length && dawnCharge(lum) ? 2 : 1;
  for (const e of targets) u.world.launchAttack(u, e, { instant: true, flat: bonus, fromAbility: ab });
  if (lum) lum.z = 0;
  return targets;
}
passive('dawnbreaker_luminosity', {
  fid: 'full', note: 'healing = heal_pct % of the damage the charged attack dealt (to Dawnbreaker in full, allied_healing_pct % to allied heroes in heal_radius); creeps give heal_from_creeps % of that (value name; its tooltip label reads "creep heal penalty"). A Starbreaker swing counts as one attack. Scepter gives 2 charged attacks (number from the tooltip text). Break only stops the counting of attacks, a charge that is already up still fires',
  breakable: false,       // Break is handled in dawnCharge: it "disables the gaining of new stacks" only
  onAttack(m, rec) {      // z: 0 = regular attack, 1 = part of a plain swing, 2 = part of a charged swing
    if (rec.target.isBuilding) return;
    if (!(m.z ? m.z === 2 : dawnCharge(m))) return;
    const c = m.v('bonus_damage') / 100; if (c > rec.crit) rec.crit = c; (rec.data ||= {}).lum = m;
  },
  onAttackLanded(m, rec) {
    if (!(rec.data && rec.data.lum === m) || rec.dealt <= 0) return;
    const u = m.parent; const heal = rec.dealt * m.v('heal_pct') / 100 * (rec.target.heroLike ? 1 : m.v('heal_from_creeps') / 100);
    u.heal(heal, u, m.ability);
    for (const a of u.world.alliesInRadius(u, u.x, u.y, m.v('heal_radius'))) if (a !== u && a.isHero) a.heal(heal * m.v('allied_healing_pct') / 100, u, m.ability);
  } });
debuff('modifier_dawnbreaker_fire_wreath_slow', { stats: (m) => ({ msPct: m.v('swipe_slow') }) });      // swipe_slow is negative in the data
// data: { x, y (cast point), dx, dy (direction), iv (time between swings), next (time of the next swing) }; x = swings done; z = 1 with Shard
modifier('modifier_dawnbreaker_fire_wreath', { purge: 'none', state: ['DISARM'], interval: (m) => m.parent.world.dt, thinkNow: true,
  stats: (m) => (m.v('immunity_resist') > 0 ? { mr: m.v('immunity_resist'), msAbs: m.v('movement_speed'), msCap: m.v('movement_speed') } : {}),
  onCreated(m) { if (m.v('immunity_resist') > 0) { m.parent.st[ST.IMMUNE]++; m.z = 1; } },
  onDestroy(m) { if (m.z === 1) m.parent.st[ST.IMMUNE]--; },
  onThink(m) {
    const u = m.parent; const w = u.world; const ab = m.ability; const D = m.data; const n = m.v('total_attacks'); const reach = m.v('smash_distance_from_hero');
    if (u.st[ST.ROOT] === 0) {
      if (m.z === 1) {      // Shard: she walks (to the cast point here) at movement_speed
        const a = aim(u.x, u.y, D.x, D.y); const go = Math.min(a.d, m.v('movement_speed') * w.dt);
        if (a.d > 1e-6) { D.dx = a.dx; D.dy = a.dy; u.x += a.dx * go; u.y += a.dy * go; }
      } else { const go = m.v('movement_speed') / m.v('duration') * w.dt; u.x += D.dx * go; u.y += D.dy * go; }      // [L] measured in Hero Demo: she slides movement_speed units per `duration` (195.45 per second) in the cast direction, past the cast point
    }
    if (w.time + 1e-9 < D.next) return;
    D.next = w.time + D.iv;
    if (++m.x < n) { for (const e of dawnSwing(ab, w.enemiesInRadius(u, u.x, u.y, m.v('swipe_radius')), m.v('swipe_damage'))) if (e.alive) addMod(ab, e, 'modifier_dawnbreaker_fire_wreath_slow', m.v('sweep_stun_duration')); return; }
    for (const e of dawnSwing(ab, w.enemiesInRadius(u, u.x + D.dx * reach, u.y + D.dy * reach, m.v('smash_radius')), m.v('smash_damage'))) if (e.alive) stun(ab, e, m.v('smash_stun_duration'));
    m.remove();
    if (m.v('self_stun_duration') > 0) u.addModifier('modifier_stunned', { caster: u, ability: ab, duration: m.v('self_stun_duration'), noResist: true });
  } });
const dawnWreathGap = (ab) => tickUp(ab.owner.world, ab.v('duration') / Math.max(1, ab.v('total_attacks') - 1));
defAbility('dawnbreaker_fire_wreath', {
  prio: 60, fid: 'approx', channel: (ab) => dawnWreathGap(ab) * Math.max(1, ab.v('total_attacks') - 1),
  note: 'total_attacks swings: the first on cast, the others `duration` / (total_attacks - 1) apart (on server frames: 0.567 s). The first ones hit everything in swipe_radius and slow, the last one hits smash_radius around the point smash_distance_from_hero ahead and stuns; each swing is an attack + bonus damage with on-hit effects. She is disarmed, slides movement_speed units per `duration` in the cast direction and is stunned for self_stun_duration after the last swing (with Shard: debuff immune, walks to the cast point at movement_speed). She is locked like a channel, so without Shard a stun ends the combo. "Cleave does not work" cannot be enforced (a cleave item still triggers on the swings). The attack roll of a swing is random, so single swings differ from a recording by the roll',
  ai: (ab, u, t) => (t && !t.isBuilding && !dawnHammerOut(u) && u.distTo(t) <= ab.v('swipe_radius') + 50 ? { x: t.x, y: t.y } : null),
  cast(ab, t, x, y) {
    const u = ab.owner; if (dawnHammerOut(u)) return;
    const f = focus(u); const a = aim(u.x, u.y, x, y); const b = a.d > 1e-6 || !f ? a : aim(u.x, u.y, f.x, f.y);
    addMod(ab, u, 'modifier_dawnbreaker_fire_wreath', undefined, { data: { x, y, dx: b.dx, dy: b.dy, iv: dawnWreathGap(ab), next: 0 } });
  },
  channelEnd(ab, interrupted) { if (interrupted) ab.owner.removeModifierByName('modifier_dawnbreaker_fire_wreath'); } });
function dawnPass(m, x1, y1, x2, y2) { for (const e of enemiesInLine(m.ability, x1, y1, x2, y2, 2 * (m.v('projectile_radius')))) { if (m.data.hit.has(e) || e.isBuilding) continue; m.data.hit.add(e); mhit(m, e, m.v('hammer_damage'), MAGICAL); } }
function dawnTrail(m, x1, y1, x2, y2) { m.data.trail.push({ x1, y1, x2, y2, end: m.parent.world.time + m.v('flare_debuff_duration') }); }
function dawnOnTrail(e, s, half) {      // same geometry as enemiesInLine: within half width + hull of the segment
  const vx = s.x2 - s.x1; const vy = s.y2 - s.y1; const k = clamp(((e.x - s.x1) * vx + (e.y - s.y1) * vy) / (vx * vx + vy * vy || 1), 0, 1);
  const px = s.x1 + vx * k - e.x; const py = s.y1 + vy * k - e.y; const r = half + e.def.hull; return px * px + py * py <= r * r;
}
debuff('modifier_dawnbreaker_celestial_hammer_slow', { interval: (m) => m.v('burn_interval'), thinkNow: true, stats: (m) => ({ msPct: -m.v('move_slow') }),
  onThink(m) { mhit(m, m.parent, m.v('burn_damage') * m.v('burn_interval'), MAGICAL); } });
buff('modifier_dawnbreaker_celestial_hammer_haste', { stats: (m) => ({ msPct: m.v('move_slow') }) });      // talent: "Bonus movement speed is equal to the movement slow"
modifier('modifier_dawnbreaker_celestial_hammer', { purge: 'none', interval: (m) => m.parent.world.dt,      // data.phase: 0 flying out, 1 resting, 2 flying back, 3 back in hand (only the trail is left)
  onThink(m) {
    const u = m.parent; const w = u.world; const D = m.data; const step = m.v('projectile_speed') * w.dt; const now = w.time;
    if (D.phase === 0 || D.phase === 2) {
      const a = D.phase === 0 ? aim(D.x, D.y, D.tx, D.ty) : aim(D.x, D.y, u.x, u.y); const go = Math.min(a.d, step); const nx = D.x + a.dx * go; const ny = D.y + a.dy * go;
      dawnPass(m, D.x, D.y, nx, ny); if (D.phase === 2) dawnTrail(m, D.x, D.y, nx, ny);
      D.x = nx; D.y = ny;
      if (a.d <= step + 1e-6) { if (D.phase === 0) { D.phase = 1; D.wait = now + m.v('pause_duration'); } else D.phase = 3; }
    } else if (D.phase === 1 && now + 1e-9 >= D.wait) { D.phase = 2; D.hit = new Set(); dawnPass(m, D.x, D.y, D.x, D.y); dawnTrail(m, D.x, D.y, D.x, D.y); }      // the return starts: units at the hammer are hit and burned at once
    if (D.trail.length) {
      D.trail = D.trail.filter((s) => s.end + 1e-9 >= now);
      const half = m.v('flare_radius'); const haste = m.v('targets_allies') > 0;      // talent "Trail Grants Movement Speed to Allies"
      for (const e of w.units) {
        if (!e.alive || e.isBuilding || e.st[ST.OUT] > 0 || (e.team === u.team && !haste) || !D.trail.some((s) => dawnOnTrail(e, s, half))) continue;
        e.addModifier(e.team === u.team ? 'modifier_dawnbreaker_celestial_hammer_haste' : 'modifier_dawnbreaker_celestial_hammer_slow', { caster: u, ability: m.ability, duration: DAWN_TRAIL_LINGER });
      }
    }
    if (D.phase === 3 && !D.trail.length) m.remove();
  } });
defAbility('dawnbreaker_celestial_hammer', {
  prio: 56, fid: 'approx',
  note: 'the hammer is stepped along its path every tick: hammer_damage once per pass to enemies within projectile_radius on the way out (from the cast on) and on the way back, pause_duration at the end point, and a fire trail along the return path that lasts flare_debuff_duration. An enemy on the trail carries a 1 s debuff (renewed while it stands there; duration measured in the game) that slows and burns burn_damage x burn_interval at once and every burn_interval. Talent: allied units on the trail (Dawnbreaker included) gain movement speed equal to move_slow the same way; that amount comes from the talent\'s own description in the game\'s localization file, the data pack has no value for it',
  ai: (ab, u, t) => (t && !t.isBuilding && !dawnHammer(u) && !u.hasModifier('modifier_dawnbreaker_fire_wreath') && u.distTo(t) <= ab.v('range') + u.castRangeBonus ? { x: t.x, y: t.y } : null),
  cast(ab, t, x, y) {
    const u = ab.owner; const a = aim(u.x, u.y, x, y); const L = Math.min(a.d, ab.v('range') + u.castRangeBonus);
    u.removeModifierByName('modifier_dawnbreaker_celestial_hammer');
    const m = addMod(ab, u, 'modifier_dawnbreaker_celestial_hammer', undefined, { data: { x: u.x, y: u.y, tx: u.x + a.dx * L, ty: u.y + a.dy * L, phase: 0, wait: 0, hit: new Set(), trail: [] } });
    if (m) dawnPass(m, u.x, u.y, u.x, u.y);      // enemies already inside the hammer's radius are hit as it leaves her hand
  } });
defAbility('dawnbreaker_converge', {
  prio: 100, fid: 'approx', note: 'Dawnbreaker and the hammer meet half way at once (her travel is capped at the hammer cast range); the hammer damages and leaves its trail on its half. Controller: used only as a gap closer while the target is out of reach. Not recorded in the live game',
  ai: (ab, u, t) => {
    const m = dawnHammer(u); if (!m || m.data.phase > 1 || !t || u.st[ST.ROOT] > 0 || u.rangeTo(t) - u.attackRange <= 150) return null;
    const mx = (u.x + m.data.x) / 2; const my = (u.y + m.data.y) / 2; return Math.sqrt((mx - t.x) * (mx - t.x) + (my - t.y) * (my - t.y)) < u.distTo(t) - 100 ? here(u) : null;
  },
  cast(ab) {
    const u = ab.owner; const m = dawnHammer(u); if (!m || m.data.phase > 1 || u.st[ST.ROOT] > 0) return;
    const D = m.data; const h = u.findAbility('dawnbreaker_celestial_hammer'); const a = aim(u.x, u.y, D.x, D.y); const go = Math.min(a.d / 2, h ? h.v('range') + u.castRangeBonus : a.d / 2);
    const mx = u.x + a.dx * go; const my = u.y + a.dy * go;
    D.hit = new Set(); dawnPass(m, D.x, D.y, mx, my); dawnTrail(m, D.x, D.y, mx, my);
    u.x = mx; u.y = my; D.x = mx; D.y = my; D.phase = 3;
  } });
// "creates daylight for daytime_duration": the world flag is switched the way the other day / night abilities do it, and a night it replaced comes back afterwards
const DAWN_DAY = new WeakMap();      // world -> { on, until, night }: her daylight is in force until `until`; night = it replaced a night
function dawnDaylight(w, dur) {
  let d = DAWN_DAY.get(w); if (!d) DAWN_DAY.set(w, d = { on: false, until: -1, night: false });
  const dirty = () => { for (const x of w.units) x.dirty = true; };
  if (!d.on) { d.on = true; d.night = !w.isDay; }
  d.until = Math.max(d.until, w.time + dur); w.isDay = true; dirty();
  w.after(dur, () => { if (!d.on || w.time + 1e-6 < d.until) return; d.on = false; if (d.night && w.isDay) w.isDay = false; dirty(); });
}
modifier('modifier_dawnbreaker_solar_guardian_daylight', { purge: 'none' });      // marker for the combat log; the daylight itself is the world flag
modifier('modifier_dawnbreaker_solar_guardian_air', { purge: 'none', state: ['STUN', 'SILENCE', 'DISARM', 'MUTE', 'OUT'] });
// data: { x, y (landing point), next (time of the next pulse), landAt (set when the channel completes), landed, end }
modifier('modifier_dawnbreaker_solar_guardian', { purge: 'none', interval: (m) => m.parent.world.dt, thinkNow: true,
  onThink(m) {
    const u = m.parent; const w = u.world; const D = m.data; const ab = m.ability; const now = w.time + 1e-9; const r = m.v('radius'); const aura = m.v('scepter_aura_duration');
    const land = !D.landed && D.landAt !== null && now >= D.landAt;
    if (now >= D.next) {
      D.next += tickUp(w, m.v('pulse_interval'));
      if (!land || aura > 0) {      // the pulse that would fall on the landing only exists while the Scepter aura goes on
        const x = D.landed ? u.x : D.x; const y = D.landed ? u.y : D.y;
        for (const e of w.inRadius(x, y, r, u.team, true)) if (!e.isBuilding) mhit(m, e, m.v('base_damage'), MAGICAL);
        for (const a of w.inRadius(x, y, r, u.team, false)) if (!a.isBuilding) a.heal(m.v('base_heal'), u, ab);
      }
    }
    if (land) {
      D.landed = true; D.end = w.time + aura; u.removeModifierByName('modifier_dawnbreaker_solar_guardian_air'); u.x = D.x; u.y = D.y;
      for (const e of enemiesNear(ab, u.x, u.y, r)) { if (e.isBuilding) continue; hit(ab, e, m.v('land_damage'), MAGICAL); stun(ab, e, m.v('land_stun_duration')); }
    }
    if (D.landed && now >= D.end) m.remove();
  } });
defAbility('dawnbreaker_solar_guardian', {
  prio: 72, fid: 'approx', channel: true,
  note: 'the point is clamped to max_offset_distance around the allied hero nearest to it; in Hero Demo she herself counts as that hero. A pulse on cast and every pulse_interval (damage to enemies, heal to allies in radius of the point) until she lands: channel time, then airtime_duration out of play (stunned, silenced, muted, disarmed), then land_damage and stun; the pulse that would coincide with the landing is not fired. An interrupted channel cancels the flight. Scepter: the pulses go on around her for scepter_aura_duration after landing, the one at the landing included (the other Scepter values of the ability have no tooltip text and are ignored). Daylight: the world is day for daytime_duration from the cast (Break of Dawn at full power), then a night it replaced returns. The game moves her off a unit she lands on (collision); the sandbox leaves her on the point',
  ai: (ab, u, t) => {
    if (!t || t.isBuilding) return null;
    const a = nearestOf(realAllies(u, true), t.x, t.y); if (!a) return null;
    const d = a.distTo(t); if (d > ab.v('radius') + ab.v('max_offset_distance') - 100) return null;
    const k = Math.min(1, ab.v('max_offset_distance') / (d || 1)); return { x: a.x + (t.x - a.x) * k, y: a.y + (t.y - a.y) * k };
  },
  cast(ab, t, x, y) {
    const u = ab.owner; const w = u.world; const a = nearestOf(realAllies(u, true), x, y) || u; ab.data = null;
    const v = aim(a.x, a.y, x, y); const off = Math.min(v.d, ab.v('max_offset_distance'));
    const h = dawnHammer(u); if (h) h.data.phase = 3;                              // "instantly recalls the Hammer on cast"
    u.addModifier('modifier_dawnbreaker_solar_guardian_daylight', { ability: ab, duration: ab.v('daytime_duration') }); dawnDaylight(w, ab.v('daytime_duration'));
    u.removeModifierByName('modifier_dawnbreaker_solar_guardian');
    ab.data = addMod(ab, u, 'modifier_dawnbreaker_solar_guardian', undefined, { data: { x: a.x + v.dx * off, y: a.y + v.dy * off, next: w.time, landAt: null, landed: false, end: 0 } });
  },
  channelEnd(ab, interrupted) {
    const u = ab.owner; const m = ab.data; if (!m || m.removed) return;
    if (interrupted) { m.remove(); return; }
    m.data.landAt = u.world.time + ab.v('airtime_duration'); addMod(ab, u, 'modifier_dawnbreaker_solar_guardian_air', ab.v('airtime_duration') + 1);
  } });
na('dawnbreaker_land', 'internal helper of Solar Guardian (the landing is part of that script); it has no tooltip');
modifier('modifier_dawnbreaker_break_of_dawn', { hidden: true,
  stats: (m) => { const w = m.parent.world; if (!w.isDay) return {}; const d = DAWN_DAY.get(w); const p = m.v('max_dmg_pct') * (d && d.on ? 1 : DAWN_DAY_LEFT); return { dmgBasePct: p, healAmp: p * m.v('heal_amp') }; } });
defAbility('dawnbreaker_break_of_dawn', {
  mods: ['modifier_dawnbreaker_break_of_dawn', skillSync('dawnbreaker_break_of_dawn', { basics: ['dawnbreaker_fire_wreath', 'dawnbreaker_celestial_hammer', 'dawnbreaker_luminosity'], helpers: { dawnbreaker_land: null } })],
  fid: 'partial', note: 'bonus base damage (and, with Scepter, the same heal amplification) while it is day, nothing at night: the full max_dmg_pct during Solar Guardian\'s daylight, 99.8% of it on an ordinary day, which is what the Hero Demo shows (its clock stands still just after sunrise). Missing: the decay of the bonus over the course of a real day (the sandbox has no time of day); the game applies the percentage to each attack roll, the engine to the average base damage, so single attacks differ by up to 0.8; vision does not exist' });

// ================================================================ Gyrocopter
const GYRO_MISSILE = 'npc_dota_gyrocopter_homing_missile';
const GYRO_WEAK_HIT = 0.25;      // "Creeps and illusions deal 25% damage to the missile": written in the tooltip note only, there is no data value
let gyroQuiet = false;           // true while a Homing Missile fires rockets: those do not trigger Afterburner
buff('modifier_gyrocopter_afterburner_buff', { purge: 'none', interval: 0.25, onCreated(m) { m.data = []; }, stats: (m) => ({ ms: m.x }),       // data: [[expiry, bonus]], x = current bonus
  onThink(m) { const L = m.data; const now = m.parent.world.time; let ch = false; while (L.length && L[0][0] <= now) { m.x -= L.shift()[1]; ch = true; } if (!L.length) m.remove(); else if (ch) m.parent.dirty = true; } });
passive('gyrocopter_afterburner', {
  fid: 'full', note: 'every damage instance of his attacks and abilities on an enemy adds one stack (flat movement speed) with its own timer',
  onDealDamage(m, d) {
    const u = m.parent; const t = d.dst;
    if (gyroQuiet || d.dealt <= 0 || t.team === u.team || t.isBuilding || (d.ability && d.ability.isItem)) return;
    const b = u.addModifier('modifier_gyrocopter_afterburner_buff', { ability: m.ability }); const v = t.heroLike ? m.v('bonus_movement_speed_per_hit') : m.v('bonus_movement_speed_per_hit_creep');
    b.data.push([u.world.time + m.v('bonus_movespeed_duration'), v]); b.x += v; u.dirty = true;
  } });
// one rocket: a random enemy in the radius (the preferred unit first when it is inside)
function gyroRocket(ab, x, y, radius, prefer) {
  const u = ab.owner; const w = u.world;
  const c = w.enemiesInRadius(u, x, y, radius).filter((e) => !e.isBuilding && e.st[ST.INVULN] === 0 && e.st[ST.IMMUNE] === 0 && seen(w, e));
  if (c.length) hit(ab, prefer && c.includes(prefer) ? prefer : c[w.rng.int(0, c.length - 1)], ab.v('rocket_damage'), MAGICAL);
}
buff('modifier_gyrocopter_rocket_barrage', { interval: (m) => m.v('rocket_interval'), thinkNow: true, onThink(m) { const u = m.parent; gyroRocket(m.ability, u.x, u.y, m.v('radius'), null); } });
defAbility('gyrocopter_rocket_barrage', {
  prio: 50, fid: 'full', note: 'one rocket per rocket_interval at a random visible, non-immune enemy in radius',
  ai: (ab, u, t) => (t && !t.isBuilding && u.distTo(t) <= ab.v('radius') - 50 ? here(u) : null),
  cast(ab) { addMod(ab, ab.owner, 'modifier_gyrocopter_rocket_barrage', ab.v('barrage_duration')); } });
modifier('modifier_gyrocopter_homing_missile_unit', { purge: 'none', state: ['IMMUNE'], interval: (m) => m.parent.world.dt,      // on the missile unit; data: { target, acc }
  postMit(m, d) {       // only attacks hurt it: a hero needs hits_to_kill hits
    const s = d.src; if (!s || !(d.flags & F_ATTACK)) { d.amount = 0; return; }
    const pip = m.parent.maxHp / m.v('hits_to_kill'); d.amount = s.isHero && !s.isIllusion ? pip : pip * GYRO_WEAK_HIT;
  },
  onThink(m) {
    const ms = m.parent; const w = ms.world; const D = m.data; const g = m.caster; const ab = m.ability; const t = D.target; const age = w.time - m.created;
    if (!t.alive) { w.kill(ms, null, null, true); return; }
    const rb = g.findAbility('gyrocopter_rocket_barrage');      // Shard: the missile fires the current Rocket Barrage
    if (m.v('shard_radius') > 0 && rb && rb.level > 0 && age + 1e-9 >= m.v('shard_delay')) {
      D.acc += w.dt;
      while (D.acc + 1e-9 >= rb.v('rocket_interval')) { D.acc -= rb.v('rocket_interval'); gyroQuiet = true; gyroRocket(rb, ms.x, ms.y, m.v('shard_radius'), t); gyroQuiet = false; }
    }
    if (age < m.v('pre_flight_time')) return;
    const a = aim(ms.x, ms.y, t.x, t.y); const step = (m.v('speed') + m.v('acceleration') * (age - m.v('pre_flight_time'))) * w.dt;
    if (a.d > step + t.def.hull) { ms.x += a.dx * step; ms.y += a.dy * step; return; }
    if (!blocked(ab, t)) { stun(ab, t, m.v('stun_duration')); hit(ab, t, m.v('hit_damage'), MAGICAL); }
    w.kill(ms, null, null, true);
  } });
defAbility('gyrocopter_homing_missile', {
  prio: 62, fid: 'approx',
  note: 'the missile is a summoned unit: it waits pre_flight_time, then flies at `speed` + `acceleration` per second of flight (unit of the acceleration assumed) and stuns + damages on contact; it vanishes when the target dies. Enemies can attack it: hits_to_kill hero attacks destroy it, creeps and illusions do a quarter (tooltip text), spells do nothing. Shard: after shard_delay it fires Rocket Barrage rockets in shard_radius, its target first. max_distance has no tooltip text and is ignored',
  ai: (ab, u, t, w) => (t && !t.isBuilding && !t.isImmune() && u.distTo(t) <= ab.castRange() + 200 && !w.units.some((x) => x.alive && x.owner === u && x.name === GYRO_MISSILE) ? { target: t } : null),
  cast(ab, t) {
    const u = ab.owner; const ms = summon(ab, GYRO_MISSILE, { x: u.x, y: u.y, ai: 'idle' });
    ms.addModifier('modifier_gyrocopter_homing_missile_unit', { caster: u, ability: ab, data: { target: t, acc: 0 } });
  } });
modifier('modifier_gyrocopter_flak_cannon', { purge: 'none', multi: 'stack',
  onAttack(m, rec) {
    const u = m.parent; const w = u.world; if (rec.fromAbility) return;
    for (const e of w.enemiesInRadius(u, u.x, u.y, m.v('radius'))) {
      if (e === rec.target || e.isBuilding || !e.attackableBy(u)) continue;
      const r = w.launchAttack(u, e, { fromAbility: m.ability, flat: m.v('bonus_damage'), potency: u.itemPotency * m.v('attack_effectiveness') / 100 });
      r.crit = 1; r.noLifesteal = true;        // extra attacks cannot crit or lifesteal
    }
    if (m.stacks <= 1) m.remove(); else m.setStacks(m.stacks - 1);
  } });
defAbility('gyrocopter_flak_cannon', {
  prio: 57, fid: 'approx', note: 'each of the next max_attacks attacks also launches a full attack at every other enemy in radius with attack_effectiveness % Item Potency, no crit and no lifesteal; the extra projectiles fly at his normal projectile speed instead of projectile_speed',
  ai: (ab, u, t) => { if (!t || u.hasModifier('modifier_gyrocopter_flak_cannon') || u.rangeTo(t) > u.attackRange + 200) return null; let n = 0; for (const e of u.world.enemiesInRadius(u, u.x, u.y, ab.v('radius'))) if (!e.isBuilding && e.attackableBy(u)) n++; return n >= 2 ? here(u) : null; },
  cast(ab) { const u = ab.owner; u.removeModifierByName('modifier_gyrocopter_flak_cannon'); u.addModifier('modifier_gyrocopter_flak_cannon', { ability: ab, duration: ab.v('AbilityDuration'), stacks: ab.v('max_attacks') }); } });
passive('gyrocopter_side_gunner_spawn_ability', {
  fid: 'approx', note: 'every sidegunner_fire_rate a full attack with attack_effectiveness % Item Potency is launched from Gyrocopter at the farthest enemy unit in range (also while he is disabled); the gunner is not a separate unit. double_target has no tooltip text and is ignored',
  interval: (m) => m.v('sidegunner_fire_rate'),
  onThink(m) {
    const u = m.parent; const w = u.world; let best = null; let bd = -1;
    for (const e of w.inRadius(u.x, u.y, m.ability.castRange(), u.team, true)) { if (e.isBuilding || !e.attackableBy(u)) continue; const d = u.distTo(e); if (d > bd) { bd = d; best = e; } }
    if (best) w.launchAttack(u, best, { fromAbility: m.ability, potency: u.itemPotency * m.v('attack_effectiveness') / 100 });
  } });
na('gyrocopter_side_gunner', 'marker passive of the Side Gunner unit (no values, no tooltip); the gunner is scripted on Gyrocopter as gyrocopter_side_gunner_spawn_ability and the unit is not spawned');
debuff('modifier_gyrocopter_call_down_slow', { stats: (m) => ({ msPct: -m.v('slow') }) });
defAbility('gyrocopter_call_down', {
  prio: 72, fid: 'approx', note: 'first strike on the target point after missile_delay_tooltip, each next one strike_delay later and strike_separation farther along the line from Gyrocopter through the point (direction assumed); the tracking_* values have no tooltip text and are ignored',
  ai: (ab, u, t) => { if (!t || t.isBuilding || u.distTo(t) > ab.castRange() + 200) return null; return t.heroLike || enemiesNear(ab, t.x, t.y, ab.v('radius')).length >= 2 ? { x: t.x, y: t.y } : null; },
  cast(ab, t, x, y) {
    const u = ab.owner; const w = u.world; const a = aim(u.x, u.y, x, y);
    for (let i = 0; i < ab.v('total_strikes'); i++) {
      const sx = x + a.dx * ab.v('strike_separation') * i; const sy = y + a.dy * ab.v('strike_separation') * i;
      w.after(ab.v('missile_delay_tooltip') + i * ab.v('strike_delay'), () => { for (const e of enemiesNear(ab, sx, sy, ab.v('radius'))) { if (e.isBuilding) continue; addMod(ab, e, 'modifier_gyrocopter_call_down_slow', ab.v('slow_duration')); hit(ab, e, ab.v('damage'), MAGICAL); } });
    }
  } });

// ================================================================ Mirana
defAbility('mirana_starfall', {
  prio: 55, fid: 'approx', note: 'both hits land on cast (the impact delays are not in the data): the wave on every visible enemy in radius, then the second meteor on the closest one still alive',
  ai: (ab, u, t) => (t && !t.isBuilding && u.distTo(t) <= ab.v('starfall_radius') - 75 ? here(u) : null),
  cast(ab) {
    const u = ab.owner; const w = u.world; const ok = (e) => e.alive && !e.isBuilding && seen(w, e);
    for (const e of enemiesNear(ab, u.x, u.y, ab.v('starfall_radius'))) if (ok(e)) hit(ab, e, ab.v('damage'), MAGICAL);
    const again = enemiesNear(ab, u.x, u.y, ab.v('starfall_secondary_radius')).filter(ok).sort((a, b) => u.distTo(a) - u.distTo(b)).slice(0, ab.v('secondary_targets'));
    for (const e of again) hit(ab, e, ab.v('damage') * ab.v('secondary_starfall_damage_percent') / 100, MAGICAL);
  } });
function miranaArrow(ab, dx, dy, main, struck) {      // struck: units already hit by an arrow of this cast (the talent arrows "cannot hit the same target")
  const u = ab.owner; const w = u.world; const star = u.findAbility('mirana_starfall'); const sr = main && star && star.level > 0 ? ab.v('scepter_radius') : 0; const lit = new Set(); const sx = u.x; const sy = u.y;
  linearProjectile(w, { x: u.x, y: u.y, dx, dy, speed: ab.v('arrow_speed'), range: ab.v('arrow_range'), radius: ab.v('arrow_width'),
    filter: (e) => e.team !== u.team && !e.isBuilding && e.st[ST.INVULN] === 0 && e.st[ST.IMMUNE] === 0 && !struck.has(e),
    onStep: sr > 0 ? (x1, y1, x2, y2) => { for (const e of enemiesInLine(ab, x1, y1, x2, y2, 2 * (sr))) if (!lit.has(e) && !e.isBuilding) { lit.add(e); hit(star, e, star.v('damage'), MAGICAL); } } : null,
    onHit: (e, d) => {
      struck.add(e);
      if (!e.heroLike && !e.def.ancient) { w.kill(e, u, ab); return true; }        // instantly kills the first non-ancient creep
      const k = Math.min(1, Math.hypot(e.x - sx, e.y - sy) / ab.v('arrow_max_stunrange'));      // [L] measured in Hero Demo: the distance counts from the launch point to the unit's centre (500 -> 315 damage, 1.70 s stun)
      stun(ab, e, ab.v('arrow_min_stun') + (ab.v('arrow_max_stun') - ab.v('arrow_min_stun')) * k);
      hit(ab, e, ab.v('AbilityDamage') + ab.v('arrow_bonus_damage') * k, MAGICAL);
      if (sr > 0 && e.alive) hit(star, e, star.v('damage') * ab.v('scepter_starstorm_target_pct') / 100, MAGICAL);
      return true;
    } });
}
defAbility('mirana_arrow', {
  prio: 65, fid: 'approx',
  note: 'the arrow is stepped every tick and hits the first enemy unit within arrow_width of its path (debuff-immune units are passed); stun and bonus damage grow linearly with the distance from the launch point to the centre of the unit up to arrow_max_stunrange. Scepter: a Starstorm hit on every enemy within scepter_radius of the path plus a second one at scepter_starstorm_target_pct % on the unit struck. Talent arrows fly extra_arrows_angle to the left and right of the main one and skip a unit that another arrow of the cast has already hit (both from the talent\'s own description in the game\'s localization file); only the main arrow carries the Starstorm. The rule skillshotHit can make the whole cast miss',
  ai: (ab, u, t) => (t && !t.isBuilding && !t.isImmune() && u.distTo(t) <= ab.v('arrow_range') - 500 ? { x: t.x, y: t.y } : null),
  cast(ab, t, x, y) {
    const u = ab.owner; const w = u.world; const a = aim(u.x, u.y, x, y);
    if (w.skillshotHit < 1 && !w.rng.chance(w.skillshotHit)) return;
    const struck = new Set(); miranaArrow(ab, a.dx, a.dy, true, struck);
    for (let i = 1; i <= ab.v('extra_arrows'); i++) { const g = Math.ceil(i / 2) * ab.v('extra_arrows_angle') * (i % 2 ? 1 : -1) * Math.PI / 180; miranaArrow(ab, a.dx * Math.cos(g) - a.dy * Math.sin(g), a.dx * Math.sin(g) + a.dy * Math.cos(g), false, struck); }
  } });
buff('modifier_mirana_leap', { stats: (m) => ({ msPct: m.v('leap_speedbonus'), as: m.v('leap_speedbonus_as') }) });      // x = temporary Celestial Quiver charges (Shard)
modifier('modifier_mirana_leap_charges', { hidden: true, purge: 'none', interval: 0.5, thinkNow: true,      // engine gap: the charge count is read raw, so the Shard charge is written into it
  onThink(m) { const ab = m.ability; const e = ab.def.vals.AbilityCharges; const arr = Array.isArray(e) ? e : e.v; const want = arr[Math.min(arr.length, Math.max(1, ab.level)) - 1] + ab.v('additional_charges'); if (ab.vals.AbilityCharges !== want) ab.vals.AbilityCharges = want; } });
defAbility('mirana_leap', {
  mods: ['modifier_mirana_leap_charges'], prio: 68, fid: 'approx',
  note: 'the leap is an instant move (leap_speed and leap_acceleration are not used) that only carries Mirana as far towards her target as she needs to get it into attack range, at most leap_distance (a real leap always covers leap_distance in the facing direction); the controller uses it for the attack / movement speed buff whenever the buff is down. Shard: +1 charge and temporary Celestial Quiver charges while the buff lasts',
  ai: (ab, u, t) => (t && u.st[ST.ROOT] === 0 && !u.hasModifier('modifier_mirana_leap') && u.rangeTo(t) <= u.attackRange + ab.v('leap_distance') ? here(u) : null),
  cast(ab) {
    const u = ab.owner; const t = focus(u); const q = u.findAbility('mirana_celestial_quiver');
    if (t && t.alive && u.rangeTo(t) > u.attackRange) u.jumpTo(t, ab.v('leap_distance'), u.attackRange + u.def.hull + t.def.hull - 20);
    const m = addMod(ab, u, 'modifier_mirana_leap', ab.v('leap_bonus_duration')); if (m) m.x = q && q.level > 0 ? q.v('quiver_restore') : 0;
  } });
passive('mirana_celestial_quiver', {
  fid: 'full', note: 'autocast assumed on: every attack uses a charge while one is available (bonus Item Potency on that attack, bonus magic damage on hit)',
  onAttack(m, rec) {
    const u = m.parent; const ab = m.ability; const lb = u.findModifier('modifier_mirana_leap'); if (rec.target.isBuilding) return;
    if (lb && lb.x > 0) lb.x--; else if (u.world.freeSpells || ab.charges >= 1) ab.startCooldown(); else return;
    rec.potency += m.v('bonus_potency'); (rec.data ||= {}).quiver = m;
  },
  onAttackLanded(m, rec) { if (rec.data && rec.data.quiver === m && rec.target.alive) mhit(m, rec.target, m.v('bonus_damage'), MAGICAL); } });
function miranaReveal(m) { const u = m.parent; if (m.z === 1) { m.z = 0; u.st[ST.INVIS]--; u.dirty = true; } m.x = u.world.time + m.v('fade_delay'); }
modifier('modifier_mirana_invis', { purge: 'none', interval: 0.1, stats: (m) => ({ msPct: m.z === 1 ? m.v('bonus_movement_speed') : 0, evasion: m.v('evasion') }),      // [L] measured in Hero Demo: the speed bonus only while invisible (after fade_delay)      // x = time invisibility (re)starts, z = 1 while invisible
  onCreated(m) { m.x = m.parent.world.time + m.v('fade_delay'); },
  onThink(m) { const u = m.parent; if (m.z === 0 && u.world.time + 1e-9 >= m.x) { m.z = 1; u.st[ST.INVIS]++; u.dirty = true; } },
  onAttack(m) { miranaReveal(m); }, onCast(m, ev) { if (ev.ability !== m.ability && reveals(ev.ability)) miranaReveal(m); },
  outgoing(m, d) { if (m.parent === m.caster && d.dst.team !== m.parent.team) d.amount *= 1 + m.v('bonus_outgoing_damage_pct') / 100; },
  onDestroy(m) { if (m.z === 1) m.parent.st[ST.INVIS]--; } });
defAbility('mirana_invis', {
  prio: 76, fid: 'full', note: 'attacking or casting reveals a hero until fade_delay has passed again; invisibility only hides units in worlds with detectAll off. The remark that affected units stop auto-attacking is a control setting and is not applied: heroes keep fighting',
  ai: (ab, u, t) => (t && u.distTo(t) <= 1200 && !u.hasModifier('modifier_mirana_invis') ? here(u) : null),
  cast(ab) { const u = ab.owner; for (const a of u.world.units) if (a.alive && a.team === u.team && a.isHero) addMod(ab, a, 'modifier_mirana_invis', ab.v('duration')); } });

// ================================================================ Pudge
// Shard: [L] measured in Hero Demo: distance_to_damage % of the distance pulled each server frame (hook_speed x frame), dealt every frame of the pull
debuff('modifier_pudge_meat_hook_drag', { pierce: true, purge: 'none', statusResist: false, state: ['STUN'], interval: (m) => m.parent.world.dt,
  onThink(m) { const p = m.v('distance_to_damage'); const w = m.parent.world; if (p > 0) mhit(m, m.parent, m.v('hook_speed') * w.dt * p / 100, PURE); } });
modifier('modifier_pudge_meat_hook_self', { purge: 'none', state: ['ROOT', 'DISARM', 'MUTE'] });
defAbility('pudge_meat_hook', {
  prio: 82, fid: 'approx',
  note: 'the hook is stepped every tick and snags the first unit (enemy or ally, not ancients or buildings) within hook_width of its path: non-hero enemies die, other enemies take the damage, and the unit is set next to Pudge after distance / hook_speed, disabled meanwhile. Shard: + distance_to_damage % of the distance pulled (at least min_distance_damage, reading assumed). Pudge is not locked while the hook flies (self_stun_duration_percent has no tooltip text). Controller: only at enemy heroes with no ally in the way. The rule skillshotHit can make it miss',
  ai: (ab, u) => {
    const w = u.world; const reach = ab.castRange() - 50; let best = null;
    for (const e of w.units) {
      if (!e.alive || e.team === u.team || !e.heroLike || !e.targetable() || e.st[ST.INVULN] > 0) continue;
      const d = u.distTo(e); if (d > reach || d < 200 || (best && d >= u.distTo(best))) continue;
      const a = aim(u.x, u.y, e.x, e.y); let clear = true;
      for (const o of w.units) {
        if (o === u || o === e || !o.alive || o.isBuilding || o.def.ancient || o.ms <= 0 || o.st[ST.OUT] > 0) continue;
        const k = (o.x - u.x) * a.dx + (o.y - u.y) * a.dy; if (k <= u.def.hull || k > d) continue;
        const px = u.x + a.dx * k - o.x; const py = u.y + a.dy * k - o.y; const r = ab.v('hook_width') + o.def.hull + 50; if (px * px + py * py <= r * r) { clear = false; break; }
      }
      if (clear) best = e;
    }
    return best ? { x: best.x, y: best.y } : null;
  },
  cast(ab, t, x, y) {
    const u = ab.owner; const w = u.world; const a = aim(u.x, u.y, x, y);
    // [L] measured in Hero Demo: Pudge is rooted, disarmed and muted while the hook flies, at most self_stun_duration_percent % of range / hook_speed, until it connects
    const self = addMod(ab, u, 'modifier_pudge_meat_hook_self', ab.v('self_stun_duration_percent') / 100 * ab.castRange() / ab.v('hook_speed'));
    if (w.skillshotHit < 1 && !w.rng.chance(w.skillshotHit)) return;
    linearProjectile(w, { x: u.x + a.dx * u.def.hull, y: u.y + a.dy * u.def.hull, dx: a.dx, dy: a.dy, speed: ab.v('hook_speed'), range: ab.castRange() - u.def.hull, radius: ab.v('hook_width'),      // leaves from the front of Pudge's hull
      filter: (e) => e !== u && !e.isBuilding && !e.def.ancient && e.st[ST.INVULN] === 0 && e.ms > 0,
      onHit: (e, d0) => {
        if (self && !self.removed) self.remove();
        const d = d0 + u.def.hull; const back = d / ab.v('hook_speed');
        if (e.team !== u.team) {
          if (!e.heroLike) { w.kill(e, u, ab); return true; }
          hit(ab, e, ab.v('damage'), PURE);
          if (e.alive) e.addModifier('modifier_pudge_meat_hook_drag', { caster: u, ability: ab, duration: back, pierce: true });
        }
        w.after(back, () => { if (e.alive && u.alive) { const v = aim(u.x, u.y, e.x, e.y); const keep = u.def.hull + e.def.hull + 10; e.x = u.x + v.dx * keep; e.y = u.y + v.dy * keep; } });
        return true;
      } });
  } });
debuff('modifier_pudge_rot_slow', { stats: (m) => ({ msPct: m.v('rot_slow'), restore: -m.v('scepter_rot_regen_reduction_pct') }) });      // rot_slow is negative in the data
modifier('modifier_pudge_rot', { purge: 'none', interval: (m) => m.v('rot_tick'), thinkNow: true,
  onThink(m) {
    const u = m.parent; const w = u.world; const tk = m.v('rot_tick'); const dmg = m.v('rot_damage') * tk;
    for (const e of w.enemiesInRadius(u, u.x, u.y, m.v('rot_radius'))) { if (e.isBuilding) continue; e.addModifier('modifier_pudge_rot_slow', { caster: u, ability: m.ability, duration: tk * 2 }); mhit(m, e, dmg, MAGICAL); }
    w.damage(u, u, dmg, MAGICAL, F_NON_LETHAL | F_NO_AMP, m.ability);
  } });
defAbility('pudge_rot', {
  prio: 90, fid: 'approx', note: 'toggle: the controller turns it on with an enemy inside the radius and off when none is within radius + 150; the slow lingers for two ticks after leaving. "Using Rot doesn\'t interrupt channeling": a Rot that is on keeps burning through Dismember, but it cannot be switched during a channel (a channelling unit takes no other action in the engine), so the controller switches it on first',
  ai: (ab, u) => { const on = u.hasModifier('modifier_pudge_rot'); const near = u.world.enemiesInRadius(u, u.x, u.y, ab.v('rot_radius') + (on ? 150 : 0)).some((e) => !e.isBuilding); return on !== near ? here(u) : null; },
  cast(ab) { const u = ab.owner; ab.toggled = u.removeModifierByName('modifier_pudge_rot') === 0; if (ab.toggled) addMod(ab, u, 'modifier_pudge_rot'); } });
modifier('modifier_pudge_flesh_heap', { purge: 'none', preMit(m, d) { d.amount = Math.max(0, d.amount - m.v('damage_block')); } });
defAbility('pudge_flesh_heap', {
  prio: 88, fid: 'full', note: 'the block is taken off every damage instance before armor / magic resistance (direct health loss is not blocked)',
  ai: (ab, u, t) => (t && !u.hasModifier('modifier_pudge_flesh_heap') && (u.world.time - u.lastHurt < 1.5 || u.distTo(t) <= 350) ? here(u) : null),
  cast(ab) { addMod(ab, ab.owner, 'modifier_pudge_flesh_heap', ab.v('duration')); } });
passive('pudge_innate_graft_flesh', {
  fid: 'full', note: 'starts a fight without stacks; the unit option stacks: { pudge_innate_graft_flesh: N } sets them',
  stats: (m) => ({ str: m.v('flesh_heap_strength_buff_amount') * m.stacks }),
  onAnyDeath(m, ev) { const u = m.parent; const v = ev.victim; if (v.team === u.team || !v.isHero || v.isIllusion) return; if (ev.killer === u || u.distTo(v) <= m.v('flesh_heap_range')) m.setStacks(m.stacks + 1); } });
debuff('modifier_pudge_dismember', { pierce: true, purge: 'strong', state: ['STUN'], interval: (m) => m.v('AbilityChannelTime') / m.v('ticks'), thinkNow: true,
  onThink(m) {
    const t = m.parent; const c = m.caster; if (!c.alive || c.channelAb !== m.ability) { m.remove(); return; }
    const iv = m.v('AbilityChannelTime') / m.v('ticks'); const dealt = mhit(m, t, (m.v('dismember_damage') + c.str * m.v('strength_damage')) * iv, MAGICAL);
    if (dealt > 0) c.heal(dealt, c, m.ability);
    const d = c.distTo(t); if (d > m.v('pull_distance_limit')) knockback(t, c.x, c.y, -Math.min(d - m.v('pull_distance_limit'), m.v('pull_units_per_second') * iv));
  },
  onDestroy(m) { const c = m.caster; if (c.alive && c.channelAb === m.ability) c.channelEnd = c.world.time; } });
defAbility('pudge_dismember', {
  prio: 86, fid: 'approx', channel: true,
  note: '`ticks` damage ticks spread evenly over the channel, each (dismember_damage + strength_damage x Strength) x tick length, healing Pudge for the damage dealt; the target is stunned, pulled at pull_units_per_second and released when the channel ends or the debuff is removed. The shard_* values of the ability have no tooltip text (and the ability no Shard flag) and are ignored',
  ai: (ab, u, t) => { const h = heroFocus(u, t, ab.castRange() + 250); return h ? { target: h } : null; },
  cast(ab, t) { ab.data = t; addMod(ab, t, 'modifier_pudge_dismember', ab.v('AbilityChannelTime') - 0.01, { pierce: true }); },
  channelEnd(ab) { const t = ab.data; ab.data = null; const m = t && t.findModifier('modifier_pudge_dismember', ab.owner); if (m) m.remove(); } });

// ================================================================ Templar Assassin
const TA_TRAP = 'npc_dota_templar_assassin_psionic_trap';
const taTraps = (u) => u.world.units.filter((x) => x.alive && x.owner === u && x.name === TA_TRAP);
const taCharge = (tr) => { const m = tr.findModifier('modifier_templar_assassin_psionic_trap_unit'); return m ? tr.world.time - m.created : 0; };
modifier('modifier_templar_assassin_refraction_damage', { purge: 'none', multi: 'stack',
  onAttack(m, rec) { rec.flat += m.v('bonus_damage'); if (m.stacks <= 1) m.remove(); else m.setStacks(m.stacks - 1); } });
modifier('modifier_templar_assassin_refraction_absorb', { purge: 'none', multi: 'stack', onCreated(m) { m.x = m.v('shield_per_instance'); },      // x = barrier left of the current instance
  postMit(m, d) {
    if (d.amount <= 0) return;
    if (d.amount < m.x) { m.x -= d.amount; d.amount = 0; return; }
    d.amount = 0; if (m.stacks <= 1) m.remove(); else { m.setStacks(m.stacks - 1); m.x = m.v('shield_per_instance'); }
  } });
defAbility('templar_assassin_refraction', {
  prio: 85, fid: 'partial', note: 'damage instances: bonus damage on the next `instances` attacks; barrier instances: each absorbs shield_per_instance, and a hit larger than what is left is absorbed whole and uses the instance up. Missing: the Shard clause "can be cast while disabled" (the engine does not let disabled units cast)',
  ai: (ab, u, t) => (t && u.distTo(t) <= 900 && !u.hasModifier('modifier_templar_assassin_refraction_absorb') ? here(u) : null),
  cast(ab) {
    const u = ab.owner; if (ab.v('dispels') > 0) u.purge({ debuffs: true });
    for (const n of ['modifier_templar_assassin_refraction_damage', 'modifier_templar_assassin_refraction_absorb']) { u.removeModifierByName(n); u.addModifier(n, { ability: ab, duration: ab.v('duration'), stacks: ab.v('instances') }); }
  } });
debuff('modifier_templar_assassin_meld_armor', { pierce: true, stats: (m) => ({ armor: m.v('bonus_armor') }) });      // bonus_armor is negative in the data
function taMeldMark(ab, t) {
  if (!t.alive || t.isBuilding) return;
  t.addModifier('modifier_templar_assassin_meld_armor', { caster: ab.owner, ability: ab, duration: ab.v('debuff_duration'), pierce: true });
  stun(ab, t, ab.v('bash_duration'), true);
}
modifier('modifier_templar_assassin_meld', { purge: 'none', state: ['INVIS'], interval: 0.1, stats: (m) => ({ attackRange: m.v('attack_range_bonus') }),
  onCreated(m) { m.x = m.parent.x; m.y = m.parent.y; },
  onThink(m) { const u = m.parent; if (Math.abs(u.x - m.x) + Math.abs(u.y - m.y) > 1) m.remove(); },      // moving breaks Meld
  onCast(m, ev) { if (ev.ability !== m.ability && ev.ability.name !== 'templar_assassin_trap_teleport') m.remove(); },
  onAttack(m, rec) {
    const t = rec.target; rec.add += m.v('bonus_damage'); (rec.data ||= {}).meld = m.ability;
    if (!t.isBuilding && !t.hasModifier('modifier_templar_assassin_meld_armor')) rec.pierceArmor = -m.v('bonus_armor');      // the strike already benefits from its own armor reduction
    m.remove();
  } });
modifier('modifier_templar_assassin_meld_strike', { hidden: true, onAttackLanded(m, rec) { if (rec.data && rec.data.meld === m.ability) taMeldMark(m.ability, rec.target); } });
defAbility('templar_assassin_meld', {
  mods: ['modifier_templar_assassin_meld_strike'], prio: 60, fid: 'approx',
  note: 'the attack that breaks Meld deals bonus_damage on top (physical, added after crit) against the already reduced armor and applies the armor debuff (and the talent bash); units hit by the Psi Blades spill get the debuff too and the bonus as part of the spilled damage (so scaled by attack_spill_pct and pure). Moving or casting breaks Meld without the bonus. Controller: cast only with the target in attack range',
  ai: (ab, u, t) => (t && !u.hasModifier('modifier_templar_assassin_meld') && u.rangeTo(t) <= u.attackRange + ab.v('attack_range_bonus') ? here(u) : null),
  cast(ab) { addMod(ab, ab.owner, 'modifier_templar_assassin_meld'); } });
passive('templar_assassin_psi_blades', {
  fid: 'approx', note: 'units within attack_spill_width of the attack_spill_range line behind the target take pure damage: attack_spill_pct % of the damage dealt to the main target, reduced again by that percentage for every further unit; no on-hit effects',
  stats: (m) => ({ attackRange: m.v('bonus_attack_range') }),
  onAttackLanded(m, rec) {
    const u = m.parent; const t = rec.target; if (rec.dealt <= 0 || t.isBuilding) return;
    const a = aim(u.x, u.y, t.x, t.y); const L = m.v('attack_spill_range'); let dmg = rec.dealt;
    const list = enemiesInLine(m.ability, t.x, t.y, t.x + a.dx * L, t.y + a.dy * L, 2 * m.v('attack_spill_width')).filter((e) => e !== t && !e.isBuilding).sort((p, q) => t.distTo(p) - t.distTo(q));
    for (const e of list) {
      dmg *= m.v('attack_spill_pct') / 100;
      u.world.damage(u, e, dmg, PURE, F_SECONDARY | F_NO_AMP, m.ability);
      if (rec.data && rec.data.meld && m.v('meld_strike_spills') > 0) taMeldMark(rec.data.meld, e);
    }
  } });
modifier('modifier_templar_assassin_psionic_trap_unit', { purge: 'none', state: ['INVULN', 'UNTARGETABLE', 'INVIS'] });      // on the trap unit; `created` = time it was placed
debuff('modifier_templar_assassin_trap_slow', { interval: (m) => m.v('damage_tick_rate'), thinkNow: true, stats: (m) => ({ msPct: -m.data.slow }),      // data: { slow, dmg (total over trap_duration) }
  onRefresh(m, o) { if (o && o.data) { m.data = { slow: Math.max(m.data.slow, o.data.slow), dmg: Math.max(m.data.dmg, o.data.dmg) }; m.parent.dirty = true; } },
  onThink(m) { if (m.data.dmg > 0) mhit(m, m.parent, m.data.dmg * m.v('damage_tick_rate') / m.v('trap_duration'), MAGICAL); } });
// springs one trap: slow by charge, damage over the slow duration when fully charged, Scepter silence by charge
function taSpring(ta, trap, full, bonus) {
  const ult = ta.findAbility('templar_assassin_psionic_trap'); const w = ta.world; if (!ult || !trap.alive) return;
  const k = full ? 1 : clamp(taCharge(trap) / ult.v('trap_max_charge_duration'), 0, 1);
  const slow = ult.v('movement_speed_min') + (ult.v('movement_speed_max') - ult.v('movement_speed_min')) * k;
  const sil = ult.v('max_silence_duration') > 0 ? ult.v('min_silence_duration') + (ult.v('max_silence_duration') - ult.v('min_silence_duration')) * k : 0;
  for (const e of enemiesNear(ult, trap.x, trap.y, ult.v('trap_radius'))) {
    if (e.isBuilding) continue;
    if (bonus > 0) hit(ult, e, bonus, MAGICAL);
    if (!e.alive) continue;
    addMod(ult, e, 'modifier_templar_assassin_trap_slow', ult.v('trap_duration'), { data: { slow, dmg: k >= 1 ? ult.v('trap_bonus_damage') : 0 } });
    if (sil > 0) silence(ult, e, sil);
  }
  w.kill(trap, null, null, true);
}
defAbility('templar_assassin_trap', {
  prio: 66, fid: 'approx', note: 'springs the trap nearest to Templar Assassin (the alt-cast "nearest to the cursor" does not exist). Controller: only when that trap is fully charged and has an enemy hero inside',
  ai: (ab, u) => {
    const ult = u.findAbility('templar_assassin_psionic_trap'); if (!ult || ult.level < 1) return null;
    const tr = nearestOf(taTraps(u), u.x, u.y); if (!tr || taCharge(tr) < ult.v('trap_max_charge_duration')) return null;
    return enemiesNear(ult, tr.x, tr.y, ult.v('trap_radius')).some((e) => e.heroLike && !e.isImmune()) ? here(u) : null;
  },
  cast(ab) { const u = ab.owner; const tr = nearestOf(taTraps(u), u.x, u.y); if (tr) taSpring(u, tr, false, 0); } });
defAbility('templar_assassin_self_trap', { fid: 'approx', manual: true, note: 'ability of the trap unit: springs that trap. Manual: the controller springs traps through Templar Assassin\'s own Trap ability', cast(ab) { const tr = ab.owner; if (tr.owner) taSpring(tr.owner, tr, false, 0); } });
defAbility('templar_assassin_psionic_trap', {
  prio: 35, fid: 'partial',
  note: 'traps are summoned units; beyond max_traps the oldest one disappears. Missing: enemies can never see or destroy a trap (the tooltip gives traps pips that attacks remove once a trap is detected); here they stay untouchable even in worlds with detectAll on, because the default controller attacks the nearest unit and would chase every trap. Sprung: slow from movement_speed_min to movement_speed_max by charge time for trap_duration; a fully charged trap also deals trap_bonus_damage, spread over the slow in damage_tick_rate ticks (the tooltip only says "deals damage after" the charge time); Scepter silence scales the same way. Controller: one trap on the target unless a trap already lies within 60% of the radius',
  ai: (ab, u, t) => { if (!t || t.isBuilding || u.distTo(t) > ab.castRange()) return null; const R = ab.v('trap_radius') * 0.6; for (const tr of taTraps(u)) if (tr.distTo(t) <= R) return null; return { x: t.x, y: t.y }; },
  cast(ab, t, x, y) {
    const u = ab.owner; const tr = summon(ab, TA_TRAP, { x, y, ai: 'idle' });
    tr.addModifier('modifier_templar_assassin_psionic_trap_unit', { caster: u, ability: ab });
    const all = taTraps(u); while (all.length > ab.v('max_traps')) u.world.kill(all.shift(), null, null, true);
  } });
defAbility('templar_assassin_trap_teleport', {
  prio: 45, fid: 'approx', channel: true,
  note: 'after the channel she appears on the trap nearest to the chosen point, which is sprung as fully charged and deals extra_damage (magical, engine default: the data has no type). Controller: used when the enemy hero target stands in a trap and is fighting in place (its own target is in its attack reach), and she is either out of reach or the trap would still need longer than the channel to charge',
  ai: (ab, u, t) => {
    const ult = u.findAbility('templar_assassin_psionic_trap'); if (!t || !t.heroLike || !ult || ult.level < 1) return null;
    const tr = nearestOf(taTraps(u), t.x, t.y); if (!tr || tr.distTo(t) > ult.v('trap_radius') - 100) return null;
    const o = t.orderTarget; if (!(t.st[ST.STUN] > 0 || t.st[ST.ROOT] > 0 || (o && o.alive && t.rangeTo(o) <= t.attackRange + 50))) return null;
    return u.rangeTo(t) - u.attackRange > 200 || taCharge(tr) < ult.v('trap_max_charge_duration') - ab.v('AbilityChannelTime') ? { x: tr.x, y: tr.y } : null;
  },
  cast(ab, t, x, y) { ab.data = nearestOf(taTraps(ab.owner), x, y); },
  channelEnd(ab, interrupted) { const u = ab.owner; const tr = ab.data; ab.data = null; if (interrupted || !tr || !tr.alive) return; u.x = tr.x; u.y = tr.y; taSpring(u, tr, true, ab.v('extra_damage')); } });
passive('templar_assassin_inner_peace', {
  fid: 'approx', note: 'standing still and undamaged is checked every 0.1 s; the bonus grows linearly from time_until_meditation to full after time_until_max_bonus',
  dynamic: true, interval: 0.1,       // x = time of the last move / damage
  onCreated(m) { const u = m.parent; m.x = u.world.time + 0.03; m.data = { x: u.x, y: u.y }; },      // [L] measured in Hero Demo (stats 1 s after spawn, levels 1-21): the still time starts 0.03 s after the hero appears
  onThink(m) { const u = m.parent; if (u.x !== m.data.x || u.y !== m.data.y) { m.data.x = u.x; m.data.y = u.y; m.x = u.world.time; } },
  onTakeDamage(m, d) { if (d.dealt > 0) m.x = m.parent.world.time; },
  stats: (m) => { const k = clamp((m.parent.world.time - m.x - m.v('time_until_meditation')) / m.v('time_until_max_bonus'), 0, 1); return { hpRegen: m.v('max_hp_regen') * k, manaRegen: m.v('max_mana_regen') * k }; } });

// ================================================================ Winter Wyvern
debuff('modifier_winter_wyvern_arctic_burn_debuff', { interval: (m) => m.v('tick_rate'), stats: (m) => ({ msPct: -m.v('move_slow') }),
  onThink(m) { const t = m.parent; mhit(m, t, t.hp * m.v('percent_damage') / 100 * m.v('tick_rate'), MAGICAL); } });
modifier('modifier_winter_wyvern_arctic_burn', { purge: 'none',
  stats: (m) => ({ attackRange: m.v('attack_range_bonus'), projSpeed: m.v('projectile_speed_bonus'), msPct: m.v('movement_scepter') }),
  onAttackLanded(m, rec) {
    const t = rec.target; if (!t.alive || t.isBuilding || t.name === 'npc_dota_roshan') return;
    t.addModifier('modifier_winter_wyvern_arctic_burn_debuff', { caster: m.parent, ability: m.ability, duration: m.v('damage_duration') + 0.01 });
  } });
// hidden intrinsic modifier that rewrites a standard slot (cooldown) every time the values are refreshed
function slotSync(ability, fn) { modifier('modifier_' + ability + '_slot', { hidden: true, purge: 'none', breakable: false, apply(m) { fn(m.ability, m); } }); return 'modifier_' + ability + '_slot'; }
const levelVal = (ab, key) => { const e = ab.def.vals[key]; if (e === undefined) return 0; if (typeof e === 'number') return e; const arr = Array.isArray(e) ? e : e.v; return arr[Math.max(1, Math.min(arr.length, ab.level)) - 1]; };
defAbility('winter_wyvern_arctic_burn', {
  prio: 60, fid: 'partial',
  // [L] measured in Hero Demo (Scepter): the cast reports cooldown 0 and no toggle state, the flight lasts `duration` (10 s) and no mana
  // is drained over those 10 s (mana rises by regeneration only), movement speed +movement_scepter %
  mods: [slotSync('winter_wyvern_arctic_burn', (ab) => { if (ab.owner.hasScepter) ab.vals.AbilityCooldown = 0; })],
  note: 'bonus attack range and projectile speed; every attack applies the burn (percent_damage % of current health per second in tick_rate ticks, magical) and slow for damage_duration, not on Roshan. Scepter (measured): no cooldown, lasts `duration`, adds movement speed; the tooltip\'s toggle with a mana drain (mana_cost_scepter) was not seen in the game and is not modelled. Missing: the attack point reduction to attack_point (no engine stat) and flying movement (no terrain); max_attacks has no tooltip text and is not applied',
  ai: (ab, u, t) => (t && !u.hasModifier('modifier_winter_wyvern_arctic_burn') && u.rangeTo(t) <= u.attackRange + ab.v('attack_range_bonus') + 150 ? here(u) : null),
  cast(ab) { addMod(ab, ab.owner, 'modifier_winter_wyvern_arctic_burn', ab.v('duration')); } });
debuff('modifier_winter_wyvern_splinter_blast_slow', { stats: (m) => ({ msPct: m.v('bonus_movespeed') }) });      // negative in the data
defAbility('winter_wyvern_splinter_blast', {
  prio: 55, fid: 'full', note: 'controller: aims at the unit (enemy or ally, never herself) with the most enemies around it inside split_radius, heroes counting double; with a lone enemy and no ally next to it there is nothing to hit',
  ai: (ab, u, t, w) => {
    if (!t) return null;
    const R = ab.v('split_radius'); const reach = ab.castRange() + 150; let best = null; let bs = 0;
    for (const c of w.units) {
      if (!c.alive || c === u || c.isBuilding || !c.targetable() || u.distTo(c) > reach || (c.team !== u.team && c.isImmune())) continue;
      let s = 0; for (const e of w.inRadius(c.x, c.y, R, u.team, true)) if (e !== c && !e.isBuilding) s += e.heroLike ? 2 : 1;
      if (s > bs) { bs = s; best = c; }
    }
    return best ? { target: best } : null;
  },
  cast(ab, t) {
    const u = ab.owner; const w = u.world; if (!t || t === u) return;
    w.projectile(u, t, Math.max(ab.v('projectile_speed'), u.distTo(t) / ab.v('projectile_max_time')), (tt) => {
      for (const e of enemiesNear(ab, tt.x, tt.y, ab.v('split_radius'))) {
        if (e === tt || e.isBuilding) continue;
        w.after(tt.distTo(e) / ab.v('secondary_projectile_speed'), () => {
          if (!e.alive) return;
          if (!blocked(ab, e)) { stun(ab, e, ab.v('stun_duration')); addMod(ab, e, 'modifier_winter_wyvern_splinter_blast_slow', ab.v('slow_duration')); }
          hit(ab, e, ab.v('damage'), MAGICAL);
        });
      }
    });
    const ps = w.projectiles; if (Array.isArray(ps) && ps.length && ps[ps.length - 1].target === t) ps[ps.length - 1].noDodge = true;      // "the primary projectile cannot be disjointed"
  } });
buff('modifier_winter_wyvern_cold_embrace_damage', { stats: (m) => ({ dmgBasePct: m.v('damage_buff_pct') }) });
modifier('modifier_winter_wyvern_cold_embrace', { purge: 'none', state: ['STUN'], interval: (m) => m.v('tick_interval'),
  preMit(m, d) { if (d.type === PHYSICAL) d.amount = 0; },
  onThink(m) { const t = m.parent; t.heal((m.v('heal_additive') + t.maxHp * m.v('heal_percentage') / 100) * m.v('tick_interval'), m.caster, m.ability); },
  onDestroy(m) { const t = m.parent; if (t.alive && m.v('damage_buff_duration') > 0) t.addModifier('modifier_winter_wyvern_cold_embrace_damage', { caster: m.caster, ability: m.ability, duration: m.v('damage_buff_duration') }); } });
defAbility('winter_wyvern_cold_embrace', {
  // [L] measured in Hero Demo (Shard): the cast already reports the shortened cooldown (11 s at level 4 = 15 - shard_cooldown_reduction)
  mods: [slotSync('winter_wyvern_cold_embrace', (ab) => { const r = ab.vals.shard_cooldown_reduction || 0; if (r > 0) ab.vals.AbilityCooldown = Math.max(0, levelVal(ab, 'AbilityCooldown') - r); })],
  prio: 80, fid: 'approx', note: 'the ally is frozen (cannot act), takes no physical damage and is healed every tick_interval. Shard: cooldown shortened and damage_buff_pct applied as a bonus on base attack damage after the cocoon (the tooltip does not say what the percentage is of). Controller: lowest-health allied hero below 45% (herself below 30%)',
  ai: (ab, u) => {
    let best = null;
    for (const a of realAllies(u, true)) if (hpFrac(a) < (a === u ? 0.3 : 0.45) && u.distTo(a) <= ab.castRange() + 150 && !a.hasModifier('modifier_winter_wyvern_cold_embrace') && (!best || hpFrac(a) < hpFrac(best))) best = a;
    return best ? { target: best } : null;
  },
  cast(ab, t) {
    const u = ab.owner; addMod(ab, t || u, 'modifier_winter_wyvern_cold_embrace', ab.v('duration') + 0.01);
  } });
na('winter_wyvern_eldwurms_edda', 'progression item: the player decides when to consume it and which basic ability gets +1 level (the data has no values for a fifth level) together with +25% base Intelligence; none of it is applied in the sandbox');
// damage from the enemies of a cursed unit is negated unless it comes from Winter Wyvern or a unit she owns
function wyvernCurseShield(m, d) { const s = d.src; const u = m.parent; const ww = m.ability.owner; if (!s || s.team === u.team || s === ww || s.owner === ww) return; d.amount *= Math.max(0, 1 - m.v('damage_reduction') / 100); }
modifier('modifier_winter_wyvern_winters_curse_attacker', { purge: 'none', state: ['TAUNT'], stats: (m) => ({ as: m.v('bonus_attack_speed') }), preMit: wyvernCurseShield,      // caster = the frozen ally it must attack
  onDestroy(m) { const u = m.parent; if (u.alive && u.orderTarget === m.caster) u.stop(); } });
debuff('modifier_winter_wyvern_winters_curse', { pierce: true, purge: 'none', state: ['STUN'], interval: 0.1, thinkNow: true, preMit: wyvernCurseShield,
  onCreated(m) { m.data = new Set(); },
  onThink(m) {
    const t = m.parent; const w = t.world; const ab = m.ability; const last = m.created + m.v('max_duration');
    for (const e of w.inRadius(t.x, t.y, m.v('radius'), t.team, false)) {
      if (e === t || m.data.has(e) || e.isBuilding || !e.canAttack || e.st[ST.IMMUNE] > 0 || e.st[ST.INVULN] > 0) continue;
      m.data.add(e);
      const end = Math.min(last, m.dieTime + (e.isHero ? m.v('bonus_duration_per_hero') : m.v('bonus_duration_per_creep'))); if (end > m.dieTime) m.setDuration(end - w.time);
    }
    const left = m.remaining(); if (left > 0) for (const e of m.data) if (e.alive) e.addModifier('modifier_winter_wyvern_winters_curse_attacker', { caster: t, ability: ab, duration: left });
  },
  onTakeDamage(m, d) {      // "If the target dies to its allies, Winter Wyvern will receive credit for the kill"
    const t = m.parent; const s = d.src; if (t.hp <= 0 && t.alive && s && s !== t && s.team === t.team) t.world.kill(t, m.ability.owner, m.ability);
  },
  onDestroy(m) { for (const e of m.data) { const c = e.findModifier('modifier_winter_wyvern_winters_curse_attacker', m.parent); if (c) c.remove(); } } });
defAbility('winter_wyvern_winters_curse', {
  prio: 86, fid: 'approx',
  note: 'the target is dispelled and frozen; its allies inside the radius (also those entering later, never debuff-immune ones) are taunted to attack it with bonus attack speed, and all of them ignore damage from their enemies except Winter Wyvern and her units; a target killed by its own allies is credited to her. Duration = `duration` + the per-hero / per-creep bonus for every cursed unit, capped at max_duration (the tooltip only spells this out for heroes that enter later). Controller: only on a hero with another enemy hero or two creeps next to it',
  ai: (ab, u, t, w) => {
    const crowd = (h) => { let n = 0; for (const e of w.inRadius(h.x, h.y, ab.v('radius'), h.team, false)) if (e !== h && !e.isBuilding && e.canAttack && !e.isImmune()) n += e.isHero ? 2 : 1; return n >= 2; };
    const h = heroFocus(u, t, ab.castRange() + 150, crowd); return h ? { target: h } : null;
  },
  cast(ab, t) { t.purge({ debuffs: false, buffs: true }); addMod(ab, t, 'modifier_winter_wyvern_winters_curse', ab.v('duration'), { pierce: true }); } });

// ================================================================ Earthshaker
function esShockOne(ab, e, k) { if (e.isBuilding || !e.alive) return; if (!blocked(ab, e)) stun(ab, e, ab.v('AbilityDuration') * k); hit(ab, e, ab.v('aftershock_damage'), MAGICAL); }
// Aftershock around a point; with Shard also along every standing Fissure when another ability was cast (shortened stun)
function esAftershock(u, x, y, cast) {
  const ab = u.findAbility('earthshaker_aftershock'); const fis = u.findAbility('earthshaker_fissure'); const w = u.world;
  if (!ab || ab.level < 1 || u.st[ST.BREAK] > 0) return;
  const done = new Set(enemiesNear(ab, x, y, ab.v('aftershock_range')));
  if (fis && fis.data && cast !== fis && fis.v('shard_aftershock_stun_duration_pct') > 0) {
    fis.data = fis.data.filter((s) => s.end > w.time);
    for (const s of fis.data) for (const e of enemiesInLine(ab, s.x1, s.y1, s.x2, s.y2, 2 * (ab.v('aftershock_range')))) if (!done.has(e)) { done.add(e); esShockOne(ab, e, fis.v('shard_aftershock_stun_duration_pct') / 100); }
  }
  for (const e of enemiesNear(ab, x, y, ab.v('aftershock_range'))) esShockOne(ab, e, 1);
}
defAbility('earthshaker_fissure', {
  prio: 78, fid: 'approx',
  note: 'stun and damage on every enemy within fissure_radius of the line from Earthshaker over the full cast range; the impassable ridge is not modelled (no terrain or pathing). Shard: while the fissure stands, each other ability he casts releases an Aftershock along it with the stun shortened to shard_aftershock_stun_duration_pct % (a unit also caught by the normal Aftershock is hit once)',
  ai: (ab, u, t) => (t && !t.isBuilding && u.distTo(t) <= ab.castRange() - 100 ? { x: t.x, y: t.y } : null),
  cast(ab, t, x, y) {
    const u = ab.owner; const a = aim(u.x, u.y, x, y); const L = ab.castRange(); const x2 = u.x + a.dx * L; const y2 = u.y + a.dy * L;
    for (const e of enemiesInLine(ab, u.x, u.y, x2, y2, 2 * (ab.v('fissure_radius')))) { if (e.isBuilding) continue; if (!blocked(ab, e)) stun(ab, e, ab.v('stun_duration')); hit(ab, e, ab.v('fissure_damage'), MAGICAL); }
    (ab.data ||= []).push({ x1: u.x, y1: u.y, x2, y2, end: u.world.time + ab.v('fissure_duration') });
  } });
buff('modifier_earthshaker_enchant_totem_buff', { stats: (m) => ({ dmgBasePct: m.v('totem_damage_percentage'), attackRange: m.v('bonus_attack_range') }),
  onAttack(m, rec) {
    if (rec.fromAbility) return;
    const p = m.parent.findModifier('modifier_earthshaker_enchant_totem'); if (p) { p.data = rec.target; p.x = m.parent.world.time; }
    (rec.data ||= {}).totem = m.ability; m.remove();
  } });
modifier('modifier_earthshaker_enchant_totem', { hidden: true,       // data / x = target and time of the last empowered attack (read by Slugger)
  onAttackLanded(m, rec) {
    const ab = rec.data && rec.data.totem; if (!ab || rec.damage <= 0 || ab.v('scepter_cleave_pct') <= 0) return;
    cleave(m.parent, rec.target, rec.damage * ab.v('scepter_cleave_pct') / 100, ab.v('scepter_cleave_starting_width'), ab.v('scepter_cleave_ending_width'), ab.v('scepter_cleave_distance'), ab);
  } });
function esTotemBuff(ab) { const u = ab.owner; u.removeModifierByName('modifier_earthshaker_enchant_totem_buff'); addMod(ab, u, 'modifier_earthshaker_enchant_totem_buff', ab.v('AbilityDuration')); }
modifier('modifier_earthshaker_enchant_totem_leap', { purge: 'none', state: ['STUN'],
  onDestroy(m, expired) { const u = m.parent; const ab = m.ability; ab.data = null; if (!expired || !u.alive) return; u.x = m.data.x; u.y = m.data.y; esTotemBuff(ab); esAftershock(u, u.x, u.y, ab); } });
defAbility('earthshaker_enchant_totem', {
  mods: ['modifier_earthshaker_enchant_totem'], prio: 60, fid: 'approx',
  note: 'next attack: + totem_damage_percentage % of base damage and bonus range. Scepter: that attack cleaves, and a cast on a distant point makes him leap there (scepter_leap_duration in the air, unable to act), the buff and Aftershock happening on landing. Controller: self-cast in melee, the leap only as a gap closer',
  ai: (ab, u, t) => {
    if (!t || u.hasModifier('modifier_earthshaker_enchant_totem_buff') || u.hasModifier('modifier_earthshaker_enchant_totem_leap')) return null;
    if (u.rangeTo(t) <= u.attackRange + ab.v('bonus_attack_range') + 100) return here(u);
    if (ab.v('distance_scepter') <= 0 || u.distTo(t) > ab.v('distance_scepter') + 100) return null;
    const a = aim(t.x, t.y, u.x, u.y); const keep = u.def.hull + t.def.hull + 50; return { x: t.x + a.dx * keep, y: t.y + a.dy * keep };
  },
  cast(ab, t, x, y) {
    const u = ab.owner; const a = aim(u.x, u.y, x, y); ab.data = null;
    if (ab.v('distance_scepter') <= 0 || a.d <= 1) { esTotemBuff(ab); return; }
    const go = Math.min(a.d, ab.v('distance_scepter')); ab.data = { leap: true };
    addMod(ab, u, 'modifier_earthshaker_enchant_totem_leap', ab.v('scepter_leap_duration'), { data: { x: u.x + a.dx * go, y: u.y + a.dy * go } });
  } });
passive('earthshaker_aftershock', {
  fid: 'full', note: 'triggered by every non-item ability cast',
  onCast(m, ev) { const a = ev.ability; const u = m.parent; if (a.isItem || (a.data && a.data.leap)) return; esAftershock(u, u.x, u.y, a); } });
defAbility('earthshaker_echo_slam', {
  prio: 80, fid: 'full', note: 'an echo damages every enemy within echo range of the unit that caused it except that unit itself (the tooltip says "nearby units"); real heroes cause two',
  ai: (ab, u, t) => {
    if (!t || t.isBuilding) return null; const as = u.findAbility('earthshaker_aftershock');
    if (u.distTo(t) <= (as ? as.v('aftershock_range') : 300) - 25) return here(u);
    return enemiesNear(ab, u.x, u.y, ab.v('echo_slam_damage_range') - 100).filter((e) => !e.isBuilding).length >= 2 ? here(u) : null;
  },
  cast(ab) {
    const u = ab.owner; const live = (e) => !e.isBuilding;
    const src = enemiesNear(ab, u.x, u.y, ab.v('echo_slam_echo_search_range')).filter(live);
    for (const e of enemiesNear(ab, u.x, u.y, ab.v('echo_slam_damage_range')).filter(live)) hit(ab, e, ab.v('echo_slam_initial_damage'), MAGICAL);
    for (const s of src) { const n = s.isHero && !s.isIllusion ? 2 : 1; for (const e of enemiesNear(ab, s.x, s.y, ab.v('echo_slam_echo_range'))) { if (e === s || e.isBuilding) continue; for (let i = 0; i < n && e.alive; i++) hit(ab, e, ab.v('echo_slam_echo_damage'), MAGICAL); } }
  } });
passive('earthshaker_slugger', {
  fid: 'approx', note: 'a unit killed by Earthshaker\'s abilities or by the Enchant Totem attack flies projectile_body_distance away from him and damages each enemy within its width once: the creep or the hero damage and width value, chosen by what the flying unit is (reading assumed, the labels only say "creeps" / "heroes"), + projectile_body_damage_additional_percent_health % of the flying unit\'s max health; magical by engine default, the data has no type. projectile_body_initial_impact_radius has no tooltip text and is ignored',
  onKill(m, ev) {
    const u = m.parent; const v = ev.victim; const w = u.world; const a = ev.ability; const tm = u.findModifier('modifier_earthshaker_enchant_totem');
    if (v.team === u.team || v.isBuilding || m.v('projectile_body_on_kill') <= 0) return;
    if (!(a ? !a.isItem && a.owner === u : tm && tm.data === v && tm.x === w.time)) return;
    const d = aim(u.x, u.y, v.x, v.y); const dmg = (v.heroLike ? m.v('projectile_body_damage_hero') : m.v('projectile_body_damage_creep')) + v.maxHp * m.v('projectile_body_damage_additional_percent_health') / 100;
    linearProjectile(w, { x: v.x, y: v.y, dx: d.dx, dy: d.dy, speed: m.v('projectile_body_speed'), range: m.v('projectile_body_distance'), radius: v.heroLike ? m.v('projectile_body_width_hero') : m.v('projectile_body_width_creep'),
      filter: (e) => e.team !== u.team && e !== v && !e.isBuilding && e.st[ST.INVULN] === 0, onHit: (e) => { w.damage(u, e, dmg, m.ability.dmgType, 0, m.ability); return false; } });
  } });

// ================================================================ Sand King
debuff('modifier_sandking_caustic_finale_debuff', {
  onDestroy(m, expired) {       // the carrier died: explode
    const t = m.parent; const c = m.caster; if (t.alive || expired) return;
    const dmg = m.v('caustic_finale_damage_flat') + t.maxHp * m.v('caustic_finale_damage_pct') / 100;
    for (const e of t.world.inRadius(t.x, t.y, m.v('caustic_finale_radius'), c.team, true)) if (e !== t && !e.isBuilding) t.world.damage(c, e, dmg, MAGICAL, 0, m.ability);
  } });
function skCaustic(u, t) { const cf = u.findAbility('sandking_caustic_finale'); if (cf && cf.level > 0 && t.alive && !t.isBuilding && u.st[ST.BREAK] === 0) t.addModifier('modifier_sandking_caustic_finale_debuff', { caster: u, ability: cf, duration: cf.v('caustic_finale_duration') }); }
passive('sandking_caustic_finale', { fid: 'full', onAttackLanded(m, rec) { skCaustic(m.parent, rec.target); } });
debuff('modifier_sandking_scorpion_strike_slow', { stats: (m) => ({ msPct: -m.v('strike_slow') }) });
// one Stinger attack on one unit: k scales the damage (Scepter spines), inner = inside the innermost radius
function skSting(ab, e, k, inner) {
  const u = ab.owner; if (!e.alive || e.isBuilding || !e.attackableBy(u)) return;
  const on = ab.level > 0;      // Burrowstrike spines also work with Stinger unlearned: a plain attack then
  // [L] measured in Hero Demo: the inner-radius bonus multiplies attack_damage only (350 = 154 + 140 x 1.4), not the weapon damage
  const r = u.world.launchAttack(u, e, { instant: true, fromAbility: ab, flat: on ? ab.v('attack_damage') * (inner ? 1 + ab.v('inner_radius_bonus_damage_pct') / 100 : 1) : 0, mult: k, potency: on ? u.itemPotency * ab.v('potency') / 100 : u.itemPotency });
  if (r.missed || !e.alive) return;
  skCaustic(u, e); if (on) addMod(ab, e, 'modifier_sandking_scorpion_strike_slow', ab.v('debuff_duration'));
}
const SK_IMPALE_AIR = 0.5;      // [L] measured in Hero Demo: the damage lands 0.5 s after the impale stun, when the unit comes down
modifier('modifier_sandking_burrowstrike_self', { purge: 'none', state: ['STUN'] });
defAbility('sandking_burrowstrike', {
  prio: 90, fid: 'approx',
  note: 'Sand King is out of action for burrow_anim_time and then at the point; distance / burrow_speed after the cast every enemy within burrow_width of the path is stunned (heroes get Caustic Finale) and takes the damage 0.5 s later (measured). Scepter: spine_duration later spines every spine_radius along the path and at its end strike every enemy within spine_radius of them with a Stinger attack at spine_damage_pct % (a plain attack when Stinger is not learned; spine spacing is an assumption that reproduces the two hits recorded on a unit at the end point). He is not hidden while tunnelling',
  ai: (ab, u, t) => (t && !t.isBuilding && u.st[ST.ROOT] === 0 && u.distTo(t) <= ab.castRange() + 100 ? { x: t.x, y: t.y } : null),
  cast(ab, t, x, y) {
    const u = ab.owner; const w = u.world; const a = aim(u.x, u.y, x, y); const L = Math.min(a.d, ab.castRange()); const x1 = u.x; const y1 = u.y; const x2 = x1 + a.dx * L; const y2 = y1 + a.dy * L; const T = L / ab.v('burrow_speed');
    addMod(ab, u, 'modifier_sandking_burrowstrike_self', ab.v('burrow_anim_time'));      // [L] measured in Hero Demo: Sand King is out of action for burrow_anim_time and surfaces at its end
    w.after(ab.v('burrow_anim_time'), () => { if (u.alive) { u.x = x2; u.y = y2; } });
    w.after(T, () => {
      if (!u.alive) return;
      for (const e of enemiesInLine(ab, x1, y1, x2, y2, 2 * ab.v('burrow_width'))) {
        if (e.isBuilding) continue; if (!blocked(ab, e)) stun(ab, e, ab.v('burrow_duration')); if (e.isHero) skCaustic(u, e);
        w.after(SK_IMPALE_AIR, () => { if (e.alive) hit(ab, e, ab.v('AbilityDamage'), MAGICAL); });
      }
    });
    const st = u.findAbility('sandking_scorpion_strike');
    if (ab.v('spine_radius') > 0 && st) w.after(T + ab.v('spine_duration'), () => {      // spines every spine_radius along the path and at its end; a unit near two spines is struck twice
      if (!u.alive) return; const R = ab.v('spine_radius'); const pts = []; for (let d = 0; d < L - 1e-6; d += R) pts.push(d); pts.push(L);
      for (const d of pts) for (const e of w.inRadius(x1 + a.dx * d, y1 + a.dy * d, R, u.team, true)) skSting(st, e, ab.v('spine_damage_pct') / 100, false);
    });
  } });
debuff('modifier_sandking_sand_storm_debuff', { stats: (m) => ({ msPct: -m.v('sand_storm_slow'), miss: m.v('blind_pct') }) });
function skStormReveal(m) { const u = m.parent; if (m.z === 1) { m.z = 0; u.st[ST.INVIS]--; } m.data.vis = u.world.time + m.v('fade_delay'); }
// "can be used to dodge projectiles": the engine has no disjoint call, so the tracking projectiles (attacks and unit-target spells) flying at `u`
// are taken out of world.projectiles; a projectile marked noDodge ("cannot be disjointed", set by Splinter Blast below) stays
function dodgeProjectiles(u) {
  const ps = u.world.projectiles; if (!Array.isArray(ps)) return;
  for (let i = ps.length - 1; i >= 0; i--) { const p = ps[i]; if (p.target !== u || p.noDodge) continue; if (p.rec) p.rec.cancel = true; ps.splice(i, 1); }
}
modifier('modifier_sandking_sand_storm', { purge: 'none', interval: (m) => m.v('damage_tick_rate'),       // x, y = storm centre; z = 1 while invisible
  onCreated(m) { const u = m.parent; m.x = u.x; m.y = u.y; m.z = 1; u.st[ST.INVIS]++; m.data = { vis: 0 }; },      // invisible from the cast on; fade_delay only applies after a reveal
  onThink(m) {
    const u = m.parent; const w = u.world; const R = m.v('sand_storm_radius'); const tk = m.v('damage_tick_rate'); const deb = m.v('sand_storm_slow') > 0 || m.v('blind_pct') > 0;
    if ((u.x - m.x) * (u.x - m.x) + (u.y - m.y) * (u.y - m.y) > R * R) { m.remove(); return; }      // leaving the area ends the storm
    if (m.z === 0 && w.time + 1e-9 >= m.data.vis) { m.z = 1; u.st[ST.INVIS]++; }
    for (const e of w.inRadius(m.x, m.y, R, u.team, true)) { if (e.isBuilding) continue; if (deb) e.addModifier('modifier_sandking_sand_storm_debuff', { caster: u, ability: m.ability, duration: tk * 2 }); mhit(m, e, m.v('sand_storm_damage') * tk, MAGICAL); }
  },
  onAttack(m) { skStormReveal(m); }, onCast(m, ev) { if (ev.ability !== m.ability && reveals(ev.ability)) skStormReveal(m); },
  onDestroy(m) { if (m.z === 1) m.parent.st[ST.INVIS]--; } });
defAbility('sandking_sand_storm', {
  prio: 86, fid: 'approx', note: 'the storm stays where it was cast and ends when Sand King leaves it; he is invisible from the cast on, attacks and casts reveal him for fade_delay (invisibility only hides units in worlds with detectAll off). "Can be used to dodge projectiles": the cast removes every tracking projectile flying at him, attacks and unit-target spells alike; the engine cannot tell the ones the game treats as undodgeable apart (only this file\'s Splinter Blast is exempt)',
  ai: (ab, u, t) => (t && !t.isBuilding && !u.hasModifier('modifier_sandking_sand_storm') && u.distTo(t) <= ab.v('sand_storm_radius') - 100 ? here(u) : null),
  cast(ab) { const u = ab.owner; dodgeProjectiles(u); u.removeModifierByName('modifier_sandking_sand_storm'); addMod(ab, u, 'modifier_sandking_sand_storm', ab.v('AbilityDuration')); } });
defAbility('sandking_scorpion_strike', {
  prio: 56, fid: 'full', note: 'an attack with on-hit effects at `potency` % Item Potency on every enemy in the area: attack damage + attack_damage, x (1 + inner_radius_bonus_damage_pct %) inside inner_radius; then Caustic Finale and the slow. The Shard text in the data refers to caustic_damage_pct = 0 and to no upgrade flag, so it does nothing',
  ai: (ab, u, t) => (t && !t.isBuilding && u.distTo(t) <= ab.castRange() + ab.v('inner_radius') + 100 ? { x: t.x, y: t.y } : null),
  cast(ab, t, x, y) { const u = ab.owner; for (const e of u.world.inRadius(x, y, ab.v('radius'), u.team, true)) skSting(ab, e, 1, (e.x - x) * (e.x - x) + (e.y - y) * (e.y - y) <= ab.v('inner_radius') * ab.v('inner_radius')); } });
debuff('modifier_sandking_epicenter_slow', { stats: (m) => ({ msPct: m.v('epicenter_slow'), asSlow: m.v('epicenter_slow_as') }) });      // both negative in the data
function skPulse(ab, u, radius) { for (const e of enemiesNear(ab, u.x, u.y, radius)) { if (e.isBuilding) continue; addMod(ab, e, 'modifier_sandking_epicenter_slow', ab.v('linger_duration')); hit(ab, e, ab.v('epicenter_damage'), MAGICAL); } }
modifier('modifier_sandking_epicenter', { purge: 'none', interval: (m) => m.v('AbilityDuration') / m.v('epicenter_pulses'), thinkNow: true,
  onThink(m) { if (m.x >= m.v('epicenter_pulses')) { m.remove(); return; } skPulse(m.ability, m.parent, m.v('epicenter_radius_base') + m.v('epicenter_radius_increment') * m.x); m.x++; } });
modifier('modifier_sandking_epicenter_shard', { hidden: true, interval: (m) => m.v('shard_interval'), onThink(m) { if (m.v('proc_passively') > 0) skPulse(m.ability, m.parent, m.v('shard_radius')); } });
defAbility('sandking_epicenter', {
  mods: ['modifier_sandking_epicenter_shard'], requires: (ab) => ab.v('proc_passively') > 0, prio: 84, fid: 'full',
  note: 'epicenter_pulses pulses spread evenly over AbilityDuration around Sand King, radius growing by epicenter_radius_increment per pulse; Shard: one pulse of shard_radius every shard_interval. The Scepter text in the data references values that do not exist (and the ability has no Scepter flag), so nothing is modelled for it',
  ai: (ab, u, t) => (t && !t.isBuilding && !u.hasModifier('modifier_sandking_epicenter') && u.distTo(t) <= ab.v('epicenter_radius_base') - 50 ? here(u) : null),
  cast(ab) { const u = ab.owner; u.removeModifierByName('modifier_sandking_epicenter'); addMod(ab, u, 'modifier_sandking_epicenter', ab.v('AbilityDuration') + 0.5); } });

// ================================================================ Witch Doctor
const WD_WARD = 'npc_dota_witch_doctor_death_ward';
function wdCask(ab, t, i) {
  const u = ab.owner; const w = u.world; const creep = !t.heroLike;
  if (!blocked(ab, t)) { stun(ab, t, creep ? ab.v('creep_duration') : ab.v('hero_duration')); hit(ab, t, (ab.v('base_damage') + ab.v('bounce_bonus_damage') * i) * (creep ? ab.v('creep_damage_pct') / 100 : 1), MAGICAL); }
  if (i + 1 >= ab.v('bounces')) return;
  const c = w.inRadius(t.x, t.y, ab.v('bounce_range'), u.team, true).filter((e) => e !== t && !e.isBuilding && e.st[ST.INVULN] === 0 && e.st[ST.IMMUNE] === 0 && seen(w, e));
  if (!c.length) return;
  const nx = c[w.rng.int(0, c.length - 1)]; const from = { x: t.x, y: t.y };
  w.after(ab.v('bounce_delay'), () => { if (nx.alive) w.projectile(from, nx, ab.v('speed'), (tt) => wdCask(ab, tt, i + 1)); });
}
defAbility('witch_doctor_paralyzing_cask', {
  prio: 81, fid: 'approx', note: '`bounces` is taken as the total number of hits; each bounce goes to a random other enemy within bounce_range (never straight back onto the unit just hit) and adds bounce_bonus_damage',
  ai: (ab, u, t) => (t && !t.isBuilding && !t.isImmune() && u.distTo(t) <= ab.castRange() + 150 ? { target: t } : null),
  cast(ab, t) { const u = ab.owner; u.world.projectile(u, t, ab.v('speed'), (tt) => wdCask(ab, tt, 0)); } });
modifier('modifier_witch_doctor_voodoo_restoration', { purge: 'none', interval: (m) => m.v('heal_interval'),
  onThink(m) {
    const u = m.parent; const w = u.world; const iv = m.v('heal_interval'); const cost = m.v('mana_per_second') * iv;
    if (!w.freeSpells) { if (u.mana < cost) { m.ability.toggled = false; m.remove(); return; } u.mana -= cost; }
    for (const a of m.v('does_heal_all_allies') > 0 ? w.alliesInRadius(u, u.x, u.y, m.v('radius')) : [u]) if (!a.isBuilding) a.heal((m.v('heal') + a.maxHp * m.v('bonus_heal_percent') / 100) * iv, u, m.ability);
  } });
defAbility('witch_doctor_voodoo_restoration', {
  prio: 85, fid: 'full', note: 'toggle: `heal` per second in heal_interval steps for mana_per_second. Controller: on while an allied hero in radius is below 85% health and he has more than 25% mana, off when all are above 98% (switching off refunds the activation cost) or when the mana runs out',
  ai: (ab, u, t, w) => {
    const on = u.hasModifier('modifier_witch_doctor_voodoo_restoration'); let low = 1;
    for (const a of w.alliesInRadius(u, u.x, u.y, ab.v('radius'))) if (a.heroLike && hpFrac(a) < low) low = hpFrac(a);
    return (on ? low >= 0.98 : low < 0.85 && u.mana > u.maxMana * 0.25) ? here(u) : null;
  },
  cast(ab) {
    const u = ab.owner; ab.toggled = u.removeModifierByName('modifier_witch_doctor_voodoo_restoration') === 0;
    if (ab.toggled) addMod(ab, u, 'modifier_witch_doctor_voodoo_restoration'); else if (!u.world.freeSpells) u.mana = Math.min(u.maxMana, u.mana + ab.manaCost());
  } });
debuff('modifier_witch_doctor_maledict', { purge: 'none', interval: 1,       // x = health when cursed, y = seconds elapsed
  onCreated(m) { m.x = m.parent.hp; },
  onThink(m) {
    const t = m.parent; const w = t.world; const ab = m.ability; const c = m.caster; m.y++;
    mhit(m, t, m.v('AbilityDamage'), MAGICAL);
    if (m.y % Math.max(1, Math.round(m.v('AbilityDuration') / m.v('ticks'))) !== 0) return;
    const burst = (m.x - t.hp) * m.v('bonus_damage') / m.v('bonus_damage_threshold'); if (burst <= 0) return;
    const near = m.v('spread_pct') > 0 ? w.inRadius(t.x, t.y, m.v('spread_radius'), c.team, true).filter((e) => e !== t && !e.isBuilding) : [];
    for (const e of near) w.after(t.distTo(e) / m.v('spread_speed'), () => { if (e.alive) w.damage(c, e, burst * m.v('spread_pct') / 100, MAGICAL, 0, ab); });
    if (t.alive) mhit(m, t, burst, MAGICAL);
  } });
defAbility('witch_doctor_maledict', {
  prio: 80, fid: 'full', note: 'AbilityDamage every second; every AbilityDuration / ticks seconds a burst of bonus_damage per bonus_damage_threshold health lost since the curse began; "player-controlled targets" = heroes, illusions and summons',
  ai: (ab, u, t) => { const h = heroFocus(u, t, ab.castRange() + 150, (e) => !e.isImmune() && !e.hasModifier('modifier_witch_doctor_maledict')); return h ? { x: h.x, y: h.y } : null; },
  cast(ab, t, x, y) { for (const e of enemiesNear(ab, x, y, ab.v('radius'))) if (e.heroLike || e.isSummon) addMod(ab, e, 'modifier_witch_doctor_maledict', ab.v('AbilityDuration') + 0.05); } });
// [L] measured in Hero Demo: the channelled ward's first shot lands 0.1 s after it appears (target standing on the ward), then every
// 0.22 s; the Switcheroo ward fires on the frame it appears (300 away: first hit 0.267 s later, then every 0.4 s with the slow)
modifier('modifier_witch_doctor_death_ward_unit', { purge: 'none', allowDead: true, state: ['INVULN', 'UNTARGETABLE'], interval: 0.1, thinkNow: true,       // on the ward; data: { slow, channel }; stays on the dead ward so shots still in flight keep their damage type
  stats: (m) => ({ as: -m.data.slow }),
  onThink(m) {      // attacks only enemy heroes inside its range
    const wd = m.parent; const w = wd.world; const o = m.caster;
    if (!o.alive || (m.data.channel && o.channelAb !== m.ability)) { w.kill(wd, null, null, true); return; }
    if (m.data.channel && !m.data.armed) { m.data.armed = true; return; }
    const reach = wd.attackRange + wd.def.hull; const ok = (e) => !!e && e.alive && e.team !== wd.team && e.heroLike && e.attackableBy(wd) && wd.distTo(e) <= reach + e.def.hull;
    if (ok(wd.orderTarget)) return;
    const t = nearestOf(w.units.filter(ok), wd.x, wd.y); if (t) wd.attack(t); else if (wd.orderTarget) wd.stop();
  },
  outgoing(m, d) { if (d.flags & F_ATTACK) d.type = PURE; },
  onAttack(m, rec) { if (m.parent.world.rng.chance(m.v('bonus_accuracy') / 100)) rec.trueStrike = true; },
  onAttackLanded(m, rec) {       // Scepter: bounces
    const wd = m.parent; if (m.v('bounce_radius') <= 0 || rec.damage <= 0) return;
    chain(wd, rec.target, Infinity, m.v('bounce_radius'), (e, i) => { if (i > 0 && !e.isBuilding) wd.world.damage(wd, e, rec.damage, PURE, F_ATTACK | F_SECONDARY, m.ability); });
  },
  onDealDamage(m, d) { const o = m.caster; if (m.v('scepter_lifesteal') > 0 && o.alive && d.dealt > 0) o.heal(d.dealt * m.v('scepter_lifesteal') / 100, o, m.ability, true); } });
function wdWard(ab, x, y, slow, life, channel) {
  const wd = summon(ab, WD_WARD, { x, y, ai: 'idle', duration: life, ovr: { dmgMin: ab.v('damage'), dmgMax: ab.v('damage'), range: ab.v('attack_range_tooltip') } });
  wd.addModifier('modifier_witch_doctor_death_ward_unit', { caster: ab.owner, ability: ab, data: { slow, channel } });
  return wd;
}
defAbility('witch_doctor_death_ward', {
  prio: 78, fid: 'approx', channel: true,
  note: 'the ward is a summoned, invulnerable unit that attacks the nearest enemy hero in attack_range_tooltip with the unit\'s own attack rate (0.22 s) and keeps that target while it stays in range (it cannot be given a target by hand: sandbox orders do not reach summoned units); each hit deals `damage` as pure damage (the ability\'s damage type) and can be evaded, bonus_accuracy being a chance to ignore evasion. Scepter: every hit bounces once to each enemy reachable in bounce_radius hops (the data has no bounce count) and scepter_lifesteal % of the ward damage heals Witch Doctor (value without tooltip text). Controller: places it towards the nearest enemy hero so that the hero stands well inside its range',
  ai: (ab, u, t) => {
    const keep = ab.v('attack_range_tooltip') - 300; const h = heroFocus(u, t, ab.castRange() + keep - 50); if (!h) return null;
    const a = aim(u.x, u.y, h.x, h.y); const go = clamp(a.d - keep, 0, ab.castRange() - 50); return { x: u.x + a.dx * go, y: u.y + a.dy * go };
  },
  cast(ab, t, x, y) { ab.data = wdWard(ab, x, y, 0, ab.v('AbilityChannelTime') + 0.1, true); },
  channelEnd(ab) { const wd = ab.data; ab.data = null; if (wd && wd.alive) ab.owner.world.kill(wd, null, null, true); } });
// [L] measured in Hero Demo: the hidden Witch Doctor carries root, disarm, invulnerable, invisible, ethereal and out-of-game
modifier('modifier_witch_doctor_voodoo_switcheroo', { purge: 'none', state: ['OUT', 'INVULN', 'ROOT', 'DISARM', 'INVIS', 'ETHEREAL'] });
defAbility('witch_doctor_voodoo_switcheroo', {
  prio: 79, fid: 'approx', note: 'Witch Doctor leaves play for `duration` (rooted, disarmed, invulnerable, invisible, ethereal, out of game: measured) while a Death Ward of the current ultimate level stands in his place with attack speed lowered by attack_speed_reduction; without Death Ward learned the cast only costs mana and cooldown (measured). Controller: with an enemy hero in ward range, when he is below 80% health or an enemy hero is attacking him',
  ai: (ab, u, t) => {
    const dw = u.findAbility('witch_doctor_death_ward'); if (!dw || dw.level < 1 || !heroFocus(u, t, dw.v('attack_range_tooltip') - 50)) return null;
    return hpFrac(u) < 0.8 || u.world.units.some((e) => e.alive && e.team !== u.team && e.isHero && e.attackTarget === u && e.rangeTo(u) <= e.attackRange + 100) ? here(u) : null;
  },
  cast(ab) {
    const u = ab.owner; const dw = u.findAbility('witch_doctor_death_ward'); const d = ab.v('duration');
    if (!dw || dw.level < 1) return;      // [L] measured in Hero Demo: without Death Ward learned the cast costs mana and cooldown and does nothing
    addMod(ab, u, 'modifier_witch_doctor_voodoo_switcheroo', d);
    wdWard(dw, u.x, u.y, ab.v('attack_speed_reduction'), d, false);
  } });
na('witch_doctor_gris_gris', 'gold item (economy); no combat effect');
