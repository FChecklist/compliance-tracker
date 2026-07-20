#!/usr/bin/env python3
"""
VERIDIAN-DEV 15-minute health check. Zero AI cost -- pure deterministic
script (L0 tier: no model call of any kind). Checks:
  - systemd status of every veridian-worker@*/veridian-supervisor@* unit
  - staleness of every in_progress task's checkpoint vs its unit's state
  - Mother Router / AI router registry reachability (row counts, via psql)
  - server health (disk, memory, load)
  - best-effort Claude-CLI-quota-exhaustion signature scan (no real quota
    API exists in this Claude Code CLI version as of 2026-07-19 -- this is
    a PROXY signal via known failure-message patterns, not a real quota
    check; documented as such, not oversold)
Appends one JSON line to health-15min.jsonl, one human line to
health-15min.log, and any anomaly to ATTENTION.md. Self-rotates: keeps only
the last 700 lines (~1 week at 15-min cadence) of each log.
"""
import json
import os
import re
import subprocess
import sys
from datetime import datetime, timezone, timedelta

LOG_DIR = "/opt/veridian/ai-os/logs"
TASKS_DIR = "/opt/veridian/ai-os/tasks"
JSONL_LOG = os.path.join(LOG_DIR, "health-15min.jsonl")
TEXT_LOG = os.path.join(LOG_DIR, "health-15min.log")
ATTENTION_FILE = os.path.join(LOG_DIR, "ATTENTION.md")
MAX_LINES = 700
STALE_THRESHOLD_MIN = 25  # 15-min cadence + 1 grace period
FAILURE_RATE_THRESHOLD = 0.20  # 2026-07-20, constitution-audit gap #3
ENV_FILE = "/opt/veridian/repos/compliance-tracker/.env.local"

EXHAUSTION_PATTERNS = [
    r"credit balance is too low",
    r"rate.?limit",
    r"\b429\b",
    r"quota exceeded",
    r"insufficient.?quota",
]


def sh(cmd, timeout=15):
    try:
        r = subprocess.run(cmd, shell=True, capture_output=True, text=True, timeout=timeout)
        return r.stdout.strip(), r.stderr.strip(), r.returncode
    except Exception as e:
        return "", str(e), -1


def get_env_value(key, path=ENV_FILE):
    try:
        with open(path) as f:
            for line in f:
                if line.startswith(key + "="):
                    return line.split("=", 1)[1].strip().strip('"').strip("'")
    except FileNotFoundError:
        pass
    return None


def check_systemd_units():
    out, _, _ = sh("systemctl --user list-units 'veridian-worker@*' 'veridian-supervisor@*' --all --no-legend --plain 2>/dev/null")
    units = []
    for line in out.splitlines():
        parts = line.split(None, 4)
        if len(parts) >= 4:
            unit, load, active, sub = parts[0], parts[1], parts[2], parts[3]
            units.append({"unit": unit, "load": load, "active": active, "sub": sub})
    running = sum(1 for u in units if u["active"] == "active")
    failed = [u for u in units if u["active"] == "failed" or u["sub"] == "failed"]
    return {"total": len(units), "running": running, "failed_count": len(failed), "failed_units": [u["unit"] for u in failed]}


def check_tasks():
    """Read every task.yaml's status + last_checkpoint_at without requiring PyYAML."""
    results = {"in_progress": 0, "completed": 0, "failed": 0, "blocked": 0,
               "awaiting_human_approval": 0, "other": 0, "stalled": []}
    if not os.path.isdir(TASKS_DIR):
        return results
    now = datetime.now(timezone.utc)
    for task_id in os.listdir(TASKS_DIR):
        yaml_path = os.path.join(TASKS_DIR, task_id, "task.yaml")
        if not os.path.isfile(yaml_path):
            continue
        try:
            with open(yaml_path) as f:
                content = f.read()
        except Exception:
            continue
        status_m = re.search(r"^status:\s*(\S+)", content, re.MULTILINE)
        status = status_m.group(1).strip("'\"") if status_m else "other"
        results[status] = results.get(status, 0) + 1
        if status == "in_progress":
            cp_m = re.search(r"^last_checkpoint_at:\s*'?([0-9T:.+-]+)'?", content, re.MULTILINE)
            if cp_m:
                try:
                    cp_time = datetime.fromisoformat(cp_m.group(1).replace("Z", "+00:00"))
                    age_min = (now - cp_time).total_seconds() / 60
                    if age_min > STALE_THRESHOLD_MIN:
                        results["stalled"].append({"task_id": task_id, "checkpoint_age_min": round(age_min, 1)})
                except Exception:
                    pass
    return results


def check_mother_router_db():
    db_url = get_env_value("DATABASE_URL")
    if not db_url:
        return {"reachable": False, "error": "DATABASE_URL not found in .env.local"}
    out, err, code = sh(
        f'psql "{db_url}" -t -A -c '
        '"select (select count(*) from platform.ai_model_registry) as models, '
        '(select count(*) from platform.ai_routing_policies) as policies, '
        '(select count(*) from platform.ai_routing_audit_log) as audit_rows;"',
        timeout=20,
    )
    if code != 0:
        return {"reachable": False, "error": err[:300]}
    try:
        models, policies, audit_rows = out.split("|")
        return {"reachable": True, "ai_model_registry_rows": int(models), "ai_routing_policies_rows": int(policies), "ai_routing_audit_log_rows": int(audit_rows)}
    except Exception:
        return {"reachable": True, "raw": out}


def check_server_health():
    disk_out, _, _ = sh("df -h / | tail -1")
    disk_pct = None
    m = re.search(r"(\d+)%", disk_out)
    if m:
        disk_pct = int(m.group(1))
    mem_out, _, _ = sh("free -m | grep Mem")
    mem_parts = mem_out.split()
    mem_used_pct = None
    if len(mem_parts) >= 3:
        try:
            total, used = int(mem_parts[1]), int(mem_parts[2])
            mem_used_pct = round(100 * used / total, 1) if total else None
        except Exception:
            pass
    load_out, _, _ = sh("uptime")
    return {"disk_pct_used": disk_pct, "mem_pct_used": mem_used_pct, "uptime_raw": load_out}


def scan_claude_exhaustion_signatures():
    """Best-effort proxy for CLI-subscription quota exhaustion -- NOT a real
    quota API (none exists in claude-code 2.1.212). Scans worker.log/result.json
    files touched in the last 15 min for known failure-message patterns."""
    out, _, _ = sh(f"find {TASKS_DIR} -name 'worker.log' -o -name 'result.json' -mmin -16 2>/dev/null")
    hits = []
    for path in out.splitlines():
        try:
            with open(path, errors="ignore") as f:
                content = f.read()[-4000:]
            for pat in EXHAUSTION_PATTERNS:
                if re.search(pat, content, re.IGNORECASE):
                    hits.append({"file": path, "pattern": pat})
                    break
        except Exception:
            continue
    return {"scanned": len(out.splitlines()), "exhaustion_signature_hits": hits}


def rotate(path, max_lines):
    if not os.path.isfile(path):
        return
    with open(path) as f:
        lines = f.readlines()
    if len(lines) > max_lines:
        with open(path, "w") as f:
            f.writelines(lines[-max_lines:])


def main():
    os.makedirs(LOG_DIR, exist_ok=True)
    now = datetime.now(timezone.utc).isoformat()

    units = check_systemd_units()
    tasks = check_tasks()
    router = check_mother_router_db()
    server = check_server_health()
    claude_signal = scan_claude_exhaustion_signatures()

    anomalies = []
    if units["failed_count"] > 0:
        anomalies.append(f"{units['failed_count']} systemd unit(s) in failed state: {', '.join(units['failed_units'])}")
    if tasks["stalled"]:
        for s in tasks["stalled"]:
            anomalies.append(f"Task {s['task_id']} checkpoint stale ({s['checkpoint_age_min']} min, threshold {STALE_THRESHOLD_MIN})")
    # 2026-07-20 (constitution-audit gap #3, corrected): this check_tasks()
    # call already counted failed/completed/etc, but nothing computed the
    # RATE or alerted on it -- a 71% all-time failure rate produced zero
    # anomalies here before this. Deliberately reuses this same scheduled
    # run + the same ATTENTION_FILE mechanism rather than a new cron job --
    # a separate reconciliation script+cron was drafted first and found to
    # duplicate this file's existing job before being deployed.
    total_known_tasks = sum(v for k, v in tasks.items() if k != "stalled" and isinstance(v, int))
    failed_count = tasks.get("failed", 0)
    if total_known_tasks >= 5:  # don't alarm on a tiny/early sample
        failure_rate = failed_count / total_known_tasks
        if failure_rate > FAILURE_RATE_THRESHOLD:
            anomalies.append(f"Task failure rate {failure_rate*100:.1f}% ({failed_count}/{total_known_tasks}) "
                              f"above {FAILURE_RATE_THRESHOLD*100:.0f}% threshold")
    if not router.get("reachable"):
        anomalies.append(f"Mother Router DB unreachable: {router.get('error')}")
    if server.get("disk_pct_used") is not None and server["disk_pct_used"] >= 90:
        anomalies.append(f"Disk usage at {server['disk_pct_used']}%")
    if server.get("mem_pct_used") is not None and server["mem_pct_used"] >= 90:
        anomalies.append(f"Memory usage at {server['mem_pct_used']}%")
    if claude_signal["exhaustion_signature_hits"]:
        anomalies.append(f"Possible Claude/API quota exhaustion signature found in {len(claude_signal['exhaustion_signature_hits'])} recent log(s)")

    record = {
        "ts": now,
        "systemd_units": units,
        "tasks": tasks,
        "mother_router": router,
        "server": server,
        "claude_quota_proxy_signal": claude_signal,
        "anomalies": anomalies,
    }

    with open(JSONL_LOG, "a") as f:
        f.write(json.dumps(record) + "\n")

    summary = (f"{now} | units running={units['running']}/{units['total']} failed={units['failed_count']} | "
               f"tasks in_progress={tasks.get('in_progress', 0)} completed={tasks.get('completed', 0)} "
               f"failed={tasks.get('failed', 0)} stalled={len(tasks['stalled'])} | "
               f"router_reachable={router.get('reachable')} | disk={server.get('disk_pct_used')}% mem={server.get('mem_pct_used')}% | "
               f"anomalies={len(anomalies)}")
    with open(TEXT_LOG, "a") as f:
        f.write(summary + "\n")

    if anomalies:
        with open(ATTENTION_FILE, "a") as f:
            f.write(f"\n## {now} -- health-check-15min\n")
            for a in anomalies:
                f.write(f"- {a}\n")

    rotate(JSONL_LOG, MAX_LINES)
    rotate(TEXT_LOG, MAX_LINES)

    print(summary)
    if anomalies:
        print("ANOMALIES:", anomalies, file=sys.stderr)


if __name__ == "__main__":
    main()
