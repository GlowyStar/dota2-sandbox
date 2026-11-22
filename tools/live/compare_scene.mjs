// Compares two scene records (live game vs simulator) by what happened, not by internal names:
// cast orders (readiness, mana cost, cooldown, cast point, moment of the cast), every damage instance (time and amount after
// reductions), state intervals (stun, silence, root...), stat timelines (speed, armor, attack speed, damage, range...) and positions.
//   node tools/live/compare_scene.mjs <live.json> <sim.json>
import fs from 'node:fs';

const TT = 0.085;                       // time tolerance: two server ticks and a bit
const near = (a, b, abs, rel = 0) => Math.abs(a - b) <= abs + rel * Math.max(Math.abs(a), Math.abs(b));
const STAT_TOL = { ms: [0.6, 0], armor: [0.06, 0], as: [0.6, 0], dmg: [1.01, 0], range: [1, 0], evasion: [0.006, 0], statusRes: [0.006, 0], spellAmp: [0.006, 0], maxHp: [1.01, 0], maxMana: [1.01, 0] };

function timeline(rec) {
  const units = {};
  const get = (u) => (units[u] ||= { stat: {}, st: [], dmg: [], pos: [], hp: [], mods: [] });
  const orders = []; const abil = [];
  for (const e of rec.ev) {
    if (e.k === 's') {
      const U = get(e.u);
      for (const [k, v] of Object.entries(e.d)) {
        if (k === 'st') U.st.push([e.t, v]);
        else if (k === 'x' || k === 'y') { const p = U.pos.length ? { ...U.pos[U.pos.length - 1] } : { x: 0, y: 0 }; p[k] = v; p.t = e.t; U.pos.push(p); }
        else if (STAT_TOL[k]) (U.stat[k] ||= []).push([e.t, v]);
      }
    } else if (e.k === 'df') { if (e.v > 0.01 && e.to) get(e.to).dmg.push({ t: e.t, v: e.v, by: e.by, ab: e.ab }); }
    else if (e.k === 'h') get(e.u).hp.push({ t: e.t, hp: e.hp, mana: e.mana });
    else if (e.k === 'order' && e.type === 'cast') orders.push(e);
    else if (e.k === 'a') abil.push(e);
    else if (e.k === 'm+') get(e.u).mods.push(e);
  }
  return { units, orders, abil };
}
const at = (series, t) => { let v; for (const [ts, x] of series) { if (ts <= t + 1e-9) v = x; else break; } return v; };
const changesNear = (series, t) => series.some(([ts]) => Math.abs(ts - t) <= TT + 0.07);
function intervals(stSeries, name, end) {
  const out = []; let start = null;
  for (const [t, s] of stSeries) { const on = s.split(',').includes(name); if (on && start === null) start = t; else if (!on && start !== null) { out.push([start, t]); start = null; } }
  if (start !== null) out.push([start, end]);
  return out;
}

export function compareScene(live, sim) {
  const F = [];
  const add = (kind, text, weight = 1) => F.push({ kind, text, weight });
  if (sim.error) add('error', `simulator error: ${sim.error}`, 100);
  const L = timeline(live); const S = timeline(sim);
  // ---- cast orders
  for (let i = 0; i < Math.max(L.orders.length, S.orders.length); i++) {
    const a = L.orders[i]; const b = S.orders[i];
    if (!a || !b) { add('order', `cast order #${i + 1} is missing on the ${a ? 'simulator' : 'live'} side`, 10); continue; }
    const tag = `${a.ab}`;
    if (a.ready !== b.ready) add('ready', `${tag}: castable in the game ${a.ready}, in the simulator ${b.ready}`, 10);
    if (!near(a.manaCost, b.manaCost, 0.51)) add('mana cost', `${tag}: mana cost live ${a.manaCost}, sim ${b.manaCost}`, 5);
    if (!near(a.cdFull, b.cdFull, 0.011)) add('cooldown', `${tag}: cooldown live ${a.cdFull}, sim ${b.cdFull}`, 5);
    if (!near(a.castPoint, b.castPoint, 0.011)) add('cast point', `${tag}: cast point live ${a.castPoint}, sim ${b.castPoint}`, 2);
    // the moment the cooldown starts (the cast itself)
    const cast = (T, o) => T.abil.find((e) => e.u === o.u && e.ab === o.ab && e.t >= o.t - 1e-9 && (e.cd > 0 || e.channel || e.toggle));
    const ca = cast(L, a); const cb = cast(S, b);
    if (!ca !== !cb) add('cast', `${tag}: ${ca ? 'cast in the game but not in the simulator' : 'cast in the simulator but not in the game'}`, 10);
    else if (ca && cb) {
      if (!near(ca.t - a.t, cb.t - b.t, TT)) add('cast time', `${tag}: cast lands ${(ca.t - a.t).toFixed(3)} s after the order in the game, ${(cb.t - b.t).toFixed(3)} s in the simulator`, 2);
      if (!near(ca.cd, cb.cd, 0.07)) add('cooldown', `${tag}: cooldown started at live ${ca.cd}, sim ${cb.cd}`, 5);
      if (ca.charges !== cb.charges) add('charges', `${tag}: charges after the cast live ${ca.charges}, sim ${cb.charges}`, 3);
    }
    // mana actually spent: mana just before the cast minus just after
    const spent = (T, o, c) => { if (!c) return null; const U = T.units[o.u]; const hp = U ? U.hp : []; const before = [...hp].reverse().find((h) => h.t < c.t - 1e-9); const after = hp.find((h) => h.t >= c.t - 1e-9); if (!before || !after) return null;
      // the two samples can be some ticks apart (the simulator samples sparsely): add back the mana regenerated in between
      const rs = U.stat.manaRegen || []; let reg = 0; for (const [t, v] of rs) { if (t <= c.t + 1e-9) reg = v; else break; }
      return before.mana - after.mana + reg * (after.t - before.t); };
    const ma = spent(L, a, ca); const mb = spent(S, b, cb);
    if (ma !== null && mb !== null && !near(ma, mb, 1.2)) add('mana spent', `${tag}: mana spent live ${ma.toFixed(1)}, sim ${mb.toFixed(1)}`, 5);
  }
  // ---- per unit
  const tags = new Set([...Object.keys(L.units), ...Object.keys(S.units)]);
  for (const tag of tags) {
    const a = L.units[tag]; const b = S.units[tag];
    if (!a || !b) { add('unit', `unit ${tag} exists only on the ${a ? 'live' : 'simulator'} side`, tag.includes('~') ? 3 : 20); continue; }
    // damage instances in time order
    const da = a.dmg; const db = b.dmg;
    const ta = da.reduce((s, d) => s + d.v, 0); const tb = db.reduce((s, d) => s + d.v, 0);
    // Instances are paired in time order. A periodic effect that started a little earlier or later on one side can fit one
    // more tick into the recording window: an unpaired tail that lies in the last 1.2 s of the window is not a difference.
    const n = Math.min(da.length, db.length);
    const tail = (da.length > n ? da : db).slice(n);
    const end = Math.min(live.duration, sim.duration);
    const tailAtEnd = tail.every((d) => d.t >= end - 1.2);
    if (da.length !== db.length && !tailAtEnd) add('damage count', `${tag}: ${da.length} damage instances in the game (total ${ta.toFixed(1)}), ${db.length} in the simulator (total ${tb.toFixed(1)})`, 8);
    let shift = 0; let atkA = 0; let atkB = 0; let atkN = 0;
    for (let i = 0; i < n; i++) {
      // plain attacks roll their damage between a minimum and a maximum on both sides: single hits are compared loosely,
      // the average over all of them tightly
      if (!da[i].ab && !db[i].ab) { atkA += da[i].v; atkB += db[i].v; atkN++; if (!near(da[i].v, db[i].v, 4, 0.06)) add('damage', `${tag}: attack #${i + 1} at ${da[i].t.toFixed(2)} s: live ${da[i].v}, sim ${db[i].v}`, 6); }
      else if (!near(da[i].v, db[i].v, 0.6, 0.004)) add('damage', `${tag}: hit #${i + 1} at ${da[i].t.toFixed(2)} s (${da[i].ab || 'attack'}): live ${da[i].v}, sim ${db[i].v}`, 6);
      if (!near(da[i].t, db[i].t, TT + 0.03) && Math.abs(da[i].t - db[i].t) > Math.abs(shift)) shift = db[i].t - da[i].t;
    }
    if (atkN >= 4 && !near(atkA / atkN, atkB / atkN, 1.5, 0.012)) add('damage', `${tag}: average attack damage over ${atkN} hits: live ${(atkA / atkN).toFixed(1)}, sim ${(atkB / atkN).toFixed(1)}`, 6);
    if (shift !== 0) add('damage time', `${tag}: damage arrives ${Math.abs(shift).toFixed(2)} s ${shift > 0 ? 'later' : 'earlier'} in the simulator than in the game (largest shift over ${n} hits)`, 2);
    // states
    const names = new Set([...a.st, ...b.st].flatMap(([, s]) => s.split(',').filter(Boolean)));
    for (const n of names) {
      const ia = intervals(a.st, n, live.duration); const ib = intervals(b.st, n, sim.duration);
      const sum = (x) => x.reduce((s, [p, q]) => s + q - p, 0);
      if (ia.length !== ib.length) add('state', `${tag}: ${n} ${ia.length} time(s) in the game (${sum(ia).toFixed(2)} s), ${ib.length} in the simulator (${sum(ib).toFixed(2)} s)`, 7);
      else for (let i = 0; i < ia.length; i++) {
        if (!near(ia[i][0], ib[i][0], TT + 0.03)) add('state time', `${tag}: ${n} starts at live ${ia[i][0].toFixed(3)} s, sim ${ib[i][0].toFixed(3)} s`, 2);
        if (!near(ia[i][1] - ia[i][0], ib[i][1] - ib[i][0], TT)) add('state duration', `${tag}: ${n} lasts live ${(ia[i][1] - ia[i][0]).toFixed(3)} s, sim ${(ib[i][1] - ib[i][0]).toFixed(3)} s`, 6);
      }
    }
    // stat timelines, sampled every 0.1 s away from changes
    for (const [k, [abs, rel]] of Object.entries(STAT_TOL)) {
      const sa = a.stat[k] || []; const sb = b.stat[k] || [];
      let first = null; let n = 0; let worst = 0;
      for (let t = 0.2; t < Math.min(live.duration, sim.duration) - 0.1; t += 0.1) {
        if (changesNear(sa, t) || changesNear(sb, t)) continue;
        const va = at(sa, t); const vb = at(sb, t);
        if (va === undefined || vb === undefined) continue;
        if (!near(va, vb, abs, rel)) { n++; if (first === null) first = [t, va, vb]; worst = Math.max(worst, Math.abs(va - vb)); }
      }
      if (first) add('stat', `${tag}: ${k} differs for ${(n * 0.1).toFixed(1)} s, first at ${first[0].toFixed(1)} s: live ${first[1]}, sim ${first[2]}`, 4);
    }
    // final position
    const pa = a.pos[a.pos.length - 1]; const pb = b.pos[b.pos.length - 1];
    if (pa && pb && Math.hypot(pa.x - pb.x, pa.y - pb.y) > 40) add('position', `${tag}: ends at live (${pa.x}, ${pa.y}), sim (${pb.x}, ${pb.y})`, 3);
  }
  F.sort((x, y) => y.weight - x.weight);
  return { id: live.id, score: F.reduce((s, f) => s + f.weight, 0), findings: F };
}

if (process.argv[1] && process.argv[1].replace(/\\/g, '/').endsWith('tools/live/compare_scene.mjs')) {
  const live = JSON.parse(fs.readFileSync(process.argv[2], 'utf8')); const sim = JSON.parse(fs.readFileSync(process.argv[3], 'utf8'));
  const r = compareScene(live, sim);
  console.log(`${r.id}: ${r.findings.length ? r.findings.length + ' difference(s), score ' + r.score : 'MATCH'}`);
  for (const f of r.findings) console.log(`  [${f.kind}] ${f.text}`);
}
