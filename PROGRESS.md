# PROGRESS -- task-20260808-074739-make-master-issue-tracker-permanent--rea

Governing chain: UMR-20260806-171945-5767 -> UMR-20260808-074726-d105.
Real table: /opt/veridian/ai-os/memory/superboss-register.sqlite `master_issue_tracker`
(986 rows verified live at task start: 981 migrated from UMR_5767_ISSUE_RESOLUTION_MATRIX.json
via /tmp/build_master_issue_tracker.py, one-off, non-callable; 5 real OCID-020 GTM-cert
category failures).

## Completed
- [x] Step 1: extended `scripts/superboss-register.py` (zero new files) with real,
      deterministic `add-issue` / `close-issue` / `update-issue` / `list-issues`
      subcommands (functions `add_master_issue`/`close_master_issue`/
      `update_master_issue`/`query_master_issues` + `cmd_*` CLI wrappers +
      `_ensure_master_issue_tracker_table()` wired into `_migrate_schema()`).
      Schema is byte-identical to the real live table (confirmed via
      `PRAGMA table_info(master_issue_tracker)` before writing, cross-checked
      against `/tmp/build_master_issue_tracker.py`'s own CREATE TABLE).
      Real boolean tests run against a throwaway `cp` of the real DB
      (`SUPERBOSS_REGISTER_DB` env override, the file's own documented test
      seam -- never touched the live production DB):
        - `add-issue` -> real new row (`TEST-MIT-0001`, issue_number 987),
          verified by direct `SELECT` afterward.
        - duplicate `--issue-id` -> real `ValueError`, exit 1 (no silent overwrite).
        - missing both `--linked-ocid`/`--linked-umr-id` -> real `ValueError`, exit 1.
        - `update-issue --field solution_applied=BOGUS` -> real
          `sqlite3.IntegrityError` (table's own CHECK constraint), exit 1.
        - `update-issue --field created_at=...` -> real `ValueError`
          (protected/immutable column), exit 1.
        - `close-issue` with blank `--resolution-notes` -> real `ValueError`, exit 1.
        - `close-issue` with real notes -> `issue_resolved_permanently=YES`,
          `is_closed=YES`, `apply_fix_notes` set -- verified by direct `SELECT`.
        - `list-issues --is-closed YES` and `--linked-ocid <none>` -> real JSON
          `{"count": N, "matches": [...]}`, matching `--query-umr`'s own convention
          (`resource_governor.py` main()).
      Temp test DB deleted after verification; production DB untouched by this step.
      `/opt/veridian/scripts` (veridian-scripts repo) was found ~97 commits behind
      `origin/main` with unrelated concurrent-session uncommitted changes in the shared
      live checkout -- re-applied the same edits in an isolated `git worktree` branched
      from fresh `origin/main` instead (never touched the shared checkout's other files),
      verified pure-additive diff (354 insertions, 0 deletions), re-ran every real
      boolean test against that copy too. Committed + pushed
      `feat/master-issue-tracker-add-issue-cli`, opened
      https://github.com/FChecklist/veridian-scripts/pull/273 (PR/CI gate, no direct
      push to `main`).

- [x] Step 2: confirmed via `ai-os/MASTER_INDEX.yaml`'s own `readme_server_md_note`
      that `/opt/veridian/README-SERVER.md` is still the real, current, authoritative
      infra-ops doc (not superseded) -- `/opt/veridian` itself is not a git repo, so
      this edit is a direct, immediately-live file write (no PR/CI gate applies here,
      unlike the two real git repos touched by steps 1 and 3). Added a new top-level
      section `## MANDATORY: Real Issue Recording via master_issue_tracker
      (added 2026-08-08)` right after the intro, with the real `add-issue`/
      `close-issue`/`update-issue`/`list-issues` command reference, the
      dedup-before-insert rule, and an explicit note that deterministic software gates
      (not just AI agents) are equally in scope, cross-referencing step 3's real
      `resource_governor.py` wiring. Boolean test:
      `grep -n "MANDATORY: Real Issue Recording" README-SERVER.md` -> real match at
      line 5; `grep -c master_issue_tracker README-SERVER.md` -> 3 real matches.

## Remaining
- [ ] Step 3: wire `resource_governor.py`'s real gate/pipeline (stop-work-order gate
      / emergency-stop cascade / dispatch_one()) to call the new add-issue path for
      a genuinely new, distinct issue class not already captured in
      master_issue_tracker -- scoped minimally, no duplication of umr_tasks' own
      reason/failure recording. Candidate identified: `_write_emergency_stop()`
      (EMERGENCY_CONSECUTIVE_TICKS_HARDSTOP cascade) -- currently only recorded in
      ATTENTION.md/EMERGENCY_STOP_PATH, system-wide (not per-task, so it does not
      duplicate umr_tasks), and confirmed absent from master_issue_tracker today
      (checked live). The stop-work-order gate (`_stop_work_order_block_reason()`)
      already has a real row (`UMR5767-0980`) -- reusing it via dedup-check, not a
      fresh per-occurrence insert, to avoid duplicate-row spam on a recurring gate.
- [ ] Record completion via `agent_work_briefing.py record-completion --umr-id
      UMR-20260808-074726-d105`.
- [ ] Final commit + push confirmation.
