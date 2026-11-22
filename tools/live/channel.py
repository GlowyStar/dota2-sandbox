"""Command channel to a running Dota 2 Hero Demo, built only from supported pieces.

How it works
  - the game runs the probe script  game/dota/scripts/vscripts/simlab_probe.lua  (loaded once per demo session with the console
    command `script_reload_code simlab_probe`)
  - the probe polls  cfg/simlab_q<N>.cfg ; a batch file runs `script_reload_code simlab_job` (a Lua job written by this module)
    and then `sl_done <N>`, so every batch runs exactly once
  - everything the probe prints starts with "SL|" and goes to console.log (the game's own -condebug log), which is read back here

Nothing is injected into the game process and its memory is never read. Files written into the game folder:
  game/dota/scripts/vscripts/simlab_probe.lua, simlab_job.lua and game/dota/cfg/simlab_q*.cfg   (all removed by `cleanup`).

    python tools/live/channel.py launch            start the game through Steam with console logging
    python tools/live/channel.py lua "SimLab.out('hi')"     run a Lua line in the demo, print the probe's output
    python tools/live/channel.py cleanup           remove every simlab file from the game folder
"""
import glob
import json
import os
import shutil
import subprocess
import sys
import time

GAME = r"C:\Program Files (x86)\Steam\steamapps\common\dota 2 beta\game\dota"
CFG = os.path.join(GAME, "cfg")
VSCRIPTS = os.path.join(GAME, "scripts", "vscripts")
LOG = os.path.join(GAME, "console.log")
STEAM = r"C:\Program Files (x86)\Steam\steam.exe"
HERE = os.path.dirname(os.path.abspath(__file__))
STATE = os.path.join(HERE, ".channel_state.json")
PROBE_SRC = os.path.join(HERE, "simlab_probe.lua")


def _load():
    try:
        with open(STATE, encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        return {"next": 1}


def _save(st):
    with open(STATE, "w", encoding="utf-8") as f:
        json.dump(st, f)


def _write(path, text):
    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8", newline="\n") as f:
        f.write(text)
    os.replace(tmp, path)


LIBS = ["simlab_probe", "simlab_scene"]


def install_probe():
    """Copy the probe libraries next to the game's scripts (source of truth: tools/live/simlab_*.lua)."""
    for lib in LIBS:
        shutil.copyfile(os.path.join(HERE, lib + ".lua"), os.path.join(VSCRIPTS, lib + ".lua"))


def reload_probe():
    """Copy the libraries and make the running demo load them again (the probe must already be running)."""
    install_probe()
    lines = run_job("\n".join(f"SendToServerConsole('script_reload_code {lib}')" for lib in LIBS))
    time.sleep(0.6)
    return lines


def cleanup():
    for f in glob.glob(os.path.join(CFG, "simlab_*")) + glob.glob(os.path.join(VSCRIPTS, "simlab_*")):
        os.remove(f)
    if os.path.exists(STATE):
        os.remove(STATE)


def running():
    out = subprocess.run(["tasklist", "/FI", "IMAGENAME eq dota2.exe", "/NH"], capture_output=True, text=True, errors="ignore").stdout
    return "dota2.exe" in out


def launch(extra=()):
    if running():
        raise SystemExit("dota2.exe is already running: not touching it")
    for f in glob.glob(os.path.join(CFG, "simlab_q*.cfg")):
        os.remove(f)
    _save({"next": 1})
    subprocess.Popen([STEAM, "-applaunch", "570", "-novid", "-console", "-condebug", *extra])


def log_size():
    try:
        return os.path.getsize(LOG)
    except OSError:
        return 0


def read_log(offset):
    try:
        with open(LOG, "rb") as f:
            f.seek(offset)
            data = f.read()
    except OSError:
        return "", offset
    return data.decode("utf-8", "replace"), offset + len(data)


def probe_lines(text):
    """Payloads of the probe's lines ("SL|...") in a piece of log text."""
    out = []
    for line in text.splitlines():
        i = line.find("SL|")
        if i >= 0:
            out.append(line[i + 3:])
    return out


def resync(wait=20.0):
    """Bring the batch counter of this module and the probe's counter in the game back together (after a job was cut short).
    Every batch number near the last known one gets a file that jumps the probe's counter to a fresh number."""
    with _Lock():
        st = _load()
        n = st["next"]
        target = n + 200
        off = log_size()
        names = []
        for old in glob.glob(os.path.join(CFG, "simlab_q*.cfg")):
            os.remove(old)
        for k in range(max(1, n - 60), n + 60):
            path = os.path.join(CFG, f"simlab_q{k}.cfg")
            _write(path, "sl_done " + str(target) + chr(10))
            names.append(path)
        ok = False
        t0 = time.time()
        text = ""
        while time.time() - t0 < wait:
            chunk, off = read_log(off)
            text += chunk
            if f"SL|DONE {target}" in text:
                ok = True
                break
            time.sleep(0.05)
        for path in names:
            if os.path.exists(path):
                os.remove(path)
        if ok:
            _save({"next": target + 1})
        return ok


def reset_sequence(n=1):
    """Call after the probe was loaded in a fresh demo session (its counter starts at 1 again)."""
    for f in glob.glob(os.path.join(CFG, "simlab_q*.cfg")):
        os.remove(f)
    _save({"next": n})


LOCK = os.path.join(HERE, ".channel.lock")


class _Lock:
    """One job at a time across processes: the game has a single job slot."""

    def __enter__(self):
        t0 = time.time()
        while True:
            try:
                self.fd = os.open(LOCK, os.O_CREAT | os.O_EXCL | os.O_WRONLY)
                os.write(self.fd, str(os.getpid()).encode())
                return self
            except (FileExistsError, PermissionError):
                # (Windows reports a file that is being deleted by another process as 'permission denied')
                # a lock left behind by a process that died is taken over after two minutes
                try:
                    if time.time() - os.path.getmtime(LOCK) > 120:
                        os.remove(LOCK)
                        continue
                except OSError:
                    pass
                if time.time() - t0 > 600:
                    raise TimeoutError("could not get the channel lock")
                time.sleep(0.05)

    def __exit__(self, *exc):
        os.close(self.fd)
        try:
            os.remove(LOCK)
        except OSError:
            pass


def run_job(lua, until=None, wait=30.0):
    """Run Lua code inside the demo's server VM. Returns the probe lines printed from the start of the job to the batch
    marker, or to a line starting with `until` (for jobs that keep working on timers and print an end line later)."""
    with _Lock():
        return _run_job(lua, until, wait)


def _run_job(lua, until=None, wait=30.0):
    st = _load()
    n = st["next"]
    off = log_size()
    _write(os.path.join(VSCRIPTS, "simlab_job.lua"), "local SL = SimLab\nSL.try('job', function()\n" + lua + "\nend)\n")
    _write(os.path.join(CFG, f"simlab_q{n}.cfg"), f"script_reload_code simlab_job\nsl_done {n}\n")
    st["next"] = n + 1
    _save(st)
    done = f"DONE {n}"
    lines = []
    seen_done = False
    buf = ""
    t0 = time.time()
    while time.time() - t0 < wait:
        chunk, off = read_log(off)
        if chunk:
            buf += chunk
            cut = buf.rfind("\n")
            if cut >= 0:
                new = probe_lines(buf[:cut + 1])
                buf = buf[cut + 1:]
                for ln in new:
                    if ln == done:
                        seen_done = True
                        old = os.path.join(CFG, f"simlab_q{n}.cfg")
                        if os.path.exists(old):
                            os.remove(old)
                        continue
                    lines.append(ln)
                    if until and ln.startswith(until):
                        return lines
                if seen_done and not until:
                    return lines
        time.sleep(0.03)
    raise TimeoutError(f"job {n}: no {'end line ' + until if until else 'batch marker'} within {wait} s; got {len(lines)} lines: {lines[-3:]}")


def records(lines):
    """Reassemble SL.record() output: {id: object}."""
    parts = {}
    for ln in lines:
        if not ln.startswith("R "):
            continue
        _, rid, i, n, text = ln.split(" ", 4)
        parts.setdefault(rid, {})[int(i)] = text
        parts[rid]["_n"] = int(n)
    out = {}
    for rid, p in parts.items():
        n = p.pop("_n")
        if len(p) == n:
            out[rid] = json.loads("".join(p[i] for i in range(1, n + 1)))
    return out


if __name__ == "__main__":
    cmd = sys.argv[1] if len(sys.argv) > 1 else "help"
    if cmd == "launch":
        launch(sys.argv[2:]); print("launch requested")
    elif cmd == "install":
        install_probe(); print("probe copied to", VSCRIPTS)
    elif cmd == "reset":
        reset_sequence(); print("sequence reset")
    elif cmd == "lua":
        for ln in run_job("\n".join(sys.argv[2:])):
            print(ln)
    elif cmd == "resync":
        print("resynced" if resync() else "FAILED: the probe did not answer (is the demo running with the probe loaded?)")
    elif cmd == "reload":
        reload_probe(); print("libraries reloaded")
    elif cmd == "job":
        # python channel.py job <file.lua> [end marker] [wait seconds]
        with open(sys.argv[2], encoding="utf-8") as f:
            code = f.read()
        until = sys.argv[3] if len(sys.argv) > 3 else None
        lines = run_job(code, until=until, wait=float(sys.argv[4]) if len(sys.argv) > 4 else 60)
        recs = records(lines)
        for ln in lines:
            if not ln.startswith("R "):
                print(ln)
        for rid, rec in recs.items():
            print("RECORD", rid, json.dumps(rec))
    elif cmd == "cleanup":
        cleanup(); print("removed")
    elif cmd == "running":
        print(running())
    else:
        print(__doc__)
