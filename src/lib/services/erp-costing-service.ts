// CO-006 (sap_mapping.sqlite gap analysis, "Statistical Key Figure Report",
// module CO, BUILD_NEW/LOW, veridian_existing_equivalent=None). Confirmed
// via a fresh grep of src/lib/db/schema.ts and this directory immediately
// before writing this file that zero statistical-key-figure concept
// existed anywhere in this codebase, and that no dedicated Controlling
// (CO) service file existed either -- erp-accounting-service.ts owns cost
// center CRUD (listCostCenters/createCostCenter, studied directly as the
// template below) but nothing CO-specific beyond that. This is the first
// file in that domain.
//
// Follows this codebase's own established ERP service conventions exactly
// (studied erp-accounting-service.ts and erp-fixed-assets-service.ts
// before writing anything here): requireErpEnabled() first in every
// exported function, withTenantContext for every DB access (RLS-
// respecting, never the raw db client), logActivity() on every state
// change, ServiceError for expected failure modes, and a pure/DB-free
// core function for the report's own aggregation logic (directly unit
// tested in erp-costing-service.test.ts, matching erp-fixed-assets-
// service.ts's computeAssetGlReconciliation precedent).
//
// SAP's own statistical key figures (SKFs) are non-financial, per-cost-
// center metrics (headcount, square meters, machine hours, etc.) used as
// CO allocation drivers. This service is deliberately lighter than SAP's
// own two-transaction model (KB21N posts actuals, KP46 enters plan, both
// heavy master-data-driven transactions): one master-data function
// (createStatisticalKeyFigureType) and one posting function
// (postStatisticalKeyFigureValue) covering both plan and actual via a
// version tag, so an org can record a value without standing up a
// parallel SKF posting workflow.
//
// IMPORTANT, disclosed up front (see this PR's own description for the
// full quote): sap_mapping.sqlite's own implementation_notes field for
// CO-006 argues AGAINST building this as a standalone report at all,
// preferring that any future overhead-allocation feature let the user
// pick a driver straight from existing data (active-project count, labor
// hours, revenue) rather than requiring separate SKF master data/posting.
// This file takes the task's explicit instruction to build the literal
// SAP-equivalent report anyway, but keeps it a genuinely OPTIONAL,
// standalone tracking/verification feature -- nothing elsewhere in this
// codebase depends on erp_statistical_key_figure_postings existing or
// being populated, so it does not contradict that note's real concern
// (forcing SKF master data as a mandatory prerequisite).
import {
  erpStatisticalKeyFigureTypes, erpStatisticalKeyFigurePostings, erpCostCenters, users,
} from "@/lib/db"
import { withTenantContext } from "@/lib/db/tenant-scoped"
import { and, eq, inArray } from "drizzle-orm"
import { ServiceError } from "./compliance-service"
export { ServiceError }
import { logActivity } from "@/lib/audit"
import { requireErpEnabled } from "./erp-enablement-service"

export type ErpContext = { orgId: string; userId: string; dbUser: typeof users.$inferSelect }

function round2(n: number): number {
  return Math.round(n * 100) / 100
}

// ============================================================
// Master data: Statistical Key Figure Types
// ============================================================

export async function listStatisticalKeyFigureTypes(ctx: { orgId: string }) {
  await requireErpEnabled(ctx.orgId)
  return withTenantContext({ orgId: ctx.orgId }, async (db) => {
    return db.query.erpStatisticalKeyFigureTypes.findMany({
      where: eq(erpStatisticalKeyFigureTypes.orgId, ctx.orgId),
      orderBy: (t, { asc }) => asc(t.name),
    })
  })
}

export type StatisticalKeyFigureTypeInput = { name: string; unitOfMeasure: string; isActive?: boolean }

export async function createStatisticalKeyFigureType(ctx: ErpContext, input: StatisticalKeyFigureTypeInput) {
  await requireErpEnabled(ctx.orgId)
  if (!input.name?.trim()) throw new ServiceError("name is required", 400)
  if (!input.unitOfMeasure?.trim()) throw new ServiceError("unitOfMeasure is required", 400)
  return withTenantContext({ orgId: ctx.orgId, userId: ctx.userId }, async (db) => {
    const [skfType] = await db.insert(erpStatisticalKeyFigureTypes).values({
      orgId: ctx.orgId, name: input.name, unitOfMeasure: input.unitOfMeasure, isActive: input.isActive ?? true,
    }).returning()
    await logActivity({ tx: db, orgId: ctx.orgId, dbUser: ctx.dbUser, action: "erp_statistical_key_figure_type.created", entityType: "erp_statistical_key_figure_type", entityId: skfType.id })
    return skfType
  })
}

// ============================================================
// Postings (KB21N actual-posting / KP46 plan-entry equivalent, merged
// into one function via the `version` tag)
// ============================================================

export type StatisticalKeyFigurePostingInput = {
  statKeyFigureTypeId: string
  costCenterId: string
  accountingPeriodId: string
  version: "plan" | "actual"
  value: number
  remark?: string
}

export async function postStatisticalKeyFigureValue(ctx: ErpContext, input: StatisticalKeyFigurePostingInput) {
  await requireErpEnabled(ctx.orgId)
  if (!input.statKeyFigureTypeId) throw new ServiceError("statKeyFigureTypeId is required", 400)
  if (!input.costCenterId) throw new ServiceError("costCenterId is required", 400)
  if (!input.accountingPeriodId) throw new ServiceError("accountingPeriodId is required", 400)
  if (input.version !== "plan" && input.version !== "actual") throw new ServiceError("version must be 'plan' or 'actual'", 400)
  if (typeof input.value !== "number" || Number.isNaN(input.value)) throw new ServiceError("value is required and must be a number", 400)

  return withTenantContext({ orgId: ctx.orgId, userId: ctx.userId }, async (db) => {
    const [posting] = await db.insert(erpStatisticalKeyFigurePostings).values({
      orgId: ctx.orgId,
      statKeyFigureTypeId: input.statKeyFigureTypeId,
      costCenterId: input.costCenterId,
      accountingPeriodId: input.accountingPeriodId,
      version: input.version,
      value: String(input.value),
      postedById: ctx.userId,
      remark: input.remark,
    }).returning()
    await logActivity({ tx: db, orgId: ctx.orgId, dbUser: ctx.dbUser, action: "erp_statistical_key_figure_posting.created", entityType: "erp_statistical_key_figure_posting", entityId: posting.id })
    return posting
  })
}

// ============================================================
// Report (SAP CO-006 equivalent). Pure aggregation core first (no DB,
// directly unit tested in erp-costing-service.test.ts), then the DB
// wrapper that feeds it real rows -- matching erp-fixed-assets-service.ts's
// computeAssetGlReconciliation / assetToGlReconciliation split exactly.
// ============================================================

export type StatKeyFigurePostingRow = {
  statKeyFigureTypeId: string
  costCenterId: string
  version: "plan" | "actual"
  value: number
}

export type StatKeyFigureReportRow = {
  costCenterId: string
  costCenterName: string
  statKeyFigureTypeId: string
  statKeyFigureName: string
  unitOfMeasure: string
  planValue: number
  actualValue: number
  variance: number
}

/**
 * Pure core (no DB): matches SAP's own calculation logic exactly --
 * actual (and plan) values for a given SKF/cost-center are the SUM of all
 * postings for that period selection, not a single overwritten value
 * (KB21N-style additive posting). One output row per (cost center, SKF
 * type) pair that has at least one posting in the input.
 */
export function computeStatisticalKeyFigureReport(
  types: { id: string; name: string; unitOfMeasure: string }[],
  costCenters: { id: string; name: string }[],
  postings: StatKeyFigurePostingRow[]
): StatKeyFigureReportRow[] {
  const typeById = new Map(types.map((t) => [t.id, t]))
  const costCenterById = new Map(costCenters.map((c) => [c.id, c]))

  const sums = new Map<string, { costCenterId: string; statKeyFigureTypeId: string; plan: number; actual: number }>()
  for (const p of postings) {
    const key = `${p.costCenterId}::${p.statKeyFigureTypeId}`
    const entry = sums.get(key) ?? { costCenterId: p.costCenterId, statKeyFigureTypeId: p.statKeyFigureTypeId, plan: 0, actual: 0 }
    if (p.version === "plan") entry.plan += p.value
    else entry.actual += p.value
    sums.set(key, entry)
  }

  const rows: StatKeyFigureReportRow[] = []
  for (const entry of sums.values()) {
    const cc = costCenterById.get(entry.costCenterId)
    const t = typeById.get(entry.statKeyFigureTypeId)
    // Defensive only -- real FK data never hits this; a posting whose
    // cost center or type isn't in the (org-scoped, possibly filtered)
    // lookup lists passed in is silently skipped rather than crashing the
    // whole report over one bad row.
    if (!cc || !t) continue
    rows.push({
      costCenterId: entry.costCenterId,
      costCenterName: cc.name,
      statKeyFigureTypeId: entry.statKeyFigureTypeId,
      statKeyFigureName: t.name,
      unitOfMeasure: t.unitOfMeasure,
      planValue: round2(entry.plan),
      actualValue: round2(entry.actual),
      variance: round2(entry.actual - entry.plan),
    })
  }

  rows.sort((a, b) => a.costCenterName.localeCompare(b.costCenterName) || a.statKeyFigureName.localeCompare(b.statKeyFigureName))
  return rows
}

export type StatisticalKeyFigureReportFilter = {
  /** Required -- matches the SAP report's own "period or period range" input requirement. One or more erp_accounting_periods ids. */
  accountingPeriodIds: string[]
  costCenterIds?: string[]
  statKeyFigureTypeIds?: string[]
}

/**
 * DB wrapper: loads org-scoped (optionally filtered) SKF types + cost
 * centers for display names/units, sums postings within the requested
 * accounting period(s), then runs the pure aggregation above.
 */
export async function statisticalKeyFigureReport(ctx: { orgId: string }, filter: StatisticalKeyFigureReportFilter) {
  await requireErpEnabled(ctx.orgId)
  if (!filter.accountingPeriodIds?.length) throw new ServiceError("accountingPeriodIds is required (at least one period)", 400)

  return withTenantContext({ orgId: ctx.orgId }, async (db) => {
    const types = await db.query.erpStatisticalKeyFigureTypes.findMany({
      where: and(
        eq(erpStatisticalKeyFigureTypes.orgId, ctx.orgId),
        filter.statKeyFigureTypeIds?.length ? inArray(erpStatisticalKeyFigureTypes.id, filter.statKeyFigureTypeIds) : undefined
      ),
    })
    const costCenters = await db.query.erpCostCenters.findMany({
      where: and(
        eq(erpCostCenters.orgId, ctx.orgId),
        filter.costCenterIds?.length ? inArray(erpCostCenters.id, filter.costCenterIds) : undefined
      ),
    })
    const postingRows = await db.query.erpStatisticalKeyFigurePostings.findMany({
      where: and(
        eq(erpStatisticalKeyFigurePostings.orgId, ctx.orgId),
        inArray(erpStatisticalKeyFigurePostings.accountingPeriodId, filter.accountingPeriodIds),
        filter.costCenterIds?.length ? inArray(erpStatisticalKeyFigurePostings.costCenterId, filter.costCenterIds) : undefined,
        filter.statKeyFigureTypeIds?.length ? inArray(erpStatisticalKeyFigurePostings.statKeyFigureTypeId, filter.statKeyFigureTypeIds) : undefined
      ),
    })

    const postings: StatKeyFigurePostingRow[] = postingRows.map((p) => ({
      statKeyFigureTypeId: p.statKeyFigureTypeId,
      costCenterId: p.costCenterId,
      version: p.version,
      value: Number(p.value),
    }))

    return computeStatisticalKeyFigureReport(types, costCenters, postings)
  })
}
