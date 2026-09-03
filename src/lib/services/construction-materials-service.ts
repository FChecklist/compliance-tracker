// Point 33 (PROJEXA Materials) service layer -- material master + inbound
// receipts. His words, all of them: "material database. material inbound,
// spec, cost, qty." No outbound/consumption/stock-on-hand -- not requested,
// not built. receipt.unitCost defaults from the master's unitCost but is
// stored per receipt (a delivery can be priced differently), matching
// construction-labour-service.ts's dailyCost-computed-at-write-time posture.
import { constructionMaterials, constructionMaterialReceipts, erpSuppliers } from "@/lib/db"
import { withTenantContext } from "@/lib/db/tenant-scoped"
import { and, eq, sql, gte, lte, inArray, isNull } from "drizzle-orm"
import { ServiceError } from "./compliance-service"
export { ServiceError }

export type MaterialInput = {
  projectId: string
  name: string
  spec?: string
  unit: string
  unitCost?: number
}

export type MaterialReceiptInput = {
  projectId: string
  materialId: string
  receivedDate: string
  quantity: number
  unitCost?: number
  vendorId?: string
  notes?: string
  createdById: string
}

export async function listMaterials(ctx: { orgId: string }, projectId: string) {
  return withTenantContext({ orgId: ctx.orgId }, (db) =>
    db.query.constructionMaterials.findMany({
      where: and(eq(constructionMaterials.orgId, ctx.orgId), eq(constructionMaterials.projectId, projectId)),
    })
  )
}

export async function createMaterial(ctx: { orgId: string }, input: MaterialInput) {
  const name = input.name?.trim()
  if (!name) throw new ServiceError("name is required", 400)
  if (!input.projectId) throw new ServiceError("projectId is required", 400)
  if (!input.unit?.trim()) throw new ServiceError("unit is required", 400)

  return withTenantContext({ orgId: ctx.orgId }, async (db) => {
    const [row] = await db.insert(constructionMaterials).values({
      orgId: ctx.orgId, projectId: input.projectId, name,
      spec: input.spec || null, unit: input.unit.trim(),
      unitCost: String(input.unitCost ?? 0),
    }).returning()
    return row
  })
}

// Real-screen conversion (2026-08-30): single-material lookup + real update
// for the Material Object Page -- neither existed since Wave 33; a spec/
// unit-cost correction or retiring a material had no path except
// re-creating it. Mirrors construction-labour-service.ts's identical
// getRosterEntry()/updateRosterEntry() fix this same session.
export async function getMaterial(ctx: { orgId: string }, materialId: string) {
  return withTenantContext({ orgId: ctx.orgId }, async (db) => {
    const material = await db.query.constructionMaterials.findFirst({ where: and(eq(constructionMaterials.id, materialId), eq(constructionMaterials.orgId, ctx.orgId)) })
    if (!material) throw new ServiceError("Material not found", 404)
    return material
  })
}

export async function updateMaterial(
  ctx: { orgId: string },
  materialId: string,
  patch: Partial<{ name: string; spec: string | null; unit: string; unitCost: number; isActive: boolean }>
) {
  return withTenantContext({ orgId: ctx.orgId }, async (db) => {
    const existing = await db.query.constructionMaterials.findFirst({ where: and(eq(constructionMaterials.id, materialId), eq(constructionMaterials.orgId, ctx.orgId)) })
    if (!existing) throw new ServiceError("Material not found", 404)
    if (patch.name !== undefined && !patch.name.trim()) throw new ServiceError("name cannot be empty", 400)
    if (patch.unit !== undefined && !patch.unit.trim()) throw new ServiceError("unit cannot be empty", 400)

    const [row] = await db.update(constructionMaterials)
      .set({ ...patch, unitCost: patch.unitCost !== undefined ? String(patch.unitCost) : undefined })
      .where(eq(constructionMaterials.id, materialId)).returning()
    return row
  })
}

export async function listMaterialReceipts(ctx: { orgId: string }, projectId: string) {
  return withTenantContext({ orgId: ctx.orgId }, (db) =>
    db.query.constructionMaterialReceipts.findMany({
      where: and(eq(constructionMaterialReceipts.orgId, ctx.orgId), eq(constructionMaterialReceipts.projectId, projectId)),
      with: { material: true },
    })
  )
}

// Real-screen conversion (2026-08-30): backs the "Cost Report" tab that
// /site-materials has shown since R52 but that has never worked -- the
// proxy it calls (PROJEXA's api/construction-materials/cost-report/route.ts)
// has always pointed at VERIDIAN's /construction/materials/cost-report,
// and nothing on this side ever implemented that path. Real aggregation
// over the real receipts ledger, matching construction-valuation-service.ts's
// own groupBy/sum precedent (previousBilledAmountsByLineItem) rather than
// inventing a parallel summary table. quantity/unitCost are both numeric
// columns stored as strings (see createMaterialReceipt above) -- summed in
// SQL, not fetched row-by-row and reduced in JS, so this scales the same way
// that precedent does.
// R67 E-05 (R-103). The Cost Report tab was "a summary card wearing the word
// report": no date range, no grand total, no vendor, no export, and it counted
// receipts that had been VOIDED. This is the real report behind it.
//
// WHAT CHANGED, and why each part is here rather than in the browser:
//   * from / to -- a report with no period is not a report. Filtered in SQL so
//     the totals row and the rows above it can never describe different sets.
//   * groupBy -- "which material cost most" and "which vendor cost most" are
//     the two questions a QS actually asks of this ledger.
//   * vendor names -- receipts carry only a vendor_id; every screen that
//     showed it showed a cuid. Joined once here, not per row.
//   * voided receipts EXCLUDED (WS-I item I-02 added voided_at for exactly
//     this: a voided goods receipt stays queryable for its audit trail and
//     must never be counted again as cost). Every consumer that totals cost
//     must filter voided_at IS NULL -- that column's own schema comment.
//   * totals -- returned WITH the rows, from the same grouped read, so the
//     grand total ties by construction rather than by the browser re-adding
//     the numbers and hoping.
export type MaterialCostReportGroupBy = "material" | "vendor"

export type MaterialCostReportOptions = {
  /** YYYY-MM-DD, inclusive. Omitted = no lower bound. */
  from?: string
  /** YYYY-MM-DD, inclusive. Omitted = no upper bound. */
  to?: string
  groupBy?: MaterialCostReportGroupBy
}

/** One (material, vendor) pair as the grouped SQL read returns it. */
export type MaterialReceiptGroup = {
  materialId: string
  vendorId: string | null
  quantity: number
  cost: number
}

export type MaterialCostReportRow = {
  /** materialId when grouping by material, vendorId (or "unassigned") when grouping by vendor. */
  key: string
  materialId: string | null
  name: string
  spec: string | null
  vendorId: string | null
  vendorName: string | null
  unit: string | null
  totalQuantityReceived: number
  totalCost: number
  averageUnitCost: number
  /** The material master's own unit cost. null when the row spans more than one material. */
  masterUnitCost: number | null
  /** averageUnitCost - masterUnitCost. null when there is nothing single to compare against. */
  variance: number | null
}

export type MaterialCostReport = {
  rows: MaterialCostReportRow[]
  totals: { quantity: number; cost: number }
  /** Echoed back so the screen's parameter bar and its numbers can never disagree. */
  params: { projectId: string; from: string | null; to: string | null; groupBy: MaterialCostReportGroupBy }
}

/** More than one distinct material/vendor/unit rolled into one row. Stated in words, never blank. */
export const MIXED_MATERIALS_LABEL = "Multiple materials"
export const MIXED_VENDORS_LABEL = "Multiple vendors"
export const NO_VENDOR_KEY = "unassigned"
export const NO_VENDOR_LABEL = "No vendor recorded"

function round2(n: number): number {
  return Math.round(n * 100) / 100
}

/**
 * Pure roll-up: grouped (material, vendor) receipt totals -> the report's rows
 * and its grand total. DB-free so the arithmetic that a QS checks by hand is
 * testable without a database, the same convention computeEarnedValue and
 * aggregateDesignerTimesheetCosts follow in construction-reports-service.ts.
 *
 * The identity this guarantees, and which the screen asserts before it will
 * enable Export: sum(rows.totalCost) === totals.cost, in BOTH groupings, because
 * both are folded from the same input array.
 */
export function aggregateMaterialCostReport(
  groups: MaterialReceiptGroup[],
  materialById: Map<string, { name: string; spec: string | null; unit: string; unitCost: string | number | null }>,
  vendorNameById: Map<string, string>,
  params: MaterialCostReport["params"]
): MaterialCostReport {
  const byKey = new Map<string, { quantity: number; cost: number; materialIds: Set<string>; vendorIds: Set<string | null> }>()
  for (const g of groups) {
    const key = params.groupBy === "vendor" ? (g.vendorId ?? NO_VENDOR_KEY) : g.materialId
    const bucket = byKey.get(key) ?? { quantity: 0, cost: 0, materialIds: new Set<string>(), vendorIds: new Set<string | null>() }
    bucket.quantity += g.quantity
    bucket.cost += g.cost
    bucket.materialIds.add(g.materialId)
    bucket.vendorIds.add(g.vendorId)
    byKey.set(key, bucket)
  }

  const rows: MaterialCostReportRow[] = [...byKey.entries()].map(([key, bucket]) => {
    const materialIds = [...bucket.materialIds]
    const soleMaterialId = materialIds.length === 1 ? materialIds[0] : null
    const soleMaterial = soleMaterialId ? materialById.get(soleMaterialId) : undefined
    const vendorIds = [...bucket.vendorIds]
    const soleVendorId = vendorIds.length === 1 ? vendorIds[0] : null

    const totalCost = round2(bucket.cost)
    const quantity = round2(bucket.quantity)
    const averageUnitCost = quantity > 0 ? round2(totalCost / quantity) : 0
    const masterUnitCost = soleMaterial && soleMaterial.unitCost !== null && soleMaterial.unitCost !== ""
      ? round2(Number(soleMaterial.unitCost))
      : null

    return {
      key,
      materialId: soleMaterialId,
      name: soleMaterial ? soleMaterial.name : soleMaterialId ?? MIXED_MATERIALS_LABEL,
      spec: soleMaterial?.spec ?? null,
      vendorId: soleVendorId,
      vendorName: soleVendorId === null
        ? (vendorIds.length > 1 ? MIXED_VENDORS_LABEL : NO_VENDOR_LABEL)
        : (vendorNameById.get(soleVendorId) ?? soleVendorId),
      // A quantity summed across two different units is meaningless, so the
      // unit is only stated when there IS one.
      unit: soleMaterial?.unit ?? null,
      totalQuantityReceived: quantity,
      totalCost,
      averageUnitCost,
      masterUnitCost,
      variance: masterUnitCost !== null ? round2(averageUnitCost - masterUnitCost) : null,
    }
  })

  // Costliest first -- the question this report answers is "where did the
  // money go", and that is the row a reader wants at the top.
  rows.sort((a, b) => b.totalCost - a.totalCost)

  return {
    rows,
    totals: {
      quantity: round2(groups.reduce((s, g) => s + g.quantity, 0)),
      cost: round2(groups.reduce((s, g) => s + g.cost, 0)),
    },
    params,
  }
}

export async function getMaterialCostReport(
  ctx: { orgId: string },
  projectId: string,
  options: MaterialCostReportOptions = {}
): Promise<MaterialCostReport> {
  const groupBy: MaterialCostReportGroupBy = options.groupBy === "vendor" ? "vendor" : "material"
  const from = options.from?.trim() || null
  const to = options.to?.trim() || null
  const params = { projectId, from, to, groupBy }

  return withTenantContext({ orgId: ctx.orgId }, async (db) => {
    const conditions = [
      eq(constructionMaterialReceipts.orgId, ctx.orgId),
      eq(constructionMaterialReceipts.projectId, projectId),
      // WS-I I-02's own rule: a voided receipt stays queryable for its audit
      // trail and is never counted as cost again.
      isNull(constructionMaterialReceipts.voidedAt),
    ]
    if (from) conditions.push(gte(constructionMaterialReceipts.receivedDate, from))
    if (to) conditions.push(lte(constructionMaterialReceipts.receivedDate, to))

    // One grouped read, by (material, vendor) -- the finest grain BOTH
    // groupings fold from, so switching Group by never re-queries and the two
    // views can never disagree. Summed in SQL, same posture as before.
    const grouped = await db.select({
      materialId: constructionMaterialReceipts.materialId,
      vendorId: constructionMaterialReceipts.vendorId,
      quantity: sql<string>`coalesce(sum(${constructionMaterialReceipts.quantity}), 0)`,
      cost: sql<string>`coalesce(sum(${constructionMaterialReceipts.quantity} * coalesce(${constructionMaterialReceipts.unitCost}, 0)), 0)`,
    })
      .from(constructionMaterialReceipts)
      .where(and(...conditions))
      .groupBy(constructionMaterialReceipts.materialId, constructionMaterialReceipts.vendorId)

    if (grouped.length === 0) return { rows: [], totals: { quantity: 0, cost: 0 }, params }

    const materials = await db.query.constructionMaterials.findMany({
      where: and(eq(constructionMaterials.orgId, ctx.orgId), eq(constructionMaterials.projectId, projectId)),
      columns: { id: true, name: true, spec: true, unit: true, unitCost: true },
    })
    const materialById = new Map(materials.map((m) => [m.id, { name: m.name, spec: m.spec, unit: m.unit, unitCost: m.unitCost }]))

    // Vendors are erp_suppliers (the /api/v1/projexa/vendors route's own
    // aliasing) -- looked up once for every vendor on the report, never per
    // row, and only when at least one receipt actually names one.
    const vendorIds = [...new Set(grouped.map((g) => g.vendorId).filter((v): v is string => Boolean(v)))]
    const vendors = vendorIds.length > 0
      ? await db.query.erpSuppliers.findMany({
          where: and(eq(erpSuppliers.orgId, ctx.orgId), inArray(erpSuppliers.id, vendorIds)),
          columns: { id: true, supplierName: true },
        })
      : []
    const vendorNameById = new Map(vendors.map((v) => [v.id, v.supplierName]))

    return aggregateMaterialCostReport(
      grouped.map((g) => ({ materialId: g.materialId, vendorId: g.vendorId, quantity: Number(g.quantity), cost: Number(g.cost) })),
      materialById,
      vendorNameById,
      params
    )
  })
}

export async function createMaterialReceipt(ctx: { orgId: string }, input: MaterialReceiptInput) {
  if (!input.materialId) throw new ServiceError("materialId is required", 400)
  if (!input.projectId) throw new ServiceError("projectId is required", 400)
  if (!input.receivedDate) throw new ServiceError("receivedDate is required", 400)
  if (input.quantity === undefined || input.quantity === null) throw new ServiceError("quantity is required", 400)

  return withTenantContext({ orgId: ctx.orgId }, async (db) => {
    const material = await db.query.constructionMaterials.findFirst({
      where: and(eq(constructionMaterials.id, input.materialId), eq(constructionMaterials.orgId, ctx.orgId)),
    })
    if (!material) throw new ServiceError("Material not found", 404)

    const [row] = await db.insert(constructionMaterialReceipts).values({
      orgId: ctx.orgId, projectId: input.projectId, materialId: input.materialId,
      receivedDate: input.receivedDate,
      quantity: String(input.quantity),
      unitCost: input.unitCost !== undefined ? String(input.unitCost) : material.unitCost,
      vendorId: input.vendorId || null, notes: input.notes || null,
      createdById: input.createdById,
    }).returning()
    return row
  })
}
