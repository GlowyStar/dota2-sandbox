// Reinforcement-learning style environment on top of the simulator: reset / step / observe / act.
// In-process: `new Env().reset({ scenario })`, `env.step(actions)`.
// Out-of-process: `node src/cli.mjs env` speaks the same API as JSON lines on stdin/stdout (see docs/ENV.md).
import readline from 'node:readline';
import { loadData } from './engine/gamedata.mjs';
import { buildWorld } from './scenario.mjs';
import { ORDER } from './engine/core.mjs';
import { ST } from './engine/registry.mjs';

const r2 = (x) => Math.round(x * 100) / 100;
const ORDER_NAME = Object.fromEntries(Object.entries(ORDER).map(([k, v]) => [v, k.toLowerCase()]));

function castType(ab) {
  if (ab.passive || !ab.script || !ab.script.cast) return 'passive';
  const b = ab.def.behavior;
  if (b.includes('UNIT_TARGET')) return b.includes('POINT') ? 'unit_or_point' : 'unit';
  if (b.includes('POINT')) return 'point';
  return 'none';
}

export class Env {
  constructor(data = loadData()) {
    this.data = data;
    this.world = null;
    this.spec = null;
    this.dt = 0.2;
    this.maxTime = 120;
    this.controlled = new Set();
    this.prev = null;
    this.done = true;
    this.winner = -1;
    this.steps = 0;
  }

  // options: { scenario, seed, dt (seconds per step), events (bool: return combat log entries of each step), reward: { damage, kill, win } weights }
  reset(o = {}) {
    const spec = o.scenario || this.spec;
    if (!spec) throw new Error('reset needs a scenario');
    this.spec = spec;
    this.dt = o.dt ?? this.dt;
    this.events = !!o.events;
    this.rw = { damage: 0.001, kill: 1, win: 5, ...(o.reward || {}) };
    const rules = spec.rules || {};
    this.maxTime = rules.maxTime ?? 120;
    const w = buildWorld(this.data, spec, o.seed ?? 1, { log: this.events, logLimit: 1e9 });
    this.world = w;
    this.controlled = new Set();
    const us = spec.units || [];
    // externally controlled units: ai "external" (or listed in o.control)
    for (const u of w.units) {
      if (!u.counts) continue;
      const src = us.find((x) => (x.id || '') === u.tag || (x.count > 1 && x.id && u.tag.startsWith(x.id)));
      if ((src && src.ai === 'external') || (o.control && o.control.includes(u.tag))) { u.ai = null; this.controlled.add(u.tag); }
    }
    this.logPos = 0;
    this.done = false; this.winner = -1; this.steps = 0;
    this.prev = this.totals();
    return { obs: this.observe(), info: { controlled: [...this.controlled], dt: this.dt, maxTime: this.maxTime, teams: [...new Set(w.units.map((u) => u.team))] } };
  }

  totals() {
    const t = { dealt: [0, 0, 0, 0], alive: [0, 0, 0, 0] };
    for (const u of this.world.units) { if (!u.counts) continue; t.dealt[u.team] += u.mHeroDealt + (u.mDealt - u.mHeroDealt) * 0.25; if (u.alive) t.alive[u.team]++; }
    return t;
  }

  unitObs(u) {
    if (u.dirty) u.recompute();
    const w = this.world; const st = u.st;
    return {
      id: u.tag, unit: u.name.replace('npc_dota_hero_', '').replace('npc_dota_', ''), heroId: u.def.id || 0, team: u.team, controlled: this.controlled.has(u.tag), alive: u.alive, level: u.level,
      hp: r2(u.hp), maxHp: r2(u.maxHp), mana: r2(u.mana), maxMana: r2(u.maxMana), x: r2(u.x), y: r2(u.y),
      armor: r2(u.armor), mr: r2(u.mr), damage: r2((u.dmgMin + u.dmgMax) / 2 + u.dmgBonus), attackInterval: r2(u.attackInterval), attackRange: u.attackRange, moveSpeed: r2(u.ms),
      stunned: st[ST.STUN] > 0 || st[ST.SLEEP] > 0 || st[ST.OUT] > 0, silenced: u.isSilenced(), rooted: st[ST.ROOT] > 0, disarmed: u.isDisarmed(), hexed: st[ST.HEX] > 0,
      immune: st[ST.IMMUNE] > 0, invulnerable: st[ST.INVULN] > 0, untargetable: st[ST.UNTARGETABLE] > 0 || st[ST.OUT] > 0,
      order: ORDER_NAME[u.order], target: u.orderTarget ? u.orderTarget.tag : null, casting: u.castAb ? u.castAb.name : u.channelAb ? u.channelAb.name : null,
      abilities: u.abilities.filter((a) => a.level > 0 && !a.def.talent && a.name !== 'special_bonus_attributes').map((a) => ({ name: a.name, level: a.level, type: castType(a), cd: r2(a.cdRemaining()), mana: r2(a.manaCost()), ready: !a.passive && a.ready() && !u.isSilenced(), range: a.castRange(), charges: a.vals.AbilityCharges > 0 ? a.charges : undefined })),
      items: u.items.map((a) => ({ name: a.name, type: castType(a), cd: r2(a.cdRemaining()), ready: !a.passive && a.ready() && !u.isMuted(), charges: a.charges || undefined })),
      modifiers: u.mods.filter((m) => !m.def.hidden).map((m) => ({ name: m.name, stacks: m.stacks || undefined, left: m.dieTime === Infinity ? undefined : r2(m.dieTime - w.time), debuff: m.def.debuff || undefined })),
    };
  }

  observe() {
    const w = this.world;
    return { time: r2(w.time), units: w.units.filter((u) => u.counts || (u.alive && u.isSummon)).map((u) => this.unitObs(u)) };
  }

  // Flat numeric encoding: for each of `maxUnits` units a fixed block of features (zeros for empty slots).
  // Layout per unit: [present, team, alive, heroId, level, hp/maxHp, maxHp/5000, mana/maxMana, maxMana/3000, x/2000, y/2000, armor/50, mr, damage/500,
  //   1/attackInterval/5, attackRange/1000, moveSpeed/550, stunned, silenced, rooted, disarmed, hexed, immune, invulnerable]
  //   + per ability slot [present, ready, cd/60]  + per item slot [present, ready, cd/60]
  vector({ maxUnits = 10, maxAbilities = 8, maxItems = 7 } = {}) {
    const per = 24 + maxAbilities * 3 + maxItems * 3;
    const out = new Array(maxUnits * per).fill(0);
    const us = this.world.units.filter((u) => u.counts).slice(0, maxUnits);
    us.forEach((u, i) => {
      if (u.dirty) u.recompute();
      const o = i * per; const st = u.st; const b = (x) => (x ? 1 : 0);
      const f = [1, u.team, b(u.alive), u.def.id || 0, u.level, u.hp / u.maxHp, u.maxHp / 5000, u.maxMana > 0 ? u.mana / u.maxMana : 0, u.maxMana / 3000, u.x / 2000, u.y / 2000, u.armor / 50, u.mr,
        ((u.dmgMin + u.dmgMax) / 2 + u.dmgBonus) / 500, 1 / u.attackInterval / 5, u.attackRange / 1000, u.ms / 550, b(st[ST.STUN] > 0 || st[ST.SLEEP] > 0 || st[ST.OUT] > 0), b(u.isSilenced()), b(st[ST.ROOT] > 0), b(u.isDisarmed()), b(st[ST.HEX] > 0), b(st[ST.IMMUNE] > 0), b(st[ST.INVULN] > 0)];
      for (let k = 0; k < f.length; k++) out[o + k] = r2(f[k]);
      const abs = u.abilities.filter((a) => a.level > 0 && !a.passive && a.script && a.script.cast).slice(0, maxAbilities);
      abs.forEach((a, k) => { const p = o + 24 + k * 3; out[p] = 1; out[p + 1] = b(a.ready() && !u.isSilenced()); out[p + 2] = r2(Math.min(1, a.cdRemaining() / 60)); });
      const its = u.items.filter((a) => !a.passive && a.script && a.script.cast).slice(0, maxItems);
      its.forEach((a, k) => { const p = o + 24 + maxAbilities * 3 + k * 3; out[p] = 1; out[p + 1] = b(a.ready() && !u.isMuted()); out[p + 2] = r2(Math.min(1, a.cdRemaining() / 60)); });
    });
    return { vector: out, perUnit: per, maxUnits };
  }

  // action: { unit, type: 'attack'|'move'|'cast'|'stop'|'hold'|'noop', target, ability, pos: [x, y] }
  act(a) {
    const w = this.world;
    const u = w.byTag.get(a.unit);
    if (!u) return `unknown unit ${a.unit}`;
    if (!this.controlled.has(a.unit)) return `unit ${a.unit} is not externally controlled (set ai: "external" in the scenario)`;
    if (!u.alive) return null;
    const t = a.target ? w.byTag.get(a.target) || w.units.find((x) => x.tag === a.target) : null;
    switch (a.type) {
      case 'noop': case undefined: return null;
      case 'attack': if (!t) return 'attack needs a valid target'; if (!t.alive) return 'target is dead'; u.attack(t); return null;
      case 'move': if (!a.pos) return 'move needs pos'; u.moveTo(a.pos[0], a.pos[1]); return null;
      case 'stop': u.stop(); return null;
      case 'hold': u.hold(); return null;
      case 'cast': {
        const key = this.data.resolve('ability', a.ability) || this.data.resolve('item', a.ability) || a.ability;
        const ab = u.findAbility(key);
        if (!ab) return `unit has no ability ${a.ability}`;
        if (!ab.script || !ab.script.cast) return `${ab.name} is not castable in the simulator`;
        if (!ab.ready()) return `${ab.name} is not ready`;
        if (ab.isItem ? u.isMuted() : u.isSilenced()) return `${ab.name} cannot be cast now (silenced / muted)`;
        if (t && !t.alive) return 'target is dead';
        const b = ab.def.behavior;
        if (b.includes('UNIT_TARGET') && !t && !a.pos && !b.includes('POINT')) return `${ab.name} needs a target`;
        u.cast(ab, t, a.pos ? a.pos[0] : t ? t.x : u.x, a.pos ? a.pos[1] : t ? t.y : u.y);
        return null;
      }
      default: return `unknown action type ${a.type}`;
    }
  }

  step(actions = []) {
    if (this.done) throw new Error('episode is over: call reset');
    const w = this.world; const invalid = [];
    for (const a of actions) { const err = this.act(a); if (err) invalid.push({ unit: a.unit, error: err }); }
    const ticks = Math.max(1, Math.round(this.dt / w.dt));
    for (let i = 0; i < ticks; i++) w.tick();
    this.steps++;
    const now = this.totals();
    // done: at most one team has living principal units, or time is up
    let mask = 0; for (let t = 0; t < 4; t++) if (now.alive[t] > 0) mask |= 1 << t;
    const reward = [0, 0];
    for (const t of [0, 1]) { const o = 1 - t; reward[t] += (now.dealt[t] - this.prev.dealt[t]) * this.rw.damage - (now.dealt[o] - this.prev.dealt[o]) * this.rw.damage; reward[t] += (this.prev.alive[o] - now.alive[o]) * this.rw.kill - (this.prev.alive[t] - now.alive[t]) * this.rw.kill; }
    if ((mask & (mask - 1)) === 0) { this.done = true; this.winner = mask === 0 ? -1 : Math.log2(mask) | 0; if (this.winner === 0 || this.winner === 1) { reward[this.winner] += this.rw.win; reward[1 - this.winner] -= this.rw.win; } }
    else if (w.time + 1e-9 >= this.maxTime) { this.done = true; this.winner = -1; }
    this.prev = now;
    const out = { obs: this.observe(), reward: reward.map(r2), done: this.done, winner: this.done ? this.winner : undefined, info: { time: r2(w.time), step: this.steps } };
    if (invalid.length) out.info.invalid = invalid;
    if (this.events && w.log) { out.info.events = w.log.slice(this.logPos); this.logPos = w.log.length; }
    return out;
  }
}

// ---------------------------------------------------------------- JSON-lines server (one request per line, one reply per line)
// { "cmd": "make", "n": 4 } -> { ids }
// { "cmd": "reset", "env": 0, "scenario": {...}, "seed": 1, "dt": 0.2, "events": false, "vector": {...} }
// { "cmd": "step", "env": 0, "actions": [...] }      { "cmd": "step_many", "envs": [0,1], "actions": [[...],[...]] }
// { "cmd": "observe", "env": 0 }  { "cmd": "spec" }  { "cmd": "close" }
export function startEnvServer() {
  const data = loadData();
  const envs = new Map(); const vecOpts = new Map();
  let next = 0;
  const get = (id) => { const e = envs.get(id ?? 0); if (!e) throw new Error(`no env ${id}; send {"cmd":"make"} first`); return e; };
  const withVec = (id, res) => { const vo = vecOpts.get(id ?? 0); if (vo) res.vec = get(id).vector(vo === true ? {} : vo); return res; };
  const handle = (m) => {
    switch (m.cmd) {
      case 'make': { const ids = []; for (let i = 0; i < (m.n || 1); i++) { envs.set(next, new Env(data)); ids.push(next++); } return { ids }; }
      case 'reset': { if (!envs.has(m.env ?? 0) && (m.env ?? 0) === 0) { envs.set(0, new Env(data)); next = Math.max(next, 1); } if (m.vector !== undefined) vecOpts.set(m.env ?? 0, m.vector); return withVec(m.env, get(m.env).reset(m)); }
      case 'step': return withVec(m.env, get(m.env).step(m.actions || []));
      case 'step_many': return { results: m.envs.map((id, i) => { const e = get(id); return e.done ? { done: true, env: id } : withVec(id, e.step((m.actions && m.actions[i]) || [])); }) };
      case 'observe': return withVec(m.env, { obs: get(m.env).observe() });
      case 'spec': return { actions: ['noop', 'attack', 'move', 'cast', 'stop', 'hold'], actionFields: { unit: 'id of a controlled unit', type: 'action name', target: 'unit id', ability: 'ability or item name', pos: '[x, y]' },
        vectorLayout: 'per unit: present, team, alive, heroId, level, hpFrac, maxHp/5000, manaFrac, maxMana/3000, x/2000, y/2000, armor/50, magicResist, damage/500, attacksPerSec/5, range/1000, moveSpeed/550, stunned, silenced, rooted, disarmed, hexed, immune, invulnerable, then [present, ready, cd/60] per ability slot and per item slot',
        reward: 'per team: damage dealt minus damage taken (weighted, creep damage counts 25%), kills, win bonus; weights via reset.reward = { damage, kill, win }' };
      case 'close': if (m.env !== undefined) { envs.delete(m.env); return { closed: m.env }; } return { closed: 'all', exit: true };
      default: throw new Error(`unknown cmd ${m.cmd}`);
    }
  };
  const rl = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
  rl.on('line', (line) => {
    const s = line.trim();
    if (!s) return;
    let id;
    try {
      const m = JSON.parse(s); id = m.id;
      const res = handle(m);
      process.stdout.write(JSON.stringify(id !== undefined ? { id, ...res } : res) + '\n');
      if (res.exit) process.exit(0);
    } catch (e) { process.stdout.write(JSON.stringify({ id, error: String(e && e.message ? e.message : e) }) + '\n'); }
  });
  rl.on('close', () => process.exit(0));
}
