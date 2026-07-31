#!/usr/bin/env python3
"""Deterministic verifier for this session's #1 highest-volume task-type
pattern: "SAP-report build" / "schema-additive migration + service function"
(FI-AP-005/006/007/008, FI-AR-004/006, FI-AA-006, HCM-006, SD-002/007,
CRM auto-distribution, etc. -- 10+ merged PRs this session, all the same
real shape: a new/changed drizzle migration (when the report needs new
columns/tables), a service function + its own *.test.ts, and a new API
route, gated by ai-os/registry/terminology-guardrail-exemptions.yaml).

Usage:
    python3 scripts/verify-task-sap-report.py <pr_number|git_ref>
    python3 scripts/verify-task-sap-report.py 658
    python3 scripts/verify-task-sap-report.py my-deliberately-broken-branch

Real check sequence (each run inside a disposable `git worktree` checked out
at the target commit, never the caller's own working tree):
  1. bunx tsc --noEmit                                   (always)
  2. bun test <every *.test.ts file this diff touches>    (always -- a
     sap-report PR with zero test-file changes is treated as a FAILED
     check, not skipped, since this task type is defined by adding one)
  3. node scripts/check-migration-collision.mjs           (only if the diff
     touches drizzle/*.sql -- most, not all, of this task type)
  4. node scripts/check-terminology-guardrail.mjs --diff-only (always)

Exits 0 only if every check above actually ran and passed. Prints one JSON
object with a per-check breakdown either way.
"""
import argparse
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _verify_task_common import (
    changed_files, failed_without_running, get_repo_root, make_worktree,
    prepare_node_modules, remove_worktree, resolve_target, run_check, skipped_check,
)

TASK_TYPE = "sap-report"


def main():
    parser = argparse.ArgumentParser(description=__doc__,
                                      formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("target", help="PR number (merged or open) or a git ref/branch/sha")
    parser.add_argument("--keep-worktree", action="store_true",
                         help="don't delete the temp worktree afterward (debugging)")
    parser.add_argument("--tsc-timeout", type=int, default=280)
    args = parser.parse_args()

    repo_root = get_repo_root()
    result = {"task_type": TASK_TYPE, "target": args.target}
    worktree = None
    try:
        resolved = resolve_target(repo_root, args.target)
        result["resolved"] = resolved
        commit, base = resolved["commit"], resolved["base"]
        files = changed_files(repo_root, base, commit)
        result["changed_files"] = files

        worktree = make_worktree(repo_root, commit)
        result["node_modules"] = prepare_node_modules(repo_root, worktree, base, commit)

        checks = []
        checks.append(run_check("typecheck", ["bunx", "tsc", "--noEmit"], worktree,
                                 args.tsc_timeout))

        test_files = [f for f in files if f.endswith(".test.ts")
                      and os.path.exists(os.path.join(worktree, f))]
        if test_files:
            checks.append(run_check("unit-tests", ["bun", "test", *test_files], worktree, 120))
        else:
            checks.append(failed_without_running(
                "unit-tests",
                "no *.test.ts file in this diff -- a 'sap-report' task is expected to add or "
                "modify a service test file alongside its report function"))

        migration_touched = any(f.startswith("drizzle/") and f.endswith(".sql") for f in files)
        if migration_touched:
            checks.append(run_check("migration-collision",
                                     ["node", "scripts/check-migration-collision.mjs"],
                                     worktree, 30))
        else:
            checks.append(skipped_check("migration-collision",
                                         "no drizzle/*.sql file in this diff"))

        checks.append(run_check("terminology-guardrail",
                                 ["node", "scripts/check-terminology-guardrail.mjs",
                                  "--diff-only"], worktree, 30))

        result["checks"] = checks
        result["all_passed"] = all(c["ok"] for c in checks)
    except Exception as e:  # noqa: BLE001 -- surface as a real failed result, not a crash
        result["error"] = str(e)
        result["all_passed"] = False
    finally:
        if worktree and not args.keep_worktree:
            remove_worktree(repo_root, worktree)

    print(json.dumps(result, indent=2))
    sys.exit(0 if result.get("all_passed") else 1)


if __name__ == "__main__":
    main()
