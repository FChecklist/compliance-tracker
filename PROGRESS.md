# PROGRESS -- task-20260726-081117-fix-pr563-ci---stale-migration-files--do

## Completed
- [x] Read ai-os/boss/ACTIVE-CLAIMS.yaml + AGENTS.md/CLAUDE.md governance docs.
- [x] Located PR #563 (`gh pr view 563`), branch
      `worker/task-20260726-071400-migration-drift-audit-and-reconciliation`,
      already checked out in another task's worktree -- worked via a local
      branch built on `FETCH_HEAD` of that remote branch instead, then pushed
      straight back to the same remote branch name (never touched the other
      worktree).
- [x] Registered `ai-os/MIGRATION_DRIFT_AUDIT_2026-07-26.yaml` in
      `ai-os/OS.yaml`'s `index.health_and_compliance` section. Verified locally
      (via a temp `js-yaml`/`argparse` node_modules symlink, since `bun` was
      not usable in this sandbox): without the entry the check reports 57
      missing items including this file; with it, 56, and this file is no
      longer in the missing list.
- [x] Read migration `0245_create_platform_schema_compartment.sql` to confirm
      the real relocation target (`ALTER TABLE compliance.dynamic_chains SET
      SCHEMA platform;`), then corrected:
      - `drizzle/0140_wave166_monitoring_tool_health.sql` line 39 ->
        `platform.dynamic_chains`
      - `drizzle/0199_gap_dcmd_rich_schema_slice.sql` (all 7 ALTER TABLE
        lines) -> `platform.dynamic_chains`
      - `drizzle/0253_tenant_ai_config.sql` line 27 `provider ai_provider` ->
        `provider compliance.ai_provider` (confirmed `compliance.ai_provider`
        is the real enum, defined in `drizzle/0004_ai_configurations_and_indexes.sql`)
      Verified via grep: `compliance.dynamic_chains` no longer appears in
      0140/0199; `platform.dynamic_chains` does.
- [x] Fixed PR #563's own `PROGRESS.md` stale `[ ] Open PR` line (PR is
      confirmed open) and documented the CI-fix work there.
- [x] Registered this follow-up task + closed it in
      `ai-os/boss/ACTIVE-CLAIMS.yaml` `recently_completed:` (added directly,
      since the fix was already complete by the time of registration).
- [x] Committed + pushed both fixes directly to PR #563's branch (2 commits):
      `92887462` (the 3 real fixes) and `2ea99ee0` (ACTIVE-CLAIMS entry).
- [x] Found and flagged (NOT fixed -- out of scope, needs real per-file
      research this task didn't have time/budget for): Metadata Index
      Coverage Check has a much larger pre-existing gap, 56 unrelated
      `ai-os/` files/scripts never indexed or exempted in `OS.yaml`. Confirmed
      via `git worktree add` at PR #563's merge-base commit (`51b7cccc`) that
      this gap already existed there (not introduced by PR #563), and via
      `gh run view` on main's own latest CI run (commit `9bcdb108`) that
      "Metadata Index Coverage Check" is failing on main HEAD right now for
      the same reason. Deliberately did not bulk-register 56 files with
      guessed descriptions -- this repo's own `OS.yaml` `covers:` entries are
      all evidence-researched; fabricating them would undermine the exact
      thing this check exists to catch. Recommend a dedicated follow-up claim.

## Remaining
- [ ] Owner sign-off on PR #563 (constitutionally required per this task's
      own constraints -- prior live-DDL-before-review exception -- not
      merged by this session under any circumstance).
- [ ] `gh pr checks 563` will still show "Metadata Index Coverage Check" red
      after this push, but for the separate pre-existing reason above, not
      the migration-drift-audit-file gap this task fixed. A future session
      should open a dedicated task to research and register/exempt the 56
      flagged items.
- [ ] No live database action was taken in this task (by design, per SPEC) --
      the live DB was already correct per the prior audit; only repo files
      were changed to match it.
