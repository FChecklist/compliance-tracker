#!/usr/bin/env python3
"""Deterministic verifier for this session's #2 highest-volume task-type
pattern: "rebase-only conflict resolution" (re-rebasing a stalled PR branch
onto current main and resolving conflicts -- no new feature, the whole point
is that behavior doesn't change. This session alone: PR #630 re-rebased at
least twice, #653 twice, #643, #652, #635/#610/#618/#604 dispatched as
rebase-fix tasks, PR #656 fixing check-migration-collision.mjs's own
stale-base-ref bug plus a 4-migration renumber -- see git log --merges and
KERNEL_CONSOLIDATION_STATUS.md's 2026-07-31 update entries).

Usage:
    python3 scripts/verify-task-rebase.py <pr_number|git_ref>
    python3 scripts/verify-task-rebase.py 658
    python3 scripts/verify-task-rebase.py my-deliberately-broken-branch

Real check sequence (run inside a disposable `git worktree` at the target
commit, never the caller's own working tree):
  1. no leftover git conflict markers (<<<<<<<, =======, >>>>>>>) anywhere
     in the tree -- the single most common real mistake in this task type
     (an incompletely resolved conflict that still parses/compiles as text
     but is semantically broken)                                (always)
  2. bunx tsc --noEmit                                            (always)
  3. bun test <every *.test.ts file this diff touches>            (only if
     the diff touches any -- a pure conflict-resolution rebase legitimately
     may not, unlike the sap-report task type)
  4. node scripts/check-migration-collision.mjs                   (only if
     the diff touches drizzle/*.sql -- migration renumbering during a
     rebase is this task type's other real recurring failure mode)
  5. node scripts/check-terminology-guardrail.mjs --diff-only     (always)

Exits 0 only if every check above actually ran and passed. Prints one JSON
object with a per-check breakdown either way.
"""
import argparse
import json
import os
import re
import subprocess
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _verify_task_common import (
    changed_files, get_repo_root, make_worktree, prepare_node_modules,
    remove_worktree, resolve_target, run_check, skipped_check,
)

TASK_TYPE = "rebase"

# Real git conflict-marker shape: <<<<<<< / >>>>>>> followed by a ref name,
# and a bare ======= line of exactly 7 equals signs. Anchored to line start
# and exact marker width so this doesn't false-positive on this repo's own
# markdown/yaml ASCII divider banners (e.g. "# ====...====" section rules,
# which run far longer than 7 characters).
_CONFLICT_MARKER_RE = re.compile(r"^(<{7} |>{7} |={7}$)", re.MULTILINE)


def check_conflict_markers(worktree):
    """git grep across the whole checked-out tree (not diff-scoped -- a
    leftover marker anywhere in the tree at this commit is real, regardless
    of which commit introduced it)."""
    result = subprocess.run(
        ["git", "grep", "-nIE", r"^(<{7} |>{7} |={7}$)"],
        cwd=worktree, capture_output=True, text=True,
    )
    # git grep exit code: 0 = match found, 1 = no match, >1 = real error
    if result.returncode == 1:
        return {"name": "no-conflict-markers", "cmd": "git grep <conflict-marker-pattern>",
                "exit_code": 1, "ok": True, "duration_s": 0,
                "stdout_tail": "no conflict markers found", "stderr_tail": ""}
    if result.returncode == 0:
        return {"name": "no-conflict-markers", "cmd": "git grep <conflict-marker-pattern>",
                "exit_code": 0, "ok": False, "duration_s": 0,
                "stdout_tail": result.stdout[-1500:], "stderr_tail": ""}
    return {"name": "no-conflict-markers", "cmd": "git grep <conflict-marker-pattern>",
            "exit_code": result.returncode, "ok": False, "duration_s": 0,
            "stdout_tail": result.stdout[-1500:], "stderr_tail": result.stderr[-1500:]}


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

        checks = [check_conflict_markers(worktree)]

        checks.append(run_check("typecheck", ["bunx", "tsc", "--noEmit"], worktree,
                                 args.tsc_timeout))

        test_files = [f for f in files if f.endswith(".test.ts")
                      and os.path.exists(os.path.join(worktree, f))]
        if test_files:
            checks.append(run_check("unit-tests", ["bun", "test", *test_files], worktree, 120))
        else:
            checks.append(skipped_check("unit-tests",
                                         "no *.test.ts file in this diff -- a pure conflict-"
                                         "resolution rebase legitimately may not touch tests"))

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
