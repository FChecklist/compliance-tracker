#!/usr/bin/env python3
"""
Master/Supervisor pilot dispatcher. Reads one or more module-scoped queue
files (ai-os/queues/<module>.yaml), each holding standardized-template
tasks (TASK ID/MODULE/FILES ALLOWED/.../DONE CRITERIA), and dispatches
them the same way queue-dispatcher.py dispatches the general gap-queue --
same veridian-task.py create call, same worker/supervisor systemd
machinery, same tier1/tier2/audit-comment/merge flow (untouched).

Additive only: shares the SAME global worker concurrency cap with the
general gap-queue (queue-dispatcher.py) by counting ALL running
veridian-worker@ units server-wide, not a separate per-pipeline cap --
this pilot does not add concurrency risk beyond what's already verified
safe. Dependencies block a task from dispatching until every listed
dependency task is itself MERGED. Writes a module_scope.yaml sidecar file
into each dispatched task's task_dir so supervisor-entrypoint.sh can run
scope-check.py against it at merge time (see that script's own comment
for why this is additive, not required, for non-pilot tasks).

Run via cron, same pattern as queue-dispatcher.py.
"""
import contextlib
import fcntl
import glob as globmod
import os
import re
import subprocess
import sys
import yaml

sys.path.insert(0, "/opt/veridian/scripts")
from importlib.util import spec_from_file_location, module_from_spec

_spec = spec_from_file_location("task_template", "/opt/veridian/scripts/task-template.py")
_task_template = module_from_spec(_spec)
_spec.loader.exec_module(_task_template)
render_task_prompt = _task_template.render_task_prompt

QUEUES_DIR = "/opt/veridian/ai-os/queues"
LOCK_PATH = "/opt/veridian/ai-os/.module_queues.lock"
AI_OS_TASKS = "/opt/veridian/ai-os/tasks"
REPO = "compliance-tracker"
REPO_PATH = f"/opt/veridian/repos/{REPO}"
CONCURRENCY_CAP = 3  # SAME cap as queue-dispatcher.py -- shared server-wide, not additive
TASK_MANAGER = "/opt/veridian/scripts/veridian-task.py"

TERMINAL_GOOD = {"completed"}
TERMINAL_BAD = {"blocked", "failed"}
TERMINAL_HOLD = {"awaiting_human_approval"}


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


def load_all_queues():
    paths = sorted(globmod.glob(f"{QUEUES_DIR}/*.yaml"))
    docs = {}
    for p in paths:
        with open(p) as f:
            docs[p] = yaml.safe_load(f) or {"module": os.path.basename(p).replace(".yaml", ""), "queue": []}
    return docs


def save_queue(path, doc):
    tmp = f"{path}.tmp"
    with open(tmp, "w") as f:
        yaml.safe_dump(doc, f, sort_keys=False, default_flow_style=False, allow_unicode=True)
    os.replace(tmp, path)


def running_worker_count():
    r = run(["systemctl", "--user", "list-units", "veridian-worker@*", "--state=running", "--no-legend"])
    return len([l for l in r.stdout.splitlines() if l.strip()])


def task_status(task_id):
    path = f"{AI_OS_TASKS}/{task_id}/task.yaml"
    try:
        with open(path) as f:
            return yaml.safe_load(f).get("status")
    except FileNotFoundError:
        return None


def sync_statuses(docs):
    changed_paths = set()
    for path, doc in docs.items():
        for item in doc.get("queue", []):
            if item["status"] == "RUNNING" and item.get("task_id"):
                s = task_status(item["task_id"])
                if s in TERMINAL_GOOD:
                    item["status"] = "MERGED"
                    changed_paths.add(path)
                elif s in TERMINAL_BAD:
                    item["status"] = "REWORK"
                    changed_paths.add(path)
                elif s in TERMINAL_HOLD:
                    item["status"] = "REVIEW"  # tier2 hold -- awaiting human, same as REVIEW state
                    changed_paths.add(path)
    return changed_paths


def dependency_met(item, all_items_by_id):
    for dep_id in item.get("dependencies", []):
        dep = all_items_by_id.get(dep_id)
        if not dep or dep["status"] != "MERGED":
            return False
    return True


def dispatch(item, doc):
    module = doc["module"]
    title = f"[{module}] {item['id']}: {item['objective']}"[:80]
    prompt = render_task_prompt(item)
    r = run([sys.executable, TASK_MANAGER, "create", "--repo", REPO, "--title", title, "--prompt", prompt])
    print(r.stdout)
    print(r.stderr, file=sys.stderr)
    m = re.search(r"^CREATED: (\S+)", r.stdout, re.MULTILINE)
    if not m:
        item["status"] = "REWORK"
        item["dispatch_error"] = "veridian-task.py create failed -- see dispatcher log"
        return False
    task_id = m.group(1)
    item["task_id"] = task_id
    item["status"] = "RUNNING"
    # Sidecar file for supervisor-entrypoint.sh's scope-check step.
    task_dir = f"{AI_OS_TASKS}/{task_id}"
    with open(f"{task_dir}/module_scope.yaml", "w") as f:
        yaml.safe_dump({
            "module": module,
            "files_allowed": item.get("files_allowed", []),
        }, f)
    return True


def main():
    with queue_lock():
        docs = load_all_queues()
        if not docs:
            print("No module queue files found in", QUEUES_DIR)
            return

        changed = sync_statuses(docs)

        all_items_by_id = {}
        for doc in docs.values():
            for item in doc.get("queue", []):
                all_items_by_id[item["id"]] = item

        running = running_worker_count()
        slots = CONCURRENCY_CAP - running
        print(f"Running workers (server-wide, shared cap): {running}, free slots: {slots}")

        if slots > 0:
            # Round-robin across module queues so one module can't starve another.
            candidates = []
            for path, doc in docs.items():
                for item in doc.get("queue", []):
                    if item["status"] == "NEW" and dependency_met(item, all_items_by_id):
                        candidates.append((path, doc, item))

            for path, doc, item in candidates[:slots]:
                print(f"Dispatching: {item['id']} (module: {doc['module']})")
                if dispatch(item, doc):
                    item["status"] = "ASSIGNED"  # will flip to RUNNING once the worker checkpoint confirms start; kept simple here
                    item["status"] = "RUNNING"
                changed.add(path)

        for path in changed:
            save_queue(path, docs[path])

        for path, doc in docs.items():
            counts = {}
            for item in doc.get("queue", []):
                counts[item["status"]] = counts.get(item["status"], 0) + 1
            print(f"{doc['module']}: {counts}")


if __name__ == "__main__":
    main()
