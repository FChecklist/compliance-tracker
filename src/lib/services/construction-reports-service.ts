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

// R67 F-10 (R-134). requireConstructionEnabled() is not a cheap boolean: it
// goes through isBranchEnabledForOrg(), which opens its OWN withTenantContext
// transaction and takes one of the five app_runtime connections. Every one of
// the ~20 report functions below calls it as its first statement, and the
// composite reports call several of those, so a single /reports run could
// spend three or four pooled connections re-answering "does this org have the
// construction module?" -- a question whose answer is a purchased package and
// cannot change between two clicks.
//
// So the answer is memoised per org for 60 s. Deliberately small: an org that
// buys the module mid-session waits at most a minute, and nothing here is a
// security boundary being cached for longer than the request that needs it.
//
// TWO RULES, both of which a naive memo gets wrong:
//
//  1. A REFUSAL IS NEVER CACHED. Only the success is remembered. Caching the
//     403 would keep telling an org that has JUST enabled construction that it
//     has not, for up to a minute -- and a cached denial is exactly the kind of
//     stale authorisation answer that should always be re-derived.
//  2. CONCURRENT CALLERS SHARE ONE CHECK. The in-flight promise is stored, not
//     just the settled result, so budgetVsActual's Promise.all cannot fire two
//     enablement transactions at once.
const ENABLEMENT_MEMO_TTL_MS = 60_000
const enablementMemo = new Map<string, { at: number; promise: Promise<void> }>()

/** Test seam: `bun test` runs every file in one process, so the memo above would leak between files. */
export function __resetConstructionEnablementMemo(): void {
  enablementMemo.clear()
}

async function ensureConstructionEnabled(orgId: string): Promise<void> {
  const hit = enablementMemo.get(orgId)
  if (hit && Date.now() - hit.at < ENABLEMENT_MEMO_TTL_MS) return hit.promise

  const promise = requireConstructionEnabled(orgId)
  enablementMemo.set(orgId, { at: Date.now(), promise })
  try {
    await promise
  } catch (err) {
    enablementMemo.delete(orgId)
    throw err
  }
}

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
// R67 F-14 (R-215) -- W-01, THE MEASURED NUMBER, RECORDED HERE RATHER THAN
// FIXED HERE. The R66 audit timed this route at 24.3 s on the demo org
// (GET /api/v1/projexa/reports/work-progress), against ~400-831 ms for the
// projexa /api/work-progress list over the same data. The shape below is why:
//
//   array_agg(percent_complete ORDER BY entry_date DESC)[1]
//
// builds the FULL ordered array of every entry ever logged for each activity,
// in memory, and then throws all of it away except element 1. Cost grows with
// the project's whole logging history, not with the number of activities, and
// it cannot use an index for the ordering because the sort happens inside the
// aggregate. The equivalent answer via `DISTINCT ON (activity_id) ... ORDER BY
// activity_id, entry_date DESC` -- which categoryProgressReport() and
// getProjectDashboard() both already use for exactly this question -- is one
// indexed pass.
//
// It is NOT rewritten here on purpose. Programme decision D-02 makes
// /work-progress?tab=report (backed by the 2.7 s projexa assembly) the ONE Work
// Progress Report, and retires this route from the UI instead of keeping two
// implementations of the same report alive. Rewriting it would be work spent
// on a route that is being unlinked; the number above is the evidence for that
// call, and it stays recorded so nobody has to re-measure it to make it.
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
  // R67 F-10: the memoised check, not requireConstructionEnabled() directly --
  // that one opens its OWN withTenantContext transaction on the max:5 pool, per
  // report, per request.
  await ensureConstructionEnabled(ctx.orgId)
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
// R67 E-22 (R-199/R-207): Sumeet's Weekly Project report is a table with DAY
// COLUMNS and CATEGORY ROWS, not four week-total scalars. The four measures
// this function already computes are exactly the rows; this is the same
// window, grouped by date instead of collapsed, so a day column and the
// week total can never disagree -- the total is the sum of the days.
export type ProjectPeriodDay = {
  date: string
  labourCost: number
  workersPresent: number
  expenseTotal: number
  progressEntriesLogged: number
  diaryEntries: number
}

export async function projectPeriodReport(ctx: { orgId: string }, projectId: string, periodStart: string, periodEnd: string) {
  await ensureConstructionEnabled(ctx.orgId)
  return withTenantContext({ orgId: ctx.orgId }, async (db) => {
    const [progressCount] = await db.select({ count: sql<number>`count(*)` }).from(constructionWorkProgressEntries)
      .where(and(eq(constructionWorkProgressEntries.orgId, ctx.orgId), eq(constructionWorkProgressEntries.projectId, projectId), sql`${constructionWorkProgressEntries.entryDate} >= ${periodStart} and ${constructionWorkProgressEntries.entryDate} < ${periodEnd}`))
    const [attendanceCost] = await db.select({ total: sql<number>`coalesce(sum(${constructionAttendance.dailyCost}), 0)::float`, presentCount: sql<number>`count(*) filter (where ${constructionAttendance.status} = 'present')` })
      .from(constructionAttendance).where(and(eq(constructionAttendance.orgId, ctx.orgId), eq(constructionAttendance.projectId, projectId), sql`${constructionAttendance.attendanceDate} >= ${periodStart} and ${constructionAttendance.attendanceDate} < ${periodEnd}`))
    const diaryEntries = await db.query.constructionSiteDiaries.findMany({ where: and(eq(constructionSiteDiaries.orgId, ctx.orgId), eq(constructionSiteDiaries.projectId, projectId), gte(constructionSiteDiaries.diaryDate, periodStart), lt(constructionSiteDiaries.diaryDate, periodEnd)) })
    const [expenseTotal] = await db.select({ total: sql<number>`coalesce(sum(${constructionExpenseEntries.amount}), 0)::float` }).from(constructionExpenseEntries)
      .where(and(eq(constructionExpenseEntries.orgId, ctx.orgId), eq(constructionExpenseEntries.projectId, projectId), gte(constructionExpenseEntries.expenseDate, periodStart), lt(constructionExpenseEntries.expenseDate, periodEnd)))

    // R67 E-22: the same four measures, per day. Three grouped reads on the
    // transaction already open -- no extra pool connection (C06-21), and the
    // day rows are built from the SAME predicates as the totals above, so a
    // column and the total cannot drift apart.
    const attendanceByDay = await db.select({
      date: constructionAttendance.attendanceDate,
      cost: sql<number>`coalesce(sum(${constructionAttendance.dailyCost}), 0)::float`,
      presentCount: sql<number>`count(*) filter (where ${constructionAttendance.status} = 'present')`,
    }).from(constructionAttendance)
      .where(and(eq(constructionAttendance.orgId, ctx.orgId), eq(constructionAttendance.projectId, projectId), gte(constructionAttendance.attendanceDate, periodStart), lt(constructionAttendance.attendanceDate, periodEnd)))
      .groupBy(constructionAttendance.attendanceDate)

    const expensesByDay = await db.select({
      date: constructionExpenseEntries.expenseDate,
      total: sql<number>`coalesce(sum(${constructionExpenseEntries.amount}), 0)::float`,
    }).from(constructionExpenseEntries)
      .where(and(eq(constructionExpenseEntries.orgId, ctx.orgId), eq(constructionExpenseEntries.projectId, projectId), gte(constructionExpenseEntries.expenseDate, periodStart), lt(constructionExpenseEntries.expenseDate, periodEnd)))
      .groupBy(constructionExpenseEntries.expenseDate)

    const progressByDay = await db.select({
      date: constructionWorkProgressEntries.entryDate,
      count: sql<number>`count(*)`,
    }).from(constructionWorkProgressEntries)
      .where(and(eq(constructionWorkProgressEntries.orgId, ctx.orgId), eq(constructionWorkProgressEntries.projectId, projectId), gte(constructionWorkProgressEntries.entryDate, periodStart), lt(constructionWorkProgressEntries.entryDate, periodEnd)))
      .groupBy(constructionWorkProgressEntries.entryDate)

    const byDay = buildPeriodDays(periodStart, periodEnd, {
      attendance: attendanceByDay.map((r) => ({ date: String(r.date), cost: Number(r.cost), presentCount: Number(r.presentCount) })),
      expenses: expensesByDay.map((r) => ({ date: String(r.date), total: Number(r.total) })),
      progress: progressByDay.map((r) => ({ date: String(r.date), count: Number(r.count) })),
      diaries: diaryEntries.map((d) => ({ date: String(d.diaryDate) })),
    })

    return {
      periodStart, periodEnd,
      progressEntriesLogged: Number(progressCount?.count ?? 0),
      labourCost: Number(attendanceCost?.total ?? 0),
      workersPresent: Number(attendanceCost?.presentCount ?? 0),
      diaryEntries: diaryEntries.length,
      expenseTotal: Number(expenseTotal?.total ?? 0),
      byDay,
    }
  })
}

/**
 * R67 E-22. Turns four grouped-by-date reads into ONE row per calendar day in
 * [periodStart, periodEnd) -- including the days with nothing on them, which
 * is the whole point of a day-column report: a blank Thursday is a fact, and
 * a table that silently omits Thursday makes the week look shorter than it is.
 *
 * Pure, so the day-filling rule is unit-testable without a database.
 */
export function buildPeriodDays(
  periodStart: string,
  periodEnd: string,
  data: {
    attendance: { date: string; cost: number; presentCount: number }[]
    expenses: { date: string; total: number }[]
    progress: { date: string; count: number }[]
    diaries: { date: string }[]
  }
): ProjectPeriodDay[] {
  const attendanceByDate = new Map(data.attendance.map((r) => [r.date, r]))
  const expenseByDate = new Map(data.expenses.map((r) => [r.date, r.total]))
  const progressByDate = new Map(data.progress.map((r) => [r.date, r.count]))
  const diaryByDate = new Map<string, number>()
  for (const d of data.diaries) diaryByDate.set(d.date, (diaryByDate.get(d.date) ?? 0) + 1)

  const days: ProjectPeriodDay[] = []
  // Iterate on UTC midnights so a DST boundary cannot drop or duplicate a day.
  const end = Date.parse(`${periodEnd}T00:00:00Z`)
  for (let t = Date.parse(`${periodStart}T00:00:00Z`); Number.isFinite(t) && Number.isFinite(end) && t < end; t += 86400000) {
    const date = new Date(t).toISOString().slice(0, 10)
    const attendance = attendanceByDate.get(date)
    days.push({
      date,
      labourCost: attendance?.cost ?? 0,
      workersPresent: attendance?.presentCount ?? 0,
      expenseTotal: expenseByDate.get(date) ?? 0,
      progressEntriesLogged: progressByDate.get(date) ?? 0,
      diaryEntries: diaryByDate.get(date) ?? 0,
    })
  }
  return days
}

export async function weeklyProjectReport(ctx: { orgId: string }, projectId: string, weekStart: string) {
  const weekEnd = new Date(new Date(weekStart).getTime() + 7 * 86400000).toISOString().slice(0, 10)
  const result = await projectPeriodReport(ctx, projectId, weekStart, weekEnd)
  // R67 E-22: byDay is passed straight through -- Sumeet's Weekly Project
  // sheet is day columns over category rows, and this is those columns.
  return { weekStart, weekEnd, progressEntriesLogged: result.progressEntriesLogged, labourCost: result.labourCost, workersPresent: result.workersPresent, diaryEntries: result.diaryEntries, expenseTotal: result.expenseTotal, byDay: result.byDay }
}

// 3. Project Status Report -- reuses the project dashboard verbatim.
export async function projectStatusReport(ctx: { orgId: string }, projectId: string) {
  await ensureConstructionEnabled(ctx.orgId)
  return getProjectDashboard(ctx, projectId)
}

// 4. Attendance Report -- present/absent/half_day counts + cost, by trade.
//
// R67 E-22 (R-199): Sumeet's Attendance sheet is ONE ROW PER WORKER --
// S.No | ID | Name | Company | Trade | Salary -- with a subtotal per trade.
// The trade x status roll-up this function already returned cannot produce
// that sheet (it has no worker identity in it at all), so `workers` and
// `tradeSubtotals` are added alongside it. `rows` is untouched, because the
// existing consumers (report-engine-service's definition rows, the projexa
// generic renderer) read it.
export type AttendanceWorkerRow = {
  rosterId: string
  /** The customer's own free-text worker label -- his "ID" column. null when never set. */
  employeeCode: string | null
  name: string
  /** The subcontractor the worker belongs to -- his "Company" column. null for direct labour. */
  company: string | null
  trade: string | null
  daysPresent: number
  daysHalf: number
  daysAbsent: number
  /** Summed daily_cost over the period -- his "Salary" column. */
  salary: number
}

export type AttendanceTradeSubtotal = { trade: string; workers: number; daysPresent: number; salary: number }

/** Pure: the trade subtotal rows under Sumeet's worker table, in the same trade order the rows appear in. */
export function rollUpAttendanceByTrade(workers: AttendanceWorkerRow[]): AttendanceTradeSubtotal[] {
  const byTrade = new Map<string, AttendanceTradeSubtotal>()
  for (const w of workers) {
    // A worker with no trade recorded is still a real worker with a real
    // wage -- bucketed under a named "Not set" subtotal rather than dropped,
    // so the subtotals still add up to the table.
    const trade = w.trade?.trim() || "Not set"
    const row = byTrade.get(trade) ?? { trade, workers: 0, daysPresent: 0, salary: 0 }
    row.workers += 1
    row.daysPresent += w.daysPresent
    row.salary += w.salary
    byTrade.set(trade, row)
  }
  return Array.from(byTrade.values())
}

// R67 D-31: dateFrom/dateTo are additive and optional. Omitting both keeps the
// existing all-time behaviour byte for byte, which is what the report registry
// (and therefore every existing caller) does -- the dispatcher passes only
// (ctx, projectId). They exist so the Manpower screen's "Today / This week /
// This month" panel can reuse THIS aggregate rather than a second, parallel
// grouping written for the screen. E-22's worker rows below are built from the
// SAME date-filtered read, so the sheet and the roll-up cover one period.
export async function attendanceReport(ctx: { orgId: string }, projectId: string, dateFrom?: string, dateTo?: string) {
  // R67 F-10: the memoised check, not requireConstructionEnabled() directly.
  await ensureConstructionEnabled(ctx.orgId)
  return withTenantContext({ orgId: ctx.orgId }, async (db) => {
    const conditions = [eq(constructionAttendance.orgId, ctx.orgId), eq(constructionAttendance.projectId, projectId)]
    if (dateFrom) conditions.push(gte(constructionAttendance.attendanceDate, dateFrom))
    if (dateTo) conditions.push(lte(constructionAttendance.attendanceDate, dateTo))
    const rows = await db.select({
      trade: constructionLabourRoster.trade,
      status: constructionAttendance.status,
      count: sql<number>`count(*)`,
      cost: sql<number>`coalesce(sum(${constructionAttendance.dailyCost}), 0)::float`,
    }).from(constructionAttendance)
      .innerJoin(constructionLabourRoster, eq(constructionAttendance.rosterId, constructionLabourRoster.id))
      .where(and(...conditions))
      .groupBy(constructionLabourRoster.trade, constructionAttendance.status)

    // One grouped read on the SAME transaction -- the vendor join is a LEFT
    // join because direct (non-subcontracted) labour has no vendorId, and an
    // inner join would silently drop exactly the workers a main contractor
    // employs itself.
    const workerRows = await db.select({
      rosterId: constructionLabourRoster.id,
      employeeCode: constructionLabourRoster.employeeCode,
      name: constructionLabourRoster.name,
      company: erpSuppliers.supplierName,
      trade: constructionLabourRoster.trade,
      daysPresent: sql<number>`count(*) filter (where ${constructionAttendance.status} = 'present')`,
      daysHalf: sql<number>`count(*) filter (where ${constructionAttendance.status} = 'half_day')`,
      daysAbsent: sql<number>`count(*) filter (where ${constructionAttendance.status} = 'absent')`,
      salary: sql<number>`coalesce(sum(${constructionAttendance.dailyCost}), 0)::float`,
    }).from(constructionAttendance)
      .innerJoin(constructionLabourRoster, eq(constructionAttendance.rosterId, constructionLabourRoster.id))
      .leftJoin(erpSuppliers, eq(constructionLabourRoster.vendorId, erpSuppliers.id))
      // R67 E-22 x D-31 (resolved on rebase): the SAME `conditions` the trade
      // roll-up above uses, date filter included. E-22 wrote this query before
      // D-31 added dateFrom/dateTo, so it carried its own org+project where
      // clause; left that way, a caller passing a range would get a trade
      // roll-up for the range and a worker sheet for all time, on one sheet,
      // with subtotals that do not reconcile.
      .where(and(...conditions))
      .groupBy(constructionLabourRoster.id, constructionLabourRoster.employeeCode, constructionLabourRoster.name, erpSuppliers.supplierName, constructionLabourRoster.trade)
      .orderBy(constructionLabourRoster.trade, constructionLabourRoster.name)

    const workers: AttendanceWorkerRow[] = workerRows.map((r) => ({
      rosterId: r.rosterId,
      employeeCode: r.employeeCode,
      name: r.name,
      company: r.company,
      trade: r.trade,
      daysPresent: Number(r.daysPresent),
      daysHalf: Number(r.daysHalf),
      daysAbsent: Number(r.daysAbsent),
      salary: Number(r.salary),
    }))

    return { rows, workers, tradeSubtotals: rollUpAttendanceByTrade(workers) }
  })
}

// ---------------------------------------------------------------------------
// R67 D-31 (R-090): the trade-wise attendance summary the Manpower screen shows.
//
// Sumeet asked for "how many people are on site today, by trade, and what they
// cost". Both halves of that answer already existed as aggregates in this file
// -- attendanceReport() groups by (trade, status) with cost, manpowerCostReport()
// groups by trade with an attendance-row count and cost -- and neither was
// reachable from the screen where the work happens. So no new SQL grouping is
// written here: the summary COMPOSES those two, and because they are two
// independently-issued aggregates over the same window, comparing them is a
// real reconciliation rather than a tautology (see reconcileAttendanceSummary).
export const UNSPECIFIED_TRADE_LABEL = "Unspecified"

/**
 * Worker-days per attendance status. Identical to construction-labour-service's
 * COST_MULTIPLIER, and for the same reason: a half day is half a worker-day
 * exactly as it is half a day's pay, and an absence is neither. Kept here as
 * its own named constant rather than imported, because that one is about MONEY
 * and this one is about PEOPLE -- they agree today, and a future change to
 * either must be a deliberate decision about the other.
 */
export const WORKER_DAY_WEIGHT: Record<string, number> = { present: 1, half_day: 0.5, absent: 0 }

export type AttendanceStatusRow = { trade: string | null; status: string; count: number | string; cost: number | string }
export type AttendanceSummaryRow = {
  trade: string
  present: number
  halfDay: number
  absent: number
  workerDays: number
  cost: number
}

function toNumber(value: number | string | null | undefined): number {
  if (value === null || value === undefined) return 0
  const n = typeof value === "number" ? value : Number(value)
  return Number.isFinite(n) ? n : 0
}

/** Pure. Folds attendanceReport()'s (trade, status) rows into one row per trade. */
export function buildAttendanceSummaryRows(statusRows: AttendanceStatusRow[]): AttendanceSummaryRow[] {
  const byTrade = new Map<string, AttendanceSummaryRow>()
  for (const row of statusRows) {
    // A blank trade is a real roster row with no trade recorded, not a missing
    // group -- it is named, never dropped, or the totals stop adding up.
    const trade = row.trade?.trim() || UNSPECIFIED_TRADE_LABEL
    const current = byTrade.get(trade) ?? { trade, present: 0, halfDay: 0, absent: 0, workerDays: 0, cost: 0 }
    const count = toNumber(row.count)
    if (row.status === "present") current.present += count
    else if (row.status === "half_day") current.halfDay += count
    else if (row.status === "absent") current.absent += count
    current.workerDays += count * (WORKER_DAY_WEIGHT[row.status] ?? 0)
    current.cost += toNumber(row.cost)
    byTrade.set(trade, current)
  }
  // Alphabetical, with the unnamed group last: a stable order the screen and
  // the PDF share, so a printed sheet matches what was on screen.
  return [...byTrade.values()].sort((a, b) => {
    if (a.trade === UNSPECIFIED_TRADE_LABEL) return 1
    if (b.trade === UNSPECIFIED_TRADE_LABEL) return -1
    return a.trade.localeCompare(b.trade)
  })
}

/** Pure. The bold grand-total row. */
export function totalAttendanceSummary(rows: AttendanceSummaryRow[]): Omit<AttendanceSummaryRow, "trade"> {
  return rows.reduce(
    (total, row) => ({
      present: total.present + row.present,
      halfDay: total.halfDay + row.halfDay,
      absent: total.absent + row.absent,
      workerDays: total.workerDays + row.workerDays,
      cost: total.cost + row.cost,
    }),
    { present: 0, halfDay: 0, absent: 0, workerDays: 0, cost: 0 }
  )
}

export type AttendanceReconciliation = {
  ties: boolean
  /** Attendance rows counted by the (trade, status) aggregate vs by the per-trade one. */
  rowCountFromStatuses: number
  rowCountFromTrades: number
  costFromStatuses: number
  costFromTrades: number
}

/**
 * Pure. Compares the two aggregates against each other. This is NOT a
 * tautology: `rows` come from attendanceReport()'s (trade, status) grouping and
 * `byTrade` from manpowerCostReport()'s own separate query, so a difference
 * means one of them saw rows the other did not -- a join that dropped a roster
 * row, a write that landed between the two reads -- and the screen must say so
 * rather than print a total nobody can reproduce.
 *
 * Compared on ATTENDANCE-ROW COUNT, not worker-days: manpowerCostReport counts
 * every attendance row including absences, while worker-days weight them. The
 * comparable quantity is present + halfDay + absent.
 */
export function reconcileAttendanceSummary(
  rows: AttendanceSummaryRow[],
  byTrade: { totalCost: number | string; workerDays: number | string }[]
): AttendanceReconciliation {
  const rowCountFromStatuses = rows.reduce((s, r) => s + r.present + r.halfDay + r.absent, 0)
  const rowCountFromTrades = byTrade.reduce((s, r) => s + toNumber(r.workerDays), 0)
  const costFromStatuses = rows.reduce((s, r) => s + r.cost, 0)
  const costFromTrades = byTrade.reduce((s, r) => s + toNumber(r.totalCost), 0)
  // Money is summed as floats on both sides; a sub-cent difference is the
  // float, not a disagreement about the data.
  const ties = rowCountFromStatuses === rowCountFromTrades && Math.abs(costFromStatuses - costFromTrades) < 0.005
  return { ties, rowCountFromStatuses, rowCountFromTrades, costFromStatuses, costFromTrades }
}

/** Pure. "12 people on site" -- the headline count, which is bodies present at all, half-day included. */
export function headcountOnSite(rows: AttendanceSummaryRow[]): number {
  return rows.reduce((s, r) => s + r.present + r.halfDay, 0)
}

export type AttendanceSummary = {
  projectId: string
  from: string | null
  to: string | null
  rows: AttendanceSummaryRow[]
  totals: Omit<AttendanceSummaryRow, "trade">
  headcount: number
  reconciliation: AttendanceReconciliation
}

export async function attendanceSummary(
  ctx: { orgId: string },
  projectId: string,
  from?: string,
  to?: string
): Promise<AttendanceSummary> {
  const [statuses, byTrade] = await Promise.all([
    attendanceReport(ctx, projectId, from, to),
    manpowerCostReport(ctx, projectId, undefined, undefined, from, to),
  ])
  const rows = buildAttendanceSummaryRows(statuses.rows)
  return {
    projectId,
    from: from ?? null,
    to: to ?? null,
    rows,
    totals: totalAttendanceSummary(rows),
    headcount: headcountOnSite(rows),
    reconciliation: reconcileAttendanceSummary(rows, byTrade.byTrade),
  }
}

// 5. Site Picture Report -- documents(category='site_photo') grouped by date.
export async function sitePictureReport(ctx: { orgId: string }, projectId: string) {
  await ensureConstructionEnabled(ctx.orgId)
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
  await ensureConstructionEnabled(ctx.orgId)
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

/**
 * R67 D-26 (R-066) -- the pure heart of boqBudgetVarianceReport, extracted so
 * the rule can be tested without a live DB (this file's own convention; see
 * computeEarnedValue / aggregateDesignerTimesheetCosts).
 *
 * TWO REAL CHANGES from the R39/R-C09 version this replaces:
 *
 *  1. COMMITTED COST IS ALL THREE. Sumeet's budget model against a scope line
 *     is vendor, MATERIAL and MANPOWER; only vendor existed, so "committed"
 *     could never be more than the subcontract.
 *  2. THE SIGN IS NOW "HOW MUCH BUDGET IS LEFT". variance = budget - vendor -
 *     material - manpower, so a POSITIVE variance means under budget and a
 *     NEGATIVE one means over. (The previous formula was vendorAmount - budget,
 *     the opposite reading. Every caller of this report is updated in the same
 *     change; there is exactly one, PROJEXA's Cost Variance tab.)
 *
 * `null` remains load-bearing and is the reason this is not just arithmetic: a
 * line with NO vendor, material or manpower has no variance at all, and must
 * not be reported as 0 -- a fabricated zero reads as "on budget" when the truth
 * is "nothing has been costed yet".
 *
 * R67 MERGE NOTE (D-11, lane D1 x lane D21, 2026-09-03) -- READ BEFORE EDITING.
 * Lane D1 arrived at this same file with its own pure extraction, toBudgetLine()
 * (below), written from D-62 against the OLD sign (variance = vendorAmount -
 * budget) and counting ONLY the vendor amount as committed. Both lanes were
 * written in parallel from the same audit and only met here. NOTHING WAS
 * DROPPED, but the two are no longer independent:
 *
 *   - THIS function is now the single source of the budget/committed/variance
 *     arithmetic. D21's semantics win on merit: "committed" that ignores
 *     material and manpower understates every line that was costed without a
 *     subcontract, and the surrounding totals in boqBudgetVarianceReport (which
 *     merged cleanly from main) read `_rawCommitted`, a figure D1's row shape
 *     never produced.
 *   - toBudgetLine() SURVIVES as D1's per-row projection, but it no longer does
 *     its own arithmetic -- it calls this function. Two exported functions each
 *     computing "the variance" with opposite signs is precisely the defect this
 *     programme has already found once (format-date.ts carrying two
 *     implementations of one exported function), and it is not repeated here.
 *   - D1's assertion that a 30,000 vendor amount against a 25,000 budget yields
 *     +5,000 has been RESTATED, not deleted, as -5,000 under this sign. See the
 *     test file's own merge note.
 */
export type BudgetVarianceInput = {
  amount: number
  budgetPercentage: number
  vendorAmount: number | null
  materialAmount: number | null
  manpowerAmount: number | null
}

export function computeBudgetVarianceLine(input: BudgetVarianceInput): { budget: number; committed: number | null; variance: number | null } {
  const budget = input.amount * (input.budgetPercentage / 100)
  const nothingCosted = input.vendorAmount === null && input.materialAmount === null && input.manpowerAmount === null
  if (nothingCosted) return { budget, committed: null, variance: null }
  const committed = (input.vendorAmount ?? 0) + (input.materialAmount ?? 0) + (input.manpowerAmount ?? 0)
  return { budget, committed, variance: budget - committed }
}

/** A line is over budget when its committed cost exceeds its budget -- i.e. a NEGATIVE variance. A line with no committed cost is neither over nor under. */
export function isLineOverBudget(variance: number | null): boolean {
  return variance !== null && variance < 0
}

/**
 * R67 D-62 (audit R-202). One BOQ line, as the Budget tab reads it. Pure, so the
 * projection and the null rules can be tested without a database. The ARITHMETIC
 * is not here -- it is computeBudgetVarianceLine above (see that function's merge
 * note); this function is the row shape and the presentation rules only.
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
 *
 * unit/quantity/rate and the row INDEX are optional (D-26 added them to the row
 * so the Cost Variance table can match Sumeet's Budget Report shape). The real
 * DB row always carries all three, so the call site below is unaffected; they
 * are optional purely so a pure test fixture need not restate presentation-only
 * columns to assert a null rule.
 */
export type BudgetLineInput = {
  id: string
  itemCode: string | null
  description: string
  unit?: string | null
  quantity?: string | number | null
  rate?: string | number | null
  amount: string | number
  budgetPercentage: string | number
  materialAmount: string | number | null
  manpowerAmount: string | number | null
  vendorId: string | null
  vendorAmount: string | number | null
  category: string | null
  /**
   * R67 E-26 (R-212): null on a root line, the parent's id on a sub-task.
   * Optional so the many existing callers that build a BudgetLineInput by hand
   * keep compiling; absent is read as "root", which is what a caller with no
   * hierarchy means.
   */
  parentLineItemId?: string | null
}

/**
 * R67 E-26 (R-212). THE SENTENCE THIS REPORT NOW OBEYS, printed on the report
 * itself so a QS reading a printout knows the rule the totals follow.
 */
export const DERIVED_BUDGET_NOTE =
  "Totals sum root BOQ lines only. A sub-task's budget is derived from its parent line, so it is shown for detail and never added into a total."

export function toBudgetLine(item: BudgetLineInput, supplierNameById: Map<string, string>, index = 0) {
  const vendorAmount = item.vendorAmount !== null ? Number(item.vendorAmount) : null
  const materialAmount = item.materialAmount !== null ? Number(item.materialAmount) : null
  const manpowerAmount = item.manpowerAmount !== null ? Number(item.manpowerAmount) : null
  const { budget: rawBudget, committed: rawCommitted, variance: rawVariance } = computeBudgetVarianceLine({
    amount: Number(item.amount),
    budgetPercentage: Number(item.budgetPercentage),
    vendorAmount,
    materialAmount,
    manpowerAmount,
  })
  return {
    // R67 D-26: S.No, Category, Qty and Rate join the row so the Cost Variance
    // table can match Sumeet's own Budget Report shape.
    serialNumber: index + 1,
    lineItemId: item.id,
    code: item.itemCode,
    // R67 lane I (WS-I item I-05, R-177): the line's own category, so the
    // Budget table can show a Category column and group by a real value.
    // null (never "") -- normalizeCategory in construction-boq-service.ts is
    // the single writer, so "no category" is one value here, and the Budget
    // Report's Category filter shows those lines under "No category" rather
    // than inventing one.
    category: item.category,
    description: item.description,
    unit: item.unit ?? null,
    quantity: item.quantity != null ? Number(item.quantity) : null,
    rate: item.rate != null ? Number(item.rate) : null,
    amount: Number(item.amount),
    budgetPercentage: Number(item.budgetPercentage),
    budget: Math.round(rawBudget * 100) / 100,
    // R67 lane I (WS-I item I-03): the material/manpower split, projected
    // alongside the budget it belongs to. null (not 0) when the QS has not
    // split this line -- "unsplit" and "split as zero" are different facts and
    // a report that conflated them would read as if every line had been costed.
    // (Both already narrowed to number | null above, for
    // computeBudgetVarianceLine's input -- reused here so the row and the
    // arithmetic can never read the column two different ways.)
    materialAmount,
    manpowerAmount,
    vendorId: item.vendorId,
    vendorName: item.vendorId ? (supplierNameById.get(item.vendorId) ?? null) : null,
    vendorAmount,
    committed: rawCommitted !== null ? Math.round(rawCommitted * 100) / 100 : null,
    // *** CONTRACT CHANGE, R67 D-26. `variance` USED TO MEAN OVERSPEND
    // (vendorAmount - budget); it now means BUDGET REMAINING
    // (budget - vendor - material - manpower). Same name, opposite sign.
    // `budgetRemaining` below is the name that says what the number is;
    // `variance` is kept as its alias so the shipped /reports/budget-variance
    // consumers keep working, and is the one to drop once they have moved.
    variance: rawVariance !== null ? Math.round(rawVariance * 100) / 100 : null,
    budgetRemaining: rawVariance !== null ? Math.round(rawVariance * 100) / 100 : null,
    // R67 E-26 (R-212): the two facts the UI needs to show a sub-task without
    // COUNTING it. A sub-task's amount is AMOUNT_root x breakdownPercentage/100,
    // so its budget is derived from the root's and the root row already carries
    // the whole value -- see the roots-only totals in boqBudgetVarianceReport.
    parentLineItemId: item.parentLineItemId ?? null,
    budgetIsDerived: (item.parentLineItemId ?? null) !== null,
    /**
     * Filled in by the caller that can see the whole BOQ (a pure row projection
     * cannot know its parent's budget). null on a root, and on a child whose
     * parent is not among the rows being reported.
     */
    percentOfParent: null as number | null,
    _rawBudget: rawBudget,
    _rawCommitted: rawCommitted,
    _rawVariance: rawVariance,
  }
}

export type BudgetLine = ReturnType<typeof toBudgetLine>

/**
 * R67 E-26 (R-212). THE FIX, and the reason this report's totals changed.
 *
 * THE BUG. The totals summed EVERY line -- roots and their derived sub-tasks
 * alike. This file's own `rootBoqLineItemsOnly` rule (and scopeReport, and
 * categoryBoqAmountsReport, and earnedValueReport, and projexa's WPR grand
 * total) already records why that is wrong: a sub-task's amount is
 * AMOUNT_root x breakdownPercentage/100, so the root row already carries the
 * full value and adding the child on top counts the same money twice. The
 * observed consequence was a QS being shown two budgets for one BOQ that were
 * 35% apart -- this report's total against the Work Progress Report's.
 *
 * WHAT DID NOT CHANGE. Every line is still RETURNED, child rows included: a QS
 * needs to see the breakdown, and hiding the rows would trade one wrong answer
 * for a missing one. Each row says which it is (`parentLineItemId`,
 * `budgetIsDerived`) and what share of its parent it represents
 * (`percentOfParent`), so the UI can show a child without counting it.
 *
 * WHY THIS IS A SEPARATE, PURE FUNCTION. E-26's acceptance is a unit test on
 * the roots-only rule, and the report around it needs a database. It is NOT a
 * second implementation of the arithmetic: every figure here is summed from the
 * `_raw*` values toBudgetLine() already computed through
 * computeBudgetVarianceLine(), so there remains exactly ONE place that decides
 * what a line's budget, committed cost and variance are. (Two exported
 * functions each computing "the variance" is the defect this file's own D-11
 * merge note records, and it is not repeated here.)
 *
 * ROUNDING. Unchanged from the R48 gap-closure rule: totals are summed from the
 * RAW per-line figures and rounded once at the end, so they reconcile exactly
 * to a raw SQL SUM over the same rows rather than drifting by accumulated
 * per-line rounding.
 */
export function summariseBudgetLines(lines: BudgetLine[]) {
  // Each sub-task's share of its parent's budget, so the UI can print "35% of
  // parent" beside an indented row instead of leaving the reader to work out
  // why a child's budget is what it is. Done here rather than in toBudgetLine
  // because only this scope can see the parent row.
  const rawBudgetById = new Map(lines.map((l) => [l.lineItemId, l._rawBudget]))
  for (const line of lines) {
    if (line.parentLineItemId === null) continue
    const parentBudget = rawBudgetById.get(line.parentLineItemId)
    if (parentBudget === undefined || parentBudget === 0) continue
    line.percentOfParent = Math.round((line._rawBudget / parentBudget) * 100 * 100) / 100
  }

  // Applying the roots-only rule to only SOME of the money totals would just
  // move the disagreement, so it applies to every one of them.
  const rootLines = lines.filter((l) => l.parentLineItemId === null)

  const totalBudget = Math.round(rootLines.reduce((s, l) => s + l._rawBudget, 0) * 100) / 100
  const totalVendorAmount = Math.round(rootLines.reduce((s, l) => s + (l.vendorAmount ?? 0), 0) * 100) / 100
  // R67 D-26: null, not 0, when NO line carries any committed cost -- the tiles
  // then read "Committed AED –" rather than a zero that looks like a measured
  // figure. One costed line is enough to make the total real.
  const costedLines = rootLines.filter((l) => l._rawCommitted !== null)
  const totalCommitted = costedLines.length === 0 ? null : Math.round(costedLines.reduce((s, l) => s + (l._rawCommitted ?? 0), 0) * 100) / 100
  const totalVariance = costedLines.length === 0 ? null : Math.round(costedLines.reduce((s, l) => s + (l._rawVariance ?? 0), 0) * 100) / 100
  // R67 lane I (WS-I item I-03): totalled once, at the end, over the raw
  // per-line values -- the same single-rounding rule as above.
  const totalMaterialAmount = Math.round(rootLines.reduce((s, l) => s + (l.materialAmount ?? 0), 0) * 100) / 100
  const totalManpowerAmount = Math.round(rootLines.reduce((s, l) => s + (l.manpowerAmount ?? 0), 0) * 100) / 100

  return {
    lines: lines.map(({ _rawBudget, _rawCommitted, _rawVariance, ...line }) => line),
    totalBudget,
    totalVendorAmount,
    totalCommitted,
    totalVariance,
    budgetRemaining: totalVariance,
    totalMaterialAmount,
    totalManpowerAmount,
    // Counts, not money: these describe the ROWS the table shows, which is
    // every line including sub-tasks, so they are deliberately NOT filtered to
    // roots the way the money totals are. `note` states that rule on the report
    // itself, so a QS reading a printout knows which population each figure
    // covers.
    linesOverBudget: lines.filter((l) => isLineOverBudget(l.variance)).length,
    lineCount: lines.length,
    note: DERIVED_BUDGET_NOTE,
  }
}

// R39/R-C09 (Point 154 follow-on), rewritten by R67 D-26: per-line budget vs
// committed cost, over the latest (non-superseded) BOQ's line items -- reuses
// the SAME budgetPercentage/vendorId/vendorAmount columns Point 154 shipped,
// plus material_amount/manpower_amount (drizzle/0529), and computedBudget()'s
// exact amount*pct/100 formula (kept in one place per D-3 -- see that
// function's own comment for why it's not stored).
export async function boqBudgetVarianceReport(ctx: { orgId: string }, projectId: string) {
  await ensureConstructionEnabled(ctx.orgId)
  return withTenantContext({ orgId: ctx.orgId }, async (db) => {
    const boqs = await db.query.constructionBoqs.findMany({ where: and(eq(constructionBoqs.orgId, ctx.orgId), eq(constructionBoqs.projectId, projectId)), orderBy: (t, { desc }) => [desc(t.version), desc(t.createdAt)] })
    const latest = boqs.find((b) => b.status !== "superseded") ?? boqs[0]
    // R67 lane I (I-03) + D-26: the empty-project shape must carry the SAME
    // keys as the populated one, or a caller that reads totalMaterialAmount or
    // totalCommitted gets undefined on a project with no BOQ and renders "NaN".
    if (!latest) {
      // R67 E-26: built through the SAME summariser as the populated branch, so
      // the promise this comment makes is kept by construction rather than by
      // two literals being maintained in step.
      return { boqId: null, ...summariseBudgetLines([]) }
    }

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
    // R67 merge (D-11, lane D1 x lane D21): the row is built by toBudgetLine()
    // above -- D1's pure extraction, now computing through D21's
    // computeBudgetVarianceLine so the projection and the arithmetic cannot
    // drift apart. `index` feeds D-26's serialNumber.
    const lines = lineItems.map((item, index) => toBudgetLine(item, supplierNameById, index))
    return { boqId: latest.id, ...summariseBudgetLines(lines) }
  })
}

// 6. Scope Report -- BOQ total value + line-item count for the latest (non-superseded) revision.
export async function scopeReport(ctx: { orgId: string }, projectId: string) {
  await ensureConstructionEnabled(ctx.orgId)
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
  await ensureConstructionEnabled(ctx.orgId)
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
  await ensureConstructionEnabled(ctx.orgId)
  const [dashboard, expenseByHead] = await Promise.all([
    getProjectDashboard(ctx, projectId),
    getExpenseSummaryByHead(ctx, projectId),
  ])
  const actual = expenseByHead.reduce((s, r) => s + Number(r.total), 0)
  return { budget: dashboard.budget, actual, variance: budgetVariance(dashboard.budget, actual), byHead: expenseByHead }
}

// 9. Material Consumption Report -- net stock movement per item for this project (negative = consumed).
export async function materialConsumptionReport(ctx: { orgId: string }, projectId: string) {
  await ensureConstructionEnabled(ctx.orgId)
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
  await ensureConstructionEnabled(ctx.orgId)
  return withTenantContext({ orgId: ctx.orgId }, async (db) => {
    // R67 E-32 (R-265): the vendor's NAME joins here. This returned a bare
    // vendorId, so every consumer that rendered these rows -- the generic
    // report renderer included -- put a raw cuid where a company name belongs.
    // A LEFT join, and vendorName stays nullable, because a roster row can
    // legitimately point at a supplier that has since been removed and a
    // missing name must read as missing, not drop the cost off the report.
    // Additive: `vendorId` and `total` are untouched for every existing caller.
    const rows = await db.select({
      vendorId: constructionLabourRoster.vendorId,
      vendorName: erpSuppliers.supplierName,
      total: sql<number>`coalesce(sum(${constructionAttendance.dailyCost}), 0)::float`,
    }).from(constructionAttendance)
      .innerJoin(constructionLabourRoster, eq(constructionAttendance.rosterId, constructionLabourRoster.id))
      .leftJoin(erpSuppliers, eq(constructionLabourRoster.vendorId, erpSuppliers.id))
      .where(and(eq(constructionAttendance.orgId, ctx.orgId), eq(constructionAttendance.projectId, projectId), sql`${constructionLabourRoster.vendorId} is not null`))
      .groupBy(constructionLabourRoster.vendorId, erpSuppliers.supplierName)
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
// R67 D-31: dateFrom/dateTo added after date/trade so every existing positional
// caller (the report dispatcher passes date and trade only) is untouched. `date`
// stays the exact-day filter it has always been; the range is for the Manpower
// panel's Today / This week / This month presets.
export async function manpowerCostReport(ctx: { orgId: string }, projectId: string, date?: string, trade?: string, dateFrom?: string, dateTo?: string) {
  // R67 F-10: the memoised check, not requireConstructionEnabled() directly.
  await ensureConstructionEnabled(ctx.orgId)
  return withTenantContext({ orgId: ctx.orgId }, async (db) => {
    const conditions = [eq(constructionAttendance.orgId, ctx.orgId), eq(constructionAttendance.projectId, projectId)]
    if (date) conditions.push(eq(constructionAttendance.attendanceDate, date))
    if (dateFrom) conditions.push(gte(constructionAttendance.attendanceDate, dateFrom))
    if (dateTo) conditions.push(lte(constructionAttendance.attendanceDate, dateTo))
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
  await ensureConstructionEnabled(ctx.orgId)
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

// R67 E-32 follow-up (E-36..E-40 group): typed, not Record<string, ...>.
// `counts` was a Record with a STRING key, and spreading a string-indexed
// record into an object literal produces a type with no known properties at
// all -- so aggregateDesignerApprovalStatus()'s public return type was
// `{ userId, userName }[]`, the four status buckets were invisible to
// TypeScript, and E-32's report-table builder for this report referenced
// `u.draft.hours` against a type that had no `draft`. Runtime values are
// unchanged; the keys are simply now declared.
type ApprovalStatusKey = TimesheetStatusEntry["approvalStatus"]
type ApprovalStatusCount = { hours: number; entries: number }

export function aggregateDesignerApprovalStatus(entries: TimesheetStatusEntry[]) {
  const byUser = new Map<
    string,
    { userId: string; userName: string; counts: Record<ApprovalStatusKey, ApprovalStatusCount> }
  >()
  for (const e of entries) {
    let bucket = byUser.get(e.userId)
    if (!bucket) {
      bucket = {
        userId: e.userId,
        userName: e.userName,
        counts: {
          draft: { hours: 0, entries: 0 },
          submitted: { hours: 0, entries: 0 },
          approved: { hours: 0, entries: 0 },
          rejected: { hours: 0, entries: 0 },
        },
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
  await ensureConstructionEnabled(ctx.orgId)
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
  await ensureConstructionEnabled(ctx.orgId)
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
  await ensureConstructionEnabled(ctx.orgId)
  return withTenantContext({ orgId: ctx.orgId }, async (db) => {
    const definitions = await db.query.constructionKpiDefinitions.findMany({ where: and(eq(constructionKpiDefinitions.orgId, ctx.orgId), eq(constructionKpiDefinitions.projectId, projectId)) })
    const defIds = definitions.map((d) => d.id)
    const entries = defIds.length > 0 ? await db.query.constructionKpiEntries.findMany({ where: inArray(constructionKpiEntries.kpiDefinitionId, defIds) }) : []
    return { definitions, entries }
  })
}

// 14. Revenue Report -- erp_sales_invoices for this project.
export async function revenueReport(ctx: { orgId: string }, projectId: string) {
  await ensureConstructionEnabled(ctx.orgId)
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
  await ensureConstructionEnabled(ctx.orgId)
  const byHead = await getExpenseSummaryByHead(ctx, projectId)
  return { byHead, total: byHead.reduce((s, r) => s + Number(r.total), 0) }
}

// R67 F-14 (R-215): the pure half of categoryProgressReport, extracted so the
// project dashboard can fold the same breakdown into the transaction it already
// holds instead of the browser making a second call for it. Exported for the
// same reason computeEarnedValue is: ONE arithmetic path, so the chart on the
// dashboard and the "category-progress" named report cannot disagree.
//
// An activity nobody has logged against counts as 0 here (not as absent), which
// is what the report has always done: a category with three activities and one
// logged at 60% is 20% complete, not 60%.
export type CategoryProgressRow = { categoryId: string; name: string; percentComplete: number }

export function computeCategoryProgress(
  categories: { id: string; name: string }[],
  activities: { id: string; categoryId: string | null }[],
  percentByActivity: Map<string, number>
): CategoryProgressRow[] {
  return categories.map((c) => {
    const activityIdsInCat = activities.filter((a) => a.categoryId === c.id).map((a) => a.id)
    const percents = activityIdsInCat.map((id) => percentByActivity.get(id) ?? 0)
    const avg = percents.length > 0 ? percents.reduce((s, p) => s + p, 0) / percents.length : 0
    return { categoryId: c.id, name: c.name, percentComplete: Math.round(avg) }
  })
}

// 16. Category Progress Report -- latest % complete averaged per category (via its activities).
export async function categoryProgressReport(ctx: { orgId: string }, projectId: string) {
  await ensureConstructionEnabled(ctx.orgId)
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
    return { categories: computeCategoryProgress(categories, activities, percentByActivity) }
  })
}

// 17. Project Completion Report -- overall completion % (reuses the dashboard figure) + category breakdown.
export async function projectCompletionReport(ctx: { orgId: string }, projectId: string) {
  await ensureConstructionEnabled(ctx.orgId)
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
  await ensureConstructionEnabled(ctx.orgId)
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
  await ensureConstructionEnabled(ctx.orgId)
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

// R67 D-53 (audit R-181). Sumeet's report 4 is a DAILY manpower sheet:
// trade-wise present/absent/half-day with that day's labour cost, and the
// people behind each trade row. Neither existing report answers it:
// attendanceReport() has no date filter at all (it aggregates a project's
// whole history), and manpowerCostReport() is date-aware but returns only
// cost and a worker-day count per trade -- no status split and no people.
//
// It is ONE function rather than a caller that awaits both, because both of
// those open their own withTenantContext transaction and the app_runtime pool
// is 5 connections wide (tenant-scoped.ts:31-38); chaining them would double
// the transaction cost of the screen /labour already renders slowly. Nesting
// them inside a third transaction is forbidden outright (programme decision
// D-06). So: one transaction, one joined read of the day's marked rows, and
// one vendor-name lookup for the companies that read mentions -- the grouping
// itself is done by the pure aggregator below, which is what the unit test
// exercises.
export const UNCATEGORISED_TRADE_LABEL = "Uncategorised trade"

export type ManpowerDailyPerson = {
  /** The roster entry's id -- the person, not the attendance row. */
  id: string
  employeeCode: string | null
  name: string
  trade: string | null
  company: string | null
  dailyRate: number
  status: string
  /**
   * What this person cost on this date. This is the attendance row's STORED
   * dailyCost, which construction-labour-service.ts computed from the roster
   * rate at the moment the day was marked (present x rate, half_day x rate/2,
   * absent 0 -- ATTENDANCE_COST_MULTIPLIER). Re-deriving it here from today's
   * dailyRate would retro-price a past day whenever a worker's rate changes,
   * which is exactly the bug a stored cost exists to prevent.
   */
  cost: number
}

export type ManpowerDailyTradeRow = {
  trade: string
  present: number
  absent: number
  halfDay: number
  headcount: number
  cost: number
}

/**
 * Pure: the day's marked people -> one row per trade plus the totals row.
 *
 * headcount is present + absent + halfDay, i.e. every person marked on the
 * date, so an expanded trade always lists exactly `headcount` people. Trades
 * sort alphabetically with the un-traded bucket LAST, never interleaved
 * alphabetically as "U" -- it is not a trade, it is the absence of one.
 */
export function aggregateManpowerDailySummary(people: readonly ManpowerDailyPerson[]): {
  rows: ManpowerDailyTradeRow[]
  totals: ManpowerDailyTradeRow
} {
  const byTrade = new Map<string, ManpowerDailyTradeRow>()
  for (const person of people) {
    const trade = person.trade && person.trade.trim() !== "" ? person.trade.trim() : UNCATEGORISED_TRADE_LABEL
    const row = byTrade.get(trade) ?? { trade, present: 0, absent: 0, halfDay: 0, headcount: 0, cost: 0 }
    if (person.status === "present") row.present++
    else if (person.status === "half_day") row.halfDay++
    else if (person.status === "absent") row.absent++
    row.headcount = row.present + row.absent + row.halfDay
    row.cost = Math.round((row.cost + (Number.isFinite(person.cost) ? person.cost : 0)) * 100) / 100
    byTrade.set(trade, row)
  }

  const rows = [...byTrade.values()].sort((a, b) => {
    if (a.trade === UNCATEGORISED_TRADE_LABEL) return 1
    if (b.trade === UNCATEGORISED_TRADE_LABEL) return -1
    return a.trade.localeCompare(b.trade)
  })

  const totals = rows.reduce<ManpowerDailyTradeRow>(
    (acc, row) => ({
      trade: "Total",
      present: acc.present + row.present,
      absent: acc.absent + row.absent,
      halfDay: acc.halfDay + row.halfDay,
      headcount: acc.headcount + row.headcount,
      cost: Math.round((acc.cost + row.cost) * 100) / 100,
    }),
    { trade: "Total", present: 0, absent: 0, halfDay: 0, headcount: 0, cost: 0 }
  )

  return { rows, totals }
}

export async function manpowerDailySummary(ctx: { orgId: string }, projectId: string, date?: string) {
  await requireConstructionEnabled(ctx.orgId)
  const attendanceDate = date ?? new Date().toISOString().slice(0, 10)
  return withTenantContext({ orgId: ctx.orgId }, async (db) => {
    const marked = await db.select({
      rosterId: constructionLabourRoster.id,
      employeeCode: constructionLabourRoster.employeeCode,
      name: constructionLabourRoster.name,
      trade: constructionLabourRoster.trade,
      vendorId: constructionLabourRoster.vendorId,
      dailyRate: constructionLabourRoster.dailyRate,
      status: constructionAttendance.status,
      dailyCost: constructionAttendance.dailyCost,
    }).from(constructionAttendance)
      .innerJoin(constructionLabourRoster, eq(constructionAttendance.rosterId, constructionLabourRoster.id))
      .where(and(
        eq(constructionAttendance.orgId, ctx.orgId),
        eq(constructionAttendance.projectId, projectId),
        eq(constructionAttendance.attendanceDate, attendanceDate)
      ))

    // One lookup for every company mentioned, not one per worker.
    const vendorIds = [...new Set(marked.map((row) => row.vendorId).filter((id): id is string => !!id))]
    const vendorRows = vendorIds.length > 0
      ? await db.select({ id: erpSuppliers.id, name: erpSuppliers.supplierName })
        .from(erpSuppliers)
        .where(and(eq(erpSuppliers.orgId, ctx.orgId), inArray(erpSuppliers.id, vendorIds)))
      : []
    const vendorName = new Map(vendorRows.map((v) => [v.id, v.name]))

    const people: ManpowerDailyPerson[] = marked.map((row) => ({
      id: row.rosterId,
      employeeCode: row.employeeCode,
      name: row.name,
      trade: row.trade,
      company: row.vendorId ? vendorName.get(row.vendorId) ?? null : null,
      dailyRate: Number(row.dailyRate ?? 0),
      status: row.status,
      cost: Math.round(Number(row.dailyCost ?? 0) * 100) / 100,
    })).sort((a, b) => a.name.localeCompare(b.name))

    return { date: attendanceDate, ...aggregateManpowerDailySummary(people), people }
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
  // R67 D-53: registered here so the Reports picker's "Attendance"/"Manpower
  // Cost" entries and /labour?tab=summary reach the SAME function by name.
  "manpower-daily-summary": manpowerDailySummary,
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

// ---------------------------------------------------------------------------
// R67 E-32 (R-265): EVERY REPORT IS A TABLE
// ---------------------------------------------------------------------------
//
// WHAT WAS WRONG. Each of the 23 handlers above answers in its own shape --
// some an array of rows, some an object of scalars, some a composite of four
// aggregates. PROJEXA's Reports module therefore had a per-report renderer for
// five of them (report-documents.ts, shipped by E-22) and, for the other
// eighteen, ReportOutput's generic renderer: a grid of the payload's own JSON
// KEY NAMES against their raw values. `percentByValue: 25` beside
// `progressPercent: 60`, `contractValue: 475000` with no currency, a cuid where
// a project name belongs. That is a debug view, not a report.
//
// WHAT THIS IS. One shape every report can be READ in -- columns that declare
// their own unit and alignment, rows keyed by those columns, an optional totals
// row, and the ORG'S currency stated ONCE for the whole table rather than
// guessed per cell. The screen then has exactly one renderer and one place
// where money, dates and blanks are formatted.
//
// WHY IT IS A TABULATOR AND NOT A REWRITE OF THE 23 HANDLERS. Three reasons,
// in order of weight:
//   1. `?format=legacy` has to keep working for a release. A handler that no
//      longer produces the old shape cannot serve it.
//   2. The handlers have in-process consumers that are not this screen -- the
//      WPR PDF and XLSX writers, the dashboards, report-engine-service. They
//      read the payloads directly and must not be broken to change a UI.
//   3. It is pure. Every column list and every total below is unit-testable
//      without a database, which is what makes "one row per vendor" a test
//      rather than a screenshot.
//
// TOTALS ARE NOT DECORATION. A totals entry appears only where adding that
// column up is a real arithmetic statement. Project Status has none: summing a
// revenue, a budget and an expense produces a number that means nothing, and
// putting it under a "Total" label would be a fabricated figure on a money
// report -- exactly what REPORT.GLOBAL exists to prevent.

/** What a column HOLDS, so the screen formats it once instead of sniffing each cell. */
export type ReportColumnUnit = "currency" | "percent" | "number" | "date" | "text"

export type ReportColumn = {
  key: string
  label: string
  unit: ReportColumnUnit
  align: "left" | "right"
}

/** A cell. `null` means "there is no value here", which renders as an en-dash -- never as 0. */
export type ReportCell = string | number | null

export type ReportTable = {
  columns: ReportColumn[]
  rows: Record<string, ReportCell>[]
  /** Keyed by column key. Present only where summing that column is a real statement. */
  totals?: Record<string, number>
  /** The org's base currency code, or null when the org has not set one. Never guessed. */
  currency: string | null
  /** A sentence about the table's own rules (e.g. what the totals do and do not include). */
  note?: string
}

const textCol = (key: string, label: string): ReportColumn => ({ key, label, unit: "text", align: "left" })
const dateCol = (key: string, label: string): ReportColumn => ({ key, label, unit: "date", align: "left" })
const moneyCol = (key: string, label: string): ReportColumn => ({ key, label, unit: "currency", align: "right" })
const numCol = (key: string, label: string): ReportColumn => ({ key, label, unit: "number", align: "right" })
const pctCol = (key: string, label: string): ReportColumn => ({ key, label, unit: "percent", align: "right" })

type BuiltTable = Omit<ReportTable, "currency">

type Payload<K extends ReportName> = Awaited<ReturnType<(typeof REPORT_REGISTRY)[K]>>

/**
 * Sums one numeric key over rows, ignoring nulls -- an unpriced line is not a
 * zero. Named sumColumn, not sumBy: this module already has a sumColumn() with a
 * completely different signature (items, keyFn, valueFn -> Map) that the
 * designer-timesheet aggregator uses, and a second definition of that name
 * silently shadows it for everything declared after this point.
 */
function sumColumn<T>(rows: T[], pick: (row: T) => number | null | undefined): number {
  const total = rows.reduce((s, r) => s + (pick(r) ?? 0), 0)
  return Math.round(total * 100) / 100
}

/**
 * One builder per registry entry. Typed against each handler's OWN return type
 * (`Payload<"scope">` and friends), so a handler that changes shape breaks this
 * file at compile time instead of quietly emitting a table of undefineds.
 */
const REPORT_TABLE_BUILDERS: { [K in ReportName]: (payload: Payload<K>) => BuiltTable } = {
  // The BOQ lines behind the progress, with the money rule the roll-up follows
  // printed on the table -- a child line is shown and never added up.
  "work-progress": (p) => ({
    columns: [textCol("code", "Code"), textCol("description", "Description"), textCol("category", "Category"), moneyCol("amount", "Amount")],
    rows: p.lines.map((l) => ({
      code: l.code,
      description: l.description,
      category: l.category ?? UNCATEGORIZED_LABEL,
      // A sub-task's amount is derived from its parent, so it is shown as a
      // detail on its own row and contributes nothing to the total.
      amount: l.parentLineItemId === null ? l.amount : null,
    })),
    totals: { amount: p.grandTotal },
    note: DERIVED_BUDGET_NOTE,
  }),

  // Sumeet's Weekly Project sheet: one row per DAY, and a week total that is
  // the sum of the days by construction rather than a second aggregate.
  "weekly-project": (p) => ({
    columns: [
      dateCol("date", "Date"), moneyCol("labourCost", "Labour cost"), numCol("workersPresent", "Workers"),
      moneyCol("expenseTotal", "Expenses"), numCol("progressEntriesLogged", "Progress entries"), numCol("diaryEntries", "Diary entries"),
    ],
    rows: p.byDay.map((d) => ({
      date: d.date, labourCost: d.labourCost, workersPresent: d.workersPresent,
      expenseTotal: d.expenseTotal, progressEntriesLogged: d.progressEntriesLogged, diaryEntries: d.diaryEntries,
    })),
    totals: {
      labourCost: p.labourCost, workersPresent: p.workersPresent, expenseTotal: p.expenseTotal,
      progressEntriesLogged: p.progressEntriesLogged, diaryEntries: p.diaryEntries,
    },
  }),

  // ONE row, because this report describes ONE project. Deliberately no totals:
  // see this section's header. The project NAME is the first cell, so the raw
  // cuid never reaches a reader.
  "project-status": (p) => ({
    columns: [
      textCol("projectName", "Project"), moneyCol("contractValue", "Contract value"), moneyCol("earnedValue", "Earned value"),
      pctCol("percentByValue", "% complete by value"), pctCol("progressPercent", "% logged"),
      moneyCol("revenue", "Revenue"), moneyCol("budget", "Budget"), moneyCol("expenses", "Expenses"),
      numCol("taskCount", "Tasks"), numCol("delayedTaskCount", "Late"),
    ],
    rows: [{
      projectName: p.projectName, contractValue: p.contractValue, earnedValue: p.earnedValue,
      percentByValue: p.percentByValue, progressPercent: p.progressPercent,
      revenue: p.revenue, budget: p.budget, expenses: p.expenses,
      taskCount: p.taskCount, delayedTaskCount: p.delayedTaskCount,
    }],
    note: "One project, one row. Revenue, budget and expenses are three different measures and are deliberately not totalled.",
  }),

  // Sumeet's Attendance sheet: one row per WORKER. `rows` (the trade x status
  // roll-up) has no worker identity in it and cannot make this sheet.
  attendance: (p) => ({
    columns: [
      textCol("employeeCode", "ID"), textCol("name", "Name"), textCol("company", "Company"), textCol("trade", "Trade"),
      numCol("daysPresent", "Present"), numCol("daysHalf", "Half day"), numCol("daysAbsent", "Absent"), moneyCol("salary", "Salary"),
    ],
    rows: p.workers.map((w) => ({
      employeeCode: w.employeeCode, name: w.name, company: w.company, trade: w.trade,
      daysPresent: w.daysPresent, daysHalf: w.daysHalf, daysAbsent: w.daysAbsent, salary: w.salary,
    })),
    totals: {
      salary: sumColumn(p.workers, (w) => w.salary),
      daysPresent: sumColumn(p.workers, (w) => w.daysPresent),
      daysHalf: sumColumn(p.workers, (w) => w.daysHalf),
      daysAbsent: sumColumn(p.workers, (w) => w.daysAbsent),
    },
  }),

  "site-picture": (p) => ({
    columns: [textCol("name", "Photo"), dateCol("createdAt", "Uploaded")],
    rows: p.photos.map((d) => ({ name: d.name, createdAt: d.createdAt ? new Date(d.createdAt).toISOString().slice(0, 10) : null })),
  }),

  // The BOQ this project is currently reporting against -- one row, because
  // exactly one revision is the live one. Older revisions are in the legacy
  // payload; listing them here with blank money would read as five BOQs.
  scope: (p) => ({
    columns: [
      textCol("title", "BOQ"), numCol("version", "Version"), textCol("status", "Status"),
      numCol("lineItemCount", "Line items"), moneyCol("totalValue", "Contract value"),
    ],
    rows: p.boq
      ? [{ title: p.boq.title, version: p.boq.version, status: p.boq.status, lineItemCount: p.lineItemCount, totalValue: p.totalValue }]
      : [],
    note: "Contract value sums root BOQ lines only, matching the Work Progress grand total.",
  }),

  "budget-summary": (p) => ({
    columns: [textCol("accountId", "Account"), moneyCol("total", "Budget")],
    rows: p.byAccount.map((r) => ({ accountId: r.accountId, total: Number(r.total) })),
    totals: { total: p.total },
  }),

  // Budget is a single undivided project-wide figure in the ERP model
  // (erp_budget_line_items has no expense-head dimension), so a per-head budget
  // is a null -- a real "there is no such number" -- and never a zero. The
  // comparison the report is FOR lives in the totals row, where all three
  // figures are real.
  // R67 E-32 x E-39 x D-02 (resolved on rebase): `budget` and `variance` are
  // `number | null` on this payload now -- D-02 made getProjectDashboard report
  // null (never 0) for a project with no ERP budget rows, and budgetVariance()
  // propagates that. `totals` is a map of NUMBERS, and its own contract is
  // "present only where summing that column is a real statement", so a budget
  // nobody has set is omitted rather than written as a 0 that would read as a
  // measured zero budget and make every unbudgeted project look overspent by
  // its whole spend. The renderer already prints an en dash for an absent
  // total, which is the honest cell here.
  "budget-vs-actual": (p) => ({
    columns: [textCol("head", "Expense head"), moneyCol("budget", "Budget"), moneyCol("actual", "Actual"), moneyCol("variance", "Variance")],
    rows: p.byHead.map((r) => ({ head: r.expenseHead, budget: null, actual: Number(r.total), variance: null })),
    totals: {
      ...(p.budget !== null ? { budget: p.budget } : {}),
      actual: p.actual,
      ...(p.variance !== null ? { variance: p.variance } : {}),
    },
    note: p.budget === null
      ? "No ERP budget is set for this project, so there is nothing to compare the spend against."
      : "The ERP budget is a single project-wide figure, so there is no per-head budget to compare against; the comparison is the total row.",
  }),

  "material-consumption": (p) => ({
    columns: [textCol("itemName", "Item"), textCol("uom", "UoM"), numCol("netQuantity", "Net quantity"), moneyCol("totalValue", "Value")],
    rows: p.items.map((r) => ({ itemName: r.itemName, uom: r.uom, netQuantity: Number(r.netQuantity), totalValue: Number(r.totalValue) })),
    totals: { totalValue: sumColumn(p.items, (r) => Number(r.totalValue)) },
  }),

  "vendor-cost": (p) => ({
    columns: [textCol("vendorName", "Vendor"), moneyCol("total", "Labour cost")],
    rows: p.labourVendorCosts.map((r) => ({ vendorName: r.vendorName ?? r.vendorId, total: Number(r.total) })),
    totals: { total: sumColumn(p.labourVendorCosts, (r) => Number(r.total)) },
    note: p.note,
  }),

  "manpower-cost": (p) => ({
    columns: [textCol("trade", "Trade"), numCol("workerDays", "Worker-days"), moneyCol("totalCost", "Cost")],
    rows: p.byTrade.map((r) => ({ trade: r.trade, workerDays: Number(r.workerDays), totalCost: Number(r.totalCost) })),
    totals: {
      workerDays: sumColumn(p.byTrade, (r) => Number(r.workerDays)),
      totalCost: sumColumn(p.byTrade, (r) => Number(r.totalCost)),
    },
  }),
  // R67 E-32, added on rebase: manpowerDailySummary reached main from lane D3
  // AFTER this builder map was written, so the map was one report short and the
  // "every registry report has a builder" guard caught it -- which is what that
  // guard is for. One row per trade for the chosen day.
  //
  // The totals row is taken from the handler's OWN `totals` rather than re-summed
  // here: aggregateManpowerDailySummary already computes it (and rounds the cost
  // once), and a second summation is how a footer starts disagreeing with the
  // column above it. `date` is not a column -- it describes the whole table, not
  // a cell, and it is already on the report header.
  "manpower-daily-summary": (p) => ({
    columns: [
      textCol("trade", "Trade"),
      numCol("present", "Present"),
      numCol("absent", "Absent"),
      numCol("halfDay", "Half day"),
      numCol("headcount", "Headcount"),
      moneyCol("cost", "Cost"),
    ],
    rows: p.rows.map((r) => ({
      trade: r.trade,
      present: r.present,
      absent: r.absent,
      halfDay: r.halfDay,
      headcount: r.headcount,
      cost: r.cost,
    })),
    totals: {
      present: p.totals.present,
      absent: p.totals.absent,
      halfDay: p.totals.halfDay,
      headcount: p.totals.headcount,
      cost: p.totals.cost,
    },
    note: "Counts only workers marked on this date. A worker with no attendance row is absent from the day, not marked absent.",
  }),

  // The project-scoped hours per designer. The org-wide and budget breakdowns
  // this report also computes are a different grain and would not be rows of
  // this table; the note says where they are.
  "designer-timesheet": (p) => ({
    columns: [textCol("userName", "Designer"), numCol("totalHours", "Hours")],
    rows: p.projectScoped.byUser.map((u) => ({ userName: u.userName, totalHours: u.totalHours })),
    totals: { totalHours: sumColumn(p.projectScoped.byUser, (u) => u.totalHours) },
    note: "Hours logged on this project, per designer. The budget-vs-actual and org-wide breakdowns are a different grain and are served by ?format=legacy.",
  }),

  // R67 E-32 follow-up: this read `p.byUser` and a "sent_back" status. The
  // handler's key is `byDesigner`, and the four real statuses are draft |
  // submitted | approved | REJECTED (pms_time_entries.approval_status) --
  // "sent back" is not a value this system stores, so the column was a name
  // for a number that could never arrive.
  "designer-approval-status": (p) => ({
    columns: [
      textCol("userName", "Designer"), numCol("draft", "Draft (h)"), numCol("submitted", "Submitted (h)"),
      numCol("approved", "Approved (h)"), numCol("rejected", "Rejected (h)"),
    ],
    rows: p.byDesigner.map((u) => ({
      userName: u.userName,
      draft: u.draft.hours, submitted: u.submitted.hours, approved: u.approved.hours, rejected: u.rejected.hours,
    })),
    totals: {
      draft: sumColumn(p.byDesigner, (u) => u.draft.hours),
      submitted: sumColumn(p.byDesigner, (u) => u.submitted.hours),
      approved: sumColumn(p.byDesigner, (u) => u.approved.hours),
      rejected: sumColumn(p.byDesigner, (u) => u.rejected.hours),
    },
  }),

  // R67 E-32 follow-up: `p.byUser` -> `p.byDesigner`, the handler's own key.
  "work-analysis": (p) => ({
    columns: [textCol("userName", "Person"), numCol("totalHours", "Hours"), numCol("taskCount", "Tasks worked")],
    rows: p.byDesigner.map((u) => ({ userName: u.userName, totalHours: u.totalHours, taskCount: u.byTask.length })),
    totals: {
      totalHours: sumColumn(p.byDesigner, (u) => u.totalHours),
      taskCount: sumColumn(p.byDesigner, (u) => u.byTask.length),
    },
  }),

  // R67 E-32 follow-up: the column is `metricName` on the real row -- a KPI
  // definition has no `name`.
  kpi: (p) => ({
    columns: [textCol("metricName", "KPI"), textCol("unit", "Unit"), numCol("entryCount", "Readings")],
    rows: p.definitions.map((d) => ({
      metricName: d.metricName,
      unit: d.unit ?? null,
      entryCount: p.entries.filter((e) => e.kpiDefinitionId === d.id).length,
    })),
  }),

  revenue: (p) => ({
    columns: [textCol("invoiceNumber", "Invoice"), dateCol("postingDate", "Posted"), textCol("status", "Status"), moneyCol("grandTotal", "Amount")],
    rows: p.invoices.map((i) => ({
      invoiceNumber: i.invoiceNumber, postingDate: i.postingDate, status: i.status, grandTotal: Number(i.grandTotal),
    })),
    totals: { grandTotal: p.total },
  }),

  expense: (p) => ({
    columns: [textCol("expenseHead", "Expense head"), moneyCol("total", "Amount")],
    rows: p.byHead.map((r) => ({ expenseHead: r.expenseHead, total: Number(r.total) })),
    totals: { total: p.total },
  }),

  // Percentages of different categories do not add up to anything, so there is
  // no total here on purpose.
  "category-progress": (p) => ({
    columns: [textCol("name", "Category"), pctCol("percentComplete", "% complete")],
    rows: p.categories.map((c) => ({ name: c.name, percentComplete: c.percentComplete })),
  }),

  "project-completion": (p) => ({
    columns: [textCol("name", "Category"), pctCol("percentComplete", "% complete")],
    rows: p.byCategory.map((c) => ({ name: c.name, percentComplete: c.percentComplete })),
    note: `Overall ${p.overallPercentComplete}% complete, averaged over the categories below.`,
  }),

  // R67 E-32 follow-up: this report has NO completion figure -- it totals BOQ
  // line amounts per category and nothing else (the completion percentage is
  // "category-progress", a different report, and the two are combined for the
  // charts by src/lib/category-distribution.ts in projexa). The "% complete"
  // column named a field that does not exist on the row, so it could only ever
  // have rendered an en dash. Money that belongs to no category is real BOQ
  // money and is stated rather than dropped, which is why the rows can sum to
  // less than the total.
  "category-boq-amounts": (p) => ({
    columns: [textCol("name", "Category"), moneyCol("totalAmount", "BOQ amount")],
    rows: p.categories.map((c) => ({ name: c.name, totalAmount: c.totalAmount })),
    totals: { totalAmount: p.totalAmount },
    note:
      p.uncategorizedAmount > 0
        ? `The total includes ${p.uncategorizedAmount} of BOQ value on lines with no category.`
        : undefined,
  }),

  "certified-payroll": (p) => ({
    columns: [
      textCol("workerName", "Worker"), textCol("trade", "Trade"), numCol("totalHours", "Hours"),
      moneyCol("ratePaid", "Rate paid"), moneyCol("prevailingHourlyRate", "Prevailing rate"),
      moneyCol("grossWages", "Gross wages"), textCol("complianceStatus", "Status"),
    ],
    rows: p.workers.map((w) => ({
      workerName: w.workerName, trade: w.trade, totalHours: w.totalHours,
      ratePaid: w.ratePaid, prevailingHourlyRate: w.prevailingHourlyRate,
      grossWages: w.grossWages, complianceStatus: w.complianceStatus,
    })),
    totals: { totalHours: p.totalHours, grossWages: p.totalGrossWages },
    note: p.dataGapNotes.join(" "),
  }),

  // One row: earned value is a single figure about one BOQ.
  "earned-value": (p) => ({
    columns: [moneyCol("contractValue", "Contract value"), moneyCol("earnedValue", "Earned value"), pctCol("percentByValue", "% by value")],
    rows: [{ contractValue: p.contractValue, earnedValue: p.earnedValue, percentByValue: p.percentByValue }],
  }),

  "budget-variance": (p) => ({
    columns: [
      textCol("code", "Code"), textCol("description", "Description"), textCol("category", "Category"),
      moneyCol("amount", "BOQ amount"), pctCol("budgetPercentage", "Budget %"), moneyCol("budget", "Budget"),
      textCol("vendorName", "Vendor"), moneyCol("vendorAmount", "Vendor amount"), moneyCol("variance", "Variance"),
    ],
    rows: p.lines.map((l) => ({
      code: l.code, description: l.description, category: l.category ?? UNCATEGORIZED_LABEL,
      // A derived (sub-task) budget is shown for detail and never counted, the
      // same rule E-26 put on the totals -- so its money cells stay real
      // numbers but the totals below come from the roots-only computation.
      amount: l.amount, budgetPercentage: l.budgetPercentage, budget: l.budget,
      vendorName: l.vendorName, vendorAmount: l.vendorAmount, variance: l.variance,
    })),
    totals: { budget: p.totalBudget, vendorAmount: p.totalVendorAmount, variance: p.totalVariance },
    note: p.note,
  }),
}

// ---------------------------------------------------------------------------
// R67 E-33 (R-265): the portfolio chart's own row shape
// ---------------------------------------------------------------------------
//
// Sumeet 5.png's first graph is a grouped bar PER PROJECT -- revenue, budget
// and progress side by side across the portfolio. Every figure it needs is
// already computed, once, inside getOrgDashboard's single transaction (E-21
// put them there so PROJEXA's launchpad could make one call instead of an
// N+1 fan-out). This turns those rows into the same {columns, rows} contract
// every other report now speaks, so the chart reads a report rather than a
// dashboard payload it has to reshape by hand.
//
// WHY IT IS NOT A NEW REGISTRY REPORT. Every entry in REPORT_REGISTRY is
// per-project and is dispatched by /reports/[reportName]?projectId=. This one
// is ACROSS projects and has no projectId at all, so it cannot be dispatched
// there -- and a static /reports/budget-vs-actual/ route would SHADOW that
// dynamic segment and silently break the per-project budget-vs-actual report
// that already exists under exactly that name. It lives at
// /reports/portfolio/budget-vs-actual instead, two segments deep, where
// nothing can collide.
//
// WHY earnedValue IS HERE ALONGSIDE progressPct. The chart draws three bars on
// ONE shared money axis, and a percentage cannot share an axis with money.
// Progress is therefore PLOTTED as earned value and PRINTED as the percentage,
// which is why both travel.

export type PortfolioProjectRow = {
  id: string
  name: string
  revenue: number
  /** BOQ-derived budget: root line amount x budget %. Falls back to the ERP cost-centre budget. */
  boqBudget: number | null
  budget: number | null
  spent: number
  earnedValue: number | null
  progressPercent: number | null
}

/**
 * R67 E-33: one row per project -- revenue, budget, actual and progress.
 *
 * `budget` is the BOQ-derived figure when the BOQ carries percentages and the
 * ERP cost-centre budget otherwise, matching the rule PROJEXA's own project-bar
 * chart already applies -- one rule, so the number on the chart and the number
 * in this table can never disagree. null (never 0) where neither exists: a
 * project with no budget set and a project budgeted at zero are different facts.
 */
export function buildBudgetVsActualByProject(projects: PortfolioProjectRow[], currency: string | null): ReportTable {
  const rows = projects.map((p) => {
    const budget = p.boqBudget !== null && p.boqBudget > 0 ? p.boqBudget : p.budget
    return {
      project: p.name,
      // Carried but NOT a column: the chart makes each row a link to that
      // project's dashboard, and it needs the id to build the href. It is a
      // link target, never a cell -- E-22's rule that a raw cuid must not
      // reach a reader is about what is RENDERED.
      projectId: p.id,
      revenue: p.revenue,
      budget,
      // Also carried and not a column: WHICH budget the row landed on. The
      // chart's caption has to say whether the reader is looking at a BOQ
      // figure or an ERP cost-centre one, and re-deriving that on the client
      // from a null check is how the caption comes to disagree with the bar.
      budgetSource: budget === null ? "none" : p.boqBudget !== null && p.boqBudget > 0 ? "boq" : "erp",
      actual: p.spent,
      earnedValue: p.earnedValue,
      progressPct: p.progressPercent,
    }
  })
  return {
    columns: [
      textCol("project", "Project"),
      moneyCol("revenue", "Revenue"),
      moneyCol("budget", "Budget"),
      moneyCol("actual", "Actual"),
      moneyCol("earnedValue", "Earned value"),
      pctCol("progressPct", "% logged"),
    ],
    rows,
    totals: {
      revenue: sumColumn(rows, (r) => r.revenue),
      budget: sumColumn(rows, (r) => r.budget),
      actual: sumColumn(rows, (r) => r.actual),
      earnedValue: sumColumn(rows, (r) => r.earnedValue),
    },
    currency,
    note: "Budget is the BOQ-derived figure (root line amount x budget %) where the BOQ carries percentages, and the ERP cost-centre budget otherwise.",
  }
}


/**
 * Every report that has a table builder. The map above is typed against
 * ReportName so this is always the whole registry -- exported so a test can
 * restate that promise at runtime, because "no report falls back to a JSON
 * dump" is the entire point of E-32 and deserves an assertion, not just a type.
 */
export const REPORT_TABLE_BUILDER_NAMES = Object.keys(REPORT_TABLE_BUILDERS) as ReportName[]

/**
 * R67 E-32 (R-265): a report's payload, as the table PROJEXA renders.
 *
 * `currency` is the ORG's base currency code, or null when the org has not set
 * one -- reported, never guessed, exactly as getBaseCurrency() reports it. A
 * screen with a null currency shows the numbers and says the currency is unset;
 * it must not invent AED.
 */
export function buildReportTable(reportName: ReportName, payload: unknown, currency: string | null): ReportTable {
  // The one cast in this file, and it is contained: the builders above are each
  // typed against their own handler's return, and REPORT_TABLE_BUILDERS is keyed
  // by the same union the caller's `reportName` comes from, so the pairing is
  // checked at every definition site. What TypeScript cannot do is correlate the
  // two at a single dynamic lookup.
  const build = REPORT_TABLE_BUILDERS[reportName] as (p: unknown) => BuiltTable
  return { ...build(payload), currency }
}
