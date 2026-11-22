"""Record every scene directory in the live game, restarting the Hero Demo session when the client goes down.

    python tools/live/record_all.py [dir ...]        (default: specs/auto, specs/items, specs/units)

A scene during which the client went down is added to out/crashers.txt by run_specs.py and skipped from then on.
The run gives up after MAX_RESTARTS restarts: something is wrong then, and the client should not be hammered.
"""
import os
import subprocess
import sys
import time

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import channel as ch
import session

MAX_RESTARTS = 4


def main():
    dirs = sys.argv[1:] or [os.path.join(HERE, "specs", d) for d in ("auto", "items", "units")]
    restarts = 0
    for d in dirs:
        while True:
            print(f"== {os.path.basename(d)}", flush=True)
            subprocess.run([sys.executable, os.path.join(HERE, "run_specs.py"), "--dir", d])
            if ch.running() and session.probe_alive(15):
                break
            restarts += 1
            if restarts > MAX_RESTARTS:
                print("giving up: too many restarts", flush=True)
                return
            print(f"client down; restart {restarts}", flush=True)
            time.sleep(8)
            for attempt in range(3):
                res = session.ensure()
                print("  ", res, flush=True)
                if not res.startswith("FAILED"):
                    break
                time.sleep(10)
            else:
                print("giving up: the demo session could not be started", flush=True)
                return
    print("all directories done", flush=True)


if __name__ == "__main__":
    main()
