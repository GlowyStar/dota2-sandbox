// MCP server (stdio, JSON-RPC 2.0, one JSON message per line). No dependencies.
import readline from 'node:readline';
import * as api from './api.mjs';

const UNIT_SPEC = 'Unit spec: { id, team (0|1), unit (hero/unit name), level, items: [names or {name, attr, level, charges}], neutral: [names or {name, level}], talents: "none|first|second|all|1-2-1-2" or [names], skills: {ability: level}, scepter, shard, pos: [x,y], hp, mana (fraction 0..1 or absolute), ai: "fight|attack|idle" or {mode, focus, target, abilities, items, order}, count }.';

const TOOLS = [
  { name: 'sim_info', description: 'Simulator status: game build the data was compiled from, counts, what is modelled, and a guide to the scenario / batch JSON formats. Call this first in a new session.',
    inputSchema: { type: 'object', properties: {} }, run: () => api.info() },
  { name: 'sim_list', description: 'List spawnable heroes, units (creeps, neutrals, Roshan, summons, buildings), shop items or current neutral items. Shows which effects are modelled.',
    inputSchema: { type: 'object', properties: { kind: { type: 'string', enum: ['heroes', 'units', 'items', 'neutral_items'] }, query: { type: 'string', description: 'substring filter on name / display name / role' }, limit: { type: 'number' } }, required: ['kind'] }, run: (a) => api.list(a) },
  { name: 'sim_describe', description: 'Full data for one hero, unit, item or ability: base stats, abilities with values per level and current tooltip text, talents (with index), and whether the engine models it. Use before designing a test around a specific ability or item.',
    inputSchema: { type: 'object', properties: { name: { type: 'string' } }, required: ['name'] }, run: (a) => api.describe(a) },
  { name: 'sim_sheet', description: `Character sheet (HP, armor, damage, attack speed, DPS, EHP, move speed...) for one unit setup, like the in-game stats panel. ${UNIT_SPEC}`,
    inputSchema: { type: 'object', properties: { unit: { type: 'object', description: 'unit spec' } }, required: ['unit'] }, run: (a) => api.charSheet(a.unit) },
  { name: 'sim_run', description: `Run ONE scenario and get the outcome (winner, time, per-unit damage / healing / casts) and optionally the combat log. Scenario: { units: [unit specs], rules: { maxTime, end: "team_dead|first_death|time|{unit_dead:id}", regen, freeSpells, talents, ai }, distance }. ${UNIT_SPEC}`,
    inputSchema: { type: 'object', properties: { scenario: { type: 'object' }, seed: { type: 'number' }, log: { type: 'boolean', description: 'include the combat log' }, logLimit: { type: 'number' } }, required: ['scenario'] }, run: (a) => api.run(a) },
  { name: 'sim_batch', description: 'Mass simulation on all CPU threads: runs `runs` seeded repetitions of every variation of a scenario and returns aggregated statistics (win rates, time-to-kill quantiles, damage, survival). Variations: `vary` = cartesian product over JSON paths ({"units.0.unit": ["sven","axe"], "units.0.items": [["desolator"],["greater_crit"]]}), `zip` = lists advanced together, or explicit `variations` [{label, set:{path:value}}]. Handles millions of scenarios (about 20-40k scenarios/s). Full results are saved to a JSON file; the reply shows the first `top` rows (sort: "winrate" | "time"). Set async:true for long jobs and poll sim_job.',
    inputSchema: { type: 'object', properties: { scenario: { type: 'object' }, runs: { type: 'number' }, seed: { type: 'number' }, vary: { type: 'object' }, zip: { type: 'object' }, variations: { type: 'array' }, workers: { type: 'number' }, top: { type: 'number' }, sort: { type: 'string' }, name: { type: 'string' }, async: { type: 'boolean' } }, required: ['scenario'] }, run: (a) => api.batch(a) },
  { name: 'sim_matrix', description: 'Every setup in `a` fights every setup in `b` (1v1), `runs` times each; returns the win-rate matrix for side a, mean fight time and a ranking. a / b: arrays of hero names or unit specs (optional `label`). `common` / `aCommon` / `bCommon`: fields merged into every unit (e.g. {"level": 20, "items": ["black_king_bar"]}).',
    inputSchema: { type: 'object', properties: { a: { type: 'array' }, b: { type: 'array' }, common: { type: 'object' }, aCommon: { type: 'object' }, bCommon: { type: 'object' }, rules: { type: 'object' }, distance: { type: 'number' }, runs: { type: 'number' }, seed: { type: 'number' }, workers: { type: 'number' }, name: { type: 'string' } }, required: ['a'] }, run: (a) => api.matrix(a) },
  { name: 'sim_job', description: 'Status / result of a background batch started with async:true. Without `job` lists all jobs.',
    inputSchema: { type: 'object', properties: { job: { type: 'string' }, top: { type: 'number' }, sort: { type: 'string' } } }, run: (a) => api.jobStatus(a) },
  { name: 'sandbox', description: 'Interactive sandbox session (hero-demo style). Send a list of commands; they run in order and the session persists between calls. Ops: {op:"new", seed, freeSpells, regen} | {op:"spawn", unit, team, level, items, id, pos, ai, count} (ai defaults to idle = training dummy) | {op:"give", id, item} | {op:"take", id, item} | {op:"set", id, level, hp, mana, talents, scepter, shard, invulnerable, pos, ai} | {op:"mod", id, name, duration} | {op:"rune", id, rune:"dd|haste|regen|arcane"} | {op:"order", id, type:"attack|move|cast|stop|hold", target, ability, pos} | {op:"step", seconds, until:{dead:id}} | {op:"state", id, verbose} | {op:"log", last, filter} | {op:"refresh", id} | {op:"free_spells", on} | {op:"results"} | {op:"remove", id} | {op:"close"}.',
    inputSchema: { type: 'object', properties: { session: { type: 'string' }, commands: { type: 'array', items: { type: 'object' } } }, required: ['commands'] }, run: (a) => api.sandbox(a) },
  { name: 'sim_coverage', description: 'How closely each hero ability, item and creep ability is modelled (full / approx / partial / n/a with a note). Pass `hero` for one hero in detail. Check this before trusting a result that depends on a particular ability.',
    inputSchema: { type: 'object', properties: { hero: { type: 'string' } } }, run: (a) => api.coverageReport(a) },
];

const MAX_TEXT = 90000;
const send = (obj) => process.stdout.write(JSON.stringify(obj) + '\n');
const KNOWN = ['2025-06-18', '2025-03-26', '2024-11-05'];

async function handle(msg) {
  const { id, method, params } = msg;
  const reply = (result) => { if (id !== undefined && id !== null) send({ jsonrpc: '2.0', id, result }); };
  const fail = (code, message) => { if (id !== undefined && id !== null) send({ jsonrpc: '2.0', id, error: { code, message } }); };
  switch (method) {
    case 'initialize':
      return reply({ protocolVersion: KNOWN.includes(params && params.protocolVersion) ? params.protocolVersion : KNOWN[0], capabilities: { tools: {} }, serverInfo: { name: 'dota-sandbox', version: api.VERSION },
        instructions: 'Headless combat simulator built from the installed Dota 2 game data (numbers only). Start with sim_info. Every ability has a fidelity label (sim_coverage); results list "partiallyModelled" abilities - check them before drawing conclusions. Ability behaviour was checked against the live game (Hero Demo, client 6983): 72% of hero ability scenes and 88% of item scenes match exactly; see EVIDENCE.md for the rest.' });
    case 'ping': return reply({});
    case 'tools/list': return reply({ tools: TOOLS.map(({ name, description, inputSchema }) => ({ name, description, inputSchema })) });
    case 'resources/list': return reply({ resources: [] });
    case 'prompts/list': return reply({ prompts: [] });
    case 'tools/call': {
      const tool = TOOLS.find((t) => t.name === (params && params.name));
      if (!tool) return reply({ isError: true, content: [{ type: 'text', text: `unknown tool ${params && params.name}` }] });
      try {
        const res = await tool.run((params && params.arguments) || {});
        let text = JSON.stringify(res);
        if (text.length > MAX_TEXT) text = text.slice(0, MAX_TEXT) + `... [truncated ${text.length - MAX_TEXT} chars; narrow the request or read the result file]`;
        return reply({ content: [{ type: 'text', text }] });
      } catch (e) {
        return reply({ isError: true, content: [{ type: 'text', text: String(e && e.message ? e.message : e) }] });
      }
    }
    default:
      if (method && method.startsWith('notifications/')) return undefined;
      return fail(-32601, `method not found: ${method}`);
  }
}

export function startMcp() {
  const rl = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
  let pending = 0; let closed = false;
  const maybeExit = () => { if (closed && pending === 0) api.shutdown().then(() => process.exit(0)); };
  rl.on('line', (line) => {
    const s = line.trim();
    if (!s) return;
    let msg;
    try { msg = JSON.parse(s); } catch { send({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'parse error' } }); return; }
    pending++;
    handle(msg).catch((e) => process.stderr.write(`mcp error: ${e && e.stack ? e.stack : e}\n`)).finally(() => { pending--; maybeExit(); });
  });
  rl.on('close', () => { closed = true; maybeExit(); });
}
