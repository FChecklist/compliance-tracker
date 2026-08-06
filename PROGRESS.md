# PROGRESS -- task-20260806-104218-build-extend-calculation-track-engines

## Source of truth
Spec: "Build/extend only calculation-track engines marked BUILD_NEW or EXTEND_EXISTING from
PHASE-2-CROSSREF." PHASE-2-CROSSREF = the real `sap_reports` table in
`/opt/veridian/ai-os/memory/sap_mapping.sqlite` (`engine_track`/`veridian_mapping_status` columns,
not a repo doc) -- confirmed via direct sqlite query, matches every prior session in this task
lineage. `engine_track='calculation' AND veridian_mapping_status IN (BUILD_NEW,
EXTEND_EXISTING(...))` = 36 rows total.

wiring_registry = `/opt/veridian/ai-os/memory/superboss-register.sqlite` (host-level, shared,
NOT this repo) via `superboss-register.py`'s `register-entity` CLI.

## Completed
- [x] Read AGENTS.md/CLAUDE.md governance chain + `ai-os/boss/ACTIVE-CLAIMS.yaml` before starting
- [x] Resolved PHASE-2-CROSSREF + scoped the 36 rows via direct sqlite query
- [x] Collision check: `worker/task-20260806-091101-...` claimed the identical scope ~1.5h earlier
      but has zero real work beyond its own claim commit -- proceeding, documented in ACTIVE-CLAIMS.yaml
- [x] Verified live state against current `origin/main` + `gh pr list` (not trusted from prior
      sessions' notes): 6 of 36 rows already merged (FI-AP-005/006/007, FI-AR-006, FI-AA-006, HCM-006).
      4 open-but-stale (2026-08-02, CONFLICTING) PRs cover 7 more: #643 (CO-001, CO-003, FI-GL-002,
      FI-GL-008 -- service code only, missing migration/route/tests), #647 (FI-GL-007, complete),
      #652 (SD-006, complete), #653 (CO-006, complete but needs new schema tables -- separate scope).
- [x] Registered claim in ACTIVE-CLAIMS.yaml, committed+pushed before real work

## This session's scope (budget-bounded)
Rescuing the 5 already-designed, verified-good-quality rows stranded on stale PRs, re-implemented
fresh against current main (not a raw cherry-pick -- source branches are 4-6 days stale with 32k+
lines of unrelated drift):
- [x] CO-001 `listJournalEntryLinesByCostCenter` (erp-accounting-service.ts) + migration
      (0313) + route (`/api/erp/reports/cost-center-line-items`) -- no dedicated test file,
      matches this codebase's established convention of leaving DB-touching wrappers
      untested when there's no extractable pure-logic core (see erp-accounting-service.ts's
      own sibling functions -- listJournalEntries etc. have no test file either)
- [x] CO-003 `costCenterHierarchyReport` (erp-accounting-service.ts) + migration (0314) +
      route (`/api/erp/reports/cost-center-hierarchy`) -- same untested-DB-wrapper convention
- [x] FI-GL-002 `glAccountBalanceDisplay` (erp-financial-report-service.ts) + migration
      (0315) + route (`/api/erp/reports/gl-account-balance`)
- [x] FI-GL-008 `glAccountGroupBalancesSummary` (erp-financial-report-service.ts) + migration
      (0316) + route (`/api/erp/reports/gl-account-group-balances`)
- [x] FI-GL-007 `subledgerToGlReconciliation` (erp-financial-report-service.ts, rescued from
      stale PR #647, re-implemented fresh) + migration (0317, FORMULA_REGISTRY-wired) +
      wired into report-engine-service.ts's FORMULA_REGISTRY as
      `subledger_to_gl_reconciliation` (no dedicated route -- goes through the generic
      report-engine execution path like other formula-registry reports) + tests
      (erp-financial-report-service.test.ts, pure functions only)
- [x] SD-006 `salesByMaterialServiceTypeReport` (report-engine-service.ts, rescued from
      stale PR #652, re-implemented fresh) + migration (0318, FORMULA_REGISTRY-wired as
      `sales_by_material_service_type`) + tests (report-engine-service.test.ts, pure
      aggregation function only)
- [x] `bun test` clean: 37 pass, 0 fail across erp-financial-report-service.test.ts +
      report-engine-service.test.ts
- [x] `tsc --noEmit` clean, 0 errors (repo-wide typecheck OOM'd twice on this shared/loaded
      box at default and 4096MB heap -- system-wide `free -h` showed only ~460MB free RAM
      with 3.1GB swap in use from other concurrent sessions' node processes, load average
      19 -- succeeded at 8192MB heap run via a properly-detached `run_in_background` Bash
      call, exit 0, empty output)
- [x] `scripts/check-migration-collision.mjs` clean: 6 new migration files, no number
      collisions against origin/main
- [x] `scripts/check-guardrail-presence.mjs` clean: all 88 markers present (Rule 9)
- [ ] Register each in wiring_registry (superboss-register.py) -- deferred: this is a
      host-level sqlite registry outside this repo/PR's own review surface and outside
      CI's gates; not blocking commit/push on it -- noting honestly as incomplete rather
      than silently skipping or fabricating registration
- [x] Commit + push (3bde69e8) + PR opened: https://github.com/FChecklist/compliance-tracker/pull/997

## Explicitly out of scope this session
- CO-006 (PR #653, complete but needs new `erp_statistical_key_figure_types`/postings schema tables
  -- materially bigger unit of work) -- left untouched, its own PR still open.
- 23 genuinely untouched rows (no branch/PR found for any of these): CO-005, FI-AP-001, FI-AP-002,
  FI-AP-003, FI-AP-004, FI-AR-001, FI-AR-002, FI-AR-005, FI-AR-007, MM-004, MM-008, PS-001, PS-005,
  PS-007, SD-004, SD-005, SD-008, Treasury-004, Treasury-005, FI-AA-004, FI-AA-007, CRM-006, HCM-005.
  These need a follow-up task -- 36 fresh engines is multi-session scale per this task's own history
  (6+ prior sessions on this exact task title since 2026-07-29).

## Known systemic blocker (not this session's to fix)
`compliance-tracker` `main` branch protection requires 1 approving PR review, but every credential
in this environment resolves to the same GitHub identity (`FChecklist`) -- no PR here is mergeable
via `gh pr merge`, even `--admin` (see memory `veridian-branch-protection-self-approval-deadlock-active`).
This PR will be opened and left ready to merge once that's resolved, same as every other open PR
in this repo right now.
