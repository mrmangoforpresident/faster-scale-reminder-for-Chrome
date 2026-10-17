"""Download the behavior list used by fasterscaleapp.com.

The Unofficial Faster Scale App (https://github.com/CorWatts/fasterscale,
BSD-3-Clause) keeps its check-in options in common/models/Behavior.php.
This fetches that file (pinned to the revision the site runs), extracts the
behaviors, and writes them to <data>/behaviors.json for the check-in page.

Run directly to refresh:  python import_fsa.py [data_dir]
"""

import json
import os
import re
import sys
import urllib.request

FSA_REV = "4da2beff09f67dfe82ed964e0908152665bde8a3"
FSA_URL = f"https://raw.githubusercontent.com/CorWatts/fasterscale/{FSA_REV}/common/models/Behavior.php"

# FSA category ids 1..7 -> our stage keys
CATEGORY_KEYS = {1: "R", 2: "F", 3: "A", 4: "S", 5: "T", 6: "E", 7: "X"}

_ROW = re.compile(
    r"\[\s*'id'\s*=>\s*(\d+)\s*,\s*'name'\s*=>\s*'((?:[^'\\]|\\.)*)'\s*,\s*'category_id'\s*=>\s*(\d+)\s*\]"
)


def parse(php_source):
    behaviors, seen = [], set()
    for bid, name, cat in _ROW.findall(php_source):
        cat = int(cat)
        if cat not in CATEGORY_KEYS or int(bid) in seen:  # doc comments repeat example rows
            continue
        seen.add(int(bid))
        name = name.replace("\\'", "'").replace("\\\\", "\\").strip()
        behaviors.append({"id": int(bid), "stage": CATEGORY_KEYS[cat], "name": name})
    return behaviors


def fetch(timeout=15):
    req = urllib.request.Request(FSA_URL, headers={"User-Agent": "faster-checkin"})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return r.read().decode("utf-8")


def import_to(data_dir):
    behaviors = parse(fetch())
    stages = {b["stage"] for b in behaviors}
    if len(behaviors) < 50 or stages != set(CATEGORY_KEYS.values()):
        raise ValueError(f"unexpected Behavior.php contents ({len(behaviors)} behaviors, stages {sorted(stages)})")
    os.makedirs(data_dir, exist_ok=True)
    path = os.path.join(data_dir, "behaviors.json")
    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump({"source": "fasterscaleapp.com", "revision": FSA_REV, "url": FSA_URL, "behaviors": behaviors},
                  f, indent=1, ensure_ascii=False)
    os.replace(tmp, path)
    return len(behaviors)


if __name__ == "__main__":
    target = sys.argv[1] if len(sys.argv) > 1 else os.path.join(
        os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "data")
    print(f"imported {import_to(target)} behaviors into {target}")
