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
- [ ] CO-001 `listJournalEntryLinesByCostCenter` (erp-accounting-service.ts) + migration + route + tests
- [ ] CO-003 `costCenterHierarchyReport` (erp-accounting-service.ts) + migration + route + tests
- [ ] FI-GL-002 `glAccountBalanceDisplay` (erp-financial-report-service.ts) + migration + route + tests
- [ ] FI-GL-008 `glAccountGroupBalancesSummary` (erp-financial-report-service.ts) + migration + route + tests
- [ ] FI-GL-007 `subledgerToGlReconciliation` (erp-financial-report-service.ts, from PR #647) + migration + route + tests
- [ ] SD-006 `salesByMaterialServiceTypeReport` (report-engine-service.ts, from PR #652) + migration + tests
- [ ] Register each in wiring_registry (superboss-register.py) immediately per engine, not batched
- [ ] `tsc --noEmit` clean, `bun test` clean
- [ ] Commit + push per meaningful unit, open PR

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
