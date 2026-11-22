"""Print the raw KV definition of an ability from the dumped game files (optionally only lines matching a pattern).

    python tools/live/rawkv.py lich_frost_shield [regex]
"""
import glob
import os
import re
import sys

# the dumped scripts/npc folder of the game: Dota2_data next to this project by default, or set DOTA2_RAW_NPC
RAW = os.environ.get("DOTA2_RAW_NPC") or os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "..",
                                                       "Dota2_data", "raw", "game_files", "scripts", "npc")


def find(name):
    files = glob.glob(os.path.join(RAW, "heroes", "*.txt")) + [os.path.join(RAW, "npc_abilities.txt"), os.path.join(RAW, "items.txt")]
    pat = re.compile(r'^\s*"' + re.escape(name) + r'"\s*$')
    for f in files:
        with open(f, encoding="utf-8", errors="replace") as fh:
            lines = fh.read().splitlines()
        for i, ln in enumerate(lines):
            if pat.match(ln) and i + 1 < len(lines) and lines[i + 1].strip() == "{":
                depth = 0
                out = []
                for ln2 in lines[i + 1:]:
                    s = ln2.strip()
                    if s.startswith("//") or not s:
                        continue
                    out.append(ln2)
                    depth += s.count("{") - s.count("}")
                    if depth == 0:
                        break
                return out
    return None


if __name__ == "__main__":
    block = find(sys.argv[1])
    if block is None:
        print("not found")
        sys.exit(1)
    rx = re.compile(sys.argv[2], re.I) if len(sys.argv) > 2 else None
    for i, ln in enumerate(block):
        if rx is None:
            print(ln.replace("\t", "  ")[:170])
        elif rx.search(ln):
            for l2 in block[max(0, i - 1):i + 6]:
                print(l2.replace("\t", "  ")[:170])
            print("  --")
