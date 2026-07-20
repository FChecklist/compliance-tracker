#!/usr/bin/env python3
"""
VERIDIAN-DEV AI-OS task/worker manager.
Server-side, self-contained state management for async AI workers that
survive client disconnects, server reboots, and resume from checkpoints
on interruption. See /opt/veridian/README-SERVER.md.
"""
import argparse
import contextlib
import datetime
import fcntl
import json
import os
import re
import subprocess
import sys
import yaml

AI_OS = "/opt/veridian/ai-os"
CONTROLLER = f"{AI_OS}/CONTROLLER.yaml"
CONTROLLER_LOCK = f"{AI_OS}/.controller.lock"
REPOS = "/opt/veridian/repos"


def _auto_log_task_event(kind, task, extra_note=""):
    """Automatic server-side logging to the Superboss Register -- Owner
    directive 2026-07-20: the laptop-side Claude Code hooks
    (.claude/hooks/*.ps1) only cover the interactive session; this is the
    other half -- every AI worker/supervisor/doc-worker task dispatched
    on THIS server, regardless of what created it (queue-dispatcher.py,
    module-queue-dispatcher.py, master-decompose.py, a manual CLI call).
    veridian-task.py is the single choke point every one of those paths
    already goes through for create/checkpoint, so instrumenting it here
    once covers all of them -- same principle as the interactive hooks,
    applied to the dispatch layer instead of the chat layer.

    Reuses superboss-register.py's own tested CLI exactly (log-work /
    log-action) rather than a second, parallel write path. Runs entirely
    on this server, so there is no network-latency concern the laptop
    hooks had to design around.

    MUST NEVER break real task lifecycle management, which is this
    script's actual job -- a logging failure here is swallowed, never
    raised, never blocks task create/checkpoint.
    """
    try:
        if kind == "create":
            subprocess.run(
                ["python3", "/opt/veridian/scripts/superboss-register.py", "log-work",
                 "--ai-task-id", task["id"], "--source", "software", "--medium", "veridian_task_cli",
                 "--campaign", "auto-worker-task-log", "--content", f"task_create:{task['title'][:60]}",
                 "--term", "auto_log,worker_task,create,software",
                 "--status", task["status"]],
                capture_output=True, timeout=10,
            )
        elif kind == "checkpoint":
            subprocess.run(
                ["python3", "/opt/veridian/scripts/superboss-register.py", "log-action",
                 "--source", "ai_agent", "--medium", "veridian_task_cli",
                 "--campaign", "auto-worker-task-log",
                 "--content", f"task_checkpoint:{task['id']} status={task['status']}",
                 "--term", "auto_log,worker_task,checkpoint",
                 "--result", (extra_note or "")[:500]],
                capture_output=True, timeout=10,
            )
        elif kind == "record_usage":
            subprocess.run(
                ["python3", "/opt/veridian/scripts/superboss-register.py", "log-action",
                 "--source", "ai_agent", "--medium", "veridian_task_cli",
                 "--campaign", "auto-worker-task-log",
                 "--content", f"task_usage:{task['id']}",
                 "--term", "auto_log,worker_task,record_usage,cost",
                 "--result", (extra_note or "")[:500]],
                capture_output=True, timeout=10,
            )
    except Exception:
        pass


def now():
    return datetime.datetime.now(datetime.timezone.utc).isoformat()


@contextlib.contextmanager
def controller_lock():
    """Exclusive OS-level lock so concurrent workers/supervisors can't
    interleave read-modify-write cycles on CONTROLLER.yaml (root cause of
    the 2026-07-18 corruption -- two processes both read, both modified,
    both wrote, second write silently clobbered/interleaved with the first).
    """
    with open(CONTROLLER_LOCK, "w") as lockfile:
        fcntl.flock(lockfile, fcntl.LOCK_EX)
        try:
            yield
        finally:
            fcntl.flock(lockfile, fcntl.LOCK_UN)


def load_controller():
    with open(CONTROLLER) as f:
        return yaml.safe_load(f) or {"server": "VERIDIAN-DEV", "tasks": []}


def save_controller(ctrl):
    ctrl["updated_at"] = now()
    ctrl["task_count"] = len(ctrl["tasks"])
    # Atomic write (temp file + rename) so a reader can never observe a
    # partially-written file, even without holding the lock itself.
    tmp_path = f"{CONTROLLER}.tmp.{os.getpid()}"
    with open(tmp_path, "w") as f:
        yaml.safe_dump(ctrl, f, sort_keys=False, default_flow_style=False)
    os.replace(tmp_path, CONTROLLER)


def load_task(task_id):
    path = f"{AI_OS}/tasks/{task_id}/task.yaml"
    with open(path) as f:
        return yaml.safe_load(f)


def save_task(task_id, task):
    path = f"{AI_OS}/tasks/{task_id}/task.yaml"
    tmp_path = f"{path}.tmp.{os.getpid()}"
    with open(tmp_path, "w") as f:
        yaml.safe_dump(task, f, sort_keys=False, default_flow_style=False)
    os.replace(tmp_path, path)


@contextlib.contextmanager
def task_lock(task_id):
    lock_path = f"{AI_OS}/tasks/{task_id}/.task.lock"
    with open(lock_path, "w") as lockfile:
        fcntl.flock(lockfile, fcntl.LOCK_EX)
        try:
            yield
        finally:
            fcntl.flock(lockfile, fcntl.LOCK_UN)


def sync_controller_entry(task):
    with controller_lock():
        ctrl = load_controller()
        entry = {
            "id": task["id"],
            "title": task["title"],
            "status": task["status"],
            "repo": task["repo"],
            "branch": task["branch"],
            "created_at": task["created_at"],
            "last_checkpoint_at": task.get("last_checkpoint_at"),
            "service": task["service"],
            "task_dir": task["task_dir"],
            "execution_seconds": task.get("execution_seconds", 0),
            "restart_count": task.get("restart_count", 0),
        }
        ctrl["tasks"] = [t for t in ctrl["tasks"] if t["id"] != task["id"]] + [entry]
        save_controller(ctrl)


def parse_progress_md(workspace):
    """Parses a PROGRESS.md with '## Completed' / '## Remaining' checklist sections."""
    path = os.path.join(workspace, "PROGRESS.md")
    if not os.path.isfile(path):
        return None, None
    text = open(path).read()
    sections = re.split(r"^##\s+", text, flags=re.MULTILINE)
    completed, remaining = [], []
    for sec in sections:
        if sec.lower().startswith("completed"):
            completed = re.findall(r"^\s*-\s*\[[xX ]\]\s*(.+)$", sec, re.MULTILINE)
        elif sec.lower().startswith("remaining"):
            remaining = re.findall(r"^\s*-\s*\[[xX ]\]\s*(.+)$", sec, re.MULTILINE)
    return completed, remaining


def cmd_create(args):
    ts = datetime.datetime.now().strftime("%Y%m%d-%H%M%S")
    slug = "".join(c if c.isalnum() else "-" for c in args.title.lower())[:40].strip("-")
    task_id = f"task-{ts}-{slug}"
    task_dir = f"{AI_OS}/tasks/{task_id}"
    workspace = f"{task_dir}/workspace"
    branch = f"worker/{task_id}"
    repo_path = f"{REPOS}/{args.repo}"

    if not os.path.isdir(repo_path):
        print(f"ERROR: repo not found at {repo_path}")
        sys.exit(1)

    os.makedirs(task_dir, exist_ok=True)

    subprocess.run(["git", "-C", repo_path, "fetch", "origin"], check=True)
    default_ref = subprocess.run(
        ["git", "-C", repo_path, "symbolic-ref", "refs/remotes/origin/HEAD"],
        capture_output=True, text=True, check=True,
    ).stdout.strip()
    default_branch = default_ref.rsplit("/", 1)[-1]
    subprocess.run(
        ["git", "-C", repo_path, "worktree", "add", "-b", branch, workspace, f"origin/{default_branch}"],
        check=True,
    )

    # Reset PROGRESS.md: it is committed to main by each merged task, so a
    # fresh worktree otherwise inherits the PREVIOUS task's "complete"
    # content, which the checkpoint/resume-context flow would misreport as
    # this task's own status. Give every task a clean, task-scoped stub.
    progress_path = os.path.join(workspace, "PROGRESS.md")
    with open(progress_path, "w") as pf:
        pf.write(
            "# PROGRESS -- " + task_id + "\n\n"
            "## Completed\n\n"
            "## Remaining\n"
            "- [ ] Not started\n"
        )

    with open(f"{task_dir}/prompt.txt", "w") as f:
        f.write(args.prompt)

    task = {
        "id": task_id,
        "title": args.title,
        "status": "pending",
        "repo": args.repo,
        "branch": branch,
        "workspace": workspace,
        "task_dir": task_dir,
        "service": f"veridian-worker@{task_id}.service",
        "created_at": now(),
        "last_checkpoint_at": None,
        "completed_steps": [],
        "remaining_steps": [],
        "files_modified": [],
        "checkpoints": [],
        "execution_seconds": 0,
        "restart_count": 0,
        "token_usage": None,
    }
    save_task(task_id, task)
    sync_controller_entry(task)
    _auto_log_task_event("create", task, extra_note=f"repo={args.repo}")

    subprocess.run(["systemctl", "--user", "daemon-reload"], check=True)
    # enable (not just start): survives server reboot via linger + WantedBy=default.target
    subprocess.run(["systemctl", "--user", "enable", task["service"]], check=True)
    subprocess.run(["systemctl", "--user", "start", task["service"]], check=True)

    print(f"CREATED: {task_id}")
    print(f"service: {task['service']} (enabled — will auto-start on server reboot)")
    print(f"workspace: {workspace}")


def cmd_checkpoint(args):
    with task_lock(args.task_id):
        task = load_task(args.task_id)
        task["last_checkpoint_at"] = now()
        if args.status:
            if args.status == "in_progress" and task["status"] != "pending":
                task["restart_count"] = task.get("restart_count", 0) + 1
            task["status"] = args.status

        workspace = task["workspace"]
        log_out = ""
        if os.path.isdir(workspace):
            try:
                status_out = subprocess.run(
                    ["git", "-C", workspace, "status", "--porcelain"],
                    capture_output=True, text=True, check=True,
                ).stdout
                files = [line[3:] for line in status_out.splitlines() if line.strip()]
                task["files_modified"] = files
                log_out = subprocess.run(
                    ["git", "-C", workspace, "log", "--oneline", "-10"],
                    capture_output=True, text=True, check=True,
                ).stdout
                completed, remaining = parse_progress_md(workspace)
                if completed is not None:
                    task["completed_steps"] = completed
                if remaining is not None:
                    task["remaining_steps"] = remaining
            except subprocess.CalledProcessError:
                pass

        checkpoint = {
            "at": task["last_checkpoint_at"],
            "status": task["status"],
            "files_modified": task["files_modified"],
            "completed_steps": task.get("completed_steps", []),
            "remaining_steps": task.get("remaining_steps", []),
            "recent_commits": log_out.strip().splitlines(),
            "note": args.note or "",
        }
        task.setdefault("checkpoints", []).append(checkpoint)
        save_task(args.task_id, task)
    sync_controller_entry(task)
    _auto_log_task_event("checkpoint", task, extra_note=args.note or f"files_modified={len(task.get('files_modified', []))}")
    print(f"CHECKPOINT saved for {args.task_id}: status={task['status']}")


def cmd_resume_context(args):
    task = load_task(args.task_id)
    checkpoints = task.get("checkpoints", [])
    if not checkpoints:
        print("(no prior checkpoint — this is a fresh start)")
        return
    last = checkpoints[-1]
    print(f"Last checkpoint at {last['at']} (status was: {last['status']})")
    if last.get("note"):
        print(f"Note: {last['note']}")
    if last.get("completed_steps"):
        print("Completed so far:")
        for s in last["completed_steps"]:
            print(f"  - {s}")
    if last.get("remaining_steps"):
        print("Remaining (per last known plan):")
        for s in last["remaining_steps"]:
            print(f"  - {s}")
    if last.get("files_modified"):
        print(f"Files with uncommitted changes at last checkpoint: {', '.join(last['files_modified'])}")
    if last.get("recent_commits"):
        print("Recent commits:")
        for c in last["recent_commits"]:
            print(f"  {c}")


def cmd_record_usage(args):
    with task_lock(args.task_id):
        task = load_task(args.task_id)
        task["execution_seconds"] = task.get("execution_seconds", 0) + args.elapsed
        result_path = f"{task['task_dir']}/result.json"
        if os.path.isfile(result_path):
            try:
                with open(result_path) as f:
                    result = json.load(f)
                usage = result.get("usage") or result.get("total_cost_usd")
                if usage:
                    task["token_usage"] = usage
            except (json.JSONDecodeError, ValueError):
                pass
        save_task(args.task_id, task)
    sync_controller_entry(task)
    _auto_log_task_event("record_usage", task, extra_note=f"+{args.elapsed}s total={task['execution_seconds']}s usage={task.get('token_usage')}")
    print(f"USAGE recorded for {args.task_id}: +{args.elapsed}s (total {task['execution_seconds']}s)")


def cmd_status(args):
    ctrl = load_controller()
    tasks = ctrl.get("tasks", [])
    if not tasks:
        print("No tasks recorded.")
        return
    by_status = {}
    for t in tasks:
        by_status.setdefault(t["status"], []).append(t)
    order = ["in_progress", "pending", "pending_review", "awaiting_human_approval", "blocked", "failed", "completed"]
    for status in order:
        items = by_status.pop(status, [])
        if not items:
            continue
        print(f"\n=== {status.upper()} ({len(items)}) ===")
        for t in items:
            print(f"  {t['id']}  [{t['repo']}:{t['branch']}]  {t['title']}")
            print(f"    last checkpoint: {t.get('last_checkpoint_at')}  restarts: {t.get('restart_count', 0)}  exec_seconds: {t.get('execution_seconds', 0)}")
    for status, items in by_status.items():
        print(f"\n=== {status.upper()} ({len(items)}) ===")
        for t in items:
            print(f"  {t['id']}  {t['title']}")


if __name__ == "__main__":
    p = argparse.ArgumentParser()
    sub = p.add_subparsers(dest="cmd", required=True)

    c = sub.add_parser("create")
    c.add_argument("--title", required=True)
    c.add_argument("--repo", required=True)
    c.add_argument("--prompt", required=True)
    c.set_defaults(func=cmd_create)

    ck = sub.add_parser("checkpoint")
    ck.add_argument("task_id")
    ck.add_argument("--status", default=None)
    ck.add_argument("--note", default=None)
    ck.add_argument("--auto", action="store_true")
    ck.set_defaults(func=cmd_checkpoint)

    rc = sub.add_parser("resume-context")
    rc.add_argument("task_id")
    rc.set_defaults(func=cmd_resume_context)

    ru = sub.add_parser("record-usage")
    ru.add_argument("task_id")
    ru.add_argument("--elapsed", type=int, required=True)
    ru.set_defaults(func=cmd_record_usage)

    st = sub.add_parser("status")
    st.set_defaults(func=cmd_status)

    args = p.parse_args()
    args.func(args)
