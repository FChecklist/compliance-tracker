import sys

path = sys.argv[1]
with open(path, "r") as f:
    content = f.read()

old = '''def run_check_duplicate_battery(task_identity, title, prompt):
    """Real, confirmed gap closed (Stage 5, 2026-07-29): this module used to go
    straight from find_in_flight_duplicate() above to resource_governor.py
    --submit, bypassing task-gateway.py submit's own check-duplicate/search/
    query-knowledge/lookup-capability battery (cmd_submit in task-gateway.py)
    entirely -- every OTHER real trigger into the task lifecycle (see
    prompt_gateway/gateway.py's dispatch_to_task_lifecycle(), action "start")
    goes through that battery first, and this file's own docstring history
    already documents why DIRECTIVE.yaml-driven submissions deserve the same
    guards as any other trigger, not a separate weaker path.

    This calls task-gateway.py's real "submit" subcommand via subprocess --
    it does NOT reimplement check-duplicate/search/query-knowledge/lookup-
    capability here, only reuses the already-built command exactly as
    gateway.py's dispatch_to_task_lifecycle() already does for its own
    "start" action. --source is always ai_agent (software calling software,
    not a raw Owner-text gate -- DIRECTIVE.yaml entries are Owner-authored
    config, not live chat text) and --owner-chat-id carries task_identity
    through for audit, the same cross-reference convention cmd_submit's own
    docstring establishes for --source ai_agent callers.

    Returns the parsed JSON dict from task-gateway.py submit, or None on any
    failure -- fails open, same philosophy as find_in_flight_duplicate()
    above: a broken check here must never silently block a real, legitimate
    DIRECTIVE.yaml-driven dispatch."""
    text = f"{title}\\n\\n{prompt}".strip() if prompt else (title or task_identity)
    try:
        result = subprocess.run(
            ["python3", TASK_GATEWAY, "submit",
             "--text", text, "--source", "ai_agent",
             "--session-id", f"directive-engine-{task_identity}",
             "--owner-chat-id", task_identity],
            capture_output=True, text=True, timeout=90,
        )
        return json.loads(result.stdout.strip())
    except Exception as e:
        log_status(task_identity, f"check-duplicate battery call failed, fail-open, proceeding: {e}")
        return None'''

new = '''def run_check_duplicate_battery(task_identity, title, prompt):
    """Real, confirmed gap closed (Stage 5, 2026-07-29): this module used to go
    straight from find_in_flight_duplicate() above to resource_governor.py
    --submit, bypassing task-gateway.py submit's own check-duplicate/search/
    query-knowledge/lookup-capability battery (cmd_submit in task-gateway.py)
    entirely -- every OTHER real trigger into the task lifecycle (see
    prompt_gateway/gateway.py's dispatch_to_task_lifecycle(), action "start")
    goes through that battery first, and this file's own docstring history
    already documents why DIRECTIVE.yaml-driven submissions deserve the same
    guards as any other trigger, not a separate weaker path.

    This calls task-gateway.py's real "submit" subcommand via subprocess --
    it does NOT reimplement check-duplicate/search/query-knowledge/lookup-
    capability here, only reuses the already-built command exactly as
    gateway.py's dispatch_to_task_lifecycle() already does for its own
    "start" action. --source is always ai_agent (software calling software,
    not a raw Owner-text gate -- DIRECTIVE.yaml entries are Owner-authored
    config, not live chat text) and --owner-chat-id carries task_identity
    through for audit, the same cross-reference convention cmd_submit's own
    docstring establishes for --source ai_agent callers.

    Real fix (P0 dispatch-queue-starvation blocker, PM sentinel cycle
    2026-08-06T10:30Z, UMR-20260806-071025-1d28 / UMR-20260806-090229-f2a7,
    this fix's own governing UMR-20260806-102737-d780): this function used to
    fail OPEN on any exception here -- return None, and process_one() below
    then proceeded straight to submit_task() as if the battery had genuinely
    run and found no duplicate. Real, live incident:
    veridian-directive-engine.service's own journal recorded "check-duplicate
    battery call failed, fail-open, proceeding" immediately followed by
    "submitted" on literally every tick, for eight distinct dead
    task_identity values, ~52 resubmissions each within one 15-minute window
    (~416 total). Each resubmission reused the same umr_id via
    resource_governor.py submit()'s Rule-1 reuse-on-resubmit path, whose
    ts_submitted is never refreshed on reuse, so the resubmitted row's age
    never resets -- it then permanently won next_queued_task()'s ascending-
    ts_submitted tiebreak against every other real queued row (see
    resource_governor.py's own comment near next_queued_task()/dispatch_one()/
    run_tick(): only the single top-ranked row is evaluated per tick, so one
    poisoned row starves the entire rest of the queue forever). A broken
    duplicate check must never look identical to "no duplicate found" --
    fails CLOSED now: the caller must skip submission and flag for Owner
    review instead of dispatching past a check it cannot prove passed.

    Returns (parsed_json_dict, False) on a real, successful battery call, or
    (None, True) if the call itself failed for any reason (subprocess error,
    timeout, unparseable output) -- the second element is the real
    fail-closed signal callers must check before ever calling submit_task()."""
    text = f"{title}\\n\\n{prompt}".strip() if prompt else (title or task_identity)
    try:
        result = subprocess.run(
            ["python3", TASK_GATEWAY, "submit",
             "--text", text, "--source", "ai_agent",
             "--session-id", f"directive-engine-{task_identity}",
             "--owner-chat-id", task_identity],
            capture_output=True, text=True, timeout=90,
        )
        return json.loads(result.stdout.strip()), False
    except Exception as e:
        log_status(task_identity, f"check-duplicate battery call failed, fail-closed, NOT submitting: {e}")
        return None, True'''

assert old in content, "old run_check_duplicate_battery block not found verbatim"
content = content.replace(old, new, 1)

old2 = '''    battery = run_check_duplicate_battery(
        task_identity, entry.get("title", task_identity), entry.get("prompt", ""),
    )
    if battery and battery.get("duplicate_found"):'''

new2 = '''    battery, battery_call_failed = run_check_duplicate_battery(
        task_identity, entry.get("title", task_identity), entry.get("prompt", ""),
    )
    if battery_call_failed:
        note_needs_review(
            task_identity,
            "task-gateway.py submit's check-duplicate/search/query-knowledge battery "
            "call itself failed (subprocess error, timeout, or unparseable output) -- "
            "failing CLOSED per the 2026-08-06 dispatch-queue-starvation P0 fix "
            "(UMR-20260806-102737-d780): a broken check must never look identical to "
            "'no duplicate found', so this is NOT submitted; needs human judgment to "
            "confirm task-gateway.py/the battery path is healthy before retry",
        )
        log_status(task_identity, "skipped -- check-duplicate battery call itself failed, "
                                   "fail-closed, NOT submitted, queued for Owner review")
        return "battery_call_failed"
    if battery and battery.get("duplicate_found"):'''

assert old2 in content, "old process_one battery-call block not found verbatim"
content = content.replace(old2, new2, 1)

with open(path, "w") as f:
    f.write(content)

print("patched:", path)
