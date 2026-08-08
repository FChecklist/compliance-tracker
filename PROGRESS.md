# PROGRESS -- task-20260808-142214-addendum-to-umr-20260808-122929-bc77--au

Addendum to UMR-20260808-122929-bc77 (audit-24-points). GOVERNING CHAIN:
UMR-20260806-171945-5767, UMR-20260808-122929-bc77.

## Completed
- [x] Read the full governing chain (bc77's own dispatch prompt, the addendum prompt,
      `agent_work_briefing.py assemble-briefing` deterministic briefing for this UMR).
- [x] Live-verified state before starting real work (Rule 11):
      - `task-gateway.py audit-24-points` does NOT exist yet on live `/opt/veridian/scripts`
        (zero `audit.24.points` hits; HEAD == origin/main, no branch pushed for the sibling
        build task `task-20260808-142208-build-task-gateway-py-audit-24-points--r`).
      - The shared live checkout (`/opt/veridian/scripts`) has real, unrelated, in-flight
        uncommitted edits to `task-gateway.py` + `resource_governor.py` from a DIFFERENT
        concurrent session (UMR-20260808-121334-e122 Option B gate wiring) -- not the
        audit-24-points sibling. Scoped my own edits away from both files to avoid a real
        collision (this checkout is not per-task branched).
      - Confirmed, via direct read-only SQLite query (never touched with a raw write), the real
        1:1 mapping bc77's "Point N" text -> `master_issue_tracker.issue_id='UMR171945-{N:04d}'`
        (e.g. point 8 "memory-check log" <-> UMR171945-0008 "PM has seen last 24h memory and
        checked"; point 17 Zoekt/pgvector <-> UMR171945-0017). The addendum's own
        "UMR171945-0001..0024" citation is real and correct.
      - Confirmed `master_issue_tracker` CRUD (`add-issue`/`close-issue`/`update-issue`/
        `list-issues`) is already live on `origin/main` (PR #277, commit `d8efb3c`, matches live
        checkout HEAD) -- but `list-issues` has no `--linked-umr-id` filter (only
        `--linked-ocid`/`--is-closed`/`--limit`), which the addendum's own "Real boolean test"
        paragraph explicitly names as the query surface. Building that.
- [x] Registered `ai-os/boss/ACTIVE-CLAIMS.yaml` entry (Rule 11) before starting real edits,
      scoped to `superboss-register.py` (list-issues filter) + a new test file only.

- [x] Discovered, mid-session, that the shared live checkout was ALSO carrying real, unrelated
      uncommitted work from a THIRD session directly on the working tree (I had inherited its
      checked-out branch `fix/e122-shared-gate-check-cmd-start`, HEAD `bc14a21`, one commit ahead
      of `origin/main`). Recovered safely: reverted my own in-place edit off that branch,
      created a clean new branch from `origin/main`
      (`feat/audit24-master-issue-tracker-linked-umr-id`), reapplied my diff there via
      `git apply`, and switched the shared checkout back to the other session's branch afterward
      so it was left exactly as found. Zero interference with that session's own uncommitted
      work at any point (confirmed via `git status --short` before and after).
- [x] Added `--linked-umr-id` filter to `superboss-register.py list-issues`
      (`query_master_issues()`, `cmd_list_issues()`, argparse) -- combinable with the existing
      `--linked-ocid`/`--is-closed` filters, same convention. Live-verified (read-only) against
      the real production DB: correctly returns the 30 real rows (24 `UMR171945-00NN` + 6
      `UMR171945-BLK0N`) linked to `UMR-20260806-171945-5767`.
- [x] Built + ran a real regression test
      (`tests/test_audit24_master_issue_tracker_persistence.py`, 2 tests, both passing via
      pytest) proving the exact persistence pattern the addendum requires: for each of the 12
      points (2/4/8/9/12/14/16/17/19/20/22/23), a real `update-issue` CLI call sets
      `is_deterministic`/`is_ai_free`/`is_boolean_software`/`solution_applied`/
      `issue_resolved_permanently`/`check_again_notes`, and `list-issues --linked-umr-id
      UMR-20260806-171945-5767` reflects it back correctly; a re-run updates the same row in
      place (no duplicate, stale note replaced); untouched points/rows stay untouched. Runs
      against an isolated scratch DB (`SUPERBOSS_REGISTER_DB` seam), never the live production
      `UMR171945-00NN` rows.
- [x] Opened veridian-scripts PR #279 (`feat/audit24-master-issue-tracker-linked-umr-id` ->
      `main`): https://github.com/FChecklist/veridian-scripts/pull/279

## Remaining
- [ ] The true end-to-end acceptance test (a REAL `audit-24-points` run reflected in the live
      `UMR171945-00NN` rows) is blocked on the sibling base-build task landing
      `task-gateway.py audit-24-points` -- out of this addendum's own scope to build (SPEC:
      "does not replace it"; that task did not exist on live `/opt/veridian/scripts` as of this
      task's own completion). Once it lands, wiring is: after computing each of the 12 booleans,
      shell out to `superboss-register.py update-issue --issue-id UMR171945-{point:04d} --field
      ...` (exact pattern proven by the new test file above).
- [x] Opened compliance-tracker PR #1062, posted `AUDIT: PASS` self-audit verdict.
- [x] Recorded completion via `agent_work_briefing.py record-completion`
      (`UMR-20260808-123107-875a` -> `umr_tasks.status=completed`, `PR #1062`).
