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

- [x] Reimplement CO-001 (listJournalEntryLinesByCostCenter), CO-003 (costCenterHierarchyReport) in
      erp-accounting-service.ts fresh on current main
- [x] Reimplement FI-GL-002 (glAccountBalanceDisplay), FI-GL-008 (glAccountGroupBalancesSummary) in
      erp-financial-report-service.ts fresh on current main
- [x] Implement FI-GL-007 (subledger-to-GL reconciliation) fresh (BUILD_NEW, deterministic_formula
      wired into report-engine-service.ts's FORMULA_REGISTRY as `subledger_to_gl_reconciliation`)
- [x] For each: report_definitions migration (drizzle/0313-0317) + report-catalog-service.ts entry +
      API route + real tests -- all 5 done. 4 EXTEND_EXISTING reports use execution_type=
      'external_service' (thin API route, no FORMULA_REGISTRY entry needed, matching drizzle/0183's
      established precedent); FI-GL-007 alone uses 'deterministic_formula' since it's BUILD_NEW.
- [x] wiring_registry check: confirmed (by reading generate_wiring_registry.py) it's a mechanically
      regenerated snapshot from existing catalogs (DATABASE_CATALOG.json/FUNCTION_CATALOG.json/
      ROUTE_REGISTRY_SCHEMA/SOFTWARE_CATALOG.yaml/knowledge_engine sqlite), not a manual per-file
      registration step. Cross-checked against precedent PRs for this exact task (FI-AA-006 #648,
      FI-AR-006 #645, FI-AP-006 #651, HCM-006 #654) -- none of them performed a manual
      superboss-register.py registration step either. No action needed here.
- [x] tsc --noEmit clean (NODE_OPTIONS=--max-old-space-size=6144, bun x tsc OOMs on this box without it)
- [x] bun test clean: new file's 17/17 pass; full suite 2529/2529 pass, 0 fail (some tests print
      expected error-logging output for intentional fail-closed cases, not real failures)

- [x] Commit + push, open PR: https://github.com/FChecklist/compliance-tracker/pull/995

## Remaining
- [ ] Wait for CI to go green on PR #995
- [ ] Merge PR #995 (watch for the known self-approval-deadlock issue --
      see memory `veridian-branch-protection-self-approval-deadlock-active`)
- [ ] Close out ACTIVE-CLAIMS.yaml entry for this session once merged
