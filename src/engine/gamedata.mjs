// Loads the compiled data pack and builds lookup indices.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
export const DATA_DIR = path.resolve(here, '../../data');

let cached = null;

export function prepareData(data) {
  const ab = data.abilities;
  // boots family: item_boots and everything built from it (their movement speed bonuses do not stack)
  const boots = new Set(['item_boots']);
  let grew = true;
  while (grew) {
    grew = false;
    for (const a of Object.values(ab)) {
      if (!a.item || boots.has(a.name) || !a.comps) continue;
      if (a.comps.some((c) => boots.has(c))) { boots.add(a.name); grew = true; }
    }
  }
  data.bootsFamily = boots;
  // name index: internal name, short name and display name (case-insensitive)
  const idx = new Map();
  const norm = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '');
  const add = (key, kind, name) => { const k = norm(key); if (k && !idx.has(kind + ':' + k)) idx.set(kind + ':' + k, name); };
  for (const h of Object.values(data.heroes)) { add(h.name, 'unit', h.name); add(h.name.replace('npc_dota_hero_', ''), 'unit', h.name); if (h.dname) add(h.dname, 'unit', h.name); }
  for (const u of Object.values(data.units)) { add(u.name, 'unit', u.name); add(u.name.replace('npc_dota_', ''), 'unit', u.name); if (u.dname) add(u.dname, 'unit', u.name); }
  for (const a of Object.values(ab)) {
    if (a.item) { add(a.name, 'item', a.name); add(a.name.replace('item_', ''), 'item', a.name); if (a.dname && !a.recipe) add(a.dname, 'item', a.name); }
    else { add(a.name, 'ability', a.name); if (a.dname) add(a.dname, 'ability', a.name); }
  }
  for (const a of Object.values(ab)) if (a.aoe) { a.aoeMap = {}; for (const k of a.aoe) a.aoeMap[k] = 1; }
  data.index = idx;
  data.resolve = (kind, name) => idx.get(kind + ':' + norm(String(name))) || null;
  return data;
}

// Facts read from the running game (tools/live): max levels, level links, levels on an untouched hero, attribute bonus schedule,
// pause between charge uses. They are attached to the definitions only when they were collected for the same game build.
export function applyFacts(data, facts) {
  data.facts = null;
  if (!facts) return data;
  if (String(facts.build) !== String(data.meta.ClientVersion)) { data.factsStale = `live facts are from build ${facts.build}, data pack is build ${data.meta.ClientVersion}`; return data; }
  data.facts = facts;
  const ab = data.abilities;
  for (const [n, m] of Object.entries(facts.maxLevel || {})) if (ab[n] && m > 0) ab[n].liveMax = m;
  for (const [n, l] of Object.entries(facts.fresh || {})) if (ab[n]) ab[n].fresh = l;
  for (const [n, s] of Object.entries(facts.chargeLockout || {})) if (ab[n]) ab[n].lockout = s;
  for (const [lead, followers] of Object.entries(facts.follow || {})) {
    if (!ab[lead]) continue;
    ab[lead].follow = followers;
    for (const f of Object.keys(followers)) if (ab[f]) (ab[f].followerOf ||= []).push(lead);
  }
  // an ability that follows another one which does not follow it back never takes skill points itself
  for (const a of Object.values(ab)) if (a.followerOf) a.pureFollower = a.followerOf.some((lead) => !(a.follow && a.follow[lead])) ? 1 : 0;
  for (const h of facts.noAttributeBonus || []) if (data.heroes[h]) data.heroes[h].noAttr = 1;
  return data;
}

export function loadData(file) {
  if (cached && !file) return cached;
  const f = file || path.join(DATA_DIR, 'gamedata.json');
  if (!fs.existsSync(f)) throw new Error(`data pack not found: ${f}. Run "simlab build-data" first.`);
  const data = prepareData(JSON.parse(fs.readFileSync(f, 'utf8')));
  const ff = path.join(path.dirname(f), 'live_facts.json');
  applyFacts(data, fs.existsSync(ff) ? JSON.parse(fs.readFileSync(ff, 'utf8')) : null);
  if (!file) cached = data;
  return data;
}

export function loadDescriptions() {
  const f = path.join(DATA_DIR, 'descriptions.json');
  return fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')) : {};
}
