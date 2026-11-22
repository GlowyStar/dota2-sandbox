"""Run scene specs in the live game and store the recordings (tools/live/out/scenes/<id>.live.json).

    python tools/live/run_specs.py [--dir tools/live/specs/auto] [--hero lina] [--only id1,id2] [--redo] [--timescale 10]

A recording is reused when the spec has not changed since it was made (a hash of the spec is stored inside it); --redo forces a new run.
"""
import hashlib
import json
import os
import sys
import time

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import channel as ch
import scene

OUT = os.path.join(HERE, "out", "scenes")
CRASHERS = os.path.join(HERE, "out", "crashers.txt")   # scenes during which the game went down (skipped afterwards)


def spec_hash(spec):
    return hashlib.sha1(json.dumps(spec, sort_keys=True).encode()).hexdigest()[:16]


def arg(name, default=None):
    return sys.argv[sys.argv.index(name) + 1] if name in sys.argv else default


QUEUE = os.path.join(HERE, "queue")
# 3: abilities and talents learned through UpgradeAbility, talent charges refreshed after 0.1 s; 4: match clock stored
RECORDER = 4
LATER = os.path.join(HERE, "out", "later.txt")   # scenes kept for the end of a session (they have crashed the client before)
_broker_misses = 0


def uses_talents(spec):
    return any(u.get("talents") for u in spec.get("units", []))


def yield_to_broker(maxwait=25.0):
    """The batch and the broker share one game. A plain pause does not hand the channel over reliably, so after every
    scene the batch waits until the broker has served one of the requests that are waiting (or until it is clear that
    nobody is serving them)."""
    global _broker_misses
    time.sleep(0.1)
    if _broker_misses >= 2:
        return
    try:
        pending = {f for f in os.listdir(QUEUE) if f.endswith(".spec.json")}
    except OSError:
        return
    if not pending:
        return
    t0 = time.time()
    while time.time() - t0 < maxwait:
        now = {f for f in os.listdir(QUEUE) if f.endswith(".spec.json")}
        if not pending <= now:
            _broker_misses = 0
            return
        time.sleep(0.05)
    _broker_misses += 1


def main():
    d = arg("--dir", os.path.join(HERE, "specs", "auto"))
    hero = arg("--hero")
    only = set(arg("--only", "").split(",")) - {""}
    redo = "--redo" in sys.argv
    match = arg("--match")
    os.makedirs(OUT, exist_ok=True)
    files = sorted(f for f in os.listdir(d) if f.endswith(".json"))
    crashers = set()
    if os.path.exists(CRASHERS):
        with open(CRASHERS, encoding="utf-8") as fh:
            crashers = {x.strip() for x in fh if x.strip()}
    later = set()
    if os.path.exists(LATER):
        with open(LATER, encoding="utf-8") as fh:
            later = {x.strip() for x in fh if x.strip()}
    todo = []
    for f in files:
        with open(os.path.join(d, f), encoding="utf-8") as fh:
            spec = json.load(fh)
        if hero and spec.get("hero") != hero:
            continue
        if only and spec["id"] not in only:
            continue
        if match and match not in spec["id"]:
            continue
        if spec["id"] in crashers and not only:
            continue
        if spec["id"] in later and not only and "--later" not in sys.argv:
            continue
        dst = os.path.join(OUT, spec["id"] + ".live.json")
        h = spec_hash(spec)
        if not redo and os.path.exists(dst):
            try:
                with open(dst, encoding="utf-8") as fh:
                    old = json.load(fh)
                    # recordings made before talents were learned through the upgrade path are stale
                    if old.get("spec") == h and old.get("recorder") == RECORDER:
                        continue
            except Exception:
                pass
        todo.append((spec, dst, h))
    print(f"{len(todo)} scene(s) to record ({len(files)} specs in {d})", flush=True)
    if not todo:
        return
    ch.run_job(f"SendToServerConsole('host_timescale {arg('--timescale', '10')}')")
    time.sleep(0.4)
    t0 = time.time()
    failed = []
    for i, (spec, dst, h) in enumerate(todo):
        try:
            rec = scene.run_live(spec)
            rec["spec"] = h
            rec["recorder"] = RECORDER
            tmp = dst + ".tmp"
            with open(tmp, "w", encoding="utf-8") as fh:
                json.dump(rec, fh)
            os.replace(tmp, dst)
        except Exception as e:  # keep going: one broken scene must not stop the batch
            failed.append((spec["id"], str(e)[:160]))
            if not ch.running():
                # the game went down during this scene: remember it so that the next run skips it, and stop
                with open(CRASHERS, "a", encoding="utf-8") as fh:
                    fh.write(spec["id"] + chr(10))
                print(f"GAME NOT RUNNING after scene {spec['id']} (added to {os.path.basename(CRASHERS)}); stopping", flush=True)
                break
            try:
                ch.run_job("SL.sceneEnd()", wait=10)
            except Exception:
                pass
        yield_to_broker()  # let the broker serve one waiting request before the next scene
        if (i + 1) % 25 == 0:
            print(f"{i + 1}/{len(todo)}  {time.time() - t0:.0f} s  failed {len(failed)}", flush=True)
    print(f"done: {len(todo) - len(failed)} recorded, {len(failed)} failed, {time.time() - t0:.0f} s")
    for i, e in failed[:30]:
        print("  FAILED", i, e)


if __name__ == "__main__":
    main()
