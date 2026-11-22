// Compares the data pack compiled from the installed game's VPK with one compiled from an extracted folder (mirror).
import { compileGameData } from '../src/data/compile.mjs';
import crypto from 'node:crypto';
import fs from 'node:fs';
const folder = process.argv[2];
const a = compileGameData({}).data; const b = compileGameData({ folder }).data;
const h = (o) => crypto.createHash('sha256').update(JSON.stringify(o)).digest('hex').slice(0, 16);
for (const k of ['heroes', 'units', 'abilities', 'neutral']) console.log(k.padEnd(10), h(a[k]), h(b[k]), h(a[k]) === h(b[k]) ? 'IDENTICAL' : 'DIFFERENT');
const game = a.meta.source.replace('vpk:', '');
const sha = (f) => crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex');
console.log('pak01_dir.vpk sha256', sha(game));
console.log('server.dll    sha256', sha(game.replace(/pak01_dir\.vpk$/, 'bin/win64/server.dll').replace(/\pak01_dir.vpk$/, '\bin\win64\server.dll')));
