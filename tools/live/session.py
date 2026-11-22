"""Bring up a Hero Demo session with the probe loaded (or check that one is running).

    python tools/live/session.py ensure       start the game if needed, enter Hero Demo, load the probe
    python tools/live/session.py status       is the probe answering?
    python tools/live/session.py quit         close the game window

Starting needs the Dota 2 window in the foreground for a few seconds: the console is opened with the backslash key and two
commands are typed (dota_demo_hero ..., script_reload_code ...). Nothing else is ever typed or clicked.
"""
import os
import subprocess
import sys
import time

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import channel as ch

KEYS = os.path.join(HERE, "keys.ps1")
DEMO_HERO = "npc_dota_hero_axe"
POPUP_X = (0.6896, 0.3148)        # the close button of the dashboard popup, as a fraction of the screen
CONSOLE_INPUT = (0.2708, 0.7481)  # the input line of the console panel
BACKSLASH = "0xDC"                # the console key


def keys(*steps):
    r = subprocess.run(["powershell", "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", KEYS, *[str(s) for s in steps]], capture_output=True, text=True)
    return (r.stdout or "").strip()


def wait_log(needles, offset, timeout):
    """Wait until one of the strings shows up in console.log after `offset`; returns (found string or None, new offset)."""
    t0 = time.time()
    text = ""
    while time.time() - t0 < timeout:
        chunk, offset = ch.read_log(offset)
        text += chunk
        for n in needles:
            if n in text:
                return n, offset
        time.sleep(0.25)
    return None, offset


def probe_alive(timeout=6):
    try:
        ch.run_job("SL.out('PING')", wait=timeout)
        return True
    except Exception:
        return False


def focus_ok():
    return keys("sleep", 10) == "ok"


def console_cmd(cmd, expect, timeout=6.0, tries=4):
    """Type a command into the game console and wait for the line it must produce in console.log.
    Whether the console is open is not known: the command is typed as is; when nothing happens the console key is pressed
    once (which opens a closed console) and the command is typed again. After a success the console is open."""
    for attempt in range(tries):
        off = ch.log_size()
        keys("clickf", CONSOLE_INPUT[0], CONSOLE_INPUT[1], "sleep", 350, "type", cmd, "sleep", 250, "key", "0x0D")
        found, _ = wait_log([expect], off, timeout)
        if found:
            return True
        keys("key", BACKSLASH, "sleep", 900)
    return False


def in_demo():
    text, _ = ch.read_log(max(0, ch.log_size() - 400000))
    tail = text.split("Hero Demo game mode loaded")
    return len(tail) > 1 and "DOTA_GAMERULES_STATE_GAME_IN_PROGRESS" in tail[-1] and "Disconnect" not in tail[-1]


def ensure():
    if ch.running() and probe_alive():
        return "probe already running"
    if ch.running() and ch.resync(wait=8):
        return "probe resynced"
    if not ch.running():
        ch.launch()
        wait_log(["k_EMsgGCMatchmakingStatsResponse", "Connected to GC"], 0, 150)
        time.sleep(12)   # the dashboard and its start-up popup need a moment
    # the window must be in the foreground for the typed commands
    t0 = time.time()
    while not focus_ok():
        if time.time() - t0 > 60:
            return "FAILED: the Dota 2 window is not in the foreground"
        time.sleep(1)
    if not in_demo():
        # close the start-up popup (its X); then the demo command
        keys("clickf", POPUP_X[0], POPUP_X[1], "sleep", 600)
        if not console_cmd(f"dota_demo_hero {DEMO_HERO}", "addons (hero_demo)", timeout=10):
            return "FAILED: Hero Demo did not start"
        off = ch.log_size()
        found, off = wait_log(["spawnedUnit is player's hero"], max(0, off - 20000), 150)
        if not found:
            return "FAILED: the demo hero did not appear"
        time.sleep(4)
    ch.install_probe()
    ch.reset_sequence()
    if not console_cmd("script_reload_code simlab_probe", "SL|", timeout=5):
        return "FAILED: the probe did not load"
    if not console_cmd("script_reload_code simlab_scene", "SL|SCENE_LOADED", timeout=5):
        return "FAILED: the scene recorder did not load"
    keys("key", BACKSLASH, "sleep", 300)   # close the console
    return "demo started and probe loaded" if probe_alive(10) else "FAILED: the probe does not answer"


def quit_game():
    if not ch.running():
        return "not running"
    r = subprocess.run(["powershell", "-NoProfile", "-Command",
                        "$p = Get-Process dota2 -ErrorAction SilentlyContinue; if ($p) { [void]$p.CloseMainWindow(); if ($p.WaitForExit(30000)) { 'closed' } else { 'still running' } }"],
                       capture_output=True, text=True)
    return (r.stdout or "").strip()


if __name__ == "__main__":
    cmd = sys.argv[1] if len(sys.argv) > 1 else "status"
    if cmd == "ensure":
        print(ensure())
    elif cmd == "status":
        print("game running:", ch.running(), "| probe answering:", probe_alive() if ch.running() else False)
    elif cmd == "quit":
        print(quit_game())
    else:
        print(__doc__)
