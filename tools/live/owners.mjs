// Which script file owns which hero (the file that registers the hero's abilities).
//   node tools/live/owners.mjs            -> prints  file: hero hero ...
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { loadData } from '../../src/engine/gamedata.mjs';

const data = loadData();
const dir = 'src/scripts';
const text = {};
for (const f of fs.readdirSync(dir)) if (/^heroes_[0-9]+[.]mjs$/.test(f)) text[f] = fs.readFileSync(path.join(dir, f), 'utf8');
const owners = {};
for (const h of Object.values(data.heroes)) {
  if (!h.enabled) continue;
  const count = {};
  for (const an of h.abilities) for (const [f, t] of Object.entries(text)) if (t.includes(`'${an}'`)) count[f] = (count[f] || 0) + 1;
  const best = Object.entries(count).sort((a, b) => b[1] - a[1])[0];
  (owners[best ? best[0] : '?'] ||= []).push(h.name.replace('npc_dota_hero_', ''));
}
export default owners;

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  for (const f of Object.keys(owners).sort((a, b) => parseInt(a.slice(7), 10) - parseInt(b.slice(7), 10))) console.log(`${f}: ${owners[f].join(' ')}`);
}
