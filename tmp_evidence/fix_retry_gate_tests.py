import sys

path = sys.argv[1]
with open(path) as f:
    content = f.read()

mock_note = (
    "        # Real fix (UMR-20260806-102737-d780, P0 dispatch-queue-starvation\n"
    "        # blocker): run_check_duplicate_battery() now fails CLOSED on a real\n"
    "        # subprocess/parse failure, and this test's default TASK_GATEWAY\n"
    "        # (unmocked) genuinely fails in this sandboxed test environment --\n"
    "        # which used to be silently swallowed by the old fail-OPEN bug this\n"
    "        # module's own retry-once gate is unrelated to. Mock the battery\n"
    "        # call to a real, successful, no-duplicate-found result so this test\n"
    "        # exercises the retry-once gate in isolation, not task-gateway.py's\n"
    "        # own subprocess plumbing.\n"
    "        de.run_check_duplicate_battery = lambda *a, **k: (None, False)\n"
)

anchor1 = (
    '        calls = []\n'
    '        de.submit_task = lambda *a, **k: (calls.append((a, k)) or {"accepted": True, "umr_id": umr_id})\n'
    '\n'
    '        result = de.process_one({"task_identity": "test-first-failure-task", "tier": 2,\n'
)
replacement1 = (
    mock_note +
    '        calls = []\n'
    '        de.submit_task = lambda *a, **k: (calls.append((a, k)) or {"accepted": True, "umr_id": umr_id})\n'
    '\n'
    '        result = de.process_one({"task_identity": "test-first-failure-task", "tier": 2,\n'
)
assert content.count(anchor1) == 1, content.count(anchor1)
content = content.replace(anchor1, replacement1, 1)

anchor2 = (
    '        calls = []\n'
    '        de.submit_task = lambda *a, **k: (calls.append((a, k)) or {"accepted": True, "umr_id": umr_id})\n'
    '        result = de.process_one({"task_identity": "test-corrupt-state-task", "tier": 2,\n'
)
replacement2 = (
    mock_note +
    '        calls = []\n'
    '        de.submit_task = lambda *a, **k: (calls.append((a, k)) or {"accepted": True, "umr_id": umr_id})\n'
    '        result = de.process_one({"task_identity": "test-corrupt-state-task", "tier": 2,\n'
)
assert content.count(anchor2) == 1, content.count(anchor2)
content = content.replace(anchor2, replacement2, 1)

with open(path, "w") as f:
    f.write(content)
print("patched", path)
