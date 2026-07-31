# PROGRESS -- task-20260730-040810-build-extend-calculation-track-engines

## Source of truth
Spec: "Build/extend only calculation-track engines marked BUILD_NEW or EXTEND_EXISTING from
PHASE-2-CROSSREF." Neither "PHASE-2-CROSSREF" nor "wiring_registry" exist under those literal
names anywhere on disk (confirmed via whole-filesystem search) -- traced the real lineage
(re-confirmed this session, matches a prior abandoned session's findings exactly):

- Real data: `/opt/veridian/ai-os/memory/sap_mapping.sqlite`'s `sap_reports` table (NOT in this
  repo, NOT Postgres -- shared host-level SQLite, 80 rows). Queried read-only directly.
- The "Phase 2 cross-reference" = the `veridian_mapping_status` column, populated by
  task-20260728-160934 and independently re-verified by task-20260729-001528 (both unmerged
  branches; see `ai-os/tasks/sap_mapping/`).
- "wiring_registry" = `compliance.computation_engines` (schema.ts:9488), the real Postgres-backed
  VCEL catalog behind `src/lib/engines/*.ts`.
- 36 of 80 sap_reports rows have `engine_track='calculation'` AND `veridian_mapping_status` starting
  with `BUILD_NEW` or `EXTEND_EXISTING` (9 BUILD_NEW, 27 EXTEND_EXISTING) -- these are this task's
  scope, grouped into 8 file-scoped work units below.
- **Prior-session note**: `worker/task-20260729-112410-build-extend-calculation-track-engines`
  (commit 3d190ecc, claimed_at 2026-07-29T11:36Z) did this same tracing + planning and produced
  the 8-group plan reused below verbatim, but did zero actual engine implementation (no PR, no
  further commits, confirmed stale/abandoned). This session takes over under its own task id per
  ACTIVE-CLAIMS.yaml protocol #1 and continues from the plan rather than re-deriving it.
- Sibling task `worker/task-20260729-112447-build-extend-workflow-track-engines` (PR #629, merged)
  already closed the disjoint `engine_track='workflow'` rows -- no overlap.
- Registering each new/extended engine's row in `compliance.computation_engines` via an idempotent
  `INSERT ... ON CONFLICT (engine_key) DO UPDATE` in that group's own migration file (established
  pattern -- see e.g. drizzle/0100_gst_reconciliation_engine.sql's HSN-master seed), immediately per
  group, not batched to the end.
- No live DB credentials available in this workspace (no DATABASE_URL/SUPABASE_DB_PASSWORD in
  /opt/veridian/shared/.env) -- migrations are written but not pushed live; `db:push`/`db:migrate`
  left for the merge step per this repo's normal PR flow (drizzle migrations run in CI/deploy, not
  by hand in this session).

## Plan -- 36 rows grouped by target file (commit per group)

### Group 1: GL/CO -- erp-accounting-service.ts + erp-financial-report-service.ts [DONE]
- [x] CO-001 Cost Center Line Item Display (listJournalEntryLinesByCostCenter)
- [x] CO-003 Cost Center Hierarchy Report (costCenterHierarchyReport)
- [x] FI-GL-002 G/L Account Balances Display (glAccountBalanceDisplay)
- [x] FI-GL-007 Subledger Reconciliation to GL (subledgerReconciliationToGl, BUILD_NEW)
- [x] FI-GL-008 G/L Account Group Balances Summary (glAccountGroupBalancesSummary)
- Registered in compliance.computation_engines via drizzle/0269_calc_track_group1_gl_co_engines.sql
  (idempotent ON CONFLICT (engine_key) DO UPDATE). Full-repo `tsc --noEmit` clean after this group.

### Group 2: AP -- erp-buying-service.ts + erp-invoicing-service.ts (AP-side)
- [ ] FI-AP-001 Vendor Line Item Display (open+cleared, partial-clearing math)
- [ ] FI-AP-002 Vendor Balances (sum outstandingAmount per supplier, mirrors arAgingReport's data source)
- [ ] FI-AP-003 Vendor Items Aging Report (apAgingReport, mirrors arAgingReport bucketing)
- [ ] FI-AP-004 Vendor Account Balance Display (single-vendor open/cleared snapshot)
- [ ] FI-AP-005 Payment Run / Payment Proposal (BUILD_NEW -- due+not-blocked selection, discount calc, group by vendor/bank)
- [ ] FI-AP-006 Vendor Payment Behavior / DPO (BUILD_NEW)
- [ ] FI-AP-007 Subcontractor Retention Summary (BUILD_NEW -- new schema: vendor-side retention tracking)
- [ ] MM-004 Purchase Orders by Project/WBS (project filter on listPurchaseOrders)
- [ ] MM-008 Vendor Purchasing History Report (compose getSupplierScorecard + vendorCostReport)
- [ ] PS-005 Project Commitments Report (open PO value rollup by project)

### Group 3: AR -- erp-selling-service.ts + erp-invoicing-service.ts (AR-side)
- [ ] FI-AR-001 Customer Line Item Display
- [ ] FI-AR-002 Customer Balances
- [ ] FI-AR-005 Customer Credit Exposure (open AR + open order value vs creditLimit)
- [ ] FI-AR-006 Customer Payment History / DSO (BUILD_NEW)
- [ ] FI-AR-007 Customer Account Balance Display (verify/extend getCustomerOverview)
- [ ] SD-004 Open Sales Order Backlog Report
- [ ] SD-005 Customer Sales Analysis
- [ ] SD-006 Sales by Material/Service Type (BUILD_NEW)
- [ ] SD-008 Cancelled and Rejected Billing Analysis

### Group 4: Treasury/PS -- banking-engine.ts + erp-cash-service.ts + construction-expense-service.ts
- [ ] PS-001 Project Line Item Display
- [ ] PS-007 Project Cash Flow Report (extend banking-engine.ts:projectCashFlow w/ billing-plan+delay)
- [ ] Treasury-004 Liquidity Forecast (compose AR+AP+payroll timing)
- [ ] Treasury-005 Bank Account Transaction List

### Group 5: Fixed Assets -- erp-fixed-assets-service.ts
- [ ] FI-AA-004 Asset History Sheet (year-over-year APC/depreciation rollup)
- [ ] FI-AA-006 Asset-to-GL Reconciliation (BUILD_NEW)
- [ ] FI-AA-007 Asset Depreciation Forecast (portfolio-wide forward rollup)

### Group 6: HR -- payroll-engine.ts / erp-payroll-service.ts
- [ ] HCM-005 Overtime and Absence Analysis
- [ ] HCM-006 Certified Payroll Report (BUILD_NEW -- US WH-347 format)

### Group 7: CO allocation -- costing-engine.ts
- [ ] CO-005 Sender/Receiver Cost Allocation Report (wire allocateCostPool to real cost-center data + posting)
- [ ] CO-006 Statistical Key Figure Report (BUILD_NEW, but implementation_notes explicitly says
      "do not build as standalone" -- building the lightweight version it recommends instead:
      existing-metric-driven allocation basis picker, no new SKF subsystem)

### Group 8: CRM
- [ ] CRM-006 Win/Loss Analysis Report (crmLostReasons aggregation)

## Completed
- Group 1 (GL/CO, 5 rows: CO-001, CO-003, FI-GL-002, FI-GL-007, FI-GL-008) -- see checkboxes above.

## Remaining
Groups 2-8 (31 rows), not started as of this writing.
