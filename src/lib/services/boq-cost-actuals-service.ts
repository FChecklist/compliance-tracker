// R85 Addendum 3 v4 (FINAL, supersedes v3/v2/Addendum 2 -- claude_log 379),
// owner rulings D87 (366) D88 (372) D89 (373) D90 (374) D91 (375). PHASE 5
// (Part A5, gates 5-01..5-07): COMMITTED AND SPENT.
//
// A5, verbatim: "rate_project IS ALWAYS THE CURRENT BEST ESTIMATE ... ONE
// column, not three. COMMITTED and SPENT are DERIVED, never editable, never
// on the line: cost_committed = SUM(PO grand_total) + SUM(subcontract
// commitments) + SUM(committed labour), scoped to the project. cost_spent =
// SUM(received supplier invoices) + SUM(paid labour)." X-06 forbids storing
// either figure on constructionBoqLineItems or anywhere else -- both are
// computed live, on every call, from the source ERP/construction tables
// below. Nothing in this file is a second producer of boq-dual-view-
// service.ts's project_value/contract_value/variance math (X-27) -- this
// file only ever adds the two NEW figures A5 defines, committed and spent,
// and the cost-variance comparison against a baseline estimate supplied by
// the caller (see computeCostVariance's own comment on why it takes that
// baseline as a parameter rather than importing Phase 3).
//
// ─── G-25 INVESTIGATION (done BEFORE writing a line of this file, per that
// rule's "query whether it exists before building it") -- real table/column
// names, confirmed against BOTH src/lib/db/schema.ts and a live
// information_schema query against pcrjmlpuqsbocqfwoxod (they agree, no
// drift found on any table named below) ───────────────────────────────────
//
// PURCHASE ORDERS (the PO term). compliance.erp_purchase_orders has a real,
// live `project_id` column (nullable -- "Point 121: the missing link a
// PO-derived project value needs", schema.ts's own comment) and a real
// `grand_total` numeric column. A draft PO is not yet a commitment and a
// cancelled one no longer is one -- excluded here via `status <> 'draft'
// AND status <> 'cancelled'`, the SAME exclusion erp-buying-service.ts's own
// listPurchaseOrders-for-supplier query already uses for "does this
// supplier have live commitments" (see its `ne(status,'draft')`/
// `ne(status,'cancelled')` pair) -- reused, not reinvented.
//
// SUBCONTRACTS (the spec's second committed-cost term). THIS SCHEMA HAS NO
// SEPARATE SUBCONTRACT TABLE. A subcontractor is simply an erp_suppliers row
// (optionally tagged via its own free-text `trade` and `project_id` columns,
// Wave 120's "Vendor Master enhancement" comment: "a subcontractor-type
// supplier tied to one job") -- their commitments are raised and tracked
// through the SAME erp_purchase_orders / erp_purchase_invoices tables as
// any other supplier. Querying a second "subcontract commitments" source
// would therefore double-count exactly what the PO term above already
// counts. constructionBoqLineItems.vendorAmount (R39/R-C09, Point 154) is
// NOT this either -- it is an editable, ON-THE-LINE budget-split overlay
// (material/manpower/vendor amounts the estimator types in), which is
// precisely the shape X-06 forbids cost_committed from having. If a real
// subcontract-agreement-value concept distinct from a raised PO is ever
// added to this schema, wire its sum into computeCommittedCostWithDb below
// as a third term -- do not build a second producer elsewhere.
//
// COMMITTED LABOUR (the PO term's sibling). compliance.construction_
// attendance.daily_cost is the only real labour-cost figure this codebase
// has: computed and snapshotted at write time (construction-labour-
// service.ts's recordAttendance/recordAttendanceBatch) from the roster's
// daily_rate. A marked attendance row means a day was worked, which is a
// wage the firm has already incurred and owes -- exactly the "on the hook
// for it" character A5's COMMITTED figure is asking for -- so every
// attendance row for the project counts here, in full.
//
// PAID LABOUR (the spent-side sibling of the line above). THIS SCHEMA HAS NO
// DISBURSEMENT TRACKING FOR SITE LABOUR, AND THAT IS A REAL, DOCUMENTED GAP,
// NOT A FABRICATED ZERO. erp_payroll_runs/erp_payslips exist and DO have a
// real 'paid' status, but they are scoped to employeeProfiles-linked staff;
// construction_labour_roster "deliberately has no userId FK" (its own
// schema.ts comment: "site labour rarely has login accounts"), so there is
// no join from a roster/attendance row to a payroll run at all. Until a real
// site-labour disbursement record exists, "paid labour" contributes ZERO
// ROWS to cost_spent below -- it does not silently borrow the committed
// figure, and it does not fabricate a 0. Whoever adds that record should
// wire its row-count and sum into computeSpentCostWithDb, not build a
// second producer.
//
// RECEIVED SUPPLIER INVOICES (the cost_spent PO-side term).
// compliance.erp_purchase_invoices has a real `grand_total`, a real
// `status` (erp_invoice_status: draft|submitted|partially_paid|paid|
// overdue|cancelled -- confirmed live, matches schema.ts's enum exactly),
// and a real but NULLABLE `purchase_order_id`. Critically, this table has
// NO project_id column of its own (confirmed live via information_schema --
// zero drift from schema.ts on this point), so a purchase invoice is only
// attributable to a project by joining through purchase_order_id ->
// erp_purchase_orders.project_id. schema.ts's own Wave 85 comment records
// that purchaseOrderId "existed since Wave 49 with zero service-layer
// writer" until Wave 85 -- so any invoice raised before that wave, or any
// invoice never linked to a PO at all (createPurchaseInvoice's
// purchaseOrderId parameter is optional), is genuinely NOT attributable to
// any one project. Those invoices are correctly EXCLUDED here, never
// guessed into a project's total and never spread across every project of
// the org. "received" is read as any post-draft status (submitted /
// partially_paid / paid / overdue) -- the spec's own wording is "received
// supplier invoices", not "paid invoices": once an invoice is submitted it
// is a real, recognised obligation regardless of whether it has been
// settled yet, which is the distinction cost_committed vs cost_spent is
// actually drawing (a promise, vs. a recognised bill) rather than
// "unpaid vs paid cash".
//
// ─── RECOMPUTE (5-04) ──────────────────────────────────────────────────────
// "Recompute on PO create, amend, cancel, and on invoice receipt. Prove
// EACH trigger fires." Both figures below are computed LIVE, on every call,
// directly from erp_purchase_orders / erp_purchase_invoices /
// construction_attendance -- NOTHING here is cached. Confirmed by reading
// project-dashboard-cache.ts (the one caching layer this codebase has for
// project financial figures) and by grepping every caller of its
// bustProjectDashboardCache(): only construction-boq-service.ts,
// construction-expense-service.ts and construction-progress-service.ts call
// it. Neither erp-buying-service.ts (PO create/submit/amend/cancel) nor
// erp-invoicing-service.ts (purchase invoice create/submit) call it, or any
// cache of their own -- so a PO or invoice write was never covered by that
// cache in the first place. Therefore "recompute" needs no new
// invalidation mechanism at all: the very next call to
// computeCommittedCost/computeSpentCost after any of those four writes
// reads the row that write just made, because there is nothing sitting in
// between to go stale. boq-cost-actuals-service.test.ts proves this
// concretely for each of the four triggers (create, amend, cancel, receipt)
// by mutating the same in-memory fixture the fake db reads from and
// re-invoking the compute function.
//
// ─── TENANT-SCOPED DB PATTERN ──────────────────────────────────────────────
// Same *WithDb escape hatch this codebase's nested-withTenantContext fix
// established (isBranchEnabledForOrgWithDb in product-branch-service.ts;
// budgetVsActualWithDb/kpiReportWithDb in construction-reports-service.ts):
// every DB-touching export here has a `*WithDb(db, ctx, ...)` sibling that
// takes an already-open handle, for a caller (e.g. a future Phase 9
// analysis-screen aggregate, or an assistant codeReference) that already
// holds a transaction open. The no-suffix functions open their own single
// withTenantContext and delegate to the WithDb form -- never two nested
// transactions.
import { erpPurchaseOrders, erpPurchaseInvoices, constructionAttendance, projects } from "@/lib/db"
import { withTenantContext, type TenantDb } from "@/lib/db/tenant-scoped"
import { and, eq, ne, inArray } from "drizzle-orm"
import { ServiceError } from "./compliance-service"
import { requireConstructionEnabledWithDb } from "./construction-enablement-service"
import { NOT_SET, type MoneyFigure } from "./boq-dual-view-service"
export { ServiceError, NOT_SET }
export type { MoneyFigure }

async function findProjectOrThrow(db: TenantDb, orgId: string, projectId: string) {
  const project = await db.query.projects.findFirst({
    where: and(eq(projects.id, projectId), eq(projects.orgId, orgId)),
  })
  if (!project) throw new ServiceError("Project not found", 404)
  return project
}

/** Every real commitment this project has raised a PO for. Draft (not yet a
 * commitment) and cancelled (no longer one) are excluded -- see this file's
 * header for the precedent this mirrors in erp-buying-service.ts. */
async function committedPurchaseOrders(db: TenantDb, orgId: string, projectId: string) {
  return db.query.erpPurchaseOrders.findMany({
    where: and(
      eq(erpPurchaseOrders.orgId, orgId),
      eq(erpPurchaseOrders.projectId, projectId),
      ne(erpPurchaseOrders.status, "draft"),
      ne(erpPurchaseOrders.status, "cancelled"),
    ),
  })
}

/** Every attendance row recorded against this project -- see this file's
 * header on why the whole accrued figure counts as COMMITTED labour. */
async function committedLabourRows(db: TenantDb, orgId: string, projectId: string) {
  return db.query.constructionAttendance.findMany({
    where: and(eq(constructionAttendance.orgId, orgId), eq(constructionAttendance.projectId, projectId)),
  })
}

/** Every non-draft, non-cancelled purchase invoice reachable from one of
 * this project's own POs. Returns [] (never throws, never guesses) when the
 * project has no POs at all -- there is nothing to join an invoice through. */
async function receivedSupplierInvoices(db: TenantDb, orgId: string, projectId: string) {
  const projectPos = await db.query.erpPurchaseOrders.findMany({
    where: and(eq(erpPurchaseOrders.orgId, orgId), eq(erpPurchaseOrders.projectId, projectId)),
    columns: { id: true },
  })
  const poIds = projectPos.map((po) => po.id)
  if (poIds.length === 0) return []
  return db.query.erpPurchaseInvoices.findMany({
    where: and(
      eq(erpPurchaseInvoices.orgId, orgId),
      inArray(erpPurchaseInvoices.purchaseOrderId, poIds),
      ne(erpPurchaseInvoices.status, "draft"),
      ne(erpPurchaseInvoices.status, "cancelled"),
    ),
  })
}

/**
 * 5-01. cost_committed = SUM(PO grand_total) + SUM(subcontract commitments)
 * + SUM(committed labour), scoped to the project. See this file's header for
 * why the subcontract term contributes zero rows in this schema today (it
 * is not a separate source -- see the PO term) without double-counting or
 * silently dropping anything.
 *
 * 5-03 / X-04: NOT_SET, never 0, when this project has genuinely zero rows
 * across every real committed-cost source (no POs and no attendance at
 * all). A project WITH a real source that happens to sum to exactly 0 (a
 * $0 PO, say) still returns the number 0 -- that is a real answer, not an
 * absence, and X-04 forbids conflating the two.
 */
export async function computeCommittedCostWithDb(
  db: TenantDb,
  ctx: { orgId: string },
  projectId: string,
): Promise<MoneyFigure> {
  if (!projectId) throw new ServiceError("projectId is required", 400)
  await requireConstructionEnabledWithDb(db, ctx.orgId)
  await findProjectOrThrow(db, ctx.orgId, projectId)

  const [pos, labourRows] = await Promise.all([
    committedPurchaseOrders(db, ctx.orgId, projectId),
    committedLabourRows(db, ctx.orgId, projectId),
  ])

  if (pos.length === 0 && labourRows.length === 0) return NOT_SET

  const poTotal = pos.reduce((sum, po) => sum + Number(po.grandTotal), 0)
  const labourTotal = labourRows.reduce((sum, row) => sum + Number(row.dailyCost), 0)
  return poTotal + labourTotal
}

export async function computeCommittedCost(ctx: { orgId: string }, projectId: string): Promise<MoneyFigure> {
  return withTenantContext({ orgId: ctx.orgId }, (db) => computeCommittedCostWithDb(db, ctx, projectId))
}

/**
 * 5-02. cost_spent = SUM(received supplier invoices) + SUM(paid labour).
 * "Paid labour" contributes zero rows in this schema today -- see this
 * file's header; it is a documented gap, never a silent 0 standing in for
 * "no source".
 *
 * 5-03 / X-04: NOT_SET, never 0, when the project has zero received
 * invoices reachable through its own POs (which also covers "this project
 * has no POs at all" -- receivedSupplierInvoices() returns [] in that case
 * too, for the same underlying reason).
 */
export async function computeSpentCostWithDb(
  db: TenantDb,
  ctx: { orgId: string },
  projectId: string,
): Promise<MoneyFigure> {
  if (!projectId) throw new ServiceError("projectId is required", 400)
  await requireConstructionEnabledWithDb(db, ctx.orgId)
  await findProjectOrThrow(db, ctx.orgId, projectId)

  const invoices = await receivedSupplierInvoices(db, ctx.orgId, projectId)
  if (invoices.length === 0) return NOT_SET

  return invoices.reduce((sum, inv) => sum + Number(inv.grandTotal), 0)
}

export async function computeSpentCost(ctx: { orgId: string }, projectId: string): Promise<MoneyFigure> {
  return withTenantContext({ orgId: ctx.orgId }, (db) => computeSpentCostWithDb(db, ctx, projectId))
}

export type CostActuals = { committed: MoneyFigure; spent: MoneyFigure }

/** Convenience combiner for a caller (e.g. Phase 9's analysis screen) that
 * wants both figures from one already-open transaction. Each half still
 * re-runs its own enablement/project-exists check -- redundant DB work, but
 * each function stays independently correct when called on its own, which
 * this codebase's own kpiReportWithDb/budgetVsActualWithDb precedent also
 * accepts (see construction-reports-service.ts). */
export async function computeCostActualsWithDb(
  db: TenantDb,
  ctx: { orgId: string },
  projectId: string,
): Promise<CostActuals> {
  const [committed, spent] = await Promise.all([
    computeCommittedCostWithDb(db, ctx, projectId),
    computeSpentCostWithDb(db, ctx, projectId),
  ])
  return { committed, spent }
}

export async function computeCostActuals(ctx: { orgId: string }, projectId: string): Promise<CostActuals> {
  return withTenantContext({ orgId: ctx.orgId }, (db) => computeCostActualsWithDb(db, ctx, projectId))
}

// ─── 5-06 / 5-07 -- pure, no DB. Both take the baseline's snapshotted
// estimated cost as a plain MoneyFigure PARAMETER rather than importing
// Phase 3's boq-baseline-service.ts directly: Phase 3 was still in progress
// on a separate branch when this file was first written (this comment was
// updated once Phase 3 merged to main -- PR #1697 -- but the parameter
// shape was kept deliberately, both to avoid a cross-branch dependency
// while it was still unmerged and because it keeps this file's own tests
// free of Phase 3's DB-touching setup). INTEGRATION POINT FOR WHOEVER WIRES
// PHASE 9 (the analysis screen) TOGETHER: boq-baseline-service.ts's own
// getEstimatedCostFromBaseline(baseline).projectValue -- "the baseline
// snapshot of rate_project at the project's latest confirmed version, per
// E2/3-09" -- is the exact value to pass as `baselineEstimatedCost` below.
// This file deliberately never imports that table/service itself; the
// caller reads the baseline and hands this file only the number. ──────────

export type CostVarianceLabel = "committed" | "spent"

export type CostVarianceResult = {
  label: CostVarianceLabel
  baselineEstimatedCost: MoneyFigure
  actual: MoneyFigure
  /** baselineEstimatedCost - actual. NOT_SET if either side is NOT_SET. */
  variance: MoneyFigure
}

/**
 * 5-06. COST VARIANCE = baseline estimate - committed, and baseline estimate
 * - spent. Both computed and labelled -- call this once per side (label
 * "committed", label "spent") rather than building two near-identical
 * producers. NOT_SET-propagating per A4/X-04: an unknown baseline or an
 * unknown actual makes the comparison itself unknown, never a fabricated
 * number.
 */
export function computeCostVariance(
  baselineEstimatedCost: MoneyFigure,
  actual: MoneyFigure,
  label: CostVarianceLabel,
): CostVarianceResult {
  const variance: MoneyFigure =
    baselineEstimatedCost === NOT_SET || actual === NOT_SET ? NOT_SET : baselineEstimatedCost - actual
  return { label, baselineEstimatedCost, actual, variance }
}

/**
 * 5-07 / Part C, C-4: "committed exceeding the baseline estimate carries a
 * warning marker and the delta." This is the boolean signal the caller uses
 * to decide whether to raise that marker -- staying consistent with how
 * boq-dual-view-service.ts exposes signals as small pure functions
 * (validateBoqCellEdit, compareBoqLinesBySortKey) rather than a fatter
 * combined "view model" object.
 *
 * NOT_SET on either side answers false, never true: an unknown comparison
 * is not evidence of drift, and warning on an unknown would be exactly the
 * kind of confidently-wrong signal X-04 exists to prevent.
 */
export function isCommittedOverBaseline(baselineEstimatedCost: MoneyFigure, committed: MoneyFigure): boolean {
  if (baselineEstimatedCost === NOT_SET || committed === NOT_SET) return false
  return committed > baselineEstimatedCost
}
