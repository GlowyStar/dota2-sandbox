"""Record a scene in the live game (through the broker, cached) and in the simulator, and show how they differ.

    python tools/live/verify.py <spec.json> [--events] [--unit t] [--from 0.4] [--to 6]

  --events   also print both timelines side by side (damage, modifiers, state / stat changes, casts)
  --unit     restrict the printed timelines to one unit tag
Exit code 0 when the simulator matches the game, 1 otherwise, 2 on errors.
"""
import json
import os
import subprocess
import sys
import time
import uuid

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", ".."))
QUEUE = os.path.join(HERE, "queue")


def ask(spec, timeout=600):
    """Live recording of a scene spec through the broker (tools/live/broker.py must be running unless the scene is cached)."""
    os.makedirs(QUEUE, exist_ok=True)
    name = uuid.uuid4().hex[:12]
    base = os.path.join(QUEUE, name)
    tmp = base + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(spec, f)
    os.replace(tmp, base + ".spec.json")
    t0 = time.time()
    while time.time() - t0 < timeout:
        if os.path.exists(base + ".live.json"):
            with open(base + ".live.json", encoding="utf-8") as f:
                rec = json.load(f)
            os.remove(base + ".live.json")
            return rec
        if os.path.exists(base + ".error.txt"):
            with open(base + ".error.txt", encoding="utf-8") as f:
                msg = f.read()
            os.remove(base + ".error.txt")
            raise RuntimeError("live recording failed: " + msg)
        time.sleep(0.05)
    try:
        os.remove(base + ".spec.json")   # nobody is waiting for it any more
    except OSError:
        pass
    raise TimeoutError("no answer from the broker within " + str(timeout) + " s (the queue is long or the game is restarting); ask again later")


def fmt(e):
    k = e["k"]
    if k == "df":
        return f"damage to {e['to']} {e['v']} ({e.get('ab') or 'attack'})"
    if k == "heal":
        return f"heal {e['to']} {e['v']} ({e.get('ab') or ''})"
    if k == "m+":
        return f"+{e['name']} on {e['u']} dur {e['dur']}" + (f" stacks {e['stacks']}" if e.get("stacks") else "")
    if k == "m-":
        return f"-{e['name']} on {e['u']} after {e['life']}"
    if k == "ms":
        return f"{e['name']} on {e['u']} stacks {e['stacks']}"
    if k == "s":
        d = {x: v for x, v in e["d"].items() if x not in ("hpRegen", "manaRegen")}
        return f"{e['u']}: " + ", ".join(f"{x}={v}" for x, v in d.items()) if d else None
    if k == "a":
        return f"{e['u']} {e['ab']}: cd {e['cd']} charges {e['charges']} toggle {e['toggle']} channel {e['channel']} phase {e['phase']}"
    if k == "order":
        return f"ORDER {e['u']} {e['type']} " + (f"{e['ab']} ready {e['ready']} mana cost {e['manaCost']} cd {e['cdFull']} cast point {e['castPoint']}" if e["type"] == "cast" else str(e.get("target", "")))
    if k == "order_failed":
        return f"ORDER FAILED {e['u']}: {e['why']}"
    return None


def show(title, rec, unit, t_from, t_to):
    print(f"--- {title}")
    first = True
    for e in rec["ev"]:
        if e["k"] in ("h", "dmg"):
            continue
        if not (t_from <= e["t"] <= t_to):
            continue
        if e["k"] == "s" and e["t"] < 0.1 and first is not None:
            pass
        if unit and unit not in (e.get("u"), e.get("to")):
            continue
        s = fmt(e)
        if s:
            print(f"  {e['t']:7.3f}  {s}"[:230])


def main():
    args = sys.argv[1:]
    if not args:
        print(__doc__)
        return 2
    opt = lambda k, d=None: args[args.index(k) + 1] if k in args else d
    with open(args[0], encoding="utf-8") as f:
        spec = json.load(f)
    try:
        live = ask(spec)
    except Exception as e:
        print("ERROR", e)
        return 2
    tmp_dir = os.path.join(HERE, "out", "tmp")
    os.makedirs(tmp_dir, exist_ok=True)
    tag = uuid.uuid4().hex[:8]
    lf = os.path.join(tmp_dir, tag + ".live.json")
    sf = os.path.join(tmp_dir, tag + ".sim.json")
    with open(lf, "w", encoding="utf-8") as f:
        json.dump(live, f)
    r = subprocess.run(["node", os.path.join(HERE, "sim_scene.mjs"), os.path.abspath(args[0]), sf], cwd=ROOT, capture_output=True, text=True)
    if r.returncode != 0:
        print("ERROR simulator:", (r.stderr or r.stdout)[-600:])
        return 2
    with open(sf, encoding="utf-8") as f:
        sim = json.load(f)
    c = subprocess.run(["node", os.path.join(HERE, "compare_scene.mjs"), lf, sf], cwd=ROOT, capture_output=True, text=True)
    print(c.stdout.rstrip())
    if live.get("notes"):
        print("live notes:", "; ".join(live["notes"])[:400])
    if "--events" in args:
        show("LIVE GAME", live, opt("--unit"), float(opt("--from", -1)), float(opt("--to", 1e9)))
        show("SIMULATOR", sim, opt("--unit"), float(opt("--from", -1)), float(opt("--to", 1e9)))
    for p in (lf, sf):
        try:
            os.remove(p)
        except OSError:
            pass
    return 0 if "MATCH" in c.stdout.splitlines()[0] else 1


if __name__ == "__main__":
    sys.exit(main())
