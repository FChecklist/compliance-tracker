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
... more files changed
