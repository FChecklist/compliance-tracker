#!/usr/bin/env python3
"""
Autonomous dispatcher for /opt/veridian/ai-os/gap_queue.yaml. Run via cron.
1. Syncs status of already-dispatched queue items from their task's real
   current status (completed/blocked/failed/etc).
2. Counts currently-running workers; if under the concurrency cap, pulls
   the next queued item(s), checks for an existing open PR/branch on
   similar scope first (best-effort duplication guard), builds a task
   prompt from the CSV-derived findings, and dispatches it.
Never touches more than CONCURRENCY_CAP workers at once. File-locked so a
slow run can't overlap with the next cron tick.
"""
import contextlib
import fcntl
import glob
import re
import subprocess
import sys
import yaml

QUEUE_PATH = "/opt/veridian/ai-os/gap_queue.yaml"
LOCK_PATH = "/opt/veridian/ai-os/.gap_queue.lock"
AI_OS_TASKS = "/opt/veridian/ai-os/tasks"
REPO = "compliance-tracker"
REPO_PATH = f"/opt/veridian/repos/{REPO}"
CONCURRENCY_CAP = 5  # raised 2026-07-20 (Owner: ~80% capacity on this 8-core box; was 3)
MAX_RETRIES = 3
TASK_MANAGER = "/opt/veridian/scripts/veridian-task.py"


@contextlib.contextmanager
def queue_lock():
    with open(LOCK_PATH, "w") as f:
        fcntl.flock(f, fcntl.LOCK_EX)
        try:
            yield
        finally:
            fcntl.flock(f, fcntl.LOCK_UN)


def run(cmd, **kw):
    return subprocess.run(cmd, capture_output=True, text=True, **kw)


def load_queue():
    with open(QUEUE_PATH) as f:
        return yaml.safe_load(f)


def save_queue(doc):
    tmp = f"{QUEUE_PATH}.tmp"
    with open(tmp, "w") as f:
        yaml.safe_dump(doc, f, sort_keys=False, default_flow_style=False, allow_unicode=True)
    import os
    os.replace(tmp, QUEUE_PATH)


def running_worker_count():
    r = run(["systemctl", "--user", "list-units", "veridian-worker@*", "--state=running", "--no-legend"])
    lines = [l for l in r.stdout.splitlines() if l.strip()]
    return len(lines)


def task_status(task_id):
    path = f"{AI_OS_TASKS}/{task_id}/task.yaml"
    try:
        with open(path) as f:
            return yaml.safe_load(f).get("status")
    except FileNotFoundError:
        return None


TERMINAL_GOOD = {"completed"}
TERMINAL_BAD = {"blocked", "failed"}
TERMINAL_HOLD = {"awaiting_human_approval"}


def sync_dispatched_statuses(doc):
    changed = False
    for item in doc["queue"]:
        if item["status"] == "dispatched" and item.get("task_id"):
            s = task_status(item["task_id"])
            if s in TERMINAL_GOOD:
                item["status"] = "completed"
                changed = True
            elif s in TERMINAL_BAD:
                item["retry_count"] = item.get("retry_count", 0) + 1
                if item["retry_count"] >= MAX_RETRIES:
                    item["status"] = "stuck_needs_human"
                else:
                    item["status"] = "needs_retry"
                changed = True
            elif s in TERMINAL_HOLD:
                item["status"] = "awaiting_human_approval"
                changed = True
    return changed


def existing_scope_conflict(category, sub_category):
    """Best-effort duplication guard: check open PR titles and branch names
    for the same category/sub_category wording before dispatching."""
    needle = sub_category.lower()[:20]
    r = run(["gh", "pr", "list", "--repo", f"FChecklist/{REPO}", "--state", "open",
             "--json", "title", "-q", ".[].title"])
    if needle in r.stdout.lower():
        return True
    r = run(["git", "-C", REPO_PATH, "for-each-ref", "--format=%(refname:short)", "refs/remotes/origin"])
    slug = re.sub(r"[^a-z0-9]+", "-", sub_category.lower()).strip("-")[:20]
    if slug and slug in r.stdout.lower():
        return True
    return False


def build_prompt(item):
    # 2026-07-20: an item may carry a pre-written, already-scoped prompt
    # (e.g. one of the 25 V2 implementation-plan tasks, which already have
    # a real TASK ID/READ FIRST/WHAT TO BUILD/DONE CRITERIA shape) -- use it
    # verbatim instead of forcing it through the generic CSV-finding format
    # below, which was designed for raw framework rows, not pre-scoped tasks.
    if item.get("full_prompt"):
        return item["full_prompt"]
    lines = [
        f"VERIDIAN Review Framework gap-closure: {item['category']} / {item['sub_category']}.",
        f"This covers {item['row_count']} related finding(s) from the framework evaluation. "
        "Close all of them in one coherent PR if they share the same module/area -- do not "
        "create a separate PR per finding if they're naturally one piece of work.",
        "",
        "Findings to address:",
    ]
    for f in item["findings"]:
        lines.append(f"- [{f['severity']}] {f['parameter']}")
        if f["gap_identified"]:
            lines.append(f"  Gap: {f['gap_identified']}")
        if f["recommended_approach"]:
            lines.append(f"  Recommended approach: {f['recommended_approach']}")
    lines += [
        "",
        "Before writing any code: read the actual current implementation of the "
        "relevant module(s) first -- do not assume the gap description is still "
        "accurate, the codebase has moved since this evaluation was written. If a "
        "finding turns out to already be resolved, or the described gap doesn't "
        "match what you find in the code, say so in PROGRESS.md rather than making "
        "an unnecessary change.",
        "Do not touch src/lib/services/permission-service.ts's shared "
        "ERP_ACTION_ROLES table structure or any other in-flight worker's declared "
        "scope -- if your area genuinely needs a new permission-service entry, add "
        "it additively (new keys only).",
        "Maintain PROGRESS.md with '## Completed' / '## Remaining' checklists as usual.",
    ]
    return "\n".join(lines)


def dispatch(item):
    was_retry = item["status"] == "needs_retry"
    title = f"{item['category']}: {item['sub_category']}"[:80]
    if was_retry:
        title = f"[retry {item.get('retry_count', 0)}] {title}"[:80]
    prompt = build_prompt(item)
    r = run([sys.executable, TASK_MANAGER, "create", "--repo", REPO, "--title", title, "--prompt", prompt])
    print(r.stdout)
    print(r.stderr, file=sys.stderr)
    m = re.search(r"^CREATED: (\S+)", r.stdout, re.MULTILINE)
    if m:
        item["task_id"] = m.group(1)
        item["status"] = "dispatched"
        return True
    item["status"] = "dispatch_failed"
    return False


def main():
    with queue_lock():
        doc = load_queue()

        if doc.get("dispatch_paused"):
            print(f"PAUSED: {doc.get("pause_reason", "no reason recorded")}")
            print(f"Held task_ids: {len(doc.get("held_task_ids", []))} -- dispatching nothing this run.")
            return

        changed = sync_dispatched_statuses(doc)

        running = running_worker_count()
        slots = CONCURRENCY_CAP - running
        print(f"Running workers: {running}, free slots: {slots}")

        if slots > 0:
            queued = [it for it in doc["queue"] if it["status"] in ("queued", "needs_retry")]
            for item in queued[:slots]:
                if existing_scope_conflict(item["category"], item["sub_category"]):
                    print(f"SKIP (possible duplicate scope): {item['id']}")
                    item["status"] = "skipped_possible_duplicate"
                    changed = True
                    continue
                print(f"Dispatching: {item['id']}")
                dispatch(item)
                changed = True

        if changed:
            save_queue(doc)

        completed = sum(1 for it in doc["queue"] if it["status"] == "completed")
        total = len(doc["queue"])
        print(f"PROGRESS: {completed}/{total} groups completed")


if __name__ == "__main__":
    main()
