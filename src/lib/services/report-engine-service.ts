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
//   - 'deterministic_aggregation' -- a generic group-by/count/sum/avg,
//     resolved through TABLE_REGISTRY (below) -- a hardcoded, code-
//     reviewed map from a definition's tableKey string to real Drizzle
//     table/column objects. This generalizes custom-report-service.ts's
//     per-entity switch into ONE reusable function+registry pair instead
//     of a switch-branch per entity, while staying exactly as safe: a
//     report_definitions row's JSON config can only ever resolve to a key
//     that exists in TABLE_REGISTRY, never an arbitrary table (that would
//     reopen the exact surface custom-report-service.ts's own header
//     explicitly rejected). Future waves ADD their own domain's tables as
//     new TABLE_REGISTRY entries -- this is genuinely executable through
//     the dispatcher, not left for callers to wire per-report.
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
  crmLeads, crmOpportunities, crmAccounts, crmContacts, crmSalesTargets, erpQuotations, erpSalesOrders, erpSalesInvoices, erpCustomers,
  salesReferrals, salesCommissionAccruals, veriMeetings,
  complianceItems, notices, risks, pmsIssues, pmsMilestones, incidents,
  constructionBoqs, constructionWorkProgressEntries, constructionAttendance, constructionLabourRoster,
  constructionRfis, constructionSubmittals, constructionPunchListItems, constructionChangeOrders,
  constructionSiteDiaries, constructionExpenseEntries, constructionActivities,
  constructionBoqLineItems, constructionMaterials,
  erpPurchaseOrders, erpSuppliers, erpStockLedgerEntries, erpBudgetLineItems, erpBudgets, erpCostCenters,
  erpContracts, erpContractBillingSchedules, erpReorderLevels,
  erpSalesInvoiceItems, erpItems, erpItemGroups,
  projects,
  interiorMoodBoards, interiorFfeItems, interiorFloorPlans, interiorFloorPlanRooms,
  interiorFurniturePlacements, interiorMaterials, users,
} from "@/lib/db"
import { withTenantContext, type TenantDb } from "@/lib/db/tenant-scoped"
import { and, eq, or, isNull, isNotNull, inArray, sql, gte, lt, lte, ilike, type SQL } from "drizzle-orm"
import type { AnyPgColumn, PgTable } from "drizzle-orm/pg-core"
import { resolveModelConfig } from "@/lib/orchestra-model-resolver"
import { callLLMJson, stripJsonFence } from "@/lib/llm-client"
import { recordOrchestraExecution } from "@/lib/orchestra-execution-logger"
import { enforcePolicy, refusalMessageFor, hasGroundingData } from "@/lib/policy-enforcement-engine"
import { DEFAULT_DOMAIN } from "@/lib/purpose-bound-ai"
import { validateClassifications, validatePeriodicity, REPORT_CATEGORY_VALUES, type ReportCategory } from "./report-taxonomy"
import { budgetVsActual, projectCompletionReport, revenueReport, expenseReport, projectPeriodReport } from "./construction-reports-service"
import { customerPaymentBehaviorReport, vendorPaymentBehaviorReport } from "./erp-invoicing-service"
import { getMaterialCostReport } from "./construction-materials-service"
import { listStockBalances } from "./erp-inventory-service"
import {
  tenderRegisterReport, tenderPipelineByStage, tenderWinLossReport, tenderCostingReport,
  boqSubmissionReport, preBidMeetingReport, emdTrackingReport, contractAwardReport,
} from "./construction-tender-service"
import {
  threeDDesignApprovalReport, designConsultationReport, designRevisionReport,
  furniturePackageReport, interiorPackageComparisonReport, modularKitchenSalesReport,
  roomWiseEstimateReport, wardrobeSalesReport,
} from "./interior-sales-package-service"
import { subledgerToGlReconciliation, SUBLEDGER_RECONCILIATION_TOLERANCE } from "./erp-financial-report-service"
import { calculateCriticalPath } from "./schedule-service"
import { REPORT_CATALOG, type ReportCatalogEntry, type ReportDomain } from "./report-catalog-service"
import { requireReportDomainEnabled, isReportDomainEnabledForOrg } from "./report-domain-enablement-service"
import { ServiceError } from "./compliance-service"
export { ServiceError }

// Priority 12 (OPEN-07 point 8 follow-on): report_definitions rows have no
// literal `domain` column (see schema.ts) -- domain is derived from
// classifications, the same inference getFullReportCatalog() already did
// inline. Extracted to a pure, exported, unit-testable function so
// executeReportDefinition()'s new branch-enablement gate (below) and the
// catalog merge use one identical rule, not two copies that could drift.
export function deriveReportDomainFromClassifications(classifications: string[]): ReportDomain {
  if (classifications.includes("compliance")) return "compliance"
  if (classifications.includes("financial") || classifications.includes("revenue")) return "ERP"
  if (classifications.includes("construction") || classifications.includes("project")) return "construction"
  return "custom"
}

export type ExecutionType = "deterministic_aggregation" | "deterministic_formula" | "ai_recipe" | "external_service"

// ─── execution_config shapes, one per ExecutionType ───────────────────────

export type AggregationConfig = {
  kind: "aggregation"
  /**
   * Priority 11 wave 2 (2026-07-13 catalog build-out): resolves against
   * TABLE_REGISTRY below so executeReportDefinition() can actually run this
   * definition end-to-end via runAggregation() -- previously
   * deterministic_aggregation had no dispatcher handler at all (only direct,
   * hand-coded callers could use runAggregation(), which needs real typed
   * Drizzle objects no report_definitions row could carry). Optional (not
   * required) purely so a minimal stub config keeps type-checking -- a row
   * without tableKey will 500 with a clear "cannot resolve which table"
   * error at run time rather than silently doing nothing, so this is never
   * a way to accidentally mark something 'built' without it actually
   * running. NOT an arbitrary table name: only keys that exist in
   * TABLE_REGISTRY (a code-reviewed, hardcoded map) resolve to anything,
   * exactly like custom-report-service.ts's GROUP_BY_FIELDS whitelist.
   */
  tableKey?: string
  /** Column key (must exist in TABLE_REGISTRY[tableKey].columns) to GROUP BY. Omit for a single ungrouped total. */
  groupByColumn?: string
  aggregation: "count" | "sum" | "avg"
  /** Column key to sum/avg -- required when aggregation is 'sum'|'avg', ignored for 'count'. */
  aggregationColumnKey?: string
  /** Optional single equality filter (e.g. status='open') -- still whitelist-only: columnKey must be a registered column, never an arbitrary string. */
  filterEquals?: { columnKey: string; value: string | number | boolean }
}
export type FormulaConfig = { kind: "formula"; formulaKey: string; params?: Record<string, unknown> }
export type AiRecipeConfig = {
  kind: "ai_recipe"
  promptKey: string
  groundingNote: string
  /**
   * Priority 11 wave 2: when set, and the caller doesn't already pass
   * params.groundingData, executeReportDefinition() auto-runs this against
   * the same TABLE_REGISTRY/runAggregation() whitelist deterministic_
   * aggregation uses, and feeds the real result to the LLM as grounding --
   * making an ai_recipe definition genuinely re-runnable end-to-end instead
   * of permanently depending on a caller that knows how to pre-query data
   * for it. Still bounded to one simple group-by/count/sum/avg query, same
   * honesty limits as deterministic_aggregation.
   */
  groundingQuery?: { tableKey: string; groupByColumn?: string; aggregation: "count" | "sum" | "avg"; aggregationColumnKey?: string; filterEquals?: { columnKey: string; value: string | number | boolean } }
}
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

// ─── Table registry (Priority 11 wave 2, 2026-07-13 catalog build-out) ────
// A whitelist of table+column objects deterministic_aggregation/ai_recipe's
// groundingQuery are allowed to resolve a string key against, so a
// report_definitions row's JSON config can actually be executed by
// executeReportDefinition() instead of only being runnable by a caller that
// separately imports the real Drizzle objects. This does NOT reopen an
// arbitrary-query surface: a tableKey/columnKey that isn't listed here
// throws immediately (ServiceError, 500) rather than resolving to anything,
// and runAggregation() itself is unchanged -- still a parameterized,
// injection-safe group-by/count/sum/avg, just resolved from a name instead
// of hand-imported per call site. Additive-only -- append new domain tables
// at the end, never rename/remove an existing key (report_definitions rows
// reference these keys by string in their jsonb execution_config, so a
// rename silently breaks every row that used the old key).
export type TableRegistryEntry = { table: PgTable; orgIdColumn: AnyPgColumn; columns: Record<string, AnyPgColumn> }

export const TABLE_REGISTRY: Record<string, TableRegistryEntry> = {
  compliance_items: { table: complianceItems, orgIdColumn: complianceItems.orgId, columns: { status: complianceItems.status, priority: complianceItems.priority, complianceType: complianceItems.complianceType, departmentId: complianceItems.departmentId } },
  notices: { table: notices, orgIdColumn: notices.orgId, columns: { status: notices.status, authority: notices.authority, departmentId: notices.departmentId } },
  risks: { table: risks, orgIdColumn: risks.orgId, columns: { status: risks.status, category: risks.category, likelihood: risks.likelihood, impact: risks.impact } },
  pms_issues: { table: pmsIssues, orgIdColumn: pmsIssues.orgId, columns: { statusId: pmsIssues.statusId, priority: pmsIssues.priority, projectId: pmsIssues.projectId } },
  incidents: { table: incidents, orgIdColumn: incidents.orgId, columns: { category: incidents.category, severity: incidents.severity, stage: incidents.stage } },
  construction_boqs: { table: constructionBoqs, orgIdColumn: constructionBoqs.orgId, columns: { status: constructionBoqs.status, projectId: constructionBoqs.projectId } },
  construction_work_progress_entries: { table: constructionWorkProgressEntries, orgIdColumn: constructionWorkProgressEntries.orgId, columns: { projectId: constructionWorkProgressEntries.projectId, activityId: constructionWorkProgressEntries.activityId, percentComplete: constructionWorkProgressEntries.percentComplete } },
  // dailyCost/attendanceDate whitelisted 2026-08-22 (Sumeet 8-report closure
  // pass): both are real, pre-existing columns (dailyCost already read via
  // raw SQL by computeContractorPerformanceReport below) -- adding them here
  // is what makes "Daily Cost Report" (group by attendanceDate, sum
  // dailyCost) resolvable through the generic deterministic_aggregation
  // path instead of needing a bespoke function. Grouping by `trade` still
  // isn't possible here (that column lives on construction_labour_roster,
  // one join away, and this engine is deliberately single-table) -- that
  // remains a real, separate gap, not silently worked around.
  construction_attendance: { table: constructionAttendance, orgIdColumn: constructionAttendance.orgId, columns: { projectId: constructionAttendance.projectId, status: constructionAttendance.status, rosterId: constructionAttendance.rosterId, dailyCost: constructionAttendance.dailyCost, attendanceDate: constructionAttendance.attendanceDate } },
  // -- new for the Owner's 30 Project Reports / 30 Analysis Dashboards / Executive KPI catalog (2026-07-13) --
  projects: { table: projects, orgIdColumn: projects.orgId, columns: { healthStatus: projects.healthStatus, isActive: projects.isActive } },
  pms_milestones: { table: pmsMilestones, orgIdColumn: pmsMilestones.orgId, columns: { status: pmsMilestones.status, projectId: pmsMilestones.projectId } },
  construction_rfis: { table: constructionRfis, orgIdColumn: constructionRfis.orgId, columns: { status: constructionRfis.status, projectId: constructionRfis.projectId, ballInCourt: constructionRfis.ballInCourt } },
  construction_submittals: { table: constructionSubmittals, orgIdColumn: constructionSubmittals.orgId, columns: { status: constructionSubmittals.status, projectId: constructionSubmittals.projectId, type: constructionSubmittals.type } },
  construction_punch_list_items: { table: constructionPunchListItems, orgIdColumn: constructionPunchListItems.orgId, columns: { status: constructionPunchListItems.status, projectId: constructionPunchListItems.projectId, priority: constructionPunchListItems.priority } },
  construction_change_orders: { table: constructionChangeOrders, orgIdColumn: constructionChangeOrders.orgId, columns: { status: constructionChangeOrders.status, projectId: constructionChangeOrders.projectId, costImpact: constructionChangeOrders.costImpact } },
  construction_site_diaries: { table: constructionSiteDiaries, orgIdColumn: constructionSiteDiaries.orgId, columns: { projectId: constructionSiteDiaries.projectId, weather: constructionSiteDiaries.weather } },
  construction_expense_entries: { table: constructionExpenseEntries, orgIdColumn: constructionExpenseEntries.orgId, columns: { projectId: constructionExpenseEntries.projectId, expenseHead: constructionExpenseEntries.expenseHead, amount: constructionExpenseEntries.amount } },
  // Priority 17 final gap (2026-07-16): companyId whitelisted now that
  // erp_purchase_orders/erp_quotations/erp_sales_orders carry the column
  // (see this table's own comment further down for the full whitelist
  // rationale established by #365's crm_leads/erp_sales_invoices entries).
  erp_purchase_orders: { table: erpPurchaseOrders, orgIdColumn: erpPurchaseOrders.orgId, columns: { status: erpPurchaseOrders.status, supplierId: erpPurchaseOrders.supplierId, grandTotal: erpPurchaseOrders.grandTotal, companyId: erpPurchaseOrders.companyId } },
  erp_suppliers: { table: erpSuppliers, orgIdColumn: erpSuppliers.orgId, columns: { qualificationStatus: erpSuppliers.qualificationStatus, sanctionScreeningStatus: erpSuppliers.sanctionScreeningStatus, trade: erpSuppliers.trade } },
  erp_stock_ledger_entries: { table: erpStockLedgerEntries, orgIdColumn: erpStockLedgerEntries.orgId, columns: { itemId: erpStockLedgerEntries.itemId, quantityChange: erpStockLedgerEntries.quantityChange } },
  // -- new for the Owner's 30 Sales Reports / 30 Sales Analysis / AI Sales Cockpit catalog (2026-07-13) --
  // Priority 17 remaining gap: companyId whitelisted here now that crm_leads
  // carries the column -- this is one of only 2 TABLE_REGISTRY entries whose
  // real table has a companyId column today (the other is erp_sales_invoices
  // below); every other entry's underlying table genuinely has no
  // company/office dimension, so companyId is deliberately NOT added to
  // their columns maps rather than faked.
  crm_leads: { table: crmLeads, orgIdColumn: crmLeads.orgId, columns: { status: crmLeads.status, source: crmLeads.source, ownerId: crmLeads.ownerId, aiScore: crmLeads.aiScore, companyId: crmLeads.companyId } },
  crm_opportunities: {
    table: crmOpportunities, orgIdColumn: crmOpportunities.orgId,
    columns: {
      stage: crmOpportunities.stage, ownerId: crmOpportunities.ownerId, estimatedValue: crmOpportunities.estimatedValue,
      aiWinProbability: crmOpportunities.aiWinProbability, aiRecommendedAction: crmOpportunities.aiRecommendedAction,
      expectedCloseDate: crmOpportunities.expectedCloseDate,
    },
  },
  // VERIDIAN Review Framework "Accounts & Contacts" gap-closure (Reporting &
  // Export Accuracy): crm_accounts/crm_contacts had no reportable surface
  // at all (unlike crm_leads/crm_opportunities just above) -- an org
  // couldn't build even a simple "accounts by lifecycle stage" or "contacts
  // per account" ad-hoc report via the Reports & Analysis Engine. Same
  // whitelist convention as every other entry in this registry.
  crm_accounts: {
    table: crmAccounts, orgIdColumn: crmAccounts.orgId,
    columns: {
      lifecycleStage: crmAccounts.lifecycleStage, ownerId: crmAccounts.ownerId, industry: crmAccounts.industry,
      companyId: crmAccounts.companyId, aiHealthScore: crmAccounts.aiHealthScore, parentAccountId: crmAccounts.parentAccountId,
    },
  },
  crm_contacts: {
    table: crmContacts, orgIdColumn: crmContacts.orgId,
    columns: { accountId: crmContacts.accountId, isPrimary: crmContacts.isPrimary },
  },
  // Priority 17 final gap: companyId whitelisted here now that erp_quotations
  // carries the column -- direct continuation of #365, which left this exact
  // gap unwired ("Sales/CRM beyond Leads ... those tables have no companyId
  // column in the schema").
  erp_quotations: { table: erpQuotations, orgIdColumn: erpQuotations.orgId, columns: { status: erpQuotations.status, customerId: erpQuotations.customerId, grandTotal: erpQuotations.grandTotal, quotationDate: erpQuotations.quotationDate, companyId: erpQuotations.companyId } },
  // Priority 17 final gap: same as erp_quotations above.
  erp_sales_orders: { table: erpSalesOrders, orgIdColumn: erpSalesOrders.orgId, columns: { status: erpSalesOrders.status, customerId: erpSalesOrders.customerId, grandTotal: erpSalesOrders.grandTotal, orderDate: erpSalesOrders.orderDate, companyId: erpSalesOrders.companyId } },
  erp_sales_invoices: { table: erpSalesInvoices, orgIdColumn: erpSalesInvoices.orgId, columns: { status: erpSalesInvoices.status, customerId: erpSalesInvoices.customerId, grandTotal: erpSalesInvoices.grandTotal, outstandingAmount: erpSalesInvoices.outstandingAmount, postingDate: erpSalesInvoices.postingDate, companyId: erpSalesInvoices.companyId } },
  erp_customers: { table: erpCustomers, orgIdColumn: erpCustomers.orgId, columns: { isActive: erpCustomers.isActive, defaultPaymentTermsDays: erpCustomers.defaultPaymentTermsDays, creditLimit: erpCustomers.creditLimit } },
  sales_referrals: { table: salesReferrals, orgIdColumn: salesReferrals.orgId, columns: { status: salesReferrals.status, salesPartnerId: salesReferrals.salesPartnerId, productKey: salesReferrals.productKey } },
  // meetingType='client' is a real but imperfect proxy for a "customer
  // meeting" -- veri_meetings has no dedicated sales/pre-sales flag, so any
  // report reading this table documents that limitation in its own
  // dataGapNote/description rather than silently overclaiming precision.
  veri_meetings: { table: veriMeetings, orgIdColumn: veriMeetings.orgId, columns: { meetingType: veriMeetings.meetingType, contextEntityType: veriMeetings.contextEntityType } },
  // -- 2026-08-22 (Sumeet 8-report closure pass) --
  // construction_boq_line_items had NO org_id column at all until migration
  // add_org_id_to_construction_boq_line_items (this pass) added one,
  // denormalized from construction_boqs.org_id and backfilled -- required
  // because runAggregation()'s WHERE clause needs a real orgIdColumn on the
  // table it queries; RLS alone (the EXISTS-against-construction_boqs
  // policy) already enforced isolation but gave this generic single-table
  // engine nothing to filter on directly. "Cost Report by Scope" reads this:
  // amount summed, grouped by description (each line item IS a scope/work
  // item) -- a real, populated table (179 rows for the demo org's projects).
  construction_boq_line_items: { table: constructionBoqLineItems, orgIdColumn: constructionBoqLineItems.orgId, columns: { boqId: constructionBoqLineItems.boqId, description: constructionBoqLineItems.description, unit: constructionBoqLineItems.unit, amount: constructionBoqLineItems.amount, quantity: constructionBoqLineItems.quantity, rate: constructionBoqLineItems.rate } },
  // construction_materials (point 33) IS correctly structured (real orgId
  // column, same shape as every other entry) -- registered here so
  // "Cost Report by Material" no longer 500s with "not registered in
  // TABLE_REGISTRY". Left here for when data exists: the table has 0 rows
  // for EVERY org today (not just the demo org), so this report_definitions
  // row's status is deliberately NOT flipped to 'built' in this pass --
  // doing so would produce an empty report that LOOKS built but isn't
  // provably correct (do_not_assume rule 2, 2026-08-22 Sumeet pass).
  construction_materials: { table: constructionMaterials, orgIdColumn: constructionMaterials.orgId, columns: { projectId: constructionMaterials.projectId, name: constructionMaterials.name, unit: constructionMaterials.unit, unitCost: constructionMaterials.unitCost, isActive: constructionMaterials.isActive } },
}

function resolveAggregationTarget(config: { tableKey?: string; groupByColumn?: string; aggregationColumnKey?: string; filterEquals?: { columnKey: string; value: string | number | boolean } }) {
  if (!config.tableKey) throw new ServiceError("Aggregation config has no tableKey set -- cannot resolve which table to query.", 500)
  const entry = TABLE_REGISTRY[config.tableKey]
  if (!entry) throw new ServiceError(`No table registered in TABLE_REGISTRY for key "${config.tableKey}".`, 500)
  const groupByColumn = config.groupByColumn ? entry.columns[config.groupByColumn] : null
  if (config.groupByColumn && !groupByColumn) throw new ServiceError(`Column "${config.groupByColumn}" is not whitelisted for table "${config.tableKey}".`, 500)
  const aggregationColumn = config.aggregationColumnKey ? entry.columns[config.aggregationColumnKey] : undefined
  if (config.aggregationColumnKey && !aggregationColumn) throw new ServiceError(`Column "${config.aggregationColumnKey}" is not whitelisted for table "${config.tableKey}".`, 500)
  let filterColumn: AnyPgColumn | undefined
  if (config.filterEquals) {
    filterColumn = entry.columns[config.filterEquals.columnKey]
    if (!filterColumn) throw new ServiceError(`Column "${config.filterEquals.columnKey}" is not whitelisted for table "${config.tableKey}".`, 500)
  }
  return { entry, groupByColumn: groupByColumn ?? null, aggregationColumn, filterColumn }
}

/**
 * Read-only metadata view of TABLE_REGISTRY (table keys + their whitelisted
 * column keys) -- safe to hand to a client (e.g. custom-chart-service.ts's
 * dataset picker) because it exposes only string keys, never the real
 * Drizzle table/column objects themselves. Priority 13 (self-serve ad-hoc
 * BI): this is what lets the chart-builder UI list "which datasets can I
 * build a chart from" without duplicating TABLE_REGISTRY's contents by hand.
 */
export function getTableRegistryMetadata(): Record<string, { columns: string[] }> {
  return Object.fromEntries(
    Object.entries(TABLE_REGISTRY).map(([key, entry]) => [key, { columns: Object.keys(entry.columns) }])
  )
}

/**
 * The real execution path for a deterministic_aggregation report_definitions
 * row -- resolves its config against TABLE_REGISTRY and runs it through
 * runAggregation(). Priority 13: also the direct executor custom-chart-
 * service.ts reuses for ad-hoc charts (exported, not duplicated).
 *
 * Priority 17 remaining gap: `runtimeScope.companyId` is a CALLER-supplied
 * filter (e.g. a UI company/office selector), distinct from the
 * definition's own stored `config.filterEquals` -- silently a no-op (never
 * a 500) when the resolved table has no companyId column whitelisted in
 * TABLE_REGISTRY, since most tables genuinely have no company dimension and
 * a caller passing companyId "just in case" shouldn't break the report.
 */
// AI Architecture / Explainability & Transparency gap-closure (2026-07-18):
// "Explain Reports & Dashboards" -- deterministic_aggregation rows (110/204,
// 54% of report_definitions) previously returned {columns,rows} with zero
// `note` at all, the only executionType with no explanation whatsoever (see
// PROGRESS.md for the full before/after coverage numbers). This generates a
// real, config-derived note for every aggregation run instead -- what table
// it queried, how it grouped/aggregated, and any filters actually applied --
// rather than a static placeholder, since the real config is right here.
export function buildAggregationNote(
  config: { tableKey?: string; groupByColumn?: string; aggregation: "count" | "sum" | "avg"; aggregationColumnKey?: string; filterEquals?: { columnKey: string; value: string | number | boolean } },
  runtimeScope?: { companyId?: string }
): string {
  const aggLabel = config.aggregation === "count" ? "Count of records" : config.aggregation === "sum" ? `Sum of "${config.aggregationColumnKey}"` : `Average of "${config.aggregationColumnKey}"`
  const groupedBy = config.groupByColumn ? `grouped by "${config.groupByColumn}"` : "as a single ungrouped total"
  const filters: string[] = []
  if (config.filterEquals) filters.push(`"${config.filterEquals.columnKey}" = ${JSON.stringify(config.filterEquals.value)}`)
  if (runtimeScope?.companyId) filters.push(`company = ${runtimeScope.companyId}`)
  const filterClause = filters.length > 0 ? `, filtered to rows where ${filters.join(" and ")}` : ""
  return `${aggLabel} from "${config.tableKey}", ${groupedBy}${filterClause}, scoped to your organisation only.`
}

export async function runAggregationFromConfig(ctx: { orgId: string }, config: AggregationConfig, runtimeScope?: { companyId?: string }): Promise<ReportDefinitionResult> {
  const { entry, groupByColumn, aggregationColumn, filterColumn } = resolveAggregationTarget(config)
  const whereClauses: SQL[] = []
  if (filterColumn && config.filterEquals) whereClauses.push(eq(filterColumn, config.filterEquals.value))
  if (runtimeScope?.companyId && entry.columns.companyId) whereClauses.push(eq(entry.columns.companyId, runtimeScope.companyId))
  const extraWhere = whereClauses.length > 0 ? and(...whereClauses) : undefined
  return withTenantContext({ orgId: ctx.orgId }, async (db) => {
    const rows = await runAggregation(db, {
      table: entry.table, orgIdColumn: entry.orgIdColumn, orgId: ctx.orgId,
      groupByColumn, aggregation: config.aggregation, aggregationColumn, extraWhere,
    })
    const groupLabel = config.groupByColumn ?? "Group"
    return {
      columns: [groupLabel, "Value"],
      rows: rows.map((r) => ({ [groupLabel]: String(r.groupValue), Value: r.value })),
      note: buildAggregationNote(config, runtimeScope?.companyId && entry.columns.companyId ? runtimeScope : undefined),
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
  // R67 E-06 (R-108): budgetVsActual().budget is the BOQ-derived budget now,
  // and null (not 0) when the project has no BOQ -- the same "cannot compute"
  // branch this guard already had, reached for the honest reason.
  if (budget.budget === null || budget.budget <= 0) {
    return { columns: ["Metric", "Value"], rows: [{ Metric: "CPI", Value: "N/A" }], note: "Project has no BOQ budget set -- cannot compute Earned Value." }
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

// ─── Priority 11 wave 2 formulas (2026-07-13, Owner's 30 Project Reports /
// 30 Analysis Dashboards / Executive KPI catalog). Same honesty discipline
// as the 3 formulas above -- every approximation is documented, every "N/A"
// case is a real data-gap explanation, not a fabricated number. Most are
// org-wide (not scoped to one project) because Executive/portfolio-level
// KPIs are the actual ask; the project-scoped ones take params.projectId.

/** Backs 3 catalog rows (Schedule Variance / Cost Variance / Earned Value Analysis) -- all three are genuinely the same PV/EV/AC computation, just read differently. Reuses the exact PV/EV approximations documented on computeSpi/computeCpi above. */
async function computeEarnedValueAnalysis(ctx: { orgId: string }, params: Record<string, unknown>): Promise<ReportDefinitionResult> {
  const projectId = String(params.projectId ?? "")
  if (!projectId) throw new ServiceError("projectId is required for the Earned Value Analysis formula", 400)
  return withTenantContext({ orgId: ctx.orgId }, async (db) => {
    const project = await db.query.projects.findFirst({ where: (t, { and, eq }) => and(eq(t.id, projectId), eq(t.orgId, ctx.orgId)) })
    if (!project) throw new ServiceError("Project not found", 404)
    if (!project.startDate || !project.targetDate) {
      return { columns: ["Metric", "Value"], rows: [{ Metric: "Earned Value Analysis", Value: "N/A" }], note: "Project has no startDate/targetDate set -- cannot compute a time-linear Planned Value baseline." }
    }
    const [budget, completion] = await Promise.all([budgetVsActual(ctx, projectId), projectCompletionReport(ctx, projectId)])
    // R67 E-06: same null-or-zero guard as computeCpi above.
    if (budget.budget === null || budget.budget <= 0) {
      return { columns: ["Metric", "Value"], rows: [{ Metric: "Earned Value Analysis", Value: "N/A" }], note: "Project has no BOQ budget set -- cannot compute Planned/Earned Value in cost terms." }
    }
    const start = new Date(project.startDate).getTime()
    const target = new Date(project.targetDate).getTime()
    const totalMs = target - start
    const plannedPercent = totalMs <= 0 ? 100 : Math.max(0, Math.min(100, ((Date.now() - start) / totalMs) * 100))
    const pv = budget.budget * (plannedPercent / 100)
    const ev = budget.budget * (completion.overallPercentComplete / 100)
    const ac = budget.actual
    return {
      columns: ["Metric", "Value"],
      rows: [
        { Metric: "Planned Value (PV)", Value: Math.round(pv) },
        { Metric: "Earned Value (EV)", Value: Math.round(ev) },
        { Metric: "Actual Cost (AC)", Value: Math.round(ac) },
        { Metric: "Schedule Variance (SV = EV-PV)", Value: Math.round(ev - pv) },
        { Metric: "Cost Variance (CV = EV-AC)", Value: Math.round(ev - ac) },
      ],
      note: "PV uses the same linear time-elapsed proxy as the SPI formula; EV uses the same Budget x %-Complete (BCWP) proxy as the CPI formula -- this codebase has no baseline S-curve or per-activity budget breakdown for textbook-precise EVM.",
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

/** Org-wide average of each construction activity's latest logged percent_complete -- the portfolio-level "Overall Completion %" executive KPI. */
async function computePortfolioCompletionPercent(ctx: { orgId: string }): Promise<ReportDefinitionResult> {
  return withTenantContext({ orgId: ctx.orgId }, async (db) => {
    const activities = await db.query.constructionActivities.findMany({ where: eq(constructionActivities.orgId, ctx.orgId), columns: { id: true } })
    if (activities.length === 0) return { columns: ["Metric", "Value"], rows: [{ Metric: "Overall Completion %", Value: 0 }], note: "No construction activities logged for this organisation yet." }
    const ids = activities.map((a) => a.id)
    const idsSql = sql.join(ids.map((id) => sql`${id}`), sql`, `)
    const rows = (await db.execute(sql`
      SELECT DISTINCT ON (activity_id) activity_id, percent_complete
      FROM compliance.construction_work_progress_entries
      WHERE activity_id = ANY(ARRAY[${idsSql}])
      ORDER BY activity_id, entry_date DESC
    `)) as unknown as { activity_id: string; percent_complete: number }[]
    const avg = rows.length > 0 ? rows.reduce((s, r) => s + Number(r.percent_complete), 0) / rows.length : 0
    return { columns: ["Metric", "Value"], rows: [{ Metric: "Overall Completion % (org-wide average of each activity's latest log)", Value: Math.round(avg) }], note: "Simple average of each activity's latest logged percent_complete -- not weighted by BOQ value or activity size." }
  })
}

/** Org-wide budget utilization -- sums erp_budget_line_items for cost centres linked to a construction project, vs total construction_expense_entries. */
async function computePortfolioBudgetUtilization(ctx: { orgId: string }): Promise<ReportDefinitionResult> {
  return withTenantContext({ orgId: ctx.orgId }, async (db) => {
    const [budgetRow] = await db.select({ total: sql<number>`coalesce(sum(${erpBudgetLineItems.annualAmount}), 0)::float` })
      .from(erpBudgetLineItems)
      .innerJoin(erpBudgets, eq(erpBudgetLineItems.budgetId, erpBudgets.id))
      .innerJoin(erpCostCenters, eq(erpBudgets.costCenterId, erpCostCenters.id))
      .where(and(eq(erpBudgets.orgId, ctx.orgId), sql`${erpCostCenters.projectId} is not null`))
    const [actualRow] = await db.select({ total: sql<number>`coalesce(sum(${constructionExpenseEntries.amount}), 0)::float` })
      .from(constructionExpenseEntries).where(eq(constructionExpenseEntries.orgId, ctx.orgId))
    const budgetTotal = Number(budgetRow?.total ?? 0)
    const actualTotal = Number(actualRow?.total ?? 0)
    if (budgetTotal <= 0) return { columns: ["Metric", "Value"], rows: [{ Metric: "Budget Utilized %", Value: "N/A" }], note: "No project-linked budget line items exist for this organisation's cost centres yet." }
    return {
      columns: ["Metric", "Value"],
      rows: [
        { Metric: "Total Budget (project-linked cost centres)", Value: Math.round(budgetTotal) },
        { Metric: "Total Actual Expense", Value: Math.round(actualTotal) },
        { Metric: "Budget Utilized %", Value: Math.round((actualTotal / budgetTotal) * 1000) / 10 },
      ],
      note: "Scoped to cost centres linked to a construction project (erp_cost_centers.project_id not null); actual cost is construction_expense_entries only, not the full ERP purchase-invoice ledger.",
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

/** Today's logged site progress, org-wide, grouped by project. */
async function computeTodaysSiteProgress(ctx: { orgId: string }): Promise<ReportDefinitionResult> {
  return withTenantContext({ orgId: ctx.orgId }, async (db) => {
    const today = new Date().toISOString().slice(0, 10)
    const rows = await db.select({
      projectId: constructionWorkProgressEntries.projectId,
      entries: sql<number>`count(*)`,
      totalQuantity: sql<number>`coalesce(sum(${constructionWorkProgressEntries.quantityDone}), 0)::float`,
    }).from(constructionWorkProgressEntries)
      .where(and(eq(constructionWorkProgressEntries.orgId, ctx.orgId), eq(constructionWorkProgressEntries.entryDate, today)))
      .groupBy(constructionWorkProgressEntries.projectId)
    return { columns: ["Project ID", "Entries Logged Today", "Total Quantity Done Today"], rows: rows.map((r) => ({ "Project ID": r.projectId, "Entries Logged Today": Number(r.entries), "Total Quantity Done Today": Number(r.totalQuantity) })), note: rows.length === 0 ? "No progress entries logged for today's date yet." : undefined }
  })
}

/**
 * Weekly Project Report (2026-08-22, Sumeet 8-report closure pass) -- a
 * genuinely new formula, NOT a repoint of computeTodaysSiteProgress above.
 * That function is hardcoded to entryDate = today with no projectId/date
 * params at all, and other report_definitions rows may already depend on
 * its exact today-only behaviour (todays_site_progress formulaKey) -- this
 * function is additive so nothing that already calls that one breaks.
 *
 * Params: `projectId` (optional -- omit for an org-wide/all-projects
 * breakdown, same posture as computeTodaysSiteProgress); `weekEnding`
 * (optional ISO date string, defaults to today) -- the 7-day window is
 * [weekEnding - 6 days, weekEnding], inclusive, entryDate-based (real
 * column on construction_work_progress_entries). Grouped by project so a
 * multi-project org gets one row per project, matching the existing
 * "today" formula's own shape.
 */
async function computeWeeklyProjectReport(ctx: { orgId: string }, params: Record<string, unknown>): Promise<ReportDefinitionResult> {
  const projectId = typeof params.projectId === "string" && params.projectId ? params.projectId : undefined
  const weekEndingRaw = typeof params.weekEnding === "string" && params.weekEnding ? params.weekEnding : new Date().toISOString().slice(0, 10)
  const weekEndingDate = new Date(`${weekEndingRaw}T00:00:00Z`)
  if (Number.isNaN(weekEndingDate.getTime())) throw new ServiceError(`Invalid weekEnding date: "${weekEndingRaw}"`, 400)
  const weekStartDate = new Date(weekEndingDate.getTime() - 6 * 24 * 60 * 60 * 1000)
  const weekStart = weekStartDate.toISOString().slice(0, 10)
  const weekEnding = weekEndingDate.toISOString().slice(0, 10)

  return withTenantContext({ orgId: ctx.orgId }, async (db) => {
    const whereClauses = [
      eq(constructionWorkProgressEntries.orgId, ctx.orgId),
      gte(constructionWorkProgressEntries.entryDate, weekStart),
      lte(constructionWorkProgressEntries.entryDate, weekEnding),
    ]
    if (projectId) whereClauses.push(eq(constructionWorkProgressEntries.projectId, projectId))

    const rows = await db.select({
      projectId: constructionWorkProgressEntries.projectId,
      entries: sql<number>`count(*)`,
      totalQuantity: sql<number>`coalesce(sum(${constructionWorkProgressEntries.quantityDone}), 0)::float`,
      avgPercentComplete: sql<number>`coalesce(avg(${constructionWorkProgressEntries.percentComplete}), 0)::float`,
    }).from(constructionWorkProgressEntries)
      .where(and(...whereClauses))
      .groupBy(constructionWorkProgressEntries.projectId)

    return {
      columns: ["Project ID", "Entries Logged This Week", "Total Quantity Done This Week", "Avg % Complete Logged This Week"],
      rows: rows.map((r) => ({
        "Project ID": r.projectId,
        "Entries Logged This Week": Number(r.entries),
        "Total Quantity Done This Week": Number(r.totalQuantity),
        "Avg % Complete Logged This Week": Math.round(Number(r.avgPercentComplete) * 10) / 10,
      })),
      note: `Window: ${weekStart} to ${weekEnding} inclusive (entryDate-based)${projectId ? `, filtered to project ${projectId}` : ", all projects"}. ${rows.length === 0 ? "No progress entries logged in this window." : ""}`.trim(),
    }
  })
}

/** Labour marked present today, org-wide, grouped by project. */
async function computeLabourOnSiteToday(ctx: { orgId: string }): Promise<ReportDefinitionResult> {
  return withTenantContext({ orgId: ctx.orgId }, async (db) => {
    const today = new Date().toISOString().slice(0, 10)
    const rows = await db.select({
      projectId: constructionAttendance.projectId,
      count: sql<number>`count(*)`,
    }).from(constructionAttendance)
      .where(and(eq(constructionAttendance.orgId, ctx.orgId), eq(constructionAttendance.attendanceDate, today), eq(constructionAttendance.status, "present")))
      .groupBy(constructionAttendance.projectId)
    return { columns: ["Project ID", "Labour Present Today"], rows: rows.map((r) => ({ "Project ID": r.projectId, "Labour Present Today": Number(r.count) })), note: rows.length === 0 ? "No attendance recorded for today's date yet." : undefined }
  })
}

/** Purchase orders past their expected delivery date and not yet completed/cancelled, grouped by supplier. Backs both the "Vendors Delayed" KPI and the "Procurement Delay Analysis" dashboard. */
async function computeVendorsDelayedPurchaseOrders(ctx: { orgId: string }): Promise<ReportDefinitionResult> {
  return withTenantContext({ orgId: ctx.orgId }, async (db) => {
    const today = new Date().toISOString().slice(0, 10)
    const rows = await db.select({
      supplierId: erpPurchaseOrders.supplierId,
      overdueCount: sql<number>`count(*)`,
      overdueValue: sql<number>`coalesce(sum(${erpPurchaseOrders.grandTotal}), 0)::float`,
    }).from(erpPurchaseOrders)
      .where(and(eq(erpPurchaseOrders.orgId, ctx.orgId), sql`${erpPurchaseOrders.expectedDeliveryDate} < ${today}`, sql`${erpPurchaseOrders.status} not in ('completed', 'cancelled')`))
      .groupBy(erpPurchaseOrders.supplierId)
    return { columns: ["Supplier ID", "Overdue PO Count", "Overdue PO Value"], rows: rows.map((r) => ({ "Supplier ID": r.supplierId, "Overdue PO Count": Number(r.overdueCount), "Overdue PO Value": Number(r.overdueValue) })), note: "Overdue = expected_delivery_date in the past and status not yet completed/cancelled -- no separate 'delayed' flag exists on the PO row itself." }
  })
}

/** Safety-category incidents logged this calendar month, grouped by severity. */
async function computeSafetyIncidentsThisMonth(ctx: { orgId: string }): Promise<ReportDefinitionResult> {
  return withTenantContext({ orgId: ctx.orgId }, async (db) => {
    const now = new Date()
    const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1))
    const rows = await db.select({ severity: incidents.severity, count: sql<number>`count(*)` })
      .from(incidents)
      .where(and(eq(incidents.orgId, ctx.orgId), eq(incidents.category, "Safety"), gte(incidents.createdAt, monthStart)))
      .groupBy(incidents.severity)
    return { columns: ["Severity", "Count"], rows: rows.map((r) => ({ Severity: r.severity, Count: Number(r.count) })), note: rows.length === 0 ? "No incidents logged with category='Safety' this month." : undefined }
  })
}

/** Org-wide labour-vendor cost + attendance, joined by vendor -- the org-wide counterpart to the per-project Vendor Cost Report. Cost/attendance-based, not a quality or on-time-delivery score (no such tracking exists for labour subcontractors). */
async function computeContractorPerformanceReport(ctx: { orgId: string }): Promise<ReportDefinitionResult> {
  return withTenantContext({ orgId: ctx.orgId }, async (db) => {
    const rows = await db.select({
      vendorId: constructionLabourRoster.vendorId,
      totalCost: sql<number>`coalesce(sum(${constructionAttendance.dailyCost}), 0)::float`,
      workerDays: sql<number>`count(*)`,
      presentDays: sql<number>`count(*) filter (where ${constructionAttendance.status} = 'present')`,
    }).from(constructionAttendance)
      .innerJoin(constructionLabourRoster, eq(constructionAttendance.rosterId, constructionLabourRoster.id))
      .where(and(eq(constructionAttendance.orgId, ctx.orgId), sql`${constructionLabourRoster.vendorId} is not null`))
      .groupBy(constructionLabourRoster.vendorId)
    return {
      columns: ["Vendor ID", "Total Labour Cost", "Worker-Days", "Present Days"],
      rows: rows.map((r) => ({ "Vendor ID": r.vendorId ?? "unknown", "Total Labour Cost": Number(r.totalCost), "Worker-Days": Number(r.workerDays), "Present Days": Number(r.presentDays) })),
      note: "Org-wide (all projects) version of the per-project Vendor Cost Report -- cost/attendance-based, not a quality or on-time-delivery score (no such tracking exists for labour subcontractors).",
    }
  })
}

/**
 * Labour Productivity Analysis (R65 gap closure, 2026-08-31). Was
 * status='data_gap' with note: "No per-worker output linkage exists between
 * construction_attendance (labour input, by roster entry) and
 * construction_work_progress_entries (quantity output, by activity) --
 * activities are not assigned to specific workers." Verified fresh against
 * the live schema -- that's still true and stays true after this fix:
 * construction_attendance has no activityId/taskId column (it's recorded by
 * a supervisor/foreman against a roster entry, not against what that worker
 * built that day -- see that table's own header comment above), so a real
 * per-WORKER output metric genuinely cannot be built from this schema
 * without a new column. NOT worked around here by inventing one.
 *
 * What IS real and buildable with NO new schema: a PROJECT-level labour
 * productivity metric -- the standard way this KPI is reported in practice
 * once a workforce isn't individually task-tracked ("value of work put in
 * place per worker-day deployed"). Two real, independently-grouped
 * aggregates, joined only by projectId in JS after grouping -- deliberately
 * NOT a single row-level SQL join of attendance to progress entries, which
 * would fan out every attendance row across every progress entry in the
 * same project (and vice versa), inflating both totals:
 *   - Labour input: construction_attendance -- worker-days (present=1,
 *     half_day=0.5, absent=0, the same convention dailyCost already uses at
 *     write time) and total labour cost.
 *   - Output: construction_work_progress_entries, valued in currency
 *     (quantity_done x its BOQ line's rate) rather than summed as raw
 *     quantity -- activities on one project are measured in different units
 *     (sqm/cum/nos/...), so summing quantity_done across activities would
 *     be dimensionally meaningless. Only entryBasis='DELTA' rows count
 *     (SNAPSHOT is a cumulative reading, not an additive period quantity --
 *     the same discipline construction-dashboard-service.ts's own
 *     earned-value query already applies), and only rows with a
 *     boq_line_item_id (nullable -- an entry logged against an activity
 *     with no BOQ line link has no rate to value it by, and is honestly
 *     excluded rather than guessed at).
 *
 * Params: `projectId` (optional -- omit for an org-wide per-project
 * breakdown). `periodStart`/`periodEnd` (optional ISO dates, inclusive) --
 * omit both for all-time totals (the default). Real live data confirms why
 * that's the right default: attendance and BOQ-valued progress entries are
 * logged on independent cadences (e.g. one real project's attendance rows
 * span 2026-07-06..07-13 while its progress rows span 2026-08-01..08-20,
 * zero overlap), so a hardcoded trailing-window would silently return zero
 * far more often than not; a caller who wants one real window passes it.
 */
async function computeLabourProductivityAnalysis(ctx: { orgId: string }, params: Record<string, unknown>): Promise<ReportDefinitionResult> {
  const projectId = typeof params.projectId === "string" && params.projectId ? params.projectId : undefined
  const periodStart = typeof params.periodStart === "string" && params.periodStart ? params.periodStart : undefined
  const periodEnd = typeof params.periodEnd === "string" && params.periodEnd ? params.periodEnd : undefined

  return withTenantContext({ orgId: ctx.orgId }, async (db) => {
    const attendanceWhere = [eq(constructionAttendance.orgId, ctx.orgId)]
    if (projectId) attendanceWhere.push(eq(constructionAttendance.projectId, projectId))
    if (periodStart) attendanceWhere.push(gte(constructionAttendance.attendanceDate, periodStart))
    if (periodEnd) attendanceWhere.push(lte(constructionAttendance.attendanceDate, periodEnd))

    const progressWhere = [
      eq(constructionWorkProgressEntries.orgId, ctx.orgId),
      eq(constructionWorkProgressEntries.entryBasis, "DELTA"),
    ]
    if (projectId) progressWhere.push(eq(constructionWorkProgressEntries.projectId, projectId))
    if (periodStart) progressWhere.push(gte(constructionWorkProgressEntries.entryDate, periodStart))
    if (periodEnd) progressWhere.push(lte(constructionWorkProgressEntries.entryDate, periodEnd))

    const [labourRows, outputRows] = await Promise.all([
      db.select({
        projectId: constructionAttendance.projectId,
        workerDays: sql<number>`coalesce(sum(case when ${constructionAttendance.status} = 'present' then 1 when ${constructionAttendance.status} = 'half_day' then 0.5 else 0 end), 0)::float`,
        labourCost: sql<number>`coalesce(sum(${constructionAttendance.dailyCost}), 0)::float`,
      }).from(constructionAttendance).where(and(...attendanceWhere)).groupBy(constructionAttendance.projectId),

      db.select({
        projectId: constructionWorkProgressEntries.projectId,
        valueOfWorkDone: sql<number>`coalesce(sum(${constructionWorkProgressEntries.quantityDone}::numeric * ${constructionBoqLineItems.rate}::numeric), 0)::float`,
      }).from(constructionWorkProgressEntries)
        .innerJoin(constructionBoqLineItems, eq(constructionWorkProgressEntries.boqLineItemId, constructionBoqLineItems.id))
        .where(and(...progressWhere))
        .groupBy(constructionWorkProgressEntries.projectId),
    ])

    const byProject = new Map<string, { workerDays: number; labourCost: number; valueOfWorkDone: number }>()
    for (const r of labourRows) byProject.set(r.projectId, { workerDays: Number(r.workerDays), labourCost: Number(r.labourCost), valueOfWorkDone: 0 })
    for (const r of outputRows) {
      const existing = byProject.get(r.projectId)
      if (existing) existing.valueOfWorkDone = Number(r.valueOfWorkDone)
      else byProject.set(r.projectId, { workerDays: 0, labourCost: 0, valueOfWorkDone: Number(r.valueOfWorkDone) })
    }

    const columns = ["Project ID", "Worker-Days", "Labour Cost", "Value of Work Progressed (BOQ-valued)", "Value Progressed per Worker-Day", "Labour Cost as % of Value Progressed"]

    if (byProject.size === 0) {
      return { columns, rows: [], note: `No attendance or BOQ-valued progress entries found${projectId ? ` for project ${projectId}` : ""}${periodStart || periodEnd ? " in the given period" : ""}.` }
    }

    const rows = Array.from(byProject.entries()).map(([pid, v]) => ({
      "Project ID": pid,
      "Worker-Days": Math.round(v.workerDays * 10) / 10,
      "Labour Cost": Math.round(v.labourCost),
      "Value of Work Progressed (BOQ-valued)": Math.round(v.valueOfWorkDone),
      "Value Progressed per Worker-Day": v.workerDays > 0 ? Math.round(v.valueOfWorkDone / v.workerDays) : "N/A",
      "Labour Cost as % of Value Progressed": v.valueOfWorkDone > 0 ? Math.round((v.labourCost / v.valueOfWorkDone) * 1000) / 10 : "N/A",
    }))

    return {
      columns,
      rows,
      note: "Project-level productivity, not per-worker: construction_attendance records labour by roster entry with no activity/task link, so output cannot be traced to an individual worker from this schema. Output is valued in currency (quantity_done x the BOQ line's rate) rather than summed in physical units, since activities on the same project use different units (sqm/cum/nos/...); only DELTA-basis entries with a linked BOQ line item are counted -- SNAPSHOT entries and activity-only entries with no boq_line_item_id are excluded (no rate to value them by) rather than guessed at.",
    }
  })
}

/** Monthly trend of punch-list/snag items raised, org-wide. */
async function computeSnagTrendAnalysis(ctx: { orgId: string }): Promise<ReportDefinitionResult> {
  return withTenantContext({ orgId: ctx.orgId }, async (db) => {
    const rows = (await db.execute(sql`
      SELECT to_char(date_trunc('month', created_at), 'YYYY-MM') AS month, count(*)::int AS count
      FROM compliance.construction_punch_list_items
      WHERE org_id = ${ctx.orgId}
      GROUP BY 1 ORDER BY 1
    `)) as unknown as { month: string; count: number }[]
    return { columns: ["Month", "Snags Raised"], rows: rows.map((r) => ({ Month: r.month, "Snags Raised": Number(r.count) })), note: rows.length === 0 ? "No punch-list/snag items logged for this organisation yet." : undefined }
  })
}

/** Open risks grouped by (likelihood, impact) cell -- a real 2-axis heat map, org-wide (compliance.risks has no project_id column). */
async function computeRiskHeatMap(ctx: { orgId: string }): Promise<ReportDefinitionResult> {
  return withTenantContext({ orgId: ctx.orgId }, async (db) => {
    const rows = await db.select({ likelihood: risks.likelihood, impact: risks.impact, count: sql<number>`count(*)` })
      .from(risks).where(and(eq(risks.orgId, ctx.orgId), eq(risks.status, "open")))
      .groupBy(risks.likelihood, risks.impact)
    return {
      columns: ["Likelihood", "Impact", "Count"],
      rows: rows.map((r) => ({ Likelihood: Number(r.likelihood), Impact: Number(r.impact), Count: Number(r.count) })),
      note: "Org-wide risk register (compliance.risks) has no project_id column -- this heat map is organisation-wide, not filterable to a single project.",
    }
  })
}

/** Average closure time for the 2 real closure-timestamp pairs this schema has: punch-list verification and RFI response. pms_issues has no closed_at column so general task closure time isn't included. */
async function computeIssueResolutionAnalysis(ctx: { orgId: string }): Promise<ReportDefinitionResult> {
  return withTenantContext({ orgId: ctx.orgId }, async (db) => {
    const snagRows = (await db.execute(sql`
      SELECT avg(extract(epoch from (verified_at - created_at)) / 86400)::float AS avg_days
      FROM compliance.construction_punch_list_items
      WHERE org_id = ${ctx.orgId} AND status = 'verified_closed' AND verified_at IS NOT NULL
    `)) as unknown as { avg_days: number | null }[]
    const rfiRows = (await db.execute(sql`
      SELECT avg(extract(epoch from (answered_at - created_at)) / 86400)::float AS avg_days
      FROM compliance.construction_rfis
      WHERE org_id = ${ctx.orgId} AND answered_at IS NOT NULL
    `)) as unknown as { avg_days: number | null }[]
    const snagAvg = snagRows[0]?.avg_days
    const rfiAvg = rfiRows[0]?.avg_days
    return {
      columns: ["Metric", "Average Days"],
      rows: [
        { Metric: "Avg Snag/Punch-List Closure Time (days)", "Average Days": snagAvg != null ? Math.round(snagAvg * 10) / 10 : "N/A" },
        { Metric: "Avg RFI Response Time (days)", "Average Days": rfiAvg != null ? Math.round(rfiAvg * 10) / 10 : "N/A" },
      ],
      note: "Scoped to the 2 real closure-timestamp pairs in this schema (punch_list_items.verified_at / rfis.answered_at) -- pms_issues has no closed_at column so general task closure time isn't included.",
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

/** Average decision time for submittals and change orders -- only covers decisions actually made, doesn't include still-pending items. */
async function computeApprovalBottleneckAnalysis(ctx: { orgId: string }): Promise<ReportDefinitionResult> {
  return withTenantContext({ orgId: ctx.orgId }, async (db) => {
    const submittalRows = (await db.execute(sql`
      SELECT avg(extract(epoch from (reviewed_at - created_at)) / 86400)::float AS avg_days
      FROM compliance.construction_submittals
      WHERE org_id = ${ctx.orgId} AND reviewed_at IS NOT NULL
    `)) as unknown as { avg_days: number | null }[]
    const coRows = (await db.execute(sql`
      SELECT avg(extract(epoch from (approved_at - created_at)) / 86400)::float AS avg_days
      FROM compliance.construction_change_orders
      WHERE org_id = ${ctx.orgId} AND approved_at IS NOT NULL
    `)) as unknown as { avg_days: number | null }[]
    const submittalAvg = submittalRows[0]?.avg_days
    const coAvg = coRows[0]?.avg_days
    return {
      columns: ["Metric", "Average Days"],
      rows: [
        { Metric: "Avg Submittal Review Time (days)", "Average Days": submittalAvg != null ? Math.round(submittalAvg * 10) / 10 : "N/A" },
        { Metric: "Avg Change Order Approval Time (days)", "Average Days": coAvg != null ? Math.round(coAvg * 10) / 10 : "N/A" },
      ],
      note: "Only covers decisions actually made (reviewed_at/approved_at not null) -- a bottleneck of many still-stuck items won't inflate this average (see the RFI/Change Order Pending counts for that).",
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

/** Correlates site-diary weather with same-day, same-project work-progress entries. weather is free text (not an enum), so groups are as noisy as what site staff actually typed. */
async function computeWeatherImpactAnalysis(ctx: { orgId: string }): Promise<ReportDefinitionResult> {
  return withTenantContext({ orgId: ctx.orgId }, async (db) => {
    const rows = (await db.execute(sql`
      SELECT d.weather AS weather, count(*)::int AS entries, avg(p.quantity_done)::float AS avg_quantity_done
      FROM compliance.construction_site_diaries d
      JOIN compliance.construction_work_progress_entries p
        ON p.project_id = d.project_id AND p.entry_date = d.diary_date
      WHERE d.org_id = ${ctx.orgId} AND d.weather IS NOT NULL
      GROUP BY d.weather ORDER BY entries DESC
    `)) as unknown as { weather: string; entries: number; avg_quantity_done: number }[]
    return {
      columns: ["Weather", "Matched Progress Entries", "Avg Quantity Done"],
      rows: rows.map((r) => ({ Weather: r.weather, "Matched Progress Entries": Number(r.entries), "Avg Quantity Done": Math.round(Number(r.avg_quantity_done) * 100) / 100 })),
      note: rows.length === 0 ? "No site-diary entries with both a weather value and a same-day progress entry exist yet." : "weather is free text entered by site staff, not a fixed enum ('Rain'/'rain'/'Heavy Rain' are distinct groups) -- a real correlation, but noisy until weather entry is standardized. Matches by identical project_id + date, not a lag/delay model.",
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

/** Cost + schedule impact of approved change orders, grouped by project. */
async function computeDesignChangeImpactAnalysis(ctx: { orgId: string }): Promise<ReportDefinitionResult> {
  return withTenantContext({ orgId: ctx.orgId }, async (db) => {
    const rows = await db.select({
      projectId: constructionChangeOrders.projectId,
      totalCostImpact: sql<number>`coalesce(sum(${constructionChangeOrders.costImpact}), 0)::float`,
      totalScheduleImpactDays: sql<number>`coalesce(sum(${constructionChangeOrders.scheduleImpactDays}), 0)::int`,
      count: sql<number>`count(*)`,
    }).from(constructionChangeOrders)
      .where(and(eq(constructionChangeOrders.orgId, ctx.orgId), eq(constructionChangeOrders.status, "approved")))
      .groupBy(constructionChangeOrders.projectId)
    return {
      columns: ["Project ID", "Approved Change Orders", "Total Cost Impact", "Total Schedule Impact (Days)"],
      rows: rows.map((r) => ({ "Project ID": r.projectId, "Approved Change Orders": Number(r.count), "Total Cost Impact": Number(r.totalCostImpact), "Total Schedule Impact (Days)": Number(r.totalScheduleImpactDays) })),
      note: rows.length === 0 ? "No approved change orders logged yet." : undefined,
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

/** Active projects whose actual expense exceeds budget, via the existing per-project budgetVsActual(). */
async function computeCostOverrunReport(ctx: { orgId: string }): Promise<ReportDefinitionResult> {
  return withTenantContext({ orgId: ctx.orgId }, async (db) => {
    const activeProjects = await db.query.projects.findMany({ where: and(eq(projects.orgId, ctx.orgId), eq(projects.isActive, true)), columns: { id: true, name: true } })
    const results: { name: string; budget: number; actual: number; overrun: number }[] = []
    for (const p of activeProjects) {
      const bva = await budgetVsActual(ctx, p.id)
      // R67 E-06: a project with no BOQ has no budget to overrun -- null is
      // skipped rather than compared, which would have reported every
      // unbudgeted project as an overrun the moment budget stopped being 0.
      if (bva.budget !== null && bva.variance !== null && bva.budget > 0 && bva.variance < 0) {
        results.push({ name: p.name, budget: bva.budget, actual: bva.actual, overrun: Math.abs(bva.variance) })
      }
    }
    results.sort((a, b) => b.overrun - a.overrun)
    return {
      columns: ["Project", "Budget", "Actual", "Overrun"],
      rows: results.map((r) => ({ Project: r.name, Budget: Math.round(r.budget), Actual: Math.round(r.actual), Overrun: Math.round(r.overrun) })),
      note: results.length === 0 ? "No active project currently has actual expenses exceeding its budget." : undefined,
    }
  })
}

/** Revenue minus expense for one project, via the existing revenueReport()/expenseReport(). Not a full accrual-basis GL profit/loss. */
async function computeProfitabilityAnalysis(ctx: { orgId: string }, params: Record<string, unknown>): Promise<ReportDefinitionResult> {
  const projectId = String(params.projectId ?? "")
  if (!projectId) throw new ServiceError("projectId is required for the Profitability Analysis formula", 400)
  const [revenue, expense] = await Promise.all([revenueReport(ctx, projectId), expenseReport(ctx, projectId)])
  const margin = revenue.total - expense.total
  const marginPercent = revenue.total > 0 ? Math.round((margin / revenue.total) * 1000) / 10 : null
  return {
    columns: ["Metric", "Value"],
    rows: [
      { Metric: "Revenue", Value: Math.round(revenue.total) },
      { Metric: "Expense", Value: Math.round(expense.total) },
      { Metric: "Margin", Value: Math.round(margin) },
      { Metric: "Margin %", Value: marginPercent ?? "N/A" },
    ],
    note: "Revenue is non-cancelled sales invoices for the project; expense is construction_expense_entries only -- not a full accrual-basis GL profit/loss.",
  }
}

/** Tasks (pms_issues) past their due date and not fully complete, grouped by project. Based on VERIDIAN AI PMS tasks, not a separate construction-activity schedule (construction_activities has no due date). */
async function computeDelayedTasksReport(ctx: { orgId: string }): Promise<ReportDefinitionResult> {
  return withTenantContext({ orgId: ctx.orgId }, async (db) => {
    const today = new Date().toISOString().slice(0, 10)
    const rows = await db.select({ projectId: pmsIssues.projectId, count: sql<number>`count(*)` })
      .from(pmsIssues)
      .where(and(eq(pmsIssues.orgId, ctx.orgId), lt(pmsIssues.dueDate, today), sql`${pmsIssues.completionPercentage} < 100`, eq(pmsIssues.isArchived, false)))
      .groupBy(pmsIssues.projectId)
    return { columns: ["Project ID", "Delayed Tasks"], rows: rows.map((r) => ({ "Project ID": r.projectId, "Delayed Tasks": Number(r.count) })), note: "Delayed = due_date in the past and completion_percentage < 100, based on pms_issues (VERIDIAN AI PMS) -- construction_activities has no per-activity scheduled date to compare against." }
  })
}

/** Tasks (pms_issues) due within the next N days (default 7), grouped by project. */
async function computeLookAheadPlan(ctx: { orgId: string }, params: Record<string, unknown>): Promise<ReportDefinitionResult> {
  const days = Number(params.days ?? 7)
  return withTenantContext({ orgId: ctx.orgId }, async (db) => {
    const todayStr = new Date().toISOString().slice(0, 10)
    const endStr = new Date(Date.now() + days * 86400000).toISOString().slice(0, 10)
    const rows = await db.select({ projectId: pmsIssues.projectId, count: sql<number>`count(*)` })
      .from(pmsIssues)
      .where(and(eq(pmsIssues.orgId, ctx.orgId), gte(pmsIssues.dueDate, todayStr), lt(pmsIssues.dueDate, endStr), eq(pmsIssues.isArchived, false)))
      .groupBy(pmsIssues.projectId)
    const label = `Tasks Due in Next ${days} Days`
    return { columns: ["Project ID", label], rows: rows.map((r) => ({ "Project ID": r.projectId, [label]: Number(r.count) })), note: "Based on pms_issues.due_date (VERIDIAN AI PMS tasks) -- construction_activities has no per-activity scheduled date to look ahead against." }
  })
}

// ─── Interior Design formulas (Priority 11, interior_design classification)
// ─── Wired against real interior_* tables (schema confirmed against
// src/lib/db/schema.ts, verified alongside interior-design-service.ts /
// interior-floorplan-service.ts, the two existing CRUD services for this
// domain -- neither of which previously exposed a reporting/rollup
// function beyond getMarginSummary, which computeInteriorProfitByRoom
// below deliberately does NOT duplicate: getMarginSummary groups by FF&E
// `category`, this groups the same cost/price fields by `roomOrArea`
// instead -- same underlying rows, a genuinely different rollup axis, not
// a re-implementation.  Every function here documents its own honest
// limitation inline (free-text room grouping, no order/receipt
// timestamps, etc.) in the returned `note`, matching computeSpi/computeCpi's
// own discipline above.

function polygonAreaSqCm(points: { x: number; y: number }[]): number {
  let area = 0
  for (let i = 0; i < points.length; i++) {
    const j = (i + 1) % points.length
    area += points[i].x * points[j].y - points[j].x * points[i].y
  }
  return Math.abs(area / 2)
}

/** Report 1: Mood Board Approval Report -- current draft/shared/approved state per board for a project. */
async function interiorMoodBoardApprovalReport(ctx: { orgId: string }, params: Record<string, unknown>): Promise<ReportDefinitionResult> {
  const projectId = String(params.projectId ?? "")
  if (!projectId) throw new ServiceError("projectId is required for the Mood Board Approval Report", 400)
  return withTenantContext({ orgId: ctx.orgId }, async (db) => {
    const boards = await db.query.interiorMoodBoards.findMany({
      where: and(eq(interiorMoodBoards.orgId, ctx.orgId), eq(interiorMoodBoards.projectId, projectId)),
      orderBy: (t, { desc }) => desc(t.createdAt),
    })
    const byStatus = { draft: 0, shared: 0, approved: 0 }
    for (const b of boards) byStatus[b.status] = (byStatus[b.status] ?? 0) + 1
    return {
      columns: ["Mood Board", "Room/Area", "Status", "Created"],
      rows: boards.map((b) => ({ "Mood Board": b.title, "Room/Area": b.roomOrArea ?? "-", Status: b.status, Created: b.createdAt.toISOString().slice(0, 10) })),
      note: `${boards.length} mood board(s) -- ${byStatus.draft} draft, ${byStatus.shared} shared (pending client review), ${byStatus.approved} approved. This is a current-state snapshot: interior_mood_boards has no approvedAt/updatedAt timestamp, so WHEN a status change happened cannot be reported, only the current status.`,
    }
  })
}

/** Report 3: Material Selection Report -- room surface materials (floor/wall/ceiling) + fabric/finish FF&E items for a project. */
async function interiorMaterialSelectionReport(ctx: { orgId: string }, params: Record<string, unknown>): Promise<ReportDefinitionResult> {
  const projectId = String(params.projectId ?? "")
  if (!projectId) throw new ServiceError("projectId is required for the Material Selection Report", 400)
  return withTenantContext({ orgId: ctx.orgId }, async (db) => {
    const plans = await db.query.interiorFloorPlans.findMany({ where: and(eq(interiorFloorPlans.orgId, ctx.orgId), eq(interiorFloorPlans.projectId, projectId)) })
    const planIds = plans.map((p) => p.id)
    const rooms = planIds.length ? await db.query.interiorFloorPlanRooms.findMany({ where: inArray(interiorFloorPlanRooms.floorPlanId, planIds) }) : []
    const materialIds = [...new Set(rooms.flatMap((r) => [r.floorMaterialId, r.wallMaterialId, r.ceilingMaterialId]).filter((id): id is string => !!id))]
    const materials = materialIds.length ? await db.query.interiorMaterials.findMany({ where: inArray(interiorMaterials.id, materialIds) }) : []
    const materialsById = new Map(materials.map((m) => [m.id, m]))
    const fabricItems = await db.query.interiorFfeItems.findMany({
      where: and(eq(interiorFfeItems.orgId, ctx.orgId), eq(interiorFfeItems.projectId, projectId), inArray(interiorFfeItems.category, ["textile", "finish"])),
    })

    const surfaceRows = rooms.flatMap((r) =>
      ([["floorMaterialId", "Floor"], ["wallMaterialId", "Wall"], ["ceilingMaterialId", "Ceiling"]] as const).map(([key, label]) => {
        const matId = r[key]
        const mat = matId ? materialsById.get(matId) : null
        if (!mat) return null
        return { Room: r.name, Surface: label, Material: mat.name, Category: mat.category, Color: mat.colorHex }
      }).filter((row): row is NonNullable<typeof row> => row !== null)
    )
    const fabricRows = fabricItems.map((i) => ({ Room: i.roomOrArea ?? "-", Surface: i.category === "textile" ? "Fabric" : "Finish", Material: i.itemName, Category: i.category, Color: "-" }))

    return {
      columns: ["Room", "Surface", "Material", "Category", "Color"],
      rows: [...surfaceRows, ...fabricRows],
      note: "Floor/wall/ceiling selections come from interior_materials via interior_floor_plan_rooms; fabric/finish selections come from interior_ffe_items (category='textile'|'finish'). interior_materials only has 3 category buckets (flooring/wall/ceiling) -- it does not distinguish tile vs laminate vs paint as separate types, only via the material's own free-text name.",
    }
  })
}

/** Report 4: Furniture Procurement Report -- specified/ordered/received/installed status per furniture FF&E line item. */
async function interiorFurnitureProcurementReport(ctx: { orgId: string }, params: Record<string, unknown>): Promise<ReportDefinitionResult> {
  const projectId = String(params.projectId ?? "")
  if (!projectId) throw new ServiceError("projectId is required for the Furniture Procurement Report", 400)
  return withTenantContext({ orgId: ctx.orgId }, async (db) => {
    const items = await db.query.interiorFfeItems.findMany({
      where: and(eq(interiorFfeItems.orgId, ctx.orgId), eq(interiorFfeItems.projectId, projectId), eq(interiorFfeItems.category, "furniture")),
      orderBy: (t, { desc }) => desc(t.createdAt),
    })
    const byStatus = { specified: 0, ordered: 0, received: 0, installed: 0 }
    for (const i of items) byStatus[i.status] = (byStatus[i.status] ?? 0) + 1
    return {
      columns: ["Item", "Room/Area", "Vendor ID", "Quantity", "Status", "Lead Time (days)"],
      rows: items.map((i) => ({ Item: i.itemName, "Room/Area": i.roomOrArea ?? "-", "Vendor ID": i.vendorId ?? "-", Quantity: i.quantity, Status: i.status, "Lead Time (days)": i.leadTimeDays ?? "-" })),
      note: `${items.length} furniture item(s) -- ${byStatus.specified} specified, ${byStatus.ordered} ordered, ${byStatus.received} received, ${byStatus.installed} installed.`,
    }
  })
}

/** Report 6: Site Measurement Report -- per-room floor area (shoelace formula over the stored polygon) + ceiling height. */
async function interiorSiteMeasurementReport(ctx: { orgId: string }, params: Record<string, unknown>): Promise<ReportDefinitionResult> {
  const projectId = String(params.projectId ?? "")
  if (!projectId) throw new ServiceError("projectId is required for the Site Measurement Report", 400)
  return withTenantContext({ orgId: ctx.orgId }, async (db) => {
    const plans = await db.query.interiorFloorPlans.findMany({ where: and(eq(interiorFloorPlans.orgId, ctx.orgId), eq(interiorFloorPlans.projectId, projectId)) })
    const planById = new Map(plans.map((p) => [p.id, p]))
    const planIds = plans.map((p) => p.id)
    const rooms = planIds.length ? await db.query.interiorFloorPlanRooms.findMany({ where: inArray(interiorFloorPlanRooms.floorPlanId, planIds), orderBy: (t, { asc }) => asc(t.sortOrder) }) : []
    return {
      columns: ["Floor Plan", "Room", "Area (sqm)", "Ceiling Height (cm)"],
      rows: rooms.map((r) => ({
        "Floor Plan": planById.get(r.floorPlanId)?.name ?? "-",
        Room: r.name,
        "Area (sqm)": Math.round((polygonAreaSqCm(r.polygon as { x: number; y: number }[]) / 10000) * 100) / 100,
        "Ceiling Height (cm)": Number(r.ceilingHeightCm),
      })),
      note: "Area is computed from each room's stored polygon (interior_floor_plan_rooms.polygon, shoelace formula, cm -> sqm) -- this is the room shape as drawn in the 2D floor plan editor, not an independently re-verified physical site survey.",
    }
  })
}

/** Report 8: Room-wise Progress Report -- FF&E installation completion per room (a proxy, not full room readiness). */
async function interiorRoomProgressReport(ctx: { orgId: string }, params: Record<string, unknown>): Promise<ReportDefinitionResult> {
  const projectId = String(params.projectId ?? "")
  if (!projectId) throw new ServiceError("projectId is required for the Room-wise Progress Report", 400)
  return withTenantContext({ orgId: ctx.orgId }, async (db) => {
    const plans = await db.query.interiorFloorPlans.findMany({ where: and(eq(interiorFloorPlans.orgId, ctx.orgId), eq(interiorFloorPlans.projectId, projectId)) })
    const planIds = plans.map((p) => p.id)
    const rooms = planIds.length ? await db.query.interiorFloorPlanRooms.findMany({ where: inArray(interiorFloorPlanRooms.floorPlanId, planIds) }) : []
    const roomIds = rooms.map((r) => r.id)
    const placements = roomIds.length ? await db.query.interiorFurniturePlacements.findMany({ where: inArray(interiorFurniturePlacements.roomId, roomIds) }) : []
    const itemIds = [...new Set(placements.map((p) => p.ffeItemId))]
    const items = itemIds.length ? await db.query.interiorFfeItems.findMany({ where: inArray(interiorFfeItems.id, itemIds) }) : []
    const itemsById = new Map(items.map((i) => [i.id, i]))
    const rows = rooms.map((r) => {
      const roomPlacements = placements.filter((p) => p.roomId === r.id)
      const total = roomPlacements.length
      const installed = roomPlacements.filter((p) => itemsById.get(p.ffeItemId)?.status === "installed").length
      return { Room: r.name, "FF&E Items Placed": total, Installed: installed, "Installation %": total > 0 ? Math.round((installed / total) * 100) : 0 }
    })
    return {
      columns: ["Room", "FF&E Items Placed", "Installed", "Installation %"],
      rows,
      note: "Progress here means FF&E installation completion per room (installed / total placed FF&E items via interior_furniture_placements + interior_ffe_items.status) -- it does NOT include finish/civil work percentage (flooring, painting), which construction_work_progress_entries tracks per activity/project, not per room, so isn't merged in.",
    }
  })
}

/** Analysis 3: Vendor Lead Time -- average QUOTED lead time by vendor (not measured on-time reliability, see note). */
async function interiorVendorLeadTimeAnalysis(ctx: { orgId: string }, params: Record<string, unknown>): Promise<ReportDefinitionResult> {
  const projectId = params.projectId ? String(params.projectId) : undefined
  return withTenantContext({ orgId: ctx.orgId }, async (db) => {
    const conditions = [eq(interiorFfeItems.orgId, ctx.orgId), sql`${interiorFfeItems.vendorId} is not null`, sql`${interiorFfeItems.leadTimeDays} is not null`]
    if (projectId) conditions.push(eq(interiorFfeItems.projectId, projectId))
    const items = await db.query.interiorFfeItems.findMany({ where: and(...conditions) })
    const vendorIds = [...new Set(items.map((i) => i.vendorId).filter((id): id is string => !!id))]
    const vendors = vendorIds.length ? await db.query.erpSuppliers.findMany({ where: inArray(erpSuppliers.id, vendorIds) }) : []
    const vendorsById = new Map(vendors.map((v) => [v.id, v]))
    const byVendor = new Map<string, { count: number; totalDays: number }>()
    for (const i of items) {
      if (!i.vendorId || i.leadTimeDays == null) continue
      const b = byVendor.get(i.vendorId) ?? { count: 0, totalDays: 0 }
      b.count++
      b.totalDays += i.leadTimeDays
      byVendor.set(i.vendorId, b)
    }
    const rows = [...byVendor.entries()]
      .map(([vendorId, b]) => ({ Vendor: vendorsById.get(vendorId)?.supplierName ?? vendorId, "FF&E Items": b.count, "Avg Quoted Lead Time (days)": Math.round(b.totalDays / b.count) }))
      .sort((a, b) => a["Avg Quoted Lead Time (days)"] - b["Avg Quoted Lead Time (days)"])
    return {
      columns: ["Vendor", "FF&E Items", "Avg Quoted Lead Time (days)"],
      rows,
      note: "This is each vendor's AVERAGE QUOTED lead time (interior_ffe_items.lead_time_days), not measured delivery reliability -- interior_ffe_items has no order-placed/received timestamps, so actual elapsed delivery time (and true on-time-delivery accuracy) cannot be computed from this schema. Treat as a planned-lead-time comparison, not a performance score.",
    }
  })
}

/** Analysis 9: Profit by Room -- FF&E margin (unit_price - unit_cost) grouped by the free-text roomOrArea field. */
async function interiorProfitByRoomAnalysis(ctx: { orgId: string }, params: Record<string, unknown>): Promise<ReportDefinitionResult> {
  const projectId = String(params.projectId ?? "")
  if (!projectId) throw new ServiceError("projectId is required for the Profit by Room analysis", 400)
  return withTenantContext({ orgId: ctx.orgId }, async (db) => {
    const items = await db.query.interiorFfeItems.findMany({ where: and(eq(interiorFfeItems.orgId, ctx.orgId), eq(interiorFfeItems.projectId, projectId)) })
    const byRoom = new Map<string, { cost: number; price: number }>()
    for (const i of items) {
      const key = i.roomOrArea?.trim() || "Unassigned"
      const cost = Number(i.unitCost) * i.quantity
      const price = Number(i.unitPrice) * i.quantity
      const b = byRoom.get(key) ?? { cost: 0, price: 0 }
      b.cost += cost
      b.price += price
      byRoom.set(key, b)
    }
    const rows = [...byRoom.entries()].map(([room, b]) => ({
      Room: room, "FF&E Cost": Math.round(b.cost), "FF&E Client Price": Math.round(b.price),
      Margin: Math.round(b.price - b.cost), "Margin %": b.price > 0 ? Math.round(((b.price - b.cost) / b.price) * 100) : 0,
    }))
    return {
      columns: ["Room", "FF&E Cost", "FF&E Client Price", "Margin", "Margin %"],
      rows,
      note: "Room grouping uses interior_ffe_items.room_or_area, a free-text field (not a foreign key to interior_floor_plan_rooms) -- inconsistent naming across items (e.g. 'Living Room' vs 'living room') will fragment or fail to merge groupings. This reflects FF&E procurement margin ONLY (unit_price - unit_cost) -- it does not allocate design-fee revenue or labour cost per room (no such table exists), so it is not full room profitability.",
    }
  })
}

/** Analysis 10: Designer Productivity -- raw item-creation volume per designer (mood boards + floor plans + FF&E specs). */
async function interiorDesignerProductivityAnalysis(ctx: { orgId: string }, params: Record<string, unknown>): Promise<ReportDefinitionResult> {
  void params
  return withTenantContext({ orgId: ctx.orgId }, async (db) => {
    const [moodBoards, floorPlans, ffeItems] = await Promise.all([
      db.query.interiorMoodBoards.findMany({ where: eq(interiorMoodBoards.orgId, ctx.orgId) }),
      db.query.interiorFloorPlans.findMany({ where: eq(interiorFloorPlans.orgId, ctx.orgId) }),
      db.query.interiorFfeItems.findMany({ where: eq(interiorFfeItems.orgId, ctx.orgId) }),
    ])
    const byUser = new Map<string, { moodBoards: number; floorPlans: number; ffeSpecs: number }>()
    const bump = (id: string, key: "moodBoards" | "floorPlans" | "ffeSpecs") => {
      const b = byUser.get(id) ?? { moodBoards: 0, floorPlans: 0, ffeSpecs: 0 }
      b[key]++
      byUser.set(id, b)
    }
    moodBoards.forEach((b) => bump(b.createdById, "moodBoards"))
    floorPlans.forEach((p) => bump(p.createdById, "floorPlans"))
    ffeItems.forEach((i) => bump(i.createdById, "ffeSpecs"))
    const userIds = [...byUser.keys()]
    const userRows = userIds.length ? await db.query.users.findMany({ where: inArray(users.id, userIds) }) : []
    const namesById = new Map(userRows.map((u) => [u.id, u.name]))
    const rows = [...byUser.entries()]
      .map(([userId, c]) => ({ Designer: namesById.get(userId) ?? userId, "Mood Boards": c.moodBoards, "Floor Plans": c.floorPlans, "FF&E Specs": c.ffeSpecs, Total: c.moodBoards + c.floorPlans + c.ffeSpecs }))
      .sort((a, b) => b.Total - a.Total)
    return {
      columns: ["Designer", "Mood Boards", "Floor Plans", "FF&E Specs", "Total"],
      rows,
      note: "Raw output-volume count (mood boards + floor plans + FF&E specifications created), grouped by creator, org-wide -- a proxy for activity, not a quality- or complexity-adjusted productivity score. No time-tracking exists for interior design work specifically (unlike construction-designer-timesheet-report's real PMS hours, which covers project/construction-scoped work, not interior design).",
    }
  })
}

/**
 * Analysis 11: Variation Order Analysis (report_definitions
 * a973e9a4-0e75-4c44-a6e2-05351f8779d3, classifications
 * ["interior_design","project","financial"], formulaKey
 * interior_variation_order_analysis). Was status='data_gap': construction_
 * change_orders (Wave 141) tracks cost_impact/schedule_impact_days/status
 * per project, but had no field distinguishing an interior-design-caused
 * scope change from civil/MEP/other-trade -- confirmed real and current
 * against live schema before this closure (see this table's own `trade`
 * column comment in schema.ts, added by this same change).
 *
 * The generic, UNTAGGED, org-wide version of "change order cost/schedule
 * impact" already exists (computeDesignChangeImpactAnalysis above,
 * formulaKey design_change_impact_analysis, grouped by project) -- this is
 * deliberately NOT a duplicate of that: it filters to change orders whose
 * new `trade` column matches an interior-design value, a genuinely
 * different (narrower, subject-scoped) cut the generic report cannot do.
 *
 * `trade` is free text (matching constructionLabourRoster.trade/
 * erpSuppliers.trade's own no-fixed-vocabulary convention), so the filter
 * is a case-insensitive substring match ('%interior%') rather than an
 * exact-equality lookup against an invented enum -- tolerates "Interior
 * Design", "Interiors", "Interior Fit-out", etc, the same way a human
 * would type it.
 */
async function computeInteriorVariationOrderAnalysis(ctx: { orgId: string }, params: Record<string, unknown>): Promise<ReportDefinitionResult> {
  const projectId = params.projectId ? String(params.projectId) : undefined
  return withTenantContext({ orgId: ctx.orgId }, async (db) => {
    const conditions = [eq(constructionChangeOrders.orgId, ctx.orgId), ilike(constructionChangeOrders.trade, "%interior%")]
    if (projectId) conditions.push(eq(constructionChangeOrders.projectId, projectId))
    const changeOrders = await db.query.constructionChangeOrders.findMany({
      where: and(...conditions),
      orderBy: (t, { desc }) => desc(t.number),
    })
    const rows = changeOrders.map((co) => ({
      "CO #": co.number,
      Title: co.title,
      Trade: co.trade ?? "",
      "Cost Impact": Math.round(Number(co.costImpact)),
      "Schedule Impact (Days)": co.scheduleImpactDays,
      Status: co.status,
    }))
    const totalCostImpact = Math.round(changeOrders.reduce((sum, co) => sum + Number(co.costImpact), 0))
    const totalScheduleImpactDays = changeOrders.reduce((sum, co) => sum + co.scheduleImpactDays, 0)
    return {
      columns: ["CO #", "Title", "Trade", "Cost Impact", "Schedule Impact (Days)", "Status"],
      rows,
      note: changeOrders.length > 0
        ? `${changeOrders.length} interior-design-scoped change order(s)${projectId ? "" : " across all projects"} -- total cost impact ${totalCostImpact >= 0 ? "+" : ""}${totalCostImpact}, total schedule impact ${totalScheduleImpactDays >= 0 ? "+" : ""}${totalScheduleImpactDays} day(s). Scoped via construction_change_orders.trade ILIKE '%interior%', a free-text field populated only for change orders created (or edited) after it existed -- older change orders predating it read as trade=NULL and are correctly excluded here, not silently mislabeled.`
        : "No change order is currently tagged with an interior-design trade. construction_change_orders.trade is a new free-text field (this closure, matching construction_labour_roster.trade's convention) -- it exists so a change order CAN be marked interior-design-scoped going forward, but nothing retroactively tags the change orders that already exist. Generic, untagged change-order cost/schedule impact is already covered by the 'Design Change Impact Analysis' report (formulaKey design_change_impact_analysis).",
    }
  })
}

/**
 * R65 (Rework Analysis, report_definitions rptdef_rework_analysis,
 * classifications ["financial","quality_safety","construction"],
 * formulaKey rework_analysis). Was status='data_gap':
 * construction_expense_entries.expense_head (material/labour/transport/
 * subcontractor/equipment/misc) had no way to flag an entry as the cost
 * of REDOING work already done once -- verified real and current against
 * live schema before this closure (60 real expense entries across 2
 * orgs/8 projects as of 2026-08-31, none previously taggable as rework).
 *
 * Closed with construction_expense_entries.isRework (this same change --
 * see that column's own schema.ts comment for why a boolean composed
 * WITH expenseHead, not a 7th enum value: rework can occur under ANY
 * head, so collapsing it into one new head would throw away the real
 * head classification an entry already has). This report is a
 * filtered/annotated cut of the existing expense-entry stream, not a new
 * entity -- real amount, real project, real date, no fabricated or
 * estimated figures. construction_punch_list_items is deliberately left
 * out of scope: it has no cost field of its own, and the report is fully
 * costable off real expense entries alone.
 *
 * projectId is optional (org-wide rollup when omitted, matching
 * computeInteriorVariationOrderAnalysis's precedent for a newly-added tag
 * column). Honestly notes when zero entries are tagged rework yet (true
 * for all pre-existing entries today -- untaggable retroactively) rather
 * than fabricating a result.
 */
async function computeReworkAnalysis(ctx: { orgId: string }, params: Record<string, unknown>): Promise<ReportDefinitionResult> {
  const projectId = params.projectId ? String(params.projectId) : undefined
  return withTenantContext({ orgId: ctx.orgId }, async (db) => {
    const conditions = [eq(constructionExpenseEntries.orgId, ctx.orgId)]
    if (projectId) conditions.push(eq(constructionExpenseEntries.projectId, projectId))
    const entries = await db
      .select({
        projectId: constructionExpenseEntries.projectId,
        projectName: projects.name,
        expenseHead: constructionExpenseEntries.expenseHead,
        description: constructionExpenseEntries.description,
        amount: constructionExpenseEntries.amount,
        expenseDate: constructionExpenseEntries.expenseDate,
        isRework: constructionExpenseEntries.isRework,
      })
      .from(constructionExpenseEntries)
      .innerJoin(projects, eq(constructionExpenseEntries.projectId, projects.id))
      .where(and(...conditions))

    const totalExpense = entries.reduce((sum, e) => sum + Number(e.amount), 0)
    const reworkEntries = entries.filter((e) => e.isRework).sort((a, b) => b.expenseDate.localeCompare(a.expenseDate))
    const reworkTotal = reworkEntries.reduce((sum, e) => sum + Number(e.amount), 0)
    const reworkPct = totalExpense > 0 ? (reworkTotal / totalExpense) * 100 : 0

    const byHead = new Map<string, { total: number; count: number }>()
    for (const e of reworkEntries) {
      const cur = byHead.get(e.expenseHead) ?? { total: 0, count: 0 }
      cur.total += Number(e.amount)
      cur.count += 1
      byHead.set(e.expenseHead, cur)
    }
    const headBreakdown = [...byHead.entries()]
      .sort((a, b) => b[1].total - a[1].total)
      .map(([head, v]) => `${head}: ${Math.round(v.total)} (${v.count})`)
      .join(", ")

    const rows = reworkEntries.map((e) => ({
      Date: e.expenseDate,
      Project: e.projectName,
      "Expense Head": e.expenseHead,
      Description: e.description ?? "",
      Amount: Math.round(Number(e.amount)),
    }))

    return {
      columns: ["Date", "Project", "Expense Head", "Description", "Amount"],
      rows,
      note: reworkEntries.length > 0
        ? `${reworkEntries.length} rework-tagged expense entr${reworkEntries.length === 1 ? "y" : "ies"}${projectId ? "" : " across all projects"} totalling ${Math.round(reworkTotal)} -- ${reworkPct.toFixed(1)}% of ${projectId ? "this project's" : "org-wide"} total logged expense (${Math.round(totalExpense)}). By head: ${headBreakdown}.`
        : `No expense entry is currently tagged as rework${projectId ? " for this project" : ""}. construction_expense_entries.is_rework is a new boolean field (this closure) -- it exists so an entry CAN be marked rework going forward, but nothing retroactively tags the ${entries.length} expense entr${entries.length === 1 ? "y" : "ies"} that already exist${projectId ? " for this project" : ""} (totalling ${Math.round(totalExpense)}). Tag an entry as rework from the Expenses page to see it here.`,
    }
  })
}

/**
 * Pure predicate: is a billing schedule genuinely due for billing as of a
 * given date? Extracted standalone (same precedent as
 * deriveReportDomainFromClassifications above) so the "what counts as due"
 * rule is unit-testable without a DB -- the SAP VF04 "billing date <=
 * selection date AND not already billed" check, adapted to
 * erp_contract_billing_schedules (Wave 71): isActive, lastInvoiceId still
 * null (this cycle hasn't been invoiced), and nextBillingDate on or before
 * asOfDate.
 */
export function isBillingScheduleDue(
  schedule: { nextBillingDate: string; lastInvoiceId: string | null; isActive: boolean },
  asOfDate: string
): boolean {
  return schedule.isActive && schedule.lastInvoiceId === null && schedule.nextBillingDate <= asOfDate
}

/**
 * SD-002 (SAP VF04 "Billing Due List" equivalent) -- construction/PROJEXA
 * adaptation per the 2026-07-28 gap analysis (sap_mapping.sqlite,
 * BUILD_NEW, HIGH priority, re-verified 2026-07-30 directly against this
 * repo). erp_contract_billing_schedules (Wave 71) already modelled
 * billingFrequency/nextBillingDate/amount/lastInvoiceId, but nothing ever
 * QUERIED "which schedules are due and not yet invoiced" --
 * erp-contract-service.ts's addBillingSchedule only ever creates a row;
 * there was no due-list read anywhere before this.
 *
 * "Due" = isActive, lastInvoiceId is still null, and nextBillingDate <=
 * asOfDate (params.asOfDate, default today) -- see isBillingScheduleDue()
 * above, the single source of truth this filters through.
 *
 * Actionable: each row carries Schedule ID + Contract ID so a caller can
 * invoke POST /api/erp/contracts/{Contract ID}/billing-schedules/{Schedule
 * ID}/generate-invoice (erp-contract-service.ts#
 * generateInvoiceFromBillingSchedule, same PR) directly from this
 * worklist -- a real worklist, not a static snapshot.
 *
 * Honest gap: the gap analysis's implementation_notes describe a fuller
 * "milestone achieved -> claim drafted -> submitted -> client-approved ->
 * invoiced" progress-claim workflow. No schema exists for those
 * intermediate stages (erp_contract_billing_schedules has no status enum
 * for them) -- this report surfaces only the two states the real schema
 * supports: due-and-not-yet-invoiced (below) and invoiced (lastInvoiceId
 * set, excluded). See PR description.
 */
async function computeBillingDueList(ctx: { orgId: string }, params: Record<string, unknown>): Promise<ReportDefinitionResult> {
  const asOfDate = typeof params.asOfDate === "string" && params.asOfDate ? params.asOfDate : new Date().toISOString().slice(0, 10)
  return withTenantContext({ orgId: ctx.orgId }, async (db) => {
    const rows = await db
      .select({
        scheduleId: erpContractBillingSchedules.id,
        contractId: erpContracts.id,
        contractTitle: erpContracts.title,
        customerName: erpCustomers.customerName,
        billingFrequency: erpContractBillingSchedules.billingFrequency,
        amount: erpContractBillingSchedules.amount,
        nextBillingDate: erpContractBillingSchedules.nextBillingDate,
        lastInvoiceId: erpContractBillingSchedules.lastInvoiceId,
        isActive: erpContractBillingSchedules.isActive,
      })
      .from(erpContractBillingSchedules)
      .innerJoin(erpContracts, eq(erpContractBillingSchedules.contractId, erpContracts.id))
      .innerJoin(erpCustomers, eq(erpContracts.customerId, erpCustomers.id))
      .where(and(eq(erpContracts.orgId, ctx.orgId), eq(erpContractBillingSchedules.isActive, true), isNull(erpContractBillingSchedules.lastInvoiceId)))

    const due = rows
      .filter((r) => isBillingScheduleDue({ nextBillingDate: r.nextBillingDate, lastInvoiceId: r.lastInvoiceId, isActive: r.isActive }, asOfDate))
      .sort((a, b) => a.nextBillingDate.localeCompare(b.nextBillingDate))

    return {
      columns: ["Contract", "Customer", "Billing Frequency", "Amount", "Billing Date Due", "Schedule ID", "Contract ID"],
      rows: due.map((r) => ({
        Contract: r.contractTitle,
        Customer: r.customerName,
        "Billing Frequency": r.billingFrequency,
        Amount: Number(r.amount),
        "Billing Date Due": r.nextBillingDate,
        "Schedule ID": r.scheduleId,
        "Contract ID": r.contractId,
      })),
      note: due.length === 0
        ? `No billing schedule (erp_contract_billing_schedules) is due and un-invoiced as of ${asOfDate}.`
        : "Due = active billing schedule, not yet invoiced (lastInvoiceId is null), with nextBillingDate on or before the as-of date. Generate the invoice via POST /api/erp/contracts/{Contract ID}/billing-schedules/{Schedule ID}/generate-invoice -- does not yet cover the fuller draft/submit/client-approve claim workflow described in the SD-002 gap analysis (no schema exists for those intermediate stages).",
    }
  })
}

/**
 * FI-AR-006 (SAP gap analysis, "Customer Payment Behavior / DSO", HIGH
 * priority, BUILD_NEW, re-verified directly against this repo
 * and the live Supabase project -- see erp-invoicing-service.ts's
 * customerPaymentBehaviorReport() for the full real-vs-honest-gap writeup,
 * which this thin wrapper reuses rather than re-querying (same
 * cross-service-reuse precedent as computeBillingDueList's sibling
 * imports from construction-reports-service.ts above). Distinct from
 * arAgingReport (point-in-time snapshot) and FI-AR-004's dunning list
 * (active overdue workflow): this is the only one of the three that reads
 * historical PAID-invoice payment dates.
 */
async function computeCustomerPaymentBehavior(ctx: { orgId: string }, params: Record<string, unknown>): Promise<ReportDefinitionResult> {
  const periodDays = typeof params.periodDays === "number" && params.periodDays > 0 ? params.periodDays : 90
  const asOfDate = typeof params.asOfDate === "string" && params.asOfDate ? params.asOfDate : undefined
  const report = await customerPaymentBehaviorReport(ctx, { periodDays, asOfDate })

  return {
    columns: ["Customer", "Invoices", "Avg Days to Pay", "Avg Credit Days", "DSO", "Outstanding AR", "Credit Sales (Period)", "Reliability"],
    rows: report.customers.map((c) => ({
      Customer: c.customerName,
      Invoices: c.invoiceCount,
      "Avg Days to Pay": c.avgDaysToPay ?? "n/a -- no real payment date recorded (see note)",
      "Avg Credit Days": c.avgCreditDays,
      DSO: c.dso ?? "n/a -- no credit sales in period",
      "Outstanding AR": c.outstandingAR,
      "Credit Sales (Period)": c.creditSalesInPeriod,
      Reliability: c.paymentReliability ?? "unknown",
    })),
    note: report.customers.every((c) => c.avgDaysToPay === null)
      ? `No customer in this org has a real, discoverable payment-completion date as of ${report.asOfDate} -- every 'paid' invoice's status was set without going through either real payment-recording path (recordSalesInvoicePayment's direct posting or the erp_payment_entries approval workflow). Avg Days to Pay/Reliability are honestly "n/a"/"unknown", not fabricated. DSO and Outstanding AR are still real and computed from real invoice data.`
      : `DSO period: ${report.periodDays} days ending ${report.asOfDate}. Avg Days to Pay only counts invoices with a real, discoverable payment-completion date -- see erp-invoicing-service.ts#customerPaymentBehaviorReport for which customers (if any) are missing one.`,
  }
}

/**
 * FI-AP-006 (SAP gap analysis, "Vendor Payment History / Payment Behavior
 * Analysis", MEDIUM priority, BUILD_NEW). This wraps
 * erp-invoicing-service.ts's vendorPaymentBehaviorReport() rather than
 * re-querying (same cross-service-reuse precedent as computeBillingDueList's
 * sibling imports from construction-reports-service.ts above) -- see that
 * function's own header comment for the full real-vs-honest-gap writeup,
 * including why this is a fresh implementation with distinct top-level names
 * (vendorDaysToPay/computeDpoFormula/classifyVendorPaymentReliability/
 * vendorPaymentBehaviorReport) mirroring FI-AR-006's calculation SHAPE
 * (immediately above, PR #645) rather than importing it, adapted
 * customer->vendor / DSO->DPO, at the time this PR was built (#645 was still
 * open then; both now coexist in this file cleanly under distinct names).
 */
async function computeVendorPaymentBehavior(ctx: { orgId: string }, params: Record<string, unknown>): Promise<ReportDefinitionResult> {
  const periodDays = typeof params.periodDays === "number" && params.periodDays > 0 ? params.periodDays : 90
  const asOfDate = typeof params.asOfDate === "string" && params.asOfDate ? params.asOfDate : undefined
  const report = await vendorPaymentBehaviorReport(ctx, { periodDays, asOfDate })

  return {
    columns: ["Supplier", "Invoices", "Avg Days to Pay", "Avg Credit Days", "DPO", "Outstanding AP", "Credit Purchases (Period)", "Reliability"],
    rows: report.suppliers.map((s) => ({
      Supplier: s.supplierName,
      Invoices: s.invoiceCount,
      "Avg Days to Pay": s.avgDaysToPay ?? "n/a -- no real payment date recorded (see note)",
      "Avg Credit Days": s.avgCreditDays,
      DPO: s.dpo ?? "n/a -- no credit purchases in period",
      "Outstanding AP": s.outstandingAP,
      "Credit Purchases (Period)": s.creditPurchasesInPeriod,
      Reliability: s.paymentReliability ?? "unknown",
    })),
    note: report.suppliers.every((s) => s.avgDaysToPay === null)
      ? `No supplier in this org has a real, discoverable payment-completion date as of ${report.asOfDate} -- every 'paid' invoice's status was set without going through the only real vendor payment-recording path (the erp_payment_entries approval workflow, paymentType='pay'/invoiceType='purchase_invoice'/status='approved'). Avg Days to Pay/Reliability are honestly "n/a"/"unknown", not fabricated. DPO and Outstanding AP are still real and computed from real invoice data.`
      : `DPO period: ${report.periodDays} days ending ${report.asOfDate}. Avg Days to Pay only counts invoices with a real, discoverable payment-completion date -- see erp-invoicing-service.ts#vendorPaymentBehaviorReport for which suppliers (if any) are missing one.`,
  }
}

/**
 * R65 (2026-08-30, reports-engine gap closure): rptdef_kpi_materials_running_low's
 * own execution_config already pointed at formulaKey "materials_running_low" --
 * both underlying tables (erp_reorder_levels, erp_stock_ledger_entries)
 * genuinely exist and are populated by real writes; the report's own
 * data_gap_note said plainly "the comparison is not wired," not that data
 * was missing. This is that wiring, reusing erp-inventory-service.ts's
 * listStockBalances() (the same real-time FIFO-ledger aggregation the
 * Inventory page's own stock-balance view already relies on) rather than
 * re-querying the ledger a second way.
 *
 * A reorder-level row with warehouseId=null is an org-wide default policy
 * (see the column's own comment in schema.ts) -- compared against that
 * item's TOTAL balance across all warehouses, not any one warehouse's.
 */
async function computeMaterialsRunningLow(ctx: { orgId: string }, _params: Record<string, unknown>): Promise<ReportDefinitionResult> {
  const [reorderLevels, balances] = await Promise.all([
    withTenantContext({ orgId: ctx.orgId }, (db) => db.query.erpReorderLevels.findMany({ where: eq(erpReorderLevels.orgId, ctx.orgId) })),
    listStockBalances(ctx, {}),
  ])

  if (reorderLevels.length === 0) {
    return { columns: ["Item", "Warehouse", "Current Qty", "Reorder Point", "Shortfall"], rows: [], note: "No reorder levels configured for this org yet -- set one via the Inventory module's reorder-level settings before this report has anything to compare against." }
  }

  const balanceByItemWarehouse = new Map(balances.map((b) => [`${b.itemId}::${b.warehouseId}`, b]))
  const balanceByItemTotal = new Map<string, { qty: number; itemCode: string | null; itemName: string | null; uom: string | null }>()
  for (const b of balances) {
    const existing = balanceByItemTotal.get(b.itemId)
    balanceByItemTotal.set(b.itemId, {
      qty: (existing?.qty ?? 0) + b.qty,
      itemCode: b.itemCode, itemName: b.itemName, uom: b.uom,
    })
  }

  const running_low = reorderLevels
    .map((rl) => {
      const reorderPoint = Number(rl.reorderPoint)
      if (rl.warehouseId) {
        const b = balanceByItemWarehouse.get(`${rl.itemId}::${rl.warehouseId}`)
        const qty = b?.qty ?? 0
        return { itemCode: b?.itemCode ?? null, itemName: b?.itemName ?? null, uom: b?.uom ?? null, warehouseName: b?.warehouseName ?? "(unknown warehouse)", qty, reorderPoint }
      }
      const totals = balanceByItemTotal.get(rl.itemId)
      const qty = totals?.qty ?? 0
      return { itemCode: totals?.itemCode ?? null, itemName: totals?.itemName ?? null, uom: totals?.uom ?? null, warehouseName: "(all warehouses -- org-wide policy)", qty, reorderPoint }
    })
    .filter((r) => r.qty <= r.reorderPoint)
    .sort((a, b) => (a.qty - a.reorderPoint) - (b.qty - b.reorderPoint)) // most-negative shortfall first

  return {
    columns: ["Item", "Warehouse", "Current Qty", "Reorder Point", "Shortfall"],
    rows: running_low.map((r) => ({
      Item: r.itemName ? `${r.itemCode ?? ""} ${r.itemName}`.trim() : (r.itemCode ?? "(unknown item)"),
      Warehouse: r.warehouseName,
      "Current Qty": `${r.qty} ${r.uom ?? ""}`.trim(),
      "Reorder Point": r.reorderPoint,
      Shortfall: Math.round((r.reorderPoint - r.qty) * 100) / 100,
    })),
    note: running_low.length === 0
      ? `${reorderLevels.length} reorder level(s) configured -- none currently below their reorder point.`
      : undefined,
  }
}

/**
 * R65 (2026-08-30, reports-engine gap closure): rptdef_sales_dashboard's own
 * execution_config was an honest placeholder ("NOT BUILT -- composite
 * multi-table summary") under `deterministic_aggregation`, which can only
 * ever resolve one TABLE_REGISTRY entry per call -- a genuine composite
 * across 5 tables needs `deterministic_formula` instead (this function),
 * matching computeEarnedValueAnalysis's own precedent of combining several
 * real per-table figures into one dashboard-shaped result rather than
 * re-querying each domain's own already-reportable metric a second way.
 * Each row here is independently reportable elsewhere (Lead Register,
 * Sales Pipeline Report, Quotation Report, Won Projects Report, Revenue
 * Booking Report per this row's own data_gap_note) -- this is the composite
 * view across all of them, not a replacement for any one.
 */
async function computeSalesDashboard(ctx: { orgId: string }): Promise<ReportDefinitionResult> {
  return withTenantContext({ orgId: ctx.orgId }, async (db) => {
    const [leadRows, oppRows, quoteRows, orderRows, invoiceRows] = await Promise.all([
      db.select({ value: sql<number>`count(*)::float` }).from(crmLeads).where(eq(crmLeads.orgId, ctx.orgId)),
      db.select({ value: sql<number>`count(*)::float`, total: sql<number>`coalesce(sum(${crmOpportunities.estimatedValue}), 0)::float` })
        .from(crmOpportunities).where(and(eq(crmOpportunities.orgId, ctx.orgId), inArray(crmOpportunities.stage, ["prospecting", "proposal", "negotiation"]))),
      db.select({ status: erpQuotations.status, value: sql<number>`count(*)::float` })
        .from(erpQuotations).where(eq(erpQuotations.orgId, ctx.orgId)).groupBy(erpQuotations.status),
      db.select({ value: sql<number>`count(*)::float`, total: sql<number>`coalesce(sum(${erpSalesOrders.grandTotal}), 0)::float` })
        .from(erpSalesOrders).where(eq(erpSalesOrders.orgId, ctx.orgId)),
      db.select({ value: sql<number>`count(*)::float`, total: sql<number>`coalesce(sum(${erpSalesInvoices.grandTotal}), 0)::float` })
        .from(erpSalesInvoices).where(eq(erpSalesInvoices.orgId, ctx.orgId)),
    ])

    const totalLeads = Number(leadRows[0]?.value ?? 0)
    const openOpportunities = Number(oppRows[0]?.value ?? 0)
    const openOpportunityValue = Number(oppRows[0]?.total ?? 0)
    const wonQuotes = Number(quoteRows.find((r) => r.status === "ordered")?.value ?? 0)
    const lostQuotes = Number(quoteRows.find((r) => r.status === "lost")?.value ?? 0)
    const totalOrders = Number(orderRows[0]?.value ?? 0)
    const totalOrderValue = Number(orderRows[0]?.total ?? 0)
    const totalInvoices = Number(invoiceRows[0]?.value ?? 0)
    const totalInvoiceValue = Number(invoiceRows[0]?.total ?? 0)

    return {
      columns: ["Metric", "Value"],
      rows: [
        { Metric: "Total Leads", Value: totalLeads },
        { Metric: "Open Opportunities", Value: openOpportunities },
        { Metric: "Open Opportunity Value", Value: Math.round(openOpportunityValue) },
        { Metric: "Quotations Won", Value: wonQuotes },
        { Metric: "Quotations Lost", Value: lostQuotes },
        { Metric: "Sales Orders", Value: totalOrders },
        { Metric: "Sales Order Value", Value: Math.round(totalOrderValue) },
        { Metric: "Sales Invoices Raised", Value: totalInvoices },
        { Metric: "Revenue Booked (Invoiced)", Value: Math.round(totalInvoiceValue) },
      ],
      note: "Composite across Lead Register (crm_leads), Sales Pipeline (crm_opportunities, still-open stages only -- prospecting/proposal/negotiation, excluding won/lost), Quotation Report (erp_quotations, won/lost counts), Won Projects (erp_sales_orders), and Revenue Booking (erp_sales_invoices) -- see each named report individually for a detailed, filterable breakdown.",
    }
  })
}

/**
 * R65 (2026-08-30, reports-engine gap closure): rptdef_monthly_project_report's
 * own data_gap_note said construction-reports-service.ts#weeklyProjectReport()
 * "computes a fixed 7-day composite window; no monthly-window variant exists
 * yet -- would need a straightforward generalization of that existing
 * function, not new data." That generalization is projectPeriodReport()
 * (same file, this same PR) -- this formula calls it with a calendar-month
 * window instead of a 7-day one.
 */
async function computeMonthlyProjectReport(ctx: { orgId: string }, params: Record<string, unknown>): Promise<ReportDefinitionResult> {
  const projectId = String(params.projectId ?? "")
  if (!projectId) throw new ServiceError("projectId is required for the Monthly Project Report", 400)
  const monthStartInput = typeof params.monthStart === "string" && params.monthStart ? params.monthStart : new Date().toISOString().slice(0, 8) + "01"
  const start = new Date(monthStartInput)
  const monthStart = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), 1)).toISOString().slice(0, 10)
  const monthEnd = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 1)).toISOString().slice(0, 10)

  const report = await projectPeriodReport(ctx, projectId, monthStart, monthEnd)

  return {
    columns: ["Metric", "Value"],
    rows: [
      { Metric: "Period", Value: `${report.periodStart} to ${report.periodEnd}` },
      { Metric: "Progress Entries Logged", Value: report.progressEntriesLogged },
      { Metric: "Labour Cost", Value: Math.round(report.labourCost) },
      { Metric: "Workers Present (attendance rows)", Value: report.workersPresent },
      { Metric: "Site Diary Entries", Value: report.diaryEntries },
      { Metric: "Expense Total", Value: Math.round(report.expenseTotal) },
    ],
    note: "Calendar-month window ([monthStart 1st, next month's 1st)) over the same real composite (work-progress entries, attendance/labour cost, site-diary entries, expenses) weeklyProjectReport() already computes for a 7-day window -- pass params.monthStart (YYYY-MM-01) to pick a specific month, defaults to the current month.",
  }
}

// Small shared helper: several R65 formula wrappers below delegate to a
// service-layer function that already returns real, shaped plain-object
// rows (construction-tender-service.ts's own report functions) -- this
// just infers `columns` from the first row's keys rather than each wrapper
// repeating that boilerplate. Matches every hand-written {columns, rows}
// literal elsewhere in this file for the same column set.
function rowsToResult(rows: Record<string, string | number>[], emptyNote?: string): ReportDefinitionResult {
  if (rows.length === 0) return { columns: [], rows: [], note: emptyNote ?? "No data yet." }
  return { columns: Object.keys(rows[0]), rows }
}

/**
 * R65 (2026-08-31, report-definitions gap closure): "Cost Report by
 * Material"'s own data_gap_note (dated 2026-08-22) said construction_
 * materials was already registered in TABLE_REGISTRY with a real orgId
 * column, but status was deliberately left data_gap because the table had
 * 0 rows for EVERY org -- do_not_assume rule 2, flipping to 'built' off
 * zero-everywhere data would produce an empty report that LOOKS built but
 * is unverified. That note is now stale: real construction_material_
 * receipts rows exist (verified via a fresh SQL count before writing this,
 * not trusted from the note). The real per-material aggregation was ALSO
 * already built and shipped independently on 2026-08-30 --
 * construction-materials-service.ts#getMaterialCostReport(), the backend
 * for the /site-materials "Cost Report" tab (proxied through api/v1/
 * construction/materials/cost-report/route.ts, real SQL sum/groupBy over
 * construction_material_receipts, same precedent as construction-
 * valuation-service.ts's previousBilledAmountsByLineItem). This wrapper is
 * pure plumbing, not new computation: reshape its real {materialId, name,
 * spec, unit, totalQuantityReceived, totalCost, averageUnitCost} rows into
 * the {columns, rows} shape the report engine expects. Project-scoped
 * (constructionMaterials.projectId is NOT NULL -- there is no org-wide
 * "all materials" view of this table), matching that route's own required
 * projectId query param.
 */
async function computeMaterialCostReport(ctx: { orgId: string }, params: Record<string, unknown>): Promise<ReportDefinitionResult> {
  const projectId = String(params.projectId ?? "")
  if (!projectId) throw new ServiceError("projectId is required for the Cost Report by Material", 400)
  // R67 E-05 (R-103): getMaterialCostReport now returns {rows, totals, params}
  // rather than a bare array, and accepts an optional period/grouping. This
  // wrapper forwards from/to when the definition was run with them and keeps
  // the default (every receipt, grouped by material) otherwise, so the
  // engine's own output is unchanged for a caller that passes neither. Vendor
  // is now a real column here too -- it was always on the receipt row and
  // this report never showed it.
  const { rows, totals } = await getMaterialCostReport(ctx, projectId, {
    from: typeof params.from === "string" ? params.from : undefined,
    to: typeof params.to === "string" ? params.to : undefined,
    groupBy: params.groupBy === "vendor" ? "vendor" : "material",
  })
  if (rows.length === 0) {
    return {
      columns: ["Material", "Spec", "Vendor", "Unit", "Qty Received", "Total Cost", "Avg Unit Cost"],
      rows: [],
      note: "No material receipts logged yet for this project -- log inbound receipts against a material (Materials module) before this report has anything to aggregate. A material with a master list price but zero receipts does not appear here. Voided receipts are excluded.",
    }
  }
  return {
    columns: ["Material", "Spec", "Vendor", "Unit", "Qty Received", "Total Cost", "Avg Unit Cost"],
    rows: [
      ...rows.map((r) => ({
        Material: r.name,
        Spec: r.spec ?? "",
        Vendor: r.vendorName ?? "",
        Unit: r.unit ?? "",
        "Qty Received": r.totalQuantityReceived,
        "Total Cost": r.totalCost,
        "Avg Unit Cost": r.averageUnitCost,
      })),
      // The grand total ships WITH the rows it totals, from the same read --
      // a reader must never have to re-add the column to find out.
      { Material: "Grand Total", Spec: "", Vendor: "", Unit: "", "Qty Received": totals.quantity, "Total Cost": totals.cost, "Avg Unit Cost": "" },
    ],
    note: "Total Cost/Avg Unit Cost are computed from real inbound receipts (construction_material_receipts), not the material master's list unitCost -- a material with a master price but zero receipts logged does not appear here (see construction-materials-service.ts#getMaterialCostReport).",
  }
}

/**
 * R65 (2026-08-30, tender/bid/EMD tracking gap closure): construction-
 * tender-service.ts's own header explains why this is a genuinely new
 * entity, distinct from erp_rfqs (procurement RFQs, not sales bids).
 * Closes 8 report_definitions data_gap rows.
 */
async function computeTenderRegister(ctx: { orgId: string }): Promise<ReportDefinitionResult> {
  return rowsToResult(await tenderRegisterReport(ctx), "No tenders logged yet for this org.")
}
async function computeTenderPipeline(ctx: { orgId: string }): Promise<ReportDefinitionResult> {
  return rowsToResult(await tenderPipelineByStage(ctx), "No tenders logged yet for this org.")
}
async function computeTenderWinLoss(ctx: { orgId: string }): Promise<ReportDefinitionResult> {
  return rowsToResult(await tenderWinLossReport(ctx), "No won/lost/awarded tenders yet for this org.")
}
async function computeTenderCosting(ctx: { orgId: string }, params: Record<string, unknown>): Promise<ReportDefinitionResult> {
  const tenderId = typeof params.tenderId === "string" ? params.tenderId : undefined
  return rowsToResult(await tenderCostingReport(ctx, tenderId), "No tenders logged yet for this org.")
}
async function computeBoqSubmissionReport(ctx: { orgId: string }, params: Record<string, unknown>): Promise<ReportDefinitionResult> {
  const tenderId = typeof params.tenderId === "string" ? params.tenderId : undefined
  return rowsToResult(await boqSubmissionReport(ctx, tenderId), "No tender BOQ items submitted yet for this org.")
}
async function computePreBidMeetingReport(ctx: { orgId: string }, params: Record<string, unknown>): Promise<ReportDefinitionResult> {
  const tenderId = typeof params.tenderId === "string" ? params.tenderId : undefined
  return rowsToResult(await preBidMeetingReport(ctx, tenderId), "No pre-bid meetings logged yet for this org.")
}
async function computeEmdTrackingReport(ctx: { orgId: string }): Promise<ReportDefinitionResult> {
  return rowsToResult(await emdTrackingReport(ctx), "No tenders with an EMD amount logged yet for this org.")
}
async function computeContractAwardReport(ctx: { orgId: string }): Promise<ReportDefinitionResult> {
  return rowsToResult(await contractAwardReport(ctx), "No tenders have reached 'awarded' stage yet for this org.")
}

/**
 * R65 (2026-08-31, interior design sales-package gap closure):
 * interior-sales-package-service.ts's own header explains why this is a
 * genuinely new SALES-side entity, distinct from Wave 142/143's
 * interiorFfeItems/interiorMoodBoards (design/execution infrastructure).
 * Closes 8 report_definitions data_gap rows.
 */
async function computeThreeDDesignApprovalReport(ctx: { orgId: string }): Promise<ReportDefinitionResult> {
  return rowsToResult(await threeDDesignApprovalReport(ctx), "No interior sales packages logged yet for this org.")
}
async function computeDesignConsultationReport(ctx: { orgId: string }): Promise<ReportDefinitionResult> {
  return rowsToResult(await designConsultationReport(ctx), "No design consultations booked yet for this org.")
}
async function computeDesignRevisionReport(ctx: { orgId: string }): Promise<ReportDefinitionResult> {
  return rowsToResult(await designRevisionReport(ctx), "No interior sales packages have been revised yet for this org.")
}
async function computeFurniturePackageReport(ctx: { orgId: string }): Promise<ReportDefinitionResult> {
  return rowsToResult(await furniturePackageReport(ctx), "No furniture packages sold yet for this org.")
}
async function computeInteriorPackageComparisonReport(ctx: { orgId: string }): Promise<ReportDefinitionResult> {
  return rowsToResult(await interiorPackageComparisonReport(ctx), "No interior sales packages logged yet for this org.")
}
async function computeModularKitchenSalesReport(ctx: { orgId: string }): Promise<ReportDefinitionResult> {
  return rowsToResult(await modularKitchenSalesReport(ctx), "No modular kitchen packages sold yet for this org.")
}
async function computeRoomWiseEstimateReport(ctx: { orgId: string }): Promise<ReportDefinitionResult> {
  return rowsToResult(await roomWiseEstimateReport(ctx), "No room-wise estimate packages logged yet for this org.")
}
async function computeWardrobeSalesReport(ctx: { orgId: string }): Promise<ReportDefinitionResult> {
  return rowsToResult(await wardrobeSalesReport(ctx), "No wardrobe packages sold yet for this org.")
}

/**
 * R65 (2026-08-31): closes the shared root gap for 3 report_definitions
 * rows (Booking vs Target Report, KPI: Sales Target Achievement %, Sales
 * Target Achievement) -- their data_gap_note said "no sales-target table
 * exists anywhere in the schema," which was stale: crmSalesTargets (a real,
 * org+month-scoped target row) was added later (2026-07-27, Sales Pipeline
 * Interactive Dashboard) and has simply never been wired to any report.
 * "Actual bookings" reuses the same real metric the already-built Revenue
 * Booking Report uses -- sum(erp_sales_invoices.grandTotal) -- restricted to
 * submitted/partially_paid/paid/overdue (booked/recognized revenue), never
 * draft (not yet committed) or cancelled (never happened).
 */
async function computeSalesTargetAchievement(ctx: { orgId: string }, params: Record<string, unknown>): Promise<ReportDefinitionResult> {
  const monthParam = typeof params.month === "string" ? params.month : undefined
  const now = new Date()
  const monthStart = monthParam ?? `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}-01`
  const start = new Date(monthStart + "T00:00:00Z")
  if (Number.isNaN(start.getTime())) throw new ServiceError("Invalid month param -- expected YYYY-MM-01", 400)
  const nextMonthStart = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 1))
  const nextMonthStr = `${nextMonthStart.getUTCFullYear()}-${String(nextMonthStart.getUTCMonth() + 1).padStart(2, "0")}-01`

  return withTenantContext({ orgId: ctx.orgId }, async (db) => {
    const [targetRow, invoiceRows] = await Promise.all([
      db.query.crmSalesTargets.findFirst({ where: and(eq(crmSalesTargets.orgId, ctx.orgId), eq(crmSalesTargets.month, monthStart)) }),
      db.query.erpSalesInvoices.findMany({
        where: and(
          eq(erpSalesInvoices.orgId, ctx.orgId),
          gte(erpSalesInvoices.postingDate, monthStart),
          lt(erpSalesInvoices.postingDate, nextMonthStr),
          inArray(erpSalesInvoices.status, ["submitted", "partially_paid", "paid", "overdue"])
        ),
        columns: { grandTotal: true },
      }),
    ])

    const actual = invoiceRows.reduce((sum, inv) => sum + Number(inv.grandTotal ?? 0), 0)
    const target = targetRow ? Number(targetRow.targetValue) : null

    if (target === null) {
      return {
        columns: ["Month", "Target", "Actual Bookings", "Achievement %"],
        rows: [],
        note: `No sales target has been set for ${monthStart.slice(0, 7)} yet (crm_sales_targets has no row for this org/month). Actual bookings for the month so far: ₹${actual.toLocaleString("en-IN")} -- set a target for this month to see achievement %.`,
      }
    }

    const achievementPct = target > 0 ? Math.round((actual / target) * 1000) / 10 : 0
    return {
      columns: ["Month", "Target", "Actual Bookings", "Achievement %"],
      rows: [{ Month: monthStart.slice(0, 7), Target: target, "Actual Bookings": Math.round(actual * 100) / 100, "Achievement %": achievementPct }],
    }
  })
}

/**
 * FI-GL-007 (Subledger-to-GL Reconciliation) -- thin {columns,rows} reshape
 * over erp-financial-report-service.ts#subledgerToGlReconciliation, the
 * real computation (see that function's own header comment for the full
 * design, honest scope, and why this reconciliation is genuinely meaningful
 * rather than a no-op in this codebase). params.asOfDate/companyId/
 * consolidate mirror the same optional params trial-balance/cash-flow's own
 * FORMULA_REGISTRY-adjacent report routes already accept.
 */
async function computeSubledgerToGlReconciliation(ctx: { orgId: string }, params: Record<string, unknown>): Promise<ReportDefinitionResult> {
  const asOfDate = typeof params.asOfDate === "string" && params.asOfDate ? params.asOfDate : new Date().toISOString().slice(0, 10)
  const companyId = typeof params.companyId === "string" ? params.companyId : undefined
  const result = await subledgerToGlReconciliation(ctx, asOfDate, companyId ? { companyId, consolidate: params.consolidate === true } : undefined)

  return {
    columns: ["Subledger", "GL Control Account(s)", "Subledger Total", "GL Balance", "Variance", "Reconciled"],
    rows: result.rows.map((r) => ({
      Subledger: r.subledger === "receivable" ? "Accounts Receivable" : "Accounts Payable",
      "GL Control Account(s)": r.glAccountNames.length ? r.glAccountNames.join(", ") : "(none configured)",
      "Subledger Total": Math.round(r.subledgerTotal * 100) / 100,
      "GL Balance": Math.round(r.glBalance * 100) / 100,
      Variance: Math.round(r.variance * 100) / 100,
      Reconciled: r.isReconciled ? "Yes" : "NO -- investigate",
    })),
    note: result.allReconciled
      ? `Both AR and AP reconcile to the GL as of ${asOfDate} (within the ${SUBLEDGER_RECONCILIATION_TOLERANCE} rounding tolerance).`
      : `At least one subledger does NOT reconcile to the GL as of ${asOfDate} -- see the flagged row(s) above. Fixed-asset reconciliation is a separate report (FI-AA-006); inventory/stock is not included here because stock movements do not yet post a journal entry to the GL in this codebase.`,
  }
}

/**
 * R65 (2026-08-31, report-definitions gap closure): "Critical Path
 * Report"'s own data_gap_note (dated 2026-07-13) said pms_issue_relations
 * tracks blocks/blocked_by dependencies with lag_days but "no critical-path
 * (CPM) algorithm is implemented over that graph yet". That note is stale
 * -- Wave 140 (PROJEXA Gantt/critical-path/baseline/resource-leveling gap
 * analysis) already built a real CPM computation in schedule-service.ts#
 * calculateCriticalPath(): forward pass (earliest start/finish) then
 * backward pass (latest start/finish) over the predecessor->successor DAG
 * built from pms_issue_relations' typed blocks/blocked_by rows + lagDays,
 * topologically ordered via Kahn's algorithm, float = LS - ES, critical =
 * float <= 0. It just never got wired into a report_definitions row. This
 * is pure plumbing, not new computation: reshape that function's real
 * per-issue {title, startDate, dueDate, completionPercentage, floatDays,
 * isCritical} rows into the {columns, rows} shape the report engine
 * expects. Project-scoped (a critical path is meaningless without a single
 * project's dependency graph), matching the SPI/CPI/Earned-Value formulas'
 * own required projectId param.
 */
async function computeCriticalPathReport(ctx: { orgId: string }, params: Record<string, unknown>): Promise<ReportDefinitionResult> {
  const projectId = String(params.projectId ?? "")
  if (!projectId) throw new ServiceError("projectId is required for the Critical Path Report", 400)
  const tasks = await calculateCriticalPath(ctx, projectId)
  if (tasks.length === 0) {
    return {
      columns: ["Task", "Start Date", "Due Date", "% Complete", "Float (Days)", "On Critical Path?"],
      rows: [],
      note: "No active (non-archived) issues found for this project -- log tasks with start/due dates and blocks/blocked_by relations (Schedule module) before a critical path can be computed.",
    }
  }
  const sorted = [...tasks].sort((a, b) => {
    if (a.isCritical !== b.isCritical) return a.isCritical ? -1 : 1
    return (a.startDate ?? "9999-99-99").localeCompare(b.startDate ?? "9999-99-99") || a.title.localeCompare(b.title)
  })
  const criticalCount = tasks.filter((t) => t.isCritical).length
  return {
    columns: ["Task", "Start Date", "Due Date", "% Complete", "Float (Days)", "On Critical Path?"],
    rows: sorted.map((t) => ({
      Task: t.title,
      "Start Date": t.startDate ?? "(not set)",
      "Due Date": t.dueDate ?? "(not set)",
      "% Complete": t.completionPercentage,
      "Float (Days)": t.floatDays ?? "N/A",
      "On Critical Path?": t.isCritical ? "Yes" : "No",
    })),
    note: criticalCount > 0
      ? `${criticalCount} of ${tasks.length} task(s) are on the critical path (zero or negative float) -- a slip on any of them delays the whole project. Float (Days) is Late Start minus Early Start from a forward/backward pass over each task's real startDate/dueDate and its blocks/blocked_by relations (with lagDays); "N/A" means the task has no dependency relation at all, so critical/float is not meaningful for it. A task missing either startDate or dueDate defaults to a nominal 1-day duration so it can still sit in the graph.`
      : `No task is on the critical path for this project -- either no task yet has a blocks/blocked_by dependency relation (Schedule module), or the dependency graph has a cycle (blocks/blocked_by relations that loop back on each other), which this computation deliberately leaves as float=N/A rather than guess at.`,
  }
}


// SD-006 "Sales by Material / Service Type" (sap_mapping.sqlite sap_reports,
// module SD, priority MEDIUM, BUILD_NEW as of 2026-07-28, re-verified
// directly against this repo on 2026-07-30 rather than trusting the gap
// analysis file's own citations). Per that row's own implementation_notes,
// renamed for construction: "Revenue by Service Type" -- the material
// master (erp_items, grouped via erp_item_groups) maps to a construction
// firm's service catalog/work type (demolition, joinery, painting,
// electrical, project-management-fee, ...).
//
// Real finding: erp_sales_invoice_items.item_id (Wave 60) already exists
// and is nullable -- the schema already supports grouping revenue by
// material/service-item type, but grep across every src/lib/services/*.ts
// file found zero report function anywhere that performs this specific
// aggregation. This is a genuine BUILD_NEW: no new schema, a new query +
// grouping only.
//
// calculation_logic's "Total Net Revenue = sum of net values from billing
// line items matching that material/material group" maps directly onto
// summing erp_sales_invoice_items.amount (already quantity * rate,
// snapshotted per line at invoice-creation time -- see
// erp-invoicing-service.ts#createSalesInvoice) for non-cancelled invoices
// in the selected period.

/** One already-resolved billing line (invoice item joined to its item/item-group), the shape the DB-touching wrapper below builds from real query rows. */
export type SalesByServiceTypeLine = {
  itemCode: string | null
  itemName: string | null
  itemGroupName: string | null
  description: string
  quantity: number
  amount: number
  standardBuyingRate: number | null
}

export type SalesByServiceTypeRow = {
  code: string
  description: string
  totalNetRevenue: number
  billingLineItems: number
  costOfGoodsSold: number | null
  grossProfit: number | null
  grossMarginPercent: number | null
}

/**
 * Pure grouping/summing function -- extracted standalone (same precedent as
 * isBillingScheduleDue above) so the actual aggregation is directly
 * unit-testable with real multi-material fixture data, while the
 * DB-touching wrapper (salesByMaterialServiceTypeReport, below) stays
 * untested here, matching this file's own established convention (see this
 * file's test file header comment).
 *
 * groupBy "item" groups by erp_items.item_code (individual material/service
 * item); groupBy "group" groups by the item's erp_item_groups.group_name
 * (material group). Either way, a line with no itemCode/itemGroupName at
 * all (erp_sales_invoice_items.item_id is nullable -- a free-text service
 * description with no erp_items link) is bucketed into a real "Unassigned"
 * group instead of being silently dropped, matching this codebase's
 * established convention for an ungroupable-but-real row
 * (interiorProfitByRoomAnalysis's "Unassigned" room bucket).
 *
 * Gross Profit / Gross Margin % (includeCost: true) uses
 * erp_items.standard_buying_rate x quantity as the cost -- this is a PROXY,
 * not a real weighted-average cost from the stock ledger (no
 * per-invoice-line cost allocation exists in this schema). A line with no
 * standard_buying_rate set (or no item link at all) contributes $0 cost,
 * which overstates margin for those lines -- disclosed via the caller's
 * `note` field (salesByMaterialServiceTypeReport), not hidden here.
 */
export function aggregateSalesByMaterialServiceType(
  lines: SalesByServiceTypeLine[],
  opts: { groupBy: "item" | "group"; includeCost: boolean }
): SalesByServiceTypeRow[] {
  const byKey = new Map<string, { code: string; description: string; revenue: number; count: number; cost: number }>()

  for (const line of lines) {
    const groupLabel = opts.groupBy === "group" ? line.itemGroupName : line.itemCode
    const key = groupLabel ?? "__unassigned__"
    const code = groupLabel ?? (opts.groupBy === "group" ? "Unassigned" : "UNASSIGNED")
    const description =
      opts.groupBy === "group"
        ? (line.itemGroupName ?? "No item group / no item link (free-text service line)")
        : (line.itemName ?? line.description)

    const existing = byKey.get(key) ?? { code, description, revenue: 0, count: 0, cost: 0 }
    existing.revenue += line.amount
    existing.count += 1
    if (opts.includeCost) existing.cost += line.quantity * (line.standardBuyingRate ?? 0)
    byKey.set(key, existing)
  }

  return [...byKey.values()].map((g) => {
    const revenue = Math.round(g.revenue * 100) / 100
    const cost = opts.includeCost ? Math.round(g.cost * 100) / 100 : null
    const grossProfit = opts.includeCost && cost !== null ? Math.round((g.revenue - g.cost) * 100) / 100 : null
    const grossMarginPercent = opts.includeCost ? (g.revenue > 0 ? Math.round(((g.revenue - g.cost) / g.revenue) * 10000) / 100 : 0) : null
    return {
      code: g.code,
      description: g.description,
      totalNetRevenue: revenue,
      billingLineItems: g.count,
      costOfGoodsSold: cost,
      grossProfit,
      grossMarginPercent,
    }
  })
}

/**
 * DB-touching wrapper: real erp_sales_invoice_items joined to
 * erp_sales_invoices (org + period + not-cancelled filter, optional
 * customer filter) and left-joined to erp_items/erp_item_groups, fed
 * through aggregateSalesByMaterialServiceType above. Untested here
 * (see that function's own header + this file's test file note).
 *
 * params: dateFrom/dateTo (required -- calculation_logic's "period
 * selection"), groupBy ("item" default | "group"), customerId (optional),
 * includeCost (optional, default false), sortBy ("revenue" default |
 * "margin").
 */
async function salesByMaterialServiceTypeReport(ctx: { orgId: string }, params: Record<string, unknown>): Promise<ReportDefinitionResult> {
  const dateFrom = typeof params.dateFrom === "string" ? params.dateFrom : undefined
  const dateTo = typeof params.dateTo === "string" ? params.dateTo : undefined
  if (!dateFrom || !dateTo) throw new ServiceError("dateFrom and dateTo are required for the Sales by Material/Service Type report", 400)
  const groupBy: "item" | "group" = params.groupBy === "group" ? "group" : "item"
  const includeCost = params.includeCost === true || params.includeCost === "true"
  const customerId = typeof params.customerId === "string" && params.customerId ? params.customerId : undefined
  const sortBy: "revenue" | "margin" = params.sortBy === "margin" ? "margin" : "revenue"

  return withTenantContext({ orgId: ctx.orgId }, async (db) => {
    const invoiceConditions = [
      eq(erpSalesInvoices.orgId, ctx.orgId),
      gte(erpSalesInvoices.postingDate, dateFrom),
      lte(erpSalesInvoices.postingDate, dateTo),
      sql`${erpSalesInvoices.status} != 'cancelled'`,
    ]
    if (customerId) invoiceConditions.push(eq(erpSalesInvoices.customerId, customerId))

    const rawRows = await db
      .select({
        itemId: erpSalesInvoiceItems.itemId,
        description: erpSalesInvoiceItems.description,
        quantity: erpSalesInvoiceItems.quantity,
        amount: erpSalesInvoiceItems.amount,
        itemCode: erpItems.itemCode,
        itemName: erpItems.itemName,
        itemGroupId: erpItems.itemGroupId,
        standardBuyingRate: erpItems.standardBuyingRate,
      })
      .from(erpSalesInvoiceItems)
      .innerJoin(erpSalesInvoices, eq(erpSalesInvoiceItems.invoiceId, erpSalesInvoices.id))
      .leftJoin(erpItems, eq(erpSalesInvoiceItems.itemId, erpItems.id))
      .where(and(...invoiceConditions))

    const groupIds = [...new Set(rawRows.map((r) => r.itemGroupId).filter((id): id is string => !!id))]
    const groupRows = groupIds.length ? await db.query.erpItemGroups.findMany({ where: inArray(erpItemGroups.id, groupIds) }) : []
    const groupNameById = new Map(groupRows.map((g) => [g.id, g.groupName]))

    const lines: SalesByServiceTypeLine[] = rawRows.map((r) => ({
      itemCode: r.itemCode,
      itemName: r.itemName,
      itemGroupName: r.itemGroupId ? (groupNameById.get(r.itemGroupId) ?? null) : null,
      description: r.description,
      quantity: Number(r.quantity),
      amount: Number(r.amount),
      standardBuyingRate: r.standardBuyingRate != null ? Number(r.standardBuyingRate) : null,
    }))

    const aggregated = aggregateSalesByMaterialServiceType(lines, { groupBy, includeCost })
    const sorted = [...aggregated].sort((a, b) =>
      sortBy === "margin"
        ? (b.grossMarginPercent ?? -Infinity) - (a.grossMarginPercent ?? -Infinity)
        : b.totalNetRevenue - a.totalNetRevenue
    )

    const codeColumn = groupBy === "group" ? "Material Group" : "Material/Item Code"
    const columns = [codeColumn, "Description", "Total Net Revenue", "Billing Line Items"]
    if (includeCost) columns.push("Cost of Goods Sold (proxy)", "Gross Profit", "Gross Margin %")

    return {
      columns,
      rows: sorted.map((r) => {
        const row: Record<string, string | number> = {
          [codeColumn]: r.code,
          Description: r.description,
          "Total Net Revenue": r.totalNetRevenue,
          "Billing Line Items": r.billingLineItems,
        }
        if (includeCost) {
          row["Cost of Goods Sold (proxy)"] = r.costOfGoodsSold ?? 0
          row["Gross Profit"] = r.grossProfit ?? 0
          row["Gross Margin %"] = r.grossMarginPercent ?? 0
        }
        return row
      }),
      note: includeCost
        ? "Cost of Goods Sold is a PROXY (erp_items.standard_buying_rate x quantity), not a real weighted-average cost from the stock ledger -- erp_stock_ledger_entries has no per-invoice-line cost allocation in this schema. Lines with no standard_buying_rate set (or no item link at all -- item_id is nullable) contribute $0 cost, which overstates margin for those lines. Rows with no item/item-group link are bucketed as 'Unassigned', not dropped. No prior-period comparison is computed by this report -- pass a separate dateFrom/dateTo call for a prior period and diff client-side; no 'customer sales analysis' report exists yet in this codebase to reuse a shared variance calculation from."
        : "Rows with no item/item-group link (erp_sales_invoice_items.item_id is nullable -- a free-text service line) are bucketed as 'Unassigned', not dropped. No prior-period comparison is computed by this report -- pass a separate dateFrom/dateTo call for a prior period and diff client-side; no 'customer sales analysis' report exists yet in this codebase to reuse a shared variance calculation from.",
    }
  })
}

export const FORMULA_REGISTRY: Record<string, FormulaFn> = {
  materials_running_low: computeMaterialsRunningLow,
  sales_dashboard: computeSalesDashboard,
  monthly_project_report: computeMonthlyProjectReport,
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
  earned_value_analysis: computeEarnedValueAnalysis,
  portfolio_completion_percent: computePortfolioCompletionPercent,
  portfolio_budget_utilization: computePortfolioBudgetUtilization,
  todays_site_progress: computeTodaysSiteProgress,
  critical_path_report: computeCriticalPathReport,
  weekly_project_report: computeWeeklyProjectReport,
  labour_on_site_today: computeLabourOnSiteToday,
  vendors_delayed_purchase_orders: computeVendorsDelayedPurchaseOrders,
  safety_incidents_this_month: computeSafetyIncidentsThisMonth,
  contractor_performance_report: computeContractorPerformanceReport,
  labour_productivity_analysis: computeLabourProductivityAnalysis,
  snag_trend_analysis: computeSnagTrendAnalysis,
  risk_heat_map: computeRiskHeatMap,
  issue_resolution_analysis: computeIssueResolutionAnalysis,
  approval_bottleneck_analysis: computeApprovalBottleneckAnalysis,
  weather_impact_analysis: computeWeatherImpactAnalysis,
  design_change_impact_analysis: computeDesignChangeImpactAnalysis,
  cost_overrun_report: computeCostOverrunReport,
  profitability_analysis: computeProfitabilityAnalysis,
  material_cost_report: computeMaterialCostReport,
  sales_target_achievement: computeSalesTargetAchievement,
  tender_register: computeTenderRegister,
  tender_pipeline: computeTenderPipeline,
  tender_win_loss: computeTenderWinLoss,
  tender_costing: computeTenderCosting,
  boq_submission_report: computeBoqSubmissionReport,
  pre_bid_meeting_report: computePreBidMeetingReport,
  emd_tracking_report: computeEmdTrackingReport,
  contract_award_report: computeContractAwardReport,
  interior_3d_design_approval_report: computeThreeDDesignApprovalReport,
  interior_design_consultation_report: computeDesignConsultationReport,
  interior_design_revision_report: computeDesignRevisionReport,
  interior_furniture_package_report: computeFurniturePackageReport,
  interior_package_comparison_report: computeInteriorPackageComparisonReport,
  interior_modular_kitchen_sales_report: computeModularKitchenSalesReport,
  interior_room_wise_estimate_report: computeRoomWiseEstimateReport,
  interior_wardrobe_sales_report: computeWardrobeSalesReport,
  delayed_tasks_report: computeDelayedTasksReport,
  look_ahead_plan: computeLookAheadPlan,
  interior_mood_board_approval_report: interiorMoodBoardApprovalReport,
  interior_material_selection_report: interiorMaterialSelectionReport,
  interior_furniture_procurement_report: interiorFurnitureProcurementReport,
  interior_site_measurement_report: interiorSiteMeasurementReport,
  interior_room_progress_report: interiorRoomProgressReport,
  interior_vendor_lead_time_analysis: interiorVendorLeadTimeAnalysis,
  interior_profit_by_room_analysis: interiorProfitByRoomAnalysis,
  interior_designer_productivity_analysis: interiorDesignerProductivityAnalysis,
  interior_variation_order_analysis: computeInteriorVariationOrderAnalysis,
  rework_analysis: computeReworkAnalysis,
  billing_due_list: computeBillingDueList,
  customer_payment_behavior_dso: computeCustomerPaymentBehavior,
  vendor_payment_behavior_dpo: computeVendorPaymentBehavior,
  subledger_to_gl_reconciliation: computeSubledgerToGlReconciliation,
  sales_by_material_service_type: salesByMaterialServiceTypeReport,
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

  // Gap closure (VERIDIAN Review Framework, Domain Accuracy finding): this
  // was the one free-text LLM call site in the codebase with zero
  // enforcePolicy() gate -- POST /api/reports/definitions lets any
  // authenticated org user set an ai_recipe definition's promptKey/
  // groundingNote to arbitrary text, which flows straight into this
  // function's user message below. Every other free-text call site
  // (chat-service.ts, crm-service.ts, construction-ai-service.ts, etc.)
  // already runs this same gate; report_definitions was the one gap.
  const policyDecision = enforcePolicy(
    { orgId: ctx.orgId, userId: ctx.userId, domain: DEFAULT_DOMAIN, layerKey: "customer_account_oa", eventType: "reports.ai_recipe_execute" },
    `${config.promptKey}\n${config.groundingNote}`
  )
  if (!policyDecision.allowed) {
    return { columns: ["Note"], rows: [{ Note: refusalMessageFor(policyDecision) }] }
  }

  // Gap closure (same finding): the system prompt below TELLS the model to
  // stay grounded in the provided data, but nothing enforced that a real
  // grounding data set actually existed -- groundingData defaults to `{}`
  // (see this function's only caller, executeReportDefinition()) whenever
  // neither the caller nor the definition's groundingQuery supplied
  // anything. An LLM asked to analyze `{}` has no way to produce a grounded
  // answer; whatever it writes is invented regardless of how firmly the
  // prompt forbids that. Refusing before the call (not after) means this
  // never burns a real LLM call on a request that was always going to fail
  // its own stated rule.
  if (!hasGroundingData(groundingData)) {
    return { columns: ["Note"], rows: [{ Note: "No real data was available to ground this analysis in -- refusing to generate an AI narrative from nothing. Configure a groundingQuery for this report, or pass groundingData when running it." }] }
  }

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

  // Priority 12 (OPEN-07 point 8 follow-on, 2026-07-14): the one real gate
  // every report/analysis run goes through, before any query or computation
  // -- this dispatcher had zero branch-check anywhere (confirmed directly,
  // see ai-os/MASTER-TRACKER.yaml's OPEN-07 entry). classifications, not a
  // literal `domain` column, are the source of truth (see
  // deriveReportDomainFromClassifications's own comment).
  const classifications = Array.isArray(definition.classifications) ? (definition.classifications as string[]) : []
  await requireReportDomainEnabled(ctx.orgId, deriveReportDomainFromClassifications(classifications))

  if (definition.status !== "built") {
    return { columns: ["Note"], rows: [{ Note: `This report/analysis is not yet built (status: ${definition.status}).` }], note: definition.dataGapNote ?? undefined }
  }

  const config = definition.executionConfig as AggregationConfig | FormulaConfig | AiRecipeConfig | ExternalServiceConfig

  if (definition.executionType === "deterministic_aggregation" && config.kind === "aggregation") {
    // Priority 11 wave 2 (2026-07-13): resolved against TABLE_REGISTRY --
    // see that registry's own header for why this is safe (still
    // whitelist-only, no arbitrary-query surface). A row whose config has
    // no tableKey (e.g. hand-authored before this wave) throws a clear
    // "cannot resolve" ServiceError rather than silently doing nothing.
    // Priority 17 remaining gap: params.companyId (caller-supplied, e.g. a
    // UI selector) is threaded through as a runtime scope -- see
    // runAggregationFromConfig's own header for why this is safe to pass
    // even for tables that don't support it (silent no-op, never a 500).
    const companyId = typeof params.companyId === "string" ? params.companyId : undefined
    return runAggregationFromConfig(ctx, config, { companyId })
  }

  if (definition.executionType === "deterministic_formula" && config.kind === "formula") {
    const fn = FORMULA_REGISTRY[config.formulaKey]
    if (!fn) throw new ServiceError(`No formula registered for key "${config.formulaKey}"`, 500)
    return fn(ctx, { ...(config.params ?? {}), ...params })
  }

  if (definition.executionType === "ai_recipe" && config.kind === "ai_recipe") {
    // Grounding data: prefer whatever the caller already queried and passed
    // via params.groundingData (built the same way ai-report-builder-
    // service.ts extracts real content before ever calling the LLM). If
    // neither the caller nor params supplied it, but the definition itself
    // carries a groundingQuery (Priority 11 wave 2), auto-run that against
    // the same TABLE_REGISTRY whitelist so the definition is genuinely
    // re-runnable end-to-end, not permanently dependent on a bespoke caller.
    let groundingData = params.groundingData
    if (groundingData === undefined && config.groundingQuery) {
      groundingData = await runAggregationFromConfig(ctx, { kind: "aggregation", ...config.groundingQuery })
    }
    return runAiRecipe(ctx, config, groundingData ?? {})
  }

  if (definition.executionType === "external_service") {
    return { columns: ["Note"], rows: [{ Note: `This report is served by its existing implementation (${(config as ExternalServiceConfig).sourceService}#${(config as ExternalServiceConfig).sourceFunction}), not through this generic engine -- see report-catalog-service.ts for its real route.` }] }
  }

  throw new ServiceError(`Definition ${id} has executionType "${definition.executionType}" but its execution_config has no matching "kind" for that type.`, 500)
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

// Priority 17 remaining gap: `supportsCompanyScope` tells a caller (a future
// UI, or an API consumer today) whether POSTing `params: { companyId }` to
// this definition's /run endpoint will actually filter anything -- true
// only for a 'deterministic_aggregation' definition whose tableKey resolves
// to a TABLE_REGISTRY entry with a whitelisted companyId column (currently:
// crm_leads, erp_sales_invoices). Always false for static/formula/ai_recipe/
// external_service entries -- honest rather than defaulting everything to
// "maybe supported."
export type FullCatalogEntry = ReportCatalogEntry & { source: "static" | "definition"; definitionId?: string; status?: "built" | "data_gap" | "planned"; supportsCompanyScope?: boolean }

function definitionSupportsCompanyScope(executionType: string, executionConfig: unknown): boolean {
  if (executionType !== "deterministic_aggregation") return false
  const config = executionConfig as AggregationConfig | undefined
  if (!config?.tableKey) return false
  const entry = TABLE_REGISTRY[config.tableKey]
  return Boolean(entry?.columns.companyId)
}

export async function getFullReportCatalog(ctx: { orgId: string }): Promise<FullCatalogEntry[]> {
  const staticEntries: FullCatalogEntry[] = REPORT_CATALOG.map((e) => ({ ...e, source: "static", supportsCompanyScope: false }))

  const definitions = await withTenantContext({ orgId: ctx.orgId }, (db) =>
    db.query.reportDefinitions.findMany({
      where: (t, { and, eq, or, isNull }) => and(or(eq(t.orgId, ctx.orgId), isNull(t.orgId)), eq(t.isActive, true)),
      orderBy: (t, { desc }) => desc(t.createdAt),
    })
  )

  const definitionEntries: FullCatalogEntry[] = definitions.map((d) => {
    const classifications = Array.isArray(d.classifications) ? (d.classifications as string[]) : []
    const domain = deriveReportDomainFromClassifications(classifications)
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
      supportsCompanyScope: definitionSupportsCompanyScope(d.executionType, d.executionConfig),
    }
  })

  // Priority 12 (OPEN-07 point 8 follow-on): filter out ERP/construction
  // entries the org can't actually run, rather than list them and 403 on
  // click -- matches this catalog's own "polite message, not silent 403"
  // spirit (see this file's header comment on routeNote). Deliberately
  // filters here (not in capability-tree-service.ts's buildReportCatalogNodes,
  // which just consumes this function's output) -- that file is a parallel
  // workstream's area this wave, and filtering at the source means every
  // consumer of getFullReportCatalog/getFullReportCatalogByDomain benefits
  // without each needing its own branch-aware filter.
  const allEntries = [...staticEntries, ...definitionEntries]
  const domainsPresent = Array.from(new Set(allEntries.map((e) => e.domain)))
  const enabledByDomain = new Map(
    await Promise.all(domainsPresent.map(async (domain) => [domain, await isReportDomainEnabledForOrg(ctx.orgId, domain)] as const))
  )
  return allEntries.filter((e) => enabledByDomain.get(e.domain) ?? true)
}

export async function getFullReportCatalogByDomain(ctx: { orgId: string }): Promise<Record<ReportDomain, FullCatalogEntry[]>> {
  const all = await getFullReportCatalog(ctx)
  const byDomain: Record<ReportDomain, FullCatalogEntry[]> = { compliance: [], ERP: [], construction: [], "AI-ops": [], custom: [], CRM: [] }
  for (const entry of all) byDomain[entry.domain].push(entry)
  return byDomain
}
