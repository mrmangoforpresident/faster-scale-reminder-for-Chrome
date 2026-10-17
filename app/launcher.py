"""Ensure the FASTER service is running, then ask it to check whether to pop up.

Invoked by the scheduled task on logon, unlock, wake from sleep, and every few
minutes as a watchdog. Safe to run any number of times.
"""

import os
import subprocess
import sys
import time
import urllib.request

PORT = int(os.environ.get("FASTER_PORT", "47321"))
BASE = f"http://127.0.0.1:{PORT}"
APP_DIR = os.path.dirname(os.path.abspath(__file__))


def call(path, method="GET"):
    req = urllib.request.Request(BASE + path, method=method, headers={"X-Faster-Client": "1"})
    with urllib.request.urlopen(req, timeout=2) as r:
        return r.status


def running():
    try:
        return call("/api/status") == 200
    except Exception:
        return False


def start_service():
    exe = sys.executable
    pyw = os.path.join(os.path.dirname(exe), "pythonw.exe")
    if os.path.exists(pyw):
        exe = pyw
    flags = 0x00000008 | 0x00000200  # DETACHED_PROCESS | CREATE_NEW_PROCESS_GROUP
    args = [exe, os.path.join(APP_DIR, "server.py")]
    try:
        # Break away from Task Scheduler's job object so the service outlives this launcher.
        subprocess.Popen(args, close_fds=True, creationflags=flags | 0x01000000)
    except OSError:
        subprocess.Popen(args, close_fds=True, creationflags=flags)


def main():
    if not running():
        start_service()
        for _ in range(40):
            time.sleep(0.25)
            if running():
                break
    try:
        call("/api/nudge", "POST")
    except Exception:
        pass


if __name__ == "__main__":
    main()
