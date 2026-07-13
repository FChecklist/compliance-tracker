// Reports & Analysis ENGINE (Priority 11, Owner directive 2026-07-13):
// "REPORT and ANALYSIS ENGINE should be able to generate reports and
// analysis. It should be flexible so that without reworking and without
// duplicacy, reports and analysis can be merged from various reports and
// analysis, new reports and analysis can be created."
//
// Before this file, every report in this codebase was a bespoke, hand-
// written function (construction-reports-service.ts's 17 functions,
// erp-financial-report-service.ts's 4, custom-report-service.ts's one
// per-entity switch). That does not scale to the ~150 named reports/
// analyses the Owner catalogued, and re-doing that pattern 150 times is
// exactly the "duplicacy"/"rework" this file exists to avoid.
//
// The fix: a report_definitions ROW (report-taxonomy.ts's category/
// classifications/periodicity + one of 4 execution_type shapes below) is
// now a first-class, addable unit. Executing ANY definition goes through
// ONE dispatcher (executeReportDefinition), not a new function per report:
//
//   - 'deterministic_aggregation' -- a generic group-by/count/sum/avg over
//     one whitelisted table+column (runAggregation()). This generalizes
//     custom-report-service.ts's per-entity switch into a single reusable
//     function that any caller invokes with real, already-imported Drizzle
//     table/column objects -- it is NOT a registry of raw table-name
//     strings resolved at runtime (that would reopen the exact arbitrary-
//     query surface custom-report-service.ts's own header explicitly
//     rejected). Callers (this file's seed definitions, and whatever
//     domain-specific report files future waves add) import real
//     typed Drizzle objects and pass them in -- the whitelist is still
//     "only what's explicitly wired in code", just wired ONCE per report
//     instead of once per report AND once per switch-branch.
//   - 'deterministic_formula' -- looks up a named pure function in
//     FORMULA_REGISTRY (below) that computes a real calculated metric
//     (SPI/CPI/health index) from real queried data, honestly documenting
//     every simplifying assumption it makes.
//   - 'ai_recipe' -- a grounded LLM call (same discipline as ai-report-
//     builder-service.ts: the model's ONLY inputs are real queried data,
//     never invented figures), re-run fresh every call -- this is what
//     makes Category 4/6 (AI Analysis / AI-promoted-analysis) genuinely
//     live instead of a frozen snapshot.
//   - 'external_service' -- a thin passthrough marker for reports that
//     already have a real, working, hand-written implementation elsewhere
//     (the 4 pre-Priority-11 services) -- this execution_type deliberately
//     does NOT re-implement those; it just lets them be catalogued and
//     scheduled through the same definitions table as everything else.
//
// Category 5/6's "AI made it, put in system with software, next time
// software will make it" requirement is promoteAiAnalysisToDefinition()
// below: an ad-hoc AI report-builder proposal (ai-report-builder-service.ts)
// gets inserted as a REAL report_definitions row (deterministic_aggregation
// if the proposal reduces to a simple groupby the engine can run without AI
// next time, ai_recipe if the judgment genuinely can't be made
// deterministic) -- not left as a frozen one-off blob in savedReports.

import {
  db, reportDefinitions,
  crmLeads, crmOpportunities, erpQuotations, erpSalesOrders, erpSalesInvoices, erpCustomers,
  salesReferrals, salesCommissionAccruals, veriMeetings,
} from "@/lib/db"
import { withTenantContext, type TenantDb } from "@/lib/db/tenant-scoped"
import { and, eq, or, isNull, isNotNull, sql, gte, lte, type SQL } from "drizzle-orm"
import type { AnyPgColumn, PgTable } from "drizzle-orm/pg-core"
import { resolveModelConfig } from "@/lib/orchestra-model-resolver"
import { callLLMJson, stripJsonFence } from "@/lib/llm-client"
import { recordOrchestraExecution } from "@/lib/orchestra-execution-logger"
import { validateClassifications, validatePeriodicity, REPORT_CATEGORY_VALUES, type ReportCategory } from "./report-taxonomy"
import { budgetVsActual, projectCompletionReport } from "./construction-reports-service"
import { REPORT_CATALOG, type ReportCatalogEntry, type ReportDomain } from "./report-catalog-service"
import { ServiceError } from "./compliance-service"
export { ServiceError }

export type ExecutionType = "deterministic_aggregation" | "deterministic_formula" | "ai_recipe" | "external_service"

// ─── execution_config shapes, one per ExecutionType ───────────────────────

export type AggregationConfig = {
  kind: "aggregation"
  /** Human-readable table name, documentation only. */
  tableLabel: string
  aggregation: "count" | "sum" | "avg"
  /**
   * OPTIONAL, additive (Priority 11 Sales Reports wave, migration 0183).
   * When set, must be a key in TABLE_REGISTRY below -- the generic
   * dispatcher (executeReportDefinition) resolves the real Drizzle
   * table/column objects from that fixed, code-reviewed registry and runs
   * runAggregation() itself, so a report_definitions row with a tableKey
   * genuinely works through the real API route, not just the "callers
   * bring their own objects" path the original header describes. This is
   * still NOT an arbitrary-query surface: tableKey/groupByColumn/
   * aggregationColumnKey/filterColumn only ever resolve against a
   * hardcoded whitelist of real column objects (TABLE_REGISTRY), the same
   * safety property as a caller passing real objects directly -- just
   * centralized once instead of re-declared per caller. Omit tableKey
   * entirely (as the pre-existing construction/compliance definitions do)
   * to keep executing via a bespoke caller that supplies its own objects.
   */
  tableKey?: string
  /** Key into TABLE_REGISTRY[tableKey].columns. Omit for an ungrouped total. */
  groupByColumn?: string
  /** Key into TABLE_REGISTRY[tableKey].columns. Required when aggregation is 'sum'|'avg'. */
  aggregationColumnKey?: string
  /** Optional equality filter -- key + literal value, both resolved through the same column whitelist. NOT a raw WHERE clause. */
  filterColumn?: string
  filterValue?: string
}
export type FormulaConfig = { kind: "formula"; formulaKey: string; params?: Record<string, unknown> }
export type AiRecipeConfig = { kind: "ai_recipe"; promptKey: string; groundingNote: string }
export type ExternalServiceConfig = { kind: "external_service"; sourceService: string; sourceFunction: string; requiredParams?: string[] }

export type ReportDefinitionResult = { columns: string[]; rows: Record<string, string | number>[]; narrative?: string; note?: string }

// ─── Generic aggregation executor (the group-by generalization) ──────────

/**
 * Runs `SELECT groupByColumn, agg(*) FROM table WHERE orgIdColumn = ctx.orgId [AND extraWhere] GROUP BY groupByColumn`.
 * Callers pass real, already-imported Drizzle table/column objects -- this
 * function does no string-to-table resolution, so it cannot become an
 * arbitrary-query surface no matter what a report_definitions row's JSON
 * config says. Mirrors custom-report-service.ts's runReport() switch
 * exactly, just parameterized once instead of duplicated per entity.
 */
export async function runAggregation(
  db: TenantDb,
  args: {
    table: PgTable
    orgIdColumn: AnyPgColumn
    orgId: string
    groupByColumn: AnyPgColumn | null
    aggregation: "count" | "sum" | "avg"
    aggregationColumn?: AnyPgColumn
    extraWhere?: SQL
  }
): Promise<{ groupValue: unknown; value: number }[]> {
  const aggExpr =
    args.aggregation === "count"
      ? sql<number>`count(*)::float`
      : args.aggregation === "sum"
        ? sql<number>`coalesce(sum(${args.aggregationColumn}), 0)::float`
        : sql<number>`coalesce(avg(${args.aggregationColumn}), 0)::float`

  const where = args.extraWhere ? and(eq(args.orgIdColumn, args.orgId), args.extraWhere) : eq(args.orgIdColumn, args.orgId)

  if (!args.groupByColumn) {
    const [row] = await db.select({ value: aggExpr }).from(args.table).where(where)
    return [{ groupValue: "Total", value: Number(row?.value ?? 0) }]
  }
  const groupByColumn = args.groupByColumn
  const rows = await db
    .select({ groupValue: groupByColumn, value: aggExpr })
    .from(args.table)
    .where(where)
    .groupBy(groupByColumn)
  return rows.map((r) => ({ groupValue: r.groupValue, value: Number(r.value) }))
}

// ─── Table registry (deterministic_aggregation, tableKey-resolved) ───────
// Priority 11 Sales Reports wave (migration 0183). A FIXED, code-reviewed
// whitelist -- Record<tableKey, {table, orgIdColumn, columns}> -- of the
// Sales/CRM domain's real, already-imported Drizzle table/column objects.
// Additive only: this is the first domain to populate this registry (no
// pre-existing entries to preserve), and future waves append their own
// domain's tables the same way rather than editing these. A
// report_definitions row's executionConfig.tableKey/groupByColumn/
// aggregationColumnKey/filterColumn are just STRING KEYS into this object --
// never interpolated into SQL directly -- so this cannot become the
// arbitrary-query surface the dispatcher's header explicitly rejects; it is
// exactly as safe as a caller passing runAggregation() real objects
// directly, just centralized once instead of redeclared per caller.
export const TABLE_REGISTRY: Record<string, { table: PgTable; orgIdColumn: AnyPgColumn; columns: Record<string, AnyPgColumn> }> = {
  crm_leads: {
    table: crmLeads, orgIdColumn: crmLeads.orgId,
    columns: { status: crmLeads.status, source: crmLeads.source, ownerId: crmLeads.ownerId, aiScore: crmLeads.aiScore },
  },
  crm_opportunities: {
    table: crmOpportunities, orgIdColumn: crmOpportunities.orgId,
    columns: {
      stage: crmOpportunities.stage, ownerId: crmOpportunities.ownerId, estimatedValue: crmOpportunities.estimatedValue,
      aiWinProbability: crmOpportunities.aiWinProbability, aiRecommendedAction: crmOpportunities.aiRecommendedAction,
      expectedCloseDate: crmOpportunities.expectedCloseDate,
    },
  },
  erp_quotations: {
    table: erpQuotations, orgIdColumn: erpQuotations.orgId,
    columns: { status: erpQuotations.status, customerId: erpQuotations.customerId, grandTotal: erpQuotations.grandTotal, quotationDate: erpQuotations.quotationDate },
  },
  erp_sales_orders: {
    table: erpSalesOrders, orgIdColumn: erpSalesOrders.orgId,
    columns: { status: erpSalesOrders.status, customerId: erpSalesOrders.customerId, grandTotal: erpSalesOrders.grandTotal, orderDate: erpSalesOrders.orderDate },
  },
  erp_sales_invoices: {
    table: erpSalesInvoices, orgIdColumn: erpSalesInvoices.orgId,
    columns: { status: erpSalesInvoices.status, customerId: erpSalesInvoices.customerId, grandTotal: erpSalesInvoices.grandTotal, outstandingAmount: erpSalesInvoices.outstandingAmount, postingDate: erpSalesInvoices.postingDate },
  },
  erp_customers: {
    table: erpCustomers, orgIdColumn: erpCustomers.orgId,
    columns: { isActive: erpCustomers.isActive, defaultPaymentTermsDays: erpCustomers.defaultPaymentTermsDays, creditLimit: erpCustomers.creditLimit },
  },
  sales_referrals: {
    table: salesReferrals, orgIdColumn: salesReferrals.orgId,
    columns: { status: salesReferrals.status, salesPartnerId: salesReferrals.salesPartnerId, productKey: salesReferrals.productKey },
  },
  // meetingType='client' is a real but imperfect proxy for a "customer
  // meeting" -- veri_meetings has no dedicated sales/pre-sales flag, so any
  // report reading this table documents that limitation in its own
  // dataGapNote/description rather than silently overclaiming precision.
  veri_meetings: {
    table: veriMeetings, orgIdColumn: veriMeetings.orgId,
    columns: { meetingType: veriMeetings.meetingType, contextEntityType: veriMeetings.contextEntityType },
  },
}

async function runRegisteredAggregation(ctx: { orgId: string }, config: AggregationConfig): Promise<ReportDefinitionResult> {
  const entry = config.tableKey ? TABLE_REGISTRY[config.tableKey] : undefined
  if (!entry) throw new ServiceError(`No table registered for tableKey "${config.tableKey}"`, 500)

  const groupByColumn = config.groupByColumn ? entry.columns[config.groupByColumn] : null
  if (config.groupByColumn && !groupByColumn) throw new ServiceError(`Unknown groupByColumn "${config.groupByColumn}" for tableKey "${config.tableKey}"`, 500)

  const aggregationColumn = config.aggregationColumnKey ? entry.columns[config.aggregationColumnKey] : undefined
  if (config.aggregationColumnKey && !aggregationColumn) throw new ServiceError(`Unknown aggregationColumnKey "${config.aggregationColumnKey}" for tableKey "${config.tableKey}"`, 500)

  let extraWhere: SQL | undefined
  if (config.filterColumn) {
    const filterCol = entry.columns[config.filterColumn]
    if (!filterCol) throw new ServiceError(`Unknown filterColumn "${config.filterColumn}" for tableKey "${config.tableKey}"`, 500)
    extraWhere = eq(filterCol, config.filterValue ?? "")
  }

  return withTenantContext({ orgId: ctx.orgId }, async (db) => {
    const rows = await runAggregation(db, {
      table: entry.table, orgIdColumn: entry.orgIdColumn, orgId: ctx.orgId,
      groupByColumn: groupByColumn ?? null, aggregation: config.aggregation, aggregationColumn, extraWhere,
    })
    const groupLabel = config.groupByColumn ?? "Group"
    const valueLabel = config.aggregation === "count" ? "Count" : config.aggregation === "sum" ? "Sum" : "Average"
    return {
      columns: [groupLabel, valueLabel],
      rows: rows.map((r) => ({ [groupLabel]: String(r.groupValue), [valueLabel]: r.value })),
    }
  })
}

// ─── Formula registry (deterministic_formula) ─────────────────────────────
// Small and deliberately honest about its own approximations -- every
// formula below documents exactly which real columns it reads and which
// standard simplification it applies when this codebase has no baseline
// S-curve/earned-value table to compute the textbook-precise version.
// Future waves add more formulas by adding a new key here (additive,
// self-contained) rather than touching the dispatcher.

type FormulaFn = (ctx: { orgId: string }, params: Record<string, unknown>) => Promise<ReportDefinitionResult>

/**
 * Schedule Performance Index, project-level. Textbook SPI = Earned Value /
 * Planned Value. This codebase has no baseline S-curve (a planned-%-
 * complete-over-time table), so Planned Value is approximated as a linear
 * function of elapsed time between projects.startDate and projects.
 * targetDate -- a standard simplified proxy when no detailed baseline
 * schedule exists, not a fabricated number. Earned Value is the project's
 * real actual percentComplete (projectCompletionReport(), construction-
 * reports-service.ts). SPI > 1 = ahead of the time-linear plan, < 1 =
 * behind. Requires both startDate and targetDate to be set; without them
 * there is no plan to compare against, so this returns a data_gap note
 * rather than a fabricated ratio.
 */
async function computeSpi(ctx: { orgId: string }, params: Record<string, unknown>): Promise<ReportDefinitionResult> {
  const projectId = String(params.projectId ?? "")
  if (!projectId) throw new ServiceError("projectId is required for the SPI formula", 400)
  return withTenantContext({ orgId: ctx.orgId }, async (db) => {
    const project = await db.query.projects.findFirst({ where: (t, { and, eq }) => and(eq(t.id, projectId), eq(t.orgId, ctx.orgId)) })
    if (!project) throw new ServiceError("Project not found", 404)
    if (!project.startDate || !project.targetDate) {
      return { columns: ["Metric", "Value"], rows: [{ Metric: "SPI", Value: "N/A" }], note: "Project has no startDate/targetDate set -- cannot compute a time-linear planned-progress baseline." }
    }
    const start = new Date(project.startDate).getTime()
    const target = new Date(project.targetDate).getTime()
    const now = Date.now()
    const totalMs = target - start
    const plannedPercent = totalMs <= 0 ? 100 : Math.max(0, Math.min(100, ((now - start) / totalMs) * 100))
    const completion = await projectCompletionReport(ctx, projectId)
    const actualPercent = completion.overallPercentComplete
    const spi = plannedPercent > 0 ? actualPercent / plannedPercent : actualPercent > 0 ? Infinity : 1
    return {
      columns: ["Metric", "Value"],
      rows: [
        { Metric: "Actual % Complete", Value: actualPercent },
        { Metric: "Planned % Complete (time-linear)", Value: Math.round(plannedPercent * 10) / 10 },
        { Metric: "SPI", Value: Number.isFinite(spi) ? Math.round(spi * 100) / 100 : 99 },
      ],
      note: "Planned % Complete is a linear time-elapsed proxy (project.startDate -> targetDate) -- this codebase has no baseline S-curve table for a precise Planned Value.",
    }
  })
}

/**
 * Cost Performance Index, project-level. Textbook CPI = Earned Value /
 * Actual Cost. Earned Value is approximated as Budget * (actual % complete
 * / 100) -- the standard BCWP simplification (per Owner's own 30-Analysis
 * catalog, this is the documented industry-standard approximation used
 * absent a granular per-activity budget breakdown). Actual Cost is the
 * project's real logged expenses (budgetVsActual(), construction-reports-
 * service.ts). CPI > 1 = under budget for work done, < 1 = over budget.
 */
async function computeCpi(ctx: { orgId: string }, params: Record<string, unknown>): Promise<ReportDefinitionResult> {
  const projectId = String(params.projectId ?? "")
  if (!projectId) throw new ServiceError("projectId is required for the CPI formula", 400)
  const [budget, completion] = await Promise.all([budgetVsActual(ctx, projectId), projectCompletionReport(ctx, projectId)])
  if (budget.budget <= 0) {
    return { columns: ["Metric", "Value"], rows: [{ Metric: "CPI", Value: "N/A" }], note: "Project has no budget set (via its cost centre) -- cannot compute Earned Value." }
  }
  const earnedValue = budget.budget * (completion.overallPercentComplete / 100)
  const cpi = budget.actual > 0 ? earnedValue / budget.actual : earnedValue > 0 ? Infinity : 1
  return {
    columns: ["Metric", "Value"],
    rows: [
      { Metric: "Budget (BAC)", Value: Math.round(budget.budget) },
      { Metric: "Actual Cost", Value: Math.round(budget.actual) },
      { Metric: "Earned Value (Budget x % Complete)", Value: Math.round(earnedValue) },
      { Metric: "CPI", Value: Number.isFinite(cpi) ? Math.round(cpi * 100) / 100 : 99 },
    ],
    note: "Earned Value uses the standard Budget x %-Complete approximation (BCWP) -- this codebase has no per-activity budget breakdown for a more granular Earned Value.",
  }
}

/**
 * Project Health Index -- a single 0-100 composite score, weighted average
 * of SPI and CPI each normalized to a 0-100 scale (1.0 -> 100, clamped),
 * documented as exactly that -- a transparent weighted blend, not a
 * black-box AI score (that's what Category 4's "AI Project Risk
 * Prediction" is for, a genuinely different, AI-judgment-based metric).
 */
async function computeProjectHealthIndex(ctx: { orgId: string }, params: Record<string, unknown>): Promise<ReportDefinitionResult> {
  const [spiResult, cpiResult] = await Promise.all([computeSpi(ctx, params), computeCpi(ctx, params)])
  const spiRow = spiResult.rows.find((r) => r.Metric === "SPI")
  const cpiRow = cpiResult.rows.find((r) => r.Metric === "CPI")
  const spi = typeof spiRow?.Value === "number" ? spiRow.Value : null
  const cpi = typeof cpiRow?.Value === "number" ? cpiRow.Value : null
  if (spi == null || cpi == null) {
    return { columns: ["Metric", "Value"], rows: [{ Metric: "Project Health Index", Value: "N/A" }], note: "Requires both SPI and CPI to be computable -- see their own notes for what's missing." }
  }
  const normalize = (ratio: number) => Math.max(0, Math.min(100, ratio * 100))
  const healthIndex = Math.round((normalize(spi) + normalize(cpi)) / 2)
  return {
    columns: ["Metric", "Value"],
    rows: [
      { Metric: "SPI", Value: spi },
      { Metric: "CPI", Value: cpi },
      { Metric: "Project Health Index (0-100)", Value: healthIndex },
    ],
    note: "Transparent weighted average of normalized SPI and CPI (50/50) -- not an AI-derived score.",
  }
}

// ─── Sales/CRM formulas (Priority 11 Sales Reports wave, migration 0183) ──
// Same honesty discipline as the SPI/CPI formulas above: every ratio here
// documents exactly which real columns it reads and which real rows it
// excludes, rather than silently padding a denominator or estimating a
// figure the schema can't actually support.

/** Lead -> Customer conversion rate. "Converted" = crm_leads.converted_client_id set (the real signal convertLeadToClient() writes), not the parallel free-text status column. */
async function leadConversionRate(ctx: { orgId: string }): Promise<ReportDefinitionResult> {
  return withTenantContext({ orgId: ctx.orgId }, async (db) => {
    const [totalRow] = await db.select({ value: sql<number>`count(*)::float` }).from(crmLeads).where(eq(crmLeads.orgId, ctx.orgId))
    const [convertedRow] = await db.select({ value: sql<number>`count(*)::float` }).from(crmLeads).where(and(eq(crmLeads.orgId, ctx.orgId), isNotNull(crmLeads.convertedClientId)))
    const total = Number(totalRow?.value ?? 0)
    const converted = Number(convertedRow?.value ?? 0)
    const rate = total > 0 ? Math.round((converted / total) * 1000) / 10 : 0
    return {
      columns: ["Metric", "Value"],
      rows: [
        { Metric: "Total Leads", Value: total },
        { Metric: "Converted Leads", Value: converted },
        { Metric: "Lead -> Customer Conversion Rate (%)", Value: rate },
      ],
      note: "\"Converted\" = crm_leads.converted_client_id is set (written by convertLeadToClient()), not the free-text status column, which can lag or be edited independently.",
    }
  })
}

/** Quotation win rate over DECIDED quotations only (ordered/lost/expired) -- draft/submitted quotations are still pending and are excluded from the denominator rather than counted as losses. */
async function quotationWinRate(ctx: { orgId: string }): Promise<ReportDefinitionResult> {
  return withTenantContext({ orgId: ctx.orgId }, async (db) => {
    const decided = await db
      .select({ status: erpQuotations.status, value: sql<number>`count(*)::float` })
      .from(erpQuotations)
      .where(and(eq(erpQuotations.orgId, ctx.orgId), or(eq(erpQuotations.status, "ordered"), eq(erpQuotations.status, "lost"), eq(erpQuotations.status, "expired"))))
      .groupBy(erpQuotations.status)
    const won = Number(decided.find((r) => r.status === "ordered")?.value ?? 0)
    const totalDecided = decided.reduce((sum, r) => sum + Number(r.value), 0)
    const winRate = totalDecided > 0 ? Math.round((won / totalDecided) * 1000) / 10 : 0
    return {
      columns: ["Metric", "Value"],
      rows: [
        { Metric: "Decided Quotations (ordered/lost/expired)", Value: totalDecided },
        { Metric: "Won (ordered)", Value: won },
        { Metric: "Win Rate (%)", Value: winRate },
      ],
      note: "Excludes quotations still in draft/submitted (undecided) from the denominator -- a fair win rate only counts quotations that reached a real outcome.",
    }
  })
}

/** Average lead-to-order sales cycle, in days -- ONLY for completed sales orders that trace back through a real quotation to a real lead (quotation_id and quotation.lead_id both set). */
async function salesCycleLengthDays(ctx: { orgId: string }): Promise<ReportDefinitionResult> {
  return withTenantContext({ orgId: ctx.orgId }, async (db) => {
    const rows = await db
      .select({ orderDate: erpSalesOrders.orderDate, leadCreatedAt: crmLeads.createdAt })
      .from(erpSalesOrders)
      .innerJoin(erpQuotations, eq(erpSalesOrders.quotationId, erpQuotations.id))
      .innerJoin(crmLeads, eq(erpQuotations.leadId, crmLeads.id))
      .where(and(eq(erpSalesOrders.orgId, ctx.orgId), eq(erpSalesOrders.status, "completed")))

    if (rows.length === 0) {
      return {
        columns: ["Metric", "Value"], rows: [{ Metric: "Average Sales Cycle (days)", Value: "N/A" }],
        note: "No completed sales orders trace back through a quotation to a lead (quotation_id and quotation.lead_id must both be set) -- cannot compute a lead-to-order cycle length.",
      }
    }
    const days = rows
      .map((r) => (new Date(r.orderDate).getTime() - new Date(r.leadCreatedAt).getTime()) / (1000 * 60 * 60 * 24))
      .filter((d) => Number.isFinite(d) && d >= 0)
    const avgDays = days.length > 0 ? Math.round((days.reduce((a, b) => a + b, 0) / days.length) * 10) / 10 : 0
    return {
      columns: ["Metric", "Value"],
      rows: [
        { Metric: "Completed Orders Traced to a Lead", Value: days.length },
        { Metric: "Average Sales Cycle (days)", Value: avgDays },
      ],
      note: "Only covers completed sales orders that trace back through a real quotation to a real lead -- orders from an opportunity/quotation with no linked lead are excluded rather than estimated.",
    }
  })
}

/** Repeat-customer % -- "repeat" = more than one COMPLETED erp_sales_order for the same customer_id. */
async function repeatCustomerPercentage(ctx: { orgId: string }): Promise<ReportDefinitionResult> {
  return withTenantContext({ orgId: ctx.orgId }, async (db) => {
    const perCustomer = await db
      .select({ customerId: erpSalesOrders.customerId, orderCount: sql<number>`count(*)::float` })
      .from(erpSalesOrders)
      .where(and(eq(erpSalesOrders.orgId, ctx.orgId), eq(erpSalesOrders.status, "completed")))
      .groupBy(erpSalesOrders.customerId)

    const totalCustomers = perCustomer.length
    const repeatCustomers = perCustomer.filter((r) => Number(r.orderCount) > 1).length
    const pct = totalCustomers > 0 ? Math.round((repeatCustomers / totalCustomers) * 1000) / 10 : 0
    return {
      columns: ["Metric", "Value"],
      rows: [
        { Metric: "Distinct Customers (completed orders)", Value: totalCustomers },
        { Metric: "Repeat Customers (>1 completed order)", Value: repeatCustomers },
        { Metric: "Repeat Customer %", Value: pct },
      ],
      note: "\"Repeat\" = more than one completed erp_sales_order for the same customer_id -- does not account for repeat business logged only as invoices with no sales order, or a customer whose customer_id changed across deals.",
    }
  })
}

/** Referral-attributed deal value + commission, by partner -- sales_commission_accruals has no direct org_id, so this is scoped via an inner join through sales_referrals.org_id (set once a referral's org is provisioned). */
async function referralRevenueSummary(ctx: { orgId: string }): Promise<ReportDefinitionResult> {
  return withTenantContext({ orgId: ctx.orgId }, async (db) => {
    const rows = await db
      .select({
        salesPartnerId: salesCommissionAccruals.salesPartnerId,
        totalDealValue: sql<number>`coalesce(sum(${salesCommissionAccruals.dealValue}), 0)::float`,
        totalCommission: sql<number>`coalesce(sum(${salesCommissionAccruals.amount}), 0)::float`,
        accrualCount: sql<number>`count(*)::float`,
      })
      .from(salesCommissionAccruals)
      .innerJoin(salesReferrals, eq(salesCommissionAccruals.salesReferralId, salesReferrals.id))
      .where(eq(salesReferrals.orgId, ctx.orgId))
      .groupBy(salesCommissionAccruals.salesPartnerId)

    return {
      columns: ["Sales Partner ID", "Referred Deal Value", "Commission Accrued", "Accrual Count"],
      rows: rows.map((r) => ({
        "Sales Partner ID": r.salesPartnerId,
        "Referred Deal Value": Number(r.totalDealValue),
        "Commission Accrued": Number(r.totalCommission),
        "Accrual Count": Number(r.accrualCount),
      })),
      note: "sales_commission_accruals has no direct org_id -- scoped here via an inner join through sales_referrals.org_id (only set once a referral's org is provisioned), so referrals that never reached org_provisioned are correctly excluded.",
    }
  })
}

/** Opportunities the real Wave-75 CRM Intelligence scoring (crm_opportunities.ai_win_probability/ai_risk_factors) flagged as high-risk -- low win probability or an explicit risk factor. Never re-scores; only reads whatever a separate scoring flow already computed. Opportunities never AI-analyzed (ai_analyzed_at null) are excluded rather than shown as a false "not risky". */
async function aiOpportunityRiskSummary(ctx: { orgId: string }): Promise<ReportDefinitionResult> {
  return withTenantContext({ orgId: ctx.orgId }, async (db) => {
    const rows = await db
      .select({
        id: crmOpportunities.id, name: crmOpportunities.name, stage: crmOpportunities.stage,
        estimatedValue: crmOpportunities.estimatedValue, aiWinProbability: crmOpportunities.aiWinProbability,
        aiRiskFactors: crmOpportunities.aiRiskFactors, aiRecommendedAction: crmOpportunities.aiRecommendedAction,
      })
      .from(crmOpportunities)
      .where(and(
        eq(crmOpportunities.orgId, ctx.orgId),
        isNotNull(crmOpportunities.aiAnalyzedAt),
        or(sql`${crmOpportunities.aiWinProbability} < 40`, sql`jsonb_array_length(${crmOpportunities.aiRiskFactors}) > 0`)
      ))
    return {
      columns: ["Opportunity", "Stage", "Estimated Value", "AI Win Probability", "AI Risk Factors", "AI Recommended Action"],
      rows: rows.map((r) => ({
        Opportunity: r.name, Stage: r.stage, "Estimated Value": Number(r.estimatedValue ?? 0),
        "AI Win Probability": r.aiWinProbability ?? "Not scored",
        "AI Risk Factors": Array.isArray(r.aiRiskFactors) ? (r.aiRiskFactors as string[]).join("; ") : "",
        "AI Recommended Action": r.aiRecommendedAction ?? "",
      })),
      note: "Reads the real Wave-75 CRM Intelligence AI scores (crm_opportunities.ai_win_probability/ai_risk_factors) already computed by a separate scoring flow -- this report never re-scores; opportunities never AI-analyzed (ai_analyzed_at null) are excluded rather than shown as false 'not risky'.",
    }
  })
}

/** Opportunities with expected_close_date in the next 7 days -- reads the real Wave-75 AI win-probability score where present, never re-scores. */
async function dealsClosingSoon(ctx: { orgId: string }): Promise<ReportDefinitionResult> {
  return withTenantContext({ orgId: ctx.orgId }, async (db) => {
    const todayStr = new Date().toISOString().slice(0, 10)
    const weekStr = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)
    const rows = await db
      .select({
        id: crmOpportunities.id, name: crmOpportunities.name, stage: crmOpportunities.stage,
        estimatedValue: crmOpportunities.estimatedValue, expectedCloseDate: crmOpportunities.expectedCloseDate,
        aiWinProbability: crmOpportunities.aiWinProbability,
      })
      .from(crmOpportunities)
      .where(and(eq(crmOpportunities.orgId, ctx.orgId), gte(crmOpportunities.expectedCloseDate, todayStr), lte(crmOpportunities.expectedCloseDate, weekStr)))
    return {
      columns: ["Opportunity", "Stage", "Estimated Value", "Expected Close", "AI Win Probability"],
      rows: rows.map((r) => ({
        Opportunity: r.name, Stage: r.stage, "Estimated Value": Number(r.estimatedValue ?? 0),
        "Expected Close": String(r.expectedCloseDate), "AI Win Probability": r.aiWinProbability ?? "Not scored",
      })),
      note: rows.length === 0 ? "No opportunities have expectedCloseDate within the next 7 days." : "Filters crm_opportunities.expected_close_date only -- does not additionally weight by stage or AI win probability.",
    }
  })
}

export const FORMULA_REGISTRY: Record<string, FormulaFn> = {
  schedule_performance_index: computeSpi,
  cost_performance_index: computeCpi,
  project_health_index: computeProjectHealthIndex,
  lead_conversion_rate: leadConversionRate,
  quotation_win_rate: quotationWinRate,
  sales_cycle_length_days: salesCycleLengthDays,
  repeat_customer_percentage: repeatCustomerPercentage,
  referral_revenue_summary: referralRevenueSummary,
  ai_opportunity_risk_summary: aiOpportunityRiskSummary,
  deals_closing_soon: dealsClosingSoon,
}

// ─── AI recipe executor (ai_recipe) ───────────────────────────────────────
// Reuses ai-report-builder-service.ts's exact grounding discipline: the
// model's ONLY inputs are the real data this function queries and passes
// in -- groundingData is serialized verbatim into the prompt, nothing else
// is interpolated, and the system prompt forbids inventing unsourced
// numbers. Unlike ai-report-builder-service.ts (grounded in an uploaded
// file), this is grounded in a live DB query the definition's own config
// names -- see PROMPT_TEMPLATES below for what each promptKey actually
// grounds against.

const AI_RECIPE_SYSTEM_PROMPT = `You are an analysis assistant inside VERIDIAN AI OS. You will be given real, live data queried from the organisation's own records. Produce a concise analysis grounded ONLY in that data.

STRICT RULES:
- Use ONLY facts, numbers, and patterns present in the provided data. Never invent, estimate, or guess a figure not derivable from it.
- If the data is too sparse to support a real conclusion, say so plainly instead of padding with generic advice.

Respond with ONLY a JSON object of this exact shape, no markdown, no extra text:
{ "columns": ["Column A", "Column B"], "rows": [ { "Column A": "value", "Column B": "value" } ], "narrative": "2-4 sentence grounded analysis" }`

async function runAiRecipe(ctx: { orgId: string; userId?: string }, config: AiRecipeConfig, groundingData: unknown): Promise<ReportDefinitionResult> {
  const startedAt = Date.now()
  const modelConfig = await resolveModelConfig(ctx.orgId, "customer_account_oa")
  if (!modelConfig) throw new ServiceError("No AI model is configured for this organisation. Configure one in Settings -> AI Configuration.", 503)

  const { data, usage } = await callLLMJson<{ columns?: string[]; rows?: Record<string, unknown>[]; narrative?: string }>(
    modelConfig.provider, modelConfig.model, modelConfig.apiKey,
    AI_RECIPE_SYSTEM_PROMPT,
    `Recipe: ${config.promptKey}\nGrounding note: ${config.groundingNote}\n\nReal data (the ONLY source of truth for this analysis):\n${JSON.stringify(groundingData).slice(0, 12000)}`,
    { temperature: 0.1, maxTokens: 1500 },
    modelConfig.fallback
  )

  recordOrchestraExecution({
    orgId: ctx.orgId, userId: ctx.userId ?? "system", layerKey: "customer_account_oa", eventType: "reports.ai_recipe_execute",
    input: { promptKey: config.promptKey }, output: { rowCount: data?.rows?.length ?? 0 },
    status: "completed", durationMs: Date.now() - startedAt, provider: modelConfig.provider, model: modelConfig.model, usage,
  })

  const columns = Array.isArray(data?.columns) ? data!.columns.map(String) : []
  const rows = Array.isArray(data?.rows) ? (data!.rows as Record<string, string | number>[]) : []
  if (columns.length === 0 || rows.length === 0) {
    return { columns: ["Note"], rows: [{ Note: "AI could not derive a structured analysis from the available data." }], narrative: data?.narrative }
  }
  return { columns, rows, narrative: typeof data?.narrative === "string" ? data.narrative : undefined }
}

// ─── report_definitions CRUD (org-scoped OR platform-wide read, matching
// platformAssets/taskCapabilities' nullable-org precedent) ────────────────

export type CreateReportDefinitionInput = {
  name: string
  description: string
  category: ReportCategory
  classifications: string[]
  periodicity?: string | null
  periodicityConfig?: Record<string, unknown> | null
  executionType: ExecutionType
  executionConfig: AggregationConfig | FormulaConfig | AiRecipeConfig | ExternalServiceConfig
  outputFormats?: string[]
  status?: "built" | "data_gap" | "planned"
  dataGapNote?: string | null
  createdBy?: string
  promotedFromContext?: string | null
}

export function validateReportDefinitionInput(input: CreateReportDefinitionInput): { valid: true } | { valid: false; reason: string } {
  if (!input.name?.trim()) return { valid: false, reason: "name is required" }
  if (!input.description?.trim()) return { valid: false, reason: "description is required" }
  if (!REPORT_CATEGORY_VALUES.includes(input.category)) return { valid: false, reason: `category must be one of: ${REPORT_CATEGORY_VALUES.join(", ")}` }
  const classificationCheck = validateClassifications(input.classifications)
  if (!classificationCheck.valid) return classificationCheck
  if (input.periodicity) {
    const periodicityCheck = validatePeriodicity(input.periodicity, input.periodicityConfig as never)
    if (!periodicityCheck.valid) return periodicityCheck
  }
  if (!["deterministic_aggregation", "deterministic_formula", "ai_recipe", "external_service"].includes(input.executionType)) {
    return { valid: false, reason: "executionType must be one of: deterministic_aggregation, deterministic_formula, ai_recipe, external_service" }
  }
  if ((input.status ?? "built") !== "built" && !input.dataGapNote?.trim()) {
    return { valid: false, reason: "dataGapNote is required when status is not 'built' -- never leave a non-built definition unexplained" }
  }
  return { valid: true }
}

export async function listReportDefinitions(ctx: { orgId: string }, filter?: { category?: string; classification?: string }) {
  return withTenantContext({ orgId: ctx.orgId }, (db) =>
    db.query.reportDefinitions.findMany({
      where: (t, { and, eq, or, isNull }) => {
        const scope = or(eq(t.orgId, ctx.orgId), isNull(t.orgId))
        const categoryFilter = filter?.category ? eq(t.category, filter.category) : undefined
        return categoryFilter ? and(scope, categoryFilter) : scope
      },
      orderBy: (t, { desc }) => desc(t.createdAt),
    })
  ).then((rows) =>
    filter?.classification ? rows.filter((r) => Array.isArray(r.classifications) && (r.classifications as string[]).includes(filter.classification!)) : rows
  )
}

export async function createReportDefinition(ctx: { orgId: string; asPlatformWide?: boolean }, input: CreateReportDefinitionInput) {
  const check = validateReportDefinitionInput(input)
  if (!check.valid) throw new ServiceError(check.reason, 400)

  return withTenantContext({ orgId: ctx.orgId }, async (db) => {
    const [created] = await db.insert(reportDefinitions).values({
      orgId: ctx.asPlatformWide ? null : ctx.orgId,
      name: input.name.trim(),
      description: input.description.trim(),
      category: input.category,
      classifications: input.classifications,
      periodicity: input.periodicity || null,
      periodicityConfig: input.periodicityConfig || null,
      executionType: input.executionType,
      executionConfig: input.executionConfig,
      outputFormats: input.outputFormats ?? ["table"],
      status: input.status ?? "built",
      dataGapNote: input.dataGapNote || null,
      createdBy: input.createdBy ?? "system",
      promotedFromContext: input.promotedFromContext || null,
    }).returning()
    return created
  })
}

export async function updateReportDefinition(ctx: { orgId: string }, id: string, patch: Partial<CreateReportDefinitionInput & { isActive: boolean }>) {
  return withTenantContext({ orgId: ctx.orgId }, async (db) => {
    const existing = await db.query.reportDefinitions.findFirst({ where: and(eq(reportDefinitions.id, id), or(eq(reportDefinitions.orgId, ctx.orgId), isNull(reportDefinitions.orgId))) })
    if (!existing) throw new ServiceError("Report definition not found", 404)
    if (existing.orgId === null) throw new ServiceError("Platform-wide definitions cannot be edited from an org context", 403)
    const [updated] = await db.update(reportDefinitions).set({ ...patch, updatedAt: new Date() }).where(eq(reportDefinitions.id, id)).returning()
    return updated
  })
}

export async function deleteReportDefinition(ctx: { orgId: string }, id: string) {
  return withTenantContext({ orgId: ctx.orgId }, async (db) => {
    const existing = await db.query.reportDefinitions.findFirst({ where: and(eq(reportDefinitions.id, id), eq(reportDefinitions.orgId, ctx.orgId)) })
    if (!existing) throw new ServiceError("Report definition not found (or is platform-wide, which cannot be deleted from an org context)", 404)
    await db.delete(reportDefinitions).where(eq(reportDefinitions.id, id))
  })
}

// ─── The dispatcher every report_definitions row is run through ──────────

export async function executeReportDefinition(ctx: { orgId: string; userId?: string }, id: string, params: Record<string, unknown> = {}): Promise<ReportDefinitionResult> {
  const definition = await withTenantContext({ orgId: ctx.orgId }, (db) =>
    db.query.reportDefinitions.findFirst({ where: and(or(eq(reportDefinitions.orgId, ctx.orgId), isNull(reportDefinitions.orgId)), eq(reportDefinitions.id, id)) })
  )
  if (!definition) throw new ServiceError("Report definition not found", 404)
  if (definition.status !== "built") {
    return { columns: ["Note"], rows: [{ Note: `This report/analysis is not yet built (status: ${definition.status}).` }], note: definition.dataGapNote ?? undefined }
  }

  const config = definition.executionConfig as AggregationConfig | FormulaConfig | AiRecipeConfig | ExternalServiceConfig

  if (definition.executionType === "deterministic_aggregation" && config.kind === "aggregation" && config.tableKey) {
    // Only takes this path when the row's own executionConfig names a real
    // TABLE_REGISTRY tableKey (Priority 11 Sales Reports wave) -- a
    // deterministic_aggregation row with no tableKey falls through to the
    // "executed by a bespoke caller" throw below, unchanged.
    return runRegisteredAggregation(ctx, config)
  }

  if (definition.executionType === "deterministic_formula" && config.kind === "formula") {
    const fn = FORMULA_REGISTRY[config.formulaKey]
    if (!fn) throw new ServiceError(`No formula registered for key "${config.formulaKey}"`, 500)
    return fn(ctx, { ...(config.params ?? {}), ...params })
  }

  if (definition.executionType === "ai_recipe" && config.kind === "ai_recipe") {
    // Grounding data comes from the same aggregation/formula primitives
    // this file already exposes -- callers that register an ai_recipe
    // definition are expected to pass their own already-queried grounding
    // data via params.groundingData (built the same way ai-report-builder-
    // service.ts extracts real content before ever calling the LLM).
    return runAiRecipe(ctx, config, params.groundingData ?? {})
  }

  if (definition.executionType === "external_service") {
    return { columns: ["Note"], rows: [{ Note: `This report is served by its existing implementation (${(config as ExternalServiceConfig).sourceService}#${(config as ExternalServiceConfig).sourceFunction}), not through this generic engine -- see report-catalog-service.ts for its real route.` }] }
  }

  throw new ServiceError(`Definition ${id} has executionType "${definition.executionType}" but no matching handler (a deterministic_aggregation row with no executionConfig.tableKey is executed by a bespoke caller via runAggregation() with its own typed table/column objects, not through this generic dispatcher -- see this file's header. Add a tableKey resolving against TABLE_REGISTRY to run it through the dispatcher instead).`, 500)
}

// ─── Category 5/6 promotion (the literal "next time software will make
// it" mechanism) ───────────────────────────────────────────────────────

/**
 * Promotes an ad-hoc AI-proposed report (the shape ai-report-builder-
 * service.ts's proposeReportFromUpload() returns) into a reusable
 * report_definitions row. If the proposal is a simple, static table (no
 * ongoing judgment needed), it's stored as-is with executionType
 * 'external_service' pointing back at the frozen savedReports row (so
 * "software makes it" means "software redisplays the AI's real prior
 * output", not a fabricated live re-query of data the AI can't
 * re-derive from an ephemeral upload). If the caller explicitly marks it
 * `stillNeedsAiJudgment`, it's stored as 'ai_recipe' with the given
 * groundingNote instead, category 'ai_new_analysis_promoted' -- for
 * definitions whose grounding data IS a live queryable source (not a
 * one-off upload), letting every future run re-derive fresh output.
 */
export async function promoteAiAnalysisToDefinition(
  ctx: { orgId: string; userId: string },
  input: {
    name: string
    description: string
    classifications: string[]
    sourceSavedReportId: string
    stillNeedsAiJudgment?: boolean
    aiRecipeConfig?: AiRecipeConfig
  }
) {
  return createReportDefinition(
    { orgId: ctx.orgId },
    {
      name: input.name,
      description: input.description,
      category: input.stillNeedsAiJudgment ? "ai_new_analysis_promoted" : "ai_new_report_promoted",
      classifications: input.classifications,
      executionType: input.stillNeedsAiJudgment ? "ai_recipe" : "external_service",
      executionConfig: input.stillNeedsAiJudgment
        ? (input.aiRecipeConfig ?? { kind: "ai_recipe", promptKey: `promoted_${input.sourceSavedReportId}`, groundingNote: "Promoted from an ad-hoc AI report -- grounding source to be configured." })
        : { kind: "external_service", sourceService: "custom-report-service.ts", sourceFunction: "runReport", requiredParams: ["reportId"] },
      createdBy: "ai",
      promotedFromContext: `savedReports:${input.sourceSavedReportId}`,
    }
  )
}

// ─── Merged catalog (static REPORT_CATALOG + live report_definitions rows)
// ─────────────────────────────────────────────────────────────────────────
// Deliberately lives HERE, not in report-catalog-service.ts, even though it
// conceptually extends that file's catalog -- report-catalog-service.ts is
// imported by ReportCatalogList.tsx, a CLIENT component ("use client"), and
// that file's own header states it is DATA-ONLY with no DB access. Adding a
// withTenantContext()/db-touching function there once broke the production
// build (Next.js's client bundler pulled the `postgres` driver, which needs
// Node's `tls`/`perf_hooks`, into the client JS bundle). This file is
// already server-only (imports `db`/LLM clients), consumed only by server
// code (capability-tree-service.ts, API routes) -- the safe place for
// anything that touches the DB.

export type FullCatalogEntry = ReportCatalogEntry & { source: "static" | "definition"; definitionId?: string; status?: "built" | "data_gap" | "planned" }

export async function getFullReportCatalog(ctx: { orgId: string }): Promise<FullCatalogEntry[]> {
  const staticEntries: FullCatalogEntry[] = REPORT_CATALOG.map((e) => ({ ...e, source: "static" }))

  const definitions = await withTenantContext({ orgId: ctx.orgId }, (db) =>
    db.query.reportDefinitions.findMany({
      where: (t, { and, eq, or, isNull }) => and(or(eq(t.orgId, ctx.orgId), isNull(t.orgId)), eq(t.isActive, true)),
      orderBy: (t, { desc }) => desc(t.createdAt),
    })
  )

  const definitionEntries: FullCatalogEntry[] = definitions.map((d) => {
    const classifications = Array.isArray(d.classifications) ? (d.classifications as string[]) : []
    const domain: ReportDomain = classifications.includes("compliance")
      ? "compliance"
      : classifications.includes("financial") || classifications.includes("revenue")
        ? "ERP"
        : classifications.includes("construction") || classifications.includes("project")
          ? "construction"
          : "custom"
    return {
      id: d.id,
      name: d.name,
      description: d.description,
      domain,
      sourceService: "src/lib/services/report-engine-service.ts#executeReportDefinition",
      outputFormats: Array.isArray(d.outputFormats) ? (d.outputFormats as string[]) : ["table"],
      route: `/api/reports/definitions/${d.id}/run`,
      routeNote: d.status === "built" ? "Real, auth-required API endpoint (POST) executed by the generic Reports & Analysis Engine dispatcher." : `Not yet built -- ${d.dataGapNote ?? "status: " + d.status}`,
      directlyNavigable: false,
      category: d.category as ReportCategory,
      classifications,
      periodicity: d.periodicity ?? undefined,
      source: "definition",
      definitionId: d.id,
      status: d.status as "built" | "data_gap" | "planned",
    }
  })

  return [...staticEntries, ...definitionEntries]
}

export async function getFullReportCatalogByDomain(ctx: { orgId: string }): Promise<Record<ReportDomain, FullCatalogEntry[]>> {
  const all = await getFullReportCatalog(ctx)
  const byDomain: Record<ReportDomain, FullCatalogEntry[]> = { compliance: [], ERP: [], construction: [], "AI-ops": [], custom: [] }
  for (const entry of all) byDomain[entry.domain].push(entry)
  return byDomain
}
