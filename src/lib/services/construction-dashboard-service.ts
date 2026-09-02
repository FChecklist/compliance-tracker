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
import { projects, products, erpSalesInvoices, erpBudgetLineItems, erpBudgets, erpCostCenters, constructionExpenseEntries, constructionActivities, constructionWorkProgressEntries, pmsIssues, documents, users, erpPurchaseOrders, constructionBoqs, constructionBoqLineItems } from "@/lib/db"
import { withTenantContext } from "@/lib/db/tenant-scoped"
import { and, eq, inArray, sql, isNull } from "drizzle-orm"
import { ServiceError } from "./compliance-service"
// R39/R-51 (D-3): reuses the SAME earnedValueReport construction-reports-
// service.ts exposes as the "earned-value" named report -- NOT a second
// summation path. This is a real circular import (construction-reports-
// service.ts also imports getProjectDashboard FROM this file) -- safe here
// because both references are only ever called from inside an async
// function body, never at module-evaluation top level, so ESM's live
// bindings resolve correctly by call time either direction.
//
// R43_MGR_01 (2026-08-27): computeEarnedValue and EvLineItem are the pure,
// no-DB-call half of earnedValueReport() -- getOrgDashboard batches its own
// BOQ/progress reads and calls this directly (see below) instead of calling
// earnedValueReport() once per project. Same circular-import safety as
// earnedValueReport above (call-time only, never module-evaluation time).
import { computeEarnedValue, type EvLineItem } from "./construction-reports-service"
import { isConstructionEnabledForOrg } from "./construction-enablement-service"
export { ServiceError }

// Lists the org's active Products (business lines a new Project nests
// under, e.g. "Villa Projects", "Commercial & Office Fit-outs") -- feeds
// the Product picker in PROJEXA's Create Project dialog. Read-only, no
// construction-specific filter (a Project's productId FK doesn't
// distinguish construction vs any other domain -- see createProject below).
export async function listActiveProducts(ctx: { orgId: string }) {
  return withTenantContext({ orgId: ctx.orgId }, (db) =>
    db.query.products.findMany({
      where: and(eq(products.orgId, ctx.orgId), eq(products.isActive, true)),
      columns: { id: true, name: true },
      orderBy: (t, { asc }) => asc(t.name),
    })
  )
}

export type ProjectInput = { productId: string; name: string; description?: string; clientId?: string; startDate?: string; targetDate?: string }

// Closes the one real gap found in a 2026-07-18 production-readiness pass:
// every other PROJEXA entity (RFIs, submittals, punch list, ...) has a real
// create path, but Projects itself -- the entity everything else nests
// under -- had none. This is what "create new project" in VeriChat's
// Discuss mode should have actually triggered (Discuss is a free-form LLM
// endpoint with no dispatch capability by design -- see discuss/route.ts --
// so the real fix is giving the product a genuine Create Project form, the
// same pattern every other module already follows, not making Discuss
// pretend to run actions it can't).
//
// ctx.userId is the caller's real user id when authenticated via session,
// but PROJEXA's own server calls VERIDIAN via a per-org API key -- in that
// path ctx.userId is the *key's* id (api_keys.id), not a row in `users`.
// Unlike constructionRfis.raisedById (no FK), projects.leadUserId has a
// real FK to users.id, so blindly writing ctx.userId here 500s every
// API-key-authenticated create (caught live while verifying this endpoint,
// not by typecheck/lint). isRealUser lets the caller say whether ctx.userId
// actually resolves to a `users` row.
export async function createProject(ctx: { orgId: string; userId: string; isRealUser?: boolean }, input: ProjectInput) {
  if (!input.productId?.trim()) throw new ServiceError("productId is required", 400)
  if (!input.name?.trim()) throw new ServiceError("name is required", 400)

  return withTenantContext({ orgId: ctx.orgId, userId: ctx.userId }, async (db) => {
    const product = await db.query.products.findFirst({ where: and(eq(products.id, input.productId), eq(products.orgId, ctx.orgId)) })
    if (!product) throw new ServiceError("Product not found for this organisation", 404)

    const [row] = await db.insert(projects).values({
      orgId: ctx.orgId, productId: input.productId, name: input.name.trim(),
      description: input.description?.trim() || null,
      clientId: input.clientId || null,
      startDate: input.startDate || null,
      targetDate: input.targetDate || null,
      leadUserId: ctx.isRealUser ? ctx.userId : null,
    }).returning()
    return row
  })
}

// Point 121: sets (or clears, with null) the user-entered project value.
// Wins over the PO-derived fallback at read time -- see getProjectDashboard.
export async function updateProjectValue(ctx: { orgId: string }, projectId: string, projectValue: number | null) {
  return withTenantContext({ orgId: ctx.orgId }, async (db) => {
    const project = await db.query.projects.findFirst({ where: and(eq(projects.id, projectId), eq(projects.orgId, ctx.orgId)) })
    if (!project) throw new ServiceError("Project not found", 404)
    const [row] = await db.update(projects)
      .set({ projectValue: projectValue !== null ? String(projectValue) : null, updatedAt: new Date() })
      .where(eq(projects.id, projectId))
      .returning()
    return row
  })
}

// ─── R67 D-62: ONE project-money model ───────────────────────────────────────
//
// The defect (audit R-202): the same project told three different money stories
// one click apart. The home dashboard showed getOrgDashboard's per-project
// `value` (the active BOQ's ROOT line-item total). /dashboard/project showed
// getProjectDashboard's `projectValue` (the user-entered figure, falling back to
// the sum of linked purchase orders) NEXT TO its `contractValue` (the earned-
// value contract total). The Project Status report showed a third arrangement of
// the same numbers. None of them was wrong on its own; nothing named which
// question each answered, so they read as three answers to one question.
//
// The fix is not a new number. It is naming the three facts once, here, and
// making every screen read this one helper:
//
//   contractValue  -- what the BOQ says this job is worth (root lines only, the
//                     same D-3/B-3 no-double-counting rule computeEarnedValue
//                     uses). null when the project has no active BOQ.
//   projectValue   -- the COMMERCIAL value: the figure a human entered, else the
//                     sum of the purchase orders raised against the project.
//                     null when neither exists, NEVER 0 -- "nobody has set a
//                     project value" and "this project is worth nothing" are
//                     different facts and only one of them is ever true here.
//   earnedValue    -- how much of the contract has actually been earned.
//
// projectValue deliberately does NOT fall back to the BOQ. That is Rajat's
// standing ruling, recorded on the projects.projectValue column itself in
// schema.ts: the commercial value of a job is a PO/user-entered fact, not a
// restatement of its scope. Falling back would silently make contractValue and
// projectValue the same number for every project that has a BOQ and no PO --
// which is exactly the "three stories" confusion in a new disguise.
//
// projectValueSource is returned so a screen can SAY which of the two sources it
// is showing, rather than presenting a derived figure as if it had been typed.
export type ProjectValueSource = "entered" | "purchase_orders" | null

export type ProjectMoney = {
  contractValue: number | null
  projectValue: number | null
  projectValueSource: ProjectValueSource
  earnedValue: number | null
}

/**
 * Pure: every caller has already read these four inputs on its own already-open
 * transaction, so this adds no query of its own and can be unit-tested directly.
 * A 0 that was really read stays 0; only a genuinely absent figure is null.
 */
export function resolveProjectMoney(input: {
  /** projects.projectValue, already Number()'d, or null when the column is null. */
  enteredProjectValue: number | null
  /** SUM(erp_purchase_orders.grand_total) for this project, or null when there are none. */
  purchaseOrderTotal: number | null
  /** The active BOQ's root-line total, or null when the project has no active BOQ. */
  boqContractValue: number | null
  /** computeEarnedValue()'s earnedValue for the active BOQ, or null. */
  earnedValue: number | null
}): ProjectMoney {
  const projectValue =
    input.enteredProjectValue !== null
      ? input.enteredProjectValue
      : input.purchaseOrderTotal !== null
        ? input.purchaseOrderTotal
        : null
  const projectValueSource: ProjectValueSource =
    input.enteredProjectValue !== null ? "entered" : input.purchaseOrderTotal !== null ? "purchase_orders" : null
  return {
    contractValue: input.boqContractValue,
    projectValue,
    projectValueSource,
    earnedValue: input.earnedValue,
  }
}

export type ProjectDashboard = {
  projectId: string
  projectName: string
  // R67 D-02 (audit R-004/R-009): null (never 0) when this project's scope has
  // NO erp_budget_line_items rows at all. A budget of zero and "nobody has set
  // a budget" are different facts, and the dashboards that read this were
  // rendering the second as "AED 0" -- a figure a user reasonably reads as a
  // real, approved, zero budget, and which made every "Budget vs Actual" tile
  // claim the project was over budget the moment a single expense existed.
  // Same null-not-zero convention projectValue/earnedValue/contractValue below
  // already use.
  budget: number | null
  revenue: number
  expenses: number
  progressPercent: number // average of each activity's latest logged percentComplete
  delayedTaskCount: number // open pms_issues past dueDate (approximation -- doesn't check status "completed" group, see comment above)
  photoCount: number
  taskCount: number
  // Point 121: COALESCE(user-entered projects.projectValue, SUM of linked
  // erp_purchase_orders.grandTotal). null (never 0) when NEITHER source
  // exists -- a zero project value on a dashboard reads as a real figure.
  // Deliberately NOT derived from the BOQ (Rajat's ruling, see schema.ts).
  projectValue: number | null
  /** R67 D-62: which of the two sources projectValue came from, so a screen can say so. */
  projectValueSource: ProjectValueSource
  // R42 seq24: same D-3 earnedValueReport() getOrgDashboard already
  // exposes -- null (not 0) when construction isn't enabled or no BOQ
  // exists yet. contractValue is parent-BOQ-lines-only (TC-11).
  earnedValue: number | null
  percentByValue: number | null
  contractValue: number | null
}

export async function getProjectDashboard(ctx: { orgId: string }, projectId: string): Promise<ProjectDashboard> {
  // R66 audit: the enablement check is itself a withTenantContext transaction
  // (product-branch-service.ts isBranchEnabledForOrg) -- run it BEFORE opening
  // this one so no request ever holds two pooled connections at once.
  const constructionEnabled = await isConstructionEnabledForOrg(ctx.orgId).catch(() => false)
  return withTenantContext({ orgId: ctx.orgId }, async (db) => {
    const project = await db.query.projects.findFirst({ where: and(eq(projects.id, projectId), eq(projects.orgId, ctx.orgId)) })
    if (!project) throw new ServiceError("Project not found", 404)

    // R67 D-02: the row count comes back alongside the sum so "no budget rows"
    // can be told apart from "budget rows that sum to zero" -- count() over the
    // joined column is 0 exactly when nothing matched.
    const [budgetRow] = await db.select({
      total: sql<number>`coalesce(sum(${erpBudgetLineItems.annualAmount}), 0)::float`,
      lines: sql<number>`count(${erpBudgetLineItems.id})::int`,
    })
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
      //
      // Bug fix (verified live in production 2026-07-08): passing a plain JS
      // array as a single sql`` template parameter does NOT serialize it as
      // a Postgres array -- postgres.js binds it as a scalar, and
      // `= ANY($1)` then fails with "malformed array literal" trying to
      // parse the first element's string value as array syntax. sql.join()
      // building a real ARRAY[...] literal (each element still its own
      // bound parameter, so no injection risk) is the correct fix.
      const idsSql = sql.join(activityIds.map((id) => sql`${id}`), sql`, `)
      const rows = (await db.execute(sql`
        SELECT DISTINCT ON (activity_id) percent_complete
        FROM compliance.construction_work_progress_entries
        WHERE activity_id = ANY(ARRAY[${idsSql}])
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

    // Point 121: user-entered value WINS when set -- a human overriding a
    // derived figure is always deliberate. Falls back to the SUM of linked
    // POs' grand_total. null (never 0) when neither exists.
    //
    // R67 D-62: the RULE now lives in resolveProjectMoney() below and is shared
    // with getOrgDashboard; this block only READS the two sources. The PO sum is
    // read unconditionally rather than only when the entered value is absent, so
    // the source this function reports is a fact about the data and not about
    // which branch happened to run.
    const enteredProjectValue = project.projectValue !== null ? Number(project.projectValue) : null
    const [poRow] = await db.select({ total: sql<number | null>`sum(${erpPurchaseOrders.grandTotal})` })
      .from(erpPurchaseOrders)
      .where(and(eq(erpPurchaseOrders.orgId, ctx.orgId), eq(erpPurchaseOrders.projectId, projectId)))
    const purchaseOrderTotal = poRow?.total !== null && poRow?.total !== undefined ? Number(poRow.total) : null

    // R42 seq24 (M28 DASHBOARD.PROJECT, D-3): the SAME earnedValueReport()
    // getOrgDashboard already calls -- ONE summation path, never a second,
    // so the project dashboard and the org dashboard/WPR report can never
    // disagree. contractValue is parent-lines-only by that function's own
    // contract (v5 D-3) -- this is what TC-11 checks (5,000 not 10,000).
    // R66 audit (2026-09-02, LOCAL DEV PATCH that validates the recommended
    // fix): earnedValueReport() opens TWO nested transactions
    // (requireConstructionEnabled() + its own withTenantContext) while THIS
    // transaction already holds one of tenant-scoped.ts's 5 pooled
    // connections -- the same self-deadlock R43_MGR_01 removed from
    // getOrgDashboard on 2026-08-27, still live here. Reproduced live: all 5
    // app_runtime sessions "idle in transaction" for 25 minutes, parked on the
    // PO-sum query above. Same batched pattern as getOrgDashboard: read the
    // active BOQ's items + progress on the already-open `db` and run the pure
    // computeEarnedValue() in memory -- zero extra pool connections.
    let earnedValue: number | null = null
    let percentByValue: number | null = null
    let contractValue: number | null = null
    try {
      if (constructionEnabled) {
        const activeBoq = await db.query.constructionBoqs.findFirst({
          where: and(eq(constructionBoqs.orgId, ctx.orgId), eq(constructionBoqs.projectId, projectId), sql`${constructionBoqs.status} != 'superseded'`),
          orderBy: (t, { desc }) => [desc(t.version), desc(t.createdAt)],
          columns: { id: true },
        })
        if (activeBoq) {
          const items = await db.query.constructionBoqLineItems.findMany({
            where: eq(constructionBoqLineItems.boqId, activeBoq.id),
            columns: { id: true, boqId: true, parentLineItemId: true, rate: true, amount: true, breakdownPercentage: true },
          })
          let qtyByItem = new Map<string, number>()
          let latestPercentByItem = new Map<string, number>()
          if (items.length > 0) {
            const evIdsSql = sql.join(items.map((i) => sql`${i.id}`), sql`, `)
            const qtyRows = (await db.execute(sql`
              SELECT boq_line_item_id, coalesce(sum(quantity_done), 0)::float AS total_qty
              FROM compliance.construction_work_progress_entries
              WHERE boq_line_item_id = ANY(ARRAY[${evIdsSql}]) AND entry_basis = 'DELTA'
              GROUP BY boq_line_item_id
            `)) as { boq_line_item_id: string; total_qty: number }[]
            qtyByItem = new Map(qtyRows.map((r) => [r.boq_line_item_id, Number(r.total_qty)]))
            const percentRows = (await db.execute(sql`
              SELECT DISTINCT ON (boq_line_item_id) boq_line_item_id, percent_complete
              FROM compliance.construction_work_progress_entries
              WHERE boq_line_item_id = ANY(ARRAY[${evIdsSql}])
              ORDER BY boq_line_item_id, entry_date DESC
            `)) as { boq_line_item_id: string; percent_complete: number }[]
            latestPercentByItem = new Map(percentRows.map((r) => [r.boq_line_item_id, Number(r.percent_complete)]))
          }
          const ev = computeEarnedValue(items, qtyByItem, latestPercentByItem)
          if (ev.contractValue > 0) {
            earnedValue = ev.earnedValue
            percentByValue = ev.percentByValue
            contractValue = ev.contractValue
          }
        }
      }
    } catch {
      // null (not 0) is the correct "no data" signal, same convention
      // getOrgDashboard already uses for this exact case.
    }

    // R67 D-62: one helper, three named facts -- the same one the home
    // dashboard and (through projectStatusReport, which delegates here) the
    // Project Status report now read.
    const money = resolveProjectMoney({
      enteredProjectValue,
      purchaseOrderTotal,
      boqContractValue: contractValue,
      earnedValue,
    })

    return {
      projectId: project.id,
      projectName: project.name,
      budget: Number(budgetRow?.lines ?? 0) > 0 ? Number(budgetRow!.total) : null,
      revenue: Number(revenueRow?.total ?? 0),
      expenses: Number(expenseRow?.total ?? 0),
      progressPercent: Math.round(progressPercent),
      delayedTaskCount: Number(taskStats?.delayed ?? 0),
      photoCount: Number(photoRow?.total ?? 0),
      taskCount: Number(taskStats?.total ?? 0),
      projectValue: money.projectValue,
      projectValueSource: money.projectValueSource,
      earnedValue: money.earnedValue,
      percentByValue,
      contractValue: money.contractValue,
    }
  })
}

export type OrgDashboardFilters = { departmentId?: string }

export type OrgDashboardSummary = {
  totalProjects: number
  // R67 D-02: null (never 0) when NO erp_budget_line_items row exists for any
  // project in scope -- see ProjectDashboard.budget's comment above.
  totalBudget: number | null
  totalRevenue: number
  totalExpenses: number
  projects: {
    id: string
    name: string
    revenue: number
    expenses: number
    taskCount: number
    delayedTaskCount: number
    earnedValue: number | null
    percentByValue: number | null
    /**
     * R67 D-62: the SAME three facts /dashboard/project reports, from the same
     * resolveProjectMoney() helper -- so the home and the project dashboard can
     * no longer disagree about what a project is worth.
     */
    contractValue: number | null
    projectValue: number | null
    projectValueSource: ProjectValueSource
    /**
     * @deprecated R67 D-62 -- kept as an exact alias of contractValue so callers
     * written before the money model was named keep working. New readers use
     * contractValue, which says which of the three figures this is.
     */
    value: number | null
  }[]
}

/** Company -> [Department] -> Project drill-down. departmentId filters by the project LEAD's department (projects has no direct departmentId column -- see file header). */
export async function getOrgDashboard(ctx: { orgId: string }, filters: OrgDashboardFilters = {}): Promise<OrgDashboardSummary> {
  // R66 audit: same hoist as getProjectDashboard -- R43_MGR_01 removed the
  // per-project nesting but left this one nested transaction inside.
  const constructionEnabled = await isConstructionEnabledForOrg(ctx.orgId).catch(() => false)
  return withTenantContext({ orgId: ctx.orgId }, async (db) => {
    let projectIds: string[] | undefined
    if (filters.departmentId) {
      const leads = await db.query.users.findMany({ where: eq(users.departmentId, filters.departmentId), columns: { id: true } })
      const leadIds = leads.map((u) => u.id)
      const scoped = leadIds.length > 0
        ? await db.query.projects.findMany({ where: and(eq(projects.orgId, ctx.orgId), inArray(projects.leadUserId, leadIds)), columns: { id: true } })
        : []
      projectIds = scoped.map((p) => p.id)
      if (projectIds.length === 0) return { totalProjects: 0, totalBudget: null, totalRevenue: 0, totalExpenses: 0, projects: [] }
    }

    const projectConditions = [eq(projects.orgId, ctx.orgId), eq(projects.isActive, true)]
    if (projectIds) projectConditions.push(inArray(projects.id, projectIds))
    // R67 D-62: projectValue comes down with the row now -- the home used to
    // have no access to it at all, which is why it showed the BOQ total where
    // /dashboard/project showed the entered/PO figure.
    const projectRows = await db.query.projects.findMany({ where: and(...projectConditions), columns: { id: true, name: true, projectValue: true } })
    const ids = projectRows.map((p) => p.id)
    if (ids.length === 0) return { totalProjects: 0, totalBudget: null, totalRevenue: 0, totalExpenses: 0, projects: [] }

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

    // R67 D-02: count alongside the sum -- see getProjectDashboard's own note.
    const [budgetTotal] = await db.select({
      total: sql<number>`coalesce(sum(${erpBudgetLineItems.annualAmount}), 0)::float`,
      lines: sql<number>`count(${erpBudgetLineItems.id})::int`,
    })
      .from(erpBudgetLineItems)
      .innerJoin(erpBudgets, eq(erpBudgetLineItems.budgetId, erpBudgets.id))
      .innerJoin(erpCostCenters, eq(erpBudgets.costCenterId, erpCostCenters.id))
      .where(and(eq(erpBudgets.orgId, ctx.orgId), inArray(erpCostCenters.projectId, ids)))

    // R38 (R-50/TC-40): the dashboard's per-project "value" now derives from
    // the project's own active BOQ (root lines only, same rootBoqLineItemsOnly
    // convention as construction-reports-service.ts#scopeReport -- summing
    // children too would double-count, same D-3 rule) rather than a manually
    // typed figure. "Active" = latest non-superseded BOQ, version DESC then
    // createdAt DESC -- the identical tiebreaker construction-boq-service.ts
    // #listBoqs() and the R38-fixed scopeReport()/categoryBoqAmountsReport()
    // already use, kept consistent on purpose (three independent call sites,
    // one convention). DISTINCT ON is Postgres-native and does this in one
    // query rather than N -- there is no drizzle query-builder equivalent.
    const projectIdsSql = sql.join(ids.map((id) => sql`${id}`), sql`, `)
    const latestBoqPerProject = (await db.execute(sql`
      SELECT DISTINCT ON (project_id) project_id, id AS boq_id
      FROM compliance.construction_boqs
      WHERE org_id = ${ctx.orgId} AND project_id = ANY(ARRAY[${projectIdsSql}]) AND status != 'superseded'
      ORDER BY project_id, version DESC, created_at DESC
    `)) as { project_id: string; boq_id: string }[]
    const boqIdByProject = new Map(latestBoqPerProject.map((r) => [r.project_id, r.boq_id]))
    const activeBoqIds = Array.from(boqIdByProject.values())
    const valueByBoq = activeBoqIds.length > 0
      ? await db.select({ boqId: constructionBoqLineItems.boqId, total: sql<number>`coalesce(sum(${constructionBoqLineItems.amount}), 0)::float` })
          .from(constructionBoqLineItems)
          .where(and(inArray(constructionBoqLineItems.boqId, activeBoqIds), isNull(constructionBoqLineItems.parentLineItemId)))
          .groupBy(constructionBoqLineItems.boqId)
      : []
    const valueByBoqMap = new Map(valueByBoq.map((v) => [v.boqId, Number(v.total)]))

    // R67 D-62: the second half of projectValue, grouped in ONE query for every
    // project in scope rather than the per-project read getProjectDashboard
    // does -- same figure, no extra pool connections (this reuses the already
    // open outer transaction, per R43_MGR_01's rule for this function).
    const poByProject = await db.select({ projectId: erpPurchaseOrders.projectId, total: sql<number | null>`sum(${erpPurchaseOrders.grandTotal})` })
      .from(erpPurchaseOrders)
      .where(and(eq(erpPurchaseOrders.orgId, ctx.orgId), inArray(erpPurchaseOrders.projectId, ids)))
      .groupBy(erpPurchaseOrders.projectId)
    const poMap = new Map(
      poByProject
        .filter((r): r is { projectId: string; total: number | string } => r.projectId !== null && r.total !== null)
        .map((r) => [r.projectId, Number(r.total)])
    )

    const revenueMap = new Map(revenueByProject.map((r) => [r.projectId, Number(r.total)]))
    const expenseMap = new Map(expensesByProject.map((r) => [r.projectId, Number(r.total)]))
    const taskMap = new Map(tasksByProject.map((r) => [r.projectId, { total: Number(r.total), delayed: Number(r.delayed) }]))

    // R39/R-51: null (not 0) when construction isn't enabled for this org, or
    // the project has no BOQ yet -- both real "not applicable yet" states,
    // never silently 0.
    //
    // R43_MGR_01 (2026-08-27, shared root cause with F_030/F_033's
    // "/api/v1/projexa/dashboard" timeouts): this used to call
    // earnedValueReport(ctx, p.id) once per project via Promise.all. Each
    // call opens its OWN withTenantContext() transaction, AND its internal
    // requireConstructionEnabled() opens a SECOND one on top of that -- so
    // an org with N active projects fired up to 2N *concurrent* nested
    // transactions, each requesting its own connection from tenant-
    // scoped.ts's pool (`max: 5`, ONE pool shared by every request on the
    // warm instance, confirmed in that file), on top of the ONE connection
    // this function's own outer withTenantContext already holds for its
    // entire duration. Any org with more than a handful of active projects
    // needs more simultaneous connections than the pool has, so the excess
    // transactions queue behind whichever got there first -- a stall whose
    // odds scale with concurrent project count, not a uniform latency tax.
    // That shape matches what R52's own probe measured directly: 19/20
    // sub-second responses and 1 hang of 21s+, never a consistent slowdown
    // across all of them (ruled out cold start for the same reason). #1389
    // already named "per-project BOQ reads" as one of getOrgDashboard's
    // sequential-await hot spots and fixed the per-round-trip latency
    // (region pin, sin1 -> bom1) but explicitly scoped out "connection
    // handling" as a separate, still-open problem -- this is that fix.
    //
    // Batched instead: ONE enablement check (not N), and the BOQ line items
    // + progress data for EVERY active project's BOQ fetched in at most two
    // more queries, all reusing the SAME already-open outer transaction --
    // zero additional pool connections for the data reads, versus up to 2N
    // before. The pure, already-exported computeEarnedValue() (construction-
    // reports-service.ts) is reused UNCHANGED, run once per BOQ in memory --
    // so the earned-value arithmetic, and therefore every figure this
    // produces, is byte-for-byte identical to calling earnedValueReport()
    // per project; only the round-trip/connection count changes. Wrapped in
    // try/catch, same as the old per-project version, so an unexpected
    // failure here still degrades to "no earned-value data" rather than
    // failing the whole dashboard.
    //
    // One narrow, deliberate behavior change: this reuses boqIdByProject
    // above, which only ever holds a NON-superseded BOQ (its own query
    // filters status != 'superseded', same as the "value" field a few lines
    // up). earnedValueReport()'s own `boqs.find(...) ?? boqs[0]` fallback
    // would still compute against an all-superseded project's newest BOQ;
    // this now reports null for that project instead -- like "value"
    // already does for the same project today. Consistent within this
    // function (a project with no active BOQ now shows null for BOTH
    // fields, not value=null alongside a stale earnedValue), at the cost of
    // that one pre-existing inconsistency for the rare project with zero
    // non-superseded BOQs. getProjectDashboard (single project, still calls
    // earnedValueReport() directly, untouched here) keeps the old fallback.
    const evByProject = new Map<string, { earnedValue: number; percentByValue: number } | null>()
    try {
      if (activeBoqIds.length > 0 && constructionEnabled) {
        const allLineItems = await db.query.constructionBoqLineItems.findMany({
          where: inArray(constructionBoqLineItems.boqId, activeBoqIds),
          columns: { id: true, boqId: true, parentLineItemId: true, rate: true, amount: true, breakdownPercentage: true },
        })
        const itemIds = allLineItems.map((i) => i.id)

        let qtyByItem = new Map<string, number>()
        let latestPercentByItem = new Map<string, number>()
        if (itemIds.length > 0) {
          // Same ARRAY[...] construction as latestBoqPerProject above (and
          // earnedValueReport()'s own equivalent query) -- sql.join, not a
          // bound JS array; see that query's comment for why a plain array
          // parameter doesn't serialize as Postgres array syntax. Scoped to
          // every item across every project's active BOQ at once, instead
          // of one project's.
          const evItemIdsSql = sql.join(itemIds.map((id) => sql`${id}`), sql`, `)
          const qtyRows = (await db.execute(sql`
            SELECT boq_line_item_id, coalesce(sum(quantity_done), 0)::float AS total_qty
            FROM compliance.construction_work_progress_entries
            WHERE boq_line_item_id = ANY(ARRAY[${evItemIdsSql}]) AND entry_basis = 'DELTA'
            GROUP BY boq_line_item_id
          `)) as { boq_line_item_id: string; total_qty: number }[]
          qtyByItem = new Map(qtyRows.map((r) => [r.boq_line_item_id, Number(r.total_qty)]))

          const percentRows = (await db.execute(sql`
            SELECT DISTINCT ON (boq_line_item_id) boq_line_item_id, percent_complete
            FROM compliance.construction_work_progress_entries
            WHERE boq_line_item_id = ANY(ARRAY[${evItemIdsSql}])
            ORDER BY boq_line_item_id, entry_date DESC
          `)) as { boq_line_item_id: string; percent_complete: number }[]
          latestPercentByItem = new Map(percentRows.map((r) => [r.boq_line_item_id, Number(r.percent_complete)]))
        }

        const itemsByBoq = new Map<string, EvLineItem[]>()
        for (const item of allLineItems) {
          const list = itemsByBoq.get(item.boqId) ?? []
          list.push(item)
          itemsByBoq.set(item.boqId, list)
        }

        for (const [projectId, boqId] of boqIdByProject) {
          const ev = computeEarnedValue(itemsByBoq.get(boqId) ?? [], qtyByItem, latestPercentByItem)
          evByProject.set(projectId, ev.contractValue > 0 ? { earnedValue: ev.earnedValue, percentByValue: ev.percentByValue } : null)
        }
      }
    } catch {
      // Same fail-open contract the old per-project try/catch had --
      // construction disabled, or any other unexpected error, both leave
      // every project's earned value at its Map default (null via `?? null`
      // below), never a fabricated 0 and never a failed dashboard.
    }

    const projectSummaries = projectRows.map((p) => {
      const activeBoqId = boqIdByProject.get(p.id)
      const ev = evByProject.get(p.id) ?? null
      // R67 D-62: the same helper /dashboard/project uses. null (not 0) when the
      // project has no BOQ at all yet -- a real "no scope defined" state,
      // distinct from a real BOQ worth zero.
      const money = resolveProjectMoney({
        enteredProjectValue: p.projectValue !== null ? Number(p.projectValue) : null,
        purchaseOrderTotal: poMap.get(p.id) ?? null,
        boqContractValue: activeBoqId ? (valueByBoqMap.get(activeBoqId) ?? 0) : null,
        earnedValue: ev?.earnedValue ?? null,
      })
      return {
        id: p.id, name: p.name,
        revenue: revenueMap.get(p.id) ?? 0,
        expenses: expenseMap.get(p.id) ?? 0,
        taskCount: taskMap.get(p.id)?.total ?? 0,
        delayedTaskCount: taskMap.get(p.id)?.delayed ?? 0,
        contractValue: money.contractValue,
        projectValue: money.projectValue,
        projectValueSource: money.projectValueSource,
        value: money.contractValue, // deprecated alias -- see the type above
        earnedValue: money.earnedValue,
        percentByValue: ev?.percentByValue ?? null,
      }
    })

    return {
      totalProjects: projectRows.length,
      totalBudget: Number(budgetTotal?.lines ?? 0) > 0 ? Number(budgetTotal!.total) : null,
      totalRevenue: projectSummaries.reduce((s, p) => s + p.revenue, 0),
      totalExpenses: projectSummaries.reduce((s, p) => s + p.expenses, 0),
      projects: projectSummaries,
    }
  })
}
