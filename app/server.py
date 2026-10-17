"""FASTER Scale daily check-in service.

Runs in the background (pythonw), bound to 127.0.0.1 only.
  * Stores check-ins in a local SQLite database.
  * Serves the check-in form and the dashboards.
  * Watches for the first activity of each "logical day" (including after
    waking from sleep) and pops the check-in window until it's done.

Standard library only.
"""

import csv
import ctypes
import ctypes.wintypes as wt
import datetime as dt
import io
import json
import logging
import mimetypes
import os
import sqlite3
import subprocess
import sys
import threading
import time
import urllib.parse
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

PORT = int(os.environ.get("FASTER_PORT", "47321"))
HOST = "127.0.0.1"
ORIGIN = f"http://{HOST}:{PORT}"
ALLOWED_HOSTS = {f"{HOST}:{PORT}", f"localhost:{PORT}"}
ALLOWED_ORIGINS = {f"http://{h}" for h in ALLOWED_HOSTS}

APP_DIR = os.path.dirname(os.path.abspath(__file__))
WEB_DIR = os.path.join(APP_DIR, "web")
# Installed layout: <install>\app\server.py and <install>\data\faster.db
DATA_DIR = os.environ.get("FASTER_DATA_DIR", os.path.join(os.path.dirname(APP_DIR), "data"))
DB_PATH = os.path.join(DATA_DIR, "faster.db")
LOG_PATH = os.path.join(DATA_DIR, "faster.log")

STAGE_KEYS = ["R", "F", "A", "S", "T", "E", "X"]  # X = Relapse (second R)

DEFAULT_SETTINGS = {
    "dayStartHour": 4,          # a "day" starts at 4 AM, so 1 AM still counts as yesterday
    "popupEnabled": True,
    "keepOnTop": True,          # pin the check-in window above other windows until done
    "browser": "auto",          # auto | chrome | edge
    "idleThresholdSec": 120,    # only pop up when someone has touched the keyboard/mouse recently
    "repopCooldownSec": 90,     # if the window is closed without checking in, re-open after this long
    "hourlyEnabled": True,      # after the day's first check-in, pop up again every hourlyIntervalMin
    "hourlyIntervalMin": 60,
    "customIndicators": {k: [] for k in STAGE_KEYS},
}

os.makedirs(DATA_DIR, exist_ok=True)
logging.basicConfig(
    filename=LOG_PATH,
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(message)s",
)
log = logging.getLogger("faster")


# --------------------------------------------------------------------------- storage

_db_lock = threading.Lock()


def db():
    conn = sqlite3.connect(DB_PATH, timeout=10)
    conn.row_factory = sqlite3.Row
    return conn


def init_db():
    with _db_lock, db() as conn:
        conn.executescript(
            """
            CREATE TABLE IF NOT EXISTS checkins (
                id              INTEGER PRIMARY KEY AUTOINCREMENT,
                day             TEXT NOT NULL,          -- logical day, YYYY-MM-DD
                created_at      TEXT NOT NULL,          -- local ISO timestamp
                stage           INTEGER NOT NULL,       -- 0=Restoration .. 6=Relapse
                selections      TEXT NOT NULL,          -- JSON [{stage:'F', text:'...'}]
                wellbeing       INTEGER,                -- 1..10
                urges           INTEGER,                -- 0..10
                followthrough   TEXT,                   -- yes | partly | no | NULL
                affects_me      TEXT,
                affects_others  TEXT,
                payoff          TEXT,
                commitment      TEXT,
                connect_with    TEXT,
                gratitude       TEXT,
                notes           TEXT,
                answers         TEXT                    -- JSON [{stage, behavior, a, b, c}] (FSA questions)
            );
            CREATE INDEX IF NOT EXISTS idx_checkins_day ON checkins(day);
            CREATE TABLE IF NOT EXISTS settings (
                key   TEXT PRIMARY KEY,
                value TEXT NOT NULL
            );
            """
        )
        cols = {r["name"] for r in conn.execute("PRAGMA table_info(checkins)")}
        if "answers" not in cols:
            conn.execute("ALTER TABLE checkins ADD COLUMN answers TEXT")


# --------------------------------------------------------------------------- behavior list

BEHAVIORS_PATH = os.path.join(DATA_DIR, "behaviors.json")


def get_behaviors():
    """The fasterscaleapp.com behavior list, if it has been imported."""
    try:
        with open(BEHAVIORS_PATH, encoding="utf-8") as f:
            return json.load(f)
    except (OSError, ValueError):
        return {"source": "builtin", "behaviors": []}


def import_behaviors():
    import import_fsa
    n = import_fsa.import_to(DATA_DIR)
    log.info("imported %d behaviors from fasterscaleapp.com", n)
    return get_behaviors()


def ensure_behaviors():
    """Import the FSA list on first run; retry hourly until it succeeds (e.g. offline at install)."""
    while not os.path.exists(BEHAVIORS_PATH):
        try:
            import_behaviors()
        except Exception as e:
            log.warning("behavior import failed, using built-in list for now: %s", e)
            time.sleep(3600)


def get_settings():
    s = json.loads(json.dumps(DEFAULT_SETTINGS))
    with _db_lock, db() as conn:
        for row in conn.execute("SELECT key, value FROM settings"):
            try:
                s[row["key"]] = json.loads(row["value"])
            except ValueError:
                pass
    ci = s.get("customIndicators") or {}
    s["customIndicators"] = {k: [str(x) for x in ci.get(k, [])][:50] for k in STAGE_KEYS}
    return s


def save_settings(patch):
    current = get_settings()
    clean = {}
    if "dayStartHour" in patch:
        clean["dayStartHour"] = max(0, min(12, int(patch["dayStartHour"])))
    if "hourlyIntervalMin" in patch:
        clean["hourlyIntervalMin"] = max(15, min(480, int(patch["hourlyIntervalMin"])))
    for key in ("popupEnabled", "keepOnTop", "hourlyEnabled"):
        if key in patch:
            clean[key] = bool(patch[key])
    if "browser" in patch and patch["browser"] in ("auto", "chrome", "edge"):
        clean["browser"] = patch["browser"]
    if "idleThresholdSec" in patch:
        clean["idleThresholdSec"] = max(15, min(3600, int(patch["idleThresholdSec"])))
    if "repopCooldownSec" in patch:
        clean["repopCooldownSec"] = max(30, min(3600, int(patch["repopCooldownSec"])))
    if "customIndicators" in patch and isinstance(patch["customIndicators"], dict):
        ci = {}
        for k in STAGE_KEYS:
            items = patch["customIndicators"].get(k, [])
            ci[k] = [str(x).strip()[:200] for x in items if str(x).strip()][:50]
        clean["customIndicators"] = ci
    with _db_lock, db() as conn:
        for k, v in clean.items():
            conn.execute(
                "INSERT INTO settings(key, value) VALUES(?, ?) "
                "ON CONFLICT(key) DO UPDATE SET value = excluded.value",
                (k, json.dumps(v)),
            )
    current.update(clean)
    return current


def logical_day(now=None, day_start_hour=None):
    now = now or dt.datetime.now()
    if day_start_hour is None:
        day_start_hour = get_settings()["dayStartHour"]
    return (now - dt.timedelta(hours=day_start_hour)).date().isoformat()


def row_to_entry(row):
    e = dict(row)
    e["selections"] = json.loads(e["selections"] or "[]")
    e["answers"] = json.loads(e.get("answers") or "[]")
    return e


def list_entries(start=None, end=None):
    sql = "SELECT * FROM checkins"
    args, where = [], []
    if start:
        where.append("day >= ?")
        args.append(start)
    if end:
        where.append("day <= ?")
        args.append(end)
    if where:
        sql += " WHERE " + " AND ".join(where)
    sql += " ORDER BY day ASC, created_at ASC"
    with _db_lock, db() as conn:
        return [row_to_entry(r) for r in conn.execute(sql, args)]


def checked_in(day):
    with _db_lock, db() as conn:
        return conn.execute("SELECT 1 FROM checkins WHERE day = ? LIMIT 1", (day,)).fetchone() is not None


def latest_checkin_time(day):
    with _db_lock, db() as conn:
        r = conn.execute("SELECT MAX(created_at) FROM checkins WHERE day = ?", (day,)).fetchone()
    return dt.datetime.fromisoformat(r[0]) if r and r[0] else None


def latest_entry(before_day=None):
    sql = "SELECT * FROM checkins"
    args = []
    if before_day:
        sql += " WHERE day < ?"
        args.append(before_day)
    sql += " ORDER BY day DESC, created_at DESC LIMIT 1"
    with _db_lock, db() as conn:
        r = conn.execute(sql, args).fetchone()
    return row_to_entry(r) if r else None


def _clip_int(v, lo, hi):
    if v is None or v == "":
        return None
    v = int(v)
    if not lo <= v <= hi:
        raise ValueError(f"value {v} outside {lo}..{hi}")
    return v


def _text(v, limit=4000):
    if v is None:
        return None
    v = str(v).strip()
    return v[:limit] or None


def insert_entry(payload):
    selections = []
    for s in payload.get("selections") or []:
        if isinstance(s, dict) and s.get("stage") in STAGE_KEYS and str(s.get("text", "")).strip():
            selections.append({"stage": s["stage"], "text": str(s["text"]).strip()[:300]})
    if not selections:
        raise ValueError("select at least one behavior")
    # Like fasterscaleapp.com: the day's level is the highest category with a selected behavior.
    stage = max(STAGE_KEYS.index(s["stage"]) for s in selections)
    # One answer set per category: which behavior it's about + the three questions.
    answers, seen = [], set()
    for a in payload.get("answers") or []:
        if not isinstance(a, dict) or a.get("stage") not in STAGE_KEYS or a["stage"] in seen:
            continue
        texts = {k: _text(a.get(k)) for k in ("a", "b", "c")}
        behavior = str(a.get("behavior") or "").strip()
        if not any(texts.values()) and not behavior:
            continue
        if not any(s["stage"] == a["stage"] and s["text"] == behavior for s in selections):
            raise ValueError(f"choose which {a['stage']} behavior your answers apply to")
        seen.add(a["stage"])
        answers.append({"stage": a["stage"], "behavior": behavior, **texts})
    followthrough = payload.get("followthrough")
    if followthrough not in ("yes", "partly", "no"):
        followthrough = None
    now = dt.datetime.now()
    day = payload.get("day") or logical_day(now)
    dt.date.fromisoformat(day)  # validate
    row = (
        day,
        now.isoformat(timespec="seconds"),
        stage,
        json.dumps(selections),
        _clip_int(payload.get("wellbeing"), 1, 10),
        _clip_int(payload.get("urges"), 0, 10),
        followthrough,
        _text(payload.get("affects_me")),
        _text(payload.get("affects_others")),
        _text(payload.get("payoff")),
        _text(payload.get("commitment")),
        _text(payload.get("connect_with")),
        _text(payload.get("gratitude")),
        _text(payload.get("notes"), 20000),
        json.dumps(answers),
    )
    with _db_lock, db() as conn:
        cur = conn.execute(
            """INSERT INTO checkins(day, created_at, stage, selections, wellbeing, urges,
                   followthrough, affects_me, affects_others, payoff, commitment,
                   connect_with, gratitude, notes, answers)
               VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
            row,
        )
        new_id = cur.lastrowid
        r = conn.execute("SELECT * FROM checkins WHERE id = ?", (new_id,)).fetchone()
    log.info("check-in saved for %s (stage %s)", day, stage)
    monitor.on_checked_in()
    return row_to_entry(r)


def delete_entry(entry_id):
    with _db_lock, db() as conn:
        return conn.execute("DELETE FROM checkins WHERE id = ?", (entry_id,)).rowcount


def backup_db():
    """Keep a rolling daily copy of the database next to it (last 14 days)."""
    if not os.path.exists(DB_PATH):
        return
    bdir = os.path.join(DATA_DIR, "backups")
    os.makedirs(bdir, exist_ok=True)
    target = os.path.join(bdir, f"faster-{dt.date.today().isoformat()}.db")
    if not os.path.exists(target):
        with _db_lock:
            src = sqlite3.connect(DB_PATH)
            dst = sqlite3.connect(target)
            with dst:
                src.backup(dst)
            src.close()
            dst.close()
    backups = sorted(f for f in os.listdir(bdir) if f.startswith("faster-") and f.endswith(".db"))
    for old in backups[:-14]:
        try:
            os.remove(os.path.join(bdir, old))
        except OSError:
            pass


# --------------------------------------------------------------------------- Windows helpers

user32 = ctypes.windll.user32 if sys.platform == "win32" else None
kernel32 = ctypes.windll.kernel32 if sys.platform == "win32" else None
if user32:
    # Declare pointer-sized handles; without this, HWND_TOPMOST (-1) is truncated on 64-bit.
    user32.SetWindowPos.argtypes = [wt.HWND, wt.HWND, ctypes.c_int, ctypes.c_int, ctypes.c_int, ctypes.c_int, wt.UINT]
    user32.ShowWindow.argtypes = [wt.HWND, ctypes.c_int]
    user32.SetForegroundWindow.argtypes = [wt.HWND]
    user32.IsWindowVisible.argtypes = [wt.HWND]
    user32.GetWindowTextLengthW.argtypes = [wt.HWND]
    user32.GetWindowTextW.argtypes = [wt.HWND, wt.LPWSTR, ctypes.c_int]
    user32.CloseDesktop.argtypes = [wt.HANDLE]

HWND_TOPMOST = wt.HWND(-1)
HWND_NOTOPMOST = wt.HWND(-2)


class LASTINPUTINFO(ctypes.Structure):
    _fields_ = [("cbSize", wt.UINT), ("dwTime", wt.DWORD)]


def idle_seconds():
    if not user32:
        return 0
    lii = LASTINPUTINFO()
    lii.cbSize = ctypes.sizeof(LASTINPUTINFO)
    if not user32.GetLastInputInfo(ctypes.byref(lii)):
        return 0
    kernel32.GetTickCount.restype = wt.DWORD
    return ((kernel32.GetTickCount() - lii.dwTime) & 0xFFFFFFFF) / 1000.0


def session_locked():
    """True while the lock screen is up (no input desktop can be opened)."""
    if not user32:
        return False
    user32.OpenInputDesktop.restype = wt.HANDLE
    h = user32.OpenInputDesktop(0, False, 0x0100)  # DESKTOP_SWITCHDESKTOP
    if not h:
        return True
    user32.CloseDesktop(h)
    return False


WINDOW_TITLE = "FASTER Check-in"


def find_checkin_windows():
    found = []
    if not user32:
        return found

    @ctypes.WINFUNCTYPE(wt.BOOL, wt.HWND, wt.LPARAM)
    def cb(hwnd, _):
        if user32.IsWindowVisible(hwnd):
            n = user32.GetWindowTextLengthW(hwnd)
            if n:
                buf = ctypes.create_unicode_buffer(n + 1)
                user32.GetWindowTextW(hwnd, buf, n + 1)
                if buf.value == WINDOW_TITLE:  # app windows only, not a normal browser tab
                    found.append(hwnd)
        return True

    user32.EnumWindows(cb, 0)
    return found


def raise_window(hwnd, topmost):
    SWP_NOMOVE, SWP_NOSIZE, SWP_SHOWWINDOW = 0x2, 0x1, 0x40
    user32.ShowWindow(hwnd, 9)  # SW_RESTORE
    # Windows refuses SetForegroundWindow from background processes unless a key
    # event just happened; a synthetic ALT tap is the standard workaround.
    user32.keybd_event(0x12, 0, 0, 0)
    user32.keybd_event(0x12, 0, 2, 0)
    user32.SetWindowPos(hwnd, HWND_TOPMOST if topmost else HWND_NOTOPMOST, 0, 0, 0, 0,
                        SWP_NOMOVE | SWP_NOSIZE | SWP_SHOWWINDOW)
    user32.SetForegroundWindow(hwnd)


def find_browser(pref):
    pf = os.environ.get("ProgramFiles", r"C:\Program Files")
    pf86 = os.environ.get("ProgramFiles(x86)", r"C:\Program Files (x86)")
    local = os.environ.get("LOCALAPPDATA", "")
    chrome = [os.path.join(p, "Google", "Chrome", "Application", "chrome.exe") for p in (pf, pf86, local)]
    edge = [os.path.join(p, "Microsoft", "Edge", "Application", "msedge.exe") for p in (pf86, pf)]
    order = {"chrome": chrome + edge, "edge": edge + chrome}.get(pref, chrome + edge)
    for p in order:
        if os.path.exists(p):
            return p
    return None


# --------------------------------------------------------------------------- monitor

class Monitor:
    """Decides when to show the check-in window.

    A loop wakes every few seconds. Because it keeps running across sleep/hibernate,
    the first iteration after waking notices (a) the logical day changed and
    (b) the user is active again, and pops the window. Logon/unlock/wake
    scheduled-task triggers also call /api/nudge for an immediate check.
    """

    def __init__(self):
        self.last_heartbeat = 0.0   # check-in page reports it's open
        self.last_popup = 0.0
        self.wake = threading.Event()
        self.last_hourly = None     # wall-clock time of the last hourly pop-up

    def heartbeat(self):
        self.last_heartbeat = time.monotonic()

    def nudge(self):
        self.wake.set()

    def on_checked_in(self):
        for hwnd in find_checkin_windows():
            try:
                user32.SetWindowPos(hwnd, HWND_NOTOPMOST, 0, 0, 0, 0, 0x3 | 0x10)  # drop always-on-top
            except Exception:
                pass

    def run(self):
        last_tick = time.time()
        last_backup_day = None
        while True:
            self.wake.wait(timeout=10)
            nudged = self.wake.is_set()
            self.wake.clear()
            now = time.time()
            if now - last_tick > 60:
                log.info("resumed after %.0fs gap (sleep/hibernate?)", now - last_tick)
                nudged = True
            last_tick = now
            try:
                today = dt.date.today().isoformat()
                if last_backup_day != today:
                    backup_db()
                    last_backup_day = today
                self.check(nudged)
            except Exception:
                log.exception("monitor iteration failed")

    def check(self, nudged):
        s = get_settings()
        day = logical_day(day_start_hour=s["dayStartHour"])
        if checked_in(day):
            self.check_hourly(s, day)
            return
        if not s["popupEnabled"] or session_locked():
            return
        if idle_seconds() > s["idleThresholdSec"]:
            return
        mono = time.monotonic()
        windows = find_checkin_windows()
        if windows or mono - self.last_heartbeat < 25:
            # Already open: keep it pinned above other windows (without stealing focus).
            if s["keepOnTop"]:
                for hwnd in windows:
                    user32.SetWindowPos(hwnd, HWND_TOPMOST, 0, 0, 0, 0, 0x3 | 0x10)  # NOMOVE|NOSIZE|NOACTIVATE
            return
        if not nudged and mono - self.last_popup < s["repopCooldownSec"]:
            return
        self.open_window(s)

    def check_hourly(self, s, day):
        """After the day's first check-in, re-open the check-in every N minutes.

        The clock restarts at whichever is later: your most recent check-in or the
        last hourly pop-up. So closing the window skips to the next hour instead of
        nagging, and checking in early pushes the next one back. Wall-clock time is
        used so a long sleep yields one pop-up on return, not a backlog.
        """
        if not (s["popupEnabled"] and s["hourlyEnabled"]) or session_locked():
            return
        if idle_seconds() > s["idleThresholdSec"] or find_checkin_windows():
            return
        last_checkin = latest_checkin_time(day)
        anchors = [t for t in (last_checkin, self.last_hourly) if t]
        if not anchors:
            return
        if dt.datetime.now() - max(anchors) < dt.timedelta(minutes=s["hourlyIntervalMin"]):
            return
        self.last_hourly = dt.datetime.now()
        log.info("hourly check-in (last check-in %s)", last_checkin)
        self.open_window(s, hourly=True)

    def open_window(self, s, hourly=False):
        self.last_popup = time.monotonic()
        url = f"{ORIGIN}/checkin?popup=1" + ("&hourly=1" if hourly else "")
        topmost = s["keepOnTop"] and not hourly  # hourly ones come to the front but aren't pinned
        exe = find_browser(s["browser"])
        log.info("opening check-in window via %s", exe or "default browser")
        if exe:
            subprocess.Popen(
                [exe, f"--app={url}", "--window-size=980,1000", "--new-window"],
                close_fds=True,
                creationflags=0x00000008 | 0x00000200,  # DETACHED_PROCESS | NEW_PROCESS_GROUP
            )
        else:
            os.startfile(url)
        for _ in range(30):  # wait up to ~15 s for the window to appear, then bring it forward
            time.sleep(0.5)
            wins = find_checkin_windows()
            if wins:
                for hwnd in wins:
                    raise_window(hwnd, topmost)
                break


monitor = Monitor()


# --------------------------------------------------------------------------- HTTP

PAGES = {
    "/": "dashboard.html",
    "/dashboard": "dashboard.html",
    "/checkin": "checkin.html",
}


class Handler(BaseHTTPRequestHandler):
    server_version = "FasterScale/1.0"

    def log_message(self, fmt, *args):  # quiet
        pass

    # -- guards: only our own pages may talk to the API (blocks DNS rebinding & CSRF
    #    from arbitrary websites, which could otherwise "check in" to unlock browsing)
    def _host_ok(self):
        return self.headers.get("Host", "") in ALLOWED_HOSTS

    def _origin_ok(self):
        origin = self.headers.get("Origin")
        if origin is None:
            return self.headers.get("X-Faster-Client") == "1"
        return origin in ALLOWED_ORIGINS

    def _send(self, code, body=b"", ctype="application/json; charset=utf-8", headers=None):
        if isinstance(body, (dict, list)):
            body = json.dumps(body).encode()
        elif isinstance(body, str):
            body = body.encode()
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        for k, v in (headers or {}).items():
            self.send_header(k, v)
        self.end_headers()
        if self.command != "HEAD":
            self.wfile.write(body)

    def _json_body(self):
        n = int(self.headers.get("Content-Length") or 0)
        if n > 1_000_000:
            raise ValueError("body too large")
        if "application/json" not in (self.headers.get("Content-Type") or ""):
            raise ValueError("expected application/json")
        return json.loads(self.rfile.read(n) or b"{}")

    def _static(self, rel):
        path = os.path.normpath(os.path.join(WEB_DIR, rel))
        if not path.startswith(WEB_DIR + os.sep) or not os.path.isfile(path):
            return self._send(404, {"error": "not found"})
        ctype = mimetypes.guess_type(path)[0] or "application/octet-stream"
        if ctype.startswith("text/") or ctype in ("application/javascript",):
            ctype += "; charset=utf-8"
        with open(path, "rb") as f:
            self._send(200, f.read(), ctype)

    def status(self):
        s = get_settings()
        day = logical_day(day_start_hour=s["dayStartHour"])
        done = checked_in(day)
        return {
            "today": day,
            "checkedIn": done,
            "dayStartHour": s["dayStartHour"],
            "serverTime": dt.datetime.now().isoformat(timespec="seconds"),
            "previous": latest_entry(before_day=day) if not done else None,
        }

    def do_HEAD(self):
        self.do_GET()

    def do_GET(self):
        if not self._host_ok():
            return self._send(403, {"error": "bad host"})
        url = urllib.parse.urlsplit(self.path)
        q = urllib.parse.parse_qs(url.query)
        p = url.path
        try:
            if p in PAGES:
                return self._static(PAGES[p])
            if p.startswith("/static/"):
                return self._static(p[len("/static/"):])
            if p == "/api/status":
                return self._send(200, self.status())
            if p == "/api/entries":
                return self._send(200, list_entries(q.get("from", [None])[0], q.get("to", [None])[0]))
            if p == "/api/settings":
                return self._send(200, get_settings())
            if p == "/api/behaviors":
                return self._send(200, get_behaviors())
            if p == "/api/export.json":
                return self._send(200, json.dumps(list_entries(), indent=2), headers={
                    "Content-Disposition": 'attachment; filename="faster-checkins.json"'})
            if p == "/api/export.csv":
                return self._send(200, self._csv(), "text/csv; charset=utf-8", {
                    "Content-Disposition": 'attachment; filename="faster-checkins.csv"'})
            return self._send(404, {"error": "not found"})
        except Exception as e:
            log.exception("GET %s failed", p)
            return self._send(500, {"error": str(e)})

    def _csv(self):
        buf = io.StringIO()
        cols = ["id", "day", "created_at", "stage", "stage_name", "selections", "answers",
                "wellbeing", "urges", "followthrough", "affects_me", "affects_others", "payoff",
                "commitment", "connect_with", "gratitude", "notes"]
        names = ["Restoration", "Forgetting Priorities", "Anxiety", "Speeding Up", "Ticked Off",
                 "Exhausted", "Relapse/Moral Failure"]
        w = csv.writer(buf)
        w.writerow(cols)
        for e in list_entries():
            e["stage_name"] = names[e["stage"]]
            e["selections"] = "; ".join(f'{s["stage"]}: {s["text"]}' for s in e["selections"])
            e["answers"] = " | ".join(
                f'{a["stage"]} ({a["behavior"]}): affects me: {a.get("a") or ""}; '
                f'affects others: {a.get("b") or ""}; why/benefit: {a.get("c") or ""}'
                for a in e["answers"])
            w.writerow([e.get(c) for c in cols])
        return "\ufeff" + buf.getvalue()  # BOM so Excel opens it as UTF-8

    def do_POST(self):
        if not self._host_ok() or not self._origin_ok():
            return self._send(403, {"error": "forbidden"})
        p = urllib.parse.urlsplit(self.path).path
        try:
            if p == "/api/heartbeat":
                monitor.heartbeat()
                return self._send(200, {"ok": True})
            if p == "/api/nudge":
                monitor.nudge()
                return self._send(200, {"ok": True})
            if p == "/api/behaviors/import":
                try:
                    return self._send(200, import_behaviors())
                except Exception as e:
                    log.warning("behavior import failed: %s", e)
                    return self._send(502, {"error": f"couldn't download the list: {e}"})
            body = self._json_body()
            if p == "/api/entries":
                return self._send(201, insert_entry(body))
            return self._send(404, {"error": "not found"})
        except (ValueError, TypeError) as e:
            return self._send(400, {"error": str(e)})
        except Exception as e:
            log.exception("POST %s failed", p)
            return self._send(500, {"error": str(e)})

    def do_PUT(self):
        if not self._host_ok() or not self._origin_ok():
            return self._send(403, {"error": "forbidden"})
        p = urllib.parse.urlsplit(self.path).path
        try:
            if p == "/api/settings":
                return self._send(200, save_settings(self._json_body()))
            return self._send(404, {"error": "not found"})
        except (ValueError, TypeError) as e:
            return self._send(400, {"error": str(e)})

    def do_DELETE(self):
        if not self._host_ok() or not self._origin_ok():
            return self._send(403, {"error": "forbidden"})
        p = urllib.parse.urlsplit(self.path).path
        if p.startswith("/api/entries/"):
            try:
                n = delete_entry(int(p.rsplit("/", 1)[1]))
            except ValueError:
                return self._send(400, {"error": "bad id"})
            return self._send(200 if n else 404, {"deleted": n})
        return self._send(404, {"error": "not found"})


def main():
    init_db()
    try:
        httpd = ThreadingHTTPServer((HOST, PORT), Handler)
    except OSError:
        # Another instance already owns the port - nothing to do.
        sys.exit(0)
    httpd.daemon_threads = True
    log.info("service started on %s (data: %s)", ORIGIN, DATA_DIR)
    if "--no-monitor" not in sys.argv:
        threading.Thread(target=monitor.run, daemon=True, name="monitor").start()
    threading.Thread(target=ensure_behaviors, daemon=True, name="behaviors").start()
    try:
        httpd.serve_forever()
    finally:
        log.info("service stopped")


if __name__ == "__main__":
    main()
