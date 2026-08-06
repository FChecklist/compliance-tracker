# PROGRESS -- task-20260806-091101-build-extend-calculation-track-engines

## Completed
- [x] Read AGENTS.md/CLAUDE.md governance chain + ai-os/boss/ACTIVE-CLAIMS.yaml before starting
- [x] Resolved PHASE-2-CROSSREF: real `sap_reports` table in `/opt/veridian/ai-os/memory/sap_mapping.sqlite`
      (`engine_track`/`veridian_mapping_status` columns), not a repo doc -- confirmed via direct sqlite query
- [x] Scoped work: `engine_track='calculation' AND veridian_mapping_status IN (BUILD_NEW, EXTEND_EXISTING(...))`
      = 36 rows total
- [x] Collision check: found real prior work on this exact task title. PR #643 (rebased 2026-07-31) has 4
      clean surviving functions (CO-001, CO-003, FI-GL-002, FI-GL-008); PR #647 has FI-GL-007. Both stale/
      CONFLICTING against current main. FI-AR-006/FI-AP-006/FI-AA-006/HCM-006 already separately merged
      (PR #645/#651/#648/#654). SD-006 (#652) and CO-006 (#653) have their own complete open PRs -- left
      alone, not duplicated.
- [x] Registered claim in ai-os/boss/ACTIVE-CLAIMS.yaml, committed+pushed before real work

## Remaining
- [ ] Reimplement CO-001 (listJournalEntryLinesByCostCenter), CO-003 (costCenterHierarchyReport) in
      erp-accounting-service.ts fresh on current main
- [ ] Reimplement FI-GL-002 (glAccountBalanceDisplay), FI-GL-008 (glAccountGroupBalancesSummary) in
      erp-financial-report-service.ts fresh on current main
- [ ] Implement FI-GL-007 (subledger-to-GL reconciliation) fresh
- [ ] For each: report_definitions migration + report-catalog-service.ts entry + API route + real tests
- [ ] Register each in wiring_registry (superboss-register.py) immediately on creation
- [ ] tsc --noEmit clean, bun test clean
- [ ] Commit + push, open PR
