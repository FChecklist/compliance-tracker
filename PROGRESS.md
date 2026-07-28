# PROGRESS -- task-20260728-043316-design-studio-timesheets--designer-wise

## Completed
- [x] Read governance docs, registered claim in ai-os/boss/ACTIVE-CLAIMS.yaml
- [x] Audited existing infra: confirmed designer-wise Budget-vs-Actual cut (byDesigner) already exists in construction-reports-service.ts (PR #597 + audit fix 46d6967d) -- SCOPE item 1 already satisfied, no rebuild needed
- [x] Audited existing infra: confirmed a full KPI designer-fills/manager-approves table pair already exists (constructionKpiDefinitions/constructionKpiEntries, construction-kpi-service.ts, /api/construction/kpi-entries + /[id]/approve) -- SCOPE item 3 already satisfied, not duplicating

- [x] Schema: added `pmsTimeEntryApprovalStatusEnum` (draft/submitted/approved/rejected) + approvalStatus/approvedById/approvedAt/rejectionReason columns to `pmsTimeEntries` (schema.ts)
- [x] Hand-written migration `drizzle/0268_pms_time_entry_approval_flow.sql` + `_journal.json` entry (same drizzle/meta snapshot-gap approach documented in 0267's header)
- [x] Service: `submitTimeEntry`/`approveTimeEntry`/`rejectTimeEntry` in pms-time-service.ts, modeled on construction-kpi-service.ts's submitKpiEntry/approveKpiEntry (self-approval blocked, state-machine enforced)
- [x] API routes: `/api/pms/time-entries/[id]/{submit,approve,reject}` -- approve/reject gated via `requireRole(dbUser, "manager")`
- [x] Report: `designerApprovalStatusReport`/`aggregateDesignerApprovalStatus` (designer-wise approval-status view) in construction-reports-service.ts
- [x] Report: `workAnalysisReport`/`aggregateWorkAnalysis` (hours by task/category per designer over a period) in construction-reports-service.ts
- [x] Registered both new reports (`designer-approval-status`, `work-analysis`) in REPORT_REGISTRY + dispatcher route (dateFrom/dateTo query params for work-analysis)
- [x] Tests: existing designer-wise Budget-vs-Actual cut tests (PR #597) still pass unmodified; new pure-aggregator tests for both new reports; new state-machine tests (self-approval blocked, wrong-state transitions blocked, happy path) in pms-time-service.test.ts; new route-level access-control test (member 403'd, manager allowed) in approve/route.test.ts
- [x] Verified: `bunx tsc --noEmit` clean; `bun test construction-reports-service.test.ts` (10 pass, includes all pre-existing PR #597 tests); full `bun test` -- 2244 pass, 0 fail
- [x] Commit + push

## Remaining
- [ ] Open PR, request supervisor audit (per EXPECTED_OUTPUT -- not self-merged)
