"""Run a scene spec in the live game (Hero Demo with the probe) and save the recorded timeline.

    python tools/live/scene.py <spec.json> [out.json]

Spec (the same file is given to tools/live/sim_scene.mjs for the simulator side):
  { "id": "lina_ds",
    "units": [ { "tag": "c", "name": "npc_dota_hero_lina", "team": 0, "x": 0, "y": 0, "level": 10,
                 "abilities": { "lina_dragon_slave": 4 }, "talents": "all" | ["special_bonus_..."], "scepter": false, "shard": false,
                 "items": ["item_blink"], "face": [400, 0] },
               { "tag": "t", "name": "npc_dota_hero_target_dummy", "team": 1, "x": 400, "y": 0 } ],
    "actions": [ { "t": 0.5, "unit": "c", "type": "cast", "ability": "lina_dragon_slave", "target": "t" } ],
    "duration": 5.0 }
"""
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import channel as ch


def lua_str(s):
    return "'" + str(s).replace("\\", "\\\\").replace("'", "\\'") + "'"


def lua_val(v):
    if isinstance(v, bool):
        return "true" if v else "false"
    if isinstance(v, (int, float)):
        return repr(v)
    if isinstance(v, str):
        return lua_str(v)
    if isinstance(v, (list, tuple)):
        return "{ " + ", ".join(lua_val(x) for x in v) + " }"
    if isinstance(v, dict):
        return "{ " + ", ".join(f"[{lua_str(k)}] = {lua_val(x)}" for k, x in v.items()) + " }"
    return "nil"


def to_lua(spec):
    out = [f"SL.sceneNew({lua_str(spec['id'])})"]
    for u in spec["units"]:
        o = {k: u[k] for k in ("level", "abilities", "talents", "scepter", "shard", "items", "face") if k in u and u[k] not in (None, False, [], {})}
        out.append(f"SL.sceneUnit({lua_str(u['tag'])}, {lua_str(u['name'])}, {int(u.get('team', 0))}, {u.get('x', 0)}, {u.get('y', 0)}, {lua_val(o)})")
    acts = []
    for a in spec.get("actions", []):
        o = {k: a[k] for k in ("type", "ability", "target", "pos", "toggle") if k in a and a[k] is not None}
        acts.append(f"  {{ {a['t']}, function() SL.sceneOrder({lua_str(a['unit'])}, {lua_val(o)}) end }},")
    out.append("SL.sceneGo({\n" + "\n".join(acts) + "\n}, " + repr(float(spec["duration"])) + ")")
    return "\n".join(out)


def run_live(spec, wait=None):
    lines = ch.run_job(to_lua(spec), until="SCENE_DONE", wait=wait or (float(spec["duration"]) * 1.5 + 25))
    rec = ch.records(lines).get("T." + spec["id"])
    notes = [l for l in lines if l.startswith(("ERROR", "WARN"))]
    if rec is None:
        raise RuntimeError("no record for scene " + spec["id"] + ": " + "; ".join(notes[:3]))
    if notes:
        rec["notes"] = notes
    return rec


if __name__ == "__main__":
    with open(sys.argv[1], encoding="utf-8") as f:
        spec = json.load(f)
    rec = run_live(spec)
    text = json.dumps(rec)
    if len(sys.argv) > 2:
        with open(sys.argv[2], "w", encoding="utf-8") as f:
            f.write(text)
        print("saved", sys.argv[2], len(rec["ev"]), "events")
    else:
        print(text)
