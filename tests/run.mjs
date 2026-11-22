// Test suite: node tests/run.mjs   (exit code 0 = all passed)
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { loadData } from '../src/engine/gamedata.mjs';
import { runScenario, sheet, buildWorld } from '../src/scenario.mjs';
import { armorMult } from '../src/engine/constants.mjs';
import * as C from '../src/engine/constants.mjs';
import { Rng, prdC } from '../src/engine/rng.mjs';
import { runBatch } from '../src/batch.mjs';
import { sandboxExec } from '../src/sandbox.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const data = loadData();
let pass = 0; let fail = 0; const failures = [];
const ok = (name, cond, info = '') => { if (cond) pass++; else { fail++; failures.push(`${name} ${info}`); console.log(`  FAIL ${name} ${info}`); } };
const near = (a, b, tol = 1e-6) => Math.abs(a - b) <= tol;
const section = (s) => console.log(`- ${s}`);

section('data pack');
ok('heroes >= 120', Object.values(data.heroes).filter((h) => h.enabled).length >= 120);
ok('items present', !!data.abilities.item_black_king_bar && data.abilities.item_black_king_bar.tokens.bonus_strength === 'str');
ok('build recorded', !!data.meta.ClientVersion);

section('formulas');
ok('armor 10 -> 62.5% through', near(armorMult(10), 0.625));
ok('armor -10 -> 137.5%', near(armorMult(-10), 1.375));
const am1 = sheet(data, { unit: 'antimage', level: 1 });
ok('attack interval = BAT / (AS/100)', near(am1.attackInterval, 1.4 / ((100 + 25) / 100), 1e-3), String(am1.attackInterval));
const am30 = sheet(data, { unit: 'antimage', level: 30 });
ok('level 30 strength = base + gain*29 + 14', near(am30.str, 21 + 1.6 * 29 + 14, 0.01), String(am30.str));
ok('level 30 gets all 8 talents', am30.talents.length === 8);
{
  const rng = new Rng(7); const c = prdC(25); let hits = 0; let n = 0; const N = 400000;
  for (let i = 0; i < N; i++) { if (rng.next() < c * (n + 1)) { hits++; n = 0; } else n++; }
  ok('PRD 25% long-run average', near(hits / N, 0.25, 0.004), String(hits / N));
}

section('ability value resolution');
{
  const w = buildWorld(data, { units: [{ id: 'a', unit: 'antimage', level: 25, talents: [6] }] }, 1);
  const u = w.byTag.get('a');
  const blink = u.findAbility('antimage_blink');
  ok('talent: -1s Blink cooldown', near(blink.v('AbilityCooldown'), 5), String(blink.v('AbilityCooldown')));
  const pers = u.findAbility('antimage_persectur');
  ok('per-level scaling (12 + 0.5 * 25)', near(pers.v('move_slow_min'), 24.5), String(pers.v('move_slow_min')));
}
{
  const w = buildWorld(data, { units: [{ id: 'a', unit: 'antimage', level: 10, scepter: true }] }, 1);
  const mb = w.byTag.get('a').findAbility('antimage_mana_break');
  ok('scepter value bonus', near(mb.v('mana_per_hit_pct'), [1.8, 2.7, 3.6, 4.5][mb.level - 1] + 1.5), String(mb.v('mana_per_hit_pct')));
}

section('cross-check against the Valve datafeed (independent source)');
const feed = path.resolve(root, '../Dota2_data/raw/valve_datafeed/english/heroes');
if (fs.existsSync(feed)) {
  let checked = 0; let bad = 0;
  for (const f of fs.readdirSync(feed)) {
    const h = JSON.parse(fs.readFileSync(path.join(feed, f), 'utf8')).result.data.heroes[0];
    const def = data.heroes[h.name];
    if (!def) { bad++; continue; }
    const s = sheet(data, { unit: h.name, level: 1, noAbilities: true }); const uni = def.attr === 'all';
    const exp = { hp: h.max_health, mana: h.max_mana, hpRegen: h.health_regen, manaRegen: h.mana_regen, armor: h.armor, damageMin: uni ? null : h.damage_min, damageMax: uni ? null : h.damage_max, moveSpeed: h.movement_speed, attackRange: h.attack_range };
    for (const [k, v] of Object.entries(exp)) if (v !== null && Math.abs(s[k] - v) > 0.011) bad++;
    checked++;
  }
  ok(`level-1 stats of ${checked} heroes match the published numbers`, bad === 0 && checked >= 120, `mismatches=${bad}`);
} else console.log('  (skipped: datafeed folder not found)');

section('determinism');
const spec = { units: [{ id: 'a', team: 0, unit: 'phantom_assassin', level: 18, items: ['desolator', 'basher'] }, { id: 'b', team: 1, unit: 'sven', level: 18, items: ['echo_sabre', 'greater_crit'] }] };
ok('same seed -> identical result', JSON.stringify(runScenario(data, spec, 99)) === JSON.stringify(runScenario(data, spec, 99)));
{
  const times = new Set();
  for (let s = 1; s <= 12; s++) times.add(runScenario(data, spec, s).time);
  ok('different seeds -> different fights', times.size > 3, `distinct=${times.size}`);
}

section('item effects');
{
  const r = sandboxExec(data, null, [{ op: 'new' }, { op: 'spawn', unit: 'sven', level: 10, id: 's', items: ['desolator'] }, { op: 'spawn', unit: 'axe', team: 1, level: 10, id: 'x', pos: [150, 0] }, { op: 'state', id: 'x' },
    { op: 'order', id: 's', type: 'attack', target: 'x' }, { op: 'step', seconds: 1.5 }, { op: 'state', id: 'x' }, { op: 'close' }]);
  const before = r.out[3].units[0].armor; const after = r.out[6].units[0].armor;
  ok('Desolator: -6 armor on hit', near(before - after, 6, 0.11), `${before} -> ${after}`);
}
{
  const mk = (items) => ({ units: [{ id: 'a', team: 0, unit: 'sven', level: 15, items, ai: 'attack', skills: {} }, { id: 'b', team: 1, unit: 'axe', level: 15, ai: 'idle', skills: {}, override: { hp: 1e9 } }], rules: { maxTime: 400, regen: false } });
  const plain = ['claymore', 'claymore', 'claymore', 'broadsword'];
  const d0 = runScenario(data, mk(plain), 3).units[0]; const d1 = runScenario(data, mk(['greater_crit']), 3).units[0];
  const s0 = sheet(data, { unit: 'sven', level: 15, items: plain, skills: {} }); const s1 = sheet(data, { unit: 'sven', level: 15, items: ['greater_crit'], skills: {} });
  const ratio = (d1.dealt / d1.hits) / (d0.dealt / d0.hits) / (s1.damageAvg / s0.damageAvg);
  ok('Daedalus: mean hit x (1 + 30% * 1.25)', near(ratio, 1.375, 0.04), ratio.toFixed(3));
}

section('every hero: level 30, all talents, Scepter + Shard, fights without script errors');
{
  const errs = []; let n = 0;
  for (const h of Object.values(data.heroes)) {
    if (!h.enabled) continue;
    n++;
    try {
      const r = runScenario(data, { units: [{ id: 'a', team: 0, unit: h.name, level: 30, scepter: true, shard: true, items: ['black_king_bar', 'manta'] }, { id: 'b', team: 1, unit: 'axe', level: 30, items: ['heart', 'blade_mail'] }, { id: 'c', team: 1, unit: 'npc_dota_neutral_alpha_wolf', count: 2 }], rules: { maxTime: 25 } }, 5);
      for (const u of r.units) if (!Number.isFinite(u.dealt) || !Number.isFinite(u.hp)) errs.push(`${h.name}: NaN`);
    } catch (e) { errs.push(`${h.name}: ${e.message}`); }
  }
  ok(`${n} heroes ran`, errs.length === 0, errs.slice(0, 5).join(' ; '));
}

section('every item can be equipped and fought with');
{
  const errs = []; let n = 0;
  for (const a of Object.values(data.abilities)) {
    if (!a.item || a.recipe) continue;
    n++;
    try { runScenario(data, { units: [{ id: 'a', team: 0, unit: 'juggernaut', level: 20, items: [a.name] }, { id: 'b', team: 1, unit: 'sniper', level: 20, items: [a.name] }], rules: { maxTime: 12 } }, 2); } catch (e) { errs.push(`${a.name}: ${e.message}`); }
  }
  ok(`${n} items ran`, errs.length === 0, errs.slice(0, 5).join(' ; '));
}

section('every unit can be spawned and fought');
{
  const errs = []; let n = 0;
  for (const u of Object.values(data.units)) {
    n++;
    try { runScenario(data, { units: [{ id: 'a', team: 0, unit: 'sven', level: 15 }, { id: 'b', team: 1, unit: u.name }], rules: { maxTime: 6, gameTime: '20:00' } }, 2); } catch (e) { errs.push(`${u.name}: ${e.message}`); }
  }
  ok(`${n} units ran`, errs.length === 0, errs.slice(0, 5).join(' ; '));
}

section('skill builds');
{
  let bad = 0; let checked = 0;
  for (const h of Object.values(data.heroes)) {
    if (!h.enabled) continue;
    for (const L of [1, 2, 5, 6, 11, 16, 18, 24, 25, 30]) {
      const u = buildWorld(data, { units: [{ id: 'a', unit: h.name, level: L }] }, 1).byTag.get('a');
      const plan = u.skillPlan();
      const spent = plan.groups.reduce((s, g) => s + g.lead.level, 0);
      // one point per hero level; a group can hold as many levels as its level gates allow at this hero level
      let room = 0;
      for (const g of plan.groups) for (let k = 1; k <= g.lead.maxLevel; k++) if (L >= g.req + g.step * (k - 1)) room++;
      const gates = plan.groups.every((g) => g.lead.level === 0 || L >= g.req + g.step * (g.lead.level - 1));
      const attr = h.noAttr ? 0 : C.ATTRIBUTE_BONUS_LEVELS.filter((x) => x <= L).length;
      if (!gates || spent !== Math.min(L, room) || u.attrLevels !== attr) bad++;
      checked++;
    }
  }
  ok(`every skill point is accounted for (${checked} hero / level pairs)`, bad === 0, `bad=${bad}`);
  const lv = (unit, L, name) => buildWorld(data, { units: [{ id: 'a', unit, level: L }] }, 1).byTag.get('a').findAbility(name).level;
  ok('standard build at 18: 4/4/4 and ultimate 3', lv('axe', 18, 'axe_berserkers_call') === 4 && lv('axe', 18, 'axe_counter_helix') === 4 && lv('axe', 18, 'axe_culling_blade') === 3);
  ok('linked abilities share one level (Shadowraze)', lv('nevermore', 7, 'nevermore_shadowraze1') === 2 && lv('nevermore', 7, 'nevermore_shadowraze3') === 2);
  ok('hidden helper follows its parent', lv('alchemist', 12, 'alchemist_unstable_concoction_throw') === lv('alchemist', 12, 'alchemist_unstable_concoction'));
  ok('Invoker: 22 points in the orbs at level 22 (8/7/7), no attribute bonuses', lv('invoker', 22, 'invoker_quas') === 8 && lv('invoker', 22, 'invoker_wex') === 7 && lv('invoker', 22, 'invoker_exort') === 7
    && buildWorld(data, { units: [{ id: 'a', unit: 'invoker', level: 30 }] }, 1).byTag.get('a').attrLevels === 0);
  ok('attribute bonuses arrive at 15, 16, 17, 19, 20, 21, 22', [14, 15, 17, 18, 22, 30].map((L) => buildWorld(data, { units: [{ id: 'a', unit: 'axe', level: L }] }, 1).byTag.get('a').attrLevels).join() === '0,1,3,3,7,7');
  {
    // health and mana use whole attribute points; damage of a universal hero is 0.45 x the whole part of the attribute sum
    const u = buildWorld(data, { units: [{ id: 'a', unit: 'abaddon', level: 30, skills: {} }] }, 1).byTag.get('a'); u.setTalents([]); u.recompute();
    ok('health from whole strength points (Abaddon 30: 2400)', near(u.maxHp, 2400, 0.5) && near(u.maxMana, 1167, 0.5), `${u.maxHp} / ${u.maxMana}`);
  }
  ok('explicit skills are taken as given', buildWorld(data, { units: [{ id: 'a', unit: 'axe', level: 10, skills: { axe_counter_helix: 4 } }] }, 1).byTag.get('a').findAbility('axe_berserkers_call').level === 0);
}

section('engine rules');
{
  // a faster melee unit must be able to hit a target that keeps walking away
  const r = sandboxExec(data, null, [{ op: 'new' }, { op: 'spawn', unit: 'sven', level: 10, id: 's', items: ['boots'], skills: {} },
    { op: 'spawn', unit: 'crystal_maiden', team: 1, level: 10, id: 'x', pos: [300, 0], skills: {} },
    { op: 'order', id: 'x', type: 'move', pos: [9000, 0] }, { op: 'order', id: 's', type: 'attack', target: 'x' }, { op: 'step', seconds: 8 }, { op: 'results' }, { op: 'close' }]);
  const s = r.out[6].units.find((u) => u.id === 's');
  ok('a chasing unit lands attacks', s.hits >= 2, `hits=${s.hits}`);
}
{
  // charge abilities: the short cooldown is a lockout between uses
  const w = buildWorld(data, { units: [{ id: 'a', unit: 'ringmaster', level: 10, ai: 'idle' }, { id: 'b', team: 1, unit: 'axe', level: 10, ai: 'idle' }] }, 1);
  const ab = w.byTag.get('a').findAbility('ringmaster_impalement');
  const full = ab.charges; ab.startCooldown();
  const locked = !ab.ready(); w.run(ab.v('AbilityCooldown') + 0.1);
  ok('charge lockout between uses', full >= 2 && ab.charges === full - 1 && locked && ab.ready(), `charges=${ab.charges} locked=${locked}`);
}
{
  // summoned units are addressable in the sandbox by the id that `state` shows
  const r = sandboxExec(data, null, [{ op: 'new' }, { op: 'spawn', unit: 'furion', level: 12, id: 'f', ai: 'fight' }, { op: 'spawn', unit: 'axe', team: 1, level: 12, id: 'x', ai: 'idle' }, { op: 'step', seconds: 6 }, { op: 'state' }]);
  const summon = r.out[4].units.find((u) => u.id.includes('~') && u.alive);
  let moved = false;
  if (summon) { const r2 = sandboxExec(data, r.session, [{ op: 'order', id: summon.id, type: 'move', pos: [-500, -500] }, { op: 'state', id: summon.id }]); moved = r2.out[1].units[0].order === 'MOVE'; }
  sandboxExec(data, r.session, [{ op: 'close' }]);
  ok('sandbox orders reach summoned units', !!summon && moved, summon ? summon.id : 'no summon');
}
{
  // jungle creep abilities level with game time
  const lvAt = (t) => buildWorld(data, { units: [{ id: 'a', unit: 'sven' }, { id: 'c', team: 1, unit: 'npc_dota_neutral_centaur_khan' }], rules: { gameTime: t } }, 1).byTag.get('c').findAbility('centaur_khan_war_stomp').level;
  ok('neutral ability level 1 / 2 / 3 at 0:00 / 15:00 / 30:00', lvAt('0:00') === 1 && lvAt('15:00') === 2 && lvAt('30:00') === 3, `${lvAt('0:00')}/${lvAt('15:00')}/${lvAt('30:00')}`);
}
{
  // fights that once failed (found by tools/fuzz.mjs and by authors); each must run to the end
  const cases = JSON.parse(fs.readFileSync(path.join(root, 'tests/regressions.json'), 'utf8'));
  for (const c of cases) {
    let err = '';
    try { runScenario(data, c.scenario, c.seed); } catch (e) { err = e.message; }
    ok(`regression: ${c.name}`, err === '', err);
  }
}
{
  // results name the abilities whose script misses a tooltip clause
  const r = runScenario(data, { units: [{ id: 'a', unit: 'riki', level: 12 }, { id: 'b', team: 1, unit: 'axe', level: 12 }], rules: { maxTime: 5 } }, 1);
  ok('results list partially modelled abilities', Array.isArray(r.partiallyModelled) && r.partiallyModelled[0].abilities.includes('riki_smoke_screen') && r.notModelled === undefined, JSON.stringify(r.partiallyModelled || r.notModelled || null));
}
{
  // free spells: the controller must stay usable (bounded casts) and passives keep their internal cooldowns
  const t0 = Date.now();
  const r = runScenario(data, { units: [{ id: 'a', team: 0, unit: 'clinkz', level: 25, scepter: true }, { id: 'b', team: 1, unit: 'clinkz', level: 25, scepter: true }], rules: { maxTime: 30, freeSpells: true } }, 4);
  ok('free-spell fights stay bounded', r.units[0].casts <= 30 * 12 && Date.now() - t0 < 20000, `casts=${r.units[0].casts} ms=${Date.now() - t0}`);
}

section('coverage report');
{
  const { coverage } = await import('../src/coverage.mjs');
  const s = coverage(data).summary;
  ok('every hero ability has a script', s.heroAbilityFidelity.missing === 0, JSON.stringify(s.heroAbilityFidelity));
  ok('every script carries a fidelity label', s.heroAbilityFidelity.unlabelled + s.shopItemFidelity.unlabelled + s.neutralItemFidelity.unlabelled + s.unitAbilityFidelity.unlabelled === 0);
  ok('no item or creep ability without a script', s.shopItemsNotModelled + s.neutralItemsNotModelled + s.unitAbilityFidelity.missing === 0);
}

section('environment for ML agents');
{
  const { Env } = await import('../src/env.mjs');
  const env = new Env(data);
  const scen = { units: [{ id: 'me', team: 0, unit: 'juggernaut', level: 15, items: ['bfury'], ai: 'external' }, { id: 'foe', team: 1, unit: 'sven', level: 15, ai: 'fight' }], rules: { maxTime: 60 } };
  let out = env.reset({ scenario: scen, seed: 5, dt: 0.2 });
  const me = out.obs.units.find((u) => u.id === 'me');
  ok('reset returns an observation', out.obs.units.length === 2 && out.info.controlled.includes('me') && me.controlled && me.abilities.length > 0);
  const vec = env.vector({});
  ok('fixed-length observation vector', Array.isArray(vec.vector) && vec.vector.length === vec.perUnit * vec.maxUnits && vec.vector.every(Number.isFinite));
  const episode = (seed) => {
    let o = env.reset({ scenario: scen, seed }); const trace = []; let n = 0;
    while (!o.done && n < 2000) {
      const j = o.obs.units.find((u) => u.id === 'me');
      const spin = j.abilities.find((a) => a.name === 'juggernaut_blade_fury');
      o = env.step([spin && spin.ready && n % 7 === 0 ? { unit: 'me', type: 'cast', ability: 'juggernaut_blade_fury' } : { unit: 'me', type: 'attack', target: 'foe' }]);
      trace.push(o.reward[0]); n++;
    }
    return { o, n, key: JSON.stringify(trace) };
  };
  const e1 = episode(5); const e2 = episode(5);
  ok('episode ends with a winner or a timeout', e1.o.done && e1.n <= 60 / 0.2 + 1, `steps=${e1.n}`);
  ok('same seed and actions give the same episode', e1.key === e2.key && e1.o.winner === e2.o.winner);
  ok('rewards of the two teams mirror each other', Math.abs(e1.o.reward[0] + e1.o.reward[1]) < 1e-6);
  out = env.reset({ scenario: scen, seed: 5 });
  out = env.step([{ unit: 'me', type: 'cast', ability: 'no_such_ability' }, { unit: 'foe', type: 'stop' }]);
  ok('invalid actions are reported, not thrown', !!out.info.invalid && out.info.invalid.length === 2);
}
await new Promise((resolve) => {
  const child = spawn(process.execPath, [path.join(root, 'src/cli.mjs'), 'env'], { stdio: ['pipe', 'pipe', 'ignore'] });
  let buf = ''; const got = []; let finished = false;
  const timer = setTimeout(() => { ok('env server replies in time', false); child.kill(); resolve(); }, 20000);
  child.stdout.on('data', (d) => {
    buf += d; let i;
    while ((i = buf.indexOf('\n')) >= 0) { got.push(JSON.parse(buf.slice(0, i))); buf = buf.slice(i + 1); }
    if (got.length >= 6 && !finished) {
      finished = true;
      clearTimeout(timer);
      ok('env server: make', got[0].id === 1 && got[0].ids.length === 2);
      ok('env server: reset with vector', got[1].obs.units.length === 2 && got[1].vec.vector.length > 0);
      ok('env server: step', got[2].reward.length === 2 && got[2].done === false);
      ok('env server: step_many', got[4].results.length === 2 && got[4].results[1].reward.length === 2);
      ok('env server: errors come back as replies', typeof got[5].error === 'string');
      child.stdin.write(JSON.stringify({ cmd: 'close' }) + '\n'); child.stdin.end(); resolve();
    }
  });
  const send = (o) => child.stdin.write(JSON.stringify(o) + '\n');
  const scen = { units: [{ id: 'me', team: 0, unit: 'lina', level: 12, ai: 'external' }, { id: 'foe', team: 1, unit: 'axe', level: 12 }], rules: { maxTime: 30 } };
  send({ id: 1, cmd: 'make', n: 2 });
  send({ id: 2, cmd: 'reset', env: 0, scenario: scen, seed: 3, vector: true });
  send({ id: 3, cmd: 'step', env: 0, actions: [{ unit: 'me', type: 'cast', ability: 'lina_dragon_slave', target: 'foe' }] });
  send({ id: 4, cmd: 'reset', env: 1, scenario: scen, seed: 4 });
  send({ id: 5, cmd: 'step_many', envs: [0, 1], actions: [[{ unit: 'me', type: 'attack', target: 'foe' }], []] });
  send({ id: 6, cmd: 'step', env: 7 });
});

section('batch runner');
{
  const job = { scenario: spec, vary: { 'units.0.level': [10, 20], 'units.1.level': [10, 20] }, runs: 50, seed: 3 };
  const res = await runBatch({ ...job, workers: 2 });
  ok('4 variations x 50 runs', res.scenarios === 200 && res.results.length === 4 && res.errors.length === 0, JSON.stringify(res.errors.slice(0, 2)));
  const res2 = await runBatch({ ...job, workers: 3 });
  ok('batch results do not depend on the worker count', JSON.stringify(res.results) === JSON.stringify(res2.results));
}

section('MCP server handshake');
await new Promise((resolve) => {
  const child = spawn(process.execPath, [path.join(root, 'src/cli.mjs'), 'mcp'], { stdio: ['pipe', 'pipe', 'ignore'] });
  let buf = ''; const got = [];
  const timer = setTimeout(() => { ok('mcp replies in time', false); child.kill(); resolve(); }, 20000);
  child.stdout.on('data', (d) => {
    buf += d; let i;
    while ((i = buf.indexOf('\n')) >= 0) { got.push(JSON.parse(buf.slice(0, i))); buf = buf.slice(i + 1); }
    if (got.length >= 3) {
      clearTimeout(timer);
      ok('initialize', got[0].result.serverInfo.name === 'dota-sandbox');
      ok('tools/list', got[1].result.tools.length >= 9);
      const t = JSON.parse(got[2].result.content[0].text);
      ok('tools/call sim_run', !!t.units && t.units.length === 2);
      child.stdin.end(); resolve();
    }
  });
  const send = (o) => child.stdin.write(JSON.stringify(o) + '\n');
  send({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 't', version: '0' } } });
  send({ jsonrpc: '2.0', id: 2, method: 'tools/list' });
  send({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'sim_run', arguments: { scenario: spec, seed: 1 } } });
});

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) { console.log(failures.join('\n')); process.exit(1); }
