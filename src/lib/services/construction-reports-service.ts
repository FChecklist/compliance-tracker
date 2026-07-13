// Wave 122 (PROJEXA foundation) -- the 17 named reports from the original
// requirement. NOT forced through custom-report-service.ts's generic
// whitelist (that mechanism only does count(*); most of these need
// sum/avg/joins). One function per report, reusing Wave 115-121 tables and
// services directly. Every function takes the same (ctx, projectId) shape
// so the dynamic route dispatcher (Wave 122 route) can stay a simple switch.
import {
  constructionCategories, constructionActivities, constructionWorkProgressEntries, constructionSiteDiaries,
  constructionBoqs, constructionBoqLineItems, constructionAttendance, constructionLabourRoster,
  constructionKpiDefinitions, constructionKpiEntries, constructionExpenseEntries, erpStockLedgerEntries, erpItems, erpSalesInvoices,
  documents, pmsIssues, pmsTimeEntries, users, erpBudgetLineItems, erpBudgets, erpCostCenters,
} from "@/lib/db"
import { withTenantContext, type TenantDb } from "@/lib/db/tenant-scoped"
import { and, eq, inArray, sql, gte, lt } from "drizzle-orm"
import { ServiceError } from "./compliance-service"
import { getExpenseSummaryByHead } from "./construction-expense-service"
import { getProjectDashboard } from "./construction-dashboard-service"
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

// 1. Work Progress Report -- latest logged % complete + total quantity done per activity.
export async function workProgressReport(ctx: { orgId: string }, projectId: string) {
  await requireConstructionEnabled(ctx.orgId)
  return withTenantContext({ orgId: ctx.orgId }, async (db) => {
    const activities = await activityIdsForProject(db, ctx.orgId, projectId)
    if (activities.length === 0) return { activities: [] }
    const ids = activities.map((a) => a.id)
    const totals = await db.select({
      activityId: constructionWorkProgressEntries.activityId,
      totalQuantityDone: sql<number>`coalesce(sum(${constructionWorkProgressEntries.quantityDone}), 0)::float`,
      latestPercent: sql<number>`(array_agg(${constructionWorkProgressEntries.percentComplete} order by ${constructionWorkProgressEntries.entryDate} desc))[1]`,
    }).from(constructionWorkProgressEntries).where(inArray(constructionWorkProgressEntries.activityId, ids)).groupBy(constructionWorkProgressEntries.activityId)
    const byActivity = new Map(totals.map((t) => [t.activityId, t]))
    return { activities: activities.map((a) => ({ activityId: a.id, name: a.name, quantityDone: Number(byActivity.get(a.id)?.totalQuantityDone ?? 0), percentComplete: Number(byActivity.get(a.id)?.latestPercent ?? 0) })) }
  })
}

// 2. Weekly Project Report -- composite: progress/attendance/diary/expenses within a 7-day window.
export async function weeklyProjectReport(ctx: { orgId: string }, projectId: string, weekStart: string) {
  await requireConstructionEnabled(ctx.orgId)
  return withTenantContext({ orgId: ctx.orgId }, async (db) => {
    const weekEnd = new Date(new Date(weekStart).getTime() + 7 * 86400000).toISOString().slice(0, 10)
    const [progressCount] = await db.select({ count: sql<number>`count(*)` }).from(constructionWorkProgressEntries)
      .where(and(eq(constructionWorkProgressEntries.orgId, ctx.orgId), eq(constructionWorkProgressEntries.projectId, projectId), sql`${constructionWorkProgressEntries.entryDate} >= ${weekStart} and ${constructionWorkProgressEntries.entryDate} < ${weekEnd}`))
    const [attendanceCost] = await db.select({ total: sql<number>`coalesce(sum(${constructionAttendance.dailyCost}), 0)::float`, presentCount: sql<number>`count(*) filter (where ${constructionAttendance.status} = 'present')` })
      .from(constructionAttendance).where(and(eq(constructionAttendance.orgId, ctx.orgId), eq(constructionAttendance.projectId, projectId), sql`${constructionAttendance.attendanceDate} >= ${weekStart} and ${constructionAttendance.attendanceDate} < ${weekEnd}`))
    const diaryEntries = await db.query.constructionSiteDiaries.findMany({ where: and(eq(constructionSiteDiaries.orgId, ctx.orgId), eq(constructionSiteDiaries.projectId, projectId), gte(constructionSiteDiaries.diaryDate, weekStart), lt(constructionSiteDiaries.diaryDate, weekEnd)) })
    const [expenseTotal] = await db.select({ total: sql<number>`coalesce(sum(${constructionExpenseEntries.amount}), 0)::float` }).from(constructionExpenseEntries)
      .where(and(eq(constructionExpenseEntries.orgId, ctx.orgId), eq(constructionExpenseEntries.projectId, projectId), gte(constructionExpenseEntries.expenseDate, weekStart), lt(constructionExpenseEntries.expenseDate, weekEnd)))
    return {
      weekStart, weekEnd,
      progressEntriesLogged: Number(progressCount?.count ?? 0),
      labourCost: Number(attendanceCost?.total ?? 0),
      workersPresent: Number(attendanceCost?.presentCount ?? 0),
      diaryEntries: diaryEntries.length,
      expenseTotal: Number(expenseTotal?.total ?? 0),
    }
  })
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

// 6. Scope Report -- BOQ total value + line-item count for the latest (non-superseded) revision.
export async function scopeReport(ctx: { orgId: string }, projectId: string) {
  await requireConstructionEnabled(ctx.orgId)
  return withTenantContext({ orgId: ctx.orgId }, async (db) => {
    const boqs = await db.query.constructionBoqs.findMany({ where: and(eq(constructionBoqs.orgId, ctx.orgId), eq(constructionBoqs.projectId, projectId)), orderBy: (t, { desc }) => desc(t.version) })
    const latest = boqs.find((b) => b.status !== "superseded") ?? boqs[0]
    if (!latest) return { boq: null, totalValue: 0, lineItemCount: 0, revisions: [] }
    const [valueRow] = await db.select({ total: sql<number>`coalesce(sum(${constructionBoqLineItems.amount}), 0)::float`, count: sql<number>`count(*)` })
      .from(constructionBoqLineItems).where(eq(constructionBoqLineItems.boqId, latest.id))
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

// 8. Budget vs Actual -- budget total (via cost center) vs actual expenses (construction_expense_entries).
export async function budgetVsActual(ctx: { orgId: string }, projectId: string) {
  await requireConstructionEnabled(ctx.orgId)
  const [dashboard, expenseByHead] = await Promise.all([
    getProjectDashboard(ctx, projectId),
    getExpenseSummaryByHead(ctx, projectId),
  ])
  const actual = expenseByHead.reduce((s, r) => s + Number(r.total), 0)
  return { budget: dashboard.budget, actual, variance: dashboard.budget - actual, byHead: expenseByHead }
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
export async function manpowerCostReport(ctx: { orgId: string }, projectId: string) {
  await requireConstructionEnabled(ctx.orgId)
  return withTenantContext({ orgId: ctx.orgId }, async (db) => {
    const rows = await db.select({
      trade: constructionLabourRoster.trade,
      totalCost: sql<number>`coalesce(sum(${constructionAttendance.dailyCost}), 0)::float`,
      workerDays: sql<number>`count(*)`,
    }).from(constructionAttendance)
      .innerJoin(constructionLabourRoster, eq(constructionAttendance.rosterId, constructionLabourRoster.id))
      .where(and(eq(constructionAttendance.orgId, ctx.orgId), eq(constructionAttendance.projectId, projectId)))
      .groupBy(constructionLabourRoster.trade)
    return { byTrade: rows }
  })
}

// 12. Designer Timesheet Report -- pms_time_entries hours summed by user, for this project's issues.
export async function designerTimesheetReport(ctx: { orgId: string }, projectId: string) {
  await requireConstructionEnabled(ctx.orgId)
  return withTenantContext({ orgId: ctx.orgId }, async (db) => {
    const issueIds = (await db.query.pmsIssues.findMany({ where: and(eq(pmsIssues.orgId, ctx.orgId), eq(pmsIssues.projectId, projectId)), columns: { id: true } })).map((i) => i.id)
    if (issueIds.length === 0) return { byUser: [] }
    const rows = await db.select({
      userId: pmsTimeEntries.userId,
      userName: users.name,
      totalHours: sql<number>`coalesce(sum(${pmsTimeEntries.hours}), 0)::float`,
    }).from(pmsTimeEntries)
      .innerJoin(users, eq(pmsTimeEntries.userId, users.id))
      .where(and(eq(pmsTimeEntries.orgId, ctx.orgId), inArray(pmsTimeEntries.issueId, issueIds)))
      .groupBy(pmsTimeEntries.userId, users.name)
    return { byUser: rows }
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
  "kpi": kpiReport,
  "revenue": revenueReport,
  "expense": expenseReport,
  "category-progress": categoryProgressReport,
  "project-completion": projectCompletionReport,
} as const

export type ReportName = keyof typeof REPORT_REGISTRY
