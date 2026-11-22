import sys, json, time, os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import channel as ch, scene
here = os.path.dirname(os.path.abspath(__file__))
spec = json.load(open(os.path.join(here, 'specs', 'lina_ds.json')))
base = json.load(open(os.path.join(here, 'out', 'scenes', 'lina_ds.live.json')))
pick = lambda r: [(e['t'], e['k'], e.get('v'), e.get('ab')) for e in r['ev'] if e['k'] in ('df', 'a', 'order')]
for ts in sys.argv[1:]:
    ch.run_job(f"SendToServerConsole('host_timescale {ts}')")
    time.sleep(0.5)
    t0 = time.time()
    rec = scene.run_live(spec)
    print('timescale', ts, 'real seconds', round(time.time() - t0, 2), 'same as 1x:', pick(base) == pick(rec))
