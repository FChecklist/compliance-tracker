// Point 33 (PROJEXA Materials) service layer -- material master + inbound
// receipts. His words, all of them: "material database. material inbound,
// spec, cost, qty." No outbound/consumption/stock-on-hand -- not requested,
// not built. receipt.unitCost defaults from the master's unitCost but is
// stored per receipt (a delivery can be priced differently), matching
// construction-labour-service.ts's dailyCost-computed-at-write-time posture.
import { constructionMaterials, constructionMaterialReceipts } from "@/lib/db"
import { withTenantContext } from "@/lib/db/tenant-scoped"
import { and, eq, sql } from "drizzle-orm"
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
export async function getMaterialCostReport(ctx: { orgId: string }, projectId: string) {
  return withTenantContext({ orgId: ctx.orgId }, async (db) => {
    const totals = await db.select({
      materialId: constructionMaterialReceipts.materialId,
      totalQuantityReceived: sql<string>`coalesce(sum(${constructionMaterialReceipts.quantity}), 0)`,
      totalCost: sql<string>`coalesce(sum(${constructionMaterialReceipts.quantity} * ${constructionMaterialReceipts.unitCost}), 0)`,
    })
      .from(constructionMaterialReceipts)
      .where(and(eq(constructionMaterialReceipts.orgId, ctx.orgId), eq(constructionMaterialReceipts.projectId, projectId)))
      .groupBy(constructionMaterialReceipts.materialId)

    if (totals.length === 0) return []

    const materials = await db.query.constructionMaterials.findMany({
      where: and(eq(constructionMaterials.orgId, ctx.orgId), eq(constructionMaterials.projectId, projectId)),
    })
    const materialById = new Map(materials.map((m) => [m.id, m]))

    return totals.map((t) => {
      const material = materialById.get(t.materialId)
      const totalQuantityReceived = Number(t.totalQuantityReceived)
      const totalCost = Math.round(Number(t.totalCost) * 100) / 100
      return {
        materialId: t.materialId,
        name: material?.name ?? t.materialId,
        spec: material?.spec ?? null,
        unit: material?.unit ?? "",
        totalQuantityReceived,
        totalCost,
        averageUnitCost: totalQuantityReceived > 0 ? Math.round((totalCost / totalQuantityReceived) * 100) / 100 : 0,
      }
    })
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
