# PROGRESS -- task-20260728-043316-design-studio-timesheets--designer-wise

## Completed
- [x] Read governance docs, registered claim in ai-os/boss/ACTIVE-CLAIMS.yaml
- [x] Audited existing infra: confirmed designer-wise Budget-vs-Actual cut (byDesigner) already exists in construction-reports-service.ts (PR #597 + audit fix 46d6967d) -- SCOPE item 1 already satisfied, no rebuild needed
- [x] Audited existing infra: confirmed a full KPI designer-fills/manager-approves table pair already exists (constructionKpiDefinitions/constructionKpiEntries, construction-kpi-service.ts, /api/construction/kpi-entries + /[id]/approve) -- SCOPE item 3 already satisfied, not duplicating

## Remaining
- [ ] Schema: add approval-status enum + columns to pms_time_entries (draft/submitted/approved/rejected)
- [ ] Hand-written migration drizzle/0268_*.sql (drizzle/meta snapshot gap, same as 0267's documented approach)
- [ ] Service: submitTimeEntry/approveTimeEntry/rejectTimeEntry in pms-time-service.ts (modeled on construction-kpi-service.ts's submit/approve)
- [ ] API routes: /api/pms/time-entries/[id]/{submit,approve,reject}, manager-role-gated
- [ ] Report: designer-wise approval-status view in construction-reports-service.ts
- [ ] Report: work-analysis view (hours by task/category per designer over a period)
- [ ] Register new reports in REPORT_REGISTRY
- [ ] Tests: designer-wise cut correctness (may already be covered by existing PR #597 tests -- verify), approval state machine enforcement (member cannot self-approve, only manager can submitted->approved)
- [ ] Verify: npx tsc --noEmit, bun test construction-reports-service.test.ts, bun test (scoped to new files)
- [ ] Commit + push
