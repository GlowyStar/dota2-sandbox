"""Collect the live game's resolved ability values and hero stats for every hero (needs a running Hero Demo with the probe).

    python tools/live/collect_values.py [hero ...]        -> tools/live/out/values_live.json

For each hero five fresh units are created: A level 1; B level 30; C level 30 + all talents; D level 30 + Scepter; E level 30 + Shard.
For each ability and each of its levels the game is asked for cooldown, mana cost, cast range, cast point and every AbilityValues
entry (`GetSpecialValueFor`), i.e. exactly the numbers the game itself uses.
"""
import json
import os
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import channel as ch

ROOT = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", ".."))
OUT = os.path.join(ROOT, "tools", "live", "out")


def heroes():
    with open(os.path.join(ROOT, "data", "gamedata.json"), encoding="utf-8") as f:
        d = json.load(f)
    return sorted(h["name"] for h in d["heroes"].values() if h.get("enabled"))


def main():
    os.makedirs(OUT, exist_ok=True)
    path = os.path.join(OUT, "values_live.json")
    result = {}
    if os.path.exists(path) and len(sys.argv) > 1:
        with open(path, encoding="utf-8") as f:
            result = json.load(f)
    names = [n if n.startswith("npc_dota_hero_") else "npc_dota_hero_" + n for n in sys.argv[1:]] or heroes()
    t0 = time.time()
    failed = []
    for i, name in enumerate(names):
        try:
            lines = ch.run_job(f"SL.heroValues('{name}')", until="VALUES_DONE", wait=60)
        except TimeoutError as e:
            failed.append((name, str(e)[:200]))
            continue
        errs = [l for l in lines if l.startswith("ERROR")]
        recs = ch.records(lines)
        if errs or len(recs) != 5:
            failed.append((name, (errs or ["incomplete"])[0][:200]))
        for rid, rec in recs.items():
            result[rid[2:]] = rec
        if (i + 1) % 10 == 0:
            print(f"{i + 1}/{len(names)} heroes, {time.time() - t0:.1f} s", flush=True)
    with open(path, "w", encoding="utf-8") as f:
        json.dump(result, f)
    print(f"saved {len(result)} records to {path} in {time.time() - t0:.1f} s; failed: {len(failed)}")
    for n, e in failed[:20]:
        print("  FAILED", n, e)


if __name__ == "__main__":
    main()
