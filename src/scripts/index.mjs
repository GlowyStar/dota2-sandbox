// Content scripts: importing this module registers every modelled ability, item effect and modifier.
// Base files load first; every other heroes_*.mjs / items_*.mjs / units_*.mjs / neutral_*.mjs in this folder is picked up
// automatically. SIMLAB_SCRIPTS=name1,name2 restricts the automatic part (used while authoring a single file).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import './generic.mjs';
import './items.mjs';
import './heroes_1.mjs';
import './heroes_2.mjs';
import './heroes_3.mjs';
import './heroes_4.mjs';
import './units.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const base = new Set(['generic.mjs', 'items.mjs', 'heroes_1.mjs', 'heroes_2.mjs', 'heroes_3.mjs', 'heroes_4.mjs', 'units.mjs', 'index.mjs']);
const only = process.env.SIMLAB_SCRIPTS ? new Set(process.env.SIMLAB_SCRIPTS.split(',').map((s) => s.trim().replace(/\.mjs$/, '') + '.mjs')) : null;
for (const f of fs.readdirSync(here).sort()) {
  if (base.has(f) || !/^(heroes|items|units|neutral)_[\w-]+\.mjs$/.test(f)) continue;
  if (only && !only.has(f)) continue;
  await import(pathToFileURL(path.join(here, f)).href);
}
