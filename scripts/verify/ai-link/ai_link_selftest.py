#!/usr/bin/env python3
"""Self-test for ai_link_conformance.py (spec S01 section 13.3, as fixed by audit S02).

1. Starts ai_link_mock_server.py with no breaks and runs the harness with every
   optional check on: all 24 checks must pass (harness exit 0).
2. For each --break NAME, restarts the mock with that one rule switched off and
   runs the harness again: the harness must exit 1 and the named check(s) must FAIL.
Exit 0 only when step 1 passes and every break is detected.
Last line: "SELFTEST: clean <p>/<n> pass; <d>/<b> breaks detected"
Standard library only.
"""
import os
import socket
import subprocess
import sys
import time

HERE = os.path.dirname(os.path.abspath(__file__))
MOCK = os.path.join(HERE, "ai_link_mock_server.py")
HARNESS = os.path.join(HERE, "ai_link_conformance.py")
TOKENS = {"a": "pxa_" + "a" * 64, "m": "pxa_" + "b" * 64, "b": "pxa_" + "c" * 64, "r": "pxa_" + "d" * 64,
          "d": "pxa_" + "f" * 64}
CLEAN_TOTAL = 24
# break name -> the check ids that must FAIL when that rule is switched off
EXPECT = {
    "content-type": ["H01"],
    "headers": ["H03"],
    "get-writes": ["H12", "H13"],
    "get-submissions": ["H13"],
    "get-function": ["H14"],
    "read-writes": ["H21"],
    "isolation": ["H17"],
    "redaction": ["H18"],
    "money-filter": ["H18"],
    "revocation": ["H19"],
    "mcp-get": ["H09"],
    "mcp-modern": ["H08"],
    "query-token": ["H16"],
    "idempotency": ["H20"],
    "search-leak": ["H22"],
    "search-token": ["H22"],
    "demotion": ["H23"],
    "json-default": ["H24"],
}


def free_port():
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


def wait_for(port, seconds=10.0):
    end = time.monotonic() + seconds
    while time.monotonic() < end:
        try:
            with socket.create_connection(("127.0.0.1", port), timeout=0.5):
                return True
        except OSError:
            time.sleep(0.1)
    return False


def run_case(breaks):
    port = free_port()
    cmd = [sys.executable, MOCK, "--port", str(port)]
    for name in breaks:
        cmd += ["--break", name]
    mock = subprocess.Popen(cmd, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    try:
        if not wait_for(port):
            return 99, "mock did not start"
        base = "http://127.0.0.1:%d/functions/v1/ai-work-link/" % port
        args = [sys.executable, HARNESS, "--link", base + TOKENS["a"], "--link-b", base + TOKENS["b"],
                "--member-link", base + TOKENS["m"], "--revoked-link", base + TOKENS["r"],
                "--demoted-link", base + TOKENS["d"], "--write"]
        done = subprocess.run(args, capture_output=True, text=True, timeout=180)
        return done.returncode, done.stdout
    finally:
        mock.terminate()
        try:
            mock.wait(timeout=10)
        except subprocess.TimeoutExpired:
            mock.kill()


def main():
    code, out = run_case([])
    lines = out.strip().splitlines()
    total = sum(1 for line in lines if line.startswith(("PASS ", "FAIL ")))
    passed = sum(1 for line in lines if line.startswith("PASS "))
    clean_ok = code == 0 and total == CLEAN_TOTAL and passed == CLEAN_TOTAL
    print("clean run: exit=%s, %d/%d checks pass" % (code, passed, total))
    if not clean_ok:
        print(out)
    detected = 0
    for name, must_fail in EXPECT.items():
        code, out = run_case([name])
        failed_ids = {line.split()[1] for line in out.splitlines() if line.startswith("FAIL ")}
        ok = code == 1 and set(must_fail) <= failed_ids
        detected += 1 if ok else 0
        print("break %-15s -> exit=%s, failed=%s, expected=%s : %s"
              % (name, code, sorted(failed_ids), must_fail, "DETECTED" if ok else "MISSED"))
    print("SELFTEST: clean %d/%d pass; %d/%d breaks detected" % (passed, total, detected, len(EXPECT)))
    return 0 if clean_ok and detected == len(EXPECT) else 1


if __name__ == "__main__":
    sys.exit(main())
