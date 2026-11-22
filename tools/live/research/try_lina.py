import sys, json, time
sys.path.insert(0, '.')
import channel as ch
t0=time.time()
lines = ch.run_job("SL.heroValues('npc_dota_hero_lina')", until="VALUES_DONE", wait=40)
recs = ch.records(lines)
print('lines', len(lines), 'records', list(recs), 'sec', round(time.time()-t0,2))
print('errors', [l for l in lines if l.startswith('ERROR')][:3])
if recs:
    a = recs.get('V.npc_dota_hero_lina.A')
    print(json.dumps(a['stats']))
    ab = a['abilities']['lina_dragon_slave']
    print('dragon_slave max', ab['max'], json.dumps(ab['lv'][0])[:600])
    c = recs.get('V.npc_dota_hero_lina.C')['abilities']['lina_dragon_slave']['lv']
    print('with talents L4', json.dumps(c[3])[:500])
    print('abilities:', list(a['abilities']))
