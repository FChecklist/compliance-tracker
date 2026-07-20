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


def check_tight_task_schema(task_dir):
    """Faithful Python port of task-tightening.ts's validateTightTask() --
    closes the gap found in the constitution cross-check audit (2026-07-20):
    the shell-layer fleet had zero access to this TS/DB-backed validation.
    Only blocks NEW-format prompts (## OBJECTIVE / ## SCOPE / etc. labeled
    headers) -- a legacy free-text prompt is never retroactively failed."""
    prompt_path = os.path.join(task_dir, "prompt.txt")
    if not os.path.exists(prompt_path):
        return
    try:
        sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
        import tight_task_validation as ttv
        with open(prompt_path) as f:
            text = f.read()
        fields = ttv.parse_labeled_fields(text)
        if fields is None:
            return  # legacy free-text prompt -- not this validator's concern
        result = ttv.validate_tight_task(fields)
        if not result.get("valid"):
            fail("tight_task_schema_violation", f"{result.get('reason')} {result.get('guidance')}")
    except ImportError:
        return  # validator module unavailable -- fail open, don't block on infra issue


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


def check_openrouter_balance(min_remaining_usd=0.10):
    """RCA fix, 2026-07-20 -- root cause of the 47-failed-unit /
    71.9%-task-failure-rate incident found this same day: this proxy's own
    check_proxy_health() above tracks ONLY the budget THIS proxy itself has
    spent -- it has no visibility into the REAL, LIVE OpenRouter account
    balance, which can be (and was) drained toward zero by other draws on
    the same API key. Confirmed directly: the account showed
    total_credits=$40 / total_usage=$40.07 (already over) while every
    worker's canary call (5 max_tokens, cheap enough to still succeed) kept
    passing preflight, only for the REAL prompt (up to 64000 max_tokens) to
    fail immediately with a real, live OpenRouter 402 -- which systemd then
    retried 3x into a permanent 'failed' state per affected task, across at
    least 47 units.

    This queries OpenRouter's OWN /credits endpoint directly -- ground
    truth, cannot drift out of sync with reality the way a local tracker
    can. Fails OPEN (never blocks a real task) on any network/read/parse
    error on the check itself; fails CLOSED (blocks, hard stop) only on a
    confirmed, real low/zero balance. Same fail-open/fail-closed asymmetry
    as the app-layer's checkOpenRouterBalance() in cost-policy.ts -- this
    is that same guardrail's ops-layer twin, for the worker fleet that
    guardrail never covered.
    """
    key = os.environ.get("OPENROUTER_API_KEY")
    if not key:
        env_path = "/opt/veridian/shared/.env"
        try:
            with open(env_path) as f:
                for line in f:
                    if line.startswith("OPENROUTER_API_KEY="):
                        key = line.strip().split("=", 1)[1]
                        break
        except FileNotFoundError:
            pass
    if not key:
        return  # can't verify -- fail open, do not block on a check with no key to run it
    req = urllib.request.Request(
        "https://openrouter.ai/api/v1/credits",
        headers={"Authorization": f"Bearer {key}"},
    )
    try:
        with urllib.request.urlopen(req, timeout=10) as r:
            data = json.loads(r.read())
    except Exception:
        return  # fail open -- a hiccup on the balance check itself must never block real work
    d = data.get("data", {})
    total_credits = d.get("total_credits")
    total_usage = d.get("total_usage")
    if total_credits is None or total_usage is None:
        return  # unexpected response shape -- fail open
    remaining = total_credits - total_usage
    if remaining < min_remaining_usd:
        fail("openrouter_balance_exhausted",
             f"OpenRouter account has ${remaining:.4f} remaining "
             f"(${total_usage:.2f} used of ${total_credits:.2f} credits) -- below the "
             f"${min_remaining_usd} safety floor. This is the REAL, live account balance, "
             f"not this proxy's own internal spend tracker. Add credits at "
             f"https://openrouter.ai/settings/credits before retrying -- this is a real "
             f"money problem, not a code bug, and retrying will not help until the balance "
             f"is restored.")


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
        fail("bad_invocation", "usage: preflight-guard.py <task_dir> <workspace> [proxy_url|--no-proxy]")
    task_dir_arg = sys.argv[1]
    workspace_arg = sys.argv[2]
    proxy_arg = sys.argv[3] if len(sys.argv) > 3 else "http://127.0.0.1:8787"

    check_circuit_breaker(task_dir_arg)
    check_tight_task_schema(task_dir_arg)
    check_disk(workspace_arg)
    check_mem()
    check_worktree(workspace_arg)

    if proxy_arg == "--no-proxy":
        # doc-worker-entrypoint.sh's real-subscription tasks don't route
        # through the GLM proxy at all (see that script's own header
        # comment) -- proxy health/canary/budget checks don't apply. Static
        # checks + circuit breaker above still fully apply and already ran.
        ok("pre-flight checks passed (circuit-breaker, disk, memory, worktree) -- proxy checks skipped, not applicable to this task family")
    else:
        check_proxy_health(proxy_arg)
        check_openrouter_balance()
        canary_call(proxy_arg)
        ok("all pre-flight checks passed (circuit-breaker, disk, memory, worktree, proxy health, real OpenRouter balance, canary)")
