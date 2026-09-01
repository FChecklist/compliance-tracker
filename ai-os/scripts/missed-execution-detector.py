#!/usr/bin/env python3
"""
Missed-Execution Detector -- audit198 ARTICLE-083 gap closure
("Every scheduled job shall detect missed executions and recover
automatically whenever feasible").

Owner directive 2026-07-21 (audit198 gap-closure wave, MONITORING_INFRA /
TRACEABILITY_AUDIT_LOGGING / RECOVERY_RESILIENCE cluster). Per
AI_ENGINEERING_POLICY.yaml's "prefer existing wrapper over new parallel
mechanism": this is deliberately an EXTENSION of the execution-logging
pipeline already built the same session (run-logged.sh + superboss-
register.py's `actions` table), not a second, parallel logging/scheduling
system. It reuses:
  - the SAME crontab as the single source of truth for what "scheduled"
    means and what the real recovery command is (no separate job
    registry to drift out of sync with cron),
  - the SAME superboss-register.py `actions` table (job_start/job_end
    rows already written by run-logged.sh) as the SAME source of truth
    for "did this job actually run," read directly (read-only) rather
    than re-implemented,
  - the SAME run-logged.sh wrapper to perform the actual recovery re-run,
    so a recovered execution is logged exactly like a normal one (no
    special-cased log format for recovered runs).

This script itself is meant to be invoked BY cron, wrapped in
run-logged.sh like every other job, e.g.:
    */20 * * * * /opt/veridian/scripts/run-logged.sh "missed-execution-detector" \
        /usr/bin/python3 /opt/veridian/scripts/missed-execution-detector.py \
        >> /opt/veridian/ai-os/logs/missed-execution-detector-cron.log 2>&1

Canonical copy lives in this repo at ai-os/scripts/missed-execution-detector.py
(git-reviewed, PR'd) and is mirrored to /opt/veridian/scripts/ (the same
untracked-ops-script directory run-logged.sh and superboss-register.py
already live in) so cron can invoke a stable path independent of which
git branch happens to be checked out in any given worktree. Keep the two
copies identical; the in-repo copy is the source of truth.

Deliberately conservative about what counts as "missed": a job is only
flagged if its own logged interval (derived from ITS OWN crontab
schedule field, not a hardcoded assumption) has been exceeded by a
2x-plus-10-minute grace window, which absorbs normal jitter/overlap
without either false-positiving on every run or silently ignoring a
genuinely stuck/skipped job.
"""
import json
import os
import re
import shlex
import sqlite3
import subprocess
import sys
from datetime import datetime, timezone

DB_PATH = os.environ.get(
    "SUPERBOSS_REGISTER_DB", "/opt/veridian/ai-os/memory/superboss-register.sqlite"
)
REGISTER_SCRIPT = os.environ.get(
    "SUPERBOSS_REGISTER_SCRIPT", "/opt/veridian/scripts/superboss-register.py"
)
RUN_LOGGED = os.environ.get("RUN_LOGGED_SH", "/opt/veridian/scripts/run-logged.sh")

# This detector must never treat itself as a job it can detect-as-missed
# and "recover" -- that would be a self-triggering loop.
SELF_JOB_NAME = "missed-execution-detector"

# grace multiplier + fixed floor (minutes) applied on top of a job's own
# derived interval before it is considered missed, not just late.
GRACE_MULTIPLIER = 2
GRACE_FLOOR_MIN = 10

RUN_LOGGED_RE = re.compile(
    r'run-logged\.sh\s+"([^"]+)"\s+(.*)$'
)


def _now():
    return datetime.now(timezone.utc)


def _parse_iso(ts: str):
    # superboss-register.py writes datetime.now(timezone.utc).isoformat(),
    # which may or may not include microseconds -- handle both.
    try:
        return datetime.fromisoformat(ts)
    except ValueError:
        return None


def get_crontab_lines():
    try:
        out = subprocess.run(
            ["crontab", "-l"], capture_output=True, text=True, check=True
        ).stdout
    except (subprocess.CalledProcessError, FileNotFoundError):
        return []
    return out.splitlines()


def estimate_interval_minutes(minute_f, hour_f):
    """Heuristic cron-interval estimator covering every pattern actually
    present in this server's crontab today (*/N minute, */N hour, fixed
    minute+hour daily, fixed minute hourly). Not a full cron-expression
    engine -- deliberately scoped to what this server's real crontab uses,
    documented so a future genuinely novel schedule shape is easy to add
    a branch for rather than silently mis-estimated."""
    if minute_f.startswith("*/") and hour_f == "*":
        return int(minute_f[2:])
    if minute_f.isdigit() and hour_f.startswith("*/"):
        return int(hour_f[2:]) * 60
    if minute_f.isdigit() and hour_f == "*":
        return 60
    if minute_f.isdigit() and hour_f.isdigit():
        return 24 * 60
    # Unrecognized shape -- fall back to a conservative daily assumption
    # rather than guessing something tighter and false-positiving.
    return 24 * 60


def discover_jobs():
    """Returns {job_name: {"command": [...], "interval_min": int}} for
    every crontab line that runs through run-logged.sh -- i.e. every job
    this detector has both (a) a known name to look up in the register
    and (b) a real command it could re-invoke to recover."""
    jobs = {}
    for line in get_crontab_lines():
        stripped = line.strip()
        if not stripped or stripped.startswith("#") or "=" in stripped.split(" ", 1)[0] and stripped.split(" ", 1)[0].isupper():
            # skip comments and bare VAR=value lines (e.g. XDG_RUNTIME_DIR=...)
            if not stripped.startswith("#"):
                pass
            else:
                continue
        parts = stripped.split(None, 5)
        if len(parts) < 6:
            continue
        minute_f, hour_f, _dom, _mon, _dow, rest = parts
        m = RUN_LOGGED_RE.search(rest)
        if not m:
            continue
        job_name, tail_cmd = m.group(1), m.group(2)
        if job_name == SELF_JOB_NAME:
            continue
        # Strip a trailing shell redirect (`>> file 2>&1`) -- keep the
        # real command runnable standalone via run-logged.sh again.
        tail_cmd_clean = re.sub(r"\s*>>?\s*\S+(\s+2>&1)?\s*$", "", tail_cmd).strip()
        try:
            cmd_argv = shlex.split(tail_cmd_clean)
        except ValueError:
            continue
        jobs[job_name] = {
            "command": cmd_argv,
            "interval_min": estimate_interval_minutes(minute_f, hour_f),
            "schedule": f"{minute_f} {hour_f} {_dom} {_mon} {_dow}",
        }
    return jobs


def latest_action_ts(conn, job_name, kind):
    """kind: 'job_start' or 'job_end'. Returns (ts_str, raw_row) of the
    most recent matching action, or (None, None)."""
    like = f"{kind}:{job_name} %"
    row = conn.execute(
        "SELECT ts, utm_content, result FROM actions "
        "WHERE utm_content LIKE ? ORDER BY ts DESC LIMIT 1",
        (like,),
    ).fetchone()
    if row is None:
        return None, None
    return row[0], row


def log_action(content, term, result):
    try:
        subprocess.run(
            [
                sys.executable, REGISTER_SCRIPT, "log-action",
                "--source", "software",
                "--medium", "cron_systemd_wrapper",
                "--campaign", "missed-execution-detector",
                "--content", content,
                "--term", term,
                "--result", result,
            ],
            capture_output=True, text=True, timeout=10, check=False,
        )
    except Exception:
        # Logging is best-effort, same fail-open posture as run-logged.sh
        # itself -- a logging hiccup must never block real recovery work.
        pass


def attempt_recovery(job_name, command):
    try:
        proc = subprocess.run(
            [RUN_LOGGED, job_name, *command],
            capture_output=True, text=True, timeout=600, check=False,
        )
        return proc.returncode
    except Exception as exc:
        return f"recovery_invocation_error:{exc}"


def main():
    if not os.path.exists(DB_PATH):
        print(json.dumps({"status": "skipped", "reason": f"register DB not found at {DB_PATH}"}))
        return 0

    jobs = discover_jobs()
    conn = sqlite3.connect(f"file:{DB_PATH}?mode=ro", uri=True, timeout=10)
    now = _now()

    report = []
    any_unrecovered = False

    for job_name, meta in jobs.items():
        threshold_min = max(meta["interval_min"] * GRACE_MULTIPLIER, meta["interval_min"] + GRACE_FLOOR_MIN)

        start_ts, _ = latest_action_ts(conn, job_name, "job_start")
        end_ts, end_row = latest_action_ts(conn, job_name, "job_end")

        if start_ts is None and end_ts is None:
            report.append({"job": job_name, "status": "NEVER_OBSERVED", "schedule": meta["schedule"]})
            continue

        # Currently mid-run: latest start is newer than latest end (or no
        # end yet at all). Give it room -- do not treat an in-flight job
        # as missed, and never launch an overlapping recovery run.
        running = start_ts is not None and (end_ts is None or start_ts > end_ts)
        if running:
            start_dt = _parse_iso(start_ts)
            in_flight_min = (now - start_dt).total_seconds() / 60 if start_dt else 0
            if in_flight_min < threshold_min:
                report.append({"job": job_name, "status": "RUNNING", "in_flight_min": round(in_flight_min, 1)})
                continue
            # Started but never completed, and well past its own
            # threshold -- treat exactly like a missed execution below
            # (falls through using start_ts as the "last known activity").
            last_known = start_dt
            reason = "started_but_never_completed"
        else:
            last_known = _parse_iso(end_ts)
            reason = "interval_exceeded"

        if last_known is None:
            report.append({"job": job_name, "status": "UNPARSEABLE_TIMESTAMP"})
            continue

        gap_min = (now - last_known).total_seconds() / 60
        if gap_min <= threshold_min:
            report.append({"job": job_name, "status": "OK", "gap_min": round(gap_min, 1), "threshold_min": threshold_min})
            continue

        # -- Missed execution detected --
        log_action(
            content=f"missed_execution_detected:{job_name}",
            term=f"missed_execution,auto_recovery,{job_name}",
            result=f"reason={reason} gap_min={round(gap_min, 1)} threshold_min={threshold_min} expected_interval_min={meta['interval_min']} last_known={last_known.isoformat()}",
        )

        recovery_code = attempt_recovery(job_name, meta["command"])
        recovered = recovery_code == 0
        if not recovered:
            any_unrecovered = True

        log_action(
            content=f"missed_execution_recovery_attempted:{job_name}",
            term=f"missed_execution,auto_recovery,{job_name},{'recovered' if recovered else 'recovery_failed'}",
            result=f"recovery_exit_code={recovery_code}",
        )

        report.append({
            "job": job_name,
            "status": "RECOVERED" if recovered else "RECOVERY_FAILED",
            "gap_min": round(gap_min, 1),
            "threshold_min": threshold_min,
            "recovery_exit_code": recovery_code,
        })

    conn.close()
    print(json.dumps({"checked_at": now.isoformat(), "jobs": report}, indent=2))
    return 1 if any_unrecovered else 0


if __name__ == "__main__":
    sys.exit(main())
