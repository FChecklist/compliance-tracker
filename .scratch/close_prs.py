import json
import subprocess
import sys

decisions = json.load(open('.scratch/disposal_decisions.json'))
safe = decisions['safe_to_close']

REPO = "FChecklist/compliance-tracker"

results = {}
for num, citation in safe.items():
    comment = (
        f"Closing as a duplicate/superseded DOCS-ONLY pull request per the "
        f"2026-08-16 owner-directed bulk PR classification task "
        f"(task-20260816-171212-classify-the-entire-compliance-tracker-p).\n\n"
        f"This PR's documentation content is already present on `main` in equal "
        f"or newer form:\n\n{citation}\n\n"
        f"No source, config, test, or schema file is touched by this PR (verified "
        f"via its real changed-file list, see "
        f"ai-os/registry/pr-classification-20260816.json). Closing does not "
        f"discard any unshipped work -- the substance is already merged/recorded "
        f"on `main` at the cited location."
    )
    r = subprocess.run(
        ["gh", "pr", "close", num, "--repo", REPO, "--comment", comment],
        capture_output=True, text=True
    )
    ok = r.returncode == 0
    results[num] = {"ok": ok, "stdout": r.stdout.strip(), "stderr": r.stderr.strip()}
    print(num, "OK" if ok else "FAIL", r.stdout.strip() or r.stderr.strip())

json.dump(results, open('.scratch/close_results.json', 'w'), indent=2)
