# PROGRESS -- task-20260729-112410-build-extend-calculation-track-engines

## Source of truth
Spec: "Build/extend only calculation-track engines marked BUILD_NEW or EXTEND_EXISTING from
PHASE-2-CROSSREF." Neither "PHASE-2-CROSSREF" nor "wiring_registry" exist under those literal
names anywhere on disk (confirmed via whole-filesystem search) -- traced the real lineage instead:

- Real data: `/opt/veridian/ai-os/memory/sap_mapping.sqlite`'s `sap_reports` table (NOT in this
  repo, NOT Postgres -- shared host-level SQLite, 80 rows). Queried read-only directly.
- The "Phase 2 cross-reference" = the `veridian_mapping_status` column, populated by
  task-20260728-160934 (commits on an unmerged branch,
  `worker/task-20260728-160934-cross-reference-sap-reports-vs-existing`) and independently
  re-verified by task-20260729-001528 (see `ai-os/tasks/sap_mapping/SAP_REPORTS_80_CROSS_REFERENCE_STATUS.yaml`
  on branch `worker/task-20260729-001528-cross-reference-sap-reports-vs-existing`, also unmerged).
- "wiring_registry" = `compliance.computation_engines` (schema.ts:9488), the real Postgres-backed
  VCEL catalog behind `src/lib/engines/*.ts` -- NOT claude-control repo's
  `WIRING_ENGINE_REGISTRY_2026-07-25.json` (a different, platform-wiring-only registry, per that
  file's own real_storage_locations section).
- 36 of 80 sap_reports rows have `engine_track='calculation'` AND `veridian_mapping_status` starting
  with `BUILD_NEW` or `EXTEND_EXISTING` (9 BUILD_NEW, 27 EXTEND_EXISTING) -- these are this task's
  scope. Full row dump: `/tmp/calc_rows.json` (this session only, not committed -- regenerate with
  the query in this file's own history if needed).
- **Duplicate-task note**: `worker/task-20260729-092858-build-extend-calculation-track-engines`
  (commit 5ce7bfc0, claimed_at 09:31:54Z) registered the identical claim ~2h before this session
  and did zero real work beyond that one commit (no PR, confirmed via `gh pr list`). Took over under
  this task's own id per ACTIVE-CLAIMS.yaml protocol #1 (stale/abandoned claim).
- Registering each new/extended engine's row in `compliance.computation_engines` via an idempotent
  `INSERT ... ON CONFLICT (engine_key) DO UPDATE` in that group's own migration file (established
  pattern -- see e.g. drizzle/0100_gst_reconciliation_engine.sql's HSN-master seed), immediately per
  group, not batched to the end.

## Plan -- 36 rows grouped by target file (commit per group)

### Group 1: GL/CO -- erp-accounting-service.ts + erp-financial-report-service.ts
- [ ] CO-001 Cost Center Line Item Display (extend listJournalEntries w/ costCenterId filter + drill-down)
- [ ] CO-003 Cost Center Hierarchy Report (recursive parent/child rollup over erpCostCenters)
- [ ] FI-GL-002 G/L Account Balances Display (single/range-account filter over trialBalance)
- [ ] FI-GL-007 Subledger Reconciliation to GL (BUILD_NEW -- AR/AP subledger totals vs GL recon accounts)
- [ ] FI-GL-008 G/L Account Group Balances Summary (rollup by erpAccounts.parentAccountId/isGroup)

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
(updated per-group as work lands)

## Remaining
All 8 groups above, not started as of this writing.
