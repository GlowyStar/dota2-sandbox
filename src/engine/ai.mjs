// Unit controllers. Deliberately simple and deterministic so that test results are explainable:
//   fight  - pick a target, use every scripted ability / item that is ready (in priority order), otherwise attack
//   attack - only right-click the target
//   idle   - do nothing (training dummy)
import { ORDER } from './core.mjs';
import { ST } from './registry.mjs';

function pickTarget(u, w, focus) {
  const us = w.units;
  let best = null; let bestScore = Infinity;
  for (let i = 0; i < us.length; i++) {
    const o = us[i];
    if (!o.alive || o.team === u.team || !o.attackableBy(u)) continue;
    let score;
    if (focus === 'lowest_hp') score = o.hp;
    else if (focus === 'heroes_first') score = (o.isHero ? 0 : 1e7) + u.distTo(o);
    else score = u.distTo(o);
    if (score < bestScore) { bestScore = score; best = o; }
  }
  return best;
}

export class BasicAI {
  constructor(opts = {}) {
    this.mode = opts.mode || 'fight';
    this.focus = opts.focus || 'nearest';
    this.fixedTarget = null;        // Unit, set by the scenario when focus is a unit tag
    this.target = null;
    this.abilities = opts.abilities ?? 'all';   // 'all' | 'none' | [names]
    this.items = opts.items ?? 'all';
    this.order = opts.order || null;            // optional explicit cast priority: [names]
    this.castables = null;
    this.retarget = opts.retarget !== false;
  }

  buildCastables(u) {
    const list = [];
    const listed = (set, name) => Array.isArray(set) && set.includes(name);
    const allow = (set, name, sc) => (set === 'all' && !sc.manual) || listed(set, name) || (this.order !== null && this.order.includes(name));
    for (const a of u.abilities) if (a.script && (a.script.cast || a.script.ai) && !a.passive && a.ai && allow(this.abilities, a.name, a.script)) list.push(a);
    for (const a of u.items) if (a.script && (a.script.cast || a.script.ai) && !a.passive && a.slot !== 'backpack' && a.ai && allow(this.items, a.name, a.script)) list.push(a);
    const prio = (a) => {
      if (this.order) { const i = this.order.indexOf(a.name); if (i >= 0) return -1000 + i; }
      return -(a.script.prio || 0);
    };
    list.sort((a, b) => prio(a) - prio(b));
    this.castables = list;
  }

  think(u, w) {
    if (this.mode === 'idle') return;
    let t = this.fixedTarget && this.fixedTarget.alive ? this.fixedTarget : this.target;
    if (t === null || !t.alive || !t.attackableBy(u)) t = this.fixedTarget && this.fixedTarget.alive && this.fixedTarget.attackableBy(u) ? this.fixedTarget : pickTarget(u, w, this.focus);
    this.target = t;
    if (this.mode === 'fight' && u.order !== ORDER.CAST) {
      if (this.castables === null || this.castables.length !== 0) {
        if (this.castables === null) this.buildCastables(u);
        const cs = this.castables;
        const silenced = u.isSilenced(); const muted = u.isMuted();
        for (let i = 0; i < cs.length; i++) {
          const ab = cs[i];
          if (ab.isItem ? muted : silenced) continue;
          if (!ab.ready() || ab.level < 1) continue;
          // without cooldowns (rules.freeSpells) the controller uses each ability at most once per FREE_SPELL_GAP seconds
          if (w.freeSpells && ab.aiNext > w.time) continue;
          const d = decide(ab, u, t, w);
          if (d === null) continue;
          const dt = d.target || null;
          // a spell that cannot affect its target is not ordered (the cast would be dropped and re-issued every tick)
          if (dt !== null && dt.team !== u.team && (!dt.targetable() || (dt.st[ST.IMMUNE] > 0 && !ab.pierces))) continue;
          if (w.freeSpells) ab.aiNext = w.time + FREE_SPELL_GAP;
          u.cast(ab, dt, d.x === undefined ? (dt ? dt.x : u.x) : d.x, d.y === undefined ? (dt ? dt.y : u.y) : d.y);
          return;
        }
      }
    }
    if (u.order === ORDER.CAST) return;
    if (t === null) { if (u.order === ORDER.ATTACK) u.stop(); return; }
    if (u.order !== ORDER.ATTACK || u.orderTarget !== t) u.attack(t);
  }
}

const SELF = { target: null };
const FREE_SPELL_GAP = 1;

// Default casting rules derived from the ability's shipped behaviour flags; scripts may override with `ai`.
export function decide(ab, u, t, w) {
  const sc = ab.script;
  if (sc.ai) {
    const r = sc.ai(ab, u, t, w);
    if (!r) return null;
    return r === true ? autoTarget(ab, u, t) : r;
  }
  if (sc.cond && !sc.cond(ab, u, t, w)) return null;
  return autoTarget(ab, u, t);
}

function autoTarget(ab, u, t) {
  const b = ab.def.behavior;
  const team = ab.def.team || '';
  if (b.includes('UNIT_TARGET')) {
    if (team.includes('FRIENDLY') && !team.includes('ENEMY')) return { target: u };
    if (t === null) return team.includes('BOTH') || team === '' ? null : null;
    if (t.st[ST.IMMUNE] > 0 && !ab.pierces) return null;
    return { target: t };
  }
  if (b.includes('POINT')) { if (t === null) return null; return { x: t.x, y: t.y }; }
  if (b.includes('NO_TARGET') || b.includes('IMMEDIATE') || b.includes('TOGGLE')) {
    if (t === null) return null;
    const r = ab.script.radius ? (typeof ab.script.radius === 'string' ? ab.v(ab.script.radius) : ab.script.radius) : 0;
    if (r > 0 && u.distTo(t) > r) return null;
    if (r === 0 && ab.script.engage !== false && u.rangeTo(t) > Math.max(u.attackRange, 300) + 150) return null;
    return SELF;
  }
  return null;
}

export function makeAI(spec) {
  if (!spec || spec === 'fight') return new BasicAI({ mode: 'fight' });
  if (typeof spec === 'string') return new BasicAI({ mode: spec });
  return new BasicAI(spec);
}
