// Compact per-hero digest of shipped ability data + tooltip text (authoring aid for src/scripts/heroes_*.mjs).
import fs from 'node:fs';
const d = JSON.parse(fs.readFileSync(new URL('../data/gamedata.json', import.meta.url)));
const ds = JSON.parse(fs.readFileSync(new URL('../data/descriptions.json', import.meta.url)));
const strip = (s) => (s || '').replace(/<h1>/g, '[').replace(/<\/h1>/g, '] ').replace(/<[^>]+>/g, ' ').replace(/\n/g, ' ').replace(/%%%/g, '%').replace(/%%/g, '%').replace(/\s+/g, ' ').trim();
const fv = (e) => { if (Array.isArray(e)) return e.join('/'); let s = e.v.join('/'); if (e.lv) s += `(+${e.lv[0]}/lvl)`; if (e.t) s += '{T' + Object.values(e.t).map((m) => m[0] + m[2].join('/') + (m[1] ? '%' : '')).join(',') + '}'; if (e.sc) s += `{SC${e.sc[0]}${e.sc[2].join('/')}}`; if (e.sh) s += `{SH${e.sh[0]}${e.sh[2].join('/')}}`; return s; };
const maxDesc = Number(process.env.DESC || 300);
for (const hn of process.argv.slice(2)) {
  const h = d.heroes[hn.startsWith('npc_') ? hn : 'npc_dota_hero_' + hn];
  if (!h) { console.log('?? ' + hn); continue; }
  console.log(`\n### ${h.name.replace('npc_dota_hero_', '')} (${h.dname}) ${h.attr} ${h.atk} range ${h.range}`);
  for (const an of h.abilities) {
    const a = d.abilities[an]; const de = ds[an] || {};
    const beh = a.behavior.filter((b) => !/IGNORE|DONT|ROOT_DISABLES|SHOW_IN|AUTOCAST|OVERSHOOT|NORMAL_WHEN/.test(b)).join('|');
    console.log(`- ${an} "${a.dname || ''}" [${beh}]${a.dmg ? ' ' + a.dmg : ''}${a.team ? ' ' + a.team : ''}${a.immunity ? ' imm:' + a.immunity : ''}${a.type === 'ultimate' ? ' ULT' : ''}${a.innate ? ' INNATE' : ''}${a.bySc ? ' bySC' : ''}${a.bySh ? ' bySH' : ''}`);
    console.log('    ' + Object.entries(a.vals).map(([k, e]) => k.replace(/^Ability/, 'A') + '=' + fv(e)).join('; '));
    console.log('    D: ' + strip(de.desc).slice(0, maxDesc) + (de.scepter ? ' | SC: ' + strip(de.scepter).slice(0, 160) : '') + (de.shard ? ' | SH: ' + strip(de.shard).slice(0, 160) : ''));
  }
  console.log('  talents: ' + h.talents.map((t, i) => `${i}:${(d.abilities[t] || {}).dname || t}`).join(' ; ').slice(0, 700));
}
