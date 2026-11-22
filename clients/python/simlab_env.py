"""Python client for the simlab environment server (reset / step / observe).

No third-party dependencies. The server is the Node process `node src/cli.mjs env`, spoken to over JSON lines.

    from simlab_env import SimlabEnv
    env = SimlabEnv()
    out = env.reset(scenario, seed=1, dt=0.2)            # {"obs": {...}, "info": {...}}
    out = env.step([{"unit": "a", "type": "attack", "target": "b"}])
    # out["obs"], out["reward"] (per team), out["done"], out["winner"], out["info"]
    env.close()
"""
import json
import os
import subprocess

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))


class SimlabError(RuntimeError):
    pass


class SimlabEnv:
    """One server process; it can host many independent environments (see `make`)."""

    def __init__(self, node="node", root=ROOT, scripts=None):
        env = dict(os.environ)
        if scripts is not None:
            env["SIMLAB_SCRIPTS"] = scripts
        self.proc = subprocess.Popen(
            [node, os.path.join(root, "src", "cli.mjs"), "env"],
            stdin=subprocess.PIPE, stdout=subprocess.PIPE, text=True, encoding="utf-8", bufsize=1, env=env)
        self._next = 0

    def _call(self, msg):
        self._next += 1
        msg["id"] = self._next
        self.proc.stdin.write(json.dumps(msg) + "\n")
        self.proc.stdin.flush()
        line = self.proc.stdout.readline()
        if not line:
            raise SimlabError("environment server exited")
        res = json.loads(line)
        if "error" in res:
            raise SimlabError(res["error"])
        return res

    def make(self, n=1):
        """Create n more environments inside the server; returns their ids."""
        return self._call({"cmd": "make", "n": n})["ids"]

    def reset(self, scenario=None, seed=1, env=0, dt=None, events=False, vector=None, reward=None, control=None):
        msg = {"cmd": "reset", "env": env, "seed": seed, "events": events}
        if scenario is not None:
            msg["scenario"] = scenario
        if dt is not None:
            msg["dt"] = dt
        if vector is not None:
            msg["vector"] = vector          # True or {"maxUnits": 10, "maxAbilities": 8, "maxItems": 7}
        if reward is not None:
            msg["reward"] = reward          # {"damage": 0.001, "kill": 1, "win": 5}
        if control is not None:
            msg["control"] = control        # unit ids to control in addition to units with ai "external"
        return self._call(msg)

    def step(self, actions=(), env=0):
        return self._call({"cmd": "step", "env": env, "actions": list(actions)})

    def step_many(self, envs, actions):
        """Step several environments with one round trip. actions[i] is the action list for envs[i]."""
        return self._call({"cmd": "step_many", "envs": list(envs), "actions": [list(a) for a in actions]})["results"]

    def observe(self, env=0):
        return self._call({"cmd": "observe", "env": env})

    def spec(self):
        return self._call({"cmd": "spec"})

    def close(self):
        try:
            self.proc.stdin.write(json.dumps({"cmd": "close"}) + "\n")
            self.proc.stdin.flush()
        except Exception:
            pass
        try:
            self.proc.wait(timeout=5)
        except Exception:
            self.proc.kill()

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        self.close()


if __name__ == "__main__":
    import random
    import time

    scenario = {
        "units": [
            {"id": "me", "team": 0, "unit": "juggernaut", "level": 15, "items": ["bfury", "power_treads"], "ai": "external"},
            {"id": "foe", "team": 1, "unit": "sven", "level": 15, "items": ["echo_sabre"], "ai": "fight"},
        ],
        "rules": {"maxTime": 60},
    }
    with SimlabEnv() as sim:
        out = sim.reset(scenario, seed=7, vector=True)
        me = next(u for u in out["obs"]["units"] if u["id"] == "me")
        print("abilities:", [(a["name"], a["type"]) for a in me["abilities"]])
        print("vector length:", len(out["vec"]["vector"]), "per unit:", out["vec"]["perUnit"])
        total = [0.0, 0.0]
        steps = 0
        t0 = time.time()
        while True:
            me = next(u for u in out["obs"]["units"] if u["id"] == "me")
            ready = [a for a in me["abilities"] if a["ready"] and a["type"] != "passive"]
            if ready and random.random() < 0.5:
                a = random.choice(ready)
                act = {"unit": "me", "type": "cast", "ability": a["name"], "target": "foe"}
            else:
                act = {"unit": "me", "type": "attack", "target": "foe"}
            out = sim.step([act])
            steps += 1
            total = [total[i] + out["reward"][i] for i in range(2)]
            if out["done"]:
                break
        print(f"episode: {steps} steps, sim time {out['info']['time']}s, winner team {out['winner']}, return {total}, {steps / (time.time() - t0):.0f} steps/s")
