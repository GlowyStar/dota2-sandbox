import sys, json, time, os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import channel as ch
name = sys.argv[1] if len(sys.argv) > 1 else 'npc_dota_hero_nevermore'
t0 = time.time()
lines = ch.run_job(f"SL.heroStatic('{name}', 1.0)", until="STATIC_DONE", wait=60)
print('sec', round(time.time() - t0, 2), 'errors', [l for l in lines if l.startswith('ERROR')][:3])
rec = ch.records(lines).get('S.' + name)
if rec:
    print('fresh1', json.dumps({k: v for k, v in rec['fresh1'].items() if v}))
    print('fresh30', json.dumps({k: v for k, v in rec['fresh30'].items() if v}))
    print('links', json.dumps(rec['links'])[:900])
    print('stats L1', json.dumps(rec['stats'][0])[:400])
    print('meta sample', json.dumps(list(rec['meta'].items())[0])[:300])
