"""Serves scene requests against the running game, one at a time, so that several workers can share one Hero Demo.

    python tools/live/broker.py            (keep it running; stop with Ctrl+C or by creating tools/live/queue/STOP)

Workers drop a scene spec into tools/live/queue/<name>.spec.json (use tools/live/ask.py); the broker records the scene in
the live game and writes <name>.live.json (or <name>.error.txt). Recordings are cached by the content of the spec in
tools/live/out/cache, so asking again for the same scene costs nothing and works even when the game is closed.
Only scene specs are accepted: workers never send code to the game.
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

QUEUE = os.path.join(HERE, "queue")
CACHE = os.path.join(HERE, "out", "cache")
MAX_DURATION = 90.0
MAX_UNITS = 14


def spec_hash(spec):
    core = {k: spec[k] for k in ("units", "actions", "duration") if k in spec}
    core["recorder"] = 4   # keep in step with RECORDER in run_specs.py
    return hashlib.sha1(json.dumps(core, sort_keys=True).encode()).hexdigest()[:20]


def validate(spec):
    if not isinstance(spec.get("units"), list) or not spec["units"]:
        return "spec needs units"
    if len(spec["units"]) > MAX_UNITS:
        return f"at most {MAX_UNITS} units"
    if not (0 < float(spec.get("duration", 0)) <= MAX_DURATION):
        return f"duration must be within 0..{MAX_DURATION} s"
    for u in spec["units"]:
        for k in ("tag", "name"):
            if not isinstance(u.get(k), str) or not u[k].replace("_", "").isalnum():
                return f"bad unit {k}: {u.get(k)!r}"
    for a in spec.get("actions", []):
        if a.get("type") not in ("cast", "attack", "move", "stop", "hold"):
            return f"bad action type {a.get('type')!r}"
        for k in ("unit", "ability", "target"):
            if k in a and a[k] is not None and (not isinstance(a[k], str) or not a[k].replace("_", "").isalnum()):
                return f"bad action {k}: {a[k]!r}"
    return None


BLOCKED_FILE = os.path.join(HERE, "blocked.json")


def blocked(spec):
    """Scenes that have crashed the game client are refused (tools/live/blocked.json: unit names and ability prefixes)."""
    try:
        with open(BLOCKED_FILE, encoding="utf-8") as f:
            rules = json.load(f)
    except (OSError, ValueError):
        return None
    for u in spec.get("units", []):
        if u.get("name") in rules.get("units", []):
            return u["name"]
    for a in spec.get("actions", []):
        for pre in rules.get("abilityPrefixes", []):
            if isinstance(a.get("ability"), str) and a["ability"].startswith(pre):
                return a["ability"]
    return None


def cached(h):
    p = os.path.join(CACHE, h + ".json")
    if os.path.exists(p):
        with open(p, encoding="utf-8") as f:
            return f.read()
    return None


def serve_one(path):
    base = path[:-len(".spec.json")]
    try:
        with open(path, encoding="utf-8") as f:
            spec = json.load(f)
        err = validate(spec)
        if err:
            raise ValueError(err)
        h = spec_hash(spec)
        text = None if spec.get("fresh") else cached(h)
        if text is None:
            hit = blocked(spec)
            if hit:
                raise RuntimeError(f"scenes with {hit} are not recorded for now: they have crashed the game client. Work from the data and say so in your report")
            if not ch.running():
                raise RuntimeError("the game is restarting; ask again in a few minutes (this scene is not in the cache)")
            live_spec = dict(spec)
            live_spec["id"] = "q" + h[:10]
            rec = scene.run_live(live_spec)
            rec["id"] = spec.get("id", rec["id"])
            rec["spec"] = h
            text = json.dumps(rec)
            with open(os.path.join(CACHE, h + ".json"), "w", encoding="utf-8") as f:
                f.write(text)
        tmp = base + ".live.json.tmp"
        with open(tmp, "w", encoding="utf-8") as f:
            f.write(text)
        os.replace(tmp, base + ".live.json")
    except Exception as e:  # report to the worker, keep serving
        with open(base + ".error.txt", "w", encoding="utf-8") as f:
            f.write(str(e)[:500])
        try:
            ch.run_job("SL.sceneEnd()", wait=10)
        except Exception:
            pass
    finally:
        try:
            os.remove(path)
        except OSError:
            pass


def pending():
    """Waiting requests, oldest first. A request older than the worker's own timeout has nobody waiting for it and is
    dropped; so are answers that were never collected."""
    now = time.time()
    out = []
    for f in os.listdir(QUEUE):
        p = os.path.join(QUEUE, f)
        try:
            age = now - os.path.getmtime(p)
            if f.endswith(".spec.json"):
                if age > 600:
                    os.remove(p)
                else:
                    out.append((age, f))
            elif f.endswith((".live.json", ".error.txt", ".tmp")) and age > 900:
                os.remove(p)
        except OSError:
            pass
    return [f for _, f in sorted(out, reverse=True)]


def main():
    os.makedirs(QUEUE, exist_ok=True)
    os.makedirs(CACHE, exist_ok=True)
    stop = os.path.join(QUEUE, "STOP")
    if os.path.exists(stop):
        os.remove(stop)
    if ch.running():
        try:
            ch.run_job("SendToServerConsole('host_timescale 10')")
        except Exception as e:
            print("could not set the time scale:", e, flush=True)
    print("broker ready", flush=True)
    served = 0
    while not os.path.exists(stop):
        files = pending()
        if not files:
            time.sleep(0.1)
            continue
        serve_one(os.path.join(QUEUE, files[0]))
        served += 1
        if served % 50 == 0:
            print(f"served {served}", flush=True)
    print("broker stopped after", served, "requests", flush=True)


if __name__ == "__main__":
    main()
