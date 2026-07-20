#!/usr/bin/env python3
"""
Pre-flight guard, run BEFORE the main claude -p invocation in
worker-entrypoint.sh. Deployed 2026-07-20 per Owner zero-waste directive.

Two failure classes were found in the RCA that this exists to catch before
they cost anything:
  - "instant environment failure" (Group B): 5 tasks, 2-8s each, zero output,
    all failing the same minute under resource contention. Caught here by
    static checks -- $0, no model call.
  - "pathological retry" (Group A): one task retried an unfixed approach 12
    times, burning 2.3 hours. Caught here by the circuit breaker -- refuses
    to start a 3rd attempt at an approach that failed identically twice.

Usage: preflight-guard.py <task_dir> <workspace> [proxy_url]
Exit 0 = proceed (JSON {"proceed": true, ...} on stdout).
Exit 1 = abort (JSON {"proceed": false, "reason": ..., "detail": ...} on
         stdout) -- caller checkpoints as blocked using this and does NOT
         invoke the model.
"""
import json
import os
import shutil
import sys
import urllib.error
import urllib.request


def fail(reason, detail=""):
    print(json.dumps({"proceed": False, "reason": reason, "detail": str(detail)}))
    sys.exit(1)


def ok(detail=""):
    print(json.dumps({"proceed": True, "detail": detail}))
    sys.exit(0)


def check_circuit_breaker(task_dir):
    """Refuse to proceed if the last 2 recorded failures have the identical
    signature -- a 3rd identical attempt is a stop signal, not a retry
    signal (see COST-CONTROL.md Q1/Q4)."""
    sig_file = os.path.join(task_dir, ".failure_signatures.json")
    if not os.path.exists(sig_file):
        return
    try:
        with open(sig_file) as f:
            sigs = json.load(f)
    except Exception:
        return
    if len(sigs) >= 2 and sigs[-1] and sigs[-1] == sigs[-2]:
        fail("circuit_breaker_tripped",
             f"last 2 failures had the identical signature -- needs a different approach or human review, "
             f"not a 3rd blind retry. signature={sigs[-1][:100]}")


def check_disk(workspace, min_free_mb=500):
    try:
        usage = shutil.disk_usage(workspace)
    except FileNotFoundError:
        return  # workspace not created yet -- not this guard's concern
    free_mb = usage.free / (1024 * 1024)
    if free_mb < min_free_mb:
        fail("disk_low", f"{free_mb:.0f}MB free at {workspace}, need >={min_free_mb}MB")


def check_mem(min_available_mb=300):
    try:
        meminfo = {}
        with open("/proc/meminfo") as f:
            for line in f:
                k, v = line.split(":", 1)
                meminfo[k.strip()] = int(v.strip().split()[0])  # kB
        avail_mb = meminfo.get("MemAvailable", 0) / 1024
    except Exception:
        return  # can't read /proc/meminfo -- don't block on a check that can't run
    if avail_mb < min_available_mb:
        fail("memory_low", f"{avail_mb:.0f}MB available, need >={min_available_mb}MB -- "
                            f"likely resource contention from concurrent workers (Group B failure pattern)")


def check_worktree(workspace):
    lock = os.path.join(workspace, ".git", "index.lock")
    if os.path.exists(lock):
        fail("worktree_locked", lock)


def check_proxy_health(proxy_url):
    try:
        with urllib.request.urlopen(f"{proxy_url}/healthz", timeout=5) as r:
            data = json.loads(r.read())
    except Exception as e:
        fail("proxy_unreachable", f"{proxy_url}/healthz: {e}")
    if data.get("budget_allowed") is False:
        fail("budget_exhausted",
             f"spent ${data.get('budget_spent_usd')} >= cap ${data.get('budget_cap_usd')} -- "
             f"this is the hard ceiling working as designed, not a bug")


def canary_call(proxy_url):
    """One minimal real call through the actual call path -- confirms model
    reachability, auth, and tool-schema handling before the full task prompt
    (which can be tens of thousands of tokens) goes out. Costs a fraction of
    a cent; a cache hit on a repeat canary costs nothing at all."""
    payload = {
        "model": "claude-opus-4-8",
        "max_tokens": 5,
        "messages": [{"role": "user", "content": "canary: reply OK"}],
    }
    req = urllib.request.Request(
        f"{proxy_url}/v1/messages",
        data=json.dumps(payload).encode(),
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            resp = json.loads(r.read())
    except urllib.error.HTTPError as e:
        err = e.read().decode(errors="replace")
        fail("canary_call_http_error", f"{e.code}: {err[:200]}")
        return
    except Exception as e:
        fail("canary_call_failed", str(e))
        return
    if resp.get("type") == "error":
        fail("canary_call_error", resp.get("error", {}).get("message", ""))


if __name__ == "__main__":
    if len(sys.argv) < 3:
        fail("bad_invocation", "usage: preflight-guard.py <task_dir> <workspace> [proxy_url]")
    task_dir_arg = sys.argv[1]
    workspace_arg = sys.argv[2]
    proxy_url_arg = sys.argv[3] if len(sys.argv) > 3 else "http://127.0.0.1:8787"

    check_circuit_breaker(task_dir_arg)
    check_disk(workspace_arg)
    check_mem()
    check_worktree(workspace_arg)
    check_proxy_health(proxy_url_arg)
    canary_call(proxy_url_arg)
    ok("all pre-flight checks passed (circuit-breaker, disk, memory, worktree, proxy health, canary)")
