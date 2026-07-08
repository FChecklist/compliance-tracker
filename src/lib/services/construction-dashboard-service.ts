// Wave 121 (PROJEXA foundation) -- Project Dashboard (Budget/Revenue/
// Expenses/Progress/Delay/Photos/Tasks) and the Company -> Project
// drill-down. Query-time aggregation, modeled directly on
// kpi-hub-service.ts's per-category `db.select().groupBy()` pattern --
// no denormalized summary columns on `projects`, matching this codebase's
// existing convention (erp-financial-report-service.ts, erp-budget-
// service.ts's getBudgetVariance).
//
// Note: `projects` has no `departmentId` column (confirmed against
// schema.ts) -- the "Department" level of the Company->Department->Project
// hierarchy is approximated via the project lead's department
// (`projects.leadUserId` -> `users.departmentId`), not a direct FK. This is
// documented here rather than silently treated as exact.
import { projects, erpSalesInvoices, erpBudgetLineItems, erpBudgets, erpCostCenters, constructionExpenseEntries, constructionActivities, constructionWorkProgressEntries, pmsIssues, documents, users } from "@/lib/db"
import { withTenantContext } from "@/lib/db/tenant-scoped"
import { and, eq, inArray, sql } from "drizzle-orm"
import { ServiceError } from "./compliance-service"
export { ServiceError }

export type ProjectDashboard = {
  projectId: string
  projectName: string
  budget: number
  revenue: number
  expenses: number
  progressPercent: number // average of each activity's latest logged percentComplete
  delayedTaskCount: number // open pms_issues past dueDate (approximation -- doesn't check status "completed" group, see comment above)
  photoCount: number
  taskCount: number
}

export async function getProjectDashboard(ctx: { orgId: string }, projectId: string): Promise<ProjectDashboard> {
  return withTenantContext({ orgId: ctx.orgId }, async (db) => {
    const project = await db.query.projects.findFirst({ where: and(eq(projects.id, projectId), eq(projects.orgId, ctx.orgId)) })
    if (!project) throw new ServiceError("Project not found", 404)

    const [budgetRow] = await db.select({ total: sql<number>`coalesce(sum(${erpBudgetLineItems.annualAmount}), 0)::float` })
      .from(erpBudgetLineItems)
      .innerJoin(erpBudgets, eq(erpBudgetLineItems.budgetId, erpBudgets.id))
      .innerJoin(erpCostCenters, eq(erpBudgets.costCenterId, erpCostCenters.id))
      .where(and(eq(erpCostCenters.projectId, projectId), eq(erpBudgets.orgId, ctx.orgId)))

    const [revenueRow] = await db.select({ total: sql<number>`coalesce(sum(${erpSalesInvoices.grandTotal}), 0)::float` })
      .from(erpSalesInvoices)
      .where(and(eq(erpSalesInvoices.orgId, ctx.orgId), eq(erpSalesInvoices.projectId, projectId), sql`${erpSalesInvoices.status} != 'cancelled'`))

    const [expenseRow] = await db.select({ total: sql<number>`coalesce(sum(${constructionExpenseEntries.amount}), 0)::float` })
      .from(constructionExpenseEntries)
      .where(and(eq(constructionExpenseEntries.orgId, ctx.orgId), eq(constructionExpenseEntries.projectId, projectId)))

    const activityIds = (await db.query.constructionActivities.findMany({
      where: and(eq(constructionActivities.orgId, ctx.orgId), eq(constructionActivities.projectId, projectId)),
      columns: { id: true },
    })).map((a) => a.id)

    let progressPercent = 0
    if (activityIds.length > 0) {
      // Latest logged entry per activity, then averaged -- a daily-log table
      // shouldn't have every historical entry weighted equally.
      const rows = (await db.execute(sql`
        SELECT DISTINCT ON (activity_id) percent_complete
        FROM compliance.construction_work_progress_entries
        WHERE activity_id = ANY(${activityIds})
        ORDER BY activity_id, entry_date DESC
      `)) as { percent_complete: number }[]
      if (rows.length > 0) progressPercent = rows.reduce((sum, r) => sum + Number(r.percent_complete), 0) / rows.length
    }

    const today = new Date().toISOString().slice(0, 10)
    const [taskStats] = await db.select({
      total: sql<number>`count(*)`,
      delayed: sql<number>`count(*) filter (where ${pmsIssues.dueDate} < ${today})`,
    }).from(pmsIssues).where(and(eq(pmsIssues.orgId, ctx.orgId), eq(pmsIssues.projectId, projectId), eq(pmsIssues.isArchived, false)))

    const [photoRow] = await db.select({ total: sql<number>`count(*)` })
      .from(documents)
      .where(and(eq(documents.orgId, ctx.orgId), eq(documents.category, "site_photo"), eq(documents.linkedEntityType, "project"), eq(documents.linkedEntityId, projectId)))

    return {
      projectId: project.id,
      projectName: project.name,
      budget: Number(budgetRow?.total ?? 0),
      revenue: Number(revenueRow?.total ?? 0),
      expenses: Number(expenseRow?.total ?? 0),
      progressPercent: Math.round(progressPercent),
      delayedTaskCount: Number(taskStats?.delayed ?? 0),
      photoCount: Number(photoRow?.total ?? 0),
      taskCount: Number(taskStats?.total ?? 0),
    }
  })
}

export type OrgDashboardFilters = { departmentId?: string }

export type OrgDashboardSummary = {
  totalProjects: number
  totalBudget: number
  totalRevenue: number
  totalExpenses: number
  projects: { id: string; name: string; revenue: number; expenses: number; taskCount: number; delayedTaskCount: number }[]
}

/** Company -> [Department] -> Project drill-down. departmentId filters by the project LEAD's department (projects has no direct departmentId column -- see file header). */
export async function getOrgDashboard(ctx: { orgId: string }, filters: OrgDashboardFilters = {}): Promise<OrgDashboardSummary> {
  return withTenantContext({ orgId: ctx.orgId }, async (db) => {
    let projectIds: string[] | undefined
    if (filters.departmentId) {
      const leads = await db.query.users.findMany({ where: eq(users.departmentId, filters.departmentId), columns: { id: true } })
      const leadIds = leads.map((u) => u.id)
      const scoped = leadIds.length > 0
        ? await db.query.projects.findMany({ where: and(eq(projects.orgId, ctx.orgId), inArray(projects.leadUserId, leadIds)), columns: { id: true } })
        : []
      projectIds = scoped.map((p) => p.id)
      if (projectIds.length === 0) return { totalProjects: 0, totalBudget: 0, totalRevenue: 0, totalExpenses: 0, projects: [] }
    }

    const projectConditions = [eq(projects.orgId, ctx.orgId), eq(projects.isActive, true)]
    if (projectIds) projectConditions.push(inArray(projects.id, projectIds))
    const projectRows = await db.query.projects.findMany({ where: and(...projectConditions), columns: { id: true, name: true } })
    const ids = projectRows.map((p) => p.id)
    if (ids.length === 0) return { totalProjects: 0, totalBudget: 0, totalRevenue: 0, totalExpenses: 0, projects: [] }

    const revenueByProject = await db.select({ projectId: erpSalesInvoices.projectId, total: sql<number>`coalesce(sum(${erpSalesInvoices.grandTotal}), 0)::float` })
      .from(erpSalesInvoices)
      .where(and(eq(erpSalesInvoices.orgId, ctx.orgId), inArray(erpSalesInvoices.projectId, ids), sql`${erpSalesInvoices.status} != 'cancelled'`))
      .groupBy(erpSalesInvoices.projectId)

    const expensesByProject = await db.select({ projectId: constructionExpenseEntries.projectId, total: sql<number>`coalesce(sum(${constructionExpenseEntries.amount}), 0)::float` })
      .from(constructionExpenseEntries)
      .where(and(eq(constructionExpenseEntries.orgId, ctx.orgId), inArray(constructionExpenseEntries.projectId, ids)))
      .groupBy(constructionExpenseEntries.projectId)

    const today = new Date().toISOString().slice(0, 10)
    const tasksByProject = await db.select({
      projectId: pmsIssues.projectId,
      total: sql<number>`count(*)`,
      delayed: sql<number>`count(*) filter (where ${pmsIssues.dueDate} < ${today})`,
    }).from(pmsIssues).where(and(eq(pmsIssues.orgId, ctx.orgId), inArray(pmsIssues.projectId, ids), eq(pmsIssues.isArchived, false)))
      .groupBy(pmsIssues.projectId)

    const [budgetTotal] = await db.select({ total: sql<number>`coalesce(sum(${erpBudgetLineItems.annualAmount}), 0)::float` })
      .from(erpBudgetLineItems)
      .innerJoin(erpBudgets, eq(erpBudgetLineItems.budgetId, erpBudgets.id))
      .innerJoin(erpCostCenters, eq(erpBudgets.costCenterId, erpCostCenters.id))
      .where(and(eq(erpBudgets.orgId, ctx.orgId), inArray(erpCostCenters.projectId, ids)))

    const revenueMap = new Map(revenueByProject.map((r) => [r.projectId, Number(r.total)]))
    const expenseMap = new Map(expensesByProject.map((r) => [r.projectId, Number(r.total)]))
    const taskMap = new Map(tasksByProject.map((r) => [r.projectId, { total: Number(r.total), delayed: Number(r.delayed) }]))

    const projectSummaries = projectRows.map((p) => ({
      id: p.id, name: p.name,
      revenue: revenueMap.get(p.id) ?? 0,
      expenses: expenseMap.get(p.id) ?? 0,
      taskCount: taskMap.get(p.id)?.total ?? 0,
      delayedTaskCount: taskMap.get(p.id)?.delayed ?? 0,
    }))

    return {
      totalProjects: projectRows.length,
      totalBudget: Number(budgetTotal?.total ?? 0),
      totalRevenue: projectSummaries.reduce((s, p) => s + p.revenue, 0),
      totalExpenses: projectSummaries.reduce((s, p) => s + p.expenses, 0),
      projects: projectSummaries,
    }
  })
}
