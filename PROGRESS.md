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

### Group 2: AP -- erp-buying-service.ts + erp-invoicing-service.ts (AP-side) [DONE]
- [x] FI-AP-001 Vendor Line Item Display (listVendorLineItems -- open+cleared, partial-clearing math)
- [x] FI-AP-002 Vendor Balances (vendorBalances)
- [x] FI-AP-003 Vendor Items Aging Report (apAgingReport)
- [x] FI-AP-004 Vendor Account Balance Display (vendorAccountBalanceDisplay)
- [x] FI-AP-005 Payment Run / Payment Proposal (paymentProposalList, BUILD_NEW -- added
      erpSuppliers.earlyPaymentDiscountPercent/Days for the discount calc)
- [x] FI-AP-006 Vendor Payment Behavior / DPO (vendorPaymentBehaviorReport, BUILD_NEW)
- [x] FI-AP-007 Subcontractor Retention Summary (subcontractorRetentionSummary, BUILD_NEW --
      added erpPurchaseInvoices.retentionPercent/retentionAmount/netPayable, computed in
      createPurchaseInvoice; deliberately informational only -- outstandingAmount/GL posting
      unchanged so FI-GL-007's subledger reconciliation stays correct; retention release
      workflow is a documented follow-up, not built here)
- [x] MM-004 Purchase Orders by Project/WBS (added erpPurchaseOrders.projectId; listPurchaseOrders
      projectId filter + purchaseOrdersByProjectSummary)
- [x] MM-008 Vendor Purchasing History Report (vendorPurchasingHistoryReport)
- [x] PS-005 Project Commitments Report (projectCommitmentsReport, composes
      purchaseOrdersByProjectSummary, with >60-day commitment-aging flags)
- Schema additions: drizzle/0270_calc_track_group2_ap_project_retention.sql. Engine registry:
  drizzle/0271_calc_track_group2_ap_engines.sql. Full-repo `tsc --noEmit` clean after this group
  (needed NODE_OPTIONS=--max-old-space-size=4096 in this sandbox -- default heap OOMs on the
  full project graph, unrelated to this change).

### Group 3: AR -- erp-selling-service.ts + erp-invoicing-service.ts (AR-side) [DONE]
- [x] FI-AR-001 Customer Line Item Display (listCustomerLineItems)
- [x] FI-AR-002 Customer Balances (customerBalances)
- [x] FI-AR-005 Customer Credit Exposure (customerCreditExposure -- open AR + open order value vs creditLimit)
- [x] FI-AR-006 Customer Payment History / DSO (customerPaymentBehaviorReport, BUILD_NEW)
- [x] FI-AR-007 Customer Account Balance Display (getCustomerOverview extended with openInvoices split)
- [x] SD-004 Open Sales Order Backlog Report (salesOrderBacklogReport, project-level)
- [x] SD-005 Customer Sales Analysis (customerSalesAnalysis, with prior-period variance)
- [x] SD-006 Sales by Material/Service Type (revenueByServiceType, BUILD_NEW -- grouped by
      erpItems.itemGroupId, margin from standardBuyingRate)
- [x] SD-008 Cancelled and Rejected Billing Analysis (cancelledAndRejectedBillingAnalysis)
- No schema additions this group. Engine registry: drizzle/0272_calc_track_group3_ar_engines.sql.
  Full-repo `tsc --noEmit` clean after this group.

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
- Group 2 (AP, 10 rows: FI-AP-001..007, MM-004, MM-008, PS-005) -- see checkboxes above.
- Group 3 (AR, 9 rows: FI-AR-001/002/005/006/007, SD-004/005/006/008) -- see checkboxes above.

## Remaining
Groups 4-8 (12 rows), not started as of this writing. Next session: start
with Group 4 (Treasury/PS -- banking-engine.ts + erp-cash-service.ts +
construction-expense-service.ts). Follow the established per-group loop:
read gap_notes/implementation_notes from sap_mapping.sqlite for each row
first, implement at the same lightweight/real-computation scope as Groups
1-3 (no schema/feature scope creep beyond what gap_notes confirms is
actually missing), typecheck with
`NODE_OPTIONS=--max-old-space-size=4096 npx tsc --noEmit -p .` (default
heap OOMs in this sandbox), register engines in computation_engines via a
new drizzle/027N migration + hand-append a drizzle/meta/_journal.json
entry (drizzle-kit generate is NOT safe to run here -- the meta snapshot
is stale from an earlier session, see 0270/0271/0272's own commits for the
established hand-write pattern), then commit+push per group.
