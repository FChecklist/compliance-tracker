// Wave 122 (PROJEXA foundation) -- the 17 named reports from the original
// requirement. NOT forced through custom-report-service.ts's generic
// whitelist (that mechanism only does count(*); most of these need
// sum/avg/joins). One function per report, reusing Wave 115-121 tables and
// services directly. Every function takes the same (ctx, projectId) shape
// so the dynamic route dispatcher (Wave 122 route) can stay a simple switch.
import {
  constructionCategories, constructionActivities, constructionWorkProgressEntries, constructionSiteDiaries,
  constructionBoqs, constructionBoqLineItems, constructionAttendance, constructionLabourRoster, constructionPrevailingWageRates,
  constructionKpiDefinitions, constructionKpiEntries, constructionExpenseEntries, erpStockLedgerEntries, erpItems, erpSalesInvoices,
  documents, pmsIssues, pmsTimeEntries, pmsBillableRates, users, erpBudgetLineItems, erpBudgets, erpCostCenters,
  pmsBudgets, pmsBudgetLineItems, projects, erpSuppliers,
} from "@/lib/db"
import { withTenantContext, type TenantDb } from "@/lib/db/tenant-scoped"
import { and, eq, inArray, sql, gte, lt, lte, or, isNull } from "drizzle-orm"
import { ServiceError } from "./compliance-service"
import { getExpenseSummaryByHead } from "./construction-expense-service"
import { getProjectDashboard } from "./construction-dashboard-service"
import { resolvePmsBillableRatePure } from "./pms-time-service"
// Priority 12 (OPEN-07 point 8 follow-on, 2026-07-14): these 17 functions
// were the same "zero branch-check" gap PR #282 closed for ERP's
// erp-financial-report-service.ts -- gated here the identical way, first
// statement of every exported function, not just at the generic Reports &
// Analysis Engine dispatcher (report-engine-service.ts#executeReportDefinition),
// since these are also reached directly via /api/construction/reports/<name>
// (and its /api/v1/projexa/reports/<name> alias), which never goes through
// that dispatcher at all.
import { requireConstructionEnabled } from "./construction-enablement-service"
export { ServiceError }

async function activityIdsForProject(db: TenantDb, orgId: string, projectId: string) {
  const rows = await db.query.constructionActivities.findMany({ where: and(eq(constructionActivities.orgId, orgId), eq(constructionActivities.projectId, projectId)), columns: { id: true, categoryId: true, name: true } })
  return rows
}

// R67 lane I (WS-I item I-05, R-177). The bucket a line with no category of
// its own falls into. ONE constant, so the report, the filter and the UI can
// never disagree about its spelling -- the Category-wise tab shows this label
// only for lines that TRULY have none.
export const UNCATEGORIZED_LABEL = "Uncategorized"

export type CategoryLine = {
  lineItemId: string
  code: string | null
  description: string
  /** null on the row means "no category"; the roll-up buckets it under UNCATEGORIZED_LABEL. */
  category: string | null
  amount: number
  parentLineItemId: string | null
}

export type CategorySubtotal = { category: string; subtotal: number; lineCount: number }

/**
 * R67 lane I (WS-I item I-05). Pure: groups BOQ lines by category, applies an
 * optional category filter, and returns subtotals plus a Grand Total that ties
 * to them by construction (the total is the sum of the subtotals, never a
 * second, independently-computed sum that could drift -- REPORT.GLOBAL).
 *
 * TWO RULES THAT MATTER:
 *
 * 1. MONEY SUMS ROOT LINES ONLY (Master v5 B-3/D-3, the same
 *    rootBoqLineItemsOnly discipline scopeReport and categoryBoqAmountsReport
 *    already use): a weighted sub-task's amount is derived from its root
 *    ancestor's qty x rate x breakdown %, so the root row already carries the
 *    full value and summing both double-counts. Child rows are still RETURNED
 *    (a QS needs to see them) and still counted in lineCount, they just
 *    contribute 0 to the subtotal.
 *
 * 2. THE FILTER IS CASE-INSENSITIVE, matching construction-boq-category-
 *    service.ts's own comparison rule. A line imported as "civil" must not
 *    silently fall out of a "Civil" filter -- that is a missing row in a money
 *    report, the exact defect the tie check exists to catch.
 */
export function rollUpLinesByCategory(
  lines: CategoryLine[],
  categoryFilter?: string[]
): { lines: CategoryLine[]; byCategory: CategorySubtotal[]; grandTotal: number } {
  // A filter that cleans down to nothing (omitted, [], or only blank strings --
  // e.g. a stray `?category=` on the URL) means EVERY category, never none.
  // Returning an empty report there would look exactly like "this project has
  // no BOQ", which is a different and much more alarming fact.
  const cleaned = (categoryFilter ?? []).map((c) => c.trim().toLowerCase()).filter((c) => c !== "")
  const wanted = cleaned.length > 0 ? new Set(cleaned) : null
  const labelOf = (line: CategoryLine) => line.category ?? UNCATEGORIZED_LABEL

  const kept = wanted ? lines.filter((l) => wanted.has(labelOf(l).toLowerCase())) : lines

  const buckets = new Map<string, CategorySubtotal>()
  for (const line of kept) {
    const label = labelOf(line)
    const key = label.toLowerCase()
    const bucket = buckets.get(key) ?? { category: label, subtotal: 0, lineCount: 0 }
    bucket.lineCount += 1
    // Rule 1 above: only a root line's amount is real money at this level.
    if (line.parentLineItemId === null) bucket.subtotal += line.amount
    buckets.set(key, bucket)
  }

  // Uncategorized always last -- it is a residue, not a category, and reading
  // it between "Paint" and "Plumbing" makes it look like one.
  const byCategory = [...buckets.values()].sort((a, b) => {
    if (a.category === UNCATEGORIZED_LABEL) return 1
    if (b.category === UNCATEGORIZED_LABEL) return -1
    return a.category.localeCompare(b.category)
  }).map((b) => ({ ...b, subtotal: Math.round(b.subtotal * 100) / 100 }))

  const grandTotal = Math.round(byCategory.reduce((s, b) => s + b.subtotal, 0) * 100) / 100
  return { lines: kept, byCategory, grandTotal }
}

export type WorkProgressReportOptions = {
  /** R67 I-05: keep only lines in these categories. Empty/omitted = every category. */
  categoryFilter?: string[]
}

// 1. Work Progress Report -- latest logged % complete + total quantity done per activity.
//
// R67 lane I (WS-I item I-05, R-177) adds the CATEGORY dimension alongside the
// activity one, additively: `activities` keeps its exact previous shape and
// meaning for every existing caller, and `lines`/`byCategory`/`grandTotal` are
// new keys computed from the latest non-superseded BOQ's line items, filtered
// server-side by `options.categoryFilter`.
//
// Why the category rows come from the BOQ and not from `activities`: an
// activity has no category of its own except through
// constructionCategories (the per-project progress hierarchy), and most real
// BOQ lines have no activityId at all -- an imported BOQ never does. The new
// construction_boq_line_items.category column (drizzle/0532) is the only place
// a line's real category lives.
export async function workProgressReport(
  ctx: { orgId: string },
  projectId: string,
  options: WorkProgressReportOptions = {}
) {
  await requireConstructionEnabled(ctx.orgId)
  return withTenantContext({ orgId: ctx.orgId }, async (db) => {
    const activities = await activityIdsForProject(db, ctx.orgId, projectId)

    let activityRows: { activityId: string; name: string; quantityDone: number; percentComplete: number }[] = []
    if (activities.length > 0) {
      const ids = activities.map((a) => a.id)
      const totals = await db.select({
        activityId: constructionWorkProgressEntries.activityId,
        totalQuantityDone: sql<number>`coalesce(sum(${constructionWorkProgressEntries.quantityDone}), 0)::float`,
        latestPercent: sql<number>`(array_agg(${constructionWorkProgressEntries.percentComplete} order by ${constructionWorkProgressEntries.entryDate} desc))[1]`,
      }).from(constructionWorkProgressEntries).where(inArray(constructionWorkProgressEntries.activityId, ids)).groupBy(constructionWorkProgressEntries.activityId)
      const byActivity = new Map(totals.map((t) => [t.activityId, t]))
      activityRows = activities.map((a) => ({ activityId: a.id, name: a.name, quantityDone: Number(byActivity.get(a.id)?.totalQuantityDone ?? 0), percentComplete: Number(byActivity.get(a.id)?.latestPercent ?? 0) }))
    }

    // Same "latest active revision" pick as scopeReport/categoryBoqAmountsReport,
    // including PR #1325's createdAt DESC tiebreaker -- this report must not
    // categorise a different revision than the Scope report totals.
    const boqs = await db.query.constructionBoqs.findMany({
      where: and(eq(constructionBoqs.orgId, ctx.orgId), eq(constructionBoqs.projectId, projectId)),
      orderBy: (t, { desc }) => [desc(t.version), desc(t.createdAt)],
    })
    const latest = boqs.find((b) => b.status !== "superseded") ?? boqs[0]
    const lineItems = latest
      ? await db.query.constructionBoqLineItems.findMany({
          where: eq(constructionBoqLineItems.boqId, latest.id),
          columns: { id: true, itemCode: true, description: true, category: true, amount: true, parentLineItemId: true },
        })
      : []

    const rollup = rollUpLinesByCategory(
      lineItems.map((item) => ({
        lineItemId: item.id,
        code: item.itemCode,
        description: item.description,
        category: item.category,
        amount: Number(item.amount),
        parentLineItemId: item.parentLineItemId,
      })),
      options.categoryFilter
    )

    return {
      activities: activityRows,
      boqId: latest?.id ?? null,
      lines: rollup.lines,
      byCategory: rollup.byCategory,
      grandTotal: rollup.grandTotal,
    }
  })
}

// 2. Weekly Project Report -- composite: progress/attendance/diary/expenses within a 7-day window.
// R65 (2026-08-30, reports-engine gap closure): rptdef_monthly_project_report's
// own data_gap_note said this function "computes a fixed 7-day composite
// window; no monthly-window (weekStart -> monthStart) variant exists yet --
// would need a straightforward generalization." This is that generalization:
// the real composite-window computation is extracted into
// projectPeriodReport() (arbitrary [periodStart, periodEnd) window), and
// weeklyProjectReport() becomes a thin 7-day-window caller of it -- same
// real behavior/return shape as before for every existing caller, zero
// duplication for the new monthly variant (report-engine-service.ts's
// computeMonthlyProjectReport formula).
export async function projectPeriodReport(ctx: { orgId: string }, projectId: string, periodStart: string, periodEnd: string) {
  await requireConstructionEnabled(ctx.orgId)
  return withTenantContext({ orgId: ctx.orgId }, async (db) => {
    const [progressCount] = await db.select({ count: sql<number>`count(*)` }).from(constructionWorkProgressEntries)
      .where(and(eq(constructionWorkProgressEntries.orgId, ctx.orgId), eq(constructionWorkProgressEntries.projectId, projectId), sql`${constructionWorkProgressEntries.entryDate} >= ${periodStart} and ${constructionWorkProgressEntries.entryDate} < ${periodEnd}`))
    const [attendanceCost] = await db.select({ total: sql<number>`coalesce(sum(${constructionAttendance.dailyCost}), 0)::float`, presentCount: sql<number>`count(*) filter (where ${constructionAttendance.status} = 'present')` })
      .from(constructionAttendance).where(and(eq(constructionAttendance.orgId, ctx.orgId), eq(constructionAttendance.projectId, projectId), sql`${constructionAttendance.attendanceDate} >= ${periodStart} and ${constructionAttendance.attendanceDate} < ${periodEnd}`))
    const diaryEntries = await db.query.constructionSiteDiaries.findMany({ where: and(eq(constructionSiteDiaries.orgId, ctx.orgId), eq(constructionSiteDiaries.projectId, projectId), gte(constructionSiteDiaries.diaryDate, periodStart), lt(constructionSiteDiaries.diaryDate, periodEnd)) })
    const [expenseTotal] = await db.select({ total: sql<number>`coalesce(sum(${constructionExpenseEntries.amount}), 0)::float` }).from(constructionExpenseEntries)
      .where(and(eq(constructionExpenseEntries.orgId, ctx.orgId), eq(constructionExpenseEntries.projectId, projectId), gte(constructionExpenseEntries.expenseDate, periodStart), lt(constructionExpenseEntries.expenseDate, periodEnd)))
    return {
      periodStart, periodEnd,
      progressEntriesLogged: Number(progressCount?.count ?? 0),
      labourCost: Number(attendanceCost?.total ?? 0),
      workersPresent: Number(attendanceCost?.presentCount ?? 0),
      diaryEntries: diaryEntries.length,
      expenseTotal: Number(expenseTotal?.total ?? 0),
    }
  })
}

export async function weeklyProjectReport(ctx: { orgId: string }, projectId: string, weekStart: string) {
  const weekEnd = new Date(new Date(weekStart).getTime() + 7 * 86400000).toISOString().slice(0, 10)
  const result = await projectPeriodReport(ctx, projectId, weekStart, weekEnd)
  return { weekStart, weekEnd, progressEntriesLogged: result.progressEntriesLogged, labourCost: result.labourCost, workersPresent: result.workersPresent, diaryEntries: result.diaryEntries, expenseTotal: result.expenseTotal }
}

// 3. Project Status Report -- reuses the project dashboard verbatim.
export async function projectStatusReport(ctx: { orgId: string }, projectId: string) {
  await requireConstructionEnabled(ctx.orgId)
  return getProjectDashboard(ctx, projectId)
}

// 4. Attendance Report -- present/absent/half_day counts + cost, by trade.
export async function attendanceReport(ctx: { orgId: string }, projectId: string) {
  await requireConstructionEnabled(ctx.orgId)
  return withTenantContext({ orgId: ctx.orgId }, async (db) => {
    const rows = await db.select({
      trade: constructionLabourRoster.trade,
      status: constructionAttendance.status,
      count: sql<number>`count(*)`,
      cost: sql<number>`coalesce(sum(${constructionAttendance.dailyCost}), 0)::float`,
    }).from(constructionAttendance)
      .innerJoin(constructionLabourRoster, eq(constructionAttendance.rosterId, constructionLabourRoster.id))
      .where(and(eq(constructionAttendance.orgId, ctx.orgId), eq(constructionAttendance.projectId, projectId)))
      .groupBy(constructionLabourRoster.trade, constructionAttendance.status)
    return { rows }
  })
}

// 5. Site Picture Report -- documents(category='site_photo') grouped by date.
export async function sitePictureReport(ctx: { orgId: string }, projectId: string) {
  await requireConstructionEnabled(ctx.orgId)
  return withTenantContext({ orgId: ctx.orgId }, async (db) => {
    const photos = await db.query.documents.findMany({
      where: and(eq(documents.orgId, ctx.orgId), eq(documents.category, "site_photo"), eq(documents.linkedEntityType, "project"), eq(documents.linkedEntityId, projectId)),
      orderBy: (t, { desc }) => desc(t.createdAt),
      columns: { id: true, name: true, createdAt: true, metadata: true },
    })
    return { photos }
  })
}

// Shared BOQ money predicate (Master v5 B-3 / D-3): a weighted sub-task's amount
// is derived from its ROOT ancestor's qty x rate x breakdown %, so the root row
// already carries the full value. Summing roots AND sub-tasks double-counts.
// Every BOQ value roll-up must aggregate ROOT rows only -- which is what the
// customer-facing View dialog total already does (projexa ScopeClient.tsx
// boqTotal). Used by scopeReport and categoryBoqAmountsReport.
const rootBoqLineItemsOnly = (boqId: string) =>
  and(eq(constructionBoqLineItems.boqId, boqId), isNull(constructionBoqLineItems.parentLineItemId))

// R39/R-51 (D-3 extension, NOT a second summation path): earned value is a
// faithful, minimal port of projexa's applyWeightedParentRollup -- the ONE
// place this weighted-rollup algorithm lives (a real cross-repo constraint;
// compliance-tracker cannot import from projexa). Both must be kept in sync
// by hand; this comment is the pointer. Summed over ROOT lines only (same
// rootBoqLineItemsOnly discipline as scopeReport/categoryBoqAmountsReport
// above -- summing roots AND children double-counts, D-3/B-3). A childless
// root uses its own cumulative DELTA quantity x its own rate. A root WITH
// children uses SUM(child cumQty x root.rate x child.breakdownPercentage/100).
// CORRECTED 2026-08-24 (R45 seq 7 / E-127): this file previously claimed
// "children's own rate/amount are always 0 in real BOQ storage" -- checked
// directly against production and that was FALSE. A follow-up verify pass
// the same day re-checked the OPPOSITE claim this comment used to make ("477/
// 477 child rows match, zero exceptions, no migration needed") and that was
// ALSO FALSE -- re-verified live via Supabase MCP 2026-08-24 (root-ancestor
// resolution via parent_line_item_id): 503 total child rows, 287 matching
// F2/F3 exactly, 216 mismatching. Of those 216: 198 are harmless e2e test
// noise (demo-gate-smoke.spec.ts submitting quantity:1/rate:1 on children
// against real production before this write-path fix existed -- same family
// as the accepted "R-B1 smoke" rows, left alone per this repo's P-11
// protocol against raw-SQL test cleanup) and 18 were real, pre-existing
// DEMO-ORG data (org_id='projexa_demo_org' and 've45lczmkodbiq1m20fy48r5',
// both confirmed non-production demo tenants, created 2026-08-23/24 --
// before this write-path fix landed). Those 18 were backfilled to the
// canonical F2/F3 rate/quantity via scripts/backfill-r45-seq7-child-rate-
// convention.ts (real before/after counts in that script's own header and
// this PR's description) -- 0 real (non-smoke-noise) mismatches remained
// immediately after. This calculation is still correct regardless of any of
// the above -- it multiplies by root.rate x breakdownPct/100 directly rather
// than reading child.rate, which is mathematically identical to child.rate
// now that F2 is enforced at write time, and never double-counts even
// though child rows exist in the same table. R-46-aware: only
// entry_basis='DELTA' quantity is summed (a SNAPSHOT reading isn't a
// this-period delta and must never be added into a cumulative sum -- same
// rule as work-progress-report.ts's sumQtyInRange). KNOWN LIMITATION
// (inherited from applyWeightedParentRollup's own documented one): only
// ONE level of hierarchy nesting is handled -- see that function's comment.
export type EvLineItem = {
  id: string
  parentLineItemId: string | null
  rate: string | number
  amount: string | number
  breakdownPercentage: string | number | null
}

// R46/R-51 (D-3 extension, confirmed live 2026-08-25 -- fault
// R46P5_R51_01): earnedValueReport() only ever read `quantity_done`
// (physical "Units Completed" method, BCWP = qty x rate) and completely
// ignored `percentComplete`, even though createProgressEntry() requires
// and validates percentComplete (0-100) on every real progress entry
// exactly as it requires quantityDone -- both are equally real, equally
// recorded signals, but only one was ever read here. A field crew that
// reports "50% done" before a precise quantity survey is a normal,
// legitimate real-world logging pattern (industry-standard EVM's own
// "% Complete method", BCWP = %complete x line's contracted value, a
// long-standing alternative to the "Units Completed method" this file
// already implements) -- previously that entry was silently worth $0 of
// earned value, identical to a line with NO progress logged at all.
// Live evidence: Oakwood Residence (upv2q7pv8qcwdayybvu74egm) had 13 real
// construction_work_progress_entries rows (percent_complete 15-60,
// 2026-08-24) yet GET /api/projects read earnedValue:0 -- confirmed via
// Supabase MCP that its active BOQ's own root line item (which has
// children, so its own quantity_done was ALSO already being dropped
// entirely by the pre-existing children-only loop below, a second, related
// bug fixed in the same pass) had 2 real entries, percentComplete=50,
// quantityDone=0 both times: real, reported progress with nothing to show
// for it under the old qty-only formula.
//
// Fix, applied per line item (root's own line, and independently per
// child): prefer a real measured quantity (qty x rate) exactly as before
// -- this is strictly additive, every existing qty>0 code path is
// byte-for-byte unchanged. ONLY when a line's summed DELTA quantity is 0
// (no physical measurement recorded for it at all) does it fall back to
// (latest percentComplete / 100) x that line's own contracted value
// (root.amount for a childless root or the root itself; root.amount x
// breakdownPercentage/100 -- the same share-of-parent-value convention the
// qty-based child formula already uses -- for a child). "Latest
// percentComplete per item" uses the same DISTINCT ON ... ORDER BY
// entry_date DESC convention categoryProgressReport() above already uses;
// unlike quantity_done, percentComplete is a cumulative/absolute reading,
// never summed across entries.
export function computeEarnedValue(
  allItems: EvLineItem[],
  qtyByItem: Map<string, number>,
  latestPercentByItem: Map<string, number>
): { earnedValue: number; contractValue: number; percentByValue: number } {
  const roots = allItems.filter((i) => i.parentLineItemId === null)
  const childrenByParent = new Map<string, EvLineItem[]>()
  for (const item of allItems) {
    if (item.parentLineItemId) {
      const list = childrenByParent.get(item.parentLineItemId) ?? []
      list.push(item)
      childrenByParent.set(item.parentLineItemId, list)
    }
  }

  // Earned value for one line: real measured quantity wins when there is
  // one; percentComplete of the line's own contracted value only fills in
  // when there is nothing measured to read.
  const lineEarnedValue = (itemId: string, rate: number, lineValue: number) => {
    const measuredQty = qtyByItem.get(itemId) ?? 0
    if (measuredQty > 0) return measuredQty * rate
    const pct = latestPercentByItem.get(itemId)
    return pct ? (pct / 100) * lineValue : 0
  }

  let earnedValue = 0
  let contractValue = 0
  for (const root of roots) {
    const rootAmount = Number(root.amount)
    const rootRate = Number(root.rate)
    contractValue += rootAmount
    const children = childrenByParent.get(root.id)
    if (children && children.length > 0) {
      // The root's own line can carry real progress too (logged before its
      // scope was broken into weighted children, or reported at the parent
      // level directly) -- previously dropped unconditionally whenever
      // children existed; now counted additively on top of whatever the
      // children separately earn, never double-counted against them.
      earnedValue += lineEarnedValue(root.id, rootRate, rootAmount)
      for (const child of children) {
        const breakdownPct = Number(child.breakdownPercentage ?? 0)
        const childShareOfContractValue = rootAmount * (breakdownPct / 100)
        // A measured child quantity must still be scaled by the same
        // rootRate x breakdownPct/100 the pre-existing formula always used
        // -- folded into the "rate" passed to lineEarnedValue() so the
        // percent-fallback branch (which needs the child's plain share of
        // contract value, not that value again) stays correct too.
        earnedValue += lineEarnedValue(child.id, rootRate * (breakdownPct / 100), childShareOfContractValue)
      }
    } else {
      earnedValue += lineEarnedValue(root.id, rootRate, rootAmount)
    }
  }

  const percentByValue = contractValue > 0 ? Math.round((earnedValue / contractValue) * 10000) / 100 : 0
  return { earnedValue: Math.round(earnedValue * 100) / 100, contractValue, percentByValue }
}

export async function earnedValueReport(ctx: { orgId: string }, projectId: string) {
  await requireConstructionEnabled(ctx.orgId)
  return withTenantContext({ orgId: ctx.orgId }, async (db) => {
    const boqs = await db.query.constructionBoqs.findMany({ where: and(eq(constructionBoqs.orgId, ctx.orgId), eq(constructionBoqs.projectId, projectId)), orderBy: (t, { desc }) => [desc(t.version), desc(t.createdAt)] })
    const latest = boqs.find((b) => b.status !== "superseded") ?? boqs[0]
    if (!latest) return { earnedValue: 0, contractValue: 0, percentByValue: 0 }

    const allItems = await db.query.constructionBoqLineItems.findMany({ where: eq(constructionBoqLineItems.boqId, latest.id) })

    const itemIds = allItems.map((i) => i.id)
    let qtyByItem = new Map<string, number>()
    let latestPercentByItem = new Map<string, number>()
    if (itemIds.length > 0) {
      const idsSql = sql.join(itemIds.map((id) => sql`${id}`), sql`, `)
      const rows = (await db.execute(sql`
        SELECT boq_line_item_id, coalesce(sum(quantity_done), 0)::float AS total_qty
        FROM compliance.construction_work_progress_entries
        WHERE boq_line_item_id = ANY(ARRAY[${idsSql}]) AND entry_basis = 'DELTA'
        GROUP BY boq_line_item_id
      `)) as { boq_line_item_id: string; total_qty: number }[]
      qtyByItem = new Map(rows.map((r) => [r.boq_line_item_id, Number(r.total_qty)]))

      const percentRows = (await db.execute(sql`
        SELECT DISTINCT ON (boq_line_item_id) boq_line_item_id, percent_complete
        FROM compliance.construction_work_progress_entries
        WHERE boq_line_item_id = ANY(ARRAY[${idsSql}])
        ORDER BY boq_line_item_id, entry_date DESC
      `)) as { boq_line_item_id: string; percent_complete: number }[]
      latestPercentByItem = new Map(percentRows.map((r) => [r.boq_line_item_id, Number(r.percent_complete)]))
    }

    return computeEarnedValue(allItems, qtyByItem, latestPercentByItem)
  })
}

// R39/R-C09 (Point 154 follow-on): per-line budget vs actual-vendor-cost
// variance, over the latest (non-superseded) BOQ's line items -- reuses the
// SAME budgetPercentage/vendorId/vendorAmount columns Point 154 already
// shipped and computedBudget()'s exact formula (imported indirectly via the
// same amount*pct/100 arithmetic, kept in one place per D-3 -- see that
// function's own comment for why it's not stored). variance = vendorAmount -
// budget; null (not 0) when no vendor amount has been entered yet for a
// line, a real "not yet quoted" state, not a fabricated zero variance.
/**
 * R67 D-62 (audit R-202). One BOQ line, as the Budget tab reads it. Pure, so the
 * arithmetic and the null rules can be tested without a database.
 *
 * WHY THIS TOOK NO MIGRATION. D-62 says to check whether the line already
 * persists a budget percent and a vendor amount before inventing columns, and it
 * does: budgetPercentage (NOT NULL DEFAULT 25 -- the "25% default budget with a
 * per-line override" the item asks for is the column's own default, shipped by
 * Point 154), vendorId and vendorAmount have been real columns since 22 Aug, and
 * updateLineItemBudget() in construction-boq-service.ts is their write path.
 * Nothing here is new storage; the figures simply had no reader.
 *
 * WHICH MATERIAL/MANPOWER COLUMNS (settled at the R67 lane I merge, 2026-09-03).
 * This function reads materialAmount / manpowerAmount, NOT materialCost /
 * labourCost. Both pairs exist on construction_boq_line_items and they mean
 * different things, which schema.ts states at the column: materialCost/
 * labourCost are Wave 125's rate-ANALYSIS inputs, PER UNIT, multiplied up by
 * computedRate() to justify a rate; materialAmount/manpowerAmount are lane I's
 * budget-side AMOUNTS for the whole line, entered next to budgetPercentage and
 * vendorAmount, and are the pair this report is meant to project. D-62's first
 * draft read the cost pair -- exactly the conflation schema.ts warns against --
 * and the lane I merge corrected it. Do not swap them back.
 *
 * The category is the line's OWN `category` column (lane I, I-05), not a value
 * re-derived through activityId -> activity -> category: that indirection cost
 * two extra reads per report and answered null for every line filed under no
 * activity, including lines the importer had already categorised from the
 * customer's own spreadsheet.
 *
 * null, never 0, for every unset figure: a line nobody has quoted and a line
 * quoted at zero are different facts, and only the second is worth reporting as
 * a variance.
 */
export type BudgetLineInput = {
  id: string
  itemCode: string | null
  description: string
  amount: string | number
  budgetPercentage: string | number
  materialAmount: string | number | null
  manpowerAmount: string | number | null
  vendorId: string | null
  vendorAmount: string | number | null
  category: string | null
}

export function toBudgetLine(item: BudgetLineInput, supplierNameById: Map<string, string>) {
  const rawBudget = Number(item.amount) * (Number(item.budgetPercentage) / 100)
  const vendorAmount = item.vendorAmount !== null ? Number(item.vendorAmount) : null
  const rawVariance = vendorAmount !== null ? vendorAmount - rawBudget : null
  return {
    lineItemId: item.id,
    code: item.itemCode,
    description: item.description,
    amount: Number(item.amount),
    // R67 lane I (WS-I item I-05, R-177): the line's own category, so the
    // Budget table can show a Category column and group by a real value.
    // null (never "") -- normalizeCategory in construction-boq-service.ts is
    // the single writer, so "no category" is one value here, and the Budget
    // Report's Category filter shows those lines under "No category" rather
    // than inventing one.
    category: item.category,
    budgetPercentage: Number(item.budgetPercentage),
    budget: Math.round(rawBudget * 100) / 100,
    // R67 lane I (WS-I item I-03): the material/manpower split, projected
    // alongside the budget it belongs to. null (not 0) when the QS has not
    // split this line -- "unsplit" and "split as zero" are different facts and
    // a report that conflated them would read as if every line had been costed.
    materialAmount: item.materialAmount !== null ? Number(item.materialAmount) : null,
    manpowerAmount: item.manpowerAmount !== null ? Number(item.manpowerAmount) : null,
    vendorId: item.vendorId,
    vendorName: item.vendorId ? (supplierNameById.get(item.vendorId) ?? null) : null,
    vendorAmount,
    variance: rawVariance !== null ? Math.round(rawVariance * 100) / 100 : null,
    _rawBudget: rawBudget,
    _rawVariance: rawVariance,
  }
}

export async function boqBudgetVarianceReport(ctx: { orgId: string }, projectId: string) {
  await requireConstructionEnabled(ctx.orgId)
  return withTenantContext({ orgId: ctx.orgId }, async (db) => {
    const boqs = await db.query.constructionBoqs.findMany({ where: and(eq(constructionBoqs.orgId, ctx.orgId), eq(constructionBoqs.projectId, projectId)), orderBy: (t, { desc }) => [desc(t.version), desc(t.createdAt)] })
    const latest = boqs.find((b) => b.status !== "superseded") ?? boqs[0]
    // R67 lane I (I-03): the empty-project shape must carry the SAME keys as
    // the populated one, or a caller that reads totalMaterialAmount gets
    // undefined on a project with no BOQ and renders "NaN".
    if (!latest) return { lines: [], totalBudget: 0, totalVendorAmount: 0, totalVariance: 0, totalMaterialAmount: 0, totalManpowerAmount: 0 }

    const lineItems = await db.query.constructionBoqLineItems.findMany({ where: eq(constructionBoqLineItems.boqId, latest.id) })
    const vendorIds = [...new Set(lineItems.map((i) => i.vendorId).filter((id): id is string => !!id))]
    const suppliers = vendorIds.length > 0
      ? await db.select({ id: erpSuppliers.id, name: erpSuppliers.supplierName }).from(erpSuppliers).where(inArray(erpSuppliers.id, vendorIds))
      : []
    const supplierNameById = new Map(suppliers.map((s) => [s.id, s.name]))

    // R67 D-62's Budget Report Category filter reads each line's own `category`
    // column (lane I, I-05) inside toBudgetLine below. D-62's first draft
    // resolved it through activityId -> activity -> category with two extra
    // reads on this transaction; that indirection is gone, and with it the null
    // it returned for every line the importer had categorised but nobody had
    // linked to an activity.

    // R48 gap-closure (2026-08-30, F088: "Report figures reconcile to the
    // database exactly"). Real, confirmed bug: totals below used to sum the
    // already-ROUNDED per-line display values (each independently rounded
    // to 2dp) and round again -- cumulative per-line rounding can drift the
    // total by fractions of a currency unit from the true
    // SUM(amount*pct/100) a direct SQL query would return, which is exactly
    // what "to the last unit" rules out. Fixed: keep the raw (unrounded)
    // budget/variance alongside the rounded display value, and total from
    // the RAW figures, rounding only once at the very end -- the totals now
    // reconcile exactly to a raw SQL sum over the same rows.
    const lines = lineItems.map((item) => toBudgetLine(item, supplierNameById))

    const totalBudget = Math.round(lines.reduce((s, l) => s + l._rawBudget, 0) * 100) / 100
    const totalVendorAmount = Math.round(lines.reduce((s, l) => s + (l.vendorAmount ?? 0), 0) * 100) / 100
    const totalVariance = Math.round(lines.reduce((s, l) => s + (l._rawVariance ?? 0), 0) * 100) / 100
    // R67 lane I (WS-I item I-03): totalled once, at the end, over the raw
    // per-line values -- the same single-rounding rule the R48 gap-closure
    // note above established for totalBudget/totalVariance, so these totals
    // reconcile exactly to a raw SQL SUM over the same rows.
    const totalMaterialAmount = Math.round(lines.reduce((s, l) => s + (l.materialAmount ?? 0), 0) * 100) / 100
    const totalManpowerAmount = Math.round(lines.reduce((s, l) => s + (l.manpowerAmount ?? 0), 0) * 100) / 100

    return {
      lines: lines.map(({ _rawBudget, _rawVariance, ...line }) => line),
      totalBudget,
      totalVendorAmount,
      totalVariance,
      totalMaterialAmount,
      totalManpowerAmount,
    }
  })
}

// 6. Scope Report -- BOQ total value + line-item count for the latest (non-superseded) revision.
export async function scopeReport(ctx: { orgId: string }, projectId: string) {
  await requireConstructionEnabled(ctx.orgId)
  return withTenantContext({ orgId: ctx.orgId }, async (db) => {
    // R38 (TC-11/TC-43 fix, same root cause class as point 177/PR #1325): version
    // DESC alone has no tiebreaker when 2+ INDEPENDENT (non-revision-chain) BOQs
    // for this project share the highest version number -- Postgres then returns
    // an arbitrary one, not the actually-latest. createdAt DESC as a secondary
    // key matches construction-boq-service.ts#listBoqs()'s already-fixed ordering
    // (kept as an inline duplicate here rather than a cross-module call, to
    // avoid nesting withTenantContext).
    const boqs = await db.query.constructionBoqs.findMany({ where: and(eq(constructionBoqs.orgId, ctx.orgId), eq(constructionBoqs.projectId, projectId)), orderBy: (t, { desc }) => [desc(t.version), desc(t.createdAt)] })
    const latest = boqs.find((b) => b.status !== "superseded") ?? boqs[0]
    if (!latest) return { boq: null, totalValue: 0, lineItemCount: 0, revisions: [] }
    const [valueRow] = await db.select({ total: sql<number>`coalesce(sum(${constructionBoqLineItems.amount}), 0)::float`, count: sql<number>`count(*)` })
      .from(constructionBoqLineItems).where(rootBoqLineItemsOnly(latest.id))
    return {
      boq: latest, totalValue: Number(valueRow?.total ?? 0), lineItemCount: Number(valueRow?.count ?? 0),
      revisions: boqs.map((b) => ({ id: b.id, version: b.version, status: b.status })),
    }
  })
}

// 7. Budget Summary -- total budget (via cost-center-per-project) + line items by account.
export async function budgetSummary(ctx: { orgId: string }, projectId: string) {
  await requireConstructionEnabled(ctx.orgId)
  return withTenantContext({ orgId: ctx.orgId }, async (db) => {
    const lineItems = await db.select({
      accountId: erpBudgetLineItems.accountId,
      total: sql<number>`coalesce(sum(${erpBudgetLineItems.annualAmount}), 0)::float`,
    }).from(erpBudgetLineItems)
      .innerJoin(erpBudgets, eq(erpBudgetLineItems.budgetId, erpBudgets.id))
      .innerJoin(erpCostCenters, eq(erpBudgets.costCenterId, erpCostCenters.id))
      .where(and(eq(erpBudgets.orgId, ctx.orgId), eq(erpCostCenters.projectId, projectId)))
      .groupBy(erpBudgetLineItems.accountId)
    return { byAccount: lineItems, total: lineItems.reduce((s, r) => s + Number(r.total), 0) }
  })
}

/**
 * R67 D-02. Budget-vs-actual variance when the budget itself may be absent.
 * getProjectDashboard().budget is `number | null` -- null means no budget row
 * exists for the project's scope, and "no budget" has no variance. Returning
 * `0 - actual` there would report every unbudgeted project as overspent by
 * exactly its own spend, which is the fabricated figure this item exists to
 * remove. Extracted so the rule is unit-testable without a live DB.
 */
export function budgetVariance(budget: number | null, actual: number): number | null {
  return budget === null ? null : budget - actual
}

// 8. Budget vs Actual -- budget total (via cost center) vs actual expenses (construction_expense_entries).
export async function budgetVsActual(ctx: { orgId: string }, projectId: string) {
  await requireConstructionEnabled(ctx.orgId)
  const [dashboard, expenseByHead] = await Promise.all([
    getProjectDashboard(ctx, projectId),
    getExpenseSummaryByHead(ctx, projectId),
  ])
  const actual = expenseByHead.reduce((s, r) => s + Number(r.total), 0)
  return { budget: dashboard.budget, actual, variance: budgetVariance(dashboard.budget, actual), byHead: expenseByHead }
}

// 9. Material Consumption Report -- net stock movement per item for this project (negative = consumed).
export async function materialConsumptionReport(ctx: { orgId: string }, projectId: string) {
  await requireConstructionEnabled(ctx.orgId)
  return withTenantContext({ orgId: ctx.orgId }, async (db) => {
    const rows = await db.select({
      itemId: erpStockLedgerEntries.itemId,
      itemName: erpItems.itemName,
      uom: erpItems.uom,
      netQuantity: sql<number>`coalesce(sum(${erpStockLedgerEntries.quantityChange}), 0)::float`,
      totalValue: sql<number>`coalesce(sum(${erpStockLedgerEntries.quantityChange} * ${erpStockLedgerEntries.valuationRate}), 0)::float`,
    }).from(erpStockLedgerEntries)
      .innerJoin(erpItems, eq(erpStockLedgerEntries.itemId, erpItems.id))
      .where(and(eq(erpStockLedgerEntries.orgId, ctx.orgId), eq(erpStockLedgerEntries.projectId, projectId)))
      .groupBy(erpStockLedgerEntries.itemId, erpItems.itemName, erpItems.uom)
    return { items: rows }
  })
}

// 10. Vendor Cost Report -- labour-vendor cost only (attendance.dailyCost by vendor), this wave.
// Purchase-invoice-based vendor cost isn't included: erp_purchase_invoices has
// no project_id column (only erp_sales_invoices and erp_stock_ledger_entries
// got one in Wave 120's plan) -- a known, documented gap, not silently faked.
export async function vendorCostReport(ctx: { orgId: string }, projectId: string) {
  await requireConstructionEnabled(ctx.orgId)
  return withTenantContext({ orgId: ctx.orgId }, async (db) => {
    const rows = await db.select({
      vendorId: constructionLabourRoster.vendorId,
      total: sql<number>`coalesce(sum(${constructionAttendance.dailyCost}), 0)::float`,
    }).from(constructionAttendance)
      .innerJoin(constructionLabourRoster, eq(constructionAttendance.rosterId, constructionLabourRoster.id))
      .where(and(eq(constructionAttendance.orgId, ctx.orgId), eq(constructionAttendance.projectId, projectId), sql`${constructionLabourRoster.vendorId} is not null`))
      .groupBy(constructionLabourRoster.vendorId)
    return { labourVendorCosts: rows, note: "Purchase-invoice-based vendor cost not included -- erp_purchase_invoices has no project_id yet." }
  })
}

// 11. Manpower Cost Report -- attendance dailyCost summed by trade.
// R39/R-C07: `date` is optional -- omitted, this is the existing all-time
// aggregate (unchanged, zero regression for every caller that never passed
// it). Scoped to one day, workerDays IS the real headcount for that date
// (one attendance row per worker per day, so count(*) over a single-date
// filter is exactly "how many people worked"), and totalCost is that same
// day's real labour cost -- the row's own oracle ("trade-wise summary
// returns correct headcount and cost for that date").
export async function manpowerCostReport(ctx: { orgId: string }, projectId: string, date?: string, trade?: string) {
  await requireConstructionEnabled(ctx.orgId)
  return withTenantContext({ orgId: ctx.orgId }, async (db) => {
    const conditions = [eq(constructionAttendance.orgId, ctx.orgId), eq(constructionAttendance.projectId, projectId)]
    if (date) conditions.push(eq(constructionAttendance.attendanceDate, date))
    if (trade) conditions.push(eq(constructionLabourRoster.trade, trade))
    const rows = await db.select({
      trade: constructionLabourRoster.trade,
      totalCost: sql<number>`coalesce(sum(${constructionAttendance.dailyCost}), 0)::float`,
      workerDays: sql<number>`count(*)`,
    }).from(constructionAttendance)
      .innerJoin(constructionLabourRoster, eq(constructionAttendance.rosterId, constructionLabourRoster.id))
      .where(and(...conditions))
      .groupBy(constructionLabourRoster.trade)
    return { byTrade: rows, date: date ?? null }
  })
}

// 12. Designer Timesheet Report -- pms_time_entries hours summed by user,
// for this project's issues, plus a Category/Designer/Project/Designer-status
// Budget-vs-Actual breakdown (Owner's timesheet requirement, marked
// "IMPORTANT"). Reuses pms-budget-service.ts's own budget-vs-actual shape
// (pmsBudgets/pmsBudgetLineItems = planned, sum(hours x resolveBillableRate)
// = actual, computed live -- see getBudget()/getBudgetActuals() there)
// rather than construction-reports-service.ts's own ERP-based
// budgetSummary()/budgetVsActual(): that pattern is a single undivided
// project-wide total (erp_budget_line_items has no userId/category/project
// dimension at all -- confirmed by grep), so it cannot support any of the 4
// breakdowns this report needs. pms_budget_line_items, by contrast, already
// carries a real per-designer (userId) budget dimension -- the correct
// existing pattern to extend, not a new one.
export type DesignerTimesheetEntry = {
  userId: string
  userName: string
  userIsActive: boolean
  projectId: string
  projectName: string
  category: string
  hours: number
  cost: number
}
export type DesignerTimesheetBudgetLine = {
  projectId: string
  userId: string | null
  amount: number
}
export type DesignerTimesheetRosterUser = {
  userId: string
  isActive: boolean
}

function sumBy<T>(items: T[], keyFn: (item: T) => string, valueFn: (item: T) => number) {
  const totals = new Map<string, number>()
  for (const item of items) {
    const key = keyFn(item)
    totals.set(key, (totals.get(key) ?? 0) + valueFn(item))
  }
  return totals
}

/**
 * Pure Budget-vs-Actual aggregator: given every relevant time entry (already
 * priced at its resolved billable rate) and every relevant budget line item
 * for the org, computes the 4 breakdowns the Owner's timesheet requirement
 * asks for. No DB access here -- entries/budgetLines are fetched by the
 * caller (designerTimesheetReport below), matching this repo's convention
 * of keeping DB-free aggregation logic separately unit-testable (see
 * resolvePmsBillableRatePure in pms-time-service.ts).
 *
 * `roster` (optional, defaults to []) is the full set of org users with
 * their isActive flag -- pass it so a designer with a real budget line but
 * zero time entries anywhere (e.g. newly budgeted, hasn't logged hours yet)
 * still resolves an active/inactive status and isn't silently dropped from
 * byDesignerStatus. Without it, designerStatusByUser only knows about users
 * who logged at least one entry, so sum(byDesignerStatus.budget) can fall
 * short of overallBudget.
 */
export function aggregateDesignerTimesheetCosts(
  entries: DesignerTimesheetEntry[],
  budgetLines: DesignerTimesheetBudgetLine[],
  roster: DesignerTimesheetRosterUser[] = []
) {
  const actualByCategory = sumBy(entries, (e) => e.category, (e) => e.cost)
  const hoursByCategory = sumBy(entries, (e) => e.category, (e) => e.hours)

  const actualByDesigner = sumBy(entries, (e) => e.userId, (e) => e.cost)
  const hoursByDesigner = sumBy(entries, (e) => e.userId, (e) => e.hours)
  const budgetByDesigner = sumBy(budgetLines.filter((b) => b.userId !== null), (b) => b.userId as string, (b) => b.amount)
  const designerNames = new Map(entries.map((e) => [e.userId, e.userName]))

  const actualByProject = sumBy(entries, (e) => e.projectId, (e) => e.cost)
  const budgetByProject = sumBy(budgetLines, (b) => b.projectId, (b) => b.amount)
  const projectNames = new Map(entries.map((e) => [e.projectId, e.projectName]))
  const allProjectIds = new Set([...actualByProject.keys(), ...budgetByProject.keys()])

  const statusKey = (isActive: boolean) => (isActive ? "active" : "inactive")
  const actualByDesignerStatus = sumBy(entries, (e) => statusKey(e.userIsActive), (e) => e.cost)
  const designerStatusByUser = new Map<string, boolean>(roster.map((u) => [u.userId, u.isActive]))
  for (const e of entries) {
    if (!designerStatusByUser.has(e.userId)) designerStatusByUser.set(e.userId, e.userIsActive)
  }
  const budgetByDesignerStatus = sumBy(
    budgetLines.filter((b) => b.userId !== null && designerStatusByUser.has(b.userId as string)),
    (b) => statusKey(designerStatusByUser.get(b.userId as string)!),
    (b) => b.amount
  )

  const overallBudget = budgetLines.reduce((s, b) => s + b.amount, 0)
  const overallActual = entries.reduce((s, e) => s + e.cost, 0)

  return {
    byCategory: [...actualByCategory.keys()].sort().map((category) => ({
      category, hours: hoursByCategory.get(category) ?? 0, actual: actualByCategory.get(category) ?? 0,
      // No per-category budget dimension exists in pms_budget_line_items
      // (only kind/userId) -- reported honestly as null, not fabricated,
      // matching this file's existing convention (see vendorCostReport's
      // documented gap note above).
      budget: null as number | null,
    })),
    byDesigner: [...new Set([...actualByDesigner.keys(), ...budgetByDesigner.keys()])].sort().map((userId) => {
      const budget = budgetByDesigner.get(userId) ?? 0
      const actual = actualByDesigner.get(userId) ?? 0
      return { userId, userName: designerNames.get(userId) ?? userId, hours: hoursByDesigner.get(userId) ?? 0, budget, actual, variance: budget - actual }
    }),
    byProject: [...allProjectIds].sort().map((pId) => {
      const budget = budgetByProject.get(pId) ?? 0
      const actual = actualByProject.get(pId) ?? 0
      return { projectId: pId, projectName: projectNames.get(pId) ?? pId, budget, actual, variance: budget - actual }
    }),
    byDesignerStatus: (["active", "inactive"] as const).map((status) => {
      const budget = budgetByDesignerStatus.get(status) ?? 0
      const actual = actualByDesignerStatus.get(status) ?? 0
      return { status, budget, actual, variance: budget - actual }
    }),
    overallBudget, overallActual, overallVariance: overallBudget - overallActual,
  }
}

// Response shape note (audit fix, PR #597): byDesigner/byProject are
// necessarily org-wide (a project comparison needs more than 1 project;
// a designer's total budget/actual isn't naturally scoped to one project
// either -- see the comment below), while byUser/byCategory/
// byDesignerStatus/overall* are scoped to the requested project. Rather
// than mixing both under one flat object with no field-level indication
// of scope (the audited bug -- likely to mislead a per-project report UI
// into showing org-wide totals as if they belonged to the requested
// project), the two scopes are returned under explicit `projectScoped`/
// `orgWide` keys.
export type DesignerTimesheetReport = {
  projectScoped: {
    byUser: { userId: string; userName: string; totalHours: number }[]
    byCategory: ReturnType<typeof aggregateDesignerTimesheetCosts>["byCategory"]
    byDesignerStatus: ReturnType<typeof aggregateDesignerTimesheetCosts>["byDesignerStatus"]
    overallBudget: number
    overallActual: number
    overallVariance: number
  }
  orgWide: {
    byDesigner: ReturnType<typeof aggregateDesignerTimesheetCosts>["byDesigner"]
    byProject: ReturnType<typeof aggregateDesignerTimesheetCosts>["byProject"]
  }
}

export async function designerTimesheetReport(ctx: { orgId: string }, projectId: string): Promise<DesignerTimesheetReport> {
  await requireConstructionEnabled(ctx.orgId)
  return withTenantContext({ orgId: ctx.orgId }, async (db) => {
    const issueIds = (await db.query.pmsIssues.findMany({ where: and(eq(pmsIssues.orgId, ctx.orgId), eq(pmsIssues.projectId, projectId)), columns: { id: true } })).map((i) => i.id)
    if (issueIds.length === 0) {
      return {
        projectScoped: { byUser: [], byCategory: [], byDesignerStatus: [], overallBudget: 0, overallActual: 0, overallVariance: 0 },
        orgWide: { byDesigner: [], byProject: [] },
      }
    }
    // R39/R-C12 (D-10): approval must actually BLOCK, not just sit as a
    // cosmetic status -- a draft/submitted/rejected hour is not yet a real
    // cost until a manager approves it. approvalStatus='approved' here and
    // in the allTimeEntries fetch below (both real cost-roll-up sources)
    // is the fix; listTimeEntriesForProject/listTimeEntriesForIssue (the
    // raw entry lists, not cost aggregates) are deliberately untouched --
    // a designer/manager still needs to SEE a pending entry to review it.
    const rows = await db.select({
      userId: pmsTimeEntries.userId,
      userName: users.name,
      totalHours: sql<number>`coalesce(sum(${pmsTimeEntries.hours}), 0)::float`,
    }).from(pmsTimeEntries)
      .innerJoin(users, eq(pmsTimeEntries.userId, users.id))
      .where(and(eq(pmsTimeEntries.orgId, ctx.orgId), inArray(pmsTimeEntries.issueId, issueIds), eq(pmsTimeEntries.approvalStatus, "approved")))
      .groupBy(pmsTimeEntries.userId, users.name)

    // Budget-vs-Actual breakdown: Category/Designer-status/overall are
    // scoped to this project (the report's own subject); Project-wise is
    // necessarily org-wide (a project comparison needs more than 1
    // project), and Designer-wise is also computed org-wide since a
    // designer's total budget/actual isn't naturally scoped to one project
    // either. Both scopes are derived from the same org-wide fetch below,
    // filtered per breakdown, rather than issuing near-duplicate queries.
    const allProjects = await db.query.projects.findMany({ where: eq(projects.orgId, ctx.orgId), columns: { id: true, name: true } })
    const allIssues = await db.query.pmsIssues.findMany({ where: eq(pmsIssues.orgId, ctx.orgId), columns: { id: true, projectId: true } })
    const allUsers = await db.query.users.findMany({ where: eq(users.orgId, ctx.orgId), columns: { id: true, name: true, isActive: true } })
    const allTimeEntries = await db.query.pmsTimeEntries.findMany({ where: and(eq(pmsTimeEntries.orgId, ctx.orgId), eq(pmsTimeEntries.approvalStatus, "approved")) })
    // Fetched once upfront (not once per time entry, see resolvePmsBillableRatePure
    // below) -- same pattern pms-invoice-service.ts's buildInvoiceLinesFromTimeEntries
    // already uses to avoid the equivalent N+1 on this same table.
    const orgBillableRates = await db.query.pmsBillableRates.findMany({ where: eq(pmsBillableRates.orgId, ctx.orgId) })

    const projectNameById = new Map(allProjects.map((p) => [p.id, p.name]))
    const projectIdByIssue = new Map(allIssues.map((i) => [i.id, i.projectId]))
    const userById = new Map(allUsers.map((u) => [u.id, u]))
    const roster: DesignerTimesheetRosterUser[] = allUsers.map((u) => ({ userId: u.id, isActive: u.isActive }))

    const priced: DesignerTimesheetEntry[] = []
    for (const entry of allTimeEntries) {
      const entryProjectId = projectIdByIssue.get(entry.issueId)
      if (!entryProjectId) continue
      const user = userById.get(entry.userId)
      const rate = resolvePmsBillableRatePure(orgBillableRates, entry.userId, entry.spentOn) ?? 0
      priced.push({
        userId: entry.userId,
        userName: user?.name ?? entry.userId,
        userIsActive: user?.isActive ?? true,
        projectId: entryProjectId,
        projectName: projectNameById.get(entryProjectId) ?? entryProjectId,
        category: entry.activityType?.trim() || "uncategorized",
        hours: Number(entry.hours),
        cost: rate * Number(entry.hours),
      })
    }
    const pricedThisProject = priced.filter((e) => e.projectId === projectId)

    const orgBudgetLines: DesignerTimesheetBudgetLine[] = []
    const orgBudgets = await db.query.pmsBudgets.findMany({ where: eq(pmsBudgets.orgId, ctx.orgId), columns: { id: true, projectId: true } })
    const budgetIds = orgBudgets.map((b) => b.id)
    if (budgetIds.length > 0) {
      const projectIdByBudget = new Map(orgBudgets.map((b) => [b.id, b.projectId]))
      const lineItems = await db.query.pmsBudgetLineItems.findMany({ where: inArray(pmsBudgetLineItems.budgetId, budgetIds) })
      for (const li of lineItems) {
        const liProjectId = projectIdByBudget.get(li.budgetId)
        if (!liProjectId) continue
        orgBudgetLines.push({ projectId: liProjectId, userId: li.userId, amount: Number(li.amount) })
      }
    }
    const thisProjectBudgetLines = orgBudgetLines.filter((b) => b.projectId === projectId)

    const orgWide = aggregateDesignerTimesheetCosts(priced, orgBudgetLines, roster)
    const scoped = aggregateDesignerTimesheetCosts(pricedThisProject, thisProjectBudgetLines, roster)

    return {
      projectScoped: {
        byUser: rows,
        byCategory: scoped.byCategory,
        byDesignerStatus: scoped.byDesignerStatus,
        overallBudget: scoped.overallBudget,
        overallActual: scoped.overallActual,
        overallVariance: scoped.overallVariance,
      },
      orgWide: {
        byDesigner: orgWide.byDesigner,
        byProject: orgWide.byProject,
      },
    }
  })
}

// 12b. Designer-wise Timesheet Status Report -- count/hours per designer
// broken down by approval status (draft/submitted/approved/rejected).
// Owner's spec (item 12, "IMPORTANT") asks for this "designer-wise status
// view" as a distinct cut from the byDesignerStatus (active/inactive)
// breakdown aggregateDesignerTimesheetCosts already produces above -- that
// one groups by whether the designer account is active, this one groups by
// where each designer's logged hours currently sit in the approval
// workflow (pms_time_entries.approval_status, added alongside this report).
export type TimesheetStatusEntry = {
  userId: string
  userName: string
  approvalStatus: "draft" | "submitted" | "approved" | "rejected"
  hours: number
}

const APPROVAL_STATUSES = ["draft", "submitted", "approved", "rejected"] as const

export function aggregateDesignerApprovalStatus(entries: TimesheetStatusEntry[]) {
  const byUser = new Map<string, { userId: string; userName: string; counts: Record<string, { hours: number; entries: number }> }>()
  for (const e of entries) {
    let bucket = byUser.get(e.userId)
    if (!bucket) {
      bucket = {
        userId: e.userId,
        userName: e.userName,
        counts: Object.fromEntries(APPROVAL_STATUSES.map((s) => [s, { hours: 0, entries: 0 }])),
      }
      byUser.set(e.userId, bucket)
    }
    bucket.counts[e.approvalStatus].hours += e.hours
    bucket.counts[e.approvalStatus].entries += 1
  }
  return [...byUser.values()]
    .sort((a, b) => a.userId.localeCompare(b.userId))
    .map((b) => ({ userId: b.userId, userName: b.userName, ...b.counts }))
}

export async function designerApprovalStatusReport(ctx: { orgId: string }, projectId: string) {
  await requireConstructionEnabled(ctx.orgId)
  return withTenantContext({ orgId: ctx.orgId }, async (db) => {
    const issueIds = (await db.query.pmsIssues.findMany({ where: and(eq(pmsIssues.orgId, ctx.orgId), eq(pmsIssues.projectId, projectId)), columns: { id: true } })).map((i) => i.id)
    if (issueIds.length === 0) return { byDesigner: [] }
    const rows = await db.query.pmsTimeEntries.findMany({
      where: and(eq(pmsTimeEntries.orgId, ctx.orgId), inArray(pmsTimeEntries.issueId, issueIds)),
      columns: { userId: true, hours: true, approvalStatus: true },
    })
    const userIds = [...new Set(rows.map((r) => r.userId))]
    const usersById = userIds.length > 0
      ? new Map((await db.query.users.findMany({ where: inArray(users.id, userIds), columns: { id: true, name: true } })).map((u) => [u.id, u.name]))
      : new Map<string, string>()
    const entries: TimesheetStatusEntry[] = rows.map((r) => ({
      userId: r.userId, userName: usersById.get(r.userId) ?? r.userId, approvalStatus: r.approvalStatus, hours: Number(r.hours),
    }))
    return { byDesigner: aggregateDesignerApprovalStatus(entries) }
  })
}

// 12c. Work Analysis Report -- hours by task/category per designer over a
// period (Owner spec item 12: "real breakdown of hours by task/category
// per designer over a period"). "Task" here is the pms_issue the time entry
// is logged against (pms_issues.title), the same entity designerTimesheetReport
// already resolves projectId through -- not a new concept.
export type WorkAnalysisEntry = {
  userId: string
  userName: string
  taskId: string
  taskName: string
  category: string
  hours: number
}

export function aggregateWorkAnalysis(entries: WorkAnalysisEntry[]) {
  const byUser = new Map<string, { userId: string; userName: string; totalHours: number; byTask: Map<string, { taskId: string; taskName: string; hours: number }>; byCategory: Map<string, number> }>()
  for (const e of entries) {
    let bucket = byUser.get(e.userId)
    if (!bucket) {
      bucket = { userId: e.userId, userName: e.userName, totalHours: 0, byTask: new Map(), byCategory: new Map() }
      byUser.set(e.userId, bucket)
    }
    bucket.totalHours += e.hours
    const taskBucket = bucket.byTask.get(e.taskId) ?? { taskId: e.taskId, taskName: e.taskName, hours: 0 }
    taskBucket.hours += e.hours
    bucket.byTask.set(e.taskId, taskBucket)
    bucket.byCategory.set(e.category, (bucket.byCategory.get(e.category) ?? 0) + e.hours)
  }
  return [...byUser.values()]
    .sort((a, b) => a.userId.localeCompare(b.userId))
    .map((b) => ({
      userId: b.userId,
      userName: b.userName,
      totalHours: b.totalHours,
      byTask: [...b.byTask.values()].sort((x, y) => x.taskName.localeCompare(y.taskName)),
      byCategory: [...b.byCategory.entries()].sort(([x], [y]) => x.localeCompare(y)).map(([category, hours]) => ({ category, hours })),
    }))
}

export async function workAnalysisReport(ctx: { orgId: string }, projectId: string, dateFrom?: string, dateTo?: string) {
  await requireConstructionEnabled(ctx.orgId)
  return withTenantContext({ orgId: ctx.orgId }, async (db) => {
    const issues = await db.query.pmsIssues.findMany({ where: and(eq(pmsIssues.orgId, ctx.orgId), eq(pmsIssues.projectId, projectId)), columns: { id: true, title: true } })
    const issueIds = issues.map((i) => i.id)
    if (issueIds.length === 0) return { byDesigner: [] }
    const issueById = new Map(issues.map((i) => [i.id, i.title]))

    const conditions = [eq(pmsTimeEntries.orgId, ctx.orgId), inArray(pmsTimeEntries.issueId, issueIds)]
    if (dateFrom) conditions.push(gte(pmsTimeEntries.spentOn, dateFrom))
    if (dateTo) conditions.push(lt(pmsTimeEntries.spentOn, dateTo))
    const rows = await db.query.pmsTimeEntries.findMany({
      where: and(...conditions),
      columns: { userId: true, issueId: true, hours: true, activityType: true },
    })
    const userIds = [...new Set(rows.map((r) => r.userId))]
    const usersById = userIds.length > 0
      ? new Map((await db.query.users.findMany({ where: inArray(users.id, userIds), columns: { id: true, name: true } })).map((u) => [u.id, u.name]))
      : new Map<string, string>()

    const entries: WorkAnalysisEntry[] = rows.map((r) => ({
      userId: r.userId,
      userName: usersById.get(r.userId) ?? r.userId,
      taskId: r.issueId,
      taskName: issueById.get(r.issueId) ?? r.issueId,
      category: r.activityType?.trim() || "uncategorized",
      hours: Number(r.hours),
    }))
    return { byDesigner: aggregateWorkAnalysis(entries) }
  })
}

// 13. KPI Report -- approved KPI entries for this project's definitions (or org-wide when projectId is null on the definition).
export async function kpiReport(ctx: { orgId: string }, projectId: string) {
  await requireConstructionEnabled(ctx.orgId)
  return withTenantContext({ orgId: ctx.orgId }, async (db) => {
    const definitions = await db.query.constructionKpiDefinitions.findMany({ where: and(eq(constructionKpiDefinitions.orgId, ctx.orgId), eq(constructionKpiDefinitions.projectId, projectId)) })
    const defIds = definitions.map((d) => d.id)
    const entries = defIds.length > 0 ? await db.query.constructionKpiEntries.findMany({ where: inArray(constructionKpiEntries.kpiDefinitionId, defIds) }) : []
    return { definitions, entries }
  })
}

// 14. Revenue Report -- erp_sales_invoices for this project.
export async function revenueReport(ctx: { orgId: string }, projectId: string) {
  await requireConstructionEnabled(ctx.orgId)
  return withTenantContext({ orgId: ctx.orgId }, async (db) => {
    const invoices = await db.query.erpSalesInvoices.findMany({
      where: and(eq(erpSalesInvoices.orgId, ctx.orgId), eq(erpSalesInvoices.projectId, projectId), sql`${erpSalesInvoices.status} != 'cancelled'`),
      orderBy: (t, { desc }) => desc(t.postingDate),
    })
    return { invoices, total: invoices.reduce((s, i) => s + Number(i.grandTotal), 0) }
  })
}

// 15. Expense Report -- reuses the expense-head summary + full entry list.
export async function expenseReport(ctx: { orgId: string }, projectId: string) {
  await requireConstructionEnabled(ctx.orgId)
  const byHead = await getExpenseSummaryByHead(ctx, projectId)
  return { byHead, total: byHead.reduce((s, r) => s + Number(r.total), 0) }
}

// 16. Category Progress Report -- latest % complete averaged per category (via its activities).
export async function categoryProgressReport(ctx: { orgId: string }, projectId: string) {
  await requireConstructionEnabled(ctx.orgId)
  return withTenantContext({ orgId: ctx.orgId }, async (db) => {
    const categories = await db.query.constructionCategories.findMany({ where: and(eq(constructionCategories.orgId, ctx.orgId), eq(constructionCategories.projectId, projectId)) })
    const activities = await activityIdsForProject(db, ctx.orgId, projectId)
    if (activities.length === 0) return { categories: categories.map((c) => ({ categoryId: c.id, name: c.name, percentComplete: 0 })) }
    const ids = activities.map((a) => a.id)
    // Same fix as construction-dashboard-service.ts's getProjectDashboard()
    // (verified live in production 2026-07-08) -- a plain JS array as a
    // single sql`` parameter doesn't serialize as a Postgres array; build a
    // real ARRAY[...] literal instead (still individually bound, no
    // injection risk).
    const idsSql = sql.join(ids.map((id) => sql`${id}`), sql`, `)
    const rows = (await db.execute(sql`
      SELECT DISTINCT ON (activity_id) activity_id, percent_complete
      FROM compliance.construction_work_progress_entries
      WHERE activity_id = ANY(ARRAY[${idsSql}])
      ORDER BY activity_id, entry_date DESC
    `)) as { activity_id: string; percent_complete: number }[]
    const percentByActivity = new Map(rows.map((r) => [r.activity_id, Number(r.percent_complete)]))
    return {
      categories: categories.map((c) => {
        const activityIdsInCat = activities.filter((a) => a.categoryId === c.id).map((a) => a.id)
        const percents = activityIdsInCat.map((id) => percentByActivity.get(id) ?? 0)
        const avg = percents.length > 0 ? percents.reduce((s, p) => s + p, 0) / percents.length : 0
        return { categoryId: c.id, name: c.name, percentComplete: Math.round(avg) }
      }),
    }
  })
}

// 17. Project Completion Report -- overall completion % (reuses the dashboard figure) + category breakdown.
export async function projectCompletionReport(ctx: { orgId: string }, projectId: string) {
  await requireConstructionEnabled(ctx.orgId)
  const [dashboard, categoryBreakdown] = await Promise.all([getProjectDashboard(ctx, projectId), categoryProgressReport(ctx, projectId)])
  return { overallPercentComplete: dashboard.progressPercent, byCategory: categoryBreakdown.categories }
}

// 18. Category BOQ Amounts Report -- BOQ line-item `amount` totaled per
// category, for the PROJEXA Company/Department/Project drill-down's
// category-distribution chart (pie share-of-total + completed-vs-total
// bar). A line item with no category at all falls into a synthetic
// "Uncategorized" bucket rather than being silently dropped, so
// sum(byCategory.totalAmount) + uncategorizedAmount always equals the BOQ's
// real total, matching scopeReport's totalValue for the same project.
//
// R67 lane I (WS-I item I-05, R-177) -- ATTRIBUTION ORDER, and why it changed:
// this used to resolve a category ONLY through
// lineItem.activityId -> activity.categoryId -> category.name, because
// construction_boq_line_items had no category column (that is what this
// comment used to say). It does now (drizzle/0532), and the direct column
// WINS: most real lines have no activityId at all -- an imported BOQ never
// does -- which is exactly why nearly every amount used to land in
// Uncategorized and the charts had almost nothing to plot. Order is now:
//   1. the line's own `category` text (the R-177 column, what the customer
//      actually typed or imported);
//   2. failing that, the old activityId -> activity -> category path, so every
//      pre-existing categorised line keeps reporting exactly as before;
//   3. failing both, Uncategorized.
//
// categoryId STAYS A NON-NULL STRING for every bucket, because PROJEXA's
// category-distribution route uses it as a Map key and a React key. A bucket
// that came from the text column and matches no constructionCategories row
// gets the stable synthetic id "text:<lowercased name>" -- distinguishable,
// never colliding with a real cuid, and honestly resolving to 0% in the
// completion lookup (there is no per-category progress row behind it).
export async function categoryBoqAmountsReport(ctx: { orgId: string }, projectId: string) {
  await requireConstructionEnabled(ctx.orgId)
  return withTenantContext({ orgId: ctx.orgId }, async (db) => {
    // R38 (TC-42/TC-43 fix): same missing-tiebreaker bug as scopeReport() above --
    // see its comment for the full explanation.
    const boqs = await db.query.constructionBoqs.findMany({ where: and(eq(constructionBoqs.orgId, ctx.orgId), eq(constructionBoqs.projectId, projectId)), orderBy: (t, { desc }) => [desc(t.version), desc(t.createdAt)] })
    const latest = boqs.find((b) => b.status !== "superseded") ?? boqs[0]
    if (!latest) return { categories: [], uncategorizedAmount: 0, totalAmount: 0 }

    const [lineItems, categories, activities] = await Promise.all([
      db.query.constructionBoqLineItems.findMany({ where: rootBoqLineItemsOnly(latest.id), columns: { activityId: true, amount: true, category: true } }),
      db.query.constructionCategories.findMany({ where: and(eq(constructionCategories.orgId, ctx.orgId), eq(constructionCategories.projectId, projectId)) }),
      activityIdsForProject(db, ctx.orgId, projectId),
    ])
    const categoryIdByActivity = new Map(activities.map((a) => [a.id, a.categoryId]))
    // A direct category TEXT that names an existing project category resolves
    // to that same row, so the two attribution paths converge on ONE bucket
    // instead of showing "Civil" twice in the pie.
    const categoryIdByLowerName = new Map(categories.map((c) => [c.name.trim().toLowerCase(), c.id]))
    const amountByCategory = new Map<string, number>()
    // Buckets that came from the text column and match no project category row.
    const syntheticNameById = new Map<string, string>()
    let uncategorizedAmount = 0

    for (const item of lineItems) {
      const amount = Number(item.amount)
      const directName = typeof item.category === "string" ? item.category.trim() : ""
      if (directName !== "") {
        const matchedId = categoryIdByLowerName.get(directName.toLowerCase())
        const bucketId = matchedId ?? `text:${directName.toLowerCase()}`
        if (!matchedId) syntheticNameById.set(bucketId, directName)
        amountByCategory.set(bucketId, (amountByCategory.get(bucketId) ?? 0) + amount)
        continue
      }
      const categoryId = item.activityId ? categoryIdByActivity.get(item.activityId) : undefined
      if (!categoryId) { uncategorizedAmount += amount; continue }
      amountByCategory.set(categoryId, (amountByCategory.get(categoryId) ?? 0) + amount)
    }

    const byCategory = [
      ...categories.map((c) => ({ categoryId: c.id, name: c.name, totalAmount: amountByCategory.get(c.id) ?? 0 })),
      ...[...syntheticNameById.entries()].map(([id, name]) => ({ categoryId: id, name, totalAmount: amountByCategory.get(id) ?? 0 })),
    ]
    const totalAmount = byCategory.reduce((s, c) => s + c.totalAmount, 0) + uncategorizedAmount
    return { categories: byCategory, uncategorizedAmount, totalAmount }
  })
}

// 19. Certified Payroll Report (SAP-mapping gap analysis HCM-006,
// "Certified Payroll Report (Regulatory / Public Works)", US WH-347
// equivalent, BUILD_NEW/MEDIUM, engine_track=calculation) -- grepped
// certifiedPayroll/davis-bacon/prevailingWage/WH-347 across the whole repo
// first, zero hits, a genuine gap, not assumed. Per public-works project,
// per calendar week: every site-labour worker's hours by day-of-week and
// trade classification, the effective hourly rate actually paid, the
// project's own prevailing-wage determination for that trade (new
// constructionPrevailingWageRates table, admin-editable master data, same
// "rates come from a periodic government determination, never a formula"
// posture as erpStatutoryRules/erpIncomeTaxSlabs), gross wages, and a
// compliance statement flagging any worker paid below the determination or
// with no classification on file.
//
// Reuses this module's own real site-labour ledger
// (constructionLabourRoster/constructionAttendance -- trade, dailyRate,
// hoursWorked, dailyCost per day) rather than pms_time_entries or the
// payroll module: pms_time_entries has no trade/classification concept at
// all (confirmed by schema read), and erp_payslips/erp_payroll_runs are
// monthly-aggregate with no FK to constructionLabourRoster (that table's
// own schema.ts comment: site labour "rarely has login accounts"). This is
// the only place per-day, per-trade labour hours genuinely exist.
//
// Two real, disclosed gaps (same "honest, not fabricated" posture as
// vendorCostReport's documented gap above):
// 1. Deductions -- constructionLabourRoster/constructionAttendance model a
//    flat daily-rate day-labour workforce with no link whatsoever to the
//    statutory payroll engine (erp_payslips/erp_payslip_lines). No
//    federal/state/FICA/etc. withholding is tracked for this workforce at
//    all, so totalDeductions is honestly 0 and netWages === grossWages for
//    every worker on this report -- never a fabricated number.
// 2. Fringe benefits -- constructionPrevailingWageRates stores the
//    REQUIRED fringe rate per the wage determination for reference only;
//    no field anywhere tracks fringe benefits actually PAID per worker, so
//    the compliance flag below compares base hourly rate paid vs.
//    required only, never fringe.
export type CertifiedPayrollAttendanceRow = {
  rosterId: string
  workerName: string
  trade: string | null
  attendanceDate: string // YYYY-MM-DD
  hoursWorked: number | null
  dailyCost: number
}
export type CertifiedPayrollWageRate = {
  trade: string
  prevailingHourlyRate: number
  fringeBenefitRate: number
}
export type CertifiedPayrollComplianceStatus = "compliant" | "rate_below_prevailing" | "no_classification_on_file"

// WH-347's own daily-hours grid runs Sunday-Saturday, keyed by the
// attendance row's real calendar day-of-week -- not an offset from
// weekStart, so a report requested with any weekStart still buckets each
// day under its real name.
export const WH347_DAY_LABELS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"] as const

/**
 * Pure core: builds the WH-347-shaped per-worker weekly breakdown from raw
 * attendance rows + the project's prevailing-wage determinations. No DB
 * access -- attendanceRows/wageRates are fetched by the caller
 * (certifiedPayrollReport below), matching this repo's established DB-free
 * pure-aggregation convention (aggregateDesignerTimesheetCosts above,
 * resolvePmsBillableRatePure in pms-time-service.ts). weekStart is only
 * used to compute the returned weekEnd label -- day-of-week bucketing
 * reads each row's own attendanceDate directly.
 */
export function computeCertifiedPayroll(
  attendanceRows: CertifiedPayrollAttendanceRow[],
  wageRates: CertifiedPayrollWageRate[],
  weekStart: string
) {
  const rateByTrade = new Map(wageRates.map((r) => [r.trade.trim().toLowerCase(), r]))

  type WorkerAccumulator = {
    rosterId: string; workerName: string; trade: string | null
    dailyHours: Record<(typeof WH347_DAY_LABELS)[number], number>
    totalHours: number; grossWages: number
  }
  const byWorker = new Map<string, WorkerAccumulator>()
  for (const row of attendanceRows) {
    let bucket = byWorker.get(row.rosterId)
    if (!bucket) {
      bucket = {
        rosterId: row.rosterId, workerName: row.workerName, trade: row.trade,
        dailyHours: { sun: 0, mon: 0, tue: 0, wed: 0, thu: 0, fri: 0, sat: 0 },
        totalHours: 0, grossWages: 0,
      }
      byWorker.set(row.rosterId, bucket)
    }
    const dayLabel = WH347_DAY_LABELS[new Date(row.attendanceDate).getUTCDay()]
    const hours = Number(row.hoursWorked ?? 0)
    bucket.dailyHours[dayLabel] += hours
    bucket.totalHours += hours
    bucket.grossWages += row.dailyCost
  }

  const workers = [...byWorker.values()].sort((a, b) => a.workerName.localeCompare(b.workerName)).map((w) => {
    const trade = w.trade?.trim() || null
    const determination = trade ? rateByTrade.get(trade.toLowerCase()) ?? null : null
    // Effective hourly rate actually paid, derived from real dailyCost/
    // hoursWorked -- not a fabricated figure. Zero-hours workers (present
    // in attendance with no hoursWorked recorded) fall back to 0, matching
    // this file's other "no data yet, not an error" conventions.
    const ratePaid = w.totalHours > 0 ? w.grossWages / w.totalHours : 0
    let complianceStatus: CertifiedPayrollComplianceStatus
    if (!trade || !determination) complianceStatus = "no_classification_on_file"
    else if (ratePaid < determination.prevailingHourlyRate) complianceStatus = "rate_below_prevailing"
    else complianceStatus = "compliant"

    return {
      rosterId: w.rosterId,
      workerName: w.workerName,
      trade,
      dailyHours: w.dailyHours,
      totalHours: w.totalHours,
      ratePaid,
      prevailingHourlyRate: determination?.prevailingHourlyRate ?? null,
      fringeBenefitRateRequired: determination?.fringeBenefitRate ?? null,
      grossWages: w.grossWages,
      totalDeductions: 0, // real, disclosed gap -- see this function's header comment
      netWages: w.grossWages,
      complianceStatus,
    }
  })

  const exceptions = workers
    .filter((w) => w.complianceStatus !== "compliant")
    .map((w) => ({ rosterId: w.rosterId, workerName: w.workerName, reason: w.complianceStatus }))

  return {
    weekStart,
    weekEnd: new Date(new Date(weekStart).getTime() + 6 * 86400000).toISOString().slice(0, 10),
    workers,
    workerCount: workers.length,
    totalHours: workers.reduce((s, w) => s + w.totalHours, 0),
    totalGrossWages: workers.reduce((s, w) => s + w.grossWages, 0),
    statementOfCompliance: {
      allWorkersCompliant: exceptions.length === 0,
      exceptions,
    },
    dataGapNotes: [
      "Deductions are not tracked for this site-labour workforce (construction_labour_roster/construction_attendance model a flat daily-rate workforce with no link to the statutory payroll engine) -- totalDeductions is 0 and netWages equals grossWages for every worker, not fabricated.",
      "Fringe benefits actually paid are not tracked per worker -- only the wage determination's required rate (if configured) is shown, under fringeBenefitRateRequired.",
    ],
  }
}

export async function certifiedPayrollReport(ctx: { orgId: string }, projectId: string, weekStart: string) {
  await requireConstructionEnabled(ctx.orgId)
  return withTenantContext({ orgId: ctx.orgId }, async (db) => {
    const weekEnd = new Date(new Date(weekStart).getTime() + 7 * 86400000).toISOString().slice(0, 10)

    const roster = await db.query.constructionLabourRoster.findMany({
      where: and(eq(constructionLabourRoster.orgId, ctx.orgId), eq(constructionLabourRoster.projectId, projectId)),
      columns: { id: true, name: true, trade: true },
    })
    const rosterById = new Map(roster.map((r) => [r.id, r]))

    const attendance = await db.query.constructionAttendance.findMany({
      where: and(
        eq(constructionAttendance.orgId, ctx.orgId),
        eq(constructionAttendance.projectId, projectId),
        gte(constructionAttendance.attendanceDate, weekStart),
        lt(constructionAttendance.attendanceDate, weekEnd)
      ),
    })
    const attendanceRows: CertifiedPayrollAttendanceRow[] = attendance.map((a) => {
      const r = rosterById.get(a.rosterId)
      return {
        rosterId: a.rosterId,
        workerName: r?.name ?? a.rosterId,
        trade: r?.trade ?? null,
        attendanceDate: a.attendanceDate,
        hoursWorked: a.hoursWorked !== null ? Number(a.hoursWorked) : null,
        dailyCost: Number(a.dailyCost),
      }
    })

    const wageRateRows = await db.query.constructionPrevailingWageRates.findMany({
      where: and(
        eq(constructionPrevailingWageRates.orgId, ctx.orgId),
        eq(constructionPrevailingWageRates.projectId, projectId),
        lte(constructionPrevailingWageRates.effectiveFrom, weekStart),
        or(isNull(constructionPrevailingWageRates.effectiveTo), gte(constructionPrevailingWageRates.effectiveTo, weekStart))
      ),
    })
    const wageRates: CertifiedPayrollWageRate[] = wageRateRows.map((w) => ({
      trade: w.trade, prevailingHourlyRate: Number(w.prevailingHourlyRate), fringeBenefitRate: Number(w.fringeBenefitRate),
    }))

    const project = await db.query.projects.findFirst({ where: eq(projects.id, projectId), columns: { name: true } })

    return { projectId, projectName: project?.name ?? projectId, ...computeCertifiedPayroll(attendanceRows, wageRates, weekStart) }
  })
}

export const REPORT_REGISTRY = {
  "work-progress": workProgressReport,
  "weekly-project": weeklyProjectReport,
  "project-status": projectStatusReport,
  "attendance": attendanceReport,
  "site-picture": sitePictureReport,
  "scope": scopeReport,
  "budget-summary": budgetSummary,
  "budget-vs-actual": budgetVsActual,
  "material-consumption": materialConsumptionReport,
  "vendor-cost": vendorCostReport,
  "manpower-cost": manpowerCostReport,
  "designer-timesheet": designerTimesheetReport,
  "designer-approval-status": designerApprovalStatusReport,
  "work-analysis": workAnalysisReport,
  "kpi": kpiReport,
  "revenue": revenueReport,
  "expense": expenseReport,
  "category-progress": categoryProgressReport,
  "project-completion": projectCompletionReport,
  "category-boq-amounts": categoryBoqAmountsReport,
  "certified-payroll": certifiedPayrollReport,
  "earned-value": earnedValueReport, // R39/R-51
  "budget-variance": boqBudgetVarianceReport, // R39/R-C09
} as const

export type ReportName = keyof typeof REPORT_REGISTRY
